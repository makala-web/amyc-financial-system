'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { db } from '@/lib/db-offline';
import { bulkAddTransactions, deleteTransactionsByImportBatchIds } from '@/lib/storage/transaction-store';
import { queueTransactionCreate } from '@/lib/transaction-sync';
import { useAuthStore } from '@/lib/store';
import type { Transaction, ImportBatch, OrgUnit, Department } from '@/lib/types';
import { DEPARTMENTS, MONTHS, MONTHS_SHORT } from '@/lib/types';
import { parseReportNineWorkbook } from '@/lib/reports/report-nine-excel';
import { saveImportedRegionalReportNine } from '@/lib/reports/consolidated-report-nine';
import type { ConsolidatedReportNineData } from '@/lib/reports/consolidated-report-nine';
import { parseBranchExcel } from '@/lib/importers/branch-import';
import type { BranchReportSnapshot } from '@/lib/exporters/branch-export';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Upload,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  Building2,
  Layers,
  ArrowDownCircle,
  ArrowUpCircle,
  Info,
} from 'lucide-react';

// ============================================================
// Validation helpers
// ============================================================

interface ValidationError {
  row: number;
  column: string;
  message: string;
}

interface ParsedRow {
  rowIndex: number;
  data: Record<string, unknown>;
  errors: ValidationError[];
  isValid: boolean;
  sheetType?: 'income' | 'expense';
  sheetName?: string;
}

interface ImportResult {
  success: boolean;
  totalRows: number;
  importedCount: number;
  errorCount: number;
  errors: ValidationError[];
  batchId?: number;
  sheetSummary?: Record<string, { type: string; count: number }>;
}

interface ImportProgress {
  phase: 'reading' | 'validating' | 'mapping' | 'saving' | 'queueing' | 'done';
  processed: number;
  total: number;
  message: string;
}

// Required columns for income import
const INCOME_REQUIRED_COLUMNS = ['CHANZO CHA MAPATO', 'IDARA', 'KIASI'];
// Required columns for expense import
const EXPENSE_REQUIRED_COLUMNS = ['NA', 'BIDHAA/VIFAA/HUDUMA', 'IDARA', 'JUMLA'];
const PREVIEW_ROW_LIMIT = 500;
const PROCESSING_CHUNK_SIZE = 250;

type ReportTypeSelection = 'zote' | 'mapato' | 'matumizi' | 'ripoti_tisa_jimbo' | 'ripoti_tawi';

function parseMonthString(month?: string): number | undefined {
  if (!month) return undefined;
  const numeric = Number(String(month).trim());
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 12) {
    return numeric;
  }

  const normalized = String(month).trim().toLowerCase();
  const monthIndex = MONTHS.findIndex((m) => m.toLowerCase() === normalized);
  if (monthIndex >= 0) return monthIndex + 1;
  const shortIndex = MONTHS_SHORT.findIndex((m) => m.toLowerCase() === normalized);
  if (shortIndex >= 0) return shortIndex + 1;
  return undefined;
}

function normalizeCompareValue(value: string | number | undefined | null): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function isDuplicateImportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('duplicate import imezuiwa') || message.includes('upakiaji rudufu umezuiwa');
}

async function hashExcelFile(fileToHash: File | null): Promise<string | undefined> {
  if (!fileToHash || !crypto?.subtle) return undefined;
  const buffer = await fileToHash.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// Known header names to detect the actual data header row
const KNOWN_HEADERS = [
  'CHANZO CHA MAPATO', 'IDARA', 'KIASI', 'BIDHAA/VIFAA/HUDUMA',
  'JUMLA', 'TAREHE', 'MWEZI', 'NA', 'KIPIMO', 'IDADI', 'BEI@',
  'MWAKA', 'MAPATO', 'MATUMIZI', 'SALIO', 'MWEZI',
];

// AMYC header markers (indicate rows to skip)
const AMYC_HEADER_MARKERS = ['AMYC', 'MARKAZ', 'JIMBO', 'TAWI', 'ANSAAR'];

// Sheet name to type mapping
const SHEET_TYPE_MAP: Record<string, 'income' | 'expense' | 'summary' | 'departmental'> = {
  'mapato': 'income',
  'matumizi': 'expense',
  'taarifa ya mwaka': 'summary',
  'taarifa': 'summary',
  'ki-idara': 'departmental',
  'ki idara': 'departmental',
  'muunganiko': 'summary',
  'consolidation': 'summary',
};

// Column name mappings (Swahili -> English field)
const COLUMN_MAPPINGS: Record<string, string> = {
  'CHANZO CHA MAPATO': 'source',
  'IDARA': 'department',
  'KIASI': 'amount',
  'KIASI (TSh)': 'amount',
  'NA': 'name',
  'BIDHAA/VIFAA/HUDUMA': 'description',
  'KIPIMO': 'unit',
  'IDADI': 'quantity',
  'BEI@': 'unitPrice',
  'BEI @(TSh)': 'unitPrice',
  'JUMLA': 'amount',
  'JUMLA (TSh)': 'amount',
  'TAREHE': 'date',
  'MWEZI': 'month',
  'MWAKA': 'year',
};

function normalizeColumnName(col: string): string {
  return col.trim().toUpperCase();
}

function validateDepartment(value: string): boolean {
  return DEPARTMENTS.includes(value as Department);
}

function validateAmount(value: unknown): boolean {
  if (typeof value === 'number') return value >= 0;
  if (typeof value === 'string') {
    const num = parseFloat(value.replace(/,/g, ''));
    return !isNaN(num) && num >= 0;
  }
  return false;
}

function parseAmount(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseFloat(value.replace(/,/g, '')) || 0;
  return 0;
}

function yieldToMainThread() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ============================================================
// AMYC Header Row Detection
// ============================================================

interface HeaderDetectionResult {
  headerRowIndex: number;
  headers: string[];
  detectedMonth?: number;
  detectedYear?: number;
  detectedOrgName?: string;
  detectedOrgLevel?: string;
}

/**
 * Scan rows in a sheet to find the actual data header row,
 * skipping any AMYC header rows at the top.
 */
function detectHeaderRow(sheet: XLSX.WorkSheet): HeaderDetectionResult {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const result: HeaderDetectionResult = {
    headerRowIndex: 0,
    headers: [],
  };

  // Scan up to first 15 rows to find the header row
  const maxScanRow = Math.min(range.e.r, range.s.r + 14);

  for (let R = range.s.r; R <= maxScanRow; R++) {
    const rowValues: string[] = [];
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = sheet[cellAddress];
      if (cell && cell.v != null) {
        rowValues.push(String(cell.v).trim().toUpperCase());
      }
    }

    // Check if this row matches at least 2 known data headers
    const matchCount = rowValues.filter(v =>
      KNOWN_HEADERS.some(h => v.includes(h))
    ).length;

    if (matchCount >= 2) {
      result.headerRowIndex = R;

      // Extract actual headers from this row
      const headers: string[] = [];
      for (let C = range.s.c; C <= range.e.c; C++) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        const cell = sheet[cellAddress];
        headers.push(cell && cell.v != null ? String(cell.v).trim() : '');
      }
      result.headers = headers;
      break;
    }

    // Also try to extract month/year from AMYC header rows
    const rowText = rowValues.join(' ');

    // Try to detect year from header rows (e.g., "Mwaka 2025" or "2025")
    const yearMatch = rowText.match(/\b(20\d{2})\b/);
    if (yearMatch && !result.detectedYear) {
      result.detectedYear = parseInt(yearMatch[1]);
    }

    // Try to detect month from header rows (e.g., "Januari 2025")
    for (let i = 0; i < MONTHS.length; i++) {
      if (rowText.includes(MONTHS[i].toUpperCase())) {
        result.detectedMonth = i + 1;
        break;
      }
    }
    // Also try short month names
    if (!result.detectedMonth) {
      for (let i = 0; i < MONTHS_SHORT.length; i++) {
        if (rowText.includes(MONTHS_SHORT[i])) {
          result.detectedMonth = i + 1;
          break;
        }
      }
    }

    // Try to detect org name and level from header rows
    for (const marker of AMYC_HEADER_MARKERS) {
      if (rowText.includes(marker)) {
        // Get the original (non-uppercased) cell value for org name
        for (let C = range.s.c; C <= range.e.c; C++) {
          const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
          const cell = sheet[cellAddress];
          if (cell && cell.v != null) {
            const cellStr = String(cell.v).trim();
            if (cellStr.toUpperCase().includes(marker)) {
              result.detectedOrgName = cellStr;
              // Detect level from parentheses like (Tawi), (Jimbo), (Markaz)
              const levelMatch = cellStr.match(/\((Tawi|Jimbo|Markaz)\)/i);
              if (levelMatch) {
                result.detectedOrgLevel = levelMatch[1].toLowerCase();
              }
              break;
            }
          }
        }
        break;
      }
    }
  }

  // If no header row found, fallback to first row
  if (result.headers.length === 0) {
    result.headerRowIndex = 0;
    const headers: string[] = [];
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: C });
      const cell = sheet[cellAddress];
      headers.push(cell && cell.v != null ? String(cell.v).trim() : '');
    }
    result.headers = headers;
  }

  return result;
}

/**
 * Parse a single sheet with AMYC header detection
 */
function parseSheet(
  sheet: XLSX.WorkSheet,
  sheetName: string
): {
  headers: string[];
  dataRows: Record<string, unknown>[];
  detectedMonth?: number;
  detectedYear?: number;
  sheetType: 'income' | 'expense' | 'summary' | 'departmental';
} {
  const detection = detectHeaderRow(sheet);

  // Determine sheet type from sheet name
  const normalizedSheetName = sheetName.toLowerCase().trim();
  let sheetType: 'income' | 'expense' | 'summary' | 'departmental' = 'income';

  for (const [key, type] of Object.entries(SHEET_TYPE_MAP)) {
    if (normalizedSheetName.includes(key)) {
      sheetType = type;
      break;
    }
  }

  // If sheet type not determined from name, try from headers
  if (sheetType === 'income') {
    const normalizedHeaders = detection.headers.map(normalizeColumnName);
    const hasExpenseCols = normalizedHeaders.includes('BIDHAA/VIFAA/HUDUMA');
    if (hasExpenseCols) {
      sheetType = 'expense';
    }
  }

  // Read data starting from header row
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const dataRows: Record<string, unknown>[] = [];

  // Start from row after header row
  for (let R = detection.headerRowIndex + 1; R <= range.e.r; R++) {
    const rowData: Record<string, unknown> = {};
    let hasData = false;

    detection.headers.forEach((header, C) => {
      if (!header) return;
      const cellAddress = XLSX.utils.encode_cell({ r: R, c: C + range.s.c });
      const cell = sheet[cellAddress];
      const value = cell && cell.v != null ? cell.v : '';
      rowData[header] = value;
      if (value !== '' && value != null) hasData = true;
    });

    // Skip empty rows
    if (hasData) {
      // Skip total/summary rows (JUMLA, JUMBO, etc.)
      const firstVal = Object.values(rowData)[0];
      if (typeof firstVal === 'string') {
        const upper = firstVal.trim().toUpperCase();
        if (upper === 'JUMLA' || upper === 'JUMBO' || upper === 'TOTAL') {
          return {
            headers: detection.headers,
            dataRows,
            detectedMonth: detection.detectedMonth,
            detectedYear: detection.detectedYear,
            sheetType,
          };
        }
      }
      dataRows.push(rowData);
    }
  }

  return {
    headers: detection.headers,
    dataRows,
    detectedMonth: detection.detectedMonth,
    detectedYear: detection.detectedYear,
    sheetType,
  };
}

// ============================================================
// ExcelImport Component
// ============================================================

interface ExcelImportProps {
  orgUnits: OrgUnit[];
  currentOrg?: OrgUnit | null;
  onImportComplete?: (result: ImportResult) => void;
}

export default function ExcelImport({ orgUnits, currentOrg, onImportComplete }: ExcelImportProps) {
  const { currentUser } = useAuthStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [importType, setImportType] = useState<'income' | 'expense' | 'auto'>('auto');
  const [reportTypeSelection, setReportTypeSelection] = useState<ReportTypeSelection>('zote');
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [detectedYear, setDetectedYear] = useState<number | undefined>();
  const [detectedMonth, setDetectedMonth] = useState<number | undefined>();
  const [sheetSummary, setSheetSummary] = useState<Record<string, { type: string; count: number }>>({});
  const [parsedReportNine, setParsedReportNine] = useState<ConsolidatedReportNineData | null>(null);
  const [parsedBranchSnapshot, setParsedBranchSnapshot] = useState<BranchReportSnapshot | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);

  const availableOrgUnits = useMemo(() => {
    if (!currentOrg) return orgUnits;
    if (currentOrg.type === 'jimbo') {
      return orgUnits.filter((org) => org.parentId === currentOrg.id && org.type === 'tawi');
    }
    if (currentOrg.type === 'markaz') {
      return orgUnits.filter((org) => org.parentId === currentOrg.id && org.type === 'jimbo');
    }
    if (currentOrg.type === 'tawi') {
      return orgUnits.filter((org) => org.id === currentOrg.id);
    }
    return orgUnits;
  }, [currentOrg, orgUnits]);

  // If there are available child org units, default selection to the first one.
  useEffect(() => {
    if (!selectedOrgId && availableOrgUnits.length > 0) {
      setSelectedOrgId(String(availableOrgUnits[0].id));
    }
  }, [availableOrgUnits, selectedOrgId]);

  useEffect(() => {
    if (currentOrg?.type === 'jimbo') {
      setReportTypeSelection('ripoti_tawi');
    } else if (currentOrg?.type === 'markaz') {
      setReportTypeSelection('ripoti_tisa_jimbo');
    } else {
      setReportTypeSelection('zote');
    }
  }, [currentOrg]);

  // Detect import type from column headers
  const detectImportType = (headers: string[]): 'income' | 'expense' => {
    const normalized = headers.map(normalizeColumnName);
    const hasExpenseCols = normalized.includes(normalizeColumnName('BIDHAA/VIFAA/HUDUMA'));
    if (hasExpenseCols) return 'expense';
    const hasIncomeCols = INCOME_REQUIRED_COLUMNS.some((col) =>
      normalized.includes(normalizeColumnName(col))
    );
    if (hasIncomeCols) return 'income';
    return 'income'; // default
  };

  // Parse and validate the Excel file
  const parseFile = useCallback(
    async (file: File) => {
      setIsValidating(true);
      setImportResult(null);
      setSheetSummary({});
      setParsedReportNine(null);
      setParsedBranchSnapshot(null);
      setImportProgress({ phase: 'reading', processed: 0, total: 1, message: 'Inasoma faili ya Excel...' });

      try {
        const arrayBuffer = await file.arrayBuffer();
        setImportProgress({ phase: 'reading', processed: 1, total: 2, message: 'Inafungua workbook...' });
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });

        if (reportTypeSelection === 'ripoti_tisa_jimbo') {
          const report = parseReportNineWorkbook(workbook);
          if (report.level !== 'jimbo') {
            throw new Error('Markaz inahitaji kupakia Ripoti ya Tisa ya Jimbo, si ya Markaz.');
          }

          setParsedReportNine(report);
          setParsedBranchSnapshot(null);
          setParsedData([]);
          setColumns(['Ripoti', 'Jimbo', 'Mwaka', 'Mwezi', 'Mapato', 'Matumizi', 'Closing']);
          setSheetSummary({
            'Ripoti ya Tisa': { type: 'regional_report_nine', count: 1 },
          });
          setDetectedYear(report.year);
          setDetectedMonth(report.month);
          setImportResult(null);
          setImportProgress(null);
          setIsValidating(false);
          return;
        }

        if (reportTypeSelection === 'ripoti_tawi') {
          if (currentOrg?.type !== 'jimbo') {
            throw new Error('Ripoti ya Tawi inapakiwa Jimbo pekee.');
          }

          const branchSnapshot = await parseBranchExcel(file);
          setParsedBranchSnapshot(branchSnapshot);
          setParsedReportNine(null);
          setParsedData([]);
          setColumns(['Maelezo', 'Thamani']);
          setSheetSummary({
            'Ripoti ya Tawi': { type: 'branch_report', count: 1 },
          });
          setDetectedYear(branchSnapshot.year);
          setDetectedMonth(parseMonthString(branchSnapshot.month));
          setImportResult(null);
          setImportProgress(null);
          setIsValidating(false);
          return;
        }

        // Determine which sheets to parse based on report type selection
        const sheetNames = workbook.SheetNames;
        let targetSheets: string[] = [];

        if (reportTypeSelection === 'zote') {
          // Parse ALL sheets
          targetSheets = sheetNames;
        } else if (reportTypeSelection === 'mapato') {
          // Only income sheets
          targetSheets = sheetNames.filter(name => {
            const lower = name.toLowerCase();
            return lower.includes('mapato') || lower.includes('income');
          });
          // If no income-specific sheet found, use first sheet
          if (targetSheets.length === 0) targetSheets = [sheetNames[0]];
        } else {
          // Only expense sheets
          targetSheets = sheetNames.filter(name => {
            const lower = name.toLowerCase();
            return lower.includes('matumizi') || lower.includes('expense');
          });
          // If no expense-specific sheet found, use first sheet
          if (targetSheets.length === 0) targetSheets = [sheetNames[0]];
        }

        const allParsedRows: ParsedRow[] = [];
        let allHeaders: string[] = [];
        const summaryMap: Record<string, { type: string; count: number }> = {};
        let globalDetectedYear: number | undefined;
        let globalDetectedMonth: number | undefined;

        for (const sheetName of targetSheets) {
          setImportProgress({
            phase: 'validating',
            processed: allParsedRows.length,
            total: Math.max(allParsedRows.length + 1, 1),
            message: `Inathibitisha karatasi: ${sheetName}`,
          });
          const sheet = workbook.Sheets[sheetName];
          if (!sheet || !sheet['!ref']) continue;

          const parsed = parseSheet(sheet, sheetName);

          // Skip summary/departmental sheets (they don't contain individual transactions)
          if (parsed.sheetType === 'summary' || parsed.sheetType === 'departmental') {
            summaryMap[sheetName] = { type: parsed.sheetType, count: 0 };
            continue;
          }

          // Capture detected month/year from sheet headers
          if (parsed.detectedYear && !globalDetectedYear) {
            globalDetectedYear = parsed.detectedYear;
          }
          if (parsed.detectedMonth && !globalDetectedMonth) {
            globalDetectedMonth = parsed.detectedMonth;
          }

          if (parsed.dataRows.length === 0) {
            summaryMap[sheetName] = { type: parsed.sheetType, count: 0 };
            continue;
          }

          // Set headers from first parsed sheet that has data
          if (allHeaders.length === 0) {
            allHeaders = parsed.headers;
          }

          // Determine import type for this sheet
          const sheetImportType =
            reportTypeSelection === 'mapato' ? 'income'
            : reportTypeSelection === 'matumizi' ? 'expense'
            : parsed.sheetType === 'income' ? 'income'
            : parsed.sheetType === 'expense' ? 'expense'
            : detectImportType(parsed.headers);

          const requiredCols =
            sheetImportType === 'income' ? INCOME_REQUIRED_COLUMNS : EXPENSE_REQUIRED_COLUMNS;

          const normalizedHeaders = parsed.headers.map(normalizeColumnName);

          // Check required columns
          const missingCols = requiredCols.filter(
            (col) => !normalizedHeaders.includes(normalizeColumnName(col))
          );

          if (missingCols.length > 0 && targetSheets.length === 1) {
            // Only show error for required columns if it's a single-sheet import
            setImportResult({
              success: false,
              totalRows: parsed.dataRows.length,
              importedCount: 0,
              errorCount: 1,
              errors: [
                {
                  row: 0,
                  column: missingCols.join(', '),
                  message: `Safu haziipo kwenye karatasi "${sheetName}": ${missingCols.join(', ')}`,
                },
              ],
            });
            setImportProgress(null);
            setIsValidating(false);
            return;
          }

          // Validate each row — apply defaults for empty fields instead of marking invalid
          const sheetParsed: ParsedRow[] = parsed.dataRows.map((row, idx) => {
            const warnings: ValidationError[] = []; // informational only, not blocking

            // Department validation — apply default instead of error
            const deptValue = String(
              row['IDARA'] || row['Idara'] || ''
            ).trim();
            let effectiveDept = deptValue;
            if (!deptValue || !validateDepartment(deptValue)) {
              effectiveDept = DEPARTMENTS[0]; // Default to 'Daawah'
              if (!deptValue) {
                warnings.push({
                  row: idx + 1,
                  column: 'IDARA',
                  message: 'Idara imeachwa wazi — imewekwa chaguo-msingi: Daawah',
                });
              } else {
                warnings.push({
                  row: idx + 1,
                  column: 'IDARA',
                  message: `Idara "${deptValue}" si sahihi — imewekwa chaguo-msingi: Daawah`,
                });
              }
            }

            // Amount validation — default to 0 instead of error
            const amountKeyNormalized = normalizedHeaders.includes('KIASI (TSh)')
              ? 'KIASI (TSh)'
              : normalizedHeaders.includes('JUMLA (TSh)')
                ? 'JUMLA (TSh)'
                : normalizedHeaders.includes('KIASI')
                  ? 'KIASI'
                  : 'JUMLA';
            const amountRaw = parsed.headers.find(
              (h) => normalizeColumnName(h) === amountKeyNormalized
            );
            const amountValue = amountRaw ? row[amountRaw] : null;
            let effectiveAmount = 0;
            if (amountValue === null || amountValue === '' || amountValue === undefined) {
              effectiveAmount = 0;
              warnings.push({
                row: idx + 1,
                column: amountKeyNormalized,
                message: 'Kiasi limeachwa wazi — imewekwa 0',
              });
            } else if (validateAmount(amountValue)) {
              effectiveAmount = parseAmount(amountValue);
            } else {
              effectiveAmount = 0;
              warnings.push({
                row: idx + 1,
                column: amountKeyNormalized,
                message: 'Kiasi si nambari halali — imewekwa 0',
              });
            }

            // Source/description defaults
            const sourceRaw = String(row['CHANZO CHA MAPATO'] || row['Chanzo cha Mapato'] || '').trim();
            const descRaw = String(row['BIDHAA/VIFAA/HUDUMA'] || row['Bidhaa/Vifaa/Huduma'] || '').trim();
            if (!sourceRaw) {
              warnings.push({
                row: idx + 1,
                column: 'CHANZO CHA MAPATO',
                message: 'Chanzo cha mapato imeachwa wazi — imewekwa: Vyanzo vingine',
              });
            }
            if (!descRaw) {
              warnings.push({
                row: idx + 1,
                column: 'BIDHAA/VIFAA/HUDUMA',
                message: 'Maelezo yameachwa wazi',
              });
            }

            // A row is valid as long as it has ANY non-empty field
            // Only completely empty rows are invalid
            const hasAnyData = Object.values(row).some(
              v => v !== '' && v != null && v !== 0
            );

            // Store effective values in row data for use during import
            const enrichedRow = { ...row, _effectiveDept: effectiveDept, _effectiveAmount: effectiveAmount };

            return {
              rowIndex: idx + 1,
              data: enrichedRow,
              errors: warnings, // informational warnings, not errors
              isValid: hasAnyData,
              sheetType: sheetImportType as 'income' | 'expense',
              sheetName,
            };
          });

          summaryMap[sheetName] = {
            type: sheetImportType,
            count: sheetParsed.filter(r => r.isValid).length,
          };

          allParsedRows.push(...sheetParsed);
          await yieldToMainThread();
        }

        // Set state
        setRawHeaders(allHeaders);
        setColumns(allHeaders);
        setParsedData(allParsedRows);
        setSheetSummary(summaryMap);
        setDetectedYear(globalDetectedYear);
        setDetectedMonth(globalDetectedMonth);

        // Auto-detect import type
        if (importType === 'auto') {
          // If we have both income and expense rows from multi-sheet
          const hasIncome = allParsedRows.some(r => r.sheetType === 'income');
          const hasExpense = allParsedRows.some(r => r.sheetType === 'expense');
          if (hasIncome && hasExpense) {
            setImportType('auto'); // keep auto for multi-sheet
          } else if (hasExpense) {
            setImportType('expense');
          } else {
            setImportType('income');
          }
        }

        if (allParsedRows.length === 0) {
          setImportResult({
            success: false,
            totalRows: 0,
            importedCount: 0,
            errorCount: 1,
            errors: [{ row: 0, column: '', message: 'Faili halina data ya miamala. Karatasi za muhtasari tu zimepatikana.' }],
          });
        }
        setImportProgress(null);
      } catch (error) {
        setImportResult({
          success: false,
          totalRows: 0,
          importedCount: 0,
          errorCount: 1,
        errors: [{ row: 0, column: '', message: error instanceof Error ? error.message : `Hitilafu kusoma faili: ${String(error)}` }],
        });
        setImportProgress(null);
      }

      setIsValidating(false);
    },
    [importType, reportTypeSelection]
  );

  // Handle file selection
  const handleFileSelect = (selectedFile: File) => {
    if (!selectedFile.name.endsWith('.xlsx') && !selectedFile.name.endsWith('.xls')) {
      setImportResult({
        success: false,
        totalRows: 0,
        importedCount: 0,
        errorCount: 1,
        errors: [{ row: 0, column: '', message: 'Tafadhali chagua faili ya Excel (.xlsx)' }],
      });
      setImportProgress(null);
      return;
    }
    setFile(selectedFile);
    setParsedData([]);
    setParsedReportNine(null);
    setImportResult(null);
    setImportProgress(null);
    setDetectedYear(undefined);
    setDetectedMonth(undefined);
    setSheetSummary({});
    parseFile(selectedFile);
  };

  // Drag & drop handlers
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFileSelect(e.dataTransfer.files[0]);
      }
    },
    [handleFileSelect]
  );

  // Import data into database
  const handleImport = async () => {
    if (!selectedOrgId) {
      setImportResult({
        success: false,
        totalRows: parsedData.length,
        importedCount: 0,
        errorCount: 1,
        errors: [{ row: 0, column: '', message: 'Tafadhali chagua kitengo kabla ya kupakia.' }],
      });
      return;
    }

    if (parsedData.length === 0 && !parsedReportNine && !parsedBranchSnapshot) {
      setImportResult({
        success: false,
        totalRows: 0,
        importedCount: 0,
        errorCount: 1,
        errors: [{ row: 0, column: '', message: 'Hakuna data ya kupakia. Tafadhali chagua faili ya Excel ambayo ina data.' }],
      });
      return;
    }

    setIsImporting(true);
    setImportProgress({ phase: 'mapping', processed: 0, total: parsedData.length || 1, message: 'Inajiandaa kupakia data...' });

    try {
      const effectiveUserId = currentUser?.id ?? 0;
      const orgId = parseInt(selectedOrgId);
      const orgUnit = await db.orgUnits.get(orgId);
      if (!orgUnit) {
        setImportResult({
          success: false,
          totalRows: parsedData.length,
          importedCount: 0,
          errorCount: 1,
          errors: [{ row: 0, column: '', message: 'Kitengo hakipatikani' }],
        });
        setIsImporting(false);
        setImportProgress(null);
        return;
      }

      if (reportTypeSelection === 'ripoti_tisa_jimbo') {
        if (!parsedReportNine) {
          throw new Error('Hakuna Ripoti ya Tisa iliyosomwa kwenye faili.');
        }
        if (currentOrg?.type !== 'markaz') {
          throw new Error('Ripoti ya Tisa ya Jimbo inapakiwa Markaz Kuu pekee.');
        }
        if (orgUnit.type !== 'jimbo') {
          throw new Error('Chagua Jimbo sahihi kabla ya kupakia Ripoti ya Tisa.');
        }
        if (orgUnit.parentId !== currentOrg.id) {
          throw new Error('Jimbo umechaguliwa si mtoto wa Markaz Kuu hii. Chagua Jimbo kutoka kwenye Markaz Kuu yako.');
        }
        if (parsedReportNine.level !== 'jimbo') {
          throw new Error('Faili imekataliwa: ripoti hii si ya ngazi ya Jimbo.');
        }

        const snapshotUnitId = normalizeCompareValue(parsedReportNine.unitId);
        const snapshotUnitName = normalizeCompareValue(parsedReportNine.unitName);
        const allowedUnitIds = [String(orgUnit.id), String(orgUnit.code || '')]
          .map((v) => normalizeCompareValue(v))
          .filter(Boolean);
        const selectedUnitName = normalizeCompareValue(orgUnit.name);
        const idMatches = allowedUnitIds.includes(snapshotUnitId);
        const nameMatches = selectedUnitName && selectedUnitName === snapshotUnitName;

        if (!idMatches && !nameMatches) {
          throw new Error(
            `Faili imekataliwa: Namba/Msimbo wa Jimbo kwenye ripoti (${parsedReportNine.unitId}) au jina la Jimbo (${parsedReportNine.unitName}) halilingani na Jimbo lililochaguliwa (${orgUnit.name}${orgUnit.code ? ` / ${orgUnit.code}` : ''}).`
          );
        }

        let overwrite = false;
        try {
          await saveImportedRegionalReportNine({
            regionId: orgId,
            report: parsedReportNine,
            importedBy: effectiveUserId,
            fileName: file?.name,
          });
        } catch (error) {
          if (!isDuplicateImportError(error)) throw error;
          overwrite = window.confirm(
            'Ripoti ya Jimbo ya kipindi hiki tayari ipo Markaz. Unataka ku-update kwa data mpya ya Jimbo hili?'
          );
          if (!overwrite) {
            throw new Error('Upakiaji umeghairiwa. Ripoti ya Jimbo iliyokuwepo imeachwa kama ilivyo.');
          }
          await saveImportedRegionalReportNine({
            regionId: orgId,
            report: parsedReportNine,
            importedBy: effectiveUserId,
            fileName: file?.name,
            overwrite: true,
          });
        }

        const now = new Date().toISOString();
        const batchId = await db.importBatches.add({
          fileName: file?.name || 'ripoti_ya_tisa_jimbo.xlsx',
          sourceOrgId: orgId,
          targetOrgId: currentOrg.id!,
          importType: 'regional_report_nine',
          recordCount: 1,
          status: 'processed',
          importedBy: effectiveUserId,
          createdAt: now,
        } as ImportBatch);

        const result: ImportResult = {
          success: true,
          totalRows: 1,
          importedCount: 1,
          errorCount: 0,
          errors: [],
          batchId: batchId as number,
          sheetSummary: { 'Ripoti ya Tisa': { type: 'regional_report_nine', count: 1 } },
        };

        setImportResult(result);
        setImportProgress(null);
        onImportComplete?.(result);
        alert(`Imefanikiwa! Ripoti ya Tisa ya ${orgUnit.name} imepakiwa Markaz Kuu na itatumika kwenye muunganiko wa Markaz.`);
        setIsImporting(false);
        return;
      }

      if (reportTypeSelection === 'ripoti_tawi') {
        const { saveImportedBranchReportOffline } = await import('@/lib/reports/branch-unified-offline');
        if (!parsedBranchSnapshot) {
          throw new Error('Hakuna Ripoti ya Tawi iliyosomwa kwenye faili.');
        }
        if (currentOrg?.type !== 'jimbo') {
          throw new Error('Ripoti ya Tawi inapakiwa Jimbo pekee.');
        }
        if (orgUnit.type !== 'tawi') {
          throw new Error('Chagua Tawi sahihi kabla ya kupakia Ripoti ya Tawi.');
        }
        if (orgUnit.parentId !== currentOrg.id) {
          throw new Error('Tawi umechaguliwa si mtoto wa Jimbo hili. Chagua Tawi kutoka kwenye Jimbo lako.');
        }
        const snapshotBranchId = normalizeCompareValue(parsedBranchSnapshot.branchId);
        const snapshotBranchName = normalizeCompareValue(parsedBranchSnapshot.branchName);
        const allowedIds = [String(orgUnit.id), String(orgUnit.code || '')]
          .map((v) => normalizeCompareValue(v))
          .filter(Boolean);
        const selectedBranchName = normalizeCompareValue(orgUnit.name);
        const idMatches = allowedIds.includes(snapshotBranchId);
        const nameMatches = selectedBranchName && selectedBranchName === snapshotBranchName;

        if (!idMatches && !nameMatches) {
          throw new Error(
            `Faili imekataliwa: Namba/Msimbo wa Tawi kwenye ripoti (${parsedBranchSnapshot.branchId}) au jina la tawi (${parsedBranchSnapshot.branchName}) halilingani na tawi lililochaguliwa (${orgUnit.name}${orgUnit.code ? ` / ${orgUnit.code}` : ''}).`
          );
        }

        let overwrite = false;
        try {
          await saveImportedBranchReportOffline({
            snapshot: parsedBranchSnapshot,
            branchId: orgId,
            uploadedBy: effectiveUserId,
            fileName: file?.name,
          });
        } catch (error) {
          if (!isDuplicateImportError(error)) throw error;
          overwrite = window.confirm(
            'Tawi hili tayari limeshapakiwa kwa kipindi hiki kwenye Jimbo. Unataka ku-update kwa data mpya ya tawi hili?'
          );
          if (!overwrite) {
            throw new Error('Upakiaji umeghairiwa. Ripoti ya Tawi iliyokuwepo imeachwa kama ilivyo.');
          }
          await saveImportedBranchReportOffline({
            snapshot: parsedBranchSnapshot,
            branchId: orgId,
            uploadedBy: effectiveUserId,
            fileName: file?.name,
            overwrite: true,
          });
        }

        const now = new Date().toISOString();
        const batchId = await db.importBatches.add({
          fileName: file?.name || 'ripoti_ya_tawi.xlsx',
          sourceOrgId: orgId,
          targetOrgId: currentOrg.id!,
          importType: 'branch_report',
          recordCount: 1,
          status: 'processed',
          importedBy: effectiveUserId,
          createdAt: now,
        } as ImportBatch);

        const result: ImportResult = {
          success: true,
          totalRows: 1,
          importedCount: 1,
          errorCount: 0,
          errors: [],
          batchId: batchId as number,
          sheetSummary: { 'Ripoti ya Tawi': { type: 'branch_report', count: 1 } },
        };

        setImportResult(result);
        setImportProgress(null);
        onImportComplete?.(result);
        alert(`Imefanikiwa! Ripoti ya Tawi ya ${orgUnit.name} imepakiwa na itaunganishwa kwenye ripoti ya Jimbo.`);
        setIsImporting(false);
        return;
      }

      const validRows = parsedData.filter((r) => r.isValid);
      const errorRows = parsedData.filter((r) => !r.isValid);

      // Determine overall import type
      const hasIncome = validRows.some(r => r.sheetType === 'income');
      const hasExpense = validRows.some(r => r.sheetType === 'expense');
      let batchImportType: 'income' | 'expense' | 'both' = 'both';
      if (hasIncome && !hasExpense) batchImportType = 'income';
      if (!hasIncome && hasExpense) batchImportType = 'expense';

      const now = new Date().toISOString();

      // Use detected year/month from file, fallback to current
      const importYear = detectedYear || new Date().getFullYear();
      const importMonth = detectedMonth || new Date().getMonth() + 1;
      const fileHash = await hashExcelFile(file);

      const previousBatches = await db.importBatches
        .where('sourceOrgId')
        .equals(orgId)
        .toArray();
      const periodBatches = previousBatches.filter((batch) => {
        const candidate = batch as ImportBatch;
        return candidate.targetOrgId === orgId
          && candidate.status === 'processed'
          && candidate.importType === batchImportType
          && candidate.periodYear === importYear
          && candidate.periodMonth === importMonth;
      });
      const duplicateBatch = periodBatches.find((batch) => {
        const candidate = batch as ImportBatch;
        return (fileHash && candidate.fileHash === fileHash)
          || (!fileHash && candidate.fileName === (file?.name || 'unknown.xlsx'));
      });

      if (duplicateBatch) {
        throw new Error(
          `Upakiaji rudufu umezuiwa: faili hili tayari lilipakiwa kwa ${MONTHS[importMonth - 1]} ${importYear}. Batch #${duplicateBatch.id}.`
        );
      }

      if (periodBatches.length > 0) {
        const replace = window.confirm(
          `${MONTHS[importMonth - 1]} ${importYear} tayari ina import ya ${orgUnit.name}. Unataka ku-archive version ya zamani na kui-replace kwa faili hili jipya?`
        );
        if (!replace) {
          throw new Error('Upakiaji umeghairiwa. Import iliyokuwepo imeachwa kama ilivyo.');
        }

        const previousBatchIds = periodBatches
          .map((batch) => batch.id)
          .filter((id): id is number => typeof id === 'number');
        const previousTransactions = previousBatchIds.length > 0
          ? await db.transactions.where('importBatchId').anyOf(previousBatchIds).toArray()
          : [];

        await db.reportArchives.add({
          entity: 'generic_excel_import',
          entityId: previousBatchIds[0] || orgId,
          sourceOrgId: orgId,
          targetOrgId: orgId,
          month: importMonth,
          year: importYear,
          previousDataJson: JSON.stringify({
            batches: periodBatches,
            transactions: previousTransactions,
          }),
          replacementDataJson: JSON.stringify({
            fileName: file?.name || 'unknown.xlsx',
            fileHash,
            rows: validRows.length,
          }),
          reason: 'Controlled replacement of existing Excel import for same org/period',
          archivedBy: effectiveUserId,
          archivedAt: now,
        });

        if (previousBatchIds.length > 0) {
          await deleteTransactionsByImportBatchIds(previousBatchIds);
        }
        await db.auditLogs.add({
          action: 'REPLACE_IMPORT',
          entity: 'generic_excel_import',
          entityId: orgId,
          userId: effectiveUserId,
          details: `Archived and replaced ${periodBatches.length} import batch(es) for ${orgUnit.name}, ${importMonth}/${importYear}`,
          createdAt: now,
        });
      }

      // Create import batch
      const batchId = await db.importBatches.add({
        fileName: file?.name || 'unknown.xlsx',
        fileHash,
        sourceOrgId: orgId,
        targetOrgId: orgId,
        importType: batchImportType,
        periodMonth: importMonth,
        periodYear: importYear,
        recordCount: validRows.length,
        status: 'processed',
        importedBy: effectiveUserId,
        createdAt: now,
      } as ImportBatch);

      // Map columns and create transactions — use effective defaults for empty fields
      const transactions: Transaction[] = [];
      for (let rowIndex = 0; rowIndex < validRows.length; rowIndex++) {
        const row = validRows[rowIndex];
        if (rowIndex % PROCESSING_CHUNK_SIZE === 0) {
          setImportProgress({
            phase: 'mapping',
            processed: rowIndex,
            total: validRows.length,
            message: 'Inabadilisha mistari kuwa miamala...',
          });
          await yieldToMainThread();
        }
        const normalizedHeaders = Object.keys(row.data).map(normalizeColumnName);
        const originalHeaders = Object.keys(row.data);

        // Use effective department (from validation step with defaults applied)
        const effectiveDept = (row.data._effectiveDept || DEPARTMENTS[0]) as Department;

        // Determine the type for this specific row
        const rowType: 'income' | 'expense' = row.sheetType || 'income';

        // Use effective amount (from validation step with defaults applied)
        const effectiveAmount = (row.data._effectiveAmount as number) ?? 0;

        // Source/category — default to "Hakuna maelezo" if empty
        const sourceHeader = originalHeaders.find(
          (h) => normalizeColumnName(h) === 'CHANZO CHA MAPATO'
        );
        const sourceValue = sourceHeader ? String(row.data[sourceHeader] || '').trim() : '';

        // Description — default to "Hakuna maelezo" if empty
        const descHeader = originalHeaders.find(
          (h) => normalizeColumnName(h) === 'BIDHAA/VIFAA/HUDUMA'
        );
        const descValue = descHeader ? String(row.data[descHeader] || '').trim() : '';

        // Date — default to detected period date or current date
        const dateHeader = originalHeaders.find((h) => normalizeColumnName(h) === 'TAREHE');
        const dateValue = dateHeader ? String(row.data[dateHeader] || '') : '';

        // Month from data
        const monthHeader = originalHeaders.find((h) => normalizeColumnName(h) === 'MWEZI');
        let rowMonth = importMonth;
        if (monthHeader) {
          const monthVal = row.data[monthHeader];
          if (typeof monthVal === 'number' && monthVal >= 1 && monthVal <= 12) {
            rowMonth = monthVal;
          } else if (typeof monthVal === 'string') {
            // Try to parse month name
            const upperMonth = monthVal.trim().toUpperCase();
            for (let i = 0; i < MONTHS.length; i++) {
              if (upperMonth.includes(MONTHS[i].toUpperCase())) {
                rowMonth = i + 1;
                break;
              }
            }
            for (let i = 0; i < MONTHS_SHORT.length; i++) {
              if (upperMonth.includes(MONTHS_SHORT[i])) {
                rowMonth = i + 1;
                break;
              }
            }
          }
        }

        // Year from data
        const yearHeader = originalHeaders.find((h) => normalizeColumnName(h) === 'MWAKA');
        let rowYear = importYear;
        if (yearHeader) {
          const yearVal = row.data[yearHeader];
          if (typeof yearVal === 'number' && yearVal >= 2026 && yearVal <= 2040) {
            rowYear = yearVal;
          } else if (typeof yearVal === 'string') {
            const parsed = parseInt(yearVal);
            if (!isNaN(parsed) && parsed >= 2026 && parsed <= 2040) {
              rowYear = parsed;
            }
          }
        }

        // Quantity — default to 1 if empty
        const qtyHeader = originalHeaders.find((h) => normalizeColumnName(h) === 'IDADI');
        const rawQty = qtyHeader ? parseAmount(row.data[qtyHeader]) : 0;
        const qtyValue = rawQty > 0 ? rawQty : 1;

        // Unit price — default to amount value if empty
        const priceHeader = originalHeaders.find(
          (h) => normalizeColumnName(h) === 'BEI@' || normalizeColumnName(h) === 'BEI @(TSh)'
        );
        const rawPrice = priceHeader ? parseAmount(row.data[priceHeader]) : 0;
        const priceValue = rawPrice > 0 ? rawPrice : effectiveAmount;

        // Unit — default to "-" if empty
        const unitHeader = originalHeaders.find((h) => normalizeColumnName(h) === 'KIPIMO');
        const rawUnit = unitHeader ? String(row.data[unitHeader] || '').trim() : '';
        const unitValue = rawUnit || '-';

        // Vendor — default to empty string if empty
        const nameHeader = originalHeaders.find((h) => normalizeColumnName(h) === 'NA');
        const vendorValue = nameHeader ? String(row.data[nameHeader] || '').trim() : '';

        // Apply defaults for empty source/category_name/description
        const defaultCategoryName = 'Vyanzo vingine';
        const finalSource = sourceValue || defaultCategoryName;
        const finalDesc = descValue || ''; // empty description defaults to ''

        transactions.push({
          type: rowType,
          amount: effectiveAmount,
          date: dateValue || `${rowYear}-${String(rowMonth).padStart(2, '0')}-01`,
          month: rowMonth,
          year: rowYear,
          department: effectiveDept,
          categoryId: 0,
          category_name: finalSource,
          description: finalDesc,
          source: rowType === 'income' ? finalSource : undefined,
          vendor: rowType === 'expense' ? vendorValue : undefined,
          quantity: rowType === 'expense' ? qtyValue : undefined,
          unitPrice: rowType === 'expense' ? priceValue : undefined,
          unit: rowType === 'expense' ? unitValue : undefined,
          orgUnitId: orgId,
          orgUnitName: orgUnit.name,
          orgLevel: orgUnit.type,
            enteredBy: effectiveUserId,
          importBatchId: batchId as number,
          createdAt: now,
          updatedAt: now,
        } as Transaction);
      }

      // Add all transactions
      await bulkAddTransactions(transactions, (progress) => {
        setImportProgress({
          phase: 'saving',
          processed: progress.processed,
          total: progress.total,
          message: `Inahifadhi miamala kwenye local database (${progress.processed}/${progress.total})...`,
        });
      });

      const imported = await db.transactions
        .where('importBatchId')
        .equals(batchId as number)
        .toArray();
      for (let index = 0; index < imported.length; index++) {
        const txn = imported[index];
        if (index % PROCESSING_CHUNK_SIZE === 0) {
          setImportProgress({
            phase: 'queueing',
            processed: index,
            total: imported.length,
            message: 'Inaandaa import history na audit queue...',
          });
          await yieldToMainThread();
        }
        if (txn.id) {
          queueTransactionCreate(txn as typeof txn & { id: number });
        }
      }

      const allErrors = errorRows.flatMap((r) => r.errors);

      const result: ImportResult = {
        success: true,
        totalRows: parsedData.length,
        importedCount: validRows.length,
        errorCount: errorRows.length,
        errors: allErrors,
        batchId: batchId as number,
        sheetSummary,
      };

      setImportResult(result);
      setImportProgress(null);
      onImportComplete?.(result);

      // Show clear success toast-style message via alert for count of records imported
      if (validRows.length > 0) {
        const incomeCount = validRows.filter(r => r.sheetType === 'income').length;
        const expenseCount = validRows.filter(r => r.sheetType === 'expense').length;
        const parts: string[] = [];
        if (incomeCount > 0) parts.push(`Mapato: ${incomeCount}`);
        if (expenseCount > 0) parts.push(`Matumizi: ${expenseCount}`);
        const detailStr = parts.length > 0 ? ` (${parts.join(', ')})` : '';
        alert(`✅ Imefanikiwa! Rekodi ${validRows.length} zimeingizwa${detailStr}.`);
      }
    } catch (error) {
      setImportResult({
        success: false,
        totalRows: parsedData.length,
        importedCount: 0,
        errorCount: 1,
        errors: [{ row: 0, column: '', message: error instanceof Error ? error.message : `Hitilafu wakati wa kupakia: ${String(error)}` }],
      });
      setImportProgress(null);
    }

    setIsImporting(false);
  };

  // Reset form
  const handleReset = () => {
    setFile(null);
    setParsedData([]);
    setParsedReportNine(null);
    setParsedBranchSnapshot(null);
    setColumns([]);
    setImportResult(null);
    setImportProgress(null);
    setImportType('auto');
    setRawHeaders([]);
    setDetectedYear(undefined);
    setDetectedMonth(undefined);
    setSheetSummary({});
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const validCount = parsedData.filter((r) => r.isValid).length;
  const invalidCount = parsedData.filter((r) => !r.isValid).length;
  const previewRows = parsedData.slice(0, PREVIEW_ROW_LIMIT);
  const hiddenPreviewRows = Math.max(parsedData.length - previewRows.length, 0);
  const progressPercent = importProgress
    ? Math.min(100, Math.round((importProgress.processed / Math.max(importProgress.total, 1)) * 100))
    : 0;

  // Compute upload context info
  const selectedOrg = availableOrgUnits.find(o => o.id === parseInt(selectedOrgId));
  const uploadContextLabel = currentOrg?.type === 'jimbo'
    ? 'Jimbo linapakia ripoti za Tawi'
    : currentOrg?.type === 'markaz'
      ? 'Markaz linapakia ripoti za Jimbo'
      : 'Tawi linapakia ripoti yake';
  const uploadContextHelp = currentOrg?.type === 'jimbo'
    ? 'Chagua Tawi sahihi, kisha pakia faili ya Excel ya Ripoti ya Tawi kutoka Tawi ili iunganishwe kwenye ripoti ya Jimbo.'
    : currentOrg?.type === 'markaz'
      ? 'Chagua Jimbo sahihi, kisha pakia faili ya Excel ya Ripoti ya Jimbo ili iunganishwe kwenye ripoti ya Markaz.'
      : 'Pakua au pakia Excel ya Ripoti ya Tawi kwa ajili ya tawi lako.';

  return (
    <Card className="border-emerald-200 dark:border-emerald-900">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
          <Upload className="h-5 w-5" />
          Pakia Excel
        </CardTitle>
        <CardDescription>Pakia data kutoka faili ya Excel kwenye mfumo</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Upload Context Banner */}
        {currentOrg && (
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/20 p-4 border border-emerald-200 dark:border-emerald-800">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                  {uploadContextLabel}
                </p>
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  {uploadContextHelp}
                </p>
                <div className="flex flex-wrap gap-2 text-xs text-emerald-700 dark:text-emerald-400">
                  <span className="flex items-center gap-1">
                    <Building2 className="h-3 w-3" />
                    {currentOrg.name} ({currentOrg.type === 'tawi' ? 'Tawi' : currentOrg.type === 'jimbo' ? 'Jimbo' : 'Markaz'})
                  </span>
                  {selectedOrg && selectedOrg.id !== currentOrg.id && (
                    <span className="flex items-center gap-1">
                      → {selectedOrg.name}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Report Type Selection */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Aina ya Ripoti</Label>
          {currentOrg?.type === 'jimbo' ? (
            <div className="rounded-lg border-2 border-emerald-200 p-4 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                <div>
                  <p className="text-sm font-medium">Ripoti ya Tawi</p>
                  <p className="text-xs text-muted-foreground">Chagua Ripoti ya Tawi kutoka Tawi iliyopo kwenye Excel, itapakiwa na kuingizwa kwenye Jimbo.</p>
                </div>
              </div>
            </div>
          ) : currentOrg?.type === 'markaz' ? (
            <div className="rounded-lg border-2 border-amber-200 p-4 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-amber-600" />
                <div>
                  <p className="text-sm font-medium">Ripoti ya Jimbo</p>
                  <p className="text-xs text-muted-foreground">Chagua Ripoti ya Jimbo iliyojumuisha matawi ili iweze kupakiwa na kuunganishwa kwa Markaz Kuu.</p>
                </div>
              </div>
            </div>
          ) : (
            <RadioGroup
              value={reportTypeSelection}
              onValueChange={(val) => setReportTypeSelection(val as ReportTypeSelection)}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
            >
              <div className="flex items-center space-x-2 rounded-lg border-2 p-3 cursor-pointer transition-colors hover:border-emerald-300 dark:hover:border-emerald-700 has-[button[data-state=checked]]:border-emerald-500 has-[button[data-state=checked]]:bg-emerald-50 dark:has-[button[data-state=checked]]:bg-emerald-950/20">
                <RadioGroupItem value="zote" id="zote" />
                <Label htmlFor="zote" className="cursor-pointer flex-1">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-emerald-600" />
                    <div>
                      <p className="text-sm font-medium">Ripoti Kamili (Zote)</p>
                      <p className="text-xs text-muted-foreground">Mapato + Matumizi</p>
                    </div>
                  </div>
                </Label>
              </div>
              <div className="flex items-center space-x-2 rounded-lg border-2 p-3 cursor-pointer transition-colors hover:border-emerald-300 dark:hover:border-emerald-700 has-[button[data-state=checked]]:border-emerald-500 has-[button[data-state=checked]]:bg-emerald-50 dark:has-[button[data-state=checked]]:bg-emerald-950/20">
                <RadioGroupItem value="mapato" id="mapato" />
                <Label htmlFor="mapato" className="cursor-pointer flex-1">
                  <div className="flex items-center gap-2">
                    <ArrowDownCircle className="h-4 w-4 text-emerald-600" />
                    <div>
                      <p className="text-sm font-medium">Mapato Pekee</p>
                      <p className="text-xs text-muted-foreground">Mapato tu</p>
                    </div>
                  </div>
                </Label>
              </div>
              <div className="flex items-center space-x-2 rounded-lg border-2 p-3 cursor-pointer transition-colors hover:border-orange-300 dark:hover:border-orange-700 has-[button[data-state=checked]]:border-orange-500 has-[button[data-state=checked]]:bg-orange-50 dark:has-[button[data-state=checked]]:bg-orange-950/20">
                <RadioGroupItem value="matumizi" id="matumizi" />
                <Label htmlFor="matumizi" className="cursor-pointer flex-1">
                  <div className="flex items-center gap-2">
                    <ArrowUpCircle className="h-4 w-4 text-orange-500" />
                    <div>
                      <p className="text-sm font-medium">Matumizi Pekee</p>
                      <p className="text-xs text-muted-foreground">Matumizi tu</p>
                    </div>
                  </div>
                </Label>
              </div>
            </RadioGroup>
          )}
        </div>

        {/* Org Unit Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Chagua Kitengo</label>
          <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Chagua kitengo..." />
            </SelectTrigger>
            <SelectContent>
              {availableOrgUnits.map((org) => (
                <SelectItem key={org.id} value={String(org.id)}>
                  {org.name} ({org.type === 'tawi' ? 'Tawi' : org.type === 'jimbo' ? 'Jimbo' : 'Markaz'})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* File Upload Area */}
        <div
          className={`relative rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
            dragActive
              ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20'
              : 'border-gray-300 dark:border-gray-700 hover:border-emerald-400'
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="absolute inset-0 cursor-pointer opacity-0"
            onChange={(e) => {
              if (e.target.files?.[0]) handleFileSelect(e.target.files[0]);
            }}
          />
          <FileSpreadsheet className="mx-auto h-12 w-12 text-emerald-500 mb-3" />
          <p className="text-sm font-medium">Buruta faili hapa au bonyeza kuchagua</p>
          <p className="text-xs text-muted-foreground mt-1">
            Faili za Excel (.xlsx, .xls) pekee
          </p>
          {file && (
            <div className="mt-3 flex items-center justify-center gap-2">
              <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                {file.name}
              </Badge>
            </div>
          )}
        </div>

        {/* Detected Period Info */}
        {(detectedYear || detectedMonth) && !isValidating && parsedData.length > 0 && (
          <div className="flex gap-2 flex-wrap text-xs">
            {detectedYear && (
              <Badge variant="outline" className="text-blue-700 border-blue-200 dark:text-blue-400 dark:border-blue-800">
                Mwaka: {detectedYear}
              </Badge>
            )}
            {detectedMonth && (
              <Badge variant="outline" className="text-blue-700 border-blue-200 dark:text-blue-400 dark:border-blue-800">
                Mwezi: {MONTHS[detectedMonth - 1]}
              </Badge>
            )}
          </div>
        )}

        {/* Validation Indicator */}
        {isValidating && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Inathibitisha data...
          </div>
        )}

        {importProgress && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950/20">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-blue-800 dark:text-blue-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{importProgress.message}</span>
              </div>
              <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
                {progressPercent}%
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900">
              <div
                className="h-full rounded-full bg-blue-600 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Sheet Summary */}
        {Object.keys(sheetSummary).length > 1 && !isValidating && parsedData.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Muhtasari wa Karatasi</h4>
            <div className="flex gap-2 flex-wrap">
              {Object.entries(sheetSummary).map(([name, info]) => (
                <Badge
                  key={name}
                  variant="outline"
                  className={
                    info.type === 'income'
                      ? 'border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400'
                      : info.type === 'expense'
                        ? 'border-orange-300 text-orange-700 dark:border-orange-700 dark:text-orange-400'
                        : 'border-gray-300 text-gray-600 dark:border-gray-700 dark:text-gray-400'
                  }
                >
                  {name}: {info.count} mistari
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Validation Summary */}
        {parsedData.length > 0 && !isValidating && (
          <div className="flex gap-3 flex-wrap">
            <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 border-emerald-200">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {validCount} sahihi
            </Badge>
            {invalidCount > 0 && (
              <Badge variant="destructive">
                <XCircle className="h-3 w-3 mr-1" />
                {invalidCount} na hitilafu
              </Badge>
            )}
            <Badge variant="outline">
              Jumla: {parsedData.length}
            </Badge>
          </div>
        )}

        {parsedReportNine && !isValidating && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
            <div className="font-semibold text-amber-800">Ripoti ya Tisa imetambuliwa</div>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-amber-800">
              <p>Jimbo: {parsedReportNine.unitName}</p>
              <p>Mwaka: {parsedReportNine.year}</p>
              <p>Mapato: {parsedReportNine.totalIncome.toLocaleString('en-US')}</p>
              <p>Matumizi: {parsedReportNine.totalExpense.toLocaleString('en-US')}</p>
            </div>
            <p className="mt-2 text-xs text-amber-700">
              Ukibonyeza Pakia, ripoti hii itahifadhiwa kama regional snapshot na Markaz itaitumia kwenye Ripoti ya Tisa ya kitaasisi.
            </p>
          </div>
        )}

        {/* Data Preview */}
        {parsedData.length > 0 && columns.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Hakiki Data</h4>
            {hiddenPreviewRows > 0 && (
              <p className="text-xs text-muted-foreground">
                Inaonyesha mistari {PREVIEW_ROW_LIMIT} ya kwanza kati ya {parsedData.length}. Import itahifadhi mistari yote sahihi.
              </p>
            )}
            <ScrollArea className="h-72 w-full">
              <div className="min-w-150">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    {reportTypeSelection === 'zote' && (
                      <TableHead className="w-20 text-xs">Karatasi</TableHead>
                    )}
                    {columns.slice(0, 5).map((col) => (
                      <TableHead key={col} className="text-xs">
                        {col}
                      </TableHead>
                    ))}
                    <TableHead className="w-20">Hali</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row, idx) => (
                    <TableRow key={idx} className={row.isValid ? '' : 'bg-red-50 dark:bg-red-950/20'}>
                      <TableCell className="text-xs">{row.rowIndex}</TableCell>
                      {reportTypeSelection === 'zote' && (
                        <TableCell className="text-xs">
                          <Badge
                            variant="outline"
                            className={
                              row.sheetType === 'income'
                                ? 'text-emerald-600 border-emerald-300 text-[10px]'
                                : 'text-orange-600 border-orange-300 text-[10px]'
                            }
                          >
                            {row.sheetName || (row.sheetType === 'income' ? 'Mapato' : 'Matumizi')}
                          </Badge>
                        </TableCell>
                      )}
                      {columns.slice(0, 5).map((col) => (
                        <TableCell key={col} className="text-xs max-w-32 truncate">
                          {String(row.data[col] ?? '')}
                        </TableCell>
                      ))}
                      <TableCell>
                        {row.isValid ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-red-500" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Error Details */}
        {parsedData.some((r) => !r.isValid) && (
          <div className="space-y-1">
            <h4 className="text-sm font-medium text-red-600">Hitilafu:</h4>
            <ScrollArea className="max-h-32">
              {parsedData
                .filter((r) => !r.isValid)
                .flatMap((r) => r.errors)
                .map((err, i) => (
                  <p key={i} className="text-xs text-red-600">
                    Mstari {err.row}, Safu &ldquo;{err.column}&rdquo;: {err.message}
                  </p>
                ))}
            </ScrollArea>
          </div>
        )}

        {/* Import Result */}
        {importResult && (
          <div
            className={`rounded-lg p-4 ${
              importResult.success
                ? 'bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800'
                : 'bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              {importResult.success ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : (
                <XCircle className="h-5 w-5 text-red-600" />
              )}
              <span className="font-medium text-sm">
                {importResult.success ? 'Upakiaji Umefanikiwa!' : 'Upakiaji Umeshindikana'}
              </span>
            </div>
            <div className="text-xs space-y-1">
              <p>Jumla ya mistari: {importResult.totalRows}</p>
              <p className="text-emerald-700 dark:text-emerald-400">Imepakiwa: {importResult.importedCount}</p>
              {importResult.errorCount > 0 && (
                <p className="text-red-600">Hitilafu: {importResult.errorCount}</p>
              )}
              {importResult.errors.length > 0 && (
                <div className="mt-2 pt-2 border-t border-red-200 dark:border-red-800 space-y-1">
                  {importResult.errors.slice(0, 5).map((errorItem, index) => (
                    <p key={`${errorItem.row}-${errorItem.column}-${index}`} className="text-red-600">
                      {errorItem.message}
                    </p>
                  ))}
                </div>
              )}
              {importResult.batchId && (
                <p className="text-muted-foreground">Namba ya Batch: #{importResult.batchId}</p>
              )}
              {importResult.sheetSummary && Object.keys(importResult.sheetSummary).length > 1 && (
                <div className="mt-2 pt-2 border-t border-emerald-200 dark:border-emerald-800">
                  <p className="font-medium mb-1">Muhtasari kwa karatasi:</p>
                  {Object.entries(importResult.sheetSummary).map(([name, info]) => (
                    <p key={name}>
                      {name}: {info.count} mistari ({info.type === 'income' ? 'Mapato' : info.type === 'expense' ? 'Matumizi' : info.type})
                    </p>
                  ))}
                </div>
              )}
              {(detectedYear || detectedMonth) && (
                <div className="mt-2 pt-2 border-t border-emerald-200 dark:border-emerald-800">
                  <p>Kipindi kilichogunduliwa:
                    {detectedYear && ` Mwaka ${detectedYear}`}
                    {detectedMonth && ` - ${MONTHS[detectedMonth - 1]}`}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3">
          <Button
            onClick={handleImport}
            disabled={
              !selectedOrgId ||
              (parsedData.length === 0 && !parsedReportNine && !parsedBranchSnapshot) ||
              isImporting ||
              (validCount === 0 && !parsedReportNine && !parsedBranchSnapshot)
            }
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {isImporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Inapakia...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Pakia
              </>
            )}
          </Button>
          <Button variant="outline" onClick={handleReset}>
            Futa
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
