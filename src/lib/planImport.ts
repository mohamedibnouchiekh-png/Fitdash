// Reads a "weekly tracking" spreadsheet template and turns it into exercise-log entries.
//
// Layout it understands (from the template you use):
//   - one header row with "Exercise" and "Week1 … WeekN" columns
//   - a "Day N" label in the column left of the exercise names
//   - a "PHASE 1 (3×5)" style row that sets the target sets × reps for the exercises below it
//   - one row per set; the cell holds the load in kg, or a short note such as "80x3-70x2"
// The sheet records loads, not reps per set, so reps come from the plan's target. That is flagged to the user.
//
// Pure functions only (no Node APIs) so the browser and the tests can share them.
import type { LiftEntry, LiftSet } from "./types.ts";
import { addDays } from "./dates.ts";

export type Cell = string | number | boolean | null | undefined;

export interface PlanFlag {
  kind: "assumed" | "unreadable" | "suspect";
  exercise: string;
  day: number;
  week: number;
  raw: string;
  note: string;
}
export interface PlanSession {
  day: number;
  week: number;
  exercise: string;
  sets: LiftSet[];
  targetReps: number;
  suspect?: boolean;
}
export interface PlanParse {
  sheet?: string;
  weeks: number[];
  days: number[];
  sessions: PlanSession[];
  flags: PlanFlag[];
  /** Day number → weekday (0 = Sunday … 6 = Saturday), when the sheet has a weekly schedule block. */
  schedule: Record<number, number> | null;
  skippedSets: number; // cells marked "X" (not done)
}

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const toNum = (s: string) => Number(s.replace(",", "."));
const round2 = (n: number) => Math.round(n * 100) / 100;
const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export interface CellResult { sets: LiftSet[]; status: "ok" | "assumed" | "skipped" | "unreadable"; note?: string }
interface Ctx { targetReps: number; ref: number | null }

const validReps = (r: number) => Number.isInteger(r) && r >= 1 && r <= 60;

/** Reads one cell. `ref` is the exercise's typical load, used to decide whether "4x20" means 4 reps at 20 kg or 20 reps at 4 kg. */
export function parseCell(raw: Cell, ctx: Ctx): CellResult {
  if (raw === null || raw === undefined || raw === "") return { sets: [], status: "skipped" };
  if (typeof raw === "number") return plain(raw, ctx);
  const t = String(raw).trim().replace(/[–—]/g, "-").replace(/\s+/g, " ");
  if (!t) return { sets: [], status: "skipped" };
  if (/^x$/i.test(t)) return { sets: [], status: "skipped", note: "marked X (not done)" };

  let m = t.match(new RegExp(`^(${NUM})\\s*(?:kg)?\\s*(?:each(?: side)?|per side|cable)?$`, "i"));
  if (m) return plain(toNum(m[1]), ctx);

  m = t.match(new RegExp(`^(${NUM})\\s*\\+\\s*(${NUM})\\s*(?:kg)?$`, "i"));
  if (m) {
    const kg = round2(toNum(m[1]) + toNum(m[2]));
    return { sets: [{ reps: ctx.targetReps, kg }], status: "assumed", note: `${t} read as ${kg} kg (added together)` };
  }

  if (/^hack\s*squat\s*0$/i.test(t)) return { sets: [{ reps: ctx.targetReps, kg: 0 }], status: "assumed", note: "counted as 0 kg (no added load)" };

  // reps × kg, or kg × reps, optionally several parts joined by "-" (a drop set inside one set)
  const parts = t.split(/\s*-\s*/);
  const seg = parts.map((p) => p.match(new RegExp(`^(${NUM})\\s*[x×]\\s*(${NUM})\\s*(?:kg)?$`, "i")));
  if (parts.length >= 1 && parts.length <= 3 && seg.every(Boolean)) return crossed(t, seg.map((s) => [toNum(s![1]), toNum(s![2])] as [number, number]), ctx);

  // two loads in one set ("30/20", "6\4", "5-5"): a drop set or left/right — counted at the heavier load
  m = t.match(new RegExp(`^(${NUM})\\s*[/\\\\-]\\s*(${NUM})$`));
  if (m) {
    const a = toNum(m[1]), b = toNum(m[2]), kg = Math.max(a, b);
    return { sets: [{ reps: ctx.targetReps, kg }], status: "assumed", note: `two loads (${a} and ${b}); counted at ${kg} kg` };
  }
  return { sets: [], status: "unreadable", note: "could not read this cell, so it was left out" };
}

function plain(kg: number, ctx: Ctx): CellResult {
  if (!(kg >= 0) || kg > 1000) return { sets: [], status: "unreadable", note: "load out of range" };
  return { sets: [{ reps: ctx.targetReps, kg: round2(kg) }], status: "ok" };
}

function crossed(raw: string, segs: [number, number][], ctx: Ctx): CellResult {
  const score = (kg: number) => (ctx.ref && ctx.ref > 0 && kg > 0 ? Math.abs(Math.log(kg / ctx.ref)) : 0);
  type Pick = { reps: number; kg: number };
  // every way of reading each part as reps × kg or kg × reps, keeping only whole-number reps
  const options = segs.map(([a, b]) => ([{ reps: a, kg: b }, { reps: b, kg: a }] as Pick[]).filter((p) => validReps(p.reps) && p.kg > 0));
  if (options.some((o) => o.length === 0)) return { sets: [], status: "unreadable", note: "could not read this cell, so it was left out" };
  let combos: Pick[][] = [[]];
  for (const o of options) combos = combos.flatMap((c) => o.map((p) => [...c, p]));
  const cost = (c: Pick[]) => c.reduce((s, p) => s + score(p.kg), 0);
  const totalMatches = (c: Pick[]) => c.reduce((s, p) => s + p.reps, 0) === ctx.targetReps;
  const matching = combos.filter(totalMatches);
  const pool = matching.length ? matching : combos;
  const best = [...pool].sort((x, y) => cost(x) - cost(y))[0];
  const top = best.reduce((a, p) => (p.kg > a.kg ? p : a), best[0]);
  const desc = best.map((p) => `${p.reps} reps at ${p.kg} kg`).join(" then ");
  return { sets: [{ reps: top.reps, kg: top.kg }], status: "assumed", note: `"${raw}" read as ${desc}${best.length > 1 ? "; counted as one set at the heaviest load" : ""}` };
}

// ---------------------------------------------------------------------------------------------

const cellText = (c: Cell) => (c === null || c === undefined ? "" : String(c).trim());
const WEEKDAYS: [RegExp, number][] = [[/^(lun|mon)/i, 1], [/^(mar|tue)/i, 2], [/^(mer|wed)/i, 3], [/^(jeu|thu)/i, 4], [/^(ven|fri)/i, 5], [/^(sam|sat)/i, 6], [/^(dim|sun)/i, 0]];

/** Strips "(3×5)", "(×12 reps)", "3 x10 resp" from an exercise label and tidies spacing. Returns the clean name and any reps it states. */
export function cleanExercise(label: string): { name: string; reps: number | null; sets: number | null } {
  let name = label.replace(/\s+/g, " ").trim();
  let sets: number | null = null, reps: number | null = null;
  const take = (re: RegExp, f: (m: RegExpMatchArray) => void) => { const m = name.match(re); if (m) { f(m); name = name.replace(re, " "); } };
  take(/\(\s*(\d+)\s*[x×]\s*(\d+)[^)]*\)/i, (m) => { sets = Number(m[1]); reps = Number(m[2]); });
  take(/\(\s*[x×]\s*(\d+)\s*reps?\s*\)/i, (m) => { reps = Number(m[1]); });
  take(/\s(\d+)\s*x\s*(\d+)\s*(?:resp|reps?)\b/i, (m) => { sets = Number(m[1]); reps = Number(m[2]); });
  name = name.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/\s+/g, " ").trim();
  return { name, reps, sets };
}

export function parsePlanGrid(grid: Cell[][], sheet?: string): PlanParse {
  const flags: PlanFlag[] = [];
  // 1. header row: Week columns
  let headRow = -1; const weekCols = new Map<number, number>(); let exCol = 1;
  for (let r = 0; r < Math.min(grid.length, 40) && headRow < 0; r++) {
    const cols = new Map<number, number>();
    (grid[r] ?? []).forEach((c, i) => { const m = cellText(c).match(/^week\s*0*(\d+)$/i); if (m) cols.set(i, Number(m[1])); });
    if (cols.size >= 2) { headRow = r; cols.forEach((w, i) => weekCols.set(i, w)); const e = (grid[r] ?? []).findIndex((c) => /^exercise$/i.test(cellText(c))); if (e >= 0) exCol = e; }
  }
  if (headRow < 0) return { sheet, weeks: [], days: [], sessions: [], flags, schedule: null, skippedSets: 0 };
  const dayCol = Math.max(0, exCol - 1);

  // 2. walk the exercise rows
  interface Block { day: number; name: string; rows: number[]; targetReps: number }
  const blocks: Block[] = [];
  let day = 0, phaseReps = 10, cur: Block | null = null;
  for (let r = headRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const label = cellText(row[exCol]);
    if (/daily stats|stats track/i.test(label)) break;
    const dm = cellText(row[dayCol]).match(/^day\s*(\d+)$/i);
    if (dm) { day = Number(dm[1]); cur = null; phaseReps = 10; }
    if (/^phase\s*\d+/i.test(label)) { const m = label.match(/\(\s*(\d+)\s*[x×]\s*(\d+)\s*\)/); if (m) phaseReps = Number(m[2]); cur = null; continue; }
    if (label) {
      const c = cleanExercise(label);
      cur = { day, name: c.name, rows: [r], targetReps: c.reps ?? phaseReps };
      blocks.push(cur);
    } else if (cur && [...weekCols.keys()].some((i) => cellText(row[i]) !== "")) cur.rows.push(r);
  }

  // 3. read each exercise's weekly sets
  const sessions: PlanSession[] = []; let skippedSets = 0;
  for (const b of blocks) {
    const plainLoads: number[] = [];
    for (const r of b.rows) for (const i of weekCols.keys()) { const v = grid[r]?.[i]; const n = typeof v === "number" ? v : /^\d+(?:[.,]\d+)?$/.test(cellText(v)) ? toNum(cellText(v)) : NaN; if (n > 0) plainLoads.push(n); }
    const ctx: Ctx = { targetReps: b.targetReps, ref: median(plainLoads) };
    const byWeek: PlanSession[] = [];
    for (const [col, week] of [...weekCols.entries()].sort((a, b2) => a[1] - b2[1])) {
      const sets: LiftSet[] = [];
      for (const r of b.rows) {
        const raw = grid[r]?.[col];
        const res = parseCell(raw, ctx);
        if (res.status === "skipped") { if (res.note) skippedSets++; continue; }
        if (res.status === "unreadable") { flags.push({ kind: "unreadable", exercise: b.name, day: b.day, week, raw: cellText(raw), note: res.note ?? "" }); continue; }
        if (res.status === "assumed") flags.push({ kind: "assumed", exercise: b.name, day: b.day, week, raw: cellText(raw), note: res.note ?? "" });
        sets.push(...res.sets);
      }
      if (sets.length) byWeek.push({ day: b.day, week, exercise: b.name, sets, targetReps: b.targetReps });
    }
    // a load that jumps by 3.5× or more from one week to the next usually means a different unit, machine setting or typo
    const top = (s: PlanSession) => Math.max(...s.sets.map((x) => x.kg));
    for (let i = 0; i + 1 < byWeek.length; i++) {
      const a = top(byWeek[i]), n = top(byWeek[i + 1]);
      if (a > 0 && n / a >= 3.5) {
        for (let k = 0; k <= i; k++) byWeek[k].suspect = true;
        flags.push({ kind: "suspect", exercise: b.name, day: b.day, week: byWeek[i].week, raw: `${a} → ${n}`, note: `${a} kg in week ${byWeek[i].week}, then ${n} kg in week ${byWeek[i + 1].week}` });
      }
    }
    sessions.push(...byWeek);
  }

  return { sheet, weeks: [...new Set(sessions.map((s) => s.week))].sort((a, b) => a - b), days: [...new Set(sessions.map((s) => s.day))].sort((a, b) => a - b), sessions, flags, schedule: readSchedule(grid, [...new Set(sessions.map((s) => s.day))].sort((a, b) => a - b)), skippedSets };
}

/** Finds a block like "Mardi | Full Body, Jeudi | Full Body …" and maps Day 1, 2, 3 … to those weekdays in order. */
function readSchedule(grid: Cell[][], days: number[]): Record<number, number> | null {
  const hits: { wd: number; row: number; col: number }[] = [];
  grid.forEach((row, r) => (row ?? []).forEach((c, i) => {
    const t = cellText(c); if (!t || t.length > 12) return;
    const w = WEEKDAYS.find(([re]) => re.test(t)); if (!w) return;
    const next = cellText(row[i + 1]);
    if (/full\s*body|strength|push|pull|leg|upper|lower|chest|back|shoulder|arms?|day\s*\d/i.test(next) && !/run|steps?/i.test(next)) hits.push({ wd: w[1], row: r, col: i });
  }));
  if (!hits.length || !days.length) return null;
  const order = [1, 2, 3, 4, 5, 6, 0];
  // keep the largest group that sits in one column (the weekly schedule block)
  const byCol = new Map<number, typeof hits>(); hits.forEach((h) => byCol.set(h.col, [...(byCol.get(h.col) ?? []), h]));
  const group = [...byCol.values()].sort((a, b) => b.length - a.length)[0].sort((a, b) => order.indexOf(a.wd) - order.indexOf(b.wd));
  if (group.length < days.length) return null;
  return Object.fromEntries(days.map((d, i) => [d, group[i].wd]));
}

// ---------------------------------------------------------------------------------------------

export interface DateOpts { week1Monday: string; dayWeekday: Record<number, number> }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Turns parsed sessions into dated log entries. The id is built from date + exercise, so importing again replaces instead of duplicating. */
export function assignDates(sessions: PlanSession[], o: DateOpts): LiftEntry[] {
  const out: LiftEntry[] = [];
  for (const s of sessions) {
    const wd = o.dayWeekday[s.day];
    if (wd === undefined) continue;
    const date = addDays(o.week1Monday, 7 * (s.week - 1) + ((wd + 6) % 7));
    out.push({ id: `plan:${date}:${slug(s.exercise)}`, date, exercise: s.exercise, sets: s.sets, source: "plan" });
  }
  return out;
}
