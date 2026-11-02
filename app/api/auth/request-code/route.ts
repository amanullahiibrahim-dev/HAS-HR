import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/auth";
import { PasswordRecoveryError } from "@/lib/admin-credentials";
import { requestEmailRecovery } from "@/lib/email-recovery";
import { recoveryRequestBody } from "@/lib/recovery-request";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const json = (body: object, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!isSameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  try {
    const body = await recoveryRequestBody(request);
    await requestEmailRecovery(body?.email);
    return json({ ok: true, message: "If this is the registered recovery email, a code has been sent. Check your inbox and spam folder." }, 200);
  } catch (error) { return json({ error: error instanceof PasswordRecoveryError ? error.message : "Unable to process recovery. Contact the server administrator." }, error instanceof PasswordRecoveryError ? error.status : 500); }
}
