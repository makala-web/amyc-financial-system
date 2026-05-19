// ============================================================
// AMYC Financial Management System - A4 Print/PDF Utility
// ============================================================

/**
 * Opens a new window with A4-formatted report content,
 * triggers the browser's print dialog (which allows Save as PDF).
 */

export interface PrintReportOptions {
  title: string;
  subtitle: string;
  orgInfo: string;
  /** @deprecated Ngazi is already in orgInfo (e.g. OFISI YA MUDIR - TAWI LA …); not shown separately */
  orgLevel?: string;
  year: number;
  month?: number; // undefined = all months
  contentHtml: string;
  mudirName?: string; // Jina la Mudir (Director) - appears in signature area
  mudirSignature?: string; // Sahihi ya Mudir - appears in signature area
  mwekahazinaName?: string; // Jina la Mwekahazina (Treasurer) - appears in signature area
  mwekahazinaSignature?: string; // Sahihi ya Mwekahazina - appears in signature area
  hideSignatureArea?: boolean;
  orientation?: 'portrait' | 'landscape' | 'auto';
}

const MONTH_NAMES = [
  'Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni',
  'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba',
];

/**
 * Generate the full HTML for a report (shared by print and download).
 */
export function generateReportHTML(options: PrintReportOptions): string {
  const {
    title,
    subtitle,
    orgInfo,
    year,
    month,
    contentHtml,
    mudirName,
    mudirSignature,
    mwekahazinaName,
    mwekahazinaSignature,
    hideSignatureArea,
  } = options;
  const hasLandscapeHint = contentHtml.includes('class="landscape"') || contentHtml.includes("class='landscape'");
  const resolvedOrientation = options.orientation === 'auto' || !options.orientation
    ? (hasLandscapeHint ? 'landscape' : 'portrait')
    : options.orientation;
  const pageSize = resolvedOrientation === 'landscape' ? 'A4 landscape' : 'A4';

  const periodText = month
    ? `Mwezi: ${MONTH_NAMES[month - 1]} ${year}`
    : `Mwaka: ${year}`;

  return `<!DOCTYPE html>
<html lang="sw">
<head>
  <meta charset="UTF-8" />
  <title>${title} - ${orgInfo}</title>
  <style>
    @page {
      size: ${pageSize};
      margin: 14mm 15mm 18mm;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: Arial, sans-serif;
      font-size: 10pt;
      color: #0f172a;
      background: #e5e7eb;
      line-height: 1.4;
    }

    h3 {
      color: #166534;
      font-size: 11pt;
      margin: 14px 0 6px;
      page-break-after: avoid;
      break-after: avoid;
    }

    .report-shell {
      width: 100%;
      max-width: ${resolvedOrientation === 'landscape' ? '1120px' : '820px'};
      min-height: 100vh;
      margin: 0 auto;
      padding: 18px 18px 28px;
      box-sizing: border-box;
      background: #fff;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12);
    }

    .report-header {
      text-align: center;
      margin-bottom: 16px;
      padding: 10px 12px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      background: linear-gradient(90deg, #ecfdf5 0%, #ffffff 55%, #dcfce7 100%);
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .report-header h1 {
      font-size: 17px;
      font-weight: 800;
      color: #065f46;
      margin-bottom: 4px;
    }

    .report-header h2 {
      font-size: 14px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 2px;
    }

    .report-header h3 {
      font-size: 13px;
      font-weight: 600;
      color: #065f46;
      margin-bottom: 2px;
    }

    .report-header .period {
      font-size: 11px;
      color: #334155;
    }

    /* Table styling */
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
      font-size: 10px;
      table-layout: fixed;
      page-break-inside: auto;
      break-inside: auto;
    }

    th {
      background-color: #166534;
      color: #fff;
      font-weight: bold;
      padding: 5px 6px;
      border: 1.4px solid #64748b;
      text-align: center;
      font-size: 8.5pt;
      break-inside: avoid;
    }

    td {
      padding: 4px 6px;
      border: 1.4px solid #64748b;
      vertical-align: middle;
      overflow-wrap: anywhere;
      word-break: break-word;
      break-inside: avoid;
    }

    tr {
      page-break-inside: avoid;
      break-inside: avoid;
      page-break-after: auto;
    }

    thead {
      display: table-header-group;
    }

    tbody {
      display: table-row-group;
    }

    tfoot {
      display: table-footer-group;
    }

    td.text-right {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    td.text-center {
      text-align: center;
    }

    td.text-left {
      text-align: left;
    }

    tr:nth-child(even) td {
      background-color: #f8fafc;
    }

    tr.total-row td {
      background-color: #166534;
      color: #fff;
      font-weight: bold;
      border: 1.4px solid #475569;
    }

    tr.subtotal-row td {
      background-color: #dcfce7;
      font-weight: bold;
      border: 1.4px solid #64748b;
    }

    tr.bakaa-row td {
      background-color: #f0fdf4;
      font-weight: bold;
      border: 1.4px solid #64748b;
    }

    .group-header td {
      background-color: #bbf7d0;
      font-weight: bold;
      font-size: 9pt;
      border: 1.4px solid #64748b;
    }

    .report-content {
      width: 100%;
      overflow: visible;
    }

    .report-content > h1,
    .report-content > h2,
    .report-content > h3,
    .report-content > h4,
    .box-title,
    .section-title {
      page-break-after: avoid;
      break-after: avoid;
    }

    .summary-card,
    .summary-grid,
    .signature-area,
    .report-footer {
      page-break-inside: avoid;
      break-inside: avoid;
    }

    /* Footer */
    .report-footer {
      margin-top: 20px;
      padding-top: 8px;
      border-top: 1px solid #ccc;
      font-size: 8pt;
      color: #475569;
      display: flex;
      justify-content: space-between;
      align-items: center;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .page-counter::after {
      content: "Ukurasa " counter(page);
      font-weight: 600;
      color: #334155;
    }

    /* Signature area */
    .signature-area {
      margin-top: 24px;
      display: flex;
      justify-content: space-between;
      gap: 40px;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .signature-box {
      flex: 1;
      text-align: center;
    }

    .signature-box .line {
      border-top: 1px solid #000;
      margin-top: 50px;
      padding-top: 4px;
      font-size: 9pt;
      color: #333;
    }

    .signature-box .subline {
      margin-top: 8px;
      font-size: 9pt;
      color: #333;
    }

    /* Page break control */
    .page-break {
      page-break-before: always;
      break-before: page;
    }

    .page-break:last-child {
      display: none;
    }

    /* No-print utility */
    @media print {
      .no-print {
        display: none !important;
      }
      body {
        background: #fff;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .report-shell {
        max-width: none;
        min-height: auto;
        margin: 0;
        padding: 0;
        box-shadow: none;
      }
      .report-footer {
        position: static;
        margin: 0;
        padding: 8px 0 0;
        background: #fff;
      }
      table {
        page-break-inside: auto;
        break-inside: auto;
      }
      thead {
        display: table-header-group;
      }
      tfoot {
        display: table-footer-group;
      }
      tr {
        page-break-inside: avoid;
        break-inside: avoid;
      }
    }

    /* Print button (only visible on screen) */
    .print-actions {
      position: fixed;
      top: 10px;
      right: 10px;
      display: flex;
      gap: 8px;
      z-index: 1000;
    }

    .print-actions button {
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 11pt;
      font-weight: bold;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .btn-print {
      background: #166534;
      color: #fff;
    }

    .btn-close {
      background: #991b1b;
      color: #fff;
    }

    .btn-back {
      background: #334155;
      color: #fff;
    }

    .print-actions button:hover {
      opacity: 0.9;
    }

    .landscape {
      width: 100%;
    }
  </style>
</head>
<body>
  <!-- Print/PDF + Close buttons (hidden when actually printing) -->
  <div class="print-actions no-print">
    <button class="btn-back" onclick="window.close()">
      &#8592; Rudi kwenye Ripoti
    </button>
    <button class="btn-print" onclick="window.print()">
      &#128424; Chapa A4
    </button>
    <button class="btn-close" onclick="window.close()">
      &#10005; Cancel Print
    </button>
  </div>

  <div class="report-shell">
    <!-- Report Header -->
    <div class="report-header">
      <h1>ANSAAR MUSLIM YOUTH CENTRE</h1>
      <h2>${orgInfo}</h2>
      <h3>${title}</h3>
      <p class="period">${subtitle} &mdash; ${periodText}</p>
      <p style="font-size:8pt;color:#64748b;margin-top:4px;">Ripoti imetolewa: ${new Date().toLocaleDateString('sw-TZ', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
    </div>

    <!-- Report Content -->
    <div class="report-content">
      ${contentHtml}
    </div>

  ${hideSignatureArea ? '' : `
  <!-- Signature Area -->
  <div class="signature-area">
    <div class="signature-box">
      <div class="line">Mudir: ${mudirName || '_________________________'}</div>
      <div class="subline">Sahihi: ${mudirSignature || '_________________________'}</div>
    </div>
    <div class="signature-box">
      <div class="line">Mwekahazina: ${mwekahazinaName || '_________________________'}</div>
      <div class="subline">Sahihi: ${mwekahazinaSignature || '_________________________'}</div>
    </div>
    <div class="signature-box">
      <div class="line">Tarehe: _________________________</div>
    </div>
  </div>`}

    <!-- Footer -->
    <div class="report-footer">
      <span>AMYC - Mfumo wa Fedha</span>
      <span>Imechapishwa: ${new Date().toLocaleDateString('sw-TZ', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
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

function resolveOrientation(options: PrintReportOptions): 'portrait' | 'landscape' {
  const hasLandscapeHint =
    options.contentHtml.includes('class="landscape"') ||
    options.contentHtml.includes("class='landscape'");
  return options.orientation === 'auto' || !options.orientation
    ? hasLandscapeHint
      ? 'landscape'
      : 'portrait'
    : options.orientation;
}

function hasUnsupportedColor(value: string | null | undefined): boolean {
  return !!value && /(oklab|oklch|lab|lch)\(/i.test(value);
}

function sanitizeUnsupportedColors(doc: Document, view: Window | null | undefined) {
  if (!view) return;

  const elements = [doc.documentElement, doc.body, ...Array.from(doc.querySelectorAll('*'))]
    .filter((el): el is HTMLElement => !!el && el instanceof HTMLElement);

  for (const el of elements) {
    const computed = view.getComputedStyle(el);

    const color = computed.color;
    if (hasUnsupportedColor(color)) {
      el.style.color = '#000000';
    }

    const backgroundColor = computed.backgroundColor;
    if (hasUnsupportedColor(backgroundColor)) {
      el.style.backgroundColor = '#ffffff';
    }

    const borderColor = computed.borderColor;
    if (hasUnsupportedColor(borderColor)) {
      el.style.borderColor = '#333333';
    }

    const borderTopColor = computed.borderTopColor;
    if (hasUnsupportedColor(borderTopColor)) {
      el.style.borderTopColor = '#333333';
    }

    const borderRightColor = computed.borderRightColor;
    if (hasUnsupportedColor(borderRightColor)) {
      el.style.borderRightColor = '#333333';
    }

    const borderBottomColor = computed.borderBottomColor;
    if (hasUnsupportedColor(borderBottomColor)) {
      el.style.borderBottomColor = '#333333';
    }

    const borderLeftColor = computed.borderLeftColor;
    if (hasUnsupportedColor(borderLeftColor)) {
      el.style.borderLeftColor = '#333333';
    }

    const outlineColor = computed.outlineColor;
    if (hasUnsupportedColor(outlineColor)) {
      el.style.outlineColor = '#333333';
    }
  }
}

function withSuppressedUnsupportedColorLogs<T>(action: () => Promise<T>): Promise<T> {
  const originalError = console.error;
  const originalWarn = console.warn;
  const shouldSuppress = (args: unknown[]) =>
    args.some(
      (arg) =>
        typeof arg === 'string' &&
        arg.includes('Attempting to parse an unsupported color function "lab"'),
    );

  console.error = (...args: unknown[]) => {
    if (shouldSuppress(args)) return;
    originalError(...args);
  };

  console.warn = (...args: unknown[]) => {
    if (shouldSuppress(args)) return;
    originalWarn(...args);
  };

  return action().finally(() => {
    console.error = originalError;
    console.warn = originalWarn;
  });
}

/** Chapa A4 — same HTML/CSS as screen preview; opens browser print dialog */
export function openReportPrintPreview(options: PrintReportOptions): void {
  openHtmlPrintPreview(generateReportHTML(options));
}

/** Chapa A4 kwa HTML maalum (tawi/jimbo unified, n.k.) */
export function openHtmlPrintPreview(html: string): void {
  const popup = window.open('', '_blank', 'width=1024,height=768');
  if (!popup) {
    alert('Pop-up imezuiwa. Ruhusu pop-ups ili kuchapa ripoti.');
    return;
  }
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.focus();
}

export function printReport(options: PrintReportOptions): void {
  openReportPrintPreview(options);
}

/**
 * Download the report as an HTML file (can be opened in browser and printed to PDF).
 */
export function downloadReportHTML(options: PrintReportOptions) {
  const html = generateReportHTML(options);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${options.title.replace(/\s+/g, '_')}_${options.year}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadReportPDF(options: PrintReportOptions) {
  try {
    await generateReportPDF(options);
  } catch (error) {
    console.error('PDF export failed, falling back to HTML download.', error);
    downloadReportHTML(options);
  }
}

export type HtmlPdfOptions = {
  fileName: string;
  orientation?: 'portrait' | 'landscape' | 'auto';
};

export async function downloadHtmlAsPdf(html: string, options: HtmlPdfOptions): Promise<void> {
  const orientation =
    options.orientation === 'auto' || !options.orientation
      ? html.includes('class="landscape"') ||
        html.includes("class='landscape'") ||
        html.includes('@page { size: A4 landscape')
        ? 'landscape'
        : 'portrait'
      : options.orientation;

  await withSuppressedUnsupportedColorLogs(async () => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText =
      'position:fixed;left:-12000px;top:0;border:none;visibility:hidden;';
    frame.style.width = orientation === 'landscape' ? '1123px' : '794px';
    document.body.appendChild(frame);

    const frameDoc = frame.contentDocument;
    if (!frameDoc) {
      document.body.removeChild(frame);
      throw new Error('Iframe document unavailable');
    }

    frameDoc.open();
    frameDoc.write(html);
    frameDoc.close();

    await new Promise<void>((resolve) => {
      const done = () => resolve();
      if (frame.contentWindow?.document.readyState === 'complete') {
        setTimeout(done, 200);
      } else {
        frame.onload = () => setTimeout(done, 200);
      }
    });

    sanitizeUnsupportedColors(frameDoc, frame.contentWindow);
    frameDoc.querySelectorAll('.no-print, .print-actions').forEach((el) => {
      (el as HTMLElement).style.display = 'none';
    });

    const root =
      (frameDoc.querySelector('.report-shell') as HTMLElement | null) ||
      (frameDoc.querySelector('.wrapper') as HTMLElement | null) ||
      frameDoc.body;

    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(root, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      width: root.scrollWidth,
      height: root.scrollHeight,
      windowWidth: root.scrollWidth,
      windowHeight: root.scrollHeight,
    });

    document.body.removeChild(frame);

    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const imgData = canvas.toDataURL('image/jpeg', 0.92);

    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position -= pageHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    const fileName = options.fileName.endsWith('.pdf') ? options.fileName : `${options.fileName}.pdf`;
    const { isNativeApp, saveNativeBase64File } = await import('@/lib/native-files');
    if (isNativeApp()) {
      const dataUri = pdf.output('datauristring');
      const base64Data = dataUri.split(',')[1] || '';
      await saveNativeBase64File({
        fileName,
        base64Data,
        mimeType: 'application/pdf',
        share: true,
      });
    } else {
      pdf.save(fileName);
    }
  });
}

export async function generateReportPDF(options: PrintReportOptions) {
  const html = generateReportHTML(options);
  const orientation = resolveOrientation(options);
  const fileName = `${options.title.replace(/\s+/g, '_')}_${options.year}.pdf`;
  await downloadHtmlAsPdf(html, { fileName, orientation });
}

/**
 * Helper: Format a number for printing (2 decimal places, comma-separated)
 */
export function formatPrintNum(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Helper: Build an HTML table from row data for printing
 */
export function buildPrintTable(headers: string[], rows: (string | number)[][], options?: {
  totalRow?: (string | number)[];
  footers?: (string | number)[][];
  landscape?: boolean;
  colAligns?: ('left' | 'center' | 'right')[];
}): string {
  const { totalRow, footers, landscape, colAligns } = options || {};
  const useLandscape = landscape ?? headers.length >= 5;
  const alignClass = (i: number) => {
    const a = colAligns?.[i] || 'right';
    return `text-${a}`;
  };

  const cellBorder = 'style="border:1px solid #333"';

  let html = `<table${useLandscape ? ' class="landscape"' : ''}>`;

  // Header
  html += '<thead><tr>';
  headers.forEach((h, i) => {
    html += `<th ${cellBorder}>${h}</th>`;
  });
  html += '</tr></thead>';

  // Body
  html += '<tbody>';
  rows.forEach((row) => {
    html += '<tr>';
    row.forEach((cell, i) => {
      const val = cell === 0 || cell === '' ? '' : cell;
      html += `<td class="${alignClass(i)}" ${cellBorder}>${val}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody>';

  // Total row
  if (totalRow) {
    html += '<tfoot><tr class="total-row">';
    totalRow.forEach((cell, i) => {
      html += `<td class="${alignClass(i)}" ${cellBorder}>${cell}</td>`;
    });
    html += '</tr>';
  }

  // Additional footer rows
  if (footers) {
    footers.forEach((row) => {
      html += '<tr class="subtotal-row">';
      row.forEach((cell, i) => {
        html += `<td class="${alignClass(i)}" ${cellBorder}>${cell}</td>`;
      });
      html += '</tr>';
    });
  }

  if (totalRow || footers) {
    html += '</tfoot>';
  }

  html += '</table>';
  return html;
}
