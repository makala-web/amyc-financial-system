import { db, getTransactionsForOrgPeriod } from '@/lib/db-offline';
import type { Transaction } from '@/lib/types';
import { mirrorNativeRecord } from '@/lib/storage/native-record-store';

export interface OfflineMonthlyBalance {
  orgUnitId: number;
  month: number;
  year: number;
  openingBalance: number;
  totalIncome: number;
  totalExpense: number;
  closingBalance: number;
  carryForward: number;
}

export interface OfflinePeriodBalance {
  orgUnitId: number;
  year: number;
  month?: number;
  openingBalance: number;
  totalIncome: number;
  totalExpense: number;
  closingBalance: number;
  carryForward: number;
  monthlyData: OfflineMonthlyBalance[];
}

function previousPeriod(month: number, year: number) {
  if (month === 1) {
    return { month: 12, year: year - 1 };
  }

  return { month: month - 1, year };
}

function sumTransactions(transactions: Transaction[]) {
  return transactions.reduce(
    (totals, transaction) => {
      if (transaction.type === 'income') {
        totals.totalIncome += transaction.amount;
      } else {
        totals.totalExpense += transaction.amount;
      }

      return totals;
    },
    { totalIncome: 0, totalExpense: 0 }
  );
}

async function getTransactionsForMonth(orgUnitId: number, month: number, year: number) {
  return getTransactionsForOrgPeriod(orgUnitId, year, month);
}

export async function calculateOfflineOpeningBalance(
  orgUnitId: number,
  month: number,
  year: number,
  depth = 0
): Promise<number> {
  if (depth > 24) {
    return 0;
  }

  // If January, get previous year's December closing balance
  if (month === 1) {
    const storedPrevious = await db.monthlyBalances
      .where('[orgUnitId+month+year]')
      .equals([orgUnitId, 12, year - 1])
      .first();

    if (storedPrevious) {
      return storedPrevious.closingBalance;
    }

    // Calculate previous year's December if not stored
    const previousDecember = await calculateOfflineMonthlyBalance(orgUnitId, 12, year - 1, depth + 1);
    return previousDecember.closingBalance;
  }

  // For other months, get previous month's closing balance
  const previous = previousPeriod(month, year);
  const storedPrevious = await db.monthlyBalances
    .where('[orgUnitId+month+year]')
    .equals([orgUnitId, previous.month, previous.year])
    .first();

  if (storedPrevious) {
    return storedPrevious.closingBalance;
  }

  const previousTransactions = await getTransactionsForMonth(orgUnitId, previous.month, previous.year);
  if (previousTransactions.length === 0) {
    return 0;
  }

  const previousBalance = await calculateOfflineMonthlyBalance(
    orgUnitId,
    previous.month,
    previous.year,
    depth + 1
  );

  return previousBalance.closingBalance;
}

export async function calculateOfflineMonthlyBalance(
  orgUnitId: number,
  month: number,
  year: number,
  depth = 0
): Promise<OfflineMonthlyBalance> {
  const openingBalance = await calculateOfflineOpeningBalance(orgUnitId, month, year, depth);
  const transactions = await getTransactionsForMonth(orgUnitId, month, year);
  const { totalIncome, totalExpense } = sumTransactions(transactions);
  const closingBalance = openingBalance + totalIncome - totalExpense;

  return {
    orgUnitId,
    month,
    year,
    openingBalance,
    totalIncome,
    totalExpense,
    closingBalance,
    carryForward: closingBalance,
  };
}

export async function calculateOfflinePeriodBalance(
  orgUnitId: number,
  year: number,
  month?: number
): Promise<OfflinePeriodBalance> {
  const months = month && month > 0 ? [month] : Array.from({ length: 12 }, (_, index) => index + 1);
  const monthlyData: OfflineMonthlyBalance[] = [];

  for (const periodMonth of months) {
    monthlyData.push(await calculateOfflineMonthlyBalance(orgUnitId, periodMonth, year));
  }

  const openingBalance = monthlyData[0]?.openingBalance || 0;
  const totalIncome = monthlyData.reduce((sum, item) => sum + item.totalIncome, 0);
  const totalExpense = monthlyData.reduce((sum, item) => sum + item.totalExpense, 0);
  const closingBalance = openingBalance + totalIncome - totalExpense;

  return {
    orgUnitId,
    year,
    month,
    openingBalance,
    totalIncome,
    totalExpense,
    closingBalance,
    carryForward: closingBalance,
    monthlyData,
  };
}

export async function saveOfflineMonthlyBalance(
  balance: OfflineMonthlyBalance,
  generatedBy?: number,
  reportType: 'branch' | 'regional' | 'markaz' | 'consolidated_master' = 'branch',
  notes?: string
) {
  const existing = await db.monthlyBalances
    .where('[orgUnitId+month+year]')
    .equals([balance.orgUnitId, balance.month, balance.year])
    .first();
  const now = new Date().toISOString();

  const record = {
    orgUnitId: balance.orgUnitId,
    month: balance.month,
    year: balance.year,
    openingBalance: balance.openingBalance,
    totalIncome: balance.totalIncome,
    totalExpense: balance.totalExpense,
    closingBalance: balance.closingBalance,
    carryForward: balance.carryForward,
    generatedBy,
    generatedAt: now,
    reportType,
    notes,
    updatedAt: now,
  };

  if (existing?.id) {
    await db.monthlyBalances.update(existing.id, record);
    await mirrorNativeRecord('monthlyBalances', existing.id, { ...existing, ...record }, {
      orgUnitId: balance.orgUnitId,
      month: balance.month,
      year: balance.year,
    });
  } else {
    const id = (await db.monthlyBalances.add({ ...record, createdAt: now })) as number;
    await mirrorNativeRecord('monthlyBalances', id, { id, ...record, createdAt: now }, {
      orgUnitId: balance.orgUnitId,
      month: balance.month,
      year: balance.year,
    });
  }
}

export async function validateOfflineMonthlyContinuity(orgUnitId: number, year: number) {
  const issues: Array<{ month: number; issue: string }> = [];

  for (let month = 1; month < 12; month++) {
    const current = await calculateOfflineMonthlyBalance(orgUnitId, month, year);
    const next = await calculateOfflineMonthlyBalance(orgUnitId, month + 1, year);

    if (Math.abs(current.closingBalance - next.openingBalance) > 0.01) {
      issues.push({
        month,
        issue: `Closing balance (${current.closingBalance}) haitalingani na opening balance ya mwezi unaofuata (${next.openingBalance})`,
      });
    }
  }

  return issues;
}
