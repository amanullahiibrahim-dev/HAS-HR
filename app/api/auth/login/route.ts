import { NextResponse } from "next/server";
import { adminSignInConfigured, expiredSessionCookie, isSameOrigin, sessionCookie, verifyAdminPassword } from "@/lib/auth";
import { checkSystemUserPassword, isAdministratorUsername } from "@/lib/system-users";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!adminSignInConfigured()) {
    return NextResponse.json({ error: "Admin sign-in is not configured on the office server." }, { status: 503 });
  }
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const body = await request.json().catch(() => null) as { username?: string; password?: string } | null;
  // A blank username (or "Administrator") signs in to the Administrator account as before.
  const administrator = isAdministratorUsername(body?.username);
  const user = administrator ? null : checkSystemUserPassword(body?.username, body?.password);
  if (administrator ? !verifyAdminPassword(body?.password) : !user) {
    const response = NextResponse.json({ error: administrator ? "Incorrect administrator password." : "Incorrect username or password." }, { status: 401 });
    response.headers.set("Set-Cookie", expiredSessionCookie);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", sessionCookie(user ? { kind: "user", id: user.id } : undefined));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
