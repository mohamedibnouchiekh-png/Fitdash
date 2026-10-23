"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Activity, Database, Dumbbell, Footprints, HeartPulse, Lightbulb, LayoutDashboard, Monitor, Moon, Settings as Cog, Sun, Target, Utensils } from "lucide-react";
import { useApp, RANGES } from "@/lib/store";
import { Segmented } from "./ui";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/nutrition", label: "Nutrition", icon: Utensils },
  { href: "/running", label: "Running", icon: Footprints },
  { href: "/strength", label: "Strength", icon: Dumbbell },
  { href: "/recovery", label: "Recovery", icon: HeartPulse },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/insights", label: "Insights", icon: Lightbulb },
  { href: "/settings", label: "Settings", icon: Cog },
];

export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "unknown" : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function SourceMenu() {
  const { settings, update, isSample, server } = useApp();
  const imported = server.lastImport?.status === "ok" ? server.lastImport.finishedAt : null;
  const [open, setOpen] = useState(false);
  const rows: { key: "watch" | "mfp" | "manual"; name: string; what: string }[] = [
    { key: "watch", name: "Apple Watch (via Apple Health)", what: "Runs, workouts, heart rate, sleep, VO₂ max" },
    { key: "mfp", name: "MyFitnessPal (via Apple Health)", what: "Calories and macros" },
    { key: "manual", name: "Manual entries", what: "Weight, exercise log" },
  ];
  return (
    <div className="relative">
      <button type="button" aria-label="Data sources" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium hover:bg-surface2">
        <Database size={14} aria-hidden /> <span className="hidden sm:inline">Sources</span>
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-line bg-surface p-3 shadow-xl">
          <p className="mb-2 text-xs text-mute">Turn a source off to see how the dashboard behaves without it. Missing data stays missing; it is never counted as zero.</p>
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.key} className="flex items-start gap-2">
                <input id={`src-${r.key}`} type="checkbox" className="mt-1" checked={settings.enabledSources[r.key]} onChange={(e) => update({ enabledSources: { ...settings.enabledSources, [r.key]: e.target.checked } })} />
                <label htmlFor={`src-${r.key}`} className="text-xs">
                  <span className="block font-medium">{r.name}</span>
                  <span className="block text-mute">{r.what}</span>
                  <span className="block text-mute">
                    {r.key === "manual"
                      ? <>Status: <b className="font-medium">entered by you</b> · always live</>
                      : isSample ? <>Status: <b className="font-medium text-warn">{server.hasData ? "sample data (preview)" : "sample data"}</b> · last import: {fmtWhen(imported)}</>
                      : <>Status: <b className="font-medium text-good">imported</b> · last import: {fmtWhen(imported)}</>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ThemeToggle() {
  const { settings, update } = useApp();
  const next = settings.theme === "system" ? "light" : settings.theme === "light" ? "dark" : "system";
  const Icon = settings.theme === "system" ? Monitor : settings.theme === "light" ? Sun : Moon;
  return (
    <button type="button" onClick={() => update({ theme: next })} aria-label={`Theme: ${settings.theme}. Switch to ${next}`} title={`Theme: ${settings.theme}`} className="rounded-lg border border-line bg-surface p-2 hover:bg-surface2">
      <Icon size={15} aria-hidden />
    </button>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { range, setRange, isSample, server, serverError, saveState } = useApp();
  const imported = server.lastImport?.status === "ok" ? server.lastImport.finishedAt : null;
  const status = isSample
    ? <>{server.hasData ? "Previewing sample data" : "Sample data · not your real measurements"} · <Link href="/settings#import" className="text-accent underline-offset-2 hover:underline">{server.hasData ? "Settings" : "Import your Apple Health data"}</Link></>
    : <>Your Apple Health data · last import {fmtWhen(imported)}</>;
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="hidden border-r border-line bg-surface md:block">
        <div className="sticky top-0 flex h-screen flex-col p-4">
          <div className="mb-6 flex items-center gap-2 px-2 text-base font-semibold"><Activity size={18} className="text-accent" aria-hidden /> FitDash</div>
          <nav aria-label="Main" className="space-y-0.5">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} aria-current={active(href) ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm ${active(href) ? "bg-surface2 font-semibold" : "text-mute hover:bg-surface2 hover:text-ink"}`}>
                <Icon size={16} aria-hidden /> {label}
              </Link>
            ))}
          </nav>
          <Link href="/methodology" className="mt-auto px-2.5 text-xs text-mute underline-offset-2 hover:underline">Metric definitions</Link>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 sm:px-6">
            <div className="flex items-center gap-2 text-sm font-semibold md:hidden"><Activity size={16} className="text-accent" aria-hidden /> FitDash</div>
            <div className="hidden text-xs text-mute md:block">{status}</div>
            <div className="flex items-center gap-2">
              <Segmented label="Date range" value={range} onChange={setRange} options={RANGES.map((r) => ({ key: r.key, label: r.label }))} />
              <SourceMenu />
              <ThemeToggle />
            </div>
          </div>
          <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-2 md:hidden">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} aria-current={active(href) ? "page" : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs ${active(href) ? "bg-surface2 font-semibold" : "text-mute"}`}>
                <Icon size={13} aria-hidden /> {label}
              </Link>
            ))}
          </nav>
        </header>
        {isSample && <div className="border-b border-warn/30 bg-surface px-4 py-1.5 text-center text-xs text-warn md:hidden">{server.hasData ? "Previewing sample data" : "Sample data: not your real measurements"} · <Link href="/settings#import" className="underline">{server.hasData ? "Settings" : "Import yours"}</Link></div>}
        {serverError && <div role="alert" className="border-b border-bad/40 bg-surface px-4 py-2 text-center text-xs text-bad">Cannot reach the local database: {serverError} Showing sample data. Entries and settings will not be saved.</div>}
        {saveState === "error" && <div role="alert" className="border-b border-bad/40 bg-surface px-4 py-2 text-center text-xs text-bad">Your last change could not be saved to the local database. Check that the FitDash server is still running, then try again.</div>}
        <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
