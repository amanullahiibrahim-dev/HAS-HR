import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual, createHash } from "node:crypto";
import { PasswordRecoveryError, setSavedPassword, updateCredentials } from "./admin-credentials";
import { gmailRecoveryConfiguration, sendRecoveryEmail } from "./recovery-mail";
const CODE_MS = 10 * 60 * 1000;
const GRANT_MS = 10 * 60 * 1000;
const invalidCode = () => new PasswordRecoveryError("Invalid or expired code. Request a new code and try again.");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function codeDigest(id: string, code: string) { return createHmac("sha256", process.env.HAAZIR_SESSION_SECRET!).update("haazir-email-code\0" + id + "\0" + code).digest("hex"); }
function equal(a: string, b: string) { return /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) && timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
function normalizedEmail(input: unknown) { return typeof input === "string" && input.length <= 254 ? input.trim().toLowerCase() : ""; }
export async function requestEmailRecovery(email: unknown) {
  const { recipient } = gmailRecoveryConfiguration();
  // Never send to an address supplied by an unauthenticated caller.
  if (normalizedEmail(email) !== recipient) return;
  const now = Date.now(), id = randomUUID(), code = String(randomInt(0, 1000000)).padStart(6, "0");
  updateCredentials(data => {
    const requests = (data.emailRecoveryRequests || []).filter(t => Number.isFinite(t) && t > now - 60 * 60 * 1000);
    if (requests.length >= 5 || requests.some(t => now - t < 60000)) throw new PasswordRecoveryError("Please wait before requesting another code. You can request one per minute and up to five per hour.", 429);
    data.emailRecoveryRequests = [...requests, now];
    data.emailRecovery = { id, recipientDigest: digest(recipient), codeDigest: codeDigest(id, code), expiresAt: now + CODE_MS, attempts: 0, status: "pending" };
  });
  try { await sendRecoveryEmail(code); }
  catch (error) { updateCredentials(data => { if (data.emailRecovery?.id === id) delete data.emailRecovery; }); throw error; }
  updateCredentials(data => { if (data.emailRecovery?.id === id) data.emailRecovery.status = "sent"; });
}
export function verifyEmailRecovery(email: unknown, code: unknown) {
  const { recipient } = gmailRecoveryConfiguration();
  if (normalizedEmail(email) !== recipient || typeof code !== "string" || code.length > 256) throw invalidCode();
  const grant = updateCredentials(data => {
    const record = data.emailRecovery;
    if (!record || record.status !== "sent" || record.expiresAt <= Date.now() || record.attempts >= 5 || !equal(record.recipientDigest, digest(recipient))) return null;
    if (!equal(record.codeDigest || "", codeDigest(record.id, code.trim()))) { record.attempts++; return null; }
    const token = randomBytes(32).toString("hex");
    record.status = "verified"; record.grantDigest = digest(token); record.grantExpiresAt = Date.now() + GRANT_MS; delete record.codeDigest;
    return token;
  });
  if (!grant) throw invalidCode();
  return grant;
}
export function resetWithEmailGrant(token: string | undefined, password: unknown) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new PasswordRecoveryError("Verify your email code before changing the password.");
  const { recipient } = gmailRecoveryConfiguration();
  updateCredentials(data => {
    const record = data.emailRecovery;
    if (!record || record.status !== "verified" || !record.grantExpiresAt || record.grantExpiresAt <= Date.now() || !equal(record.recipientDigest, digest(recipient)) || !equal(record.grantDigest || "", digest(token))) throw new PasswordRecoveryError("Your reset session expired. Request a new code.");
    setSavedPassword(data, password);
  });
}
export function emailGrantCookie(token: string, clear = false) { return `haazir_reset=${token}; Path=/api/auth/reset-password; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : GRANT_MS / 1000}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`; }
export function emailGrantFromRequest(request: Request) { return request.headers.get("cookie")?.split(";").map(s => s.trim()).find(s => s.startsWith("haazir_reset="))?.slice("haazir_reset=".length); }
