import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { buildExportXml, buildGpxFiles, buildZip, ROUTE_A, ROUTE_B } from "./fixture.ts";
import { openDbForTest, closeDb, getDb } from "../src/server/db.ts";
import { importHealthExport, type ImportResult } from "../src/server/importer/index.ts";
import { readDataset } from "../src/server/repo.ts";
import { parseTs } from "../src/server/importer/healthExport.ts";
import { buildRoute, cumulativeGain, parseGpx } from "../src/server/importer/gpx.ts";

const near = (a: number | null | undefined, b: number, tol: number, msg?: string) => {
  assert.ok(a !== null && a !== undefined && Math.abs(a - b) <= tol, msg ?? `expected ${a} to be within ${tol} of ${b}`);
};
const row = (sql: string, ...p: (string | number)[]) => getDb().prepare(sql).get(...p) as Record<string, unknown>;
const all = (sql: string, ...p: (string | number)[]) => getDb().prepare(sql).all(...p) as Record<string, unknown>[];

describe("timestamps", () => {
  test("parses Apple's format into absolute time, local day and hour bucket", () => {
    const t = parseTs("2026-10-14 18:00:00 +0200")!;
    assert.equal(t.day, "2026-10-14");
    assert.equal(t.hour, "2026-10-14T18");
    assert.equal(t.hhmm, "18:00");
    assert.equal(new Date(t.abs).toISOString(), "2026-10-14T16:00:00.000Z");
  });
  test("the local day is the day as written, not the UTC day", () => {
    assert.equal(parseTs("2026-10-15 00:30:00 +0200")!.day, "2026-10-15"); // 22:30Z on the 14th
  });
  test("rejects garbage", () => assert.equal(parseTs("yesterday"), null));
});

describe("GPX route maths", () => {
  test("hysteresis ignores sensor noise but counts a real climb", () => {
    assert.equal(cumulativeGain([100, 101, 100, 101, 100, 101, 100]).at(-1), 0);
    near(cumulativeGain([100, 103, 106, 109, 112]).at(-1), 12, 0.001);
  });
  test("a long stop is removed from moving time, and splits still add up", () => {
    const base = Date.parse("2026-10-14T16:00:00Z");
    const R = 6371008.8, deg = (R * Math.PI) / 180;
    const pts: { t: number; lat: number; lon: number; ele: number | null }[] = [];
    let t = base, d = 0;
    for (let i = 0; i <= 200; i++) { pts.push({ t, lat: 50 + d / deg, lon: 4, ele: null }); t += 5000; d += 15; }   // 3 km at 3 m/s
    pts.push({ t: t + 120000, lat: 50 + d / deg, lon: 4, ele: null });                                            // stood still for 2 minutes
    const r = buildRoute(pts)!;
    near(r.movingSec, 1000, 1);                         // 200 × 5 s, the 120 s stop excluded
    assert.equal(r.splits.length, 3);
    for (const s of r.splits) near(s.paceSec, 333, 1);
  });
  test("GPS distance is calibrated to the distance Apple reports", () => {
    const g = parseGpx(buildGpxFiles()[ROUTE_A]);
    const r = buildRoute(g, { reportedDistanceKm: 3.5 })!;
    near(r.rawDistanceKm, 3.6, 0.001);
    near(r.distanceKm, 3.5, 0.001);
    near(r.scale, 3.5 / 3.6, 0.0001);
  });
  test("an implausible calibration (>10% off) is ignored rather than applied", () => {
    const r = buildRoute(parseGpx(buildGpxFiles()[ROUTE_A]), { reportedDistanceKm: 5 })!;
    assert.equal(r.scale, 1);
  });
  test("too short to be a run → no result", () => {
    assert.equal(buildRoute([{ t: 0, lat: 1, lon: 1, ele: null }, { t: 5000, lat: 1.0001, lon: 1, ele: null }]), null);
  });
});

describe("importing a full export zip", () => {
  let tmp: string, zipPath: string, result: ImportResult;
  before(async () => {
    openDbForTest(":memory:");
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fitdash-test-"));
    zipPath = path.join(tmp, "export.zip");
    fs.writeFileSync(zipPath, buildZip());
    result = await importHealthExport(zipPath);
  });
  after(() => { closeDb(); fs.rmSync(tmp, { recursive: true, force: true }); });

  test("summary counts", () => {
    const s = result.summary;
    assert.equal(s.runs, 3);
    assert.equal(s.runsWithRoute, 2);
    assert.equal(s.runsWithoutRoute, 1);
    assert.equal(s.strength, 1);
    assert.equal(s.duplicateWorkoutsDropped, 1);
    assert.deepEqual(s.ignoredWorkouts, { Cycling: 1 });
    assert.equal(s.exportDate, "2026-10-19 21:55:12 +0200");
  });

  test("steps: Watch wins each hour, phone-only hours still count, nothing is added twice", () => {
    const d = row("SELECT * FROM day WHERE date='2026-10-15'");
    assert.equal(d.steps, 800 + 500 + 200);           // 10h Watch 800, 11h phone 500, 12h Watch 200 (phone's 600 ignored)
    assert.equal(row("SELECT steps, sources FROM day WHERE date='2026-10-17'").steps, 4000);
  });

  test("energy: kJ converted, Watch values summed", () => {
    const d = row("SELECT * FROM day WHERE date='2026-10-15'");
    near(d.active_kcal as number, 220, 1);             // 50 + 70 + 418.4 kJ (=100 kcal)
    assert.equal(d.resting_kcal, 140);
  });

  test("recovery metrics: mean for resting HR / HRV / respiratory rate, last value for VO₂ max", () => {
    const d = row("SELECT * FROM day WHERE date='2026-10-15'");
    assert.equal(d.resting_hr, 56);
    assert.equal(d.hrv, 45);
    assert.equal(d.resp_rate, 14.5);
    assert.equal(d.vo2max, 44.5);
  });

  test("nutrition: records seen twice (Correlation + top-level) count once; MyFitnessPal beats other apps; kJ converted", () => {
    const d = row("SELECT * FROM day WHERE date='2026-10-15'");
    near(d.kcal_in as number, 1000, 1);                // 300 + 600 + 418.4 kJ (100 kcal); Lose It!'s 50 ignored
    assert.equal(d.protein, 60);
    assert.equal(d.carbs, 100);
    assert.equal(d.fat, 28);
    assert.equal(JSON.parse(d.sources as string).nutrition, "MyFitnessPal");
  });

  test("nutrition: two separate foods with the same calories at different times are both kept", () => {
    const d = row("SELECT * FROM day WHERE date='2026-10-16'");
    assert.equal(d.kcal_in, 500);
    assert.equal(d.protein, null);                      // no macros were logged → missing, not zero
  });

  test("sleep: Watch stages are used, overlapping other apps are not added, bedtime is relative to midnight", () => {
    const d = row("SELECT * FROM day WHERE date='2026-10-16'");
    assert.equal(d.sleep_min, 450);
    assert.equal(d.deep_min, 60);
    assert.equal(d.rem_min, 60);
    assert.equal(d.bedtime_min, -60);                   // fell asleep 23:00 the evening before
    assert.equal(JSON.parse(d.sources as string).sleep, "Test Apple Watch");
  });

  test("sleep: a night without stage data has no deep/REM (null, not zero)", () => {
    const d = row("SELECT * FROM day WHERE date='2026-10-18'");
    assert.equal(d.sleep_min, 420);
    assert.equal(d.deep_min, null);
    assert.equal(d.rem_min, null);
    assert.equal(d.bedtime_min, 0);
  });

  test("sleep: a 30-minute nap is not a night", () => {
    assert.equal(row("SELECT sleep_min FROM day WHERE date='2026-10-17'").sleep_min, null);
    assert.ok(result.warnings.some((w) => /treated as naps/.test(w)));
  });

  test("run A: GPS splits calibrated to the reported distance, Apple elevation preferred, heart rate from the Watch only", () => {
    const r = row("SELECT * FROM run WHERE date='2026-10-14'");
    assert.equal(r.distance_km, 3.5);
    assert.equal(r.duration_sec, 1200);
    assert.equal(r.start_time, "18:00");
    assert.equal(r.elev_gain, 30);
    assert.equal(r.elev_source, "apple");
    assert.equal(r.avg_hr, 150);
    assert.equal(r.max_hr, 165);
    assert.equal(r.source, "Test Apple Watch");
    assert.match(r.id as string, /^ah:2026-10-14T16:00:00\.000Z$/);
    const splits = JSON.parse(r.splits as string) as { km: number; distKm: number; paceSec: number; hr: number | null }[];
    assert.equal(splits.length, 4);                     // 3 full km + a 0.5 km remainder
    assert.deepEqual(splits.map((s) => s.distKm), [1, 1, 1, 0.5]);
    for (const s of splits) assert.equal(s.paceSec, 343); // 1200 s / 3.5 km
    assert.equal(splits[0].hr, 140);
    assert.equal(splits[3].hr, 160);                    // Strava's stray 100 bpm sample and the out-of-window samples are ignored
    const series = JSON.parse(r.hr_series as string) as { t: number; hr: number }[];
    assert.equal(series.length, 80);
    assert.equal(series[0].hr, 140);
    assert.equal(series.at(-1)!.hr, 160);
  });

  test("run B: GPS elevation is used when Apple gave none, and missing heart rate stays missing", () => {
    const r = row("SELECT * FROM run WHERE date='2026-10-18'");
    assert.equal(r.elev_source, "gps");
    near(r.elev_gain as number, 20, 2);                 // climbs 1 m per 100 m over 2 km
    assert.equal(r.avg_hr, null);
    assert.equal(r.max_hr, null);
    assert.equal(r.hr_series, "[]");
    const splits = JSON.parse(r.splits as string) as { paceSec: number }[];
    assert.equal(splits.length, 2);
    for (const s of splits) near(s.paceSec, 300, 1);
  });

  test("treadmill run: kept for distance/pace/HR, but has no splits", () => {
    const r = row("SELECT * FROM run WHERE date='2026-10-16'");
    assert.equal(r.distance_km, 5);
    assert.equal(r.indoor, 1);
    assert.equal(r.splits, "[]");
    assert.equal(r.avg_hr, 140);
    assert.ok(result.warnings.some((w) => /no GPS route/.test(w)));
  });

  test("a running workout with no distance is skipped with a warning, not stored as 0 km", () => {
    assert.equal(all("SELECT * FROM run WHERE date='2026-10-17'").length, 0);
    assert.ok(result.warnings.some((w) => /2026-10-17.*no distance/.test(w)));
  });

  test("strength session", () => {
    const s = row("SELECT * FROM strength WHERE date='2026-10-13'");
    assert.equal(s.duration_min, 45);
    assert.equal(s.active_kcal, 250);
    assert.equal(s.avg_hr, 112);
    assert.equal(s.max_hr, 148);
    assert.equal(s.type, "Traditional Strength Training");
  });

  test("the duplicate Strava recording is not stored", () => {
    assert.equal(all("SELECT * FROM run WHERE source='Strava'").length, 0);
    assert.equal(all("SELECT * FROM run").length, 3);
  });

  test("import is logged, and re-importing the same file changes nothing", async () => {
    const before = { days: all("SELECT * FROM day"), runs: all("SELECT * FROM run"), strength: all("SELECT * FROM strength") };
    const again = await importHealthExport(zipPath);
    assert.equal(again.summary.runs, 3);
    assert.deepEqual({ days: all("SELECT * FROM day"), runs: all("SELECT * FROM run"), strength: all("SELECT * FROM strength") }, before);
    const log = all("SELECT status FROM import_log ORDER BY id");
    assert.deepEqual(log.map((l) => l.status), ["ok", "ok"]);
  });

  test("readDataset returns the UI shape: missing values are undefined/null, never 0", () => {
    const { dataset, hasData, lastImport, counts } = readDataset();
    assert.equal(hasData, true);
    assert.deepEqual(counts, { days: dataset.days.length, runs: 3, strength: 1 });
    assert.equal(lastImport?.status, "ok");
    const d16 = dataset.days.find((d) => d.date === "2026-10-16")!;
    assert.equal(d16.kcalIn, 500);
    assert.equal(d16.protein, undefined);
    assert.equal(d16.restingHr, undefined);
    const rb = dataset.runs.find((r) => r.date === "2026-10-18")!;
    assert.equal(rb.avgHr, null);
    assert.equal(rb.elevSource, "gps");
    assert.equal(dataset.runs.find((r) => r.date === "2026-10-16")!.indoor, true);
    assert.deepEqual(dataset.runs.map((r) => r.date), ["2026-10-14", "2026-10-16", "2026-10-18"]); // chronological
  });
});

describe("other input forms", () => {
  let tmp: string;
  before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fitdash-test-")); });
  after(() => { closeDb(); fs.rmSync(tmp, { recursive: true, force: true }); });

  test("an unzipped folder gives the same result as the zip", async () => {
    const dir = path.join(tmp, "apple_health_export");
    fs.mkdirSync(path.join(dir, "workout-routes"), { recursive: true });
    fs.writeFileSync(path.join(dir, "export.xml"), buildExportXml());
    for (const [n, g] of Object.entries(buildGpxFiles())) fs.writeFileSync(path.join(dir, "workout-routes", n), g);
    openDbForTest(":memory:");
    const r = await importHealthExport(dir);
    assert.equal(r.summary.runsWithRoute, 2);
    assert.equal(JSON.parse(row("SELECT splits FROM run WHERE date='2026-10-14'").splits as string).length, 4);
  });

  test("export.xml alone works, but runs have no splits and the user is told why", async () => {
    const xml = path.join(tmp, "export.xml");
    fs.writeFileSync(xml, buildExportXml());
    openDbForTest(":memory:");
    const r = await importHealthExport(xml);
    assert.equal(r.summary.runs, 3);
    assert.equal(r.summary.runsWithRoute, 0);
    assert.ok(r.warnings.some((w) => /workout-routes folder/.test(w)));
    assert.equal(row("SELECT splits FROM run WHERE date='2026-10-14'").splits, "[]");
  });
});

describe("bad input fails clearly and leaves the database untouched", () => {
  let tmp: string;
  before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fitdash-test-")); openDbForTest(":memory:"); });
  after(() => { closeDb(); fs.rmSync(tmp, { recursive: true, force: true }); });

  const failing = async (file: string, pattern: RegExp) => {
    await assert.rejects(() => importHealthExport(file), pattern);
    assert.equal(all("SELECT * FROM day").length, 0);
    assert.equal(all("SELECT * FROM run").length, 0);
  };

  test("missing file", () => failing(path.join(tmp, "nope.zip"), /File not found/));
  test("not a zip", async () => {
    const f = path.join(tmp, "fake.zip"); fs.writeFileSync(f, "this is not a zip file at all");
    await failing(f, /Could not open the zip/);
  });
  test("zip without export.xml", async () => {
    const f = path.join(tmp, "empty.zip"); fs.writeFileSync(f, zipSync({ "readme.txt": strToU8("hi") }));
    await failing(f, /does not contain export\.xml/);
  });
  test("truncated / malformed XML", async () => {
    const f = path.join(tmp, "broken.xml"); fs.writeFileSync(f, buildExportXml().slice(0, 4000) + "<Record type=");
    await failing(f, /not valid XML|no health records/);
  });
  test("valid XML with no health data", async () => {
    const f = path.join(tmp, "blank.xml"); fs.writeFileSync(f, `<?xml version="1.0"?><HealthData locale="en"><ExportDate value="2026-01-01 00:00:00 +0000"/></HealthData>`);
    await failing(f, /no health records/);
  });
  test("failures are recorded in the import log", () => {
    const log = all("SELECT status, error FROM import_log");
    assert.ok(log.length >= 4);
    assert.ok(log.every((l) => l.status === "error" && typeof l.error === "string"));
  });
});
