// ============================================================
// AMYC Financial Management System - Regional Consolidator
// Consolidates all branches (tawi) in a region (jimbo)
// ============================================================

import { db } from '@/lib/db';
import { calculateMonthlyBalance } from '@/lib/finance/balance-engine';

// ============================================================
// Types
// ============================================================

export interface RegionalConsolidationData {
  regionId: number;
  regionName: string;
  month: number;
  year: number;
  branchCount: number;
  openingBalance: number;
  totalIncome: number;
  totalExpense: number;
  closingBalance: number;
  carryForward: number;
  incomeByCategory: Record<string, number>;
  expenseByCategory: Record<string, number>;
  branches: Array<{
    branchId: number;
    branchName: string;
    income: number;
    expense: number;
    balance: number;
  }>;
}

// ============================================================
// 1. Get All Branches in a Region
// ============================================================

/**
 * Get all active branches (tawi) that belong to a region (jimbo).
 */
export async function getRegionBranches(regionId: number): Promise<any[]> {
  const region = await db.orgUnit.findUnique({
    where: { id: regionId },
  });

  if (!region || region.type !== 'jimbo') {
    throw new Error(`Invalid region ID or region is not of type 'jimbo'`);
  }

  const branches = await db.orgUnit.findMany({
    where: {
      parentId: regionId,
      type: 'tawi',
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      code: true,
    },
    orderBy: { name: 'asc' },
  });

  return branches;
}

// ============================================================
// 2. Calculate Regional Monthly Summary
// ============================================================

/**
 * Sum all branch transactions for a region for a specific month.
 * Returns aggregated income, expense, and balance without branch details.
 */
export async function calculateRegionalMonthlyData(
  regionId: number,
  month: number,
  year: number
): Promise<{
  totalIncome: number;
  totalExpense: number;
  incomeByCategory: Record<string, number>;
  expenseByCategory: Record<string, number>;
}> {
  // Get all branches in region
  const branches = await getRegionBranches(regionId);
  const branchIds = branches.map((b) => b.id);

  // Get all transactions for this month from all branches
  const transactions = await db.transaction.findMany({
    where: {
      orgUnitId: { in: branchIds },
      month,
      year,
      isOpening: false,
    },
    include: {
      category: true,
    },
  });

  // Aggregate by type
  let totalIncome = 0;
  let totalExpense = 0;
  const incomeByCategory: Record<string, number> = {};
  const expenseByCategory: Record<string, number> = {};

  for (const transaction of transactions) {
    const categoryKey = transaction.categoryName || transaction.category?.name || 'Uncategorized';

    if (transaction.type === 'income') {
      totalIncome += transaction.amount;
      incomeByCategory[categoryKey] = (incomeByCategory[categoryKey] || 0) + transaction.amount;
    } else if (transaction.type === 'expense') {
      totalExpense += transaction.amount;
      expenseByCategory[categoryKey] = (expenseByCategory[categoryKey] || 0) + transaction.amount;
    }
  }

  return {
    totalIncome,
    totalExpense,
    incomeByCategory,
    expenseByCategory,
  };
}

// ============================================================
// 3. Calculate Opening Balance for Region
// ============================================================

/**
 * Calculate regional opening balance = sum of all branches' opening balances.
 */
export async function calculateRegionalOpeningBalance(
  regionId: number,
  month: number,
  year: number
): Promise<number> {
  const branches = await getRegionBranches(regionId);
  const branchIds = branches.map((b) => b.id);

  // Get or calculate opening balance for each branch
  let totalOpening = 0;

  for (const branchId of branchIds) {
    const branchBalance = await db.monthlyBalance.findUnique({
      where: {
        orgUnitId_month_year: {
          orgUnitId: branchId,
          month,
          year,
        },
      },
      select: { openingBalance: true },
    });

    if (branchBalance) {
      totalOpening += branchBalance.openingBalance;
    } else {
      // Calculate it
      const monthlyData = await calculateMonthlyBalance(branchId, month, year);
      totalOpening += monthlyData.openingBalance;
    }
  }

  return totalOpening;
}

// ============================================================
// 4. Consolidate Regional Month Report
// ============================================================

/**
 * Create a complete regional consolidation for a month.
 * Aggregates all branches into a single regional summary.
 *
 * NOTE: This does NOT include branch names or details - only totals.
 */
export async function consolidateRegionalMonth(
  regionId: number,
  month: number,
  year: number
): Promise<RegionalConsolidationData> {
  // Get region info
  const region = await db.orgUnit.findUnique({
    where: { id: regionId },
  });

  if (!region) {
    throw new Error(`Region ${regionId} not found`);
  }

  // Get branches
  const branches = await getRegionBranches(regionId);

  // Calculate regional data
  const { totalIncome, totalExpense, incomeByCategory, expenseByCategory } =
    await calculateRegionalMonthlyData(regionId, month, year);

  // Calculate opening balance
  const openingBalance = await calculateRegionalOpeningBalance(regionId, month, year);

  // Calculate closing balance
  const closingBalance = openingBalance + totalIncome - totalExpense;

  // Carry forward = closing balance
  const carryForward = closingBalance;

  // Get branch details (for reference, but not included in final report output)
  const branchDetails = await Promise.all(
    branches.map(async (branch) => {
      const branchMonth = await calculateMonthlyBalance(branch.id, month, year);
      return {
        branchId: branch.id,
        branchName: branch.name,
        income: branchMonth.totalIncome,
        expense: branchMonth.totalExpense,
        balance: branchMonth.closingBalance - branchMonth.openingBalance,
      };
    })
  );

  return {
    regionId,
    regionName: region.name,
    month,
    year,
    branchCount: branches.length,
    openingBalance,
    totalIncome,
    totalExpense,
    closingBalance,
    carryForward,
    incomeByCategory,
    expenseByCategory,
    branches: branchDetails, // Included for internal reference, but should not be shown in UI
  };
}

// ============================================================
// 5. Save Regional Report to Database
// ============================================================

/**
 * Save consolidated regional report to database.
 */
export async function saveRegionalReport(
  consolidation: RegionalConsolidationData,
  userId?: number,
  notes?: string
): Promise<void> {
  try {
    await db.regionalReport.upsert({
      where: {
        regionId_month_year: {
          regionId: consolidation.regionId,
          month: consolidation.month,
          year: consolidation.year,
        },
      },
      update: {
        openingBalance: consolidation.openingBalance,
        totalIncome: consolidation.totalIncome,
        totalExpense: consolidation.totalExpense,
        closingBalance: consolidation.closingBalance,
        carryForward: consolidation.carryForward,
        branchCount: consolidation.branchCount,
        incomeBreakdown: JSON.stringify(consolidation.incomeByCategory),
        expenseBreakdown: JSON.stringify(consolidation.expenseByCategory),
        generatedBy: userId,
        generatedAt: new Date(),
        notes,
      },
      create: {
        regionId: consolidation.regionId,
        month: consolidation.month,
        year: consolidation.year,
        openingBalance: consolidation.openingBalance,
        totalIncome: consolidation.totalIncome,
        totalExpense: consolidation.totalExpense,
        closingBalance: consolidation.closingBalance,
        carryForward: consolidation.carryForward,
        branchCount: consolidation.branchCount,
        incomeBreakdown: JSON.stringify(consolidation.incomeByCategory),
        expenseBreakdown: JSON.stringify(consolidation.expenseByCategory),
        generatedBy: userId,
        notes,
      },
    });

    console.log(
      `Saved regional report for region ${consolidation.regionId}, ${consolidation.month}/${consolidation.year}`
    );
  } catch (error) {
    console.error(`Error saving regional report:`, error);
    throw error;
  }
}

// ============================================================
// 6. Get or Create Regional Report
// ============================================================

/**
 * Get regional report from database, or generate and save if not found.
 */
export async function getOrCreateRegionalReport(
  regionId: number,
  month: number,
  year: number,
  userId?: number
): Promise<RegionalConsolidationData> {
  // Check if exists in database
  const stored = await db.regionalReport.findUnique({
    where: {
      regionId_month_year: {
        regionId,
        month,
        year,
      },
    },
  });

  if (stored) {
    return {
      regionId: stored.regionId,
      regionName: (await db.orgUnit.findUnique({ where: { id: regionId }, select: { name: true } }))?.name || '',
      month: stored.month,
      year: stored.year,
      branchCount: stored.branchCount,
      openingBalance: stored.openingBalance,
      totalIncome: stored.totalIncome,
      totalExpense: stored.totalExpense,
      closingBalance: stored.closingBalance,
      carryForward: stored.carryForward || 0,
      incomeByCategory: stored.incomeBreakdown ? JSON.parse(stored.incomeBreakdown) : {},
      expenseByCategory: stored.expenseBreakdown ? JSON.parse(stored.expenseBreakdown) : {},
      branches: [],
    };
  }

  // Generate and save
  const consolidation = await consolidateRegionalMonth(regionId, month, year);
  await saveRegionalReport(consolidation, userId);

  return consolidation;
}

// ============================================================
// 7. Consolidate Multiple Regions (Batch)
// ============================================================

/**
 * Generate regional reports for all regions in a given month/year.
 */
export async function consolidateAllRegions(
  month: number,
  year: number,
  userId?: number
): Promise<{
  successful: number;
  failed: number;
  errors: string[];
}> {
  // Get all regions (jimbo)
  const regions = await db.orgUnit.findMany({
    where: {
      type: 'jimbo',
      isActive: true,
    },
    select: { id: true },
  });

  let successful = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const region of regions) {
    try {
      const consolidation = await consolidateRegionalMonth(region.id, month, year);
      await saveRegionalReport(consolidation, userId, `Auto-generated for ${month}/${year}`);
      successful++;
    } catch (error) {
      failed++;
      errors.push(`Region ${region.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return { successful, failed, errors };
}
