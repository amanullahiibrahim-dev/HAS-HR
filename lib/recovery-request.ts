import { PasswordRecoveryError } from "./admin-credentials";
export async function recoveryRequestBody(request: Request) {
  const reader = request.body?.getReader(); if (!reader) throw new PasswordRecoveryError("Enter your recovery details.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 4096) { await reader.cancel(); throw new PasswordRecoveryError("Request is too large.", 413); } chunks.push(value); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new PasswordRecoveryError("Invalid recovery request."); }
}
