import fs from "node:fs";
import path from "node:path";

export type Staff = {
  id: string;
  name: string;
  dept: string;
  role: "Teacher" | "Admin Staff";
  devicePin: string;
  annual: number;
  medical: number;
  casual: number;
  workStart: string;
};

export type Leave = {
  id: string;
  employeeId: string;
  name: string;
  type: "Annual" | "Medical" | "Casual";
  start: string;
  end: string;
  days: number;
  usedDays?: number;
  reason: string;
  status: "Approved" | "Pending" | "Completed" | "Declined";
  returnedAt?: string;
};

export type Punch = {
  id: string;
  serial: string;
  pin: string;
  timestamp: string;
  state: number;
  verify: string;
  workCode: string;
};

export type Store = {
  people: Staff[];
  leaves: Leave[];
  punches: Punch[];
  device: { lastSeen: string | null; serial: string | null; count: number };
};

const dbPath = process.env.HAAZIR_DB_PATH || path.join(process.cwd(), "data", "haazir-data.json");

function freshStore(): Store {
  return { people: [], leaves: [], punches: [], device: { lastSeen: null, serial: null, count: 0 } };
}

export function readStore(): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(dbPath, "utf8")) as Partial<Store>;
    return { people: parsed.people || [], leaves: parsed.leaves || [], punches: parsed.punches || [], device: { ...freshStore().device, ...parsed.device } };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return freshStore();
  }
}

export function writeStore(store: Store): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const temporaryPath = `${dbPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(temporaryPath, dbPath);
}

export function makeId(): string {
  return globalThis.crypto.randomUUID();
}

export function weekdaysBeforeReturn(start: string, returnDate: string) {
  let days = 0;
  for (const date = new Date(`${start}T00:00:00Z`); date < new Date(`${returnDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) {
    const weekday = date.getUTCDay();
    if (weekday > 0 && weekday < 6) days += 1;
  }
  return days;
}

export function stateForClient(store = readStore()) {
  const grouped = new Map<string, Punch[]>();
  for (const punch of store.punches) {
    const staff = store.people.find((person) => person.devicePin === punch.pin || person.id === punch.pin);
    if (!staff) continue;
    const key = `${staff.id}:${punch.timestamp.slice(0, 10)}`;
    grouped.set(key, [...(grouped.get(key) || []), punch]);
  }
  const attendance = [...grouped.values()].map((items) => {
    const sorted = items.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const first = sorted[0];
    const staff = store.people.find((person) => person.devicePin === first.pin || person.id === first.pin)!;
    const last = sorted.at(-1)!;
    const checkIn = first.timestamp.slice(11, 16);
    const checkOut = last.id === first.id ? "—" : last.timestamp.slice(11, 16);
    return { name: staff.name, date: first.timestamp.slice(0, 10), checkIn, checkOut, status: checkIn > staff.workStart ? "Late" : "Present", source: first.serial === "Manual" ? "Manual" : "iClock990" };
  }).sort((a, b) => `${b.date} ${b.checkIn}`.localeCompare(`${a.date} ${a.checkIn}`));
  const lastSeen = store.device.lastSeen;
  const online = !!lastSeen && Date.now() - new Date(lastSeen).getTime() < 5 * 60 * 1000;
  return { people: store.people, leaves: store.leaves, attendance, device: { ...store.device, online } };
}
