import { db, getChildOrgUnits } from '@/lib/db-offline';
import { DEPARTMENTS, MONTHS_SHORT } from '@/lib/types';
import type { OrgLevel, OrgUnit, Transaction } from '@/lib/types';
import { calculateOfflinePeriodBalance } from '@/lib/finance/offline-balance-engine';
import type { BranchReportSnapshot } from '@/lib/exporters/branch-export';
import { parseBranchSnapshotMonth } from '@/lib/reports/branch-snapshot-month';
import { mirrorNativeRecord } from '@/lib/storage/native-record-store';

export interface ReportNineMonthlyRow {
  month: number;
  label: string;
  openingBalance: number;
  income: number;
  expense: number;
  balance: number;
  closingBalance: number;
}

export interface ReportNineDepartmentRow {
  department: string;
  income: number;
  expense: number;
  balance: number;
}

export interface ReportNineCategoryRow {
  category: string;
  amount: number;
  percent: number;
}

export type ReportNineUnitRowKind = 'markaz' | 'jimbo' | 'tawi' | 'jumla';

export interface ReportNineUnitRow {
  unitId: number;
  unitName: string;
  unitCode?: string;
  rowKind: ReportNineUnitRowKind;
  openingBalance: number;
  income: number;
  expense: number;
  balance: number;
  closingBalance: number;
  hasUploaded?: boolean;
}

export interface ConsolidatedReportNineData {
  reportType: 'consolidated_master';
  level: Extract<OrgLevel, 'jimbo' | 'markaz'>;
  unitId: number;
  unitName: string;
  title: string;
  month?: number;
  year: number;
  childLabel: string;
  childCount: number;
  generatedBy?: number;
  generatedAt: string;
  openingBalance: number;
  totalIncome: number;
  totalExpense: number;
  closingBalance: number;
  carryForward: number;
  monthlyRows: ReportNineMonthlyRow[];
  unitRows?: ReportNineUnitRow[];
  departmentRows: ReportNineDepartmentRow[];
  incomeCategoryRows: ReportNineCategoryRow[];
  expenseCategoryRows: ReportNineCategoryRow[];
}

const CHILD_LABEL: Record<Extract<OrgLevel, 'jimbo' | 'markaz'>, string> = {
  jimbo: 'Matawi',
  markaz: 'Majimbo',
};

function categoryName(transaction: Transaction) {
  return transaction.category_name || 'Bila Kategoria';
}

function isInPeriod(transaction: Transaction, year: number, month?: number) {
  return transaction.year === year && (!month || transaction.month === month);
}

function addToMap(map: Record<string, number>, key: string, value: number) {
  map[key] = (map[key] || 0) + value;
}

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

async function getRegionalBranchSnapshots(
  regionId: number,
  year: number,
  month: number | undefined,
  selectedChildIds: Set<number>
) {
  const records = month
    ? await db.regionalReports.where('[unitId+month+year]').equals([regionId, month, year]).toArray()
    : await db.regionalReports.where('unitId').equals(regionId).toArray();

  const yearRecords = records.filter(
    (record) =>
      record.reportType === 'regional' &&
      record.year === year &&
      (!month || record.month === month)
  );
  const snapshots: Array<{ branchId: number; snapshot: BranchReportSnapshot; recordMonth: number }> = [];

  for (const record of yearRecords) {
    const stored = parseStoredBranchState(record.dataJson);
    if (!stored?.branchSnapshots) continue;
    for (const [branchId, snapshot] of Object.entries(stored.branchSnapshots)) {
      const numericBranchId = Number(branchId);
      if (!selectedChildIds.has(numericBranchId)) continue;
      if (month && parseBranchSnapshotMonth(snapshot.month) !== month) continue;
      snapshots.push({
        branchId: numericBranchId,
        snapshot,
        recordMonth: record.month,
      });
    }
  }

  return snapshots;
}

async function getSelectedActiveChildren(parentId: number, selectedChildIds: Set<number>) {
  const children = await getChildOrgUnits(parentId);
  return children.filter((child) => child.isActive && selectedChildIds.has(child.id!));
}

async function getMarkazRegionalScope(markazId: number, selectedChildIds: Set<number>) {
  const selectedRegions = await getSelectedActiveChildren(markazId, selectedChildIds);
  const regionIds = selectedRegions.map((region) => region.id!);
  const branchIds: number[] = [];

  for (const region of selectedRegions) {
    const branches = await getChildOrgUnits(region.id!);
    branchIds.push(...branches.filter((branch) => branch.isActive).map((branch) => branch.id!));
  }

  return {
    childCount: selectedRegions.length,
    orgUnitIds: [markazId, ...regionIds, ...branchIds],
  };
}

async function getStoredReportNine(unitId: number, year: number, month?: number) {
  const stored = (
    await db.regionalReports
      .where('[unitId+year+month]')
      .equals([unitId, year, month || 0])
      .toArray()
  ).find((record) => record.reportType === 'consolidated_master');

  if (!stored?.dataJson) {
    return null;
  }

  try {
    return JSON.parse(stored.dataJson) as ConsolidatedReportNineData;
  } catch {
    return null;
  }
}

export async function getStoredReportNineFlexible(unitId: number, year: number, month?: number) {
  const exact = await getStoredReportNine(unitId, year, month);
  if (exact) return exact;

  if (month && month > 0) {
    return null;
  }

  const all = await db.regionalReports
    .where('unitId')
    .equals(unitId)
    .toArray();

  const candidates = all
    .filter((row) => row.year === year && row.reportType === 'consolidated_master')
    .map((row) => {
      try {
        return JSON.parse(row.dataJson || '{}') as ConsolidatedReportNineData;
      } catch {
        return null;
      }
    })
    .filter((row): row is ConsolidatedReportNineData => Boolean(row && row.level === 'jimbo'));

  if (candidates.length === 0) return null;

  const annual = candidates.find((row) => !row.month || row.month === 0);
  if (annual) return annual;

  const sorted = [...candidates].sort((a, b) => (a.month || 0) - (b.month || 0));
  if (sorted.length === 1) return sorted[0];

  return {
    ...sorted[0],
    month: undefined,
    monthlyRows: mergeMonthlyRows(sorted, year),
    departmentRows: mergeDepartmentRows(sorted),
    totalIncome: sorted.reduce((sum, item) => sum + item.totalIncome, 0),
    totalExpense: sorted.reduce((sum, item) => sum + item.totalExpense, 0),
    closingBalance: sorted.reduce((sum, item) => sum + item.closingBalance, 0),
    carryForward: sorted.reduce((sum, item) => sum + item.carryForward, 0),
    incomeCategoryRows: mergeCategoryRows(sorted, 'incomeCategoryRows', sorted.reduce((sum, item) => sum + item.totalIncome, 0)),
    expenseCategoryRows: mergeCategoryRows(sorted, 'expenseCategoryRows', sorted.reduce((sum, item) => sum + item.totalExpense, 0)),
  };
}

async function getReportScope(
  orgUnitId: number,
  orgLevel: Extract<OrgLevel, 'jimbo' | 'markaz'>,
  selectedChildIds: Set<number>
) {
  if (orgLevel === 'markaz') {
    return getMarkazRegionalScope(orgUnitId, selectedChildIds);
  }

  const selectedBranches = await getSelectedActiveChildren(orgUnitId, selectedChildIds);
  return {
    childCount: selectedBranches.length,
    orgUnitIds: [orgUnitId, ...selectedBranches.map((branch) => branch.id!)],
  };
}

async function getTransactionsForScope(orgUnitIds: number[], year: number, month?: number) {
  if (orgUnitIds.length === 0) {
    return [];
  }

  const transactions = await db.transactions
    .where('orgUnitId')
    .anyOf(orgUnitIds)
    .toArray();

  return transactions.filter((transaction) => isInPeriod(transaction, year, month));
}

async function buildFinancialSummary(orgUnitIds: number[], year: number, month?: number) {
  const monthList = month && month > 0 ? [month] : Array.from({ length: 12 }, (_, index) => index + 1);
  const monthlyRows: ReportNineMonthlyRow[] = [];
  let openingBalance = 0;
  let totalIncome = 0;
  let totalExpense = 0;

  for (const periodMonth of monthList) {
    const balances = await Promise.all(
      orgUnitIds.map((orgUnitId) => calculateOfflinePeriodBalance(orgUnitId, year, periodMonth))
    );

    const rowOpening = balances.reduce((sum, balance) => sum + balance.openingBalance, 0);
    const rowIncome = balances.reduce((sum, balance) => sum + balance.totalIncome, 0);
    const rowExpense = balances.reduce((sum, balance) => sum + balance.totalExpense, 0);
    const rowClosing = balances.reduce((sum, balance) => sum + balance.closingBalance, 0);

    if (monthlyRows.length === 0) {
      openingBalance = rowOpening;
    }

    totalIncome += rowIncome;
    totalExpense += rowExpense;
    monthlyRows.push({
      month: periodMonth,
      label: MONTHS_SHORT[periodMonth - 1],
      openingBalance: rowOpening,
      income: rowIncome,
      expense: rowExpense,
      balance: rowIncome - rowExpense,
      closingBalance: rowClosing,
    });
  }

  const closingBalance = openingBalance + totalIncome - totalExpense;

  return {
    openingBalance,
    totalIncome,
    totalExpense,
    closingBalance,
    carryForward: closingBalance,
    monthlyRows,
  };
}

function buildDepartmentRows(transactions: Transaction[]) {
  const departmentTotals: Record<string, { income: number; expense: number }> = {};

  for (const department of DEPARTMENTS) {
    departmentTotals[department] = { income: 0, expense: 0 };
  }

  for (const transaction of transactions) {
    if (!departmentTotals[transaction.department]) {
      departmentTotals[transaction.department] = { income: 0, expense: 0 };
    }

    if (transaction.type === 'income') {
      departmentTotals[transaction.department].income += transaction.amount;
    } else {
      departmentTotals[transaction.department].expense += transaction.amount;
    }
  }

  return Object.entries(departmentTotals).map(([department, totals]) => ({
    department,
    income: totals.income,
    expense: totals.expense,
    balance: totals.income - totals.expense,
  }));
}

function buildCategoryRows(transactions: Transaction[], type: 'income' | 'expense') {
  const categoryTotals: Record<string, number> = {};
  let total = 0;

  for (const transaction of transactions) {
    if (transaction.type !== type) continue;

    total += transaction.amount;
    addToMap(categoryTotals, categoryName(transaction), transaction.amount);
  }

  return Object.entries(categoryTotals)
    .map(([category, amount]) => ({
      category,
      amount,
      percent: total > 0 ? (amount / total) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

export async function generateConsolidatedReportNine(options: {
  orgUnit: OrgUnit;
  year: number;
  month?: number;
  selectedChildIds: Set<number>;
  generatedBy?: number;
}): Promise<ConsolidatedReportNineData> {
  const { orgUnit, year, month, selectedChildIds, generatedBy } = options;

  if (orgUnit.type !== 'jimbo' && orgUnit.type !== 'markaz') {
    throw new Error('Ripoti ya Tisa inapatikana kwa Jimbo na Markaz Kuu pekee.');
  }

  if (orgUnit.type === 'markaz') {
    return generateMarkazReportNineFromRegionalReports(options as {
      orgUnit: OrgUnit & { type: 'markaz' };
      year: number;
      month?: number;
      selectedChildIds: Set<number>;
      generatedBy?: number;
    });
  }

  const storedSnapshots = await getRegionalBranchSnapshots(orgUnit.id!, year, month, selectedChildIds);
  if (storedSnapshots.length > 0) {
    const ownTransactions = await getTransactionsForScope([orgUnit.id!], year, month);
    const ownSummary = await buildFinancialSummary([orgUnit.id!], year, month);
    const generatedAt = new Date().toISOString();

    const incomeCategoryMap: Record<string, number> = {};
    const expenseCategoryMap: Record<string, number> = {};
    const departmentMap: Record<string, { income: number; expense: number }> = {};
    const monthlyMap: Record<number, { income: number; expense: number; closingBalance: number }> = {};

    for (const department of DEPARTMENTS) {
      departmentMap[department] = { income: 0, expense: 0 };
    }

    for (const txn of ownTransactions) {
      if (!departmentMap[txn.department]) {
        departmentMap[txn.department] = { income: 0, expense: 0 };
      }
      if (txn.type === 'income') {
        departmentMap[txn.department].income += txn.amount;
        addToMap(incomeCategoryMap, categoryName(txn), txn.amount);
      } else {
        departmentMap[txn.department].expense += txn.amount;
        addToMap(expenseCategoryMap, categoryName(txn), txn.amount);
      }
    }

    for (const row of ownSummary.monthlyRows) {
      monthlyMap[row.month] = {
        income: row.income,
        expense: row.expense,
        closingBalance: row.closingBalance,
      };
    }

    for (const { snapshot, recordMonth } of storedSnapshots) {
      const snapshotMonth = parseBranchSnapshotMonth(snapshot.month) || recordMonth || 0;
      if (snapshotMonth >= 1 && snapshotMonth <= 12) {
        if (!monthlyMap[snapshotMonth]) {
          monthlyMap[snapshotMonth] = { income: 0, expense: 0, closingBalance: 0 };
        }
        monthlyMap[snapshotMonth].income += snapshot.income.total;
        monthlyMap[snapshotMonth].expense += snapshot.expenses.total;
        monthlyMap[snapshotMonth].closingBalance += snapshot.net;
      }

      for (const [category, amount] of Object.entries(snapshot.income.categories || {})) {
        addToMap(incomeCategoryMap, category, amount);
      }
      for (const [category, amount] of Object.entries(snapshot.expenses.categories || {})) {
        addToMap(expenseCategoryMap, category, amount);
      }

      if (snapshot.departmentDetails && Object.keys(snapshot.departmentDetails).length > 0) {
        for (const [department, totals] of Object.entries(snapshot.departmentDetails)) {
          if (!departmentMap[department]) {
            departmentMap[department] = { income: 0, expense: 0 };
          }
          departmentMap[department].income += totals.income || 0;
          departmentMap[department].expense += totals.expense || 0;
        }
      }
    }

    const monthList = month && month > 0 ? [month] : Array.from({ length: 12 }, (_, index) => index + 1);
    const monthlyRows: ReportNineMonthlyRow[] = monthList.map((periodMonth) => {
      const bucket = monthlyMap[periodMonth] || { income: 0, expense: 0, closingBalance: 0 };
      return {
        month: periodMonth,
        label: MONTHS_SHORT[periodMonth - 1],
        openingBalance: 0,
        income: bucket.income,
        expense: bucket.expense,
        balance: bucket.income - bucket.expense,
        closingBalance: bucket.closingBalance,
      };
    });

    const totalIncome = monthlyRows.reduce((sum, row) => sum + row.income, 0);
    const totalExpense = monthlyRows.reduce((sum, row) => sum + row.expense, 0);
    const closingBalance = monthlyRows.reduce((sum, row) => sum + row.closingBalance, 0);

    const departmentRows = Object.entries(departmentMap).map(([department, totals]) => ({
      department,
      income: totals.income,
      expense: totals.expense,
      balance: totals.income - totals.expense,
    }));

    const incomeCategoryRows = Object.entries(incomeCategoryMap)
      .map(([category, amount]) => ({
        category,
        amount,
        percent: totalIncome > 0 ? (amount / totalIncome) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    const expenseCategoryRows = Object.entries(expenseCategoryMap)
      .map(([category, amount]) => ({
        category,
        amount,
        percent: totalExpense > 0 ? (amount / totalExpense) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    const unitRows: ReportNineUnitRow[] = [];
    unitRows.push(totalsToUnitRow({
      unitId: orgUnit.id!,
      unitName: `${orgUnit.name} (Jimbo)`,
      unitCode: orgUnit.code,
      rowKind: 'jimbo',
      openingBalance: ownSummary.openingBalance,
      income: ownSummary.totalIncome,
      expense: ownSummary.totalExpense,
      closingBalance: ownSummary.closingBalance,
    }));

    const branchUnitMap = new Map<number, ReportNineUnitRow>();
    for (const { branchId, snapshot } of storedSnapshots) {
      const current = branchUnitMap.get(branchId);
      if (current) {
        current.income += snapshot.income.total;
        current.expense += snapshot.expenses.total;
        current.balance = current.income - current.expense;
        current.closingBalance += snapshot.net;
      } else {
        branchUnitMap.set(branchId, totalsToUnitRow({
          unitId: branchId,
          unitName: snapshot.branchName,
          unitCode: snapshot.branchId,
          rowKind: 'tawi',
          openingBalance: 0,
          income: snapshot.income.total,
          expense: snapshot.expenses.total,
          closingBalance: snapshot.net,
          hasUploaded: true,
        }));
      }
    }
    unitRows.push(...Array.from(branchUnitMap.values()).sort((a, b) => a.unitName.localeCompare(b.unitName, 'sw')));
    const unitTotals = sumReportNineUnitRows(unitRows);
    unitRows.push(totalsToUnitRow({
      unitId: 0,
      unitName: `JUMLA (${orgUnit.name} + Matawi)`,
      unitCode: 'JUMLA',
      rowKind: 'jumla',
      openingBalance: unitTotals.openingBalance,
      income: unitTotals.income,
      expense: unitTotals.expense,
      closingBalance: unitTotals.closingBalance,
    }));

    const data: ConsolidatedReportNineData = {
      reportType: 'consolidated_master',
      level: orgUnit.type,
      unitId: orgUnit.id!,
      unitName: orgUnit.name,
      title: 'RIPOTI YA TISA - MJUMUISHO WA MUUNGANIKO WA JIMBO',
      month,
      year,
      childLabel: CHILD_LABEL[orgUnit.type],
      childCount: selectedChildIds.size,
      generatedBy,
      generatedAt,
      openingBalance: 0,
      totalIncome,
      totalExpense,
      closingBalance,
      carryForward: closingBalance,
      monthlyRows,
      unitRows,
      departmentRows,
      incomeCategoryRows,
      expenseCategoryRows,
    };

    await saveConsolidatedReportNine(data);
    return data;
  }

  const scope = await getReportScope(orgUnit.id!, orgUnit.type, selectedChildIds);
  const transactions = await getTransactionsForScope(scope.orgUnitIds, year, month);
  const summary = await buildFinancialSummary(scope.orgUnitIds, year, month);
  const generatedAt = new Date().toISOString();

  const data: ConsolidatedReportNineData = {
    reportType: 'consolidated_master',
    level: orgUnit.type,
    unitId: orgUnit.id!,
    unitName: orgUnit.name,
    title: 'RIPOTI YA TISA - MJUMUISHO WA MUUNGANIKO WA JIMBO',
    month,
    year,
    childLabel: CHILD_LABEL[orgUnit.type],
    childCount: scope.childCount,
    generatedBy,
    generatedAt,
    ...summary,
    unitRows: await buildLocalReportNineUnitRows({
      orgUnit,
      childKind: 'tawi',
      totalKind: 'Matawi',
      year,
      month,
      selectedChildIds,
    }),
    departmentRows: buildDepartmentRows(transactions),
    incomeCategoryRows: buildCategoryRows(transactions, 'income'),
    expenseCategoryRows: buildCategoryRows(transactions, 'expense'),
  };

  await saveConsolidatedReportNine(data);
  await db.auditLogs.add({
    action: 'GENERATE_REPORT',
    entity: 'consolidated_master_report',
    entityId: orgUnit.id!,
    userId: generatedBy || 0,
    details: `Generated regional consolidated master report for ${month || 'all months'}/${year}`,
    createdAt: generatedAt,
  });

  return data;
}

async function generateRegionalReportNineData(options: {
  orgUnit: OrgUnit;
  year: number;
  month?: number;
  selectedChildIds: Set<number>;
  generatedBy?: number;
}) {
  const { orgUnit, year, month, selectedChildIds, generatedBy } = options;
  const scope = await getReportScope(orgUnit.id!, 'jimbo', selectedChildIds);
  const transactions = await getTransactionsForScope(scope.orgUnitIds, year, month);
  const summary = await buildFinancialSummary(scope.orgUnitIds, year, month);

  return {
    reportType: 'consolidated_master' as const,
    level: 'jimbo' as const,
    unitId: orgUnit.id!,
    unitName: orgUnit.name,
    title: 'RIPOTI YA TISA - MJUMUISHO WA MUUNGANIKO WA JIMBO',
    month,
    year,
    childLabel: CHILD_LABEL.jimbo,
    childCount: scope.childCount,
    generatedBy,
    generatedAt: new Date().toISOString(),
    ...summary,
    unitRows: await buildLocalReportNineUnitRows({
      orgUnit,
      childKind: 'tawi',
      totalKind: 'Matawi',
      year,
      month,
      selectedChildIds,
    }),
    departmentRows: buildDepartmentRows(transactions),
    incomeCategoryRows: buildCategoryRows(transactions, 'income'),
    expenseCategoryRows: buildCategoryRows(transactions, 'expense'),
  };
}

function mergeDepartmentRows(reports: ConsolidatedReportNineData[]) {
  const totals: Record<string, { income: number; expense: number }> = {};

  for (const department of DEPARTMENTS) {
    totals[department] = { income: 0, expense: 0 };
  }

  for (const report of reports) {
    for (const row of report.departmentRows) {
      if (!totals[row.department]) {
        totals[row.department] = { income: 0, expense: 0 };
      }
      totals[row.department].income += row.income;
      totals[row.department].expense += row.expense;
    }
  }

  return Object.entries(totals).map(([department, total]) => ({
    department,
    income: total.income,
    expense: total.expense,
    balance: total.income - total.expense,
  }));
}

function mergeCategoryRows(
  reports: ConsolidatedReportNineData[],
  key: 'incomeCategoryRows' | 'expenseCategoryRows',
  total: number
) {
  const totals: Record<string, number> = {};

  for (const report of reports) {
    for (const row of report[key]) {
      addToMap(totals, row.category, row.amount);
    }
  }

  return Object.entries(totals)
    .map(([category, amount]) => ({
      category,
      amount,
      percent: total > 0 ? (amount / total) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

function mergeMonthlyRows(reports: ConsolidatedReportNineData[], year: number, month?: number) {
  const months = month && month > 0 ? [month] : Array.from({ length: 12 }, (_, index) => index + 1);

  return months.map((periodMonth) => {
    const rows = reports
      .map((report) => report.monthlyRows.find((row) => row.month === periodMonth))
      .filter(Boolean) as ReportNineMonthlyRow[];
    const openingBalance = rows.reduce((sum, row) => sum + row.openingBalance, 0);
    const income = rows.reduce((sum, row) => sum + row.income, 0);
    const expense = rows.reduce((sum, row) => sum + row.expense, 0);
    const closingBalance = rows.reduce((sum, row) => sum + row.closingBalance, 0);

    return {
      month: periodMonth,
      label: MONTHS_SHORT[periodMonth - 1],
      openingBalance,
      income,
      expense,
      balance: income - expense,
      closingBalance,
    };
  });
}

function sumReportNineUnitRows(rows: ReportNineUnitRow[]) {
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

function totalsToUnitRow(options: {
  unitId: number;
  unitName: string;
  unitCode?: string;
  rowKind: ReportNineUnitRowKind;
  openingBalance: number;
  income: number;
  expense: number;
  closingBalance: number;
  hasUploaded?: boolean;
}): ReportNineUnitRow {
  return {
    ...options,
    balance: options.income - options.expense,
  };
}

async function buildLocalReportNineUnitRows(options: {
  orgUnit: OrgUnit;
  childKind: Extract<ReportNineUnitRowKind, 'tawi' | 'jimbo'>;
  totalKind: string;
  year: number;
  month?: number;
  selectedChildIds: Set<number>;
}) {
  const { orgUnit, childKind, totalKind, year, month, selectedChildIds } = options;
  const rows: ReportNineUnitRow[] = [];
  const ownSummary = await buildFinancialSummary([orgUnit.id!], year, month);
  const ownKind = orgUnit.type === 'markaz' ? 'markaz' : 'jimbo';

  rows.push(totalsToUnitRow({
    unitId: orgUnit.id!,
    unitName: `${orgUnit.name} (${ownKind === 'markaz' ? 'Markaz Kuu' : 'Jimbo'})`,
    unitCode: orgUnit.code,
    rowKind: ownKind,
    openingBalance: ownSummary.openingBalance,
    income: ownSummary.totalIncome,
    expense: ownSummary.totalExpense,
    closingBalance: ownSummary.closingBalance,
  }));

  const children = await getSelectedActiveChildren(orgUnit.id!, selectedChildIds);
  for (const child of children.sort((a, b) => a.name.localeCompare(b.name, 'sw'))) {
    const childSummary = await buildFinancialSummary([child.id!], year, month);
    rows.push(totalsToUnitRow({
      unitId: child.id!,
      unitName: child.name,
      unitCode: child.code,
      rowKind: childKind,
      openingBalance: childSummary.openingBalance,
      income: childSummary.totalIncome,
      expense: childSummary.totalExpense,
      closingBalance: childSummary.closingBalance,
      hasUploaded: true,
    }));
  }

  const totals = sumReportNineUnitRows(rows);
  rows.push(totalsToUnitRow({
    unitId: 0,
    unitName: `JUMLA (${orgUnit.name} + ${totalKind})`,
    unitCode: 'JUMLA',
    rowKind: 'jumla',
    openingBalance: totals.openingBalance,
    income: totals.income,
    expense: totals.expense,
    closingBalance: totals.closingBalance,
  }));

  return rows;
}

function reportTotalUnitRow(report: ConsolidatedReportNineData, unitName?: string): ReportNineUnitRow {
  const explicitTotal = report.unitRows?.find((row) => row.rowKind === 'jumla');
  if (explicitTotal) {
    return {
      ...explicitTotal,
      unitId: report.unitId,
      unitName: unitName || report.unitName,
      unitCode: explicitTotal.unitCode === 'JUMLA' ? undefined : explicitTotal.unitCode,
      rowKind: report.level === 'markaz' ? 'markaz' : 'jimbo',
      hasUploaded: true,
    };
  }

  return totalsToUnitRow({
    unitId: report.unitId,
    unitName: unitName || report.unitName,
    rowKind: report.level === 'markaz' ? 'markaz' : 'jimbo',
    openingBalance: report.openingBalance,
    income: report.totalIncome,
    expense: report.totalExpense,
    closingBalance: report.closingBalance,
    hasUploaded: true,
  });
}

async function generateMarkazOwnReportPart(options: {
  orgUnit: OrgUnit;
  year: number;
  month?: number;
  generatedBy?: number;
}) {
  const { orgUnit, year, month, generatedBy } = options;
  const transactions = await getTransactionsForScope([orgUnit.id!], year, month);
  const summary = await buildFinancialSummary([orgUnit.id!], year, month);

  return {
    reportType: 'consolidated_master' as const,
    level: 'markaz' as const,
    unitId: orgUnit.id!,
    unitName: orgUnit.name,
    title: 'MARKAZ KUU PEKEE',
    month,
    year,
    childLabel: 'Markaz',
    childCount: 1,
    generatedBy,
    generatedAt: new Date().toISOString(),
    ...summary,
    unitRows: [
      totalsToUnitRow({
        unitId: orgUnit.id!,
        unitName: `${orgUnit.name} (Markaz Kuu)`,
        unitCode: orgUnit.code,
        rowKind: 'markaz',
        openingBalance: summary.openingBalance,
        income: summary.totalIncome,
        expense: summary.totalExpense,
        closingBalance: summary.closingBalance,
      }),
    ],
    departmentRows: buildDepartmentRows(transactions),
    incomeCategoryRows: buildCategoryRows(transactions, 'income'),
    expenseCategoryRows: buildCategoryRows(transactions, 'expense'),
  };
}

async function generateMarkazReportNineFromRegionalReports(options: {
  orgUnit: OrgUnit & { type: 'markaz' };
  year: number;
  month?: number;
  selectedChildIds: Set<number>;
  generatedBy?: number;
}) {
  const { orgUnit, year, month, selectedChildIds, generatedBy } = options;
  const selectedRegions = await getSelectedActiveChildren(orgUnit.id!, selectedChildIds);
  const ownReport = await generateMarkazOwnReportPart({ orgUnit, year, month, generatedBy });
  const sourceReports: ConsolidatedReportNineData[] = [ownReport];
  const unitRows: ReportNineUnitRow[] = [reportTotalUnitRow(ownReport, `${orgUnit.name} (Markaz Kuu)`)];

  for (const region of selectedRegions) {
    const uploaded = await getStoredReportNineFlexible(region.id!, year, month);
    if (uploaded) {
      sourceReports.push(uploaded);
      unitRows.push(reportTotalUnitRow(uploaded, region.name));
    } else {
      unitRows.push(totalsToUnitRow({
        unitId: region.id!,
        unitName: region.name,
        unitCode: region.code,
        rowKind: 'jimbo',
        openingBalance: 0,
        income: 0,
        expense: 0,
        closingBalance: 0,
        hasUploaded: false,
      }));
    }
  }

  const detailUnitRows = unitRows.filter((row) => row.rowKind !== 'jumla');
  const unitTotals = sumReportNineUnitRows(detailUnitRows);
  unitRows.push(totalsToUnitRow({
    unitId: 0,
    unitName: `JUMLA (${orgUnit.name} + Majimbo)`,
    unitCode: 'JUMLA',
    rowKind: 'jumla',
    openingBalance: unitTotals.openingBalance,
    income: unitTotals.income,
    expense: unitTotals.expense,
    closingBalance: unitTotals.closingBalance,
  }));

  const monthlyRows = mergeMonthlyRows(sourceReports, year, month);
  const openingBalance = unitTotals.openingBalance;
  const totalIncome = unitTotals.income;
  const totalExpense = unitTotals.expense;
  const closingBalance = unitTotals.closingBalance;
  const generatedAt = new Date().toISOString();
  const data: ConsolidatedReportNineData = {
    reportType: 'consolidated_master',
    level: 'markaz',
    unitId: orgUnit.id!,
    unitName: orgUnit.name,
    title: 'RIPOTI YA KITAIFA - MUUNGANIKO WA MARKAZ KUU NA MAJIMBO',
    month,
    year,
    childLabel: CHILD_LABEL.markaz,
    childCount: selectedRegions.length,
    generatedBy,
    generatedAt,
    openingBalance,
    totalIncome,
    totalExpense,
    closingBalance,
    carryForward: closingBalance,
    monthlyRows,
    unitRows,
    departmentRows: mergeDepartmentRows(sourceReports),
    incomeCategoryRows: mergeCategoryRows(sourceReports, 'incomeCategoryRows', totalIncome),
    expenseCategoryRows: mergeCategoryRows(sourceReports, 'expenseCategoryRows', totalExpense),
  };

  await saveConsolidatedReportNine(data);
  await db.auditLogs.add({
    action: 'GENERATE_REPORT',
    entity: 'consolidated_master_report',
    entityId: orgUnit.id!,
    userId: generatedBy || 0,
    details: `Generated markaz institutional report from ${selectedRegions.length} regional report snapshots for ${month || 'all months'}/${year}`,
    createdAt: generatedAt,
  });

  return data;
}

export async function saveImportedRegionalReportNine(options: {
  regionId: number;
  report: ConsolidatedReportNineData;
  importedBy?: number;
  fileName?: string;
  overwrite?: boolean;
}) {
  const { regionId, report, importedBy, fileName, overwrite = false } = options;
  const now = new Date().toISOString();
  const existing = (
    await db.regionalReports
      .where('[unitId+month+year]')
      .equals([regionId, report.month || 0, report.year])
      .toArray()
  ).find((record) => record.reportType === 'consolidated_master');
  if (existing?.id && !overwrite) {
    throw new Error(
      `Upakiaji rudufu umezuiwa: Ripoti ya Jimbo kwa kipindi hiki tayari ilishapakiwa.`
    );
  }
  if (existing?.id && overwrite) {
    const archiveId = (await db.reportArchives.add({
      entity: 'regional_report_nine',
      entityId: regionId,
      sourceOrgId: regionId,
      targetOrgId: report.unitId,
      month: report.month || 0,
      year: report.year,
      previousDataJson: existing.dataJson || JSON.stringify(existing),
      replacementDataJson: JSON.stringify(report),
      reason: 'Controlled replacement of imported regional Report Nine',
      archivedBy: importedBy,
      archivedAt: now,
    })) as number;
    await mirrorNativeRecord('reportArchives', archiveId, {
      id: archiveId,
      entity: 'regional_report_nine',
      entityId: regionId,
      sourceOrgId: regionId,
      targetOrgId: report.unitId,
      month: report.month || 0,
      year: report.year,
      previousDataJson: existing.dataJson || JSON.stringify(existing),
      replacementDataJson: JSON.stringify(report),
      reason: 'Controlled replacement of imported regional Report Nine',
      archivedBy: importedBy,
      archivedAt: now,
    }, { unitId: regionId, month: report.month || 0, year: report.year });
  }
  const record = {
    unitId: regionId,
    reportType: 'consolidated_master' as const,
    month: report.month || 0,
    year: report.year,
    openingBalance: report.openingBalance,
    totalIncome: report.totalIncome,
    totalExpense: report.totalExpense,
    closingBalance: report.closingBalance,
    carryForward: report.carryForward,
    childCount: report.childCount,
    incomeBreakdown: JSON.stringify(report.incomeCategoryRows),
    expenseBreakdown: JSON.stringify(report.expenseCategoryRows),
    dataJson: JSON.stringify({
      ...report,
      unitId: regionId,
      generatedBy: importedBy,
      generatedAt: now,
    }),
    generatedBy: importedBy,
    generatedAt: now,
    notes: fileName ? `Imported from ${fileName}` : 'Imported regional Report Nine',
    updatedAt: now,
  };

  if (existing?.id) {
    await db.regionalReports.update(existing.id, record);
    await mirrorNativeRecord('regionalReports', existing.id, { ...existing, ...record }, {
      unitId: regionId,
      month: report.month || 0,
      year: report.year,
    });
  } else {
    const id = (await db.regionalReports.add({ ...record, createdAt: now })) as number;
    await mirrorNativeRecord('regionalReports', id, { id, ...record, createdAt: now }, {
      unitId: regionId,
      month: report.month || 0,
      year: report.year,
    });
  }

  await db.auditLogs.add({
    action: overwrite ? 'UPDATE_REPORT' : 'IMPORT_REPORT',
    entity: 'regional_report_nine',
    entityId: regionId,
    userId: importedBy || 0,
    details: `${overwrite ? 'Updated' : 'Imported'} regional Report Nine for ${report.month || 'all months'}/${report.year}`,
    createdAt: now,
  });

  const region = await db.orgUnits.get(regionId);
  if (region?.parentId) {
    const { notifyJimboReportImported } = await import('@/lib/reports/markaz-unified-offline');
    notifyJimboReportImported(region.parentId);
  }
}

async function saveConsolidatedReportNine(data: ConsolidatedReportNineData) {
  const table = data.level === 'markaz' ? db.markazReports : db.regionalReports;
  const existing = (
    await table
      .where('[unitId+month+year]')
      .equals([data.unitId, data.month || 0, data.year])
      .toArray()
  ).find((record) => record.reportType === 'consolidated_master');
  const now = new Date().toISOString();
  const record = {
    unitId: data.unitId,
    reportType: 'consolidated_master' as const,
    month: data.month || 0,
    year: data.year,
    openingBalance: data.openingBalance,
    totalIncome: data.totalIncome,
    totalExpense: data.totalExpense,
    closingBalance: data.closingBalance,
    carryForward: data.carryForward,
    childCount: data.childCount,
    incomeBreakdown: JSON.stringify(data.incomeCategoryRows),
    expenseBreakdown: JSON.stringify(data.expenseCategoryRows),
    dataJson: JSON.stringify(data),
    generatedBy: data.generatedBy,
    generatedAt: data.generatedAt,
    notes: data.title,
    updatedAt: now,
  };

  if (existing?.id) {
    await table.update(existing.id, record);
    await mirrorNativeRecord(data.level === 'markaz' ? 'markazReports' : 'regionalReports', existing.id, { ...existing, ...record }, {
      unitId: data.unitId,
      month: data.month || 0,
      year: data.year,
    });
  } else {
    const id = (await table.add({ ...record, createdAt: now })) as number;
    await mirrorNativeRecord(data.level === 'markaz' ? 'markazReports' : 'regionalReports', id, { id, ...record, createdAt: now }, {
      unitId: data.unitId,
      month: data.month || 0,
      year: data.year,
    });
  }
}
