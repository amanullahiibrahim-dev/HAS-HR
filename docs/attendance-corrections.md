# Administrator attendance corrections

In Attendance, open a day's View and choose Correct attendance, or use the Correct attendance button to add a missed punch. Choose staff and attendance date, enter the correct arrival time, optionally correct checkout, and supply a reason. Blank checkout preserves the current checkout and allows subsequent machine checkout logs to flow through.

The authenticated administrator endpoint appends a correction to `corrections` in the server data store. It no longer deletes or replaces raw punch records. Each correction includes the staff ID, day, server-generated timestamp and ID, account actor, mandatory reason, effective before/after times, changed fields, and snapshots of original punch evidence. A second correction appends another revision. No API is provided to edit or delete an audit event. Reports recalculate present/late using corrected times and label corrected attendance; CSV exports contain the latest correction's actor, timestamp and reason. Day details show the full correction history.

The existing login is a shared Administrator account. Attribution records that account; it cannot identify which individual used a shared password. Audit data is stored with the application data and must be backed up. This file store is not tamper-proof against someone who can directly edit server files.

A stale form is rejected when the effective times or correction revision have changed. Review the updated day and reopen the form before retrying. The current correction form handles same-day attendance; checkout must be later than arrival. New corrections do not fabricate biometric verification events or alter fingerprint templates or the original ZKTeco software.

Earlier versions' legacy manual entries are displayed as Legacy manual. Logs previously deleted by those versions cannot be reconstructed by this feature.

Run `node --test tests/attendance-corrections.test.cjs` for correction regression checks.
