import * as XLSX from 'xlsx';
import { integrityHash, integritySignature, stableStringify } from '@/lib/reports/integrity';
import { isNativeApp, saveNativeBase64File } from '@/lib/native-files';

export interface BranchReportSnapshot {
  branchId: string;
  branchName: string;
  month: string;
  year: number;
  income: {
    total: number;
    categories: Record<string, number>;
  };
  expenses: {
    total: number;
    categories: Record<string, number>;
  };
  departments: Record<string, number>;
  departmentDetails?: Record<string, { income: number; expense: number; balance: number }>;
  net: number;
}

function buildSummarySheet(snapshot: BranchReportSnapshot): XLSX.WorkSheet {
  const rows = [
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
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 25 }, { wch: 18 }];
  return ws;
}

function buildCategorySheet(
  title: string,
  categories: Record<string, number>
): XLSX.WorkSheet {
  const rows: (string | number)[][] = [[title], [], ['Kategoria', 'Kiasi']];
  for (const [category, amount] of Object.entries(categories)) {
    rows.push([category, amount]);
  }
  rows.push([], ['Jumla', Object.values(categories).reduce((sum, value) => sum + value, 0)]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 35 }, { wch: 18 }];
  return ws;
}

function buildDepartmentSheet(departments: Record<string, number>): XLSX.WorkSheet {
  const rows: (string | number)[][] = [['Ki-Idara'], [], ['Idara', 'Kiasi']];
  for (const [department, amount] of Object.entries(departments)) {
    rows.push([department, amount]);
  }
  rows.push([], ['Jumla', Object.values(departments).reduce((sum, value) => sum + value, 0)]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 35 }, { wch: 18 }];
  return ws;
}

export async function generateBranchReportExcel(snapshot: BranchReportSnapshot): Promise<void> {
  const wb = XLSX.utils.book_new();
  const checksumPayload = stableStringify({
    branchId: snapshot.branchId,
    branchName: snapshot.branchName,
    month: snapshot.month,
    year: snapshot.year,
    income: snapshot.income,
    expenses: snapshot.expenses,
    departments: snapshot.departments,
    net: snapshot.net,
  });
  const checksum = integrityHash(checksumPayload);
  const signature = integritySignature(checksumPayload);
  const metadataRows: (string | number)[][] = [
    ['AMYC_REPORT_KIND', 'BRANCH_UNIFIED_REPORT'],
    ['REPORT_VERSION', '1.0'],
    ['BRANCH_ID', snapshot.branchId],
    ['BRANCH_NAME', snapshot.branchName],
    ['MONTH', snapshot.month],
    ['YEAR', snapshot.year],
    ['INCOME_TOTAL', snapshot.income.total],
    ['EXPENSE_TOTAL', snapshot.expenses.total],
    ['NET', snapshot.net],
    ['INTEGRITY_HASH', checksum],
    ['INTEGRITY_SIGNATURE', signature],
    ['GENERATED_AT', new Date().toISOString()],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(metadataRows), 'AMYC_METADATA');
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(snapshot), 'Muhtasari');
  XLSX.utils.book_append_sheet(wb, buildCategorySheet('Mapato', snapshot.income.categories), 'Mapato');
  XLSX.utils.book_append_sheet(wb, buildCategorySheet('Matumizi', snapshot.expenses.categories), 'Matumizi');
  XLSX.utils.book_append_sheet(wb, buildDepartmentSheet(snapshot.departments), 'Ki-Idara');

  const fileName = `Ripoti_Tawi_${snapshot.branchName.replace(/\s+/g, '_')}_${snapshot.month.replace(/\s+/g, '_')}_${snapshot.year}.xlsx`;
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
