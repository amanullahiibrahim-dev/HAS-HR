import { NextResponse } from "next/server";
import { currentSession, expiredSessionCookie, isSameOrigin, sessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

// Called by user activity and valid reloads. Background data polling never renews a session.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = currentSession(request);
  if (!session) {
    return NextResponse.json({ error: "Your session has expired. Please sign in again." }, {
      status: 401, headers: { "Set-Cookie": expiredSessionCookie, "Cache-Control": "no-store" }
    });
  }
  return NextResponse.json({ ok: true }, {
    headers: { "Set-Cookie": sessionCookie(session), "Cache-Control": "no-store" }
  });
}
