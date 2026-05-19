/**
 * Kuunda Ripoti Jumuishi ya Markaz Kuu (offline): Markaz + majimbo yote + jumla.
 * Majimbo yanatoka kwenye Ripoti ya Tisa iliyopakiwa (consolidated_master), si matawi.
 */

import { DEPARTMENTS, MONTHS } from '@/lib/types';
import { db as offlineDb, getChildOrgUnits, getTransactionsForOrgPeriod } from '@/lib/db-offline';
import { calculateOfflinePeriodBalance } from '@/lib/finance/offline-balance-engine';
import { buildAllDepartmentRows } from '@/lib/reports/department-rows';
import { getStoredReportNineFlexible } from '@/lib/reports/consolidated-report-nine';
import type { ConsolidatedReportNineData } from '@/lib/reports/consolidated-report-nine';

export type MarkazUnitRowKind = 'markaz' | 'jimbo' | 'jumla';

export type MarkazUnitRow = {
  branchId: number;
  branchName: string;
  branchCode: string;
  rowKind: MarkazUnitRowKind;
  openingBalance: number;
  income: number;
  expense: number;
  closingBalance: number;
  hasUploaded?: boolean;
};

export type MarkazUnifiedReportData = {
  reportType: 'markaz_unified';
  markazId: number;
  markazName: string;
  markazCode?: string;
  year: number;
  month?: number;
  generatedAt: string;
  generatedBy?: number;
  dataSource: 'consolidated' | 'local_transactions';
  openingBalance: number;
  totalIncome: number;
  totalExpense: number;
  closingBalance: number;
  carryForward: number;
  branchRows: MarkazUnitRow[];
  regionsUploadedCount: number;
  regionsMissingCount: number;
  missingRegionNames: string[];
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

function mergeCategoryMaps(
  target: Record<string, number>,
  rows: Array<{ category: string; amount: number }>
) {
  for (const row of rows) {
    target[row.category] = (target[row.category] || 0) + row.amount;
  }
}

function mergeDepartmentFromReport(
  target: Record<string, { income: number; expense: number }>,
  rows: ConsolidatedReportNineData['departmentRows']
) {
  for (const row of rows) {
    if (!target[row.department]) target[row.department] = { income: 0, expense: 0 };
    target[row.department].income += row.income || 0;
    target[row.department].expense += row.expense || 0;
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

function sumUnitRows(rows: MarkazUnitRow[]) {
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

function reportMatchesMonth(report: ConsolidatedReportNineData, month?: number) {
  if (!month) return true;
  return report.month === month;
}

function pickMonthlyRows(report: ConsolidatedReportNineData, month?: number) {
  const rows = report.monthlyRows || [];
  if (!month) return rows;
  return rows.filter((row) => row.month === month);
}

function totalsFromUploadedRegion(report: ConsolidatedReportNineData) {
  const totalRow = report.unitRows?.find((row) => row.rowKind === 'jumla');
  if (totalRow) {
    return {
      openingBalance: totalRow.openingBalance || 0,
      income: totalRow.income || 0,
      expense: totalRow.expense || 0,
      closingBalance: totalRow.closingBalance || 0,
    };
  }

  return {
    openingBalance: report.openingBalance || 0,
    income: report.totalIncome || 0,
    expense: report.totalExpense || 0,
    closingBalance: report.closingBalance || 0,
  };
}

export async function buildOfflineMarkazReport(
  markazId: number,
  year: number,
  month?: number,
  generatedBy?: number
): Promise<MarkazUnifiedReportData> {
  const markaz = await offlineDb.orgUnits.get(markazId);
  if (!markaz || markaz.type !== 'markaz') {
    throw new Error('Markaz Kuu halijapatikana kwenye local database.');
  }

  const regions = (await getChildOrgUnits(markazId))
    .filter((org) => org.type === 'jimbo' && org.isActive)
    .sort((a, b) => a.name.localeCompare(b.name, 'sw'));

  const markazBalance = await calculateOfflinePeriodBalance(markazId, year, month);
  const markazTxns = filterTransactionsByPeriod(
    await getTransactionsForOrgPeriod(markazId, year, month),
    year,
    month
  );

  const unitRows: MarkazUnitRow[] = [];
  const missingRegionNames: string[] = [];
  let regionsUploadedCount = 0;
  let hasUploadedJimbo = false;

  unitRows.push({
    branchId: markazId,
    branchName: `${markaz.name} (Markaz Kuu)`,
    branchCode: markaz.code || String(markazId),
    rowKind: 'markaz',
    openingBalance: markazBalance.openingBalance,
    income: markazBalance.totalIncome,
    expense: markazBalance.totalExpense,
    closingBalance: markazBalance.closingBalance,
  });

  const incomeCategoryMap: Record<string, number> = {};
  const expenseCategoryMap: Record<string, number> = {};
  const departmentTotals: Record<string, { income: number; expense: number }> = {};

  markazTxns.forEach((t) => {
    const category = (t as { category_name?: string }).category_name || 'Bila Kategoria';
    if (t.type === 'income') {
      incomeCategoryMap[category] = (incomeCategoryMap[category] || 0) + t.amount;
    } else {
      expenseCategoryMap[category] = (expenseCategoryMap[category] || 0) + t.amount;
    }
  });

  if (month) {
    const markazDeptFiltered: Record<string, { income: number; expense: number }> = {};
    for (const dept of DEPARTMENTS) {
      const income = markazTxns
        .filter((t) => t.department === dept && t.type === 'income')
        .reduce((sum, t) => sum + t.amount, 0);
      const expense = markazTxns
        .filter((t) => t.department === dept && t.type === 'expense')
        .reduce((sum, t) => sum + t.amount, 0);
      markazDeptFiltered[dept] = { income, expense };
    }
    for (const [dept, totals] of Object.entries(markazDeptFiltered)) {
      if (!departmentTotals[dept]) departmentTotals[dept] = { income: 0, expense: 0 };
      departmentTotals[dept].income += totals.income;
      departmentTotals[dept].expense += totals.expense;
    }
  }

  for (const region of regions) {
    const regionId = region.id!;
    const stored = await getStoredReportNineFlexible(regionId, year, month);

    if (stored && stored.level === 'jimbo' && reportMatchesMonth(stored, month)) {
      const regionTotals = totalsFromUploadedRegion(stored);
      hasUploadedJimbo = true;
      regionsUploadedCount += 1;
      unitRows.push({
        branchId: regionId,
        branchName: region.name,
        branchCode: region.code || String(regionId),
        rowKind: 'jimbo',
        openingBalance: regionTotals.openingBalance,
        income: regionTotals.income,
        expense: regionTotals.expense,
        closingBalance: regionTotals.closingBalance,
        hasUploaded: true,
      });

      mergeCategoryMaps(incomeCategoryMap, stored.incomeCategoryRows || []);
      mergeCategoryMaps(expenseCategoryMap, stored.expenseCategoryRows || []);
      mergeDepartmentFromReport(departmentTotals, stored.departmentRows || []);
      continue;
    }

    missingRegionNames.push(region.name);
    unitRows.push({
      branchId: regionId,
      branchName: region.name,
      branchCode: region.code || String(regionId),
      rowKind: 'jimbo',
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
    branchName: `JUMLA (${markaz.name} + Majimbo)`,
    branchCode: 'JUMLA',
    rowKind: 'jumla',
    openingBalance: totals.openingBalance,
    income: totals.income,
    expense: totals.expense,
    closingBalance: totals.closingBalance,
  });

  const monthsToShow = month ? [month] : Array.from({ length: 12 }, (_, i) => i + 1);
  const monthlyJimboIncome = new Map<number, number>();
  const monthlyJimboExpense = new Map<number, number>();

  for (const region of regions) {
    const stored = await getStoredReportNineFlexible(region.id!, year, month);
    if (!stored?.monthlyRows) continue;
    for (const row of pickMonthlyRows(stored, month)) {
      if (row.month < 1 || row.month > 12) continue;
      monthlyJimboIncome.set(row.month, (monthlyJimboIncome.get(row.month) || 0) + (row.income || 0));
      monthlyJimboExpense.set(row.month, (monthlyJimboExpense.get(row.month) || 0) + (row.expense || 0));
    }
  }

  const monthlyRows = await Promise.all(
    monthsToShow.map(async (periodMonth) => {
      const markazMonthBalance = await calculateOfflinePeriodBalance(markazId, year, periodMonth);
      let income = markazMonthBalance.totalIncome;
      let expense = markazMonthBalance.totalExpense;
      const openingBalance = markazMonthBalance.openingBalance;

      if (hasUploadedJimbo) {
        income += monthlyJimboIncome.get(periodMonth) || 0;
        expense += monthlyJimboExpense.get(periodMonth) || 0;
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

  const dataSource: MarkazUnifiedReportData['dataSource'] =
    hasUploadedJimbo ? 'consolidated' : 'local_transactions';

  return {
    reportType: 'markaz_unified',
    markazId,
    markazName: markaz.name,
    markazCode: markaz.code,
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
    regionsUploadedCount,
    regionsMissingCount: missingRegionNames.length,
    missingRegionNames,
    departmentRows: buildAllDepartmentRows(departmentTotals),
    monthlyRows,
    incomeCategoryRows: categoryRowsFromMap(incomeCategoryMap, totals.income),
    expenseCategoryRows: categoryRowsFromMap(expenseCategoryMap, totals.expense),
    totalTransactions: markazTxns.length + regionsUploadedCount,
    incomeTransactionCount: detailRows.filter((r) => r.income > 0).length,
    expenseTransactionCount: detailRows.filter((r) => r.expense > 0).length,
  };
}

export const JIMBO_REPORT_IMPORTED_EVENT = 'amyc-jimbo-report-imported';

export function notifyJimboReportImported(markazId: number) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(JIMBO_REPORT_IMPORTED_EVENT, { detail: { markazId } })
  );
}
