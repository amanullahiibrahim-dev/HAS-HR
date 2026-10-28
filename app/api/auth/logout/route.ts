import { NextResponse } from "next/server";
import { expiredSessionCookie, isAdmin } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAdmin(request)) return NextResponse.json({ ok: true });
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", expiredSessionCookie);
  return response;
}
