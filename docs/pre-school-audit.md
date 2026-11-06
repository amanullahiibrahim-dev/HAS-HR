# Pre-school deployment verification — 5 November 2026

The administrator confirmed that the connected terminal is a test device and asked to continue using the current dataset. No personnel, punch, leave or appraisal records were deleted, reclassified, cleared or moved by this audit. The data displayed for school staff can include simulated matches from the test device's PINs; it is not evidence that those staff attended school.

## Completed

- Full automated suite: 305 passed, zero failed or skipped. Fixtures cover imports, replay/deduplication, missing/unknown punch labels, PIN history/reuse, corrections/denials, leave returns/allowances, anniversaries, closures, duty travel, appraisal, auth/recovery, exports and desktop/mobile controls.
- TypeScript validation passed.
- Fixed bridge terminal-serial validation: every log must match the configured terminal even if the optional batch serial is omitted. Missing terminal configuration rejects imports without writes. Mixed-device batches reject atomically.
- Updated two stale staff-search test assertions after the authorized helper-text removal; search, result limits, escaping and fixed staff while editing remain verified.
- Read-only `npm run device:check` successfully connected to the test terminal. This reads counters and disconnects; it does not download, upload, delete or modify device logs/settings/users.

## Checks still requiring the school terminal

Automated tests and a successful connection do not verify the school terminal's reporting configuration. Confirm its physical serial/IP, machine PIN-to-employee matches, local clock and recorded attendance IN/OUT types. Compare a known on-time IN, late IN and OUT against the school's source records, including overtime/break events, and replay the same batch to verify stable counts. Verify the source application's history is complete for any historical appraisal period.

The current direct connector preserves numeric codes but does not invent attendance classifications. In this test installation code 0 has appeared on both arrival and departure; no global code-0-to-IN rule was added. The supported software bridge can supply confirmed ATT IN/ATT OUT or `kind` labels. Unlabelled, OUT-only and OT-only events intentionally remain review cases and cannot falsely close personal leave. Establish trustworthy classifications on the school setup before accepting unattended attendance/leave-return processing.

The SDK's `getInfo` returns counters, not the terminal's physical serial; the connector attaches the configured serial. Verify the physical serial at installation rather than treating configured metadata as hardware identity proof. No settings were changed on either device by this audit.

Existing PIN ownership is dataset-wide for the single configured terminal. Continuing with the current test dataset was explicitly requested; changing the configured serial alone does not separate earlier test history. Review historical test-derived figures before using this dataset for official school reporting. This audit does not certify the current test dataset as real school attendance or guarantee absence of all future faults.
