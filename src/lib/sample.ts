// SAMPLE DATA GENERATOR — every value here is synthetic. Nothing is a real measurement.
// Deterministic (seeded) so the prototype looks the same on every load. Deliberately contains gaps
// (un-logged meals, watch not worn, sparse VO2 max) to exercise the "missing is not zero" rules.
import type { Dataset, Day, LiftEntry, Run, Split, StrengthSession, WeightEntry } from "./types.ts";
import { addDays, dow } from "./dates.ts";

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DAYS_OF_SAMPLE = 210;
const STRENGTH_DAYS = [1, 3, 5];
const RUN_DAYS = [2, 6];

const EXERCISES: { name: string; start: number; end: number; reps: number; group: string }[] = [
  { name: "Back squat", start: 62.5, end: 80, reps: 8, group: "Legs" },
  { name: "Bench press", start: 50, end: 62.5, reps: 8, group: "Chest" },
  { name: "Barbell row", start: 50, end: 62.5, reps: 8, group: "Back" },
  { name: "Romanian deadlift", start: 70, end: 90, reps: 8, group: "Legs" },
  { name: "Overhead press", start: 32.5, end: 40, reps: 8, group: "Shoulders" },
];
export const EXERCISE_GROUPS: Record<string, string> = Object.fromEntries(EXERCISES.map((e) => [e.name, e.group]));
Object.assign(EXERCISE_GROUPS, { "Pull-up": "Back", "Lunge": "Legs", "Dumbbell curl": "Arms", "Triceps pushdown": "Arms", "Plank": "Core" });

export function generateSample(today: string): Dataset {
  const rnd = mulberry32(20261019);
  const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return (s - 3) / Math.sqrt(0.5); };
  const n = (sdv: number) => gauss() * sdv;

  const days: Day[] = [];
  const runs: Run[] = [];
  const strength: StrengthSession[] = [];
  const lifts: LiftEntry[] = [];
  const weights: WeightEntry[] = [];
  let runCount = 0, sCount = 0, liftCount = 0;

  for (let i = 0; i < DAYS_OF_SAMPLE; i++) {
    const date = addDays(today, -(DAYS_OF_SAMPLE - 1 - i));
    const p = i / (DAYS_OF_SAMPLE - 1);
    const wd = dow(date);
    const isToday = date === today;
    const d: Day = { date };

    // ----- Runs (Tue + Sat) -----
    let ranKm = 0;
    if (RUN_DAYS.includes(wd) && rnd() > 0.1 && !isToday) {
      const long = wd === 6;
      const dist = Math.max(3.2, (long ? 7 + 4 * p : 5) + n(0.6));
      const basePace = 372 - 30 * p + n(6) + (long ? 8 : 0);
      const avgHrTarget = 156 - 4 * p + n(2) - (long ? 3 : 0);
      const fullKm = Math.floor(dist);
      const splits: Split[] = [];
      for (let k = 1; k <= fullKm + (dist - fullKm > 0.05 ? 1 : 0); k++) {
        const partial = k > fullKm;
        const dk = partial ? dist - fullKm : 1;
        const fade = (k / Math.max(dist, 1)) * 0.02 + (k === 1 ? 0.03 : 0);
        splits.push({
          km: k, distKm: Math.round(dk * 100) / 100,
          paceSec: Math.round(basePace * (1 + fade) + n(4)),
          hr: Math.round(avgHrTarget - 6 + Math.min(k, 4) * 2.2 + (k / dist) * 5 + n(1.5)),
          elevGain: Math.max(0, Math.round(10 + n(6))),
        });
      }
      const durationSec = Math.round(splits.reduce((a, s) => a + s.paceSec * s.distKm, 0));
      const hrSeries: { t: number; hr: number }[] = [];
      let t = 0, ki = 0, tInSplit = 0;
      while (t < durationSec && ki < splits.length) {
        hrSeries.push({ t, hr: Math.round((splits[ki].hr as number) + n(1.5)) });
        t += 15; tInSplit += 15;
        if (tInSplit >= splits[ki].paceSec * splits[ki].distKm) { ki++; tInSplit = 0; }
      }
      const hrs = hrSeries.map((h) => h.hr);
      const avgHr = Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length);
      runs.push({
        id: `run-${++runCount}`, date, startTime: wd === 6 ? "09:10" : "18:30",
        distanceKm: Math.round(dist * 100) / 100, durationSec,
        elevGain: splits.reduce((a, s) => a + s.elevGain, 0),
        avgHr, maxHr: Math.max(...hrs) + 3, splits, hrSeries, source: "Apple Watch",
      });
      ranKm = dist;
      if (rnd() < 0.7) d.vo2max = Math.round((44 + 3 * p + n(0.35)) * 10) / 10;
    }

    // ----- Strength (Mon/Wed/Fri) -----
    let lifted = false;
    if (STRENGTH_DAYS.includes(wd) && rnd() > 0.13 && !isToday) {
      lifted = true;
      strength.push({
        id: `str-${++sCount}`, date, type: "Traditional Strength Training",
        durationMin: Math.round(46 + n(7)), activeKcal: Math.round(255 + n(40)),
        avgHr: Math.round(112 + n(6)), maxHr: Math.round(148 + n(7)),
      });
      // Manual exercise log only for the last ~10 weeks (the user would have started logging recently).
      if (i > DAYS_OF_SAMPLE - 70) {
        for (const ex of EXERCISES) {
          const w = Math.round(((ex.start + (ex.end - ex.start) * p + n(1)) / 2.5)) * 2.5;
          lifts.push({
            id: `lift-${++liftCount}`, date, exercise: ex.name, sample: true,
            sets: [0, 1, 2].map((s) => ({ kg: w, reps: ex.reps - (s === 2 ? 1 : 0) + (rnd() < 0.15 ? 1 : 0) })),
          });
        }
      }
    }

    // ----- Nutrition (MyFitnessPal → Apple Health, only after sync was switched on ~day 25) -----
    if (i >= 25) {
      if (isToday) {
        d.protein = 82; d.carbs = 120; d.fat = 36; d.kcalIn = Math.round(4 * 82 + 4 * 120 + 9 * 36); d.mealsLogged = 2;
      } else if (rnd() > 0.09) {
        const prot = Math.round(138 + n(20) - (p > 0.7 ? 6 : 0));
        const carbs = Math.round(225 + n(38));
        const fat = Math.round(68 + n(11));
        d.protein = prot; d.carbs = carbs; d.fat = fat;
        d.kcalIn = Math.round(4 * prot + 4 * carbs + 9 * fat + n(30));
        d.mealsLogged = rnd() < 0.8 ? 4 : 3;
        if (rnd() < 0.025) { d.kcalIn = Math.round(500 + n(120)); d.protein = 35; d.carbs = 50; d.fat = 18; d.mealsLogged = 1; } // forgot to finish logging
      }
    }

    // ----- Activity energy & steps (Apple Watch) -----
    if (rnd() > 0.04) {
      d.restingKcal = Math.round(1760 - 25 * p + n(18));
      d.activeKcal = Math.round(380 + n(70) + (ranKm ? 120 + ranKm * 55 : 0) + (lifted ? 180 : 0));
      d.steps = Math.round(7600 + n(1900) + ranKm * 1100);
    }

    // ----- Recovery (Apple Watch) -----
    const worn = rnd() > 0.07;
    if (worn) {
      const sleep = Math.round(438 + n(42) - (p > 0.85 ? 18 : 0) + ([5, 6].includes(wd) ? 12 : 0));
      d.sleepMin = sleep;
      d.deepMin = Math.round(sleep * (0.15 + n(0.02)));
      d.remMin = Math.round(sleep * (0.21 + n(0.025)));
      d.bedtimeMin = Math.round(-60 + n(35) + ([5, 6].includes(wd) ? 45 : 0));
    }
    if (rnd() > 0.1) {
      d.restingHr = Math.round((56 - 3 * p + n(1.5)) * 10) / 10;
      d.hrv = Math.round((52 + 5 * p + n(8)) * 10) / 10;
    }
    if (rnd() > 0.12) d.respRate = Math.round((14.6 + n(0.4)) * 10) / 10;
    // A short illustrative dip in the most recent 3 days so the baseline-deviation feature has something to show.
    if (i >= DAYS_OF_SAMPLE - 3 && d.restingHr) { d.restingHr = Math.round((d.restingHr + 4.5) * 10) / 10; if (d.hrv) d.hrv = Math.round((d.hrv - 11) * 10) / 10; }

    // ----- Weight (MANUAL entries, ~every 3 days) -----
    if (i % 3 === 0 || (i + 1) % 11 === 0) weights.push({ date, kg: Math.round((84.2 - 3.4 * p + n(0.35)) * 10) / 10, sample: true });

    days.push(d);
  }
  return { days, runs, strength, lifts, weights };
}
