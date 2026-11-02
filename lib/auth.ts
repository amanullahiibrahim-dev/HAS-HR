import { createHmac, timingSafeEqual } from "node:crypto";

import { adminCredentialVersion, checkAdminPassword } from "./admin-credentials";

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

function signature(value: string) {
  return createHmac("sha256", process.env.HAAZIR_SESSION_SECRET || "")
    .update("haazir-session-v3\0").update(adminCredentialVersion()).update("\0").update(value).digest("base64url");
}

export function sessionCookie() {
  const expires = Date.now() + SESSION_IDLE_MS;
  const value = `admin.${expires}`;
  const token = `${value}.${signature(value)}`;
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export function isAdmin(request: Request) {
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token || !process.env.HAAZIR_SESSION_SECRET || !adminCredentialVersion()) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [role, expiresText, supplied] = parts;
  const expires = Number(expiresText);
  const value = `${role}.${expiresText}`;
  const expected = signature(value);
  if (role !== "admin" || !/^\d+$/.test(expiresText) || !supplied || !Number.isSafeInteger(expires) || expires <= Date.now()) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function adminSignInConfigured() { return Boolean(process.env.HAAZIR_SESSION_SECRET && adminCredentialVersion()); }
export function verifyAdminPassword(input: unknown) {
  return Boolean(process.env.HAAZIR_SESSION_SECRET) && checkAdminPassword(input);
}

export const expiredSessionCookie = `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
