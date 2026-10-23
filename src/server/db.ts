// SQLite storage (node:sqlite, built into Node 22.18+; no native modules to compile).
// `process.getBuiltinModule` is used instead of `import "node:sqlite"` so the Next.js bundler never tries to resolve it.
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync as DB } from "node:sqlite";

const SCHEMA_VERSION = 1;

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE day (
    date TEXT PRIMARY KEY,           -- local calendar day YYYY-MM-DD (the day as written in the export, i.e. the timezone the iPhone was in)
    kcal_in REAL, protein REAL, carbs REAL, fat REAL,
    active_kcal REAL, resting_kcal REAL, steps REAL,
    resting_hr REAL, hrv REAL, vo2max REAL, resp_rate REAL,
    sleep_min REAL, deep_min REAL, rem_min REAL, bedtime_min REAL,
    sources TEXT                      -- JSON: which Health source each metric was taken from
  );
  CREATE TABLE run (
    id TEXT PRIMARY KEY,              -- stable external id: "ah:<ISO start time>"
    date TEXT NOT NULL, start_time TEXT NOT NULL, start_ts INTEGER NOT NULL, end_ts INTEGER NOT NULL,
    distance_km REAL NOT NULL, duration_sec REAL NOT NULL, elev_gain REAL,
    avg_hr REAL, max_hr REAL,
    splits TEXT NOT NULL, hr_series TEXT NOT NULL,
    source TEXT NOT NULL, indoor INTEGER NOT NULL DEFAULT 0, elev_source TEXT
  );
  CREATE INDEX run_date ON run(date);
  CREATE TABLE strength (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL, start_ts INTEGER NOT NULL, end_ts INTEGER NOT NULL,
    duration_min REAL NOT NULL, active_kcal REAL, avg_hr REAL, max_hr REAL,
    type TEXT NOT NULL, source TEXT NOT NULL
  );
  CREATE INDEX strength_date ON strength(date);
  CREATE TABLE import_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL, finished_at TEXT,
    kind TEXT NOT NULL, file_name TEXT, file_bytes INTEGER,
    status TEXT NOT NULL,             -- running | ok | error
    summary TEXT,                     -- JSON counts
    warnings TEXT,                    -- JSON string[]
    error TEXT
  );
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
  `,
];

// Kept on globalThis: Next.js may load route modules separately in dev, and they must share one connection.
const g = globalThis as unknown as { __fitdashDb?: DB | null };

export function dbPath(): string {
  return process.env.FITDASH_DB ?? path.join(process.cwd(), "data", "fitdash.db");
}

export function getDb(): DB {
  if (g.__fitdashDb) return g.__fitdashDb;
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  const file = dbPath();
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new DatabaseSync(file);
  d.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(d);
  g.__fitdashDb = d;
  return d;
}

/** Test helper: open a separate database (e.g. ":memory:") and make it the active one. */
export function openDbForTest(file: string): DB {
  closeDb();
  process.env.FITDASH_DB = file;
  return getDb();
}
export function closeDb(): void { if (g.__fitdashDb) { g.__fitdashDb.close(); g.__fitdashDb = null; } }

function migrate(d: DB): void {
  d.exec("CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)");
  const row = d.prepare("SELECT MAX(v) AS v FROM schema_version").get() as { v: number | null };
  let v = row.v ?? 0;
  if (v > SCHEMA_VERSION) throw new Error(`Database schema v${v} is newer than this app (v${SCHEMA_VERSION}). Update the app.`);
  while (v < SCHEMA_VERSION) {
    d.exec("BEGIN");
    try {
      d.exec(MIGRATIONS[v]);
      v += 1;
      d.prepare("INSERT INTO schema_version (v) VALUES (?)").run(v);
      d.exec("COMMIT");
    } catch (e) { d.exec("ROLLBACK"); throw e; }
  }
}

export function kvGet<T>(key: string): T | null {
  const r = getDb().prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  if (!r) return null;
  try { return JSON.parse(r.value) as T; } catch { return null; }
}
export function kvSet(key: string, value: unknown): void {
  getDb().prepare("INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .run(key, JSON.stringify(value), new Date().toISOString());
}
