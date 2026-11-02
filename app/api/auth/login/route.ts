import { NextResponse } from "next/server";
import { adminSignInConfigured, expiredSessionCookie, isSameOrigin, sessionCookie, verifyAdminPassword } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!adminSignInConfigured()) {
    return NextResponse.json({ error: "Admin sign-in is not configured on the office server." }, { status: 503 });
  }
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const body = await request.json().catch(() => null) as { password?: string } | null;
  if (!verifyAdminPassword(body?.password)) {
    const response = NextResponse.json({ error: "Incorrect administrator password." }, { status: 401 });
    response.headers.set("Set-Cookie", expiredSessionCookie);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", sessionCookie());
  response.headers.set("Cache-Control", "no-store");
  return response;
}
