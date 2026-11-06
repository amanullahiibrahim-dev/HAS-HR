"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";

const attendanceMarkup = `<section class="page" id="page-attendance">
  <div class="section-title"><div><h1>Attendance</h1><p>Daily hours, shifts and fingerprint machine records.</p></div></div>
  <p id="att-summary-prompt" hidden></p>
  <div class="att-kpis" id="att-summary" role="region" aria-label="Selected employee attendance summary" hidden>
    <div class="att-kpi"><span class="status present">Present</span><b id="att-present">0</b><small>Days</small></div>
    <div class="att-kpi"><span class="status leave">Leave / Off</span><b id="att-leave">0</b><small>Days</small></div>
    <div class="att-kpi"><span class="status absent">Absent</span><b id="att-absent">0</b><small>Days</small></div>
    <div class="att-kpi"><span class="status late">Late</span><b id="att-late-mins">0</b><small>Mins (<span id="att-late-days">0</span> days)</small></div>
    <div class="att-spark"><div class="att-legend"><span><i style="background:#d87565"></i>Late mins</span><span><i style="background:#57a577"></i>Worked mins</span></div><svg id="att-chart" viewBox="0 0 360 84" preserveAspectRatio="none" aria-label="Attendance trend"></svg><div class="att-chart-dates" id="att-chart-dates"></div></div>
    <div class="att-score"><div class="att-ring" id="att-score-ring"><span id="att-score">100%</span></div><small>Score</small></div>
  </div>
  <div class="att-controls">
    <div class="att-control"><label for="att-period">Period</label><select class="filter" id="att-period"><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="month" selected>This month</option><option value="last-month">Last month</option><option value="custom">Custom range</option></select></div>
    <div class="att-control att-custom" id="att-custom"><label>Custom range</label><div class="att-custom-row"><input class="filter" type="date" id="att-from" aria-label="From date"><span>to</span><input class="filter" type="date" id="att-to" aria-label="To date"></div></div>
    <button class="btn primary" id="att-view">View</button>
    <div class="att-controls-right"><button class="btn" id="att-print" type="button">Print</button><button type="button" class="btn" id="att-pdf">PDF</button><button type="button" class="btn" id="att-docx">Word (.docx)</button></div>
  </div>
  <div class="att-searchbar">
    <div class="att-staff-picker"><input type="search" class="filter" id="att-search" role="combobox" aria-label="Search attendance" aria-autocomplete="list" aria-expanded="false" aria-controls="att-staff-results" autocomplete="off" placeholder="Search name, ID, PIN, department or status…"><div id="att-staff-results" class="att-staff-results staff-picker-results" role="listbox" aria-label="Matching staff" hidden></div></div>
    <select class="filter" id="att-sort"><option value="date-desc">Newest first</option><option value="date-asc">Oldest first</option><option value="late">Most late</option><option value="hours">Most hours</option></select>
    <div class="att-chips" id="att-chips"><button class="chip active" data-status="all">All</button><button class="chip" data-status="Present">Present</button><button class="chip" data-status="Late">Late</button><button class="chip" data-status="Incomplete">Punch review</button><button class="chip" data-status="Absent">Absent</button></div>
  </div>
  <div class="wide-panel att-panel">
    <div class="panel-head"><div><h2 id="att-table-title">Attendance</h2><p id="att-range-label">This month</p></div><span id="att-count" style="font-size:10px;color:#8b958d"></span></div>
    <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Date</th><th>In</th><th>Out</th><th>Worked</th><th>Late</th><th>Status</th><th>Action</th></tr></thead><tbody id="attendance-table"></tbody></table></div>
  </div>
</section>`;



const closedDaysMarkup = `<section class="page" id="page-closed-days"><div class="section-title"><div><h1>Closed Days</h1><p>Record public holidays, presidential closures and other officially closed dates.</p></div></div>
  <div class="wide-panel closed-days-panel"><div class="panel-head"><div><h2>Add or update a closed day</h2><p>Friday and Saturday are already weekly off days.</p></div></div><form id="closed-day-form"><div class="closed-day-fields"><div class="field"><label for="closed-day-date">Closed date</label><input id="closed-day-date" type="date" required></div><div class="field"><label for="closed-day-category">Category</label><select id="closed-day-category"><option>Public holiday</option><option>Presidential closure</option><option>Other official closure</option></select></div><div class="field"><label for="closed-day-reason">Name / official announcement reference</label><input id="closed-day-reason" maxlength="300" required placeholder="Closure name or announcement reference"></div></div><p class="helper">Saving preserves the requested days and recalculates expected return for applicable leave, excluding holidays. Recorded actual returns stay unchanged. Fixed charter dates, no-pay leave, official duty and additional Hajj travel days retain their counting rules.</p><div class="actions"><button class="btn primary" id="closed-day-save" type="submit">Save closed day</button></div><p id="closed-day-message" role="status"></p></form></div>
  <div class="wide-panel"><div class="panel-head"><div><h2>Official closed dates</h2><p id="closed-day-count"></p></div></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Name / reference</th><th>Actions</th></tr></thead><tbody id="closed-day-table"></tbody></table></div></div></section>`;

function attendancePages(markup: string) {
  return markup
    .replace(/<button data-page="attendance">([\s\S]*?)<\/button>/,(_,content:string)=>`<div class="nav-group attendance-nav-group"><button type="button" id="attendance-toggle" aria-expanded="false" aria-controls="attendance-submenu" onclick="toggleAttendanceMenu()">${content}<svg class="nav-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button><div class="nav-submenu" id="attendance-submenu" hidden><button type="button" data-page="attendance">Attendance records</button><button type="button" data-page="closed-days">Closed Days</button></div></div>`)
    .replace('<section class="page" id="page-people">', closedDaysMarkup + '<section class="page" id="page-people">');
}

const staffOnLeaveRecordsMarkup = "<div class=\"leave-top-cards\">\n <div class=\"card leave-stat-card\"><div class=\"card-head\">Applied leave records</div><div class=\"metric\" id=\"leave-used\">0</div></div>\n <div class=\"card leave-stat-card\"><div class=\"card-head\">Requests pending</div><div class=\"metric\" id=\"leave-pending\">0</div></div>\n <div class=\"card leave-stat-card\"><div class=\"card-head\">Approved records</div><div class=\"metric\" id=\"leave-approved\">0</div></div>\n</div>\n<div class=\"wide-panel leave-record-panel\"><div class=\"panel-head\"><h2>Applied leave records</h2><span id=\"leave-result-count\" class=\"leave-result-count\" role=\"status\" aria-live=\"polite\"></span></div>\n <div class=\"manage-leave-filters leave-record-filters\">\n  <div class=\"field leave-record-search\"><label for=\"manage-leave-search\">Search staff or leave</label><input type=\"search\" class=\"filter\" id=\"manage-leave-search\" placeholder=\"Name, ID, machine PIN or reason\"></div>\n  <div class=\"field\"><label for=\"manage-leave-type\">Leave type</label><select class=\"filter\" id=\"manage-leave-type\"><option value=\"all\">All leave types</option></select></div>\n  <div class=\"field\"><label for=\"leave-filter\">Status</label><select class=\"filter\" id=\"leave-filter\"><option value=\"all\">All statuses</option><option>Pending</option><option>Approved</option><option>Completed</option><option>Declined</option></select></div>\n  <button type=\"button\" class=\"btn\" id=\"leave-filter-clear\">Clear filters</button>\n </div>\n <div class=\"table-wrap\"><table class=\"leave-record-table\"><thead><tr><th scope=\"col\">Employee</th><th scope=\"col\">Leave details</th><th scope=\"col\">Leave period</th><th scope=\"col\">Days</th><th scope=\"col\">Status</th><th scope=\"col\">Actions</th></tr></thead><tbody id=\"leave-table\"></tbody></table></div>\n</div>";

const leaveWorkspaceMarkup = `<div class="wide-panel leave-workspace" id="leave-workspace">
  <div class="panel-head"><div><h2 id="leave-editor-title">Leave plan</h2><p>Select a staff member to record or update leave.</p></div><span class="status present" id="leave-editor-mode">New record</span></div>
  <div class="leave-selection">
    <div class="staff-picker">
      <label for="lp-staff-search">Find a staff member</label>
      <div class="staff-search-bar"><input id="lp-staff-search" type="search" placeholder="Search name, employee ID or machine PIN" autocomplete="off" aria-controls="lp-staff-results"><button type="button" class="btn" id="lp-staff-search-button">Search</button><button type="button" class="btn" id="lp-staff-filter-button" aria-expanded="false" aria-controls="lp-staff-filters">Filters</button><button type="button" class="btn" id="lp-staff-reset">Reset</button></div>
      <div class="staff-picker-filters" id="lp-staff-filters" hidden><div class="field"><label for="lp-staff-role">Staff type</label><select id="lp-staff-role"><option value="">All staff types</option><option>Admin Staff</option><option>Administrator</option><option>Teacher</option><option>Technical Staff</option><option>Support Staff</option><option>Principal</option><option>Deputy Principal</option></select></div><div class="field"><label for="lp-staff-department">Department</label><select id="lp-staff-department"><option value="">All departments</option></select></div></div>
      <p class="staff-picker-hint" id="lp-staff-hint">Search all staff, or narrow the results with filters.</p>
      <div class="staff-picker-results" id="lp-staff-results" aria-label="Staff search results" hidden></div>
      <input id="lp-employee" type="hidden" value="">
    </div>
  </div>
  <div class="leave-staff-summary" id="leave-staff-summary" aria-live="polite"></div>
  <form id="leave-plan-form">
    <div class="leave-plan-grid">
      <div class="field"><label for="lp-type">Leave type</label><select id="lp-type"><option>Annual</option><option>Medical</option><option>Casual</option></select></div>
      <div class="field"><label for="lp-days">Days</label><input id="lp-days" type="number" min="0.5" step="0.5" value="1" required></div>
      <div class="field"><label for="lp-start">Leave starts</label><input id="lp-start" type="date" required></div>
      <div class="field"><label for="lp-end">Expected return (automatic)</label><input id="lp-end" type="date" required readonly></div>
      <div class="field"><label for="lp-reason">Reason / note</label><input id="lp-reason" placeholder="Optional"></div>
    </div>
    <div class="leave-plan-grid" id="medical-fields" hidden>
      <div class="field"><label for="lp-mc-file">Upload MC (optional)</label><input id="lp-mc-file" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"><p class="helper">You can save without a file and attach it later when editing. PDF, JPG or PNG, up to 5 MB.</p></div>
      <div id="mc-current-document" class="record-detail"></div>
    </div>
    <div class="leave-plan-grid" id="circumcision-fields" hidden><div class="field"><label for="lp-event-ref">Circumcision occasion / approval reference</label><input id="lp-event-ref" maxlength="200" placeholder="Same reference for requests relating to the same occasion"></div><p class="helper">Either parent may take up to 5 days for this occasion. Includes weekends; excludes public holidays.</p></div>
    <div class="leave-plan-grid" id="pilgrimage-fields" hidden>
      <div class="field"><label for="lp-trip-basis">Pilgrimage leave basis</label><select id="lp-trip-basis"><option value="">Choose leave basis</option><option>First paid Hajj</option><option value="Annual">Use annual leave</option><option value="No pay">Authorized no-pay leave</option></select></div>
      <div class="field" id="trip-first-field"><label class="check-label"><input type="checkbox" id="lp-trip-first"> I verified this is the employee's first paid Hajj, including prior service.</label></div>
      <div class="field" id="trip-office-field"><label for="lp-trip-office">Office location</label><select id="lp-trip-office"><option value="Male">Male'</option><option value="Atoll">Atoll</option></select></div>
      <div class="field" id="trip-charter-field"><label for="lp-trip-charter">Travel arrangement</label><select id="lp-trip-charter"><option value="no">Other travel (30-day base)</option><option value="yes">Chartered flight (actual travel dates)</option></select></div>
      <div class="field" id="trip-return-field"><label for="lp-trip-return">Charter return date (inclusive)</label><input id="lp-trip-return" type="date"></div>
      <div class="field" id="trip-before-field"><label for="lp-trip-before">Atoll travel days before departure from Male' (0–15)</label><input id="lp-trip-before" type="number" min="0" max="15" value="0"></div>
      <div class="field" id="trip-permission-field"><label for="lp-trip-permission">Office permission / approval reference</label><input id="lp-trip-permission" maxlength="300"></div>
      <p class="helper">Atoll offices receive 15 additional calendar days including holidays. Allocate any days needed before departure from Male'; the rest follow the base period. Umra and later Hajj require annual leave or authorized no-pay leave.</p>
    </div>
    <p class="validation-message leave-policy-note" id="leave-policy-note" hidden></p>
    <div class="field leave-edit-reason" id="leave-edit-reason" hidden><label for="lp-edit-reason">Reason for change (required)</label><textarea id="lp-edit-reason" rows="3" maxlength="1000"></textarea></div>
    <div class="leave-plan-actions"><span id="leave-plan-message" role="status">Choose staff to begin.</span><button class="btn primary" id="lp-save" type="submit" disabled>Save</button><button class="btn primary" id="lp-update" type="button" disabled>Update</button><button class="btn" id="lp-clear" type="button">Clear</button></div>
  </form>
  <div id="leave-edit-history" class="leave-edit-history"></div>
</div>`;

const appMarkup = "<div class=\"app\">\n<aside class=\"sidebar\"><div class=\"brand\"><span class=\"brand-mark\">H</span>Haaziry</div><div class=\"nav-label\">Workspace</div><nav class=\"nav\" id=\"nav\">\n<button class=\"active\" data-page=\"overview\"><svg viewBox=\"0 0 24 24\"><rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/></svg>Overview</button>\n<button data-page=\"attendance\"><svg viewBox=\"0 0 24 24\"><path d=\"M4 5h16M4 10h16M4 15h10M4 20h8\"/><path d=\"m17 17 2 2 4-5\"/></svg>Attendance</button>\n<button data-page=\"leaves\"><svg viewBox=\"0 0 24 24\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M16 3v4M8 3v4M3 10h18m-12 4h2m3 0h2m-7 3h2\"/></svg>Staff Leave</button>\n<button data-page=\"people\"><svg viewBox=\"0 0 24 24\"><circle cx=\"9\" cy=\"8\" r=\"4\"/><path d=\"M2 21v-2a7 7 0 0 1 14 0v2M16 4a4 4 0 0 1 0 8m2 2a6 6 0 0 1 4 5v2\"/></svg>Employees</button>\n<button data-page=\"system-users\" id=\"system-users-nav\" hidden><svg viewBox=\"0 0 24 24\"><path d=\"M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z\"/><circle cx=\"12\" cy=\"10\" r=\"2.5\"/><path d=\"M8.5 16a4 4 0 0 1 7 0\"/></svg>System Users</button></nav>\n<div class=\"side-bottom\"><div class=\"device\"><div class=\"device-top\"><i class=\"pulse\"></i> Fingerprint machine</div><small id=\"device-state\">Waiting for iClock990</small></div><div class=\"profile\"><div class=\"avatar\">HR</div><div><b id=\"viewer-name\">HR Administrator</b><small>People & Culture</small></div><button id=\"logout\" class=\"text-btn\" style=\"margin-left:auto\">Sign out</button></div></div></aside>\n<main class=\"main\"><header class=\"topbar\"><div class=\"crumb\"><b>Haaziry</b> &nbsp;/&nbsp; <span id=\"crumb\">Overview</span></div><div class=\"top-right\"><span class=\"today\" id=\"today\"></span><div class=\"avatar\">HR</div></div></header>\n<div class=\"content\">\n<section class=\"page active\" id=\"page-overview\"><div class=\"greeting\"><div><p class=\"eyebrow\" id=\"greet-date\">MONDAY, OCTOBER 26</p><h1>Good morning, team <span style=\"font-size:22px\">✳</span></h1><p>Here’s what’s happening with your people today.</p></div><div class=\"actions\"><span class=\"device-chip\" id=\"device-chip\">Waiting for device</span></div></div>\n<div class=\"cards\"><div class=\"card\"><div class=\"card-head\">Present today <span class=\"card-ico\"><svg viewBox=\"0 0 24 24\"><path d=\"m5 12 4 4L19 6\"/></svg></span></div><div class=\"metric\" id=\"stat-present\">24</div><div class=\"metric-foot\"><span class=\"good\">On schedule</span> · of <span id=\"stat-total\">28</span> employees</div></div><div class=\"card\"><div class=\"card-head\">Late arrivals <span class=\"card-ico\" style=\"background:#fbf3e7;color:#b7833e\"><svg viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/></svg></span></div><div class=\"metric\" id=\"stat-late\">2</div><div class=\"metric-foot\">Late from 7:01 AM: Teachers, Technical, Support & Deputy Principal · 8:01 AM: Admin & Principal</div></div><div class=\"card\"><div class=\"card-head\">On leave <span class=\"card-ico\" style=\"background:#f2eef7;color:#79649e\"><svg viewBox=\"0 0 24 24\"><path d=\"M7 3v4m10-4v4M4 10h16M5 5h14a1 1 0 0 1 1 1v13H4V6a1 1 0 0 1 1-1Z\"/></svg></span></div><div class=\"metric\" id=\"stat-leave\">2</div><div class=\"metric-foot\">Approved leave today</div></div></div>\n<div class=\"grid-main\"><div><div class=\"panel\"><div class=\"panel-head\"><div><h2>Today’s attendance</h2><p>Check-in activity across your team</p></div><button class=\"text-btn\" onclick=\"go('attendance')\">View all →</button></div><div class=\"table-wrap\"><table><thead><tr><th>Employee</th><th>Check in</th><th>Check out</th><th>Hours</th><th>Status</th></tr></thead><tbody id=\"attendance-preview\"></tbody></table></div></div>\n<div class=\"panel leave-panel\"><div class=\"panel-head\"><div><h2>Staff leave summary</h2><p>Today and the next 30 days</p></div><button class=\"text-btn\" onclick=\"go('manage')\">Manage →</button></div><div class=\"leave-summary overview-leave-summary\" id=\"overview-leave-summary\" aria-live=\"polite\"></div></div></div>\n<div class=\"right-col\"><div class=\"panel\"><div class=\"panel-head\"><div><h2>Recent activity</h2><p>Latest team check-ins</p></div><span style=\"font-size:10px;color:#8b958d\">Today</span></div><div class=\"timeline\" id=\"activity\"></div></div><div class=\"panel leave-panel\"><div class=\"panel-head\"><div><h2>iClock990 live connection</h2><p>Automatic attendance sync</p></div><span class=\"card-ico\"><svg viewBox=\"0 0 24 24\"><path d=\"M12 16V4m-4 4 4-4 4 4M4 14v5h16v-5\"/></svg></span></div><div style=\"padding:14px 17px 17px\"><p style=\"font-size:11px;color:#737e76;line-height:1.55;margin:0 0 12px\">Punch logs arrive from the iClock990 over the office network.</p><div class=\"device-last\"><span class=\"pulse\"></span><span id=\"device-last-seen\">Waiting for the first device check-in</span></div></div></div></div></div></section>\n<section class=\"page\" id=\"page-attendance\"><div class=\"section-title\"><div><h1>Attendance</h1><p>Daily hours, check-ins and fingerprint machine records.</p></div><div class=\"actions\"><button class=\"btn\" onclick=\"openModal('manual')\">＋ Add entry</button><button class=\"btn\" onclick=\"exportAttendance()\">↓ Export CSV</button></div></div><div class=\"filters\"><input class=\"filter\" type=\"date\" id=\"attendance-date\"><select class=\"filter\" id=\"attendance-filter\"><option value=\"all\">All statuses</option><option>Present</option><option>Late</option><option>Absent</option><option>On leave</option></select><button class=\"btn\" onclick=\"exportAttendance()\">↓ Export CSV</button></div><div class=\"cards\" style=\"margin-top:17px\"><div class=\"card\"><div class=\"card-head\">Present</div><div class=\"metric\" id=\"att-present\">24</div></div><div class=\"card\"><div class=\"card-head\">Late</div><div class=\"metric\" id=\"att-late\">2</div></div><div class=\"card\"><div class=\"card-head\">Absent</div><div class=\"metric\" id=\"att-absent\">0</div></div><div class=\"card\"><div class=\"card-head\">On leave</div><div class=\"metric\" id=\"att-leave\">2</div></div></div><div class=\"wide-panel\"><div class=\"panel-head\"><div><h2>Daily records</h2><p id=\"attendance-day-label\">Attendance for today</p></div></div><div class=\"table-wrap\"><table><thead><tr><th>Employee</th><th>Date</th><th>Check in</th><th>Check out</th><th>Hours</th><th>Source</th><th>Status</th></tr></thead><tbody id=\"attendance-table\"></tbody></table></div></div></section>\n<section class=\"page\" id=\"page-leaves\"><div class=\"section-title\"><div><h1>Leave management</h1><p>Requests and employee balances in one place.</p></div><button class=\"btn primary\" onclick=\"openModal('leave')\">＋ New leave request</button></div><div class=\"leave-top-cards\"><div class=\"card\"><div class=\"card-head\">Annual leave used</div><div class=\"metric\" id=\"leave-used\">42 <span style=\"font-size:12px;color:#88928a;font-weight:500\">days</span></div><div class=\"progress\"><i style=\"width:42%\"></i></div></div><div class=\"card\"><div class=\"card-head\">Requests pending</div><div class=\"metric\" id=\"leave-pending\">3</div><div class=\"metric-foot\">Needs review by HR</div></div><div class=\"card\"><div class=\"card-head\">Approved this month</div><div class=\"metric\" id=\"leave-approved\">8</div><div class=\"metric-foot\">Across all leave types</div></div></div><div class=\"wide-panel\"><div class=\"panel-head\"><div><h2>Leave requests</h2><p>Review and update team requests</p></div><select class=\"filter\" id=\"leave-filter\"><option value=\"all\">All requests</option><option>Pending</option><option>Approved</option><option>Declined</option></select></div><div class=\"table-wrap\"><table><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Used / planned</th><th>Reason</th><th>Status</th><th>Action</th></tr></thead><tbody id=\"leave-table\"></tbody></table></div></div><h2 class=\"subheading\">Employee balances</h2><div class=\"wide-panel\"><div class=\"table-wrap\"><table><thead><tr><th>Employee</th><th>Annual</th><th>Medical</th><th>Casual</th><th>Manage</th></tr></thead><tbody id=\"balance-table\"></tbody></table></div></div></section>\n<section class=\"page\" id=\"page-system-users\"><div class=\"section-title\"><div><h1>System Users</h1></div><button class=\"btn primary\" id=\"system-user-add\" type=\"button\">＋ Add user</button></div><div class=\"wide-panel\"><div class=\"panel-head\"><div><h2>Sign-in accounts</h2><span id=\"system-users-count\" class=\"leave-result-count\"></span></div></div><div class=\"table-wrap\"><table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Created</th><th class=\"employee-action-header\">Action</th></tr></thead><tbody id=\"system-users-table\"></tbody></table></div></div></section>\n<section class=\"page\" id=\"page-people\"><div class=\"section-title\"><div><h1>Employees</h1><p>Manage people and their leave entitlements.</p></div><button class=\"btn primary\" onclick=\"openModal('employee')\">＋ Add employee</button></div><div class=\"wide-panel\"><div class=\"panel-head\"><div><h2>Team directory</h2><p id=\"people-count\">28 people</p></div><div class=\"people-filters\"><input class=\"filter\" placeholder=\"Search employees…\" id=\"people-search\"></div></div><div class=\"table-wrap\"><table><thead><tr><th>Employee</th><th>Role</th><th>Department</th><th>Machine PIN</th><th>ID card number</th><th class=\"employee-action-header\">Action</th></tr></thead><tbody id=\"people-table\"></tbody></table></div></div></section>\n</div></main></div>\n<div class=\"modal-back\" id=\"modal-back\" onclick=\"if(event.target===this)closeModal()\"><div class=\"modal\"><div class=\"modal-head\"><h2 id=\"modal-title\">New request</h2><button class=\"close\" onclick=\"closeModal()\">×</button></div><div id=\"modal-body\"></div><div class=\"modal-actions\"><button class=\"btn\" onclick=\"closeModal()\">Cancel</button><button class=\"btn primary\" id=\"modal-save\">Save</button></div></div></div><div class=\"toast\" id=\"toast\"></div>";

function staffLeavePages(markup: string) {
  return attendancePages(markup)
    .replace(/<button data-page="leaves">([\s\S]*?)<\/button>/,(_,content:string)=>`<div class="nav-group"><button type="button" id="staff-leave-toggle" aria-expanded="false" aria-controls="staff-leave-submenu" onclick="toggleStaffLeave()">${content}<svg class="nav-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button><div class="nav-submenu" id="staff-leave-submenu" hidden><button type="button" data-page="leaves">Leave</button><button type="button" data-page="sick">Sick Leave</button></div></div>`)
    .replace('data-page="sick">Sick Leave</button>','data-page="sick">Sick Leave</button><button type="button" data-page="manage">Manage Leave</button><button type="button" data-page="staff-on-leave">Staff on Leave</button>')
    .replace(/<section class="page" id="page-leaves">([\s\S]*?)<\/section>/,(_,content:string)=>{
      const records=content.slice(content.indexOf('<div class="leave-top-cards">')).replace('<option>Declined</option>','<option>Completed</option><option>Declined</option>').replace('Approved this month','Approved records').replace('<h2>Leave requests</h2><p>Review and update team requests</p>','<h2>Applied leave records</h2><p>Find an existing record and choose Edit to update it.</p>').replace('<select class="filter" id="leave-filter">','<div class="manage-leave-filters"><input type="search" class="filter" id="manage-leave-search" aria-label="Search applied leave" placeholder="Search name, ID, PIN or reason"><select class="filter" id="manage-leave-type" aria-label="Filter leave type"><option value="all">All leave types</option></select><select class="filter" id="leave-filter" aria-label="Filter leave status">').replace('</select></div><div class="table-wrap">','</select></div></div><div class="table-wrap">').replace('<h2 class="subheading">Employee balances</h2>','<div class="balance-heading"><h2 class="subheading" id="balance-heading">Employee balances</h2></div><div class="balance-toolbar"><div class="field balance-type-field"><label for="balance-type">Leave type</label><select id="balance-type" class="filter" aria-controls="balance-table"><option value="Annual">Annual</option></select></div><form id="balance-search-form" class="balance-search-form" role="search" aria-labelledby="balance-heading"><input type="search" class="filter" id="balance-search" aria-label="Search staff balances" aria-controls="balance-table" placeholder="Search name, employee ID or machine PIN"><button type="submit" class="btn">Search</button><button type="button" id="balance-search-clear" class="btn">Clear</button></form></div>');
      const balanceStart=records.indexOf('<div class="balance-heading">');
      const appliedRecords=staffOnLeaveRecordsMarkup,balances=records.slice(balanceStart);
      const header=(sick:boolean)=>`<div class="section-title"><div><h1>${sick?'Sick Leave':'Leave'}</h1><p>${sick?'Sick leave with MC and without MC. One shared 30-day allowance.':'Apply for non-sick leave, including annual, family, no pay and other approved leave types.'}</p></div><button type="button" class="btn primary" onclick="openModal('leave')">＋ ${sick?'Record sick leave':'Record leave'}</button></div>`;
      return `<section class="page" id="page-leaves">${header(false)}<div id="leave-host"><div id="leave-shared">${leaveWorkspaceMarkup}</div></div></section><section class="page" id="page-sick">${header(true)}<div id="sick-host"></div></section><section class="page" id="page-manage"><div class="section-title"><div><h1>Manage Leave</h1><p>Update applied leave and manage employee balances. Choose Edit on Staff on Leave to change a record.</p></div><button type="button" class="btn" onclick="go('staff-on-leave')">Staff on Leave →</button></div><div id="manage-host"></div>${balances}</section><section class="page" id="page-staff-on-leave"><div class="section-title"><div><h1>Staff on Leave</h1><p>Applied leave records across all leave types.</p></div></div><div id="leave-records">${appliedRecords}</div></section>`;
    });
}

const appraisalPagesList = [['appraisal-required','Days Required to Attend'],['appraisal-attended','Days Attended'],['appraisal-on-time','Days Attended (On Time)'],['appraisal-absent','Absent Days'],['appraisal-disciplinary','Disciplinary Actions'],['appraisal-report','Appraisal Report'],['appraisal-supervisor','Supervisor']];
const appraisalWorkspaceMarkup = `<div id="appraisal-shared">
  <form id="appraisal-filters" class="appraisal-filters wide-panel">
    <div class="field"><label for="appraisal-year">Appraisal Period</label><input id="appraisal-year" type="number" min="2000" max="2100" step="1" required></div>
    <div class="field" id="appraisal-basis-field" hidden><label for="appraisal-basis">Calculation basis</label><select id="appraisal-basis"><option value="working">Working days</option></select></div>
    <div class="field appraisal-employee-search"><label for="appraisal-search">Employee</label><div class="appraisal-search-controls"><input id="appraisal-search" type="search" placeholder="Name, ID, PIN or department"><button type="button" id="appraisal-search-button" class="btn">Search</button></div></div>
    <button type="button" id="appraisal-supervisor-button" class="btn" aria-expanded="false" aria-controls="appraisal-supervisor-panel">Supervisor</button><button type="submit" class="btn primary">View</button><button type="button" class="btn" id="appraisal-pdf">PDF</button><button type="button" class="btn" id="appraisal-docx">Word (.docx)</button>
    <div id="appraisal-supervisor-panel" class="appraisal-supervisor-panel" hidden><label for="appraisal-supervisor-search">Supervisor</label><input id="appraisal-supervisor-search" type="search" placeholder="Search school supervisors"><div id="appraisal-supervisor-options"></div></div>
  </form>
  <div class="appraisal-period"><span id="appraisal-period"></span><span id="appraisal-count"></span></div><div id="appraisal-kpis" class="appraisal-kpis"></div>
  <div class="disciplinary-toolbar" id="disciplinary-toolbar" hidden><button type="button" id="disciplinary-new" class="btn primary">Record disciplinary action</button></div>
  <div id="supervisor-workspace" class="wide-panel supervisor-workspace" hidden><div class="panel-head"><h2 id="supervisor-editor-title">Assign supervisor</h2></div>
    <form id="supervisor-assignment-form"><div class="supervisor-assignment-grid">
      <div class="field" id="assignment-supervisor-picker"><div class="supervisor-picker-heading"><label for="assignment-supervisor-search">Supervisor</label><span id="assignment-supervisor-selected" aria-live="polite"></span></div><input id="assignment-supervisor-search" type="search" placeholder="Filter supervisors" autocomplete="off"><input id="assignment-supervisor-id" type="hidden"><div id="assignment-supervisor-results" class="supervisor-choice-options" role="radiogroup" aria-label="Supervisor"></div></div>
      <div class="field supervisor-staff-field"><label for="assignment-staff-search">Staff members</label><input id="assignment-staff-search" type="search" placeholder="Search staff to select"><div class="supervisor-selection-actions"><button type="button" id="assignment-select-all" class="text-btn">Select matching staff</button><button type="button" id="assignment-select-none" class="text-btn">Clear selection</button><span id="assignment-selected-count"></span></div><div id="assignment-staff-options" class="supervisor-staff-options" role="group" aria-label="Staff members"></div></div>
      </div><div class="supervisor-form-actions"><button type="submit" id="assignment-save" class="btn primary">Save assignments</button><button type="button" id="assignment-reset" class="btn">Clear</button></div></form></div>
  <div class="wide-panel appraisal-roster"><div class="panel-head"><div><h2 id="appraisal-roster-title">Employees</h2><span id="appraisal-roster-period"></span></div></div><div class="table-wrap"><table><thead id="appraisal-head"></thead><tbody id="appraisal-table"></tbody></table></div></div>
</div>`;
function appraisalPages(markup: string) {
  const nav=`<div class="nav-group appraisal-nav-group"><button type="button" id="appraisal-toggle" aria-expanded="false" aria-controls="appraisal-submenu" onclick="toggleAppraisalMenu()"><svg viewBox="0 0 24 24"><path d="M5 3h14v18H5zM8 8h8M8 12h8m-8 4h4"/></svg>Appraisal<svg class="nav-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button><div class="nav-submenu" id="appraisal-submenu" hidden>${appraisalPagesList.map(([id,title])=>`<button type="button" data-page="${id}">${title}</button>`).join('')}</div></div>`;
  const pages=appraisalPagesList.map(([id,title],index)=>`<section class="page" id="page-${id}"><div class="section-title"><h1>${title}</h1></div><div id="${id}-host">${index===0?appraisalWorkspaceMarkup:''}</div></section>`).join('');
  return markup.replace('<button data-page="people">',nav+'<button data-page="people">').replace('<section class="page" id="page-people">',pages+'<section class="page" id="page-people">');
}

function mobileControls(markup: string) {
  return markup.replace(/(<div class="metric-foot">)(Late from [^<]*)(<\/div>)/, '$1<span class="metric-desktop-note">$2</span><span class="mobile-metric-note">Based on staff schedules</span>$3').replace('<div class="top-right">','<div class="top-right"><button type="button" id="mobile-signout" class="mobile-signout" aria-label="Sign out" title="Sign out"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H5v16h4m5-12 4 4-4 4m-6-4h10"/></svg></button>');
}

function withoutHelperText(markup: string) {
  return markup
    .replace(/<p>[^<]*<\/p>/g, '')
    .replace(/<p class="helper">[\s\S]*?<\/p>/g, '')
    .replace(/<small class="report-field-note">[\s\S]*?<\/small>/g, '')
    .replace(/<p class="staff-picker-hint" id="lp-staff-hint">[\s\S]*?<\/p>/g, '<p id="lp-staff-hint" hidden></p>')
    .replace(/<div class="metric-foot">([\s\S]*?)<\/div>/g, (whole: string, content: string) => content.includes('id="stat-total"') ? whole : '')
    .replace(/<div class="wide-panel report-initial" id="ar-empty">[\s\S]*?<\/div>/g, '<div id="ar-empty"></div>')
    .replace(/<p style="[^"]*">Punch logs arrive[\s\S]*?<\/p>/g, '')
    .replace('<small>People & Culture</small>', '');
}

const startupWatchdog = `(function(){
  const loading=document.getElementById('session-loading');
  if(!loading)return;
  const fail=function(){if(!loading.hidden){document.getElementById('startup-error').hidden=false;loading.classList.add('startup-failed');}};
  const timer=setTimeout(fail,20000);
  const observer=new MutationObserver(function(){if(loading.hidden){clearTimeout(timer);observer.disconnect();}});
  observer.observe(loading,{attributes:true,attributeFilter:['hidden']});
  window.addEventListener('haaziry:startup-error',fail);
  window.addEventListener('error',fail);
})();`;

export default function Home() {
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const script = document.createElement("script");
    script.src = "/app.js?v=supervision-disciplinary-29-correction-notes-30-individual-summary-31-holiday-extension-32-opening-balances-33-supervisor-ticks-34-document-exports-32-startup-fix-35-attendance-controls-36-balance-search-37-compact-balances-38-staff-on-leave-39-service-periods-34-csc-35-leave-record-design-40-attendance-fit-41-duty-simple-42-leave-fields-42-return-preview-43-employee-number-44-manual-punches-45-deny-logs-46-anniversary-renewal-47-appraisal-working-49-appraisal-sections-50-no-helpers-51-leading-teacher-52-stable-forms-57-deny-manual-48-duty-days-52-punch-review-49-ministry-supervision-53-day-first-50-simple-supervision-54-system-users-55-joining-date-lock-55-user-theme-56-admin-balances-57-attendance-search-56-attendance-staff-picker-57-remove-attendance-report-58";
    script.async = false;
    script.onerror = () => window.dispatchEvent(new Event("haaziry:startup-error"));
    const reports = document.createElement("script");
    reports.src = "/report-downloads.js?v=shared-downloads-1";
    reports.async = false;
    reports.onerror = () => window.dispatchEvent(new Event("haaziry:startup-error"));
    reports.onload = () => document.body.appendChild(script);
    const dates = document.createElement("script");
    dates.src = "/date-format.js?v=day-first-3";
    dates.async = false;
    dates.onerror = () => window.dispatchEvent(new Event("haaziry:startup-error"));
    dates.onload = () => document.body.appendChild(reports);
    document.body.appendChild(dates);
  }, []);
  return <>
    <div id="session-loading" className="session-loading" role="status" aria-live="polite">
      <span className="session-loading-spinner" aria-hidden="true" />
      <p className="startup-opening">Opening Haaziry…</p>
      <div id="startup-error" hidden><p>The app could not finish loading. Reload to try again.</p><a className="btn primary" href="">Reload app</a></div>
    </div>
    <script dangerouslySetInnerHTML={{ __html: startupWatchdog }} />
    <main id="login-wall" className="login-wall" hidden>
      <div className="login-shell">
        <header className="login-heading">
          <div className="login-school-mark"><Image src="/has-logo.jpg" alt="HAS school logo" width={128} height={114} priority unoptimized /></div>
          <p className="login-school-name">Haaziry</p>
          <h1>Welcome back</h1>
        </header>
        <section className="login-card" aria-labelledby="login-title">
          <div className="login-card-heading"><span className="login-access-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg></span><div><h2 id="login-title">Sign in</h2></div></div>
          <form id="login-form">
            <label htmlFor="login-username">Username</label>
            <div className="login-password-field" style={{ marginBottom: 14 }}>
              <svg className="login-lock" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>
              <input id="login-username" name="username" type="text" placeholder="Administrator" autoComplete="username" maxLength={32} />
            </div>
            <label htmlFor="login-password">Password</label>
            <div className="login-password-field">
              <svg className="login-lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg>
              <input id="login-password" name="password" type="password" placeholder="Enter your password" autoComplete="current-password" aria-describedby="login-error" required />
              <button id="toggle-password" type="button" aria-label="Show password" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button>
            </div>
            <button type="button" id="forgot-password" className="login-forgot" aria-expanded="false" aria-controls="password-recovery">Forgot password?</button>
            <div id="login-error" role="alert" aria-live="polite" />
            <button className="btn primary login-submit" type="submit">Sign in<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg></button>
          </form>
          <section id="password-recovery" className="password-recovery" aria-labelledby="recovery-title" hidden>
            <h3 id="recovery-title">Reset your password</h3>

            <form id="recovery-form">
              <div id="recovery-email-step"><label htmlFor="recovery-email">Recovery email</label><input id="recovery-email" name="recovery-email" type="email" autoComplete="email" maxLength={254} placeholder="Your registered email address" required /></div>
              <div id="recovery-code-step" hidden><label htmlFor="recovery-code">6-digit email code</label><input id="recovery-code" name="recovery-code" type="text" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" maxLength={6} disabled required /></div>
              <div id="recovery-password-step" hidden>
                <label htmlFor="recovery-password">New password</label><input id="recovery-password" name="new-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} placeholder="At least 8 characters" disabled required />
                <label htmlFor="recovery-confirm">Confirm new password</label><input id="recovery-confirm" name="confirm-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} disabled required />
              </div>
              <div id="recovery-message" role="status" aria-live="polite" />
              <button className="btn primary login-submit" type="submit">Send code</button>
              <button className="recovery-back" id="recovery-resend" type="button" hidden>Resend code</button>
              <button className="recovery-back" id="recovery-restart" type="button" hidden>Use a different email / start again</button>
              <button className="recovery-back" id="recovery-back" type="button">Back to sign in</button>
            </form>
          </section>
        </section>
        <footer className="login-footer"><span className="login-footer-dot" />Haaziry<span className="login-footer-divider">/</span>School administration</footer>
      </div>
    </main>
    <div id="app-container" dangerouslySetInnerHTML={{ __html: withoutHelperText(mobileControls(appraisalPages(staffLeavePages(appMarkup
      .replace(/<section class="page" id="page-attendance">[\s\S]*?<\/section>/, attendanceMarkup)
      )))) }} />
  </>;
}
