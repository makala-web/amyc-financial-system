import { DEPARTMENTS } from '@/lib/types';

export interface DepartmentAmountRow {
  department: string;
  income: number;
  expense: number;
  balance: number;
}

/** Always return all standard idara rows (zeros when no transactions). */
export function buildAllDepartmentRows(
  totalsByDept: Record<string, { income: number; expense: number }>
): DepartmentAmountRow[] {
  return DEPARTMENTS.map((department) => {
    const totals = totalsByDept[department] || { income: 0, expense: 0 };
    return {
      department,
      income: totals.income,
      expense: totals.expense,
      balance: totals.income - totals.expense,
    };
  });
}

export function emptyDepartmentTotals(): Record<string, { income: number; expense: number }> {
  const totals: Record<string, { income: number; expense: number }> = {};
  for (const department of DEPARTMENTS) {
    totals[department] = { income: 0, expense: 0 };
  }
  return totals;
}
