"use client";
import { useState, type ReactNode } from "react";
import { Info, Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { Provenance } from "@/lib/types";
import type { Status } from "@/lib/goals";

export function InfoTip({ text }: { text: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex align-middle">
      <button type="button" aria-label="What does this mean?" aria-expanded={open} onClick={() => setOpen((o) => !o)} onBlur={() => setOpen(false)}
        onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} className="text-mute hover:text-ink rounded-full">
        <Info size={14} />
      </button>
      {open && (
        <span role="tooltip" className="absolute left-1/2 top-full z-30 mt-1.5 w-64 -translate-x-1/2 rounded-lg border border-line bg-surface p-2.5 text-xs font-normal leading-relaxed text-ink shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}

const PROV: Record<Provenance, { label: string; cls: string; tip: string }> = {
  measured: { label: "Measured", cls: "border-good/40 text-good", tip: "A direct sensor reading (e.g. heart rate, distance, steps)." },
  reported: { label: "Reported", cls: "border-accent/40 text-accent", tip: "A value reported by a source app or typed in by you (e.g. food log, weight)." },
  estimated: { label: "Estimated", cls: "border-warn/50 text-warn", tip: "An algorithmic estimate by a device (e.g. VO₂ max, calories burned, sleep stages). Not a lab measurement." },
  calculated: { label: "Calculated", cls: "border-line text-mute", tip: "Computed by this dashboard from other values using the formula in Methodology." },
};
export function Prov({ kind }: { kind: Provenance }) {
  const p = PROV[kind];
  return <span title={p.tip} className={`inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide ${p.cls}`}>{p.label}</span>;
}

export function Card({ title, info, right, children, className = "" }: { title?: ReactNode; info?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-surface p-4 sm:p-5 ${className}`}>
      {(title || right) && (
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">{title}{info && <InfoTip text={info} />}</h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, unit, sub, prov, info, delta, deltaGood, progress, children }: {
  label: string; value: ReactNode; unit?: string; sub?: ReactNode; prov?: Provenance; info?: ReactNode;
  delta?: { text: string; dir: "up" | "down" | "flat" } | null; deltaGood?: boolean | null; progress?: number | null; children?: ReactNode;
}) {
  const Icon = delta?.dir === "up" ? TrendingUp : delta?.dir === "down" ? TrendingDown : Minus;
  const tone = deltaGood === true ? "text-good" : deltaGood === false ? "text-bad" : "text-mute";
  return (
    <div className="flex flex-col rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1 text-xs font-medium text-mute">{label}{info && <InfoTip text={info} />}</div>
        {prov && <Prov kind={prov} />}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="tnum text-2xl font-semibold tracking-tight">{value}</span>
        {unit && <span className="text-sm text-mute">{unit}</span>}
      </div>
      {progress !== undefined && progress !== null && <Progress value={progress} className="mt-2" label={label} />}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-mute">
        {delta && <span className={`inline-flex items-center gap-1 font-medium ${tone}`}><Icon size={13} aria-hidden />{delta.text}</span>}
        {sub && <span>{sub}</span>}
      </div>
      {children}
    </div>
  );
}

export function Progress({ value, className = "", label, tone }: { value: number; className?: string; label?: string; tone?: "good" | "warn" | "bad" | "accent" }) {
  const v = Math.max(0, Math.min(100, value));
  const color = tone === "good" ? "bg-good" : tone === "warn" ? "bg-warn" : tone === "bad" ? "bg-bad" : "bg-accent";
  return (
    <div role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label} className={`h-1.5 w-full overflow-hidden rounded-full bg-surface2 ${className}`}>
      <div className={`h-full rounded-full ${color} transition-[width]`} style={{ width: `${v}%` }} />
    </div>
  );
}

export function StatusChip({ status, text }: { status: Status; text?: string }) {
  const map: Record<Status, string> = {
    achieved: "border-good/50 text-good", on_track: "border-good/50 text-good", at_risk: "border-warn/60 text-warn", off_track: "border-bad/50 text-bad", unknown: "border-line text-mute",
  };
  const mark: Record<Status, string> = { achieved: "✓", on_track: "●", at_risk: "▲", off_track: "■", unknown: "?" };
  const label = text ?? { achieved: "Achieved", on_track: "On track", at_risk: "At risk", off_track: "Off track", unknown: "Not enough data" }[status];
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${map[status]}`}><span aria-hidden>{mark[status]}</span>{label}</span>;
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { key: T; label: string }[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-line bg-surface2 p-0.5">
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => onChange(o.key)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${value === o.key ? "bg-surface text-ink shadow-sm" : "text-mute hover:text-ink"}`}>{o.label}</button>
      ))}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-4 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {body && <p className="mt-1 max-w-md text-xs text-mute">{body}</p>}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "bad"; title?: string; children: ReactNode }) {
  const cls = tone === "warn" ? "border-warn/50" : tone === "bad" ? "border-bad/50" : "border-accent/40";
  return (
    <div role={tone === "info" ? "note" : "alert"} className={`rounded-xl border ${cls} bg-surface px-4 py-3 text-sm`}>
      {title && <p className="font-semibold">{title}</p>}
      <div className="text-mute">{children}</div>
    </div>
  );
}

export function PageHeader({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>{sub && <p className="mt-0.5 text-sm text-mute">{sub}</p>}</div>
      {right}
    </div>
  );
}

export const inputCls = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-mute focus:border-accent";
export const btnCls = "inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium hover:bg-surface2";
export const btnPrimary = "inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 dark:text-black";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-mute">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-mute">{hint}</span>}
    </label>
  );
}
