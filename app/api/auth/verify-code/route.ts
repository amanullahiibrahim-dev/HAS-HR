import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/auth";
import { PasswordRecoveryError } from "@/lib/admin-credentials";
import { verifyEmailRecovery, emailGrantCookie } from "@/lib/email-recovery";
import { recoveryRequestBody } from "@/lib/recovery-request";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const json = (body: object, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!isSameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  try {
    const body = await recoveryRequestBody(request);
    const token = verifyEmailRecovery(body?.email, body?.code);
    const response = json({ ok: true }, 200); response.headers.set("Set-Cookie", emailGrantCookie(token)); return response;
  } catch (error) { return json({ error: error instanceof PasswordRecoveryError ? error.message : "Unable to process recovery. Contact the server administrator." }, error instanceof PasswordRecoveryError ? error.status : 500); }
}
