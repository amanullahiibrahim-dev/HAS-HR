import { NextResponse } from "next/server";
import { isAdmin, isSameOrigin } from "@/lib/auth";
import { createSystemUser, deleteSystemUser, listSystemUsers, SystemUserError, updateSystemUser } from "@/lib/system-users";

export const runtime = "nodejs";

const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  if (!isAdmin(request)) return json({ error: "Only the Administrator can manage system users." }, 403);
  return json({ users: listSystemUsers() });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  if (!isAdmin(request)) return json({ error: "Only the Administrator can manage system users." }, 403);
  const body = await request.json().catch(() => null) as { action?: string; id?: string; name?: unknown; username?: unknown; password?: unknown; disabled?: unknown } | null;
  try {
    if (body?.action === "create") createSystemUser(body);
    else if (body?.action === "update") updateSystemUser(body.id, { name: body.name, password: body.password, disabled: body.disabled });
    else if (body?.action === "delete") deleteSystemUser(body.id);
    else return json({ error: "Unknown action." }, 400);
  } catch (error) {
    if (error instanceof SystemUserError) return json({ error: error.message }, error.status);
    throw error;
  }
  return json({ users: listSystemUsers() });
}
