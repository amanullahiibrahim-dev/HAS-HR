# Gmail password recovery

The sign-in page offers three steps: **Forgot password? / Send code / Verify code / Reset password**. Only the configured recovery email can receive a code. New-password fields appear after verification; the server also requires a verified reset session.

## Configure on the always-on office server

Add these private values to the server `.env.local` (never commit or share the actual App Password):

```dotenv
HAAZIR_RECOVERY_EMAIL=administrator@gmail.com
HAAZIR_GMAIL_USER=sender@gmail.com
HAAZIR_GMAIL_APP_PASSWORD=your-16-character-google-app-password
```

The sender and recovery address may be the same. Enable Google 2-Step Verification for the sender, then create a Google App Password for Haaziry. Organisational accounts may restrict App Passwords. Do not use your normal Gmail account password. Restart the app after changing these settings. The server needs outbound TLS access to `smtp.gmail.com:465`.

Google setup: https://support.google.com/mail/answer/185833
Nodemailer Gmail guidance: https://nodemailer.com/guides/using-gmail

Until all three values and the existing session secret are configured, email recovery reports unavailable. Delivery is never simulated. Mail is sent only to the fixed server-configured address, never an address chosen by an unauthenticated visitor. SMTP errors are returned without credentials.

## Recovery behaviour

- Six-digit codes expire after 10 minutes. Only keyed digests are stored.
- Maximum five incorrect attempts per code, one resend per minute, and five emails per hour. Limits persist across restarts.
- Resending replaces the previous code and verified reset session. Failed delivery invalidates the pending code.
- Verification consumes the code and issues an HttpOnly, SameSite=Strict reset cookie valid for 10 minutes. It only authorises password changes, never staff-data access.
- Passwords must contain 8-128 characters and are stored using scrypt and a random salt.
- Reset invalidates old passwords, administrator sessions and recovery grants. Sign in with the new password.
- Endpoints enforce same-origin requests, bounded bodies and no-store responses. Unregistered email addresses receive the same generic success message but no mail is sent.

Private credentials and recovery limits live in `data/admin-auth.json`, or beside the file configured by `HAAZIR_DB_PATH`. Preserve it with private server backups, keep it outside `public/`, and do not delete it during deployment. The saved password takes precedence over the initial environment password after the first reset.

## Emergency recovery

Server operators can still run `npm run password:recovery` in the office server app folder to issue a high-entropy emergency code (30 minutes, single use). The browser normally uses email recovery. Emergency API requests use that server-issued code and a new password in a same-origin POST to `/api/auth/reset-password`; six-digit email codes cannot use this path. Emergency resets also invalidate email grants. Running the command on a developer PC does not recover the office server.

Use local persistent storage for each installation. If a terminated process leaves `admin-auth.json.lock`, ensure no recovery process is active before removing only that stale lock.
