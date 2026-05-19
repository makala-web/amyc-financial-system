// ============================================================
// AMYC Financial Management System - Balance Engine
// Manages opening balances, closing balances, and monthly continuity
// ============================================================

import { db } from '@/lib/db';

// ============================================================
// Types
// ============================================================

export interface MonthlyBalanceData {
  orgUnitId: number;
  month: number;
  year: number;
  openingBalance: number;
  totalIncome: number;
  totalExpense: number;
  closingBalance: number;
  carryForward: number;
}

export interface BalanceCalculationResult {
  orgUnitId: number;
  year: number;
  openingBalance: number;
  closingBalance: number;
  totalIncome: number;
  totalExpense: number;
  monthlyData: MonthlyBalanceData[];
}

// ============================================================
// 1. Calculate Opening Balance for a Month
// ============================================================

/**
 * Calculate opening balance for a specific month/year.
 * If it's January, opening balance = previous year's closing balance.
 * If it's other months, opening balance = previous month's closing balance.
 */
export async function calculateMonthlyOpeningBalance(
  orgUnitId: number,
  month: number,
  year: number
): Promise<number> {
  // If January, get previous year's closing balance
  if (month === 1) {
    const prevYearClosing = await getMonthlyClosingBalance(orgUnitId, 12, year - 1);
    return prevYearClosing;
  }

  // For other months, get previous month's closing balance
  const prevMonthClosing = await getMonthlyClosingBalance(orgUnitId, month - 1, year);
  return prevMonthClosing;
}

// ============================================================
// 2. Get Monthly Closing Balance from Database or Calculate It
// ============================================================

/**
 * Get closing balance for a specific month.
 * First checks if it's stored in database, otherwise calculates from transactions.
 */
export async function getMonthlyClosingBalance(
  orgUnitId: number,
  month: number,
  year: number
): Promise<number> {
  // Check if balance is stored in database
  const storedBalance = await db.monthlyBalance.findUnique({
    where: {
      orgUnitId_month_year: {
        orgUnitId,
        month,
        year,
      },
    },
    select: { closingBalance: true },
  });

  if (storedBalance) {
    return storedBalance.closingBalance;
  }

  // Calculate from transactions
  const monthlyData = await calculateMonthlyBalance(orgUnitId, month, year);
  return monthlyData.closingBalance;
}

// ============================================================
// 3. Calculate Monthly Balance (Income - Expense)
// ============================================================

/**
 * Calculate income and expense for a specific month,
 * then calculate closing balance using opening balance.
 */
export async function calculateMonthlyBalance(
  orgUnitId: number,
  month: number,
  year: number
): Promise<MonthlyBalanceData> {
  // Get opening balance
  const openingBalance = await calculateMonthlyOpeningBalance(orgUnitId, month, year);

  // Get transactions for this month
  const transactions = await db.transaction.findMany({
    where: {
      orgUnitId,
      month,
      year,
      isOpening: false,
    },
    select: { type: true, amount: true },
  });

  // Calculate income and expense
  const totalIncome = transactions
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpense = transactions
    .filter((t) => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);

  // Calculate closing balance
  // Formula: Closing Balance = Opening Balance + Income - Expense
  const closingBalance = openingBalance + totalIncome - totalExpense;

  // Carry forward = Closing balance for next month
  const carryForward = closingBalance;

  return {
    orgUnitId,
    month,
    year,
    openingBalance,
    totalIncome,
    totalExpense,
    closingBalance,
    carryForward,
  };
}

// ============================================================
// 4. Calculate Full Year Balance
// ============================================================

/**
 * Calculate monthly balances for entire year.
 * This produces the running balance for all 12 months.
 */
export async function calculateYearlyBalance(
  orgUnitId: number,
  year: number
): Promise<BalanceCalculationResult> {
  const orgUnit = await db.orgUnit.findUnique({
    where: { id: orgUnitId },
    select: { name: true },
  });

  if (!orgUnit) {
    throw new Error(`Organization unit ${orgUnitId} not found`);
  }

  const monthlyData: MonthlyBalanceData[] = [];
  let totalIncome = 0;
  let totalExpense = 0;
  let openingBalance = 0;
  let closingBalance = 0;

  for (let month = 1; month <= 12; month++) {
    const monthlyBalance = await calculateMonthlyBalance(orgUnitId, month, year);

    monthlyData.push(monthlyBalance);

    if (month === 1) {
      openingBalance = monthlyBalance.openingBalance;
    }

    totalIncome += monthlyBalance.totalIncome;
    totalExpense += monthlyBalance.totalExpense;
    closingBalance = monthlyBalance.closingBalance;
  }

  return {
    orgUnitId,
    year,
    openingBalance,
    closingBalance,
    totalIncome,
    totalExpense,
    monthlyData,
  };
}

// ============================================================
// 5. Save Monthly Balance to Database
// ============================================================

/**
 * Save calculated monthly balance to database.
 * This allows for efficient retrieval later without recalculating.
 */
export async function saveMonthlyBalance(
  balance: MonthlyBalanceData,
  userId?: number,
  notes?: string
): Promise<void> {
  try {
    await db.monthlyBalance.upsert({
      where: {
        orgUnitId_month_year: {
          orgUnitId: balance.orgUnitId,
          month: balance.month,
          year: balance.year,
        },
      },
      update: {
        openingBalance: balance.openingBalance,
        totalIncome: balance.totalIncome,
        totalExpense: balance.totalExpense,
        closingBalance: balance.closingBalance,
        carryForward: balance.carryForward,
        generatedBy: userId,
        generatedAt: new Date(),
        notes,
      },
      create: {
        orgUnitId: balance.orgUnitId,
        month: balance.month,
        year: balance.year,
        openingBalance: balance.openingBalance,
        totalIncome: balance.totalIncome,
        totalExpense: balance.totalExpense,
        closingBalance: balance.closingBalance,
        carryForward: balance.carryForward,
        generatedBy: userId,
        notes,
      },
    });
  } catch (error) {
    console.error(
      `Error saving monthly balance for org ${balance.orgUnitId}, ${balance.month}/${balance.year}:`,
      error
    );
    throw error;
  }
}

// ============================================================
// 6. Save Year's Balances
// ============================================================

/**
 * Save all monthly balances for a year to database.
 */
export async function saveYearlyBalances(
  yearlyBalance: BalanceCalculationResult,
  userId?: number
): Promise<void> {
  try {
    const savePromises = yearlyBalance.monthlyData.map((monthlyData) =>
      saveMonthlyBalance(monthlyData, userId, `Auto-generated for year ${yearlyBalance.year}`)
    );

    await Promise.all(savePromises);

    console.log(`Saved ${yearlyBalance.monthlyData.length} monthly balances for org ${yearlyBalance.orgUnitId}`);
  } catch (error) {
    console.error(`Error saving yearly balances:`, error);
    throw error;
  }
}

// ============================================================
// 7. Validate Monthly Continuity
// ============================================================

/**
 * Validate that closing balance of month N = opening balance of month N+1.
 * Returns any continuity breaks.
 */
export async function validateMonthlyContinuity(
  orgUnitId: number,
  year: number
): Promise<Array<{ month: number; issue: string }>> {
  const issues: Array<{ month: number; issue: string }> = [];

  for (let month = 1; month < 12; month++) {
    const currentClosing = await getMonthlyClosingBalance(orgUnitId, month, year);
    const nextOpening = await calculateMonthlyOpeningBalance(orgUnitId, month + 1, year);

    if (Math.abs(currentClosing - nextOpening) > 0.01) {
      issues.push({
        month,
        issue: `Closing balance (${currentClosing}) doesn't match next month's opening (${nextOpening})`,
      });
    }
  }

  return issues;
}

// ============================================================
// 8. Get or Create Monthly Balance
// ============================================================

/**
 * Get monthly balance from database, or calculate and save it if not found.
 */
export async function getOrCreateMonthlyBalance(
  orgUnitId: number,
  month: number,
  year: number,
  userId?: number
): Promise<MonthlyBalanceData> {
  // Check if exists in database
  const stored = await db.monthlyBalance.findUnique({
    where: {
      orgUnitId_month_year: {
        orgUnitId,
        month,
        year,
      },
    },
  });

  if (stored) {
    return {
      orgUnitId: stored.orgUnitId,
      month: stored.month,
      year: stored.year,
      openingBalance: stored.openingBalance,
      totalIncome: stored.totalIncome,
      totalExpense: stored.totalExpense,
      closingBalance: stored.closingBalance,
      carryForward: stored.carryForward || 0,
    };
  }

  // Calculate and save
  const calculated = await calculateMonthlyBalance(orgUnitId, month, year);
  await saveMonthlyBalance(calculated, userId);

  return calculated;
}
