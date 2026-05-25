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
import { aggregateIncomeWithIntegrity } from '@/lib/financial-report-integrity';

// ── Grouped income categories per DOCX spec ─────────────
const INCOME_GROUPS = [
  {
    label: 'Ruzuku kutoka Markaz Kuu',
    categories: ['Ruzuku kutoka Markaz Kuu'],
  },
  {
    label: 'Ruzuku kutoka Serikalini',
    categories: ['Ruzuku kutoka Serikalini'],
  },
  {
    label: 'Misaada ya Nje',
    categories: ['Misaada ya Nje'],
  },
  {
    label: 'Misikiti',
    categories: ['Misikiti'],
  },
  {
    label: 'Shule (Ada & Michango mingine)',
    categories: ['Shule (Ada & Michango mingine)'],
  },
  {
    label: 'Mahad, Vyuo, Vituo, Madrasa, Hospitali',
    categories: ['Mahad', 'Vyuo', 'Vituo', 'Madrasa', 'Hospitali'],
  },
  {
    label: 'Maduka, Mashamba, Majengo ya Biashara, Magari',
    categories: ['Maduka', 'Mashamba', 'Majengo ya Biashara', 'Magari'],
  },
  {
    label: 'Sadaka, Zaka, Wahisani',
    categories: ['Sadaka', 'Zaka', 'Wahisani'],
  },
  {
    label: 'Michango ya Wanajamii, Mkopo',
    categories: ['Michango ya Wanajamii', 'Mkopo'],
  },
  {
    label: 'Maegesho ya Magari, Car Wash, Maji (Visima), Vyanzo vingine',
    categories: [
      'Maegesho ya Magari',
      'Car Wash',
      'Maji (Visima)',
      'Vyanzo vingine',
    ],
  },
];

// ── Org label helper ──────────────────────────────────────
const ORG_LABEL: Record<OrgLevel, string> = {
  markaz: 'MARKAZ KUU',
  jimbo: 'JIMBO LA',
  tawi: 'TAWI LA',
};

// ── Props ────────────────────────────────────────────────
interface MonthlyIncomeReportProps {
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

// ── Aggregate helper (includes uncategorized income for correct totals) ──
function aggregateGroups(transactions: Transaction[]) {
  return aggregateIncomeWithIntegrity(transactions, INCOME_GROUPS).groups;
}

// ── Component ────────────────────────────────────────────
export default function MonthlyIncomeReport({
  orgUnitId,
  month,
  year,
  orgName,
  orgLevel = 'tawi',
  monthMode = 'single',
}: MonthlyIncomeReportProps) {
  const currentOrg = useAuthStore((s) => s.currentOrg);
  const generatedAt = new Date().toLocaleString('sw-TZ');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [allMonthsData, setAllMonthsData] = useState<Map<number, Transaction[]>>(new Map());
  const [periodExpenseTotal, setPeriodExpenseTotal] = useState(0);
  const [allMonthsExpenseTotals, setAllMonthsExpenseTotals] = useState<Map<number, number>>(new Map());
  const [yearExpenseTotal, setYearExpenseTotal] = useState(0);
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
      const incomeData = data.filter((t) => t.type === 'income');
      const expenseTotal = data
        .filter((t) => t.type === 'expense')
        .reduce((sum, t) => sum + t.amount, 0);
      setTransactions(incomeData);
      setPeriodExpenseTotal(expenseTotal);
    } finally {
      setLoading(false);
    }
  };

  const loadAllMonths = async () => {
    setLoading(true);
    try {
      const map = new Map<number, Transaction[]>();
      const expenseMap = new Map<number, number>();
      let expenseYear = 0;
      for (let m = 1; m <= 12; m++) {
        const data = await getTransactionsByOrg(orgUnitId, year, m);
        const incomeData = data.filter((t) => t.type === 'income');
        const expenseTotal = data
          .filter((t) => t.type === 'expense')
          .reduce((sum, t) => sum + t.amount, 0);
        map.set(m, incomeData);
        expenseMap.set(m, expenseTotal);
        expenseYear += expenseTotal;
      }
      setAllMonthsData(map);
      setAllMonthsExpenseTotals(expenseMap);
      setYearExpenseTotal(expenseYear);
    } finally {
      setLoading(false);
    }
  };

  // ── Aggregate by group (single month) ────────────────────
  const groupData = aggregateGroups(transactions);
  const grandTotal = groupData.reduce((sum, g) => sum + g.amount, 0);

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
      // All months print
      let contentHtml = '';
      let grandGrandTotal = 0;

      for (let m = 1; m <= 12; m++) {
        const monthTxns = allMonthsData.get(m) || [];
        const groups = aggregateGroups(monthTxns);
        const monthTotal = groups.reduce((sum, g) => sum + g.amount, 0);
        grandGrandTotal += monthTotal;

        if (m > 1) {
          contentHtml += '<div class="page-break"></div>';
        }

        contentHtml += `<h3 style="margin-top:8px;margin-bottom:4px;color:#166534;">${MONTH_NAMES[m - 1]} ${year}</h3>`;

        const headers = ['TAREHE', 'NA', 'CHANZO CHA MAPATO', 'IDARA', 'KIASI', 'ASILIMIA'];
        const rows: (string | number)[][] = [];
        const monthExpense = allMonthsExpenseTotals.get(m) || 0;

        groups.filter(g => g.amount > 0 || g.items.length > 0).forEach((g) => {
          if (g.items.length === 0) {
            rows.push(
              withAsilimia(
                ['', '', g.label, g.department, g.amount > 0 ? formatPrintNum(g.amount) : ''],
                g.amount,
                monthTotal,
              ),
            );
          } else {
            g.items.forEach((item, j) => {
              rows.push(
                withAsilimia(
                  [
                    item.date,
                    item.source || '',
                    j === 0 ? g.label : '',
                    item.department,
                    formatPrintNum(item.amount),
                  ],
                  item.amount,
                  monthTotal,
                ),
              );
            });
            if (g.items.length > 1) {
              rows.push(
                withAsilimia(
                  ['', '', `  Jumla: ${g.label}`, '', formatPrintNum(g.amount)],
                  g.amount,
                  monthTotal,
                ),
              );
            }
          }
        });

        contentHtml += buildPrintTable(headers, rows, {
          totalRow: ['', '', 'JUMLA YA MAPATO', '', formatPrintNum(monthTotal), '100%'],
          colAligns: ['left', 'left', 'left', 'left', 'right', 'right'],
        });
      }

      // Grand total section
      contentHtml += '<div class="page-break"></div>';
      contentHtml += `<h3 style="margin-top:8px;margin-bottom:4px;color:#166534;">JUMLA KUU YA MAPATO KWA MWAKA ${year}</h3>`;
      const summaryHeaders = ['MWEZI', 'JUMLA'];
      const summaryRows: (string | number)[][] = [];
      for (let m = 1; m <= 12; m++) {
        const monthTxns = allMonthsData.get(m) || [];
        const groups = aggregateGroups(monthTxns);
        const monthTotal = groups.reduce((sum, g) => sum + g.amount, 0);
        summaryRows.push([MONTH_NAMES[m - 1], formatPrintNum(monthTotal)]);
      }
      contentHtml += buildPrintTable(summaryHeaders, summaryRows, {
        totalRow: ['JUMLA KUU', formatPrintNum(grandGrandTotal)],
        colAligns: ['left', 'right'],
      });

      return {
        title: 'Fomu ya Mapato kwa Mwaka',
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
      const headers = ['TAREHE', 'NA', 'CHANZO CHA MAPATO', 'IDARA', 'KIASI', 'ASILIMIA'];
      const rows: (string | number)[][] = [];

      groupData.filter(g => g.amount > 0 || g.items.length > 0).forEach((g) => {
        if (g.items.length === 0) {
          rows.push(
            withAsilimia(
              ['', '', g.label, g.department, g.amount > 0 ? formatPrintNum(g.amount) : ''],
              g.amount,
              grandTotal,
            ),
          );
        } else {
          g.items.forEach((item, j) => {
            rows.push(
              withAsilimia(
                [
                  item.date,
                  item.source || '',
                  j === 0 ? g.label : '',
                  item.department,
                  formatPrintNum(item.amount),
                ],
                item.amount,
                grandTotal,
              ),
            );
          });
          if (g.items.length > 1) {
            rows.push(
              withAsilimia(
                ['', '', `  Jumla: ${g.label}`, '', formatPrintNum(g.amount)],
                g.amount,
                grandTotal,
              ),
            );
          }
        }
      });

      let contentHtml = buildPrintTable(headers, rows, {
        totalRow: ['', '', 'JUMLA YA MAPATO', '', formatPrintNum(grandTotal), '100%'],
        colAligns: ['left', 'left', 'left', 'left', 'right', 'right'],
      });

      return {
        title: 'Fomu ya Mapato kwa Mwezi',
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
        const groups = aggregateGroups(monthTxns);
        const monthTotal = groups.reduce((sum, g) => sum + g.amount, 0);
        grandGrandTotal += monthTotal;

        const wsData: (string | number)[][] = [
          ['ANSAAR MUSLIM YOUTH CENTRE'],
          [`OFISI YA MUDIR - ${orgLabel} ${orgName.toUpperCase()}`],
          [`Fomu ya Mapato kwa Mwezi: ${MONTH_NAMES[m - 1]} ${year}`],
          [],
          ['TAREHE', 'NA', 'CHANZO CHA MAPATO', 'IDARA', 'KIASI', 'ASILIMIA'],
        ];

        groups.filter(g => g.items.length > 0 || g.amount > 0).forEach((g) => {
          if (g.items.length === 0) {
            wsData.push([
              '',
              '',
              g.label,
              g.department,
              g.amount,
              pctOfPart(g.amount, monthTotal),
            ]);
          } else {
            g.items.forEach((item, j) => {
              wsData.push([
                item.date,
                item.source || '',
                j === 0 ? g.label : '',
                item.department,
                item.amount,
                pctOfPart(item.amount, monthTotal),
              ]);
            });
            if (g.items.length > 1) {
              wsData.push([
                '',
                '',
                `  Jumla: ${g.label}`,
                '',
                g.amount,
                pctOfPart(g.amount, monthTotal),
              ]);
            }
          }
        });

        wsData.push([]);
        wsData.push(['', '', 'JUMLA YA MAPATO', '', monthTotal, '100%']);

        const ws = XLSX.utils.aoa_to_sheet(wsData);
        XLSX.utils.book_append_sheet(wb, ws, MONTH_NAMES[m - 1]);
      }

      // Summary sheet
      const summaryData: (string | number)[][] = [
        ['ANSAAR MUSLIM YOUTH CENTRE'],
        [`OFISI YA MUDIR - ${orgLabel} ${orgName.toUpperCase()}`],
        [`JUMLA KUU YA MAPATO KWA MWAKA: ${year}`],
        [],
        ['MWEZI', 'JUMLA'],
      ];
      for (let m = 1; m <= 12; m++) {
        const monthTxns = allMonthsData.get(m) || [];
        const groups = aggregateGroups(monthTxns);
        const monthTotal = groups.reduce((sum, g) => sum + g.amount, 0);
        summaryData.push([MONTH_NAMES[m - 1], monthTotal]);
      }
      summaryData.push([]);
      summaryData.push(['JUMLA KUU', grandGrandTotal]);
      const ws = XLSX.utils.aoa_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, ws, 'Jumla Kuu');
      await saveWorkbookFile(wb, `Mapato_Mwaka_${orgName}_${year}.xlsx`);
    } else {
      const wsData: (string | number)[][] = [
        ['ANSAAR MUSLIM YOUTH CENTRE'],
        [`OFISI YA MUDIR - ${orgLabel} ${orgName.toUpperCase()}`],
        [`Fomu ya Mapato kwa Mwezi: ${MONTH_NAMES[month - 1]} ${year}`],
        [],
        ['TAREHE', 'NA', 'CHANZO CHA MAPATO', 'IDARA', 'KIASI', 'ASILIMIA'],
      ];

      groupData.filter(g => g.items.length > 0 || g.amount > 0).forEach((g) => {
        if (g.items.length === 0) {
          wsData.push(['', '', g.label, g.department, g.amount, pctOfPart(g.amount, grandTotal)]);
        } else {
          g.items.forEach((item, j) => {
            wsData.push([
              item.date,
              item.source || '',
              j === 0 ? g.label : '',
              item.department,
              item.amount,
              pctOfPart(item.amount, grandTotal),
            ]);
          });
          if (g.items.length > 1) {
            wsData.push(['', '', `  Jumla: ${g.label}`, '', g.amount, pctOfPart(g.amount, grandTotal)]);
          }
        }
      });

      wsData.push([]);
      wsData.push(['', '', 'JUMLA YA MAPATO', '', grandTotal, '100%']);
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Mapato kwa Mwezi');
      await saveWorkbookFile(wb, `Mapato_Mwezi_${orgName}_${MONTH_NAMES[month - 1]}_${year}.xlsx`);
    }
  };

  // ── Render a single month table ─────────────────────────
  const renderMonthTable = (monthTxns: Transaction[], monthNum: number) => {
    const groups = aggregateGroups(monthTxns);
    const total = groups.reduce((sum, g) => sum + g.amount, 0);
    const monthExpense = allMonthsExpenseTotals.get(monthNum) || 0;

    return (
      <div key={monthNum} className="space-y-2">
        <h4 className="font-semibold text-emerald-800 text-base">
          {MONTH_NAMES[monthNum - 1]} {year}
        </h4>
        <div className="border rounded-lg overflow-x-auto">
          <Table className="[&_th]:border [&_td]:border [&_th]:border-emerald-400 [&_td]:border-emerald-300">
            <TableHeader>
              <TableRow className="bg-emerald-800 hover:bg-emerald-800">
                <TableHead className="text-white font-bold w-24">TAREHE</TableHead>
                <TableHead className="text-white font-bold w-24">NA</TableHead>
                <TableHead className="text-white font-bold">CHANZO CHA MAPATO</TableHead>
                <TableHead className="text-white font-bold w-32">IDARA</TableHead>
                <TableHead className="text-white font-bold text-right w-28">KIASI</TableHead>
                <TableHead className="text-white font-bold text-right w-20">ASILIMIA</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.filter(g => g.items.length > 0 || g.amount > 0).map((group, gi) => {
                if (group.items.length === 0) {
                  return (
                    <TableRow key={gi} className={gi % 2 === 1 ? 'bg-muted/30' : ''}>
                      <TableCell />
                      <TableCell />
                      <TableCell className="font-medium">{group.label}</TableCell>
                      <TableCell />
                      <TableCell className="text-right">
                        {group.amount > 0 ? formatNum(group.amount) : ''}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {pctOfPart(group.amount, total)}
                      </TableCell>
                    </TableRow>
                  );
                }
                return group.items.map((item, ii) => (
                  <TableRow
                    key={`${gi}-${ii}`}
                    className={gi % 2 === 1 ? 'bg-muted/30' : ''}
                  >
                    <TableCell className="text-sm">{item.date}</TableCell>
                    <TableCell className="text-sm">{item.source || ''}</TableCell>
                    <TableCell className="font-medium">
                      {ii === 0 ? group.label : ''}
                    </TableCell>
                    <TableCell className="text-sm">{item.department}</TableCell>
                    <TableCell className="text-right">{formatNum(item.amount)}</TableCell>
                    <TableCell className="text-right text-sm">
                      {pctOfPart(item.amount, total)}
                    </TableCell>
                  </TableRow>
                ));
              })}
            </TableBody>
            <TableFooter>
              <TableRow className="bg-emerald-900 text-white font-bold hover:bg-emerald-900">
                <TableCell colSpan={4} className="text-white font-bold">
                  JUMLA YA MAPATO - {MONTH_NAMES[monthNum - 1]}
                </TableCell>
                <TableCell className="text-right text-white font-bold">
                  {formatNum(total)}
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
      const groups = aggregateGroups(monthTxns);
      const monthTotal = groups.reduce((sum, g) => sum + g.amount, 0);
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
                <TableCell className="text-white font-bold">JUMLA KUU YA MAPATO KWA MWAKA</TableCell>
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
            ? `Fomu ya Mapato kwa Mwaka: ${year}`
            : `Fomu ya Mapato kwa Mwezi: ${MONTH_NAMES[month - 1]} ${year}`}
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
                  <TableHead className="text-white font-bold w-24">TAREHE</TableHead>
                  <TableHead className="text-white font-bold w-24">NA</TableHead>
                  <TableHead className="text-white font-bold">CHANZO CHA MAPATO</TableHead>
                  <TableHead className="text-white font-bold w-32">IDARA</TableHead>
                  <TableHead className="text-white font-bold text-right w-28">KIASI</TableHead>
                  <TableHead className="text-white font-bold text-right w-20">ASILIMIA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupData.filter(g => g.items.length > 0 || g.amount > 0).map((group, gi) => {
                  if (group.items.length === 0) {
                    return (
                      <TableRow key={gi} className={gi % 2 === 1 ? 'bg-muted/30' : ''}>
                        <TableCell />
                        <TableCell />
                        <TableCell className="font-medium">{group.label}</TableCell>
                        <TableCell />
                        <TableCell className="text-right">
                          {group.amount > 0 ? formatNum(group.amount) : ''}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {pctOfPart(group.amount, grandTotal)}
                        </TableCell>
                      </TableRow>
                    );
                  }
                  return group.items.map((item, ii) => (
                    <TableRow
                      key={`${gi}-${ii}`}
                      className={gi % 2 === 1 ? 'bg-muted/30' : ''}
                    >
                      <TableCell className="text-sm">{item.date}</TableCell>
                      <TableCell className="text-sm">{item.source || ''}</TableCell>
                      <TableCell className="font-medium">
                        {ii === 0 ? group.label : ''}
                      </TableCell>
                      <TableCell className="text-sm">{item.department}</TableCell>
                      <TableCell className="text-right">{formatNum(item.amount)}</TableCell>
                      <TableCell className="text-right text-sm">
                        {pctOfPart(item.amount, grandTotal)}
                      </TableCell>
                    </TableRow>
                  ));
                })}
              </TableBody>
              <TableFooter>
                <TableRow className="bg-emerald-900 text-white font-bold hover:bg-emerald-900">
                  <TableCell colSpan={4} className="text-white font-bold">
                    JUMLA YA MAPATO
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
