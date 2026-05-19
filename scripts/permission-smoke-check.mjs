import fs from 'fs';
import path from 'path';

function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

function assertContains(content, needle, label) {
  if (!content.includes(needle)) {
    throw new Error(`FAILED: ${label} -> missing "${needle}"`);
  }
  console.log(`PASS: ${label}`);
}

function run() {
  const importsApi = read('src/app/api/imports/route.ts');
  const branchReportApi = read('src/app/api/reports/branch-unified/route.ts');
  const regionalReportApi = read('src/app/api/reports/regional-unified/route.ts');
  const branchImporter = read('src/lib/importers/branch-import.ts');
  const reportNine = read('src/lib/reports/report-nine-excel.ts');

  assertContains(
    importsApi,
    'parsedTargetOrgId !== user.orgUnitId',
    'Import target locked to own org'
  );
  assertContains(
    importsApi,
    'sourceOrg.parentId !== targetOrg.id',
    'Import allows direct-child flow only'
  );
  assertContains(
    branchReportApi,
    'targetOrgId: bId',
    'Branch report scope is RBAC-checked'
  );
  assertContains(
    regionalReportApi,
    'targetOrgId: regId',
    'Regional report scope is RBAC-checked'
  );
  assertContains(
    branchImporter,
    'INTEGRITY_SIGNATURE',
    'Branch import verifies signed integrity'
  );
  assertContains(
    reportNine,
    'INTEGRITY_SIGNATURE',
    'Regional report import verifies signed integrity'
  );

  console.log('\nPermission smoke check passed.');
}

try {
  run();
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(1);
}
