# Attendance corrections

In Attendance, choose Correct attendance, select a staff member and attendance date, and enter the correction reason. Administrators can add or correct an in-punch, an out-punch, or both. Each supplied time is a same-day `HH:mm` value. When a time is omitted, its current effective value is preserved. When both effective times are known, the out-punch must be later than the in-punch.

Corrections are kept separately from original machine punches. They recalculate attendance status, worked hours and late minutes without fabricating or overwriting a machine log. An out-punch entered without an in-punch leaves the day incomplete and records no worked time. A later device punch can fill an omitted time; a time explicitly corrected by the administrator remains effective.

Every correction records its reason, staff ID, date, administrator actor, timestamp, supplied changes, before/after snapshots, and original punch evidence. Correction history is visible for the selected staff member and date. Empty reasons, invalid dates or times, unchanged explicit time changes, and stale forms are rejected. Saving another correction appends history.

Reason-only notes remain supported. The authenticated endpoint appends them with `noteOnly: true` and an empty `changes` object. They do not change attendance or undo earlier corrections, and a note on a day without punches does not create an attendance row. No verification reference is required; existing supplied references remain in their audit records.

The existing login is a shared Administrator account. Attribution records that account; it cannot identify which individual used a shared password. Audit data is stored with the application data and must be backed up. This file store is not tamper-proof against someone who can directly edit server files.

Run `node --test tests/attendance-corrections.test.cjs tests/attendance-partial-corrections.test.cjs` for correction regression checks.
