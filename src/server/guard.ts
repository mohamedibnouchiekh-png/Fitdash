// FitDash is a single-user local app. These checks stop other websites (or other machines) from talking to its API.
import { NextResponse } from "next/server";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/** Returns an error response when the request should be refused, otherwise null. */
export function guard(req: Request, opts: { mutating?: boolean } = {}): NextResponse | null {
  const host = req.headers.get("host") ?? "";
  if (!LOCAL_HOST.test(host) && process.env.FITDASH_ALLOW_REMOTE !== "1") {
    return NextResponse.json({ error: "FitDash only answers requests addressed to localhost." }, { status: 403 });
  }
  if (opts.mutating && req.headers.get("x-fitdash") !== "1") {
    return NextResponse.json({ error: "Missing x-fitdash header." }, { status: 403 });
  }
  return null;
}
export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
