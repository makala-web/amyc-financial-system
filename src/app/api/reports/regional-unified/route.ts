// ============================================================
// AMYC Financial Management System - Regional Unified Report API
// GET: Generate unified regional report combining all branches
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { enforceRbac } from '@/lib/rbac';
import { assertStrongReportSignatureSalt } from '@/lib/reports/integrity';
import { calculateMonthlyBalance, calculateYearlyBalance } from '@/lib/finance/balance-engine';
import { buildAllDepartmentRows } from '@/lib/reports/department-rows';

const MONTH_NAMES = [
  'Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni',
  'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba',
];

export async function GET(request: NextRequest) {
  try {
    assertStrongReportSignatureSalt();
    const { searchParams } = new URL(request.url);
    const regionId = searchParams.get('regionId');
    const year = searchParams.get('year');
    const month = searchParams.get('month');

    if (!regionId || !year) {
      return NextResponse.json(
        { error: 'regionId at year zinazohitajika' },
        { status: 400 }
      );
    }

    const regId = parseInt(regionId);
    const yr = parseInt(year);
    const mo = month ? parseInt(month) : undefined;

    if (isNaN(regId) || isNaN(yr) || (mo !== undefined && isNaN(mo))) {
      return NextResponse.json({ error: 'Muundo wa regionId/year/month si sahihi' }, { status: 400 });
    }

    const rbac = await enforceRbac(request, { permission: 'view_data', targetOrgId: regId });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }

    // Get region details
    const region = await db.orgUnit.findUnique({
      where: { id: regId },
      select: { id: true, name: true, code: true, type: true, parentId: true },
    });

    if (!region || region.type !== 'jimbo') {
      return NextResponse.json(
        { error: 'Jimbo halipatikani' },
        { status: 404 }
      );
    }

    // Get all branches in this region
    const branches = await db.orgUnit.findMany({
      where: {
        parentId: regId,
        type: 'tawi',
      },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });

    // Calculate branch summaries with reliable monthly balances
    const branchRows = await Promise.all(
      branches.map(async (branch) => {
        const branchBalance = mo
          ? await calculateMonthlyBalance(branch.id, mo, yr)
          : await calculateYearlyBalance(branch.id, yr);

        return {
          branchId: branch.id,
          branchName: branch.name,
          branchCode: branch.code || '',
          openingBalance: branchBalance.openingBalance,
          income: branchBalance.totalIncome,
          expense: branchBalance.totalExpense,
          closingBalance: branchBalance.closingBalance,
        };
      })
    );

    // Calculate monthly summaries across all branches
    interface MonthlyRow {
      month: number;
      monthLabel: string;
      openingBalance: number;
      income: number;
      expense: number;
      closingBalance: number;
    }

    const monthlyRows: MonthlyRow[] = [];
    const monthList = mo ? [mo] : Array.from({ length: 12 }, (_, index) => index + 1);

    const orgUnitIds = [regId, ...branches.map((b) => b.id)];

    for (const m of monthList) {
      const balances = await Promise.all(
        orgUnitIds.map((unitId) => calculateMonthlyBalance(unitId, m, yr))
      );

      const openingBalance = balances.reduce((sum, balance) => sum + balance.openingBalance, 0);
      const income = balances.reduce((sum, balance) => sum + balance.totalIncome, 0);
      const expense = balances.reduce((sum, balance) => sum + balance.totalExpense, 0);
      const closingBalance = balances.reduce((sum, balance) => sum + balance.closingBalance, 0);

      monthlyRows.push({
        month: m,
        monthLabel: MONTH_NAMES[m - 1],
        openingBalance,
        income,
        expense,
        closingBalance,
      });
    }

    // Collect all transactions for the selected period
    const allTransactions = await db.transaction.findMany({
      where: {
        orgUnitId: { in: orgUnitIds },
        year: yr,
        ...(mo && { month: mo }),
        isOpening: false,
      },
      select: {
        id: true,
        orgUnitId: true,
        type: true,
        categoryName: true,
        date: true,
        description: true,
        amount: true,
        department: true,
        month: true,
        year: true,
        source: true,
        vendor: true,
      },
    });

    // Calculate department summaries
    const departmentMap: Record<string, { income: number; expense: number }> = {};

    allTransactions.forEach((txn) => {
      const dept = txn.department || 'Nyingine';
      if (!departmentMap[dept]) {
        departmentMap[dept] = { income: 0, expense: 0 };
      }
      if (txn.type === 'income') {
        departmentMap[dept].income += txn.amount;
      } else {
        departmentMap[dept].expense += txn.amount;
      }
    });

    const departmentRows = buildAllDepartmentRows(departmentMap);

    // Calculate category summaries
    const incomeCategoryMap: Record<string, number> = {};
    const expenseCategoryMap: Record<string, number> = {};

    allTransactions.forEach((txn) => {
      const cat: string = txn.categoryName || 'Nyingine';
      if (txn.type === 'income') {
        incomeCategoryMap[cat] = (incomeCategoryMap[cat] || 0) + txn.amount;
      } else {
        expenseCategoryMap[cat] = (expenseCategoryMap[cat] || 0) + txn.amount;
      }
    });

    const totalIncome = Object.values(incomeCategoryMap).reduce((a, b) => a + b, 0);
    const totalExpense = Object.values(expenseCategoryMap).reduce((a, b) => a + b, 0);

    const incomeCategoryRows = Object.entries(incomeCategoryMap)
      .map(([cat, amount]) => ({
        category: cat,
        amount,
        percentage: totalIncome > 0 ? (amount / totalIncome) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    const expenseCategoryRows = Object.entries(expenseCategoryMap)
      .map(([cat, amount]) => ({
        category: cat,
        amount,
        percentage: totalExpense > 0 ? (amount / totalExpense) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    // Calculate totals
    const openingBalance = monthlyRows[0]?.openingBalance || 0;
    const closingBalance = monthlyRows[monthlyRows.length - 1]?.closingBalance || 0;

    const reportData = {
      reportType: 'regional_unified' as const,
      regionId: regId,
      regionName: region.name,
      regionCode: region.code,
      year: yr,
      month: mo,
      generatedAt: new Date().toISOString(),
      generatedBy: rbac.user?.userId,

      // Summary
      openingBalance,
      totalIncome,
      totalExpense,
      closingBalance,

      // Branch breakdown
      branchRows,

      // Department breakdown
      departmentRows,

      // Monthly breakdown
      monthlyRows,

      // Category breakdown
      incomeCategoryRows,
      expenseCategoryRows,

      // Metadata
      totalTransactions: allTransactions.length,
      incomeTransactionCount: allTransactions.filter((t) => t.type === 'income').length,
      expenseTransactionCount: allTransactions.filter((t) => t.type === 'expense').length,
      carryForward: closingBalance,
    };

    return NextResponse.json(reportData);
  } catch (error) {
    console.error('Error generating regional unified report:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kuandaa ripoti' },
      { status: 500 }
    );
  }
}
