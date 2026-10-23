"use client";
import Link from "next/link";
import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, Tooltip, XAxis, YAxis, BarChart } from "recharts";
import { ArrowRight, Check, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { useApp } from "@/lib/store";
import { addDays, shortDate, weekStart } from "@/lib/dates";
import { strengthDates, aggregatePace, countInWeek, energyBalance, estimatedExpenditure, fmtPace, mean, present, weeklyDistance, baselineAt, zScore } from "@/lib/metrics";
import { evaluateGoal } from "@/lib/goals";
import { computeInsights, trendSummary } from "@/lib/insights";
import { Card, Kpi, PageHeader, Progress, StatusChip, EmptyState } from "@/components/ui";
import { ChartBox, Legend, useAxis } from "@/components/charts";

const dir = (d: number, eps = 0): "up" | "down" | "flat" => (d > eps ? "up" : d < -eps ? "down" : "flat");

export default function Overview() {
  const { ds, settings, today, isSample } = useApp();
  const ax = useAxis();
  const t = settings.targets;
  const ws = weekStart(today);
  const prevWs = addDays(ws, -7);

  const m = useMemo(() => {
    const day = ds.days.find((d) => d.date === today);
    const yest = ds.days.find((d) => d.date === addDays(today, -1));
    const runsWeek = ds.runs.filter((r) => r.date >= ws);
    const km = weeklyDistance(ds.runs, ws);
    // like-for-like comparison: same elapsed days of the previous week
    const elapsed = (new Date(today).getUTCDay() + 6) % 7;
    const kmPrevSame = ds.runs.filter((r) => r.date >= prevWs && r.date <= addDays(prevWs, elapsed)).reduce((a, r) => a + r.distanceKm, 0);
    const runsDone = countInWeek(ds.runs.map((r) => r.date), ws);
    const strDone = countInWeek(strengthDates(ds), ws);
    const vo2 = ds.days.filter((d) => d.vo2max !== undefined);
    const vo2Now = mean(vo2.slice(-3).map((d) => d.vo2max));
    const vo2Then = mean(vo2.filter((d) => d.date <= addDays(today, -30)).slice(-3).map((d) => d.vo2max));
    const seven = ds.days.filter((d) => d.date > addDays(today, -7));
    const rhrArr = ds.days.map((d) => d.restingHr), hrvArr = ds.days.map((d) => d.hrv);
    const n = ds.days.length;
    const rhr7 = mean(seven.map((d) => d.restingHr)), hrv7 = mean(seven.map((d) => d.hrv));
    const bRhr = baselineAt(rhrArr, n - 1), bHrv = baselineAt(hrvArr, n - 1);
    const sleep7 = mean(seven.map((d) => d.sleepMin));
    const sleepPrev = mean(ds.days.filter((d) => d.date > addDays(today, -35) && d.date <= addDays(today, -7)).map((d) => d.sleepMin));
    const w7 = mean(ds.weights.filter((w) => w.date > addDays(today, -7)).map((w) => w.kg));
    const w28 = mean(ds.weights.filter((w) => w.date > addDays(today, -35) && w.date <= addDays(today, -21)).map((w) => w.kg));
    const chart = Array.from({ length: 14 }, (_, i) => {
      const date = addDays(today, -13 + i); const d = ds.days.find((x) => x.date === date);
      const complete = d && d.date < today && d.kcalIn !== undefined && d.kcalIn >= 800;
      return { label: shortDate(date), kcal: complete ? d!.kcalIn : undefined, exp: d ? estimatedExpenditure(d) ?? undefined : undefined };
    });
    const weeks = Array.from({ length: 8 }, (_, i) => { const w = addDays(ws, -7 * (7 - i)); return { label: shortDate(w), km: Math.round(weeklyDistance(ds.runs, w) * 10) / 10, current: i === 7 }; });
    return { day, yest, runsWeek, km, kmPrevSame, runsDone, strDone, vo2Now, vo2Then, rhr7, hrv7, bRhr, bHrv, sleep7, sleepPrev, w7, w28, chart, weeks, pace: aggregatePace(runsWeek) };
  }, [ds, today, ws, prevWs]);

  const goals = useMemo(() => settings.goals.map((g) => ({ g, e: evaluateGoal(g, ds, settings, today) })), [settings, ds, today]);
  const { insights } = useMemo(() => computeInsights(ds, settings, today), [ds, settings, today]);
  const trends = useMemo(() => trendSummary(ds, settings, today), [ds, settings, today]);

  const plannedRuns = settings.schedule.runDays.length, plannedStr = settings.schedule.strengthDays.length;
  const yBal = m.yest ? energyBalance(m.yest, today) : null;
  const dev = (v: number | null, b: ReturnType<typeof baselineAt>, badWhen: 1 | -1) => {
    if (v === null) return "No data";
    if (!b) return "Baseline building";
    const z = zScore(v, b);
    if (z === null) return "Within usual range";
    return z * badWhen > 1.5 ? "Outside usual range" : "Within usual range";
  };
  const rhrFlag = dev(m.rhr7 === null ? null : (present(ds.days.slice(-7).map((d) => d.restingHr)).at(-1) ?? null), m.bRhr, 1); // latest reading in the last 7 days

  const onTrack = goals.filter((x) => ["on_track", "achieved"].includes(x.e.status)).length;
  const evaluable = goals.filter((x) => x.e.status !== "unknown").length;
  const needsFocus = goals.find((x) => x.e.status === "off_track") ?? goals.find((x) => x.e.status === "at_risk");
  const attention = insights.find((i) => i.severity === "attention");

  return (
    <>
      <PageHeader title="Overview" sub={isSample ? "Where you stand today and this week. Sample data." : "Where you stand today and this week."} />

      <h2 className="sr-only">Today</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Calories today" prov="reported" value={m.day?.kcalIn ?? "—"} unit={m.day?.kcalIn !== undefined ? `/ ${t.kcal} kcal` : undefined}
          progress={m.day?.kcalIn !== undefined ? (m.day.kcalIn / t.kcal) * 100 : null}
          sub={m.day?.kcalIn !== undefined ? `Today is in progress · ${m.day.mealsLogged ?? "?"} meals logged` : "Nothing logged yet"}
          info="Food-log calories from MyFitnessPal, via Apple Health. Today is incomplete until you finish logging." />
        <Kpi label="Protein today" prov="reported" value={m.day?.protein ?? "—"} unit={m.day?.protein !== undefined ? `/ ${t.protein} g` : undefined} progress={m.day?.protein !== undefined ? (m.day.protein / t.protein) * 100 : null}
          sub={m.day?.carbs !== undefined ? `C ${m.day.carbs} g · F ${m.day.fat} g` : undefined} />
        <Kpi label="Est. calories burned" prov="estimated" value={m.day && estimatedExpenditure(m.day) ? Math.round(estimatedExpenditure(m.day) as number) : "—"} unit="kcal"
          sub="Apple Watch resting + active energy" info="An estimate. Resting (basal) energy plus active energy as computed by Apple Watch. Real expenditure differs, often by 10–20%." />
        <Kpi label="Estimated balance (yesterday)" prov="estimated" value={yBal === null ? "—" : `${yBal > 0 ? "+" : ""}${Math.round(yBal)}`} unit={yBal === null ? undefined : "kcal"}
          sub={yBal === null ? "Needs a complete food log and watch energy data" : yBal < 0 ? "Estimated deficit" : "Estimated surplus"}
          info="Logged intake minus estimated expenditure. Both sides are estimates, so use the multi-week trend, not a single day." />
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold text-mute">This week (Mon–Sun)</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Running distance" prov="measured" value={m.km.toFixed(1)} unit="km"
          delta={m.runsWeek.length || m.kmPrevSame ? { text: `${m.km - m.kmPrevSame >= 0 ? "+" : "−"}${Math.abs(m.km - m.kmPrevSame).toFixed(1)} km vs same point last week`, dir: dir(m.km - m.kmPrevSame, 0.05) } : null} deltaGood={null} />
        <Kpi label="Runs" prov="measured" value={`${m.runsDone}`} unit={`/ ${plannedRuns} planned`} progress={plannedRuns ? (m.runsDone / plannedRuns) * 100 : null} sub="Counted once even if also on Strava" />
        <Kpi label="Strength sessions" prov="measured" value={`${m.strDone}`} unit={`/ ${plannedStr} planned`} progress={plannedStr ? (m.strDone / plannedStr) * 100 : null} />
        <Kpi label="Average pace" prov="calculated" value={fmtPace(m.pace)} unit="/km" sub={m.runsWeek.length ? `${m.runsWeek.length} run${m.runsWeek.length > 1 ? "s" : ""}, distance-weighted` : "No runs yet this week"}
          info="Total running time divided by total distance (not the average of each run's pace)." />
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold text-mute">Fitness &amp; recovery</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="VO₂ max" prov="estimated" value={m.vo2Now?.toFixed(1) ?? "—"} unit="ml/kg/min"
          delta={m.vo2Now !== null && m.vo2Then !== null ? { text: `${m.vo2Now - m.vo2Then >= 0 ? "+" : "−"}${Math.abs(m.vo2Now - m.vo2Then).toFixed(1)} vs 30 d ago`, dir: dir(m.vo2Now - m.vo2Then, 0.05) } : null} deltaGood={m.vo2Now !== null && m.vo2Then !== null ? m.vo2Now - m.vo2Then > 0.05 : null}
          info="Apple Watch estimate from outdoor runs. It is not a laboratory measurement and the watch records it only occasionally." />
        <Kpi label="Resting HR (7 d)" prov="measured" value={m.rhr7?.toFixed(1) ?? "—"} unit="bpm" sub={rhrFlag}
          info="Average over 7 days compared with your own previous 28 days. Needs 14+ days of data for a baseline." />
        <Kpi label="HRV (7 d)" prov="measured" value={m.hrv7 === null ? "—" : Math.round(m.hrv7)} unit="ms" sub={dev(m.hrv7, m.bHrv, -1)} info="Heart-rate variability (SDNN) from Apple Watch. Individual and noisy; look at your own trend." />
        <Kpi label="Sleep (7 d avg)" prov="estimated" value={m.sleep7 === null ? "—" : (m.sleep7 / 60).toFixed(1)} unit="h"
          delta={m.sleep7 !== null && m.sleepPrev !== null ? { text: `${m.sleep7 - m.sleepPrev >= 0 ? "+" : "−"}${Math.abs(m.sleep7 - m.sleepPrev).toFixed(0)} min vs prior 4 wk`, dir: dir(m.sleep7 - m.sleepPrev, 5) } : null} deltaGood={m.sleep7 !== null && m.sleepPrev !== null ? (m.sleep7 - m.sleepPrev > 5 ? true : m.sleep7 - m.sleepPrev < -5 ? false : null) : null} />
        <Kpi label="Weight (7 d avg)" prov="reported" value={m.w7?.toFixed(1) ?? "—"} unit="kg"
          delta={m.w7 !== null && m.w28 !== null ? { text: `${m.w7 - m.w28 >= 0 ? "+" : "−"}${Math.abs(m.w7 - m.w28).toFixed(1)} kg vs 4 wk ago`, dir: dir(m.w7 - m.w28, 0.05) } : null} deltaGood={null}
          sub={m.w7 === null ? "Add an entry under Recovery" : "Manual entries"} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Calories vs estimated expenditure (14 days)" info="Bars: logged intake on complete days. Line: Apple Watch resting + active energy (estimate). Days with no log or an incomplete log are left blank rather than shown as zero.">
          {m.chart.some((c) => c.kcal !== undefined) ? (
            <>
              <ChartBox label="Daily calorie intake compared with estimated expenditure and target over 14 days" height={230}>
                <ComposedChart data={m.chart}>
                  <CartesianGrid {...ax.grid} />
                  <XAxis dataKey="label" {...ax.x} />
                  <YAxis {...ax.y} domain={[0, "auto"]} />
                  <Tooltip {...ax.tip} />
                  <ReferenceLine y={t.kcal} stroke={ax.p.gray} strokeDasharray="5 4" />
                  <Bar dataKey="kcal" name="Intake (kcal)" fill={ax.p.blue} radius={[3, 3, 0, 0]} />
                  <Line dataKey="exp" name="Est. expenditure (kcal)" stroke={ax.p.orange} strokeWidth={2} dot={false} connectNulls={false} />
                </ComposedChart>
              </ChartBox>
              <Legend items={[{ color: ax.p.blue, label: "Intake (reported)" }, { color: ax.p.orange, label: "Est. expenditure (estimated)" }, { color: ax.p.gray, label: `Target ${t.kcal} kcal`, dashed: true }]} />
            </>
          ) : <EmptyState title="No complete food logs in this window" body="Turn MyFitnessPal → Apple Health sync on, then import a Health export." />}
        </Card>

        <Card title="Weekly running distance" info="Calendar weeks (Monday–Sunday). The last bar is the current week and is still in progress.">
          {m.weeks.some((w) => w.km > 0) ? (
            <>
              <ChartBox label="Running distance per week for the last 8 weeks" height={230}>
                <BarChart data={m.weeks}>
                  <CartesianGrid {...ax.grid} />
                  <XAxis dataKey="label" {...ax.x} />
                  <YAxis {...ax.y} unit=" km" />
                  <Tooltip {...ax.tip} formatter={(v) => [`${v} km`, "Distance"]} />
                  <Bar dataKey="km" fill={ax.p.green} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ChartBox>
              <Legend items={[{ color: ax.p.green, label: "Distance (measured). Last bar is this week so far." }]} />
            </>
          ) : <EmptyState title="No runs recorded" />}
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Three questions" info="A quick read-out built from the rules on the Goals and Insights pages. Nothing here is a medical assessment.">
          <div className="grid gap-5 md:grid-cols-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-mute">1 · Am I progressing?</h3>
              <p className="mt-1.5 text-sm">{evaluable === 0 ? "Not enough data to judge goals yet." : <><b>{onTrack}</b> of {evaluable} evaluable goals are on track or achieved.</>}</p>
              <ul className="mt-2 space-y-1.5">
                {goals.slice(0, 4).map(({ g, e }) => (
                  <li key={g.id} className="text-xs">
                    <div className="mb-1 flex items-center justify-between gap-2"><span className="truncate">{g.label}</span><StatusChip status={e.status} /></div>
                    {e.progressPct !== null && <Progress value={e.progressPct} label={g.label} />}
                  </li>
                ))}
              </ul>
              <Link href="/goals" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent">All goals <ArrowRight size={12} aria-hidden /></Link>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-mute">2 · What is changing?</h3>
              <p className="mt-1.5 text-xs text-mute">Last 4 weeks vs the 4 weeks before</p>
              <ul className="mt-2 space-y-1.5">
                {trends.rows.map((r) => {
                  const Icon = r.verdict === "improving" ? TrendingUp : r.verdict === "declining" ? TrendingDown : Minus;
                  const good = r.neutral ? null : r.verdict === "improving" ? true : r.verdict === "declining" ? false : null;
                  return (
                    <li key={r.id} className="flex items-start justify-between gap-2 text-xs">
                      <span>{r.label}</span>
                      <span className={`inline-flex items-center gap-1 text-right font-medium ${good === true ? "text-good" : good === false ? "text-bad" : "text-mute"}`}><Icon size={13} aria-hidden />{r.neutral && r.verdict !== "stable" ? (r.verdict === "improving" ? "up" : "down") : r.verdict}</span>
                    </li>
                  );
                })}
              </ul>
              {trends.skipped.length > 0 && <p className="mt-2 text-xs text-mute">Not enough data: {trends.skipped.join(", ")}.</p>}
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-mute">3 · What should I focus on?</h3>
              {needsFocus ? (
                <div className="mt-1.5 text-sm"><p className="font-medium">{needsFocus.g.label}</p><p className="mt-1 text-xs text-mute">{needsFocus.e.nextAction}</p></div>
              ) : attention ? (
                <div className="mt-1.5 text-sm"><p className="font-medium">{attention.title}</p><p className="mt-1 text-xs text-mute">{attention.body}</p></div>
              ) : (
                <p className="mt-1.5 flex items-start gap-1.5 text-sm"><Check size={16} className="mt-0.5 text-good" aria-hidden />Nothing needs attention. Keep your current routine.</p>
              )}
              <Link href="/insights" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent">All insights <ArrowRight size={12} aria-hidden /></Link>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
