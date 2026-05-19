'use client';

import { useState, useEffect } from 'react';
import { getMonthlySummary } from '@/lib/db-offline';
import { MONTHS, MONTHS_SHORT } from '@/lib/types';
import type { OrgLevel } from '@/lib/types';
import { useAuthStore } from '@/lib/store';
import { calculateOfflinePeriodBalance } from '@/lib/finance/offline-balance-engine';
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
import { Download, FileText, Printer, RefreshCw } from 'lucide-react';
import {
  downloadReportPDF,
  openReportPrintPreview,
  formatPrintNum,
  buildPrintTable,
} from '@/lib/print-report';
import * as XLSX from 'xlsx';

// ── Props ────────────────────────────────────────────────
interface AnnualSummaryReportProps {
  orgUnitId: number;
  year: number;
  orgLevel: OrgLevel;
  orgName: string;
  monthMode?: 'all' | 'single';
  month?: number;
}

// ── Helpers ──────────────────────────────────────────────
const ORG_LABELS: Record<OrgLevel, string> = {
  markaz: 'MARKAZ KUU',
  jimbo: 'JIMBO LA',
  tawi: 'TAWI LA',
};

function formatNum(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function officeLabel(orgLevel: OrgLevel, orgName: string) {
  if (orgLevel === 'tawi') return `OFISI YA MUDIR - TAWI LA ${orgName.toUpperCase()}`;
  if (orgLevel === 'jimbo') return `OFISI YA MUDIR - JIMBO LA ${orgName.toUpperCase()}`;
  return `OFISI YA MUDIR - MARKAZ KUU ${orgName.toUpperCase()}`;
}

// ── Component ────────────────────────────────────────────
export default function AnnualSummaryReport({
  orgUnitId,
  year,
  orgLevel,
  orgName,
  monthMode = 'all',
  month,
}: AnnualSummaryReportProps) {
  const currentOrg = useAuthStore((s) => s.currentOrg);
  const generatedAt = new Date().toLocaleString('sw-TZ');
  const [incomeByMonth, setIncomeByMonth] = useState<number[]>(new Array(12).fill(0));
  const [expenseByMonth, setExpenseByMonth] = useState<number[]>(new Array(12).fill(0));
  const [openingBalance, setOpeningBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [orgUnitId, year]);

  const loadData = async () => {
    setLoading(true);
    try {
      const { incomeByMonth, expenseByMonth } = await getMonthlySummary(orgUnitId, year);
      const balance = await calculateOfflinePeriodBalance(orgUnitId, year);
      setIncomeByMonth(incomeByMonth);
      setExpenseByMonth(expenseByMonth);
      setOpeningBalance(balance.openingBalance);
    } finally {
      setLoading(false);
    }
  };

  // ── Calculations ───────────────────────────────────────
  const bakaa = openingBalance;

  // Running total of income (MAPATO JUMLA)
  const mapatoJumla: number[] = [];
  let runningTotal = 0;
  for (let i = 0; i < 12; i++) {
    runningTotal += incomeByMonth[i];
    mapatoJumla.push(runningTotal);
  }

  // Balance (SALIO = BAKAA + MAPATO JUMLA - MATUMIZI)
  const salio: number[] = [];
  for (let i = 0; i < 12; i++) {
    salio.push(bakaa + mapatoJumla[i] - expenseByMonth[i]);
  }

  const totalMapato = incomeByMonth.reduce((s, v) => s + v, 0);
  const totalMatumizi = expenseByMonth.reduce((s, v) => s + v, 0);
  const totalMapatoJumla = mapatoJumla[11];
  const totalSalio = bakaa + totalMapatoJumla - totalMatumizi;
  const asilimia = totalMapato > 0 ? ((totalMatumizi / totalMapato) * 100).toFixed(1) : '0.0';

  // Determine which month indices to display (hide months with zero income AND zero expense)
  const allMonthIndices: number[] =
    monthMode === 'single' && month != null && month >= 1 && month <= 12
      ? [month - 1]
      : Array.from({ length: 12 }, (_, i) => i);

  const displayMonthIndices = allMonthIndices.filter(
    (i) => incomeByMonth[i] !== 0 || expenseByMonth[i] !== 0
  );

  // ── Print / PDF ────────────────────────────────────────
  const buildPrintOptions = () => {
    const orgInfo = officeLabel(orgLevel, orgName);
    const title = 'TAARIFA YA MAPATO NA MATUMIZI KWA MWAKA';
    const subtitle = monthMode === 'single' && month
      ? `Mwezi: ${MONTHS[month - 1]}`
      : 'Mwaka Kamili';

    // Build table rows for print
    const headers = ['MWEZI', 'MAPATO', 'MAPATO JUMLA', 'MATUMIZI', 'SALIO'];
    const rows: (string | number)[][] = [];

    // Month rows
    for (const i of displayMonthIndices) {
      rows.push([
        MONTHS[i],
        formatPrintNum(incomeByMonth[i]),
        formatPrintNum(mapatoJumla[i]),
        formatPrintNum(expenseByMonth[i]),
        formatPrintNum(salio[i]),
      ]);
    }

    // Totals
    const totalRow: (string | number)[] = [
      'JUMLA',
      formatPrintNum(totalMapato),
      formatPrintNum(totalMapatoJumla),
      formatPrintNum(totalMatumizi),
      formatPrintNum(totalSalio),
    ];

    const footerRows: (string | number)[][] = [
      ['ASILIMIA (%)', '100%', '—', `${asilimia}%`, '—'],
    ];

    const colAligns: ('left' | 'center' | 'right')[] = ['left', 'right', 'right', 'right', 'right'];

    const contentHtml = buildPrintTable(headers, rows, {
      totalRow,
      footers: footerRows,
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
  const exportToExcel = () => {
    const wsData: (string | number)[][] = [
      ['ANSAAR MUSLIM YOUTH CENTRE'],
      [officeLabel(orgLevel, orgName)],
      [`TAARIFA YA MAPATO NA MATUMIZI KWA MWAKA: ${year}`],
      [],
      ['MWEZI', 'MAPATO', 'MAPATO JUMLA', 'MATUMIZI', 'SALIO'],
    ];

    // Month rows
    for (const i of displayMonthIndices) {
      wsData.push([
        MONTHS[i],
        incomeByMonth[i],
        mapatoJumla[i],
        expenseByMonth[i],
        salio[i],
      ]);
    }

    // JUMLA row
    wsData.push(['JUMLA', totalMapato, totalMapatoJumla, totalMatumizi, totalSalio]);

    // ASILIMIA row
    wsData.push(['ASILIMIA (%)', '', '', `${asilimia}%`, '']);

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Taarifa ya Mwaka');
    XLSX.writeFile(wb, `Taarifa_Mwaka_${orgName}_${year}.xlsx`);
  };

  // ── Render ─────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-emerald-600" />
        <span className="ml-2 text-muted-foreground">Inapakia taarifa...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-emerald-200 bg-linear-to-r from-emerald-50 via-white to-emerald-100 p-4 text-center space-y-1">
        <p className="text-xs font-semibold tracking-wide text-emerald-800 uppercase">ANSAAR MUSLIM YOUTH CENTRE</p>
        <h3 className="text-lg font-bold text-emerald-900">
          {officeLabel(orgLevel, orgName)}
        </h3>
        <p className="font-semibold text-emerald-800">
          TAARIFA YA MAPATO NA MATUMIZI KWA MWAKA
        </p>
        <p className="text-xs text-muted-foreground">
          Kwa Mwaka: {year}{monthMode === 'single' && month ? ` | Mwezi: ${MONTHS[month - 1]}` : ' | Miezi yote'}
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

      {/* Signature area */}
      <div className="flex justify-between gap-8 mt-8 pt-6 border-t border-emerald-200">
        <div className="text-center flex-1">
          <div className="border-t border-gray-400 mt-12 pt-2 text-sm text-gray-700 space-y-2">
            Mudir: {currentOrg?.mudirName || '_________________________'}
            <div>Sahihi: {currentOrg?.mudirSignature || '_________________________'}</div>
          </div>
        </div>
        <div className="text-center flex-1">
          <div className="border-t border-gray-400 mt-12 pt-2 text-sm text-gray-700 space-y-2">
            Mwekahazina: {currentOrg?.mwekahazinaName || '_________________________'}
            <div>Sahihi: {currentOrg?.mwekahazinaSignature || '_________________________'}</div>
          </div>
        </div>
        <div className="text-center flex-1">
          <div className="border-t border-gray-400 mt-12 pt-2 text-sm text-gray-700">
            Tarehe: _________________________
          </div>
        </div>
      </div>

      {/* Report table */}
      <div className="border rounded-lg overflow-x-auto">
        <Table className="[&_th]:border [&_td]:border [&_th]:border-emerald-400 [&_td]:border-emerald-300">
          <TableHeader>
            <TableRow className="bg-emerald-800 hover:bg-emerald-800">
              <TableHead className="text-white font-bold w-32">MWEZI</TableHead>
              <TableHead className="text-white font-bold text-right">MAPATO</TableHead>
              <TableHead className="text-white font-bold text-right">MAPATO JUMLA</TableHead>
              <TableHead className="text-white font-bold text-right">MATUMIZI</TableHead>
              <TableHead className="text-white font-bold text-right">SALIO</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Month rows */}
            {displayMonthIndices.map((i) => (
              <TableRow key={MONTHS[i]} className={i % 2 === 1 ? 'bg-muted/30' : ''}>
                <TableCell className="font-medium">{MONTHS[i]}</TableCell>
                <TableCell className="text-right">{formatNum(incomeByMonth[i])}</TableCell>
                <TableCell className="text-right font-medium">{formatNum(mapatoJumla[i])}</TableCell>
                <TableCell className="text-right">{formatNum(expenseByMonth[i])}</TableCell>
                <TableCell className={`text-right font-semibold ${salio[i] < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                  {formatNum(salio[i])}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            {/* JUMLA row */}
            <TableRow className="bg-emerald-900 text-white font-bold hover:bg-emerald-900">
              <TableCell className="font-bold text-white">JUMLA</TableCell>
              <TableCell className="text-right text-white">{formatNum(totalMapato)}</TableCell>
              <TableCell className="text-right text-white">{formatNum(totalMapatoJumla)}</TableCell>
              <TableCell className="text-right text-white">{formatNum(totalMatumizi)}</TableCell>
              <TableCell className={`text-right font-bold ${totalSalio < 0 ? 'text-red-300' : 'text-emerald-200'}`}>
                {formatNum(totalSalio)}
              </TableCell>
            </TableRow>
            {/* ASILIMIA row */}
            <TableRow className="bg-emerald-800 text-white hover:bg-emerald-800">
              <TableCell className="font-bold text-white">ASILIMIA (%)</TableCell>
              <TableCell className="text-right text-white">100%</TableCell>
              <TableCell className="text-right text-white">—</TableCell>
              <TableCell className="text-right text-white">{asilimia}%</TableCell>
              <TableCell className="text-right text-white">—</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
