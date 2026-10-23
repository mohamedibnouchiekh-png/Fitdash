// Apple Health export → SQLite. Idempotent: importing the same (or a newer) export again replaces the affected rows by key.
import { getDb } from "../db.ts";
import { openExport } from "./source.ts";
import { collect, collectHeartRate } from "./healthExport.ts";
import { buildDays, buildRun, buildStrength, categoryOf, dedupeWorkouts, pickHr, type RunRow, type StrengthRow } from "./aggregate.ts";

export interface ImportSummary {
  recordsSeen: number; recordsUsed: number; exportDate: string | null;
  days: number; runs: number; strength: number;
  runsWithRoute: number; runsWithoutRoute: number; duplicateWorkoutsDropped: number;
  ignoredWorkouts: Record<string, number>;
  firstDay: string | null; lastDay: string | null;
}
export interface ImportResult { ok: true; logId: number; summary: ImportSummary; warnings: string[] }
export type Progress = (phase: string) => void;

// On globalThis so every API route (possibly separate bundles in dev) sees the same state.
const g = globalThis as unknown as { __fitdashImport?: { running: boolean; phase: string; startedAt: string | null } };
const state = () => (g.__fitdashImport ??= { running: false, phase: "", startedAt: null });
export const importState = () => ({ ...state() });

/** Mark imports left "running" by a crashed or killed process as failed. */
export function recoverInterruptedImports(): void {
  getDb().prepare("UPDATE import_log SET status='error', error='Interrupted before it finished', finished_at=? WHERE status='running'").run(new Date().toISOString());
}

export async function importHealthExport(input: string, opts: { fileName?: string; fileBytes?: number; progress?: Progress } = {}): Promise<ImportResult> {
  const st = state();
  if (st.running) throw new Error("An import is already running. Wait for it to finish.");
  st.running = true; st.phase = "Starting"; st.startedAt = new Date().toISOString();
  const db = getDb();
  recoverInterruptedImports();
  const log = db.prepare("INSERT INTO import_log (started_at, kind, file_name, file_bytes, status) VALUES (?, 'apple-health-export', ?, ?, 'running')")
    .run(new Date().toISOString(), opts.fileName ?? input.split(/[\\/]/).pop() ?? input, opts.fileBytes ?? null);
  const logId = Number(log.lastInsertRowid);
  const say: Progress = (p) => { st.phase = p; opts.progress?.(p); };
  let src: Awaited<ReturnType<typeof openExport>> | null = null;
  try {
    say("Opening export");
    src = await openExport(input);

    say("Reading export.xml (this can take a few minutes for large exports)");
    const c = await collect(await src.openXml());
    if (c.recordsSeen === 0 && c.workouts.length === 0) throw new Error("export.xml contains no health records. Did you export from the Health app?");

    const warnings = [...c.warnings];
    const ignored: Record<string, number> = {};
    for (const w of c.workouts) if (!categoryOf(w.activity)) { const k = w.activity.replace("HKWorkoutActivityType", ""); ignored[k] = (ignored[k] ?? 0) + 1; }

    say("Combining sources and removing duplicates");
    const dayBuild = buildDays(c);
    warnings.push(...dayBuild.warnings);
    const { kept, dropped } = dedupeWorkouts(c.workouts);

    let hrByWorkout: Awaited<ReturnType<typeof collectHeartRate>> = kept.map(() => []);
    if (kept.length) {
      say("Reading heart rate during workouts");
      hrByWorkout = await collectHeartRate(await src.openXml(), kept.map((w) => ({ start: w.start.abs, end: w.end.abs })));
    }

    say("Building runs and strength sessions");
    const runs: RunRow[] = [], strength: StrengthRow[] = [];
    let withRoute = 0, withoutRoute = 0;
    for (let i = 0; i < kept.length; i++) {
      const w = kept[i];
      const hr = pickHr(hrByWorkout[i], w.source);
      if (categoryOf(w.activity) === "run") {
        let gpx: string | null = null;
        for (const p of w.routePaths) { gpx = await src.readText(p); if (gpx) break; }
        const { row, note } = buildRun(w, hr, gpx);
        if (note) warnings.push(note);
        if (row) { runs.push(row); if (row.splits.length) withRoute++; else withoutRoute++; }
      } else strength.push(buildStrength(w, hr));
    }
    if (withoutRoute > 0) warnings.push(`${withoutRoute} run(s) have no GPS route (treadmill, or the route was not exported). They count toward distance, pace and heart rate, but have no per-km splits and are not used for best 5 km / 10 km efforts.`);
    if (!src.hasRoutes && withoutRoute > 0) warnings.push("This export has no workout-routes folder. Export the full zip from the Health app (not just export.xml) to get splits.");

    say("Saving");
    db.exec("BEGIN");
    try {
      const putDay = db.prepare(`INSERT OR REPLACE INTO day (date,kcal_in,protein,carbs,fat,active_kcal,resting_kcal,steps,resting_hr,hrv,vo2max,resp_rate,sleep_min,deep_min,rem_min,bedtime_min,sources) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const d of dayBuild.days) putDay.run(d.date, d.kcal_in, d.protein, d.carbs, d.fat, d.active_kcal, d.resting_kcal, d.steps, d.resting_hr, d.hrv, d.vo2max, d.resp_rate, d.sleep_min, d.deep_min, d.rem_min, d.bedtime_min, JSON.stringify(d.sources));
      const putRun = db.prepare(`INSERT OR REPLACE INTO run (id,date,start_time,start_ts,end_ts,distance_km,duration_sec,elev_gain,avg_hr,max_hr,splits,hr_series,source,indoor,elev_source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const r of runs) putRun.run(r.id, r.date, r.start_time, r.start_ts, r.end_ts, r.distance_km, r.duration_sec, r.elev_gain, r.avg_hr, r.max_hr, JSON.stringify(r.splits), JSON.stringify(r.hr_series), r.source, r.indoor ? 1 : 0, r.elev_source);
      const putStr = db.prepare(`INSERT OR REPLACE INTO strength (id,date,start_ts,end_ts,duration_min,active_kcal,avg_hr,max_hr,type,source) VALUES (?,?,?,?,?,?,?,?,?,?)`);
      for (const s of strength) putStr.run(s.id, s.date, s.start_ts, s.end_ts, s.duration_min, s.active_kcal, s.avg_hr, s.max_hr, s.type, s.source);
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }

    const summary: ImportSummary = {
      recordsSeen: c.recordsSeen, recordsUsed: c.recordsUsed, exportDate: c.exportDate,
      days: dayBuild.days.length, runs: runs.length, strength: strength.length,
      runsWithRoute: withRoute, runsWithoutRoute: withoutRoute, duplicateWorkoutsDropped: dropped, ignoredWorkouts: ignored,
      firstDay: dayBuild.days[0]?.date ?? null, lastDay: dayBuild.days[dayBuild.days.length - 1]?.date ?? null,
    };
    db.prepare("UPDATE import_log SET status='ok', finished_at=?, summary=?, warnings=? WHERE id=?").run(new Date().toISOString(), JSON.stringify(summary), JSON.stringify(warnings), logId);
    return { ok: true, logId, summary, warnings };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    db.prepare("UPDATE import_log SET status='error', finished_at=?, error=? WHERE id=?").run(new Date().toISOString(), msg, logId);
    throw e;
  } finally {
    src?.close();
    st.running = false; st.phase = "";
  }
}
