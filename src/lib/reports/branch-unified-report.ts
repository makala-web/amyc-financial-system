// ============================================================
// AMYC Financial Management System - Branch Unified Report (5th Report)
// Combines Income, Expense, Categories, Departments, and Balance
// For branches (tawi) to send as single file to regions (jimbo)
// ============================================================

import { db } from '@/lib/db';
import type { OrgLevel } from '@/lib/types';
import { DEPARTMENTS } from '@/lib/types';
import type { BranchReportSnapshot } from '@/lib/exporters/branch-export';

// ============================================================
// Types
// ============================================================

export interface BranchUnifiedMonthRow {
  month: number;
  monthLabel: string;
  openingBalance: number;
  income: number;
  expense: number;
  balance: number;
  closingBalance: number;
}

export interface BranchUnifiedCategoryRow {
  category: string;
  amount: number;
  percentage: number;
  transactions: Array<{
    date: string;
    description: string;
    amount: number;
    department: string;
    source?: string;
    vendor?: string;
    unit?: string;
    quantity?: number;
    unitPrice?: number;
  }>;
}

export interface BranchUnifiedDepartmentRow {
  department: string;
  income: number;
  expense: number;
  balance: number;
}

export interface BranchUnifiedReportData {
  reportType: 'branch_unified';
  branchId: number;
  branchName: string;
  branchCode?: string;
  year: number;
  month?: number; // undefined = all months
  generatedAt: string;
  generatedBy?: number;

  // Summary
  openingBalance: number;
  totalIncome: number;
  totalExpense: number;
  closingBalance: number;
  carryForward: number;

  // Monthly breakdown
  monthlyRows: BranchUnifiedMonthRow[];

  // Department breakdown
  departmentRows: BranchUnifiedDepartmentRow[];

  // Category breakdown
  incomeCategoryRows: BranchUnifiedCategoryRow[];
  expenseCategoryRows: BranchUnifiedCategoryRow[];

  // Metadata for tracking
  totalTransactions: number;
  incomeTransactionCount: number;
  expenseTransactionCount: number;
}

const MONTHS = [
  'Januari',
  'Februari',
  'Machi',
  'Aprili',
  'Mei',
  'Juni',
  'Julai',
  'Agosti',
  'Septemba',
  'Oktoba',
  'Novemba',
  'Desemba',
];

// ============================================================
// 1. Generate Monthly Rows
// ============================================================

async function generateMonthlyRows(
  branchId: number,
  year: number,
  month?: number
): Promise<{ rows: BranchUnifiedMonthRow[]; summary: { income: number; expense: number; opening: number; closing: number } }> {
  const monthList = month ? [month] : Array.from({ length: 12 }, (_, i) => i + 1);

  const monthlyRows: BranchUnifiedMonthRow[] = [];
  let totalIncome = 0;
  let totalExpense = 0;
  let openingBalance = 0;
  let closingBalance = 0;

  for (const m of monthList) {
    const monthlyData = await db.monthlyBalance.findUnique({
      where: {
        orgUnitId_month_year: {
          orgUnitId: branchId,
          month: m,
          year,
        },
      },
    });

    if (monthlyData) {
      // Use stored balance
      const monthBalance: BranchUnifiedMonthRow = {
        month: m,
        monthLabel: MONTHS[m - 1],
        openingBalance: monthlyData.openingBalance,
        income: monthlyData.totalIncome,
        expense: monthlyData.totalExpense,
        balance: monthlyData.totalIncome - monthlyData.totalExpense,
        closingBalance: monthlyData.closingBalance,
      };
      monthlyRows.push(monthBalance);

      if (monthlyRows.length === 1) openingBalance = monthlyData.openingBalance;
      totalIncome += monthlyData.totalIncome;
      totalExpense += monthlyData.totalExpense;
      closingBalance = monthlyData.closingBalance;
    } else {
      // Calculate from transactions
      const transactions = await db.transaction.findMany({
        where: {
          orgUnitId: branchId,
          month: m,
          year,
          isOpening: false,
        },
        select: { type: true, amount: true },
      });

      const income = transactions.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
      const expense = transactions.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);

      const monthBalance: BranchUnifiedMonthRow = {
        month: m,
        monthLabel: MONTHS[m - 1],
        openingBalance: monthlyRows.length === 0 ? 0 : monthlyRows[monthlyRows.length - 1].closingBalance,
        income,
        expense,
        balance: income - expense,
        closingBalance: (monthlyRows.length === 0 ? 0 : monthlyRows[monthlyRows.length - 1].closingBalance) + income - expense,
      };
      monthlyRows.push(monthBalance);

      if (monthlyRows.length === 1) openingBalance = monthBalance.openingBalance;
      totalIncome += income;
      totalExpense += expense;
      closingBalance = monthBalance.closingBalance;
    }
  }

  return {
    rows: monthlyRows,
    summary: { income: totalIncome, expense: totalExpense, opening: openingBalance, closing: closingBalance },
  };
}

// ============================================================
// 2. Generate Department Rows
// ============================================================

async function generateDepartmentRows(branchId: number, year: number, month?: number): Promise<BranchUnifiedDepartmentRow[]> {
  const where: any = { orgUnitId: branchId, year, isOpening: false };
  if (month) where.month = month;

  const transactions = await db.transaction.findMany({
    where,
    select: { department: true, type: true, amount: true },
  });

  const deptMap: Record<string, { income: number; expense: number }> = {};

  for (const dept of DEPARTMENTS) {
    deptMap[dept] = { income: 0, expense: 0 };
  }

  for (const txn of transactions) {
    const dept = txn.department || 'Ungrouped';
    if (!deptMap[dept]) deptMap[dept] = { income: 0, expense: 0 };

    if (txn.type === 'income') {
      deptMap[dept].income += txn.amount;
    } else {
      deptMap[dept].expense += txn.amount;
    }
  }

  return DEPARTMENTS.map((department) => {
    const totals = deptMap[department] || { income: 0, expense: 0 };
    return {
      department,
      income: totals.income,
      expense: totals.expense,
      balance: totals.income - totals.expense,
    };
  });
}

// ============================================================
// 3. Generate Category Rows (FIXED)
// ============================================================

async function generateCategoryRows(
  branchId: number,
  year: number,
  type: 'income' | 'expense',
  month?: number
): Promise<BranchUnifiedCategoryRow[]> {
  const where: any = { orgUnitId: branchId, year, type, isOpening: false };
  if (month) where.month = month;

  const transactions = await db.transaction.findMany({
    where,
    include: { category: true },
  });

  const categoryMap: Record<
    string,
    { amount: number; transactions: any[] }
  > = {};
  let total = 0;

  for (const txn of transactions) {
    const categoryName = txn.categoryName || txn.category?.name || 'Uncategorized';
    if (!categoryMap[categoryName]) {
      categoryMap[categoryName] = { amount: 0, transactions: [] };
    }
    categoryMap[categoryName].amount += txn.amount;
    categoryMap[categoryName].transactions.push({
      date: txn.date
        ? new Date(txn.date).toLocaleDateString('sw-TZ')
        : 'N/A',
      description: txn.description,
      amount: txn.amount,
      department: txn.department || 'N/A',
      source: txn.source,
      vendor: txn.vendor,
    });
    total += txn.amount;
  }

  return Object.entries(categoryMap)
    .map(([category, data]) => ({
      category,
      amount: data.amount,
      percentage: total > 0 ? (data.amount / total) * 100 : 0,
      transactions: data.transactions,
    }))
    .sort((a, b) => b.amount - a.amount);
}

// ============================================================
// 4. Main Report Generator
// ============================================================

export async function generateBranchUnifiedReport(
  branchId: number,
  year: number,
  month?: number,
  userId?: number
): Promise<BranchUnifiedReportData> {
  // Get branch info
  const branch = await db.orgUnit.findUnique({
    where: { id: branchId },
    select: { id: true, name: true, code: true, type: true },
  });

  if (!branch || branch.type !== 'tawi') {
    throw new Error(`Unit ${branchId} is not a branch (tawi)`);
  }

  // Get monthly breakdown
  const { rows: monthlyRows, summary } = await generateMonthlyRows(branchId, year, month);

  // Get department breakdown
  const departmentRows = await generateDepartmentRows(branchId, year, month);

  // Get category breakdown
  const incomeCategoryRows = await generateCategoryRows(branchId, year, 'income', month);
  const expenseCategoryRows = await generateCategoryRows(branchId, year, 'expense', month);

  // Count transactions
  const transactionWhere: any = { orgUnitId: branchId, year, isOpening: false };
  if (month) transactionWhere.month = month;

  const allTransactions = await db.transaction.findMany({ where: transactionWhere });
  const incomeCount = allTransactions.filter((t) => t.type === 'income').length;
  const expenseCount = allTransactions.filter((t) => t.type === 'expense').length;

  return {
    reportType: 'branch_unified',
    branchId,
    branchName: branch.name,
    branchCode: branch.code,
    year,
    month,
    generatedAt: new Date().toISOString(),
    generatedBy: userId,
    openingBalance: summary.opening,
    totalIncome: summary.income,
    totalExpense: summary.expense,
    closingBalance: summary.closing,
    carryForward: summary.closing,
    monthlyRows,
    departmentRows,
    incomeCategoryRows,
    expenseCategoryRows,
    totalTransactions: allTransactions.length,
    incomeTransactionCount: incomeCount,
    expenseTransactionCount: expenseCount,
  };
}

function resolveBranchMonth(month?: string): number | undefined {
  if (!month) return undefined;
  const normalized = String(month).trim();
  const numeric = Number(normalized);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 12) {
    return numeric;
  }

  const lower = normalized.toLowerCase();
  const monthNames = ['januari', 'februari', 'machi', 'aprili', 'mei', 'juni', 'julai', 'agosti', 'septemba', 'oktoba', 'novemba', 'desemba'];
  const monthIndex = monthNames.findIndex((m) => m === lower);
  if (monthIndex >= 0) return monthIndex + 1;
  return undefined;
}

function buildBranchUnifiedReportFromSnapshot(
  snapshot: BranchReportSnapshot,
  branchId: number,
  branchName: string,
  userId?: number
): BranchUnifiedReportData {
  const month = resolveBranchMonth(snapshot.month);
  const incomeCategoryRows = Object.entries(snapshot.income.categories).map(([category, amount]) => ({
    category,
    amount,
    percentage: snapshot.income.total > 0 ? (amount / snapshot.income.total) * 100 : 0,
    transactions: [],
  }));

  const expenseCategoryRows = Object.entries(snapshot.expenses.categories).map(([category, amount]) => ({
    category,
    amount,
    percentage: snapshot.expenses.total > 0 ? (amount / snapshot.expenses.total) * 100 : 0,
    transactions: [],
  }));

  const departmentRows = Object.entries(snapshot.departments).map(([department, balance]) => ({
    department,
    income: 0,
    expense: 0,
    balance,
  }));

  return {
    reportType: 'branch_unified',
    branchId,
    branchName,
    branchCode: undefined,
    year: snapshot.year,
    month,
    generatedAt: new Date().toISOString(),
    generatedBy: userId,
    openingBalance: 0,
    totalIncome: snapshot.income.total,
    totalExpense: snapshot.expenses.total,
    closingBalance: snapshot.net,
    carryForward: snapshot.net,
    monthlyRows: [],
    departmentRows,
    incomeCategoryRows,
    expenseCategoryRows,
    totalTransactions: 0,
    incomeTransactionCount: 0,
    expenseTransactionCount: 0,
  };
}

export async function saveImportedBranchReport(
  options: {
    snapshot: BranchReportSnapshot;
    branchId: number;
    uploadedBy?: number;
    fileName?: string;
  }
): Promise<void> {
  const { snapshot, branchId, uploadedBy } = options;
  const branch = await db.orgUnit.findUnique({
    where: { id: branchId },
    select: { id: true, name: true, parentId: true, type: true },
  });
  if (!branch || branch.type !== 'tawi') {
    throw new Error(`Tawi ${branchId} haipatikani au si tawi.`);
  }

  const report = buildBranchUnifiedReportFromSnapshot(snapshot, branchId, branch.name, uploadedBy);
  await saveBranchUnifiedReport(report, uploadedBy);

  await db.auditLog.create({
    data: {
      action: 'IMPORT_REPORT',
      entity: 'branch_unified_report',
      entityId: branchId,
      userId: uploadedBy || 0,
      details: `Imported branch report snapshot for ${branch.name} (${snapshot.year}${snapshot.month ? `/${snapshot.month}` : ''})`,
      createdAt: new Date().toISOString(),
    },
  });
}

// ============================================================
// 5. Save Branch Report
// ============================================================

export async function saveBranchUnifiedReport(
  report: BranchUnifiedReportData,
  userId?: number
): Promise<void> {
  // Persist a regional consolidated snapshot for the parent Jimbo
  try {
    // Find branch to get parent (region/jimbo)
    const branch = await db.orgUnit.findUnique({ where: { id: report.branchId }, select: { parentId: true } });
    const regionId = branch?.parentId;
    if (!regionId) {
      console.warn(`Branch ${report.branchId} has no parent region; skipping regional save.`);
      return;
    }

    const month = report.month ?? 0;

    // Build category breakdowns as simple maps
    const incomeMap: Record<string, number> = {};
    for (const c of report.incomeCategoryRows || []) {
      incomeMap[c.category] = (incomeMap[c.category] || 0) + c.amount;
    }
    const expenseMap: Record<string, number> = {};
    for (const c of report.expenseCategoryRows || []) {
      expenseMap[c.category] = (expenseMap[c.category] || 0) + c.amount;
    }

    // Try to find existing regional report for this region/month/year
    const existing = await db.regionalReport.findUnique({ where: { regionId_month_year: { regionId, month, year: report.year } } });

    if (existing) {
      let importedBranchIds: number[] = [];
      try {
        const parsed = existing.notes ? JSON.parse(existing.notes) : null;
        if (Array.isArray(parsed?.importedBranchIds)) {
          importedBranchIds = parsed.importedBranchIds.filter((id: unknown) => typeof id === 'number');
        }
      } catch {
        importedBranchIds = [];
      }

      if (importedBranchIds.includes(report.branchId)) {
        throw new Error(
          `Upakiaji rudufu umezuiwa: tawi ${report.branchName} tayari limeingizwa kwa kipindi hiki.`
        );
      }

      importedBranchIds.push(report.branchId);

      // Merge totals
      const mergedIncomeBreakdown = existing.incomeBreakdown ? JSON.parse(existing.incomeBreakdown) : {};
      for (const [k, v] of Object.entries(incomeMap)) mergedIncomeBreakdown[k] = (mergedIncomeBreakdown[k] || 0) + v;

      const mergedExpenseBreakdown = existing.expenseBreakdown ? JSON.parse(existing.expenseBreakdown) : {};
      for (const [k, v] of Object.entries(expenseMap)) mergedExpenseBreakdown[k] = (mergedExpenseBreakdown[k] || 0) + v;

      await db.regionalReport.update({ where: { id: existing.id }, data: {
        openingBalance: existing.openingBalance + report.openingBalance,
        totalIncome: existing.totalIncome + report.totalIncome,
        totalExpense: existing.totalExpense + report.totalExpense,
        closingBalance: existing.closingBalance + report.closingBalance,
        carryForward: (existing.carryForward || 0) + report.carryForward,
        branchCount: (existing.branchCount || 0) + 1,
        incomeBreakdown: JSON.stringify(mergedIncomeBreakdown),
        expenseBreakdown: JSON.stringify(mergedExpenseBreakdown),
        notes: JSON.stringify({ importedBranchIds }),
        generatedBy: userId,
        generatedAt: new Date(),
        updatedAt: new Date(),
      }});
    } else {
      await db.regionalReport.create({
        data: {
          regionId,
          month,
          year: report.year,
          openingBalance: report.openingBalance,
          totalIncome: report.totalIncome,
          totalExpense: report.totalExpense,
          closingBalance: report.closingBalance,
          carryForward: report.carryForward,
          branchCount: 1,
          incomeBreakdown: JSON.stringify(incomeMap),
          expenseBreakdown: JSON.stringify(expenseMap),
          generatedBy: userId,
          generatedAt: new Date(),
          notes: JSON.stringify({ importedBranchIds: [report.branchId] }),
        },
      });
    }

    // Also log to console for audit
    console.log(`Saved branch unified report for ${report.branchName}, ${report.year}/${report.month || 'all'} to region ${regionId}`);
  } catch (err) {
    console.error('Error saving branch unified report to regional snapshot:', err);
    throw err;
  }
}
