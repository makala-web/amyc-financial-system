// ============================================================
// AMYC Financial Management System - Carry-Forward Logic
// Handles automatic month creation and balance carry-forward
// ============================================================

import { db } from '@/lib/db';
import { calculateMonthlyBalance, saveMonthlyBalance } from './balance-engine';

// ============================================================
// Types
// ============================================================

export interface CarryForwardResult {
  orgUnitId: number;
  month: number;
  year: number;
  previousClosingBalance: number;
  newOpeningBalance: number;
  success: boolean;
  message: string;
}

// ============================================================
// 1. Get Previous Month's Closing Balance
// ============================================================

/**
 * Get the closing balance from the previous month.
 * This becomes the opening balance for the current month.
 */
export async function getPreviousClosingBalance(
  orgUnitId: number,
  month: number,
  year: number
): Promise<number> {
  if (month === 1) {
    // For January, get December of previous year
    return getPreviousYearClosingBalance(orgUnitId, year);
  }

  // For other months, get previous month's closing
  const prevMonthBalance = await db.monthlyBalance.findUnique({
    where: {
      orgUnitId_month_year: {
        orgUnitId,
        month: month - 1,
        year,
      },
    },
    select: { closingBalance: true },
  });

  if (prevMonthBalance) {
    return prevMonthBalance.closingBalance;
  }

  // If not found, calculate it
  const monthlyData = await calculateMonthlyBalance(orgUnitId, month - 1, year);
  return monthlyData.closingBalance;
}

// ============================================================
// 2. Get Previous Year's Closing Balance
// ============================================================

/**
 * Get December closing balance from the previous year.
 */
export async function getPreviousYearClosingBalance(
  orgUnitId: number,
  year: number
): Promise<number> {
  const prevYearDecember = await db.monthlyBalance.findUnique({
    where: {
      orgUnitId_month_year: {
        orgUnitId,
        month: 12,
        year: year - 1,
      },
    },
    select: { closingBalance: true },
  });

  if (prevYearDecember) {
    return prevYearDecember.closingBalance;
  }

  // If not found, calculate
  const monthlyData = await calculateMonthlyBalance(orgUnitId, 12, year - 1);
  return monthlyData.closingBalance;
}

// ============================================================
// 3. Carry Forward Balance to New Month
// ============================================================

/**
 * Create a new month by carrying forward the previous closing balance
 * as the opening balance for the new month.
 *
 * This is automatically called when a new month needs to be created.
 */
export async function carryForwardBalance(
  orgUnitId: number,
  newMonth: number,
  year: number,
  userId?: number
): Promise<CarryForwardResult> {
  try {
    // Get previous month's closing balance
    const previousClosing = await getPreviousClosingBalance(orgUnitId, newMonth, year);

    // Create the new month with carried forward opening balance
    const newMonthBalance = await calculateMonthlyBalance(orgUnitId, newMonth, year);

    // Save the month with carried opening balance
    await saveMonthlyBalance(
      {
        ...newMonthBalance,
        openingBalance: previousClosing,
      },
      userId,
      `Automatically carried forward from previous month`
    );

    return {
      orgUnitId,
      month: newMonth,
      year,
      previousClosingBalance: previousClosing,
      newOpeningBalance: previousClosing,
      success: true,
      message: `Balance successfully carried forward. New opening balance: ${previousClosing}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      orgUnitId,
      month: newMonth,
      year,
      previousClosingBalance: 0,
      newOpeningBalance: 0,
      success: false,
      message: `Failed to carry forward balance: ${errorMessage}`,
    };
  }
}

// ============================================================
// 4. Ensure Month Exists (Create if needed)
// ============================================================

/**
 * Ensure that a specific month exists with proper opening balance.
 * If it doesn't exist, create it with carried-forward balance.
 */
export async function ensureMonthExists(
  orgUnitId: number,
  month: number,
  year: number,
  userId?: number
): Promise<CarryForwardResult> {
  // Check if month already exists
  const existingMonth = await db.monthlyBalance.findUnique({
    where: {
      orgUnitId_month_year: {
        orgUnitId,
        month,
        year,
      },
    },
  });

  if (existingMonth) {
    return {
      orgUnitId,
      month,
      year,
      previousClosingBalance: existingMonth.openingBalance,
      newOpeningBalance: existingMonth.openingBalance,
      success: true,
      message: `Month already exists`,
    };
  }

  // Create the month by carrying forward
  return carryForwardBalance(orgUnitId, month, year, userId);
}

// ============================================================
// 5. Ensure Full Year Exists
// ============================================================

/**
 * Ensure all 12 months exist for a given year.
 * Creates any missing months with proper carry-forward.
 */
export async function ensureFullYearExists(
  orgUnitId: number,
  year: number,
  userId?: number
): Promise<CarryForwardResult[]> {
  const results: CarryForwardResult[] = [];

  for (let month = 1; month <= 12; month++) {
    const result = await ensureMonthExists(orgUnitId, month, year, userId);
    results.push(result);
  }

  return results;
}

// ============================================================
// 6. Auto-Create Next Month When Current Month Ends
// ============================================================

/**
 * Called when a month is closed/finalized.
 * Automatically creates the next month with carried-forward balance.
 */
export async function createNextMonth(
  orgUnitId: number,
  currentMonth: number,
  currentYear: number,
  userId?: number
): Promise<CarryForwardResult> {
  let nextMonth = currentMonth + 1;
  let nextYear = currentYear;

  // If we're in December, create January of next year
  if (currentMonth === 12) {
    nextMonth = 1;
    nextYear = currentYear + 1;
  }

  return ensureMonthExists(orgUnitId, nextMonth, nextYear, userId);
}

// ============================================================
// 7. Get All Org Units' Next Month Requirement
// ============================================================

/**
 * Get list of org units that need their next month created.
 * Useful for batch operations at month-end.
 */
export async function getOrgUnitsNeedingNextMonth(
  month: number,
  year: number
): Promise<number[]> {
  // Get all org units
  const allOrgUnits = await db.orgUnit.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  const needingNextMonth: number[] = [];

  for (const orgUnit of allOrgUnits) {
    // Check if current month exists
    const currentExists = await db.monthlyBalance.findUnique({
      where: {
        orgUnitId_month_year: {
          orgUnitId: orgUnit.id,
          month,
          year,
        },
      },
      select: { id: true },
    });

    // Check if next month already exists
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;

    const nextExists = await db.monthlyBalance.findUnique({
      where: {
        orgUnitId_month_year: {
          orgUnitId: orgUnit.id,
          month: nextMonth,
          year: nextYear,
        },
      },
      select: { id: true },
    });

    // If current exists but next doesn't, add to list
    if (currentExists && !nextExists) {
      needingNextMonth.push(orgUnit.id);
    }
  }

  return needingNextMonth;
}

// ============================================================
// 8. Batch Create Next Months
// ============================================================

/**
 * Batch create next months for all org units that need them.
 * Called during monthly finalization process.
 */
export async function batchCreateNextMonths(
  month: number,
  year: number,
  userId?: number
): Promise<{ successful: number; failed: number; errors: string[] }> {
  const orgUnitIds = await getOrgUnitsNeedingNextMonth(month, year);

  let successful = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const orgUnitId of orgUnitIds) {
    try {
      const result = await createNextMonth(orgUnitId, month, year, userId);

      if (result.success) {
        successful++;
      } else {
        failed++;
        errors.push(`Org ${orgUnitId}: ${result.message}`);
      }
    } catch (error) {
      failed++;
      errors.push(`Org ${orgUnitId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return { successful, failed, errors };
}
