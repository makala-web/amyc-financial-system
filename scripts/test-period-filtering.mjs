import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

function strictReportNineLookup({ exact, month, annual }) {
  if (exact) return exact;
  if (month && month > 0) return null;
  return annual ?? null;
}

function strictReportMatchesMonth(reportMonth, requestedMonth) {
  if (!requestedMonth) return true;
  return reportMonth === requestedMonth;
}

function strictSnapshotMatchesMonth({ recordMonth, snapshotMonth, requestedMonth }) {
  if (!requestedMonth) return true;
  return recordMonth === requestedMonth || snapshotMonth === requestedMonth;
}

assert.equal(
  strictReportNineLookup({ exact: null, month: 3, annual: { month: 0 } }),
  null,
  'Monthly Markaz aggregation must not fall back to annual/all-month Report Nine snapshots.'
);

assert.equal(
  strictReportMatchesMonth(0, 3),
  false,
  'All-month uploaded Jimbo reports must not match a specific month.'
);

assert.equal(
  strictSnapshotMatchesMonth({ recordMonth: 0, snapshotMonth: 0, requestedMonth: 3 }),
  false,
  'All-month branch snapshots must not match a specific monthly report.'
);

assert.equal(
  strictSnapshotMatchesMonth({ recordMonth: 0, snapshotMonth: 3, requestedMonth: 3 }),
  true,
  'A snapshot with explicit matching month may be accepted even if stored in a legacy month-0 record.'
);

const reportNineSource = read('src/lib/reports/consolidated-report-nine.ts');
const markazSource = read('src/lib/reports/markaz-unified-offline.ts');
const regionalSource = read('src/lib/reports/regional-unified-offline.ts');

assert.match(
  reportNineSource,
  /if \(month && month > 0\) \{\s*return null;\s*\}/,
  'getStoredReportNineFlexible must return null when a monthly exact match is missing.'
);

assert.doesNotMatch(
  reportNineSource,
  /annualForMonth/,
  'Annual snapshot fallback for monthly Report Nine lookups must stay removed.'
);

assert.doesNotMatch(
  markazSource,
  /if \(!report\.month \|\| report\.month === 0\) return true;/,
  'Markaz monthly aggregation must not accept all-month reports.'
);

assert.doesNotMatch(
  regionalSource,
  /yearRecords = records\.filter\(\(record\) => record\.reportType === 'regional' && record\.year === year\)/,
  'Regional monthly aggregation must not fall back to all records for the year.'
);

console.log('Period filtering hardening tests passed.');
