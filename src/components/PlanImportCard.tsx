"use client";
import { useMemo, useRef, useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { useApp } from "@/lib/store";
import { addDays, DOW_LABELS, longDate, shortDate, weekStart } from "@/lib/dates";
import { assignDates, type PlanParse } from "@/lib/planImport";
import { btnCls, btnPrimary, Card, Field, inputCls, Notice } from "./ui";

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function PlanImportCard() {
  const { settings, update, today } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<PlanParse | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [week1, setWeek1] = useState("");
  const [dayWd, setDayWd] = useState<Record<number, number>>({});
  const [include, setInclude] = useState<Set<string>>(new Set());
  const [setDays, setSetDays] = useState(true);
  const [done, setDone] = useState("");

  const importedCount = settings.lifts.filter((l) => l.source === "plan").length;

  async function choose(f: File | null) {
    setError(""); setDone(""); setPlan(null);
    if (!f) return;
    setFileName(f.name); setBusy(true);
    try {
      const res = await fetch("/api/plan/parse", { method: "POST", headers: { "x-fitdash": "1" }, body: f });
      const body = await res.json();
      if (!res.ok) { setError(body.error ?? `The server could not read the file (${res.status}).`); return; }
      const p: PlanParse = body.plan;
      setPlan(p);
      const last = Math.max(...p.weeks);
      setWeek1(addDays(weekStart(today), -7 * (last - 1)));
      setDayWd(p.schedule ?? Object.fromEntries(p.days.map((d, i) => [d, [1, 3, 5, 2, 4, 6, 0][i % 7]])));
      setInclude(new Set());
    } catch {
      setError("The upload failed. Is the FitDash server still running?");
    } finally { setBusy(false); }
  }

  const monday = week1 ? weekStart(week1) : "";
  const view = useMemo(() => {
    if (!plan || !monday) return null;
    const used = plan.sessions.filter((s) => !s.suspect || include.has(`${s.day}|${s.exercise}`));
    const entries = assignDates(used, { week1Monday: monday, dayWeekday: dayWd });
    const dates = entries.map((e) => e.date).sort();
    return {
      entries,
      sets: entries.reduce((n, e) => n + e.sets.length, 0),
      exercises: new Set(entries.map((e) => e.exercise)).size,
      first: dates[0], last: dates.at(-1),
      future: entries.filter((e) => e.date > today).length,
      leftOut: plan.sessions.length - used.length,
    };
  }, [plan, monday, dayWd, include, today]);

  const suspects = useMemo(() => (plan?.flags ?? []).filter((f) => f.kind === "suspect"), [plan]);
  const unreadable = useMemo(() => (plan?.flags ?? []).filter((f) => f.kind === "unreadable"), [plan]);
  const interpreted = useMemo(() => {
    const m = new Map<string, { exercise: string; raw: string; note: string; n: number }>();
    for (const f of plan?.flags ?? []) if (f.kind === "assumed") { const k = `${f.exercise}|${f.raw}`; const cur = m.get(k); if (cur) cur.n++; else m.set(k, { exercise: f.exercise, raw: f.raw, note: f.note, n: 1 }); }
    return [...m.values()];
  }, [plan]);

  function doImport() {
    if (!view) return;
    const ids = new Set(view.entries.map((e) => e.id));
    const lifts = [...settings.lifts.filter((l) => !ids.has(l.id)), ...view.entries].sort((a, b) => a.date.localeCompare(b.date));
    const wds = [...new Set(Object.values(dayWd))];
    update({ lifts, ...(setDays ? { schedule: { ...settings.schedule, strengthDays: wds } } : {}) });
    setDone(`Imported ${view.entries.length} sessions (${view.sets} sets, ${view.exercises} exercises), ${shortDate(view.first)} to ${shortDate(view.last!)}.`);
    setPlan(null); setFileName(""); if (fileRef.current) fileRef.current.value = "";
  }
  function removeImported() {
    update({ lifts: settings.lifts.filter((l) => l.source !== "plan") });
    setDone("Removed all entries that came from a spreadsheet. Entries you typed in yourself were kept.");
  }

  const dayName = (d: number) => `Day ${d}`;
  return (
    <Card title="Import your workout spreadsheet" info="Reads a weekly tracking sheet (one column per week, one row per set) and adds each session to your exercise log. Nothing is uploaded anywhere: the file is read by FitDash on this computer. Importing the same file again replaces those sessions instead of duplicating them.">
      <div className="flex flex-wrap items-center gap-3">
        <input ref={fileRef} type="file" accept=".xlsx" aria-label="Workout spreadsheet (.xlsx)" className="text-sm" onChange={(e) => choose(e.target.files?.[0] ?? null)} />
        {busy && <span className="text-sm text-mute" role="status">Reading {fileName}…</span>}
      </div>
      {error && <div className="mt-3"><Notice tone="bad" title="Could not import this file">{error}</Notice></div>}
      {done && <p className="mt-3 text-sm text-good" role="status">{done}</p>}

      {plan && view && (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-line bg-surface2 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium"><FileSpreadsheet size={16} aria-hidden /> {fileName}</div>
            <p className="mt-1 text-mute">Sheet “{plan.sheet}”: {plan.sessions.length} sessions found across {plan.weeks.length} weeks and {plan.days.length} training days. Preview below. Nothing is saved until you press Import.</p>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">1. When did it happen?</h3>
            <p className="mb-2 text-xs text-mute">The sheet has week numbers but no dates. I assumed your latest week (Week {Math.max(...plan.weeks)}) is this week. Change the date if that is wrong.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Week 1 starts on" hint={monday && monday !== week1 ? `Moved to the Monday: ${longDate(monday)}` : monday ? longDate(monday) : undefined}><input type="date" className={inputCls} value={week1} onChange={(e) => setWeek1(e.target.value)} /></Field>
              {plan.days.map((d) => (
                <Field key={d} label={`${dayName(d)} was on`}>
                  <select className={inputCls} value={dayWd[d] ?? 1} onChange={(e) => setDayWd({ ...dayWd, [d]: Number(e.target.value) })}>
                    {WEEK_ORDER.map((w) => <option key={w} value={w}>{DOW_LABELS[w]}</option>)}
                  </select>
                </Field>
              ))}
            </div>
            {plan.schedule && <p className="mt-1 text-xs text-mute">Weekdays were taken from the weekly schedule in your sheet.</p>}
            {view.future > 0 && <p className="mt-2 text-xs text-warn">{view.future} sessions land after today. Check the Week 1 date.</p>}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">2. What will be added</h3>
            <p className="text-sm"><b>{view.entries.length}</b> sessions · <b>{view.sets}</b> sets · <b>{view.exercises}</b> exercises · {view.first ? `${longDate(view.first)} to ${longDate(view.last!)}` : "no dates"}</p>
            <Notice title="Reps are the plan's targets">
              Your sheet records the load for each set, not the reps. Reps come from the plan heading (for example 3×5), unless a cell says otherwise (like 80x3). The strength chart's estimated one-rep max assumes you reached those reps.
            </Notice>
          </div>

          {suspects.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold">3. Loads that jump suddenly</h3>
              <p className="mb-2 text-xs text-mute">These earlier weeks look like a different unit, machine setting or typo, so they are left out by default. Tick one to include it anyway.</p>
              <ul className="space-y-1.5 text-sm">
                {suspects.map((f) => {
                  const key = `${f.day}|${f.exercise}`; const n = plan.sessions.filter((s) => s.day === f.day && s.exercise === f.exercise && s.suspect).length;
                  return (
                    <li key={key}>
                      <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={include.has(key)} onChange={(e) => { const s = new Set(include); if (e.target.checked) s.add(key); else s.delete(key); setInclude(s); }} />
                        <span><b className="font-medium">{f.exercise}</b>: {f.note}. <span className="text-mute">Affects {n} earlier session{n === 1 ? "" : "s"}.</span></span></label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {unreadable.length > 0 && (
            <Notice tone="warn" title={`${unreadable.length} cell${unreadable.length === 1 ? "" : "s"} could not be read and will be skipped`}>
              <ul className="mt-1 list-disc pl-5">{unreadable.map((f, i) => <li key={i}>{f.exercise}, Week {f.week}: “{f.raw}”. Fix it in Excel and import again.</li>)}</ul>
            </Notice>
          )}

          {interpreted.length > 0 && (
            <details className="rounded-xl border border-line p-3 text-sm">
              <summary className="cursor-pointer font-medium">{interpreted.reduce((n, x) => n + x.n, 0)} cells I had to interpret. Check my reading.</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[520px] text-xs">
                  <thead><tr className="text-left text-mute"><th className="py-1 font-medium">Exercise</th><th className="py-1 font-medium">In your sheet</th><th className="py-1 font-medium">How I read it</th></tr></thead>
                  <tbody>{interpreted.map((x, i) => <tr key={i} className="border-t border-line align-top"><td className="py-1 pr-2">{x.exercise}</td><td className="py-1 pr-2 tnum">{x.raw}{x.n > 1 ? ` ×${x.n}` : ""}</td><td className="py-1">{x.note.replace(`"${x.raw}" `, "")}</td></tr>)}</tbody>
                </table>
              </div>
            </details>
          )}

          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={setDays} onChange={(e) => setSetDays(e.target.checked)} />
            <span>Also set my planned strength days to {[...new Set(Object.values(dayWd))].sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b)).map((w) => DOW_LABELS[w]).join(", ")} (Settings)</span></label>

          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} onClick={doImport} disabled={view.entries.length === 0}>Import {view.entries.length} sessions</button>
            <button type="button" className={btnCls} onClick={() => { setPlan(null); setFileName(""); if (fileRef.current) fileRef.current.value = ""; }}>Cancel</button>
          </div>
        </div>
      )}

      {importedCount > 0 && !plan && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3 text-sm text-mute">
          <span>{importedCount} sessions in your log came from a spreadsheet.</span>
          <button type="button" className={btnCls} onClick={removeImported}>Remove spreadsheet entries</button>
        </div>
      )}
    </Card>
  );
}
