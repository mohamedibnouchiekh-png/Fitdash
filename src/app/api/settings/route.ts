import { guard, json } from "@/server/guard";
import { loadSettings, saveSettings } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const refused = guard(req);
  if (refused) return refused;
  return json({ settings: loadSettings() });
}

export async function PUT(req: Request) {
  const refused = guard(req, { mutating: true });
  if (refused) return refused;
  let body: { settings?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Body must be JSON." }, 400); }
  if (body.settings !== null && (typeof body.settings !== "object" || Array.isArray(body.settings))) return json({ error: "settings must be an object or null." }, 400);
  saveSettings(body.settings);
  return json({ ok: true });
}
