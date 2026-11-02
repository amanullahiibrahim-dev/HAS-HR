import nodemailer from "nodemailer";
import { PasswordRecoveryError } from "./admin-credentials";
export function gmailRecoveryConfiguration() {
  const recipient = (process.env.HAAZIR_RECOVERY_EMAIL || "").trim().toLowerCase();
  const sender = (process.env.HAAZIR_GMAIL_USER || "").trim().toLowerCase();
  const password = (process.env.HAAZIR_GMAIL_APP_PASSWORD || "").replace(/\s/g, "");
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email.test(recipient) || !email.test(sender) || password.length !== 16 || !process.env.HAAZIR_SESSION_SECRET) throw new PasswordRecoveryError("Email recovery is not configured. Contact the office server administrator.", 503);
  return { recipient, sender, password };
}
export async function sendRecoveryEmail(code: string) {
  const { recipient, sender, password } = gmailRecoveryConfiguration();
  const transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: sender, pass: password }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000, disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false });
  try {
    const result = await transport.sendMail({ from: { name: "Haaziry", address: sender }, to: recipient, subject: "Your Haaziry password recovery code", text: `Your Haaziry password recovery code is: ${code}\n\nEnter this code in the app, then choose a new password. It expires in 10 minutes and can be used once.\n\nIf you did not request this code, ignore this email. Your password has not changed.` });
    if (!result.accepted?.length) throw new Error("Delivery not accepted");
  } catch { throw new PasswordRecoveryError("Unable to send the recovery email. Contact the office server administrator or try again later.", 503); }
  finally { transport.close(); }
}
