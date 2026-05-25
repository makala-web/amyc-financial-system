'use client';

import React, { useState, useEffect } from 'react';
import { getChildOrgUnits, getMonthlySummary, getDepartmentalSummary, getReportsForUnitPeriod } from '@/lib/db-offline';
import { MONTHS_SHORT, DEPARTMENTS } from '@/lib/types';
import type { OrgLevel, OrgUnit } from '@/lib/types';
import type { BranchReportSnapshot } from '@/lib/exporters/branch-export';
import { calculateOfflinePeriodBalance } from '@/lib/finance/offline-balance-engine';
import { parseBranchSnapshotMonth } from '@/lib/reports/branch-snapshot-month';
import {
  printReport,
  downloadReportPDF,
  formatPrintNum,
  buildPrintTable,
} from '@/lib/print-report';
import { useAuthStore } from '@/lib/store';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, Printer, RefreshCw, Building2, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';
import { saveWorkbookFile } from '@/lib/export-workbook';
import {
  pctExpenseOfIncome,
  pctSalioRemaining,
} from '@/lib/reports/finance-percentages';

// ── Props ────────────────────────────────────────────────
interface ConsolidationReportProps {
  orgUnitId: number;
  year: number;
  orgLevel: OrgLevel;
  orgName: string;
  subType: 'income' | 'expense' | 'full' | 'consolidation_departmental';
  selectedChildIds: Set<number>;
  monthMode?: 'all' | 'single';
  month?: number;
}

// ── Helpers ──────────────────────────────────────────────
const ORG_LABELS: Record<OrgLevel, string> = {
  markaz: 'MARKAZ KUU',
  jimbo: 'JIMBO LA',
  tawi: 'TAWI LA',
};

const CHILD_LABEL: Record<OrgLevel, string> = {
  markaz: 'JIMBO',
  jimbo: 'TAWI',
  tawi: '',
};

const CHILD_PLURAL: Record<OrgLevel, string> = {
  markaz: 'MAJIMBO',
  jimbo: 'MATAWI',
  tawi: '',
};

// Department short labels
const DEPT_SHORT: Record<string, string> = {
  Daawah: 'Daawa',
  Elimu: 'Elimu',
  'Ustawi wa Jamii': 'Ustawi',
  'Uchumi & Miradi': 'Uch & Mip',
  Habari: 'Habari',
};

const DEPT_KEYS = DEPARTMENTS as readonly string[];

const MONTH_NAMES = [
  'Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni',
  'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba',
];

function formatNum(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Data types ───────────────────────────────────────────
interface ChildData {
  org: OrgUnit;
  openingBalance: number;
  incomeByMonth: number[];
  expenseByMonth: number[];
  totalIncome: number;
  totalExpense: number;
  deptSummary: Record<string, { income: number; expense: number }>;
}

interface MarkazOwnData {
  openingBalance: number;
  incomeByMonth: number[];
  expenseByMonth: number[];
  totalIncome: number;
  totalExpense: number;
  deptSummary: Record<string, { income: number; expense: number }>;
}

type StoredRegionalReportNine = {
  openingBalance?: number;
  monthlyRows?: Array<{
    month: number;
    income: number;
    expense: number;
  }>;
  departmentRows?: Array<{
    department: string;
    income: number;
    expense: number;
  }>;
  totalIncome?: number;
  totalExpense?: number;
};

function parseStoredBranchState(raw: string | undefined) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as {
      branchSnapshots?: Record<string, BranchReportSnapshot>;
    };
  } catch {
    return null;
  }
}

async function buildChildFromBranchSnapshots(
  regionId: number,
  branch: OrgUnit,
  year: number
): Promise<ChildData | null> {
  const records = await getReportsForUnitPeriod('regionalReports', regionId, year);
  const yearRecords = records.filter((record) => record.reportType === 'regional' && record.year === year);
  const snapshots: Array<{ snapshot: BranchReportSnapshot; recordMonth: number }> = [];

  for (const record of yearRecords) {
    const stored = parseStoredBranchState(record.dataJson);
    const snapshot = stored?.branchSnapshots?.[String(branch.id)];
    if (!snapshot) continue;
    snapshots.push({ snapshot, recordMonth: record.month || 0 });
  }

  if (snapshots.length === 0) return null;

  const incomeByMonth = new Array(12).fill(0);
  const expenseByMonth = new Array(12).fill(0);
  const deptSummary: Record<string, { income: number; expense: number }> = {};
  for (const dept of DEPT_KEYS) {
    deptSummary[dept] = { income: 0, expense: 0 };
  }

  for (const { snapshot, recordMonth } of snapshots) {
    const m = parseBranchSnapshotMonth(snapshot.month) || recordMonth || 0;
    if (m >= 1 && m <= 12) {
      incomeByMonth[m - 1] += snapshot.income.total;
      expenseByMonth[m - 1] += snapshot.expenses.total;
    }

    const detailedDepartments = snapshot.departmentDetails;
    if (detailedDepartments && Object.keys(detailedDepartments).length > 0) {
      for (const [dept, totals] of Object.entries(detailedDepartments)) {
        if (!deptSummary[dept]) {
          deptSummary[dept] = { income: 0, expense: 0 };
        }
        deptSummary[dept].income += totals.income || 0;
        deptSummary[dept].expense += totals.expense || 0;
      }
      continue;
    }

    for (const [dept, net] of Object.entries(snapshot.departments || {})) {
      if (!deptSummary[dept]) {
        deptSummary[dept] = { income: 0, expense: 0 };
      }
      if (net >= 0) {
        deptSummary[dept].income += net;
      } else {
        deptSummary[dept].expense += Math.abs(net);
      }
    }
  }

  return {
    org: branch,
    openingBalance: 0,
    incomeByMonth,
    expenseByMonth,
    totalIncome: incomeByMonth.reduce((s, v) => s + v, 0),
    totalExpense: expenseByMonth.reduce((s, v) => s + v, 0),
    deptSummary,
  };
}

async function buildChildFromRegionalReportSnapshot(region: OrgUnit, year: number): Promise<ChildData | null> {
  const rows = await getReportsForUnitPeriod('regionalReports', region.id!, year);
  const parsedRows = rows
    .filter((r) => r.year === year && r.reportType === 'consolidated_master')
    .map((r) => {
      try {
        return JSON.parse(r.dataJson || '{}') as StoredRegionalReportNine & { month?: number };
      } catch {
        return null;
      }
    })
    .filter((r): r is (StoredRegionalReportNine & { month?: number }) => Boolean(r));

  if (parsedRows.length === 0) return null;

  const incomeByMonth = new Array(12).fill(0);
  const expenseByMonth = new Array(12).fill(0);
  const deptSummary: Record<string, { income: number; expense: number }> = {};
  for (const dept of DEPT_KEYS) {
    deptSummary[dept] = { income: 0, expense: 0 };
  }

  let openingBalance = 0;
  let totalIncome = 0;
  let totalExpense = 0;

  for (const parsed of parsedRows) {
    openingBalance += parsed.openingBalance || 0;
    totalIncome += parsed.totalIncome || 0;
    totalExpense += parsed.totalExpense || 0;

    for (const row of parsed.monthlyRows || []) {
      if (row.month >= 1 && row.month <= 12) {
        incomeByMonth[row.month - 1] += row.income || 0;
        expenseByMonth[row.month - 1] += row.expense || 0;
      }
    }

    for (const row of parsed.departmentRows || []) {
      if (!deptSummary[row.department]) {
        deptSummary[row.department] = { income: 0, expense: 0 };
      }
      deptSummary[row.department].income += row.income || 0;
      deptSummary[row.department].expense += row.expense || 0;
    }
  }

  if (totalIncome === 0) totalIncome = incomeByMonth.reduce((s, v) => s + v, 0);
  if (totalExpense === 0) totalExpense = expenseByMonth.reduce((s, v) => s + v, 0);

  return {
    org: region,
    openingBalance,
    incomeByMonth,
    expenseByMonth,
    totalIncome,
    totalExpense,
    deptSummary,
  };
}

// ── Component ────────────────────────────────────────────
function buildEmptyChildData(org: OrgUnit): ChildData {
  const deptSummary: Record<string, { income: number; expense: number }> = {};
  for (const dept of DEPT_KEYS) {
    deptSummary[dept] = { income: 0, expense: 0 };
  }

  return {
    org,
    openingBalance: 0,
    incomeByMonth: new Array(12).fill(0),
    expenseByMonth: new Array(12).fill(0),
    totalIncome: 0,
    totalExpense: 0,
    deptSummary,
  };
}

export default function ConsolidationReport({
  orgUnitId,
  year,
  orgLevel,
  orgName,
  subType,
  selectedChildIds,
  monthMode = 'all',
  month,
}: ConsolidationReportProps) {
  const currentOrg = useAuthStore((s) => s.currentOrg);
  const generatedAt = new Date().toLocaleString('sw-TZ');
  const [childData, setChildData] = useState<ChildData[]>([]);
  const [markazOwnData, setMarkazOwnData] = useState<MarkazOwnData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasNoChildren, setHasNoChildren] = useState(false);

  const isSingleMonth = monthMode === 'single' && month && month > 0;
  const isMarkaz = orgLevel === 'markaz';
  const isJimbo = orgLevel === 'jimbo';
  // Both Markaz and Jimbo include their own data in consolidation
  const includeOwnData = isMarkaz || isJimbo;

  useEffect(() => {
    loadData();
  }, [orgUnitId, year, selectedChildIds, monthMode, month]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load own data for Markaz or Jimbo level (both include in consolidation)
      if (includeOwnData) {
        const { incomeByMonth, expenseByMonth } = await getMonthlySummary(orgUnitId, year);
        const ownPeriod = await calculateOfflinePeriodBalance(orgUnitId, year);
        const deptSummary = await getDepartmentalSummary(orgUnitId, year);
        setMarkazOwnData({
          openingBalance: ownPeriod.openingBalance,
          incomeByMonth,
          expenseByMonth,
          totalIncome: incomeByMonth.reduce((s, v) => s + v, 0),
          totalExpense: expenseByMonth.reduce((s, v) => s + v, 0),
          deptSummary,
        });
      }

      const allChildren = await getChildOrgUnits(orgUnitId);

      if (allChildren.length === 0 && !includeOwnData) {
        setHasNoChildren(true);
        setChildData([]);
        setLoading(false);
        return;
      }

      setHasNoChildren(false);

      const selected = allChildren.filter(
        (c) => c.isActive && selectedChildIds.has(c.id!)
      );

      const data: ChildData[] = [];
      for (const child of selected) {
        if (isMarkaz && child.type === 'jimbo') {
          const fromRegionalSnapshot = await buildChildFromRegionalReportSnapshot(child, year);
          if (fromRegionalSnapshot) {
            data.push(fromRegionalSnapshot);
            continue;
          }
          data.push(buildEmptyChildData(child));
          continue;
        }

        if (isJimbo && child.type === 'tawi') {
          const fromSnapshots = await buildChildFromBranchSnapshots(orgUnitId, child, year);
          if (fromSnapshots) {
            data.push(fromSnapshots);
            continue;
          }
        }

        const { incomeByMonth, expenseByMonth } = await getMonthlySummary(child.id!, year);
        const childPeriod = await calculateOfflinePeriodBalance(child.id!, year);
        const deptSummary = await getDepartmentalSummary(child.id!, year);
        data.push({
          org: child,
          openingBalance: childPeriod.openingBalance,
          incomeByMonth,
          expenseByMonth,
          totalIncome: incomeByMonth.reduce((s, v) => s + v, 0),
          totalExpense: expenseByMonth.reduce((s, v) => s + v, 0),
          deptSummary,
        });
      }
      setChildData(data);
    } finally {
      setLoading(false);
    }
  };

  // ── Title based on sub-type ───────────────────────────
  const getTitle = () => {
    const base = `OFISI YA MUDIR - ${ORG_LABELS[orgLevel]} ${orgName.toUpperCase()}`;
    const monthSuffix = isSingleMonth ? ` - ${MONTH_NAMES[month! - 1]}` : '';
    switch (subType) {
      case 'income':
        return {
          header: base,
          title: `MUUNGANIKO WA MAPATO KWA MWAKA: ${year}${monthSuffix}`,
        };
      case 'expense':
        return {
          header: base,
          title: `MUUNGANIKO WA MATUMIZI KWA MWAKA: ${year}${monthSuffix}`,
        };
      case 'full':
        return {
          header: base,
          title: `MUUNGANIKO KAMILI KWA MWAKA: ${year}${monthSuffix}`,
        };
      case 'consolidation_departmental':
        return {
          header: base,
          title: `TAARIFA YA KI-IDARA MUUNGANIKO KWA MWAKA: ${year}${monthSuffix}`,
        };
    }
  };

  const { header, title } = getTitle();

  // ── Build the combined data list (Markaz first, then children) ──
  interface RowData {
    name: string;
    isMarkazOwn: boolean;
    openingBalance: number;
    incomeByMonth: number[];
    expenseByMonth: number[];
    totalIncome: number;
    totalExpense: number;
    deptSummary: Record<string, { income: number; expense: number }>;
  }

  const allRows: RowData[] = [];

  if (includeOwnData && markazOwnData) {
    const ownLabel = isMarkaz ? `${orgName} (Markaz)` : `${orgName} (Jimbo)`;
    allRows.push({
      name: ownLabel,
      isMarkazOwn: true,
      openingBalance: markazOwnData.openingBalance,
      incomeByMonth: markazOwnData.incomeByMonth,
      expenseByMonth: markazOwnData.expenseByMonth,
      totalIncome: markazOwnData.totalIncome,
      totalExpense: markazOwnData.totalExpense,
      deptSummary: markazOwnData.deptSummary,
    });
  }

  childData.forEach((cd) => {
    allRows.push({
      name: cd.org.name,
      isMarkazOwn: false,
      openingBalance: cd.openingBalance,
      incomeByMonth: cd.incomeByMonth,
      expenseByMonth: cd.expenseByMonth,
      totalIncome: cd.totalIncome,
      totalExpense: cd.totalExpense,
      deptSummary: cd.deptSummary,
    });
  });

  // ── Consolidated totals ───────────────────────────────
  const consolidatedIncome = new Array(12).fill(0);
  const consolidatedExpense = new Array(12).fill(0);

  allRows.forEach((row) => {
    for (let i = 0; i < 12; i++) {
      consolidatedIncome[i] += row.incomeByMonth[i];
      consolidatedExpense[i] += row.expenseByMonth[i];
    }
  });

  // Consolidated departmental summary
  const consolidatedDeptSummary: Record<string, { income: number; expense: number }> = {};
  allRows.forEach((row) => {
    for (const dept of DEPT_KEYS) {
      if (!consolidatedDeptSummary[dept]) {
        consolidatedDeptSummary[dept] = { income: 0, expense: 0 };
      }
      consolidatedDeptSummary[dept].income += row.deptSummary[dept]?.income || 0;
      consolidatedDeptSummary[dept].expense += row.deptSummary[dept]?.expense || 0;
    }
  });

  const totalConsolidatedIncome = consolidatedIncome.reduce((s, v) => s + v, 0);
  const totalConsolidatedExpense = consolidatedExpense.reduce((s, v) => s + v, 0);
  const totalConsolidatedSalio = totalConsolidatedIncome - totalConsolidatedExpense;
  const totalConsolidatedOpening = allRows.reduce((sum, row) => sum + row.openingBalance, 0);

  // ── Month columns to display ──────────────────────────
  const monthIndices = isSingleMonth && month ? [month - 1] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const monthLabels = monthIndices.map((i) => MONTHS_SHORT[i]);

  const rowPeriodIncome = (row: { incomeByMonth: number[] }) =>
    monthIndices.reduce((sum, mi) => sum + row.incomeByMonth[mi], 0);
  const rowPeriodExpense = (row: { expenseByMonth: number[] }) =>
    monthIndices.reduce((sum, mi) => sum + row.expenseByMonth[mi], 0);

  const periodConsolidatedIncome = monthIndices.reduce((sum, mi) => sum + consolidatedIncome[mi], 0);
  const periodConsolidatedExpense = monthIndices.reduce((sum, mi) => sum + consolidatedExpense[mi], 0);
  const periodConsolidatedSalio = periodConsolidatedIncome - periodConsolidatedExpense;
  const displayConsolidatedIncome = isSingleMonth ? periodConsolidatedIncome : totalConsolidatedIncome;
  const displayConsolidatedExpense = isSingleMonth ? periodConsolidatedExpense : totalConsolidatedExpense;
  const displayConsolidatedSalio = isSingleMonth ? periodConsolidatedSalio : totalConsolidatedSalio;

  // ── Row label based on level ──────────────────────────
  const rowLabel = isMarkaz ? 'KITENGO' : CHILD_LABEL[orgLevel] || 'KITENGO';

  // ── Print handler ────────────────────────────────────────
  const buildPrintContentHtml = () => {
    const isLandscape = true;

    let contentHtml = '';

    if (subType === 'consolidation_departmental') {
      // Departmental consolidation format
      const headers = [
        rowLabel,
        'MAELEZO',
        ...DEPT_KEYS.map((d) => DEPT_SHORT[d] || d),
        'JUMLA',
        'ASILIMIA',
      ];

      const rows: (string | number)[][] = [];
      allRows.forEach((row) => {
        // Mapato
        let mapatoTotal = 0;
        const mapatoRow: (string | number)[] = [row.name, 'Mapato'];
        for (const dept of DEPT_KEYS) {
          const val = row.deptSummary[dept]?.income || 0;
          mapatoRow.push(val > 0 ? formatPrintNum(val) : '');
          mapatoTotal += val;
        }
        mapatoRow.push(mapatoTotal > 0 ? formatPrintNum(mapatoTotal) : '');
        mapatoRow.push(totalConsolidatedIncome > 0
          ? ((mapatoTotal / totalConsolidatedIncome) * 100).toFixed(1) + '%'
          : '0%');
        rows.push(mapatoRow);

        // Matumizi
        let matumiziTotal = 0;
        const matumiziRow: (string | number)[] = ['', 'Matumizi'];
        for (const dept of DEPT_KEYS) {
          const val = row.deptSummary[dept]?.expense || 0;
          matumiziRow.push(val > 0 ? formatPrintNum(val) : '');
          matumiziTotal += val;
        }
        matumiziRow.push(matumiziTotal > 0 ? formatPrintNum(matumiziTotal) : '');
        matumiziRow.push(totalConsolidatedExpense > 0
          ? ((matumiziTotal / totalConsolidatedExpense) * 100).toFixed(1) + '%'
          : '0%');
        rows.push(matumiziRow);

        // Salio
        let salioTotal = 0;
        const salioRow: (string | number)[] = ['', 'Salio'];
        for (const dept of DEPT_KEYS) {
          const val = (row.deptSummary[dept]?.income || 0) - (row.deptSummary[dept]?.expense || 0);
          salioRow.push(val !== 0 ? formatPrintNum(val) : '');
          salioTotal += val;
        }
        salioRow.push(salioTotal !== 0 ? formatPrintNum(salioTotal) : '');
        salioRow.push('—');
        rows.push(salioRow);
      });

      // JUMLA rows
      let grandMapato = 0;
      const jumlaMapato: (string | number)[] = ['JUMLA', 'Mapato'];
      for (const dept of DEPT_KEYS) {
        const val = consolidatedDeptSummary[dept]?.income || 0;
        jumlaMapato.push(val > 0 ? formatPrintNum(val) : '');
        grandMapato += val;
      }
      jumlaMapato.push(formatPrintNum(grandMapato));
      jumlaMapato.push('100%');

      let grandMatumizi = 0;
      const jumlaMatumizi: (string | number)[] = ['', 'Matumizi'];
      for (const dept of DEPT_KEYS) {
        const val = consolidatedDeptSummary[dept]?.expense || 0;
        jumlaMatumizi.push(val > 0 ? formatPrintNum(val) : '');
        grandMatumizi += val;
      }
      jumlaMatumizi.push(formatPrintNum(grandMatumizi));
      jumlaMatumizi.push(grandMapato > 0
        ? ((grandMatumizi / grandMapato) * 100).toFixed(1) + '%'
        : '0%');

      let grandSalio = 0;
      const jumlaSalio: (string | number)[] = ['', 'Salio'];
      for (const dept of DEPT_KEYS) {
        const val = (consolidatedDeptSummary[dept]?.income || 0) - (consolidatedDeptSummary[dept]?.expense || 0);
        jumlaSalio.push(val !== 0 ? formatPrintNum(val) : '');
        grandSalio += val;
      }
      jumlaSalio.push(formatPrintNum(grandSalio));
      jumlaSalio.push('—');

      contentHtml = buildPrintTable(headers, rows, {
        totalRow: jumlaMapato,
        footers: [jumlaMatumizi, jumlaSalio],
        landscape: isLandscape,
        colAligns: ['left', 'left', ...DEPT_KEYS.map(() => 'right' as const), 'right', 'right'],
      });
    } else if (subType === 'income' || subType === 'expense') {
      const field = subType;
      const values = field === 'income' ? 'incomeByMonth' : 'expenseByMonth';
      const totals = field === 'income' ? 'totalIncome' : 'totalExpense';
      const consolidated = field === 'income' ? consolidatedIncome : consolidatedExpense;
      const grandTotal = field === 'income' ? displayConsolidatedIncome : displayConsolidatedExpense;

      const headers = [
        rowLabel,
        'SALIO LA MWANZO',
        ...monthLabels,
        'JUMLA',
        'ASILIMIA',
      ];

      const rows: (string | number)[][] = allRows.map((row) => {
        const rowPeriodTotal = field === 'income' ? rowPeriodIncome(row) : rowPeriodExpense(row);
        const asilimia = grandTotal > 0
          ? ((rowPeriodTotal / grandTotal) * 100).toFixed(1) + '%'
          : '0%';

        return [
          row.name,
          formatPrintNum(row.openingBalance),
          ...monthIndices.map((mi) => row[values][mi] > 0
            ? formatPrintNum(row[values][mi])
            : ''),
          (field === 'income' ? rowPeriodIncome(row) : rowPeriodExpense(row)) > 0
            ? formatPrintNum(field === 'income' ? rowPeriodIncome(row) : rowPeriodExpense(row))
            : '',
          asilimia,
        ];
      });

      const totalRow = [
        'JUMLA',
        formatPrintNum(totalConsolidatedOpening),
        ...monthIndices.map((mi) => consolidated[mi] > 0 ? formatPrintNum(consolidated[mi]) : ''),
        formatPrintNum(grandTotal),
        '100%',
      ];

      const asilimiaRow = [
        'ASILIMIA',
        '—',
        ...monthIndices.map((mi) => {
          const pct = grandTotal > 0
            ? ((consolidated[mi] / grandTotal) * 100).toFixed(1) + '%'
            : '0%';
          return consolidated[mi] > 0 ? pct : '';
        }),
        '100%',
        '—',
      ];

      contentHtml = buildPrintTable(headers, rows, {
        totalRow,
        footers: [asilimiaRow],
        landscape: isLandscape,
        colAligns: ['left', 'right', ...monthLabels.map(() => 'right' as const), 'right', 'right'],
      });
    } else {
      // Full consolidation
      const headers = [
        rowLabel,
        'AINA',
        'SALIO LA MWANZO',
        ...monthLabels,
        'JUMLA',
        'ASILIMIA',
      ];

      const rows: (string | number)[][] = [];
      allRows.forEach((row) => {
        const mapatoAsilimia = totalConsolidatedIncome > 0
          ? ((row.totalIncome / totalConsolidatedIncome) * 100).toFixed(1) + '%'
          : '0%';
        const matumiziAsilimia = totalConsolidatedExpense > 0
          ? ((row.totalExpense / totalConsolidatedExpense) * 100).toFixed(1) + '%'
          : '0%';

        // Mapato
        rows.push([
          row.name,
          'Mapato',
          formatPrintNum(row.openingBalance),
          ...monthIndices.map((mi) => row.incomeByMonth[mi] > 0 ? formatPrintNum(row.incomeByMonth[mi]) : ''),
          row.totalIncome > 0 ? formatPrintNum(row.totalIncome) : '',
          mapatoAsilimia,
        ]);

        // Matumizi
        rows.push([
          '',
          'Matumizi',
          '',
          ...monthIndices.map((mi) => row.expenseByMonth[mi] > 0 ? formatPrintNum(row.expenseByMonth[mi]) : ''),
          row.totalExpense > 0 ? formatPrintNum(row.totalExpense) : '',
          matumiziAsilimia,
        ]);

        // Salio
        const totalSalio = row.totalIncome - row.totalExpense;
        rows.push([
          '',
          'Salio',
          '',
          ...monthIndices.map((mi) => {
            const val = row.incomeByMonth[mi] - row.expenseByMonth[mi];
            return val !== 0 ? formatPrintNum(val) : '';
          }),
          formatPrintNum(totalSalio),
          '—',
        ]);
      });

      // JUMLA rows
      const totalMapato = [
        'JUMLA',
        'Mapato',
        formatPrintNum(totalConsolidatedOpening),
        ...monthIndices.map((mi) => consolidatedIncome[mi] > 0 ? formatPrintNum(consolidatedIncome[mi]) : ''),
        formatPrintNum(totalConsolidatedIncome),
        '100%',
      ];
      const totalMatumizi = [
        '',
        'Matumizi',
        '',
        ...monthIndices.map((mi) => consolidatedExpense[mi] > 0 ? formatPrintNum(consolidatedExpense[mi]) : ''),
        formatPrintNum(totalConsolidatedExpense),
        totalConsolidatedIncome > 0
          ? ((totalConsolidatedExpense / totalConsolidatedIncome) * 100).toFixed(1) + '%'
          : '0%',
      ];
      const totalSalioRow = [
        '',
        'Salio',
        '',
        ...monthIndices.map((mi) => {
          const val = consolidatedIncome[mi] - consolidatedExpense[mi];
          return val !== 0 ? formatPrintNum(val) : '';
        }),
        formatPrintNum(totalConsolidatedSalio),
        '—',
      ];

      contentHtml = buildPrintTable(headers, rows, {
        totalRow: totalMapato,
        footers: [totalMatumizi, totalSalioRow],
        landscape: isLandscape,
        colAligns: ['left', 'left', 'right', ...monthLabels.map(() => 'right' as const), 'right', 'right'],
      });
    }

    return contentHtml;
  };

  const handlePrint = () => {
    const contentHtml = buildPrintContentHtml();
    printReport({
      title: title,
      subtitle: isSingleMonth && month ? MONTH_NAMES[month - 1] : `Mwaka: ${year}`,
      orgInfo: header,
      orgLevel: ORG_LABELS[orgLevel],
      year,
      month: isSingleMonth ? month : undefined,
      contentHtml,
      mudirName: currentOrg?.mudirName,
      mudirSignature: currentOrg?.mudirSignature,
      mwekahazinaName: currentOrg?.mwekahazinaName,
      mwekahazinaSignature: currentOrg?.mwekahazinaSignature,
    });
  };

  const handleDownloadPDF = async () => {
    const contentHtml = buildPrintContentHtml();
    await downloadReportPDF({
      title: title,
      subtitle: isSingleMonth && month ? MONTH_NAMES[month - 1] : `Mwaka: ${year}`,
      orgInfo: header,
      orgLevel: ORG_LABELS[orgLevel],
      year,
      month: isSingleMonth ? month : undefined,
      contentHtml,
      mudirName: currentOrg?.mudirName,
      mudirSignature: currentOrg?.mudirSignature,
      mwekahazinaName: currentOrg?.mwekahazinaName,
      mwekahazinaSignature: currentOrg?.mwekahazinaSignature,
    });
  };

  // ── Export to Excel ────────────────────────────────────
  const exportToExcel = async () => {
    const wsData: (string | number)[][] = [
      ['ANSAAR MUSLIM YOUTH CENTRE'],
      [header],
      [title],
      [],
    ];

    if (subType === 'consolidation_departmental') {
      // Departmental consolidation format
      wsData.push(
        [rowLabel, 'MAELEZO', ...DEPT_KEYS.map((d) => DEPT_SHORT[d] || d), 'JUMLA', 'ASILIMIA']
      );
      allRows.forEach((row) => {
        let mapatoTotal = 0;
        const mapatoRow: (string | number)[] = [row.name, 'Mapato'];
        for (const dept of DEPT_KEYS) {
          const val = row.deptSummary[dept]?.income || 0;
          mapatoRow.push(val);
          mapatoTotal += val;
        }
        mapatoRow.push(mapatoTotal);
        mapatoRow.push(totalConsolidatedIncome > 0
          ? `${((mapatoTotal / totalConsolidatedIncome) * 100).toFixed(1)}%`
          : '0%');
        wsData.push(mapatoRow);

        let matumiziTotal = 0;
        const matumiziRow: (string | number)[] = ['', 'Matumizi'];
        for (const dept of DEPT_KEYS) {
          const val = row.deptSummary[dept]?.expense || 0;
          matumiziRow.push(val);
          matumiziTotal += val;
        }
        matumiziRow.push(matumiziTotal);
        matumiziRow.push(totalConsolidatedExpense > 0
          ? `${((matumiziTotal / totalConsolidatedExpense) * 100).toFixed(1)}%`
          : '0%');
        wsData.push(matumiziRow);

        let salioTotal = 0;
        const salioRow: (string | number)[] = ['', 'Salio'];
        for (const dept of DEPT_KEYS) {
          const val = (row.deptSummary[dept]?.income || 0) - (row.deptSummary[dept]?.expense || 0);
          salioRow.push(val);
          salioTotal += val;
        }
        salioRow.push(salioTotal);
        salioRow.push('');
        wsData.push(salioRow);
      });

      // JUMLA rows
      let grandMapato = 0;
      const jumlaMapato: (string | number)[] = ['JUMLA', 'Mapato'];
      for (const dept of DEPT_KEYS) {
        const val = consolidatedDeptSummary[dept]?.income || 0;
        jumlaMapato.push(val);
        grandMapato += val;
      }
      jumlaMapato.push(grandMapato);
      jumlaMapato.push('100%');
      wsData.push(jumlaMapato);

      let grandMatumizi = 0;
      const jumlaMatumizi: (string | number)[] = ['', 'Matumizi'];
      for (const dept of DEPT_KEYS) {
        const val = consolidatedDeptSummary[dept]?.expense || 0;
        jumlaMatumizi.push(val);
        grandMatumizi += val;
      }
      jumlaMatumizi.push(grandMatumizi);
      jumlaMatumizi.push(grandMapato > 0
        ? `${((grandMatumizi / grandMapato) * 100).toFixed(1)}%`
        : '0%');
      wsData.push(jumlaMatumizi);

      let grandSalio = 0;
      const jumlaSalio: (string | number)[] = ['', 'Salio'];
      for (const dept of DEPT_KEYS) {
        const val = (consolidatedDeptSummary[dept]?.income || 0) - (consolidatedDeptSummary[dept]?.expense || 0);
        jumlaSalio.push(val);
        grandSalio += val;
      }
      jumlaSalio.push(grandSalio);
      jumlaSalio.push('');
      wsData.push(jumlaSalio);
    } else if (subType === 'income') {
      wsData.push(
        [rowLabel, '', ...monthLabels, 'JUMLA', 'ASILIMIA']
      );
      allRows.forEach((row) => {
        wsData.push([row.name, '', ...monthIndices.map((mi) => row.incomeByMonth[mi]), row.totalIncome, '']);
      });
      wsData.push(['JUMLA', '', ...monthIndices.map((mi) => consolidatedIncome[mi]), totalConsolidatedIncome, '']);
    } else if (subType === 'expense') {
      wsData.push(
        [rowLabel, '', ...monthLabels, 'JUMLA', 'ASILIMIA']
      );
      allRows.forEach((row) => {
        wsData.push([row.name, '', ...monthIndices.map((mi) => row.expenseByMonth[mi]), row.totalExpense, '']);
      });
      wsData.push(['JUMLA', '', ...monthIndices.map((mi) => consolidatedExpense[mi]), totalConsolidatedExpense, '']);
    } else {
      // full
      wsData.push(
        [rowLabel, 'AINA', ...monthLabels, 'JUMLA', 'ASILIMIA']
      );
      allRows.forEach((row) => {
        wsData.push([row.name, 'Mapato', ...monthIndices.map((mi) => row.incomeByMonth[mi]), row.totalIncome, '']);
        wsData.push(['', 'Matumizi', ...monthIndices.map((mi) => row.expenseByMonth[mi]), row.totalExpense, '']);
        const salio = monthIndices.map((mi) => row.incomeByMonth[mi] - row.expenseByMonth[mi]);
        const totalSalio = row.totalIncome - row.totalExpense;
        wsData.push(['', 'Salio', ...salio, totalSalio, '']);
      });

      // JUMLA row
      wsData.push(['JUMLA', 'Mapato', ...monthIndices.map((mi) => consolidatedIncome[mi]), totalConsolidatedIncome, '']);
      wsData.push(['', 'Matumizi', ...monthIndices.map((mi) => consolidatedExpense[mi]), totalConsolidatedExpense, '']);
      const consSalio = monthIndices.map((mi) => consolidatedIncome[mi] - consolidatedExpense[mi]);
      wsData.push(['', 'Salio', ...consSalio, totalConsolidatedSalio, '']);
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    const sheetName =
      subType === 'income'
        ? 'Muunganiko Mapato'
        : subType === 'expense'
        ? 'Muunganiko Matumizi'
        : subType === 'consolidation_departmental'
        ? 'Ki-Idara Muunganiko'
        : 'Muunganiko Kamili';
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    await saveWorkbookFile(wb, `${sheetName}_${orgName}_${year}.xlsx`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-emerald-600" />
        <span className="ml-2 text-muted-foreground">Inapakia taarifa...</span>
      </div>
    );
  }

  // ── No children registered (non-Markaz) ──────────────────
  if (hasNoChildren && !includeOwnData) {
    return (
      <div className="text-center py-12">
        <Building2 className="h-16 w-16 mx-auto mb-4 text-muted-foreground/30" />
        <p className="text-lg font-medium text-muted-foreground">
          Hakuna vitengo vidogo vilivyosajiliwa
        </p>
        <p className="text-sm mt-2 text-muted-foreground max-w-md mx-auto">
          Ili kuunda taarifa ya muunganiko, unahitaji kuwa na vitengo vidogo (sub-units) vilivyosajiliwa chini ya {ORG_LABELS[orgLevel]} {orgName}.
        </p>
        <p className="text-sm mt-1 text-muted-foreground">
          Nenda kwenye <strong className="text-emerald-700">Meneja wa Shirika</strong> (Organization Manager) ili kusajili {CHILD_PLURAL[orgLevel] || 'vitengo vidogo'} kwanza.
        </p>
      </div>
    );
  }

  if (allRows.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>Hakuna vitengo vidogo vilivyochaguliwa kwa muunganiko</p>
        <p className="text-sm mt-1">Chagua angalau kimoja kutoka orodha hapo juu</p>
      </div>
    );
  }

  // ── Render income/expense simple ───────────────────────
  const renderSimpleTable = (field: 'income' | 'expense') => {
    const values = field === 'income' ? 'incomeByMonth' : 'expenseByMonth';
    const totals = field === 'income' ? 'totalIncome' : 'totalExpense';
    const consolidated = field === 'income' ? consolidatedIncome : consolidatedExpense;
    const grandTotal = field === 'income' ? displayConsolidatedIncome : displayConsolidatedExpense;

    return (
      <div className="border rounded-lg overflow-x-auto">
        <Table className="[&_th]:border [&_td]:border [&_th]:border-emerald-400 [&_td]:border-emerald-300">
          <TableHeader>
            <TableRow className="bg-emerald-700 hover:bg-emerald-700">
              <TableHead className="text-white font-bold sticky left-0 bg-emerald-700 z-10 min-w-32">
                {rowLabel}
              </TableHead>
              <TableHead className="text-white font-bold">SALIO LA MWANZO</TableHead>
              {monthLabels.map((m) => (
                <TableHead key={m} className="text-white font-bold text-right min-w-20">
                  {m}
                </TableHead>
              ))}
              <TableHead className="text-white font-bold text-right">JUMLA</TableHead>
              <TableHead className="text-white font-bold text-right">ASILIMIA</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allRows.map((row, ri) => {
              const rowPeriodTotal =
                field === 'income' ? rowPeriodIncome(row) : rowPeriodExpense(row);
              const asilimia =
                grandTotal > 0
                  ? ((rowPeriodTotal / grandTotal) * 100).toFixed(1) + '%'
                  : '0%';

              return (
                <TableRow
                  key={`row-${ri}`}
                  className={ri % 2 === 1 ? 'bg-muted/30' : ''}
                >
                  <TableCell className={`font-medium sticky left-0 bg-background z-10 ${row.isMarkazOwn ? 'font-bold text-emerald-800' : ''}`}>
                    {row.name}
                  </TableCell>
                  <TableCell className="text-right">{formatNum(row.openingBalance)}</TableCell>
                  {monthIndices.map((mi) => (
                    <TableCell key={mi} className="text-right">
                      {row[values][mi] > 0 ? formatNum(row[values][mi]) : ''}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-semibold">
                    {rowPeriodTotal > 0 ? formatNum(rowPeriodTotal) : ''}
                  </TableCell>
                  <TableCell className="text-right text-sm">{asilimia}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {/* JUMLA row */}
          <tfoot>
            <TableRow className="bg-emerald-700 text-white font-bold hover:bg-emerald-700">
              <TableCell className="font-bold text-white sticky left-0 bg-emerald-700 z-10">
                JUMLA
              </TableCell>
              <TableCell className="text-right text-white">{formatNum(totalConsolidatedOpening)}</TableCell>
              {monthIndices.map((mi) => (
                <TableCell key={mi} className="text-right text-white">
                  {consolidated[mi] > 0 ? formatNum(consolidated[mi]) : ''}
                </TableCell>
              ))}
              <TableCell className="text-right text-white font-bold">
                {formatNum(grandTotal)}
              </TableCell>
              <TableCell className="text-right text-white">100%</TableCell>
            </TableRow>
            <TableRow className="bg-emerald-800 text-white hover:bg-emerald-800">
              <TableCell className="font-bold text-white sticky left-0 bg-emerald-800 z-10">
                ASILIMIA
              </TableCell>
              <TableCell className="text-right text-white">—</TableCell>
              {monthIndices.map((mi) => {
                const pct = grandTotal > 0 ? ((consolidated[mi] / grandTotal) * 100).toFixed(1) + '%' : '0%';
                return (
                  <TableCell key={mi} className="text-right text-white text-sm">
                    {consolidated[mi] > 0 ? pct : ''}
                  </TableCell>
                );
              })}
              <TableCell className="text-right text-white">100%</TableCell>
              <TableCell className="text-right text-white">—</TableCell>
            </TableRow>
          </tfoot>
        </Table>
      </div>
    );
  };

  // ── Render full consolidation ──────────────────────────
  const renderFullTable = () => {
    return (
      <div className="border rounded-lg overflow-x-auto">
        <Table className="[&_th]:border [&_td]:border [&_th]:border-emerald-400 [&_td]:border-emerald-300">
          <TableHeader>
            <TableRow className="bg-emerald-700 hover:bg-emerald-700">
              <TableHead className="text-white font-bold sticky left-0 bg-emerald-700 z-10 min-w-28">
                {rowLabel}
              </TableHead>
              <TableHead className="text-white font-bold w-24">AINA</TableHead>
              <TableHead className="text-white font-bold">SALIO LA MWANZO</TableHead>
              {monthLabels.map((m) => (
                <TableHead key={m} className="text-white font-bold text-right min-w-20">
                  {m}
                </TableHead>
              ))}
              <TableHead className="text-white font-bold text-right">JUMLA</TableHead>
              <TableHead className="text-white font-bold text-right">ASILIMIA</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allRows.map((row, ri) => {
              const mapatoAsilimia =
                totalConsolidatedIncome > 0
                  ? ((row.totalIncome / totalConsolidatedIncome) * 100).toFixed(1) + '%'
                  : '0%';
              const matumiziAsilimia =
                totalConsolidatedExpense > 0
                  ? ((row.totalExpense / totalConsolidatedExpense) * 100).toFixed(1) + '%'
                  : '0%';

              return (
                <React.Fragment key={`row-${ri}`}>
                  {/* Mapato */}
                  <TableRow className={ri % 2 === 0 ? '' : 'bg-muted/30'}>
                    <TableCell
                      className={`font-medium sticky left-0 bg-background z-10 ${row.isMarkazOwn ? 'font-bold text-emerald-800' : ''}`}
                      rowSpan={3}
                    >
                      {row.name}
                    </TableCell>
                    <TableCell className="text-emerald-700 font-medium text-sm">Mapato</TableCell>
                    <TableCell className="text-right">{formatNum(row.openingBalance)}</TableCell>
                    {monthIndices.map((mi) => (
                      <TableCell key={mi} className="text-right text-sm">
                        {row.incomeByMonth[mi] > 0 ? formatNum(row.incomeByMonth[mi]) : ''}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-semibold">
                      {row.totalIncome > 0 ? formatNum(row.totalIncome) : ''}
                    </TableCell>
                    <TableCell className="text-right text-sm">{mapatoAsilimia}</TableCell>
                  </TableRow>
                  {/* Matumizi */}
                  <TableRow className={ri % 2 === 0 ? '' : 'bg-muted/30'}>
                    <TableCell className="text-red-700 font-medium text-sm">Matumizi</TableCell>
                    <TableCell className="text-right" />
                    {monthIndices.map((mi) => (
                      <TableCell key={mi} className="text-right text-sm">
                        {row.expenseByMonth[mi] > 0 ? formatNum(row.expenseByMonth[mi]) : ''}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-semibold">
                      {row.totalExpense > 0 ? formatNum(row.totalExpense) : ''}
                    </TableCell>
                    <TableCell className="text-right text-sm">{matumiziAsilimia}</TableCell>
                  </TableRow>
                  {/* Salio */}
                  <TableRow
                    className={
                      ri % 2 === 0
                        ? 'bg-emerald-50/50 dark:bg-emerald-950/20'
                        : 'bg-muted/30'
                    }
                  >
                    <TableCell className="text-emerald-800 font-medium text-sm">Salio</TableCell>
                    <TableCell className="text-right" />
                    {monthIndices.map((mi) => {
                      const val = row.incomeByMonth[mi] - row.expenseByMonth[mi];
                      return (
                        <TableCell
                          key={mi}
                          className={`text-right text-sm font-medium ${
                            val < 0 ? 'text-red-600' : 'text-emerald-700'
                          }`}
                        >
                          {val !== 0 ? formatNum(val) : ''}
                        </TableCell>
                      );
                    })}
                    <TableCell
                      className={`text-right font-bold ${
                        row.totalIncome - row.totalExpense < 0
                          ? 'text-red-600'
                          : 'text-emerald-700'
                      }`}
                    >
                      {formatNum(row.totalIncome - row.totalExpense)}
                    </TableCell>
                    <TableCell className="text-right text-sm">—</TableCell>
                  </TableRow>
                </React.Fragment>
              );
            })}
          </TableBody>
          {/* JUMLA */}
          <tfoot>
            <TableRow className="bg-emerald-700 text-white font-bold hover:bg-emerald-700">
              <TableCell className="font-bold text-white sticky left-0 bg-emerald-700 z-10" rowSpan={3}>
                JUMLA
              </TableCell>
              <TableCell className="text-white font-bold">Mapato</TableCell>
              <TableCell className="text-right text-white">{formatNum(totalConsolidatedOpening)}</TableCell>
              {monthIndices.map((mi) => (
                <TableCell key={mi} className="text-right text-white">
                  {consolidatedIncome[mi] > 0 ? formatNum(consolidatedIncome[mi]) : ''}
                </TableCell>
              ))}
              <TableCell className="text-right text-white font-bold">
                {formatNum(totalConsolidatedIncome)}
              </TableCell>
              <TableCell className="text-right text-white">100%</TableCell>
            </TableRow>
            <TableRow className="bg-emerald-800 text-white font-bold hover:bg-emerald-800">
              <TableCell className="text-white font-bold">Matumizi</TableCell>
              <TableCell className="text-right text-white" />
              {monthIndices.map((mi) => (
                <TableCell key={mi} className="text-right text-white">
                  {consolidatedExpense[mi] > 0 ? formatNum(consolidatedExpense[mi]) : ''}
                </TableCell>
              ))}
              <TableCell className="text-right text-white font-bold">
                {formatNum(totalConsolidatedExpense)}
              </TableCell>
              <TableCell className="text-right text-white">
                {totalConsolidatedIncome > 0
                  ? ((totalConsolidatedExpense / totalConsolidatedIncome) * 100).toFixed(1) + '%'
                  : '0%'}
              </TableCell>
            </TableRow>
            <TableRow className="bg-emerald-900 text-white font-bold hover:bg-emerald-900">
              <TableCell className="text-white font-bold">Salio</TableCell>
              <TableCell className="text-right text-white" />
              {monthIndices.map((mi) => {
                const val = consolidatedIncome[mi] - consolidatedExpense[mi];
                return (
                  <TableCell key={mi} className="text-right text-white">
                    {val !== 0 ? formatNum(val) : ''}
                  </TableCell>
                );
              })}
              <TableCell
                className={`text-right text-white font-bold ${
                  totalConsolidatedSalio < 0 ? 'text-red-300' : ''
                }`}
              >
                {formatNum(totalConsolidatedSalio)}
              </TableCell>
              <TableCell className="text-right text-white">—</TableCell>
            </TableRow>
          </tfoot>
        </Table>
      </div>
    );
  };

  // ── Render departmental consolidation ──────────────────
  const renderDepartmentalTable = () => {
    return (
      <div className="border rounded-lg overflow-x-auto">
        <Table className="[&_th]:border [&_td]:border [&_th]:border-emerald-400 [&_td]:border-emerald-300">
          <TableHeader>
            <TableRow className="bg-emerald-700 hover:bg-emerald-700">
              <TableHead className="text-white font-bold sticky left-0 bg-emerald-700 z-10 min-w-28">
                {rowLabel}
              </TableHead>
              <TableHead className="text-white font-bold w-24">MAELEZO</TableHead>
              {DEPT_KEYS.map((dept) => (
                <TableHead key={dept} className="text-white font-bold text-right">
                  {DEPT_SHORT[dept] || dept}
                </TableHead>
              ))}
              <TableHead className="text-white font-bold text-right">JUMLA</TableHead>
              <TableHead className="text-white font-bold text-right">ASILIMIA</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allRows.map((row, ri) => {
              let mapatoTotal = 0;
              const mapatoCells = DEPT_KEYS.map((dept) => {
                const val = row.deptSummary[dept]?.income || 0;
                mapatoTotal += val;
                return val;
              });

              let matumiziTotal = 0;
              const matumiziCells = DEPT_KEYS.map((dept) => {
                const val = row.deptSummary[dept]?.expense || 0;
                matumiziTotal += val;
                return val;
              });

              let salioTotal = 0;
              const salioCells = DEPT_KEYS.map((dept) => {
                const val = (row.deptSummary[dept]?.income || 0) - (row.deptSummary[dept]?.expense || 0);
                salioTotal += val;
                return val;
              });

              const mapatoAsilimia = '100%';
              const matumiziAsilimia = pctExpenseOfIncome(matumiziTotal, mapatoTotal);
              const salioAsilimia = pctSalioRemaining(salioTotal, mapatoTotal);

              return (
                <React.Fragment key={`row-${ri}`}>
                  {/* Mapato */}
                  <TableRow className={ri % 2 === 0 ? '' : 'bg-muted/30'}>
                    <TableCell
                      className={`font-medium sticky left-0 bg-background z-10 ${row.isMarkazOwn ? 'font-bold text-emerald-800' : ''}`}
                      rowSpan={3}
                    >
                      {row.name}
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
                    <TableCell className="text-right text-sm">{mapatoAsilimia}</TableCell>
                  </TableRow>

                  {/* Matumizi */}
                  <TableRow className={ri % 2 === 0 ? '' : 'bg-muted/30'}>
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

                  {/* Salio */}
                  <TableRow className={ri % 2 === 0 ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : 'bg-muted/30'}>
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
              const mapatoCells = DEPT_KEYS.map((dept) => {
                const val = consolidatedDeptSummary[dept]?.income || 0;
                grandMapato += val;
                return val;
              });

              let grandMatumizi = 0;
              const matumiziCells = DEPT_KEYS.map((dept) => {
                const val = consolidatedDeptSummary[dept]?.expense || 0;
                grandMatumizi += val;
                return val;
              });

              let grandSalio = 0;
              const salioCells = DEPT_KEYS.map((dept) => {
                const val = (consolidatedDeptSummary[dept]?.income || 0) - (consolidatedDeptSummary[dept]?.expense || 0);
                grandSalio += val;
                return val;
              });

              const grandMatumiziAsilimia = pctExpenseOfIncome(grandMatumizi, grandMapato);
              const grandSalioAsilimia = pctSalioRemaining(grandSalio, grandMapato);

              return (
                <React.Fragment>
                  <TableRow className="bg-emerald-700 text-white font-bold hover:bg-emerald-700">
                    <TableCell className="font-bold text-white sticky left-0 bg-emerald-700 z-10" rowSpan={3}>
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
    );
  };

  // ── Main render ────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-emerald-200 bg-linear-to-r from-emerald-50 via-white to-emerald-100 p-4 text-center space-y-1">
        <p className="text-xs font-semibold tracking-wide text-emerald-800 uppercase">ANSAAR MUSLIM YOUTH CENTRE</p>
        <p className="font-semibold text-emerald-900">{header}</p>
        <p className="font-semibold text-emerald-800">{title}</p>
        <p className="text-xs text-muted-foreground">Imetolewa: {generatedAt}</p>
        {isMarkaz && markazOwnData && (
          <p className="text-xs text-muted-foreground mt-1">
            Muunganiko unajumuisha data ya Markaz yenyewe pamoja na Majimbo yaliyochaguliwa
          </p>
        )}
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
      {subType === 'income' && renderSimpleTable('income')}
      {subType === 'expense' && renderSimpleTable('expense')}
      {subType === 'full' && renderFullTable()}
      {subType === 'consolidation_departmental' && renderDepartmentalTable()}
    </div>
  );
}
