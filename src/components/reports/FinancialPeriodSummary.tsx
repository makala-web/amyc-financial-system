'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@/components/ui/table';
import {
  pctExpenseOfIncome,
  pctSalioRemaining,
} from '@/lib/reports/finance-percentages';

function formatNum(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface FinancialPeriodSummaryProps {
  income: number;
  expense: number;
  title?: string;
  className?: string;
}

/** Muhtasari: jumla mapato (%), jumla matumizi (%), salio lililobaki (%). */
export default function FinancialPeriodSummary({
  income,
  expense,
  title = 'MUHTASARI WA KIFEDHA',
  className = '',
}: FinancialPeriodSummaryProps) {
  const salio = income - expense;

  return (
    <div className={className}>
      <h4 className="font-semibold text-emerald-800 text-sm mb-2">{title}</h4>
      <div className="border rounded-lg overflow-x-auto max-w-xl">
        <Table className="[&_th]:border [&_td]:border [&_th]:border-emerald-400 [&_td]:border-emerald-300">
          <TableBody>
            <TableRow className="bg-emerald-50/80">
              <TableCell className="font-medium w-40">Jumla Mapato</TableCell>
              <TableCell className="text-right font-semibold">{formatNum(income)}</TableCell>
              <TableCell className="text-right text-sm w-24">100%</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-red-800">Jumla Matumizi</TableCell>
              <TableCell className="text-right font-semibold">{formatNum(expense)}</TableCell>
              <TableCell className="text-right text-sm">{pctExpenseOfIncome(expense, income)}</TableCell>
            </TableRow>
            <TableRow className="bg-emerald-100/60">
              <TableCell className="font-medium text-emerald-900">Salio</TableCell>
              <TableCell
                className={`text-right font-bold ${salio < 0 ? 'text-red-600' : 'text-emerald-800'}`}
              >
                {formatNum(salio)}
              </TableCell>
              <TableCell className="text-right text-sm font-medium">
                {pctSalioRemaining(salio, income)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
