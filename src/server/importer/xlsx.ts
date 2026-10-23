// Minimal .xlsx reader: returns each worksheet as a grid of values (text, numbers). No macros, no formulas evaluated.
// An .xlsx file is a zip of XML files; we only need the sheet list, the shared strings and the cell values.
import { unzipSync, strFromU8 } from "fflate";
import sax from "sax";
import type { Cell } from "../../lib/planImport.ts";

export interface Sheet { name: string; grid: Cell[][] }

const colIndex = (ref: string): number => {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};
const rowIndex = (ref: string): number => Number(ref.match(/\d+/)?.[0] ?? 1) - 1;

function walk(xml: string, onOpen: (name: string, attrs: Record<string, string>) => void, onText: (t: string) => void, onClose: (name: string) => void) {
  const p = sax.parser(true, { trim: false, normalize: false });
  p.onopentag = (n) => onOpen(n.name, n.attributes as Record<string, string>);
  p.ontext = onText;
  p.oncdata = onText;
  p.onclosetag = onClose;
  p.write(xml).close();
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = []; let cur = "", inT = false, inSi = false;
  walk(xml,
    (n) => { if (n === "si") { inSi = true; cur = ""; } else if (n === "t" && inSi) inT = true; },
    (t) => { if (inT) cur += t; },
    (n) => { if (n === "t") inT = false; else if (n === "si") { out.push(cur); inSi = false; } });
  return out;
}

function readSheet(xml: string, strings: string[]): Cell[][] {
  const grid: Cell[][] = [];
  let ref = "", type = "", v = "", inV = false, inIs = false, inT = false, isText = "";
  walk(xml,
    (n, a) => {
      if (n === "c") { ref = a.r ?? ""; type = a.t ?? ""; v = ""; isText = ""; }
      else if (n === "v") inV = true;
      else if (n === "is") inIs = true;
      else if (n === "t" && inIs) inT = true;
    },
    (t) => { if (inV) v += t; else if (inT) isText += t; },
    (n) => {
      if (n === "v") inV = false;
      else if (n === "t") inT = false;
      else if (n === "is") inIs = false;
      else if (n === "c" && ref) {
        let val: Cell = null;
        if (type === "s") val = strings[Number(v)] ?? null;
        else if (type === "inlineStr") val = isText;
        else if (type === "str") val = v;
        else if (type === "b") val = v === "1";
        else if (type === "e") val = null;
        else if (v !== "") { const num = Number(v); val = Number.isFinite(num) ? num : v; }
        if (val !== null && val !== "") {
          const r = rowIndex(ref), c = colIndex(ref);
          (grid[r] ??= [])[c] = val;
        }
        ref = "";
      }
    });
  for (let r = 0; r < grid.length; r++) grid[r] ??= [];
  return grid;
}

export function readXlsx(bytes: Uint8Array): Sheet[] {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { throw new Error("That file is not a valid .xlsx workbook."); }
  const text = (p: string) => (files[p] ? strFromU8(files[p]) : undefined);
  const wb = text("xl/workbook.xml");
  if (!wb) throw new Error("That file is not a valid .xlsx workbook.");
  const rels = new Map<string, string>();
  const relsXml = text("xl/_rels/workbook.xml.rels");
  if (relsXml) walk(relsXml, (n, a) => { if (n === "Relationship") rels.set(a.Id, a.Target); }, () => {}, () => {});
  const sheets: { name: string; target: string }[] = [];
  walk(wb, (n, a) => { if (n === "sheet") { const id = a["r:id"]; const t = rels.get(id) ?? `worksheets/sheet${sheets.length + 1}.xml`; sheets.push({ name: a.name, target: t }); } }, () => {}, () => {});
  const strings = sharedStrings(text("xl/sharedStrings.xml"));
  return sheets.map((s) => {
    const path = s.target.startsWith("/") ? s.target.slice(1) : `xl/${s.target}`;
    const xml = text(path);
    return { name: s.name, grid: xml ? readSheet(xml, strings) : [] };
  });
}
