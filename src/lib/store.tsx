"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Dataset, Day, Goal, Settings } from "./types.ts";
import { addDays, todayLocal } from "./dates.ts";
import { generateSample } from "./sample.ts";
import { mean, predictRaceSec } from "./metrics.ts";

export type RangeKey = "7d" | "30d" | "90d" | "all";
export const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: "7d", label: "7D", days: 7 }, { key: "30d", label: "30D", days: 30 }, { key: "90d", label: "90D", days: 90 }, { key: "all", label: "All", days: null },
];

export interface ImportInfo {
  id: number; finishedAt: string | null; status: string; fileName: string | null; error: string | null; warnings: string[];
  summary: { recordsSeen: number; days: number; runs: number; strength: number; runsWithRoute: number; runsWithoutRoute: number; duplicateWorkoutsDropped: number; firstDay: string | null; lastDay: string | null; exportDate: string | null } | null;
}
export interface ServerState { hasData: boolean; lastImport: ImportInfo | null; counts: { days: number; runs: number; strength: number } }
type SaveState = "idle" | "saving" | "error";

/** Defaults are recomputed from whichever dataset is active, so placeholder baselines never come from sample data once real data exists. */
function defaultSettings(today: string, base: Dataset, manualWeights: Settings["weights"]): Settings {
  const vo2 = base.days.filter((d) => d.vo2max !== undefined && d.date <= addDays(today, -60)).slice(-3).map((d) => d.vo2max);
  const race = predictRaceSec(base.runs, addDays(today, -60), 5);
  const weights = manualWeights.length ? manualWeights : base.weights;
  const goals: Goal[] = [
    { id: "g-race", type: "race", label: "5 km under 27:30", target: 27 * 60 + 30, raceKm: 5, deadline: addDays(today, 90), baseline: race?.sec, example: true },
    { id: "g-km", type: "weeklyKm", label: "Average 20 km per week", target: 20, deadline: addDays(today, 60), example: true },
    { id: "g-str", type: "strengthPerWeek", label: "3 strength sessions per week", target: 3, example: true },
    { id: "g-pro", type: "protein", label: "Hit protein on 80% of days", target: 80, example: true },
    { id: "g-def", type: "deficit", label: "Stay near a 400 kcal/day deficit", target: 400, example: true },
    { id: "g-vo2", type: "vo2", label: "VO₂ max 48", target: 48, deadline: addDays(today, 120), baseline: (mean(vo2) ?? undefined) as number | undefined, example: true },
    { id: "g-slp", type: "sleep", label: "Sleep 7.5 h on average", target: 7.5, example: true },
    { id: "g-wt", type: "weight", label: "Reach 78 kg", target: 78, deadline: addDays(today, 120), baseline: weights.find((w) => w.date >= addDays(today, -90))?.kg, example: true },
  ];
  return {
    theme: "system",
    targets: { kcal: 2200, protein: 150, carbs: 230, fat: 70, kcalTolerancePct: 10, proteinMetPct: 90 },
    schedule: { strengthDays: [1, 3, 5], runDays: [2, 6] },
    hrMax: 190, goals, weights: [], lifts: [],
    enabledSources: { watch: true, mfp: true, manual: true },
  };
}

function merge(defaults: Settings, stored: Partial<Settings> | null): Settings {
  if (!stored) return defaults;
  return {
    ...defaults, ...stored,
    targets: { ...defaults.targets, ...stored.targets },
    schedule: { ...defaults.schedule, ...stored.schedule },
    enabledSources: { ...defaults.enabledSources, ...stored.enabledSources },
    // goals: example goals follow the active dataset's baselines until the user edits them
    goals: stored.goals
      ? stored.goals.map((g) => (g.example ? { ...(defaults.goals.find((d) => d.id === g.id) ?? g), ...g, baseline: defaults.goals.find((d) => d.id === g.id)?.baseline } : g))
      : defaults.goals,
    weights: stored.weights ?? [], lifts: stored.lifts ?? [],
  };
}

interface Ctx {
  ready: boolean; today: string; ds: Dataset; settings: Settings;
  update: (patch: Partial<Settings>) => void; reset: () => void;
  range: RangeKey; setRange: (r: RangeKey) => void; from: string; to: string; allFrom: string;
  dark: boolean;
  /** True while the dashboard is showing generated sample data instead of an imported export. */
  isSample: boolean;
  server: ServerState; serverError: string | null; refresh: () => Promise<void>; saveState: SaveState;
}
const C = createContext<Ctx | null>(null);
export const useApp = () => { const c = useContext(C); if (!c) throw new Error("useApp outside provider"); return c; };

const WATCH_FIELDS: (keyof Day)[] = ["activeKcal", "restingKcal", "steps", "restingHr", "hrv", "sleepMin", "deepMin", "remMin", "bedtimeMin", "vo2max", "respRate"];
const MFP_FIELDS: (keyof Day)[] = ["kcalIn", "protein", "carbs", "fat", "mealsLogged"];
const EMPTY: Dataset = { days: [], runs: [], strength: [], lifts: [], weights: [] };
const NO_SERVER: ServerState = { hasData: false, lastImport: null, counts: { days: 0, runs: 0, strength: 0 } };

export function AppProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [today, setToday] = useState("2000-01-01");
  const [sample, setSample] = useState<Dataset>(EMPTY);
  const [real, setReal] = useState<Dataset>(EMPTY);
  const [server, setServer] = useState<ServerState>(NO_SERVER);
  const [serverError, setServerError] = useState<string | null>(null);
  const [stored, setStored] = useState<Partial<Settings> | null>(null);
  const [range, setRange] = useState<RangeKey>("30d");
  const [sysDark, setSysDark] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [dRes, sRes] = await Promise.all([fetch("/api/dataset", { cache: "no-store" }), fetch("/api/settings", { cache: "no-store" })]);
      if (!dRes.ok) throw new Error(`The local database returned an error (${dRes.status}).`);
      const d = await dRes.json();
      const s = sRes.ok ? await sRes.json() : { settings: null };
      setReal(d.dataset as Dataset);
      setServer({ hasData: d.hasData, lastImport: d.lastImport, counts: d.counts });
      if (!dirty.current) setStored(s.settings ?? null);
      setServerError(null);
    } catch (e) {
      setServerError(e instanceof Error ? e.message : "Could not reach the local database.");
    }
  }, []);

  useEffect(() => {
    const t = todayLocal();
    setToday(t); setSample(generateSample(t));
    refresh().finally(() => setLoaded(true));
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSysDark(mq.matches);
    const h = (e: MediaQueryListEvent) => setSysDark(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [refresh]);

  const isSample = !server.hasData || stored?.previewSample === true;
  const base = isSample ? sample : real;
  const defaults = useMemo(() => defaultSettings(today, base, stored?.weights ?? []), [today, base, stored?.weights]);
  const settings = useMemo(() => merge(defaults, stored), [defaults, stored]);

  const persist = useCallback((next: Partial<Settings> | null) => {
    dirty.current = true;
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const r = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json", "x-fitdash": "1" }, body: JSON.stringify({ settings: next }) });
        if (!r.ok) throw new Error(String(r.status));
        setSaveState("idle"); dirty.current = false;
      } catch { setSaveState("error"); }
    }, 400);
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setStored((cur) => {
      const next = { ...(cur ?? {}), ...patch } as Partial<Settings>;
      persist(next);
      return next;
    });
  }, [persist]);
  const reset = useCallback(() => { setStored(null); persist(null); }, [persist]);

  const dark = settings.theme === "dark" || (settings.theme === "system" && sysDark);
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);

  const ds = useMemo<Dataset>(() => {
    const src = settings.enabledSources;
    const days = base.days.map((d) => {
      const o = { ...d } as Record<string, unknown>;
      if (!src.watch) for (const f of WATCH_FIELDS) delete o[f];
      if (!src.mfp) for (const f of MFP_FIELDS) delete o[f];
      return o as unknown as Day;
    });
    const manualW = src.manual ? settings.weights : [];
    return {
      days, runs: src.watch ? base.runs : [], // Sample Apple Watch workouts step aside once you have logged real exercises, so the two never disagree.
      strength: src.watch && !(isSample && settings.lifts.length > 0) ? base.strength : [],
      weights: manualW.length ? manualW : isSample && src.manual ? sample.weights : [],
      lifts: !src.manual ? [] : isSample && settings.lifts.length === 0 ? sample.lifts : settings.lifts,
    };
  }, [base, settings, isSample, sample]);

  const allFrom = ds.days[0]?.date ?? today;
  const rangeDays = RANGES.find((r) => r.key === range)?.days;
  const from = rangeDays ? addDays(today, -(rangeDays - 1)) : allFrom;

  if (!loaded) return <div className="p-8"><div className="skeleton h-8 w-48 mb-4" /><div className="skeleton h-40 w-full" /></div>;
  const value: Ctx = { ready: loaded, today, ds, settings, update, reset, range, setRange, from, to: today, allFrom, dark, isSample, server, serverError, refresh, saveState };
  return <C.Provider value={value}>{children}</C.Provider>;
}
