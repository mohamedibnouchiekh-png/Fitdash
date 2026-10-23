"use client";
import type { ReactElement } from "react";
import { ResponsiveContainer } from "recharts";
import { useApp } from "@/lib/store";

export interface Palette {
  ink: string; mute: string; grid: string; surface: string;
  blue: string; orange: string; green: string; red: string; purple: string; sky: string; gray: string;
}
const LIGHT: Palette = { ink: "#15181e", mute: "#5b6472", grid: "#e3e6eb", surface: "#ffffff", blue: "#0072B2", orange: "#B86B00", green: "#00795A", red: "#B84A00", purple: "#9A4C78", sky: "#3A8FC4", gray: "#8a93a0" };
const DARK: Palette = { ink: "#eceff4", mute: "#9aa4b2", grid: "#29303b", surface: "#151a21", blue: "#56B4E9", orange: "#E69F00", green: "#2FBF9A", red: "#F0824D", purple: "#E08BB9", sky: "#8CCBF0", gray: "#7b8594" };

export function usePalette(): Palette { return useApp().dark ? DARK : LIGHT; }

export function useAxis() {
  const p = usePalette();
  const tick = { fill: p.mute, fontSize: 11 };
  return {
    p,
    x: { tick, tickLine: false, axisLine: { stroke: p.grid }, minTickGap: 24 },
    y: { tick, tickLine: false, axisLine: false, width: 44 },
    grid: { stroke: p.grid, strokeDasharray: "3 3", vertical: false },
    tip: { contentStyle: { background: p.surface, border: `1px solid ${p.grid}`, borderRadius: 10, fontSize: 12, color: p.ink, boxShadow: "0 6px 20px rgba(0,0,0,.18)" }, labelStyle: { color: p.mute, marginBottom: 4 }, itemStyle: { color: p.ink }, cursor: { stroke: p.grid } },
  };
}

/** Wraps a chart with an accessible name and a fixed-height container. */
export function ChartBox({ label, height = 240, children }: { label: string; height?: number; children: ReactElement }) {
  return <div role="img" aria-label={label} style={{ height }} className="w-full"><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>;
}

export function Legend({ items }: { items: { color: string; label: string; dashed?: boolean }[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mute">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-4 rounded" style={{ background: i.dashed ? "transparent" : i.color, borderTop: i.dashed ? `2px dashed ${i.color}` : undefined, height: i.dashed ? 0 : 3 }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
