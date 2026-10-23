"use client";
import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceArea, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "@/lib/store";
import { addDays, shortDate } from "@/lib/dates";
import { baselineAt, mean, present, rolling, sd, slope, sortedWeights, zScore, type Num } from "@/lib/metrics";
import { diffDays } from "@/lib/dates";
import { btnPrimary, Card, EmptyState, Field, inputCls, Kpi, Notice, PageHeader, Prov, Segmented } from "@/components/ui";
import { ChartBox, Legend, useAxis } from "@/components/charts";
import type { Day, Provenance } from "@/lib/types";

type Key = "restingHr" | "hrv" | "sleepMin" | "steps" | "respRate";
const METRICS: { key: Key; label: string; unit: string; scale: number; dec: number; bad: 1 | -1 | 0; prov: Provenance; info: string }[] = [
  { key: "restingHr", label: "Resting HR", unit: "bpm", scale: 1, dec: 1, bad: 1, prov: "measured", info: "Daily resting heart rate from Apple Watch. A higher-than-usual run can accompany hard training, poor sleep, illness or heat." },
  { key: "hrv", label: "HRV", unit: "ms", scale: 1, dec: 0, bad: -1, prov: "measured", info: "Heart-rate variability (SDNN). Very individual; only compare with your own history. Lower than usual can accompany stress or fatigue." },
  { key: "sleepMin", label: "Sleep", unit: "h", scale: 1 / 60, dec: 1, bad: -1, prov: "estimated", info: "Time asleep as estimated by Apple Watch. Sleep stages are estimates, not a sleep-lab measurement." },
  { key: "steps", label: "Steps", unit: "", scale: 1, dec: 0, bad: 0, prov: "measured", info: "Daily step count from iPhone and Apple Watch; Apple Health de-duplicates overlapping sources." },
  { key: "respRate", label: "Respiratory rate", unit: "br/min", scale: 1, dec: 1, bad: 1, prov: "estimated", info: "Overnight respiratory rate estimate from Apple Watch." },
];

export default function Recovery() {
  const { ds, settings, update, today, from, to } = useApp();
  const ax = useAxis();
  const [key, setKey] = useState<Key>("restingHr");
  const [wDate, setWDate] = useState(today);
  const [wKg, setWKg] = useState("");
  const [wErr, setWErr] = useState("");

  const n = ds.days.length;
  const cfg = METRICS.find((m) => m.key === key)!;

  const summary = useMemo(() => METRICS.map((m) => {
    const arr: Num[] = ds.days.map((d) => (d[m.key] === undefined ? undefined : (d[m.key] as number) * m.scale));
    const last7 = present(arr.slice(-7)), last30 = present(arr.slice(-30));
    const latestIdx = [...arr.keys()].reverse().find((i) => arr[i] !== undefined && arr[i] !== null);
    const b = baselineAt(arr, n - 1);
    const v7 = mean(arr.slice(-7));
    let flag = "No data";
    if (v7 !== null) { flag = "Baseline building (needs 14 days)"; if (b) { const z = zScore(v7, b); flag = z === null ? "Within usual range" : m.bad === 0 ? (Math.abs(z) > 1.5 ? "Different from usual" : "Within usual range") : z * m.bad > 1.5 ? "Outside usual range" : z * -m.bad > 1.5 ? "Better than usual" : "Within usual range"; } }
    return { m, latest: latestIdx === undefined ? null : (arr[latestIdx] as number), latestDate: latestIdx === undefined ? null : ds.days[latestIdx].date, v7, v30: mean(arr.slice(-30)), n7: last7.length, n30: last30.length, flag, b };
  }), [ds.days, n]);

  const chart = useMemo(() => {
    const arr: Num[] = ds.days.map((d) => (d[key] === undefined ? undefined : (d[key] as number) * cfg.scale));
    const r7 = rolling(arr, 7, 4), r30 = rolling(arr, 30, 15);
    return ds.days.map((d, i) => ({ date: d.date, label: shortDate(d.date), v: arr[i] ?? undefined, r7: r7[i] ?? undefined, r30: r30[i] ?? undefined })).filter((p) => p.date >= from && p.date <= to);
  }, [ds.days, key, cfg.scale, from, to]);
  const band = summary.find((s) => s.m.key === key)?.b;

  const sleepRows = useMemo(() => ds.days.filter((d) => d.date >= from && d.date <= to && d.sleepMin !== undefined).map((d: Day) => ({
    label: shortDate(d.date), deep: Math.round(((d.deepMin ?? 0) / 60) * 100) / 100, rem: Math.round(((d.remMin ?? 0) / 60) * 100) / 100,
    other: Math.round((((d.sleepMin as number) - (d.deepMin ?? 0) - (d.remMin ?? 0)) / 60) * 100) / 100,
  })), [ds.days, from, to]);
  const last14 = ds.days.filter((d) => d.date > addDays(today, -14));
  const bedSd = sd(last14.map((d) => d.bedtimeMin));
  const bedMean = mean(last14.map((d) => d.bedtimeMin));
  const fmtClock = (min: number) => { const t = ((Math.round(min) % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
  const stageShare = (() => { const x = last14.filter((d) => d.sleepMin && d.deepMin !== undefined && d.remMin !== undefined); const tot = x.reduce((a, d) => a + (d.sleepMin as number), 0); return x.length >= 5 && tot ? (x.reduce((a, d) => a + (d.deepMin as number) + (d.remMin as number), 0) / tot) * 100 : null; })();

  // weight
  const weights = useMemo(() => sortedWeights(ds.weights), [ds.weights]);
  const wChart = useMemo(() => weights.filter((w) => w.date >= from && w.date <= to).map((w) => ({
    label: shortDate(w.date), kg: w.kg,
    avg7: mean(weights.filter((x) => x.date <= w.date && x.date > addDays(w.date, -7)).map((x) => x.kg)) ?? undefined,
  })), [weights, from, to]);
  const w28 = weights.filter((w) => w.date > addDays(today, -28));
  const sl = slope(w28.map((w) => ({ x: diffDays(w.date, today), y: w.kg })));
  const wLast = weights[weights.length - 1];

  const addWeight = () => {
    const kg = Number(wKg.replace(",", "."));
    if (!Number.isFinite(kg) || kg < 30 || kg > 250) { setWErr("Enter a weight between 30 and 250 kg."); return; }
    if (wDate > today) { setWErr("The date cannot be in the future."); return; }
    update({ weights: [...settings.weights.filter((w) => w.date !== wDate), { date: wDate, kg: Math.round(kg * 10) / 10 }] });
    setWErr(""); setWKg("");
  };

  if (!ds.days.some((d) => d.restingHr !== undefined || d.sleepMin !== undefined) && weights.length === 0) return (<><PageHeader title="Recovery & health" /><EmptyState title="No recovery data" body="Apple Watch data and manual weight are switched off. Check the Sources menu." /></>);

  return (
    <>
      <PageHeader title="Recovery &amp; health" sub="Daily values with 7- and 30-day trends, judged against your own baseline. Consumer-device readings are not medical measurements." />
      <Notice title="Read these as signals, not diagnoses">Wearable measurements are estimates and are noisy day to day. A value outside your usual range is a prompt to look at sleep, training load and stress. It does not show what caused it, and it is not a medical assessment.</Notice>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {summary.map((s) => (
          <Kpi key={s.m.key} label={s.m.label} prov={s.m.prov} info={s.m.info} value={s.latest === null ? "—" : s.latest.toFixed(s.m.dec)} unit={s.m.unit}
            sub={<span className="block">7 d avg {s.v7 === null ? "—" : s.v7.toFixed(s.m.dec)} · 30 d {s.v30 === null ? "—" : s.v30.toFixed(s.m.dec)}<span className="block">{s.flag}</span></span>} />
        ))}
      </div>

      <div className="mt-6">
        <Card title={`${cfg.label}: daily, 7-day and 30-day`} info={`Dots/thin line: daily values. A 7-day and 30-day average needs at least 4 and 15 values in their windows. The shaded band is your own baseline (mean ± 1 SD of the 28 days before today). ${cfg.info}`}
          right={<Segmented label="Metric" value={key} onChange={setKey} options={METRICS.map((m) => ({ key: m.key, label: m.label }))} />}>
          {present(chart.map((c) => c.v)).length === 0 ? <EmptyState title="No data for this metric in the selected range" /> : (
            <>
              <ChartBox label={`${cfg.label} daily values with 7-day and 30-day averages`} height={280}>
                <ComposedChart data={chart}>
                  <CartesianGrid {...ax.grid} /><XAxis dataKey="label" {...ax.x} /><YAxis {...ax.y} domain={["auto", "auto"]} tickFormatter={(v) => (cfg.dec === 0 ? String(Math.round(v)) : Number(v).toFixed(1))} />
                  <Tooltip {...ax.tip} formatter={(v, nm) => [`${Number(v).toFixed(cfg.dec)} ${cfg.unit}`, String(nm)]} />
                  {band && <ReferenceArea y1={band.mean - band.sd} y2={band.mean + band.sd} fill={ax.p.gray} fillOpacity={0.15} strokeOpacity={0} />}
                  <Line dataKey="v" name="Daily" stroke={ax.p.sky} strokeWidth={1} strokeOpacity={0.7} dot={{ r: 2 }} connectNulls={false} />
                  <Line dataKey="r7" name="7-day avg" stroke={ax.p.blue} strokeWidth={2.5} dot={false} />
                  <Line dataKey="r30" name="30-day avg" stroke={ax.p.orange} strokeWidth={2.5} dot={false} strokeDasharray="6 3" />
                </ComposedChart>
              </ChartBox>
              <Legend items={[{ color: ax.p.sky, label: "Daily" }, { color: ax.p.blue, label: "7-day average" }, { color: ax.p.orange, label: "30-day average", dashed: true }, { color: ax.p.gray, label: band ? "Your baseline (±1 SD)" : "Baseline needs 14+ days" }]} />
            </>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Sleep" info="Hours asleep split into deep, REM and other stages (Apple Watch estimates). Regularity is the day-to-day spread of your bedtime over 14 nights; a smaller number means a more regular schedule.">
          <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
            <div><p className="text-xs text-mute">Typical bedtime</p><p className="tnum font-semibold">{bedMean === null ? "—" : fmtClock(bedMean)}</p></div>
            <div><p className="text-xs text-mute">Regularity (SD)</p><p className="tnum font-semibold">{bedSd === null ? "—" : `±${Math.round(bedSd)} min`}</p></div>
            <div><p className="text-xs text-mute">Deep + REM share</p><p className="tnum font-semibold">{stageShare === null ? "—" : `${Math.round(stageShare)}%`}</p></div>
          </div>
          {sleepRows.length === 0 ? <EmptyState title="No sleep data in range" /> : (
            <>
              <ChartBox label="Sleep duration by stage per night" height={220}>
                <BarChart data={sleepRows}>
                  <CartesianGrid {...ax.grid} /><XAxis dataKey="label" {...ax.x} /><YAxis {...ax.y} unit=" h" />
                  <Tooltip {...ax.tip} formatter={(v, nm) => [`${Number(v).toFixed(1)} h`, String(nm)]} />
                  <Bar dataKey="deep" name="Deep" stackId="s" fill={ax.p.blue} />
                  <Bar dataKey="rem" name="REM" stackId="s" fill={ax.p.purple} />
                  <Bar dataKey="other" name="Core / other" stackId="s" fill={ax.p.sky} fillOpacity={0.55} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ChartBox>
              <Legend items={[{ color: ax.p.blue, label: "Deep" }, { color: ax.p.purple, label: "REM" }, { color: ax.p.sky, label: "Core / other" }]} />
            </>
          )}
        </Card>

        <Card title="Weight (manual entry)" info="You enter weight yourself; nothing is pulled automatically. The 7-day average smooths day-to-day water fluctuations. The trend is a least-squares slope over the last 28 days and needs at least 3 entries.">
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); addWeight(); }}>
            <Field label="Date"><input type="date" max={today} className={inputCls} value={wDate} onChange={(e) => setWDate(e.target.value)} /></Field>
            <Field label="Weight (kg)" hint={wErr || undefined}><input className={`${inputCls} w-28`} inputMode="decimal" placeholder="e.g. 81.4" value={wKg} onChange={(e) => setWKg(e.target.value)} aria-invalid={!!wErr} /></Field>
            <button type="submit" className={btnPrimary}>Add</button>
          </form>
          <div className="mt-3 flex gap-6 text-sm">
            <div><p className="text-xs text-mute">Latest entry</p><p className="tnum font-semibold">{wLast ? `${wLast.kg.toFixed(1)} kg` : "—"} <Prov kind="reported" /></p></div>
            <div><p className="text-xs text-mute">Trend (28 d)</p><p className="tnum font-semibold">{sl === null ? "Needs ≥3 entries" : `${sl >= 0 ? "+" : "−"}${Math.abs(sl * 7).toFixed(2)} kg/week`}</p></div>
          </div>
          {wChart.length === 0 ? <div className="mt-3"><EmptyState title="No weight entries in this range" body="Add an entry above." /></div> : (
            <>
              <div className="mt-2"><ChartBox label="Body weight entries with 7-day average" height={190}>
                <ComposedChart data={wChart}>
                  <CartesianGrid {...ax.grid} /><XAxis dataKey="label" {...ax.x} /><YAxis {...ax.y} domain={["dataMin - 1", "dataMax + 1"]} unit=" kg" width={56} />
                  <Tooltip {...ax.tip} formatter={(v, nm) => [`${Number(v).toFixed(1)} kg`, String(nm)]} />
                  <Line dataKey="kg" name="Entry" stroke={ax.p.sky} strokeWidth={0} dot={{ r: 3 }} />
                  <Line dataKey="avg7" name="7-day avg" stroke={ax.p.blue} strokeWidth={2.5} dot={false} />
                </ComposedChart>
              </ChartBox></div>
              <Legend items={[{ color: ax.p.sky, label: "Entry (reported)" }, { color: ax.p.blue, label: "7-day average (calculated)" }]} />
            </>
          )}
          {weights.length > 0 && (
            <ul className="mt-3 max-h-40 divide-y divide-line overflow-y-auto border-t border-line text-sm">
              {[...weights].reverse().slice(0, 8).map((w) => (
                <li key={w.date} className="flex items-center justify-between py-1.5"><span className="tnum">{shortDate(w.date)} · {w.kg.toFixed(1)} kg {w.sample && <span className="ml-1 rounded border border-line px-1 text-[10px] uppercase text-mute">sample</span>}</span>
                  {!w.sample && <button type="button" aria-label={`Delete weight entry from ${shortDate(w.date)}`} onClick={() => update({ weights: settings.weights.filter((x) => x.date !== w.date) })} className="rounded p-1 text-mute hover:text-bad"><Trash2 size={14} /></button>}</li>
              ))}
            </ul>
          )}
          {weights.some((w) => w.sample) && <p className="mt-2 text-xs text-mute">These weights are sample data. As soon as you add your own entry, the sample weights disappear.</p>}
        </Card>
      </div>
    </>
  );
}
