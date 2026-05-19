/**
 * Kuunda Ripoti Jumuishi ya Jimbo (offline): Jimbo + matawi yote + jumla.
 */

import { DEPARTMENTS, MONTHS } from '@/lib/types';
import {
  db as offlineDb,
  getChildOrgUnits,
  getDepartmentalSummary,
  getMonthlySummary,
  getReportsForUnitPeriod,
  getTransactionsForOrgPeriod,
} from '@/lib/db-offline';
import { calculateOfflinePeriodBalance } from '@/lib/finance/offline-balance-engine';
import { buildAllDepartmentRows } from '@/lib/reports/department-rows';
import { parseBranchSnapshotMonth } from '@/lib/reports/branch-snapshot-month';
import type { BranchReportSnapshot } from '@/lib/exporters/branch-export';

export type RegionalUnitRowKind = 'jimbo' | 'tawi' | 'jumla';

export type RegionalUnitRow = {
  branchId: number;
  branchName: string;
  branchCode: string;
  rowKind: RegionalUnitRowKind;
  openingBalance: number;
  income: number;
  expense: number;
  closingBalance: number;
  /** Tawi pekee: true ikiwa ripoti ya Excel imepakwa kwa kipindi husika */
  hasUploaded?: boolean;
};

export type RegionalUnifiedReportData = {
  reportType: 'regional_unified';
  regionId: number;
  regionName: string;
  regionCode?: string;
  year: number;
  month?: number;
  generatedAt: string;
  generatedBy?: number;
  dataSource: 'consolidated' | 'branch_snapshots' | 'local_transactions';
  openingBalance: number;
  totalIncome: number;
  totalExpense: number;
  closingBalance: number;
  carryForward: number;
  branchRows: RegionalUnitRow[];
  branchesUploadedCount: number;
  branchesMissingCount: number;
  missingBranchNames: string[];
  departmentRows: Array<{
    department: string;
    income: number;
    expense: number;
    balance: number;
  }>;
  monthlyRows: Array<{
    month: number;
    monthLabel: string;
    openingBalance: number;
    income: number;
    expense: number;
    closingBalance: number;
  }>;
  incomeCategoryRows: Array<{
    category: string;
    amount: number;
    percentage: number;
  }>;
  expenseCategoryRows: Array<{
    category: string;
    amount: number;
    percentage: number;
  }>;
  totalTransactions: number;
  incomeTransactionCount: number;
  expenseTransactionCount: number;
};

type SnapshotAgg = {
  income: number;
  expense: number;
  net: number;
  snapshot: BranchReportSnapshot;
};

function parseStoredBranchState(raw: string | undefined) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as {
      branchSnapshots?: Record<string, BranchReportSnapshot>;
    };
  } catch {
    return null;
  }
}

function snapshotMatchesFilter(
  snapshot: BranchReportSnapshot,
  recordMonth: number,
  filterMonth?: number
): boolean {
  if (!filterMonth) return true;
  if (recordMonth === filterMonth) return true;
  const snapshotMonth = parseBranchSnapshotMonth(snapshot.month);
  if (snapshotMonth === filterMonth) return true;
  return false;
}

function filterTransactionsByPeriod<T extends { year: number; month: number; type: string }>(
  txns: T[],
  year: number,
  month?: number
) {
  return txns.filter(
    (t) =>
      t.year === year &&
      (!month || t.month === month) &&
      (t.type === 'income' || t.type === 'expense')
  );
}

async function loadBranchSnapshotAggregates(
  regionId: number,
  year: number,
  month?: number
): Promise<Map<number, SnapshotAgg>> {
  const records = await getReportsForUnitPeriod('regionalReports', regionId, year, month);

  const yearRecords = records.filter(
    (record) =>
      record.reportType === 'regional' &&
      record.year === year &&
      (!month || record.month === month)
  );

  const branchAgg = new Map<number, SnapshotAgg>();

  for (const record of yearRecords) {
    const stored = parseStoredBranchState(record.dataJson);
    if (!stored?.branchSnapshots) continue;
    for (const [branchIdRaw, snapshot] of Object.entries(stored.branchSnapshots)) {
      if (!snapshotMatchesFilter(snapshot, record.month, month)) continue;
      const branchId = Number(branchIdRaw);
      const current = branchAgg.get(branchId);
      if (current) {
        current.income += snapshot.income.total;
        current.expense += snapshot.expenses.total;
        current.net += snapshot.net;
      } else {
        branchAgg.set(branchId, {
          income: snapshot.income.total,
          expense: snapshot.expenses.total,
          net: snapshot.net,
          snapshot,
        });
      }
    }
  }

  return branchAgg;
}

function mergeCategoryMaps(
  target: Record<string, number>,
  source: Record<string, number>
) {
  for (const [category, amount] of Object.entries(source)) {
    target[category] = (target[category] || 0) + amount;
  }
}

function mergeDepartmentTotals(
  target: Record<string, { income: number; expense: number }>,
  snapshot: BranchReportSnapshot
) {
  const detailedDepartments = snapshot.departmentDetails;
  if (detailedDepartments && Object.keys(detailedDepartments).length > 0) {
    for (const [department, totals] of Object.entries(detailedDepartments)) {
      if (!target[department]) target[department] = { income: 0, expense: 0 };
      target[department].income += totals.income || 0;
      target[department].expense += totals.expense || 0;
    }
    return;
  }
  for (const [department, balance] of Object.entries(snapshot.departments || {})) {
    if (!target[department]) target[department] = { income: 0, expense: 0 };
    if (balance >= 0) target[department].income += balance;
    else target[department].expense += Math.abs(balance);
  }
}

function mergeDeptSummaryRecord(
  target: Record<string, { income: number; expense: number }>,
  source: Record<string, { income: number; expense: number }>
) {
  for (const [department, totals] of Object.entries(source)) {
    if (!target[department]) target[department] = { income: 0, expense: 0 };
    target[department].income += totals.income || 0;
    target[department].expense += totals.expense || 0;
  }
}

function categoryRowsFromMap(map: Record<string, number>, total: number) {
  return Object.entries(map)
    .map(([category, amount]) => ({
      category,
      amount,
      percentage: total > 0 ? (amount / total) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

function sumUnitRows(rows: RegionalUnitRow[]) {
  return rows.reduce(
    (acc, row) => ({
      openingBalance: acc.openingBalance + row.openingBalance,
      income: acc.income + row.income,
      expense: acc.expense + row.expense,
      closingBalance: acc.closingBalance + row.closingBalance,
    }),
    { openingBalance: 0, income: 0, expense: 0, closingBalance: 0 }
  );
}

export async function buildOfflineRegionalReport(
  regionId: number,
  year: number,
  month?: number,
  generatedBy?: number
): Promise<RegionalUnifiedReportData> {
  const region = await offlineDb.orgUnits.get(regionId);
  if (!region) {
    throw new Error('Jimbo halijapatikana kwenye local database.');
  }

  const branches = (await getChildOrgUnits(regionId))
    .filter((org) => org.type === 'tawi' && org.isActive)
    .sort((a, b) => a.name.localeCompare(b.name, 'sw'));

  const snapshotAgg = await loadBranchSnapshotAggregates(regionId, year, month);
  const hasSnapshots = snapshotAgg.size > 0;

  const jimboBalance = await calculateOfflinePeriodBalance(regionId, year, month);
  const jimboMonthly = await getMonthlySummary(regionId, year);
  const jimboDept = await getDepartmentalSummary(regionId, year);

  const jimboTxns = filterTransactionsByPeriod(
    await getTransactionsForOrgPeriod(regionId, year, month),
    year,
    month
  );

  const unitRows: RegionalUnitRow[] = [];
  const missingBranchNames: string[] = [];

  unitRows.push({
    branchId: regionId,
    branchName: `${region.name} (Jimbo)`,
    branchCode: region.code || String(regionId),
    rowKind: 'jimbo',
    openingBalance: jimboBalance.openingBalance,
    income: jimboBalance.totalIncome,
    expense: jimboBalance.totalExpense,
    closingBalance: jimboBalance.closingBalance,
  });

  let branchesUploadedCount = 0;

  for (const branch of branches) {
    const branchId = branch.id!;
    const agg = snapshotAgg.get(branchId);

    if (agg) {
      branchesUploadedCount += 1;
      unitRows.push({
        branchId,
        branchName: branch.name,
        branchCode: branch.code || String(branchId),
        rowKind: 'tawi',
        openingBalance: 0,
        income: agg.income,
        expense: agg.expense,
        closingBalance: agg.net,
        hasUploaded: true,
      });
      continue;
    }

    const localBalance = await calculateOfflinePeriodBalance(branchId, year, month);
    const hasLocalData = localBalance.totalIncome !== 0 || localBalance.totalExpense !== 0;

    if (hasLocalData && !hasSnapshots) {
      unitRows.push({
        branchId,
        branchName: branch.name,
        branchCode: branch.code || String(branchId),
        rowKind: 'tawi',
        openingBalance: localBalance.openingBalance,
        income: localBalance.totalIncome,
        expense: localBalance.totalExpense,
        closingBalance: localBalance.closingBalance,
        hasUploaded: true,
      });
      branchesUploadedCount += 1;
      continue;
    }

    missingBranchNames.push(branch.name);
    unitRows.push({
      branchId,
      branchName: branch.name,
      branchCode: branch.code || String(branchId),
      rowKind: 'tawi',
      openingBalance: 0,
      income: 0,
      expense: 0,
      closingBalance: 0,
      hasUploaded: false,
    });
  }

  const detailRows = unitRows.filter((row) => row.rowKind !== 'jumla');
  const totals = sumUnitRows(detailRows);

  unitRows.push({
    branchId: 0,
    branchName: `JUMLA (${region.name} + Matawi)`,
    branchCode: 'JUMLA',
    rowKind: 'jumla',
    openingBalance: totals.openingBalance,
    income: totals.income,
    expense: totals.expense,
    closingBalance: totals.closingBalance,
  });

  const incomeCategoryMap: Record<string, number> = {};
  const expenseCategoryMap: Record<string, number> = {};
  const departmentTotals: Record<string, { income: number; expense: number }> = {};

  jimboTxns.forEach((t) => {
    const category = (t as { category_name?: string }).category_name || 'Bila Kategoria';
    if (t.type === 'income') {
      incomeCategoryMap[category] = (incomeCategoryMap[category] || 0) + t.amount;
    } else {
      expenseCategoryMap[category] = (expenseCategoryMap[category] || 0) + t.amount;
    }
  });
  if (month) {
    const jimboDeptFiltered: Record<string, { income: number; expense: number }> = {};
    for (const dept of DEPARTMENTS) {
      const income = jimboTxns
        .filter((t) => t.department === dept && t.type === 'income')
        .reduce((sum, t) => sum + t.amount, 0);
      const expense = jimboTxns
        .filter((t) => t.department === dept && t.type === 'expense')
        .reduce((sum, t) => sum + t.amount, 0);
      jimboDeptFiltered[dept] = { income, expense };
    }
    mergeDeptSummaryRecord(departmentTotals, jimboDeptFiltered);
  } else {
    mergeDeptSummaryRecord(departmentTotals, jimboDept);
  }

  for (const agg of snapshotAgg.values()) {
    mergeCategoryMaps(incomeCategoryMap, agg.snapshot.income.categories);
    mergeCategoryMaps(expenseCategoryMap, agg.snapshot.expenses.categories);
    mergeDepartmentTotals(departmentTotals, agg.snapshot);
  }

  if (!hasSnapshots) {
    for (const branch of branches) {
      if (snapshotAgg.has(branch.id!)) continue;
      const branchTxns = filterTransactionsByPeriod(
        await getTransactionsForOrgPeriod(branch.id!, year, month),
        year,
        month
      );
      branchTxns.forEach((t) => {
        const category = (t as { category_name?: string }).category_name || 'Bila Kategoria';
        if (t.type === 'income') {
          incomeCategoryMap[category] = (incomeCategoryMap[category] || 0) + t.amount;
        } else {
          expenseCategoryMap[category] = (expenseCategoryMap[category] || 0) + t.amount;
        }
      });
      if (branchTxns.length > 0) {
        const branchDept = await getDepartmentalSummary(branch.id!, year);
        if (month) {
          const filteredDept: Record<string, { income: number; expense: number }> = {};
          for (const dept of DEPARTMENTS) {
            const income = branchTxns
              .filter((t) => t.department === dept && t.type === 'income')
              .reduce((sum, t) => sum + t.amount, 0);
            const expense = branchTxns
              .filter((t) => t.department === dept && t.type === 'expense')
              .reduce((sum, t) => sum + t.amount, 0);
            filteredDept[dept] = { income, expense };
          }
          mergeDeptSummaryRecord(departmentTotals, filteredDept);
        } else {
          mergeDeptSummaryRecord(departmentTotals, branchDept);
        }
      }
    }
  }

  const monthsToShow = month ? [month] : Array.from({ length: 12 }, (_, i) => i + 1);
  const monthlyBranchIncome = new Map<number, number>();
  const monthlyBranchExpense = new Map<number, number>();

  if (hasSnapshots) {
    const records = await getReportsForUnitPeriod('regionalReports', regionId, year, month);
    const yearRecords = records.filter(
      (record) =>
        record.reportType === 'regional' &&
        record.year === year &&
        (!month || record.month === month)
    );

    for (const record of yearRecords) {
      const stored = parseStoredBranchState(record.dataJson);
      if (!stored?.branchSnapshots) continue;
      for (const snapshot of Object.values(stored.branchSnapshots)) {
        if (!snapshotMatchesFilter(snapshot, record.month, month)) continue;
        const m = parseBranchSnapshotMonth(snapshot.month) || record.month;
        if (m < 1 || m > 12) continue;
        monthlyBranchIncome.set(m, (monthlyBranchIncome.get(m) || 0) + snapshot.income.total);
        monthlyBranchExpense.set(m, (monthlyBranchExpense.get(m) || 0) + snapshot.expenses.total);
      }
    }
  }

  const monthlyRows = await Promise.all(
    monthsToShow.map(async (periodMonth) => {
      const jimboMonthBalance = await calculateOfflinePeriodBalance(regionId, year, periodMonth);
      let income = jimboMonthBalance.totalIncome;
      let expense = jimboMonthBalance.totalExpense;
      let openingBalance = jimboMonthBalance.openingBalance;

      if (hasSnapshots) {
        income += monthlyBranchIncome.get(periodMonth) || 0;
        expense += monthlyBranchExpense.get(periodMonth) || 0;
      } else {
        for (const branch of branches) {
          const branchMonthBalance = await calculateOfflinePeriodBalance(branch.id!, year, periodMonth);
          income += branchMonthBalance.totalIncome;
          expense += branchMonthBalance.totalExpense;
          openingBalance += branchMonthBalance.openingBalance;
        }
      }

      return {
        month: periodMonth,
        monthLabel: MONTHS[periodMonth - 1],
        openingBalance,
        income,
        expense,
        closingBalance: openingBalance + income - expense,
      };
    })
  );

  const dataSource: RegionalUnifiedReportData['dataSource'] = hasSnapshots
    ? 'consolidated'
    : 'local_transactions';

  return {
    reportType: 'regional_unified',
    regionId,
    regionName: region.name,
    regionCode: region.code,
    year,
    month,
    generatedAt: new Date().toISOString(),
    generatedBy,
    dataSource,
    openingBalance: totals.openingBalance,
    totalIncome: totals.income,
    totalExpense: totals.expense,
    closingBalance: totals.closingBalance,
    carryForward: totals.closingBalance,
    branchRows: unitRows,
    branchesUploadedCount,
    branchesMissingCount: missingBranchNames.length,
    missingBranchNames,
    departmentRows: buildAllDepartmentRows(departmentTotals),
    monthlyRows,
    incomeCategoryRows: categoryRowsFromMap(incomeCategoryMap, totals.income),
    expenseCategoryRows: categoryRowsFromMap(expenseCategoryMap, totals.expense),
    totalTransactions: jimboTxns.length + branchesUploadedCount,
    incomeTransactionCount: detailRows.filter((r) => r.income > 0).length,
    expenseTransactionCount: detailRows.filter((r) => r.expense > 0).length,
  };
}

export const BRANCH_REPORT_IMPORTED_EVENT = 'amyc-branch-report-imported';

export function notifyBranchReportImported(regionId: number) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(BRANCH_REPORT_IMPORTED_EVENT, { detail: { regionId } })
  );
}
