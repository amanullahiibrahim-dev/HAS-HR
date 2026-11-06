import { createHmac, timingSafeEqual } from "node:crypto";

import { adminCredentialVersion, checkAdminPassword } from "./admin-credentials";
import { findSystemUser } from "./system-users";

const cookieName = "haazir_admin";
export const SESSION_IDLE_MS = 30 * 60 * 1000;

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") === "same-origin";
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const host = process.env.NODE_ENV === "production" && forwardedHost ? forwardedHost : request.headers.get("host") || forwardedHost;
  const protocol = process.env.NODE_ENV === "production" && forwardedProtocol ? forwardedProtocol : new URL(request.url).protocol.replace(/:$/, "");
  if (!host) return false;
  try {
    return new URL(origin).origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}

export type Session = { kind: "admin"; id: "administrator"; name: string } | { kind: "user"; id: string; name: string; username: string };

// Each principal signs with its own credential version, so a password change, disabled account
// or deleted user ends that principal's existing sessions.
function credentialVersion(subject: string) {
  if (subject === "admin") return adminCredentialVersion();
  if (!subject.startsWith("user:")) return "";
  const user = findSystemUser(subject.slice(5));
  return user && !user.disabled ? "user\0" + user.hash : "";
}

function signature(subject: string, value: string) {
  return createHmac("sha256", process.env.HAAZIR_SESSION_SECRET || "")
    .update("haazir-session-v3\0").update(credentialVersion(subject)).update("\0").update(value).digest("base64url");
}

export function sessionCookie(session: Pick<Session, "kind" | "id"> = { kind: "admin", id: "administrator" }) {
  const expires = Date.now() + SESSION_IDLE_MS;
  const subject = session.kind === "admin" ? "admin" : `user:${session.id}`;
  const value = `${subject}.${expires}`;
  const token = `${value}.${signature(subject, value)}`;
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export function currentSession(request: Request): Session | null {
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token || !process.env.HAAZIR_SESSION_SECRET || !adminCredentialVersion()) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [subject, expiresText, supplied] = parts;
  const expires = Number(expiresText);
  if (!(subject === "admin" || /^user:[0-9a-f-]{36}$/.test(subject)) || !/^\d+$/.test(expiresText) || !supplied || !Number.isSafeInteger(expires) || expires <= Date.now()) return null;
  const version = credentialVersion(subject);
  if (!version) return null;
  const a = Buffer.from(supplied);
  const b = Buffer.from(signature(subject, `${subject}.${expiresText}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (subject === "admin") return { kind: "admin", id: "administrator", name: "Administrator" };
  const user = findSystemUser(subject.slice(5))!;
  return { kind: "user", id: user.id, name: user.name, username: user.username };
}

// Any signed-in principal (Administrator or system user). System users currently have the
// same application access as the Administrator.
export function isSignedIn(request: Request) { return currentSession(request) !== null; }

// The Administrator account only (System Users management).
export function isAdmin(request: Request) { return currentSession(request)?.kind === "admin"; }

export function adminSignInConfigured() { return Boolean(process.env.HAAZIR_SESSION_SECRET && adminCredentialVersion()); }
export function verifyAdminPassword(input: unknown) {
  return Boolean(process.env.HAAZIR_SESSION_SECRET) && checkAdminPassword(input);
}

export const expiredSessionCookie = `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
