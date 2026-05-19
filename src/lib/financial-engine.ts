// ============================================================
// AMYC Financial Management System - Financial Calculation Engine
// Professional Financial System for Ansaar Muslim Youth Centre
// THE BRAIN of the financial system - all core calculations
// ============================================================

import { db } from '@/lib/db';
import { DEPARTMENTS, MONTHS } from '@/lib/types';

// ============================================================
// Types
// ============================================================

export interface MonthlyBalance {
  month: number;
  monthName: string;
  income: number;
  expense: number;
  balance: number;
  cumulativeIncome: number;
  cumulativeExpense: number;
  runningBalance: number;
}

export interface RunningBalanceResult {
  orgUnitId: number;
  year: number;
  openingBalance: number;
  months: MonthlyBalance[];
  totalIncome: number;
  totalExpense: number;
  closingBalance: number;
}

export interface DepartmentTotal {
  department: string;
  income: number;
  expense: number;
  balance: number;
  transactionCount: number;
}

export interface CategoryBreakdown {
  categoryId: number;
  categoryName: string;
  total: number;
  transactionCount: number;
  percentage: number;
}

export interface BudgetVariance {
  category: string;
  department: string;
  type: string;
  planned: number;
  actual: number;
  variance: number;
  variancePercent: number;
  status: 'under' | 'on_target' | 'over';
}

export interface ChildSubmission {
  orgUnitId: number;
  orgUnitName: string;
  orgLevel: string;
  isSubmitted: boolean;
  submittedAt: Date | null;
  totalIncome: number;
  totalExpense: number;
}

export interface FinancialYearReport {
  orgUnitId: number;
  orgUnitName: string;
  orgLevel: string;
  year: number;
  openingBalance: number;
  totalIncome: number;
  totalExpense: number;
  closingBalance: number;
  monthlyData: MonthlyBalance[];
  departmentalData: DepartmentTotal[];
  incomeBreakdown: CategoryBreakdown[];
  expenseBreakdown: CategoryBreakdown[];
  budgetVariance: BudgetVariance[];
  childrenReports: FinancialYearReport[];
}

export interface ConsolidatedResult {
  parentOrgId: number;
  parentOrgName: string;
  year: number;
  ownIncome: number;
  ownExpense: number;
  ownBalance: number;
  childrenIncome: number;
  childrenExpense: number;
  childrenBalance: number;
  consolidatedIncome: number;
  consolidatedExpense: number;
  consolidatedBalance: number;
  children: Array<{
    orgUnitId: number;
    orgUnitName: string;
    income: number;
    expense: number;
    balance: number;
  }>;
}

// ============================================================
// Helper: Get all descendant org unit IDs recursively
// ============================================================

async function getAllDescendantIds(parentId: number): Promise<number[]> {
  const children = await db.orgUnit.findMany({
    where: { parentId, isActive: true },
    select: { id: true },
  });

  const ids: number[] = [];
  for (const child of children) {
    ids.push(child.id);
    const grandChildIds = await getAllDescendantIds(child.id);
    ids.push(...grandChildIds);
  }
  return ids;
}

// ============================================================
// Helper: Get direct child org units
// ============================================================

async function getDirectChildren(parentId: number) {
  return db.orgUnit.findMany({
    where: { parentId, isActive: true },
    orderBy: { name: 'asc' },
  });
}

// ============================================================
// 1. Calculate Opening Balance
// ============================================================

/**
 * Get the opening balance for an org unit for a given year.
 * Opening balance = previous year's closing balance.
 * Closing balance = sum(income) - sum(expense) for the previous year.
 */
export async function calculateOpeningBalance(
  orgUnitId: number,
  year: number
): Promise<number> {
  const prevYear = year - 1;

  // Check for an explicit opening balance transaction
  const openingTxn = await db.transaction.findFirst({
    where: {
      orgUnitId,
      year: prevYear,
      isOpening: true,
    },
  });

  if (openingTxn) {
    return openingTxn.amount;
  }

  // Calculate from previous year's transactions
  const prevYearTxns = await db.transaction.findMany({
    where: {
      orgUnitId,
      year: prevYear,
      isOpening: false,
    },
    select: { type: true, amount: true },
  });

  const prevIncome = prevYearTxns
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);
  const prevExpense = prevYearTxns
    .filter((t) => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);

  return prevIncome - prevExpense;
}

// ============================================================
// 2. Calculate Running Balance
// ============================================================

/**
 * Calculate running balance month by month for an org unit and year.
 * This is the core financial calculation that produces the monthly
 * income/expense/balance with cumulative totals.
 */
export async function calculateRunningBalance(
  orgUnitId: number,
  year: number
): Promise<RunningBalanceResult> {
  const orgUnit = await db.orgUnit.findUnique({
    where: { id: orgUnitId },
    select: { name: true },
  });

  // Get opening balance
  const openingBalance = await calculateOpeningBalance(orgUnitId, year);

  // Get all transactions for the year (non-opening)
  const transactions = await db.transaction.findMany({
    where: {
      orgUnitId,
      year,
      isOpening: false,
    },
    select: { month: true, type: true, amount: true },
  });

  // Build monthly data
  const months: MonthlyBalance[] = [];
  let cumulativeIncome = 0;
  let cumulativeExpense = 0;
  let runningBalance = openingBalance;

  for (let m = 1; m <= 12; m++) {
    const monthTxns = transactions.filter((t) => t.month === m);
    const income = monthTxns
      .filter((t) => t.type === 'income')
      .reduce((s, t) => s + t.amount, 0);
    const expense = monthTxns
      .filter((t) => t.type === 'expense')
      .reduce((s, t) => s + t.amount, 0);

    cumulativeIncome += income;
    cumulativeExpense += expense;
    runningBalance = openingBalance + cumulativeIncome - cumulativeExpense;

    months.push({
      month: m,
      monthName: MONTHS[m - 1],
      income,
      expense,
      balance: income - expense,
      cumulativeIncome,
      cumulativeExpense,
      runningBalance,
    });
  }

  return {
    orgUnitId,
    year,
    openingBalance,
    months,
    totalIncome: cumulativeIncome,
    totalExpense: cumulativeExpense,
    closingBalance: runningBalance,
  };
}

// ============================================================
// 3. Calculate Monthly Closing
// ============================================================

/**
 * Close a month for an org unit.
 * This creates or updates a MonthlySubmission record with the
 * month's totals and locks the transactions.
 */
export async function calculateMonthlyClosing(
  orgUnitId: number,
  month: number,
  year: number
) {
  // Get month's transactions
  const transactions = await db.transaction.findMany({
    where: {
      orgUnitId,
      month,
      year,
      isOpening: false,
    },
    select: { type: true, amount: true },
  });

  const totalIncome = transactions
    .filter((t) => t.type === 'income')
    .reduce((s, t) => s + t.amount, 0);
  const totalExpense = transactions
    .filter((t) => t.type === 'expense')
    .reduce((s, t) => s + t.amount, 0);
  const netBalance = totalIncome - totalExpense;

  // Upsert monthly submission
  const submission = await db.monthlySubmission.upsert({
    where: {
      orgUnitId_month_year: { orgUnitId, month, year },
    },
    create: {
      orgUnitId,
      month,
      year,
      isSubmitted: true,
      submittedAt: new Date(),
      totalIncome,
      totalExpense,
      netBalance,
    },
    update: {
      isSubmitted: true,
      submittedAt: new Date(),
      totalIncome,
      totalExpense,
      netBalance,
    },
  });

  // Mark transactions as submitted
  await db.transaction.updateMany({
    where: {
      orgUnitId,
      month,
      year,
      isSubmitted: false,
    },
    data: {
      isSubmitted: true,
      submittedAt: new Date(),
    },
  });

  return submission;
}

// ============================================================
// 4. Carry Forward
// ============================================================

/**
 * Carry forward balances from one year to the next.
 * Creates an opening balance transaction for the new year.
 */
export async function carryForward(
  orgUnitId: number,
  fromYear: number,
  toYear: number
) {
  // Calculate closing balance for fromYear
  const runningBalance = await calculateRunningBalance(orgUnitId, fromYear);
  const closingBalance = runningBalance.closingBalance;

  // Get org unit info
  const orgUnit = await db.orgUnit.findUnique({
    where: { id: orgUnitId },
  });

  if (!orgUnit) {
    throw new Error('Org unit not found');
  }

  // Check if opening balance already exists for toYear
  const existing = await db.transaction.findFirst({
    where: {
      orgUnitId,
      year: toYear,
      isOpening: true,
    },
  });

  if (existing) {
    // Update existing opening balance
    await db.transaction.update({
      where: { id: existing.id },
      data: {
        amount: closingBalance,
        updatedAt: new Date(),
      },
    });
  } else {
    // Create opening balance transaction
    await db.transaction.create({
      data: {
        type: 'income',
        amount: closingBalance,
        date: new Date(toYear, 0, 1), // Jan 1 of new year
        month: 1,
        year: toYear,
        department: 'Bakaa',
        categoryId: 0, // Will need a special category or handle this
        categoryName: 'Bakaa kutoka Mwaka Uliopita',
        description: `Salio la kufungua kutoka mwaka ${fromYear}`,
        orgUnitId,
        orgUnitName: orgUnit.name,
        orgLevel: orgUnit.type,
        enteredBy: 0, // System
        financialYear: toYear,
        isOpening: true,
      },
    });
  }

  // Also carry forward for all active children
  const children = await getDirectChildren(orgUnitId);
  for (const child of children) {
    await carryForward(child.id, fromYear, toYear);
  }

  return {
    orgUnitId,
    fromYear,
    toYear,
    carriedAmount: closingBalance,
  };
}

// ============================================================
// 5. Calculate Departmental Totals
// ============================================================

/**
 * Calculate totals per department for an org unit and year.
 */
export async function calculateDepartmentalTotals(
  orgUnitId: number,
  year: number
): Promise<DepartmentTotal[]> {
  const transactions = await db.transaction.findMany({
    where: {
      orgUnitId,
      year,
      isOpening: false,
    },
    select: { department: true, type: true, amount: true },
  });

  const deptMap = new Map<string, { income: number; expense: number; count: number }>();

  // Initialize all departments
  for (const dept of DEPARTMENTS) {
    deptMap.set(dept, { income: 0, expense: 0, count: 0 });
  }

  // Aggregate transactions
  for (const t of transactions) {
    const dept = t.department || 'Habari'; // Default to Habari if missing
    const existing = deptMap.get(dept) || { income: 0, expense: 0, count: 0 };
    if (t.type === 'income') {
      existing.income += t.amount;
    } else {
      existing.expense += t.amount;
    }
    existing.count += 1;
    deptMap.set(dept, existing);
  }

  return Array.from(deptMap.entries()).map(([department, data]) => ({
    department,
    income: data.income,
    expense: data.expense,
    balance: data.income - data.expense,
    transactionCount: data.count,
  }));
}

// ============================================================
// 6. Calculate Consolidated Totals
// ============================================================

/**
 * Calculate consolidated totals for a parent org including
 * all active children (recursive).
 */
export async function calculateConsolidatedTotals(
  parentOrgId: number,
  year: number
): Promise<ConsolidatedResult> {
  const parent = await db.orgUnit.findUnique({
    where: { id: parentOrgId },
  });

  if (!parent) {
    throw new Error('Parent org unit not found');
  }

  // Own transactions
  const ownTxns = await db.transaction.findMany({
    where: {
      orgUnitId: parentOrgId,
      year,
      isOpening: false,
    },
    select: { type: true, amount: true },
  });

  const ownIncome = ownTxns
    .filter((t) => t.type === 'income')
    .reduce((s, t) => s + t.amount, 0);
  const ownExpense = ownTxns
    .filter((t) => t.type === 'expense')
    .reduce((s, t) => s + t.amount, 0);

  // Children's transactions
  const descendantIds = await getAllDescendantIds(parentOrgId);

  let childrenIncome = 0;
  let childrenExpense = 0;
  const childrenData: ConsolidatedResult['children'] = [];

  for (const childId of descendantIds) {
    const childTxns = await db.transaction.findMany({
      where: {
        orgUnitId: childId,
        year,
        isOpening: false,
      },
      select: { type: true, amount: true },
    });

    const childIncome = childTxns
      .filter((t) => t.type === 'income')
      .reduce((s, t) => s + t.amount, 0);
    const childExpense = childTxns
      .filter((t) => t.type === 'expense')
      .reduce((s, t) => s + t.amount, 0);

    childrenIncome += childIncome;
    childrenExpense += childExpense;

    const childOrg = await db.orgUnit.findUnique({
      where: { id: childId },
      select: { name: true },
    });

    childrenData.push({
      orgUnitId: childId,
      orgUnitName: childOrg?.name || 'Unknown',
      income: childIncome,
      expense: childExpense,
      balance: childIncome - childExpense,
    });
  }

  const consolidatedIncome = ownIncome + childrenIncome;
  const consolidatedExpense = ownExpense + childrenExpense;

  return {
    parentOrgId,
    parentOrgName: parent.name,
    year,
    ownIncome,
    ownExpense,
    ownBalance: ownIncome - ownExpense,
    childrenIncome,
    childrenExpense,
    childrenBalance: childrenIncome - childrenExpense,
    consolidatedIncome,
    consolidatedExpense,
    consolidatedBalance: consolidatedIncome - consolidatedExpense,
    children: childrenData,
  };
}

// ============================================================
// 7. Calculate Budget Variance
// ============================================================

/**
 * Calculate budget vs actual comparison for an org unit and year.
 */
export async function calculateBudgetVariance(
  orgUnitId: number,
  year: number
): Promise<BudgetVariance[]> {
  const budgets = await db.budget.findMany({
    where: {
      orgUnitId,
      year,
    },
  });

  const variances: BudgetVariance[] = [];

  for (const budget of budgets) {
    // Get actual spending for this category/department/type
    const actualTxns = await db.transaction.findMany({
      where: {
        orgUnitId,
        year,
        department: budget.department,
        categoryName: budget.category,
        type: budget.type,
        isOpening: false,
      },
      select: { amount: true },
    });

    const actualAmount = actualTxns.reduce((s, t) => s + t.amount, 0);
    const variance = budget.plannedAmount - actualAmount;
    const variancePercent =
      budget.plannedAmount > 0
        ? (variance / budget.plannedAmount) * 100
        : 0;

    let status: BudgetVariance['status'] = 'on_target';
    if (variancePercent > 5) status = 'under';
    else if (variancePercent < -5) status = 'over';

    variances.push({
      category: budget.category,
      department: budget.department,
      type: budget.type,
      planned: budget.plannedAmount,
      actual: actualAmount,
      variance,
      variancePercent: Math.round(variancePercent * 100) / 100,
      status,
    });

    // Update budget record with actual amounts
    await db.budget.update({
      where: { id: budget.id },
      data: {
        actualAmount,
        variance,
      },
    });
  }

  return variances;
}

// ============================================================
// 8. Get Monthly Summary
// ============================================================

/**
 * Get income and expense per month arrays for an org unit.
 * Returns two 12-element arrays (Jan-Dec).
 */
export async function getMonthlySummary(
  orgUnitId: number,
  year: number
): Promise<{ incomeByMonth: number[]; expenseByMonth: number[] }> {
  const transactions = await db.transaction.findMany({
    where: {
      orgUnitId,
      year,
      isOpening: false,
    },
    select: { month: true, type: true, amount: true },
  });

  const incomeByMonth = new Array(12).fill(0) as number[];
  const expenseByMonth = new Array(12).fill(0) as number[];

  for (const t of transactions) {
    const idx = t.month - 1;
    if (idx >= 0 && idx < 12) {
      if (t.type === 'income') {
        incomeByMonth[idx] += t.amount;
      } else {
        expenseByMonth[idx] += t.amount;
      }
    }
  }

  return { incomeByMonth, expenseByMonth };
}

// ============================================================
// 9. Get Consolidated Monthly Summary
// ============================================================

/**
 * Get consolidated monthly summary for a parent org including
 * all descendant transactions.
 */
export async function getConsolidatedMonthlySummary(
  parentOrgId: number,
  year: number
): Promise<{ incomeByMonth: number[]; expenseByMonth: number[] }> {
  // Get own monthly summary
  const own = await getMonthlySummary(parentOrgId, year);

  // Get all descendants
  const descendantIds = await getAllDescendantIds(parentOrgId);

  // Aggregate children
  const incomeByMonth = [...own.incomeByMonth];
  const expenseByMonth = [...own.expenseByMonth];

  for (const childId of descendantIds) {
    const childSummary = await getMonthlySummary(childId, year);
    for (let i = 0; i < 12; i++) {
      incomeByMonth[i] += childSummary.incomeByMonth[i];
      expenseByMonth[i] += childSummary.expenseByMonth[i];
    }
  }

  return { incomeByMonth, expenseByMonth };
}

// ============================================================
// 10. Get Unsubmitted Children
// ============================================================

/**
 * Find which child org units have NOT submitted their data
 * for a specific month/year.
 */
export async function getUnsubmittedChildren(
  parentOrgId: number,
  month: number,
  year: number
): Promise<ChildSubmission[]> {
  const children = await getDirectChildren(parentOrgId);
  const results: ChildSubmission[] = [];

  for (const child of children) {
    const submission = await db.monthlySubmission.findUnique({
      where: {
        orgUnitId_month_year: {
          orgUnitId: child.id,
          month,
          year,
        },
      },
    });

    // Get monthly totals regardless of submission status
    const monthTxns = await db.transaction.findMany({
      where: {
        orgUnitId: child.id,
        month,
        year,
        isOpening: false,
      },
      select: { type: true, amount: true },
    });

    const totalIncome = monthTxns
      .filter((t) => t.type === 'income')
      .reduce((s, t) => s + t.amount, 0);
    const totalExpense = monthTxns
      .filter((t) => t.type === 'expense')
      .reduce((s, t) => s + t.amount, 0);

    results.push({
      orgUnitId: child.id,
      orgUnitName: child.name,
      orgLevel: child.type,
      isSubmitted: submission?.isSubmitted ?? false,
      submittedAt: submission?.submittedAt ?? null,
      totalIncome,
      totalExpense,
    });
  }

  return results;
}

// ============================================================
// 11. Calculate Category Breakdown
// ============================================================

/**
 * Breakdown of transactions by category for a given type (income/expense).
 */
export async function calculateCategoryBreakdown(
  orgUnitId: number,
  type: 'income' | 'expense',
  year: number
): Promise<CategoryBreakdown[]> {
  const transactions = await db.transaction.findMany({
    where: {
      orgUnitId,
      type,
      year,
      isOpening: false,
    },
    select: { categoryId: true, categoryName: true, amount: true },
  });

  const catMap = new Map<number, { name: string; total: number; count: number }>();

  for (const t of transactions) {
    if (t.categoryId === null) {
      continue;
    }

    const existing = catMap.get(t.categoryId);
    if (existing) {
      existing.total += t.amount;
      existing.count += 1;
    } else {
      catMap.set(t.categoryId, {
        name: t.categoryName ?? 'Bila Kundi',
        total: t.amount,
        count: 1,
      });
    }
  }

  const grandTotal = Array.from(catMap.values()).reduce((s, c) => s + c.total, 0);

  return Array.from(catMap.entries())
    .map(([categoryId, data]) => ({
      categoryId,
      categoryName: data.name,
      total: data.total,
      transactionCount: data.count,
      percentage: grandTotal > 0 ? Math.round((data.total / grandTotal) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

// ============================================================
// 12. Generate Financial Year Report
// ============================================================

/**
 * Generate a comprehensive financial year report for an org unit.
 * Includes monthly data, departmental totals, category breakdowns,
 * budget variance, and children reports (for jimbo/markaz).
 */
export async function generateFinancialYearReport(
  orgUnitId: number,
  year: number
): Promise<FinancialYearReport> {
  const orgUnit = await db.orgUnit.findUnique({
    where: { id: orgUnitId },
  });

  if (!orgUnit) {
    throw new Error('Org unit not found');
  }

  // Running balance (includes opening balance and monthly data)
  const runningBalance = await calculateRunningBalance(orgUnitId, year);

  // Departmental totals
  const departmentalData = await calculateDepartmentalTotals(orgUnitId, year);

  // Category breakdowns
  const incomeBreakdown = await calculateCategoryBreakdown(orgUnitId, 'income', year);
  const expenseBreakdown = await calculateCategoryBreakdown(orgUnitId, 'expense', year);

  // Budget variance
  const budgetVariance = await calculateBudgetVariance(orgUnitId, year);

  // Children reports (for jimbo/markaz)
  const childrenReports: FinancialYearReport[] = [];
  if (orgUnit.type === 'jimbo' || orgUnit.type === 'markaz') {
    const children = await getDirectChildren(orgUnitId);
    for (const child of children) {
      const childReport = await generateFinancialYearReport(child.id, year);
      childrenReports.push(childReport);
    }
  }

  return {
    orgUnitId,
    orgUnitName: orgUnit.name,
    orgLevel: orgUnit.type,
    year,
    openingBalance: runningBalance.openingBalance,
    totalIncome: runningBalance.totalIncome,
    totalExpense: runningBalance.totalExpense,
    closingBalance: runningBalance.closingBalance,
    monthlyData: runningBalance.months,
    departmentalData,
    incomeBreakdown,
    expenseBreakdown,
    budgetVariance,
    childrenReports,
  };
}
