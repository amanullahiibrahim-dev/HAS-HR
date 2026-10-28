import { readStore, writeStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const serial = new URL(request.url).searchParams.get("SN") || "";
  const expected = process.env.ZKTECO_DEVICE_SN;
  if (!expected) return new Response("Device receiver is not configured.", { status: 503 });
  if (serial !== expected) return new Response("Device not allowed.", { status: 403 });
  const store = readStore();
  store.device.lastSeen = new Date().toISOString();
  store.device.serial = serial;
  writeStore(store);
  return new Response("OK", { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
