import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { billDateOf, BILL_DATE_COLUMNS } from '../lib/partyLedger';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import { usePeek } from '../context/PeekContextCore';
import { StarDisplay } from './Stakeholders';
import { QuickTransactionSheet } from '../components/QuickTransactionSheet';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  fmtRupee, fmtDate as pdfFmtDate,
  MARGIN, CONTENT, RIGHT, C,
  setColor, setDraw, drawRule, sectionLabel, valueText, drawFooter, drawSignatures
} from '../lib/pdfHelpers';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
}

function fmt(n: number) {
  return Math.abs(n).toLocaleString('en-IN');
}

function formatLedgerDate(dateStr: string): string {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.getTime() === today.getTime()) return 'Today';
  if (d.getTime() === yesterday.getTime()) return 'Yesterday';
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-IN', opts);
}

function monthKey(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthHeading(key: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1)
    .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    .toUpperCase();
}

type DateFilter = 'all' | 'month' | '3m' | 'fy';

// ─── Star rating input ────────────────────────────────────────────────────────

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button"
          onMouseEnter={() => setHovered(n)} onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(value === n ? 0 : n)}
          className="p-0.5 transition-transform hover:scale-110">
          <span className="material-symbols-outlined text-[24px]" style={{
            color: (hovered || value) >= n ? '#f59e0b' : '#d1d5db',
            fontVariationSettings: (hovered || value) >= n ? "'FILL' 1" : "'FILL' 0",
          }}>star</span>
        </button>
      ))}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StakeholderDetail({ session }: { session: Session }) {
  const { stakeholderId } = useParams<{ stakeholderId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: profile } = useUserProfile(session.user.id);
  const canManage = profile?.role === 'management' || profile?.role === 'accountant' || profile?.role === 'principal';

  // ─── UI state ───────────────────────────────────────────────────────────

  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [showWOs, setShowWOs] = useState(false);
  const [sortByDate, setSortByDate] = useState(false);
  const [showTxnSheet, setShowTxnSheet] = useState(false);
  const { openPeek } = usePeek();

  // Rating modal
  const [showRateModal, setShowRateModal] = useState(false);
  const [rateOverall, setRateOverall]   = useState(0);
  const [rateDelivery, setRateDelivery] = useState(0);
  const [rateQuality, setRateQuality]   = useState(0);
  const [ratePricing, setRatePricing]   = useState(0);
  const [showRateSubcats, setShowRateSubcats] = useState(false);

  // ─── Queries ────────────────────────────────────────────────────────────

  const { data: stk, isLoading: stkLoading } = useQuery({
    queryKey: ['stakeholder', stakeholderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stakeholders').select('*')
        .eq('stakeholder_id', stakeholderId!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!stakeholderId,
  });

  const { data: txns, isLoading: txnsLoading } = useQuery({
    queryKey: ['stakeholder_txns', stakeholderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*, txn_allocations(project_id, order_type, order_ref, allocated_amount, projects(name))')
        .eq('stakeholder_id', stakeholderId!)
        .order('date', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!stakeholderId,
  });

  const { data: workOrders, isLoading: wosLoading } = useQuery({
    queryKey: ['stakeholder_wos', stakeholderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_orders')
        .select('*, projects(name)')
        .eq('stakeholder_id', stakeholderId!)
        .order('date_issued', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!stakeholderId,
  });

  const { data: stakeholderPOs } = useQuery({
    queryKey: ['stakeholder_po_bills', stakeholderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`po_id, vendor_bill_number, vendor_bill_no, ${BILL_DATE_COLUMNS}`)
        .eq('stakeholder_id', stakeholderId!)
        .not('vendor_bill_amount', 'is', null)
        .gt('vendor_bill_amount', 0);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!stakeholderId,
  });

  // ─── Rating mutation ─────────────────────────────────────────────────────

  const updateRating = useMutation({
    mutationFn: async () => {
      const payload: any = { rating: rateOverall || null };
      payload.rating_delivery = rateDelivery > 0 ? rateDelivery : null;
      payload.rating_quality  = rateQuality  > 0 ? rateQuality  : null;
      payload.rating_pricing  = ratePricing  > 0 ? ratePricing  : null;
      const { error } = await supabase.from('stakeholders').update(payload).eq('stakeholder_id', stakeholderId!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stakeholder', stakeholderId] });
      qc.invalidateQueries({ queryKey: ['stakeholders'] });
      setShowRateModal(false);
    },
  });

  // ─── Derived data ────────────────────────────────────────────────────────

  const stkType: string = stk?.type || 'Vendor'; // 'Vendor' | 'Worker' | 'Client'
  const activeTxns = (txns || []).filter((t: any) => t.status !== 'Voided');

  const phones = (stk?.contact || '').split(/[,;/]/).map((s: string) => s.trim()).filter(Boolean);

  const openRateModal = () => {
    setRateOverall(stk?.rating || 0);
    setRateDelivery(stk?.rating_delivery || 0);
    setRateQuality(stk?.rating_quality || 0);
    setRatePricing(stk?.rating_pricing || 0);
    setShowRateSubcats(!!(stk?.rating_delivery || stk?.rating_quality || stk?.rating_pricing));
    setShowRateModal(true);
  };

  const handleDownloadPDF = () => {
    if (!stk) return;
    const doc = new jsPDF('p', 'mm', 'a4');

    // 1. Header with branding
    let y = 16;
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); setColor(doc, C.dark);
    doc.text('BRIKLAY ENGINEERING', MARGIN, y);
    doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); setColor(doc, C.muted);
    doc.text('Kakinada, East Godavari, Andhra Pradesh — 533001', MARGIN, y + 4.5);
    doc.text('GSTIN: XXXXXXXXXXXXXXXXX', MARGIN, y + 9);

    // Right side: Document Title and date
    doc.setFontSize(13); doc.setFont('helvetica', 'bold'); setColor(doc, C.dark);
    doc.text('STATEMENT OF ACCOUNT', RIGHT, y, { align: 'right' });
    doc.setFontSize(8); doc.setFont('courier', 'bold'); setColor(doc, C.accent);
    doc.text(`UID: ${stk.stakeholder_id}`, RIGHT, y + 5, { align: 'right' });
    doc.setFont('helvetica', 'normal'); setColor(doc, C.muted);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`, RIGHT, y + 10, { align: 'right' });

    y += 18;
    setDraw(doc, C.dark);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, y, RIGHT, y);
    y += 8;

    // 2. Party Details & Financial Summary side-by-side
    const rx = MARGIN + CONTENT / 2;
    sectionLabel(doc, 'PARTY DETAILS', MARGIN, y);
    sectionLabel(doc, 'ACCOUNT SUMMARY', rx, y);
    y += 4.5;

    // Party info
    valueText(doc, stk.name, MARGIN, y, { bold: true, size: 10 });
    // Summary values
    valueText(doc, `Type: ${stk.type}`, rx, y, { bold: true, size: 9 });
    y += 5;

    valueText(doc, `Trade/Cat: ${stk.category || '—'}`, MARGIN, y, { color: C.muted, size: 8.5 });
    valueText(doc, `Total Billed/Cr: ${fmtRupee(totalCredit)}`, rx, y, { color: C.muted, size: 8.5 });
    y += 5;

    valueText(doc, `Contact: ${stk.contact || '—'}`, MARGIN, y, { color: C.muted, size: 8.5 });
    valueText(doc, `Total Paid/Dr: ${fmtRupee(totalDebit)}`, rx, y, { color: C.muted, size: 8.5 });
    y += 5;

    if (stk.gstin) {
      valueText(doc, `GSTIN: ${stk.gstin}`, MARGIN, y, { color: C.muted, size: 8.5 });
    } else if (stk.bank_details) {
      const bankVal = stk.bank_details.length > 30 ? stk.bank_details.slice(0, 30) + '...' : stk.bank_details;
      valueText(doc, `Bank/UPI: ${bankVal}`, MARGIN, y, { color: C.muted, size: 8.5 });
    } else {
      valueText(doc, `GSTIN: —`, MARGIN, y, { color: C.muted, size: 8.5 });
    }

    const balText = finalBalance >= 0 ? `${fmtRupee(finalBalance)} (Payable)` : `${fmtRupee(Math.abs(finalBalance))} (Advance)`;
    const balColor = finalBalance >= 0 ? C.accent : C.success;
    valueText(doc, `Net Balance: ${balText}`, rx, y, { bold: true, size: 9.5, color: balColor });
    y += 8;

    drawRule(doc, y, true);
    y += 6;

    // 3. Transactions / Ledger Table
    sectionLabel(doc, 'LEDGER TRANSACTIONS', MARGIN, y);
    y += 6;

    const tableHeaders = ['Date', 'Particulars & Details', 'Ref', 'Project', 'Debit (Dr)', 'Credit (Cr)', 'Balance'];
    
    const pdfRows = [...ledgerRows];
    const tableData = pdfRows.map(row => {
      const rowBalText = row.runningBalance >= 0 ? `${fmtRupee(row.runningBalance)} Cr` : `${fmtRupee(Math.abs(row.runningBalance))} Dr`;
      return [
        pdfFmtDate(row.date),
        { content: `${row.particulars}\n${row.detail || ''}`, styles: { cellPadding: { top: 3, bottom: 3 } } },
        row.ref_number || '—',
        row.project || '—',
        row.debit > 0 ? fmtRupee(row.debit) : '—',
        row.credit > 0 ? fmtRupee(row.credit) : '—',
        rowBalText
      ];
    });

    autoTable(doc, {
      startY: y,
      head: [tableHeaders],
      body: tableData,
      theme: 'plain',
      columnStyles: {
        0: { cellWidth: 20, font: 'helvetica', fontSize: 8 },
        1: { cellWidth: 54, font: 'helvetica', fontSize: 8 },
        2: { cellWidth: 16, font: 'helvetica', fontSize: 8 },
        3: { cellWidth: 28, font: 'helvetica', fontSize: 8 },
        4: { cellWidth: 21, halign: 'right', font: 'courier', fontSize: 8 },
        5: { cellWidth: 21, halign: 'right', font: 'courier', fontSize: 8 },
        6: { cellWidth: 22, halign: 'right', font: 'courier', fontSize: 8, fontStyle: 'bold' }
      },
      headStyles: {
        fillColor: C.bg, textColor: C.muted as any,
        fontStyle: 'bold', fontSize: 7,
        cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 },
      },
      bodyStyles: {
        fontSize: 8, cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 },
      },
      alternateRowStyles: { fillColor: C.bg },
      margin: { left: MARGIN, right: MARGIN },
    });

    let finalY = (doc as any).lastAutoTable.finalY + 12;

    if (finalY > 230) {
      doc.addPage();
      finalY = 24;
    }

    drawSignatures(doc, finalY, 'Verified by Party', stk.name);
    drawFooter(doc);

    doc.save(`Statement_${stk.name.replace(/\s+/g, '_')}_${stk.stakeholder_id}.pdf`);
  };

  // ── Build ledger rows ────────────────────────────────────────────────

  interface LedgerRow {
    id: string;
    date: string;
    particulars: string;
    detail: string | null;
    project: string | null;
    ref_id: string | null;
    ref_number: string | null;
    ref_type: 'PO' | 'WO' | 'INV' | null;
    debit: number;
    credit: number;
    entry_type: 'DEBIT' | 'CREDIT';
    source: string;
    txn_id: string | null;
    txn_link: string | null;
    runningBalance: number;
  }

  const rawRows: Omit<LedgerRow, 'runningBalance'>[] = [];

  if (stkType === 'Vendor') {
    // CREDIT — vendor gave material (bill recorded)
    // The AMOUNT is the gate, not the timestamp: `if (!po.bill_recorded_at) continue` was never a filter,
    // it was this row needing a date. It silently dropped every bill recorded before the timestamp column
    // existed — and with them, this ledger's entire credit side. See billDateOf().
    for (const po of (stakeholderPOs || [])) {
      const billedOn = billDateOf(po);
      if (!billedOn) continue;
      rawRows.push({
        id: `bill-${po.po_id}`,
        date: billedOn,
        particulars: 'By Purchase',
        detail: po.vendor_bill_number || po.vendor_bill_no || null,
        project: null,
        ref_id: po.po_id,
        ref_number: po.po_id,
        ref_type: 'PO',
        debit: 0,
        credit: Number(po.vendor_bill_amount || 0),
        entry_type: 'CREDIT',
        source: 'VENDOR_BILL',
        txn_id: null,
        txn_link: null,
      });
    }
    // DEBIT — you paid vendor
    for (const t of activeTxns) {
      const allocs: any[] = t.txn_allocations || [];
      const project = allocs.length === 1 ? (allocs[0].projects?.name || null) : allocs.length > 1 ? 'Multiple' : null;
      const poAlloc = allocs.find((a: any) => a.order_type === 'PO');
      rawRows.push({
        id: `txn-${t.txn_id}`,
        date: t.date,
        particulars: `To ${t.payment_mode || 'Cash'}`,
        detail: t.category + (t.remarks ? ` — ${t.remarks}` : ''),
        project,
        ref_id: poAlloc?.order_ref || null,
        ref_number: poAlloc?.order_ref || null,
        ref_type: poAlloc ? 'PO' : null,
        debit: Number(t.total_amount || 0),
        credit: 0,
        entry_type: 'DEBIT',
        source: 'PAYMENT',
        txn_id: t.txn_id,
        txn_link: `/ledger/${t.txn_id}`,
      });
    }
  }

  if (stkType === 'Worker') {
    // CREDIT — worker gave labour (milestone certified/paid)
    // NOTE: wo_milestones not yet included in workOrders query — add
    // .select('*, projects(name), wo_milestones(*)') to enable this path
    for (const wo of (workOrders || [])) {
      for (const m of ((wo as any).wo_milestones || [])) {
        if (m.status !== 'PAID') continue;
        rawRows.push({
          id: `ms-${m.milestone_id}`,
          date: m.updated_at || wo.date_issued,
          particulars: 'By Work Done',
          detail: m.name,
          project: wo.projects?.name || null,
          ref_id: wo.wo_id,
          ref_number: wo.wo_id,
          ref_type: 'WO',
          debit: 0,
          credit: Number(m.planned_amount || 0),
          entry_type: 'CREDIT',
          source: 'MILESTONE',
          txn_id: null,
          txn_link: null,
        });
      }
    }
    // DEBIT — you paid worker
    for (const t of activeTxns) {
      const allocs: any[] = t.txn_allocations || [];
      const project = allocs.length === 1 ? (allocs[0].projects?.name || null) : allocs.length > 1 ? 'Multiple' : null;
      const woAlloc = allocs.find((a: any) => a.order_type === 'WO');
      rawRows.push({
        id: `txn-${t.txn_id}`,
        date: t.date,
        particulars: `To ${t.payment_mode || 'Cash'}`,
        detail: t.category + (t.remarks ? ` — ${t.remarks}` : ''),
        project,
        ref_id: woAlloc?.order_ref || null,
        ref_number: woAlloc?.order_ref || null,
        ref_type: woAlloc ? 'WO' : null,
        debit: Number(t.total_amount || 0),
        credit: 0,
        entry_type: 'DEBIT',
        source: 'PAYMENT',
        txn_id: t.txn_id,
        txn_link: `/ledger/${t.txn_id}`,
      });
    }
  }

  if (stkType === 'Client') {
    // DEBIT — client received work (invoices)
    // Note: client invoices would come from a separate query; use activeTxns tagged as receipts for now
    // CREDIT — client paid (receipts = transactions on client account)
    for (const t of activeTxns) {
      const allocs: any[] = t.txn_allocations || [];
      const project = allocs.length === 1 ? (allocs[0].projects?.name || null) : allocs.length > 1 ? 'Multiple' : null;
      rawRows.push({
        id: `txn-${t.txn_id}`,
        date: t.date,
        particulars: `By ${t.payment_mode || 'Cash'}`,
        detail: t.category + (t.remarks ? ` — ${t.remarks}` : ''),
        project,
        ref_id: null,
        ref_number: null,
        ref_type: null,
        debit: 0,
        credit: Number(t.total_amount || 0),
        entry_type: 'CREDIT',
        source: 'RECEIPT',
        txn_id: t.txn_id,
        txn_link: `/ledger/${t.txn_id}`,
      });
    }
  }

  // Apply date filter
  const now2 = new Date();
  const fyStart2 = now2.getMonth() >= 3
    ? new Date(now2.getFullYear(), 3, 1)
    : new Date(now2.getFullYear() - 1, 3, 1);
  const threeMonthsAgo2 = new Date(now2);
  threeMonthsAgo2.setMonth(now2.getMonth() - 3);

  const filterRow = (row: Omit<LedgerRow, 'runningBalance'>) => {
    if (dateFilter === 'all') return true;
    const d = new Date(row.date);
    if (dateFilter === 'month') return d.getFullYear() === now2.getFullYear() && d.getMonth() === now2.getMonth();
    if (dateFilter === '3m') return d >= threeMonthsAgo2;
    if (dateFilter === 'fy') return d >= fyStart2;
    return true;
  };

  const filteredRows = rawRows.filter(filterRow);

  // Sort oldest first for running balance
  filteredRows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Running balance (Credit increases, Debit decreases)
  let runningBal = 0;
  const ledgerRows: LedgerRow[] = filteredRows.map(row => {
    runningBal += row.credit;
    runningBal -= row.debit;
    return { ...row, runningBalance: runningBal };
  });

  // Newest first for display
  const displayRows = [...ledgerRows].reverse();

  // Build PO/WO groups (default view)
  const seenGroupKeys = new Set<string>();
  const groupOrder: string[] = [];
  const poGroupsMap = new Map<string, LedgerRow[]>();
  for (const row of displayRows) {
    const key = row.ref_id || 'unlinked';
    if (!seenGroupKeys.has(key)) { seenGroupKeys.add(key); groupOrder.push(key); }
    if (!poGroupsMap.has(key)) poGroupsMap.set(key, []);
    poGroupsMap.get(key)!.push(row);
  }
  // Unlinked group goes last
  const orderedGroupKeys = [
    ...groupOrder.filter(k => k !== 'unlinked'),
    ...(groupOrder.includes('unlinked') ? ['unlinked'] : []),
  ];

  // Group by month
  const monthGroups = new Map<string, LedgerRow[]>();
  for (const row of displayRows) {
    const key = monthKey(row.date);
    if (!monthGroups.has(key)) monthGroups.set(key, []);
    monthGroups.get(key)!.push(row);
  }

  const totalDebit  = ledgerRows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = ledgerRows.reduce((s, r) => s + r.credit, 0);
  const finalBalance = totalCredit - totalDebit; // Cr positive = payable, Dr negative = advance

  // Summary strip values
  const totalPaid = activeTxns.reduce((s: number, t: any) => s + Number(t.total_amount || 0), 0);
  const totalBilled = (stakeholderPOs || []).reduce((s: number, po: any) => s + Number(po.vendor_bill_amount || 0), 0);
  const totalWOValue = (workOrders || []).reduce((s: number, w: any) => s + Number(w.order_value || 0), 0);

  // Per-WO payment totals (for WO cards in Zone 4)
  const woPayments: Record<string, number> = {};
  for (const t of activeTxns) {
    for (const alloc of (t.txn_allocations || [])) {
      if (alloc.order_type === 'WO' && alloc.order_ref) {
        woPayments[alloc.order_ref] = (woPayments[alloc.order_ref] || 0) + Number(alloc.allocated_amount || 0);
      }
    }
  }

  // FY label for filter chips
  const fyY = fyStart2.getFullYear();

  // ─── Loading / not found ─────────────────────────────────────────────────

  if (stkLoading || txnsLoading) {
    return (
      <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center">
        <div className="text-stone-450 font-bold uppercase tracking-widest text-[11px] animate-pulse">
          Loading Statement…
        </div>
      </div>
    );
  }

  if (!stk) {
    return (
      <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center">
        <div className="text-stone-450 font-semibold text-[11px]">
          Stakeholder not found
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF9F6] px-4 sm:px-6 md:px-8 pt-6 pb-20">
      <div className="max-w-[720px] mx-auto">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 hover:text-stone-700 transition-colors uppercase tracking-wider mb-6"
        >
          <span className="material-symbols-outlined text-[14px]">arrow_back</span>
          Back
        </button>

        {/* ── ZONE 1: IDENTITY ─────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 mt-6 mb-6 flex-wrap sm:flex-nowrap">
          <div className="flex items-center gap-4">
            {/* Premium Ultra-Elegant Monogram Avatar */}
            <div className={`w-14 h-14 rounded-full flex items-center justify-center text-[16px] font-semibold tracking-wider shrink-0 shadow-xs border ${
              stk.type === 'Worker'
                ? 'bg-amber-50/70 text-amber-700 border-amber-250/30'
                : stk.type === 'Client'
                  ? 'bg-indigo-50/70 text-indigo-700 border-indigo-250/30'
                  : 'bg-stone-100/80 text-stone-700 border-stone-200/50'
            }`}>
              {getInitials(stk.name)}
            </div>

            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-[22px] font-bold text-stone-800 leading-tight tracking-tight font-sans">
                  {stk.name}
                </h1>
                <span className="px-2.5 py-0.5 text-[9.5px] font-semibold tracking-wide rounded-full bg-stone-50 border border-stone-200/40 text-stone-550">
                  {stk.type}
                </span>
                {stk.type === 'Vendor' && stk.is_approved && (
                  <span className="flex items-center gap-0.5 px-2 py-0.5 bg-emerald-50/80 border border-emerald-200/30 text-emerald-700 rounded-full text-[9.5px] font-semibold tracking-wide">
                    <span className="material-symbols-outlined text-[10.5px] text-emerald-600" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                    Verified
                  </span>
                )}
              </div>
              <p className="text-[12.5px] text-stone-500 mt-1 font-medium flex items-center gap-1.5 flex-wrap">
                <span>{stk.category}</span>
                {phones[0] && <span className="text-stone-300">·</span>}
                {phones[0] && <span className="font-sans text-stone-600">{phones[0]}</span>}
                <span className="text-stone-300">·</span>
                <span className="font-sans text-[10.5px] text-stone-400 font-medium">
                  UID: {stk.stakeholder_id.slice(0, 8)}
                </span>
              </p>
              {stk.type === 'Vendor' && stk.rating != null && (
                <div className="mt-1.5">
                  <StarDisplay value={stk.rating} size={11} />
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {stk.type === 'Vendor' && canManage && (
              <button onClick={openRateModal}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-stone-200/45 bg-white text-[12px] font-semibold text-stone-600 hover:bg-stone-50 hover:text-stone-850 hover:border-stone-350 transition-all shadow-xs">
                <span className="material-symbols-outlined text-[14px]">star</span>
                Rate
              </button>
            )}
            <button onClick={handleDownloadPDF}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-stone-200/45 bg-white text-[12px] font-semibold text-stone-600 hover:bg-stone-50 hover:text-stone-850 hover:border-stone-350 transition-all shadow-xs">
              <span className="material-symbols-outlined text-[14px]">download</span>
              Download Statement
            </button>
            <button
              onClick={() => setShowTxnSheet(true)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-stone-850 text-white text-[11.5px] font-semibold tracking-wide hover:bg-stone-950 transition-all duration-150 shadow-xs"
            >
              <span className="material-symbols-outlined text-[13px] font-bold">add</span>
              Record Transaction
            </button>
          </div>
        </div>

        {/* ── ZONE 2: EXECUTIVE STATEMENT GRID (Fintech Aesthetic) ── */}
        <div className="bg-white rounded-2xl border border-stone-200/80 shadow-[0_2px_12px_rgba(28,25,23,0.01)] overflow-hidden shrink-0 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-stone-200/45">
            {/* Col 1: Supplied / Invoiced */}
            <div className="p-4 sm:p-5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-stone-400 mb-1.5">
                {stkType === 'Client' ? 'Total Invoiced' : 'Total Supplied'}
              </p>
              <p className="text-[21px] font-semibold text-stone-800 tracking-tight leading-none font-sans">
                ₹{fmt(stkType === 'Vendor' ? totalBilled : stkType === 'Worker' ? totalCredit : totalDebit)}
              </p>
              <p className="text-[10px] text-stone-450 mt-2 font-medium">
                {stkType === 'Client' ? 'invoices raised' : stkType === 'Vendor' ? 'recorded bills' : 'certified milestones'}
              </p>
            </div>

            {/* Col 2: Paid / Payouts */}
            <div className="p-4 sm:p-5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-stone-400 mb-1.5">
                {stkType === 'Client' ? 'Total Receipts' : 'Total Payouts'}
              </p>
              <p className="text-[21px] font-semibold text-stone-800 tracking-tight leading-none font-sans">
                ₹{fmt(totalPaid)}
              </p>
              <p className="text-[10px] text-stone-450 mt-2 font-medium">
                {activeTxns.length} payment{activeTxns.length !== 1 ? 's' : ''}
              </p>
            </div>

            {/* Col 3: Balance status card (Fintech Elegant Badge) */}
            <div className="p-4 sm:p-5 bg-stone-50/20 flex flex-col justify-between">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-stone-400 mb-1.5">Net Balance</p>
                {finalBalance > 0 ? (
                  <p className="text-[21px] font-semibold text-stone-800 tracking-tight leading-none font-sans">
                    ₹{fmt(finalBalance)}
                  </p>
                ) : finalBalance < 0 ? (
                  <p className="text-[21px] font-semibold text-stone-800 tracking-tight leading-none font-sans">
                    ₹{fmt(Math.abs(finalBalance))}
                  </p>
                ) : (
                  <p className="text-[21px] font-semibold text-emerald-700 tracking-tight leading-none font-sans">
                    Nil
                  </p>
                )}
              </div>
              
              <div className="flex mt-2">
                {finalBalance > 0 ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9.5px] font-semibold bg-rose-50/70 text-rose-700 border border-rose-100/50">
                    {stkType === 'Client' ? 'Receivable' : 'Payable Cr'}
                  </span>
                ) : finalBalance < 0 ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9.5px] font-semibold bg-amber-50/70 text-amber-800 border border-amber-100/50">
                    {stkType === 'Client' ? 'Advance Cr' : 'Advance Dr'}
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9.5px] font-semibold bg-emerald-50/70 text-emerald-800 border border-emerald-100/50">
                    Settled
                  </span>
                )}
              </div>
            </div>

            {/* Col 4: Contract Count */}
            <div className="p-4 sm:p-5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-stone-450 mb-1.5">
                {stkType === 'Client' ? 'Transactions' : stkType === 'Worker' ? 'Contracts' : 'Active POs'}
              </p>
              <p className="text-[21px] font-semibold text-stone-800 tracking-tight leading-none font-sans">
                {stkType === 'Worker' ? (workOrders || []).length : stkType === 'Vendor' ? (stakeholderPOs || []).length : activeTxns.length}
              </p>
              <p className="text-[10px] text-stone-450 mt-2 font-medium">
                {stkType === 'Worker' ? `₹${fmt(totalWOValue)} certified` : stkType === 'Vendor' ? 'orders with bills' : 'payment records'}
              </p>
            </div>
          </div>
        </div>

        {/* ── ZONE 3: Account Ledger Control Bar & Views ─────────────────── */}
        <div className="mb-6">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-450">Account Ledger</span>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Period Selector switch */}
              <div className="flex bg-stone-100/80 p-0.5 rounded-full border border-stone-200/40 shadow-xs">
                {([
                  { key: 'all',   label: 'All' },
                  { key: 'month', label: 'Month' },
                  { key: '3m',    label: '3M' },
                  { key: 'fy',    label: `FY${fyY % 100}` },
                ] as { key: DateFilter; label: string }[]).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setDateFilter(key)}
                    className={`px-3 py-1 rounded-full text-[10px] font-medium tracking-wide transition-all duration-150 ${
                      dateFilter === key
                        ? 'bg-white text-stone-850 shadow-xs border border-stone-200/20 font-semibold'
                        : 'text-stone-500 hover:text-stone-750'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <span className="w-px h-3 bg-stone-200 mx-0.5" />

              {/* Group toggle button */}
              <button
                onClick={() => setSortByDate(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-semibold tracking-wide transition-all duration-150 border ${
                  sortByDate
                    ? 'bg-white border-stone-200 text-stone-600 hover:text-stone-850 hover:bg-stone-50 hover:border-stone-300'
                    : 'bg-stone-800 border-stone-800 text-white hover:bg-stone-900 shadow-xs'
                }`}
              >
                <span className="material-symbols-outlined text-[13px] font-bold">
                  {sortByDate ? 'calendar_month' : 'view_headline'}
                </span>
                {sortByDate ? 'By Date' : 'By Contract (PO/WO)'}
              </button>
            </div>
          </div>

          {/* Ledger Data Viewport */}
          {txnsLoading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="h-16 bg-stone-100 rounded-2xl border border-stone-200/45 animate-pulse" />
              ))}
            </div>
          ) : displayRows.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#EAE6DE]/75 p-10 text-center shadow-sm">
              <span className="material-symbols-outlined text-[36px] text-stone-300 mb-2 block">receipt_long</span>
              <p className="text-[12px] text-stone-500 font-semibold tracking-wide">No ledger records within this window.</p>
            </div>
          ) : sortByDate ? (
            /* ── CHRONOLOGICAL DATE VIEW (World-Class Clean Table) ────── */
            <div className="bg-white rounded-2xl border border-[#EAE6DE]/75 overflow-hidden shadow-[0_4px_24px_rgba(28,25,23,0.015)] mb-6">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#EAE6DE]/60 bg-stone-50/[0.45]">
                    <th className="pl-4 pr-2 py-3 text-[9px] font-semibold uppercase tracking-wider text-stone-455 w-[70px]">Date</th>
                    <th className="px-3 py-3 text-[9px] font-semibold uppercase tracking-wider text-stone-455">Particulars</th>
                    <th className="px-3 py-3 text-[9px] font-semibold uppercase tracking-wider text-stone-455 hidden sm:table-cell w-[95px]">Contract</th>
                    <th className="px-3 py-3 text-[9px] font-semibold uppercase tracking-wider text-stone-455 text-right w-[95px]">Debit (Dr)</th>
                    <th className="px-3 py-3 text-[9px] font-semibold uppercase tracking-wider text-stone-455 text-right w-[95px]">Credit (Cr)</th>
                    <th className="pl-3 pr-4 py-3 text-[9px] font-semibold uppercase tracking-wider text-stone-455 text-right w-[115px]">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {Array.from(monthGroups.entries()).map(([monthKeyStr, rows]) => (
                    <div key={monthKeyStr} className="contents">
                      {/* Month Header Banner */}
                      <tr className="bg-stone-50/[0.2] border-b border-[#EAE6DE]/40">
                        <td colSpan={6} className="pl-4 py-2">
                          <span className="text-[9px] font-semibold uppercase tracking-wider text-stone-400">
                            {monthHeading(monthKeyStr)}
                          </span>
                        </td>
                      </tr>
                      {/* Rows */}
                      {rows.map(row => {
                        const bal = row.runningBalance;
                        const balLabel = bal > 0 ? `₹${fmt(bal)} Cr` : bal < 0 ? `₹${fmt(Math.abs(bal))} Dr` : 'Nil';
                        const balColor = bal > 0 ? 'text-rose-600' : bal < 0 ? 'text-amber-600' : 'text-emerald-700';
                        const isCredit = row.entry_type === 'CREDIT';

                        return (
                          <tr
                            key={row.id}
                            onClick={() => row.txn_id && openPeek('TRANSACTION', row.txn_id)}
                            className={`hover:bg-[#FAF9F6]/50 transition-colors group ${
                              row.txn_id ? 'cursor-pointer' : ''
                            } ${isCredit ? 'bg-emerald-50/[0.02]' : ''}`}
                          >
                            {/* Date Column */}
                            <td className="pl-4 pr-2 py-3.5 align-top text-[10.5px] text-stone-450 tracking-tight whitespace-nowrap">
                              {formatLedgerDate(row.date)}
                            </td>
                            
                            {/* Particulars Column */}
                            <td className="px-3 py-3.5 align-top">
                              <p className={`text-[12.5px] font-medium tracking-tight ${isCredit ? 'text-emerald-800' : 'text-stone-850'}`}>
                                {row.particulars}
                              </p>
                              {row.detail && <p className="text-[10px] text-stone-450 mt-0.5 font-medium leading-relaxed">{row.detail}</p>}
                              {row.project && (
                                <p className="text-[9.5px] text-stone-400 font-medium uppercase tracking-wider mt-1 flex items-center gap-1">
                                  <span className="material-symbols-outlined text-[10px] text-stone-300">location_on</span>
                                  {row.project}
                                </p>
                              )}
                              <span className={`inline-flex items-center mt-2.5 text-[8.5px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                                isCredit 
                                  ? 'bg-emerald-50/70 text-emerald-700 border-emerald-250/20' 
                                  : 'bg-stone-50/70 text-stone-600 border-stone-200/40'
                              }`}>
                                {row.source === 'VENDOR_BILL' ? 'Bill' : row.source === 'PAYMENT' ? 'Payment' : row.source === 'MILESTONE' ? 'Certified' : row.source === 'INVOICE' ? 'Invoice' : row.source === 'RECEIPT' ? 'Receipt' : row.source}
                              </span>
                            </td>

                            {/* Contract Reference Column */}
                            <td className="px-3 py-3.5 align-top hidden sm:table-cell">
                              {row.ref_number ? (
                                <button
                                  type="button"
                                  onClick={e => {
                                    e.stopPropagation();
                                    openPeek(row.ref_type === 'WO' ? 'WO' : 'PO', row.ref_id!);
                                  }}
                                  className="font-sans text-[11px] font-semibold text-stone-600 hover:text-stone-900 hover:underline text-left flex items-center gap-0.5 group/link"
                                >
                                  {row.ref_number.slice(0, 8)}
                                  <span className="material-symbols-outlined text-[9px] text-stone-400 group-hover/link:text-stone-900 transition-colors">arrow_outward</span>
                                </button>
                              ) : (
                                <span className="text-stone-250 text-[11px]">—</span>
                              )}
                            </td>

                            {/* Debit Column */}
                            <td className="px-3 py-3.5 align-top text-right text-[12px] font-semibold font-sans text-stone-750 tracking-tight">
                              {row.entry_type === 'DEBIT' ? fmt(row.debit) : <span className="text-stone-200 font-normal">—</span>}
                            </td>

                            {/* Credit Column */}
                            <td className="px-3 py-3.5 align-top text-right text-[12px] font-semibold font-sans text-emerald-700 tracking-tight">
                              {row.entry_type === 'CREDIT' ? fmt(row.credit) : <span className="text-stone-200 font-normal">—</span>}
                            </td>

                            {/* Running Balance Column */}
                            <td className={`pl-3 pr-4 py-3.5 align-top text-right text-[12px] font-semibold font-sans tracking-tight ${balColor}`}>
                              {balLabel}
                            </td>
                          </tr>
                        );
                      })}
                    </div>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            /* ── CONTRACT/PO CARD TIMELINE VIEW (Visual Masterpiece) ───── */
            <div className="space-y-5 mb-6">
              {orderedGroupKeys.map(groupKey => {
                const rows = poGroupsMap.get(groupKey)!;
                const groupCr = rows.reduce((s, r) => s + r.credit, 0);
                const groupDr = rows.reduce((s, r) => s + r.debit, 0);
                const groupBal = groupCr - groupDr;

                const isWO = rows[0]?.ref_type === 'WO';
                const badgeBg = isWO ? 'bg-amber-50/70 text-amber-700 border-amber-250/20' : 'bg-stone-50/70 text-stone-600 border-stone-200/40';

                // Progress Calculations
                const totalBilledVal = groupCr;
                const totalPaidVal = groupDr;
                const payPercent = totalBilledVal > 0 ? Math.min(100, Math.round((totalPaidVal / totalBilledVal) * 100)) : 0;

                return (
                  <div
                    key={groupKey}
                    className="bg-white rounded-2xl border border-[#EAE6DE]/80 shadow-[0_4px_20px_rgba(28,25,23,0.015)] overflow-hidden transition-all hover:shadow-[0_6px_28px_rgba(28,25,23,0.035)]"
                  >
                    {/* Group Card Header */}
                    <div className="px-5 py-4 bg-stone-50/[0.35] border-b border-[#EAE6DE]/50 flex flex-wrap items-center justify-between gap-4">
                      <div className="flex items-center gap-2">
                        {groupKey !== 'unlinked' ? (
                          <>
                            <span className={`text-[9px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full border ${badgeBg}`}>
                              {rows[0]?.ref_type || 'PO'}
                            </span>
                            <button
                              type="button"
                              onClick={() => openPeek(isWO ? 'WO' : 'PO', groupKey)}
                              className="font-sans text-[11.5px] font-semibold text-stone-800 hover:underline flex items-center gap-1 group/peeklink"
                            >
                              {groupKey.slice(0, 10)}
                              <span className="material-symbols-outlined text-[10px] text-stone-400 group-hover/peeklink:text-stone-900 transition-colors">open_in_new</span>
                            </button>
                          </>
                        ) : (
                          <span className="text-[11.5px] font-semibold text-stone-400 uppercase tracking-wider">Unassociated Ledger Entries</span>
                        )}
                        <span className="text-[10px] text-stone-400 font-medium">({rows.length} {rows.length === 1 ? 'entry' : 'entries'})</span>
                      </div>

                      <div className="flex items-center gap-4 text-[10.5px] font-medium">
                        {groupCr > 0 && (
                          <span className="text-stone-450">Billed <span className="font-sans font-semibold text-emerald-700">₹{fmt(groupCr)}</span></span>
                        )}
                        {groupDr > 0 && (
                          <span className="text-stone-450">Paid <span className="font-sans font-semibold text-stone-850">₹{fmt(groupDr)}</span></span>
                        )}
                        <span className={`font-semibold font-sans text-[10.5px] px-2.5 py-0.5 rounded-full border ${
                          groupBal > 0 
                            ? 'bg-rose-50/60 text-rose-700 border-rose-200/25' 
                            : groupBal < 0 
                              ? 'bg-amber-50/60 text-amber-800 border-amber-200/25' 
                              : 'bg-emerald-50/60 text-emerald-750 border-emerald-200/25'
                        }`}>
                          {groupBal > 0 ? `₹${fmt(groupBal)} due` : groupBal < 0 ? `₹${fmt(Math.abs(groupBal))} adv` : 'Settled ✓'}
                        </span>
                      </div>
                    </div>

                    {/* Dynamic Payment Progress Segment */}
                    {totalBilledVal > 0 && (
                      <div className="px-5 pb-3.5 pt-2 bg-stone-50/[0.2] border-b border-[#EAE6DE]/40">
                        <div className="flex items-center justify-between text-[9.5px] font-semibold text-stone-400 mb-1.5 uppercase tracking-wider">
                          <span>Disbursement Progress</span>
                          <span className="font-sans font-medium text-stone-550">{payPercent}% Paid</span>
                        </div>
                        <div className="w-full h-1.5 bg-stone-150 rounded-full overflow-hidden flex shadow-inner">
                          <div className="bg-gradient-to-r from-emerald-600 to-emerald-500 rounded-full shadow-[0_0_4px_rgba(16,185,129,0.2)]" style={{ width: `${payPercent}%` }} />
                        </div>
                      </div>
                    )}

                    {/* Group Timeline Rows with connectors */}
                    <div className="divide-y divide-stone-100 relative">
                      {/* Vertical Hairline Connector Line */}
                      {rows.length > 1 && (
                        <div className="absolute left-[21px] top-[24px] bottom-[24px] w-[1.5px] bg-stone-200/55" />
                      )}

                      {rows.map(row => {
                        const isCredit = row.entry_type === 'CREDIT';
                        return (
                          <div
                            key={row.id}
                            onClick={() => row.txn_id && openPeek('TRANSACTION', row.txn_id)}
                            className={`pl-12 pr-5 py-4 flex items-start justify-between gap-4 transition-colors relative ${
                              row.txn_id ? 'cursor-pointer hover:bg-[#FAF9F6]/40' : ''
                            } ${isCredit ? 'bg-emerald-50/[0.01]' : ''}`}
                          >
                            {/* Custom Timeline Micro hollow Bullet */}
                            <div className={`absolute left-[17px] top-[22px] w-2.5 h-2.5 rounded-full border-2 bg-white z-10 ${
                              isCredit 
                                ? 'border-emerald-500' 
                                : 'border-stone-400'
                            }`} />

                            <div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className={`text-[12.5px] font-medium tracking-tight ${isCredit ? 'text-emerald-800' : 'text-stone-850'}`}>
                                  {row.particulars}
                                </p>
                                <span className="text-[10.5px] font-medium text-stone-400 tracking-tight">
                                  ({formatLedgerDate(row.date)})
                                </span>
                              </div>
                              {row.detail && <p className="text-[10px] text-stone-450 mt-0.5 leading-relaxed font-medium">{row.detail}</p>}
                              {row.project && (
                                <p className="text-[9.5px] text-stone-400 font-medium uppercase tracking-wider mt-1 flex items-center gap-0.5">
                                  <span className="material-symbols-outlined text-[9.5px]">location_on</span>
                                  {row.project}
                                </p>
                              )}
                              <span className={`inline-flex items-center mt-2.5 text-[8.5px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                                isCredit 
                                  ? 'bg-emerald-50/70 text-emerald-700 border-emerald-250/20' 
                                  : 'bg-stone-50/70 text-stone-600 border-stone-200/40'
                              }`}>
                                {row.source === 'VENDOR_BILL' ? 'Bill' : row.source === 'PAYMENT' ? 'Payment' : row.source === 'MILESTONE' ? 'Certified' : row.source === 'INVOICE' ? 'Invoice' : row.source === 'RECEIPT' ? 'Receipt' : row.source}
                              </span>
                            </div>

                            <div className="text-right shrink-0">
                              <p className={`text-[12.5px] font-semibold tracking-tight ${isCredit ? 'text-emerald-750' : 'text-stone-750'}`}>
                                {isCredit ? `+₹${fmt(row.credit)}` : `-₹${fmt(row.debit)}`}
                              </p>
                              <p className="text-[10.5px] text-stone-455 mt-1 font-medium">
                                Bal: ₹{fmt(row.runningBalance)} {row.runningBalance > 0 ? 'Cr' : row.runningBalance < 0 ? 'Dr' : ''}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── ZONE 4: WORK ORDERS ──────────────────────────────────────── */}
        <div className="mb-6">
          <button
            onClick={() => setShowWOs(v => !v)}
            className="flex items-center gap-2 mb-4 text-[11px] font-semibold uppercase tracking-wider text-stone-455 hover:text-stone-850 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px] text-stone-450">
              {showWOs ? 'expand_less' : 'expand_more'}
            </span>
            <span>{(workOrders || []).length} Contract{(workOrders || []).length !== 1 ? 's' : ''}</span>
            {!showWOs && (
              <span className="normal-case font-semibold text-stone-400 ml-1.5 hover:underline">View All →</span>
            )}
          </button>

          {showWOs && (
            <div className="space-y-4">
              {wosLoading ? (
                <div className="space-y-3">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="h-20 bg-stone-100 rounded-2xl border border-stone-200/45 animate-pulse" />
                  ))}
                </div>
              ) : (workOrders || []).length === 0 ? (
                <div className="bg-white rounded-2xl border border-[#EAE6DE]/75 p-8 text-center text-stone-500 font-medium">
                  No contracts registered for this stakeholder.
                </div>
              ) : (
                (workOrders || []).map((wo: any) => {
                  const paid  = woPayments[wo.wo_id] || 0;
                  const value = Number(wo.order_value || 0);
                  const pct   = value > 0 ? Math.min(100, Math.round((paid / value) * 100)) : 0;
                  const due   = Math.max(0, value - paid);
                  return (
                    <div
                      key={wo.wo_id}
                      onClick={() => navigate(`/work-orders/${wo.wo_id}`, {
                        state: { from: 'stakeholder', stakeholderId: stk.stakeholder_id, stakeholderName: stk.name }
                      })}
                      className="bg-white rounded-2xl border border-stone-200/80 p-5 cursor-pointer shadow-[0_2px_12px_rgba(28,25,23,0.01)] hover:border-stone-350 hover:shadow-md transition-all duration-200"
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-sans text-[11px] font-semibold text-stone-700 bg-stone-50 border border-stone-200/40 px-2 py-0.5 rounded-md">{wo.wo_id}</span>
                            <span className="text-[12px] text-stone-500 font-medium">{wo.projects?.name || '—'}</span>
                          </div>
                          <p className="text-[13.5px] text-stone-850 font-medium mt-1 truncate">{wo.scope_of_work}</p>
                        </div>
                        <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-[9.5px] font-semibold tracking-wide border ${
                          wo.status === 'Closed'
                            ? 'bg-emerald-50/70 text-emerald-700 border-emerald-250/20'
                            : wo.status === 'Active'
                              ? 'bg-amber-50/70 text-amber-800 border-amber-250/20'
                              : 'bg-stone-50/70 text-stone-600 border-stone-200/40'
                        }`}>
                          {wo.status}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-[10.5px] font-medium text-stone-455 mb-3 flex-wrap">
                        <span>Val: <span className="text-stone-850">₹{fmt(value)}</span></span>
                        <span className="text-stone-300">·</span>
                        <span>Paid: <span className="text-stone-850">₹{fmt(paid)}</span></span>
                        {due > 0 && (
                          <><span className="text-stone-300">·</span><span>Due: <span className="text-rose-600 font-semibold">₹{fmt(due)}</span></span></>
                        )}
                      </div>

                      <div className="w-full h-1.5 bg-stone-100 border border-stone-200/20 rounded-full overflow-hidden flex shadow-xs">
                        <div
                          className={`h-full rounded-full transition-all bg-gradient-to-r ${
                            pct === 100 
                              ? 'from-emerald-500 to-teal-400' 
                              : 'from-amber-400 to-amber-500'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-[10.5px] font-medium text-stone-455 mt-1.5">{pct}% paid</p>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── RATING MODAL (Premium Modern Style) ──────────────────────── */}
      {showRateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-[4px]"
          onClick={() => setShowRateModal(false)}>
          <div className="bg-white rounded-[24px] border border-stone-200/60 shadow-xl p-6 w-full max-w-sm mx-4 transition-all"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5 pb-3 border-b border-stone-100">
              <h3 className="text-[15px] font-semibold text-stone-800 tracking-tight">Rate Vendor</h3>
              <button onClick={() => setShowRateModal(false)}
                className="w-7 h-7 rounded-full border border-stone-200/80 flex items-center justify-center text-stone-400 hover:text-stone-700 hover:bg-stone-50 hover:border-stone-300 transition-all shrink-0">
                <span className="material-symbols-outlined text-[15px]">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[11px] font-medium text-stone-500 tracking-wide mb-1.5 block">
                  Overall Performance
                </label>
                <div className="flex items-center gap-3">
                  <StarRating value={rateOverall} onChange={setRateOverall} />
                  {rateOverall > 0
                    ? <span className="text-[12px] font-medium text-stone-700">{rateOverall} / 5</span>
                    : <span className="text-[11px] text-stone-400 italic">Not rated</span>}
                </div>
              </div>

              {rateOverall > 0 && (
                <button type="button"
                  onClick={() => setShowRateSubcats(v => !v)}
                  className="flex items-center gap-1 text-[11px] font-semibold text-stone-500 hover:text-stone-800 transition-colors">
                  <span className="material-symbols-outlined text-[13px] font-bold">
                    {showRateSubcats ? 'expand_less' : 'expand_more'}
                  </span>
                  {showRateSubcats ? 'Hide details' : 'Rate parameters'}
                </button>
              )}

              {showRateSubcats && (
                <div className="pl-3.5 border-l border-stone-200 space-y-4 pt-1">
                  {([
                    { label: 'Delivery', value: rateDelivery, onChange: setRateDelivery },
                    { label: 'Quality',  value: rateQuality,  onChange: setRateQuality  },
                    { label: 'Pricing',  value: ratePricing,  onChange: setRatePricing  },
                  ] as const).map(r => (
                    <div key={r.label}>
                      <label className="text-[10.5px] font-medium text-stone-500 mb-1.5 block">
                        {r.label}
                      </label>
                      <div className="flex items-center gap-3">
                        <StarRating value={r.value} onChange={r.onChange} />
                        {r.value > 0 && <span className="text-[11px] font-medium text-stone-600">{r.value} / 5</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-end mt-6 pt-4 border-t border-stone-100">
              <button onClick={() => setShowRateModal(false)}
                className="px-4 py-1.5 rounded-full text-[11.5px] font-medium text-stone-500 hover:text-stone-800 hover:bg-stone-50/80 transition-all">Cancel</button>
              <button
                disabled={updateRating.isPending}
                onClick={() => updateRating.mutate()}
                className="px-5 py-1.5 rounded-full text-[11.5px] font-medium text-white bg-stone-850 hover:bg-stone-900 transition-all shadow-sm disabled:opacity-50"
              >
                {updateRating.isPending ? 'Saving…' : 'Save Rating'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Quick Transaction Sheet ─────────────────────────────────────── */}
      {showTxnSheet && stk && (
        <QuickTransactionSheet
          stakeholder={{ stakeholder_id: stk.stakeholder_id, name: stk.name, type: stk.type }}
          onClose={() => setShowTxnSheet(false)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ['stakeholder_txns', stakeholderId] });
            qc.invalidateQueries({ queryKey: ['ledger'] });
          }}
        />
      )}
    </div>
  );
}
