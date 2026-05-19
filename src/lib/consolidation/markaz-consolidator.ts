// ============================================================
// AMYC Financial Management System - Markaz Consolidator
// Consolidates all regions (jimbo) into a national summary (markaz)
// ============================================================

import { db } from '@/lib/db';

// ============================================================
// Types
// ============================================================

export interface MarkazConsolidationData {
  markazId: number;
  markazName: string;
  month: number;
  year: number;
  regionCount: number;
  openingBalance: number;
  totalIncome: number;
  totalExpense: number;
  closingBalance: number;
  carryForward: number;
  incomeByCategory: Record<string, number>;
  expenseByCategory: Record<string, number>;
  regions: Array<{
    regionId: number;
    regionName: string;
    income: number;
    expense: number;
    balance: number;
  }>;
}

// ============================================================
// 1. Get All Regions Under Markaz
// ============================================================

/**
 * Get all active regions (jimbo) that belong to markaz (headquarters).
 */
export async function getMarkazRegions(markazId: number): Promise<any[]> {
  const markaz = await db.orgUnit.findUnique({
    where: { id: markazId },
  });

  if (!markaz || markaz.type !== 'markaz') {
    throw new Error(`Invalid Markaz ID or unit is not of type 'markaz'`);
  }

  const regions = await db.orgUnit.findMany({
    where: {
      parentId: markazId,
      type: 'jimbo',
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      code: true,
    },
    orderBy: { name: 'asc' },
  });

  return regions;
}

// ============================================================
// 2. Calculate Regional Summaries for Markaz
// ============================================================

/**
 * Get income and expense summaries from all regions.
 * This aggregates only the regional report data (not raw branch data).
 */
export async function calculateMarkazMonthlyData(
  markazId: number,
  month: number,
  year: number
): Promise<{
  totalIncome: number;
  totalExpense: number;
  incomeByCategory: Record<string, number>;
  expenseByCategory: Record<string, number>;
}> {
  // Get all regions
  const regions = await getMarkazRegions(markazId);
  const regionIds = regions.map((r) => r.id);

  let totalIncome = 0;
  let totalExpense = 0;
  const incomeByCategory: Record<string, number> = {};
  const expenseByCategory: Record<string, number> = {};

  // Get regional reports (not raw transactions)
  // This ensures we're aggregating from regional summaries only
  const regionalReports = await db.regionalReport.findMany({
    where: {
      regionId: { in: regionIds },
      month,
      year,
    },
  });

  for (const report of regionalReports) {
    totalIncome += report.totalIncome;
    totalExpense += report.totalExpense;

    // Parse and merge category breakdowns
    if (report.incomeBreakdown) {
      try {
        const income = JSON.parse(report.incomeBreakdown);
        for (const [category, amount] of Object.entries(income)) {
          incomeByCategory[category] = (incomeByCategory[category] || 0) + (amount as number);
        }
      } catch (e) {
        console.warn(`Failed to parse income breakdown for region ${report.regionId}`);
      }
    }

    if (report.expenseBreakdown) {
      try {
        const expense = JSON.parse(report.expenseBreakdown);
        for (const [category, amount] of Object.entries(expense)) {
          expenseByCategory[category] = (expenseByCategory[category] || 0) + (amount as number);
        }
      } catch (e) {
        console.warn(`Failed to parse expense breakdown for region ${report.regionId}`);
      }
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
// 3. Calculate Markaz Opening Balance
// ============================================================

/**
 * Calculate markaz opening balance = sum of all regional opening balances.
 */
export async function calculateMarkazOpeningBalance(
  markazId: number,
  month: number,
  year: number
): Promise<number> {
  const regions = await getMarkazRegions(markazId);
  const regionIds = regions.map((r) => r.id);

  let totalOpening = 0;

  // Get opening balances from regional reports
  const regionalReports = await db.regionalReport.findMany({
    where: {
      regionId: { in: regionIds },
      month,
      year,
    },
    select: { openingBalance: true },
  });

  for (const report of regionalReports) {
    totalOpening += report.openingBalance;
  }

  return totalOpening;
}

// ============================================================
// 4. Consolidate Markaz Monthly Report
// ============================================================

/**
 * Create a complete markaz (national) consolidation for a month.
 * Aggregates all regional summaries into a single national summary.
 *
 * NOTE: This aggregates ONLY from regional reports, not raw branch data.
 *       This maintains the hierarchical consolidation structure.
 */
export async function consolidateMarkazMonth(
  markazId: number,
  month: number,
  year: number
): Promise<MarkazConsolidationData> {
  // Get markaz info
  const markaz = await db.orgUnit.findUnique({
    where: { id: markazId },
  });

  if (!markaz) {
    throw new Error(`Markaz ${markazId} not found`);
  }

  // Get regions
  const regions = await getMarkazRegions(markazId);

  // Calculate markaz data from regional reports
  const { totalIncome, totalExpense, incomeByCategory, expenseByCategory } =
    await calculateMarkazMonthlyData(markazId, month, year);

  // Calculate opening balance
  const openingBalance = await calculateMarkazOpeningBalance(markazId, month, year);

  // Calculate closing balance
  const closingBalance = openingBalance + totalIncome - totalExpense;

  // Carry forward = closing balance
  const carryForward = closingBalance;

  // Get regional details from reports (for reference)
  const regionDetails = await Promise.all(
    regions.map(async (region) => {
      const regionalReport = await db.regionalReport.findUnique({
        where: {
          regionId_month_year: {
            regionId: region.id,
            month,
            year,
          },
        },
      });

      if (regionalReport) {
        return {
          regionId: region.id,
          regionName: region.name,
          income: regionalReport.totalIncome,
          expense: regionalReport.totalExpense,
          balance: regionalReport.closingBalance - regionalReport.openingBalance,
        };
      } else {
        // If regional report doesn't exist yet, return zeros
        return {
          regionId: region.id,
          regionName: region.name,
          income: 0,
          expense: 0,
          balance: 0,
        };
      }
    })
  );

  return {
    markazId,
    markazName: markaz.name,
    month,
    year,
    regionCount: regions.length,
    openingBalance,
    totalIncome,
    totalExpense,
    closingBalance,
    carryForward,
    incomeByCategory,
    expenseByCategory,
    regions: regionDetails, // Included for internal reference, but should not be shown in UI
  };
}

// ============================================================
// 5. Save Markaz Report to Database
// ============================================================

/**
 * Save consolidated markaz report to database.
 */
export async function saveMarkazReport(
  consolidation: MarkazConsolidationData,
  userId?: number,
  notes?: string
): Promise<void> {
  try {
    await db.markazReport.upsert({
      where: {
        markazId_month_year: {
          markazId: consolidation.markazId,
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
        regionCount: consolidation.regionCount,
        incomeBreakdown: JSON.stringify(consolidation.incomeByCategory),
        expenseBreakdown: JSON.stringify(consolidation.expenseByCategory),
        generatedBy: userId,
        generatedAt: new Date(),
        notes,
      },
      create: {
        markazId: consolidation.markazId,
        month: consolidation.month,
        year: consolidation.year,
        openingBalance: consolidation.openingBalance,
        totalIncome: consolidation.totalIncome,
        totalExpense: consolidation.totalExpense,
        closingBalance: consolidation.closingBalance,
        carryForward: consolidation.carryForward,
        regionCount: consolidation.regionCount,
        incomeBreakdown: JSON.stringify(consolidation.incomeByCategory),
        expenseBreakdown: JSON.stringify(consolidation.expenseByCategory),
        generatedBy: userId,
        notes,
      },
    });

    console.log(`Saved markaz report for ${consolidation.markazId}, ${consolidation.month}/${consolidation.year}`);
  } catch (error) {
    console.error(`Error saving markaz report:`, error);
    throw error;
  }
}

// ============================================================
// 6. Get or Create Markaz Report
// ============================================================

/**
 * Get markaz report from database, or generate and save if not found.
 */
export async function getOrCreateMarkazReport(
  markazId: number,
  month: number,
  year: number,
  userId?: number
): Promise<MarkazConsolidationData> {
  // Check if exists in database
  const stored = await db.markazReport.findUnique({
    where: {
      markazId_month_year: {
        markazId,
        month,
        year,
      },
    },
  });

  if (stored) {
    return {
      markazId: stored.markazId,
      markazName: (await db.orgUnit.findUnique({ where: { id: markazId }, select: { name: true } }))?.name || '',
      month: stored.month,
      year: stored.year,
      regionCount: stored.regionCount,
      openingBalance: stored.openingBalance,
      totalIncome: stored.totalIncome,
      totalExpense: stored.totalExpense,
      closingBalance: stored.closingBalance,
      carryForward: stored.carryForward || 0,
      incomeByCategory: stored.incomeBreakdown ? JSON.parse(stored.incomeBreakdown) : {},
      expenseByCategory: stored.expenseBreakdown ? JSON.parse(stored.expenseBreakdown) : {},
      regions: [],
    };
  }

  // Generate and save
  const consolidation = await consolidateMarkazMonth(markazId, month, year);
  await saveMarkazReport(consolidation, userId);

  return consolidation;
}

// ============================================================
// 7. Get National Summary (All Markaz Combined)
// ============================================================

/**
 * Get national summary for a month/year (aggregates all markaz).
 * Useful for top-level dashboard and reports.
 */
export async function getNationalSummary(
  month: number,
  year: number
): Promise<{
  month: number;
  year: number;
  markazCount: number;
  totalOpeningBalance: number;
  totalIncome: number;
  totalExpense: number;
  totalClosingBalance: number;
  totalCarryForward: number;
  markazSummaries: Array<{
    markazId: number;
    markazName: string;
    openingBalance: number;
    income: number;
    expense: number;
    closingBalance: number;
  }>;
}> {
  // Get all markaz reports
  const markazReports = await db.markazReport.findMany({
    where: { month, year },
    include: {
      markaz: { select: { name: true } },
    },
  });

  let totalOpening = 0;
  let totalIncome = 0;
  let totalExpense = 0;
  let totalClosing = 0;
  let totalCarryForward = 0;

  const markazSummaries = markazReports.map((report) => {
    totalOpening += report.openingBalance;
    totalIncome += report.totalIncome;
    totalExpense += report.totalExpense;
    totalClosing += report.closingBalance;
    totalCarryForward += report.carryForward || 0;

    return {
      markazId: report.markazId,
      markazName: report.markaz.name,
      openingBalance: report.openingBalance,
      income: report.totalIncome,
      expense: report.totalExpense,
      closingBalance: report.closingBalance,
    };
  });

  return {
    month,
    year,
    markazCount: markazReports.length,
    totalOpeningBalance: totalOpening,
    totalIncome,
    totalExpense,
    totalClosingBalance: totalClosing,
    totalCarryForward,
    markazSummaries,
  };
}

// ============================================================
// 8. Generate All Markaz Reports (Batch)
// ============================================================

/**
 * Generate markaz reports for all markaz units in a given month/year.
 * Usually called after regional reports are generated.
 */
export async function consolidateAllMarkaz(
  month: number,
  year: number,
  userId?: number
): Promise<{
  successful: number;
  failed: number;
  errors: string[];
}> {
  // Get all markaz units
  const markazUnits = await db.orgUnit.findMany({
    where: {
      type: 'markaz',
      isActive: true,
    },
    select: { id: true },
  });

  let successful = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const markaz of markazUnits) {
    try {
      const consolidation = await consolidateMarkazMonth(markaz.id, month, year);
      await saveMarkazReport(consolidation, userId, `Auto-generated for ${month}/${year}`);
      successful++;
    } catch (error) {
      failed++;
      errors.push(`Markaz ${markaz.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return { successful, failed, errors };
}
