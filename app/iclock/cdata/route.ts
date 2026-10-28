import { readStore, weekdaysBeforeReturn, writeStore } from "@/lib/store";
import type { Punch } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function plain(body: string, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

function values(request: Request) {
  return new URL(request.url).searchParams;
}

function acceptDevice(request: Request) {
  const expected = process.env.ZKTECO_DEVICE_SN;
  const serial = values(request).get("SN") || "";
  return { accepted: !!expected && serial === expected, configured: !!expected, serial };
}

function touchDevice(serial: string) {
  const store = readStore();
  store.device.lastSeen = new Date().toISOString();
  store.device.serial = serial;
  writeStore(store);
}

export async function GET(request: Request) {
  const device = acceptDevice(request);
  if (!device.configured) return plain("Device receiver is not configured.", 503);
  if (!device.accepted) return plain("Device not allowed.", 403);
  touchDevice(device.serial);
  if (values(request).get("table")?.toUpperCase() === "ATTLOG") return plain("OK");
  const options = [
    `GET OPTION FROM: ${device.serial}`, "Stamp=0", "OpStamp=0", "PhotoStamp=0",
    "ErrorDelay=30", "Delay=10", "TransTimes=00:00;14:05", "TransInterval=1",
    "TransFlag=1111000000", "TimeZone=5", "Realtime=1", "Encrypt=0",
    "ServerVer=2.2.14 20171127", "",
  ].join("\n");
  return plain(options);
}

function parseDeviceTime(value: string) {
  const match = value.trim().replace("T", " ").match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = "00"] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")} ${hour.padStart(2, "0")}:${minute}:${second}`;
}

export async function POST(request: Request) {
  const device = acceptDevice(request);
  if (!device.configured) return plain("Device receiver is not configured.", 503);
  if (!device.accepted) return plain("Device not allowed.", 403);
  const body = await request.text();
  const store = readStore();
  store.device.lastSeen = new Date().toISOString();
  store.device.serial = device.serial;
  if (values(request).get("table")?.toUpperCase() !== "ATTLOG") {
    writeStore(store);
    return plain("OK");
  }

  for (const line of body.split(/\r?\n/).filter(Boolean)) {
    const fields = line.split("\t");
    if (fields.length < 2) continue;
    const pin = fields[0].trim();
    const timestamp = parseDeviceTime(fields[1]);
    if (!pin || !timestamp) continue;
    const state = Number.parseInt(fields[2] || "0", 10);
    const punch: Punch = { id: `${device.serial}:${pin}:${timestamp}:${Number.isFinite(state) ? state : 0}`, serial: device.serial, pin, timestamp, state: Number.isFinite(state) ? state : 0, verify: fields[3]?.trim() || "", workCode: fields[4]?.trim() || "" };
    if (store.punches.some((item) => item.id === punch.id)) continue;
    store.punches.push(punch);
    store.device.count += 1;

    // Status 0 is the terminal's normal check-in event. On that return punch,
    // close an approved leave covering that day (including an early return).
    if (punch.state === 0) {
      const employee = store.people.find((person) => person.devicePin === pin || person.id === pin);
      if (employee) for (const leave of store.leaves) {
        if (leave.employeeId === employee.id && leave.status === "Approved" && timestamp.slice(0, 10) >= leave.start) {
          leave.status = "Completed";
          leave.returnedAt = timestamp;
          leave.usedDays = Math.min(leave.days, weekdaysBeforeReturn(leave.start, timestamp.slice(0, 10)));
        }
      }
    }
  }
  writeStore(store);
  return plain("OK");
}
