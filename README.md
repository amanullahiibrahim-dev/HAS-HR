# Haaziry — Attendance & Leave

Haaziry is a Next.js attendance and leave app intended to run as one always-on service on the office server. Developers can edit code on a separate PC and deploy it to that server. Staff, attendance, punch logs and leave records are stored on the server rather than in individual browsers.

## Features

- Pull attendance directly from the iClock990 over the LAN with `npm run device:sync` or `npm run device:watch`; see [direct connection setup](docs/attendance-sync.md). ADMS reception at `/iclock/cdata` is also available.
- Match terminal user PINs to teacher and admin-staff records.
- Group punches by person and date, show first check-in and last punch, and flag lateness against each person's expected start time.
- Record approved or pending leave, calculate balances per staff member, and mark an approved leave completed when a check-in from that staff PIN arrives during the leave period.
- Protect the HR interface and HR data API with an administrator sign-in.

## Install on the always-on office server

1. Install Node.js 20.9 or newer, copy/clone the project onto the server, and run `npm install`.
2. Choose a fixed **private LAN IP address** for the server. Copy `.env.example` to `.env.local` and set `HAAZIR_BIND_HOST` to that exact server IP, `HAAZIR_ADMIN_PASSWORD` to a unique admin password, `HAAZIR_SESSION_SECRET` to a random secret of 32+ characters, `ZKTECO_DEVICE_SN` to the exact terminal serial number, and `ZKTECO_DEVICE_IP` to the terminal’s fixed private LAN IP. Do not commit or share `.env.local`.
3. Run `npm run build`, then `npm run start`. The server binds only to the one IP set in `HAAZIR_BIND_HOST`; it refuses wildcard addresses such as `0.0.0.0` and `::`. Without a setting it listens on `127.0.0.1`, so it is local-only.
4. Configure the office firewall or reverse proxy so HR users can reach the web app, while `/iclock/cdata` is reachable only from the iClock990's fixed IP (or its dedicated device VLAN). Use the organization VPN and HTTPS for access from other offices. Do not expose the application or the device receiver to the public internet.
5. Back up `data/haazir-data.json` regularly. The built-in file store is for one server instance; don't run multiple instances against the same file. Set `HAAZIR_DB_PATH` to an absolute path on a persistent disk if deployments replace the project folder.

The developer command `npm run dev` listens only on the developer PC's loopback address. Configure the terminal to send to the office server, not the developer PC, except during a planned network test.

## Direct local connection (recommended)

Follow [the direct connector setup](docs/attendance-sync.md). Use `npm run device:check` first, then start the app and run `npm run device:sync` or `npm run device:watch`. This reads the terminal using its IP, communication port and existing COMM key; no ADMS reconfiguration is needed.

## Optional ADMS push connection

The iClock990 product sheet lists ADMS as an optional feature, so first confirm ADMS is available on this specific terminal/firmware. In the terminal's Communication / PC Connection / ADMS settings, enable it and enter the office server's fixed private IP (or internal DNS), app port, and `/iclock/cdata` path if the device asks for one. The terminal and server must be able to communicate over the office network. Give both devices fixed/reserved private IPs. The app server checks the source IP on every `/iclock/` request, and the terminal serial must match `ZKTECO_DEVICE_SN`; the serial check alone is not treated as network security.

Create each staff record with the machine's user PIN exactly as displayed on the terminal. Logs with unmapped PINs are retained on the server but won't appear under a person until the PIN is mapped.

The automatic leave return currently treats iClock punch status `0` as a check-in. Configure the terminal's return punch as check-in and verify its status behavior with the first real records before relying on automatic completion. Lateness uses each employee's expected check-in time (default 09:00). Completed leave days are estimated as weekdays before the return check-in (weekends excluded); public holidays are not yet in a holiday calendar, so HR can adjust the actual days on the completed leave record.

## Security and data

- Stored data includes staff details, attendance events, device serial, attendance status/verification codes, and leave records. It does not collect fingerprint templates.
- The HR interface and `/api/state` require the admin session cookie. The terminal cannot use a browser login; its protocol receiver requires the exact configured device serial and must also be restricted to the terminal's source IP by the office firewall/reverse proxy.
- Set real secrets before starting the service. Never use the example values in production.
- If the device does not offer ADMS, use ZKTeco's supported attendance software or SDK as an on-premises bridge instead of exposing the biometric terminal to the internet.

References: [ZKTeco iClock990 product sheet](https://www.zkteco-ea.com/wp-content/uploads/2023/01/IClock_990.pdf) · [ZKTeco user manual](https://www.zkteco.me/download-file/2832)

## Local development

1. Run `npm install` on the developer PC.
2. Create a local `.env.local` from `.env.example` with development-only credentials and a test serial.
3. Run `npm run dev`, then open http://localhost:3000. This local dev server does not receive device traffic from the office server.

## MC file backups

MC attachments are private files in `data/mc-documents` by default, or beside `HAAZIR_DB_PATH` when the data store is relocated. Back up both the JSON store and the MC directory. Set `HAAZIR_MC_DIRECTORY` only if a separate private persistent directory is needed. See [MC uploads](docs/mc-uploads.md).

Administrator sessions resume on a normal reload of the same tab while activity is less than 30 minutes old. Fresh openings require sign-in. The tab stores only an activity timestamp in sessionStorage, never the password. The HttpOnly cookie is a browser-session cookie with a signed 30-minute expiry; user activity renews it, while background polling does not. Inactivity locks the visible app and checks again on focus, visibility changes and API use, including after a suspended phone resumes. Browser or OS force-close detection is not guaranteed by web browsers; fresh navigation requires sign-in even if a browser restores session storage.


## Importing staff profiles

Copy `seed/staff.example.json` to `seed/staff.json`, fill in the office's staff records privately, then run `npm run seed:staff`. The real staff import file is excluded from Git because it can contain personnel and identity-card data. Existing profiles are preserved by the seed command.
