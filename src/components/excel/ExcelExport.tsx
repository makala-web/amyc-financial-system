'use client';

import * as XLSX from 'xlsx';
import { db, getTransactionsByOrg, getMonthlySummary, getDepartmentalSummary, getChildOrgUnits } from '@/lib/db-offline';
import type { OrgUnit } from '@/lib/types';
import { MONTHS, MONTHS_SHORT, DEPARTMENTS } from '@/lib/types';
import { generateConsolidatedReportNine } from '@/lib/reports/consolidated-report-nine';
import { downloadReportNineExcel } from '@/lib/reports/report-nine-excel';
import { isNativeApp, saveNativeBase64File } from '@/lib/native-files';

// ============================================================
// Helper: Apply cell styling (borders, bold, alignment)
// ============================================================

interface CellStyle {
  bold?: boolean;
  fontSize?: number;
  alignment?: any;
  border?: boolean;
  numFmt?: string;
}

function applyCellStyle(ws: XLSX.WorkSheet, range: XLSX.Range, style: CellStyle) {
  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[cellAddress];
      if (!cell) continue;

      if (!cell.s) cell.s = {};
      if (style.bold) cell.s.font = { ...(cell.s.font || {}), bold: true };
      if (style.fontSize) cell.s.font = { ...(cell.s.font || {}), sz: style.fontSize };
      if (style.alignment) cell.s.alignment = style.alignment;
      if (style.border) {
        const borderStyle: any = { style: 'thin', color: { rgb: '000000' } };
        cell.s.border = {
          top: borderStyle,
          bottom: borderStyle,
          left: borderStyle,
          right: borderStyle,
        };
      }
      if (style.numFmt) cell.s.numFmt = style.numFmt;
    }
  }
}

// ============================================================
// Helper: Auto-fit column widths
// ============================================================

function autoFitColumns(ws: XLSX.WorkSheet, minWidth = 10, maxWidth = 40) {
  const colWidths: number[] = [];
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

  for (let C = range.s.c; C <= range.e.c; ++C) {
    let maxLen = minWidth;
    for (let R = range.s.r; R <= range.e.r; ++R) {
      const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[cellAddress];
      if (cell && cell.v != null) {
        const len = String(cell.v).length;
        if (len > maxLen) maxLen = Math.min(len + 2, maxWidth);
      }
    }
    colWidths.push(maxLen);
  }

  ws['!cols'] = colWidths.map((w) => ({ wch: w }));
}

// ============================================================
// Helper: Download workbook
// ============================================================

async function downloadWorkbook(wb: XLSX.WorkBook, fileName: string) {
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

// ============================================================
// Helper: Create AMYC header rows (with metadata)
// ============================================================

interface AmycHeaderOptions {
  orgUnit: OrgUnit;
  title: string;
  period: string;
  startRow?: number;
  exportType?: string;
  recordCount?: number;
}

function addAmycHeader(
  ws: XLSX.WorkSheet,
  options: AmycHeaderOptions
): number {
  const { orgUnit, title, period, startRow = 0, exportType, recordCount } = options;

  const orgLevelLabel =
    orgUnit.type === 'tawi' ? 'Tawi' : orgUnit.type === 'jimbo' ? 'Jimbo' : 'Markaz';

  // Row 0: AMYC Header
  XLSX.utils.sheet_add_aoa(ws, [['AMYC - Ansaar Muslim Youth Center']], {
    origin: { r: startRow, c: 0 },
  });
  applyCellStyle(ws, { s: { r: startRow, c: 0 }, e: { r: startRow, c: 7 } }, {
    bold: true,
    fontSize: 14,
    alignment: { horizontal: 'center' },
  });

  // Row 1: Org Unit & Level
  XLSX.utils.sheet_add_aoa(ws, [[`${orgUnit.name} (${orgLevelLabel})`]], {
    origin: { r: startRow + 1, c: 0 },
  });
  applyCellStyle(ws, { s: { r: startRow + 1, c: 0 }, e: { r: startRow + 1, c: 7 } }, {
    bold: true,
    fontSize: 12,
    alignment: { horizontal: 'center' },
  });

  // Row 2: Title
  XLSX.utils.sheet_add_aoa(ws, [[title]], {
    origin: { r: startRow + 2, c: 0 },
  });
  applyCellStyle(ws, { s: { r: startRow + 2, c: 0 }, e: { r: startRow + 2, c: 7 } }, {
    bold: true,
    fontSize: 11,
    alignment: { horizontal: 'center' },
  });

  // Row 3: Period
  XLSX.utils.sheet_add_aoa(ws, [[period]], {
    origin: { r: startRow + 3, c: 0 },
  });
  applyCellStyle(ws, { s: { r: startRow + 3, c: 0 }, e: { r: startRow + 3, c: 7 } }, {
    fontSize: 10,
    alignment: { horizontal: 'center' },
  });

  // Row 4: Metadata (export date, type, record count)
  const exportDate = new Date().toLocaleDateString('sw-TZ', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const metaParts = [`Imeandaliwa: ${exportDate}`];
  if (exportType) metaParts.push(`Aina: ${exportType}`);
  if (recordCount !== undefined) metaParts.push(`Rekodi: ${recordCount}`);
  const metaStr = metaParts.join(' | ');

  XLSX.utils.sheet_add_aoa(ws, [[metaStr]], {
    origin: { r: startRow + 4, c: 0 },
  });
  applyCellStyle(ws, { s: { r: startRow + 4, c: 0 }, e: { r: startRow + 4, c: 7 } }, {
    fontSize: 9,
    alignment: { horizontal: 'center' },
  });

  return startRow + 6; // next row after headers (was 5, now 6 with metadata row)
}

// ============================================================
// Helper: Set merges and ref for a sheet
// ============================================================

function finalizeSheet(
  ws: XLSX.WorkSheet,
  lastRow: number,
  lastCol: number,
  headerRows: number = 5, // now 5 header rows (0-4) instead of 4
  startRow: number = 0
) {
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: startRow, c: 0 },
    e: { r: lastRow, c: lastCol },
  });

  // Merge header rows
  const merges: XLSX.Range[] = [];
  for (let i = 0; i < headerRows; i++) {
    merges.push({
      s: { r: startRow + i, c: 0 },
      e: { r: startRow + i, c: lastCol },
    });
  }
  ws['!merges'] = merges;

  autoFitColumns(ws);
}

// ============================================================
// Create Sheet: Income (Mapato)
// ============================================================

export async function createIncomeSheet(
  orgUnit: OrgUnit,
  year: number,
  month?: number,
  exportType?: string
): Promise<{ ws: XLSX.WorkSheet; recordCount: number }> {
  const transactions = await getTransactionsByOrg(orgUnit.id!, year, month);
  const incomeTxns = transactions.filter((t) => t.type === 'income');

  const periodStr = month
    ? `${MONTHS[month - 1]} ${year}`
    : `Mwaka ${year}`;

  const ws: XLSX.WorkSheet = {};

  let row = addAmycHeader(ws, {
    orgUnit,
    title: 'Fomu ya Mapato',
    period: periodStr,
    exportType: exportType || 'Mapato',
    recordCount: incomeTxns.length,
  });

  // Column headers
  const headers = ['NA', 'CHANZO CHA MAPATO', 'IDARA', 'KIASI (TSh)'];
  XLSX.utils.sheet_add_aoa(ws, [headers], { origin: { r: row, c: 0 } });
  applyCellStyle(
    ws,
    { s: { r: row, c: 0 }, e: { r: row, c: headers.length - 1 } },
    { bold: true, border: true, alignment: { horizontal: 'center' }, fontSize: 10 }
  );
  row++;

  // Data rows
  let totalAmount = 0;
  incomeTxns.forEach((txn, idx) => {
    const rowData = [idx + 1, txn.category_name || txn.source || '', txn.department, txn.amount];
    XLSX.utils.sheet_add_aoa(ws, [rowData], { origin: { r: row, c: 0 } });
    applyCellStyle(
      ws,
      { s: { r: row, c: 0 }, e: { r: row, c: headers.length - 1 } },
      { border: true }
    );
    const amountCell = ws[XLSX.utils.encode_cell({ r: row, c: 3 })];
    if (amountCell) amountCell.z = '#,##0';
    totalAmount += txn.amount;
    row++;
  });

  // Total row
  XLSX.utils.sheet_add_aoa(ws, [['JUMLA', '', '', totalAmount]], { origin: { r: row, c: 0 } });
  applyCellStyle(
    ws,
    { s: { r: row, c: 0 }, e: { r: row, c: headers.length - 1 } },
    { bold: true, border: true, fontSize: 10 }
  );
  const totalCell = ws[XLSX.utils.encode_cell({ r: row, c: 3 })];
  if (totalCell) totalCell.z = '#,##0';

  finalizeSheet(ws, row, headers.length - 1);

  return { ws, recordCount: incomeTxns.length };
}

// ============================================================
// Create Sheet: Expense (Matumizi)
// ============================================================

export async function createExpenseSheet(
  orgUnit: OrgUnit,
  year: number,
  month?: number,
  exportType?: string
): Promise<{ ws: XLSX.WorkSheet; recordCount: number }> {
  const transactions = await getTransactionsByOrg(orgUnit.id!, year, month);
  const expenseTxns = transactions.filter((t) => t.type === 'expense');

  const periodStr = month
    ? `${MONTHS[month - 1]} ${year}`
    : `Mwaka ${year}`;

  const ws: XLSX.WorkSheet = {};

  let row = addAmycHeader(ws, {
    orgUnit,
    title: 'Fomu ya Matumizi',
    period: periodStr,
    exportType: exportType || 'Matumizi',
    recordCount: expenseTxns.length,
  });

  // Column headers
  const headers = ['TAREHE', 'NA', 'BIDHAA/VIFAA/HUDUMA', 'KIPIMO', 'IDADI', 'IDARA', 'BEI@', 'JUMLA (TSh)'];
  XLSX.utils.sheet_add_aoa(ws, [headers], { origin: { r: row, c: 0 } });
  applyCellStyle(
    ws,
    { s: { r: row, c: 0 }, e: { r: row, c: headers.length - 1 } },
    { bold: true, border: true, alignment: { horizontal: 'center' }, fontSize: 10 }
  );
  row++;

  // Data rows
  let totalAmount = 0;
  expenseTxns.forEach((txn) => {
    const quantity = txn.quantity || 1;
    const unitPrice = txn.unitPrice || txn.amount;
    const rowData = [
      txn.date,
      txn.vendor || txn.category_name || '',
      txn.description || txn.category_name || '',
      txn.unit || '-',
      quantity,
      txn.department,
      unitPrice,
      txn.amount,
    ];
    XLSX.utils.sheet_add_aoa(ws, [rowData], { origin: { r: row, c: 0 } });
    applyCellStyle(
      ws,
      { s: { r: row, c: 0 }, e: { r: row, c: headers.length - 1 } },
      { border: true }
    );
    const amountCell = ws[XLSX.utils.encode_cell({ r: row, c: 7 })];
    if (amountCell) amountCell.z = '#,##0';
    const priceCell = ws[XLSX.utils.encode_cell({ r: row, c: 6 })];
    if (priceCell) priceCell.z = '#,##0';
    totalAmount += txn.amount;
    row++;
  });

  // Total row
  XLSX.utils.sheet_add_aoa(
    ws,
    [['JUMLA', '', '', '', '', '', '', totalAmount]],
    { origin: { r: row, c: 0 } }
  );
  applyCellStyle(
    ws,
    { s: { r: row, c: 0 }, e: { r: row, c: headers.length - 1 } },
    { bold: true, border: true, fontSize: 10 }
  );
  const totalCell = ws[XLSX.utils.encode_cell({ r: row, c: 7 })];
  if (totalCell) totalCell.z = '#,##0';

  finalizeSheet(ws, row, headers.length - 1);

  return { ws, recordCount: expenseTxns.length };
}

// ============================================================
// Create Sheet: Annual Summary (Taarifa ya Mwaka)
// ============================================================

export async function createAnnualSummarySheet(
  orgUnit: OrgUnit,
  year: number,
  month?: number,
  exportType?: string
): Promise<XLSX.WorkSheet> {
  const { incomeByMonth, expenseByMonth } = await getMonthlySummary(orgUnit.id!, year);
  const monthIndexes = month && month > 0 ? [month - 1] : Array.from({ length: 12 }, (_, index) => index);

  const periodStr = month
    ? `${MONTHS[month - 1]} ${year}`
    : `Mwaka ${year}`;

  const ws: XLSX.WorkSheet = {};

  let row = addAmycHeader(ws, {
    orgUnit,
    title: 'TAARIFA YA MAPATO NA MATUMIZI KWA MWAKA',
    period: periodStr,
    exportType: exportType || 'Taarifa ya Mwaka',
    recordCount: monthIndexes.length,
  });

  // Column headers: Mwezi | Mapato | Matumizi | Salio
  const headers = ['MWEZI', 'MAPATO (TSh)', 'MATUMIZI (TSh)', 'SALIO (TSh)', '% MATUMIZI'];
  XLSX.utils.sheet_add_aoa(ws, [headers], { origin: { r: row, c: 0 } });
  applyCellStyle(
    ws,
    { s: { r: row, c: 0 }, e: { r: row, c: headers.length - 1 } },
    { bold: true, border: true, alignment: { horizontal: 'center' }, fontSize: 10 }
  );
  row++;

  let totalIncome = 0;
  let totalExpense = 0;

  monthIndexes.forEach((idx) => {
    const monthName = MONTHS_SHORT[idx];
    const income = incomeByMonth[idx];
    const expense = expenseByMonth[idx];
    const balance = income - expense;
    const pct = income > 0 ? ((expense / income) * 100).toFixed(1) : '0.0';

    XLSX.utils.sheet_add_aoa(ws, [[monthName, income, expense, balance, `${pct}%`]], {
      origin: { r: row, c: 0 },
    });
    applyCellStyle(
      ws,
      { s: { r: row, c: 0 }, e: { r: row, c: headers.length - 1 } },
      { border: true }
    );
    const incCell = ws[XLSX.utils.encode_cell({ r: row, c: 1 })];
    if (incCell) incCell.z = '#,##0';
    const expCell = ws[XLSX.utils.encode_cell({ r: row, c: 2 })];
    if (expCell) expCell.z = '#,##0';
    const balCell = ws[XLSX.utils.encode_cell({ r: row, c: 3 })];
    if (balCell) balCell.z = '#,##0';

    totalIncome += income;
    totalExpense += expense;
    row++;
  });

  // Totals row
  const totalBalance = totalIncome - totalExpense;
  const totalPct = totalIncome > 0 ? ((totalExpense / totalIncome) * 100).toFixed(1) : '0.0';
  XLSX.utils.sheet_add_aoa(
    ws,
    [['JUMLA', totalIncome, totalExpense, totalBalance, `${totalPct}%`]],
    { origin: { r: row, c: 0 } }
  );
  applyCellStyle(
    ws,
    { s: { r: row, c: 0 }, e: { r: row, c: headers.length - 1 } },
    { bold: true, border: true, fontSize: 10 }
  );
  const tiCell = ws[XLSX.utils.encode_cell({ r: row, c: 1 })];
  if (tiCell) tiCell.z = '#,##0';
  const teCell = ws[XLSX.utils.encode_cell({ r: row, c: 2 })];
  if (teCell) teCell.z = '#,##0';
  const tbCell = ws[XLSX.utils.encode_cell({ r: row, c: 3 })];
  if (tbCell) tbCell.z = '#,##0';

  finalizeSheet(ws, row, headers.length - 1);

  return ws;
}

// ============================================================
// Create Sheet: Departmental (Ki-Idara)
// ============================================================

export async function createDepartmentalSheet(
  orgUnit: OrgUnit,
  year: number,
  month?: number,
  exportType?: string
): Promise<XLSX.WorkSheet> {
  const deptSummary = month
    ? await getDepartmentalSummaryForPeriod(orgUnit, year, month)
    : await getDepartmentalSummary(orgUnit.id!, year);

  const periodStr = month
    ? `${MONTHS[month - 1]} ${year}`
    : `Mwaka ${year}`;

  const ws: XLSX.WorkSheet = {};

  let row = addAmycHeader(ws, {
    orgUnit,
    title: 'MAPATO NA MATUMIZI (KI-IDARA) KWA MWAKA',
    period: periodStr,
    exportType: exportType || 'Ki-Idara',
    recordCount: DEPARTMENTS.length,
  });

  // Column headers
  const headers = ['IDARA', 'MAPATO (TSh)', 'MATUMIZI (TSh)', 'SALIO (TSh)', '% MATUMIZI'];
  XLSX.utils.sheet_add_aoa(ws, [headers], { origin: { r: row, c: 0 } });
  applyCellStyle(
    ws,
    { s: { r: row, c: 0 }, e: { r: row, c: headers.length - 1 } },
    { bold: true, border: true, alignment: { horizontal: 'center' }, fontSize: 10 }
  );
  row++;

  let totalIncome = 0;
  let totalExpense = 0;

  DEPARTMENTS.forEach((dept) => {
    const data = deptSummary[dept] || { income: 0, expense: 0 };
    const balance = data.income - data.expense;
    const pct = data.income > 0 ? ((data.expense / data.income) * 100).toFixed(1) : '0.0';

    XLSX.utils.sheet_add_aoa(ws, [[dept, data.income, data.expense, balance, `${pct}%`]], {
      origin: { r: row, c: 0 },
    });
    applyCellStyle(
      ws,
      { s: { r: row, c: 0 }, e: { r: row, c: headers.length - 1 } },
      { border: true }
    );
    const incCell = ws[XLSX.utils.encode_cell({ r: row, c: 1 })];
    if (incCell) incCell.z = '#,##0';
    const expCell = ws[XLSX.utils.encode_cell({ r: row, c: 2 })];
    if (expCell) expCell.z = '#,##0';
    const balCell = ws[XLSX.utils.encode_cell({ r: row, c: 3 })];
    if (balCell) balCell.z = '#,##0';

    totalIncome += data.income;
    totalExpense += data.expense;
    row++;
  });

  // Totals
  const totalBalance = totalIncome - totalExpense;
  const totalPct = totalIncome > 0 ? ((totalExpense / totalIncome) * 100).toFixed(1) : '0.0';
  XLSX.utils.sheet_add_aoa(
    ws,
    [['JUMLA', totalIncome, totalExpense, totalBalance, `${totalPct}%`]],
    { origin: { r: row, c: 0 } }
  );
  applyCellStyle(
    ws,
    { s: { r: row, c: 0 }, e: { r: row, c: headers.length - 1 } },
    { bold: true, border: true, fontSize: 10 }
  );
  const tiCell = ws[XLSX.utils.encode_cell({ r: row, c: 1 })];
  if (tiCell) tiCell.z = '#,##0';
  const teCell = ws[XLSX.utils.encode_cell({ r: row, c: 2 })];
  if (teCell) teCell.z = '#,##0';
  const tbCell = ws[XLSX.utils.encode_cell({ r: row, c: 3 })];
  if (tbCell) tbCell.z = '#,##0';

  finalizeSheet(ws, row, headers.length - 1);

  return ws;
}

async function getDepartmentalSummaryForPeriod(orgUnit: OrgUnit, year: number, month: number) {
  const transactions = await getTransactionsByOrg(orgUnit.id!, year, month);
  const summary: Record<string, { income: number; expense: number }> = {};
  for (const dept of DEPARTMENTS) {
    summary[dept] = { income: 0, expense: 0 };
  }

  transactions.forEach((transaction) => {
    if (!summary[transaction.department]) {
      summary[transaction.department] = { income: 0, expense: 0 };
    }
    if (transaction.type === 'income') {
      summary[transaction.department].income += transaction.amount;
    } else {
      summary[transaction.department].expense += transaction.amount;
    }
  });

  return summary;
}

// ============================================================
// Create Sheet: Consolidation (Muunganiko)
// ============================================================

export async function createConsolidationSheet(
  orgUnit: OrgUnit,
  year: number,
  childOrgs?: OrgUnit[],
  exportType?: string,
  month?: number
): Promise<XLSX.WorkSheet | null> {
  const children = childOrgs || (await getChildOrgUnits(orgUnit.id!));

  if (children.length === 0) {
    return null;
  }

  const ws: XLSX.WorkSheet = {};

  const orgLevelLabel =
    orgUnit.type === 'tawi' ? 'Tawi' : orgUnit.type === 'jimbo' ? 'Jimbo' : 'Markaz';

  let row = addAmycHeader(ws, {
    orgUnit,
    title: `MUUNGANIKO WA ${orgLevelLabel.toUpperCase()}`,
    period: month ? `${MONTHS[month - 1]} ${year}` : `Mwaka ${year}`,
    exportType: exportType || 'Muunganiko',
    recordCount: children.length,
  });

  // Column headers
  const headers = ['KITENGO', 'MAPATO (TSh)', 'MATUMIZI (TSh)', 'SALIO (TSh)', '% MATUMIZI'];
  XLSX.utils.sheet_add_aoa(ws, [headers], { origin: { r: row, c: 0 } });
  applyCellStyle(
    ws,
    { s: { r: row, c: 0 }, e: { r: row, c: headers.length - 1 } },
    { bold: true, border: true, alignment: { horizontal: 'center' }, fontSize: 10 }
  );
  row++;

  let totalIncome = 0;
  let totalExpense = 0;

  for (const child of children) {
    const transactions = await getTransactionsByOrg(child.id!, year, month);
    const childIncome = transactions
      .filter((transaction) => transaction.type === 'income')
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const childExpense = transactions
      .filter((transaction) => transaction.type === 'expense')
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const balance = childIncome - childExpense;
    const pct = childIncome > 0 ? ((childExpense / childIncome) * 100).toFixed(1) : '0.0';

    const childTypeLabel =
      child.type === 'tawi' ? 'Tawi' : child.type === 'jimbo' ? 'Jimbo' : 'Markaz';

    XLSX.utils.sheet_add_aoa(
      ws,
      [[`${child.name} (${childTypeLabel})`, childIncome, childExpense, balance, `${pct}%`]],
      { origin: { r: row, c: 0 } }
    );
    applyCellStyle(
      ws,
      { s: { r: row, c: 0 }, e: { r: row, c: headers.length - 1 } },
      { border: true }
    );
    const incCell = ws[XLSX.utils.encode_cell({ r: row, c: 1 })];
    if (incCell) incCell.z = '#,##0';
    const expCell = ws[XLSX.utils.encode_cell({ r: row, c: 2 })];
    if (expCell) expCell.z = '#,##0';
    const balCell = ws[XLSX.utils.encode_cell({ r: row, c: 3 })];
    if (balCell) balCell.z = '#,##0';

    totalIncome += childIncome;
    totalExpense += childExpense;
    row++;
  }

  // Totals
  const totalBalance = totalIncome - totalExpense;
  const totalPct = totalIncome > 0 ? ((totalExpense / totalIncome) * 100).toFixed(1) : '0.0';
  XLSX.utils.sheet_add_aoa(
    ws,
    [['JUMLA', totalIncome, totalExpense, totalBalance, `${totalPct}%`]],
    { origin: { r: row, c: 0 } }
  );
  applyCellStyle(
    ws,
    { s: { r: row, c: 0 }, e: { r: row, c: headers.length - 1 } },
    { bold: true, border: true, fontSize: 10 }
  );
  const tiCell = ws[XLSX.utils.encode_cell({ r: row, c: 1 })];
  if (tiCell) tiCell.z = '#,##0';
  const teCell = ws[XLSX.utils.encode_cell({ r: row, c: 2 })];
  if (teCell) teCell.z = '#,##0';
  const tbCell = ws[XLSX.utils.encode_cell({ r: row, c: 3 })];
  if (tbCell) tbCell.z = '#,##0';

  finalizeSheet(ws, row, headers.length - 1);

  return ws;
}

// ============================================================
// Export: Income Excel (single file, single sheet)
// ============================================================

export async function exportIncomeExcel(orgUnit: OrgUnit, year: number, month?: number) {
  const { ws } = await createIncomeSheet(orgUnit, year, month, 'Mapato');

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Mapato');

  const monthStr = month ? `_${MONTHS[month - 1]}` : '';
  await downloadWorkbook(wb, `AMYC_Mapato_${orgUnit.name.replace(/\s+/g, '_')}${monthStr}_${year}.xlsx`);
}

// ============================================================
// Export: Expense Excel (single file, single sheet)
// ============================================================

export async function exportExpenseExcel(orgUnit: OrgUnit, year: number, month?: number) {
  const { ws } = await createExpenseSheet(orgUnit, year, month, 'Matumizi');

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Matumizi');

  const monthStr = month ? `_${MONTHS[month - 1]}` : '';
  await downloadWorkbook(wb, `AMYC_Matumizi_${orgUnit.name.replace(/\s+/g, '_')}${monthStr}_${year}.xlsx`);
}

// ============================================================
// Export: Annual Summary Excel (single file, single sheet)
// ============================================================

export async function exportAnnualSummaryExcel(orgUnit: OrgUnit, year: number, month?: number) {
  const ws = await createAnnualSummarySheet(orgUnit, year, month, 'Taarifa ya Mwaka');

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Taarifa ya Mwaka');

  const monthStr = month ? `_${MONTHS[month - 1]}` : '';
  await downloadWorkbook(wb, `AMYC_TaarifaMwaka_${orgUnit.name.replace(/\s+/g, '_')}${monthStr}_${year}.xlsx`);
}

// ============================================================
// Export: Departmental Excel (single file, single sheet)
// ============================================================

export async function exportDepartmentalExcel(orgUnit: OrgUnit, year: number, month?: number) {
  const ws = await createDepartmentalSheet(orgUnit, year, month, 'Ki-Idara');

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ki-Idara');

  const monthStr = month ? `_${MONTHS[month - 1]}` : '';
  await downloadWorkbook(wb, `AMYC_KiIdara_${orgUnit.name.replace(/\s+/g, '_')}${monthStr}_${year}.xlsx`);
}

// ============================================================
// Export: Consolidation Excel (single file, single sheet)
// ============================================================

export async function exportConsolidationExcel(
  orgUnit: OrgUnit,
  year: number,
  childOrgs?: OrgUnit[],
  month?: number
) {
  const ws = await createConsolidationSheet(orgUnit, year, childOrgs, 'Muunganiko', month);

  if (!ws) {
    alert('Hakuna vitengo vya chini vya kuunganisha.');
    return;
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Muunganiko');

  const monthStr = month ? `_${MONTHS[month - 1]}` : '';
  await downloadWorkbook(wb, `AMYC_Muunganiko_${orgUnit.name.replace(/\s+/g, '_')}${monthStr}_${year}.xlsx`);
}

// ============================================================
// Export: Report Nine - Regional/Markaz institutional snapshot
// ============================================================

export async function exportReportNineExcel(
  orgUnit: OrgUnit,
  year: number,
  month?: number,
  childOrgs?: OrgUnit[]
) {
  if (orgUnit.type !== 'jimbo' && orgUnit.type !== 'markaz') {
    alert('Ripoti ya Tisa inapatikana kwa Jimbo na Markaz Kuu pekee.');
    return;
  }

  const selectedChildIds = new Set((childOrgs || []).filter((child) => child.isActive).map((child) => child.id!));
  const report = await generateConsolidatedReportNine({
    orgUnit,
    year,
    month,
    selectedChildIds,
  });

  await downloadReportNineExcel(report);
}

// ============================================================
// Export: ZOTE - ONE file with multiple sheets (Mapato + Matumizi + Ki-Idara + Taarifa ya Mwaka)
// ============================================================

export async function exportZoteExcel(orgUnit: OrgUnit, year: number, month?: number) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Mapato
  const { ws: incomeWs } = await createIncomeSheet(orgUnit, year, month, 'Zote');
  XLSX.utils.book_append_sheet(wb, incomeWs, 'Mapato');

  // Sheet 2: Matumizi
  const { ws: expenseWs } = await createExpenseSheet(orgUnit, year, month, 'Zote');
  XLSX.utils.book_append_sheet(wb, expenseWs, 'Matumizi');

  // Sheet 3: Ki-Idara
  const deptWs = await createDepartmentalSheet(orgUnit, year, month, 'Zote');
  XLSX.utils.book_append_sheet(wb, deptWs, 'Ki-Idara');

  // Sheet 4: Taarifa ya Mwaka
  const annualWs = await createAnnualSummarySheet(orgUnit, year, month, 'Zote');
  XLSX.utils.book_append_sheet(wb, annualWs, 'Taarifa ya Mwaka');

  // Download
  const monthStr = month ? `_${MONTHS[month - 1]}` : '';
  await downloadWorkbook(wb, `AMYC_Zote_${orgUnit.name.replace(/\s+/g, '_')}${monthStr}_${year}.xlsx`);
}

// ============================================================
// Export: Ripoti Kamili - Full Report (ALL sheets including Muunganiko if applicable)
// ============================================================

export async function exportRipotiKamiliExcel(
  orgUnit: OrgUnit,
  year: number,
  month?: number,
  childOrgs?: OrgUnit[]
) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Mapato
  const { ws: incomeWs, recordCount: incomeCount } = await createIncomeSheet(orgUnit, year, month, 'Ripoti Kamili');
  XLSX.utils.book_append_sheet(wb, incomeWs, 'Mapato');

  // Sheet 2: Matumizi
  const { ws: expenseWs, recordCount: expenseCount } = await createExpenseSheet(orgUnit, year, month, 'Ripoti Kamili');
  XLSX.utils.book_append_sheet(wb, expenseWs, 'Matumizi');

  // Sheet 3: Ki-Idara
  const deptWs = await createDepartmentalSheet(orgUnit, year, month, 'Ripoti Kamili');
  XLSX.utils.book_append_sheet(wb, deptWs, 'Ki-Idara');

  // Sheet 4: Taarifa ya Mwaka
  const annualWs = await createAnnualSummarySheet(orgUnit, year, month, 'Ripoti Kamili');
  XLSX.utils.book_append_sheet(wb, annualWs, 'Taarifa ya Mwaka');

  // Sheet 5: Muunganiko (if applicable)
  const consolidationWs = await createConsolidationSheet(orgUnit, year, childOrgs, 'Ripoti Kamili', month);
  if (consolidationWs) {
    XLSX.utils.book_append_sheet(wb, consolidationWs, 'Muunganiko');
  }

  // Download
  const monthStr = month ? `_${MONTHS[month - 1]}` : '';
  await downloadWorkbook(
    wb,
    `AMYC_RipotiKamili_${orgUnit.name.replace(/\s+/g, '_')}${monthStr}_${year}.xlsx`
  );

  return {
    incomeCount,
    expenseCount,
    hasConsolidation: !!consolidationWs,
  };
}
