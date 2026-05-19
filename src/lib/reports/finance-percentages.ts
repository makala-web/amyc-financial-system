/** Asilimia ya sehemu ikilinganishwa na jumla (k.m. idara / jumla mapato). */
export function pctOfPart(part: number, total: number, decimals = 1): string {
  if (total <= 0 || part === 0) return '';
  return `${((part / total) * 100).toFixed(decimals)}%`;
}

/** Asilimia ya jumla — daima inaonyesha (k.m. 100% kwa mapato). */
export function pctOfTotal(total: number, grandTotal: number, decimals = 1): string {
  if (grandTotal <= 0) return total > 0 ? '—' : '0%';
  return `${((total / grandTotal) * 100).toFixed(decimals)}%`;
}

/** Matumizi kama % ya mapato. */
export function pctExpenseOfIncome(expense: number, income: number, decimals = 1): string {
  if (income <= 0) return expense > 0 ? '—' : '0%';
  return `${((expense / income) * 100).toFixed(decimals)}%`;
}

/** Salio lililobaki kama % ya mapato (mapato - matumizi) / mapato. */
export function pctSalioRemaining(salio: number, income: number, decimals = 1): string {
  if (income <= 0) return salio !== 0 ? '—' : '0%';
  return `${((salio / income) * 100).toFixed(decimals)}%`;
}

/** HTML ya muhtasari wa kifedha kwa print/PDF (inatumia buildPrintTable). */
export function buildFinancialSummaryPrintHtml(
  income: number,
  expense: number,
  formatAmount: (n: number) => string,
  buildPrintTable: typeof import('@/lib/print-report').buildPrintTable,
  heading = 'MUHTASARI WA KIFEDHA',
): string {
  const salio = income - expense;
  const rows: (string | number)[][] = [
    ['Jumla Mapato', formatAmount(income), '100%'],
    ['Jumla Matumizi', formatAmount(expense), pctExpenseOfIncome(expense, income)],
    ['Salio', formatAmount(salio), pctSalioRemaining(salio, income)],
  ];
  return `<h3 style="margin-top:14px;margin-bottom:6px;color:#166534;">${heading}</h3>${buildPrintTable(
    ['KIPENGELE', 'KIASI', 'ASILIMIA (%)'],
    rows,
    { colAligns: ['left', 'right', 'right'] },
  )}`;
}

/** Safu za muhtasari kwa Excel (array of arrays). */
export function appendFinancialSummaryExcelRows(
  wsData: (string | number)[][],
  income: number,
  expense: number,
): void {
  const salio = income - expense;
  wsData.push([]);
  wsData.push(['MUHTASARI WA KIFEDHA', 'KIASI', 'ASILIMIA (%)']);
  wsData.push(['Jumla Mapato', income, '100%']);
  wsData.push(['Jumla Matumizi', expense, pctExpenseOfIncome(expense, income)]);
  wsData.push(['Salio', salio, pctSalioRemaining(salio, income)]);
}
