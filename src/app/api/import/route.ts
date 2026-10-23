import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { guard, json } from "@/server/guard";
import { importHealthExport, importState } from "@/server/importer/index";
import { getDb } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

/** Status of the current / last import (the UI polls this while a large file is processed). */
export async function GET(req: Request) {
  const refused = guard(req);
  if (refused) return refused;
  getDb();
  return json(importState());
}

/** Body = the raw export.zip (or export.xml). The upload is stored temporarily, imported in the background, then deleted. */
export async function POST(req: Request) {
  const refused = guard(req, { mutating: true });
  if (refused) return refused;
  if (importState().running) return json({ error: "An import is already running." }, 409);
  if (!req.body) return json({ error: "No file received." }, 400);

  const rawName = decodeURIComponent(req.headers.get("x-filename") ?? "export.zip");
  const ext = /\.xml$/i.test(rawName) ? ".xml" : ".zip";
  const dir = path.join(process.cwd(), "data", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `upload-${Date.now()}${ext}`);
  try {
    await pipeline(Readable.fromWeb(req.body as never), fs.createWriteStream(tmp));
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    return json({ error: `Upload failed: ${e instanceof Error ? e.message : "unknown error"}` }, 400);
  }
  const bytes = fs.statSync(tmp).size;
  if (bytes < 100) { fs.rmSync(tmp, { force: true }); return json({ error: "The file is empty." }, 400); }

  // Fire and forget: the result (or error) is recorded in import_log and shown by the UI.
  importHealthExport(tmp, { fileName: path.basename(rawName), fileBytes: bytes })
    .catch(() => { /* already recorded in import_log */ })
    .finally(() => fs.rmSync(tmp, { force: true }));
  return json({ started: true, bytes }, 202);
}
