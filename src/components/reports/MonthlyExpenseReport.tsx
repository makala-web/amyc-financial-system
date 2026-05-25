'use client';

import { useState, useEffect } from 'react';
import { getTransactionsByOrg } from '@/lib/db-offline';
import { MONTHS } from '@/lib/types';
import type { Transaction, OrgLevel } from '@/lib/types';
import {
  downloadReportPDF,
  openReportPrintPreview,
  formatPrintNum,
  buildPrintTable,
} from '@/lib/print-report';
import { useAuthStore } from '@/lib/store';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Download, Printer, RefreshCw, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';
import { saveWorkbookFile } from '@/lib/export-workbook';
import {
  pctOfPart,
} from '@/lib/reports/finance-percentages';

// ── Org label helper ──────────────────────────────────────
const ORG_LABEL: Record<OrgLevel, string> = {
  markaz: 'MARKAZ KUU',
  jimbo: 'JIMBO LA',
  tawi: 'TAWI LA',
};

// ── Props ────────────────────────────────────────────────
interface MonthlyExpenseReportProps {
  orgUnitId: number;
  month: number;
  year: number;
  orgName: string;
  orgLevel?: OrgLevel;
  monthMode?: 'all' | 'single';
}

// ── Helpers ──────────────────────────────────────────────
function formatNum(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const MONTH_NAMES = [
  'Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni',
  'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba',
];

// ── Component ────────────────────────────────────────────
export default function MonthlyExpenseReport({
  orgUnitId,
  month,
  year,
  orgName,
  orgLevel = 'tawi',
  monthMode = 'single',
}: MonthlyExpenseReportProps) {
  const currentOrg = useAuthStore((s) => s.currentOrg);
  const generatedAt = new Date().toLocaleString('sw-TZ');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [allMonthsData, setAllMonthsData] = useState<Map<number, Transaction[]>>(new Map());
  const [periodIncomeTotal, setPeriodIncomeTotal] = useState(0);
  const [allMonthsIncomeTotals, setAllMonthsIncomeTotals] = useState<Map<number, number>>(new Map());
  const [yearIncomeTotal, setYearIncomeTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const isAllMonths = monthMode === 'all';

  useEffect(() => {
    if (isAllMonths) {
      loadAllMonths();
    } else {
      loadSingleMonth();
    }
  }, [orgUnitId, month, year, monthMode]);

  const loadSingleMonth = async () => {
    setLoading(true);
    try {
      const data = await getTransactionsByOrg(orgUnitId, year, month);
      const expenseData = data.filter((t) => t.type === 'expense');
      const incomeTotal = data
        .filter((t) => t.type === 'income')
        .reduce((sum, t) => sum + t.amount, 0);
      setTransactions(expenseData);
      setPeriodIncomeTotal(incomeTotal);
    } finally {
      setLoading(false);
    }
  };

  const loadAllMonths = async () => {
    setLoading(true);
    try {
      const map = new Map<number, Transaction[]>();
      const incomeMap = new Map<number, number>();
      let incomeYear = 0;
      for (let m = 1; m <= 12; m++) {
        const data = await getTransactionsByOrg(orgUnitId, year, m);
        const expenseData = data.filter((t) => t.type === 'expense');
        const incomeTotal = data
          .filter((t) => t.type === 'income')
          .reduce((sum, t) => sum + t.amount, 0);
        map.set(m, expenseData);
        incomeMap.set(m, incomeTotal);
        incomeYear += incomeTotal;
      }
      setAllMonthsData(map);
      setAllMonthsIncomeTotals(incomeMap);
      setYearIncomeTotal(incomeYear);
    } finally {
      setLoading(false);
    }
  };

  // Only show actual data rows (no empty padding)
  const dataRows: Transaction[] = transactions;

  const grandTotal = transactions.reduce((sum, t) => sum + t.amount, 0);

  // ── Org label ────────────────────────────────────────────
  const orgLabel = ORG_LABEL[orgLevel];

  const withAsilimia = (cells: (string | number)[], amount: number, total: number) => [
    ...cells,
    pctOfPart(amount, total),
  ];

  // ── Print handler ────────────────────────────────────────
  const buildPrintOptions = () => {
    const orgInfo = `OFISI YA MUDIR - ${orgLabel} ${orgName.toUpperCase()}`;
    if (isAllMonths) {
      let contentHtml = '';
      let grandGrandTotal = 0;

      for (let m = 1; m <= 12; m++) {
        const monthTxns = allMonthsData.get(m) || [];
        const monthTotal = monthTxns.reduce((sum, t) => sum + t.amount, 0);
        grandGrandTotal += monthTotal;

        if (m > 1) {
          contentHtml += '<div class="page-break"></div>';
        }

        contentHtml += `<h3 style="margin-top:8px;margin-bottom:4px;color:#166534;">${MONTH_NAMES[m - 1]} ${year}</h3>`;

        const headers = [
          'TAREHE',
          'NA',
          'BIDHAA/VIFAA/HUDUMA',
          'KIPIMO',
          'IDADI',
          'IDARA',
          'BEI@',
          'JUMLA',
          'ASILIMIA',
        ];
        const rows: (string | number)[][] = [];
        const monthIncome = allMonthsIncomeTotals.get(m) || 0;

        monthTxns.forEach((t) => {
          rows.push(
            withAsilimia(
              [
                t.date,
                t.vendor || '',
                t.description || t.category_name,
                t.unit || '',
                t.quantity || '',
                t.department,
                t.unitPrice ? formatPrintNum(t.unitPrice) : '',
                formatPrintNum(t.amount),
              ],
              t.amount,
              monthTotal,
            ),
          );
        });

        contentHtml += buildPrintTable(headers, rows, {
          totalRow: [
            '',
            '',
            'JUMLA YA MATUMIZI',
            '',
            '',
            '',
            '',
            formatPrintNum(monthTotal),
            '100%',
          ],
          colAligns: ['left', 'left', 'left', 'center', 'center', 'left', 'right', 'right', 'right'],
        });
      }

      // Grand total section
      contentHtml += '<div class="page-break"></div>';
      contentHtml += `<h3 style="margin-top:8px;margin-bottom:4px;color:#166534;">JUMLA KUU YA MATUMIZI KWA MWAKA ${year}</h3>`;
      const summaryHeaders = ['MWEZI', 'JUMLA'];
      const summaryRows: (string | number)[][] = [];
      for (let m = 1; m <= 12; m++) {
        const monthTxns = allMonthsData.get(m) || [];
        const monthTotal = monthTxns.reduce((sum, t) => sum + t.amount, 0);
        summaryRows.push([MONTH_NAMES[m - 1], formatPrintNum(monthTotal)]);
      }
      contentHtml += buildPrintTable(summaryHeaders, summaryRows, {
        totalRow: ['JUMLA KUU', formatPrintNum(grandGrandTotal)],
        colAligns: ['left', 'right'],
      });

      return {
        title: 'Fomu ya Matumizi kwa Mwaka',
        subtitle: orgName.toUpperCase(),
        orgInfo,
        orgLevel: orgLabel,
        year,
        contentHtml,
        mudirName: currentOrg?.mudirName,
        mudirSignature: currentOrg?.mudirSignature,
        mwekahazinaName: currentOrg?.mwekahazinaName,
        mwekahazinaSignature: currentOrg?.mwekahazinaSignature,
      };
    } else {
      // Single month print
      const headers = [
        'TAREHE',
        'NA',
        'BIDHAA/VIFAA/HUDUMA',
        'KIPIMO',
        'IDADI',
        'IDARA',
        'BEI@',
        'JUMLA',
        'ASILIMIA',
      ];
      const rows: (string | number)[][] = [];

      dataRows.forEach((t) => {
        rows.push(
          withAsilimia(
            [
              t.date,
              t.vendor || '',
              t.description || t.category_name,
              t.unit || '',
              t.quantity || '',
              t.department,
              t.unitPrice ? formatPrintNum(t.unitPrice) : '',
              formatPrintNum(t.amount),
            ],
            t.amount,
            grandTotal,
          ),
        );
      });

      let contentHtml = buildPrintTable(headers, rows, {
        totalRow: [
          '',
          '',
          'JUMLA YA MATUMIZI',
          '',
          '',
          '',
          '',
          formatPrintNum(grandTotal),
          '100%',
        ],
        colAligns: ['left', 'left', 'left', 'center', 'center', 'left', 'right', 'right', 'right'],
      });

      return {
        title: 'Fomu ya Matumizi kwa Mwezi',
        subtitle: `${MONTH_NAMES[month - 1]} ${year}`,
        orgInfo,
        orgLevel: orgLabel,
        year,
        month,
        contentHtml,
        mudirName: currentOrg?.mudirName,
        mudirSignature: currentOrg?.mudirSignature,
        mwekahazinaName: currentOrg?.mwekahazinaName,
        mwekahazinaSignature: currentOrg?.mwekahazinaSignature,
      };
    }
  };

  const handlePrint = () => {
    openReportPrintPreview(buildPrintOptions());
  };

  const handleDownloadPDF = async () => {
    await downloadReportPDF(buildPrintOptions());
  };

  // ── Export to Excel ────────────────────────────────────
  const exportToExcel = async () => {
    if (isAllMonths) {
      const wb = XLSX.utils.book_new();
      let grandGrandTotal = 0;

      for (let m = 1; m <= 12; m++) {
        const monthTxns = allMonthsData.get(m) || [];
        const monthTotal = monthTxns.reduce((sum, t) => sum + t.amount, 0);
        grandGrandTotal += monthTotal;

        const wsData: (string | number)[][] = [
          ['ANSAAR MUSLIM YOUTH CENTRE'],
          [`OFISI YA MUDIR - ${orgLabel} ${orgName.toUpperCase()}`],
          [`Fomu ya Matumizi kwa Mwezi: ${MONTH_NAMES[m - 1]} ${year}`],
          [],
          ['TAREHE', 'NA', 'BIDHAA/VIFAA/HUDUMA', 'KIPIMO', 'IDADI', 'IDARA', 'BEI@', 'JUMLA', 'ASILIMIA'],
        ];

        for (const t of monthTxns) {
          wsData.push([
            t.date,
            t.vendor || '',
            t.description || t.category_name,
            t.unit || '',
            t.quantity || '',
            t.department,
            t.unitPrice ? formatNum(t.unitPrice) : '',
            t.amount,
            pctOfPart(t.amount, monthTotal),
          ]);
        }

        wsData.push([]);
        wsData.push(['', '', 'JUMLA YA MATUMIZI', '', '', '', '', monthTotal, '100%']);

        const ws = XLSX.utils.aoa_to_sheet(wsData);
        XLSX.utils.book_append_sheet(wb, ws, MONTH_NAMES[m - 1]);
      }

      // Summary sheet
      const summaryData: (string | number)[][] = [
        ['ANSAAR MUSLIM YOUTH CENTRE'],
        [`OFISI YA MUDIR - ${orgLabel} ${orgName.toUpperCase()}`],
        [`JUMLA KUU YA MATUMIZI KWA MWAKA: ${year}`],
        [],
        ['MWEZI', 'JUMLA'],
      ];
      for (let m = 1; m <= 12; m++) {
        const monthTxns = allMonthsData.get(m) || [];
        const monthTotal = monthTxns.reduce((sum, t) => sum + t.amount, 0);
        summaryData.push([MONTH_NAMES[m - 1], monthTotal]);
      }
      summaryData.push([]);
      summaryData.push(['JUMLA KUU', grandGrandTotal]);
      const ws = XLSX.utils.aoa_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, ws, 'Jumla Kuu');
      await saveWorkbookFile(wb, `Matumizi_Mwaka_${orgName}_${year}.xlsx`);
    } else {
      const wsData: (string | number)[][] = [
        ['ANSAAR MUSLIM YOUTH CENTRE'],
        [`OFISI YA MUDIR - ${orgLabel} ${orgName.toUpperCase()}`],
        [`Fomu ya Matumizi kwa Mwezi: ${MONTH_NAMES[month - 1]} ${year}`],
        [],
        ['TAREHE', 'NA', 'BIDHAA/VIFAA/HUDUMA', 'KIPIMO', 'IDADI', 'IDARA', 'BEI@', 'JUMLA', 'ASILIMIA'],
      ];

      for (const t of dataRows) {
        wsData.push([
          t.date,
          t.vendor || '',
          t.description || t.category_name,
          t.unit || '',
          t.quantity || '',
          t.department,
          t.unitPrice ? formatNum(t.unitPrice) : '',
          t.amount,
          pctOfPart(t.amount, grandTotal),
        ]);
      }

      wsData.push([]);
      wsData.push(['', '', 'JUMLA YA MATUMIZI', '', '', '', '', grandTotal, '100%']);
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Matumizi kwa Mwezi');
      await saveWorkbookFile(wb, `Matumizi_Mwezi_${orgName}_${MONTH_NAMES[month - 1]}_${year}.xlsx`);
    }
  };

  // ── Render a single month table ─────────────────────────
  const renderMonthTable = (monthTxns: Transaction[], monthNum: number) => {
    const monthTotal = monthTxns.reduce((sum, t) => sum + t.amount, 0);
    const monthIncome = allMonthsIncomeTotals.get(monthNum) || 0;

    return (
      <div key={monthNum} className="space-y-2">
        <h4 className="font-semibold text-emerald-800 text-base">
          {MONTH_NAMES[monthNum - 1]} {year}
        </h4>
        <div className="border rounded-lg overflow-x-auto">
          <Table className="[&_th]:border [&_td]:border [&_th]:border-emerald-400 [&_td]:border-emerald-300">
            <TableHeader>
              <TableRow className="bg-emerald-800 hover:bg-emerald-800">
                <TableHead className="text-white font-bold w-20">TAREHE</TableHead>
                <TableHead className="text-white font-bold w-20">NA</TableHead>
                <TableHead className="text-white font-bold">BIDHAA/VIFAA/HUDUMA</TableHead>
                <TableHead className="text-white font-bold w-16">KIPIMO</TableHead>
                <TableHead className="text-white font-bold w-16">IDADI</TableHead>
                <TableHead className="text-white font-bold w-28">IDARA</TableHead>
                <TableHead className="text-white font-bold text-right w-24">BEI@</TableHead>
                <TableHead className="text-white font-bold text-right w-28">JUMLA</TableHead>
                <TableHead className="text-white font-bold text-right w-20">ASILIMIA</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {monthTxns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-4">
                    Hakuna data ya matumizi kwa mwezi huu
                  </TableCell>
                </TableRow>
              ) : (
                monthTxns.map((t, i) => (
                  <TableRow key={i} className={i % 2 === 1 ? 'bg-muted/30' : ''}>
                    <TableCell className="text-sm">{t.date}</TableCell>
                    <TableCell className="text-sm">{t.vendor || ''}</TableCell>
                    <TableCell className="font-medium">
                      {t.description || t.category_name}
                    </TableCell>
                    <TableCell className="text-sm">{t.unit || ''}</TableCell>
                    <TableCell className="text-sm text-center">{t.quantity || ''}</TableCell>
                    <TableCell className="text-sm">{t.department}</TableCell>
                    <TableCell className="text-right text-sm">
                      {t.unitPrice ? formatNum(t.unitPrice) : ''}
                    </TableCell>
                    <TableCell className="text-right">{formatNum(t.amount)}</TableCell>
                    <TableCell className="text-right text-sm">
                      {pctOfPart(t.amount, monthTotal)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            <TableFooter>
              <TableRow className="bg-emerald-900 text-white font-bold hover:bg-emerald-900">
                <TableCell colSpan={7} className="text-white font-bold">
                  JUMLA YA MATUMIZI - {MONTH_NAMES[monthNum - 1]}
                </TableCell>
                <TableCell className="text-right text-white font-bold">
                  {formatNum(monthTotal)}
                </TableCell>
                <TableCell className="text-right text-white font-bold">100%</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </div>
    );
  };

  // ── Grand total for all months ──────────────────────────
  const renderGrandTotal = () => {
    let totalAll = 0;
    const monthTotals: { name: string; total: number }[] = [];

    for (let m = 1; m <= 12; m++) {
      const monthTxns = allMonthsData.get(m) || [];
      const monthTotal = monthTxns.reduce((sum, t) => sum + t.amount, 0);
      monthTotals.push({ name: MONTH_NAMES[m - 1], total: monthTotal });
      totalAll += monthTotal;
    }

    // Hide months with zero totals
    const activeMonthTotals = monthTotals.filter((mt) => mt.total !== 0);

    return (
      <div className="mt-4 space-y-3">
        <div className="border rounded-lg overflow-x-auto">
          <Table className="[&_th]:border [&_td]:border [&_th]:border-emerald-400 [&_td]:border-emerald-300">
            <TableHeader>
              <TableRow className="bg-emerald-800 hover:bg-emerald-800">
                <TableHead className="text-white font-bold">MWEZI</TableHead>
                <TableHead className="text-white font-bold text-right">JUMLA</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeMonthTotals.map((mt, i) => (
                <TableRow key={i} className={i % 2 === 1 ? 'bg-muted/30' : ''}>
                  <TableCell className="font-medium">{mt.name}</TableCell>
                  <TableCell className="text-right">{formatNum(mt.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="bg-emerald-800 text-white font-bold hover:bg-emerald-800">
                <TableCell className="text-white font-bold">JUMLA KUU YA MATUMIZI KWA MWAKA</TableCell>
                <TableCell className="text-right text-white font-bold">{formatNum(totalAll)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-emerald-200 bg-linear-to-r from-emerald-50 via-white to-emerald-100 p-4 text-center space-y-1">
        <p className="text-xs font-semibold tracking-wide text-emerald-800 uppercase">ANSAAR MUSLIM YOUTH CENTRE</p>
        <h3 className="text-lg font-bold text-emerald-900">OFISI YA MUDIR - {orgLabel} {orgName.toUpperCase()}</h3>
        <p className="font-semibold text-emerald-800">
          {isAllMonths
            ? `Fomu ya Matumizi kwa Mwaka: ${year}`
            : `Fomu ya Matumizi kwa Mwezi: ${MONTH_NAMES[month - 1]} ${year}`}
        </p>
        <p className="text-xs text-muted-foreground">Imetolewa: {generatedAt}</p>
      </div>

      {/* Export buttons */}
      <div className="flex justify-end gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          className="border-amber-300 text-amber-700 hover:bg-amber-50"
          onClick={handleDownloadPDF}
        >
          <FileText className="h-4 w-4 mr-1" />
          Hifadhi PDF
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
          onClick={handlePrint}
        >
          <Printer className="h-4 w-4 mr-1" />
          Chapa A4
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
          onClick={exportToExcel}
        >
          <Download className="h-4 w-4 mr-1" />
          Hamisha Excel
        </Button>
      </div>

      {/* Table(s) */}
      {isAllMonths ? (
        <div className="space-y-6">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) =>
            renderMonthTable(allMonthsData.get(m) || [], m)
          )}
          {renderGrandTotal()}
        </div>
      ) : (
        <div className="space-y-3">
        <div className="border rounded-lg overflow-x-auto">
          <Table className="[&_th]:border [&_td]:border [&_th]:border-emerald-400 [&_td]:border-emerald-300">
            <TableHeader>
              <TableRow className="bg-emerald-800 hover:bg-emerald-800">
                <TableHead className="text-white font-bold w-20">TAREHE</TableHead>
                <TableHead className="text-white font-bold w-20">NA</TableHead>
                <TableHead className="text-white font-bold">BIDHAA/VIFAA/HUDUMA</TableHead>
                <TableHead className="text-white font-bold w-16">KIPIMO</TableHead>
                <TableHead className="text-white font-bold w-16">IDADI</TableHead>
                <TableHead className="text-white font-bold w-28">IDARA</TableHead>
                <TableHead className="text-white font-bold text-right w-24">BEI@</TableHead>
                <TableHead className="text-white font-bold text-right w-28">JUMLA</TableHead>
                <TableHead className="text-white font-bold text-right w-20">ASILIMIA</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dataRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-4">
                    Hakuna data ya matumizi kwa mwezi huu
                  </TableCell>
                </TableRow>
              ) : (
                dataRows.map((t, i) => (
                  <TableRow key={i} className={i % 2 === 1 ? 'bg-muted/30' : ''}>
                    <TableCell className="text-sm">{t.date}</TableCell>
                    <TableCell className="text-sm">{t.vendor || ''}</TableCell>
                    <TableCell className="font-medium">
                      {t.description || t.category_name}
                    </TableCell>
                    <TableCell className="text-sm">{t.unit || ''}</TableCell>
                    <TableCell className="text-sm text-center">{t.quantity || ''}</TableCell>
                    <TableCell className="text-sm">{t.department}</TableCell>
                    <TableCell className="text-right text-sm">
                      {t.unitPrice ? formatNum(t.unitPrice) : ''}
                    </TableCell>
                    <TableCell className="text-right">{formatNum(t.amount)}</TableCell>
                    <TableCell className="text-right text-sm">
                      {pctOfPart(t.amount, grandTotal)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            <TableFooter>
              <TableRow className="bg-emerald-900 text-white font-bold hover:bg-emerald-900">
                <TableCell colSpan={7} className="text-white font-bold">
                  JUMLA YA MATUMIZI
                </TableCell>
                <TableCell className="text-right text-white font-bold">
                  {formatNum(grandTotal)}
                </TableCell>
                <TableCell className="text-right text-white font-bold">100%</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
        </div>
      )}
    </div>
  );
}
