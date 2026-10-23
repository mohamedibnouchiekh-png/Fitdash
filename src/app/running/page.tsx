"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { useApp } from "@/lib/store";
import { addDays, longDate, monthLabel, shortDate, weekStart } from "@/lib/dates";
import { HALF_KM, HR_ZONES, aggregatePace, bestEffort, bucketKey, fastestKm, fmtDuration, fmtPace, mean, parseDuration, predictRaceSec, riegel, sum, timeInZones, type Granularity } from "@/lib/metrics";
import { evaluateGoal, raceLabel } from "@/lib/goals";
import { btnPrimary, Card, EmptyState, Field, inputCls, Kpi, PageHeader, Progress, Segmented, StatusChip } from "@/components/ui";
import { ChartBox, Legend, useAxis } from "@/components/charts";

export default function Running() {
  const { ds, settings, update, today, from, to } = useApp();
  const ax = useAxis();
  const [gran, setGran] = useState<Granularity>("week");
  const [raceKm, setRaceKm] = useState("5");
  const [raceTime, setRaceTime] = useState("27:30");
  const [raceErr, setRaceErr] = useState("");

  const runs = useMemo(() => ds.runs.filter((r) => r.date >= from && r.date <= to), [ds.runs, from, to]);
  const m = useMemo(() => {
    const km = runs.reduce((a, r) => a + r.distanceKm, 0);
    const dur = runs.reduce((a, r) => a + r.durationSec, 0);
    const withHr = runs.filter((r) => r.avgHr !== null); // runs without heart-rate data are left out, not counted as 0 bpm
    const hrDur = withHr.reduce((a, r) => a + r.durationSec, 0);
    const hr = hrDur ? withHr.reduce((a, r) => a + (r.avgHr as number) * r.durationSec, 0) / hrDur : null; // time-weighted average
    // distance buckets, including empty weeks/months inside the range
    const map = new Map<string, number>();
    for (let d = from; d <= to; d = addDays(d, 1)) map.set(bucketKey(d, gran), map.get(bucketKey(d, gran)) ?? 0);
    for (const r of runs) map.set(bucketKey(r.date, gran), (map.get(bucketKey(r.date, gran)) ?? 0) + r.distanceKm);
    const volume = [...map.entries()].map(([k, v]) => ({ label: gran === "month" ? monthLabel(k) : shortDate(k), km: Math.round(v * 10) / 10 }));
    const perRun = runs.map((r) => ({ label: shortDate(r.date), pace: Math.round(r.durationSec / r.distanceKm), hr: r.avgHr, date: r.date }));
    const zones = timeInZones(runs, settings.hrMax);
    const zTot = zones.reduce((a, b) => a + b, 0);
    const vo2 = ds.days.filter((d) => d.vo2max !== undefined && d.date >= from && d.date <= to).map((d) => ({ label: shortDate(d.date), v: d.vo2max as number }));
    return {
      km, dur, pace: aggregatePace(runs), hr, elev: sum(runs.map((r) => r.elevGain)), volume, perRun, zones, zTot, vo2,
      scatter: runs.filter((r) => r.avgHr !== null).map((r) => ({ hr: r.avgHr as number, pace: Math.round(r.durationSec / r.distanceKm), km: r.distanceKm })),
    };
  }, [runs, from, to, gran, ds.days, settings.hrMax]);

  const all = ds.runs;
  const prs = useMemo(() => ({
    k5: bestEffort(all, 5), k10: bestEffort(all, 10), half: bestEffort(all, HALF_KM), fast: fastestKm(all),
    longest: all.reduce<(typeof all)[number] | null>((b, r) => (!b || r.distanceKm > b.distanceKm ? r : b), null),
  }), [all]);
  const pred = useMemo(() => {
    const base = predictRaceSec(all, today, 5);
    return base ? { basis: base.basis, rows: [5, 10, HALF_KM].map((d) => ({ d, sec: riegel(base.basis.sec, base.basis.distKm, d) })) } : null;
  }, [all, today]);

  const raceGoals = settings.goals.filter((g) => g.type === "race");
  const addRace = () => {
    const sec = parseDuration(raceTime);
    if (!sec || sec < 60) { setRaceErr("Enter the time as mm:ss or h:mm:ss, e.g. 27:30"); return; }
    const km = Number(raceKm);
    const base = predictRaceSec(all, today, km)?.sec;
    update({ goals: [...settings.goals, { id: `g-${Date.now()}`, type: "race", raceKm: km, target: sec, label: `${raceLabel(km)} in ${fmtDuration(sec)}`, baseline: base, deadline: addDays(today, 90) }] });
    setRaceErr("");
  };

  if (all.length === 0) return (<><PageHeader title="Running" /><EmptyState title="No runs available" body="Runs come from Apple Watch workouts via Apple Health. Check that the Apple Watch source is on in the Sources menu." /></>);

  return (
    <>
      <PageHeader title="Running" sub="Apple Watch workouts via Apple Health. Pace, splits and records are calculated here." />
      {runs.length === 0 ? <EmptyState title="No runs in this date range" body="Widen the date range to see your running data." /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label="Distance" prov="measured" value={m.km.toFixed(1)} unit="km" sub={`${runs.length} run${runs.length > 1 ? "s" : ""}`} />
            <Kpi label="Average pace" prov="calculated" value={fmtPace(m.pace)} unit="/km" info="Total time ÷ total distance. Moving pace is not separate from this: Apple Watch workout durations already exclude paused time." />
            <Kpi label="Duration" prov="measured" value={fmtDuration(m.dur)} sub={`Avg ${fmtDuration(m.dur / runs.length)} per run`} />
            <Kpi label="Average HR" prov="measured" value={m.hr === null ? "—" : Math.round(m.hr)} unit="bpm" info="Time-weighted average of each run's average heart rate." />
            <Kpi label="Elevation gain" prov="measured" value={m.elev === null ? "—" : Math.round(m.elev)} unit="m" info="Climb as reported by the Apple Watch (barometric altimeter) where available, otherwise derived from the GPS route. Runs with neither are left out." />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Card title="Distance" right={<Segmented label="Granularity" value={gran} onChange={setGran} options={[{ key: "week", label: "Week" }, { key: "month", label: "Month" }]} />} info="Mileage per calendar week (Monday–Sunday) or month. Empty periods show as 0 km because no run was recorded.">
              <ChartBox label={`Running distance per ${gran}`} height={240}>
                <BarChart data={m.volume}>
                  <CartesianGrid {...ax.grid} /><XAxis dataKey="label" {...ax.x} /><YAxis {...ax.y} unit=" km" />
                  <Tooltip {...ax.tip} formatter={(v) => [`${v} km`, "Distance"]} />
                  <Bar dataKey="km" fill={ax.p.green} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ChartBox>
              <Legend items={[{ color: ax.p.green, label: "Distance (measured)" }]} />
            </Card>

            <Card title="Pace and heart rate over time" info="Each point is one run. Pace axis is reversed so faster is higher. Pace falling while heart rate stays flat suggests improving fitness, but heat, route and fatigue also move both.">
              <ChartBox label="Average pace and average heart rate for each run" height={240}>
                <ComposedChart data={m.perRun}>
                  <CartesianGrid {...ax.grid} /><XAxis dataKey="label" {...ax.x} />
                  <YAxis yAxisId="p" reversed domain={["dataMin - 10", "dataMax + 10"]} tickFormatter={(v) => fmtPace(Number(v))} {...ax.y} width={48} />
                  <YAxis yAxisId="h" orientation="right" domain={["dataMin - 5", "dataMax + 5"]} {...ax.y} width={36} />
                  <Tooltip {...ax.tip} formatter={(v, n) => [n === "Pace" ? `${fmtPace(Number(v))} /km` : `${v} bpm`, String(n)]} />
                  <Line yAxisId="p" dataKey="pace" name="Pace" stroke={ax.p.blue} strokeWidth={2} dot={{ r: 3 }} />
                  <Line yAxisId="h" dataKey="hr" name="Avg HR" stroke={ax.p.red} strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 3" />
                </ComposedChart>
              </ChartBox>
              <Legend items={[{ color: ax.p.blue, label: "Pace (calculated)" }, { color: ax.p.red, label: "Avg HR (measured)", dashed: true }]} />
            </Card>

            <Card title="Pace vs heart rate" info="Runs further to the lower-right (faster at the same heart rate) indicate better efficiency. Compare runs of similar type; easy and long runs sit differently.">
              <ChartBox label="Scatter of average heart rate against average pace per run" height={240}>
                <ScatterChart>
                  <CartesianGrid {...ax.grid} vertical />
                  <XAxis type="number" dataKey="hr" name="Avg HR" unit=" bpm" domain={["dataMin - 3", "dataMax + 3"]} {...ax.x} />
                  <YAxis type="number" dataKey="pace" name="Pace" reversed domain={["dataMin - 10", "dataMax + 10"]} tickFormatter={(v) => fmtPace(Number(v))} {...ax.y} width={48} />
                  <ZAxis type="number" dataKey="km" range={[40, 140]} name="Distance" unit=" km" />
                  <Tooltip {...ax.tip} cursor={{ strokeDasharray: "3 3" }} formatter={(v, n) => [n === "Pace" ? `${fmtPace(Number(v))} /km` : String(v), String(n)]} />
                  <Scatter data={m.scatter} fill={ax.p.purple} fillOpacity={0.75} />
                </ScatterChart>
              </ChartBox>
              <Legend items={[{ color: ax.p.purple, label: "One run (bubble size = distance)" }]} />
            </Card>

            <Card title="Heart-rate zones" info={`Time in each zone, from heart-rate samples, as % of your max HR (${settings.hrMax} bpm; set in Settings). Zone boundaries are a common convention (60/70/80/90%), not individualised thresholds.`}>
              <ul className="space-y-2.5">
                {HR_ZONES.map((z, i) => {
                  const share = m.zTot ? (m.zones[i] / m.zTot) * 100 : 0;
                  return (
                    <li key={z.z} className="text-sm">
                      <div className="mb-1 flex justify-between text-xs"><span>{z.label} <span className="text-mute">({Math.round(z.lo * settings.hrMax)}{z.hi < 5 ? `–${Math.round(z.hi * settings.hrMax)}` : "+"} bpm)</span></span><span className="tnum text-mute">{fmtDuration(m.zones[i])} · {share.toFixed(0)}%</span></div>
                      <Progress value={share} label={z.label} tone={z.z >= 4 ? "warn" : "accent"} />
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>

          {m.vo2.length > 0 && (
            <div className="mt-4">
              <Card title="VO₂ max (watch estimate)" info="Apple Watch's estimate, recorded after suitable outdoor runs. It is not a laboratory measurement; it can lag and differs from other brands' numbers.">
                <ChartBox label="VO2 max readings over time" height={200}>
                  <LineChart data={m.vo2}>
                    <CartesianGrid {...ax.grid} /><XAxis dataKey="label" {...ax.x} /><YAxis {...ax.y} domain={["dataMin - 1", "dataMax + 1"]} />
                    <Tooltip {...ax.tip} formatter={(v) => [`${v} ml/kg/min`, "VO₂ max (estimated)"]} />
                    <Line dataKey="v" stroke={ax.p.green} strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ChartBox>
              </Card>
            </div>
          )}
        </>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Personal records (all time)" info="Best efforts are found by sliding a window over each run's 1 km splits, so they are accurate to about a second per km but not to the metre. Splits come from the GPS route recorded by the Watch and are calibrated to the distance Apple reports. Runs without a route (treadmill) cannot count.">
          <table className="w-full text-sm">
            <caption className="sr-only">Personal records</caption>
            <tbody className="tnum">
              {([["Best 5 km", prs.k5], ["Best 10 km", prs.k10], ["Best half-marathon", prs.half]] as const).map(([name, e]) => (
                <tr key={name} className="border-t border-line first:border-0">
                  <td className="py-2">{name}</td>
                  <td className="py-2 text-right font-medium">{e ? fmtDuration(e.sec) : "—"}</td>
                  <td className="py-2 text-right text-xs text-mute">{e ? <Link href={`/running/${e.run.id}`} className="underline-offset-2 hover:underline">{shortDate(e.run.date)} · {fmtPace(e.sec / e.distKm)} /km</Link> : name.includes("half") ? "No run ≥ 21.1 km yet" : "No qualifying run"}</td>
                </tr>
              ))}
              <tr className="border-t border-line"><td className="py-2">Fastest km</td><td className="py-2 text-right font-medium">{prs.fast ? fmtPace(prs.fast.sec) : "—"}</td><td className="py-2 text-right text-xs text-mute">{prs.fast && <Link href={`/running/${prs.fast.run.id}`} className="hover:underline">{shortDate(prs.fast.run.date)}</Link>}</td></tr>
              <tr className="border-t border-line"><td className="py-2">Longest run</td><td className="py-2 text-right font-medium">{prs.longest ? `${prs.longest.distanceKm.toFixed(1)} km` : "—"}</td><td className="py-2 text-right text-xs text-mute">{prs.longest && <Link href={`/running/${prs.longest.id}`} className="hover:underline">{shortDate(prs.longest.date)}</Link>}</td></tr>
            </tbody>
          </table>
        </Card>

        <Card title="Estimated race times" info="Riegel formula: T2 = T1 × (D2 ÷ D1)^1.06, from your best recent 5 km effort (last 90 days). A rough prediction that assumes equal fitness, conditions and endurance training. It is typically too optimistic for the half-marathon unless you run long regularly.">
          {pred ? (
            <>
              <table className="w-full text-sm"><tbody className="tnum">
                {pred.rows.map((r) => (<tr key={r.d} className="border-t border-line first:border-0"><td className="py-2">{raceLabel(r.d)}</td><td className="py-2 text-right font-medium">{fmtDuration(r.sec)}</td><td className="py-2 text-right text-xs text-mute">{fmtPace(r.sec / r.d)} /km</td></tr>))}
              </tbody></table>
              <p className="mt-2 text-xs text-mute">Estimate based on {raceLabel(pred.basis.distKm)} in {fmtDuration(pred.basis.sec)} on {longDate(pred.basis.run.date)}.</p>
            </>
          ) : <EmptyState title="No prediction yet" body="Needs a run of at least 3 km with split data in the last 90 days." />}
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Race-goal tracker" info="Create a target time. Progress is measured from your predicted time when the goal was created to the target; it is a prediction, not a result.">
          {raceGoals.length === 0 && <p className="mb-3 text-sm text-mute">No race goal yet. Set one below.</p>}
          <ul className="space-y-4">
            {raceGoals.map((g) => {
              const e = evaluateGoal(g, ds, settings, today);
              const hist = Array.from({ length: 12 }, (_, i) => { const d = addDays(today, -7 * (11 - i)); const p = predictRaceSec(ds.runs, d, g.raceKm ?? 5); return { label: shortDate(weekStart(d)), sec: p ? Math.round(p.sec) : undefined }; });
              return (
                <li key={g.id} className="rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{g.label}{g.deadline && <span className="text-xs font-normal text-mute"> · by {shortDate(g.deadline)}</span>}</p><StatusChip status={e.status} /></div>
                  <p className="mt-1 text-xs text-mute">Predicted now <b className="tnum text-ink">{e.currentText}</b> · target <b className="tnum text-ink">{e.targetText}</b> · {e.trendText}</p>
                  {e.progressPct !== null && <Progress className="mt-2" value={e.progressPct} label={`Progress toward ${g.label}`} />}
                  <ChartBox label={`Predicted ${raceLabel(g.raceKm ?? 5)} time by week against target`} height={150}>
                    <LineChart data={hist}>
                      <CartesianGrid {...ax.grid} /><XAxis dataKey="label" {...ax.x} /><YAxis {...ax.y} reversed domain={["dataMin - 20", "dataMax + 20"]} tickFormatter={(v) => fmtDuration(Number(v))} width={52} />
                      <Tooltip {...ax.tip} formatter={(v) => [fmtDuration(Number(v)), "Predicted"]} />
                      <ReferenceLine y={g.target} stroke={ax.p.gray} strokeDasharray="5 4" />
                      <Line dataKey="sec" stroke={ax.p.blue} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ChartBox>
                </li>
              );
            })}
          </ul>
          <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(ev) => { ev.preventDefault(); addRace(); }}>
            <Field label="Distance"><select className={inputCls} value={raceKm} onChange={(e) => setRaceKm(e.target.value)}><option value="5">5 km</option><option value="10">10 km</option><option value={String(HALF_KM)}>Half-marathon</option></select></Field>
            <Field label="Target time (mm:ss or h:mm:ss)" hint={raceErr || undefined}><input className={inputCls} value={raceTime} onChange={(e) => setRaceTime(e.target.value)} inputMode="numeric" aria-invalid={!!raceErr} /></Field>
            <button className={btnPrimary} type="submit">Add race goal</button>
          </form>
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Runs in range">
          {runs.length === 0 ? <p className="text-sm text-mute">No runs in this range.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead><tr className="text-left text-xs text-mute"><th className="py-1 font-medium">Date</th><th className="py-1 text-right font-medium">Distance</th><th className="py-1 text-right font-medium">Time</th><th className="py-1 text-right font-medium">Pace</th><th className="py-1 text-right font-medium">Avg HR</th><th className="py-1 text-right font-medium">Elev.</th></tr></thead>
                <tbody className="tnum">
                  {[...runs].reverse().slice(0, 30).map((r) => (
                    <tr key={r.id} className="border-t border-line hover:bg-surface2">
                      <td className="py-1.5"><Link href={`/running/${r.id}`} className="font-medium text-accent hover:underline">{longDate(r.date)}</Link></td>
                      <td className="py-1.5 text-right">{r.distanceKm.toFixed(2)} km</td><td className="py-1.5 text-right">{fmtDuration(r.durationSec)}</td>
                      <td className="py-1.5 text-right">{fmtPace(r.durationSec / r.distanceKm)}</td><td className="py-1.5 text-right">{r.avgHr ?? "—"}</td><td className="py-1.5 text-right">{r.elevGain === null ? "—" : `${r.elevGain} m`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
