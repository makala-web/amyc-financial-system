// ============================================================
// AMYC Financial Management System - Branch Unified Report Excel Export
// ============================================================

import type { BranchUnifiedReportData } from './branch-unified-report';
import * as XLSX from 'xlsx';
import { integrityHash, integritySignature, stableStringify } from '@/lib/reports/integrity';
import { isNativeApp, saveNativeBase64File } from '@/lib/native-files';

export type RegionalUnifiedExcelReport = {
  regionId: number;
  regionName: string;
  regionCode?: string;
  year: number;
  month?: number;
  generatedAt: string;
  openingBalance: number;
  totalIncome: number;
  totalExpense: number;
  closingBalance: number;
  carryForward: number;
  monthlyRows: Array<{
    monthLabel: string;
    openingBalance: number;
    income: number;
    expense: number;
    balance: number;
    closingBalance: number;
  }>;
  departmentRows: Array<{
    department: string;
    income: number;
    expense: number;
    balance: number;
  }>;
  incomeCategoryRows: Array<{ category: string; amount: number; percentage: number }>;
  expenseCategoryRows: Array<{ category: string; amount: number; percentage: number }>;
  branchRows: Array<{
    branchName: string;
    branchCode?: string;
    rowKind?: 'jimbo' | 'tawi' | 'jumla' | 'markaz';
    hasUploaded?: boolean;
    openingBalance: number;
    income: number;
    expense: number;
    closingBalance: number;
  }>;
  missingBranchNames?: string[];
};

function setWidths(ws: XLSX.WorkSheet, widths: number[]) {
  ws['!cols'] = widths.map((wch) => ({ wch }));
  return ws;
}

function buildImportSnapshot(report: BranchUnifiedReportData) {
  const incomeCategories = Object.fromEntries(
    report.incomeCategoryRows.map((row) => [row.category, row.amount])
  );
  const expenseCategories = Object.fromEntries(
    report.expenseCategoryRows.map((row) => [row.category, row.amount])
  );
  const departments = Object.fromEntries(
    report.departmentRows.map((row) => [row.department, row.balance])
  );
  const departmentDetails = Object.fromEntries(
    report.departmentRows.map((row) => [
      row.department,
      {
        income: row.income,
        expense: row.expense,
        balance: row.balance,
      },
    ])
  );

  return {
    branchId: String(report.branchCode || report.branchId),
    branchName: report.branchName,
    month: report.month ? String(report.month) : 'all',
    year: report.year,
    income: {
      total: report.totalIncome,
      categories: incomeCategories,
    },
    expenses: {
      total: report.totalExpense,
      categories: expenseCategories,
    },
    departments,
    departmentDetails,
    net: report.totalIncome - report.totalExpense,
  };
}

async function writeWorkbook(wb: XLSX.WorkBook, fileName: string) {
  if (isNativeApp()) {
    const base64Data = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' }) as string;
    await saveNativeBase64File({
      fileName,
      base64Data,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      share: true,
    });
    return;
  }
  XLSX.writeFile(wb, fileName);
}

export async function downloadBranchUnifiedReportExcel(report: BranchUnifiedReportData): Promise<void> {
  const wb = XLSX.utils.book_new();
  const snapshot = buildImportSnapshot(report);
  const checksumPayload = stableStringify(snapshot);
  const checksum = integrityHash(checksumPayload);
  const signature = integritySignature(checksumPayload);

  const metadataRows: Array<Array<string | number>> = [
    ['AMYC_REPORT_KIND', 'BRANCH_UNIFIED_REPORT'],
    ['REPORT_VERSION', '1.1'],
    ['BRANCH_ID', snapshot.branchId],
    ['BRANCH_NAME', snapshot.branchName],
    ['MONTH', snapshot.month],
    ['YEAR', snapshot.year],
    ['INCOME_TOTAL', snapshot.income.total],
    ['EXPENSE_TOTAL', snapshot.expenses.total],
    ['NET', snapshot.net],
    ['INTEGRITY_HASH', checksum],
    ['INTEGRITY_SIGNATURE', signature],
    ['GENERATED_AT', report.generatedAt],
  ];
  XLSX.utils.book_append_sheet(wb, setWidths(XLSX.utils.aoa_to_sheet(metadataRows), [26, 42]), 'AMYC_METADATA');

  const summaryData: Array<Array<string | number>> = [
    ['RIPOTI YA TAWI'],
    [],
    ['Tawi ID', snapshot.branchId],
    ['Tawi', snapshot.branchName],
    ['Kipindi', snapshot.month],
    ['Mwaka', snapshot.year],
    [],
    ['Jumla ya Mapato', snapshot.income.total],
    ['Jumla ya Matumizi', snapshot.expenses.total],
    ['Salio Neto', snapshot.net],
    ['Salio la mwanzo', report.openingBalance],
    ['Salio la mwisho', report.closingBalance],
    ['Carry Forward', report.carryForward],
  ];
  XLSX.utils.book_append_sheet(wb, setWidths(XLSX.utils.aoa_to_sheet(summaryData), [26, 22]), 'Muhtasari');

  const incomeImportData: Array<Array<string | number>> = [['Mapato'], [], ['Kategoria', 'Kiasi']];
  report.incomeCategoryRows.forEach((row) => incomeImportData.push([row.category, row.amount]));
  incomeImportData.push([], ['Jumla', report.totalIncome]);
  XLSX.utils.book_append_sheet(wb, setWidths(XLSX.utils.aoa_to_sheet(incomeImportData), [36, 18]), 'Mapato');

  const expenseImportData: Array<Array<string | number>> = [['Matumizi'], [], ['Kategoria', 'Kiasi']];
  report.expenseCategoryRows.forEach((row) => expenseImportData.push([row.category, row.amount]));
  expenseImportData.push([], ['Jumla', report.totalExpense]);
  XLSX.utils.book_append_sheet(wb, setWidths(XLSX.utils.aoa_to_sheet(expenseImportData), [36, 18]), 'Matumizi');

  const departmentImportData: Array<Array<string | number>> = [['Ki-Idara'], [], ['Idara', 'Mapato', 'Matumizi', 'Salio']];
  report.departmentRows.forEach((row) => departmentImportData.push([row.department, row.income, row.expense, row.balance]));
  departmentImportData.push(
    [],
    [
      'Jumla',
      report.departmentRows.reduce((sum, row) => sum + row.income, 0),
      report.departmentRows.reduce((sum, row) => sum + row.expense, 0),
      report.departmentRows.reduce((sum, row) => sum + row.balance, 0),
    ]
  );
  XLSX.utils.book_append_sheet(wb, setWidths(XLSX.utils.aoa_to_sheet(departmentImportData), [28, 18, 18, 18]), 'Ki-Idara');

  const monthlyData: Array<Array<string | number>> = [['MUHTASARI WA KILA MWEZI', '', '', '', '', '']];
  monthlyData.push(['Mwezi', 'Salio la mwanzo', 'Mapato', 'Matumizi', 'Salio', 'Salio la mwisho']);
  if (report.monthlyRows.length > 0) {
    report.monthlyRows.forEach((row) => {
      monthlyData.push([
        row.monthLabel,
        row.openingBalance,
        row.income,
        row.expense,
        row.balance,
        row.closingBalance,
      ]);
    });
  } else {
    monthlyData.push([
      report.month ? String(report.month) : 'Mwaka mzima',
      report.openingBalance,
      report.totalIncome,
      report.totalExpense,
      report.totalIncome - report.totalExpense,
      report.closingBalance,
    ]);
  }
  XLSX.utils.book_append_sheet(wb, setWidths(XLSX.utils.aoa_to_sheet(monthlyData), [16, 18, 18, 18, 18, 18]), 'Miezi');

  if (report.departmentRows.length > 0) {
    const deptData: Array<Array<string | number>> = [['MUHTASARI WA KILA IDARA', '', '', '']];
    deptData.push(['Idara', 'Mapato', 'Matumizi', 'Salio']);
    report.departmentRows.forEach((row) => {
      deptData.push([row.department, row.income, row.expense, row.balance]);
    });
    XLSX.utils.book_append_sheet(wb, setWidths(XLSX.utils.aoa_to_sheet(deptData), [26, 18, 18, 18]), 'Idara Kamili');
  }

  if (report.incomeCategoryRows.length > 0) {
    const incomeData: Array<Array<string | number>> = [['MAPATO KWA KATEGORIA', '', '']];
    incomeData.push(['Kategoria', 'Kiasi', 'Asilimia (%)']);
    report.incomeCategoryRows.forEach((row) => {
      incomeData.push([row.category, row.amount, row.percentage]);
    });
    XLSX.utils.book_append_sheet(wb, setWidths(XLSX.utils.aoa_to_sheet(incomeData), [36, 18, 14]), 'Mapato Kategoria');
  }

  if (report.expenseCategoryRows.length > 0) {
    const expenseData: Array<Array<string | number>> = [['MATUMIZI KWA KATEGORIA', '', '']];
    expenseData.push(['Kategoria', 'Kiasi', 'Asilimia (%)']);
    report.expenseCategoryRows.forEach((row) => {
      expenseData.push([row.category, row.amount, row.percentage]);
    });
    XLSX.utils.book_append_sheet(wb, setWidths(XLSX.utils.aoa_to_sheet(expenseData), [36, 18, 14]), 'Matumizi Kategoria');
  }

  const fileName = `Ripoti_Tawi_${(report.branchCode || String(report.branchId)).replace(/\s+/g, '_')}_${report.year}.xlsx`;
  await writeWorkbook(wb, fileName);
}

export async function downloadRegionalUnifiedReportExcel(
  report: RegionalUnifiedExcelReport,
  variant: 'regional' | 'markaz' = 'regional'
): Promise<void> {
  const wb = XLSX.utils.book_new();
  const departmentDetails = Object.fromEntries(
    report.departmentRows.map((row) => [
      row.department,
      { income: row.income, expense: row.expense, balance: row.balance },
    ])
  );
  const snapshot = {
    branchId: String(report.regionCode || report.regionId),
    branchName: report.regionName,
    month: report.month ? String(report.month) : 'all',
    year: report.year,
    income: {
      total: report.totalIncome,
      categories: Object.fromEntries(report.incomeCategoryRows.map((row) => [row.category, row.amount])),
    },
    expenses: {
      total: report.totalExpense,
      categories: Object.fromEntries(report.expenseCategoryRows.map((row) => [row.category, row.amount])),
    },
    departments: Object.fromEntries(report.departmentRows.map((row) => [row.department, row.balance])),
    departmentDetails,
    net: report.totalIncome - report.totalExpense,
  };
  const checksumPayload = stableStringify(snapshot);
  const checksum = integrityHash(checksumPayload);
  const signature = integritySignature(checksumPayload);

  const metadataRows: Array<Array<string | number>> = [
    ['AMYC_REPORT_KIND', variant === 'markaz' ? 'MARKAZ_UNIFIED_REPORT' : 'REGIONAL_UNIFIED_REPORT'],
    ['REPORT_VERSION', '1.1'],
    [variant === 'markaz' ? 'MARKAZ_ID' : 'REGION_ID', snapshot.branchId],
    [variant === 'markaz' ? 'MARKAZ_NAME' : 'REGION_NAME', snapshot.branchName],
    ['MONTH', snapshot.month],
    ['YEAR', snapshot.year],
    ['INCOME_TOTAL', snapshot.income.total],
    ['EXPENSE_TOTAL', snapshot.expenses.total],
    ['NET', snapshot.net],
    ['INTEGRITY_HASH', checksum],
    ['INTEGRITY_SIGNATURE', signature],
    ['GENERATED_AT', report.generatedAt],
  ];
  XLSX.utils.book_append_sheet(wb, setWidths(XLSX.utils.aoa_to_sheet(metadataRows), [26, 42]), 'AMYC_METADATA');

  const summaryData: Array<Array<string | number>> = [
    [variant === 'markaz' ? 'RIPOTI YA MARKAZ KUU' : 'RIPOTI YA JIMBO'],
    [],
    [variant === 'markaz' ? 'Markaz Kuu' : 'Jimbo', snapshot.branchName],
    ['Kipindi', snapshot.month],
    ['Mwaka', snapshot.year],
    [],
    ['Jumla ya Mapato', snapshot.income.total],
    ['Jumla ya Matumizi', snapshot.expenses.total],
    ['Salio Neto', snapshot.net],
    ['Salio la mwanzo', report.openingBalance],
    ['Salio la mwisho', report.closingBalance],
    ['Carry Forward', report.carryForward],
  ];
  XLSX.utils.book_append_sheet(wb, setWidths(XLSX.utils.aoa_to_sheet(summaryData), [26, 22]), 'Muhtasari');

  if (report.branchRows.length > 0) {
    const branchData: Array<Array<string | number>> = [
      [
        variant === 'markaz' ? 'MUHTASARI WA MARKAZ NA MAJIMBO' : 'MUHTASARI WA JIMBO NA MATAWI',
        '',
        '',
        '',
        '',
        '',
        '',
      ],
    ];
    branchData.push(['Kitengo', 'Aina', 'Hali', 'Salio la mwanzo', 'Mapato', 'Matumizi', 'Salio la mwisho']);
    report.branchRows.forEach((row) => {
      const aina =
        row.rowKind === 'markaz'
          ? 'Markaz'
          : row.rowKind === 'jimbo'
            ? 'Jimbo'
            : row.rowKind === 'jumla'
              ? 'Jumla'
              : 'Tawi';
      const hali =
        row.rowKind === 'tawi' || row.rowKind === 'jimbo'
          ? row.hasUploaded
            ? 'Imepakiwa'
            : 'Haijapakiwa'
          : '—';
      branchData.push([
        row.branchName,
        aina,
        hali,
        row.openingBalance,
        row.income,
        row.expense,
        row.closingBalance,
      ]);
    });
    if (report.missingBranchNames && report.missingBranchNames.length > 0) {
      branchData.push([]);
      branchData.push([
        variant === 'markaz' ? 'Majimbo bila ripoti kwa kipindi hiki:' : 'Matawi bila ripoti kwa kipindi hiki:',
        report.missingBranchNames.join(', '),
      ]);
    }
    XLSX.utils.book_append_sheet(
      wb,
      setWidths(XLSX.utils.aoa_to_sheet(branchData), [32, 10, 14, 18, 18, 18, 18]),
      variant === 'markaz' ? 'Markaz na Majimbo' : 'Jimbo na Matawi'
    );
  }

  const incomeImportData: Array<Array<string | number>> = [['Mapato'], [], ['Kategoria', 'Kiasi']];
  report.incomeCategoryRows.forEach((row) => incomeImportData.push([row.category, row.amount]));
  incomeImportData.push([], ['Jumla', report.totalIncome]);
  XLSX.utils.book_append_sheet(wb, setWidths(XLSX.utils.aoa_to_sheet(incomeImportData), [36, 18]), 'Mapato');

  const expenseImportData: Array<Array<string | number>> = [['Matumizi'], [], ['Kategoria', 'Kiasi']];
  report.expenseCategoryRows.forEach((row) => expenseImportData.push([row.category, row.amount]));
  expenseImportData.push([], ['Jumla', report.totalExpense]);
  XLSX.utils.book_append_sheet(wb, setWidths(XLSX.utils.aoa_to_sheet(expenseImportData), [36, 18]), 'Matumizi');

  const departmentImportData: Array<Array<string | number>> = [['Ki-Idara'], [], ['Idara', 'Mapato', 'Matumizi', 'Salio']];
  report.departmentRows.forEach((row) => departmentImportData.push([row.department, row.income, row.expense, row.balance]));
  XLSX.utils.book_append_sheet(wb, setWidths(XLSX.utils.aoa_to_sheet(departmentImportData), [28, 18, 18, 18]), 'Ki-Idara');

  const monthlyData: Array<Array<string | number>> = [['MUHTASARI WA KILA MWEZI', '', '', '', '', '']];
  monthlyData.push(['Mwezi', 'Salio la mwanzo', 'Mapato', 'Matumizi', 'Salio', 'Salio la mwisho']);
  if (report.monthlyRows.length > 0) {
    report.monthlyRows.forEach((row) => {
      monthlyData.push([
        row.monthLabel,
        row.openingBalance,
        row.income,
        row.expense,
        row.balance,
        row.closingBalance,
      ]);
    });
  } else {
    monthlyData.push([
      report.month ? String(report.month) : 'Mwaka mzima',
      report.openingBalance,
      report.totalIncome,
      report.totalExpense,
      report.totalIncome - report.totalExpense,
      report.closingBalance,
    ]);
  }
  XLSX.utils.book_append_sheet(wb, setWidths(XLSX.utils.aoa_to_sheet(monthlyData), [16, 18, 18, 18, 18, 18]), 'Miezi');

  const fileName =
    variant === 'markaz'
      ? `Ripoti_Markaz_${(report.regionCode || String(report.regionId)).replace(/\s+/g, '_')}_${report.year}.xlsx`
      : `Ripoti_Jimbo_${(report.regionCode || String(report.regionId)).replace(/\s+/g, '_')}_${report.year}.xlsx`;
  await writeWorkbook(wb, fileName);
}

export type MarkazUnifiedExcelReport = {
  markazId: number;
  markazName: string;
  markazCode?: string;
  year: number;
  month?: number;
  generatedAt: string;
  openingBalance: number;
  totalIncome: number;
  totalExpense: number;
  closingBalance: number;
  carryForward: number;
  monthlyRows: RegionalUnifiedExcelReport['monthlyRows'];
  departmentRows: RegionalUnifiedExcelReport['departmentRows'];
  incomeCategoryRows: RegionalUnifiedExcelReport['incomeCategoryRows'];
  expenseCategoryRows: RegionalUnifiedExcelReport['expenseCategoryRows'];
  branchRows: Array<{
    branchName: string;
    branchCode?: string;
    rowKind?: 'markaz' | 'jimbo' | 'jumla';
    hasUploaded?: boolean;
    openingBalance: number;
    income: number;
    expense: number;
    closingBalance: number;
  }>;
  missingRegionNames?: string[];
};

export async function downloadMarkazUnifiedReportExcel(report: MarkazUnifiedExcelReport): Promise<void> {
  await downloadRegionalUnifiedReportExcel(
    {
      regionId: report.markazId,
      regionName: report.markazName,
      regionCode: report.markazCode,
      year: report.year,
      month: report.month,
      generatedAt: report.generatedAt,
      openingBalance: report.openingBalance,
      totalIncome: report.totalIncome,
      totalExpense: report.totalExpense,
      closingBalance: report.closingBalance,
      carryForward: report.carryForward,
      monthlyRows: report.monthlyRows,
      departmentRows: report.departmentRows,
      incomeCategoryRows: report.incomeCategoryRows,
      expenseCategoryRows: report.expenseCategoryRows,
      branchRows: report.branchRows,
      missingBranchNames: report.missingRegionNames,
    },
    'markaz'
  );
}
