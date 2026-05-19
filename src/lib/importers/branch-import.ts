import * as XLSX from 'xlsx';
import type { BranchReportSnapshot } from '@/lib/exporters/branch-export';
import { integrityHash, integritySignature, stableStringify } from '@/lib/reports/integrity';

const SUMMARY_SHEET = 'Muhtasari';
const INCOME_SHEET = 'Mapato';
const EXPENSE_SHEET = 'Matumizi';
const DEPARTMENT_SHEET = 'Ki-Idara';
const META_SHEET = 'AMYC_METADATA';
const MONTHLY_SHEET_ALIASES = ['Miezi', 'Muhtasari wa Kila Mwezi'];

const SUMMARY_KEYS = {
  branchId: ['TAWI ID', 'BRANCH ID', 'TAWIID', 'BRANCHID'],
  branchName: ['TAWI', 'BRANCH'],
  month: ['KIPINDI', 'MONTH', 'MWEZI', 'PERIOD'],
  year: ['MWAKA', 'YEAR'],
  incomeTotal: ['JUMLA YA MAPATO', 'TOTAL INCOME', 'MAPATO'],
  expenseTotal: ['JUMLA YA MATUMIZI', 'TOTAL EXPENSE', 'MATUMIZI'],
  net: ['SALIO NETO', 'NET'],
};

function normalizeKey(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeSheetName(value: string): string {
  return normalizeKey(value);
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').replace('%', '').trim();
    return normalized === '' ? 0 : Number(normalized);
  }
  return 0;
}

function resolveSheetName(workbook: XLSX.WorkBook, sheetName: string): string | undefined {
  const wanted = normalizeSheetName(sheetName);
  return workbook.SheetNames.find((name) => normalizeSheetName(name) === wanted);
}

function resolveSheetNameFromAliases(workbook: XLSX.WorkBook, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const found = resolveSheetName(workbook, candidate);
    if (found) return found;
  }
  return undefined;
}

function getSheetRows(workbook: XLSX.WorkBook, sheetName: string) {
  const actualSheetName = resolveSheetName(workbook, sheetName);
  const sheet = actualSheetName ? workbook.Sheets[actualSheetName] : undefined;
  if (!sheet) return [] as (string | number)[][];
  return XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, defval: '' });
}

function getMetadata(workbook: XLSX.WorkBook) {
  const rows = getSheetRows(workbook, META_SHEET);
  const metadata: Record<string, string> = {};
  for (const row of rows) {
    const key = String(row[0] || '').trim();
    if (!key) continue;
    metadata[key] = String(row[1] || '').trim();
  }
  return metadata;
}

function parseSummarySheet(workbook: XLSX.WorkBook): Partial<BranchReportSnapshot> {
  const rows = getSheetRows(workbook, SUMMARY_SHEET);
  const result: any = {};

  for (const row of rows) {
    if (!row || row.length < 2) continue;
    const key = normalizeKey(String(row[0] || ''));
    const value = row[1];
    if (!key) continue;

    for (const [field, keys] of Object.entries(SUMMARY_KEYS)) {
      if (keys.some((alias) => normalizeKey(alias) === key)) {
        if (field === 'branchId') {
          result.branchId = String(value).trim();
        } else if (field === 'branchName') {
          result.branchName = String(value).trim();
        } else if (field === 'month') {
          result.month = String(value).trim();
        } else if (field === 'year') {
          result.year = Number(numberValue(value));
        } else if (field === 'incomeTotal') {
          result.income = result.income || { total: 0, categories: {} };
          result.income.total = numberValue(value);
        } else if (field === 'expenseTotal') {
          result.expenses = result.expenses || { total: 0, categories: {} };
          result.expenses.total = numberValue(value);
        } else if (field === 'net') {
          result.net = numberValue(value);
        }
      }
    }
  }

  return result;
}

function parseKeyValueSheetToMap(
  workbook: XLSX.WorkBook,
  sheetName: string,
  headerLabels: string[]
): Record<string, number> {
  const rows = getSheetRows(workbook, sheetName);
  if (rows.length === 0) return {};

  const headerRow = rows.find((row) => {
    const first = normalizeKey(String(row[0] || ''));
    const second = normalizeKey(String(row[1] || ''));
    const matchesFirstColumn = headerLabels.some((label) => normalizeKey(label) === first);
    const matchesAmountColumn = ['KIASI', 'AMOUNT', 'JUMLA', 'TOTAL'].includes(second);
    return matchesFirstColumn && matchesAmountColumn;
  });

  if (!headerRow || headerRow.length < 2) {
    throw new Error(`Sheet ${sheetName} haijaonyesha safu sahihi ya kichwa.`);
  }

  const output: Record<string, number> = {};

  const startIndex = rows.indexOf(headerRow) + 1;
  for (let i = startIndex; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.length < 2) continue;
    const key = String(row[0] || '').trim();
    const value = row[1];
    if (!key) continue;
    const normalizedKey = normalizeKey(key);
    if (normalizedKey === 'JUMLA' || normalizedKey === 'TOTAL') continue;
    const amount = numberValue(value);
    if (!Number.isFinite(amount)) {
      throw new Error(`Kiasi kisicho sahihi kwenye karatasi ${sheetName} kwa kategoria '${key}'.`);
    }
    output[key] = amount;
  }

  return output;
}

function parseDepartmentBreakdownSheet(
  workbook: XLSX.WorkBook,
  sheetName: string
): {
  departments: Record<string, number>;
  departmentDetails?: Record<string, { income: number; expense: number; balance: number }>;
} {
  const rows = getSheetRows(workbook, sheetName);
  if (rows.length === 0) return { departments: {} };

  const headerRow = rows.find((row) => {
    const first = normalizeKey(String(row[0] || ''));
    const second = normalizeKey(String(row[1] || ''));
    const third = normalizeKey(String(row[2] || ''));
    const fourth = normalizeKey(String(row[3] || ''));
    const matchesFirstColumn = ['IDARA', 'DEPARTMENT'].includes(first);
    return matchesFirstColumn && ['MAPATO', 'INCOME'].includes(second) && ['MATUMIZI', 'EXPENSE'].includes(third) && ['SALIO', 'BALANCE'].includes(fourth);
  });

  if (headerRow) {
    const departmentDetails: Record<string, { income: number; expense: number; balance: number }> = {};
    const departments: Record<string, number> = {};
    const startIndex = rows.indexOf(headerRow) + 1;

    for (let i = startIndex; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row || row.length < 4) continue;
      const key = String(row[0] || '').trim();
      if (!key) continue;
      const normalizedKey = normalizeKey(key);
      if (normalizedKey === 'JUMLA' || normalizedKey === 'TOTAL') continue;

      const income = numberValue(row[1]);
      const expense = numberValue(row[2]);
      const balance = numberValue(row[3]);
      departmentDetails[key] = { income, expense, balance };
      departments[key] = balance;
    }

    return { departments, departmentDetails };
  }

  return {
    departments: parseKeyValueSheetToMap(workbook, sheetName, ['IDARA', 'DEPARTMENT']),
  };
}

function validateSnapshot(snapshot: BranchReportSnapshot, options: { expectedMonth?: string; expectedYear?: number; existingBranchIds?: string[] } = {}) {
  if (!snapshot.branchId) throw new Error('Namba/Msimbo wa Tawi haupo kwenye ripoti.');
  if (!snapshot.branchName) throw new Error('Jina la tawi halijapatikana kwenye ripoti.');
  if (!snapshot.month) throw new Error('Kipindi cha ripoti hakijapatikana.');
  if (!snapshot.year || !Number.isFinite(snapshot.year)) throw new Error('Mwaka wa ripoti si sahihi.');
  if (!snapshot.income || !Number.isFinite(snapshot.income.total)) throw new Error('Jumla ya mapato si sahihi.');
  if (!snapshot.expenses || !Number.isFinite(snapshot.expenses.total)) throw new Error('Jumla ya matumizi si sahihi.');
  if (!Number.isFinite(snapshot.net)) throw new Error('Salio neto si sahihi.');
  if (Object.keys(snapshot.income.categories).length === 0 && snapshot.income.total !== 0) {
    throw new Error('Hakuna kategoria za mapato zilizopatikana licha ya ripoti kuwa na mapato.');
  }
  if (Object.keys(snapshot.expenses.categories).length === 0 && snapshot.expenses.total !== 0) {
    throw new Error('Hakuna kategoria za matumizi zilizopatikana licha ya ripoti kuwa na matumizi.');
  }
  if (Object.keys(snapshot.departments).length === 0 && (snapshot.income.total !== 0 || snapshot.expenses.total !== 0)) {
    throw new Error('Hakuna idara zilizopatikana.');
  }

  const incomeCategoryTotal = Object.values(snapshot.income.categories).reduce((total, value) => total + value, 0);
  const expenseCategoryTotal = Object.values(snapshot.expenses.categories).reduce((total, value) => total + value, 0);

  if (Math.abs(incomeCategoryTotal - snapshot.income.total) > 0.01) {
    throw new Error(`Jumla ya kategoria za mapato (${incomeCategoryTotal}) hailingani na jumla ya ripoti (${snapshot.income.total}).`);
  }
  if (Math.abs(expenseCategoryTotal - snapshot.expenses.total) > 0.01) {
    throw new Error(`Jumla ya kategoria za matumizi (${expenseCategoryTotal}) hailingani na jumla ya ripoti (${snapshot.expenses.total}).`);
  }
  if (Math.abs(snapshot.income.total - snapshot.expenses.total - snapshot.net) > 0.01) {
    throw new Error(`Salio neto (${snapshot.net}) hakilingani na mapato - matumizi (${snapshot.income.total - snapshot.expenses.total}).`);
  }

  if (options.expectedMonth && snapshot.month !== options.expectedMonth) {
    throw new Error(`Mwezi haulingani: ${snapshot.month} != ${options.expectedMonth}.`);
  }
  if (options.expectedYear && snapshot.year !== options.expectedYear) {
    throw new Error(`Mwaka haulingani: ${snapshot.year} != ${options.expectedYear}.`);
  }
  if (options.existingBranchIds && options.existingBranchIds.includes(snapshot.branchId)) {
    throw new Error(`Ripoti ya tawi ${snapshot.branchId} tayari imesambazwa. Kupakia rudia hakuruhusiwi.`);
  }
}

async function loadWorkbook(file: File | ArrayBuffer) {
  let arrayBuffer: ArrayBuffer;

  if (file instanceof ArrayBuffer) {
    arrayBuffer = file;
  } else if (typeof Blob !== 'undefined' && file instanceof Blob) {
    arrayBuffer = await file.arrayBuffer();
  } else {
    throw new Error('Faili inapaswa kuwa Excel (.xlsx) au ArrayBuffer.');
  }

  return XLSX.read(arrayBuffer, { type: 'array' });
}

export interface ParseBranchExcelOptions {
  expectedMonth?: string;
  expectedYear?: number;
  existingBranchIds?: string[];
}

export async function parseBranchExcel(
  file: File | ArrayBuffer,
  options: ParseBranchExcelOptions = {}
): Promise<BranchReportSnapshot> {
  const workbook = await loadWorkbook(file);
  const requiredSheets = [META_SHEET, SUMMARY_SHEET, INCOME_SHEET, EXPENSE_SHEET, DEPARTMENT_SHEET];
  const missingSheets = requiredSheets.filter((sheetName) => !resolveSheetName(workbook, sheetName));
  if (missingSheets.length > 0) {
    throw new Error(`Faili imekataliwa: karatasi muhimu hazipo (${missingSheets.join(', ')}).`);
  }
  resolveSheetNameFromAliases(workbook, MONTHLY_SHEET_ALIASES);

  const metadata = getMetadata(workbook);
  if (metadata.AMYC_REPORT_KIND !== 'BRANCH_UNIFIED_REPORT') {
    throw new Error('Faili imekataliwa: si branchUnifiedReport rasmi.');
  }

  const summary = parseSummarySheet(workbook);

  if (!summary.branchId || !summary.branchName) {
    throw new Error('Faili ya Excel haijumuishi metadata ya tawi inayohitajika. Hakikisha karatasi ya Muhtasari ipo.');
  }

  const incomeCategories = parseKeyValueSheetToMap(workbook, INCOME_SHEET, ['KATEGORIA', 'CATEGORY']);
  const expenseCategories = parseKeyValueSheetToMap(workbook, EXPENSE_SHEET, ['KATEGORIA', 'CATEGORY']);
  const { departments, departmentDetails } = parseDepartmentBreakdownSheet(workbook, DEPARTMENT_SHEET);

  const snapshot: BranchReportSnapshot = {
    branchId: String(summary.branchId),
    branchName: String(summary.branchName),
    month: String(summary.month || ''),
    year: summary.year || 0,
    income: {
      total: summary.income?.total ?? 0,
      categories: incomeCategories,
    },
    expenses: {
      total: summary.expenses?.total ?? 0,
      categories: expenseCategories,
    },
    departments,
    departmentDetails,
    net: summary.net ?? 0,
  };

  if (metadata.BRANCH_ID && metadata.BRANCH_ID !== snapshot.branchId) {
    throw new Error('Faili imekataliwa: BRANCH_ID ya metadata hailandani na muhtasari.');
  }
  if (metadata.YEAR && Number(metadata.YEAR) !== snapshot.year) {
    throw new Error('Faili imekataliwa: YEAR ya metadata hailandani na muhtasari.');
  }
  const expectedHash = metadata.INTEGRITY_HASH;
  const expectedSignature = metadata.INTEGRITY_SIGNATURE;
  if (!expectedHash) {
    throw new Error('Faili imekataliwa: INTEGRITY_HASH haipo.');
  }
  if (!expectedSignature) {
    throw new Error('Faili imekataliwa: INTEGRITY_SIGNATURE haipo.');
  }
  const payload = stableStringify({
    branchId: snapshot.branchId,
    branchName: snapshot.branchName,
    month: snapshot.month,
    year: snapshot.year,
    income: snapshot.income,
    expenses: snapshot.expenses,
    departments: snapshot.departments,
    departmentDetails: snapshot.departmentDetails,
    net: snapshot.net,
  });
  const actualSignature = integritySignature(payload);
  if (expectedSignature !== actualSignature) {
    const actualHash = integrityHash(payload);
    if (expectedHash !== actualHash) {
      throw new Error('Faili imekataliwa: signature verification imeshindwa.');
    }
  }
  const actualHash = integrityHash(payload);
  if (expectedHash !== actualHash) {
    throw new Error('Faili imekataliwa: integrity check imeshindwa (inaweza kuwa modified/corrupted).');
  }

  validateSnapshot(snapshot, options);

  return snapshot;
}
