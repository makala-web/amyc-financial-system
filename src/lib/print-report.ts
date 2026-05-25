// ============================================================
// AMYC Financial Management System - A4 Print/PDF Utility
// ============================================================

/**
 * Opens a new window with A4-formatted report content,
 * triggers the browser's print dialog (which allows Save as PDF).
 */
import { isNativeApp } from '@/lib/native-files';
import { registerPlugin } from '@capacitor/core';
import { toast } from 'sonner';

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

const NativePrint = registerPlugin<{ printHtml(options: { html: string; jobName?: string }): Promise<{ started: boolean }> }>('NativePrint');
const NativePdf = registerPlugin<{
  saveHtmlAsPdf(options: {
    html: string;
    fileName: string;
    orientation?: 'portrait' | 'landscape';
  }): Promise<{ success: boolean; fileName: string; uri?: string; savedToDownloads?: boolean }>;
}>('NativePdf');

function waitForRender(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
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
  <title>${escapeHtml(title)} - ${escapeHtml(orgInfo)}</title>
  <style>
    @page {
      size: ${pageSize};
      margin: 18mm 15mm 18mm;
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

    h2,
    h3 {
      color: #166534;
      page-break-after: avoid;
      break-after: avoid;
    }

    h2 {
      font-size: 12pt;
      margin: 16px 0 7px;
    }

    h3 {
      font-size: 11pt;
      margin: 14px 0 6px;
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
      overflow-x: auto;
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

    .report-content > h2,
    .report-content > h3 {
      margin-top: 16px;
    }

    .summary-card,
    .summary-grid,
    .signature-area,
    .report-footer {
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .report-content table + h2,
    .report-content table + h3,
    .report-content table + p {
      margin-top: 14px;
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
      display: none;
      justify-content: space-between;
      gap: 40px;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    body.pdf-export .signature-area {
      display: flex;
    }

    body.pdf-export .no-print,
    body.pdf-export .print-actions {
      display: none !important;
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
      .report-content > h2,
      .report-content > h3,
      .box-title,
      .section-title {
        padding-top: 3mm;
      }
      .report-footer {
        position: static;
        margin: 0;
        padding: 8px 0 0;
        background: #fff;
      }
      .signature-area {
        display: flex;
      }
      table {
        page-break-inside: auto;
        break-inside: auto;
      }
      thead {
        display: table-header-group;
      }
      tfoot {
        display: table-row-group;
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
    <button class="btn-back" onclick="if (window.opener) window.close(); else if (history.length > 1) history.back(); else location.href='/'">
      &#8592; Rudi kwenye Ripoti
    </button>
    <button class="btn-print" onclick="window.print()">
      &#128424; Chapa A4
    </button>
    <button class="btn-close" onclick="if (window.opener) window.close(); else if (history.length > 1) history.back(); else location.href='/'">
      &#10005; Cancel Print
    </button>
  </div>

  <div class="report-shell">
    <!-- Report Header -->
    <div class="report-header">
      <h1>ANSAAR MUSLIM YOUTH CENTRE</h1>
      <h2>${escapeHtml(orgInfo)}</h2>
      <h3>${escapeHtml(title)}</h3>
      <p class="period">${escapeHtml(subtitle)} &mdash; ${escapeHtml(periodText)}</p>
      <p style="font-size:8pt;color:#64748b;margin-top:4px;">Ripoti imetolewa: ${escapeHtml(new Date().toLocaleDateString('sw-TZ', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</p>
    </div>

    <!-- Report Content -->
    <div class="report-content">
      ${contentHtml}
    </div>

  ${hideSignatureArea ? '' : `
  <!-- Signature Area -->
  <div class="signature-area">
    <div class="signature-box">
      <div class="line">Mudir: ${signatureValue(mudirName)}</div>
      <div class="subline">Sahihi: ${signatureValue(mudirSignature)}</div>
    </div>
    <div class="signature-box">
      <div class="line">Mwekahazina: ${signatureValue(mwekahazinaName)}</div>
      <div class="subline">Sahihi: ${signatureValue(mwekahazinaSignature)}</div>
    </div>
    <div class="signature-box">
      <div class="line">Tarehe: _________________________</div>
    </div>
  </div>`}

    <!-- Footer -->
    <div class="report-footer">
      <span>AMYC - Mfumo wa Fedha</span>
      <span>Imechapishwa: ${escapeHtml(new Date().toLocaleDateString('sw-TZ', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span>
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
    el.style.color = hasUnsupportedColor(color) ? '#000000' : color;

    const backgroundColor = computed.backgroundColor;
    el.style.backgroundColor = hasUnsupportedColor(backgroundColor) ? '#ffffff' : backgroundColor;

    const borderColor = computed.borderColor;
    el.style.borderColor = hasUnsupportedColor(borderColor) ? '#333333' : borderColor;

    const borderTopColor = computed.borderTopColor;
    el.style.borderTopColor = hasUnsupportedColor(borderTopColor) ? '#333333' : borderTopColor;

    const borderRightColor = computed.borderRightColor;
    el.style.borderRightColor = hasUnsupportedColor(borderRightColor) ? '#333333' : borderRightColor;

    const borderBottomColor = computed.borderBottomColor;
    el.style.borderBottomColor = hasUnsupportedColor(borderBottomColor) ? '#333333' : borderBottomColor;

    const borderLeftColor = computed.borderLeftColor;
    el.style.borderLeftColor = hasUnsupportedColor(borderLeftColor) ? '#333333' : borderLeftColor;

    const outlineColor = computed.outlineColor;
    el.style.outlineColor = hasUnsupportedColor(outlineColor) ? '#333333' : outlineColor;

    const fill = computed.fill;
    if (hasUnsupportedColor(fill)) el.style.fill = '#000000';

    const stroke = computed.stroke;
    if (hasUnsupportedColor(stroke)) el.style.stroke = '#000000';

    const boxShadow = computed.boxShadow;
    if (hasUnsupportedColor(boxShadow)) el.style.boxShadow = 'none';
  }
}

function withSuppressedUnsupportedColorLogs<T>(action: () => Promise<T>): Promise<T> {
  const originalError = console.error;
  const originalWarn = console.warn;
  const shouldSuppress = (args: unknown[]) =>
    args.some(
      (arg) =>
        typeof arg === 'string' &&
        /Attempting to parse an unsupported color function "(lab|lch|oklab|oklch)"/.test(arg),
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
  if (isNativeApp()) {
    openNativeHtmlPrintPreview(html);
    return;
  }

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

function openNativeHtmlPrintPreview(html: string): void {
  const existing = document.getElementById('amyc-native-print-preview');
  existing?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'amyc-native-print-preview';
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483647',
    'background:#ffffff',
    'display:flex',
    'flex-direction:column',
  ].join(';');

  const toolbar = document.createElement('div');
  toolbar.style.cssText = [
    'min-height:56px',
    'padding:8px 10px',
    'padding-top:max(8px, env(safe-area-inset-top, 8px))',
    'display:flex',
    'align-items:center',
    'justify-content:flex-end',
    'gap:8px',
    'background:#f8fafc',
    'border-bottom:1px solid #cbd5e1',
  ].join(';');

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.textContent = '← Rudi kwenye Ripoti';
  backButton.style.cssText = nativePrintButtonStyle('#334155');

  const printButton = document.createElement('button');
  printButton.type = 'button';
  printButton.textContent = 'Chapa A4';
  printButton.style.cssText = nativePrintButtonStyle('#166534');

  const frame = document.createElement('iframe');
  frame.title = 'AMYC print preview';
  frame.style.cssText = 'flex:1;width:100%;border:0;background:#fff;';
  frame.srcdoc = html;

  const closePreview = () => {
    overlay.remove();
    window.removeEventListener('popstate', closePreview);
  };

  backButton.onclick = () => {
    if (window.history.state?.amycPrintPreview) {
      window.history.back();
    } else {
      closePreview();
    }
  };

  printButton.onclick = () => {
    void printHtmlFromNativePreview(html, frame);
  };

  frame.onload = () => {
    frame.contentDocument?.querySelectorAll('.print-actions, .no-print').forEach((el) => {
      (el as HTMLElement).style.display = 'none';
    });
  };

  toolbar.append(backButton, printButton);
  overlay.append(toolbar, frame);
  document.body.appendChild(overlay);
  window.history.pushState({ amycPrintPreview: true }, '', window.location.href);
  window.addEventListener('popstate', closePreview, { once: true });
}

async function printHtmlFromNativePreview(html: string, frame: HTMLIFrameElement) {
  try {
    await NativePrint.printHtml({
      html,
      jobName: 'AMYC Report',
    });
  } catch (error) {
    console.warn('Native print failed; falling back to WebView print.', error);
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  }
}

function nativePrintButtonStyle(background: string) {
  return [
    `background:${background}`,
    'color:#fff',
    'border:0',
    'border-radius:6px',
    'font-weight:700',
    'font-size:14px',
    'min-height:40px',
    'padding:8px 12px',
  ].join(';');
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
    console.error('PDF export failed.', error);
    if (isNativeApp()) {
      toast.error('PDF imeshindikana kwenye simu. Jaribu tena au tumia Chapa A4.');
      return;
    }
    toast.error('PDF imeshindikana. Nimehifadhi HTML badala yake.');
    downloadReportHTML(options);
  }
}

export type HtmlPdfOptions = {
  fileName: string;
  orientation?: 'portrait' | 'landscape' | 'auto';
};

function prepareHtmlForPdfExport(html: string): string {
  const pdfFitStyles = `
  <style id="amyc-pdf-fit-styles">
    @page { size: A4 landscape; }
    html,
    body {
      width: 100%;
      min-width: 0;
      margin: 0;
      background: #ffffff !important;
    }
    body.pdf-export .report-shell,
    body.pdf-export .wrapper {
      width: 100% !important;
      max-width: none !important;
      min-height: auto !important;
      margin: 0 !important;
      box-shadow: none !important;
      overflow: visible !important;
      background: #ffffff !important;
    }
    body.pdf-export table {
      width: 100% !important;
    }
  </style>`;

  const htmlWithPdfClass = /<body\b[^>]*class=/i.test(html)
    ? html.replace(/<body\b([^>]*?)class=(["'])(.*?)\2/i, '<body$1class=$2$3 pdf-export$2')
    : html.replace(/<body\b([^>]*)>/i, '<body$1 class="pdf-export">');

  if (/<\/head>/i.test(htmlWithPdfClass)) {
    return htmlWithPdfClass.replace(/<\/head>/i, `${pdfFitStyles}\n</head>`);
  }

  return `${pdfFitStyles}\n${htmlWithPdfClass}`;
}

async function saveJsPdfOnNative(
  pdf: { output: (type: 'arraybuffer') => ArrayBuffer },
  fileName: string,
) {
  const { saveNativeBase64File } = await import('@/lib/native-files');
  console.log('[PDF Native] Converting PDF to base64');
  const base64Data = arrayBufferToBase64(pdf.output('arraybuffer'));
  console.log('[PDF Native] Base64 length:', base64Data.length);
  await saveNativeBase64File({
    fileName,
    base64Data,
    mimeType: 'application/pdf',
    share: false,
  });
  console.log('[PDF Native] File saved successfully');
}

export async function downloadHtmlAsPdf(html: string, options: HtmlPdfOptions): Promise<void> {
  const orientation = 'landscape';

  const fileName = options.fileName.endsWith('.pdf') ? options.fileName : `${options.fileName}.pdf`;
  const pdfHtml = prepareHtmlForPdfExport(html);

  console.log('[PDF] Starting download:', { fileName, orientation, isNative: isNativeApp(), htmlLength: html.length });

  if (isNativeApp()) {
    try {
      const result = await NativePdf.saveHtmlAsPdf({
        html: pdfHtml,
        fileName,
        orientation,
      });
      const locationText = result.savedToDownloads ? 'Downloads/AMYC' : 'hifadhi ya programu';
      toast.success(`PDF imehifadhiwa: ${fileName} (${locationText})`);
      return;
    } catch (nativeError) {
      console.warn('[PDF Native] NativePdf failed; falling back to canvas PDF.', nativeError);
    }
  }

  await withSuppressedUnsupportedColorLogs(async () => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText =
      'position:fixed;left:0;top:0;border:none;pointer-events:none;z-index:-1;background:#ffffff;';
    frame.style.width = orientation === 'landscape' ? '1123px' : '794px';
    frame.style.minHeight = '1123px';
    document.body.appendChild(frame);
    console.log('[PDF] Iframe created and appended');

    const frameDoc = frame.contentDocument;
    if (!frameDoc) {
      document.body.removeChild(frame);
      console.error('[PDF] ERROR: Iframe document is null');
      throw new Error('Iframe document unavailable');
    }

    console.log('[PDF] Iframe document available, writing HTML');
    frameDoc.open();
    frameDoc.write(pdfHtml);
    frameDoc.close();
    console.log('[PDF] HTML written to iframe');

    const renderDelay = isNativeApp() ? 600 : 200;
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      if (frame.contentWindow?.document.readyState === 'complete') {
        setTimeout(done, renderDelay);
      } else {
        frame.onload = () => setTimeout(done, renderDelay);
      }
    });
    console.log('[PDF] Iframe document rendered, readyState:', frame.contentWindow?.document.readyState);
    await waitForRender(isNativeApp() ? 200 : 0);

    sanitizeUnsupportedColors(frameDoc, frame.contentWindow);
    frameDoc.body.classList.add('pdf-export');
    frameDoc.querySelectorAll('.no-print, .print-actions').forEach((el) => {
      (el as HTMLElement).style.display = 'none';
    });

    const root =
      (frameDoc.querySelector('.report-shell') as HTMLElement | null) ||
      (frameDoc.querySelector('.wrapper') as HTMLElement | null) ||
      frameDoc.body;

    console.log('[PDF] Root element found:', { 
      tagName: root?.tagName, 
      scrollWidth: root?.scrollWidth, 
      scrollHeight: root?.scrollHeight,
      innerHTML: root?.innerHTML?.substring(0, 100),
      textContent: root?.textContent?.substring(0, 50)
    });

    // Check if root has content
    if (!root || !root.textContent || root.textContent.trim().length === 0) {
      console.error('[PDF] ERROR: Root element has no text content!');
      document.body.removeChild(frame);
      throw new Error('PDF root element is empty - HTML rendering failed in iframe');
    }

    // Check if dimensions are too small (likely rendering issue)
    if ((root.scrollWidth || 0) < 100 || (root.scrollHeight || 0) < 100) {
      console.warn('[PDF] Root element dimensions suspiciously small:', { 
        scrollWidth: root.scrollWidth, 
        scrollHeight: root.scrollHeight 
      });
    }

    const html2canvas = (await import('html2canvas')).default;
    const nativeCanvas = isNativeApp();
    const canvasOptions = (scale: number) => ({
      scale,
      useCORS: true,
      allowTaint: true,
      foreignObjectRendering: false,
      logging: false,
      backgroundColor: '#ffffff',
      width: Math.max(root.scrollWidth, 1),
      height: Math.max(root.scrollHeight, 1),
      windowWidth: Math.max(root.scrollWidth, 1),
      windowHeight: Math.max(root.scrollHeight, 1),
      onclone: (clonedDoc: Document) => sanitizeUnsupportedColors(clonedDoc, clonedDoc.defaultView),
    });

    let canvas: HTMLCanvasElement;
    const primaryScale = nativeCanvas ? 1.25 : 2;
    const fallbackScale = nativeCanvas ? 1 : 1.25;
    console.log('[PDF] Starting html2canvas with scale:', primaryScale);
    try {
      canvas = await html2canvas(root, canvasOptions(primaryScale));
      console.log('[PDF] Canvas created:', { width: canvas.width, height: canvas.height });
    } catch (error) {
      console.warn('[PDF] High resolution PDF canvas failed; retrying with standard scale.', error);
      canvas = await html2canvas(root, canvasOptions(fallbackScale));
      console.log('[PDF] Canvas created (fallback):', { width: canvas.width, height: canvas.height });
    }

    if (!canvas.width || !canvas.height) {
      console.error('[PDF] ERROR: Canvas dimensions are zero!', { width: canvas.width, height: canvas.height });
      console.warn('[PDF] html2canvas failed on this device - attempting native PDF via print');
      document.body.removeChild(frame);

      if (isNativeApp()) {
        // Fallback: Use native print to save as PDF
        console.log('[PDF] Using native print as fallback');
        try {
          await NativePrint.printHtml({
            html: pdfHtml,
            jobName: fileName.replace('.pdf', ''),
          });
          toast.success(`PDF imetengenezwa kupitia simu: ${fileName}`);
          return;
        } catch (fallbackError) {
          console.error('[PDF] Native print also failed:', fallbackError);
          toast.error('PDF generation failed on this device');
          throw new Error('PDF canvas is empty and native print failed');
        }
      }
      throw new Error('PDF canvas is empty on this device.');
    }

    console.log('[PDF] Canvas dimensions valid, removing iframe');
    document.body.removeChild(frame);

    const { jsPDF } = await import('jspdf');
    console.log('[PDF] jsPDF imported, creating PDF document');
    const pdf = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const imgData = canvas.toDataURL('image/jpeg', 0.92);

    console.log('[PDF] PDF config:', { pageWidth, pageHeight, imgWidth, imgHeight, imgDataLength: imgData.length });

    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
    console.log('[PDF] First image added to PDF');
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position -= pageHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    const pageCount = pdf.getNumberOfPages();
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(51, 65, 85);
    for (let page = 1; page <= pageCount; page += 1) {
      pdf.setPage(page);
      pdf.text(`Ukurasa ${page} / ${pageCount}`, pageWidth - 72, pageHeight - 18, { align: 'right' });
    }

    console.log('[PDF] All pages added to PDF');

    if (isNativeApp()) {
      console.log('[PDF] Saving to native storage');
      await saveJsPdfOnNative(pdf, fileName);
      console.log('[PDF] Native save completed');
    } else {
      console.log('[PDF] Saving via browser download');
      pdf.save(fileName);
      toast.success(`PDF imedownloadiwa: ${fileName}`);
    }
  });
}

export async function generateReportPDF(options: PrintReportOptions) {
  const orientation = 'landscape';
  const html = generateReportHTML({ ...options, orientation });
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
