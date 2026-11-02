import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

export class PasswordRecoveryError extends Error { constructor(message: string, public status = 400) { super(message); } }

export type EmailRecovery = { id: string; recipientDigest: string; codeDigest?: string; expiresAt: number; attempts: number; status: "pending" | "sent" | "verified"; grantDigest?: string; grantExpiresAt?: number };
export type Credentials = { emailRecovery?: EmailRecovery; emailRecoveryRequests?: number[]; version: 1; password?: { salt: string; hash: string }; passwordChangedAt?: string; recovery?: { digest: string; expiresAt: number; attempts: number } };
export function credentialsPath() {
  return path.join(path.dirname(process.env.HAAZIR_DB_PATH || path.join(process.cwd(), "data", "haazir-data.json")), "admin-auth.json");
}
export function readCredentials(): Credentials {
  let raw: string;
  try { raw = fs.readFileSync(credentialsPath(), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1 }; throw error; }
  const data = JSON.parse(raw) as Credentials;
  if (data.version !== 1 || (data.password && (!/^[a-f0-9]{32}$/.test(data.password.salt) || !/^[a-f0-9]{128}$/.test(data.password.hash))) ||
      (data.recovery && (!/^[a-f0-9]{64}$/.test(data.recovery.digest) || !Number.isSafeInteger(data.recovery.expiresAt) || !Number.isInteger(data.recovery.attempts) || data.recovery.attempts < 0))) throw new Error("Invalid administrator credential storage.");
  return data;
}
function writeCredentials(data: Credentials) {
  const file = credentialsPath(), temporary = file + "." + randomUUID() + ".tmp";
  try { fs.writeFileSync(temporary, JSON.stringify(data), { mode: 0o600, flag: "wx" }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
export function updateCredentials<T>(change: (data: Credentials) => T): T {
  const file = credentialsPath(); fs.mkdirSync(path.dirname(file), { recursive: true });
  let lock: number;
  try { lock = fs.openSync(file + ".lock", "wx", 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new PasswordRecoveryError("Another recovery request is in progress. Try again shortly.", 409); throw error; }
  try { const data = readCredentials(); const result = change(data); writeCredentials(data); return result; }
  finally { fs.closeSync(lock); fs.unlinkSync(file + ".lock"); }
}
export function setSavedPassword(data: Credentials, password: unknown) {
  if (typeof password !== "string" || password.length < 8 || password.length > 128 || !password.trim()) throw new PasswordRecoveryError("Use a new password between 8 and 128 characters.");
  const salt = randomBytes(16).toString("hex");
  data.password = { salt, hash: scryptSync(password, salt, 64).toString("hex") };
  data.passwordChangedAt = new Date().toISOString(); delete data.recovery; delete data.emailRecovery;
}
export function adminCredentialVersion() { return readCredentials().password?.hash || process.env.HAAZIR_ADMIN_PASSWORD || ""; }
export function checkAdminPassword(input: unknown) {
  if (typeof input !== "string" || input.length > 1024) return false;
  const saved = readCredentials().password;
  if (saved) return timingSafeEqual(scryptSync(input, saved.salt, 64), Buffer.from(saved.hash, "hex"));
  const expected = process.env.HAAZIR_ADMIN_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(input), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function resetAdminPassword(code: unknown, password: unknown) {
  if (typeof password !== "string" || password.length < 8 || password.length > 128 || !password.trim()) throw new PasswordRecoveryError("Use a new password between 8 and 128 characters.");
  if (typeof code !== "string" || code.length > 256 || !code.trim()) throw new PasswordRecoveryError("Enter your recovery code.");
  const file = credentialsPath(); fs.mkdirSync(path.dirname(file), { recursive: true });
  let lock: number;
  try { lock = fs.openSync(file + ".lock", "wx", 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new PasswordRecoveryError("Another recovery request is in progress. Try again shortly."); throw error; }
  try {
    const data = readCredentials(), recovery = data.recovery;
    if (!recovery || recovery.expiresAt <= Date.now() || recovery.attempts >= 5) throw new PasswordRecoveryError("Invalid or expired recovery code. Ask the server administrator for a new code.");
    const digest = createHash("sha256").update(code.trim()).digest();
    if (!timingSafeEqual(digest, Buffer.from(recovery.digest, "hex"))) {
      recovery.attempts++; writeCredentials(data);
      throw new PasswordRecoveryError("Invalid or expired recovery code. Ask the server administrator for a new code.");
    }
    setSavedPassword(data, password);
    writeCredentials(data);
  } finally { fs.closeSync(lock); fs.unlinkSync(file + ".lock"); }
}
