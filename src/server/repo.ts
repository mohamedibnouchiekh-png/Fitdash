// Reads stored data back in the exact shape the UI already uses (src/lib/types.ts).
import { getDb, kvGet, kvSet } from "./db.ts";
import type { Dataset, Day, Run, StrengthSession } from "../lib/types.ts";
import type { ImportSummary } from "./importer/index.ts";

type Row = Record<string, unknown>;
const opt = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

export interface ImportInfo {
  id: number; finishedAt: string | null; status: string; fileName: string | null;
  summary: ImportSummary | null; warnings: string[]; error: string | null;
}
export interface DatasetResponse { dataset: Dataset; hasData: boolean; lastImport: ImportInfo | null; counts: { days: number; runs: number; strength: number } }

export function readDataset(): DatasetResponse {
  const db = getDb();
  const days: Day[] = (db.prepare("SELECT * FROM day ORDER BY date").all() as Row[]).map((r) => {
    const d: Day = { date: r.date as string };
    const map: [keyof Day, string][] = [["kcalIn", "kcal_in"], ["protein", "protein"], ["carbs", "carbs"], ["fat", "fat"], ["activeKcal", "active_kcal"], ["restingKcal", "resting_kcal"], ["steps", "steps"], ["restingHr", "resting_hr"], ["hrv", "hrv"], ["vo2max", "vo2max"], ["respRate", "resp_rate"], ["sleepMin", "sleep_min"], ["deepMin", "deep_min"], ["remMin", "rem_min"], ["bedtimeMin", "bedtime_min"]];
    for (const [k, col] of map) { const v = opt(r[col]); if (v !== undefined) (d as unknown as Record<string, number>)[k] = v; }
    return d;
  });
  const runs: Run[] = (db.prepare("SELECT * FROM run ORDER BY start_ts").all() as Row[]).map((r) => ({
    id: r.id as string, date: r.date as string, startTime: r.start_time as string,
    distanceKm: r.distance_km as number, durationSec: r.duration_sec as number,
    elevGain: opt(r.elev_gain) ?? null, avgHr: opt(r.avg_hr) ?? null, maxHr: opt(r.max_hr) ?? null,
    splits: JSON.parse(r.splits as string), hrSeries: JSON.parse(r.hr_series as string),
    source: r.source as string, indoor: r.indoor === 1, elevSource: (r.elev_source as "apple" | "gps" | null) ?? null,
  }));
  const strength: StrengthSession[] = (db.prepare("SELECT * FROM strength ORDER BY start_ts").all() as Row[]).map((r) => ({
    id: r.id as string, date: r.date as string, durationMin: r.duration_min as number,
    activeKcal: opt(r.active_kcal) ?? null, avgHr: opt(r.avg_hr) ?? null, maxHr: opt(r.max_hr) ?? null, type: r.type as string,
  }));
  const li = db.prepare("SELECT * FROM import_log WHERE kind='apple-health-export' ORDER BY id DESC LIMIT 1").get() as Row | undefined;
  const lastImport: ImportInfo | null = li ? {
    id: li.id as number, finishedAt: (li.finished_at as string) ?? null, status: li.status as string, fileName: (li.file_name as string) ?? null,
    summary: li.summary ? JSON.parse(li.summary as string) : null, warnings: li.warnings ? JSON.parse(li.warnings as string) : [], error: (li.error as string) ?? null,
  } : null;
  const hasData = days.length > 0 || runs.length > 0 || strength.length > 0;
  return { dataset: { days, runs, strength, lifts: [], weights: [] }, hasData, lastImport, counts: { days: days.length, runs: runs.length, strength: strength.length } };
}

export const loadSettings = <T>(): T | null => kvGet<T>("settings");
export const saveSettings = (s: unknown): void => kvSet("settings", s);
