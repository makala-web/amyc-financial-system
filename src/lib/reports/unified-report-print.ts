/**
 * HTML ya print/PDF kwa ripoti jumuishi (tawi na jimbo) — muundo mmoja.
 */

export type UnifiedPrintMonthlyRow = {
  monthLabel: string;
  openingBalance: number;
  income: number;
  expense: number;
  balance: number;
  closingBalance: number;
};

export type UnifiedPrintDepartmentRow = {
  department: string;
  income: number;
  expense: number;
  balance: number;
};

export type UnifiedPrintCategoryRow = {
  category: string;
  amount: number;
  percentage: number;
};

export type UnifiedPrintBranchRow = {
  name: string;
  status?: string;
  openingBalance: number;
  income: number;
  expense: number;
  closingBalance: number;
};

export type UnifiedPrintConfig = {
  orgLine: string;
  formTitle: string;
  year: number;
  month?: number;
  generatedAt: string;
  openingBalance: number;
  totalIncome: number;
  totalExpense: number;
  closingBalance: number;
  carryForward: number;
  monthlyRows: UnifiedPrintMonthlyRow[];
  departmentRows: UnifiedPrintDepartmentRow[];
  incomeCategoryRows: UnifiedPrintCategoryRow[];
  expenseCategoryRows: UnifiedPrintCategoryRow[];
  branchRows?: UnifiedPrintBranchRow[];
  branchSectionTitle?: string;
  mudirName?: string;
  mudirSignature?: string;
  mwekahazinaName?: string;
  mwekahazinaSignature?: string;
};

function formatNum(value: number) {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function signatureValue(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? escapeHtml(trimmed) : '_________________________';
}

function normalizeCategoryRows(rows: UnifiedPrintCategoryRow[], total: number) {
  const merged = new Map<string, { label: string; amount: number }>();

  for (const row of rows) {
    const label = (row.category || 'Bila Kategoria').trim() || 'Bila Kategoria';
    const key = label.toLocaleLowerCase('sw').replace(/\s+/g, ' ');
    const current = merged.get(key);
    if (current) {
      current.amount += row.amount || 0;
    } else {
      merged.set(key, { label, amount: row.amount || 0 });
    }
  }

  return Array.from(merged.values())
    .map((row) => ({
      category: row.label,
      amount: row.amount,
      percentage: total > 0 ? (row.amount / total) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category, 'sw'));
}

const PRINT_STYLES = `
  @page { size: A4 landscape; margin: 18mm 12mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; color: #0f172a; margin: 0; padding: 0; background: #e5e7eb; }
  .wrapper { width: 100%; max-width: 1120px; min-height: 100vh; margin: 0 auto; padding: 18px 18px 28px; box-sizing: border-box; background: #fff; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12); overflow-x: auto; }
  .header { text-align: center; margin-bottom: 16px; page-break-inside: avoid; break-inside: avoid; }
  .h1 { font-weight: 800; font-size: 18px; color: #065f46; margin-bottom: 4px; }
  .h2 { font-weight: 700; font-size: 14px; margin-bottom: 2px; }
  .h3 { font-weight: 600; font-size: 13px; margin-bottom: 2px; }
  .meta { font-size: 11px; color: #334155; margin-top: 4px; }
  .box { border: 1px solid #cbd5e1; border-radius: 8px; margin: 16px 0; padding: 8px; }
  .box-title { background: #ecfdf5; color: #065f46; font-weight: 700; padding: 10px 12px; border-radius: 6px; margin-bottom: 8px; page-break-after: avoid; break-after: avoid; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; page-break-inside: auto; break-inside: auto; }
  thead { display: table-header-group; }
  tbody { display: table-row-group; }
  tfoot { display: table-footer-group; }
  tr { page-break-inside: avoid; break-inside: avoid; page-break-after: auto; }
  th, td { border: 1.4px solid #64748b; padding: 8px; word-break: break-word; overflow-wrap: anywhere; page-break-inside: avoid; break-inside: avoid; }
  th { background: #f0fdf4; text-align: left; }
  td.num, th.num { text-align: right; }
  .empty-row { text-align: center; color: #475569; padding: 12px 0; }
  .section { page-break-inside: auto; break-inside: auto; scroll-margin-top: 72px; }
  .section + .section { margin-top: 18px; }
  .report-footer {
    margin-top: 14px;
    padding-top: 6px;
    border-top: 1px solid #cbd5e1;
    color: #475569;
    font-size: 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .signature-area {
    display: none;
    gap: 40px;
    justify-content: space-between;
    margin-top: 24px;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  body.pdf-export .signature-area { display: flex; }
  body.pdf-export .no-print,
  body.pdf-export .print-actions { display: none !important; }
  .signature-box { flex: 1; text-align: center; }
  .signature-line {
    border-top: 1px solid #000;
    color: #334155;
    font-size: 11px;
    margin-top: 46px;
    padding-top: 6px;
  }
  .signature-subline {
    color: #334155;
    font-size: 11px;
    margin-top: 8px;
  }
  .page-counter::after { content: "Ukurasa " counter(page); font-weight: 600; }
  .print-actions {
    position: fixed;
    top: 10px;
    right: 10px;
    display: flex;
    gap: 8px;
    z-index: 1000;
  }
  .print-actions button {
    border: 0;
    border-radius: 6px;
    color: #fff;
    cursor: pointer;
    font-size: 11pt;
    font-weight: 700;
    padding: 8px 14px;
  }
  .btn-back { background: #334155; }
  .btn-print { background: #166534; }
  .btn-close { background: #991b1b; }
  @media print {
    body { margin: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    .wrapper { max-width: none; min-height: auto; margin: 0; padding: 0; box-shadow: none; }
    .box { page-break-inside: auto; break-inside: auto; }
    .section { page-break-inside: auto; break-inside: auto; margin-top: 12px; }
    .section:first-of-type { margin-top: 0; }
    .header, .box-title { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .report-footer {
      position: static;
      margin: 0;
      padding: 8px 0 0;
      background: #fff;
    }
    .signature-area { display: flex; }
    thead { display: table-header-group; }
    tfoot { display: table-row-group; }
    tr { page-break-inside: avoid; break-inside: avoid; }
  }
`;

export function buildUnifiedFinancialPrintHtml(config: UnifiedPrintConfig): string {
  const incomeCategoryRows = normalizeCategoryRows(config.incomeCategoryRows, config.totalIncome);
  const expenseCategoryRows = normalizeCategoryRows(config.expenseCategoryRows, config.totalExpense);

  const monthlyRowsHtml =
    config.monthlyRows.length > 0
      ? config.monthlyRows
          .map(
            (row) => `
      <tr>
        <td>${escapeHtml(row.monthLabel)}</td>
        <td class="num">${formatNum(row.openingBalance)}</td>
        <td class="num">${formatNum(row.income)}</td>
        <td class="num">${formatNum(row.expense)}</td>
        <td class="num">${formatNum(row.balance)}</td>
        <td class="num">${formatNum(row.closingBalance)}</td>
      </tr>`,
          )
          .join('')
      : `<tr><td colspan="6" class="empty-row">Hakuna taarifa za miezi.</td></tr>`;

  const departmentRowsHtml = config.departmentRows
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.department)}</td>
        <td class="num">${formatNum(row.income)}</td>
        <td class="num">${formatNum(row.expense)}</td>
        <td class="num">${formatNum(row.balance)}</td>
      </tr>`,
    )
    .join('');

  const branchSectionHtml =
    config.branchRows && config.branchRows.length > 0
      ? (() => {
        const hasStatus = config.branchRows?.some((row) => row.status);
        return `
        <div class="box section">
          <div class="box-title">${escapeHtml(config.branchSectionTitle || 'Muhtasari wa Kila Tawi')}</div>
          <table>
            <thead>
            <tr>
              <th>Kitengo</th>
              ${hasStatus ? '<th>Hali</th>' : ''}
              <th class="num">Salio la mwanzo</th>
              <th class="num">Mapato</th>
              <th class="num">Matumizi</th>
              <th class="num">Salio la mwisho</th>
            </tr>
            </thead>
            <tbody>
            ${config.branchRows
              .map(
                (row) => `
            <tr>
              <td>${escapeHtml(row.name)}</td>
              ${hasStatus ? `<td>${escapeHtml(row.status || '')}</td>` : ''}
              <td class="num">${formatNum(row.openingBalance)}</td>
              <td class="num">${formatNum(row.income)}</td>
              <td class="num">${formatNum(row.expense)}</td>
              <td class="num">${formatNum(row.closingBalance)}</td>
            </tr>`,
              )
              .join('')}
            </tbody>
          </table>
        </div>`;
      })()
      : '';

  const incomeCategoryRowsHtml =
    incomeCategoryRows.length > 0
      ? incomeCategoryRows
          .map(
            (row) => `
      <tr>
        <td>${escapeHtml(row.category)}</td>
        <td class="num">${formatNum(row.amount)}</td>
        <td class="num">${formatPercent(row.percentage)}</td>
      </tr>`,
          )
          .join('')
      : `<tr><td colspan="3" class="empty-row">Hakuna taarifa za mapato kwa kategoria.</td></tr>`;

  const expenseCategoryRowsHtml =
    expenseCategoryRows.length > 0
      ? expenseCategoryRows
          .map(
            (row) => `
      <tr>
        <td>${escapeHtml(row.category)}</td>
        <td class="num">${formatNum(row.amount)}</td>
        <td class="num">${formatPercent(row.percentage)}</td>
      </tr>`,
          )
          .join('')
      : `<tr><td colspan="3" class="empty-row">Hakuna taarifa za matumizi kwa kategoria.</td></tr>`;

  const periodMeta = config.month
    ? `Kwa Mwaka: ${config.year} | Mwezi: ${config.month}`
    : `Kwa Mwaka: ${config.year} | Miezi yote`;

  return `
  <html>
    <head>
      <title>${escapeHtml(config.formTitle)}</title>
      <style>${PRINT_STYLES}</style>
    </head>
    <body>
      <div class="print-actions no-print">
        <button class="btn-back" onclick="if (window.opener) window.close(); else if (history.length > 1) history.back(); else location.href='/'">&#8592; Rudi kwenye Ripoti</button>
        <button class="btn-print" onclick="window.print()">&#128424; Chapa A4</button>
        <button class="btn-close" onclick="if (window.opener) window.close(); else if (history.length > 1) history.back(); else location.href='/'">&#10005; Cancel Print</button>
      </div>
      <div class="wrapper">
        <div class="header">
          <div class="h1">ANSAAR MUSLIM YOUTH CENTRE</div>
          <div class="h2">OFISI YA MUDIR - ${escapeHtml(config.orgLine)}</div>
          <div class="h3">${escapeHtml(config.formTitle)}</div>
          <div class="meta">${periodMeta}</div>
          <div class="meta">Imetolewa: ${escapeHtml(config.generatedAt)}</div>
        </div>

        <div class="box section">
          <div class="box-title">Muhtasari wa Kifedha</div>
          <table>
            <thead><tr><th>Kipengele</th><th class="num">Kiasi</th></tr></thead>
            <tbody>
            <tr><td>Salio la mwanzo</td><td class="num">${formatNum(config.openingBalance)}</td></tr>
            <tr><td>Jumla ya Mapato</td><td class="num">${formatNum(config.totalIncome)}</td></tr>
            <tr><td>Jumla ya Matumizi</td><td class="num">${formatNum(config.totalExpense)}</td></tr>
            <tr><td>Salio la mwisho</td><td class="num">${formatNum(config.closingBalance)}</td></tr>
            <tr><td>Carry Forward</td><td class="num">${formatNum(config.carryForward)}</td></tr>
            </tbody>
          </table>
        </div>

        <div class="box section">
          <div class="box-title">Muhtasari wa Kila Mwezi</div>
          <table>
            <thead>
            <tr>
              <th>Mwezi</th>
              <th class="num">Salio la mwanzo</th>
              <th class="num">Mapato</th>
              <th class="num">Matumizi</th>
              <th class="num">Salio</th>
              <th class="num">Salio la mwisho</th>
            </tr>
            </thead>
            <tbody>
            ${monthlyRowsHtml}
            </tbody>
          </table>
        </div>

        ${branchSectionHtml}

        <div class="box section">
          <div class="box-title">Muhtasari wa Kila Idara</div>
          <table>
            <thead>
            <tr>
              <th>Idara</th>
              <th class="num">Mapato</th>
              <th class="num">Matumizi</th>
              <th class="num">Salio</th>
            </tr>
            </thead>
            <tbody>
            ${departmentRowsHtml}
            </tbody>
          </table>
        </div>

        <div class="box section">
          <div class="box-title">Mapato kwa Kategoria</div>
          <table>
            <thead>
            <tr>
              <th>Kategoria</th>
              <th class="num">Kiasi</th>
              <th class="num">Asilimia (%)</th>
            </tr>
            </thead>
            <tbody>
            ${incomeCategoryRowsHtml}
            </tbody>
          </table>
        </div>

        <div class="box section">
          <div class="box-title">Matumizi kwa Kategoria</div>
          <table>
            <thead>
            <tr>
              <th>Kategoria</th>
              <th class="num">Kiasi</th>
              <th class="num">Asilimia (%)</th>
            </tr>
            </thead>
            <tbody>
            ${expenseCategoryRowsHtml}
            </tbody>
          </table>
        </div>

        <div class="signature-area">
          <div class="signature-box">
            <div class="signature-line">Mudir: ${signatureValue(config.mudirName)}</div>
            <div class="signature-subline">Sahihi: ${signatureValue(config.mudirSignature)}</div>
          </div>
          <div class="signature-box">
            <div class="signature-line">Mwekahazina: ${signatureValue(config.mwekahazinaName)}</div>
            <div class="signature-subline">Sahihi: ${signatureValue(config.mwekahazinaSignature)}</div>
          </div>
          <div class="signature-box">
            <div class="signature-line">Tarehe: _________________________</div>
          </div>
        </div>

        <div class="report-footer">
          <span>AMYC - Mfumo wa Fedha</span>
          <span>Imechapishwa: ${escapeHtml(config.generatedAt)}</span>
          <span class="page-counter"></span>
        </div>
      </div>
      <script>
        window.onafterprint = function () {
          document.body.classList.add('print-complete');
        };
      </script>
    </body>
  </html>`;
}
