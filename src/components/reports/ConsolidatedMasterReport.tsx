'use client';

import { useEffect, useState } from 'react';
import { generateConsolidatedReportNine } from '@/lib/reports/consolidated-report-nine';
import type { ConsolidatedReportNineData } from '@/lib/reports/consolidated-report-nine';
import type { OrgLevel } from '@/lib/types';
import { MONTHS } from '@/lib/types';
import { useAuthStore } from '@/lib/store';
import { buildPrintTable, formatPrintNum, downloadReportPDF, openReportPrintPreview } from '@/lib/print-report';
import { downloadReportNineExcel } from '@/lib/reports/report-nine-excel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Download, FileText, Printer, RefreshCw } from 'lucide-react';

interface ConsolidatedMasterReportProps {
  orgUnitId: number;
  year: number;
  orgLevel: OrgLevel;
  orgName: string;
  selectedChildIds: Set<number>;
  monthMode?: 'all' | 'single';
  month?: number;
}

function formatNum(value: number) {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function percent(value: number) {
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
  return 'text-emerald-700';
}

function unitRowClass(row: NonNullable<ConsolidatedReportNineData['unitRows']>[number]) {
  if (row.hasUploaded === false) return 'bg-amber-50/80';
  if (row.rowKind === 'markaz' || row.rowKind === 'jimbo') return 'bg-emerald-100/80 font-semibold';
  if (row.rowKind === 'jumla') return 'bg-emerald-800 text-white font-bold hover:bg-emerald-800';
  return 'odd:bg-muted/20';
}

export default function ConsolidatedMasterReport({
  year,
  orgLevel,
  orgName,
  selectedChildIds,
  monthMode = 'all',
  month,
}: ConsolidatedMasterReportProps) {
  const currentOrg = useAuthStore((state) => state.currentOrg);
  const currentUser = useAuthStore((state) => state.currentUser);
  const [report, setReport] = useState<ConsolidatedReportNineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reportMonth = monthMode === 'single' && month && month > 0 ? month : undefined;

  const loadReport = async () => {
    if (!currentOrg) return;

    setLoading(true);
    setError(null);

    try {
      const data = await generateConsolidatedReportNine({
        orgUnit: currentOrg,
        year,
        month: reportMonth,
        selectedChildIds,
        generatedBy: currentUser?.id,
      });
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Imeshindikana kutengeneza ripoti.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [currentOrg, year, reportMonth, selectedChildIds]);

  if (orgLevel !== 'jimbo' && orgLevel !== 'markaz') {
    return (
      <div className="py-12 text-center text-muted-foreground">
        Ripoti ya Tisa inapatikana kwa Jimbo na Markaz Kuu pekee.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <RefreshCw className="mr-2 size-5 animate-spin" />
        Inatengeneza Ripoti ya Tisa...
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="py-12 text-center text-red-600">
        {error || 'Hakuna taarifa iliyopatikana.'}
      </div>
    );
  }

  const periodLabel = report.month ? `${MONTHS[report.month - 1]} ${year}` : `Mwaka ${year}`;
  const orgInfo = orgLevel === 'markaz' ? `OFISI YA MUDIR - MARKAZ KUU ${orgName}` : `OFISI YA MUDIR - JIMBO LA ${orgName}`;

  const buildPrintHtml = () => {
    // Summary section
    const summaryRows = [
      ['Salio la mwanzo', formatPrintNum(report.openingBalance)],
      ['Jumla ya mapato', formatPrintNum(report.totalIncome)],
      ['Jumla ya matumizi', formatPrintNum(report.totalExpense)],
      ['Salio la mwisho', formatPrintNum(report.closingBalance)],
      ['Carry Forward', formatPrintNum(report.carryForward)],
    ];
    const summaryTable = buildPrintTable(
      ['KIPENGELE', 'KIASI'],
      summaryRows,
      {
        colAligns: ['left', 'right'],
      }
    );

    const unitRows = (report.unitRows || []).map((row) => [
      row.unitName,
      row.rowKind === 'markaz'
        ? 'Markaz'
        : row.rowKind === 'jimbo'
          ? 'Jimbo'
          : row.rowKind === 'tawi'
            ? 'Tawi'
            : 'Jumla',
      row.hasUploaded === undefined ? '' : row.hasUploaded === false ? 'Haijapakiwa' : 'Imepakiwa',
      formatPrintNum(row.openingBalance),
      formatPrintNum(row.income),
      formatPrintNum(row.expense),
      formatPrintNum(row.balance),
      formatPrintNum(row.closingBalance),
    ]);
    const unitTable = report.unitRows?.length
      ? buildPrintTable(
          ['KITENGO', 'AINA', 'HALI', 'SALIO LA MWANZO', 'MAPATO', 'MATUMIZI', 'SALIO', 'SALIO LA MWISHO'],
          unitRows,
          {
            landscape: true,
            colAligns: ['left', 'left', 'left', 'right', 'right', 'right', 'right', 'right'],
          }
        )
      : '';

    // Monthly breakdown
    const monthlyRows = report.monthlyRows.map((row) => [
      row.label,
      formatPrintNum(row.openingBalance),
      formatPrintNum(row.income),
      formatPrintNum(row.expense),
      formatPrintNum(row.balance),
      formatPrintNum(row.closingBalance),
    ]);

    const monthlyTable = buildPrintTable(
      ['MWEZI', 'SALIO LA MWANZO', 'MAPATO', 'MATUMIZI', 'SALIO', 'SALIO LA MWISHO'],
      monthlyRows,
      {
        totalRow: [
          'JUMLA',
          formatPrintNum(report.openingBalance),
          formatPrintNum(report.totalIncome),
          formatPrintNum(report.totalExpense),
          formatPrintNum(report.totalIncome - report.totalExpense),
          formatPrintNum(report.closingBalance),
        ],
        landscape: true,
        colAligns: ['left', 'right', 'right', 'right', 'right', 'right'],
      }
    );

    const departmentRows = report.departmentRows.map((row) => [
      row.department,
      formatPrintNum(row.income),
      formatPrintNum(row.expense),
      formatPrintNum(row.balance),
    ]);
    const departmentTable = buildPrintTable(
      ['IDARA', 'MAPATO', 'MATUMIZI', 'SALIO'],
      departmentRows,
      {
        totalRow: [
          'JUMLA',
          formatPrintNum(report.totalIncome),
          formatPrintNum(report.totalExpense),
          formatPrintNum(report.totalIncome - report.totalExpense),
        ],
        colAligns: ['left', 'right', 'right', 'right'],
      }
    );

    const incomeRows = report.incomeCategoryRows.map((row) => [
      row.category,
      formatPrintNum(row.amount),
      percent(row.percent),
    ]);
    const expenseRows = report.expenseCategoryRows.map((row) => [
      row.category,
      formatPrintNum(row.amount),
      percent(row.percent),
    ]);

    const incomeTable = buildPrintTable(['KATEGORIA YA MAPATO', 'KIASI', 'ASILIMIA'], incomeRows, {
      totalRow: ['JUMLA MAPATO', formatPrintNum(report.totalIncome), '100%'],
      colAligns: ['left', 'right', 'right'],
    });
    const expenseTable = buildPrintTable(['KATEGORIA YA MATUMIZI', 'KIASI', 'ASILIMIA'], expenseRows, {
      totalRow: ['JUMLA MATUMIZI', formatPrintNum(report.totalExpense), '100%'],
      colAligns: ['left', 'right', 'right'],
    });

    return `
      <h3>MUHTASARI WA KIFEDHA</h3>
      ${summaryTable}
      ${unitTable ? `<h3 style="margin-top:16px;">${orgLevel === 'markaz' ? 'MUHTASARI WA MAJIMBO NA MARKAZ' : 'MUHTASARI WA JIMBO NA MATAWI'}</h3>${unitTable}` : ''}
      <h3 style="margin-top:16px;">SEHEMU YA 1: MAPATO, MATUMIZI NA SALIO</h3>
      ${monthlyTable}
      <h3 style="margin-top:16px;">SEHEMU YA 2: MUHTASARI KI-IDARA</h3>
      ${departmentTable}
      <h3 style="margin-top:16px;">SEHEMU YA 3: UCHAMBUZI WA CATEGORY</h3>
      ${incomeTable}
      ${expenseTable}
    `;
  };

  const buildPrintOptions = () => ({
    title: report.title,
    subtitle: periodLabel,
    orgInfo,
    orgLevel: orgLevel === 'markaz' ? 'Markaz Kuu' : 'Jimbo',
    year,
    month: report.month,
    contentHtml: buildPrintHtml(),
    mudirName: currentOrg?.mudirName,
    mwekahazinaName: currentOrg?.mwekahazinaName,
    orientation: 'landscape' as const,
  });

  const handlePrint = () => {
    openReportPrintPreview(buildPrintOptions());
  };

  const handleDownloadPDF = async () => {
    await downloadReportPDF(buildPrintOptions());
  };

  const exportToExcel = () => {
    downloadReportNineExcel(report);
  };

  const summaryCards = [
    ['Salio la mwanzo', report.openingBalance],
    ['Jumla ya mapato', report.totalIncome],
    ['Jumla ya matumizi', report.totalExpense],
    ['Salio la mwisho', report.closingBalance],
    ['Salio linalohamishwa', report.carryForward],
  ];

  return (
    <div className="space-y-5">
      <div className="text-center space-y-1">
        <h3 className="text-lg font-bold">ANSAAR MUSLIM YOUTH CENTRE</h3>
        <p className="font-semibold">{orgInfo}</p>
        <p className="font-semibold text-emerald-800">{report.title}</p>
        <p className="text-sm text-muted-foreground">
          {periodLabel} - Imejumlisha {report.childCount} {report.childLabel.toLowerCase()}
        </p>
        <p className="text-xs text-muted-foreground">
          Imetolewa: {formatDateTime(report.generatedAt)}
        </p>
      </div>

      <div className="flex justify-end gap-2 flex-wrap">
        <Button variant="outline" size="sm" className="border-amber-300 text-amber-700 hover:bg-amber-50" onClick={handleDownloadPDF}>
          <FileText className="mr-1 size-4" />
          Pakua PDF
        </Button>
        <Button variant="outline" size="sm" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={handlePrint}>
          <Printer className="mr-1 size-4" />
          Chapa A4
        </Button>
        <Button variant="outline" size="sm" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={exportToExcel}>
          <Download className="mr-1 size-4" />
          Excel
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {summaryCards.map(([label, value]) => (
          <Card key={label} className="border-l-4 border-l-emerald-500">
            <CardHeader className="p-3 pb-1">
              <CardTitle className="text-xs text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className={`text-lg font-bold ${amountClass(value as number)}`}>{formatNum(value as number)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {report.unitRows && report.unitRows.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {orgLevel === 'markaz' ? 'Muhtasari wa Majimbo na Markaz' : 'Muhtasari wa Jimbo na Matawi'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-emerald-50 hover:bg-emerald-50">
                    <TableHead className="font-semibold text-emerald-900">Kitengo</TableHead>
                    <TableHead className="font-semibold text-emerald-900">Aina</TableHead>
                    <TableHead className="font-semibold text-emerald-900">Hali</TableHead>
                    <TableHead className="text-right font-semibold text-emerald-900">Salio la Mwanzo</TableHead>
                    <TableHead className="text-right font-semibold text-emerald-900">Mapato</TableHead>
                    <TableHead className="text-right font-semibold text-emerald-900">Matumizi</TableHead>
                    <TableHead className="text-right font-semibold text-emerald-900">Salio</TableHead>
                    <TableHead className="text-right font-semibold text-emerald-900">Salio la Mwisho</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.unitRows.map((row, idx) => (
                    <TableRow key={`${row.unitId}-${row.rowKind}-${idx}`} className={unitRowClass(row)}>
                      <TableCell className={`text-sm font-medium ${row.rowKind === 'jumla' ? 'text-white' : ''}`}>
                        {row.unitName}
                      </TableCell>
                      <TableCell className={`text-sm ${row.rowKind === 'jumla' ? 'text-white' : ''}`}>
                        {row.rowKind === 'markaz'
                          ? 'Markaz'
                          : row.rowKind === 'jimbo'
                            ? 'Jimbo'
                            : row.rowKind === 'tawi'
                              ? 'Tawi'
                              : 'Jumla'}
                      </TableCell>
                      <TableCell className={`text-sm ${row.rowKind === 'jumla' ? 'text-white' : row.hasUploaded === false ? 'text-amber-700 font-medium' : 'text-muted-foreground'}`}>
                        {row.hasUploaded === undefined
                          ? ''
                          : row.hasUploaded === false
                            ? 'Haijapakiwa'
                            : 'Imepakiwa'}
                      </TableCell>
                      <TableCell className={`text-right text-sm ${row.rowKind === 'jumla' ? 'text-white' : ''}`}>
                        {formatNum(row.openingBalance)}
                      </TableCell>
                      <TableCell className={`text-right text-sm ${row.rowKind === 'jumla' ? 'text-white' : 'text-emerald-700'}`}>
                        {formatNum(row.income)}
                      </TableCell>
                      <TableCell className={`text-right text-sm ${row.rowKind === 'jumla' ? 'text-white' : 'text-red-700'}`}>
                        {formatNum(row.expense)}
                      </TableCell>
                      <TableCell className={`text-right text-sm ${row.rowKind === 'jumla' ? 'text-white' : amountClass(row.balance)}`}>
                        {formatNum(row.balance)}
                      </TableCell>
                      <TableCell className={`text-right text-sm font-medium ${row.rowKind === 'jumla' ? 'text-white' : amountClass(row.closingBalance)}`}>
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

      {/* Monthly Breakdown Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Muhtasari wa Miezi</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-emerald-50 hover:bg-emerald-50">
                  <TableHead className="font-semibold text-emerald-900">Mwezi</TableHead>
                  <TableHead className="text-right font-semibold text-emerald-900">Salio la Mwanzo</TableHead>
                  <TableHead className="text-right font-semibold text-emerald-900">Mapato</TableHead>
                  <TableHead className="text-right font-semibold text-emerald-900">Matumizi</TableHead>
                  <TableHead className="text-right font-semibold text-emerald-900">Salio</TableHead>
                  <TableHead className="text-right font-semibold text-emerald-900">Salio la Mwisho</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.monthlyRows.map((row, idx) => (
                  <TableRow key={row.month} className="odd:bg-muted/20">
                    <TableCell className="text-sm font-medium">{row.label}</TableCell>
                    <TableCell className="text-right text-sm">{formatNum(row.openingBalance)}</TableCell>
                    <TableCell className="text-right text-sm text-emerald-700">{formatNum(row.income)}</TableCell>
                    <TableCell className="text-right text-sm text-red-700">{formatNum(row.expense)}</TableCell>
                    <TableCell className={`text-right text-sm ${amountClass(row.balance)}`}>{formatNum(row.balance)}</TableCell>
                    <TableCell className={`text-right text-sm font-medium ${amountClass(row.closingBalance)}`}>
                      {formatNum(row.closingBalance)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-emerald-800 hover:bg-emerald-800 text-white font-bold">
                  <TableCell className="text-white">JUMLA</TableCell>
                  <TableCell className="text-right text-white">{formatNum(report.openingBalance)}</TableCell>
                  <TableCell className="text-right text-white">{formatNum(report.totalIncome)}</TableCell>
                  <TableCell className="text-right text-white">{formatNum(report.totalExpense)}</TableCell>
                  <TableCell className="text-right text-white">{formatNum(report.totalIncome - report.totalExpense)}</TableCell>
                  <TableCell className="text-right text-white">{formatNum(report.closingBalance)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-2">
        <h4 className="font-bold text-emerald-800">SEHEMU YA 1: MAPATO, MATUMIZI NA SALIO</h4>
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-emerald-700 hover:bg-emerald-700">
                {['Mwezi', 'Salio la mwanzo', 'Mapato', 'Matumizi', 'Salio', 'Salio la mwisho'].map((head) => (
                  <TableHead key={head} className="text-white font-bold text-right first:text-left">{head}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.monthlyRows.map((row, idx) => (
                <TableRow key={row.month} className="odd:bg-muted/20">
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell className="text-right">{formatNum(row.openingBalance)}</TableCell>
                  <TableCell className="text-right text-emerald-700">{formatNum(row.income)}</TableCell>
                  <TableCell className="text-right text-orange-700">{formatNum(row.expense)}</TableCell>
                  <TableCell className={`text-right font-semibold ${amountClass(row.balance)}`}>{formatNum(row.balance)}</TableCell>
                  <TableCell className={`text-right font-semibold ${amountClass(row.closingBalance)}`}>{formatNum(row.closingBalance)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-emerald-800 hover:bg-emerald-800 text-white font-bold">
                <TableCell className="text-white">JUMLA</TableCell>
                <TableCell className="text-right text-white">{formatNum(report.openingBalance)}</TableCell>
                <TableCell className="text-right text-white">{formatNum(report.totalIncome)}</TableCell>
                <TableCell className="text-right text-white">{formatNum(report.totalExpense)}</TableCell>
                <TableCell className="text-right text-white">{formatNum(report.totalIncome - report.totalExpense)}</TableCell>
                <TableCell className="text-right text-white">{formatNum(report.closingBalance)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="font-bold text-emerald-800">SEHEMU YA 2: MUHTASARI KI-IDARA</h4>
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-emerald-700 hover:bg-emerald-700">
                {['Idara', 'Mapato', 'Matumizi', 'Salio'].map((head) => (
                  <TableHead key={head} className="text-white font-bold text-right first:text-left">{head}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.departmentRows.map((row, idx) => (
                <TableRow key={row.department} className="odd:bg-muted/20">
                  <TableCell className="font-medium">{row.department}</TableCell>
                  <TableCell className="text-right">{formatNum(row.income)}</TableCell>
                  <TableCell className="text-right">{formatNum(row.expense)}</TableCell>
                  <TableCell className={`text-right font-semibold ${amountClass(row.balance)}`}>{formatNum(row.balance)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="font-bold text-emerald-800">SEHEMU YA 3: UCHAMBUZI WA KATEGORIA</h4>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CategoryTable title="Mapato kwa Kategoria" rows={report.incomeCategoryRows} total={report.totalIncome} />
          <CategoryTable title="Matumizi kwa Kategoria" rows={report.expenseCategoryRows} total={report.totalExpense} />
        </div>
      </section>
    </div>
  );
}

function CategoryTable({
  title,
  rows,
  total,
}: {
  title: string;
  rows: ConsolidatedReportNineData['incomeCategoryRows'];
  total: number;
}) {
  return (
    <div className="rounded-lg border overflow-x-auto">
      <div className="bg-emerald-50 px-3 py-2 font-semibold text-emerald-800">{title}</div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Kategoria</TableHead>
            <TableHead className="text-right">Kiasi</TableHead>
            <TableHead className="text-right">Asilimia</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-muted-foreground">Hakuna data</TableCell>
            </TableRow>
          ) : (
            rows.map((row, idx) => (
              <TableRow key={row.category} className="odd:bg-muted/20">
                <TableCell className="font-medium">{row.category}</TableCell>
                <TableCell className="text-right">{formatNum(row.amount)}</TableCell>
                <TableCell className="text-right">{percent(row.percent)}</TableCell>
              </TableRow>
            ))
          )}
          <TableRow className="bg-emerald-800 hover:bg-emerald-800 text-white font-bold">
            <TableCell className="text-white">JUMLA</TableCell>
            <TableCell className="text-right text-white">{formatNum(total)}</TableCell>
            <TableCell className="text-right text-white">{total > 0 ? '100%' : '0%'}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
