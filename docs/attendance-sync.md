# Connect the iClock990 directly over the office LAN

The project includes `@graphland/zkteco` (pinned to 0.1.0) and a local Node connector. It reads the terminal directly; the existing ZKTeco attendance software is not needed for this path. Leave the machine's ADMS destination unchanged.

## Configuration

The connector loads `.env.local`. Set:

- `ZKTECO_DEVICE_IP`: the terminal's actual private IPv4 address from Communication / Ethernet.
- `ZKTECO_DEVICE_SN`: its exact serial number from System Info / Device Info. Use the same serial as any earlier ADMS imports so events deduplicate.
- `ZKTECO_DEVICE_PORT`: existing communication port, normally `4370`.
- `ZKTECO_COMM_KEY`: the existing numeric COMM key from PC Connection; `0` only if none is configured. Do not reset the terminal's key.
- `HAAZIR_SYNC_TOKEN`: at least 32 random characters, shared between connector and receiving app. A random token has been generated for this local installation; do not commit or print it.
- `HAAZIR_SYNC_URL`: defaults to `http://127.0.0.1:3000/api/integrations/attendance`. If the app uses another port, change it. When the app binds to a specific LAN IP, use HTTPS at that address or run it on loopback for local testing.

The computer running the connector must reach the terminal over the office LAN or VPN. The connector needs Node 20.9+ like the app. Do not put the device package in browser code.

## Commands

1. `npm run device:check` connects, reads device counters, and disconnects. It does not import records and does not require a serial or sync token.
2. Start/restart Haaziry (`npm run dev`, or build and start the production app) so it loads the bridge token.
3. `npm run device:sync` downloads the terminal's retained attendance history and imports it into Haaziry.
4. `npm run device:watch` repeats the sync every 60 seconds (`ZKTECO_POLL_SECONDS`), retries failures and stops with Ctrl+C. Run it alongside Haaziry on the always-on office PC. A Windows startup task/service has not been installed.

The initial check cannot be completed until the real terminal IP and COMM key are known. Import also requires the serial number. Hardware compatibility is confirmed only after a successful real-device check and attendance download.

## Attendance behavior

- Calls connect, getInfo, getAttendances and disconnect only. Does not disable the terminal, change its clock/settings, fetch fingerprint templates, or clear logs.
- Downloads all retained records each cycle; the receiver ignores previously stored events. No checkpoint can skip delayed punches. This favors safe retries over download efficiency; tune the interval for large device histories.
- Downloads and validates the full result before uploading batches of at most 1,000 events. A failed batch is replayed on the next run, including records from earlier successful batches.
- Preserves terminal wall-clock time without conversion to UTC, preserves string PINs, and uses the original numeric punch code rather than the package's labels. UDP devices may return numeric PINs; leading zeros cannot be recovered from a numeric record.
- Create each staff record with the exact machine PIN. Unmapped logs are retained until the matching staff record exists.
- Do not infer IN/OUT labels from numeric code 0: this installation receives code 0 even on checkout punches. Unlabelled punches are flagged for review, regardless of their count. Confirmed attendance IN after the leave start date closes approved personal leave; punches on the start date require administrator review and cannot cancel a full-day leave automatically. Overtime and checkout-only records do not finish leave. Missing/invalid raw punch codes are rejected.
- Successful imports update the device connection indicator, including an empty terminal. The receiver accepts a device serial only when every event matches it and it matches the required `ZKTECO_DEVICE_SN`. Every individual log must match this configured serial even when the optional batch `deviceSerial` is omitted. Imports are disabled until the terminal serial is configured.

## Existing attendance software alternative

The authenticated `POST /api/integrations/attendance` endpoint also remains available for vendor-software exports/APIs. Use `Authorization: Bearer <HAAZIR_SYNC_TOKEN>` and JSON:

```json
{"logs":[{"serial":"ACTUAL-TERMINAL-SERIAL","pin":"00042","timestamp":"2026-10-29 08:55:00","state":0}]}
```

The endpoint accepts at most 5,000 records / 2 MB and rejects invalid batches in full. Its token cannot create staff or edit leave balances. The direct connector adds `deviceSerial` to mark a successful device contact. Keep traffic on loopback or HTTPS. The app uses one file store; run one app instance per database.

Admin lateness boundary: Sunday–Thursday, 08:00 is on time and 08:01 or later is late. Required start stays 08:00, so an 08:01 arrival counts as one late minute. Friday/Saturday and configured holidays are off days. Teachers, Technical Staff, Support Staff and Deputy Principal start at 07:00; 07:00 is on time and lateness begins at 07:01. Principal follows the Admin Staff 08:00 start / 08:01 late boundary.

## Shared attendance rules

The server calculates attendance once; the overview, report rows, details, hours, lateness, exports and corrections use that result. Admin 08:00 is on time, 08:01 is late; Teachers, Technical Staff, Support Staff and Deputy Principal are on time through 07:00 and late from 07:01. Principal follows the Admin Staff 08:01 late boundary. Friday/Saturday and configured holidays do not incur lateness.

The software bridge can supply `eventType` (ATT IN, ATT OUT, ATT & OT IN, ATT & OT OUT, OT IN, OT OUT, BREAK IN or BREAK OUT), or `kind` (`attendance-in`, `attendance-out`, `overtime-in`, `overtime-out`, `break-in`, `break-out`). If both are supplied, they must agree. Numeric machine codes remain unchanged. Matching replays may add previously unavailable classification to the same event without inserting a duplicate.

When explicit attendance events exist, first ATT IN and last subsequent ATT OUT determine regular attendance. OT and breaks never replace regular ATT IN. A confirmed on-time IN counts Present even before checkout. OUT-only records, OT-only records and lone unlabelled punches show Punch review needed, with no invented arrival, late minutes or worked hours. Review evidence is separate from confirmed present totals. Unlabelled records never infer first/last attendance, lateness, hours, or leave return. Import ATT IN/OUT labels from the source software or use an audited correction. Raw logs remain visible in attendance details.

Dates at or before the earliest stored machine-log date without individual punch/leave/duty evidence are labelled Outside synced history, rather than asserting historical absence from incomplete imports. On subsequent working dates, a missing record still uses the existing Absent/Awaiting punch rule. This is a coverage hint, not proof that every later date has been imported completely.

Missing historical records cannot be reconstructed from a terminal download if they are no longer there. Obtain the existing software's history or make an evidenced administrator correction. Corrections preserve original punches and record actor, reason, source evidence and before/after values.


### Historical PIN ownership

Stored punches carry an employee identifier independently of the current machine PIN. Existing imports are bound to the current roster on migration; original terminal fields are retained. Changing a PIN closes its assignment at the office-local timestamp and keeps the prior employee's history. Reusing a PIN opens a new assignment from that timestamp; delayed historical imports resolve against the earlier assignment, and events in assignment gaps remain unassigned. The first registration of a previously unknown PIN can link its unassigned import history. Existing ambiguous or previously misattributed legacy history needs administrator review; migration cannot reconstruct PIN changes made before assignment history existed.

Personal-leave coverage ends at the earlier of the approved expected return and actual return, never later. Excess days remain subject to normal absence rules and a late-return review is shown in Staff Leave. A confirmed start-day IN leaves the full-day leave approved for administrator review; automatic return needs a confirmed ATT IN on a later date. Adjust leave dates with a reason when a start-day punch reflects cancellation or a partial-day arrangement. Existing same-day completion records are flagged for review; recalculating a full working-day leave no longer gives a zero-day deduction.
