import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface GRNChallanData {
  grn_id:        string;
  po_id:         string;
  vendor_name:   string;
  project_name:  string;
  receipt_date:  string;
  dc_number?:    string | null;
  vehicle_number?: string | null;
  driver_name?:  string | null;
  remarks?:      string | null;
  items: Array<{
    item_name:    string;
    unit:         string;
    qty_ordered:  number;
    qty_received: number;
    unit_rate?:   number | null;
    condition:    string;
    remarks?:     string | null;
  }>;
}

function fmtDate(d: string) {
  try {
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return d; }
}

export function downloadGRNChallan(data: GRNChallanData) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const MARGIN = 14;
  const CONTENT = W - MARGIN * 2;

  // ── Header bar ────────────────────────────────────────────────────────────
  doc.setFillColor(11, 28, 48);
  doc.rect(0, 0, W, 28, 'F');

  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('GOODS RECEIPT NOTE', MARGIN, 12);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 200, 220);
  doc.text('Material Receipt Acknowledgement', MARGIN, 19);

  // GRN ID on right
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(data.grn_id, W - MARGIN, 12, { align: 'right' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 200, 220);
  doc.text(fmtDate(data.receipt_date), W - MARGIN, 19, { align: 'right' });

  // ── Info grid ─────────────────────────────────────────────────────────────
  let y = 36;

  const fields: [string, string][] = [
    ['PO Reference',   data.po_id],
    ['Vendor',         data.vendor_name],
    ['Project',        data.project_name],
    ['Receipt Date',   fmtDate(data.receipt_date)],
    ['DC Number',      data.dc_number    || '—'],
    ['Vehicle',        data.vehicle_number || '—'],
    ['Driver',         data.driver_name  || '—'],
  ];

  const colW = (CONTENT - 4) / 2;
  const leftFields  = fields.slice(0, Math.ceil(fields.length / 2));
  const rightFields = fields.slice(Math.ceil(fields.length / 2));

  const drawField = (label: string, value: string, x: number, yy: number) => {
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 130, 145);
    doc.text(label.toUpperCase(), x, yy);
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(11, 28, 48);
    doc.text(value, x, yy + 5);
  };

  leftFields.forEach((f, i) => drawField(f[0], f[1], MARGIN, y + i * 14));
  rightFields.forEach((f, i) => drawField(f[0], f[1], MARGIN + colW + 4, y + i * 14));

  y += Math.ceil(fields.length / 2) * 14 + 6;

  // Divider
  doc.setDrawColor(220, 225, 235);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, W - MARGIN, y);
  y += 6;

  // ── Items table ───────────────────────────────────────────────────────────
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(11, 28, 48);
  doc.text('ITEMS RECEIVED', MARGIN, y);
  y += 4;

  const totalValue = data.items.reduce(
    (s, i) => s + i.qty_received * (i.unit_rate ?? 0), 0
  );

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [['#', 'Item', 'Unit', 'Ordered', 'Received', 'Rate', 'Value', 'Condition']],
    body: data.items.map((item, i) => [
      String(i + 1),
      item.item_name + (item.remarks ? `\n(${item.remarks})` : ''),
      item.unit,
      String(item.qty_ordered),
      String(item.qty_received),
      item.unit_rate ? `₹${item.unit_rate.toLocaleString('en-IN')}` : '—',
      item.unit_rate ? `₹${(item.qty_received * item.unit_rate).toLocaleString('en-IN')}` : '—',
      item.condition.charAt(0).toUpperCase() + item.condition.slice(1),
    ]),
    foot: totalValue > 0 ? [['', '', '', '', '', 'Total', `₹${totalValue.toLocaleString('en-IN')}`, '']] : undefined,
    styles: { fontSize: 8, cellPadding: 3, textColor: [11, 28, 48] },
    headStyles: { fillColor: [11, 28, 48], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
    footStyles: { fillColor: [240, 244, 255], fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 8 },
      2: { cellWidth: 14 },
      3: { halign: 'right', cellWidth: 18 },
      4: { halign: 'right', cellWidth: 18 },
      5: { halign: 'right', cellWidth: 22 },
      6: { halign: 'right', cellWidth: 24 },
      7: { cellWidth: 20 },
    },
    alternateRowStyles: { fillColor: [248, 250, 254] },
  });

  const finalY = (doc as any).lastAutoTable.finalY + 10;

  // ── Remarks ───────────────────────────────────────────────────────────────
  if (data.remarks) {
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 110, 125);
    doc.text('REMARKS', MARGIN, finalY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(11, 28, 48);
    doc.text(data.remarks, MARGIN, finalY + 5, { maxWidth: CONTENT });
  }

  // ── Signature boxes ───────────────────────────────────────────────────────
  const sigY = Math.max(finalY + (data.remarks ? 18 : 4), 240);
  const sigW  = (CONTENT - 16) / 3;

  ['Received By', 'Checked By', 'Authorized By'].forEach((label, i) => {
    const x = MARGIN + i * (sigW + 8);
    doc.setDrawColor(200, 210, 225);
    doc.setLineWidth(0.3);
    doc.line(x, sigY + 14, x + sigW, sigY + 14);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 115, 130);
    doc.text(label.toUpperCase(), x, sigY + 19);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(150, 160, 175);
    doc.text('Name / Designation', x, sigY + 24);
  });

  // ── Footer ────────────────────────────────────────────────────────────────
  doc.setFillColor(240, 243, 248);
  doc.rect(0, 287, W, 10, 'F');
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(130, 145, 165);
  doc.text(`GRN: ${data.grn_id}  ·  PO: ${data.po_id}  ·  Generated by Briklay`, W / 2, 293, { align: 'center' });

  doc.save(`${data.grn_id}.pdf`);
}
