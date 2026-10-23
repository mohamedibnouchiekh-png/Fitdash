// Usage:  npm run import -- ~/Downloads/export.zip
// Imports an Apple Health export (zip, unzipped folder, or export.xml) into the local FitDash database.
import { importHealthExport } from "../src/server/importer/index.ts";
import { dbPath } from "../src/server/db.ts";

const file = process.argv[2];
if (!file || file === "--help" || file === "-h") {
  console.log("Usage: npm run import -- <path to export.zip | export.xml | unzipped apple_health_export folder>\n\nHealth app → profile picture → Export All Health Data creates the zip.");
  process.exit(file ? 0 : 1);
}

const started = Date.now();
try {
  const res = await importHealthExport(file, { progress: (p) => console.log(`[${((Date.now() - started) / 1000).toFixed(0)}s] ${p}`) });
  const s = res.summary;
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s → ${dbPath()}`);
  console.log(`  Export created:   ${s.exportDate ?? "unknown"}`);
  console.log(`  Days with data:   ${s.days} (${s.firstDay} → ${s.lastDay})`);
  console.log(`  Runs:             ${s.runs} (${s.runsWithRoute} with GPS splits, ${s.runsWithoutRoute} without)`);
  console.log(`  Strength:         ${s.strength}`);
  console.log(`  Duplicates:       ${s.duplicateWorkoutsDropped} duplicate workout recording(s) dropped`);
  const ig = Object.entries(s.ignoredWorkouts).map(([k, v]) => `${k} ×${v}`).join(", ");
  if (ig) console.log(`  Not imported:     ${ig} (other workout types)`);
  if (res.warnings.length) { console.log("\nThings to know:"); for (const w of res.warnings) console.log(`  - ${w}`); }
} catch (e) {
  console.error(`\nImport failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
