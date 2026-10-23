const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

export const toDate = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export const fmtDate = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number): string => fmtDate(new Date(toDate(s).getTime() + n * 86400000));
/** 0 = Sunday … 6 = Saturday */
export const dow = (s: string): number => toDate(s).getUTCDay();
/** Monday of the week containing s (ISO week). */
export const weekStart = (s: string): string => addDays(s, -((dow(s) + 6) % 7));
export const monthStart = (s: string): string => s.slice(0, 7) + "-01";
export const diffDays = (a: string, b: string): number => Math.round((toDate(a).getTime() - toDate(b).getTime()) / 86400000);

export function todayLocal(): string {
  const n = new Date();
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
}

export function shortDate(s: string): string {
  const d = toDate(s);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
export function longDate(s: string): string {
  const d = toDate(s);
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function monthLabel(s: string): string {
  const d = toDate(s);
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
}
export const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function* eachDay(from: string, to: string): Generator<string> {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d;
}
