/**
 * ledgerStatementPdf — a formal "Statement of Account" for one party's ledger, in the house PDF
 * style (shares pdfHelpers with the PO/GRN documents). Reads the already-loaded PartyLedger so it
 * ties exactly to what the party page shows. Debit/Credit accounting layout with a running balance,
 * a KPI summary band, and repeated page chrome — the shape a professional accounting system emits.
 *
 * Convention (a creditor/supplier ledger, from OUR books):
 *   · Credit (Billed)  — a bill / certified work raises what we owe the party.
 *   · Debit  (Paid)    — a payment we make lowers it.
 *   · Balance          — running (billed − paid): a positive is payable (Cr), a negative is advance (Dr).
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { PartyLedger, LedgerEntry } from './partyLedgerApi';
import {
  fmtRupee, fmtDate, amountInWords,
  PAGE_H, MARGIN, CONTENT, RIGHT, C,
  setColor, setDraw, setFill, drawRule, drawHeader, drawFooter, sectionLabel, valueText,
} from './pdfHelpers';

const money = (n: number) => (Math.abs(n) < 0.5 ? '' : fmtRupee(Math.round(n)));
/** A balance with its Dr/Cr sense: +payable → Cr, −advance → Dr. */
const balStr = (payable: number) =>
  Math.abs(payable) < 0.5 ? 'Rs. 0' : `${fmtRupee(Math.abs(Math.round(payable)))} ${payable > 0 ? 'Cr' : 'Dr'}`;

/** Oldest-first, with the opening/start seed pinned to the very top. */
function ordered(entries: LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort((a, b) => {
    const seed = (e: LedgerEntry) => (e.kind === 'start' ? 0 : e.kind === 'opening' ? 1 : 2);
    return seed(a) - seed(b) || (a.date || '').localeCompare(b.date || '');
  });
}

/** Build the Statement of Account PDF for a party and return the jsPDF doc. */
export function buildPartyStatementDoc(L: PartyLedger): jsPDF {
  const doc = new jsPDF('p', 'mm', 'a4');
  const today = new Date();
  const rows = ordered(L.entries);
  const firstDated = rows.find(e => e.date)?.date ?? null;

  // ── Letterhead ──
  let y = drawHeader(doc, 'STATEMENT OF ACCOUNT', `As on ${fmtDate(today)}`);

  // ── Account + statement meta ──
  const rx = MARGIN + CONTENT / 2;
  sectionLabel(doc, 'ACCOUNT', MARGIN, y);
  sectionLabel(doc, 'STATEMENT DETAILS', rx, y);
  y += 4.5;
  valueText(doc, L.stakeholder.name, MARGIN, y, { bold: true, size: 11 });
  valueText(doc, `Period:  ${firstDated ? fmtDate(firstDated) : '—'}  to  ${fmtDate(today)}`, rx, y, { size: 8.5, color: C.mid });
  y += 5;
  const kind = [L.stakeholder.category, L.stakeholder.type].filter(Boolean).join(' · ') || (L.kind === 'vendor' ? 'Vendor' : 'Worker');
  valueText(doc, kind, MARGIN, y, { color: C.muted, size: 8 });
  valueText(doc, 'Currency:  INR (Rs.)', rx, y, { size: 8, color: C.muted });
  y += 4.5;
  valueText(doc, `Account ID:  ${L.stakeholder.id}`, MARGIN, y, { color: C.muted, size: 8 });
  y += 8;

  // ── Summary band — four bordered KPI cells ──
  const openingSigned = L.opening ? (L.opening.direction === 'work_owed' ? L.opening.total : -L.opening.total) : 0; // + = payable
  const closingPayable = L.totalCert - L.totalPaid;
  const closeLabel = closingPayable > 0.5 ? 'AMOUNT PAYABLE' : closingPayable < -0.5 ? 'ADVANCE WITH PARTY' : 'BALANCE';
  const boxGap = 3.5, boxW = (CONTENT - boxGap * 3) / 4, boxH = 18;
  const cells: { label: string; val: string; accent?: boolean }[] = [
    { label: 'OPENING BALANCE', val: balStr(openingSigned) },
    { label: 'TOTAL BILLED', val: fmtRupee(Math.round(L.totalCert)) },
    { label: 'TOTAL PAID', val: fmtRupee(Math.round(L.totalPaid)) },
    { label: closeLabel, val: fmtRupee(Math.abs(Math.round(closingPayable))), accent: closingPayable > 0.5 },
  ];
  cells.forEach((cel, i) => {
    const x = MARGIN + i * (boxW + boxGap);
    if (cel.accent) { setFill(doc, [250, 241, 236]); setDraw(doc, C.accent); doc.setLineWidth(0.4); doc.roundedRect(x, y, boxW, boxH, 1.6, 1.6, 'FD'); }
    else { setDraw(doc, C.border); doc.setLineWidth(0.3); doc.roundedRect(x, y, boxW, boxH, 1.6, 1.6, 'S'); }
    doc.setFontSize(6); doc.setFont('helvetica', 'bold'); setColor(doc, cel.accent ? C.accent : C.muted);
    doc.text(cel.label, x + 4, y + 6, { charSpace: 0.3, maxWidth: boxW - 7 });
    doc.setFontSize(11.5); doc.setFont('courier', 'bold'); setColor(doc, cel.accent ? C.accent : C.dark);
    doc.text(cel.val, x + 4, y + 13.5);
  });
  y += boxH + 8;

  // ── The ledger table — Tally shape: To/By CONTRA narration (never our internal remarks, since this
  //    is shared with the party), a voucher type + number, Debit / Credit, and a running Dr/Cr Balance ──
  const vchType = (e: LedgerEntry) =>
    e.kind === 'payment' ? 'Payment'
      : (e.kind === 'bill' || e.kind === 'consolidated') ? 'Purchase'
      : e.kind === 'wage' ? 'Wages'
      : e.kind === 'certified' ? 'Measurement'
      : (e.kind === 'opening' || e.kind === 'start') ? 'Op. Bal.'
      : 'Journal';
  const vchNo = (e: LedgerEntry) => e.contractId || (e.kind === 'bill' ? e.id.replace(/^bill-/, '') : '—');
  const particularsOf = (e: LedgerEntry) => {
    if (e.kind === 'opening' || e.kind === 'start') return 'Opening Balance b/f';
    if ((e.paid || 0) > 0) { const m = (e.mode || '').trim(); return !m ? 'To Bank / Cash' : /cash/i.test(m) ? 'To Cash' : `To Bank (${m})`; }
    if (e.kind === 'consolidated') return 'By Purchases (Consolidated)';
    if (e.kind === 'wage') return 'By Wages (Attendance)';
    if (e.kind === 'certified') return 'By Work Certified';
    if (e.kind === 'adjustment') return 'By Adjustment';
    return 'By Purchases';
  };

  let run = 0, sumPaid = 0, sumBilled = 0;
  const body = rows.map((e) => {
    run += (e.cert || 0) - (e.paid || 0);
    sumPaid += e.paid || 0; sumBilled += e.cert || 0;
    return [fmtDate(e.date), particularsOf(e), vchType(e), vchNo(e), money(e.paid || 0), money(e.cert || 0), balStr(run)];
  });

  autoTable(doc, {
    startY: y,
    head: [['Date', 'Particulars', 'Vch Type', 'Vch No', 'Debit', 'Credit', 'Balance']],
    body,
    foot: [['', 'Closing balance', '', '', fmtRupee(Math.round(sumPaid)), fmtRupee(Math.round(sumBilled)), balStr(run)]],
    theme: 'plain',
    columnStyles: {
      0: { cellWidth: 16, font: 'helvetica', fontSize: 8 },
      1: { cellWidth: 40, font: 'helvetica' },
      2: { cellWidth: 18, font: 'helvetica', fontSize: 7.5, textColor: C.muted as any },
      3: { cellWidth: 28, font: 'courier', fontSize: 7, textColor: C.muted as any },
      4: { cellWidth: 20, halign: 'right', font: 'courier', fontSize: 7.5 },
      5: { cellWidth: 20, halign: 'right', font: 'courier', fontSize: 7.5 },
      6: { cellWidth: 40, halign: 'right', font: 'courier', fontSize: 7.5, fontStyle: 'bold' },
    },
    headStyles: { fillColor: C.dark as any, textColor: C.white as any, fontStyle: 'bold', fontSize: 7, cellPadding: { top: 2.4, bottom: 2.4, left: 2.5, right: 2.5 } },
    bodyStyles: { fontSize: 8, textColor: C.dark as any, cellPadding: { top: 2.4, bottom: 2.4, left: 2.5, right: 2.5 }, lineColor: C.border as any, lineWidth: { bottom: 0.15 } as any },
    footStyles: { fillColor: C.bg as any, textColor: C.dark as any, fontStyle: 'bold', fontSize: 8.5, cellPadding: { top: 3, bottom: 3, left: 2.5, right: 2.5 }, lineColor: C.dark as any, lineWidth: { top: 0.4 } as any },
    alternateRowStyles: { fillColor: [252, 251, 249] as any },
    margin: { top: 20, left: MARGIN, right: MARGIN, bottom: 16 },
    didDrawPage: (data) => {
      if ((data.pageNumber ?? 1) > 1) {
        doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); setColor(doc, C.muted);
        doc.text(`STATEMENT OF ACCOUNT  ·  ${L.stakeholder.name}`, MARGIN, 12, { charSpace: 0.3 });
        drawRule(doc, 15);
      }
      drawFooter(doc);
      doc.setFontSize(7); doc.setFont('helvetica', 'normal'); setColor(doc, C.light);
      doc.text(`Page ${data.pageNumber ?? 1}`, RIGHT, PAGE_H - 10, { align: 'right' });
    },
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // ── Closing callout + amount in words ──
  if (y > PAGE_H - 42) { doc.addPage(); y = 24; }
  const closeAmt = Math.abs(Math.round(closingPayable));
  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); setColor(doc, C.dark);
  const lead = closingPayable > 0.5 ? 'Amount payable by us' : closingPayable < -0.5 ? 'Advance held with the party' : 'Account settled';
  doc.text(lead, MARGIN, y);
  doc.setFont('courier', 'bold'); setColor(doc, closingPayable > 0.5 ? C.accent : C.dark);
  doc.text(balStr(closingPayable), RIGHT, y, { align: 'right' });
  y += 5;
  if (closeAmt >= 1) {
    doc.setFontSize(8); doc.setFont('helvetica', 'italic'); setColor(doc, C.mid);
    const words = doc.splitTextToSize(`Rupees ${amountInWords(closeAmt)}`, CONTENT);
    doc.text(words, MARGIN, y); y += words.length * 4 + 3;
  }

  // ── Legend + note ──
  drawRule(doc, y); y += 5;
  doc.setFontSize(7); doc.setFont('helvetica', 'normal'); setColor(doc, C.muted);
  doc.text('Dr = advance paid to the party    ·    Cr = amount payable by us', MARGIN, y); y += 4;
  setColor(doc, C.light);
  doc.text('This is a computer-generated statement and does not require a signature. Figures reflect the ledger as on the statement date.', MARGIN, y, { maxWidth: CONTENT });

  return doc;
}

/** Download the statement PDF for a party. */
export function downloadPartyStatement(L: PartyLedger): void {
  const doc = buildPartyStatementDoc(L);
  const safe = L.stakeholder.name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'party';
  const d = new Date().toISOString().slice(0, 10);
  doc.save(`Statement-${safe}-${d}.pdf`);
}
