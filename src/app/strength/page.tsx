"use client";
import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "@/lib/store";
import { addDays, DOW_LABELS, longDate, shortDate, weekStart } from "@/lib/dates";
import { strengthDates, countInWeek, epley1RM, lastCompletedWeeks, mean } from "@/lib/metrics";
import { COMMON_EXERCISES, muscleGroup, parseSets } from "@/lib/lifts";
import { EXERCISE_GROUPS } from "@/lib/sample";
import { btnPrimary, Card, EmptyState, Field, inputCls, Kpi, Notice, PageHeader } from "@/components/ui";
import { ChartBox, Legend, useAxis } from "@/components/charts";
import { PlanImportCard } from "@/components/PlanImportCard";

export default function Strength() {
  const { ds, settings, update, today, from, to } = useApp();
  const ax = useAxis();
  const planned = settings.schedule.strengthDays.length;
  const [date, setDate] = useState(today);
  const [exercise, setExercise] = useState("Back squat");
  const [setsText, setSetsText] = useState("8x60, 8x60, 7x60");
  const [err, setErr] = useState("");
  const [sel, setSel] = useState("Back squat");

  const sessions = useMemo(() => ds.strength.filter((s) => s.date >= from && s.date <= to), [ds.strength, from, to]);
  const ws = weekStart(today);
  const dates = useMemo(() => strengthDates(ds), [ds]);
  const doneDates = useMemo(() => new Set(dates), [dates]);

  const weeks12 = useMemo(() => Array.from({ length: 12 }, (_, i) => addDays(ws, -7 * (11 - i))), [ws]);
  const freq = weeks12.map((w) => ({ label: shortDate(w), n: countInWeek(dates, w), current: w === ws }));
  const firstWeek = dates.length ? weekStart([...dates].sort()[0]) : ws;
  const completed = freq.slice(0, 11).filter((f) => weeks12[freq.indexOf(f)] >= firstWeek); // weeks before you started are not misses
  const consistency = planned && completed.length ? (completed.filter((f) => f.n >= planned).length / completed.length) * 100 : null;
  const thisWeek = countInWeek(dates, ws);

  const lifts = ds.lifts;
  const exercises = useMemo(() => [...new Set(lifts.map((l) => l.exercise))].sort(), [lifts]);
  const cur = exercises.includes(sel) ? sel : (exercises[0] ?? sel);
  const progression = useMemo(() => {
    const rows = lifts.filter((l) => l.exercise === cur && l.sets.length > 0).sort((a, b) => a.date.localeCompare(b.date));
    return rows.map((l) => ({ label: shortDate(l.date), e1rm: Math.round(Math.max(...l.sets.map((s) => epley1RM(s.kg, s.reps))) * 10) / 10, top: Math.max(...l.sets.map((s) => s.kg)) }));
  }, [lifts, cur]);
  // One-rep-max estimates are unreliable at high reps, so high-rep exercises are tracked by their heaviest set instead.
  const metric: "e1rm" | "top" = useMemo(() => {
    const reps = lifts.filter((l) => l.exercise === cur).flatMap((l) => l.sets.map((s) => s.reps)).sort((a, b) => a - b);
    return (reps[reps.length >> 1] ?? 0) > 12 ? "top" : "e1rm";
  }, [lifts, cur]);

  const groups = useMemo(() => {
    const wk = lastCompletedWeeks(today, 4);
    const lo = wk[0], hi = addDays(wk[3], 6);
    const tot = new Map<string, number>();
    for (const l of lifts) if (l.date >= lo && l.date <= hi) { const g = EXERCISE_GROUPS[l.exercise] ?? muscleGroup(l.exercise); tot.set(g, (tot.get(g) ?? 0) + l.sets.length); }
    return [...tot.entries()].map(([g, n]) => ({ group: g, sets: Math.round((n / 4) * 10) / 10 })).sort((a, b) => b.sets - a.sets);
  }, [lifts, today]);

  const add = () => {
    const sets = parseSets(setsText);
    if (!sets) { setErr("Enter sets like 8x60, 8x60, 7x62.5 (reps × kg)."); return; }
    if (!exercise.trim()) { setErr("Choose or type an exercise."); return; }
    update({ lifts: [...settings.lifts, { id: `m-${Date.now()}`, date, exercise: exercise.trim(), sets }] });
    setErr("");
  };
  const del = (id: string) => update({ lifts: settings.lifts.filter((l) => l.id !== id) });

  // calendar: 12 weeks × 7 weekdays
  const cal = weeks12.map((w) => Array.from({ length: 7 }, (_, i) => {
    const d = addDays(w, i); const wd = (i + 1) % 7; // Mon=1…Sun=0
    const done = doneDates.has(d), plan = settings.schedule.strengthDays.includes(wd);
    const state = done ? "done" : d > today ? (plan ? "upcoming" : "none") : plan && d >= firstWeek ? "missed" : "none";
    return { d, state };
  }));

  if (ds.strength.length === 0 && lifts.length === 0) return (<><PageHeader title="Strength" /><EmptyState title="No strength data available" body="Apple Watch strength workouts and the manual exercise log are both switched off or empty. Check the Sources menu." /></>);

  // Missing heart-rate / energy values are skipped, never averaged in as zero.
  const avgOf = (v: (number | null)[]) => { const m = mean(v); return m === null ? "—" : Math.round(m); };
  const maxHrs = sessions.map((x) => x.maxHr).filter((v): v is number => v !== null);
  const maxHrSub = maxHrs.length ? `Max ${Math.max(...maxHrs)}` : undefined;

  return (
    <>
      <PageHeader title="Strength" sub="Workout-level data from Apple Watch; exercise-level data from your own log or a spreadsheet import." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="This week" prov="measured" value={thisWeek} unit={`/ ${planned} planned`} progress={planned ? (thisWeek / planned) * 100 : null} />
        <Kpi label="Sessions in range" prov="measured" value={sessions.length} sub={`${shortDate(from)} – ${shortDate(to)}`} />
        <Kpi label="Avg duration" prov="measured" value={sessions.length ? Math.round(mean(sessions.map((s) => s.durationMin)) as number) : "—"} unit="min" />
        <Kpi label="Avg active energy" prov="estimated" value={avgOf(sessions.map((s) => s.activeKcal))} unit="kcal" info="Active energy as estimated by Apple Watch. Strength training is one of the activities where wrist-based estimates are least reliable." />
        <Kpi label="Avg heart rate" prov="measured" value={avgOf(sessions.map((s) => s.avgHr))} unit="bpm" sub={maxHrSub} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Weekly frequency (12 weeks)" info={`Sessions per Monday–Sunday week against your plan of ${planned}. Consistency = completed weeks that reached the plan: ${consistency === null ? "—" : Math.round(consistency)}% (current week excluded).`}>
          <ChartBox label="Strength sessions per week against plan" height={220}>
            <BarChart data={freq}>
              <CartesianGrid {...ax.grid} /><XAxis dataKey="label" {...ax.x} /><YAxis {...ax.y} allowDecimals={false} domain={[0, Math.max(planned + 1, 4)]} />
              <Tooltip {...ax.tip} formatter={(v) => [String(v), "Sessions"]} />
              <ReferenceLine y={planned} stroke={ax.p.gray} strokeDasharray="5 4" />
              <Bar dataKey="n" fill={ax.p.purple} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartBox>
          <Legend items={[{ color: ax.p.purple, label: "Sessions (measured)" }, { color: ax.p.gray, label: `Plan: ${planned}`, dashed: true }]} />
          <p className="mt-2 text-sm">Consistency: <b>{consistency === null ? "—" : `${Math.round(consistency)}%`}</b> <span className="text-xs text-mute">of the {completed.length} completed week{completed.length === 1 ? "" : "s"} since you started reached the plan.</span></p>
        </Card>

        <Card title="Training calendar" info="Each column is a week (Mon at the top). Filled = strength workout recorded; outlined = planned day with no recorded workout; empty = rest day.">
          <div className="flex gap-1" role="img" aria-label="12-week strength training calendar showing completed, missed and upcoming planned sessions">
            <div className="mr-1 flex flex-col justify-between py-0.5 text-[10px] text-mute">{[1, 2, 3, 4, 5, 6, 0].map((d) => <span key={d} className="h-5 leading-5">{DOW_LABELS[d]}</span>)}</div>
            {cal.map((w, i) => (
              <div key={i} className="flex flex-col gap-1">
                {w.map((c) => (
                  <span key={c.d} title={`${longDate(c.d)}: ${c.state === "done" ? "workout recorded" : c.state === "missed" ? "planned, none recorded" : c.state === "upcoming" ? "planned" : "rest"}`}
                    className={`flex h-5 w-5 items-center justify-center rounded text-[10px] ${c.state === "done" ? "bg-accent text-white dark:text-black" : c.state === "missed" ? "border-2 border-warn text-warn" : c.state === "upcoming" ? "border border-dashed border-line text-mute" : "bg-surface2"}`}>
                    {c.state === "done" ? "✓" : c.state === "missed" ? "·" : ""}
                  </span>
                ))}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-mute">✓ recorded · orange outline = planned but not recorded · dashed = still to come</p>
        </Card>
      </div>

      <div className="mt-4">
        <Notice title="What Apple Watch can and cannot tell us">
          Apple Health stores a strength workout as a duration, heart rate and an energy estimate. It does <b>not</b> store exercises, sets, reps or weights, and it cannot say which muscles you trained. Everything below that comes from the <b>quick log</b> (about 20 seconds per exercise), or the spreadsheet import below.
        </Notice>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2"><PlanImportCard /></div>
        <Card title="Log an exercise (manual)" info="Type sets as reps × kilograms, separated by commas. Entries are saved in your local FitDash database.">
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <Field label="Date"><input type="date" max={today} className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Exercise"><input list="ex-list" className={inputCls} value={exercise} onChange={(e) => setExercise(e.target.value)} /><datalist id="ex-list">{[...new Set([...COMMON_EXERCISES, ...exercises])].map((x) => <option key={x} value={x} />)}</datalist></Field>
            <div className="sm:col-span-2"><Field label="Sets (reps x kg)" hint={err || "Example: 8x60, 8x60, 7x62.5"}><input className={inputCls} value={setsText} onChange={(e) => setSetsText(e.target.value)} aria-invalid={!!err} /></Field></div>
            <div><button type="submit" className={btnPrimary}>Add to log</button></div>
          </form>
          {settings.lifts.length > 0 && (
            <ul className="mt-4 divide-y divide-line border-t border-line text-sm">
              {[...settings.lifts].reverse().slice(0, 6).map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 py-2"><span><b className="font-medium">{l.exercise}</b> <span className="text-xs text-mute">{shortDate(l.date)} · {l.sets.map((s) => `${s.reps}×${s.kg}`).join(", ")}</span></span>
                  <button type="button" onClick={() => del(l.id)} aria-label={`Delete ${l.exercise} entry from ${shortDate(l.date)}`} className="rounded p-1 text-mute hover:text-bad"><Trash2 size={14} /></button></li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Strength progression" info="Best estimated one-rep max per session using the Epley formula: weight × (1 + reps ÷ 30). It is an estimate and gets less reliable above ~10 reps.">
          {exercises.length === 0 ? <EmptyState title="No exercise log yet" body="Add a few sessions with the form to see progression." /> : (
            <>
              <div className="mb-2 flex items-center gap-2"><select aria-label="Exercise" className={`${inputCls} max-w-[220px]`} value={cur} onChange={(e) => setSel(e.target.value)}>{exercises.map((x) => <option key={x}>{x}</option>)}</select></div>
              {progression.length < 3 ? <EmptyState title="Not enough sessions for a trend" body="At least 3 logged sessions of this exercise are needed." /> : (
                <>
                  <ChartBox label={`${metric === "e1rm" ? "Estimated one-rep max" : "Heaviest set"} for ${cur} over time`} height={210}>
                    <LineChart data={progression}>
                      <CartesianGrid {...ax.grid} /><XAxis dataKey="label" {...ax.x} /><YAxis {...ax.y} domain={[(lo: number) => Math.floor(lo - 3), (hi: number) => Math.ceil(hi + 3)]} tickCount={5} allowDecimals={false} tickFormatter={(v: number) => `${Math.round(v)} kg`} width={58} />
                      <Tooltip {...ax.tip} formatter={(v) => [`${v} kg`, metric === "e1rm" ? "Est. 1RM" : "Heaviest set"]} />
                      <Line dataKey={metric} name={metric} stroke={ax.p.purple} strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ChartBox>
                  <Legend items={[{ color: ax.p.purple, label: metric === "e1rm" ? "Estimated 1RM (calculated)" : "Heaviest set, kg (as logged)" }]} />
                  {metric === "top" && <p className="mt-1 text-xs text-mute">This exercise is done for more than 12 reps, where one-rep-max estimates are unreliable, so the chart shows your heaviest set instead.</p>}
                </>
              )}
            </>
          )}
        </Card>

        <Card title="Weekly sets by muscle group" info="Average sets per week over the last 4 completed weeks, from the manual log. Groups come from a fixed exercise → muscle-group map; unknown exercises fall under 'Other'.">
          {groups.length === 0 ? <EmptyState title="No logged sets in the last 4 weeks" /> : (
            <>
              <ChartBox label="Average weekly sets per muscle group" height={220}>
                <BarChart data={groups} layout="vertical">
                  <CartesianGrid {...ax.grid} horizontal={false} vertical /><XAxis type="number" {...ax.x} /><YAxis type="category" dataKey="group" {...ax.y} width={70} />
                  <Tooltip {...ax.tip} formatter={(v) => [`${v} sets/week`, "Volume"]} />
                  <Bar dataKey="sets" fill={ax.p.orange} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ChartBox>
              <p className="mt-1 text-xs text-mute">Counts every logged set, regardless of load. Sets are a volume measure, not a measure of quality or effort.</p>
            </>
          )}
        </Card>

        <Card title="Recent Apple Watch workouts">
          {sessions.length === 0 ? <p className="text-sm text-mute">No strength workouts in this range.</p> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[380px] text-sm"><thead><tr className="text-left text-xs text-mute"><th className="py-1 font-medium">Date</th><th className="py-1 text-right font-medium">Duration</th><th className="py-1 text-right font-medium">Active kcal</th><th className="py-1 text-right font-medium">Avg / max HR</th></tr></thead>
              <tbody className="tnum">{[...sessions].reverse().slice(0, 8).map((s) => (<tr key={s.id} className="border-t border-line"><td className="py-1.5">{longDate(s.date)}</td><td className="py-1.5 text-right">{s.durationMin} min</td><td className="py-1.5 text-right">{s.activeKcal ?? "—"}</td><td className="py-1.5 text-right">{s.avgHr ?? "—"} / {s.maxHr ?? "—"}</td></tr>))}</tbody></table></div>
          )}
        </Card>
      </div>
    </>
  );
}
