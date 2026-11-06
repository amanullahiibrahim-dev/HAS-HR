# Report downloads

Attendance, Attendance Report, and appraisal pages provide PDF and Word (.docx) buttons alongside the existing CSV export. Select the staff, period and filters, then view the report before downloading it. Downloads include all matching results, not only the current table page. Word files are editable and can be opened in Microsoft Word or imported into Google Docs.

The files include the report scope, selected period, column headings and page numbers. Large tables repeat their headings on every page; wide reports use additional detail tables with the employee identity columns repeated, preserving every exported field. Word reports use landscape A4 pages. Report cells are plain text, including names, IDs and notes. The PDF embeds its text font; its license is stored beside the font in assets.

Downloads require an active administrator session and a same-origin request to `/api/reports/export?format=pdf` or `format=docx`. No generated report is retained on the server. Oversized or invalid requests produce an error rather than a partial download. Existing report filters, attendance classifications and stored staff records are unchanged.

Verification: `node --test tests/report-export.test.mjs tests/attendance-report.test.cjs tests/attendance-summary.test.cjs`. Sample files are created only from dummy data under the ignored data directory for visual layout checks.
