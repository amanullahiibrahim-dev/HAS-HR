# Leave guide configuration

These rules combine the school guide with the subsequently authorized MC, circumcision and pilgrimage changes based on the supplied Civil Service Regulation, Articles 185, 186, 188 and 190. They are not a complete implementation of every current civil-service provision.

| Leave | Allowance | Friday/Saturday | Configured holidays and closures |
|---|---|---|---|
| Family | 10 days | Excluded | Excluded |
| Annual | 30 days | Excluded | Excluded |
| Sick without MC | Up to 15 days from shared 30-day sick allowance | Excluded | Excluded |
| Sick with MC | Remaining shared 30-day sick allowance | Excluded | Excluded |
| Paternity | 30 days | Included | Excluded |
| Hajj | First paid Hajj: actual charter travel or 30-day base; atoll addition below | Included in the base | Excluded in the base |
| Umra / later Hajj | Annual leave or authorized no-pay leave | Depends on the approved basis | Depends on the approved basis |
| Maternity | Six calendar months | Included | Excluded |
| Circumcision — either parent | Up to 5 paid days per occasion | Included | Excluded |

In Attendance → Closed Days, select dates with the date picker and record each public holiday, presidential closure or other officially closed date with its name or announcement reference. Friday and Saturday remain weekly off days automatically. Existing configured dates remain available. No official dates are automatically inferred or downloaded. Duplicate dates are rejected and closure dates on excluded weekends never reduce the same day twice.

Maternity's initial duration is the number of calendar days between the leave start and six months later, clamping the target day to the last day of its month when necessary. Configured holidays extend this duration. It is not a fixed 180-day allowance.

Expected return is exclusive of leave days. Half-day balances remain supported; a date-only return cannot express a partial-day time and is shown on the next date after the allocated days. The server computes and saves expected return from the policy rather than trusting a submitted end date.

Balances currently use the calendar year of the leave start, including pending reservations, approved leave and completed usage. A leave crossing New Year is charged to its start year; confirm any fiscal-year, carryover, per-event, or cross-year allocation requirements before using balances for official decisions. Actual return punches close leave and reduce used days according to the configured counting rules.

Circumcision records require an occasion reference to limit split applications for the same occasion to five days per parent. Gender no longer changes circumcision entitlement; both parents have the same five-day occasion limit. Existing Medical/Casual records remain editable; new leave uses the guide's named categories.

Saving or removing closed dates automatically recalculates eligible pending/approved reservations and completed actual usage within each saved authorized period. Start dates, expected returns and actual returns remain unchanged. Original requested days are retained alongside `deductibleDays`; balances and the applied-record table use the recalculated deductions. Every changed leave receives a revision and before/after audit entry, and calendar changes retain their own audit history. No-pay leave and official duty are unaffected; the first-Hajj base excludes closures while additional travel days keep their existing calendar-day treatment. Zero-deduction periods remain valid applied records. Test the policy with `node --test tests/leave-policy.test.cjs`.

## Manage Leave

Staff Leave → Manage Leave lists all categories, including sick leave, and all statuses. Edit opens the shared leave editor with both Application date (when applied) and Leave starts (first leave day). Historical application dates remain blank when unknown. Updating a record recalculates its expected return under the current policy and refreshes attendance, balances and dashboards through the common saved record. A completed leave retains its actual return and recalculates used days; completed and declined records retain their status. The staff member on an existing record is fixed.

Every edit requires a reason and appends an Administrator-attributed before/after entry to Leave change history. A revision check rejects stale edits after another administrator action or machine return. The application's shared administrator account identifies the account, not an individual person. Run `node --test tests/manage-leave.test.cjs` for the edit and propagation checks.

## MC upload workflow

The medical section now contains one Upload MC file input, shown only for Sick Leave with MC. The reference, practitioner, notification, coverage, verification and HR-decision controls were removed at the user's request. They are not required to upload a certificate. Prior medical metadata and HR decisions remain stored and recorded in historical edits; the file upload does not silently erase them or automatically reverse an earlier decision.

Select a PDF, JPG or PNG up to 5 MB and save/update the leave. The file is stored privately on the server and assigned to the selected staff member. Pending leave can be saved before the MC is available, then updated with the file later. Existing attachments have an authenticated download link; replacement files leave earlier versions available through edit history. Uploading a file does not mark it medically verified and does not alter raw attendance punches or pay.

Without-MC leave has no upload field and retains the shared 30-day sick allowance, 15-day without-MC sublimit and two-consecutive-day checks. Supporting forms/certificate assessment can still be handled in the school's personnel records; this simplified interface does not assert full document-compliance verification. See mc-uploads.md for storage and backup details.

## Circumcision and pilgrimage

Article 185: up to five days excluding configured public holidays for either parent on the same occasion, including weekends. The occasion/approval reference groups split applications. It is not an annual allowance.

Article 186: first paid Hajj requires the administrator's eligibility confirmation (including prior service) and an office permission reference. An earlier pending/approved/completed paid or legacy Hajj blocks a second paid Hajj unless editing that record. For Male' standard travel the base is 30 days excluding public holidays, including weekends. Chartered travel uses departure through actual flight return, inclusive; those dates are not extended merely because a holiday occurs. Atoll offices receive 15 additional calendar days including holidays. HR allocates 0–15 of those before departure from Male', and the remainder after the base. The app does not independently verify flight dates or prior service.

Umra and later Hajj do not receive an independent annual paid 30-day bucket under this profile. Choose annual leave (charged to the Annual balance, with Annual date rules) or authorized no-pay leave using the travel-duration rules and an office permission reference. Additional Annual leave after a paid Hajj can be entered as a separate Annual record. No-pay designations are for records/reporting; this app does not execute payroll deductions.

Existing records are not silently rewritten. Older pilgrimage records without a leave basis and circumcision records without an occasion reference are flagged for administrator review. Editing or creating records applies the updated rules. The current service-year accounting gap remains documented in civil-service-review.md.

Primary source: https://csc.gov.mv/Legislation/Download/8 (Articles 185,186,188,190). The user explicitly authorized these provisions as the implementation profile; this does not assert that the 2014 English document is a fully consolidated current text.

## Duty travel (official duty)

Source checked against the uploaded 220-page Maldives Civil Service Regulation 2014, 2014/R-311, PDF page 120, Article 172(c), and Article 171(b). Article 172(c) requires time and reason to be recorded when office-required work away from the workplace prevents timely attendance registration, and says the employee is not late in that situation. This implementation uses the user's selected 2014 source; it does not assert reconciliation of every later amendment.

Duty travel appears in Leave and Manage Leave as an official-duty record, with destination, work purpose, office instruction/authorization reference, first/last authorized duty dates, and first/last duty times. The administrator explicitly confirms full-day release from normal office attendance. This is a full-day workflow; a partial-day visit must be reviewed separately and must not be represented as release for a whole day. These structured fields and confirmation are app controls for documenting the authorization; the regulation does not prescribe this exact form.

Calendar days describe the approved assignment and include intervening weekends and public holidays; these are not days deducted from a personal-leave entitlement and do not extend the authorized end date. No new annual cap or travel/pay allowance is invented. A 366-calendar-day validation bound is a technical per-record limit, not a CSC entitlement. Annual and sick balances and personal-leave utilization totals exclude this category. Travel reimbursements, overtime and holiday pay are not calculated by this feature.

Pending and declined records do not excuse attendance. Approved/completed full-day assignments show On duty in attendance and exports, count as present in attendance summaries, and have no late minutes during the authorized period. Raw machine punches and their recorded times are preserved. Pending/approved/completed duty must not overlap other live duty or leave records for the same employee. No synthetic punch times or worked hours are created.

Use Record return on an approved assignment to record when the employee reported to the attendance officer after finishing the work, plus the report/acknowledgement reference. The Administrator action validates timing in Maldives local time (UTC+5), checks the record revision, completes the duty record and appends before/after audit history. An incidental office punch does not close duty travel automatically. An early return requires updating the authorized period with an edit reason first. Completed duty duration follows the approved period rather than a freehand leave-days adjustment. Actual authorization, work performed and officer acknowledgement remain matters for the school to verify against its records.


### Standalone No pay leave

No pay is available in Leave and Manage Leave as a separate unpaid leave type. The administrator records the approved calendar-day duration, including Fridays, Saturdays and configured public holidays. It has no annual entitlement bucket and never deducts from annual, sick or other paid balances. This app setting records the approved period; it does not calculate payroll deductions or establish eligibility. Standard pending/approval, audited editing, attendance coverage and confirmed early-return processing apply. The existing no-pay Hajj/Umra options remain available.


### Permanent deletion of applied leave

Manage Leave provides Delete beside Edit for every applied record. A confirmation identifies the staff member, type and dates, warns that deletion cannot be undone, and requires a reason. The administrator-only API requires the current revision and a same-origin request. Deletion removes the leave and its edit history, releases its paid allowance reservation/usage, and updates derived attendance coverage. Unshared current/historical MC documents are removed through the persisted file-cleanup queue; documents referenced by another leave are retained. A minimal receipt records the administrator, timestamp, leave/staff identifiers and reason, without a recoverable leave snapshot. Raw machine punches and attendance corrections are preserved. Deletion does not fabricate attendance: dates with no punch or other approved coverage follow normal absence rules.
