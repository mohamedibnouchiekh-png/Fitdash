// Turns the raw collected records into the canonical day / run / strength rows.
// Pure functions: no I/O, so every rule here is covered by tests/importer.test.ts.
import type { Collected, RawWorkout, SleepSegment, SleepStage } from "./healthExport.ts";
import { buildRoute, parseGpx, type BuiltSplit, type HrSample } from "./gpx.ts";

export const isWatch = (source: string): boolean => /watch/i.test(source);
const r1 = (v: number) => Math.round(v * 10) / 10;

export interface DayRow {
  date: string;
  kcal_in: number | null; protein: number | null; carbs: number | null; fat: number | null;
  active_kcal: number | null; resting_kcal: number | null; steps: number | null;
  resting_hr: number | null; hrv: number | null; vo2max: number | null; resp_rate: number | null;
  sleep_min: number | null; deep_min: number | null; rem_min: number | null; bedtime_min: number | null;
  sources: Record<string, string>;
}
const emptyDay = (date: string): DayRow => ({
  date, kcal_in: null, protein: null, carbs: null, fat: null, active_kcal: null, resting_kcal: null, steps: null,
  resting_hr: null, hrv: null, vo2max: null, resp_rate: null, sleep_min: null, deep_min: null, rem_min: null, bedtime_min: null, sources: {},
});

/** Watch first; otherwise the candidate with the largest `weight`. */
function pickSource<T extends { source: string; weight: number }>(cands: T[]): T {
  const w = cands.filter((c) => isWatch(c.source));
  const pool = w.length ? w : cands;
  return pool.reduce((a, b) => (b.weight > a.weight || (b.weight === a.weight && b.source < a.source) ? b : a));
}

function unionMinutes(iv: [number, number][]): number {
  if (!iv.length) return 0;
  const s = [...iv].sort((a, b) => a[0] - b[0]);
  let total = 0, [cs, ce] = s[0];
  for (let i = 1; i < s.length; i++) {
    if (s[i][0] <= ce) ce = Math.max(ce, s[i][1]);
    else { total += ce - cs; [cs, ce] = s[i]; }
  }
  return (total + (ce - cs)) / 60000;
}

export interface DayBuild { days: DayRow[]; warnings: string[]; stats: { napOnlyDays: number; nutritionMismatchDays: number } }

export function buildDays(c: Collected): DayBuild {
  const days = new Map<string, DayRow>();
  const get = (d: string) => { let r = days.get(d); if (!r) { r = emptyDay(d); days.set(d, r); } return r; };
  const warnings: string[] = [];

  // --- Cumulative (steps, energy): merge sources hour by hour, Watch first, so iPhone + Watch are never added together.
  const perHour = new Map<string, { source: string; weight: number }[]>();
  for (const [key, sum] of c.cumulative) {
    const [metric, hour, source] = key.split("|");
    const k = `${metric}|${hour}`;
    const arr = perHour.get(k) ?? []; arr.push({ source, weight: sum }); perHour.set(k, arr);
  }
  const cumDay = new Map<string, { sum: number; sources: Set<string> }>();
  for (const [k, cands] of perHour) {
    const [metric, hour] = k.split("|");
    const chosen = pickSource(cands);
    const dk = `${metric}|${hour.slice(0, 10)}`;
    const cur = cumDay.get(dk) ?? { sum: 0, sources: new Set<string>() };
    cur.sum += chosen.weight; cur.sources.add(chosen.source); cumDay.set(dk, cur);
  }
  for (const [dk, v] of cumDay) {
    const [metric, date] = dk.split("|");
    const row = get(date);
    const field = metric === "steps" ? "steps" : metric === "active" ? "active_kcal" : "resting_kcal";
    row[field] = Math.round(v.sum);
    row.sources[field] = [...v.sources].sort().join(" + ");
  }

  // --- Instantaneous (resting HR, HRV, VO2 max, respiratory rate): one source per day, Watch first.
  const instByDay = new Map<string, { source: string; weight: number; sum: number; n: number; last: number }[]>();
  for (const [key, a] of c.instant) {
    const [metric, date, source] = key.split("|");
    const k = `${metric}|${date}`;
    const arr = instByDay.get(k) ?? []; arr.push({ source, weight: a.n, sum: a.sum, n: a.n, last: a.last }); instByDay.set(k, arr);
  }
  for (const [k, cands] of instByDay) {
    const [metric, date] = k.split("|");
    const ch = pickSource(cands);
    const row = get(date);
    if (metric === "rhr") { row.resting_hr = r1(ch.sum / ch.n); row.sources.resting_hr = ch.source; }
    else if (metric === "hrv") { row.hrv = r1(ch.sum / ch.n); row.sources.hrv = ch.source; }
    else if (metric === "resp") { row.resp_rate = r1(ch.sum / ch.n); row.sources.resp_rate = ch.source; }
    else if (metric === "vo2") { row.vo2max = r1(ch.last); row.sources.vo2max = ch.source; }
  }

  // --- Nutrition: one source per day (MyFitnessPal preferred). A record seen both top-level and inside a Correlation counts once.
  interface Nut { source: string; weight: number; kcal: number | null; protein: number | null; carbs: number | null; fat: number | null }
  const nut = new Map<string, Nut>();
  for (const it of c.dietary.values()) {
    const count = Math.max(it.top, it.nested);
    const k = `${it.day}|${it.source}`;
    const cur: Nut = nut.get(k) ?? { source: it.source, weight: 0, kcal: null, protein: null, carbs: null, fat: null };
    cur[it.metric] = (cur[it.metric] ?? 0) + it.value * count;
    nut.set(k, cur);
  }
  const nutByDay = new Map<string, Nut[]>();
  for (const [k, v] of nut) {
    const date = k.split("|")[0];
    v.weight = (v.kcal ?? 0) + (v.protein ?? 0) + (v.carbs ?? 0) + (v.fat ?? 0);
    const arr = nutByDay.get(date) ?? []; arr.push(v); nutByDay.set(date, arr);
  }
  let mismatch = 0;
  for (const [date, cands] of nutByDay) {
    const mfp = cands.filter((x) => /myfitnesspal/i.test(x.source));
    const ch = (mfp.length ? mfp : cands).reduce((a, b) => (b.weight > a.weight ? b : a));
    const row = get(date);
    row.kcal_in = ch.kcal === null ? null : Math.round(ch.kcal);
    row.protein = ch.protein === null ? null : r1(ch.protein);
    row.carbs = ch.carbs === null ? null : r1(ch.carbs);
    row.fat = ch.fat === null ? null : r1(ch.fat);
    row.sources.nutrition = ch.source;
    if (row.kcal_in !== null && row.kcal_in > 800 && row.protein !== null && row.carbs !== null && row.fat !== null) {
      const fromMacros = 4 * row.protein + 4 * row.carbs + 9 * row.fat;
      if (Math.abs(row.kcal_in - fromMacros) / row.kcal_in > 0.35) mismatch++;
    }
  }
  if (mismatch > 0) warnings.push(`${mismatch} day(s) have calories that differ from the macros by more than 35%. This can mean a duplicated or partly missing food sync, so check those days in Apple Health.`);

  // --- Sleep: group by the night's wake-up day; one source per night; overlapping segments merged.
  const nights = new Map<string, Map<string, SleepSegment[]>>();
  for (const seg of c.sleep) {
    const date = new Date(seg.end.wall + 4 * 3600000).toISOString().slice(0, 10);
    const bySource = nights.get(date) ?? new Map<string, SleepSegment[]>();
    const arr = bySource.get(seg.source) ?? []; arr.push(seg); bySource.set(seg.source, arr); nights.set(date, bySource);
  }
  const ASLEEP: SleepStage[] = ["asleep", "core", "deep", "rem"];
  let napOnly = 0;
  for (const [date, bySource] of nights) {
    const cands = [...bySource].map(([source, segs]) => {
      const asleep = segs.filter((s) => ASLEEP.includes(s.stage)).map((s) => [s.start.abs, s.end.abs] as [number, number]);
      return { source, weight: unionMinutes(asleep), segs };
    }).filter((x) => x.weight > 0);
    if (!cands.length) continue;
    const ch = pickSource(cands);
    if (ch.weight < 120) { napOnly++; continue; } // under 2 h in total is treated as a nap, not a night
    const row = get(date);
    row.sleep_min = Math.round(ch.weight);
    row.sources.sleep = ch.source;
    const staged = ch.segs.some((s) => s.stage === "core" || s.stage === "deep" || s.stage === "rem");
    if (staged) {
      row.deep_min = Math.round(unionMinutes(ch.segs.filter((s) => s.stage === "deep").map((s) => [s.start.abs, s.end.abs])));
      row.rem_min = Math.round(unionMinutes(ch.segs.filter((s) => s.stage === "rem").map((s) => [s.start.abs, s.end.abs])));
    }
    const first = ch.segs.filter((s) => ASLEEP.includes(s.stage)).reduce((a, b) => (b.start.abs < a.start.abs ? b : a));
    const bed = Math.round((first.start.wall - Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))) / 60000);
    if (bed >= -720 && bed <= 720) row.bedtime_min = bed;
  }
  if (napOnly > 0) warnings.push(`${napOnly} day(s) had under 2 hours of sleep recorded and were treated as naps, so no sleep value is shown for them.`);

  return { days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)), warnings, stats: { napOnlyDays: napOnly, nutritionMismatchDays: mismatch } };
}

// ---------------- Workouts ----------------
export const RUN = "HKWorkoutActivityTypeRunning";
export const STRENGTH_TYPES: Record<string, string> = {
  HKWorkoutActivityTypeTraditionalStrengthTraining: "Traditional Strength Training",
  HKWorkoutActivityTypeFunctionalStrengthTraining: "Functional Strength Training",
};
type Category = "run" | "strength";
export const categoryOf = (activity: string): Category | null => (activity === RUN ? "run" : activity in STRENGTH_TYPES ? "strength" : null);

/** Drop duplicate recordings of the same session (e.g. Watch + a third-party app). Prefers Watch, then a recorded route, then the longer one. */
export function dedupeWorkouts(all: RawWorkout[]): { kept: RawWorkout[]; dropped: number } {
  const sorted = all.filter((w) => categoryOf(w.activity)).sort((a, b) => a.start.abs - b.start.abs);
  const score = (w: RawWorkout) => (isWatch(w.source) ? 4 : 0) + (w.routePaths.length ? 2 : 0) + (w.durationSec ?? 0) / 1e7;
  const kept: RawWorkout[] = [];
  let dropped = 0;
  for (const w of sorted) {
    const cat = categoryOf(w.activity);
    let dupAt = -1;
    for (let i = kept.length - 1; i >= 0 && i >= kept.length - 6; i--) {
      const k = kept[i];
      if (categoryOf(k.activity) !== cat) continue;
      const ov = Math.min(k.end.abs, w.end.abs) - Math.max(k.start.abs, w.start.abs);
      const shorter = Math.min(k.end.abs - k.start.abs, w.end.abs - w.start.abs);
      if (shorter > 0 && ov / shorter >= 0.5) { dupAt = i; break; }
    }
    if (dupAt < 0) kept.push(w);
    else { dropped++; if (score(w) > score(kept[dupAt])) kept[dupAt] = w; }
  }
  return { kept, dropped };
}

export interface RunRow {
  id: string; date: string; start_time: string; start_ts: number; end_ts: number;
  distance_km: number; duration_sec: number; elev_gain: number | null; avg_hr: number | null; max_hr: number | null;
  splits: BuiltSplit[]; hr_series: { t: number; hr: number }[]; source: string; indoor: boolean; elev_source: "apple" | "gps" | null;
}
export interface StrengthRow {
  id: string; date: string; start_ts: number; end_ts: number; duration_min: number;
  active_kcal: number | null; avg_hr: number | null; max_hr: number | null; type: string; source: string;
}

/** Heart-rate samples recorded by the workout's own source when it has any, otherwise all samples in the window. */
export function pickHr(samples: { source: string; sample: HrSample }[], workoutSource: string): HrSample[] {
  const own = samples.filter((s) => s.source === workoutSource);
  return (own.length ? own : samples).map((s) => s.sample).sort((a, b) => a.t - b.t);
}
const meanOf = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

export function buildRun(w: RawWorkout, hr: HrSample[], gpx: string | null): { row: RunRow | null; note?: string } {
  const durationSec = w.durationSec ?? (w.end.abs - w.start.abs) / 1000;
  const route = gpx ? buildRoute(parseGpx(gpx), { reportedDistanceKm: w.distanceKm, hr }) : null;
  const distance = w.distanceKm ?? route?.distanceKm ?? null;
  if (distance === null || distance <= 0) return { row: null, note: `Run on ${w.start.day} skipped: no distance recorded.` };

  const buckets = new Map<number, number[]>();
  for (const s of hr) {
    const b = Math.floor((s.t - w.start.abs) / 15000);
    if (b < 0) continue;
    const arr = buckets.get(b) ?? []; arr.push(s.hr); buckets.set(b, arr);
  }
  const hr_series = [...buckets].sort((a, b) => a[0] - b[0]).map(([b, v]) => ({ t: b * 15, hr: Math.round(meanOf(v) as number) }));
  const hrVals = hr.map((s) => s.hr);
  const avg = w.hrAvg ?? meanOf(hrVals);
  const max = w.hrMax ?? (hrVals.length ? Math.max(...hrVals) : null);
  const elev = w.elevM ?? route?.elevGain ?? null;
  return {
    row: {
      id: `ah:${new Date(w.start.abs).toISOString()}`, date: w.start.day, start_time: w.start.hhmm,
      start_ts: w.start.abs, end_ts: w.end.abs,
      distance_km: Math.round(distance * 1000) / 1000, duration_sec: Math.round(durationSec),
      elev_gain: elev === null ? null : Math.round(elev), avg_hr: avg === null ? null : Math.round(avg), max_hr: max === null ? null : Math.round(max),
      splits: route?.splits ?? [], hr_series, source: w.source, indoor: w.indoor,
      elev_source: w.elevM !== null ? "apple" : route ? "gps" : null,
    },
  };
}

export function buildStrength(w: RawWorkout, hr: HrSample[]): StrengthRow {
  const hrVals = hr.map((s) => s.hr);
  const avg = w.hrAvg ?? meanOf(hrVals);
  const max = w.hrMax ?? (hrVals.length ? Math.max(...hrVals) : null);
  const dur = w.durationSec ?? (w.end.abs - w.start.abs) / 1000;
  return {
    id: `ah:${new Date(w.start.abs).toISOString()}`, date: w.start.day, start_ts: w.start.abs, end_ts: w.end.abs,
    duration_min: r1(dur / 60), active_kcal: w.energyKcal === null ? null : Math.round(w.energyKcal),
    avg_hr: avg === null ? null : Math.round(avg), max_hr: max === null ? null : Math.round(max),
    type: STRENGTH_TYPES[w.activity] ?? w.activity, source: w.source,
  };
}
