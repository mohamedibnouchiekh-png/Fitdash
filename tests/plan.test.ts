import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { assignDates, cleanExercise, parseCell, parsePlanGrid, type Cell } from "../src/lib/planImport.ts";
import { readXlsx } from "../src/server/importer/xlsx.ts";
import { muscleGroup } from "../src/lib/lifts.ts";

const ctx = (targetReps: number, ref: number | null = null) => ({ targetReps, ref });
const one = (raw: Cell, c = ctx(5)) => { const r = parseCell(raw, c); return { ...r, set: r.sets[0] }; };

describe("cell notations", () => {
  test("plain loads, as numbers or text, use the target reps", () => {
    assert.deepEqual(one(110).set, { reps: 5, kg: 110 });
    assert.deepEqual(one("7.5").set, { reps: 5, kg: 7.5 });
    assert.equal(one("7.5").status, "ok");
    assert.deepEqual(one("70 cable").set, { reps: 5, kg: 70 });
    assert.deepEqual(one("10 each side").set, { reps: 5, kg: 10 });
  });
  test("empty cells and X are not sets", () => {
    assert.equal(parseCell(null, ctx(5)).sets.length, 0);
    assert.equal(parseCell("X", ctx(5)).sets.length, 0);
  });
  test("reps × kg is told apart from kg × reps using the plan's target", () => {
    assert.deepEqual(one("4x80", ctx(5, 70)).set, { reps: 4, kg: 80 });          // 80 reps is impossible
    assert.deepEqual(one("16x8", ctx(10, 14)).set, { reps: 8, kg: 16 });          // 16 kg is close to the usual load
    assert.deepEqual(one("10x4", ctx(15, 5)).set, { reps: 10, kg: 4 });
    assert.deepEqual(one("8x30", ctx(5, 30)).set, { reps: 8, kg: 30 });
  });
  test("a drop set inside one set is counted once, at the heaviest load, when the parts add up to the target reps", () => {
    assert.deepEqual(one("80x3-70x2", ctx(5, 70)).set, { reps: 3, kg: 80 });
    assert.deepEqual(one("12x35-8x27.5", ctx(20, 32)).set, { reps: 12, kg: 35 });   // reps first
    assert.deepEqual(one("21.5x10-17.5x10", ctx(20, 20)).set, { reps: 10, kg: 21.5 }); // kg first
    assert.deepEqual(one("8x10-6x10", ctx(20, 5)).set, { reps: 10, kg: 8 });
    assert.equal(parseCell("80x3-70x2", ctx(5, 70)).sets.length, 1);
  });
  test("added loads are summed", () => {
    assert.deepEqual(one("50+2.5").set, { reps: 5, kg: 52.5 });
    assert.deepEqual(one("50+5kg").set, { reps: 5, kg: 55 });
  });
  test("two loads in one set are counted at the heavier one and flagged", () => {
    const r = one("30/20", ctx(20));
    assert.deepEqual(r.set, { reps: 20, kg: 30 });
    assert.equal(r.status, "assumed");
    assert.deepEqual(one("6\\4", ctx(20)).set, { reps: 20, kg: 6 });
    assert.deepEqual(one("5–5", ctx(15)).set, { reps: 15, kg: 5 });
  });
  test("gibberish is reported, never guessed", () => {
    assert.equal(parseCell("8x12-8x6x-4x6", ctx(20)).status, "unreadable");
    assert.equal(parseCell("heavy", ctx(5)).status, "unreadable");
  });
});

describe("exercise names", () => {
  test("set × rep notes are removed and spacing is tidied", () => {
    assert.deepEqual(cleanExercise("Romanian Deadlift (RDL) (3×5) "), { name: "Romanian Deadlift (RDL)", reps: 5, sets: 3 });
    assert.deepEqual(cleanExercise("Leg Curl (×12 reps)"), { name: "Leg Curl", reps: 12, sets: null });
    assert.deepEqual(cleanExercise("Shoulder dumbel Press 3 x10 resp"), { name: "Shoulder dumbel Press", reps: 10, sets: 3 });
    assert.equal(cleanExercise("Incline Press ( hammer machine )").name, "Incline Press (hammer machine)");
  });
  test("muscle groups are inferred from the name", () => {
    const g = (n: string) => muscleGroup(n);
    assert.equal(g("Leg Curl"), "Legs"); assert.equal(g("Overhead Triceps Extension"), "Arms"); assert.equal(g("EZ-Bar Biceps Curl"), "Arms");
    assert.equal(g("Rear Delt Face Pulls"), "Shoulders"); assert.equal(g("Lat Pulldown"), "Back"); assert.equal(g("Pec Deck"), "Chest");
    assert.equal(g("Shoulder dumbel Press"), "Shoulders"); assert.equal(g("Smith Machine Squat"), "Legs"); assert.equal(g("Mystery move"), "Other");
  });
});

// A small sheet in the same shape as the real template.
const GRID: Cell[][] = [
  [],
  [null, "Fitness Weekly Tracking"],
  [],
  [null, "Exercise", "Week1", "Week2", "Week3", "Week4"],
  ["Day 1", "PHASE 1 (3×5) — kg"],
  [null, "Squat Machine", 5, 7.5, 100, 105],
  [null, null, 5, 10, 100, 110],
  [null, null, 5, 12.5, 100, "4x112.5"],
  [null, "Curl Machine (×12 reps)", 20, 20, 25, "X"],
  [null, null, 20, 25, 25, 30],
  ["Day 2", "PHASE 1 (3×5) — kg"],
  [null, "Bench Press", null, 40, 42.5, 45],
  [null, null, null, 40, 42.5, 45],
  [],
  [null, "Daily Stats Track"],
  [null, "Date", "Body Weight (kg)"],
  [null, "Squat Machine", 999],
  [null, null, null, null, null, null, null, null, null, null, null, "Mardi", "Full Body"],
  [null, null, null, null, null, null, null, null, null, null, null, "Mercredi", "Run"],
  [null, null, null, null, null, null, null, null, null, null, null, "Jeudi", "Full Body"],
];

describe("sheet parsing", () => {
  const p = parsePlanGrid(GRID, "T");
  test("finds weeks, days and sessions, and stops at the daily-stats section", () => {
    assert.deepEqual(p.weeks, [1, 2, 3, 4]);
    assert.deepEqual(p.days, [1, 2]);
    assert.equal(p.sessions.length, 4 + 4 + 3); // squat 4 wks, curl 4 wks, bench 3 wks
    assert.ok(!p.sessions.some((s) => s.sets.some((x) => x.kg === 999)));
  });
  test("reps come from the phase heading, or the exercise label when it says so", () => {
    assert.equal(p.sessions.find((s) => s.exercise === "Squat Machine")!.sets[0].reps, 5);
    assert.equal(p.sessions.find((s) => s.exercise === "Curl Machine")!.sets[0].reps, 12);
  });
  test("an X leaves that set out; the other set in the week stays", () => {
    const w4 = p.sessions.find((s) => s.exercise === "Curl Machine" && s.week === 4)!;
    assert.deepEqual(w4.sets, [{ reps: 12, kg: 30 }]);
    assert.equal(p.skippedSets, 1);
  });
  test("a sudden load jump marks the earlier weeks as suspect, and says so", () => {
    const early = p.sessions.filter((s) => s.exercise === "Squat Machine");
    assert.deepEqual(early.map((s) => !!s.suspect), [true, true, false, false]);
    assert.ok(p.flags.some((f) => f.kind === "suspect" && f.exercise === "Squat Machine"));
  });
  test("the weekday schedule block maps Day 1, Day 2 to Tue, Thu", () => {
    assert.deepEqual(p.schedule, { 1: 2, 2: 4 });
  });
  test("a sheet without Week columns is not mistaken for a plan", () => {
    assert.equal(parsePlanGrid([["a", "b"], [1, 2]]).sessions.length, 0);
  });
});

describe("dates", () => {
  const p = parsePlanGrid(GRID);
  test("Week 1 Monday + weekday offsets; ids are stable so a re-import replaces", () => {
    const e = assignDates(p.sessions, { week1Monday: "2026-08-31", dayWeekday: { 1: 2, 2: 4 } });
    const squat = e.filter((x) => x.exercise === "Squat Machine").map((x) => x.date);
    assert.deepEqual(squat, ["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22"]); // Tuesdays
    assert.equal(e.find((x) => x.exercise === "Bench Press")!.date, "2026-09-10");       // Thursday of week 2
    const again = assignDates(p.sessions, { week1Monday: "2026-08-31", dayWeekday: { 1: 2, 2: 4 } });
    assert.deepEqual(e.map((x) => x.id), again.map((x) => x.id));
    assert.equal(new Set(e.map((x) => x.id)).size, e.length);
    assert.ok(e.every((x) => x.source === "plan"));
  });
  test("Sunday is the last day of the week", () => {
    const e = assignDates(p.sessions, { week1Monday: "2026-08-31", dayWeekday: { 1: 0, 2: 1 } });
    assert.equal(e.find((x) => x.exercise === "Squat Machine" && x.sets[0].kg === 5 && x.date.startsWith("2026-09-06"))?.date, "2026-09-06");
  });
});

describe("xlsx reader", () => {
  const sheetXml = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
    <row r="1"><c r="B1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Day 1</t></is></c><c r="B2"><v>12.5</v></c><c r="D2" t="s"><v>2</v></c></row></sheetData></worksheet>`;
  const files = {
    "xl/workbook.xml": strToU8(`<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/sharedStrings.xml": strToU8(`<sst><si><t>Exercise</t></si><si><r><t>Week</t></r><r><t>1</t></r></si><si><t>80x3-70x2</t></si></sst>`),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml),
  };
  test("reads shared strings, inline strings and numbers into the right cells", () => {
    const [s] = readXlsx(zipSync(files));
    assert.equal(s.name, "Data");
    assert.deepEqual(s.grid[0].slice(1, 3), ["Exercise", "Week1"]);
    assert.equal(s.grid[1][0], "Day 1");
    assert.equal(s.grid[1][1], 12.5);
    assert.equal(s.grid[1][3], "80x3-70x2");
  });
  test("rejects a file that is not a workbook", () => {
    assert.throws(() => readXlsx(new Uint8Array([1, 2, 3, 4])), /not a valid/);
    assert.throws(() => readXlsx(zipSync({ "hello.txt": strToU8("hi") })), /not a valid/);
  });
});
