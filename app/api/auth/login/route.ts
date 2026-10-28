import { NextResponse } from "next/server";
import { isSameOrigin, sessionCookie, verifyAdminPassword } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!process.env.HAAZIR_ADMIN_PASSWORD || !process.env.HAAZIR_SESSION_SECRET) {
    return NextResponse.json({ error: "Admin sign-in is not configured on the office server." }, { status: 503 });
  }
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const body = await request.json().catch(() => null) as { password?: string } | null;
  if (!body?.password || !verifyAdminPassword(body.password)) {
    return NextResponse.json({ error: "Incorrect administrator password." }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", sessionCookie());
  return response;
}
