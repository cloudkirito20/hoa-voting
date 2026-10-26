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
assert.match(html,/app\.js\?v=2\.5\.5/);
assert.match(html,/styles\.css\?v=2\.5\.5/);
assert.ok(worker.includes('hoa_delete_test_election')); // No server-side behavior removed.
console.log('PASS UI: simplified admin navigation, mobile voter cards, accessible dialogs, election setup, voucher actions, ballot steps, versioned assets.');
