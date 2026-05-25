'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { getDepartmentalSummary, db } from '@/lib/db-offline';
import { MONTHS, DEPARTMENTS } from '@/lib/types';
import type { OrgLevel } from '@/lib/types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Download, Printer, RefreshCw, FileText } from 'lucide-react';
import {
  downloadReportPDF,
  openReportPrintPreview,
  formatPrintNum,
  buildPrintTable,
} from '@/lib/print-report';
import { useAuthStore } from '@/lib/store';
import * as XLSX from 'xlsx';
import { saveWorkbookFile } from '@/lib/export-workbook';
import {
  pctExpenseOfIncome,
  pctSalioRemaining,
} from '@/lib/reports/finance-percentages';

// ── Props ────────────────────────────────────────────────
interface DepartmentalReportProps {
  orgUnitId: number;
  year: number;
  orgLevel: OrgLevel;
  orgName: string;
  monthMode?: 'all' | 'single';
  month?: number;
}

// ── Department short labels ─────────────────────────────
const DEPT_SHORT: Record<string, string> = {
  Daawah: 'Daawa',
  Elimu: 'Elimu',
  'Ustawi wa Jamii': 'Ustawi',
  'Uchumi & Miradi': 'Uch & Mip',
  Habari: 'Habari',
};

const DEPT_KEYS = DEPARTMENTS as readonly string[];

// ── Helpers ──────────────────────────────────────────────
const ORG_LABELS: Record<OrgLevel, string> = {
  markaz: 'MARKAZ KUU',
  jimbo: 'JIMBO LA',
  tawi: 'TAWI LA',
};

function formatNum(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Component ────────────────────────────────────────────
export default function DepartmentalReport({
  orgUnitId,
  year,
  orgLevel,
  orgName,
  monthMode = 'all',
  month,
}: DepartmentalReportProps) {
  const currentOrg = useAuthStore((s) => s.currentOrg);
  const generatedAt = new Date().toLocaleString('sw-TZ');
  const [summary, setSummary] = useState<Record<string, { income: number; expense: number }>>({});
  const [monthlySummary, setMonthlySummary] = useState<
    Record<number, Record<string, { income: number; expense: number }>>
  >({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [orgUnitId, year]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Get full year summary
      const annualSummary = await getDepartmentalSummary(orgUnitId, year);
      setSummary(annualSummary);

      // Get monthly breakdown from transactions
      const transactions = await db.transactions
        .where('orgUnitId')
        .equals(orgUnitId)
        .toArray();

      const filtered = transactions.filter((t) => t.year === year);

      const monthly: Record<number, Record<string, { income: number; expense: number }>> = {};
      for (let m = 1; m <= 12; m++) {
        monthly[m] = {};
        for (const dept of DEPT_KEYS) {
          monthly[m][dept] = { income: 0, expense: 0 };
        }
        const monthTxns = filtered.filter((t) => t.month === m);
        for (const t of monthTxns) {
          if (!monthly[m][t.department]) {
            monthly[m][t.department] = { income: 0, expense: 0 };
          }
          if (t.type === 'income') {
            monthly[m][t.department].income += t.amount;
          } else {
            monthly[m][t.department].expense += t.amount;
          }
        }
      }
      setMonthlySummary(monthly);
    } finally {
      setLoading(false);
    }
  };

  // All months in scope + all idara columns (even when amounts are zero)
  const activeDisplayMonths: number[] =
    monthMode === 'single' && month != null && month >= 1 && month <= 12
      ? [month]
      : Array.from({ length: 12 }, (_, i) => i + 1);

  const printDepts = [...DEPT_KEYS];

  const periodDeptTotals = useMemo(() => {
    const totals: Record<string, { income: number; expense: number }> = {};
    for (const dept of printDepts) {
      totals[dept] = { income: 0, expense: 0 };
    }
    for (const m of activeDisplayMonths) {
      const mData = monthlySummary[m] || {};
      for (const dept of printDepts) {
        totals[dept].income += mData[dept]?.income || 0;
        totals[dept].expense += mData[dept]?.expense || 0;
      }
    }
    return totals;
  }, [monthlySummary, activeDisplayMonths, printDepts]);

  // ── Print / PDF ────────────────────────────────────────
  const buildPrintOptions = () => {
    const orgInfo = `OFISI YA MUDIR - ${ORG_LABELS[orgLevel]} ${orgName.toUpperCase()}`;
    const title = 'Fomu ya Mapato na Matumizi (Ki-Idara)';
    const subtitle = monthMode === 'single' && month
      ? `Mwezi: ${MONTHS[month - 1]}`
      : 'Mwaka Kamili';

    // Build headers: MWEZI | MAELEZO | ActiveDepts | JUMLA | ASILIMIA
    const headers = [
      'MWEZI',
      'MAELEZO',
      ...printDepts.map((d) => DEPT_SHORT[d] || d),
      'JUMLA',
      'ASILIMIA',
    ];

    const colAligns: ('left' | 'center' | 'right')[] = [
      'left',
      'left',
      ...printDepts.map(() => 'right' as const),
      'right',
      'right',
    ];

    const rows: (string | number)[][] = [];

    for (const m of activeDisplayMonths) {
      const mData = monthlySummary[m] || {};
      const monthName = MONTHS[m - 1];

      // Mapato row
      let mapatoTotal = 0;
      const mapatoRow: (string | number)[] = [monthName, 'Mapato'];
      for (const dept of printDepts) {
        const val = mData[dept]?.income || 0;
        mapatoRow.push(val > 0 ? formatPrintNum(val) : '');
        mapatoTotal += val;
      }
      mapatoRow.push(mapatoTotal > 0 ? formatPrintNum(mapatoTotal) : '');
      mapatoRow.push('100%');
      rows.push(mapatoRow);

      // Matumizi row
      let matumiziTotal = 0;
      const matumiziRow: (string | number)[] = ['', 'Matumizi'];
      for (const dept of printDepts) {
        const val = mData[dept]?.expense || 0;
        matumiziRow.push(val > 0 ? formatPrintNum(val) : '');
        matumiziTotal += val;
      }
      matumiziRow.push(matumiziTotal > 0 ? formatPrintNum(matumiziTotal) : '');
      matumiziRow.push(pctExpenseOfIncome(matumiziTotal, mapatoTotal));
      rows.push(matumiziRow);

      // Salio row
      let salioTotal = 0;
      const salioRow: (string | number)[] = ['', 'Salio'];
      for (const dept of printDepts) {
        const val = (mData[dept]?.income || 0) - (mData[dept]?.expense || 0);
        salioRow.push(val !== 0 ? formatPrintNum(val) : '');
        salioTotal += val;
      }
      salioRow.push(salioTotal !== 0 ? formatPrintNum(salioTotal) : '');
      salioRow.push(pctSalioRemaining(salioTotal, mapatoTotal));
      rows.push(salioRow);
    }

    // JUMLA total row (kipindi kilichochaguliwa, si mwaka mzima)
    let grandMapato = 0;
    const jumlaMapato: (string | number)[] = ['JUMLA', 'Mapato'];
    for (const dept of printDepts) {
      const val = periodDeptTotals[dept]?.income || 0;
      jumlaMapato.push(val > 0 ? formatPrintNum(val) : '');
      grandMapato += val;
    }
    jumlaMapato.push(formatPrintNum(grandMapato));
    jumlaMapato.push('100%');

    let grandMatumizi = 0;
    const jumlaMatumizi: (string | number)[] = ['', 'Matumizi'];
    for (const dept of printDepts) {
      const val = periodDeptTotals[dept]?.expense || 0;
      jumlaMatumizi.push(val > 0 ? formatPrintNum(val) : '');
      grandMatumizi += val;
    }
    jumlaMatumizi.push(formatPrintNum(grandMatumizi));
    jumlaMatumizi.push(pctExpenseOfIncome(grandMatumizi, grandMapato));

    let grandSalio = 0;
    const jumlaSalio: (string | number)[] = ['', 'Salio'];
    for (const dept of printDepts) {
      const val = (periodDeptTotals[dept]?.income || 0) - (periodDeptTotals[dept]?.expense || 0);
      jumlaSalio.push(val !== 0 ? formatPrintNum(val) : '');
      grandSalio += val;
    }
    jumlaSalio.push(formatPrintNum(grandSalio));
    jumlaSalio.push(pctSalioRemaining(grandSalio, grandMapato));

    const contentHtml = buildPrintTable(headers, rows, {
      totalRow: jumlaMapato,
      footers: [jumlaMatumizi, jumlaSalio],
      landscape: true,
      colAligns,
    });

    return {
      title,
      subtitle,
      orgInfo,
      orgLevel: ORG_LABELS[orgLevel],
      year,
      month: monthMode === 'single' ? month : undefined,
      contentHtml,
      mudirName: currentOrg?.mudirName,
      mudirSignature: currentOrg?.mudirSignature,
      mwekahazinaName: currentOrg?.mwekahazinaName,
      mwekahazinaSignature: currentOrg?.mwekahazinaSignature,
    };
  };

  const handlePrint = () => {
    openReportPrintPreview(buildPrintOptions());
  };

  const handleDownloadPDF = async () => {
    await downloadReportPDF(buildPrintOptions());
  };

  // ── Export to Excel ────────────────────────────────────
  const exportToExcel = async () => {
    const wsData: (string | number)[][] = [
      ['ANSAAR MUSLIM YOUTH CENTRE'],
      [`OFISI YA MUDIR - ${ORG_LABELS[orgLevel]} ${orgName.toUpperCase()}`],
      [`Fomu ya Mapato na Matumizi (Ki-Idara) kwa Mwaka: ${year}`],
      [],
      [
        'MWEZI',
        'MAELEZO',
        ...printDepts.map((d) => DEPT_SHORT[d] || d),
        'JUMLA',
        'ASILIMIA',
      ],
    ];

    for (const m of activeDisplayMonths) {
      const mData = monthlySummary[m] || {};

      // Mapato row
      const mapatoRow: (string | number)[] = [MONTHS[m - 1], 'Mapato'];
      let mapatoTotal = 0;
      for (const dept of printDepts) {
        const val = mData[dept]?.income || 0;
        mapatoRow.push(val);
        mapatoTotal += val;
      }
      mapatoRow.push(mapatoTotal);
      mapatoRow.push('');
      wsData.push(mapatoRow);

      // Matumizi row
      const matumiziRow: (string | number)[] = ['', 'Matumizi'];
      let matumiziTotal = 0;
      for (const dept of printDepts) {
        const val = mData[dept]?.expense || 0;
        matumiziRow.push(val);
        matumiziTotal += val;
      }
      matumiziRow.push(matumiziTotal);
      matumiziRow.push(pctExpenseOfIncome(matumiziTotal, mapatoTotal));
      wsData.push(matumiziRow);

      // Salio row
      const salioRow: (string | number)[] = ['', 'Salio'];
      let salioTotal = 0;
      for (const dept of printDepts) {
        const val = (mData[dept]?.income || 0) - (mData[dept]?.expense || 0);
        salioRow.push(val);
        salioTotal += val;
      }
      salioRow.push(salioTotal);
      salioRow.push(pctSalioRemaining(salioTotal, mapatoTotal));
      wsData.push(salioRow);
    }

    // JUMLA rows (kipindi kilichochaguliwa)
    const jumlaMapato: (string | number)[] = ['JUMLA', 'Mapato'];
    let grandMapato = 0;
    for (const dept of printDepts) {
      const val = periodDeptTotals[dept]?.income || 0;
      jumlaMapato.push(val);
      grandMapato += val;
    }
    jumlaMapato.push(grandMapato);
    jumlaMapato.push('100%');
    wsData.push(jumlaMapato);

    const jumlaMatumizi: (string | number)[] = ['', 'Matumizi'];
    let grandMatumizi = 0;
    for (const dept of printDepts) {
      const val = periodDeptTotals[dept]?.expense || 0;
      jumlaMatumizi.push(val);
      grandMatumizi += val;
    }
    jumlaMatumizi.push(grandMatumizi);
    jumlaMatumizi.push(pctExpenseOfIncome(grandMatumizi, grandMapato));
    wsData.push(jumlaMatumizi);

    const jumlaSalio: (string | number)[] = ['', 'Salio'];
    let grandSalio = 0;
    for (const dept of printDepts) {
      const val = (periodDeptTotals[dept]?.income || 0) - (periodDeptTotals[dept]?.expense || 0);
      jumlaSalio.push(val);
      grandSalio += val;
    }
    jumlaSalio.push(grandSalio);
    jumlaSalio.push(pctSalioRemaining(grandSalio, grandMapato));
    wsData.push(jumlaSalio);

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ki-Idara Mwaka');
    await saveWorkbookFile(wb, `Ki-Idara_Mwaka_${orgName}_${year}.xlsx`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-emerald-600" />
        <span className="ml-2 text-muted-foreground">Inapakia taarifa...</span>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-emerald-200 bg-linear-to-r from-emerald-50 via-white to-emerald-100 p-4 text-center space-y-1">
        <p className="text-xs font-semibold tracking-wide text-emerald-800 uppercase">ANSAAR MUSLIM YOUTH CENTRE</p>
        <h3 className="text-lg font-bold text-emerald-900">
          OFISI YA MUDIR - {ORG_LABELS[orgLevel]} {orgName.toUpperCase()}
        </h3>
        <p className="font-semibold text-emerald-800">
          Fomu ya Mapato na Matumizi (Ki-Idara) kwa Mwaka: {year}
          {monthMode === 'single' && month ? ` — Mwezi: ${MONTHS[month - 1]}` : ''}
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

      {/* Table */}
      <div className="border rounded-lg overflow-x-auto">
        <Table className="[&_th]:border [&_td]:border [&_th]:border-emerald-400 [&_td]:border-emerald-300">
          <TableHeader>
            <TableRow className="bg-emerald-800 hover:bg-emerald-800">
              <TableHead className="text-white font-bold w-28">MWEZI</TableHead>
              <TableHead className="text-white font-bold w-24">MAELEZO</TableHead>
              {printDepts.map((dept) => (
                <TableHead key={dept} className="text-white font-bold text-right">
                  {DEPT_SHORT[dept] || dept}
                </TableHead>
              ))}
              <TableHead className="text-white font-bold text-right">JUMLA</TableHead>
              <TableHead className="text-white font-bold text-right">ASILIMIA</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activeDisplayMonths.map((m) => {
              const mi = m - 1;
              const mData = monthlySummary[m] || {};

              let mapatoTotal = 0;
              const mapatoCells = printDepts.map((dept) => {
                const val = mData[dept]?.income || 0;
                mapatoTotal += val;
                return val;
              });

              let matumiziTotal = 0;
              const matumiziCells = printDepts.map((dept) => {
                const val = mData[dept]?.expense || 0;
                matumiziTotal += val;
                return val;
              });

              let salioTotal = 0;
              const salioCells = printDepts.map((dept) => {
                const val = (mData[dept]?.income || 0) - (mData[dept]?.expense || 0);
                salioTotal += val;
                return val;
              });

              const matumiziAsilimia = pctExpenseOfIncome(matumiziTotal, mapatoTotal);
              const salioAsilimia = pctSalioRemaining(salioTotal, mapatoTotal);

              return (
                <React.Fragment key={m}>
                  {/* Mapato row */}
                  <TableRow className={mi % 2 === 0 ? '' : 'bg-muted/30'}>
                    <TableCell className="font-medium" rowSpan={3}>
                      {MONTHS[m - 1]}
                    </TableCell>
                    <TableCell className="text-emerald-700 font-medium text-sm">Mapato</TableCell>
                    {mapatoCells.map((val, di) => (
                      <TableCell key={di} className="text-right text-sm">
                        {val > 0 ? formatNum(val) : ''}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-semibold">
                      {mapatoTotal > 0 ? formatNum(mapatoTotal) : ''}
                    </TableCell>
                    <TableCell className="text-right text-sm">100%</TableCell>
                  </TableRow>

                  {/* Matumizi row */}
                  <TableRow className={mi % 2 === 0 ? '' : 'bg-muted/30'}>
                    <TableCell className="text-red-700 font-medium text-sm">Matumizi</TableCell>
                    {matumiziCells.map((val, di) => (
                      <TableCell key={di} className="text-right text-sm">
                        {val > 0 ? formatNum(val) : ''}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-semibold">
                      {matumiziTotal > 0 ? formatNum(matumiziTotal) : ''}
                    </TableCell>
                    <TableCell className="text-right text-sm">{matumiziAsilimia}</TableCell>
                  </TableRow>

                  {/* Salio row */}
                  <TableRow className={mi % 2 === 0 ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : 'bg-muted/30'}>
                    <TableCell className="text-emerald-800 font-medium text-sm">Salio</TableCell>
                    {salioCells.map((val, di) => (
                      <TableCell
                        key={di}
                        className={`text-right text-sm font-medium ${
                          val < 0 ? 'text-red-600' : 'text-emerald-700'
                        }`}
                      >
                        {val !== 0 ? formatNum(val) : ''}
                      </TableCell>
                    ))}
                    <TableCell
                      className={`text-right font-bold ${
                        salioTotal < 0 ? 'text-red-600' : 'text-emerald-700'
                      }`}
                    >
                      {salioTotal !== 0 ? formatNum(salioTotal) : ''}
                    </TableCell>
                    <TableCell className="text-right text-sm">{salioAsilimia}</TableCell>
                  </TableRow>
                </React.Fragment>
              );
            })}

            {/* ── JUMLA rows ────────────────────────────── */}
            {(() => {
              let grandMapato = 0;
              const mapatoCells = printDepts.map((dept) => {
                const val = periodDeptTotals[dept]?.income || 0;
                grandMapato += val;
                return val;
              });

              let grandMatumizi = 0;
              const matumiziCells = printDepts.map((dept) => {
                const val = periodDeptTotals[dept]?.expense || 0;
                grandMatumizi += val;
                return val;
              });

              let grandSalio = 0;
              const salioCells = printDepts.map((dept) => {
                const val =
                  (periodDeptTotals[dept]?.income || 0) - (periodDeptTotals[dept]?.expense || 0);
                grandSalio += val;
                return val;
              });

              const grandMatumiziAsilimia = pctExpenseOfIncome(grandMatumizi, grandMapato);
              const grandSalioAsilimia = pctSalioRemaining(grandSalio, grandMapato);

              return (
                <React.Fragment>
                  <TableRow className="bg-emerald-900 text-white font-bold hover:bg-emerald-900">
                    <TableCell className="font-bold text-white" rowSpan={3}>
                      JUMLA
                    </TableCell>
                    <TableCell className="text-white font-bold">Mapato</TableCell>
                    {mapatoCells.map((val, di) => (
                      <TableCell key={di} className="text-right text-white">
                        {val > 0 ? formatNum(val) : ''}
                      </TableCell>
                    ))}
                    <TableCell className="text-right text-white font-bold">
                      {formatNum(grandMapato)}
                    </TableCell>
                    <TableCell className="text-right text-white">100%</TableCell>
                  </TableRow>

                  <TableRow className="bg-emerald-800 text-white font-bold hover:bg-emerald-800">
                    <TableCell className="text-white font-bold">Matumizi</TableCell>
                    {matumiziCells.map((val, di) => (
                      <TableCell key={di} className="text-right text-white">
                        {val > 0 ? formatNum(val) : ''}
                      </TableCell>
                    ))}
                    <TableCell className="text-right text-white font-bold">
                      {formatNum(grandMatumizi)}
                    </TableCell>
                    <TableCell className="text-right text-white">{grandMatumiziAsilimia}</TableCell>
                  </TableRow>

                  <TableRow className="bg-emerald-900 text-white font-bold hover:bg-emerald-900">
                    <TableCell className="text-white font-bold">Salio</TableCell>
                    {salioCells.map((val, di) => (
                      <TableCell key={di} className="text-right text-white">
                        {val !== 0 ? formatNum(val) : ''}
                      </TableCell>
                    ))}
                    <TableCell className="text-right text-white font-bold">
                      {formatNum(grandSalio)}
                    </TableCell>
                    <TableCell className="text-right text-white">{grandSalioAsilimia}</TableCell>
                  </TableRow>
                </React.Fragment>
              );
            })()}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
