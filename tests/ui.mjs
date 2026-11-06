// UI regression checks. No browser network, live accounts, or database mutations.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');

for (const phrase of [
  'aria-label="Admin navigation"','Three steps to a ready election',
  'Voters & vouchers','Print all available vouchers',
  'id="printSelectedVouchers"','id="printAllQrSlips"',
  'id="issueLegacyQrVouchers"','id="bulkPanel"',
  'election-mode-option','name="isTest" value="yes"',
  'Unchecked = OFFICIAL','id="deleteElection"',
  'role="dialog" aria-modal="true"','aria-live="polite"',
  'ballot-progress','selection-hint','Review & Submit',
  'id="finalSubmit"','Copy credentials','password-toggle'
]) assert.ok(ui.includes(phrase), `Missing UI feature: ${phrase}`);
for (const phrase of [
  '.sidebar-links','.stats-grid','.dashboard-columns','.election-workspace',
  '.election-select','.directory-filters','.row-menu','.disclosure',
  '.voter-table tr','.ballot-footer','prefers-reduced-motion',
  'max-width:600px','max-width:860px','@media print'
]) assert.ok(css.includes(phrase), `Missing UI style: ${phrase}`);
assert.match(html,/app\.js\?v=2\.5\.5-attendance1/);
assert.match(html,/styles\.css\?v=2\.5\.5-attendance1/);
// Attendance print shows the text-only letterhead only in participation reports.
for (const phrase of [
  'CASA VERDE DE BAÑADEROS HOA, INC.',
  'Brgy. Bañadero, Calamba City, Laguna',
  'DHSUD COI No. R4A - 2611',
  'TIN No. 659-907-147-00000',
  'Voters Attendance Record',
  '${participationPrintHead(d)}',
  'participation-report-table',
  'Print Voters Attendance Record (A4)'
]) assert.ok(ui.includes(phrase), `Missing voter attendance print feature: ${phrase}`);
assert.ok(ui.includes('<th>Date &amp; Time Voted (PHT)</th>')); 
assert.ok(ui.includes('v.voted&&v.voted_at?esc(phDateTime(v.voted_at))')); 
assert.ok(css.includes('.attendance-print-header .attendance-hoa-name'));
assert.ok(css.includes('.participation-section-title {display:none!important}'));
assert.match(ui,/function drawParticipation\(d\).*?\$\{participationPrintHead\(d\)\}/s);
assert.ok(!ui.slice(ui.indexOf('function drawResults(d)'),ui.indexOf('function participationPrintHead(d)')).includes('participationPrintHead(d)'));
assert.ok(worker.includes('hoa_delete_test_election')); // No server-side behavior removed.
console.log('PASS UI: simplified admin navigation, mobile voter cards, accessible dialogs, election setup, voucher actions, ballot steps, versioned assets.');
