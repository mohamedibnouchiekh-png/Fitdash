"use client";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "@/lib/store";
import { addDays, eachDay, monthLabel, shortDate } from "@/lib/dates";
import { bucketKey, estimatedExpenditure, isCompleteNutritionDay, kcalWithin, macroEnergyShare, mean, proteinMet, rolling, type Granularity } from "@/lib/metrics";
import { computeInsights } from "@/lib/insights";
import { Card, EmptyState, Kpi, Notice, PageHeader, Segmented } from "@/components/ui";
import { ChartBox, Legend, useAxis } from "@/components/charts";

export default function Nutrition() {
  const { ds, settings, today, from, to } = useApp();
  const ax = useAxis();
  const t = settings.targets;
  const [gran, setGran] = useState<Granularity>("day");

  const m = useMemo(() => {
    const dates = [...eachDay(from, to)];
    const rows = dates.map((date) => {
      const d = ds.days.find((x) => x.date === date);
      const complete = !!d && isCompleteNutritionDay(d, today);
      return { date, d, complete };
    });
    const logged = rows.filter((r) => r.complete).map((r) => r.d!);
    const eligible = rows.filter((r) => r.date < today).length;
    const avg = (f: (d: NonNullable<(typeof rows)[number]["d"]>) => number | undefined) => mean(logged.map(f));

    // bucketed series
    const buckets = new Map<string, typeof logged>();
    for (const r of rows) {
      const k = bucketKey(r.date, gran);
      if (!buckets.has(k)) buckets.set(k, []);
      if (r.complete) buckets.get(k)!.push(r.d!);
    }
    const series = [...buckets.entries()].map(([k, ds2]) => ({
      key: k, label: gran === "month" ? monthLabel(k) : shortDate(k),
      kcal: mean(ds2.map((x) => x.kcalIn)) ?? undefined, protein: mean(ds2.map((x) => x.protein)) ?? undefined,
      carbs: mean(ds2.map((x) => x.carbs)) ?? undefined, fat: mean(ds2.map((x) => x.fat)) ?? undefined, n: ds2.length,
    }));

    // rolling 7-day intake vs expenditure on day grid
    const kcalArr = rows.map((r) => (r.complete ? r.d!.kcalIn : undefined));
    const expArr = rows.map((r) => (r.d ? estimatedExpenditure(r.d) : null));
    const rk = rolling(kcalArr, 7, 4), re = rolling(expArr, 7, 4);
    const vs = rows.map((r, i) => ({ label: shortDate(r.date), intake: rk[i] ?? undefined, exp: re[i] ?? undefined }));

    const last7 = ds.days.filter((d) => d.date > addDays(today, -7) && isCompleteNutritionDay(d, today));
    const share = macroEnergyShare(avg((d) => d.protein), avg((d) => d.carbs), avg((d) => d.fat));
    return {
      logged, eligible, series, vs, share,
      kcal7: mean(last7.map((d) => d.kcalIn)), prot7: mean(last7.map((d) => d.protein)), n7: last7.length,
      avgK: avg((d) => d.kcalIn), avgP: avg((d) => d.protein), avgC: avg((d) => d.carbs), avgF: avg((d) => d.fat),
      kcalOk: logged.filter((d) => kcalWithin(d.kcalIn as number, t.kcal, t.kcalTolerancePct)).length,
      protOk: logged.filter((d) => d.protein !== undefined && proteinMet(d.protein, t.protein, t.proteinMetPct)).length,
    };
  }, [ds, from, to, today, gran, t]);

  const { insights, withheld } = useMemo(() => computeInsights(ds, settings, today), [ds, settings, today]);
  const proteinI = insights.find((i) => i.id === "protein");
  const energyI = insights.find((i) => i.id === "energy");
  const weightI = insights.find((i) => i.id === "weight");
  const held = withheld.filter((w) => ["protein", "energy", "weight"].includes(w.id));
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  const n = m.logged.length;

  if (n === 0) return (<><PageHeader title="Nutrition" /><EmptyState title="No complete food logs in this date range" body="Nutrition data comes from MyFitnessPal via Apple Health. Check that the source is on (Sources menu) and widen the date range." /></>);

  return (
    <>
      <PageHeader title="Nutrition" sub="Calories and macros from MyFitnessPal (via Apple Health). Calorie balance is always an estimate." />
      {proteinI && <div className="mb-4"><Notice tone="warn" title={proteinI.title}>{proteinI.body}</Notice></div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Avg calories (7 d)" prov="reported" value={m.kcal7 === null ? "—" : Math.round(m.kcal7)} unit="kcal" sub={`Target ${t.kcal} · ${m.n7} complete days`} info="Mean of complete logged days. Today and logs under 800 kcal are excluded as incomplete." />
        <Kpi label="Avg protein (7 d)" prov="reported" value={m.prot7 === null ? "—" : Math.round(m.prot7)} unit="g" sub={`Target ${t.protein} g`} />
        <Kpi label="Calories on target" prov="calculated" value={pct(m.kcalOk, n)} sub={`${m.kcalOk}/${n} days within ±${t.kcalTolerancePct}%`} info={`A day counts when intake is within ±${t.kcalTolerancePct}% of ${t.kcal} kcal. Change this in Settings.`} />
        <Kpi label="Protein on target" prov="calculated" value={pct(m.protOk, n)} sub={`${m.protOk}/${n} days ≥ ${t.proteinMetPct}% of target`} />
        <Kpi label="Logging consistency" prov="calculated" value={pct(n, m.eligible)} sub={`${n} of ${m.eligible} past days with a complete log`} info="Share of past days in the range that have a complete food log. Un-logged days are excluded from averages, not counted as zero." />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Calories" info="Average of complete logged days per bucket. Gaps are un-logged days." right={<Segmented label="Granularity" value={gran} onChange={setGran} options={[{ key: "day", label: "Day" }, { key: "week", label: "Week" }, { key: "month", label: "Month" }]} />}>
          <ChartBox label={`Average calories per ${gran} against target`} height={240}>
            <BarChart data={m.series}>
              <CartesianGrid {...ax.grid} /><XAxis dataKey="label" {...ax.x} /><YAxis {...ax.y} domain={[0, "auto"]} />
              <Tooltip {...ax.tip} formatter={(v) => [`${Math.round(Number(v))} kcal`, "Intake"]} />
              <ReferenceLine y={t.kcal} stroke={ax.p.gray} strokeDasharray="5 4" />
              <Bar dataKey="kcal" fill={ax.p.blue} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartBox>
          <Legend items={[{ color: ax.p.blue, label: "Intake (reported)" }, { color: ax.p.gray, label: `Target ${t.kcal}`, dashed: true }]} />
        </Card>

        <Card title="Macros (grams)" info="Average grams per bucket. Dashed lines are your targets: protein, carbohydrate, fat.">
          <ChartBox label={`Average protein, carbohydrate and fat grams per ${gran}`} height={240}>
            <ComposedChart data={m.series}>
              <CartesianGrid {...ax.grid} /><XAxis dataKey="label" {...ax.x} /><YAxis {...ax.y} domain={[0, "auto"]} />
              <Tooltip {...ax.tip} formatter={(v, n) => [`${Math.round(Number(v))} g`, String(n)]} />
              <ReferenceLine y={t.protein} stroke={ax.p.blue} strokeDasharray="4 4" strokeOpacity={0.6} />
              <ReferenceLine y={t.carbs} stroke={ax.p.orange} strokeDasharray="4 4" strokeOpacity={0.6} />
              <ReferenceLine y={t.fat} stroke={ax.p.purple} strokeDasharray="4 4" strokeOpacity={0.6} />
              <Line dataKey="protein" name="Protein" stroke={ax.p.blue} strokeWidth={2} dot={gran !== "day"} connectNulls={false} />
              <Line dataKey="carbs" name="Carbs" stroke={ax.p.orange} strokeWidth={2} dot={gran !== "day"} connectNulls={false} />
              <Line dataKey="fat" name="Fat" stroke={ax.p.purple} strokeWidth={2} dot={gran !== "day"} connectNulls={false} />
            </ComposedChart>
          </ChartBox>
          <Legend items={[{ color: ax.p.blue, label: `Protein (target ${t.protein} g)` }, { color: ax.p.orange, label: `Carbs (${t.carbs} g)` }, { color: ax.p.purple, label: `Fat (${t.fat} g)` }]} />
        </Card>

        <Card title="Intake vs estimated expenditure (7-day rolling)" info="Rolling 7-day average of logged intake and Apple Watch resting + active energy. A point needs at least 4 days of data in its window. Expenditure is an estimate; intake depends on how accurately you log.">
          <ChartBox label="Rolling average calorie intake compared with estimated expenditure" height={240}>
            <ComposedChart data={m.vs}>
              <CartesianGrid {...ax.grid} /><XAxis dataKey="label" {...ax.x} /><YAxis {...ax.y} domain={["auto", "auto"]} />
              <Tooltip {...ax.tip} formatter={(v, n) => [`${Math.round(Number(v))} kcal`, String(n)]} />
              <Line dataKey="intake" name="Intake" stroke={ax.p.blue} strokeWidth={2} dot={false} />
              <Line dataKey="exp" name="Est. expenditure" stroke={ax.p.orange} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ChartBox>
          <Legend items={[{ color: ax.p.blue, label: "Intake (reported)" }, { color: ax.p.orange, label: "Expenditure (estimated)" }]} />
        </Card>

        <Card title="Macro distribution &amp; targets" info="Share of energy from each macro (protein 4 kcal/g, carbohydrate 4, fat 9) over the selected range. Averages use complete logged days only.">
          {m.share && (
            <div className="mb-4">
              <div className="flex h-5 overflow-hidden rounded-full" role="img" aria-label={`Energy share: protein ${Math.round(m.share.p * 100)}%, carbohydrate ${Math.round(m.share.c * 100)}%, fat ${Math.round(m.share.f * 100)}%`}>
                <div style={{ width: `${m.share.p * 100}%`, background: ax.p.blue }} /><div style={{ width: `${m.share.c * 100}%`, background: ax.p.orange }} /><div style={{ width: `${m.share.f * 100}%`, background: ax.p.purple }} />
              </div>
              <Legend items={[{ color: ax.p.blue, label: `Protein ${Math.round(m.share.p * 100)}%` }, { color: ax.p.orange, label: `Carbs ${Math.round(m.share.c * 100)}%` }, { color: ax.p.purple, label: `Fat ${Math.round(m.share.f * 100)}%` }]} />
            </div>
          )}
          <table className="w-full text-sm">
            <caption className="sr-only">Average intake versus target</caption>
            <thead><tr className="text-left text-xs text-mute"><th className="py-1 font-medium">Nutrient</th><th className="py-1 text-right font-medium">Average</th><th className="py-1 text-right font-medium">Target</th><th className="py-1 text-right font-medium">% of target</th></tr></thead>
            <tbody className="tnum">
              {([["Calories", m.avgK, t.kcal, "kcal"], ["Protein", m.avgP, t.protein, "g"], ["Carbs", m.avgC, t.carbs, "g"], ["Fat", m.avgF, t.fat, "g"]] as const).map(([name, avg, tg, u]) => (
                <tr key={name} className="border-t border-line"><td className="py-1.5">{name}</td><td className="py-1.5 text-right">{avg === null ? "—" : Math.round(avg)} {u}</td><td className="py-1.5 text-right">{tg} {u}</td><td className="py-1.5 text-right">{avg === null ? "—" : `${Math.round((avg / tg) * 100)}%`}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Does intake fit your body-composition goal?" info="Rule-based read-out. It needs enough logged days and, for weight, enough manual entries; otherwise it stays silent rather than guess.">
          {energyI || weightI ? (
            <ul className="space-y-3 text-sm">
              {[energyI, weightI].filter(Boolean).map((i) => (<li key={i!.id}><p className="font-medium">{i!.title}</p><p className="mt-0.5 text-mute">{i!.body}</p><p className="mt-0.5 text-xs text-mute">Evidence: {i!.evidence}</p></li>))}
            </ul>
          ) : <p className="text-sm text-mute">No statement made: not enough data. {held.map((h) => h.reason).join(" ")}</p>}
        </Card>
      </div>
    </>
  );
}
