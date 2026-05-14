import jsPDF from 'jspdf';

// ── Formatting ────────────────────────────────────────────────────────────────

export function fmtRupee(amount: number): string {
  return `Rs. ${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const parsed = new Date(d);
  if (isNaN(parsed.getTime())) return String(d);
  return parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function amountInWords(n: number): string {
  if (!n || isNaN(n)) return 'Zero Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
    'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function lt100(x: number): string {
    if (x < 20) return ones[x];
    return tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : '');
  }
  function lt1000(x: number): string {
    if (x < 100) return lt100(x);
    return ones[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' + lt100(x % 100) : '');
  }

  const crore = Math.floor(n / 10_000_000); n %= 10_000_000;
  const lakh  = Math.floor(n / 100_000);    n %= 100_000;
  const thou  = Math.floor(n / 1_000);      n %= 1_000;

  let result = '';
  if (crore)  result += lt1000(crore) + ' Crore ';
  if (lakh)   result += lt1000(lakh)  + ' Lakh ';
  if (thou)   result += lt1000(thou)  + ' Thousand ';
  if (n)      result += lt1000(n);
  return result.trim() + ' Only';
}

// ── Page constants (A4 in mm) ─────────────────────────────────────────────────

export const PAGE_W   = 210;
export const PAGE_H   = 297;
export const MARGIN   = 14;   // left & right
export const CONTENT  = PAGE_W - MARGIN * 2;  // 182mm
export const RIGHT    = PAGE_W - MARGIN;       // right edge

// ── Colors ────────────────────────────────────────────────────────────────────

export const C = {
  black:   [0,   0,   0]   as [number, number, number],
  dark:    [17,  24,  39]  as [number, number, number],  // #111827
  mid:     [55,  65,  81]  as [number, number, number],  // #374151
  muted:   [107, 114, 128] as [number, number, number],  // #6B7280
  light:   [156, 163, 175] as [number, number, number],  // #9CA3AF
  border:  [229, 231, 235] as [number, number, number],  // #E5E7EB
  accent:  [200, 96,  58]  as [number, number, number],  // #C8603A
  success: [22,  163, 74]  as [number, number, number],  // #16A34A
  warning: [217, 119, 6]   as [number, number, number],  // #D97706
  bg:      [249, 250, 251] as [number, number, number],  // #F9FAFB
  white:   [255, 255, 255] as [number, number, number],
};

// ── Primitives ────────────────────────────────────────────────────────────────

export function setColor(doc: jsPDF, color: [number, number, number]) {
  doc.setTextColor(color[0], color[1], color[2]);
}

export function setDraw(doc: jsPDF, color: [number, number, number]) {
  doc.setDrawColor(color[0], color[1], color[2]);
}

export function setFill(doc: jsPDF, color: [number, number, number]) {
  doc.setFillColor(color[0], color[1], color[2]);
}

/** Thin 0.2pt horizontal rule */
export function drawRule(doc: jsPDF, y: number, thick = false) {
  setDraw(doc, thick ? C.dark : C.border);
  doc.setLineWidth(thick ? 0.5 : 0.2);
  doc.line(MARGIN, y, RIGHT, y);
}

/** Terracotta diamond logo mark */
export function drawLogoMark(doc: jsPDF, x: number, y: number) {
  const s = 2.8;
  setFill(doc, C.accent);
  doc.saveGraphicsState();
  // jsPDF doesn't support CSS transforms — draw rotated square via polygon
  doc.triangle(x, y - s, x + s, y, x, y + s, 'F');
  doc.triangle(x, y - s, x - s, y, x, y + s, 'F');
  doc.restoreGraphicsState();
}

/** Section label — 6pt uppercase muted */
export function sectionLabel(doc: jsPDF, text: string, x: number, y: number) {
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  setColor(doc, C.muted);
  doc.text(text.toUpperCase(), x, y, { charSpace: 0.6 });
}

/** Value text — 9pt dark */
export function valueText(
  doc: jsPDF, text: string, x: number, y: number,
  opts?: { bold?: boolean; size?: number; color?: [number, number, number]; align?: 'left' | 'right' | 'center' }
) {
  doc.setFontSize(opts?.size ?? 9);
  doc.setFont('helvetica', opts?.bold ? 'bold' : 'normal');
  setColor(doc, opts?.color ?? C.dark);
  doc.text(text, x, y, { align: opts?.align });
}

/** Monospace amount — right-aligned at x */
export function amountText(doc: jsPDF, amount: number, x: number, y: number, opts?: { size?: number; bold?: boolean }) {
  doc.setFontSize(opts?.size ?? 9);
  doc.setFont('courier', opts?.bold ? 'bold' : 'normal');
  setColor(doc, C.dark);
  doc.text(fmtRupee(amount), x, y, { align: 'right' });
}

/** Standard document header — returns y after header */
export function drawHeader(
  doc: jsPDF,
  rightLabel: string,
  rightSub?: string,
): number {
  let y = 16;

  // Logo mark
  drawLogoMark(doc, MARGIN + 2, y - 1);

  // Company name
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  setColor(doc, C.dark);
  doc.text('BRIKLAY ENGINEERING', MARGIN + 7, y);

  // Right label
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  setColor(doc, C.dark);
  doc.text(rightLabel, RIGHT, y, { align: 'right' });

  y += 5;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  setColor(doc, C.muted);
  doc.text('Kakinada, Andhra Pradesh', MARGIN + 7, y);

  if (rightSub) {
    doc.setFontSize(7.5);
    setColor(doc, C.muted);
    doc.text(rightSub, RIGHT, y, { align: 'right' });
  }

  y += 8;
  drawRule(doc, y, true);
  return y + 6;
}

/** Two-column data pair block — returns new y */
export function dataPair(
  doc: jsPDF,
  leftLabel: string, leftVal: string, leftSub: string | null,
  rightLabel: string | null, rightVal: string | null, rightSub: string | null,
  y: number,
): number {
  const startY = y;
  sectionLabel(doc, leftLabel, MARGIN, y);
  y += 4;
  valueText(doc, leftVal, MARGIN, y, { bold: true, size: 10 });
  y += 4.5;
  if (leftSub) {
    valueText(doc, leftSub, MARGIN, y, { color: C.muted, size: 8 });
    y += 4;
  }
  if (rightLabel && rightVal) {
    const rx = MARGIN + CONTENT / 2;
    let ry = startY;
    sectionLabel(doc, rightLabel, rx, ry);
    ry += 4;
    valueText(doc, rightVal, rx, ry, { bold: true, size: 10 });
    ry += 4.5;
    if (rightSub) {
      valueText(doc, rightSub, rx, ry, { color: C.muted, size: 8 });
    }
  }
  return y + 4;
}

/** Footer with generated-by line — call at fixed bottom y */
export function drawFooter(doc: jsPDF, generatedAt?: Date) {
  const y = PAGE_H - 10;
  drawRule(doc, y - 4);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  setColor(doc, C.light);
  const ts = (generatedAt ?? new Date()).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  doc.text(`Computer-generated document  ·  Briklay Flow  ·  Generated ${ts}`, MARGIN, y);
}

/** Two signature lines at bottom — returns start y needed */
export function drawSignatures(doc: jsPDF, y: number, leftLabel: string, leftSub?: string) {
  const lineLen = 55;
  const rightX = RIGHT - lineLen;

  drawRule(doc, y);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  setColor(doc, C.muted);
  doc.line(MARGIN, y, MARGIN + lineLen, y);
  doc.text(leftLabel, MARGIN, y + 4);
  if (leftSub) { setColor(doc, C.light); doc.text(leftSub, MARGIN, y + 8); }

  doc.line(rightX, y, RIGHT, y);
  setColor(doc, C.muted);
  doc.text('Authorised Signatory', rightX, y + 4);
  setColor(doc, C.light);
  doc.text('Briklay Engineering', rightX, y + 8);
}
