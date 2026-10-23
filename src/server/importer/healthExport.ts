// Streaming reader for Apple Health's export.xml. Memory stays flat even for multi-GB exports:
// high-volume records (steps, energy) are folded into hourly buckets while streaming, never stored one by one.
import sax from "sax";
import type { Readable } from "node:stream";
import type { HrSample } from "./gpx.ts";

export interface Ts { abs: number; wall: number; day: string; hour: string; hhmm: string; raw: string }

/** "2026-10-19 21:59:00 +0200" → absolute ms, wall-clock ms (as if UTC), local day, hour bucket. */
export function parseTs(s: string): Ts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?: ([+-])(\d{2})(\d{2}))?$/.exec(s);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const off = m[7] ? (m[7] === "-" ? -1 : 1) * (+m[8] * 60 + +m[9]) * 60000 : 0;
  return { abs: wall - off, wall, day: `${m[1]}-${m[2]}-${m[3]}`, hour: `${m[1]}-${m[2]}-${m[3]}T${m[4]}`, hhmm: `${m[4]}:${m[5]}`, raw: s };
}

const CUMULATIVE: Record<string, "steps" | "active" | "basal"> = {
  HKQuantityTypeIdentifierStepCount: "steps",
  HKQuantityTypeIdentifierActiveEnergyBurned: "active",
  HKQuantityTypeIdentifierBasalEnergyBurned: "basal",
};
const INSTANT: Record<string, "rhr" | "hrv" | "vo2" | "resp"> = {
  HKQuantityTypeIdentifierRestingHeartRate: "rhr",
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: "hrv",
  HKQuantityTypeIdentifierVO2Max: "vo2",
  HKQuantityTypeIdentifierRespiratoryRate: "resp",
};
const DIETARY: Record<string, "kcal" | "protein" | "carbs" | "fat"> = {
  HKQuantityTypeIdentifierDietaryEnergyConsumed: "kcal",
  HKQuantityTypeIdentifierDietaryProtein: "protein",
  HKQuantityTypeIdentifierDietaryCarbohydrates: "carbs",
  HKQuantityTypeIdentifierDietaryFatTotal: "fat",
};
const HEART_RATE = "HKQuantityTypeIdentifierHeartRate";
const SLEEP = "HKCategoryTypeIdentifierSleepAnalysis";

export type SleepStage = "inbed" | "awake" | "asleep" | "core" | "deep" | "rem";
const SLEEP_VALUE: Record<string, SleepStage> = {
  HKCategoryValueSleepAnalysisInBed: "inbed",
  HKCategoryValueSleepAnalysisAwake: "awake",
  HKCategoryValueSleepAnalysisAsleep: "asleep",
  HKCategoryValueSleepAnalysisAsleepUnspecified: "asleep",
  HKCategoryValueSleepAnalysisAsleepCore: "core",
  HKCategoryValueSleepAnalysisAsleepDeep: "deep",
  HKCategoryValueSleepAnalysisAsleepREM: "rem",
};

export interface SleepSegment { source: string; stage: SleepStage; start: Ts; end: Ts }
export interface DietaryItem { metric: "kcal" | "protein" | "carbs" | "fat"; day: string; source: string; value: number; top: number; nested: number }
export interface RawWorkout {
  activity: string;            // e.g. HKWorkoutActivityTypeRunning
  source: string;
  start: Ts; end: Ts;
  durationSec: number | null;
  distanceKm: number | null;
  energyKcal: number | null;
  indoor: boolean;
  elevM: number | null;
  hrAvg: number | null; hrMax: number | null;
  routePaths: string[];
}
export interface InstantAgg { n: number; sum: number; last: number; lastTs: number }
export interface Collected {
  recordsSeen: number;
  recordsUsed: number;
  exportDate: string | null;
  cumulative: Map<string, number>;       // `${metric}|${hour}|${source}` → sum
  instant: Map<string, InstantAgg>;      // `${metric}|${day}|${source}`
  dietary: Map<string, DietaryItem>;     // exact-record key → counts (top-level vs inside a Correlation)
  sleep: SleepSegment[];
  workouts: RawWorkout[];
  warnings: string[];
}

export const kcalOf = (v: number, unit: string | undefined): number => (unit && /^kj$/i.test(unit) ? v / 4.184 : v);
const km = (v: number, unit: string | undefined): number => (!unit || unit === "km" ? v : unit === "m" ? v / 1000 : unit === "mi" ? v * 1.609344 : v);
const seconds = (v: number, unit: string | undefined): number => (!unit || unit === "min" ? v * 60 : unit === "sec" || unit === "s" ? v : unit === "hr" ? v * 3600 : v * 60);
const num = (s: string | undefined): number | null => { if (s === undefined || s === "") return null; const v = Number(s); return Number.isFinite(v) ? v : null; };

type Attrs = Record<string, string>;

function makeParser(onOpen: (name: string, a: Attrs) => void, onClose: (name: string) => void): sax.SAXParser {
  const p = sax.parser(true, { trim: false, normalize: false, position: true });
  p.onopentag = (n) => onOpen(n.name, n.attributes as Attrs);
  p.onclosetag = (name) => onClose(name);
  p.onerror = (e) => { throw new Error(`export.xml is not valid XML near line ${p.line + 1}: ${e.message.split("\n")[0]}`); };
  return p;
}

async function pump(stream: Readable, parser: sax.SAXParser): Promise<void> {
  for await (const chunk of stream) parser.write(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  parser.close();
}

/** Pass 1: everything except per-sample heart rate. */
export async function collect(stream: Readable): Promise<Collected> {
  const c: Collected = { recordsSeen: 0, recordsUsed: 0, exportDate: null, cumulative: new Map(), instant: new Map(), dietary: new Map(), sleep: [], workouts: [], warnings: [] };
  let inCorrelation = false, inRoute = false;
  let wk: RawWorkout | null = null;
  let badTs = 0;

  const addDietary = (a: Attrs, nested: boolean) => {
    const metric = DIETARY[a.type];
    const v = num(a.value), s = parseTs(a.startDate), e = parseTs(a.endDate ?? a.startDate);
    if (!metric || v === null || !s || !e) return;
    const value = metric === "kcal" ? kcalOf(v, a.unit) : v;
    const source = a.sourceName ?? "?";
    const key = `${metric}|${source}|${a.startDate}|${a.endDate}|${a.value}`;
    let it = c.dietary.get(key);
    if (!it) { it = { metric, day: s.day, source, value, top: 0, nested: 0 }; c.dietary.set(key, it); }
    if (nested) it.nested++; else it.top++;
  };

  const parser = makeParser((name, a) => {
    switch (name) {
      case "ExportDate": c.exportDate = a.value ?? null; break;
      case "Correlation": inCorrelation = true; break;
      case "Record": {
        c.recordsSeen++;
        const t = a.type;
        if (t in DIETARY) { addDietary(a, inCorrelation); c.recordsUsed++; break; }
        if (inCorrelation) break;
        if (t in CUMULATIVE) {
          const s = parseTs(a.startDate), v = num(a.value);
          if (!s || v === null) { badTs++; break; }
          const key = `${CUMULATIVE[t]}|${s.hour}|${a.sourceName ?? "?"}`;
          c.cumulative.set(key, (c.cumulative.get(key) ?? 0) + (CUMULATIVE[t] === "steps" ? v : kcalOf(v, a.unit)));
          c.recordsUsed++;
        } else if (t in INSTANT) {
          const s = parseTs(a.startDate), v = num(a.value);
          if (!s || v === null) { badTs++; break; }
          const key = `${INSTANT[t]}|${s.day}|${a.sourceName ?? "?"}`;
          const cur = c.instant.get(key) ?? { n: 0, sum: 0, last: v, lastTs: -Infinity };
          cur.n++; cur.sum += v;
          if (s.abs >= cur.lastTs) { cur.last = v; cur.lastTs = s.abs; }
          c.instant.set(key, cur);
          c.recordsUsed++;
        } else if (t === SLEEP) {
          const stage = SLEEP_VALUE[a.value], s = parseTs(a.startDate), e = parseTs(a.endDate);
          if (!stage || !s || !e) break;
          c.sleep.push({ source: a.sourceName ?? "?", stage, start: s, end: e });
          c.recordsUsed++;
        }
        break;
      }
      case "Workout": {
        const s = parseTs(a.startDate), e = parseTs(a.endDate);
        if (!s || !e) { badTs++; break; }
        const d = num(a.duration), dist = num(a.totalDistance), en = num(a.totalEnergyBurned);
        wk = {
          activity: a.workoutActivityType ?? "", source: a.sourceName ?? "?", start: s, end: e,
          durationSec: d === null ? null : seconds(d, a.durationUnit),
          distanceKm: dist === null ? null : km(dist, a.totalDistanceUnit),
          energyKcal: en === null ? null : kcalOf(en, a.totalEnergyBurnedUnit),
          indoor: false, elevM: null, hrAvg: null, hrMax: null, routePaths: [],
        };
        break;
      }
      case "WorkoutRoute": inRoute = true; break;
      case "FileReference": if (wk && a.path) wk.routePaths.push(a.path); break;
      case "MetadataEntry":
        if (wk && !inRoute) {
          if (a.key === "HKIndoorWorkout") wk.indoor = a.value === "1";
          else if (a.key === "HKElevationAscended") {
            const m = /^([\d.]+)\s*(cm|m|ft)?$/.exec(a.value ?? "");
            if (m) wk.elevM = m[2] === "m" ? +m[1] : m[2] === "ft" ? +m[1] * 0.3048 : +m[1] / 100;
          }
        }
        break;
      case "WorkoutStatistics":
        if (wk && a.type === HEART_RATE) { wk.hrAvg = num(a.average); wk.hrMax = num(a.maximum); }
        else if (wk && a.type === "HKQuantityTypeIdentifierDistanceWalkingRunning" && wk.distanceKm === null) { const v = num(a.sum); if (v !== null) wk.distanceKm = km(v, a.unit); }
        else if (wk && a.type === "HKQuantityTypeIdentifierActiveEnergyBurned" && wk.energyKcal === null) { const v = num(a.sum); if (v !== null) wk.energyKcal = kcalOf(v, a.unit); }
        break;
    }
  }, (name) => {
    if (name === "Correlation") inCorrelation = false;
    else if (name === "WorkoutRoute") inRoute = false;
    else if (name === "Workout" && wk) { c.workouts.push(wk); wk = null; }
  });

  await pump(stream, parser);
  if (badTs > 0) c.warnings.push(`${badTs} records had an unreadable date and were skipped.`);
  return c;
}

export interface Window { start: number; end: number }
/** Pass 2: heart-rate samples that fall inside the given workout windows (indexes match the input array). */
export async function collectHeartRate(stream: Readable, windows: Window[]): Promise<{ source: string; sample: HrSample }[][]> {
  const order = windows.map((w, i) => ({ ...w, i })).sort((a, b) => a.start - b.start);
  const starts = order.map((w) => w.start);
  const out: { source: string; sample: HrSample }[][] = windows.map(() => []);
  const parser = makeParser((name, a) => {
    if (name !== "Record" || a.type !== HEART_RATE) return;
    const s = parseTs(a.startDate), v = num(a.value);
    if (!s || v === null) return;
    // last window starting at or before the sample, then walk back over any overlapping neighbours
    let lo = 0, hi = starts.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= s.abs) lo = mid + 1; else hi = mid; }
    for (let j = lo - 1; j >= 0 && j >= lo - 3; j--) {
      if (s.abs <= order[j].end) out[order[j].i].push({ source: a.sourceName ?? "?", sample: { t: s.abs, hr: v } });
    }
  }, () => {});
  await pump(stream, parser);
  return out;
}
