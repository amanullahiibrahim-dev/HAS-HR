import { NextResponse } from "next/server";
import { expiredSessionCookie, isSameOrigin } from "@/lib/auth";
import { PasswordRecoveryError, resetAdminPassword } from "@/lib/admin-credentials";
import { emailGrantCookie, emailGrantFromRequest, resetWithEmailGrant } from "@/lib/email-recovery";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const json = (body: object, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!isSameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  if (!process.env.HAAZIR_SESSION_SECRET) return json({ error: "Administrator sign-in is not configured on this server." }, 503);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "Enter your recovery code and new password." }, 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 4096) { await reader.cancel(); return json({ error: "Request is too large." }, 413); } chunks.push(value); }
  } catch { return json({ error: "Unable to read the recovery request." }, 400); }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return json({ error: "Invalid recovery request." }, 400); }
  try {
    if (typeof body?.code === "string") resetAdminPassword(body.code, body?.password); // Offline emergency recovery remains available to the server operator.
    else resetWithEmailGrant(emailGrantFromRequest(request), body?.password);
  }
  catch (error) { return json({ error: error instanceof PasswordRecoveryError ? error.message : "Unable to reset password. Contact the server administrator." }, error instanceof PasswordRecoveryError ? error.status : 500); }
  const response = json({ ok: true }, 200); response.headers.append("Set-Cookie", expiredSessionCookie); response.headers.append("Set-Cookie", emailGrantCookie("", true)); return response;
}
