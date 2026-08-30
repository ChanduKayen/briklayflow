import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import { isGeneralExpense, generalExpenseLabel } from '../lib/transactions';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import { usePeek } from '../context/PeekContextCore';
import { ImageLightbox } from '../components/ImageLightbox';
import { DocThumb } from '../components/DocThumb';
import { autoCloseWOIfFullyPaid } from '../lib/woAutoClose';
import jsPDF from 'jspdf';
import StakeholderLedgerDrawer from '../components/StakeholderLedgerDrawer';

// ─── Scoped stylesheet — a faithful port of the txn-detail reference (cream/terracotta).
//     Every selector is prefixed with `.txnx` so nothing leaks into the rest of the app. ──
const TXNX_CSS = `
.txnx{--cream:#F6F2EA;--paper:#FFFDF9;--paper-2:#FBF8F2;--ink:#2F2622;--ink-2:#6E635B;--ink-3:#A39A91;--line:#E4DCD0;--line-2:#EFE9DF;--terra:#C4613A;--terra-deep:#A94E2B;--terra-tint:#F8E7DE;--sage:#5F7F5B;--sage-tint:#E7EFE4;--gold:#B8862E;--gold-tint:#F7EEDA;--r:8px;--ease:cubic-bezier(.2,.7,.2,1);--shadow:0 1px 2px rgba(47,38,34,.04),0 8px 24px -18px rgba(47,38,34,.25);min-height:100vh;background:var(--cream);color:var(--ink);font:15px/1.45 "DM Sans",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.txnx *{box-sizing:border-box}
.txnx button{font:inherit;color:inherit}
.txnx .mono{font-family:"DM Mono",ui-monospace,monospace;font-feature-settings:"tnum"}
.txnx .page{max-width:960px;margin:0 auto;padding:22px 32px 90px}
.txnx .page>*{animation:txnxRise .5s var(--ease) both}
.txnx .page>*:nth-child(2){animation-delay:.05s}.txnx .page>*:nth-child(3){animation-delay:.1s}.txnx .page>*:nth-child(4){animation-delay:.15s}.txnx .page>*:nth-child(6){animation-delay:.2s}
@keyframes txnxRise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.txnx .crumb{display:flex;align-items:center;gap:6px;color:var(--ink-3);font-size:13px;margin-bottom:16px}
.txnx .crumb a{color:var(--ink-2);text-decoration:none;padding:4px 6px;border-radius:6px;margin-left:-6px;transition:background .15s;cursor:pointer}
.txnx .crumb a:hover{background:var(--paper)}
.txnx .crumb b{color:var(--ink);font-weight:500}
.txnx .head{display:grid;grid-template-columns:1fr auto auto;gap:8px 20px;align-items:start;margin-bottom:20px;position:relative;z-index:20}
.txnx h1{font:600 28px/1.1 "Playfair Display",Georgia,serif;margin:0 0 8px;letter-spacing:-.01em;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.txnx .tag{font:500 13px/1 "DM Mono";letter-spacing:.04em;color:var(--ink-2);background:var(--paper);border:1px solid var(--line);padding:6px 9px;border-radius:6px}
.txnx .meta{color:var(--ink-2);font-size:14px;display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center}
.txnx .meta .sep{width:1px;height:16px;background:var(--line)}
.txnx .meta b{color:var(--ink);font-weight:500}
.txnx .chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:12.5px;font-weight:500;border:1px solid transparent}
.txnx .chip i{width:6px;height:6px;border-radius:50%}
.txnx .chip.sage{color:var(--sage);background:var(--sage-tint)}.txnx .chip.sage i{background:var(--sage)}
.txnx .chip.warn{color:var(--terra);background:var(--terra-tint);cursor:pointer;transition:transform .12s}
.txnx .chip.warn:hover{transform:translateY(-1px)}.txnx .chip.warn i{background:var(--terra)}
.txnx .chip.gold{color:var(--gold);background:var(--gold-tint)}.txnx .chip.gold i{background:var(--gold)}
.txnx .amount{text-align:right;padding-top:2px}
.txnx .amount small{border-top:3px solid var(--terra);padding-top:6px;display:block;font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-2);margin-bottom:2px}
.txnx .amount.in small{border-top-color:var(--sage)}
.txnx .amount .mono{font-size:28px;font-weight:500;letter-spacing:-.02em;line-height:1;color:var(--terra-deep)}
.txnx .amount .dir{font-size:12px;color:var(--ink-3);margin-top:2px}
.txnx .amount.in .mono{color:var(--sage)}
.txnx .more{position:relative}
.txnx .kebab{width:36px;height:36px;border-radius:50%;border:1px solid transparent;background:transparent;cursor:pointer;display:grid;place-items:center;color:var(--ink-2);transition:background .15s,border-color .15s,transform .12s}
.txnx .kebab:hover{background:var(--paper);border-color:var(--line)}.txnx .kebab:active{transform:scale(.92)}
.txnx .menu{position:absolute;right:0;top:calc(100% + 6px);background:var(--paper);border:1px solid var(--line);border-radius:var(--r);box-shadow:0 12px 30px -12px rgba(47,38,34,.28);padding:4px;min-width:210px;z-index:30;animation:txnxPop .16s var(--ease)}
@keyframes txnxPop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.txnx .menu button{display:flex;align-items:center;gap:10px;width:100%;border:0;background:transparent;text-align:left;padding:9px 10px;border-radius:6px;cursor:pointer}
.txnx .menu button:hover{background:var(--paper-2)}
.txnx .menu button.danger{color:var(--terra)}.txnx .menu button.danger:hover{background:var(--terra-tint)}
.txnx .menu hr{border:0;border-top:1px solid var(--line-2);margin:4px 0}
.txnx .menu svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.7}
.txnx .menu .hint{font-size:11.5px;color:var(--ink-3);padding:2px 10px 6px}
.txnx .sec{display:flex;align-items:center;justify-content:space-between;margin:22px 0 10px}
.txnx .sec h2{margin:0;font:600 11.5px/1 "DM Sans";letter-spacing:.14em;text-transform:uppercase;color:var(--ink-2);padding-left:10px;border-left:3px solid var(--terra);display:flex;align-items:center;gap:14px;flex:1}
.txnx .sec h2::after{content:"";flex:1;height:1px;background:var(--line);margin-right:14px}
.txnx .sheet{background:var(--paper);border:1px solid var(--line);border-radius:10px;overflow:hidden;box-shadow:var(--shadow)}
.txnx table{width:100%;border-collapse:collapse;table-layout:fixed}
.txnx th{font-weight:500;font-size:12px;color:var(--ink-2);text-align:left;padding:9px 14px;background:var(--paper-2);border-bottom:1px solid var(--line);letter-spacing:.02em;white-space:nowrap}
.txnx td{padding:10px 14px;border-bottom:1px solid var(--line-2);vertical-align:middle;height:48px}
.txnx th+th,.txnx td+td{border-left:1px solid var(--line-2)}
.txnx tbody tr:last-child td{border-bottom:0}
.txnx .num{text-align:right;font-family:"DM Mono",monospace;font-feature-settings:"tnum"}
.txnx .dim{color:var(--ink-3)}
.txnx .hdr th{width:110px;background:var(--paper-2);border-bottom:1px solid var(--line-2);vertical-align:middle}
.txnx .hdr tr:last-child th{border-bottom:0}
.txnx .hdr td b{font-weight:600}
.txnx .hdr td small{display:block;color:var(--ink-3);font-size:12.5px}
.txnx .hdr a{color:var(--ink);text-decoration:none;border-bottom:1px dashed var(--ink-3);font-weight:600;cursor:pointer}
.txnx .who{display:grid;grid-template-columns:34px 1fr;gap:2px 10px;align-items:center}
.txnx .who a{justify-self:start}
.txnx .who .av{grid-row:span 2;width:34px;height:34px;border-radius:50%;background:var(--terra-tint);color:var(--terra);display:grid;place-items:center;font:600 13px "DM Sans"}
.txnx .hdr a:hover{border-bottom-style:solid;color:var(--terra)}
.txnx .pill{display:inline-flex;align-items:center;gap:6px;font:500 12px "DM Mono";letter-spacing:.05em;background:var(--paper-2);border:1px solid var(--line-2);padding:5px 8px;border-radius:5px;color:var(--ink-2)}
.txnx .sheet.alloc{overflow:visible;position:relative;z-index:5}
.txnx .alloc td{height:56px}
.txnx .lnk{display:inline-flex;align-items:center;gap:8px}
.txnx .lnk .st{font-weight:500}
.txnx .lnk .st.un{color:var(--terra)}
.txnx .lnk .st.un::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;border:1.5px dashed var(--terra);margin-right:7px;vertical-align:1px}
.txnx .lnk .st.ok{color:var(--sage)}
.txnx .lnk .st.adv{color:var(--gold)}
.txnx .lnk small{display:block;font-weight:400;color:var(--ink-3);font-size:12px}
.txnx .linkbtn{height:32px;padding:0 14px;border-radius:6px;border:1px solid var(--terra);background:var(--terra);color:#fff;font-size:13px;font-weight:500;cursor:pointer;transition:background .15s,transform .12s,box-shadow .15s}
.txnx .linkbtn:hover{background:var(--terra-deep);transform:translateY(-1px);box-shadow:0 5px 12px -6px rgba(196,97,58,.7)}
.txnx .linkbtn:active{transform:scale(.96)}
.txnx .ghost{height:30px;padding:0 10px;border-radius:6px;border:1px solid var(--line);background:var(--paper);font-size:13px;font-weight:500;color:var(--ink-2);cursor:pointer;transition:background .15s,color .15s}
.txnx .ghost:hover{background:var(--terra-tint);color:var(--terra);border-color:transparent}
.txnx tfoot td{background:var(--paper-2);font-size:13.5px;color:var(--ink-2);height:42px;border-top:2px solid var(--line)}
.txnx tfoot td.num{color:var(--ink);font-weight:600}
.txnx .pickwrap{position:relative}
.txnx .picker{position:absolute;right:0;left:auto;top:calc(100% + 6px);z-index:40;background:var(--paper);border:1px solid var(--line);border-radius:10px;box-shadow:0 16px 40px -14px rgba(47,38,34,.35);width:400px;max-width:92vw;padding:6px;animation:txnxPop .18s var(--ease)}
.txnx .picker h5{margin:2px 0 4px;padding:6px 10px 0;font:600 11px "DM Sans";letter-spacing:.13em;text-transform:uppercase;color:var(--ink-3);display:flex;align-items:center;gap:6px}
.txnx .picker .bk{width:22px;height:22px;padding:0;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink-2);font-size:14px;line-height:1;cursor:pointer;display:grid;place-items:center}
.txnx .picker .bk:hover{background:var(--terra-tint);color:var(--terra);border-color:transparent}
.txnx .picker>button{display:grid;grid-template-columns:1fr auto;gap:2px 12px;width:100%;text-align:left;border:0;background:transparent;padding:9px 10px;border-radius:7px;cursor:pointer;transition:background .12s}
.txnx .picker>button:hover{background:var(--terra-tint)}
.txnx .picker>button b{font-weight:600;display:flex;align-items:center;gap:8px}
.txnx .picker>button b svg{width:15px;height:15px;stroke:var(--ink-2);fill:none;stroke-width:1.7;flex:none}
.txnx .picker>button:hover b svg{stroke:var(--terra)}
.txnx .picker>button.adv b svg{stroke:var(--gold)}
.txnx .picker>button .mono{color:var(--ink-2);font-size:13px}
.txnx .picker>button small{grid-column:1/-1;color:var(--ink-3);font-size:12px}
.txnx .picker>button.adv{border-top:1px solid var(--line-2);margin-top:4px;border-radius:0 0 7px 7px;color:var(--gold)}
.txnx .picker>button.adv:hover{background:var(--gold-tint)}
.txnx .log{list-style:none;margin:0;padding:6px 0}
.txnx .log li{display:grid;grid-template-columns:130px 14px 1fr;gap:10px;padding:10px 16px;font-size:13.5px;color:var(--ink-2);align-items:start}
.txnx .log li+li{border-top:1px solid var(--line-2)}
.txnx .log li i{width:8px;height:8px;border-radius:50%;background:var(--line);border:2px solid var(--paper);box-shadow:0 0 0 1px var(--line);margin-top:6px}
.txnx .log li:first-child i{background:var(--terra);box-shadow:0 0 0 1px var(--terra)}
.txnx .log .mono{color:var(--ink-3);font-size:12px;padding-top:2px}
.txnx .log b{color:var(--ink);font-weight:500}
.txnx .voided-mark .amount .mono{text-decoration:line-through;color:var(--ink-3)}
@media (max-width:760px){
  .txnx .page{padding:16px 14px 60px}
  .txnx .head{grid-template-columns:1fr auto}.txnx .amount{text-align:left;grid-column:1}
  .txnx .picker{width:min(92vw,380px)}
  .txnx .sheet{overflow-x:auto}.txnx .alloc table{min-width:640px}
}
@media (prefers-reduced-motion:reduce){.txnx *{animation-duration:.01ms !important;transition-duration:.01ms !important}}
`;

// ─── Amendment types ──────────────────────────────────────────────────────────

type AmendmentSnapshot = {
  total_amount: number;
  date: string;
  payment_mode: string;
  category: string;
  remarks: string;
};

type AmendmentRecord = {
  id: string;
  amended_by: string;
  amended_at: string;
  changes: Record<string, [any, any]>;
  snapshot: AmendmentSnapshot;
};

const CATEGORIES = [
  'Running Bill', 'Advance', 'PO Advance', 'PO Settlement',
  'Material Supply', 'Transport & Handling', 'Site Expenses',
  'Equipment Hire', 'Labour Charge', 'Other',
];

function fmtAmendVal(label: string, val: any): string {
  if (label === 'Amount') return `₹${Number(val || 0).toLocaleString()}`;
  if (label === 'Date') return val ? new Date(val).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  return String(val ?? '—');
}

// ─── Count-up hook ────────────────────────────────────────────────────────────


// ─── Obligation linking sub-components ───────────────────────────────────────

interface SelectedObligation {
  type: 'WO_PHASE' | 'WO' | 'PO';
  wo_id?: string;
  phase_id?: string;
  po_id?: string;
  label: string;
  balance: number;
}

function getPOBalance(po: any): number { return Number(po.vendor_bill_amount || po.total_value || 0); }




// ─── Section heading ──────────────────────────────────────────────────────────

// ─── Pill badge ───────────────────────────────────────────────────────────────

// ─── PDF Generator ────────────────────────────────────────────────────────────
function generatePDF(txn: any, allocs: any[], effective: AmendmentSnapshot, isAmended: boolean) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 18; // margin

  const dateStr = effective.date
    ? new Date(effective.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
    : '—';
  const amountStr = `INR ${Number(effective.total_amount || 0).toLocaleString('en-IN')}`;

  // ── Header band
  doc.setFillColor(26, 26, 26);
  doc.rect(0, 0, W, 36, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text('BRIKLAY', M, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(170, 170, 170);
  doc.text('Payment Voucher', M, 23);

  // TXN ID right side
  doc.setFont('courier', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(200, 200, 200);
  doc.text(txn.txn_id, W - M, 16, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text(dateStr, W - M, 23, { align: 'right' });

  // ── Amount hero
  doc.setFillColor(249, 248, 246);
  doc.rect(0, 36, W, 28, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(26, 26, 26);
  doc.text(amountStr, M, 57);

  if (isAmended) {
    doc.setFillColor(219, 234, 254);
    doc.roundedRect(W - M - 26, 46, 26, 8, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(29, 78, 216);
    doc.text('AMENDED', W - M - 13, 51.5, { align: 'center' });
  }

  if (txn.status === 'Voided') {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(36);
    doc.setTextColor(200, 30, 30);
    doc.setGState(doc.GState({ opacity: 0.2 }));
    doc.text('VOID', W / 2, 80, { align: 'center', angle: 25 });
    doc.setGState(doc.GState({ opacity: 1 }));
  }

  // ── Divider
  let y = 72;
  doc.setDrawColor(230, 228, 225);
  doc.setLineWidth(0.3);
  doc.line(M, y, W - M, y);
  y += 10;

  // ── Two-column metadata
  const col1 = M;
  const col2 = W / 2 + 4;

  function labelVal(lx: number, ly: number, label: string, value: string, mono = false) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(130, 125, 120);
    doc.text(label.toUpperCase(), lx, ly);
    doc.setFont(mono ? 'courier' : 'helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(26, 26, 26);
    const lines = doc.splitTextToSize(value || '—', 80);
    doc.text(lines[0] ?? '—', lx, ly + 5.5);
    return ly + 5.5 + (lines.length > 1 ? 4 : 0);
  }

  labelVal(col1, y, 'Payee', txn.stakeholders?.name || '—');
  labelVal(col2, y, 'Payee Type', `${txn.stakeholders?.type || '—'}${txn.stakeholders?.category ? ` · ${txn.stakeholders.category}` : ''}`);
  y += 16;

  labelVal(col1, y, 'Payment Mode', effective.payment_mode || '—');
  labelVal(col2, y, 'Category', effective.category || '—');
  y += 16;

  if (effective.remarks) {
    labelVal(col1, y, 'Remarks', effective.remarks);
    y += 14;
  }

  // ── Divider
  y += 2;
  doc.setDrawColor(230, 228, 225);
  doc.line(M, y, W - M, y);
  y += 10;

  // ── Allocations table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(130, 125, 120);
  doc.text('PROJECT ALLOCATIONS', M, y);
  y += 6;

  // Table header
  doc.setFillColor(245, 244, 242);
  doc.rect(M, y, W - M * 2, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 95, 90);
  doc.text('PROJECT', M + 3, y + 4.8);
  doc.text('LINKED ORDER', M + 75, y + 4.8);
  doc.text('AMOUNT', W - M - 3, y + 4.8, { align: 'right' });
  y += 8;

  // Table rows
  for (const a of (allocs || [])) {
    const projName = a.projects?.name || a.project_id || '—';
    const linked = a.order_type && a.order_ref ? `${a.order_type}: ${a.order_ref}${a.wo_milestones?.name ? ` · ${a.wo_milestones.name}` : ''}` : 'Unlinked';
    const amt = `₹${Number(a.allocated_amount).toLocaleString('en-IN')}`;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(26, 26, 26);
    const pLines = doc.splitTextToSize(projName, 68);
    doc.text(pLines[0], M + 3, y + 4.5);

    doc.setFont(a.order_type ? 'courier' : 'helvetica', a.order_type ? 'normal' : 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(a.order_type ? 29 : 120, a.order_type ? 78 : 115, a.order_type ? 216 : 110);
    doc.text(linked, M + 75, y + 4.5);

    doc.setFont('courier', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(26, 26, 26);
    doc.text(amt, W - M - 3, y + 4.5, { align: 'right' });

    y += 8;
    doc.setDrawColor(235, 232, 228);
    doc.setLineWidth(0.2);
    doc.line(M, y, W - M, y);
    y += 1;
  }

  // Total row
  y += 2;
  const totalAmt = `₹${(allocs || []).reduce((s, a) => s + Number(a.allocated_amount), 0).toLocaleString('en-IN')}`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(130, 125, 120);
  doc.text('TOTAL', W - M - 40, y + 4);
  doc.setFont('courier', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(26, 26, 26);
  doc.text(totalAmt, W - M - 3, y + 4, { align: 'right' });
  y += 14;

  // ── Footer
  doc.setDrawColor(230, 228, 225);
  doc.setLineWidth(0.3);
  doc.line(M, y, W - M, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(160, 155, 150);
  doc.text(`Generated by Briklay · ${new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } as Intl.DateTimeFormatOptions)}`, M, y);
  doc.text('This is a system-generated document.', W - M, y, { align: 'right' });

  doc.save(`${txn.txn_id}.pdf`);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TransactionDetail({ session }: { session: Session }) {
  const { txnId } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const focusProjectId = searchParams.get('project');
  const navState = (location.state as { from?: string; projectId?: string; projectName?: string; backTo?: string; backLabel?: string }) || {};
  const qc = useQueryClient();

  const { data: profile } = useUserProfile(session.user.id);

  const navigate = useNavigate();
  const [mappingAllocId, setMappingAllocId] = useState<string | null>(null);
  const [, setSelectedObligation] = useState<SelectedObligation | null>(null);
  const [, setProjectWOs] = useState<any[]>([]);
  const [projectPOs, setProjectPOs] = useState<any[]>([]);
  const [loadingObligations, setLoadingObligations] = useState(false);
  const [voidConfirm, setVoidConfirm] = useState(false);
  const [amendStep, setAmendStep] = useState<'idle' | 'edit' | 'diff'>('idle');
  const [amendForm, setAmendForm] = useState({ total_amount: '', date: '', payment_mode: '', category: '', remarks: '' });
  const [amendError, setAmendError] = useState<string | null>(null);
  const [, setShowAmendHistory] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxTitle, setLightboxTitle] = useState('Document');
  const [showStakeholderDrawer, setShowStakeholderDrawer] = useState(false);

  const { openPeek } = usePeek();

  const isManagement = profile?.role === 'management' || profile?.role === 'principal';
  const canVoid = profile?.role === 'management' || profile?.role === 'accountant' || profile?.role === 'principal';

  const { data: txn, isLoading: txnLoading } = useQuery({
    queryKey: ['transaction', txnId],
    queryFn: async () => {
      const { data, error } = await supabase.from('transactions').select('*, stakeholders(*)').eq('txn_id', txnId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: allocs, isLoading: allocsLoading } = useQuery({
    queryKey: ['txn_allocations', txnId],
    queryFn: async () => {
      const { data, error } = await supabase.from('txn_allocations').select('*, projects(name), wo_milestones(name)').eq('txn_id', txnId);
      if (error) throw error;
      return data;
    },
  });

  // The bill for a PO-linked payment lives on the PO (uploaded there, or via the bill that
  // created it). Fetch each linked PO's bill doc so we can preview it inline on this page.
  const linkedPoIds = Array.from(new Set((allocs || []).filter((a) => a.order_type === 'PO' && a.order_ref).map((a) => a.order_ref as string)));
  const { data: poBills } = useQuery({
    queryKey: ['txn_po_bills', txnId, linkedPoIds.slice().sort().join(',')],
    enabled: linkedPoIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from('purchase_orders').select('po_id, vendor_bill_doc_url, vendor_bill_url').in('po_id', linkedPoIds);
      const map: Record<string, string> = {};
      (data || []).forEach((p: any) => { const u = p.vendor_bill_doc_url || p.vendor_bill_url; if (u) map[p.po_id] = u; });
      return map;
    },
  });

  useEffect(() => {
    if (!mappingAllocId || !txn?.stakeholder_id || !allocs) {
      setProjectWOs([]); setProjectPOs([]); setSelectedObligation(null); return;
    }
    const alloc = (allocs as any[]).find((a: any) => a.allocation_id === mappingAllocId);
    if (!alloc) return;
    let cancelled = false;
    setLoadingObligations(true);
    setSelectedObligation(null);
    Promise.all([
      supabase.from('work_orders')
        .select('wo_id, scope_of_work, order_value, status, stakeholders(name, category), wo_milestones(*)')
        .eq('project_id', alloc.project_id).eq('stakeholder_id', txn.stakeholder_id)
        .not('status', 'in', '("Closed","Cancelled")').order('date_issued', { ascending: false }),
      supabase.from('purchase_orders')
        .select('po_id, status, vendor_bill_amount, total_value, stakeholders(name, category), po_line_items(*)')
        .eq('project_id', alloc.project_id).eq('stakeholder_id', txn.stakeholder_id)
        .in('status', ['ORDERED', 'BILLED', 'PARTIAL']).order('created_at', { ascending: false }),
    ]).then(([{ data: wos, error: woErr }, { data: pos, error: poErr }]) => {
      if (woErr) console.error(woErr);
      if (poErr) console.error(poErr);
      if (!cancelled) { setProjectWOs(wos || []); setProjectPOs(pos || []); setLoadingObligations(false); }
    });
    return () => { cancelled = true; };
  }, [mappingAllocId, txn?.stakeholder_id, allocs]);

  const updateAlloc = useMutation({
    mutationFn: async ({ allocId, order_type, order_ref, milestone_id }: { allocId: string; order_type: string; order_ref: string; milestone_id?: string }) => {
      const { error } = await supabase.from('txn_allocations').update({ order_type, order_ref, milestone_id: milestone_id || null }).eq('allocation_id', allocId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['txn_allocations', txnId] });
      qc.invalidateQueries({ queryKey: ['transaction', txnId] });
      qc.invalidateQueries({ queryKey: ['ledger'] });
      qc.invalidateQueries({ queryKey: ['dashboard_metrics'] });
      if (vars.order_type === 'PO' && vars.order_ref) {
        qc.invalidateQueries({ queryKey: ['po_linked_txns', vars.order_ref] });
        qc.invalidateQueries({ queryKey: ['po_detail', vars.order_ref] });
        qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
        qc.invalidateQueries({ queryKey: ['po_payment_totals'] });
      }
      if (vars.order_type === 'WO' && vars.order_ref) {
        qc.invalidateQueries({ queryKey: ['wo_allocations', vars.order_ref] });
        autoCloseWOIfFullyPaid(vars.order_ref, qc);
      }
      setMappingAllocId(null); setSelectedObligation(null); setProjectWOs([]); setProjectPOs([]);
    },
  });

  const voidMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('transactions').update({ status: 'Voided', voided_by: session.user.id, voided_at: new Date().toISOString() }).eq('txn_id', txnId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transaction', txnId] }); qc.invalidateQueries({ queryKey: ['transactions'] }); setVoidConfirm(false); },
  });

  const amendMutation = useMutation({
    mutationFn: async () => {
      if (!txn) throw new Error('Transaction not loaded.');
      if (!('amendments' in txn)) throw new Error("Amendment column missing. Run: ALTER TABLE transactions ADD COLUMN amendments jsonb DEFAULT '[]'::jsonb;");
      const userName = profile?.name || session.user.email || 'Unknown';
      const newAmendment: AmendmentRecord = {
        id: String(Date.now()), amended_by: userName, amended_at: new Date().toISOString(),
        changes: amendDiff,
        snapshot: { total_amount: Number(amendForm.total_amount), date: amendForm.date, payment_mode: amendForm.payment_mode, category: amendForm.category, remarks: amendForm.remarks },
      };
      const existing: AmendmentRecord[] = (txn as any).amendments || [];
      const { error } = await supabase.from('transactions').update({ amendments: [...existing, newAmendment] }).eq('txn_id', txnId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transaction', txnId] }); qc.invalidateQueries({ queryKey: ['transactions'] }); setAmendStep('idle'); setAmendError(null); setShowAmendHistory(true); },
    onError: (err: any) => setAmendError(err.message || 'Amendment failed.'),
  });

  // ── Redesigned page: kebab menu + the per-allocation "Attach bill" picker ──
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerStep, setPickerStep] = useState<'menu' | 'po'>('menu');
  const billInputRef = useRef<HTMLInputElement>(null);
  const proofInputRef = useRef<HTMLInputElement>(null);

  // "No bill — mark as advance": turn the allocation into an ADVANCE against the party.
  const advanceMutation = useMutation({
    mutationFn: async (allocId: string) => {
      const { error } = await supabase.from('txn_allocations').update({ order_type: 'ADVANCE', order_ref: null, milestone_id: null }).eq('allocation_id', allocId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['txn_allocations', txnId] });
      qc.invalidateQueries({ queryKey: ['transaction', txnId] });
      qc.invalidateQueries({ queryKey: ['ledger'] });
      setMappingAllocId(null);
    },
  });

  // "Upload a new bill": store the file and stamp transactions.bill_doc_url.
  const billUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const ext = file.name.split('.').pop();
      const path = `bills/${txnId}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('documents').upload(path, file, { contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('documents').getPublicUrl(path);
      const { error } = await supabase.from('transactions').update({ bill_doc_url: pub.publicUrl }).eq('txn_id', txnId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transaction', txnId] });
      qc.invalidateQueries({ queryKey: ['ledger'] });
      setMappingAllocId(null);
    },
  });

  // Proof of payment is a SEPARATE document from the bill (receipt / UPI screenshot / Day-Book
  // photo) — stored on transactions.proof_document_url.
  const proofUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const ext = file.name.split('.').pop();
      const path = `proofs/${txnId}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('documents').upload(path, file, { contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('documents').getPublicUrl(path);
      const { error } = await supabase.from('transactions').update({ proof_document_url: pub.publicUrl }).eq('txn_id', txnId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transaction', txnId] });
      qc.invalidateQueries({ queryKey: ['ledger'] });
    },
  });

  const isLoading = txnLoading || allocsLoading;
  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-primary/40" size={28} /></div>;
  if (!txn) return <div className="p-8 text-center text-on-surface-variant/50 text-[14px]">Transaction not found.</div>;

  const existingAmendments: AmendmentRecord[] = (txn as any).amendments || [];
  const latestSnapshot = existingAmendments.length > 0 ? existingAmendments[existingAmendments.length - 1].snapshot : null;
  const effective: AmendmentSnapshot = latestSnapshot ?? { total_amount: txn.total_amount, date: txn.date, payment_mode: txn.payment_mode, category: txn.category, remarks: txn.remarks };
  const isAmended = existingAmendments.length > 0;

  const amendDiff: Record<string, [any, any]> = {};
  if (amendStep === 'diff') {
    const LABELS: Record<string, [keyof AmendmentSnapshot, string]> = {
      Amount: ['total_amount', 'Amount'], Date: ['date', 'Date'], 'Payment Mode': ['payment_mode', 'Payment Mode'], Category: ['category', 'Category'], Remarks: ['remarks', 'Remarks'],
    };
    for (const [label, [key]] of Object.entries(LABELS)) {
      const oldVal = String((effective as any)[key] ?? '');
      const newVal = String((amendForm as any)[key] ?? '');
      if (oldVal !== newVal) amendDiff[label] = [(effective as any)[key], (amendForm as any)[key]];
    }
  }
  const hasDiff = Object.keys(amendDiff).length > 0;

  const openAmendModal = () => {
    setAmendForm({ total_amount: String(effective.total_amount ?? ''), date: effective.date ?? '', payment_mode: effective.payment_mode ?? '', category: effective.category ?? '', remarks: effective.remarks ?? '' });
    setAmendError(null); setAmendStep('edit');
  };

  const primaryAlloc = focusProjectId
    ? (allocs?.find((a) => a.project_id === focusProjectId) ?? allocs?.[0])
    : allocs?.[0];
  const secondaryAllocs = allocs?.filter((a) => a !== primaryAlloc) ?? [];

  const txnDate = effective.date ? new Date(effective.date) : null;
  const txnDateTime = txn.created_at ? new Date(txn.created_at) : null;
  const dateStr = txnDate ? txnDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
  const timeStr = txnDateTime ? txnDateTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
  const isVoided = txn.status === 'Voided';

  // Direction drives the amount accent: Client receipt = money IN (sage), else OUT (terracotta).
  const isIn = txn.stakeholders?.type === 'Client';

  // ── Redesigned-page derivations ──
  const backTo = navState.backTo || (navState.from === 'project' && navState.projectId ? `/projects/${navState.projectId}/transactions` : '/ledger');
  const backLabel = navState.backLabel || (navState.from === 'project' ? 'Transactions' : 'Ledger');
  const payeeName: string = txn.stakeholders?.name || (isGeneralExpense(txn) ? ((txn as any).ai_flag_data?.general_payee || generalExpenseLabel(txn)) : 'Unknown');
  const payeeType: string = txn.stakeholders?.type || '';
  const payeeCategory: string = txn.stakeholders?.category || '';
  const initials = (payeeName.split(/\s+/).map((w: string) => w[0]).filter(Boolean).slice(0, 2).join('') || '—').toUpperCase();
  const recordedBy: string = (txn as any).created_by_name || (txn as any).recorded_by_name || (txn as any).ordered_by || '';
  const totalAllocated = (allocs || []).reduce((s, a) => s + Number(a.allocated_amount), 0);
  const allAllocs = primaryAlloc ? [primaryAlloc, ...secondaryAllocs] : (allocs || []);
  const billLinked = !!primaryAlloc?.order_type || !!txn.bill_doc_url;
  const rupee = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  const openPicker = (allocId: string) => { setPickerStep('menu'); setMappingAllocId(allocId); };
  const openLightbox = (url: string, title: string) => { setLightboxTitle(title); setLightboxUrl(url); };

  return (
    <div className={`txnx${isVoided ? ' voided-mark' : ''}`}>
      <style>{TXNX_CSS}</style>
      <div className="page">

        <div className="crumb"><a onClick={() => navigate(backTo)}>{backLabel}</a> › <b>{txn.txn_id}</b></div>

        {/* header */}
        <div className="head">
          <div>
            <h1>{isIn ? 'Payment in' : 'Payment out'} <span className="tag mono">{txn.txn_id}</span></h1>
            <div className="meta">
              <span><b>{dateStr}</b>{timeStr ? ` · ${timeStr}` : ''}</span>
              {effective.payment_mode && <><span className="sep" /><span className="pill">{effective.payment_mode}</span></>}
              {recordedBy && <span>Recorded by <b>{recordedBy}</b></span>}
              <span className="sep" />
              <span className="chip sage" style={isVoided ? { color: 'var(--terra)', background: 'var(--terra-tint)' } : undefined}><i style={isVoided ? { background: 'var(--terra)' } : undefined} />{isVoided ? 'Voided' : (txn.status || 'Active')}</span>
              {!isVoided && !billLinked && (
                <span className="chip warn" onClick={() => { document.getElementById('txnx-alloc')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); const a = allAllocs.find((x) => !x.order_type); if (a) setTimeout(() => openPicker(a.allocation_id), 350); }}><i />No bill attached — attach now</span>
              )}
              {txn.ai_flag_status === 'Flagged' && <span className="chip gold"><i />Flagged</span>}
            </div>
          </div>
          <div className={`amount${isIn ? ' in' : ''}`}>
            <small>{isIn ? '↙ Money in' : '↗ Money out'}</small>
            <span className="mono">{isIn ? '+₹' : '−₹'}{(Number(effective.total_amount) || 0).toLocaleString('en-IN')}</span>
            <div className="dir">{isIn ? `Received from ${payeeName}` : `${payeeName} was paid`}{effective.payment_mode ? ` · ${effective.payment_mode}` : ''}</div>
          </div>
          <div className="more">
            <button className="kebab" aria-label="More actions" onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
            </button>
            {menuOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 25 }} onClick={() => setMenuOpen(false)} />
                <div className="menu">
                  <button onClick={() => { setMenuOpen(false); generatePDF(txn, allocs || [], effective, isAmended); }}><svg viewBox="0 0 24 24"><path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" /></svg>Download voucher PDF</button>
                  {(isManagement || profile?.role === 'accountant') && !isVoided && <button onClick={() => { setMenuOpen(false); openAmendModal(); }}><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /></svg>Amend</button>}
                  {canVoid && !isVoided && (
                    <>
                      <hr />
                      <button className="danger" onClick={() => { setMenuOpen(false); setVoidConfirm(true); }}><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>Void transaction</button>
                      <div className="hint">Voiding keeps the record but reverses it in the books.</div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* details */}
        <div className="sec"><h2>Details</h2></div>
        <div className="sheet hdr">
          <table>
            <colgroup><col style={{ width: 110 }} /><col /><col style={{ width: 110 }} /><col /></colgroup>
            <tbody>
              <tr>
                <th>Paid to</th>
                <td>
                  <div className="who">
                    <span className="av">{initials}</span>
                    {txn.stakeholder_id ? <a onClick={() => setShowStakeholderDrawer(true)}>{payeeName}</a> : <b>{payeeName}</b>}
                    <small>{[payeeType, payeeCategory].filter(Boolean).join(' · ') || (isGeneralExpense(txn) ? 'Overhead · no linked party' : '—')}</small>
                  </div>
                </td>
                <th>Project</th>
                <td>{primaryAlloc ? <><b>{primaryAlloc.projects?.name || primaryAlloc.project_id}</b><small>{primaryAlloc.project_id}{secondaryAllocs.length > 0 ? ` · +${secondaryAllocs.length} more` : ''}</small></> : <span className="dim">—</span>}</td>
              </tr>
              <tr>
                <th>Remarks</th>
                <td colSpan={3}>{effective.remarks ? effective.remarks : <span className="dim">No remarks</span>}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* where this money went */}
        <div className="sec" id="txnx-alloc"><h2>Where this money went</h2></div>
        <div className="sheet alloc">
          <table>
            <colgroup><col style={{ width: '34%' }} /><col /><col style={{ width: '20%' }} /></colgroup>
            <thead><tr><th>Project</th><th>Bill</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {allAllocs.map((a) => {
                const linked = a.order_type;
                const isPO = linked === 'PO';
                const isWO = linked === 'WO';
                const isAdv = linked === 'ADVANCE';
                const milestoneName = (a as any).wo_milestones?.name ?? null;
                const picking = mappingAllocId === a.allocation_id;
                const hasBill = isPO || isWO || isAdv || !!txn.bill_doc_url;
                return (
                  <tr key={a.allocation_id}>
                    <td><b style={{ fontWeight: 600 }}>{a.projects?.name || 'Unassigned'}</b></td>
                    <td>
                      <div className="lnk">
                        {isPO || isWO ? (
                          <>
                            <span className="st ok" onClick={() => openPeek(linked as 'WO' | 'PO', a.order_ref)} style={{ cursor: 'pointer' }}>✓ {a.order_ref}<small>{isPO ? (poBills?.[a.order_ref] ? 'Bill on PO · tap to preview' : 'Bill on PO') : 'Contract'}{milestoneName ? ` · ${milestoneName}` : ''}</small></span>
                            {isPO && poBills?.[a.order_ref] && <DocThumb stored={poBills[a.order_ref]} onImageClick={(u) => openLightbox(u, 'Bill / Invoice')} />}
                          </>
                        ) : isAdv ? (
                          <span className="st adv">Advance to {payeeName}<small>No bill yet · adjusts into the next bill</small></span>
                        ) : txn.bill_doc_url ? (
                          <>
                            <span className="st ok">✓ Bill attached<small>Uploaded · tap to preview</small></span>
                            <DocThumb stored={txn.bill_doc_url} onImageClick={(u) => openLightbox(u, 'Bill / Invoice')} />
                          </>
                        ) : (
                          <span className="st un">No bill<small>Link a PO bill or upload one</small></span>
                        )}
                        {!isVoided && (
                          <span className="pickwrap">
                            {hasBill
                              ? <button className="ghost" onClick={() => openPicker(a.allocation_id)}>Change</button>
                              : <button className="linkbtn" onClick={() => openPicker(a.allocation_id)}>Attach bill</button>}
                            {picking && (
                              <>
                                <div style={{ position: 'fixed', inset: 0, zIndex: 35 }} onClick={() => setMappingAllocId(null)} />
                                <div className="picker">
                                  {pickerStep === 'menu' ? (
                                    <>
                                      <button onClick={() => setPickerStep('po')}><b><svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1.5 1.5M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1.5-1.5" /></svg>Link to a PO</b><span className="mono">{loadingObligations ? '…' : `${projectPOs.length} open`}</span><small>Use the bill already recorded on a purchase order</small></button>
                                      <button onClick={() => { setMappingAllocId(a.allocation_id); billInputRef.current?.click(); }}><b><svg viewBox="0 0 24 24"><path d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" /></svg>Upload a new bill</b><span /><small>Photo or PDF of the vendor's bill</small></button>
                                      <button className="adv" onClick={() => advanceMutation.mutate(a.allocation_id)}><b><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>No bill — mark as advance</b><span /><small>Sits against {payeeName}, adjusts into the next bill</small></button>
                                    </>
                                  ) : (
                                    <>
                                      <h5><button className="bk" onClick={() => setPickerStep('menu')}>&lsaquo;</button> Open POs · {payeeName}</h5>
                                      {loadingObligations ? (
                                        <button disabled><b>Loading…</b></button>
                                      ) : projectPOs.length === 0 ? (
                                        <button disabled><b>No open POs</b><span /><small>Upload a bill or mark as advance instead</small></button>
                                      ) : (
                                        projectPOs.map((po: any) => {
                                          const bal = getPOBalance(po);
                                          return <button key={po.po_id} onClick={() => updateAlloc.mutate({ allocId: a.allocation_id, order_type: 'PO', order_ref: po.po_id })}><b>{po.po_id}</b><span className="mono">{rupee(bal)} due</span><small>{po.stakeholders?.category || 'Purchase order'}{po.status ? ` · ${po.status}` : ''}</small></button>;
                                        })
                                      )}
                                    </>
                                  )}
                                </div>
                              </>
                            )}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="num" style={{ fontWeight: 500 }}>{rupee(Number(a.allocated_amount))}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td colSpan={2} style={{ textAlign: 'right' }}>Total allocated</td><td className="num">{rupee(totalAllocated)}</td></tr></tfoot>
          </table>
        </div>
        <input ref={billInputRef} type="file" accept="image/*,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) billUploadMutation.mutate(f); }} />

        {/* proof of payment — a SEPARATE doc from the bill (receipt / UPI screenshot / Day-Book
            photo captured while recording the payment). Lives on transactions.proof_document_url. */}
        <div className="sec"><h2>Proof of payment</h2></div>
        <div className="sheet" style={{ padding: 16 }}>
          {txn.proof_document_url ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <DocThumb stored={txn.proof_document_url} onImageClick={(u) => openLightbox(u, 'Proof of payment')} w={54} h={68} label="View proof" />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>Payment proof attached</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Receipt / screenshot · tap to preview</div>
              </div>
              {!isVoided && <button className="ghost" style={{ marginLeft: 'auto' }} onClick={() => proofInputRef.current?.click()}>Replace</button>}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>No proof of payment attached yet.</span>
              {!isVoided && (
                <button className="linkbtn" style={{ marginLeft: 'auto' }} disabled={proofUploadMutation.isPending} onClick={() => proofInputRef.current?.click()}>
                  {proofUploadMutation.isPending ? 'Uploading…' : 'Upload proof'}
                </button>
              )}
            </div>
          )}
        </div>
        <input ref={proofInputRef} type="file" accept="image/*,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) proofUploadMutation.mutate(f); }} />

        {/* activity */}
        <div className="sec"><h2>Activity</h2></div>
        <div className="sheet"><ul className="log">
          {isVoided && txn.voided_at && (
            <li><span className="mono">{new Date(txn.voided_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span><i /><span><b>Voided</b> — reversed in the books</span></li>
          )}
          {[...existingAmendments].reverse().map((am: any) => (
            <li key={am.id}><span className="mono">{new Date(am.amended_at || am.moved_at || txn.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span><i /><span><b>{am.amended_by || am.moved_by || 'Someone'}</b> amended {Object.keys(am.changes || {}).join(', ') || 'this transaction'}</span></li>
          ))}
          <li><span className="mono">{new Date(txn.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span><i /><span><b>{recordedBy || 'Recorded'}</b> {rupee(Number(txn.total_amount))} {isIn ? 'received from' : 'paid to'} {payeeName}{effective.payment_mode ? ` by ${effective.payment_mode}` : ''}</span></li>
        </ul></div>
      </div>

      {/* ── VOID STAMP ─────────────────────────────────────────────── */}
      {isVoided && (
        <div className="pointer-events-none fixed top-32 right-10 z-10"
          style={{ transform: 'rotate(-18deg)' }}>
          <div className="border-[3px] border-red-500 text-red-500 font-black text-[28px] px-4 py-2 rounded-lg tracking-widest opacity-30">
            VOID
          </div>
        </div>
      )}

      {/* ── VOID CONFIRM MODAL ──────────────────────────────────────── */}
      {voidConfirm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setVoidConfirm(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl border border-outline-variant/20 w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-error-container flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[20px] text-error">block</span>
              </div>
              <h3 className="text-[17px] font-bold text-error">Void Transaction</h3>
            </div>
            <p className="text-[13px] text-on-surface-variant mb-5 leading-relaxed">
              Void <strong className="font-mono text-on-surface">{txn.txn_id}</strong> for{' '}
              <strong className="font-mono">₹{Number(effective.total_amount).toLocaleString('en-IN')}</strong>?
              This will be permanently excluded from all reports.
            </p>
            {voidMutation.isError && (
              <p className="text-error text-[13px] mb-4 p-3 bg-error-container/30 rounded-xl">
                {(voidMutation.error as any)?.message || 'Failed to void transaction.'}
              </p>
            )}
            <div className="flex gap-3 justify-end">
              <button onClick={() => setVoidConfirm(false)}
                className="px-5 py-2.5 rounded-xl border border-outline-variant/30 text-[13px] font-semibold text-on-surface hover:bg-surface-container-low transition-colors">
                Go Back
              </button>
              <button onClick={() => voidMutation.mutate()} disabled={voidMutation.isPending}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-error text-white font-semibold text-[13px] hover:bg-error/90 disabled:opacity-50 transition-opacity">
                {voidMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <span className="material-symbols-outlined text-[15px]">block</span>}
                Void Transaction
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── IMAGE LIGHTBOX ───────────────────────────────────────────── */}
      <ImageLightbox url={lightboxUrl} title={lightboxTitle} onClose={() => setLightboxUrl(null)} />

      {/* ── AMEND MODAL ─────────────────────────────────────────────── */}
      {amendStep !== 'idle' && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setAmendStep('idle'); setAmendError(null); } }}>
          <div className="bg-white rounded-2xl shadow-2xl border border-outline-variant/20 w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">

            {amendStep === 'edit' && (
              <>
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[20px] text-blue-700">edit_note</span>
                  </div>
                  <div>
                    <h3 className="text-[17px] font-bold text-on-surface">Amend Transaction</h3>
                    <p className="text-[11px] text-on-surface-variant/50 font-mono">{txn.txn_id}</p>
                  </div>
                </div>

                <div className="mb-5 p-4 bg-surface-container-low rounded-xl border border-outline-variant/20 space-y-2">
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide mb-2">Non-amendable fields</p>
                  {[{ label: 'TXN ID', value: txn.txn_id }, { label: 'Payee', value: `${txn.stakeholders?.name || 'Unknown'} · ${txn.stakeholders?.type || ''}` }].map((f) => (
                    <div key={f.label} className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[14px] text-on-surface-variant/40 shrink-0">lock</span>
                      <div>
                        <p className="text-[10px] font-bold text-on-surface-variant">{f.label}</p>
                        <p className="text-[13px] text-on-surface-variant">{f.value}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide block mb-1.5">Amount (₹)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono font-bold text-on-surface">₹</span>
                      <input type="number" min="0" step="0.01" value={amendForm.total_amount}
                        onChange={(e) => setAmendForm(f => ({ ...f, total_amount: e.target.value }))}
                        className="bk-input pl-8 font-mono font-bold" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide block mb-1.5">Date</label>
                    <input type="date" value={amendForm.date} onChange={(e) => setAmendForm(f => ({ ...f, date: e.target.value }))} className="bk-input" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide block mb-1.5">Payment Mode</label>
                    <select value={amendForm.payment_mode} onChange={(e) => setAmendForm(f => ({ ...f, payment_mode: e.target.value }))} className="bk-input">
                      {['NEFT', 'UPI', 'Cheque', 'Cash'].map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide block mb-1.5">Category</label>
                    <select value={amendForm.category} onChange={(e) => setAmendForm(f => ({ ...f, category: e.target.value }))} className="bk-input">
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      {!CATEGORIES.includes(amendForm.category) && amendForm.category && <option value={amendForm.category}>{amendForm.category}</option>}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide block mb-1.5">Remarks</label>
                    <textarea value={amendForm.remarks} onChange={(e) => setAmendForm(f => ({ ...f, remarks: e.target.value }))} rows={3} className="bk-input resize-none w-full" placeholder="Reason for amendment…" />
                  </div>
                </div>

                {amendError && <p className="mt-3 text-error text-[13px]">{amendError}</p>}

                <div className="flex gap-3 justify-end mt-6">
                  <button onClick={() => { setAmendStep('idle'); setAmendError(null); }}
                    className="px-5 py-2.5 rounded-xl border border-outline-variant/30 text-[13px] font-semibold text-on-surface hover:bg-surface-container-low transition-colors">Cancel</button>
                  <button onClick={() => {
                    const LABELS: Record<string, keyof AmendmentSnapshot> = { Amount: 'total_amount', Date: 'date', 'Payment Mode': 'payment_mode', Category: 'category', Remarks: 'remarks' };
                    const hasDifference = Object.entries(LABELS).some(([, key]) => String((effective as any)[key] ?? '') !== String((amendForm as any)[key] ?? ''));
                    if (!hasDifference) { setAmendError('No changes detected.'); return; }
                    setAmendError(null); setAmendStep('diff');
                  }} className="bk-btn flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px]">arrow_forward</span> Review Changes
                  </button>
                </div>
              </>
            )}

            {amendStep === 'diff' && (
              <>
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[20px] text-blue-700">compare_arrows</span>
                  </div>
                  <h3 className="text-[17px] font-bold text-on-surface">Confirm Amendment</h3>
                </div>
                <p className="text-[13px] text-on-surface-variant mb-4">You are making the following changes:</p>
                {!hasDiff ? (
                  <p className="text-on-surface-variant italic text-[13px] mb-4">No changes detected.</p>
                ) : (
                  <div className="space-y-2 mb-5">
                    {Object.entries(amendDiff).map(([label, [oldVal, newVal]]) => (
                      <div key={label} className="flex items-start gap-3 p-3.5 bg-blue-50/60 rounded-xl border border-blue-100/80">
                        <span className="material-symbols-outlined text-[16px] text-blue-400 mt-0.5 shrink-0">swap_horiz</span>
                        <div>
                          <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wide mb-1">{label}</p>
                          <p className="text-[13px]">
                            <span className="line-through text-on-surface-variant/50 mr-2">{fmtAmendVal(label, oldVal)}</span>
                            <span className="text-blue-700 font-semibold">{fmtAmendVal(label, newVal)}</span>
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {amendError && <p className="text-error text-[13px] mb-4 p-3 bg-error-container/30 rounded-xl whitespace-pre-wrap">{amendError}</p>}
                <div className="flex gap-3 justify-end">
                  <button onClick={() => { setAmendStep('edit'); setAmendError(null); }}
                    className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl border border-outline-variant/30 text-[13px] font-semibold text-on-surface hover:bg-surface-container-low transition-colors">
                    <span className="material-symbols-outlined text-[16px]">arrow_back</span> Go Back
                  </button>
                  <button onClick={() => amendMutation.mutate()} disabled={amendMutation.isPending || !hasDiff} className="bk-btn flex items-center gap-2 disabled:opacity-50">
                    {amendMutation.isPending
                      ? <><Loader2 size={15} className="animate-spin" /> Saving…</>
                      : <><span className="material-symbols-outlined text-[16px]">check_circle</span> Confirm Amendment</>}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Stakeholder Ledger Drawer */}
      {txn && txn.stakeholder_id && (
        <StakeholderLedgerDrawer
          isOpen={showStakeholderDrawer}
          onClose={() => setShowStakeholderDrawer(false)}
          stakeholderId={txn.stakeholder_id}
        />
      )}
    </div>
  );
}
