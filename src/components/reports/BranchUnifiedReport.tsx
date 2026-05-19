'use client';

import { useState, useEffect } from 'react';
import type { BranchUnifiedMonthRow, BranchUnifiedCategoryRow, BranchUnifiedDepartmentRow, BranchUnifiedReportData } from '@/lib/reports/branch-unified-report';
import { downloadBranchUnifiedReportExcel } from '@/lib/reports/branch-unified-excel';
import { useAuthStore } from '@/lib/store';
import { getTransactionsForOrgPeriod } from '@/lib/db-offline';
import { DEPARTMENTS } from '@/lib/types';
import { buildAllDepartmentRows } from '@/lib/reports/department-rows';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Download, Printer, RefreshCw, DownloadCloud } from 'lucide-react';
import { downloadHtmlAsPdf, openHtmlPrintPreview } from '@/lib/print-report';
import { buildUnifiedFinancialPrintHtml } from '@/lib/reports/unified-report-print';
import { calculateOfflinePeriodBalance } from '@/lib/finance/offline-balance-engine';

interface BranchUnifiedReportProps {
  orgUnitId: number;
  year: number;
  orgName: string;
  monthMode?: 'all' | 'single';
  month?: number;
}

function formatNum(value: number) {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('sw-TZ', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function amountClass(value: number) {
  if (value < 0) return 'text-red-600';
  return value > 0 ? 'text-emerald-700' : 'text-gray-600';
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function resolveDepartmentRows(report: BranchUnifiedReportData): BranchUnifiedDepartmentRow[] {
  if (report.departmentRows.length >= DEPARTMENTS.length) {
    return report.departmentRows;
  }
  const totals: Record<string, { income: number; expense: number }> = {};
  for (const row of report.departmentRows) {
    totals[row.department] = { income: row.income, expense: row.expense };
  }
  return buildAllDepartmentRows(totals);
}

function buildBranchPrintHtml(report: BranchUnifiedReportData) {
  return buildUnifiedFinancialPrintHtml({
    orgLine: `TAWI LA ${report.branchName.toUpperCase()}`,
    formTitle: 'Fomu ya Taarifa Jumuishi ya Tawi',
    year: report.year,
    month: report.month,
    generatedAt: formatDateTime(report.generatedAt),
    openingBalance: report.openingBalance,
    totalIncome: report.totalIncome,
    totalExpense: report.totalExpense,
    closingBalance: report.closingBalance,
    carryForward: report.carryForward,
    monthlyRows: report.monthlyRows.map((row) => ({
      monthLabel: row.monthLabel,
      openingBalance: row.openingBalance,
      income: row.income,
      expense: row.expense,
      balance: row.balance,
      closingBalance: row.closingBalance,
    })),
    departmentRows: resolveDepartmentRows(report),
    incomeCategoryRows: report.incomeCategoryRows,
    expenseCategoryRows: report.expenseCategoryRows,
  });
}

function downloadBranchUnifiedReportPDF(report: BranchUnifiedReportData) {
  return downloadHtmlAsPdf(buildBranchPrintHtml(report), {
    fileName: `Ripoti_Tawi_${report.branchCode || 'N/A'}_${report.year}.pdf`,
    orientation: 'landscape',
  });
}
export default function BranchUnifiedReport({
  orgUnitId,
  year,
  orgName,
  monthMode = 'all',
  month,
}: BranchUnifiedReportProps) {
  const currentUser = useAuthStore((state) => state.currentUser);
  const currentOrg = useAuthStore((state) => state.currentOrg);
  const [report, setReport] = useState<BranchUnifiedReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reportMonth = monthMode === 'single' && month && month > 0 ? month : undefined;

  // Check auth early to prevent race conditions
  const isAuthorized = currentUser && currentUser.id;

  const loadReport = async () => {
    if (!isAuthorized) {
      setError('Hauna ruhusa. Tafadhali ingia kwanza.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const allYearTxns = (await getTransactionsForOrgPeriod(orgUnitId, year))
        .filter((t) => t.type === 'income' || t.type === 'expense');
      const txns = reportMonth
        ? allYearTxns.filter((t) => t.month === reportMonth)
        : allYearTxns;

      const balanceData = await calculateOfflinePeriodBalance(orgUnitId, year, reportMonth);
      const monthLabels = ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'];

      const monthlyRows: BranchUnifiedMonthRow[] = balanceData.monthlyData.map((row) => ({
        month: row.month,
        monthLabel: monthLabels[row.month - 1],
        openingBalance: row.openingBalance,
        income: row.totalIncome,
        expense: row.totalExpense,
        balance: row.totalIncome - row.totalExpense,
        closingBalance: row.closingBalance,
      }));

      const totalIncome = balanceData.totalIncome;
      const totalExpense = balanceData.totalExpense;
      const openingBalance = balanceData.openingBalance;
      const closingBalance = balanceData.closingBalance;

      const deptMap: Record<string, { income: number; expense: number }> = {};
      DEPARTMENTS.forEach((d) => { deptMap[d] = { income: 0, expense: 0 }; });
      txns.forEach((t) => {
        const dep = t.department || 'Nyingine';
        if (!deptMap[dep]) deptMap[dep] = { income: 0, expense: 0 };
        if (t.type === 'income') deptMap[dep].income += t.amount;
        else deptMap[dep].expense += t.amount;
      });
      const departmentRows: BranchUnifiedDepartmentRow[] = DEPARTMENTS.map((department) => {
        const v = deptMap[department] || { income: 0, expense: 0 };
        return {
          department,
          income: v.income,
          expense: v.expense,
          balance: v.income - v.expense,
        };
      });

      const incomeTotal = totalIncome || 1;
      const expenseTotal = totalExpense || 1;
      const incomeCatMap: Record<string, number> = {};
      const expenseCatMap: Record<string, number> = {};
      txns.forEach((t) => {
        const cat = t.category_name || 'Bila Kategoria';
        if (t.type === 'income') incomeCatMap[cat] = (incomeCatMap[cat] || 0) + t.amount;
        else expenseCatMap[cat] = (expenseCatMap[cat] || 0) + t.amount;
      });
      const incomeCategoryRows: BranchUnifiedCategoryRow[] = Object.entries(incomeCatMap)
        .map(([category, amount]) => ({ category, amount, percentage: (amount / incomeTotal) * 100, transactions: [] }))
        .sort((a, b) => b.amount - a.amount);
      const expenseCategoryRows: BranchUnifiedCategoryRow[] = Object.entries(expenseCatMap)
        .map(([category, amount]) => ({ category, amount, percentage: (amount / expenseTotal) * 100, transactions: [] }))
        .sort((a, b) => b.amount - a.amount);

      const data: BranchUnifiedReportData = {
        reportType: 'branch_unified',
        branchId: orgUnitId,
        branchName: orgName || currentOrg?.name || 'Tawi',
        branchCode: currentOrg?.code,
        year,
        month: reportMonth,
        generatedAt: new Date().toISOString(),
        generatedBy: currentUser?.id,
        openingBalance,
        totalIncome,
        totalExpense,
        closingBalance,
        carryForward: closingBalance,
        monthlyRows,
        departmentRows,
        incomeCategoryRows,
        expenseCategoryRows,
        totalTransactions: txns.length,
        incomeTransactionCount: txns.filter((t) => t.type === 'income').length,
        expenseTransactionCount: txns.filter((t) => t.type === 'expense').length,
      };

      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Imeshindikana kuandaa ripoti');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [orgUnitId, year, reportMonth, currentUser]);

  const handlePrint = () => {
    if (!report) return;
    openHtmlPrintPreview(buildBranchPrintHtml(report));
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <RefreshCw className="h-8 w-8 mx-auto mb-2 animate-spin" />
        <p>Inaandaa ripoti...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12 text-center text-red-600">
        <p>Kosa: {error}</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        Hakuna taarifa ya kuonyesha
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Institutional heading + actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-linear-to-r from-emerald-50 via-white to-emerald-100 p-4">
        <div className="space-y-1 text-center sm:text-left w-full">
          <p className="text-xs font-semibold tracking-wide text-emerald-800 uppercase">
            ANSAAR MUSLIM YOUTH CENTRE
          </p>
          <h3 className="text-lg font-bold text-emerald-900">OFISI YA MUDIR - TAWI LA {report.branchName.toUpperCase()}</h3>
          <p className="text-sm text-muted-foreground">
            Fomu ya Taarifa Jumuishi ya Tawi
          </p>
          <p className="text-xs text-muted-foreground">
            Kwa Mwaka: {report.year}{report.month ? ` | Mwezi: ${report.month}` : ' | Miezi yote'}
          </p>
          <p className="text-xs text-muted-foreground">
            Imetolewa: {formatDateTime(report.generatedAt)}
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            onClick={handlePrint}
            className="gap-2"
          >
            <Printer className="h-4 w-4" />
            Chapa A4
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadBranchUnifiedReportPDF(report)}
            className="gap-2 bg-blue-50 hover:bg-blue-100"
          >
            <DownloadCloud className="h-4 w-4" />
            Hifadhi PDF
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadBranchUnifiedReportExcel(report)}
            className="gap-2 bg-green-50 hover:bg-green-100"
          >
            <Download className="h-4 w-4" />
            Excel
          </Button>
        </div>
      </div>

      {/* Summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Muhtasari wa Kifedha</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="min-w-0 rounded-md border bg-background p-3">
              <p className="text-xs text-muted-foreground">Salio la mwanzo</p>
              <p className={`text-base sm:text-lg font-bold tabular-nums break-words ${amountClass(report.openingBalance)}`}>
                {formatNum(report.openingBalance)}
              </p>
            </div>
            <div className="min-w-0 rounded-md border bg-background p-3">
              <p className="text-xs text-muted-foreground">Mapato Jumla</p>
              <p className="text-base sm:text-lg font-bold tabular-nums break-words text-emerald-700">{formatNum(report.totalIncome)}</p>
            </div>
            <div className="min-w-0 rounded-md border bg-background p-3">
              <p className="text-xs text-muted-foreground">Matumizi Jumla</p>
              <p className="text-base sm:text-lg font-bold tabular-nums break-words text-red-700">{formatNum(report.totalExpense)}</p>
            </div>
            <div className="min-w-0 rounded-md border bg-background p-3">
              <p className="text-xs text-muted-foreground">Salio la mwisho</p>
              <p className={`text-base sm:text-lg font-bold tabular-nums break-words ${amountClass(report.closingBalance)}`}>
                {formatNum(report.closingBalance)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Monthly Breakdown */}
      {report.monthlyRows.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Muhtasari wa Kila Mwezi</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-emerald-50 hover:bg-emerald-50">
                    <TableHead className="font-semibold text-emerald-900">Mwezi</TableHead>
                    <TableHead className="text-right font-semibold text-emerald-900">Salio la mwanzo</TableHead>
                    <TableHead className="text-right font-semibold text-emerald-900">Mapato</TableHead>
                    <TableHead className="text-right font-semibold text-emerald-900">Matumizi</TableHead>
                    <TableHead className="text-right font-semibold text-emerald-900">Salio</TableHead>
                    <TableHead className="text-right font-semibold text-emerald-900">Salio la mwisho</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.monthlyRows.map((row, idx) => (
                    <TableRow key={idx} className="odd:bg-muted/20">
                      <TableCell className="text-sm">{row.monthLabel}</TableCell>
                      <TableCell className="text-right text-sm">{formatNum(row.openingBalance)}</TableCell>
                      <TableCell className="text-right text-sm text-emerald-700">{formatNum(row.income)}</TableCell>
                      <TableCell className="text-right text-sm text-red-700">{formatNum(row.expense)}</TableCell>
                      <TableCell className={`text-right text-sm ${amountClass(row.balance)}`}>{formatNum(row.balance)}</TableCell>
                      <TableCell className={`text-right text-sm font-medium ${amountClass(row.closingBalance)}`}>
                        {formatNum(row.closingBalance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Department Breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Muhtasari wa Kila Idara</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-emerald-50 hover:bg-emerald-50">
                  <TableHead className="font-semibold text-emerald-900">Idara</TableHead>
                  <TableHead className="text-right font-semibold text-emerald-900">Mapato</TableHead>
                  <TableHead className="text-right font-semibold text-emerald-900">Matumizi</TableHead>
                  <TableHead className="text-right font-semibold text-emerald-900">Salio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resolveDepartmentRows(report).map((row, idx) => (
                  <TableRow key={idx} className="odd:bg-muted/20">
                    <TableCell className="text-sm">{row.department}</TableCell>
                    <TableCell className="text-right text-sm text-emerald-700">{formatNum(row.income)}</TableCell>
                    <TableCell className="text-right text-sm text-red-700">{formatNum(row.expense)}</TableCell>
                    <TableCell className={`text-right text-sm font-medium ${amountClass(row.balance)}`}>
                      {formatNum(row.balance)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Income Categories */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Mapato kwa Kategoria</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-emerald-50 hover:bg-emerald-50">
                  <TableHead className="font-semibold text-emerald-900">Kategoria</TableHead>
                  <TableHead className="text-right font-semibold text-emerald-900">Kiasi</TableHead>
                  <TableHead className="text-right font-semibold text-emerald-900">Asilimia (%)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.incomeCategoryRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-6">
                      Hakuna taarifa za mapato kwa kategoria kwa kipindi hiki.
                    </TableCell>
                  </TableRow>
                ) : (
                  report.incomeCategoryRows.map((cat, catIdx) => (
                    <TableRow key={catIdx} className="odd:bg-muted/20">
                      <TableCell className="text-sm">{cat.category}</TableCell>
                      <TableCell className="text-right text-sm text-emerald-700">{formatNum(cat.amount)}</TableCell>
                      <TableCell className="text-right text-sm">{formatPercent(cat.percentage)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Expense Categories */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Matumizi kwa Kategoria</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-red-50 hover:bg-red-50">
                  <TableHead className="font-semibold text-red-900">Kategoria</TableHead>
                  <TableHead className="text-right font-semibold text-red-900">Kiasi</TableHead>
                  <TableHead className="text-right font-semibold text-red-900">Asilimia (%)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.expenseCategoryRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-6">
                      Hakuna taarifa za matumizi kwa kategoria kwa kipindi hiki.
                    </TableCell>
                  </TableRow>
                ) : (
                  report.expenseCategoryRows.map((cat, catIdx) => (
                    <TableRow key={catIdx} className="odd:bg-muted/20">
                      <TableCell className="text-sm">{cat.category}</TableCell>
                      <TableCell className="text-right text-sm text-red-700">{formatNum(cat.amount)}</TableCell>
                      <TableCell className="text-right text-sm">{formatPercent(cat.percentage)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Metadata */}
      <Card className="bg-muted/30">
        <CardContent className="pt-4">
          <div className="text-xs text-muted-foreground space-y-1">
            <p>Jumla ya Miamala: {report.totalTransactions}</p>
            <p>Mapato: {report.incomeTransactionCount} | Matumizi: {report.expenseTransactionCount}</p>
            <p>Iliyotengwa: {new Date(report.generatedAt).toLocaleString('sw-TZ')}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
