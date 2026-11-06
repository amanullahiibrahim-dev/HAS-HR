import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

// Additional sign-in accounts created by the Administrator. The Administrator account itself
// stays in admin-auth.json / HAAZIR_ADMIN_PASSWORD and is not stored here.
export type SystemUser = { id: string; name: string; username: string; salt: string; hash: string; createdAt: string; passwordChangedAt: string; disabled?: boolean };
export type PublicSystemUser = Omit<SystemUser, "salt" | "hash">;
type UsersFile = { version: 1; users: SystemUser[] };

export class SystemUserError extends Error { constructor(message: string, public status = 400) { super(message); } }

const reservedUsernames = ["administrator", "admin"];

export function systemUsersPath() {
  return path.join(path.dirname(process.env.HAAZIR_DB_PATH || path.join(process.cwd(), "data", "haazir-data.json")), "system-users.json");
}

function readUsersFile(): UsersFile {
  let raw: string;
  try { raw = fs.readFileSync(systemUsersPath(), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, users: [] }; throw error; }
  const data = JSON.parse(raw) as UsersFile;
  if (data.version !== 1 || !Array.isArray(data.users)) throw new Error("Invalid system user storage.");
  return data;
}

function updateUsers<T>(change: (data: UsersFile) => T): T {
  const file = systemUsersPath(); fs.mkdirSync(path.dirname(file), { recursive: true });
  let lock: number;
  try { lock = fs.openSync(file + ".lock", "wx", 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new SystemUserError("Another user change is in progress. Try again shortly.", 409); throw error; }
  const temporary = file + "." + randomUUID() + ".tmp";
  try {
    const data = readUsersFile(); const result = change(data);
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600, flag: "wx" }); fs.renameSync(temporary, file);
    return result;
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); fs.closeSync(lock); fs.unlinkSync(file + ".lock"); }
}

function publicUser({ salt: _salt, hash: _hash, ...user }: SystemUser): PublicSystemUser { return user; }

function cleanName(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100) throw new SystemUserError("Enter the user's full name (up to 100 characters).");
  return value.trim();
}
function cleanUsername(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{3,32}$/.test(value.trim())) throw new SystemUserError("Username must be 3 to 32 letters, numbers, dots, dashes or underscores.");
  const username = value.trim();
  if (reservedUsernames.includes(username.toLowerCase())) throw new SystemUserError("That username is reserved for the Administrator.");
  return username;
}
function hashPassword(password: unknown) {
  if (typeof password !== "string" || password.length < 8 || password.length > 128 || !password.trim()) throw new SystemUserError("Use a password between 8 and 128 characters.");
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: scryptSync(password, salt, 64).toString("hex") };
}

export function isAdministratorUsername(username: unknown) {
  return typeof username !== "string" || !username.trim() || reservedUsernames.includes(username.trim().toLowerCase());
}

export function listSystemUsers(): PublicSystemUser[] { return readUsersFile().users.map(publicUser); }

export function findSystemUser(id: string) { return readUsersFile().users.find(user => user.id === id); }

export function createSystemUser(input: { name?: unknown; username?: unknown; password?: unknown }): PublicSystemUser {
  const name = cleanName(input.name), username = cleanUsername(input.username), secret = hashPassword(input.password);
  return updateUsers(data => {
    if (data.users.some(user => user.username.toLowerCase() === username.toLowerCase())) throw new SystemUserError("That username is already taken.", 409);
    const at = new Date().toISOString();
    const user: SystemUser = { id: randomUUID(), name, username, ...secret, createdAt: at, passwordChangedAt: at };
    data.users.push(user);
    return publicUser(user);
  });
}

export function updateSystemUser(id: unknown, input: { name?: unknown; password?: unknown; disabled?: unknown }): PublicSystemUser {
  return updateUsers(data => {
    const user = data.users.find(item => item.id === id);
    if (!user) throw new SystemUserError("User not found.", 404);
    if (input.name !== undefined) user.name = cleanName(input.name);
    if (input.password !== undefined) { Object.assign(user, hashPassword(input.password)); user.passwordChangedAt = new Date().toISOString(); }
    if (input.disabled !== undefined) { if (input.disabled) user.disabled = true; else delete user.disabled; }
    return publicUser(user);
  });
}

export function deleteSystemUser(id: unknown) {
  updateUsers(data => {
    const index = data.users.findIndex(user => user.id === id);
    if (index < 0) throw new SystemUserError("User not found.", 404);
    data.users.splice(index, 1);
  });
}

// Returns the active user whose username and password match, or null.
export function checkSystemUserPassword(username: unknown, password: unknown): SystemUser | null {
  if (typeof username !== "string" || typeof password !== "string" || password.length > 1024) return null;
  const user = readUsersFile().users.find(item => item.username.toLowerCase() === username.trim().toLowerCase());
  const salt = user?.salt || "0".repeat(32), expected = Buffer.from(user?.hash || "0".repeat(128), "hex");
  const matches = timingSafeEqual(scryptSync(password, salt, 64), expected);
  return user && matches && !user.disabled ? user : null;
}
