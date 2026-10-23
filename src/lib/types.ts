export type Provenance = "measured" | "reported" | "estimated" | "calculated";

/** One calendar day of health data. Every field is optional: a missing field means "no data", never zero. */
export interface Day {
  date: string; // YYYY-MM-DD, local calendar day of the athlete
  kcalIn?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  mealsLogged?: number;
  activeKcal?: number;
  restingKcal?: number;
  steps?: number;
  restingHr?: number;
  hrv?: number; // SDNN in ms (Apple Watch)
  sleepMin?: number;
  deepMin?: number;
  remMin?: number;
  bedtimeMin?: number; // minutes after midnight (negative = before midnight)
  vo2max?: number; // Apple Watch estimate, mL/kg/min
  respRate?: number;
}

export interface Split {
  km: number; // 1-based index
  distKm: number; // 1 for full km, <1 for the final partial km
  paceSec: number; // seconds per km
  hr: number | null; // null when no heart-rate samples cover this km
  elevGain: number;
}

export interface Run {
  id: string;
  date: string;
  startTime: string; // HH:MM
  distanceKm: number;
  durationSec: number;
  elevGain: number | null;
  avgHr: number | null;
  maxHr: number | null;
  splits: Split[]; // empty when the run has no GPS route (treadmill, or route not exported)
  hrSeries: { t: number; hr: number }[]; // t in seconds
  source: string;
  indoor?: boolean;
  elevSource?: "apple" | "gps" | null; // where elevGain comes from
}

export interface StrengthSession {
  id: string;
  date: string;
  durationMin: number;
  activeKcal: number | null;
  avgHr: number | null;
  maxHr: number | null;
  type: string;
}

export interface LiftSet { reps: number; kg: number }
export interface LiftEntry {
  id: string;
  date: string;
  exercise: string;
  sets: LiftSet[];
  sample?: boolean;
  /** Entries created by the spreadsheet import (reps are the plan's targets, not recorded per set). */
  source?: "plan";
}

export interface WeightEntry { date: string; kg: number; sample?: boolean }

export interface Dataset {
  days: Day[];
  runs: Run[];
  strength: StrengthSession[];
  lifts: LiftEntry[];
  weights: WeightEntry[];
}

export type GoalType = "race" | "weeklyKm" | "strengthPerWeek" | "protein" | "deficit" | "vo2" | "sleep" | "weight";

export interface Goal {
  id: string;
  type: GoalType;
  label: string;
  target: number; // race: seconds; weeklyKm: km; strengthPerWeek: sessions; protein: % of days; deficit: kcal/day; vo2: ml/kg/min; sleep: hours; weight: kg
  deadline?: string;
  baseline?: number;
  raceKm?: number;
  example?: boolean;
}

export interface Settings {
  theme: "system" | "light" | "dark";
  targets: { kcal: number; protein: number; carbs: number; fat: number; kcalTolerancePct: number; proteinMetPct: number };
  schedule: { strengthDays: number[]; runDays: number[] }; // 0 = Sunday … 6 = Saturday
  hrMax: number;
  goals: Goal[];
  weights: WeightEntry[]; // manual entries only; sample weights are never stored
  lifts: LiftEntry[]; // manual entries only
  enabledSources: { watch: boolean; mfp: boolean; manual: boolean };
  /** Show generated sample data even though real data has been imported (to explore the layout). */
  previewSample?: boolean;
}
