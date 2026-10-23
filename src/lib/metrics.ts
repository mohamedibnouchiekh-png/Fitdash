// Pure metric functions. No React, no I/O: everything here is unit-tested (tests/metrics.test.ts).
// Rule: missing data is `null`/`undefined` and is NEVER treated as zero.
import type { Day, Run, WeightEntry } from "./types.ts";
import { addDays, weekStart } from "./dates.ts";

/** Days with a strength session: an Apple Watch workout or a logged exercise session. A day counts once, so the same session in both is not doubled. */
export const strengthDates = (ds: { strength: { date: string }[]; lifts: { date: string }[] }): string[] =>
  [...new Set([...ds.strength.map((x) => x.date), ...ds.lifts.map((l) => l.date)])];

export type Num = number | null | undefined;
const ok = (v: Num): v is number => typeof v === "number" && Number.isFinite(v);

export function present(values: Num[]): number[] { return values.filter(ok); }
export function mean(values: Num[]): number | null {
  const v = present(values);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
export function sum(values: Num[]): number | null {
  const v = present(values);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
}
export function sd(values: Num[]): number | null {
  const v = present(values);
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

/** Trailing rolling mean ignoring gaps. Returns null where fewer than `minPoints` values exist in the window. */
export function rolling(values: Num[], window: number, minPoints = Math.ceil(window / 2)): (number | null)[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return present(slice).length >= minPoints ? mean(slice) : null;
  });
}

/** Least-squares slope (y per x unit). null when fewer than 3 points or no x variance. */
export function slope(points: { x: number; y: number }[]): number | null {
  if (points.length < 3) return null;
  const n = points.length;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  let num = 0, den = 0;
  for (const p of points) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; }
  return den === 0 ? null : num / den;
}

// ---------- Pace & speed ----------
export const paceSec = (durationSec: number, distKm: number): number | null => (distKm > 0 ? durationSec / distKm : null);
export const speedKmh = (pace: number): number => 3600 / pace;
export function fmtPace(sec: Num): string {
  if (!ok(sec)) return "—";
  let m = Math.floor(sec / 60), s = Math.round(sec - m * 60);
  if (s === 60) { m += 1; s = 0; }
  return `${m}:${String(s).padStart(2, "0")}`;
}
export function fmtDuration(sec: Num): string {
  if (!ok(sec)) return "—";
  const t = Math.round(sec);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
export function parseDuration(text: string): number | null {
  const parts = text.trim().split(":").map(Number);
  if (parts.some((p) => !Number.isFinite(p) || p < 0) || parts.length < 2 || parts.length > 3) return null;
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}
/** Distance-weighted average pace: total time / total distance (not the mean of paces). */
export function aggregatePace(runs: Run[]): number | null {
  const d = runs.reduce((a, r) => a + r.distanceKm, 0);
  const t = runs.reduce((a, r) => a + r.durationSec, 0);
  return d > 0 ? t / d : null;
}

// ---------- Volume & frequency ----------
export function weeklyDistance(runs: Run[], weekStartStr: string): number {
  const end = addDays(weekStartStr, 6);
  return runs.filter((r) => r.date >= weekStartStr && r.date <= end).reduce((a, r) => a + r.distanceKm, 0);
}
export function countInWeek(dates: string[], weekStartStr: string): number {
  const end = addDays(weekStartStr, 6);
  return dates.filter((d) => d >= weekStartStr && d <= end).length;
}
/** Week-start strings for the `n` completed weeks before the week containing `today`. */
export function lastCompletedWeeks(today: string, n: number): string[] {
  const cur = weekStart(today);
  return Array.from({ length: n }, (_, i) => addDays(cur, -7 * (n - i)));
}

// ---------- Nutrition ----------
export const kcalFromMacros = (p: number, c: number, f: number): number => 4 * p + 4 * c + 9 * f;
export function macroEnergyShare(p: Num, c: Num, f: Num): { p: number; c: number; f: number } | null {
  if (!ok(p) || !ok(c) || !ok(f)) return null;
  const tot = kcalFromMacros(p, c, f);
  return tot > 0 ? { p: (4 * p) / tot, c: (4 * c) / tot, f: (9 * f) / tot } : null;
}
export const kcalWithin = (kcal: number, target: number, tolPct: number): boolean => Math.abs(kcal - target) <= (target * tolPct) / 100;
export const proteinMet = (g: number, target: number, metPct: number): boolean => g >= (target * metPct) / 100;
/** Logs below this are treated as incomplete (not as a real intake) and excluded from averages. */
export const INCOMPLETE_KCAL = 800;
export const isCompleteNutritionDay = (d: Day, today: string): boolean =>
  d.date < today && ok(d.kcalIn) && d.kcalIn >= INCOMPLETE_KCAL;

/** Estimated expenditure = Apple Watch resting + active energy. An ESTIMATE; both parts must exist. */
export function estimatedExpenditure(d: Day): number | null {
  return ok(d.restingKcal) && ok(d.activeKcal) ? d.restingKcal + d.activeKcal : null;
}
/** Estimated balance = intake − estimated expenditure (negative = deficit). Needs a complete day. */
export function energyBalance(d: Day, today: string): number | null {
  const exp = estimatedExpenditure(d);
  return isCompleteNutritionDay(d, today) && exp !== null ? (d.kcalIn as number) - exp : null;
}

// ---------- Personal baseline ----------
export interface Baseline { mean: number; sd: number; n: number }
/** Baseline from the `window` days BEFORE index i (excludes the day itself). Needs ≥ minPoints values. */
export function baselineAt(values: Num[], i: number, window = 28, minPoints = 14): Baseline | null {
  const slice = values.slice(Math.max(0, i - window), i);
  const v = present(slice);
  if (v.length < minPoints) return null;
  const m = mean(v) as number;
  const s = sd(v) as number;
  return { mean: m, sd: s, n: v.length };
}
export const zScore = (v: number, b: Baseline): number | null => (b.sd > 0 ? (v - b.mean) / b.sd : null);

// ---------- Running performance ----------
export const HALF_KM = 21.0975;
/** Fastest time over `distKm` using consecutive FULL-km splits (1 km granularity ⇒ approximate). */
export function bestEffortSec(run: Run, distKm: number): number | null {
  const full = run.splits.filter((s) => s.distKm === 1);
  const k = Math.round(distKm);
  if (Math.abs(distKm - k) > 0.5 || full.length < k) return null;
  if (distKm === HALF_KM) {
    // Whole run must cover the distance; scale the fastest 21 consecutive km by 21.0975/21.
    if (full.length < 21) return null;
  }
  let best: number | null = null;
  for (let i = 0; i + k <= full.length; i++) {
    let t = 0;
    for (let j = i; j < i + k; j++) t += full[j].paceSec;
    if (best === null || t < best) best = t;
  }
  if (best !== null && distKm === HALF_KM) best *= HALF_KM / 21;
  return best;
}
export function fastestKm(runs: Run[]): { sec: number; run: Run } | null {
  let best: { sec: number; run: Run } | null = null;
  for (const r of runs) for (const s of r.splits) if (s.distKm === 1 && (!best || s.paceSec < best.sec)) best = { sec: s.paceSec, run: r };
  return best;
}
export interface Effort { distKm: number; sec: number; run: Run }
export function bestEffort(runs: Run[], distKm: number): Effort | null {
  let best: Effort | null = null;
  for (const r of runs) {
    const t = bestEffortSec(r, distKm);
    if (t !== null && (!best || t < best.sec)) best = { distKm, sec: t, run: r };
  }
  return best;
}
/** Riegel (1977): T2 = T1 × (D2/D1)^1.06. A rough ESTIMATE that assumes similar training and conditions. */
export const riegel = (t1: number, d1: number, d2: number): number => t1 * Math.pow(d2 / d1, 1.06);

/** Race-time prediction as of a date: best effort from the 90 days before it (5 km preferred, else 10 km, else 3 km). */
export function predictRaceSec(runs: Run[], asOf: string, raceKm: number): { sec: number; basis: Effort } | null {
  const pool = runs.filter((r) => r.date <= asOf && r.date > addDays(asOf, -90));
  for (const d of [5, 10, 3]) {
    const e = bestEffort(pool, d);
    if (e) return { sec: riegel(e.sec, e.distKm, raceKm), basis: e };
  }
  return null;
}

export const HR_ZONES = [
  { z: 1, label: "Z1 Recovery", lo: 0, hi: 0.6 },
  { z: 2, label: "Z2 Aerobic", lo: 0.6, hi: 0.7 },
  { z: 3, label: "Z3 Tempo", lo: 0.7, hi: 0.8 },
  { z: 4, label: "Z4 Threshold", lo: 0.8, hi: 0.9 },
  { z: 5, label: "Z5 Max", lo: 0.9, hi: 10 },
];
export function hrZone(hr: number, hrMax: number): number {
  const f = hr / hrMax;
  return (HR_ZONES.find((z) => f >= z.lo && f < z.hi) ?? HR_ZONES[4]).z;
}
/** Seconds spent in each zone, from the heart-rate series (each sample represents the gap to the next). */
export function timeInZones(runs: Run[], hrMax: number): number[] {
  const out = [0, 0, 0, 0, 0];
  for (const r of runs) {
    for (let i = 0; i < r.hrSeries.length; i++) {
      const next = r.hrSeries[i + 1];
      const dt = next ? next.t - r.hrSeries[i].t : 15;
      out[hrZone(r.hrSeries[i].hr, hrMax) - 1] += dt;
    }
  }
  return out;
}

// ---------- Strength ----------
/** Epley estimated one-rep max. An ESTIMATE; unreliable above ~10 reps. */
export const epley1RM = (kg: number, reps: number): number => (reps <= 1 ? kg : kg * (1 + reps / 30));

// ---------- Weight ----------
export function sortedWeights(w: WeightEntry[]): WeightEntry[] { return [...w].sort((a, b) => a.date.localeCompare(b.date)); }

// ---------- Aggregation ----------
export type Granularity = "day" | "week" | "month";
export function bucketKey(date: string, g: Granularity): string {
  return g === "day" ? date : g === "week" ? weekStart(date) : date.slice(0, 7) + "-01";
}
