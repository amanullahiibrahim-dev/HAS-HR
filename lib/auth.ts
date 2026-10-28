import { createHmac, timingSafeEqual } from "node:crypto";

const cookieName = "haazir_admin";

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
  return createHmac("sha256", process.env.HAAZIR_SESSION_SECRET || "").update(value).digest("base64url");
}

export function sessionCookie() {
  const expires = Date.now() + 12 * 60 * 60 * 1000;
  const value = `admin.${expires}`;
  const token = `${value}.${signature(value)}`;
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export function isAdmin(request: Request) {
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token || !process.env.HAAZIR_SESSION_SECRET || !process.env.HAAZIR_ADMIN_PASSWORD) return false;
  const [role, expiresText, supplied, extra] = token.split(".");
  const value = `${role}.${expiresText}`;
  const expected = signature(value);
  if (role !== "admin" || extra || !expiresText || !supplied || Number(expiresText) < Date.now()) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyAdminPassword(input: string) {
  const expected = process.env.HAAZIR_ADMIN_PASSWORD;
  if (!expected || !process.env.HAAZIR_SESSION_SECRET) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const expiredSessionCookie = `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
