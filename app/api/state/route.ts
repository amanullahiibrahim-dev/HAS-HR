import { NextResponse } from "next/server";
import { isAdmin, isSameOrigin } from "@/lib/auth";
import { makeId, readStore, stateForClient, writeStore } from "@/lib/store";
import type { Leave, Punch, Staff } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isAdmin(request)) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  return NextResponse.json(stateForClient());
}

export async function POST(request: Request) {
  if (!isAdmin(request)) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload || typeof payload.action !== "string") return NextResponse.json({ error: "A valid action is required." }, { status: 400 });
  const store = readStore();

  if (payload.action === "employee.create") {
    const input = payload.employee as Partial<Staff> | undefined;
    if (!input?.id?.trim() || !input.name?.trim() || !input.devicePin?.trim()) return NextResponse.json({ error: "Employee name, employee ID, and machine PIN are required." }, { status: 400 });
    if (store.people.some((p) => p.id.toLowerCase() === input.id!.trim().toLowerCase() || p.devicePin === input.devicePin!.trim())) return NextResponse.json({ error: "That employee ID or machine PIN is already assigned." }, { status: 409 });
    store.people.push({ id: input.id.trim(), name: input.name.trim(), dept: input.dept?.trim() || "", role: input.role === "Teacher" ? "Teacher" : "Admin Staff", devicePin: input.devicePin.trim(), annual: Math.max(0, Number(input.annual) || 0), medical: Math.max(0, Number(input.medical) || 0), casual: Math.max(0, Number(input.casual) || 0), workStart: /^\d\d:\d\d$/.test(input.workStart || "") ? input.workStart! : "09:00" });
  } else if (payload.action === "employee.balance") {
    const input = payload.employee as Partial<Staff> | undefined;
    const person = store.people.find((p) => p.id === input?.id);
    if (!person) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    for (const key of ["annual", "medical", "casual"] as const) {
      const value = Number(input?.[key]);
      if (!Number.isFinite(value) || value < 0) return NextResponse.json({ error: "Leave balances must be non-negative numbers." }, { status: 400 });
      person[key] = value;
    }
  } else if (payload.action === "leave.create" || payload.action === "leave.update") {
    const input = payload.leave as Partial<Leave> | undefined;
    const existing = payload.action === "leave.update" ? store.leaves.find((item) => item.id === payload.id) : undefined;
    if (payload.action === "leave.update" && !existing) return NextResponse.json({ error: "Leave record not found." }, { status: 404 });
    if (existing && !["Approved", "Pending"].includes(existing.status)) return NextResponse.json({ error: "Only approved or pending leave can be edited." }, { status: 409 });
    const person = store.people.find((p) => p.id === input?.employeeId);
    if (!person || !input?.start || !input.end || input.end < input.start || !Number.isFinite(Number(input.days)) || Number(input.days) <= 0) return NextResponse.json({ error: "Choose an employee and valid leave dates and days." }, { status: 400 });
    if (!input.type || !["Annual", "Medical", "Casual"].some((type) => type === input.type)) return NextResponse.json({ error: "Choose a valid leave type." }, { status: 400 });
    const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    if (!validDate(input.start) || !validDate(input.end) || !["Approved", "Pending"].includes(String(input.status))) return NextResponse.json({ error: "Choose valid dates and an Approved or Pending status." }, { status: 400 });
    const record = { employeeId: person.id, name: person.name, type: input.type as Leave["type"], start: input.start, end: input.end, days: Number(input.days), reason: typeof input.reason === "string" ? input.reason.trim() : "", status: input.status as Leave["status"] };
    if (existing) Object.assign(existing, record);
    else store.leaves.unshift({ id: makeId(), ...record });
  } else if (payload.action === "leave.decision") {
    const leave = store.leaves.find((item) => item.id === payload.id);
    if (!leave || !["Approved", "Declined"].includes(String(payload.status))) return NextResponse.json({ error: "Leave request not found." }, { status: 404 });
    if (leave.status !== "Pending") return NextResponse.json({ error: "Only pending requests can be reviewed." }, { status: 409 });
    leave.status = payload.status as Leave["status"];
  } else if (payload.action === "leave.adjust") {
    const leave = store.leaves.find((item) => item.id === payload.id);
    const usedDays = Number(payload.usedDays);
    if (!leave || leave.status !== "Completed") return NextResponse.json({ error: "Completed leave record not found." }, { status: 404 });
    if (!Number.isFinite(usedDays) || usedDays < 0 || usedDays > leave.days) return NextResponse.json({ error: "Used leave days must be between zero and the recorded leave days." }, { status: 400 });
    leave.usedDays = usedDays;
  } else if (payload.action === "attendance.manual") {
    const input = payload.entry as { employeeId?: string; date?: string; checkIn?: string; checkOut?: string; status?: string } | undefined;
    const person = store.people.find((p) => p.id === input?.employeeId);
    if (!input || !person || !/^\d{4}-\d\d-\d\d$/.test(input.date || "") || !/^\d\d:\d\d$/.test(input.checkIn || "")) return NextResponse.json({ error: "Choose an employee and enter a valid date and check-in time." }, { status: 400 });
    const pin = person.devicePin;
    store.punches = store.punches.filter((p) => !(p.pin === pin && p.timestamp.slice(0, 10) === input.date));
    store.punches.push({ id: `manual:${makeId()}`, serial: "Manual", pin, timestamp: `${input.date} ${input.checkIn}:00`, state: 0, verify: "", workCode: "" });
    if (/^\d\d:\d\d$/.test(input.checkOut || "")) store.punches.push({ id: `manual:${makeId()}`, serial: "Manual", pin, timestamp: `${input.date} ${input.checkOut}:00`, state: 1, verify: "", workCode: "" });
  } else {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  writeStore(store);
  return NextResponse.json(stateForClient(store));
}
