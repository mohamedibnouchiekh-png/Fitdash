import { guard, json } from "@/server/guard";
import { readDataset } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const refused = guard(req);
  if (refused) return refused;
  try { return json(readDataset()); }
  catch (e) { return json({ error: e instanceof Error ? e.message : "Database error" }, 500); }
}
