import { db } from '@/lib/db-offline';
import type { BranchReportSnapshot } from '@/lib/exporters/branch-export';
import { parseBranchSnapshotMonth } from '@/lib/reports/branch-snapshot-month';
import { notifyBranchReportImported } from '@/lib/reports/regional-unified-offline';
import { mirrorNativeRecord } from '@/lib/storage/native-record-store';

export async function saveImportedBranchReportOffline(options: {
  snapshot: BranchReportSnapshot;
  branchId: number;
  uploadedBy?: number;
  fileName?: string;
  overwrite?: boolean;
}) {
  const { snapshot, branchId, uploadedBy, fileName, overwrite = false } = options;
  const branch = await db.orgUnits.get(branchId);
  if (!branch || branch.type !== 'tawi') {
    throw new Error(`Tawi ${branchId} halipatikani au si tawi.`);
  }

  const regionId = branch.parentId;
  if (!regionId) {
    throw new Error(`Tawi ${branch.name} halina Jimbo la mzazi.`);
  }

  const month = parseBranchSnapshotMonth(snapshot.month);
  const now = new Date().toISOString();

  const existing = (
    await db.regionalReports
      .where('[unitId+month+year]')
      .equals([regionId, month, snapshot.year])
      .toArray()
  ).find((record) => record.reportType === 'regional');

  type StoredBranchState = {
    branchSnapshots?: Record<string, BranchReportSnapshot>;
    importedBranchIds?: number[];
    fileName?: string;
  };

  const parseStoredState = (): StoredBranchState => {
    if (!existing?.dataJson) return {};
    try {
      return JSON.parse(existing.dataJson) as StoredBranchState;
    } catch {
      return {};
    }
  };

  const storedState = parseStoredState();
  const branchSnapshots: Record<string, BranchReportSnapshot> = {
    ...(storedState.branchSnapshots || {}),
  };

  if (branchSnapshots[String(branchId)] && !overwrite) {
    throw new Error(`Upakiaji rudufu umezuiwa: tawi ${branch.name} tayari limeingizwa kwa kipindi hiki.`);
  }

  if (branchSnapshots[String(branchId)] && overwrite) {
    const archiveId = (await db.reportArchives.add({
      entity: 'branch_report',
      entityId: branchId,
      sourceOrgId: branchId,
      targetOrgId: regionId,
      month,
      year: snapshot.year,
      previousDataJson: JSON.stringify(branchSnapshots[String(branchId)]),
      replacementDataJson: JSON.stringify(snapshot),
      reason: 'Controlled replacement of branch report snapshot',
      archivedBy: uploadedBy,
      archivedAt: now,
    })) as number;
    await mirrorNativeRecord('reportArchives', archiveId, {
      id: archiveId,
      entity: 'branch_report',
      entityId: branchId,
      sourceOrgId: branchId,
      targetOrgId: regionId,
      month,
      year: snapshot.year,
      previousDataJson: JSON.stringify(branchSnapshots[String(branchId)]),
      replacementDataJson: JSON.stringify(snapshot),
      reason: 'Controlled replacement of branch report snapshot',
      archivedBy: uploadedBy,
      archivedAt: now,
    }, { orgUnitId: branchId, unitId: regionId, month, year: snapshot.year });
  }

  branchSnapshots[String(branchId)] = snapshot;

  const snapshotEntries = Object.entries(branchSnapshots);
  const totalIncome = snapshotEntries.reduce((sum, [, item]) => sum + item.income.total, 0);
  const totalExpense = snapshotEntries.reduce((sum, [, item]) => sum + item.expenses.total, 0);
  const closingBalance = snapshotEntries.reduce((sum, [, item]) => sum + item.net, 0);

  const incomeMap: Record<string, number> = {};
  const expenseMap: Record<string, number> = {};
  for (const [, item] of snapshotEntries) {
    for (const [category, amount] of Object.entries(item.income.categories)) {
      incomeMap[category] = (incomeMap[category] || 0) + amount;
    }
    for (const [category, amount] of Object.entries(item.expenses.categories)) {
      expenseMap[category] = (expenseMap[category] || 0) + amount;
    }
  }

  const incomeRows = Object.entries(incomeMap).map(([category, amount]) => ({
    category,
    amount,
    percent: totalIncome > 0 ? (amount / totalIncome) * 100 : 0,
  }));
  const expenseRows = Object.entries(expenseMap).map(([category, amount]) => ({
    category,
    amount,
    percent: totalExpense > 0 ? (amount / totalExpense) * 100 : 0,
  }));

  const recordPayload = {
    openingBalance: 0,
    totalIncome,
    totalExpense,
    closingBalance,
    carryForward: closingBalance,
    childCount: snapshotEntries.length,
    incomeBreakdown: JSON.stringify(incomeRows),
    expenseBreakdown: JSON.stringify(expenseRows),
    dataJson: JSON.stringify({
      branchSnapshots,
      importedBranchIds: snapshotEntries.map(([id]) => Number(id)),
      fileName,
    }),
    generatedBy: uploadedBy,
    generatedAt: now,
    notes: JSON.stringify({
      importedBranchIds: snapshotEntries.map(([id]) => Number(id)),
      fileName,
      overwrite,
    }),
    updatedAt: now,
  };

  if (existing?.id) {
    await db.regionalReports.update(existing.id, recordPayload);
    await mirrorNativeRecord('regionalReports', existing.id, { ...existing, ...recordPayload }, {
      unitId: regionId,
      month,
      year: snapshot.year,
    });
  } else {
    const id = (await db.regionalReports.add({
      unitId: regionId,
      reportType: 'regional',
      month,
      year: snapshot.year,
      ...recordPayload,
      createdAt: now,
    })) as number;
    await mirrorNativeRecord('regionalReports', id, {
      id,
      unitId: regionId,
      reportType: 'regional',
      month,
      year: snapshot.year,
      ...recordPayload,
      createdAt: now,
    }, { unitId: regionId, month, year: snapshot.year });
  }

  await db.auditLogs.add({
    action: overwrite ? 'UPDATE_REPORT' : 'IMPORT_REPORT',
    entity: 'branch_unified_report',
    entityId: branchId,
    userId: uploadedBy || 0,
    details: `${overwrite ? 'Updated' : 'Imported'} branch report snapshot for ${branch.name} (${snapshot.year}${snapshot.month ? `/${snapshot.month}` : ''})`,
    createdAt: now,
  } as any);

  notifyBranchReportImported(regionId);
}
