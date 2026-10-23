"use client";
import { useMemo, useState } from "react";
import { Pencil, Trash2, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { useApp } from "@/lib/store";
import { addDays, shortDate, diffDays } from "@/lib/dates";
import { evaluateGoal, raceLabel } from "@/lib/goals";
import { HALF_KM, fmtDuration, parseDuration, predictRaceSec } from "@/lib/metrics";
import type { Goal, GoalType } from "@/lib/types";
import { btnCls, btnPrimary, Card, Field, inputCls, PageHeader, Progress, StatusChip } from "@/components/ui";

const TYPES: { key: GoalType; label: string; unit: string; hint: string; def: string }[] = [
  { key: "race", label: "Race time", unit: "mm:ss or h:mm:ss", hint: "Target time for the chosen distance", def: "27:30" },
  { key: "weeklyKm", label: "Weekly running distance", unit: "km per week", hint: "Average of the last 4 completed weeks", def: "20" },
  { key: "strengthPerWeek", label: "Strength sessions per week", unit: "sessions", hint: "Average of the last 4 completed weeks", def: "3" },
  { key: "protein", label: "Protein target adherence", unit: "% of days", hint: "Share of logged days meeting your protein target", def: "80" },
  { key: "deficit", label: "Calorie deficit", unit: "kcal per day", hint: "Average estimated daily deficit", def: "400" },
  { key: "vo2", label: "VO₂ max", unit: "ml/kg/min", hint: "Apple Watch estimate", def: "48" },
  { key: "sleep", label: "Average sleep", unit: "hours", hint: "Average of the last 14 nights", def: "7.5" },
  { key: "weight", label: "Body weight", unit: "kg", hint: "7-day average of manual entries", def: "78" },
];

function labelFor(type: GoalType, target: number, raceKm?: number): string {
  switch (type) {
    case "race": return `${raceLabel(raceKm ?? 5)} in ${fmtDuration(target)}`;
    case "weeklyKm": return `Average ${target} km per week`;
    case "strengthPerWeek": return `${target} strength sessions per week`;
    case "protein": return `Hit protein on ${target}% of days`;
    case "deficit": return `Stay near a ${target} kcal/day deficit`;
    case "vo2": return `VO₂ max ${target}`;
    case "sleep": return `Sleep ${target} h on average`;
    case "weight": return `Reach ${target} kg`;
  }
}

function parseTarget(type: GoalType, raw: string): number | null {
  if (type === "race") { const s = parseDuration(raw); return s && s >= 60 ? s : null; }
  const v = Number(raw.replace(",", "."));
  if (!Number.isFinite(v) || v <= 0) return null;
  const max: Record<string, number> = { weeklyKm: 300, strengthPerWeek: 14, protein: 100, deficit: 2000, vo2: 90, sleep: 14, weight: 250 };
  return v <= (max[type] ?? 1e6) ? v : null;
}

export default function Goals() {
  const { ds, settings, update, today } = useApp();
  const [type, setType] = useState<GoalType>("race");
  const [raceKm, setRaceKm] = useState("5");
  const [target, setTarget] = useState("27:30");
  const [deadline, setDeadline] = useState("");
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [editDl, setEditDl] = useState("");

  const evals = useMemo(() => settings.goals.map((g) => ({ g, e: evaluateGoal(g, ds, settings, today) })), [settings, ds, today]);
  const tcfg = TYPES.find((t) => t.key === type)!;

  const add = () => {
    const v = parseTarget(type, target);
    if (v === null) { setErr(`Enter a valid target (${tcfg.unit}).`); return; }
    if (deadline && deadline <= today) { setErr("The deadline must be in the future."); return; }
    const km = Number(raceKm);
    const g: Goal = { id: `g-${Date.now()}`, type, label: labelFor(type, v, km), target: v, deadline: deadline || undefined, raceKm: type === "race" ? km : undefined };
    if (type === "race") g.baseline = predictRaceSec(ds.runs, today, km)?.sec;
    update({ goals: [...settings.goals, g] }); setErr(""); setDeadline("");
  };
  const saveEdit = (g: Goal) => {
    const v = parseTarget(g.type, editVal);
    if (v === null) return;
    update({ goals: settings.goals.map((x) => (x.id === g.id ? { ...x, target: v, label: labelFor(x.type, v, x.raceKm), deadline: editDl || undefined, example: false } : x)) });
    setEditing(null);
  };

  return (
    <>
      <PageHeader title="Goals &amp; progress" sub="Edit targets any time. Percentages appear only where a straight line from start to target makes sense." />
      {settings.goals.some((g) => g.example) && <p className="mb-4 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-mute">The goals marked <b>example</b> are placeholders so you can see the layout. Change their targets or delete them.</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {evals.map(({ g, e }) => {
          const TrendIcon = e.trendDir === "up" ? TrendingUp : e.trendDir === "down" ? TrendingDown : Minus;
          const tone = e.trendGood === true ? "text-good" : e.trendGood === false ? "text-bad" : "text-mute";
          const dl = g.deadline ? diffDays(g.deadline, today) : null;
          return (
            <Card key={g.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <div><h2 className="text-sm font-semibold">{g.label} {g.example && <span className="ml-1 rounded border border-line px-1 text-[10px] font-medium uppercase text-mute">example</span>}</h2>
                  <p className="text-xs text-mute">{g.deadline ? `Deadline ${shortDate(g.deadline)} (${dl! >= 0 ? `${dl} days left` : "passed"})` : "No deadline"}</p></div>
                <StatusChip status={e.status} />
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div><dt className="text-xs text-mute">Current</dt><dd className="tnum font-semibold">{e.currentText}</dd></div>
                <div><dt className="text-xs text-mute">Target</dt><dd className="tnum font-semibold">{e.targetText}</dd></div>
                <div><dt className="text-xs text-mute">Progress</dt><dd className="tnum font-semibold">{e.progressPct === null ? "n/a" : `${Math.round(e.progressPct)}%`}</dd></div>
              </dl>
              {e.progressPct !== null && <Progress className="mt-2" value={e.progressPct} label={`Progress toward ${g.label}`} tone={e.status === "off_track" ? "bad" : e.status === "at_risk" ? "warn" : "good"} />}
              {e.progressNote && <p className="mt-1 text-xs text-mute">{e.progressNote}</p>}
              <p className={`mt-2 inline-flex items-center gap-1 text-xs font-medium ${tone}`}><TrendIcon size={13} aria-hidden />{e.trendText}</p>
              <p className="mt-2 text-sm"><span className="text-xs font-semibold uppercase tracking-wide text-mute">Next action · </span>{e.nextAction}</p>
              <details className="mt-2 text-xs text-mute"><summary className="cursor-pointer">How this is calculated</summary><p className="mt-1">{e.definition}</p></details>
              <div className="mt-3 flex gap-2 border-t border-line pt-3">
                {editing === g.id ? (
                  <form className="flex flex-wrap items-end gap-2" onSubmit={(ev) => { ev.preventDefault(); saveEdit(g); }}>
                    <Field label="Target"><input className={`${inputCls} w-28`} value={editVal} onChange={(ev) => setEditVal(ev.target.value)} /></Field>
                    <Field label="Deadline"><input type="date" className={inputCls} value={editDl} onChange={(ev) => setEditDl(ev.target.value)} /></Field>
                    <button type="submit" className={btnPrimary}>Save</button><button type="button" className={btnCls} onClick={() => setEditing(null)}>Cancel</button>
                  </form>
                ) : (
                  <>
                    <button type="button" className={btnCls} onClick={() => { setEditing(g.id); setEditVal(g.type === "race" ? fmtDuration(g.target) : String(g.target)); setEditDl(g.deadline ?? ""); }}><Pencil size={14} aria-hidden /> Edit</button>
                    <button type="button" className={btnCls} onClick={() => update({ goals: settings.goals.filter((x) => x.id !== g.id) })}><Trash2 size={14} aria-hidden /> Delete</button>
                  </>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <div className="mt-6">
        <Card title="Add a goal">
          <form className="flex flex-wrap items-end gap-3" onSubmit={(ev) => { ev.preventDefault(); add(); }}>
            <Field label="Goal type"><select className={inputCls} value={type} onChange={(e) => { const k = e.target.value as GoalType; setType(k); setTarget(TYPES.find((t) => t.key === k)!.def); setErr(""); }}>{TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></Field>
            {type === "race" && <Field label="Distance"><select className={inputCls} value={raceKm} onChange={(e) => setRaceKm(e.target.value)}><option value="5">5 km</option><option value="10">10 km</option><option value={String(HALF_KM)}>Half-marathon</option></select></Field>}
            <Field label={`Target (${tcfg.unit})`} hint={err || tcfg.hint}><input className={`${inputCls} w-36`} value={target} onChange={(e) => setTarget(e.target.value)} aria-invalid={!!err} /></Field>
            <Field label="Deadline (optional)"><input type="date" min={addDays(today, 1)} className={inputCls} value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
            <button type="submit" className={btnPrimary}>Add goal</button>
          </form>
        </Card>
      </div>
    </>
  );
}
