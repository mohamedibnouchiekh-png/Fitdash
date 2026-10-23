import { guard, json } from "@/server/guard";
import { readXlsx } from "@/server/importer/xlsx";
import { parsePlanGrid } from "@/lib/planImport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024;

/** Body = the raw .xlsx file. Nothing is stored; the parsed result is returned for preview. */
export async function POST(req: Request) {
  const refused = guard(req, { mutating: true });
  if (refused) return refused;
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length < 100) return json({ error: "The file is empty." }, 400);
  if (bytes.length > MAX_BYTES) return json({ error: "The file is larger than 15 MB." }, 413);
  try {
    const sheets = readXlsx(bytes);
    const parsed = sheets.map((s) => parsePlanGrid(s.grid, s.name)).sort((a, b) => b.sessions.length - a.sessions.length);
    const best = parsed[0];
    if (!best || best.sessions.length === 0) {
      return json({ error: "No weekly tracking sheet found. FitDash looks for a sheet with an \"Exercise\" column and \"Week1, Week2 …\" columns." }, 422);
    }
    return json({ sheetNames: sheets.map((s) => s.name), plan: best });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Could not read the file." }, 400);
  }
}
