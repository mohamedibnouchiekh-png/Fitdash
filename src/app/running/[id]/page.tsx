"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "@/lib/store";
import { longDate } from "@/lib/dates";
import { HR_ZONES, fmtDuration, fmtPace, timeInZones } from "@/lib/metrics";
import { Card, EmptyState, Kpi, PageHeader, Progress } from "@/components/ui";
import { ChartBox, Legend, useAxis } from "@/components/charts";

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const { ds, settings, isSample } = useApp();
  const ax = useAxis();
  const idx = ds.runs.findIndex((r) => r.id === id);
  const run = ds.runs[idx];
  const zones = useMemo(() => (run ? timeInZones([run], settings.hrMax) : []), [run, settings.hrMax]);

  if (!run) return (<><PageHeader title="Run not found" /><EmptyState title="This run is not in your data" body="It may belong to a source that is switched off, or the id is wrong." /><Link href="/running" className="mt-3 inline-flex items-center gap-1 text-sm text-accent"><ArrowLeft size={14} /> Back to Running</Link></>);

  const prev = ds.runs[idx - 1], next = ds.runs[idx + 1];
  const splits = run.splits.map((s) => ({ km: s.distKm < 1 ? `${s.km - 1 + s.distKm}` : `${s.km}`, pace: s.paceSec, hr: s.hr, elev: s.elevGain, partial: s.distKm < 1 }));
  const hrData = run.hrSeries.map((p) => ({ min: Math.round((p.t / 60) * 10) / 10, hr: p.hr }));
  const zTot = zones.reduce((a, b) => a + b, 0);
  const avgPace = run.durationSec / run.distanceKm;
  const first = run.splits.filter((s) => s.distKm === 1);
  const fastest = first.length ? Math.min(...first.map((s) => s.paceSec)) : null;
  const hasSplits = run.splits.length > 0;
  const hasHr = hrData.length > 0;
  const elevNote = run.elevSource === "apple" ? "From the Watch's barometric altimeter" : run.elevSource === "gps" ? "Derived from the GPS route (less precise than the altimeter)" : undefined;
  const half = Math.floor(first.length / 2);
  const split2 = first.length >= 4 ? (first.slice(half).reduce((a, s) => a + s.paceSec, 0) / (first.length - half)) - (first.slice(0, half).reduce((a, s) => a + s.paceSec, 0) / half) : null;

  return (
    <>
      <Link href="/running" className="mb-3 inline-flex items-center gap-1 text-sm text-mute hover:text-ink"><ArrowLeft size={14} aria-hidden /> Running</Link>
      <PageHeader title={`Run · ${longDate(run.date)}`} sub={`${run.startTime} · ${run.source}${run.indoor ? " · indoor" : ""}${isSample ? " (sample data)" : ""}`}
        right={<div className="flex gap-2">
          {prev ? <Link href={`/running/${prev.id}`} aria-label="Previous run" className="rounded-lg border border-line bg-surface p-2 hover:bg-surface2"><ChevronLeft size={16} /></Link> : <span className="rounded-lg border border-line p-2 opacity-40"><ChevronLeft size={16} /></span>}
          {next ? <Link href={`/running/${next.id}`} aria-label="Next run" className="rounded-lg border border-line bg-surface p-2 hover:bg-surface2"><ChevronRight size={16} /></Link> : <span className="rounded-lg border border-line p-2 opacity-40"><ChevronRight size={16} /></span>}
        </div>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Distance" prov="measured" value={run.distanceKm.toFixed(2)} unit="km" />
        <Kpi label="Duration" prov="measured" value={fmtDuration(run.durationSec)} />
        <Kpi label="Average pace" prov="calculated" value={fmtPace(avgPace)} unit="/km" sub={fastest === null ? undefined : `Fastest km ${fmtPace(fastest)}`} />
        <Kpi label="Heart rate" prov="measured" value={run.avgHr ?? "—"} unit={run.avgHr === null ? undefined : "bpm avg"} sub={run.maxHr === null ? "No heart-rate data for this run" : `Max ${run.maxHr} bpm`} />
        <Kpi label="Elevation gain" prov="measured" value={run.elevGain ?? "—"} unit={run.elevGain === null ? undefined : "m"} info={elevNote} sub={split2 === null ? undefined : split2 < -1 ? `Negative split (${Math.abs(split2).toFixed(0)} s/km faster in 2nd half)` : split2 > 1 ? `Slowed ${split2.toFixed(0)} s/km in 2nd half` : "Even pacing"} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Pace per kilometre" info="Pace of each full kilometre (the final partial kilometre is marked). Axis reversed: faster is higher.">
          {!hasSplits ? <EmptyState title="No per-km splits for this run" body={run.indoor ? "Indoor runs have no GPS route, so only the totals above are available." : "Apple Health did not include a GPS route for this run. Export the full zip from the Health app to get splits."} /> : <>
          <ChartBox label="Pace for each kilometre of the run" height={240}>
            <LineChart data={splits}>
              <CartesianGrid {...ax.grid} /><XAxis dataKey="km" {...ax.x} unit=" km" />
              <YAxis {...ax.y} reversed domain={["dataMin - 8", "dataMax + 8"]} tickFormatter={(v) => fmtPace(Number(v))} width={48} />
              <Tooltip {...ax.tip} formatter={(v) => [`${fmtPace(Number(v))} /km`, "Pace"]} />
              <ReferenceLine y={avgPace} stroke={ax.p.gray} strokeDasharray="5 4" />
              <Line dataKey="pace" stroke={ax.p.blue} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ChartBox>
          <Legend items={[{ color: ax.p.blue, label: "Pace per km (calculated)" }, { color: ax.p.gray, label: `Run average ${fmtPace(avgPace)}`, dashed: true }]} />
          </>}
        </Card>

        <Card title="Heart rate" info="Heart-rate samples recorded by the Watch during the workout, averaged into 15-second steps.">
          {!hasHr ? <EmptyState title="No heart-rate samples for this run" body="The Watch recorded no heart rate during this workout, or it was not exported." /> : <>
          <ChartBox label="Heart rate over the course of the run" height={240}>
            <LineChart data={hrData}>
              <CartesianGrid {...ax.grid} /><XAxis dataKey="min" {...ax.x} unit=" min" /><YAxis {...ax.y} domain={["dataMin - 5", "dataMax + 5"]} />
              <Tooltip {...ax.tip} formatter={(v) => [`${v} bpm`, "Heart rate"]} labelFormatter={(l) => `${l} min`} />
              <Line dataKey="hr" stroke={ax.p.red} strokeWidth={1.75} dot={false} />
            </LineChart>
          </ChartBox>
          <Legend items={[{ color: ax.p.red, label: "Heart rate (measured)" }]} />
          </>}
        </Card>

        <Card title="Elevation gain per kilometre" info="Taken from the GPS route's altitude, smoothed, so the total can differ a little from the Watch's altimeter figure above.">
          {!hasSplits ? <EmptyState title="No per-km data for this run" /> : <ChartBox label="Elevation gain for each kilometre" height={200}>
            <BarChart data={splits}>
              <CartesianGrid {...ax.grid} /><XAxis dataKey="km" {...ax.x} unit=" km" /><YAxis {...ax.y} unit=" m" />
              <Tooltip {...ax.tip} formatter={(v) => [`${v} m`, "Elevation gain"]} />
              <Bar dataKey="elev" fill={ax.p.sky} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartBox>}
        </Card>

        <Card title="Time in heart-rate zones" info={`Based on max HR ${settings.hrMax} bpm (Settings).`}>
          {zTot === 0 ? <EmptyState title="No heart-rate data, so no zones" /> : <ul className="space-y-2">
            {HR_ZONES.map((z, i) => (
              <li key={z.z} className="text-xs"><div className="mb-1 flex justify-between"><span>{z.label}</span><span className="tnum text-mute">{fmtDuration(zones[i])} · {zTot ? Math.round((zones[i] / zTot) * 100) : 0}%</span></div><Progress value={zTot ? (zones[i] / zTot) * 100 : 0} label={z.label} tone={z.z >= 4 ? "warn" : "accent"} /></li>
            ))}
          </ul>}
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Splits">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead><tr className="text-left text-xs text-mute"><th className="py-1 font-medium">Km</th><th className="py-1 text-right font-medium">Pace</th><th className="py-1 text-right font-medium">Avg HR</th><th className="py-1 text-right font-medium">Elev. gain</th></tr></thead>
              <tbody className="tnum">
                {run.splits.map((s) => (
                  <tr key={s.km} className="border-t border-line"><td className="py-1.5">{s.distKm < 1 ? `${(s.km - 1 + s.distKm).toFixed(2)} (partial)` : s.km}</td><td className="py-1.5 text-right">{fmtPace(s.paceSec)}</td><td className="py-1.5 text-right">{s.hr ?? "—"}</td><td className="py-1.5 text-right">{s.elevGain} m</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasSplits ? <p className="mt-2 text-xs text-mute">Splits are calculated from the Watch&apos;s GPS route and calibrated so they add up to the distance Apple reports. Time spent standing still is excluded. There is no route map in FitDash.</p> : <p className="mt-2 text-xs text-mute">No GPS route for this run, so there are no splits.</p>}
        </Card>
      </div>
    </>
  );
}
