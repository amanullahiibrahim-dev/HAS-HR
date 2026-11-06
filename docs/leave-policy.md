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

The applied-record table shows an inclusive leave date range, followed by a separately labelled Expected return. For example, three Family days starting 1 November with 3 November configured as a holiday display 1–4 November, Expected return 5 November. The saved end date remains exclusive so attendance on the return day is not excused as leave. Expected return is exclusive of leave days. Half-day balances remain supported; a date-only return cannot express a partial-day time and is shown on the next date after the allocated days. The server computes and saves expected return from the policy rather than trusting a submitted end date.

Annual, Family and both Sick categories use the employee's service-year anniversary by default under the supplied Articles 178(a), 187(d) and 188(f). Staff joining date and an optional approved leave-cycle anchor are saved through Manage Leave → Edit balances. A special/credited-service entitlement date may differ from the latest joining date; HR must enter the approved cycle anchor, including applicable legacy May-to-April cycles. No unknown joining dates are inferred. Before setup, service-year balances show Joining date required, and new requests that need those balances require setup. Annual, Family and both Sick categories are locked to the CSC service year; calendar overrides are rejected. Legacy Medical/Casual keep their calendar-year option. Pre-May-1984 joining dates default to May–April under Article 178(a), unless an approved service-credit anchor is entered; the intervening cohort left ambiguous in the supplied English text requires an approved cycle date. Both sick categories always share one period basis and reset boundary. Maternity/Paternity are per birth rather than yearly buckets, circumcision per occasion and Hajj per trip.

Requests crossing January or a service anniversary allocate eligible charged days to each affected period, excluding weekends/holidays under that type's counting rules. Every affected period is checked in preview and save. A pending reservation follows the same allocation; completed usage stops at the actual recorded return and retains its saved usage budget. A manual reduced usage budget is allocated chronologically to the earliest eligible covered dates, since no day-by-day adjustment breakdown exists. Saved leave dates, raw punches and approved status are not rewritten by balance setup.

Circumcision records require an occasion reference to limit split applications for the same occasion to five days per parent. Gender no longer changes circumcision entitlement; both parents have the same five-day occasion limit. Existing Medical/Casual records remain editable; new leave uses the guide's named categories.

Saving or removing closed dates automatically replans pending/approved leave from the original requested day allowance: holidays do not consume that allowance, so the expected return moves instead of reducing the granted days. This follows Article 175(b)'s general exclusion, Annual Article 178(b,c), Maternity Article 181(b,d), Paternity Article 184, Circumcision Article 185, Family Article 187(a), and Sick Articles 188 and 190(f) of the supplied regulation. Existing configured Friday/Saturday rules remain in force and a holiday on an already excluded weekend is not counted twice. These changes apply to Family, Annual, both Sick categories, Paternity, Maternity, Circumcision, legacy Medical/Casual, and Hajj/Umra charged to Annual. Existing authorized allowance lengths (including the school guide's maternity/paternity lengths) are unchanged by this holiday fix.

Under Article 186, non-charter pilgrimage's 30-day base extends for excluded holidays; the additional 15 atoll travel days remain calendar days. Fixed charter departure/return dates do not extend. Standalone No pay and Duty travel retain their calendar periods. Unconfirmed legacy pilgrimage records retain their dates for administrator review.

Completed leave retains the actual return and status. Its expected return is recalculated, while actual usage counts only the eligible days actually taken; earlier manual usage adjustments are preserved by applying only the calendar difference. Declined records remain unchanged. Every affected record receives a revision and a before/after audit entry. Re-saving an unchanged calendar is idempotent and also repairs reservations previously shortened by the old deduction-only behavior. Editing/preview uses the same current holiday calendar. Removing a holiday recalculates the expected return in the other direction.

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


## Opening leave balances and leave periods

Manage Leave → Edit balances shows the leave usage fields first, followed by Staff joining date. Periods use the current date automatically; there is no Balance year, Balances as of or approved cycle-date input. Usage can be entered before the joining date; entering/correcting that date recalculates periods while preserving the visible draft values until save. Each recurring leave category shows its CSC period and actual inclusive range. Annual, Family and both Sick categories cannot be switched to calendar year. HR records usage from before the app only for the displayed period. No reason/reference field is required; saves automatically retain the balance change audit with the description Opening balances updated. Recorded app usage is displayed separately to prevent double counting. Service year ends the day before the next anniversary; leap-day anniversaries clamp to February 28 in non-leap years and recover February 29 in leap years. January changes do not reset a service-year balance. The opening amount is stored per employee, type and exact period; no opening amount carries automatically into another period.

Legacy Medical/Casual settings apply to that employee and are saved with the opening balances. CSC periods for Annual/Family/Sick are enforced in both display and server validation. Sick with/without MC share a setting and the same 30-day combined allowance/15-day without-MC sublimit. Per-birth/occasion/trip categories are managed in their applied records, not initialized as annual buckets. The former year-only opening data and its audit history are retained. Nonzero old yearly opening amounts are not silently reinterpreted as service-year amounts: affected availability is blocked for review until HR enters the checked amount for the new exact period (which may be zero).

Changes retain an Administrator-attributed before/after audit and a shared revision to reject concurrent setup/balance edits. An adjusted joining/cycle date does not move earlier opening amounts to another period. Permanent staff deletion also removes these nested opening and period histories. Legacy year-only API/storage remains readable for historical compatibility; new setup uses employee.period-balances. This feature implements period accounting and opening usage, not automatic service-credit adjudication, carryover, expiry payroll compensation or full maternity/paternity split-occasion validation.


Joining-date renewal boundary (school configuration): Annual, Family and the shared sick allowance remain valid through the joining-date anniversary and renew at 00:00 Maldives time on the following date. A 3 November 2026 joining date has its first period from 3 November 2026 through 3 November 2027 inclusive; renewal is 4 November 2027. Subsequent renewals are every 4 November. Approved alternate cycle anchors and historical May-April cycles retain their explicit boundaries. Existing opening entries keep their stable anniversary keys and prior usage remains in history. New-period bookings still reserve that period's allowance. No job, manual balance reset or deletion of leave records is needed; each state refresh selects the active period by Maldives date. Occasion/trip allowances do not become yearly allowances.
