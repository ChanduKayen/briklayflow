/**
 * poPdf — the ONE builder for the printable/signed Purchase Order PDF.
 *
 * Ported verbatim from PurchaseOrderDetail's handleDownloadPDF so the file the vendor receives
 * over WhatsApp is byte-for-byte the same document the team downloads. Fetches the PO + line
 * items by id (so it works from anywhere — the detail page AND the post-create ceremony, which
 * doesn't have the row loaded), builds the jsPDF doc, and returns it. Callers then `.save()`
 * (download) or `.output('datauristring')` (upload / send).
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from './supabase';
import {
  fmtDate as pdfFmtDate, fmtRupee, amountInWords,
  MARGIN, CONTENT, RIGHT, C,
  setColor, drawRule, sectionLabel, valueText, drawHeader, drawFooter, drawSignatures,
} from './pdfHelpers';

/** Fetch the PO (+ vendor + project) and its line items, then build the PDF doc. */
export async function buildPoPdfDoc(poId: string): Promise<jsPDF> {
  const [{ data: po, error: poErr }, { data: lineItems, error: liErr }] = await Promise.all([
    supabase
      .from('purchase_orders')
      .select('*, projects(name, site_location), stakeholders(name, category, gstin)')
      .eq('po_id', poId)
      .single(),
    supabase.from('po_line_items').select('*').eq('po_id', poId).order('line_number'),
  ]);
  if (poErr) throw poErr;
  if (liErr) throw liErr;
  if (!po) throw new Error('Purchase order not found');
  return renderPoPdf(po as any, (lineItems as any[]) ?? []);
}

/** Build the PDF and return it as a data-URI base64 string (no data: prefix), for upload/send. */
export async function buildPoPdfBase64(poId: string): Promise<string> {
  const doc = await buildPoPdfDoc(poId);
  const dataUri = doc.output('datauristring'); // "data:application/pdf;filename=...;base64,XXXX"
  return dataUri.substring(dataUri.indexOf('base64,') + 'base64,'.length);
}

/** The layout — kept identical to the detail page's download so there's one PO PDF. */
export function renderPoPdf(po: any, lineItems: any[]): jsPDF {
  const doc = new jsPDF('p', 'mm', 'a4');
  const vendor  = po.stakeholders;
  const project = po.projects;

  // ── Header ──
  let y = drawHeader(doc, 'PURCHASE ORDER', `${po.po_id}  ·  ${pdfFmtDate(po.date_issued)}`);

  // ── Vendor + Project block ──
  const rx = MARGIN + CONTENT / 2;
  sectionLabel(doc, 'VENDOR', MARGIN, y);
  sectionLabel(doc, 'PROJECT', rx, y);
  y += 4;
  valueText(doc, vendor?.name ?? '—', MARGIN, y, { bold: true, size: 10 });
  valueText(doc, project?.name ?? '—', rx, y, { bold: true, size: 10 });
  y += 5;
  if (vendor?.category) valueText(doc, vendor.category + (vendor.gstin ? ' · MSME' : ''), MARGIN, y, { color: C.muted, size: 8 });
  if (project?.site_location) valueText(doc, project.site_location, rx, y, { color: C.muted, size: 8 });
  y += 4.5;
  if (vendor?.gstin) valueText(doc, `GSTIN: ${vendor.gstin}`, MARGIN, y, { color: C.muted, size: 8 });
  y += 4;
  if (po.expected_delivery) { valueText(doc, `Expected Delivery: ${pdfFmtDate(po.expected_delivery)}`, MARGIN, y, { size: 8, color: C.mid }); y += 4; }
  if (po.ordered_by) { valueText(doc, `Ordered by: ${po.ordered_by}`, MARGIN, y, { size: 8, color: C.mid }); y += 4; }
  y += 4;

  drawRule(doc, y);
  y += 7;

  // ── Line items table ──
  sectionLabel(doc, 'ITEMS ORDERED', MARGIN, y);
  y += 4;

  const itemRows = lineItems?.length
    ? lineItems.map((li: any, i: number) => [
        String(li.line_number ?? i + 1),
        li.item_name + (li.specification ? `\n${li.specification}` : ''),
        li.unit ?? '',
        String(li.quantity_ordered ?? ''),
        fmtRupee(Number(li.unit_rate) || 0),
        fmtRupee(Number(li.total_amount) || 0),
      ])
    : (po.items || []).map((it: any, i: number) => [
        String(i + 1),
        it.description ?? '',
        it.unit ?? 'LS',
        String(it.qty ?? ''),
        fmtRupee(Number(it.rate) || 0),
        fmtRupee(Number(it.amount) || 0),
      ]);

  const orderValueNum = Number(po.order_value) || 0;
  const gstValueNum   = Number(po.gst_value)   || 0;
  const totalValueNum = Number(po.total_value || po.order_value) || 0;

  autoTable(doc, {
    startY: y,
    head: [['#', 'Item Description', 'Unit', 'Qty', 'Rate (Rs.)', 'Amount (Rs.)']],
    body: itemRows,
    theme: 'plain',
    columnStyles: {
      0: { cellWidth: 8,  halign: 'center', font: 'courier', fontSize: 7.5 },
      1: { cellWidth: 84, font: 'helvetica' },
      2: { cellWidth: 18, halign: 'center', font: 'helvetica' },
      3: { cellWidth: 14, halign: 'right',  font: 'courier' },
      4: { cellWidth: 29, halign: 'right',  font: 'courier' },
      5: { cellWidth: 29, halign: 'right',  font: 'courier', fontStyle: 'bold' },
    },
    headStyles: {
      fillColor: C.bg, textColor: C.muted as any,
      fontStyle: 'bold', fontSize: 7,
      cellPadding: { top: 2, bottom: 2, left: 2, right: 2 },
    },
    bodyStyles: { fontSize: 8.5, cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 } },
    alternateRowStyles: { fillColor: C.bg },
    margin: { left: MARGIN, right: MARGIN },
  });

  y = (doc as any).lastAutoTable.finalY + 5;

  // ── Totals block ──
  const totX = RIGHT - 90;
  const totRows: [string, number, boolean][] = [
    ['Order Value', orderValueNum, false],
    ...(gstValueNum > 0 ? [['GST', gstValueNum, false] as [string, number, boolean]] : []),
    ['TOTAL', totalValueNum, true],
  ];
  totRows.forEach(([label, val, bold]) => {
    doc.setFontSize(bold ? 10 : 8.5);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    setColor(doc, bold ? C.dark : C.muted);
    doc.text(label as string, totX, y);
    doc.setFont('courier', bold ? 'bold' : 'normal');
    doc.text(fmtRupee(val as number), RIGHT, y, { align: 'right' });
    if (bold) drawRule(doc, y - 4);
    y += bold ? 6 : 5;
  });

  // ── Amount in words ──
  y += 3;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  setColor(doc, C.mid);
  const wordLines = doc.splitTextToSize(`Rupees ${amountInWords(totalValueNum)}`, CONTENT);
  doc.text(wordLines, MARGIN, y);
  y += wordLines.length * 4 + 6;

  // ── Terms ──
  const termsToShow = po.vendor_notes || [
    '1. Delivery as per approved specifications and schedule.',
    '2. Rejected or damaged materials to be returned at vendor cost.',
    '3. Payment within 30 days of GRN acceptance and bill submission.',
    '4. Any price variation requires written approval before supply.',
  ].join('\n');
  drawRule(doc, y);
  y += 6;
  sectionLabel(doc, 'TERMS', MARGIN, y);
  y += 5;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  setColor(doc, C.mid);
  const termLines = doc.splitTextToSize(String(termsToShow).substring(0, 400), CONTENT);
  doc.text(termLines, MARGIN, y);
  y += termLines.length * 4 + 8;

  // ── Signatures + footer ──
  drawRule(doc, y);
  y += 8;
  drawSignatures(doc, y, 'Vendor Acknowledgement', vendor?.name);
  drawFooter(doc);

  return doc;
}
