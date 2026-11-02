import type { Punch } from "./store";
export type PunchKind = "attendance-in" | "attendance-out" | "overtime-in" | "overtime-out" | "break-in" | "break-out";
const labels: Record<string, PunchKind> = { "ATT IN":"attendance-in", "ATT OUT":"attendance-out", "ATT & OT IN":"attendance-in", "ATT & OT OUT":"attendance-out", "OT IN":"overtime-in", "OT OUT":"overtime-out", "BREAK IN":"break-in", "BREAK OUT":"break-out" };
const kinds = new Set(Object.values(labels));
export function normalizedPunchKind(kind: unknown, eventType: unknown): PunchKind | undefined {
  if (kind !== undefined && (typeof kind !== "string" || !kinds.has(kind as PunchKind))) throw new Error("Unsupported punch kind.");
  if (eventType !== undefined && (typeof eventType !== "string" || !labels[eventType.trim().toUpperCase().replace(/\s+/g," ")])) throw new Error("Unsupported attendance event type.");
  const labelled = typeof eventType === "string" ? labels[eventType.trim().toUpperCase().replace(/\s+/g," ")] : undefined;
  if (kind && labelled && kind !== labelled) throw new Error("Punch kind and event type disagree.");
  return (kind as PunchKind | undefined) || labelled;
}
export function dayPunches(punches: Punch[]) {
  const sorted = punches.slice().sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
  const ins = sorted.filter(p=>p.kind === "attendance-in"), outs = sorted.filter(p=>p.kind === "attendance-out");
  if (ins.length || outs.length) {
    const firstIn = ins[0];
    const lastOut = outs.filter(p=>!firstIn || p.timestamp > firstIn.timestamp).at(-1);
    return { checkIn: firstIn?.timestamp, checkOut: lastOut?.timestamp, note: !firstIn ? "Checkout received; attendance check-in is missing." : !lastOut ? "Attendance check-in received; checkout is missing." : "", inferred: false };
  }
  const untyped = sorted.filter(p=>!p.kind);
  return { checkIn:undefined, checkOut:undefined, note:untyped.length ? "Unlabelled machine punches cannot establish arrival or departure. Review the original logs or record an audited correction." : "Only overtime/break punches received; attendance IN/OUT is missing.", inferred:false };
}
