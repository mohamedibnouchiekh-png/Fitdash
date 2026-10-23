// Goal evaluation. Progress % is only produced where a linear "distance covered" reading is meaningful;
// otherwise `progressPct` is null and the status chip carries the message.
import type { Dataset, Goal, Settings } from "./types.ts";
import { addDays, diffDays } from "./dates.ts";
import {
  energyBalance, fmtDuration, isCompleteNutritionDay, lastCompletedWeeks, mean, predictRaceSec, present, proteinMet,
  slope, weeklyDistance, countInWeek, sortedWeights,
  strengthDates,
} from "./metrics.ts";

export type Status = "achieved" | "on_track" | "at_risk" | "off_track" | "unknown";
export interface GoalEval {
  currentText: string;
  targetText: string;
  progressPct: number | null;
  progressNote?: string;
  trendText: string;
  trendDir: "up" | "down" | "flat" | null;
  trendGood: boolean | null;
  status: Status;
  statusText: string;
  nextAction: string;
  definition: string;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const UNKNOWN = (def: string, tgt: string, why: string): GoalEval => ({
  currentText: "—", targetText: tgt, progressPct: null, trendText: "Not enough data", trendDir: null, trendGood: null,
  status: "unknown", statusText: "Not enough data", nextAction: why, definition: def,
});

export function raceLabel(km: number): string { return km === 5 ? "5 km" : km === 10 ? "10 km" : Math.abs(km - 21.0975) < 0.01 ? "Half-marathon" : `${km} km`; }

function projected(points: { x: number; y: number }[], xTarget: number): number | null {
  const s = slope(points);
  if (s === null) return null;
  const my = points.reduce((a, p) => a + p.y, 0) / points.length;
  const mx = points.reduce((a, p) => a + p.x, 0) / points.length;
  return my + s * (xTarget - mx);
}

export function evaluateGoal(g: Goal, ds: Dataset, s: Settings, today: string): GoalEval {
  const dl = g.deadline;
  const daysLeft = dl ? diffDays(dl, today) : null;

  switch (g.type) {
    case "race": {
      const km = g.raceKm ?? 5;
      const def = `Predicted ${raceLabel(km)} time (Riegel formula from your best recent effort in the last 90 days) versus your target time. A prediction, not a race result.`;
      const cur = predictRaceSec(ds.runs, today, km);
      if (!cur) return UNKNOWN(def, fmtDuration(g.target), "Run at least one ≥3 km session with split data to get a prediction.");
      // weekly history of predictions for trend
      const pts: { x: number; y: number }[] = [];
      for (let w = 8; w >= 0; w--) { const d = addDays(today, -7 * w); const pr = predictRaceSec(ds.runs, d, km); if (pr) pts.push({ x: -w, y: pr.sec }); }
      const sl = slope(pts); // seconds per week (negative = faster)
      const base = g.baseline ?? pts[0]?.y ?? cur.sec;
      const achieved = cur.sec <= g.target;
      const pct = achieved ? 100 : base > g.target ? clamp(((base - cur.sec) / (base - g.target)) * 100) : null;
      let status: Status = "unknown";
      if (achieved) status = "achieved";
      else if (sl !== null) {
        if (daysLeft !== null) {
          const proj = cur.sec + sl * (daysLeft / 7);
          status = proj <= g.target ? "on_track" : proj <= g.target * 1.03 ? "at_risk" : "off_track";
        } else status = sl < -1 ? "on_track" : sl < 1 ? "at_risk" : "off_track";
      }
      return {
        currentText: fmtDuration(cur.sec), targetText: fmtDuration(g.target), progressPct: pct,
        progressNote: "Measured from the prediction when the goal was set. Improvement is rarely linear.",
        trendText: sl === null ? "Not enough data" : `${sl < 0 ? "−" : "+"}${Math.abs(sl).toFixed(0)} s per week (predicted)`,
        trendDir: sl === null ? null : sl < -1 ? "down" : sl > 1 ? "up" : "flat", trendGood: sl === null ? null : sl < -1 ? true : sl > 1 ? false : null,
        status, statusText: statusLabel(status),
        nextAction: status === "achieved" ? "Target reached on paper. Consider confirming it in a time trial or race."
          : status === "on_track" ? "Keep the current plan: one easy run and one longer run per week, and add volume gradually."
          : "Add structured quality: one tempo or interval session in place of an easy run, while keeping total volume steady.",
        definition: def,
      };
    }
    case "weeklyKm": {
      const def = "Average distance per week over the last 4 completed Monday–Sunday weeks. A week without a recorded run counts as 0 km.";
      const weeks = lastCompletedWeeks(today, 8);
      const km = weeks.map((w) => weeklyDistance(ds.runs, w));
      const cur = mean(km.slice(-4)) as number;
      const sl = slope(km.map((y, x) => ({ x, y })));
      const achieved = cur >= g.target;
      let status: Status = achieved ? "achieved" : "unknown";
      if (!achieved && sl !== null) {
        if (daysLeft !== null) { const proj = cur + sl * (daysLeft / 7); status = proj >= g.target ? "on_track" : proj >= g.target * 0.9 ? "at_risk" : "off_track"; }
        else status = sl > 0.2 ? "on_track" : "at_risk";
      }
      return {
        currentText: `${cur.toFixed(1)} km/wk`, targetText: `${g.target} km/wk`, progressPct: clamp((cur / g.target) * 100),
        trendText: sl === null ? "Not enough data" : `${sl >= 0 ? "+" : "−"}${Math.abs(sl).toFixed(1)} km per week, per week`,
        trendDir: sl === null ? null : sl > 0.1 ? "up" : sl < -0.1 ? "down" : "flat", trendGood: sl === null ? null : sl > 0.1 ? true : null,
        status, statusText: statusLabel(status),
        nextAction: achieved ? "Hold this volume for a few weeks before raising the target." : "Raise weekly distance gradually, mostly through the longer run, and keep one easier week in four.",
        definition: def,
      };
    }
    case "strengthPerWeek": {
      const def = "Strength sessions per week, averaged over the last 4 completed weeks, versus the target number of sessions per week.";
      const weeks = lastCompletedWeeks(today, 4);
      const dates = strengthDates(ds);
      const counts = weeks.map((w) => countInWeek(dates, w));
      const cur = mean(counts) as number;
      const status: Status = counts.every((c) => c >= g.target) ? "achieved" : cur >= g.target * 0.85 ? "on_track" : cur >= g.target * 0.6 ? "at_risk" : "off_track";
      const missed = counts.filter((c) => c < g.target).length;
      return {
        currentText: `${cur.toFixed(1)} /wk`, targetText: `${g.target} /wk`, progressPct: clamp((cur / g.target) * 100),
        trendText: `Last 4 weeks: ${counts.join(" · ")}`, trendDir: null, trendGood: null,
        status, statusText: statusLabel(status),
        nextAction: status === "achieved" ? "Consistent. Keep your fixed training days." : `${missed} of the last 4 weeks fell short. Pin sessions to fixed weekdays and keep a short fallback session for busy days.`,
        definition: def,
      };
    }
    case "protein": {
      const def = `Share of logged days (last 14) with protein ≥ ${s.targets.proteinMetPct}% of your daily protein target (${s.targets.protein} g). Days without a complete log are skipped.`;
      const recent = ds.days.filter((d) => d.date >= addDays(today, -14) && isCompleteNutritionDay(d, today) && d.protein !== undefined);
      if (recent.length < 7) return UNKNOWN(def, `${g.target}% of days`, `Only ${recent.length} usable logged days in the last 14; at least 7 are needed.`);
      const hit = recent.filter((d) => proteinMet(d.protein as number, s.targets.protein, s.targets.proteinMetPct)).length;
      const cur = (hit / recent.length) * 100;
      const status: Status = cur >= g.target ? "achieved" : cur >= g.target * 0.8 ? "at_risk" : "off_track";
      return {
        currentText: `${cur.toFixed(0)}% (${hit}/${recent.length} days)`, targetText: `${g.target}% of days`, progressPct: clamp((cur / g.target) * 100),
        trendText: `Average ${(mean(recent.map((d) => d.protein)) as number).toFixed(0)} g vs ${s.targets.protein} g target`, trendDir: null, trendGood: null,
        status, statusText: statusLabel(status),
        nextAction: status === "achieved" ? "Keep your current protein habits." : "Anchor protein at each of your four meals (e.g. 30–40 g per meal) rather than catching up in the evening.",
        definition: def,
      };
    }
    case "deficit": {
      const def = "Average daily energy deficit over the last 14 complete days: estimated expenditure (Apple Watch resting + active) minus logged intake. Both are estimates; treat as a rough direction, not an exact figure.";
      const bal = ds.days.filter((d) => d.date >= addDays(today, -14)).map((d) => energyBalance(d, today));
      const v = present(bal);
      if (v.length < 7) return UNKNOWN(def, `${g.target} kcal/day deficit`, `Only ${v.length} days have both intake and expenditure; at least 7 are needed.`);
      const deficit = -(mean(v) as number);
      const diff = deficit - g.target;
      const status: Status = Math.abs(diff) <= 150 ? "on_track" : diff > 250 ? "at_risk" : diff < -150 ? "at_risk" : "on_track";
      const txt = Math.abs(diff) <= 150 ? "Close to the planned deficit." : diff > 0 ? "Deficit is larger than planned; check that fuelling still supports training." : "Deficit is smaller than planned.";
      return {
        currentText: `${deficit >= 0 ? "" : "+"}${Math.round(deficit)} kcal/day`, targetText: `${g.target} kcal/day`, progressPct: null,
        progressNote: "No percentage shown: a deficit goal is a band to stay inside, not a distance to cover.",
        trendText: `${v.length} days with usable data`, trendDir: null, trendGood: null,
        status, statusText: statusLabel(status),
        nextAction: txt + " Compare with your weight trend over several weeks before changing targets.", definition: def,
      };
    }
    case "vo2": {
      const def = "Apple Watch VO₂ max estimate (not a lab measurement). Current = mean of the latest 3 readings; baseline = the goal's starting value.";
      const vals = ds.days.filter((d) => d.vo2max !== undefined).map((d) => ({ date: d.date, v: d.vo2max as number }));
      if (vals.length < 4) return UNKNOWN(def, `${g.target}`, "The watch records VO₂ max only after suitable outdoor runs; need at least 4 readings.");
      const cur = mean(vals.slice(-3).map((x) => x.v)) as number;
      const pts = vals.filter((x) => x.date >= addDays(today, -90)).map((x) => ({ x: diffDays(x.date, today), y: x.v }));
      const sl = slope(pts);
      const base = g.baseline ?? (mean(vals.slice(0, 3).map((x) => x.v)) as number);
      const achieved = cur >= g.target;
      const pct = achieved ? 100 : target_gt(g.target, base) ? clamp(((cur - base) / (g.target - base)) * 100) : null;
      let status: Status = achieved ? "achieved" : "unknown";
      if (!achieved && sl !== null) {
        if (daysLeft !== null) { const proj = cur + sl * daysLeft; status = proj >= g.target ? "on_track" : proj >= g.target - 1 ? "at_risk" : "off_track"; }
        else status = sl > 0 ? "on_track" : "at_risk";
      }
      return {
        currentText: cur.toFixed(1), targetText: g.target.toFixed(1), progressPct: pct,
        progressNote: "VO₂ max moves slowly and the watch estimate is noisy; read this over months.",
        trendText: sl === null ? "Not enough data" : `${sl >= 0 ? "+" : "−"}${Math.abs(sl * 30).toFixed(1)} per month`,
        trendDir: sl === null ? null : sl > 0.002 ? "up" : sl < -0.002 ? "down" : "flat", trendGood: sl === null ? null : sl > 0.002 ? true : sl < -0.002 ? false : null,
        status, statusText: statusLabel(status),
        nextAction: "Build it with consistent easy running plus one interval session every 1–2 weeks. Judge it over months, not days.", definition: def,
      };
    }
    case "sleep": {
      const def = "Average sleep duration over the last 14 nights with recorded sleep (Apple Watch). Nights without data are skipped.";
      const v = present(ds.days.filter((d) => d.date >= addDays(today, -14)).map((d) => d.sleepMin));
      if (v.length < 7) return UNKNOWN(def, `${g.target} h`, `Only ${v.length} nights of data in the last 14; need at least 7.`);
      const cur = (mean(v) as number) / 60;
      const status: Status = cur >= g.target ? "achieved" : cur >= g.target - 0.5 ? "at_risk" : "off_track";
      return {
        currentText: `${cur.toFixed(1)} h`, targetText: `${g.target} h`, progressPct: clamp((cur / g.target) * 100),
        trendText: `${v.length} nights with data`, trendDir: null, trendGood: null, status, statusText: statusLabel(status),
        nextAction: status === "achieved" ? "Keep a regular bedtime." : "Move bedtime earlier by 15 minutes at a time, especially before training days.", definition: def,
      };
    }
    case "weight": {
      const def = "7-day average of manually entered weights versus target. Progress is measured from the weight when the goal started.";
      const w = sortedWeights(ds.weights);
      const recent = w.filter((x) => x.date > addDays(today, -7));
      if (recent.length < 2 || w.length < 4) return UNKNOWN(def, `${g.target} kg`, "Enter weight at least 2–3 times per week to see a trend.");
      const cur = mean(recent.map((x) => x.kg)) as number;
      const base = g.baseline ?? w.filter((x) => x.date >= addDays(today, -90))[0]?.kg ?? cur;
      const pts = w.filter((x) => x.date >= addDays(today, -28)).map((x) => ({ x: diffDays(x.date, today), y: x.kg }));
      const sl = slope(pts); // kg/day
      const losing = g.target < base;
      const achieved = losing ? cur <= g.target : cur >= g.target;
      const pct = achieved ? 100 : Math.abs(base - g.target) > 0.05 ? clamp(((base - cur) / (base - g.target)) * 100) : null;
      let status: Status = achieved ? "achieved" : "unknown";
      if (!achieved && sl !== null) {
        if (daysLeft !== null) { const proj = cur + sl * daysLeft; const hit = losing ? proj <= g.target : proj >= g.target; status = hit ? "on_track" : Math.abs(proj - g.target) <= 1 ? "at_risk" : "off_track"; }
        else status = (losing ? sl < 0 : sl > 0) ? "on_track" : "at_risk";
      }
      const perWeek = sl === null ? null : sl * 7;
      const fast = perWeek !== null && losing && perWeek < -(cur * 0.01);
      return {
        currentText: `${cur.toFixed(1)} kg`, targetText: `${g.target} kg`, progressPct: pct,
        trendText: perWeek === null ? "Not enough data" : `${perWeek >= 0 ? "+" : "−"}${Math.abs(perWeek).toFixed(2)} kg per week`,
        trendDir: perWeek === null ? null : perWeek > 0.05 ? "up" : perWeek < -0.05 ? "down" : "flat",
        trendGood: perWeek === null ? null : (losing ? perWeek < -0.05 : perWeek > 0.05) ? true : null,
        status, statusText: statusLabel(status),
        nextAction: fast ? "Weight is dropping faster than about 1% per week. If you want to keep muscle and run well, consider a smaller deficit." : status === "achieved" ? "Target reached. Consider shifting to maintenance." : "Judge the trend over 3–4 weeks. Day-to-day weight changes are mostly water.",
        definition: def,
      };
    }
  }
}
const target_gt = (t: number, b: number) => t > b;

export function statusLabel(s: Status): string {
  return { achieved: "Achieved", on_track: "On track", at_risk: "At risk", off_track: "Off track", unknown: "Not enough data" }[s];
}
