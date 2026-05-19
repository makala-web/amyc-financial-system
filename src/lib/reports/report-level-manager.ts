// ============================================================
// AMYC Financial Management System - Report Level Manager
// Unified interface for Branch, Regional, and Markaz reports
// ============================================================

import { db } from '@/lib/db';
import {
  calculateMonthlyBalance,
  saveMonthlyBalance,
  type MonthlyBalanceData,
} from '@/lib/finance/balance-engine';
import {
  consolidateRegionalMonth,
  saveRegionalReport,
  type RegionalConsolidationData,
} from '@/lib/consolidation/region-consolidator';
import {
  consolidateMarkazMonth,
  saveMarkazReport,
  type MarkazConsolidationData,
} from '@/lib/consolidation/markaz-consolidator';

// ============================================================
// Types
// ============================================================

export type ReportLevel = 'branch' | 'regional' | 'markaz';

export interface UnifiedReportData {
  level: ReportLevel;
  unitId: number;
  unitName: string;
  month: number;
  year: number;
  childCount?: number;
  openingBalance: number;
  totalIncome: number;
  totalExpense: number;
  closingBalance: number;
  carryForward: number;
  incomeByCategory?: Record<string, number>;
  expenseByCategory?: Record<string, number>;
}

export interface ReportGenerationResult {
  level: ReportLevel;
  success: boolean;
  message: string;
  data?: UnifiedReportData;
}

// ============================================================
// 1. Determine Report Level for Org Unit
// ============================================================

/**
 * Determine the report level (branch/regional/markaz) based on org unit type.
 */
export async function determineReportLevel(unitId: number): Promise<ReportLevel> {
  const orgUnit = await db.orgUnit.findUnique({
    where: { id: unitId },
    select: { type: true },
  });

  if (!orgUnit) {
    throw new Error(`Organization unit ${unitId} not found`);
  }

  switch (orgUnit.type) {
    case 'tawi':
      return 'branch';
    case 'jimbo':
      return 'regional';
    case 'markaz':
      return 'markaz';
    default:
      throw new Error(`Unknown org unit type: ${orgUnit.type}`);
  }
}

// ============================================================
// 2. Generate Report for Any Level
// ============================================================

/**
 * Generate a report for any level (branch, regional, or markaz).
 * Automatically determines the level and generates the appropriate report.
 */
export async function generateReport(
  unitId: number,
  month: number,
  year: number,
  userId?: number
): Promise<ReportGenerationResult> {
  try {
    const level = await determineReportLevel(unitId);

    switch (level) {
      case 'branch':
        return await generateBranchReport(unitId, month, year, userId);
      case 'regional':
        return await generateRegionalReport(unitId, month, year, userId);
      case 'markaz':
        return await generateMarkazReport(unitId, month, year, userId);
      default:
        return {
          level,
          success: false,
          message: `Unknown report level: ${level}`,
        };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return {
      level: 'branch', // Default
      success: false,
      message: `Report generation failed: ${errorMsg}`,
    };
  }
}

// ============================================================
// 3. Generate Branch Report (Existing Logic Wrapped)
// ============================================================

/**
 * Generate a branch report - calculates monthly balance for a branch (tawi).
 */
export async function generateBranchReport(
  branchId: number,
  month: number,
  year: number,
  userId?: number
): Promise<ReportGenerationResult> {
  try {
    // Verify it's a branch
    const orgUnit = await db.orgUnit.findUnique({
      where: { id: branchId },
    });

    if (!orgUnit || orgUnit.type !== 'tawi') {
      throw new Error(`Unit ${branchId} is not a branch (tawi)`);
    }

    // Calculate monthly balance
    const monthlyData = await calculateMonthlyBalance(branchId, month, year);

    // Save to database
    await saveMonthlyBalance(monthlyData, userId, `Branch report generated for ${month}/${year}`);

    return {
      level: 'branch',
      success: true,
      message: `Branch report generated successfully`,
      data: {
        level: 'branch',
        unitId: branchId,
        unitName: orgUnit.name,
        month,
        year,
        openingBalance: monthlyData.openingBalance,
        totalIncome: monthlyData.totalIncome,
        totalExpense: monthlyData.totalExpense,
        closingBalance: monthlyData.closingBalance,
        carryForward: monthlyData.carryForward,
      },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return {
      level: 'branch',
      success: false,
      message: `Branch report generation failed: ${errorMsg}`,
    };
  }
}

// ============================================================
// 4. Generate Regional Report
// ============================================================

/**
 * Generate a regional report - consolidates all branches in a region (jimbo).
 */
export async function generateRegionalReport(
  regionId: number,
  month: number,
  year: number,
  userId?: number
): Promise<ReportGenerationResult> {
  try {
    // Verify it's a region
    const orgUnit = await db.orgUnit.findUnique({
      where: { id: regionId },
    });

    if (!orgUnit || orgUnit.type !== 'jimbo') {
      throw new Error(`Unit ${regionId} is not a region (jimbo)`);
    }

    // Consolidate regional data
    const consolidation = await consolidateRegionalMonth(regionId, month, year);

    // Save to database
    await saveRegionalReport(consolidation, userId, `Regional report generated for ${month}/${year}`);

    return {
      level: 'regional',
      success: true,
      message: `Regional report generated successfully`,
      data: {
        level: 'regional',
        unitId: regionId,
        unitName: orgUnit.name,
        month,
        year,
        childCount: consolidation.branchCount,
        openingBalance: consolidation.openingBalance,
        totalIncome: consolidation.totalIncome,
        totalExpense: consolidation.totalExpense,
        closingBalance: consolidation.closingBalance,
        carryForward: consolidation.carryForward,
        incomeByCategory: consolidation.incomeByCategory,
        expenseByCategory: consolidation.expenseByCategory,
      },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return {
      level: 'regional',
      success: false,
      message: `Regional report generation failed: ${errorMsg}`,
    };
  }
}

// ============================================================
// 5. Generate Markaz Report
// ============================================================

/**
 * Generate a markaz report - consolidates all regions (jimbo) into a national summary.
 */
export async function generateMarkazReport(
  markazId: number,
  month: number,
  year: number,
  userId?: number
): Promise<ReportGenerationResult> {
  try {
    // Verify it's a markaz
    const orgUnit = await db.orgUnit.findUnique({
      where: { id: markazId },
    });

    if (!orgUnit || orgUnit.type !== 'markaz') {
      throw new Error(`Unit ${markazId} is not markaz (headquarters)`);
    }

    // Consolidate markaz data
    const consolidation = await consolidateMarkazMonth(markazId, month, year);

    // Save to database
    await saveMarkazReport(consolidation, userId, `Markaz report generated for ${month}/${year}`);

    return {
      level: 'markaz',
      success: true,
      message: `Markaz report generated successfully`,
      data: {
        level: 'markaz',
        unitId: markazId,
        unitName: orgUnit.name,
        month,
        year,
        childCount: consolidation.regionCount,
        openingBalance: consolidation.openingBalance,
        totalIncome: consolidation.totalIncome,
        totalExpense: consolidation.totalExpense,
        closingBalance: consolidation.closingBalance,
        carryForward: consolidation.carryForward,
        incomeByCategory: consolidation.incomeByCategory,
        expenseByCategory: consolidation.expenseByCategory,
      },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return {
      level: 'markaz',
      success: false,
      message: `Markaz report generation failed: ${errorMsg}`,
    };
  }
}

// ============================================================
// 6. Get Existing Report
// ============================================================

/**
 * Get an existing report from database for any level.
 */
export async function getReport(
  unitId: number,
  month: number,
  year: number
): Promise<UnifiedReportData | null> {
  try {
    const level = await determineReportLevel(unitId);
    const orgUnit = await db.orgUnit.findUnique({
      where: { id: unitId },
      select: { name: true },
    });

    switch (level) {
      case 'branch': {
        const balance = await db.monthlyBalance.findUnique({
          where: {
            orgUnitId_month_year: { orgUnitId: unitId, month, year },
          },
        });

        if (!balance) return null;

        return {
          level: 'branch',
          unitId,
          unitName: orgUnit?.name || '',
          month,
          year,
          openingBalance: balance.openingBalance,
          totalIncome: balance.totalIncome,
          totalExpense: balance.totalExpense,
          closingBalance: balance.closingBalance,
          carryForward: balance.carryForward || 0,
        };
      }

      case 'regional': {
        const report = await db.regionalReport.findUnique({
          where: {
            regionId_month_year: { regionId: unitId, month, year },
          },
        });

        if (!report) return null;

        return {
          level: 'regional',
          unitId,
          unitName: orgUnit?.name || '',
          month,
          year,
          childCount: report.branchCount,
          openingBalance: report.openingBalance,
          totalIncome: report.totalIncome,
          totalExpense: report.totalExpense,
          closingBalance: report.closingBalance,
          carryForward: report.carryForward || 0,
          incomeByCategory: report.incomeBreakdown ? JSON.parse(report.incomeBreakdown) : {},
          expenseByCategory: report.expenseBreakdown ? JSON.parse(report.expenseBreakdown) : {},
        };
      }

      case 'markaz': {
        const report = await db.markazReport.findUnique({
          where: {
            markazId_month_year: { markazId: unitId, month, year },
          },
        });

        if (!report) return null;

        return {
          level: 'markaz',
          unitId,
          unitName: orgUnit?.name || '',
          month,
          year,
          childCount: report.regionCount,
          openingBalance: report.openingBalance,
          totalIncome: report.totalIncome,
          totalExpense: report.totalExpense,
          closingBalance: report.closingBalance,
          carryForward: report.carryForward || 0,
          incomeByCategory: report.incomeBreakdown ? JSON.parse(report.incomeBreakdown) : {},
          expenseByCategory: report.expenseBreakdown ? JSON.parse(report.expenseBreakdown) : {},
        };
      }

      default:
        return null;
    }
  } catch (error) {
    console.error(`Error getting report:`, error);
    return null;
  }
}

// ============================================================
// 7. Batch Generate All Reports for Month (Full Consolidation Flow)
// ============================================================

/**
 * Generate all reports for a month in proper order:
 * 1. Branch reports (if not already calculated)
 * 2. Regional consolidations (aggregates branches)
 * 3. Markaz consolidations (aggregates regions)
 *
 * This is the primary entry point for monthly report generation.
 */
export async function generateAllReportsForMonth(
  month: number,
  year: number,
  userId?: number
): Promise<{
  month: number;
  year: number;
  results: {
    branchReports: { successful: number; failed: number; message: string };
    regionalReports: { successful: number; failed: number; message: string };
    markazReports: { successful: number; failed: number; message: string };
    totalSuccess: boolean;
    errors: string[];
  };
}> {
  const errors: string[] = [];
  if (process.env.ALLOW_CROSS_LEVEL_AUTO_SYNC !== 'true') {
    return {
      month,
      year,
      results: {
        branchReports: { successful: 0, failed: 0, message: 'Skipped by offline-first policy' },
        regionalReports: { successful: 0, failed: 0, message: 'Skipped by offline-first policy' },
        markazReports: { successful: 0, failed: 0, message: 'Skipped by offline-first policy' },
        totalSuccess: false,
        errors: [
          'Automatic cross-level consolidation is disabled. Use Excel export/import flow between Tawi -> Jimbo -> Markaz.',
        ],
      },
    };
  }
  let branchSuccess = 0;
  let branchFailed = 0;
  let regionalSuccess = 0;
  let regionalFailed = 0;
  let markazSuccess = 0;
  let markazFailed = 0;

  try {
    // Step 1: Generate/ensure all branch reports exist
    const branches = await db.orgUnit.findMany({
      where: { type: 'tawi', isActive: true },
      select: { id: true },
    });

    for (const branch of branches) {
      try {
        await generateBranchReport(branch.id, month, year, userId);
        branchSuccess++;
      } catch (error) {
        branchFailed++;
        errors.push(`Branch ${branch.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Step 2: Generate regional consolidations (depends on branch reports)
    const regions = await db.orgUnit.findMany({
      where: { type: 'jimbo', isActive: true },
      select: { id: true },
    });

    for (const region of regions) {
      try {
        await generateRegionalReport(region.id, month, year, userId);
        regionalSuccess++;
      } catch (error) {
        regionalFailed++;
        errors.push(`Region ${region.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Step 3: Generate markaz consolidations (depends on regional reports)
    const markazUnits = await db.orgUnit.findMany({
      where: { type: 'markaz', isActive: true },
      select: { id: true },
    });

    for (const markaz of markazUnits) {
      try {
        await generateMarkazReport(markaz.id, month, year, userId);
        markazSuccess++;
      } catch (error) {
        markazFailed++;
        errors.push(`Markaz ${markaz.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return {
      month,
      year,
      results: {
        branchReports: {
          successful: branchSuccess,
          failed: branchFailed,
          message: `Generated ${branchSuccess} branch reports${branchFailed > 0 ? `, ${branchFailed} failed` : ''}`,
        },
        regionalReports: {
          successful: regionalSuccess,
          failed: regionalFailed,
          message: `Generated ${regionalSuccess} regional reports${regionalFailed > 0 ? `, ${regionalFailed} failed` : ''}`,
        },
        markazReports: {
          successful: markazSuccess,
          failed: markazFailed,
          message: `Generated ${markazSuccess} markaz reports${markazFailed > 0 ? `, ${markazFailed} failed` : ''}`,
        },
        totalSuccess: branchFailed === 0 && regionalFailed === 0 && markazFailed === 0,
        errors,
      },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    errors.push(`Fatal error: ${errorMsg}`);

    return {
      month,
      year,
      results: {
        branchReports: {
          successful: branchSuccess,
          failed: branchFailed,
          message: `Partial - ${branchSuccess} successful`,
        },
        regionalReports: {
          successful: regionalSuccess,
          failed: regionalFailed,
          message: `Partial - ${regionalSuccess} successful`,
        },
        markazReports: {
          successful: markazSuccess,
          failed: markazFailed,
          message: `Partial - ${markazSuccess} successful`,
        },
        totalSuccess: false,
        errors,
      },
    };
  }
}
