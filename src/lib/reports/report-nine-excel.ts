import * as XLSX from 'xlsx';
import { integrityHash, integritySignature, stableStringify } from '@/lib/reports/integrity';
import { isNativeApp, saveNativeBase64File } from '@/lib/native-files';
import { MONTHS_SHORT } from '@/lib/types';
import type {
  ConsolidatedReportNineData,
  ReportNineCategoryRow,
  ReportNineDepartmentRow,
  ReportNineMonthlyRow,
  ReportNineUnitRow,
  ReportNineUnitRowKind,
} from '@/lib/reports/consolidated-report-nine';

const META_SHEET = 'AMYC_METADATA';
const FINANCIAL_SUMMARY_SHEET = 'Muhtasari wa Kifedha';
const SUMMARY_SHEET = 'Report 9 Summary';
const UNIT_SHEET = 'Report 9 Units';
const DEPARTMENT_SHEET = 'Report 9 Departments';
const INCOME_CATEGORY_SHEET = 'Report 9 Income Categories';
const EXPENSE_CATEGORY_SHEET = 'Report 9 Expense Categories';

function safeSheetName(name: string) {
  return name.slice(0, 31);
}

function setWidths(ws: XLSX.WorkSheet, widths: number[]) {
  ws['!cols'] = widths.map((wch) => ({ wch }));
}

function aoaSheet(rows: (string | number)[][], widths: number[]) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  setWidths(ws, widths);
  return ws;
}

function normalizedPercent(value: number) {
  return Number(Number(value || 0).toFixed(1));
}

function normalizeUnitRows(report: ConsolidatedReportNineData) {
  return (report.unitRows || []).map((row) => ({
    unitId: row.unitId,
    unitName: row.unitName,
    ...(row.unitCode ? { unitCode: row.unitCode } : {}),
    rowKind: row.rowKind,
    openingBalance: row.openingBalance,
    income: row.income,
    expense: row.expense,
    balance: row.balance,
    closingBalance: row.closingBalance,
    ...(row.hasUploaded !== undefined ? { hasUploaded: row.hasUploaded } : {}),
  }));
}

function normalizeReportNineForIntegrity(report: ConsolidatedReportNineData, includeUnitRows = true) {
  const normalized = {
    reportType: report.reportType,
    level: report.level,
    unitId: report.unitId,
    unitName: report.unitName,
    title: report.title,
    month: report.month || 0,
    year: report.year,
    childCount: report.childCount,
    openingBalance: report.openingBalance,
    totalIncome: report.totalIncome,
    totalExpense: report.totalExpense,
    closingBalance: report.closingBalance,
    carryForward: report.carryForward,
    monthlyRows: report.monthlyRows,
    departmentRows: report.departmentRows,
    incomeCategoryRows: report.incomeCategoryRows.map((row) => ({
      ...row,
      percent: normalizedPercent(row.percent),
    })),
    expenseCategoryRows: report.expenseCategoryRows.map((row) => ({
      ...row,
      percent: normalizedPercent(row.percent),
    })),
  };
  if (includeUnitRows) {
    return { ...normalized, unitRows: normalizeUnitRows(report) };
  }
  return normalized;
}

export function buildReportNineWorkbook(report: ConsolidatedReportNineData) {
  const wb = XLSX.utils.book_new();
  const reportLevel = report.level === 'jimbo' ? 'REGIONAL_REPORT_NINE' : 'MARKAZ_REPORT_NINE';
  const monthValue = report.month || 0;

  const checksumPayload = stableStringify(normalizeReportNineForIntegrity(report));
  const checksum = integrityHash(checksumPayload);
  const signature = integritySignature(checksumPayload);

  const metadataRows: (string | number)[][] = [
    ['AMYC_REPORT_KIND', reportLevel],
    ['REPORT_VERSION', '1.1'],
    ['REPORT_TYPE', report.reportType],
    ['UNIT_ID', report.unitId],
    ['UNIT_NAME', report.unitName],
    ['UNIT_LEVEL', report.level],
    ['YEAR', report.year],
    ['MONTH', monthValue],
    ['CHILD_COUNT', report.childCount],
    ['OPENING_BALANCE', report.openingBalance],
    ['TOTAL_INCOME', report.totalIncome],
    ['TOTAL_EXPENSE', report.totalExpense],
    ['CLOSING_BALANCE', report.closingBalance],
    ['CARRY_FORWARD', report.carryForward],
    ['INTEGRITY_HASH', checksum],
    ['INTEGRITY_SIGNATURE', signature],
    ['GENERATED_AT', report.generatedAt],
    ['TITLE', report.title],
  ];

  XLSX.utils.book_append_sheet(wb, aoaSheet(metadataRows, [26, 42]), META_SHEET);

  // Financial Summary Sheet
  const financialSummaryRows: (string | number)[][] = [
    ['ANSAAR MUSLIM YOUTH CENTRE'],
    [report.title],
    [`${report.unitName} | ${report.year}${report.month ? ` | Mwezi ${report.month}` : ''}`],
    [],
    ['MUHTASARI WA KIFEDHA'],
    [],
    ['Kipengele', 'Kiasi'],
    ['Salio la mwanzo', report.openingBalance],
    ['Jumla ya mapato', report.totalIncome],
    ['Jumla ya matumizi', report.totalExpense],
    ['Salio la mwisho', report.closingBalance],
    ['Carry Forward', report.carryForward],
  ];
  XLSX.utils.book_append_sheet(wb, aoaSheet(financialSummaryRows, [24, 24]), FINANCIAL_SUMMARY_SHEET);

  const summaryRows: (string | number)[][] = [
    ['ANSAAR MUSLIM YOUTH CENTRE'],
    [report.title],
    [`${report.unitName} | ${report.year}${report.month ? ` | Mwezi ${report.month}` : ''}`],
    [],
    ['MUHTASARI WA MIEZI'],
    [],
    ['Mwezi', 'Salio la Mwanzo', 'Mapato', 'Matumizi', 'Salio', 'Salio la Mwisho'],
    ...report.monthlyRows.map((row) => [
      row.label,
      row.openingBalance,
      row.income,
      row.expense,
      row.balance,
      row.closingBalance,
    ]),
    ['JUMLA', report.openingBalance, report.totalIncome, report.totalExpense, report.totalIncome - report.totalExpense, report.closingBalance],
  ];
  XLSX.utils.book_append_sheet(wb, aoaSheet(summaryRows, [14, 18, 18, 18, 18, 18]), SUMMARY_SHEET);

  const unitTitle = report.level === 'jimbo' ? 'MUHTASARI WA JIMBO NA MATAWI' : 'MUHTASARI WA MAJIMBO NA MARKAZ';
  const unitRows: (string | number)[][] = [
    [unitTitle],
    [],
    ['Kitengo', 'Unit ID', 'Code', 'Aina', 'Hali', 'Salio la Mwanzo', 'Mapato', 'Matumizi', 'Salio', 'Salio la Mwisho'],
    ...(report.unitRows || []).map((row) => [
      row.unitName,
      row.unitId,
      row.unitCode || '',
      row.rowKind,
      row.hasUploaded === undefined ? '' : row.hasUploaded === false ? 'Haijapakiwa' : 'Imepakiwa',
      row.openingBalance,
      row.income,
      row.expense,
      row.balance,
      row.closingBalance,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, aoaSheet(unitRows, [34, 12, 16, 12, 14, 18, 18, 18, 18, 18]), UNIT_SHEET);

  const departmentRows: (string | number)[][] = [
    ['Idara', 'Mapato', 'Matumizi', 'Salio'],
    ...report.departmentRows.map((row) => [row.department, row.income, row.expense, row.balance]),
    ['JUMLA', report.totalIncome, report.totalExpense, report.totalIncome - report.totalExpense],
  ];
  XLSX.utils.book_append_sheet(wb, aoaSheet(departmentRows, [24, 18, 18, 18]), DEPARTMENT_SHEET);

  const incomeRows: (string | number)[][] = [
    ['Category', 'Kiasi', 'Asilimia'],
    ...report.incomeCategoryRows.map((row) => [row.category, row.amount, normalizedPercent(row.percent)]),
    ['JUMLA MAPATO', report.totalIncome, '100%'],
  ];
  XLSX.utils.book_append_sheet(wb, aoaSheet(incomeRows, [34, 18, 14]), INCOME_CATEGORY_SHEET);

  const expenseRows: (string | number)[][] = [
    ['Category', 'Kiasi', 'Asilimia'],
    ...report.expenseCategoryRows.map((row) => [row.category, row.amount, normalizedPercent(row.percent)]),
    ['JUMLA MATUMIZI', report.totalExpense, '100%'],
  ];
  XLSX.utils.book_append_sheet(wb, aoaSheet(expenseRows, [34, 18, 14]), EXPENSE_CATEGORY_SHEET);

  return wb;
}

export async function downloadReportNineExcel(report: ConsolidatedReportNineData) {
  const wb = buildReportNineWorkbook(report);
  const level = report.level === 'jimbo' ? 'Jimbo' : 'Markaz';
  const monthPart = report.month ? `_Mwezi_${report.month}` : '';
  const fileName = `AMYC_Ripoti_ya_Tisa_${level}_${report.unitName.replace(/\s+/g, '_')}${monthPart}_${report.year}.xlsx`;
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
  XLSX.writeFile(wb, fileName, { bookType: 'xlsx', type: 'binary' });
}

function sheetRows(workbook: XLSX.WorkBook, sheetName: string) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, defval: '' });
}

function normalizeText(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeHeader(value: unknown) {
  return normalizeText(value)
    .replace(/[()]/g, '')
    .replace(/tsh/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findSheetName(workbook: XLSX.WorkBook, candidates: string[]) {
  const candidateSet = new Set(candidates.map(normalizeText));
  return workbook.SheetNames.find((name) => candidateSet.has(normalizeText(name)))
    || workbook.SheetNames.find((name) => candidates.some((candidate) => normalizeText(name).includes(normalizeText(candidate))));
}

function findHeaderIndex(rows: (string | number)[][], requiredHeaders: string[]) {
  const required = requiredHeaders.map(normalizeHeader);
  return rows.findIndex((row) => {
    const headers = row.map(normalizeHeader);
    return required.every((header) => headers.includes(header));
  });
}

function columnIndex(headerRow: (string | number)[], aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeHeader);
  return headerRow.findIndex((cell) => normalizedAliases.includes(normalizeHeader(cell)));
}

function valueFromRow(row: (string | number)[], headerRow: (string | number)[], aliases: string[]) {
  const index = columnIndex(headerRow, aliases);
  return index >= 0 ? row[index] : '';
}

function metadataFromWorkbook(workbook: XLSX.WorkBook) {
  const rows = sheetRows(workbook, META_SHEET);
  const metadata: Record<string, string | number> = {};

  for (const row of rows) {
    const key = String(row[0] || '').trim();
    if (!key) continue;
    metadata[key] = row[1] as string | number;
  }

  return metadata;
}

function numberValue(value: unknown) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').replace('%', '').replace(/[^\d.-]/g, '');
    return Number(cleaned) || 0;
  }
  return 0;
}

function parseMonthLabel(value: unknown): number | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;

  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 12) {
    return numeric;
  }

  const normalized = raw.toUpperCase();
  const shortMonthIndex = MONTHS_SHORT.findIndex((month) => month.toUpperCase() === normalized);
  if (shortMonthIndex >= 0) {
    return shortMonthIndex + 1;
  }

  const longMonthMap = [
    'JANUARI', 'FEBRUARI', 'MACHI', 'APRILI', 'MEI', 'JUNI',
    'JULAI', 'AGOSTI', 'SEPTEMBA', 'OKTOBA', 'NOVEMBA', 'DESEMBA',
  ];
  const longMonthIndex = longMonthMap.findIndex((month) => month === normalized);
  if (longMonthIndex >= 0) {
    return longMonthIndex + 1;
  }

  const monthFromPhrase = normalized.match(/(?:MWEZI\s*)?(\d{1,2})/);
  if (monthFromPhrase) {
    const parsed = Number(monthFromPhrase[1]);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 12) {
      return parsed;
    }
  }

  return undefined;
}

function parseMonthlyRows(workbook: XLSX.WorkBook): ReportNineMonthlyRow[] {
  const rows = sheetRows(workbook, SUMMARY_SHEET);
  const headerIndex = rows.findIndex((row) => String(row[0]).toLowerCase() === 'mwezi');
  if (headerIndex < 0) return [];

  return rows.slice(headerIndex + 1)
    .filter((row) => row[0] && String(row[0]).toUpperCase() !== 'JUMLA')
    .map((row, index) => ({
      month: parseMonthLabel(row[0]) || index + 1,
      label: String(row[0]),
      openingBalance: numberValue(row[1]),
      income: numberValue(row[2]),
      expense: numberValue(row[3]),
      balance: numberValue(row[4]),
      closingBalance: numberValue(row[5]),
    }));
}

function parseUnitRows(workbook: XLSX.WorkBook): ConsolidatedReportNineData['unitRows'] {
  const rows = sheetRows(workbook, UNIT_SHEET);
  const headerIndex = rows.findIndex((row) => String(row[0]).toLowerCase() === 'kitengo');
  if (headerIndex < 0) return [];

  return rows.slice(headerIndex + 1)
    .filter((row) => row[0])
    .map((row, index) => {
      const rowKindRaw = String(row[3] || '').toLowerCase();
      const rowKind =
        rowKindRaw === 'markaz' || rowKindRaw === 'jimbo' || rowKindRaw === 'tawi' || rowKindRaw === 'jumla'
          ? rowKindRaw
          : 'jimbo';
      return {
        unitId: numberValue(row[1]) || (rowKind === 'jumla' ? 0 : index + 1),
        unitName: String(row[0]),
        unitCode: String(row[2] || '') || undefined,
        rowKind,
        hasUploaded: String(row[4] || '').trim()
          ? String(row[4]).toLowerCase() !== 'haijapakiwa'
          : undefined,
        openingBalance: numberValue(row[5]),
        income: numberValue(row[6]),
        expense: numberValue(row[7]),
        balance: numberValue(row[8]),
        closingBalance: numberValue(row[9]),
      };
    });
}

function parseDepartmentRows(workbook: XLSX.WorkBook): ReportNineDepartmentRow[] {
  const rows = sheetRows(workbook, DEPARTMENT_SHEET);
  return rows.slice(1)
    .filter((row) => row[0] && String(row[0]).toUpperCase() !== 'JUMLA')
    .map((row) => ({
      department: String(row[0]),
      income: numberValue(row[1]),
      expense: numberValue(row[2]),
      balance: numberValue(row[3]),
    }));
}

function parseCategoryRows(workbook: XLSX.WorkBook, sheetName: string): ReportNineCategoryRow[] {
  const rows = sheetRows(workbook, sheetName);
  return rows.slice(1)
    .filter((row) => row[0] && !String(row[0]).toUpperCase().startsWith('JUMLA'))
    .map((row) => {
      const amount = numberValue(row[1]);
      const percent = numberValue(row[2]);
      return {
        category: String(row[0]),
        amount,
        percent,
      };
    });
}

function parseKeyValueSheet(workbook: XLSX.WorkBook, sheetNames: string[]) {
  const sheetName = findSheetName(workbook, sheetNames);
  const rows = sheetName ? sheetRows(workbook, sheetName) : [];
  const values: Record<string, string | number> = {};

  for (const row of rows) {
    const key = normalizeText(row[0]);
    if (!key) continue;
    values[key] = row[1] as string | number;
  }

  return values;
}

function parseFlexibleMonthlyRows(workbook: XLSX.WorkBook): ReportNineMonthlyRow[] {
  const sheetName = findSheetName(workbook, [SUMMARY_SHEET, 'Miezi', 'Muhtasari wa Miezi', 'Muhtasari wa Kila Mwezi']);
  const rows = sheetName ? sheetRows(workbook, sheetName) : [];
  const headerIndex = findHeaderIndex(rows, ['Mwezi', 'Mapato', 'Matumizi']);
  if (headerIndex < 0) return [];

  const header = rows[headerIndex];
  return rows.slice(headerIndex + 1)
    .filter((row) => row[0] && normalizeText(row[0]) !== 'jumla')
    .map((row, index) => {
      const income = numberValue(valueFromRow(row, header, ['Mapato']));
      const expense = numberValue(valueFromRow(row, header, ['Matumizi']));
      const balance = numberValue(valueFromRow(row, header, ['Salio'])) || income - expense;
      return {
        month: parseMonthLabel(valueFromRow(row, header, ['Mwezi'])) || index + 1,
        label: String(valueFromRow(row, header, ['Mwezi']) || row[0]),
        openingBalance: numberValue(valueFromRow(row, header, ['Salio la Mwanzo', 'Salio la mwanzo'])),
        income,
        expense,
        balance,
        closingBalance: numberValue(valueFromRow(row, header, ['Salio la Mwisho', 'Salio la mwisho'])) || balance,
      };
    });
}

function inferUnitRowKind(value: unknown, name: unknown): ReportNineUnitRowKind {
  const raw = normalizeText(value || name);
  if (raw.includes('markaz')) return 'markaz';
  if (raw.includes('jimbo')) return 'jimbo';
  if (raw.includes('tawi')) return 'tawi';
  if (raw.includes('jumla') || raw.includes('total')) return 'jumla';
  return 'tawi';
}

function parseFlexibleUnitRows(workbook: XLSX.WorkBook, fallbackUnitName: string): ReportNineUnitRow[] {
  const sheetName = findSheetName(workbook, [UNIT_SHEET, 'Jimbo na Matawi', 'Markaz na Majimbo', 'Majimbo na Markaz']);
  const rows = sheetName ? sheetRows(workbook, sheetName) : [];
  const headerIndex = findHeaderIndex(rows, ['Kitengo', 'Mapato', 'Matumizi']);
  if (headerIndex < 0) return [];

  const header = rows[headerIndex];
  return rows.slice(headerIndex + 1)
    .filter((row) => row[0])
    .filter((row) => !normalizeText(row[0]).includes('bila ripoti'))
    .map((row, index) => {
      const unitName = String(valueFromRow(row, header, ['Kitengo']) || row[0]);
      const rowKind = inferUnitRowKind(valueFromRow(row, header, ['Aina']), unitName);
      const status = normalizeText(valueFromRow(row, header, ['Hali']));
      const income = numberValue(valueFromRow(row, header, ['Mapato']));
      const expense = numberValue(valueFromRow(row, header, ['Matumizi']));
      const openingBalance = numberValue(valueFromRow(row, header, ['Salio la Mwanzo', 'Salio la mwanzo']));
      const closingBalance = numberValue(valueFromRow(row, header, ['Salio la Mwisho', 'Salio la mwisho']));
      return {
        unitId: rowKind === 'jumla' ? 0 : index + 1,
        unitName: rowKind === 'jimbo' && unitName === fallbackUnitName ? `${unitName} (Jimbo)` : unitName,
        rowKind,
        hasUploaded: status === 'haijapakiwa' ? false : status === 'imepakiwa' ? true : undefined,
        openingBalance,
        income,
        expense,
        balance: income - expense,
        closingBalance,
      };
    });
}

function parseFlexibleDepartmentRows(workbook: XLSX.WorkBook): ReportNineDepartmentRow[] {
  const sheetName = findSheetName(workbook, [DEPARTMENT_SHEET, 'Ki-Idara', 'Idara Kamili', 'Departments']);
  const rows = sheetName ? sheetRows(workbook, sheetName) : [];
  const headerIndex = findHeaderIndex(rows, ['Idara', 'Mapato', 'Matumizi']);
  if (headerIndex < 0) return [];

  const header = rows[headerIndex];
  return rows.slice(headerIndex + 1)
    .filter((row) => row[0] && !normalizeText(row[0]).startsWith('jumla'))
    .map((row) => {
      const income = numberValue(valueFromRow(row, header, ['Mapato']));
      const expense = numberValue(valueFromRow(row, header, ['Matumizi']));
      return {
        department: String(valueFromRow(row, header, ['Idara']) || row[0]),
        income,
        expense,
        balance: numberValue(valueFromRow(row, header, ['Salio'])) || income - expense,
      };
    });
}

function parseFlexibleCategoryRows(workbook: XLSX.WorkBook, candidates: string[], total: number): ReportNineCategoryRow[] {
  const sheetName = findSheetName(workbook, candidates);
  const rows = sheetName ? sheetRows(workbook, sheetName) : [];
  const headerIndex = findHeaderIndex(rows, ['Kategoria', 'Kiasi']);
  if (headerIndex < 0) return [];

  const header = rows[headerIndex];
  return rows.slice(headerIndex + 1)
    .filter((row) => row[0] && !normalizeText(row[0]).startsWith('jumla'))
    .map((row) => {
      const amount = numberValue(valueFromRow(row, header, ['Kiasi', 'Amount']));
      const percent = numberValue(valueFromRow(row, header, ['Asilimia', 'Asilimia %', 'Asilimia (%)']));
      return {
        category: String(valueFromRow(row, header, ['Kategoria', 'Category']) || row[0]),
        amount,
        percent: percent || (total > 0 ? (amount / total) * 100 : 0),
      };
    });
}

function parseRegionalUnifiedWorkbook(workbook: XLSX.WorkBook, metadata: Record<string, string | number>): ConsolidatedReportNineData {
  const summary = parseKeyValueSheet(workbook, ['Muhtasari', FINANCIAL_SUMMARY_SHEET]);
  const unitName = String(metadata.REGION_NAME || summary.jimbo || summary['jimbo la'] || '');
  const year = numberValue(metadata.YEAR || summary.mwaka);
  const rawMonth = metadata.MONTH || summary.kipindi;
  const month = parseMonthLabel(rawMonth) || undefined;
  const normalizedMonth = normalizeText(rawMonth) === 'all' ? undefined : month;
  const totalIncome = numberValue(metadata.INCOME_TOTAL || summary['jumla ya mapato']);
  const totalExpense = numberValue(metadata.EXPENSE_TOTAL || summary['jumla ya matumizi']);
  const unitRows = parseFlexibleUnitRows(workbook, unitName);
  const totalUnitRow = unitRows.find((row) => row.rowKind === 'jumla');
  const openingBalance = totalUnitRow?.openingBalance || numberValue(summary['salio la mwanzo']);
  const closingBalance = totalUnitRow?.closingBalance || numberValue(summary['salio la mwisho']) || openingBalance + totalIncome - totalExpense;

  const monthlyRows = parseFlexibleMonthlyRows(workbook);
  const departmentRows = parseFlexibleDepartmentRows(workbook);
  const incomeCategoryRows = parseFlexibleCategoryRows(workbook, [INCOME_CATEGORY_SHEET, 'Mapato Kategoria', 'Mapato'], totalIncome);
  const expenseCategoryRows = parseFlexibleCategoryRows(workbook, [EXPENSE_CATEGORY_SHEET, 'Matumizi Kategoria', 'Matumizi'], totalExpense);

  return {
    reportType: 'consolidated_master',
    level: 'jimbo',
    unitId: numberValue(metadata.REGION_ID),
    unitName,
    title: 'RIPOTI YA TISA - MJUMUISHO WA MUUNGANIKO WA JIMBO',
    month: normalizedMonth,
    year,
    childLabel: 'Matawi',
    childCount: unitRows.filter((row) => row.rowKind === 'tawi').length,
    generatedAt: String(metadata.GENERATED_AT || new Date().toISOString()),
    openingBalance,
    totalIncome: totalUnitRow?.income || totalIncome,
    totalExpense: totalUnitRow?.expense || totalExpense,
    closingBalance,
    carryForward: closingBalance,
    monthlyRows,
    unitRows,
    departmentRows,
    incomeCategoryRows,
    expenseCategoryRows,
  };
}

export function parseReportNineWorkbook(workbook: XLSX.WorkBook): ConsolidatedReportNineData {
  const metadata = metadataFromWorkbook(workbook);
  const kind = String(metadata.AMYC_REPORT_KIND || '');

  if (kind === 'REGIONAL_UNIFIED_REPORT') {
    const parsed = parseRegionalUnifiedWorkbook(workbook, metadata);
    if (!parsed.unitName || !parsed.year) {
      throw new Error('Faili ya Jimbo imesomwa lakini jina la Jimbo au mwaka havikutambulika.');
    }
    return parsed;
  }

  const requiredSheets = [META_SHEET, SUMMARY_SHEET, DEPARTMENT_SHEET, INCOME_CATEGORY_SHEET, EXPENSE_CATEGORY_SHEET];
  const missingSheets = requiredSheets.filter((sheetName) => !workbook.Sheets[sheetName]);
  if (missingSheets.length > 0) {
    const regionalUnifiedSheet = findSheetName(workbook, ['Jimbo na Matawi', 'Muhtasari', 'Miezi']);
    if (regionalUnifiedSheet) {
      const parsed = parseRegionalUnifiedWorkbook(workbook, metadata);
      if (!parsed.unitName || !parsed.year) {
        throw new Error('Structure ya Excel imetambulika kama ripoti ya Jimbo, lakini jina la Jimbo au mwaka havikusomeka.');
      }
      return parsed;
    }
    throw new Error(`Template si sahihi kwa upload ya Jimbo. Sheet hazipo: ${missingSheets.join(', ')}.`);
  }

  if (kind !== 'REGIONAL_REPORT_NINE' && kind !== 'MARKAZ_REPORT_NINE') {
    throw new Error('Faili hii si Ripoti ya Tisa rasmi ya AMYC. Tafadhali pakia Excel iliyopakuliwa kutoka kwenye Ripoti ya Tisa.');
  }

  const level = kind === 'REGIONAL_REPORT_NINE' ? 'jimbo' : 'markaz';
  const month = numberValue(metadata.MONTH) || undefined;
  const normalizedMonth = month === 0 ? undefined : month;

  const parsed: ConsolidatedReportNineData = {
    reportType: 'consolidated_master',
    level,
    unitId: numberValue(metadata.UNIT_ID),
    unitName: String(metadata.UNIT_NAME || ''),
    title: String(metadata.TITLE || 'RIPOTI YA TISA'),
    month: normalizedMonth,
    year: numberValue(metadata.YEAR),
    childLabel: level === 'jimbo' ? 'Matawi' : 'Majimbo',
    childCount: numberValue(metadata.CHILD_COUNT),
    generatedAt: String(metadata.GENERATED_AT || new Date().toISOString()),
    openingBalance: numberValue(metadata.OPENING_BALANCE),
    totalIncome: numberValue(metadata.TOTAL_INCOME),
    totalExpense: numberValue(metadata.TOTAL_EXPENSE),
    closingBalance: numberValue(metadata.CLOSING_BALANCE),
    carryForward: numberValue(metadata.CARRY_FORWARD),
    monthlyRows: parseMonthlyRows(workbook),
    unitRows: parseUnitRows(workbook),
    departmentRows: parseDepartmentRows(workbook),
    incomeCategoryRows: parseCategoryRows(workbook, INCOME_CATEGORY_SHEET),
    expenseCategoryRows: parseCategoryRows(workbook, EXPENSE_CATEGORY_SHEET),
  };

  const expectedHash = String(metadata.INTEGRITY_HASH || '').trim();
  const expectedSignature = String(metadata.INTEGRITY_SIGNATURE || '').trim();
  if (!expectedHash) {
    throw new Error('Faili imekataliwa: INTEGRITY_HASH haipo.');
  }
  if (!expectedSignature) {
    throw new Error('Faili imekataliwa: INTEGRITY_SIGNATURE haipo.');
  }
  const payload = stableStringify(normalizeReportNineForIntegrity(parsed));
  const legacyPayload = stableStringify(normalizeReportNineForIntegrity({ ...parsed, unitRows: [] }, false));
  const actualSignature = integritySignature(payload);
  const legacySignature = integritySignature(legacyPayload);
  const actualHash = integrityHash(payload);
  const legacyHash = integrityHash(legacyPayload);
  const matchesCurrent = expectedSignature === actualSignature && expectedHash === actualHash;
  const matchesLegacy = expectedSignature === legacySignature && expectedHash === legacyHash;
  if (!matchesCurrent && !matchesLegacy) {
    if (expectedSignature !== actualSignature && expectedSignature !== legacySignature) {
      if (expectedHash !== actualHash && expectedHash !== legacyHash) {
        throw new Error('Faili imekataliwa: signature verification ya Ripoti ya Tisa imeshindwa. Tafadhali tumia Excel iliyopakuliwa kutoka mfumo.');
      }
    }
    throw new Error('Faili imekataliwa: integrity check ya Ripoti ya Tisa imeshindwa. Faili inaweza kuwa imeharibika au imebadilishwa.');
  }

  return parsed;
}

export const REPORT_NINE_IMPORT_SHEETS = {
  metadata: META_SHEET,
  summary: SUMMARY_SHEET,
  units: UNIT_SHEET,
  departments: DEPARTMENT_SHEET,
  incomeCategories: safeSheetName(INCOME_CATEGORY_SHEET),
  expenseCategories: safeSheetName(EXPENSE_CATEGORY_SHEET),
};
