// Builds a small but realistic SYNTHETIC Apple Health export (same structure as the real one, including the DOCTYPE
// header, Correlation wrappers, multiple sources and GPX routes) with answers worked out by hand. Nothing here is real data.
import { zipSync, strToU8 } from "fflate";

const WATCH = "Test Apple Watch";
const PHONE = "Test iPhone";
const MFP = "MyFitnessPal";

const rec = (type: string, source: string, unit: string, start: string, end: string, value: number | string) =>
  `<Record type="${type}" sourceName="${source}" sourceVersion="1" unit="${unit}" creationDate="${end}" startDate="${start}" endDate="${end}" value="${value}"/>`;
const cat = (source: string, value: string, start: string, end: string) =>
  `<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="${source}" sourceVersion="1" creationDate="${end}" startDate="${start}" endDate="${end}" value="HKCategoryValueSleepAnalysis${value}"/>`;
const Q = (n: string) => `HKQuantityTypeIdentifier${n}`;
const t = (day: string, time: string) => `${day} ${time} +0200`;

// ---- GPX: a straight line north at constant speed, one point every 5 s, climbing 1 m per 100 m ----
const R = 6371008.8;
const M_PER_DEG = (R * Math.PI) / 180;
function gpx(startIsoZ: string, seconds: number, speedMs: number): string {
  const t0 = Date.parse(startIsoZ);
  const pts: string[] = [];
  for (let s = 0; s <= seconds; s += 5) {
    const d = s * speedMs;
    pts.push(`<trkpt lat="${(50.85 + d / M_PER_DEG).toFixed(7)}" lon="4.3500000"><ele>${(100 + d * 0.01).toFixed(2)}</ele><time>${new Date(t0 + s * 1000).toISOString().replace(".000", "")}</time></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Apple Health Export"><trk><name>Route</name><trkseg>\n${pts.join("\n")}\n</trkseg></trk></gpx>`;
}

export const ROUTE_A = "route_2026-10-14_6.00pm.gpx";
export const ROUTE_B = "route_2026-10-18_8.00am.gpx";

export function buildExportXml(): string {
  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
<!-- HealthKit Export Version: 14 -->
<!ELEMENT HealthData (ExportDate,Me,(Record|Correlation|Workout|ActivitySummary)*)>
<!ATTLIST HealthData
  locale CDATA #REQUIRED
>
<!ELEMENT ExportDate EMPTY>
<!ATTLIST ExportDate
  value CDATA #REQUIRED
>
<!ELEMENT Record ((MetadataEntry)*)>
<!ATTLIST Record
  type          CDATA #REQUIRED
  unit          CDATA #IMPLIED
  value         CDATA #IMPLIED
  sourceName    CDATA #REQUIRED
>
]>
<HealthData locale="en_BE">
 <ExportDate value="2026-10-19 21:55:12 +0200"/>
 <Me HKCharacteristicTypeIdentifierBiologicalSex="HKBiologicalSexNotSet"/>`);

  // ---- Steps: Watch has priority hour by hour; phone-only hours still count ----
  const D = "2026-10-15";
  out.push(rec(Q("StepCount"), PHONE, "count", t(D, "10:05:00"), t(D, "10:30:00"), 1000));
  out.push(rec(Q("StepCount"), WATCH, "count", t(D, "10:10:00"), t(D, "10:20:00"), 800));
  out.push(rec(Q("StepCount"), PHONE, "count", t(D, "11:00:00"), t(D, "11:10:00"), 500));      // phone only → counts
  out.push(rec(Q("StepCount"), WATCH, "count", t(D, "12:00:00"), t(D, "12:10:00"), 200));
  out.push(rec(Q("StepCount"), PHONE, "count", t(D, "12:00:00"), t(D, "12:10:00"), 600));      // bigger, but Watch wins
  out.push(rec(Q("StepCount"), PHONE, "count", t("2026-10-17", "09:00:00"), t("2026-10-17", "09:30:00"), 4000)); // phone-only day
  // ---- Energy (Watch); one record in kJ ----
  out.push(rec(Q("ActiveEnergyBurned"), WATCH, "kcal", t(D, "10:00:00"), t(D, "10:30:00"), 50));
  out.push(rec(Q("ActiveEnergyBurned"), WATCH, "kcal", t(D, "11:00:00"), t(D, "11:30:00"), 70));
  out.push(rec(Q("ActiveEnergyBurned"), WATCH, "kJ", t(D, "15:00:00"), t(D, "15:30:00"), 418.4));
  out.push(rec(Q("BasalEnergyBurned"), WATCH, "kcal", t(D, "00:00:00"), t(D, "01:00:00"), 70));
  out.push(rec(Q("BasalEnergyBurned"), WATCH, "kcal", t(D, "01:00:00"), t(D, "02:00:00"), 70));
  // ---- Recovery metrics ----
  out.push(rec(Q("RestingHeartRate"), WATCH, "count/min", t(D, "09:00:00"), t(D, "09:00:00"), 55));
  out.push(rec(Q("RestingHeartRate"), WATCH, "count/min", t(D, "20:00:00"), t(D, "20:00:00"), 57));
  out.push(rec(Q("HeartRateVariabilitySDNN"), WATCH, "ms", t(D, "03:00:00"), t(D, "03:00:00"), 40));
  out.push(rec(Q("HeartRateVariabilitySDNN"), WATCH, "ms", t(D, "05:00:00"), t(D, "05:00:00"), 50));
  out.push(rec(Q("VO2Max"), WATCH, "mL/min·kg", t(D, "08:00:00"), t(D, "08:00:00"), 44.1));
  out.push(rec(Q("VO2Max"), WATCH, "mL/min·kg", t(D, "18:00:00"), t(D, "18:00:00"), 44.5));
  out.push(rec(Q("RespiratoryRate"), WATCH, "count/min", t(D, "02:00:00"), t(D, "02:00:00"), 14));
  out.push(rec(Q("RespiratoryRate"), WATCH, "count/min", t(D, "04:00:00"), t(D, "04:00:00"), 15));

  // ---- Nutrition. Two foods are wrapped in Correlations AND also listed top-level (as Apple does); the third is top-level only, in kJ.
  const food = (src: string, start: string, kcal: number, p: number, c: number, f: number) => [
    rec(Q("DietaryEnergyConsumed"), src, "kcal", start, start, kcal), rec(Q("DietaryProtein"), src, "g", start, start, p),
    rec(Q("DietaryCarbohydrates"), src, "g", start, start, c), rec(Q("DietaryFatTotal"), src, "g", start, start, f),
  ];
  for (const [start, k, p, c, f] of [[t(D, "08:00:00"), 300, 20, 40, 8], [t(D, "12:30:00"), 600, 40, 60, 20]] as const) {
    const inner = food(MFP, start, k, p, c, f);
    out.push(`<Correlation type="HKCorrelationTypeIdentifierFood" sourceName="${MFP}" sourceVersion="1" creationDate="${start}" startDate="${start}" endDate="${start}">\n${inner.join("\n")}\n</Correlation>`);
    out.push(...inner); // the same records again at top level
  }
  out.push(rec(Q("DietaryEnergyConsumed"), MFP, "kJ", t(D, "19:00:00"), t(D, "19:00:00"), 418.4));
  out.push(rec(Q("DietaryEnergyConsumed"), "Lose It!", "kcal", t(D, "13:00:00"), t(D, "13:00:00"), 50)); // other app: MyFitnessPal is preferred
  out.push(rec(Q("DietaryEnergyConsumed"), MFP, "kcal", t("2026-10-16", "09:00:00"), t("2026-10-16", "09:00:00"), 250)); // two identical-looking foods at different times are both real
  out.push(rec(Q("DietaryEnergyConsumed"), MFP, "kcal", t("2026-10-16", "15:00:00"), t("2026-10-16", "15:00:00"), 250));

  // ---- Sleep: Watch has stages; AutoSleep overlaps it; a 30-min nap; an iPhone-only night with no stages ----
  out.push(cat(WATCH, "InBed", t("2026-10-15", "22:40:00"), t("2026-10-16", "06:50:00")));
  out.push(cat(WATCH, "AsleepCore", t("2026-10-15", "23:00:00"), t("2026-10-16", "02:00:00")));
  out.push(cat(WATCH, "AsleepDeep", t("2026-10-16", "02:00:00"), t("2026-10-16", "03:00:00")));
  out.push(cat(WATCH, "AsleepREM", t("2026-10-16", "03:00:00"), t("2026-10-16", "04:00:00")));
  out.push(cat(WATCH, "AsleepCore", t("2026-10-16", "04:00:00"), t("2026-10-16", "06:30:00")));
  out.push(cat("AutoSleep", "Asleep", t("2026-10-15", "23:10:00"), t("2026-10-16", "06:20:00")));
  out.push(cat(WATCH, "AsleepUnspecified", t("2026-10-17", "14:00:00"), t("2026-10-17", "14:30:00")));
  out.push(cat(PHONE, "Asleep", t("2026-10-18", "00:00:00"), t("2026-10-18", "07:00:00")));

  // ---- Heart rate samples: Run A window (140 bpm for 10 min, then 160), strays outside it, and another app's samples inside it ----
  const a0 = Date.parse("2026-10-14T16:00:00Z");
  const local = (ms: number) => {
    const d = new Date(ms + 2 * 3600000).toISOString();
    return `${d.slice(0, 10)} ${d.slice(11, 19)} +0200`;
  };
  for (let s = 0; s < 1200; s += 5) out.push(rec(Q("HeartRate"), WATCH, "count/min", local(a0 + s * 1000), local(a0 + s * 1000), s < 600 ? 140 : 160));
  out.push(rec(Q("HeartRate"), WATCH, "count/min", local(a0 - 300000), local(a0 - 300000), 90));
  out.push(rec(Q("HeartRate"), WATCH, "count/min", local(a0 + 1800000), local(a0 + 1800000), 90));
  out.push(rec(Q("HeartRate"), "Strava", "count/min", local(a0 + 60000), local(a0 + 60000), 100));

  // ---- Workouts (Apple writes them after the records) ----
  const wk = (a: Record<string, string | number>, children: string) =>
    `<Workout ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(" ")}>\n${children}\n</Workout>`;
  const route = (file: string) => `<WorkoutRoute sourceName="${WATCH}" sourceVersion="1" creationDate="2026-10-14 18:21:00 +0200" startDate="2026-10-14 18:00:00 +0200" endDate="2026-10-14 18:20:00 +0200">\n<MetadataEntry key="HKMetadataKeySyncVersion" value="2"/>\n<FileReference path="/workout-routes/${file}"/>\n</WorkoutRoute>`;
  const stats = (avg: number, max: number) => `<WorkoutStatistics type="${Q("HeartRate")}" startDate="2026-10-14 18:00:00 +0200" endDate="2026-10-14 18:20:00 +0200" average="${avg}" minimum="100" maximum="${max}" unit="count/min"/>`;

  // Run A: 20 min, 3.5 km reported (GPS says 3.6 km → calibrated), Apple elevation 30 m
  out.push(wk({ workoutActivityType: "HKWorkoutActivityTypeRunning", duration: 20, durationUnit: "min", totalDistance: 3.5, totalDistanceUnit: "km", totalEnergyBurned: 250, totalEnergyBurnedUnit: "kcal", sourceName: WATCH, sourceVersion: "1", creationDate: t("2026-10-14", "18:21:00"), startDate: t("2026-10-14", "18:00:00"), endDate: t("2026-10-14", "18:20:00") },
    `<MetadataEntry key="HKIndoorWorkout" value="0"/>\n<MetadataEntry key="HKElevationAscended" value="3000 cm"/>\n${stats(150, 165)}\n${route(ROUTE_A)}`));
  // Same run also recorded by another app → duplicate
  out.push(wk({ workoutActivityType: "HKWorkoutActivityTypeRunning", duration: 19.67, durationUnit: "min", totalDistance: 3.52, totalDistanceUnit: "km", sourceName: "Strava", sourceVersion: "1", creationDate: t("2026-10-14", "18:21:00"), startDate: t("2026-10-14", "18:00:30"), endDate: t("2026-10-14", "18:20:10") }, ""));
  // Treadmill run: no route
  out.push(wk({ workoutActivityType: "HKWorkoutActivityTypeRunning", duration: 30, durationUnit: "min", totalDistance: 5, totalDistanceUnit: "km", totalEnergyBurned: 320, totalEnergyBurnedUnit: "kcal", sourceName: WATCH, sourceVersion: "1", creationDate: t("2026-10-16", "07:31:00"), startDate: t("2026-10-16", "07:00:00"), endDate: t("2026-10-16", "07:30:00") },
    `<MetadataEntry key="HKIndoorWorkout" value="1"/>\n<WorkoutStatistics type="${Q("HeartRate")}" average="140" minimum="100" maximum="155" unit="count/min"/>`));
  // Running workout with no distance at all → skipped with a warning
  out.push(wk({ workoutActivityType: "HKWorkoutActivityTypeRunning", duration: 10, durationUnit: "min", sourceName: WATCH, sourceVersion: "1", creationDate: t("2026-10-17", "07:11:00"), startDate: t("2026-10-17", "07:00:00"), endDate: t("2026-10-17", "07:10:00") }, ""));
  // Run B: 2.0 km at exactly 5:00/km, no Apple elevation (→ GPS elevation), no heart-rate data
  out.push(wk({ workoutActivityType: "HKWorkoutActivityTypeRunning", duration: 10, durationUnit: "min", totalDistance: 2, totalDistanceUnit: "km", sourceName: WATCH, sourceVersion: "1", creationDate: t("2026-10-18", "08:11:00"), startDate: t("2026-10-18", "08:00:00"), endDate: t("2026-10-18", "08:10:00") },
    `<MetadataEntry key="HKIndoorWorkout" value="0"/>\n${route(ROUTE_B)}`));
  // Strength
  out.push(wk({ workoutActivityType: "HKWorkoutActivityTypeTraditionalStrengthTraining", duration: 45, durationUnit: "min", totalEnergyBurned: 250, totalEnergyBurnedUnit: "kcal", sourceName: WATCH, sourceVersion: "1", creationDate: t("2026-10-13", "07:46:00"), startDate: t("2026-10-13", "07:00:00"), endDate: t("2026-10-13", "07:45:00") },
    `<WorkoutStatistics type="${Q("HeartRate")}" average="112" minimum="80" maximum="148" unit="count/min"/>`));
  // Cycling: not a supported type
  out.push(wk({ workoutActivityType: "HKWorkoutActivityTypeCycling", duration: 40, durationUnit: "min", totalDistance: 15, totalDistanceUnit: "km", sourceName: WATCH, sourceVersion: "1", creationDate: t("2026-10-15", "17:41:00"), startDate: t("2026-10-15", "17:00:00"), endDate: t("2026-10-15", "17:40:00") }, ""));

  out.push("</HealthData>");
  return out.join("\n");
}

export function buildGpxFiles(): Record<string, string> {
  return {
    [ROUTE_A]: gpx("2026-10-14T16:00:00Z", 1200, 3),            // 3 m/s for 20 min = 3600 m raw GPS distance
    [ROUTE_B]: gpx("2026-10-18T06:00:00Z", 600, 2000 / 600),    // 2000 m in 10 min = 5:00/km
  };
}

export function buildZip(): Uint8Array {
  const files: Record<string, Uint8Array> = { "apple_health_export/export.xml": strToU8(buildExportXml()), "apple_health_export/export_cda.xml": strToU8("<ClinicalDocument/>") };
  for (const [name, text] of Object.entries(buildGpxFiles())) files[`apple_health_export/workout-routes/${name}`] = strToU8(text);
  return zipSync(files);
}
