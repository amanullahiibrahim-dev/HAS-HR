# Private MC uploads

Sick Leave with MC shows one Upload MC input for PDF/JPG/PNG files up to 5 MB. Other leave types, including Sick Leave without MC, show no MC upload control. Choose the file and Save/Update; the file upload completes before the leave is saved. If leave validation fails, retrying the same selected file reuses the successful upload. An upload which is never linked stays private; no automatic deletion is performed.

POST /api/mc-documents accepts authenticated same-origin multipart requests with employeeId and file. The body is bounded before parsing, and size, supported signature, extension and declared type are checked. Filenames are metadata only. Files use generated IDs and are stored outside public/ in mc-documents beside the configured HAAZIR_DB_PATH (default data/mc-documents). HAAZIR_MC_DIRECTORY can override that private directory. Medical metadata, staff ownership, upload account/time and SHA-256 digest are stored in the server JSON data store.

A leave can link a document only if it belongs to that staff member and the leave type is Sick with MC. GET /api/mc-documents/<id> requires the administrator session and returns a download attachment with private/no-store and nosniff headers. File paths are never accepted from the browser. File type checks are not medical authenticity verification.

Keep the JSON data store and the private MC directory together in office backups. Do not put the MC directory under public/ or commit it to Git. Replacing a certificate preserves the original file and the before/after document IDs in leave edit history. No delete endpoint is exposed. Existing supporting-document metadata is retained; a new upload or change to the leave dates invalidates any earlier verification flag rather than asserting the new material was checked.

Run node --test tests/mc-documents.test.cjs and tests/leave-workflow-api.test.cjs for private-file and leave-association regression checks. These tests use isolated temporary files and in-memory staff records, not live HR data.
