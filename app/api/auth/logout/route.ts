import { NextResponse } from "next/server";
import { expiredSessionCookie, isSameOrigin } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", expiredSessionCookie);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
