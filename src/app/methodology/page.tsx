"use client";
import { Card, PageHeader, Prov } from "@/components/ui";
import type { Provenance } from "@/lib/types";

const ROWS: { metric: string; prov: Provenance; formula: string; notes: string }[] = [
  { metric: "Pace", prov: "calculated", formula: "pace (s/km) = duration (s) ÷ distance (km). Aggregate pace = Σ time ÷ Σ distance.", notes: "Never the mean of per-run paces, which would over-weight short runs. Speed (km/h) = 3600 ÷ pace." },
  { metric: "Weekly mileage", prov: "calculated", formula: "Σ distance of runs dated Monday–Sunday of that ISO week.", notes: "A week without a recorded run counts as 0 km." },
  { metric: "Training consistency", prov: "calculated", formula: "weeks that reached the planned session count ÷ completed weeks.", notes: "The current, unfinished week is excluded." },
  { metric: "Calories eaten", prov: "reported", formula: "Daily total from MyFitnessPal via Apple Health.", notes: "Today, and any day under 800 kcal, is treated as incomplete and excluded from averages and balance. Missing days are not zero." },
  { metric: "Macro adherence", prov: "calculated", formula: "Calories met: |intake − target| ≤ tolerance% × target. Protein met: grams ≥ threshold% × target.", notes: "Tolerance and threshold are in Settings. Denominator = complete logged days only." },
  { metric: "Energy share of macros", prov: "calculated", formula: "protein 4 kcal/g, carbs 4 kcal/g, fat 9 kcal/g; share = macro kcal ÷ sum.", notes: "Standard Atwater factors. Alcohol and fibre are ignored." },
  { metric: "Estimated expenditure", prov: "estimated", formula: "Apple Watch resting energy + active energy for the day.", notes: "Both are device estimates; real expenditure commonly differs by 10–20%. Needs both parts present." },
  { metric: "Calorie balance", prov: "estimated", formula: "logged intake − estimated expenditure (negative = deficit).", notes: "Only for complete food-log days with both energy values. Use multi-week trends, not single days." },
  { metric: "Rolling averages", prov: "calculated", formula: "Mean of the non-missing values in a trailing window (7 or 30 days).", notes: "A window needs at least ½ of its days (4 of 7, 15 of 30), otherwise no value is shown." },
  { metric: "Personal baseline", prov: "calculated", formula: "mean and SD of the 28 days before the day in question (excluding it), needing ≥ 14 values.", notes: "“Outside usual range” = more than 1.5 SD from baseline in the unfavourable direction." },
  { metric: "Best 5/10 km, half", prov: "calculated", formula: "Fastest sum of consecutive full-km split times over the distance (half scaled by 21.0975/21).", notes: "Accurate to roughly 1 s/km because of 1 km granularity. Splits come from the Watch GPS route, calibrated to Apple's reported distance. Treadmill runs have no route and are excluded." },
  { metric: "Estimated race times", prov: "estimated", formula: "Riegel: T₂ = T₁ × (D₂ ÷ D₁)^1.06, from the best 5 km (else 10 km, else 3 km) effort of the last 90 days.", notes: "A prediction, not a result. Optimistic for the half-marathon without long-run training." },
  { metric: "Heart-rate zones", prov: "calculated", formula: "Z1 <60%, Z2 60–70%, Z3 70–80%, Z4 80–90%, Z5 ≥90% of max HR; time = sample spacing.", notes: "Generic percentages, not lab thresholds." },
  { metric: "VO₂ max", prov: "estimated", formula: "Value reported by Apple Watch; dashboard shows the mean of the latest 3 readings.", notes: "A watch estimate, not a laboratory measurement." },
  { metric: "Estimated 1RM", prov: "estimated", formula: "Epley: weight × (1 + reps ÷ 30).", notes: "Less reliable above about 10 reps." },
  { metric: "Weight trend", prov: "calculated", formula: "Least-squares slope over the last 28 days of manual entries (needs ≥ 3), shown per week.", notes: "7-day average smooths water fluctuation." },
  { metric: "Goal progress %", prov: "calculated", formula: "(baseline − current) ÷ (baseline − target), clamped 0–100, for race, VO₂ and weight; current ÷ target for volume/habit goals.", notes: "Not shown for calorie-deficit goals, which are a band to stay in. Progress is relative to the baseline when the goal was set." },
  { metric: "On track?", prov: "calculated", formula: "Linear projection of the recent trend to the deadline compared with the target.", notes: "A straight-line projection is a simplification; improvement is rarely linear." },
];

export default function Methodology() {
  return (
    <>
      <PageHeader title="Metric definitions" sub="How each number is obtained. Every metric is tagged Measured, Reported, Estimated or Calculated." />
      <Card>
        <ul className="mb-4 flex flex-wrap gap-2 text-xs text-mute"><li><Prov kind="measured" /> direct sensor reading</li><li><Prov kind="reported" /> value from a source app or typed by you</li><li><Prov kind="estimated" /> device or formula estimate</li><li><Prov kind="calculated" /> computed here from other values</li></ul>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="text-left text-xs text-mute"><th className="py-1.5 pr-3 font-medium">Metric</th><th className="py-1.5 pr-3 font-medium">Type</th><th className="py-1.5 pr-3 font-medium">Formula</th><th className="py-1.5 font-medium">Notes</th></tr></thead>
            <tbody>{ROWS.map((r) => (
              <tr key={r.metric} className="border-t border-line align-top"><td className="py-2 pr-3 font-medium">{r.metric}</td><td className="py-2 pr-3"><Prov kind={r.prov} /></td><td className="py-2 pr-3">{r.formula}</td><td className="py-2 text-mute">{r.notes}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-mute">Missing data is never treated as zero: a value without data is blank and is left out of averages. Calories from different sources are never summed, and one workout recorded by two sources is counted once.</p>
      </Card>
    </>
  );
}
