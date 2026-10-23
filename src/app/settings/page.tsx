"use client";
import { useState } from "react";
import { Download, RotateCcw } from "lucide-react";
import { useApp } from "@/lib/store";
import { DOW_LABELS } from "@/lib/dates";
import { btnCls, Card, Field, inputCls, PageHeader } from "@/components/ui";
import { ImportCard } from "@/components/ImportCard";
import Link from "next/link";

function NumField({ label, value, min, max, step = 1, suffix, onCommit, hint }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onCommit: (v: number) => void; hint?: string }) {
  const [txt, setTxt] = useState(String(value));
  const [err, setErr] = useState("");
  const commit = (s: string) => {
    const v = Number(s.replace(",", "."));
    if (!Number.isFinite(v) || v < min || v > max) { setErr(`Enter a number between ${min} and ${max}.`); return; }
    setErr(""); onCommit(v);
  };
  return (
    <Field label={`${label}${suffix ? ` (${suffix})` : ""}`} hint={err || hint}>
      <input className={inputCls} inputMode="decimal" step={step} value={txt} aria-invalid={!!err} onChange={(e) => { setTxt(e.target.value); commit(e.target.value); }} onBlur={() => { if (err) { setTxt(String(value)); setErr(""); } }} />
    </Field>
  );
}

export default function Settings() {
  const { settings, update, reset } = useApp();
  const t = settings.targets;
  const setT = (patch: Partial<typeof t>) => update({ targets: { ...t, ...patch } });
  const toggleDay = (kind: "strengthDays" | "runDays", d: number) => {
    const cur = settings.schedule[kind];
    update({ schedule: { ...settings.schedule, [kind]: cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort() } });
  };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "fitdash-settings.json"; a.click(); URL.revokeObjectURL(a.href);
  };
  const order = [1, 2, 3, 4, 5, 6, 0];
  const proteinPct = Math.round(((t.protein * 4) / Math.max(1, t.protein * 4 + t.carbs * 4 + t.fat * 9)) * 100);
  const macroKcal = t.protein * 4 + t.carbs * 4 + t.fat * 9;

  return (
    <>
      <PageHeader title="Settings" sub="Targets and schedule are yours to change at any time. They apply immediately across the dashboard." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Daily targets">
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Calories" suffix="kcal" value={t.kcal} min={800} max={6000} step={50} onCommit={(v) => setT({ kcal: v })} />
            <NumField label="Protein" suffix="g" value={t.protein} min={20} max={400} onCommit={(v) => setT({ protein: v })} />
            <NumField label="Carbohydrates" suffix="g" value={t.carbs} min={0} max={800} onCommit={(v) => setT({ carbs: v })} />
            <NumField label="Fat" suffix="g" value={t.fat} min={10} max={300} onCommit={(v) => setT({ fat: v })} />
            <NumField label="Calorie tolerance" suffix="± %" value={t.kcalTolerancePct} min={1} max={50} onCommit={(v) => setT({ kcalTolerancePct: v })} hint="A day “meets” the calorie target within this band." />
            <NumField label="Protein counts as met at" suffix="% of target" value={t.proteinMetPct} min={50} max={100} onCommit={(v) => setT({ proteinMetPct: v })} />
          </div>
          <p className="mt-3 text-xs text-mute">Your macro targets add up to {macroKcal} kcal ({proteinPct}% from protein) versus a {t.kcal} kcal target{Math.abs(macroKcal - t.kcal) > 150 ? ". These differ by more than 150 kcal, so check them." : "."}</p>
        </Card>

        <Card title="Training schedule" info="Used for planned-versus-completed counts and the consistency metrics.">
          {(["runDays", "strengthDays"] as const).map((k) => (
            <fieldset key={k} className="mb-4">
              <legend className="mb-1.5 text-xs font-medium text-mute">{k === "runDays" ? "Running days" : "Strength days"} · {settings.schedule[k].length} per week</legend>
              <div className="flex flex-wrap gap-1.5">
                {order.map((d) => (
                  <button key={d} type="button" aria-pressed={settings.schedule[k].includes(d)} onClick={() => toggleDay(k, d)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${settings.schedule[k].includes(d) ? "border-accent bg-accent text-white dark:text-black" : "border-line bg-surface text-mute hover:bg-surface2"}`}>{DOW_LABELS[d]}</button>
                ))}
              </div>
            </fieldset>
          ))}
          <NumField label="Max heart rate" suffix="bpm" value={settings.hrMax} min={120} max={230} onCommit={(v) => update({ hrMax: v })} hint="Used for heart-rate zones. A measured max is better than 220 − age." />
        </Card>

        <ImportCard />

        <Card title="Where each number comes from">
          <ul className="space-y-2 text-sm">
            <li><b>Apple Watch via Apple Health</b>: runs, strength workouts, heart rate, energy, steps, sleep, HRV, VO₂ max. Imported from the Health export.</li>
            <li><b>MyFitnessPal</b>: calories and macros, via Apple Health. Only food logged after you switched on MyFitnessPal&apos;s Apple Health sync is available.</li>
            <li><b>Weight and exercise log</b>: typed in by you on the Recovery and Strength pages.</li>
          </ul>
          <p className="mt-3 text-xs text-mute">If iPhone and Watch both record steps, the Watch is used for each hour. Strava is not used.</p>
        </Card>

        <Card title="Your data">
          <p className="text-sm text-mute">Everything is stored in one file on this computer (<code className="rounded bg-surface2 px-1">data/fitdash.db</code>): imported health data, settings, goals, weights and exercise log. Nothing is sent to any server. To back it up, copy that file while FitDash is stopped.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={btnCls} onClick={exportJson}><Download size={14} aria-hidden /> Export my settings (JSON)</button>
            <button type="button" className={btnCls} onClick={() => { if (confirm("Reset all settings, goals, weights and logged exercises to the defaults? Imported Apple Health data is kept.")) reset(); }}><RotateCcw size={14} aria-hidden /> Reset settings, goals and manual entries</button>
          </div>
          <p className="mt-4 text-xs text-mute">How every number is calculated: <Link href="/methodology" className="text-accent underline-offset-2 hover:underline">Metric definitions</Link>.</p>
        </Card>
      </div>
    </>
  );
}
