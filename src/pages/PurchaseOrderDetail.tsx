import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import Breadcrumb from '../components/Breadcrumb';
import { BackLink } from '../components/BackLink';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import confetti from 'canvas-confetti';
import { supabase } from '../lib/supabase';
import { openDoc, parseStoredPath } from '../lib/storage';
import { poGateState } from '../lib/poLifecycle';
import { useSnackbar } from '../components/Snackbar';
import { PageSkeleton } from '../components/SkeletonLoader';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import { useOrgId } from '../lib/auth/AuthProvider';
import { usePeek } from '../context/PeekContextCore';
import type { POLineItem, POApproval } from '../types';
import ReceiveAtSiteDrawer from '../components/ReceiveAtSiteDrawer';
import StakeholderLedgerDrawer from '../components/StakeholderLedgerDrawer';
import { downloadGRNChallan } from '../lib/grnChallan';
import {
  fmtDate as pdfFmtDate, fmtRupee, amountInWords,
  MARGIN, CONTENT, RIGHT, C,
  setColor, drawRule, sectionLabel, valueText, drawHeader, drawFooter, drawSignatures,
} from '../lib/pdfHelpers';
import { formatTxn } from '../lib/formatTxn';
import { parseAmount } from '../lib/money';

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  'ORDERED':   'bg-[#EFF6FF] text-[#3B82F6]',
  'BILLED':    'bg-[#FFFBEB] text-[#D97706]',
  'PARTIAL':   'bg-[#FFF7ED] text-[#EA580C]',
  'PAID':      'bg-[#F0FDF4] text-[#16A34A]',
  'CANCELLED': 'bg-[#F9FAFB] text-[#6B7280]',
};

const STATUS_DOT: Record<string, string> = {
  'ORDERED':   'bg-[#3B82F6]',
  'BILLED':    'bg-[#D97706]',
  'PARTIAL':   'bg-[#EA580C]',
  'PAID':      'bg-[#16A34A]',
  'CANCELLED': 'bg-[#6B7280]',
};

const STATUS_LABEL: Record<string, string> = {
  'ORDERED':   'Ordered',
  'BILLED':    'Billed',
  'PARTIAL':   'Partially Paid',
  'PAID':      'Paid',
  'CANCELLED': 'Cancelled',
};

function isOverdue(po: any): boolean {
  if (!po.expected_delivery) return false;
  const d = new Date(po.expected_delivery);
  if (isNaN(d.getTime())) return false;
  if (['BILLED', 'PARTIAL', 'PAID', 'CANCELLED'].includes(po.status)) return false;
  return d < new Date();
}

// ── Reconciliation types ──────────────────────────────────────────────────────

interface ReconLineMatch {
  po_line:      string;
  bill_line:    string | null;
  matched:      boolean;
  flags:        string[];
  flag_details: string;
  po_qty:       number;
  bill_qty:     number | null;
  po_rate:      number;
  bill_rate:    number | null;
  po_amount:    number;
  bill_amount:  number | null;
}

interface ReconGhostItem {
  item:   string;
  amount: number;
}

interface ReconResult {
  summary:               string;
  risk_level:            'LOW' | 'MEDIUM' | 'HIGH';
  bill_total_extracted:  number | null;
  line_matches:          ReconLineMatch[];
  ghost_items:           ReconGhostItem[];
  overall_flags:         string[];
}

const FLAG_LABEL: Record<string, string> = {
  BRAND_STRIPPED:          'Brand Stripped',
  GRADE_DOWNGRADE:         'Grade Downgrade',
  QTY_INFLATION:           'Qty Inflation',
  RATE_INCREASE:           'Rate Increase',
  UNIT_MISMATCH:           'Unit Mismatch',
  GHOST_ITEM:              'Ghost Item',
  DUPLICATE_ITEM:          'Duplicate Item',
  AMOUNT_ARITHMETIC_ERROR: 'Arithmetic Error',
  HSN_MISMATCH:            'HSN Mismatch',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const parsed = new Date(d);
  if (isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}


// ── Count-up hook ─────────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 500): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);
  useEffect(() => {
    let start: number | null = null;
    const animate = (ts: number) => {
      if (!start) start = ts;
      const elapsed = ts - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - (1 - progress) * (1 - progress);
      setValue(Math.round(eased * target));
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);
  return value;
}

function fireCelebration() {
  confetti({ particleCount: 60, spread: 50, origin: { y: 0.6 }, colors: ['#C8603A', '#16A34A', '#D97706', '#ffffff'] });
}

// ── BillEntryForm ─────────────────────────────────────────────────────────────

interface BillEntryFormProps {
  poId: string;
  currentUserName: string;
  onBillSaved: (data: { billAmount: number; billNo: string; billUrl: string | null }) => void;
}

function BillEntryForm({ poId, currentUserName, onBillSaved }: BillEntryFormProps) {
  const [billNo, setBillNo]         = useState('');
  const [billAmount, setBillAmount] = useState('');
  const [billDate, setBillDate]     = useState(new Date().toISOString().split('T')[0]);
  const [billFile, setBillFile]     = useState<File | null>(null);
  const [uploading, setUploading]   = useState(false);
  const [saving, setSaving]         = useState(false);
  const qc = useQueryClient();

  const bill    = parseAmount(billAmount);
  const canSave = bill > 0;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    let billUrl: string | null = null;
    if (billFile) {
      setUploading(true);
      const ext = billFile.type === 'application/pdf' ? 'pdf' : 'jpg';
      // ONE path for both upload and URL — calling Date.now() twice stored a URL whose timestamp
      // didn't match the uploaded object, so the file could never be signed/opened afterwards.
      const path = `po-bills/bill_${poId}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('documents').upload(path, billFile, { contentType: billFile.type });
      if (!upErr) {
        const { data: pub } = supabase.storage.from('documents').getPublicUrl(path);
        billUrl = pub.publicUrl;
      }
      setUploading(false);
    }
    const { error } = await supabase.from('purchase_orders').update({
      vendor_bill_number:    billNo.trim() || null,
      vendor_bill_no:        billNo.trim() || null,
      vendor_bill_amount:    bill,
      vendor_bill_date:      billDate,
      vendor_bill_url:       billUrl,
      vendor_bill_doc_url:   billUrl,
      bill_recorded_at:      new Date().toISOString(),
      bill_recorded_by_name: currentUserName,
      status:                'BILLED',
    }).eq('po_id', poId);
    setSaving(false);
    if (!error) {
      qc.invalidateQueries({ queryKey: ['po_detail', poId] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      onBillSaved({ billAmount: bill, billNo: billNo.trim(), billUrl });
    }
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wide text-amber-700 mb-1 block">Bill / Invoice No</label>
          <input type="text" placeholder="e.g. INV-2023-0445" value={billNo} onChange={e => setBillNo(e.target.value)}
            className="w-full text-[13px] px-3 py-2 border border-amber-300 rounded-lg bg-white focus:outline-none focus:border-amber-500" />
        </div>
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wide text-amber-700 mb-1 block">Bill Date</label>
          <input type="date" value={billDate} onChange={e => setBillDate(e.target.value)}
            className="w-full text-[13px] px-3 py-2 border border-amber-300 rounded-lg bg-white focus:outline-none focus:border-amber-500" />
        </div>
      </div>
      <div>
        <label className="text-[11px] font-bold uppercase tracking-wide text-amber-700 mb-1 block">
          Bill Amount *
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] font-medium text-amber-700">₹</span>
          <input type="number" placeholder="0" value={billAmount} onChange={e => setBillAmount(e.target.value)} autoFocus
            className="w-full text-[16px] font-semibold pl-7 pr-4 py-3 border-2 border-amber-400 rounded-lg bg-white focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-200" />
        </div>
      </div>
      <div>
        <label className="text-[11px] font-bold uppercase tracking-wide text-amber-700 mb-1 block">
          Bill Document <span className="text-[10px] font-normal normal-case">(PDF or image)</span>
        </label>
        {billFile ? (
          <div className="flex items-center gap-2 p-3 border border-amber-300 rounded-lg bg-white">
            <span className="material-symbols-outlined text-[16px] text-amber-500">attach_file</span>
            <p className="text-[13px] flex-1 truncate">{billFile.name}</p>
            <button onClick={() => setBillFile(null)} className="text-[11px] text-on-surface-variant hover:text-red-500">Remove</button>
          </div>
        ) : (
          <label className="flex items-center gap-2 p-3 border border-dashed border-amber-300 rounded-lg bg-white cursor-pointer hover:border-amber-500 transition-colors">
            <span className="material-symbols-outlined text-[16px] text-amber-500">upload_file</span>
            <span className="text-[13px] text-amber-700">Upload vendor bill</span>
            <input type="file" accept="image/jpeg,image/png,image/jpg,application/pdf"
              onChange={e => setBillFile(e.target.files?.[0] || null)} className="hidden" />
          </label>
        )}
      </div>
      <button onClick={handleSave} disabled={!canSave || saving}
        className={`w-full h-11 rounded-lg text-[14px] font-semibold transition-all ${canSave && !saving
          ? 'bg-amber-500 text-white hover:bg-amber-600 shadow-md shadow-amber-200'
          : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
        {saving ? (uploading ? 'Uploading…' : 'Saving…')
          : `Record Bill${billAmount ? ` — ₹${parseFloat(billAmount).toLocaleString('en-IN')}` : ''}`}
      </button>
    </div>
  );
}

// ── BillSummaryCard ───────────────────────────────────────────────────────────

function BillSummaryCard({ po, activeTxns, onNavigate }: { po: any; activeTxns: any[]; onNavigate: (p: string) => void }) {
  const totalPaid = activeTxns.reduce((s: number, t: any) => s + (Number(t.allocated_amount) || 0), 0);
  const billAmt   = Number(po.vendor_bill_amount) || 0;
  const balance   = billAmt - totalPaid;
  const billNo    = po.vendor_bill_number || po.vendor_bill_no || null;
  const billUrl   = po.vendor_bill_url || po.vendor_bill_doc_url || null;

  return (
    <div className="rounded-xl border border-outline-variant/20 bg-white p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-on-surface-variant/60 mb-0.5">Vendor Bill</p>
          <p className="text-[14px] font-medium text-on-surface">{billNo || 'No bill number'}</p>
          {po.vendor_bill_date && <p className="text-[11px] text-on-surface-variant/50">{fmtDate(po.vendor_bill_date)}</p>}
        </div>
        {billUrl && (
          <button type="button" onClick={() => openDoc(billUrl)}
            className="text-[12px] text-[#C8603A] hover:underline flex items-center gap-1">
            View bill <span className="material-symbols-outlined text-[13px]">open_in_new</span>
          </button>
        )}
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-[12px]">
          <span className="text-on-surface-variant/60">Bill Amount</span>
          <span className="font-data-mono font-medium text-[#16A34A]">₹{billAmt.toLocaleString('en-IN')}</span>
        </div>
        <div className="h-px bg-outline-variant/15 my-1" />
        <div className="flex justify-between text-[12px]">
          <span className="text-on-surface-variant/60">Total Paid</span>
          <span className="font-data-mono">₹{totalPaid.toLocaleString('en-IN')}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[13px] font-semibold text-on-surface">
            {balance > 0 ? 'Balance Due' : balance < 0 ? 'Overpaid' : 'Settled'}
          </span>
          <span className={`text-[14px] font-bold font-data-mono ${balance > 0 ? 'text-[#DC2626]' : balance < 0 ? 'text-amber-600' : 'text-[#16A34A]'}`}>
            {balance === 0 ? '₹0 ✓' : `₹${Math.abs(balance).toLocaleString('en-IN')}`}
          </span>
        </div>
      </div>
      {activeTxns.length > 0 && (
        <div className="mt-4 pt-3 border-t border-outline-variant/10">
          <p className="text-[10px] uppercase tracking-wide text-on-surface-variant/60 mb-2">Payments</p>
          {activeTxns.map((t: any) => {
            const f = formatTxn({ ...t.transactions, total_amount: t.allocated_amount }, 'po');
            return (
              <div key={t.id} onClick={() => onNavigate(`/ledger/${t.transactions?.txn_id}`)}
                className="flex justify-between py-1.5 cursor-pointer hover:bg-surface-container-low/30 rounded px-1 group">
                <div className="min-w-0 flex-1 pr-2">
                  <p className="text-[11px] font-[500] text-on-surface flex items-center gap-1.5 truncate">
                    {f.primary}
                    {t.transactions?.category === 'PO Advance' && (
                      <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200/50 inline-flex items-center shrink-0">
                        Advance
                      </span>
                    )}
                  </p>
                  {f.secondary && <p className="text-[10px] text-on-surface-variant/60 truncate">{f.secondary}</p>}
                  <p className="text-[9px] font-mono text-on-surface-variant/25 opacity-0 group-hover:opacity-100 transition-opacity">{t.transactions?.txn_id}</p>
                </div>
                <p className="text-[12px] font-medium font-data-mono shrink-0">₹{Number(t.allocated_amount).toLocaleString('en-IN')}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── SectionLabel ──────────────────────────────────────────────────────────────

function SectionLabel({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="material-symbols-outlined text-[15px] text-on-surface-variant/40">{icon}</span>
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-on-surface-variant/50">{label}</span>
      <div className="flex-1 h-px bg-outline-variant/15" />
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

// ── Reference PO-detail styling (po-detail.html), scoped under .podx so it can't leak into the app.
//    Fonts swapped to the app's existing stacks per decision (serif title, system sans, mono numerics).
const PODX_CSS = `
.podx{
  --cream:#F6F2EA; --paper:#FFFDF9; --paper-2:#FBF8F2;
  --ink:#2F2622; --ink-2:#6E635B; --ink-3:#A39A91;
  --line:#E4DCD0; --line-2:#EFE9DF;
  --terra:#C4613A; --terra-deep:#A94E2B; --terra-tint:#F8E7DE;
  --sage:#5F7F5B; --sage-tint:#E7EFE4;
  --gold:#B8862E; --gold-tint:#F7EEDA;
  --r:8px; --ease:cubic-bezier(.2,.7,.2,1);
  --serif:Georgia,'Times New Roman',serif;
  --sans:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  --mono:ui-monospace,'SF Mono',Menlo,Consolas,monospace;
  background:var(--cream);color:var(--ink);font:15px/1.45 var(--sans);-webkit-font-smoothing:antialiased;min-height:100vh;
}
.podx *{box-sizing:border-box}
.podx button,.podx input,.podx select{font:inherit;color:inherit}
.podx input::placeholder{color:var(--ink-3)}
.podx .mono{font-family:var(--mono);font-feature-settings:"tnum";font-variant-numeric:tabular-nums}
.podx .page{max-width:100%;margin:0 auto;padding:22px 32px 80px}
.podx .crumb{display:flex;align-items:center;gap:6px;color:var(--ink-3);font-size:13px;margin-bottom:18px}
.podx .crumb a{color:var(--ink-2);text-decoration:none;padding:4px 6px;border-radius:6px;margin-left:-6px;cursor:pointer;transition:background .15s}
.podx .crumb a:hover{background:var(--paper)}
.podx .crumb b{color:var(--ink);font-weight:500}
.podx .head{display:grid;grid-template-columns:1fr auto;gap:12px 24px;align-items:start;margin-bottom:18px}
.podx .head h1{font:600 28px/1.1 var(--serif);margin:0 0 8px;letter-spacing:-.01em;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.podx .tag{font:500 13px/1 var(--mono);letter-spacing:.04em;color:var(--ink-2);background:var(--paper);border:1px solid var(--line);padding:6px 9px;border-radius:6px}
.podx .head .meta{color:var(--ink-2);font-size:14px;display:flex;flex-wrap:wrap;gap:4px 14px}
.podx .head .meta b{color:var(--ink);font-weight:500}
.podx .head .meta a{color:var(--ink);text-decoration:none;border-bottom:1px dashed var(--ink-3);cursor:pointer}
.podx .head .meta a:hover{border-bottom-style:solid;color:var(--terra)}
.podx .value{text-align:right}
.podx .value small{display:block;font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-2);margin-bottom:2px}
.podx .value .mono{font-size:34px;font-weight:500;letter-spacing:-.02em;line-height:1}
.podx .value .mono::first-letter{color:var(--ink-3);font-weight:400}
.podx .more{position:relative}
.podx .kebab{width:36px;height:36px;border-radius:50%;border:1px solid transparent;background:transparent;cursor:pointer;display:grid;place-items:center;color:var(--ink-2);transition:background .15s,border-color .15s,transform .12s}
.podx .kebab:hover{background:var(--paper);border-color:var(--line)}
.podx .kebab:active{transform:scale(.92)}
.podx .menu{position:absolute;right:0;top:calc(100% + 6px);background:var(--paper);border:1px solid var(--line);border-radius:var(--r);box-shadow:0 12px 30px -12px rgba(47,38,34,.28);padding:4px;min-width:190px;display:none;z-index:30}
.podx .menu.open{display:block;animation:podxpop .16s var(--ease)}
.podx .menu button{display:flex;align-items:center;gap:10px;width:100%;border:0;background:transparent;text-align:left;padding:9px 10px;border-radius:6px;cursor:pointer;font-size:14px}
.podx .menu button:hover{background:var(--paper-2)}
.podx .menu button:disabled{opacity:.4;cursor:not-allowed}
.podx .menu button.danger{color:var(--terra)}
.podx .menu button.danger:hover{background:var(--terra-tint)}
.podx .menu hr{border:0;border-top:1px solid var(--line-2);margin:4px 0}
.podx .menu svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.7}
@keyframes podxpop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.podx .strip{background:var(--paper);border:1px solid var(--line);border-radius:10px;display:grid;grid-template-columns:repeat(4,1fr);position:relative;overflow:hidden;margin-bottom:22px;box-shadow:0 1px 2px rgba(47,38,34,.04),0 8px 24px -18px rgba(47,38,34,.25)}
.podx .strip::before{content:"";position:absolute;left:0;top:0;height:3px;width:var(--p,25%);background:var(--sage);transition:width .6s var(--ease)}
.podx .stage{padding:16px 18px 16px 16px;border-right:1px solid var(--line-2);display:grid;grid-template-columns:26px 1fr;gap:2px 12px;align-items:start;align-content:start;min-height:96px;position:relative;z-index:1;transition:background .2s}
.podx .stage.done{background:linear-gradient(180deg,var(--sage-tint) 0%,transparent 70%)}
.podx .stage.now{background:linear-gradient(180deg,var(--terra-tint) 0%,transparent 75%)}
.podx .stage:last-child{border-right:0}
.podx .stage .ico{width:26px;height:26px;margin-top:6px;border-radius:50%;border:1.5px solid var(--line);background:var(--paper);display:grid;place-items:center;grid-row:span 2;font-size:12px;font-family:var(--mono);color:var(--ink-3);transition:background .25s,border-color .25s,color .25s,transform .3s var(--ease)}
.podx .stage.done .ico{transform:scale(1.08)}
.podx .stage .ico svg{width:12px;height:12px;stroke:#fff;fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;display:none}
.podx .stage.done .ico{background:var(--sage);border-color:var(--sage)}
.podx .stage.done .ico svg{display:block}.podx .stage.done .ico span{display:none}
.podx .stage.now .ico{border-color:var(--terra);color:var(--terra);box-shadow:0 0 0 3px var(--terra-tint)}
.podx .stage .t{font-weight:600;font-size:14px;letter-spacing:-.005em}
.podx .stage .s{font-size:12.5px;color:var(--ink-3)}
.podx .stage.done .s{color:var(--ink-2)}
.podx .stage .act{grid-column:2;margin-top:8px}
.podx .stage.next-later .t{color:var(--ink-3)}
.podx .sec{display:flex;align-items:center;justify-content:space-between;margin:22px 0 10px}
.podx .sec h2{margin:0;font:600 11.5px/1 var(--sans);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-2);padding-left:10px;border-left:3px solid var(--terra);display:flex;align-items:center;gap:14px;flex:1}
.podx .sec h2::after{content:"";flex:1;height:1px;background:var(--line);margin-right:14px}
.podx .sec .right{display:flex;gap:8px;align-items:center}
.podx .sheet{background:var(--paper);border:1px solid var(--line);border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgba(47,38,34,.04),0 8px 24px -18px rgba(47,38,34,.25)}
.podx table{width:100%;border-collapse:collapse;table-layout:fixed}
.podx th{font-weight:500;font-size:12px;color:var(--ink-2);text-align:left;padding:9px 12px;background:var(--paper-2);border-bottom:1px solid var(--line);letter-spacing:.02em;white-space:nowrap}
.podx td{padding:0 12px;border-bottom:1px solid var(--line-2);height:48px;vertical-align:middle;transition:background .15s}
.podx tbody tr:hover td{background:var(--paper-2)}
.podx tbody tr:hover td.bill-col{background:#F3E8CD}
.podx th+th,.podx td+td{border-left:1px solid var(--line-2)}
.podx tbody tr:last-child td{border-bottom:0}
.podx .num{text-align:right;font-family:var(--mono);font-feature-settings:"tnum";font-variant-numeric:tabular-nums}
.podx .dim{color:var(--ink-3)}
.podx .n{text-align:center;color:var(--ink-3);font-size:12px;font-family:var(--mono)}
.podx .item b{font-weight:600;letter-spacing:-.005em}.podx .item small{display:block;color:var(--ink-3);font-size:12px;margin-top:1px}
.podx .unit{display:inline-block;font:500 11px/1 var(--mono);letter-spacing:.06em;color:var(--ink-2);background:var(--paper-2);border:1px solid var(--line-2);padding:4px 6px;border-radius:4px}
.podx td.amt{font-weight:500;color:var(--ink)}
.podx .bill-col{display:none;background:var(--gold-tint)}
.podx th.bill-col{color:var(--gold)}
.podx .sheet.billing .bill-col{display:table-cell}
.podx .sheet.billing .item b{font-size:14px}
.podx .cell{position:relative;height:44px;margin:0 -12px}
.podx .cell input{width:100%;height:44px;border:0;background:transparent;padding:0 12px;outline:none;text-align:right;font-family:var(--mono)}
.podx .cell::before{content:"";position:absolute;inset:0;pointer-events:none;border:2px solid transparent;border-radius:3px;transition:border-color .15s,box-shadow .15s}
.podx .cell:hover:not(:focus-within)::before{border-color:var(--line)}
.podx .cell:focus-within::before{border-color:var(--terra);box-shadow:0 0 0 3px var(--terra-tint)}
.podx td.diff{background:var(--terra-tint);color:var(--terra-deep);font-weight:500}
.podx td.diff .why{display:block;font-size:11px;font-family:var(--sans);font-weight:400;color:var(--terra)}
.podx td.ok-match{color:var(--sage)}
.podx tfoot td{background:var(--paper-2);height:40px;font-size:13.5px;color:var(--ink-2)}
.podx tfoot td.num{color:var(--ink)}
.podx tfoot tr.grand td{font-weight:600;color:var(--ink);font-size:15px;border-top:2px solid var(--line);height:46px}
.podx .inline{display:none;grid-template-columns:1.2fr 1fr 1fr 1.3fr auto;gap:12px;align-items:end;padding:16px 18px;background:var(--gold-tint);border-top:1px solid var(--line);box-shadow:inset 0 3px 0 rgba(184,134,46,.35)}
.podx .inline.open{display:grid;animation:podxpop .2s var(--ease)}
.podx .inline.pay{background:var(--sage-tint);grid-template-columns:1fr 1fr 1fr 1.6fr auto;box-shadow:inset 0 3px 0 rgba(95,127,91,.4)}
.podx .f label{display:block;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-2);margin-bottom:5px}
.podx .f input,.podx .f select,.podx .f .up{width:100%;height:38px;border:1px solid var(--line);border-radius:6px;background:var(--paper);padding:0 10px;outline:none;transition:border-color .15s,box-shadow .15s}
.podx .f input:focus,.podx .f select:focus{border-color:var(--terra);box-shadow:0 0 0 3px var(--terra-tint)}
.podx .f .up{display:flex;align-items:center;gap:8px;border-style:dashed;cursor:pointer;color:var(--ink-2);overflow:hidden}
.podx .f .up span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.podx .f .up:hover{border-color:var(--terra);color:var(--terra);background:var(--terra-tint)}
.podx .f .up svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.7;flex-shrink:0}
.podx .f .up.has{border-style:solid;border-color:var(--sage);color:var(--sage);background:var(--sage-tint)}
.podx .money{display:grid;grid-template-columns:repeat(4,1fr);background:var(--paper);border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-top:22px;box-shadow:0 1px 2px rgba(47,38,34,.04),0 8px 24px -18px rgba(47,38,34,.25)}
.podx .money>div{padding:16px 20px 14px;border-right:1px solid var(--line-2);position:relative}
.podx .money>div::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:var(--line-2)}
.podx .money>div:nth-child(2)::before{background:var(--gold)}
.podx .money .bal.owe::before{background:var(--terra)}.podx .money .bal.nil::before{background:var(--sage)}
.podx .money div:last-child{border-right:0}
.podx .money small{display:block;font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2);margin-bottom:4px}
.podx .money .mono{font-size:22px;font-weight:500;letter-spacing:-.01em;transition:color .3s}
.podx .money .bal .mono{font-size:26px}
.podx .money .bal.owe .mono{color:var(--terra)}.podx .money .bal.nil .mono{color:var(--sage)}
.podx .money .sub{font-size:12px;color:var(--ink-3);margin-top:2px}
.podx .log{list-style:none;margin:0;padding:6px 0}
.podx .log li{display:grid;grid-template-columns:130px 14px 1fr;gap:10px;padding:10px 16px;font-size:13.5px;color:var(--ink-2);align-items:start}
.podx .log i{width:8px;height:8px;border-radius:50%;background:var(--line);border:2px solid var(--paper);box-shadow:0 0 0 1px var(--line);margin-top:6px}
.podx .log li+li{border-top:1px solid var(--line-2)}
.podx .log .mono{color:var(--ink-3);font-size:12px;padding-top:2px}
.podx .log b{color:var(--ink);font-weight:500}
.podx .btn{--bg:var(--paper);--fg:var(--ink);--bd:var(--line);display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 14px;border-radius:var(--r);border:1px solid var(--bd);background:var(--bg);color:var(--fg);font-weight:500;font-size:14px;cursor:pointer;position:relative;overflow:hidden;transition:background .16s var(--ease),border-color .16s,color .16s,transform .12s var(--ease),box-shadow .16s var(--ease)}
.podx .btn:hover{--bg:var(--paper-2);box-shadow:0 2px 8px -4px rgba(47,38,34,.25);transform:translateY(-1px)}
.podx .btn:active{transform:translateY(0) scale(.97);box-shadow:none}
.podx .btn:disabled{opacity:.55;cursor:not-allowed;transform:none;box-shadow:none}
.podx .btn svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.8}
.podx .btn.primary{--bg:var(--terra);--fg:#fff;--bd:var(--terra)}
.podx .btn.primary:hover{--bg:var(--terra-deep);--bd:var(--terra-deep);box-shadow:0 6px 16px -8px rgba(196,97,58,.7)}
.podx .btn.soft{--bg:var(--terra-tint);--fg:var(--terra);--bd:transparent}.podx .btn.soft:hover{--bg:#F2D9CC}
.podx .btn.ghost{--bd:transparent;--bg:transparent;color:var(--ink-2)}.podx .btn.ghost:hover{--bg:var(--paper)}
.podx .btn.sm{height:30px;padding:0 10px;font-size:13px}
.podx .spinner{width:15px;height:15px;border:2px solid rgba(196,97,58,.3);border-top-color:var(--terra);border-radius:50%;animation:podxspin .7s linear infinite}
.podx .btn.primary .spinner{border-color:rgba(255,255,255,.35);border-top-color:#fff}
@keyframes podxspin{to{transform:rotate(360deg)}}
.podx .chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:12.5px;font-weight:500;background:var(--paper);border:1px solid var(--line);color:var(--ink-2)}
.podx .chip i{width:6px;height:6px;border-radius:50%;background:var(--gold)}
.podx .chip.sage{color:var(--sage);background:var(--sage-tint);border-color:transparent}.podx .chip.sage i{background:var(--sage)}
@media (max-width:820px){
  .podx .page{padding:16px 14px 60px}
  .podx .head{grid-template-columns:1fr}.podx .value{text-align:left}
  .podx .strip{grid-template-columns:1fr 1fr}.podx .stage{border-bottom:1px solid var(--line-2)}
  .podx .money{grid-template-columns:1fr 1fr}
  .podx .inline,.podx .inline.pay{grid-template-columns:1fr 1fr}
  .podx .sheet{overflow-x:auto}.podx .sheet table{min-width:720px}
}
@media (prefers-reduced-motion:reduce){.podx *{animation-duration:.01ms !important;transition-duration:.01ms !important}}
`;

export default function PurchaseOrderDetail({ session }: { session: Session }) {
  const { poId }   = useParams<{ poId: string }>();
  const navigate   = useNavigate();
  const location   = useLocation();
  const navState   = (location.state as { from?: string; projectId?: string; projectName?: string }) || {};
  const qc         = useQueryClient();
  const { show: showSnackbar } = useSnackbar();
  const { openPeek } = usePeek();
  const { data: profile } = useUserProfile(session.user.id);
  const orgId = useOrgId();

  const canManage =
    profile?.role === 'management' ||
    profile?.role === 'principal' ||
    profile?.role === 'accountant';
  // Only management / principal approve POs.
  const isApprover = profile?.role === 'management' || profile?.role === 'principal';
  const [noteAction, setNoteAction] = useState<'SEND_BACK' | 'REJECT' | null>(null);
  const [approvalRemark, setApprovalRemark] = useState('');

  const currentUserName: string = (profile as any)?.display_name || (profile as any)?.name || session.user.email || 'Unknown';

  // ── UI state ───────────────────────────────────────────────────────────────
  const [showLog,              setShowLog]             = useState(false);
  const [showReceiveDrawer,    setShowReceiveDrawer]   = useState(false);
  const [showSettleModal,      setShowSettleModal]     = useState(false);
  const [showRecordPayment,    setShowRecordPayment]   = useState(false);
  const [showReceiveModal,     setShowReceiveModal]    = useState(false);
  const [billCelebration,      setBillCelebration]     = useState<{ billAmount: number; billNo: string; vendorName: string } | null>(null);
  const [showStakeholderDrawer, setShowStakeholderDrawer] = useState(false);

  // AI reconciliation state
  const [reconFile, setReconFile]     = useState<File | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [reconResult, setReconResult] = useState<ReconResult | null>(null);
  const [reconError, setReconError]   = useState<string | null>(null);

  // Record payment fields (Feature 3)
  const [payAmount,   setPayAmount]   = useState('');
  const [payMode,     setPayMode]     = useState<'NEFT' | 'UPI' | 'Cheque' | 'Cash'>('NEFT');
  const [payRef,      setPayRef]      = useState('');


  // Settle modal fields
  const [settleAmount,     setSettleAmount]     = useState('');
  const [settlePayMode,    setSettlePayMode]    = useState<'NEFT' | 'UPI' | 'Cheque' | 'Cash'>('NEFT');
  const [settleRef,        setSettleRef]        = useState('');

  // ── Reference PO-detail redesign (po-detail.html) UI state ──────────────────
  const [menuOpen,     setMenuOpen]     = useState(false);
  const [billingOpen,  setBillingOpen]  = useState(false);   // unfolds the bill columns + bill row
  const [billEditOpen, setBillEditOpen] = useState(false);   // editing/replacing an already-recorded bill
  const [payRowOpen,   setPayRowOpen]   = useState(false);
  const [refBillNo,    setRefBillNo]    = useState('');
  const [refBillDate,  setRefBillDate]  = useState(new Date().toISOString().split('T')[0]);
  const [refBillFile,  setRefBillFile]  = useState<File | null>(null);
  const [refBillAmt,   setRefBillAmt]   = useState('');
  const [billedQty,    setBilledQty]    = useState<Record<string, string>>({});
  const [billedRate,   setBilledRate]   = useState<Record<string, string>>({});
  const [savingBill,   setSavingBill]   = useState(false);
  const refBillFileInputRef = useRef<HTMLInputElement>(null);
  const refScanInputRef     = useRef<HTMLInputElement>(null);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: po, isLoading } = useQuery({
    queryKey: ['po_detail', poId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('*, projects(name, site_location), stakeholders(name, category, gstin, is_approved)')
        .eq('po_id', poId!)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!poId,
  });

  const { data: lineItems } = useQuery({
    queryKey: ['po_line_items', poId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('po_line_items')
        .select('*')
        .eq('po_id', poId!)
        .order('line_number');
      if (error) throw error;
      return data as POLineItem[];
    },
    enabled: !!poId,
  });

  const { data: grns } = useQuery({
    queryKey: ['po_grn', poId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('po_grn')
        .select('grn_id, receipt_date, dc_number, vehicle_number, driver_name, remarks, received_by, created_at')
        .eq('po_id', poId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!poId,
  });

  const { data: grnItems } = useQuery({
    queryKey: ['po_grn_items', poId],
    queryFn: async () => {
      const grnIds = (grns ?? []).map((g: any) => g.grn_id);
      if (!grnIds.length) return [];
      const { data, error } = await supabase
        .from('po_grn_items')
        .select('grn_id, po_line_item_id, item_name, unit, qty_ordered, qty_received, unit_rate, condition, remarks')
        .in('grn_id', grnIds);
      if (error) throw error;
      return data as any[];
    },
    enabled: (grns?.length ?? 0) > 0,
  });

  const { data: approvals } = useQuery({
    queryKey: ['po_approvals', poId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('po_approvals')
        .select('*')
        .eq('po_id', poId!)
        .order('actioned_at', { ascending: false });
      if (error) throw error;
      return data as POApproval[];
    },
    enabled: !!poId,
  });

  // Feature 3 — linked transactions
  const { data: linkedTxns } = useQuery({
    queryKey: ['po_linked_txns', poId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('txn_allocations')
        .select('*, transactions(txn_id, date, total_amount, payment_mode, category, remarks, status)')
        .eq('order_ref', poId!)
        .eq('order_type', 'PO');
      if (error) throw error;
      return data as any[];
    },
    enabled: !!poId,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const updateStatus = useMutation({
    mutationFn: async (status: string) => {
      const { error } = await supabase.from('purchase_orders').update({ status }).eq('po_id', poId!);
      if (error) throw error;
    },
    onSuccess: (_, status) => {
      qc.invalidateQueries({ queryKey: ['po_detail', poId] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      showSnackbar(`PO status updated to ${status}`);
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to update status', { type: 'error' }),
  });

  // ── Approval (draft → live), management/principal only ──────────────────────
  const inrShort = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  const approve = useMutation({
    mutationFn: async ({ action, remarks }: { action: 'APPROVE' | 'SEND_BACK' | 'REJECT'; remarks?: string }) => {
      const { data, error } = await supabase.rpc('decide_purchase_order', {
        p_po_id: poId!, p_action: action, p_remarks: remarks ?? null,
      });
      if (error) throw error;
      const res = data as { success: boolean; error?: string; amount?: number; limit?: number; escalate_to?: string | null };
      if (!res?.success) {
        if (res?.error === 'above_limit') {
          throw new Error(`This ${inrShort(res.amount ?? 0)} order is above your approval limit${res.limit != null ? ` of ${inrShort(res.limit)}` : ''}${res.escalate_to ? ' — it goes to your approver to sign off.' : ' — a higher approver must sign off.'}`);
        }
        throw new Error(res?.error || 'Approval failed');
      }
      return res;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['po_detail', poId] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      qc.invalidateQueries({ queryKey: ['nav_po_draft'] });
      qc.invalidateQueries({ queryKey: ['nav_po_total'] });
      showSnackbar(vars.action === 'APPROVE' ? '✓ Purchase order approved' : vars.action === 'REJECT' ? 'Rejected' : 'Sent back to the creator');
    },
    onError: (err: any) => showSnackbar(err.message || 'Could not complete approval', { type: 'error' }),
  });


  const settlePO = useMutation({
    mutationFn: async () => {
      const amount = parseAmount(settleAmount) || Number(po?.total_value || po?.order_value) || 0;
      if (!amount) throw new Error('Amount is required');

      const txnId = `TXN-${Date.now()}`;
      const { error: rpcError } = await supabase.rpc('insert_transaction_with_allocations', {
        p_txn: {
          txn_id:         txnId,
          org_id:         orgId,
          stakeholder_id: po!.stakeholder_id,
          date:           new Date().toISOString().split('T')[0],
          total_amount:   amount,
          payment_mode:   settlePayMode,
          category:       'Purchase Payment',
          remarks:        `Settlement for PO ${poId}${settleRef ? ` · Ref: ${settleRef}` : ''}`,
          ai_flag_status: 'Clean',
          ai_flag_data:   {},
        },
        p_allocations: [{
          project_id:       po!.project_id,
          order_type:       'PO',
          order_ref:        poId!,
          allocated_amount: amount,
        }],
      });
      if (rpcError) throw rpcError;

      // Mark PO as fully paid
      await supabase.from('purchase_orders').update({ status: 'PAID' }).eq('po_id', poId!);

      return txnId;
    },
    onSuccess: (txnId) => {
      qc.invalidateQueries({ queryKey: ['po_linked_txns', poId] });
      qc.invalidateQueries({ queryKey: ['po_detail', poId] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      setShowSettleModal(false);
      showSnackbar('PO settled — transaction created');
      navigate(`/ledger/${txnId}`);
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to settle PO', { type: 'error' }),
  });

  // Feature 3 — record payment against PO
  const recordPayment = useMutation({
    mutationFn: async () => {
      const amount = parseAmount(payAmount);
      if (!amount) throw new Error('Amount is required');
      const txnId = `TXN-${Date.now()}`;
      const hasBill = po?.vendor_bill_amount && Number(po.vendor_bill_amount) > 0;
      const category = hasBill ? 'Purchase Payment' : 'PO Advance';
      const rawRemarks = `Payment for PO ${poId}${payRef ? ` · Ref: ${payRef}` : ''}`;
      const remarks = hasBill ? rawRemarks : `[PO Advance] ${rawRemarks}`;

      const { error: rpcErr } = await supabase.rpc('insert_transaction_with_allocations', {
        p_txn: {
          txn_id:         txnId,
          org_id:         orgId,
          stakeholder_id: po!.stakeholder_id,
          date:           new Date().toISOString().split('T')[0],
          total_amount:   amount,
          payment_mode:   payMode,
          category,
          remarks,
          ai_flag_status: 'Clean',
          ai_flag_data:   {},
        },
        p_allocations: [{
          project_id:       po!.project_id,
          order_type:       'PO',
          order_ref:        poId!,
          allocated_amount: amount,
        }],
      });
      if (rpcErr) throw rpcErr;

      // Auto-advance PO status: compute total paid after this payment
      const prevPaid = (linkedTxns ?? [])
        .filter((t: any) => t.transactions?.status !== 'Voided')
        .reduce((s: number, t: any) => s + (Number(t.allocated_amount) || 0), 0);
      const newTotalPaid = prevPaid + amount;
      const billOrPoValue = Number(po?.vendor_bill_amount) || Number(po?.total_value || po?.order_value) || 0;
      const newStatus = newTotalPaid >= billOrPoValue ? 'PAID' : 'PARTIAL';
      await supabase.from('purchase_orders').update({ status: newStatus }).eq('po_id', poId!);
      return { txnId, newStatus };
    },
    onSuccess: ({ newStatus }) => {
      qc.invalidateQueries({ queryKey: ['po_linked_txns', poId] });
      qc.invalidateQueries({ queryKey: ['po_detail', poId] });
      qc.invalidateQueries({ queryKey: ['po_payment_totals'] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      setShowRecordPayment(false);
      setPayAmount('');
      setPayRef('');
      if (newStatus === 'PAID') {
        fireCelebration();
        showSnackbar('🎉 Fully paid and settled!');
      } else {
        showSnackbar('Payment recorded');
      }
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to record payment', { type: 'error' }),
  });

  // ── AI Reconciliation ─────────────────────────────────────────────────────

  function fileToBase64Str(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function runReconciliation(file: File | null) {
    setReconciling(true);
    setReconError(null);
    if (!lineItems?.length) {
      setReconciling(false);
      setReconError('This PO has no line items to match the bill against.');
      return;
    }
    try {
      const body: Record<string, any> = {
        po_id:         poId,
        po_line_items: lineItems.map(li => ({
          item_name:       li.item_name,
          specification:   li.specification,
          quantity_ordered: li.quantity_ordered,
          unit:            li.unit,
          unit_rate:       li.unit_rate,
          total_amount:    li.total_amount,
          gst_rate:        li.gst_rate,
        })),
        bill_total: totalValue,
      };

      if (file) {
        body.bill_base64   = await fileToBase64Str(file);
        body.bill_mime_type = file.type || 'image/jpeg';
      } else if (po?.vendor_bill_doc_url || po?.vendor_bill_url) {
        // Hand the edge fn the object's bucket+path; it downloads with the service role. This avoids
        // the client-signed URL, which was 400-ing (the stored path didn't match the object).
        const stored = po.vendor_bill_doc_url || po.vendor_bill_url;
        const parsed = parseStoredPath(stored);
        if (parsed) { body.bill_bucket = parsed.bucket; body.bill_path = parsed.path; }
        else body.bill_url = stored; // an external (non-Supabase) URL — let the fn fetch it directly
      } else {
        throw new Error('No bill document available — upload the vendor bill image first');
      }

      const { data, error } = await supabase.functions.invoke('reconcile-po-bill', { body });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Reconciliation failed');
      const rr = data as ReconResult;
      setReconResult(rr);
      // Read succeeded but nothing usable came back — say so instead of silently doing nothing.
      const gotSomething = rr.bill_total_extracted != null || (rr.line_matches ?? []).some(m => m.bill_qty != null || m.bill_rate != null);
      if (!gotSomething) setReconError('The bill was read, but no amounts could be matched to these lines. Enter them by hand, or try a clearer photo / PDF.');
    } catch (err: any) {
      // supabase-js hides the edge fn's real error behind "non-2xx"; the reason is in error.context.
      let msg = err?.message || 'Reconciliation failed';
      const ctx = err?.context;
      if (ctx instanceof Response) {
        try { const b = await ctx.clone().json(); if (b?.error) msg = String(b.error); }
        catch { try { const t = await ctx.clone().text(); if (t) msg = t.slice(0, 200); } catch { /* ignore */ } }
      }
      setReconError(msg);
    } finally {
      setReconciling(false);
    }
  }

  // ── PDF Download ───────────────────────────────────────────────────────────

  const handleDownloadPDF = () => {
    if (!po) return;
    const doc = new jsPDF('p', 'mm', 'a4');

    // ── Header ────────────────────────────────────────────────────────────────
    let y = drawHeader(
      doc,
      'PURCHASE ORDER',
      `${po.po_id}  ·  ${pdfFmtDate(po.date_issued)}`,
    );

    // ── Vendor + Project block ────────────────────────────────────────────────
    const rx = MARGIN + CONTENT / 2;

    sectionLabel(doc, 'VENDOR', MARGIN, y);
    sectionLabel(doc, 'PROJECT', rx, y);
    y += 4;

    valueText(doc, vendor?.name ?? '—', MARGIN, y, { bold: true, size: 10 });
    valueText(doc, project?.name ?? '—', rx, y, { bold: true, size: 10 });
    y += 5;

    if (vendor?.category) {
      valueText(doc, vendor.category + (vendor.gstin ? ' · MSME' : ''), MARGIN, y, { color: C.muted, size: 8 });
    }
    if (project?.site_location) {
      valueText(doc, project.site_location, rx, y, { color: C.muted, size: 8 });
    }
    y += 4.5;

    if (vendor?.gstin) {
      valueText(doc, `GSTIN: ${vendor.gstin}`, MARGIN, y, { color: C.muted, size: 8 });
    }
    y += 4;

    if (po.expected_delivery) {
      valueText(doc, `Expected Delivery: ${pdfFmtDate(po.expected_delivery)}`, MARGIN, y, { size: 8, color: C.mid });
      y += 4;
    }
    if (po.ordered_by) {
      valueText(doc, `Ordered by: ${po.ordered_by}`, MARGIN, y, { size: 8, color: C.mid });
      y += 4;
    }
    y += 4;

    drawRule(doc, y);
    y += 7;

    // ── Line items table ──────────────────────────────────────────────────────
    sectionLabel(doc, 'ITEMS ORDERED', MARGIN, y);
    y += 4;

    // Column widths must sum to CONTENT (182mm):
    // #:8  Desc:84  Unit:18  Qty:14  Rate:29  Amount:29 = 182
    const itemRows = lineItems?.length
      ? lineItems.map((li, i) => [
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

    // Totals block — right-aligned, 80mm wide
    const totW = 90;
    const totX = RIGHT - totW;

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
      if (bold) {
        drawRule(doc, y - 4);
      }
      y += bold ? 6 : 5;
    });

    // Amount in words
    y += 3;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    setColor(doc, C.mid);
    const words = `Rupees ${amountInWords(totalValueNum)}`;
    const wordLines = doc.splitTextToSize(words, CONTENT);
    doc.text(wordLines, MARGIN, y);
    y += wordLines.length * 4 + 6;

    // Notes / Terms
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

    // Signatures
    drawRule(doc, y);
    y += 8;
    drawSignatures(doc, y, 'Vendor Acknowledgement', vendor?.name);

    drawFooter(doc);
    doc.save(`${po.po_id}.pdf`);
  };

  // Scan-and-fill: when the reconcile function returns, drop its extracted per-line qty/rate into the
  // billed columns and the bill total, so "Scan bill & fill" behaves like the reference.
  useEffect(() => {
    if (!reconResult || !reconResult.line_matches?.length) return;
    const q: Record<string, string> = {};
    const r: Record<string, string> = {};
    reconResult.line_matches.forEach((m, i) => {
      const li = (lineItems ?? [])[i];
      if (!li) return;
      if (m.bill_qty != null)  q[String(li.id)] = String(m.bill_qty);
      if (m.bill_rate != null) r[String(li.id)] = String(m.bill_rate);
    });
    setBilledQty(prev => ({ ...prev, ...q }));
    setBilledRate(prev => ({ ...prev, ...r }));
    if (reconResult.bill_total_extracted != null) setRefBillAmt(String(reconResult.bill_total_extracted));
    setBillingOpen(true);
  }, [reconResult]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-read the attached bill once, as soon as the PO + its line items load — no button needed.
  // Reads it against the PO lines so the billed amounts (and any mismatches) fill in automatically.
  const autoReadRef = useRef(false);
  useEffect(() => {
    if (autoReadRef.current) return;
    const hasDoc = !!(po?.vendor_bill_doc_url || po?.vendor_bill_url);
    if (!hasDoc || !(lineItems?.length)) return;
    autoReadRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void runReconciliation(null);
  }, [po, lineItems]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save the vendor bill (same write BillEntryForm performs) from the reference bill row.
  async function saveRefBill(): Promise<void> {
    const typed = parseAmount(refBillAmt);
    const computed = (lineItems ?? []).reduce((s, li: any) => {
      const q = parseFloat(billedQty[String(li.id)] || '') || Number(li.quantity_ordered) || 0;
      const rt = parseFloat(billedRate[String(li.id)] || '') || Number(li.unit_rate) || 0;
      return s + q * rt;
    }, 0);
    const bill = typed > 0 ? typed : (computed > 0 ? computed : totalValue);
    if (!(bill > 0)) { showSnackbar('Enter a bill amount', { type: 'error' }); return; }
    setSavingBill(true);
    let billUrl: string | null = null;
    if (refBillFile) {
      const ext = refBillFile.type === 'application/pdf' ? 'pdf' : 'jpg';
      const path = `po-bills/bill_${poId}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('documents').upload(path, refBillFile, { contentType: refBillFile.type });
      if (!upErr) { const { data: pub } = supabase.storage.from('documents').getPublicUrl(path); billUrl = pub.publicUrl; }
    }
    const { error } = await supabase.from('purchase_orders').update({
      vendor_bill_number:    refBillNo.trim() || null,
      vendor_bill_no:        refBillNo.trim() || null,
      vendor_bill_amount:    bill,
      vendor_bill_date:      refBillDate,
      // Keep the existing bill document when the user edits without re-uploading (else this wiped it).
      vendor_bill_url:       billUrl ?? po.vendor_bill_url ?? po.vendor_bill_doc_url ?? null,
      vendor_bill_doc_url:   billUrl ?? po.vendor_bill_doc_url ?? po.vendor_bill_url ?? null,
      bill_recorded_at:      new Date().toISOString(),
      bill_recorded_by_name: currentUserName,
      status:                'BILLED',
    }).eq('po_id', poId!);
    setSavingBill(false);
    if (error) { showSnackbar(error.message || 'Could not save bill', { type: 'error' }); return; }
    qc.invalidateQueries({ queryKey: ['po_detail', poId] });
    qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
    setBillingOpen(false);
    setBillEditOpen(false);
    showSnackbar('Bill saved');
  }

  // Open the bill row to edit / replace an already-recorded bill (prefilled from the PO).
  function openBillEdit() {
    setRefBillNo(po?.vendor_bill_number || po?.vendor_bill_no || '');
    setRefBillDate(po?.vendor_bill_date || new Date().toISOString().split('T')[0]);
    setRefBillAmt(po?.vendor_bill_amount != null ? String(po.vendor_bill_amount) : '');
    setRefBillFile(null);
    setBillEditOpen(true);
    setBillingOpen(true);
    setPayRowOpen(false);
    setTimeout(() => document.getElementById('podxItems')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 30);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) return <div className="p-4 md:p-8"><PageSkeleton /></div>;

  if (!po) {
    return (
      <div className="px-margin-mobile md:px-margin-desktop pt-6">
        <p className="text-on-surface-variant text-[14px]">Purchase Order not found.</p>
        <button className="mt-4 bk-btn-ghost border border-outline-variant/30 text-[13px] px-4 py-2 rounded-xl" onClick={() => navigate(navState.from === 'project' && navState.projectId ? `/projects/${navState.projectId}/purchase-orders` : '/purchase-orders')}>
          Back to list
        </button>
      </div>
    );
  }

  const vendor  = po.stakeholders;
  const project = po.projects;
  const totalValue = Number(po.total_value || po.order_value) || 0;

  const activeTxns = (linkedTxns ?? []).filter((t: any) => t.transactions?.status !== 'Voided');
  const paidTotal = activeTxns.reduce((s: number, t: any) => s + (Number(t.allocated_amount) || 0), 0);
  const billAmt   = Number(po.vendor_bill_amount) || 0;
  const balance   = billAmt - paidTotal;
  const pct       = billAmt > 0 ? Math.min(100, (paidTotal / billAmt) * 100) : 0;

  // Count-up component
  function AmountDisplay({ amount }: { amount: number }) {
    const displayed = useCountUp(amount);
    return <span className="count-up-amount">₹{displayed.toLocaleString('en-IN')}</span>;
  }

  // ── Derived state for the redesign (real data behind the reference's look) ──
  const inr0 = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  const cancelled = po.status === 'CANCELLED';
  // A PO created from a paid bill (the "Attach bill" flow) — recorded after the purchase, not raised
  // or approved in advance. The banner below states this so owners don't read it as a pre-placed order.
  const postPurchase = !!po.created_after_payment;
  const orderValue = totalValue;
  const gstValue = Number(po.gst_value) || 0;
  const subTotal = Number(po.order_value) || (lineItems ?? []).reduce((s, li: any) => s + (Number(li.total_amount) || (Number(li.quantity_ordered) || 0) * (Number(li.unit_rate) || 0)), 0);

  const received = !!(po.received_at_site || (grns?.length ?? 0) > 0);
  const receivedWhen = po.received_at_site || grns?.[grns.length - 1]?.receipt_date || grns?.[0]?.receipt_date || null;
  const receivedBy = po.received_by_name || grns?.[0]?.received_by || '';
  // Per-line quantity already received across prior GRNs — fed to the receive wizard as the baseline.
  const recvByLine: Record<string, number> = {};
  (grnItems ?? []).forEach((g: any) => { if (g.po_line_item_id) recvByLine[String(g.po_line_item_id)] = (recvByLine[String(g.po_line_item_id)] || 0) + (Number(g.qty_received) || 0); });
  const hasBill = billAmt > 0;
  const billNo = po.vendor_bill_number || po.vendor_bill_no || '';
  // Balance is owed against the BILL, not the order. Prefer the saved bill amount; if none is saved
  // yet use the amount just read from the bill (OCR) or typed in the panel; fall back to the order.
  const readBill = reconResult?.bill_total_extracted != null ? Number(reconResult.bill_total_extracted) : 0;
  const typedBill = refBillAmt ? (parseAmount(refBillAmt) || 0) : 0;
  const billForBalance = billAmt > 0 ? billAmt : (typedBill > 0 ? typedBill : readBill);
  const payBase = billForBalance > 0 ? billForBalance : orderValue;
  const balNum = payBase - paidTotal;
  const paidDone = paidTotal > 0 && balNum <= 0;
  const doneCount = 1 + (received ? 1 : 0) + (hasBill ? 1 : 0) + (paidDone ? 1 : 0);
  const progressPct = cancelled ? 100 : doneCount * 25;
  const nowStage = cancelled ? null : (!received ? 'recv' : !hasBill ? 'bill' : !paidDone ? 'pay' : null);

  // Reconciliation of the (in-progress) billed columns against the order.
  const billedLines = (lineItems ?? []).map((li: any) => {
    const oq = Number(li.quantity_ordered) || 0;
    const orr = Number(li.unit_rate) || 0;
    const bq = billedQty[String(li.id)] !== undefined && billedQty[String(li.id)] !== '' ? parseFloat(billedQty[String(li.id)]) : oq;
    const br = billedRate[String(li.id)] !== undefined && billedRate[String(li.id)] !== '' ? parseFloat(billedRate[String(li.id)]) : orr;
    const amt = bq * br;
    const why: string[] = [];
    if (bq > oq) why.push(`qty +${+(bq - oq).toFixed(2)}`);
    if (br > orr) why.push(`rate +${inr0(br - orr)}`);
    return { li, oq, orr, bq, br, amt, why, ordAmt: oq * orr };
  });
  const billedTotal = billedLines.reduce((s, r) => s + r.amt, 0);
  const billedFlags = billedLines.filter(r => r.why.length).length;
  const billedDiff = billedTotal - subTotal;

  // Activity feed, newest first.
  type Act = { when: string | null; who: string; what: React.ReactNode; first?: boolean };
  const activity: Act[] = [];
  activity.push({ when: po.date_issued || po.created_at, who: po.ordered_by || 'Someone', what: <>created this order · {(lineItems?.length ?? 0)} item{(lineItems?.length ?? 0) !== 1 ? 's' : ''}</> });
  if (received) activity.push({ when: receivedWhen, who: receivedBy || 'Site', what: <>marked material received at site</> });
  if (hasBill) activity.push({ when: po.bill_recorded_at || po.vendor_bill_date, who: po.bill_recorded_by_name || 'Accounts', what: <>recorded vendor bill {billNo ? <b>{billNo}</b> : null} for <b>{inr0(billAmt)}</b></> });
  for (const t of activeTxns) {
    const tx = t.transactions || {};
    activity.push({ when: tx.date, who: 'Accounts', what: <>paid <b>{inr0(Number(t.allocated_amount) || 0)}</b>{tx.payment_mode ? <> by {tx.payment_mode}</> : null}{tx.remarks ? <> · {tx.remarks}</> : null}</> });
  }
  if (cancelled) activity.push({ when: po.updated_at || null, who: 'Someone', what: <>cancelled this purchase order</> });
  activity.sort((a, b) => new Date(b.when || 0).getTime() - new Date(a.when || 0).getTime());
  if (activity[0]) activity[0].first = true;
  const logTime = (d: string | null) => {
    if (!d) return '';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '';
    return dt.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const backTo = navState.from === 'project' && navState.projectId ? `/projects/${navState.projectId}/purchase-orders` : '/purchase-orders';
  const Check = () => (<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7" /></svg>);

  return (
    <div className="podx" onClick={() => menuOpen && setMenuOpen(false)}>
      <style>{PODX_CSS}</style>
      <div className="page">
        {/* crumbs */}
        <div className="crumb"><a onClick={() => navigate(backTo)}>Purchase orders</a> › <b>{po.po_id}</b></div>

        {/* header */}
        <div className="head">
          <div>
            <h1>Purchase order <span className="tag mono">{po.po_id}</span>{cancelled && <span className="chip" style={{ color: 'var(--terra)', borderColor: 'var(--terra-tint)', background: 'var(--terra-tint)' }}><i style={{ background: 'var(--terra)' }} />Cancelled</span>}</h1>
            <div className="meta">
              <span>Vendor {po.stakeholder_id ? <a onClick={() => navigate(`/stakeholders/${po.stakeholder_id}`)}>{vendor?.name || '—'}</a> : <b>{vendor?.name || '—'}</b>}</span>
              <span>Project <b>{project?.name || '—'}</b>{project?.site_location ? <> · {project.site_location}</> : null}</span>
              <span>Ordered <b>{fmtDate(po.date_issued)}</b>{po.ordered_by ? <> by {po.ordered_by}</> : null}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div className="value"><small>Order value</small><span className="mono">{inr0(orderValue)}</span></div>
            <div className="more" onClick={(e) => e.stopPropagation()}>
              <button className="kebab" aria-label="More actions" onClick={() => setMenuOpen(o => !o)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
              </button>
              <div className={`menu${menuOpen ? ' open' : ''}`}>
                <button onClick={() => { setMenuOpen(false); handleDownloadPDF(); }}><svg viewBox="0 0 24 24"><path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" /></svg>Download PDF</button>
                <button onClick={() => { setMenuOpen(false); navigate('/purchase-orders/new', { state: { projectId: po.project_id, stakeholderId: po.stakeholder_id } }); }}><svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 1 8 8M4 20l4-4M4 20v-4h4" /></svg>Duplicate order</button>
                <button onClick={() => { setMenuOpen(false); navigate('/purchase-orders/new', { state: { projectId: po.project_id, stakeholderId: po.stakeholder_id } }); }}><svg viewBox="0 0 24 24"><path d="M4 6h16M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>Edit items</button>
                <hr />
                <button className="danger" disabled={cancelled} onClick={() => { setMenuOpen(false); if (!cancelled && window.confirm('Cancel this PO?')) updateStatus.mutate('CANCELLED'); }}><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>Cancel PO</button>
              </div>
            </div>
          </div>
        </div>

        {/* post-purchase notice — this PO documents a completed purchase, not a pre-placed order */}
        {postPurchase && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 14px', borderRadius: 12, background: 'var(--gold-tint)', border: '1px solid var(--line)', margin: '0 0 16px' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>Recorded after purchase</div>
              <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 2, lineHeight: 1.5 }}>
                This order was created from the vendor&apos;s bill after the material was purchased and paid for. It documents a completed transaction — it was not raised or approved in advance.
              </div>
            </div>
          </div>
        )}

        {/* lifecycle strip */}
        <div className="strip" style={{ ['--p' as any]: progressPct + '%' }}>
          <div className={`stage done`}>
            <div className="ico"><span>1</span><Check /></div>
            <div className="t">{postPurchase ? 'Recorded' : 'Ordered'}</div>
            <div className="s">{fmtDate(po.date_issued)}{po.ordered_by ? ` · ${po.ordered_by}` : ''}</div>
          </div>

          <div className={`stage ${received ? 'done' : nowStage === 'recv' ? 'now' : 'next-later'}`}>
            <div className="ico"><span>2</span><Check /></div>
            <div className="t">Received at site</div>
            <div className="s">{received ? `${fmtDate(receivedWhen)}${receivedBy ? ` · ${receivedBy}` : ''}` : 'Material not yet checked in'}</div>
            {!received && !cancelled && nowStage === 'recv' && (
              <div className="act"><button className="btn primary sm" onClick={() => setShowReceiveModal(true)}>Receive items</button></div>
            )}
          </div>

          <div className={`stage ${hasBill ? 'done' : nowStage === 'bill' ? 'now' : 'next-later'}`}>
            <div className="ico"><span>3</span><Check /></div>
            <div className="t">Bill recorded</div>
            <div className="s">{hasBill ? `${billNo ? billNo + ' · ' : ''}${inr0(billAmt)}` : `Est. ${inr0(orderValue)} · no bill yet`}</div>
            {!hasBill && !cancelled && (
              <div className="act"><button className={`btn sm${nowStage === 'bill' ? ' primary' : ''}`} onClick={() => { setBillingOpen(true); setPayRowOpen(false); setTimeout(() => document.getElementById('podxItems')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 30); }}>Record bill</button></div>
            )}
            {hasBill && !cancelled && (
              <div className="act" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {reconciling && <span className="chip"><span className="spinner" /> Reading bill…</span>}
                {(po.vendor_bill_url || po.vendor_bill_doc_url) && (
                  <button className="btn ghost sm" onClick={() => openDoc(po.vendor_bill_doc_url || po.vendor_bill_url)}>
                    <svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg>
                    View
                  </button>
                )}
                <button className="btn ghost sm" onClick={openBillEdit}>
                  <svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
                  Edit / replace
                </button>
              </div>
            )}
          </div>

          <div className={`stage ${paidDone ? 'done' : nowStage === 'pay' ? 'now' : 'next-later'}`}>
            <div className="ico"><span>4</span><Check /></div>
            <div className="t">Paid</div>
            <div className="s">{paidTotal > 0 ? `${inr0(paidTotal)} paid · ${balNum > 0 ? inr0(balNum) + ' due' : 'settled'}` : 'Nothing paid'}</div>
            {!paidDone && !cancelled && (
              <div className="act"><button className={`btn sm${nowStage === 'pay' ? ' primary' : ''}`} onClick={() => { setPayRowOpen(true); setBillingOpen(false); setPayAmount(String(Math.max(0, payBase - paidTotal))); setTimeout(() => document.getElementById('podxItems')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 30); }}>Record payment</button></div>
            )}
          </div>
        </div>

        {/* items */}
        <div className="sec">
          <h2>Items</h2>
          <div className="right" style={{ display: billingOpen ? 'flex' : 'none' }}>
            <span className={`chip${billedFlags ? '' : ' sage'}`}><i />{billedFlags ? `${billedFlags} line${billedFlags > 1 ? 's' : ''} above order — check before saving` : 'Bill matches order'}</span>
            <button className="btn soft sm" disabled={reconciling} onClick={() => refScanInputRef.current?.click()}>
              {reconciling ? <span className="spinner" /> : <svg viewBox="0 0 24 24"><path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M4 12h16" /></svg>}
              {(po.vendor_bill_url || po.vendor_bill_doc_url) ? 'Upload a different bill' : 'Upload & read bill'}
            </button>
            <input ref={refScanInputRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0] || null; if (f) { setRefBillFile(f); runReconciliation(f); } }} />
          </div>
        </div>

        {reconError && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'var(--terra-tint)', border: '1px solid var(--terra)', borderRadius: 10, padding: '9px 12px', margin: '0 0 10px', color: 'var(--terra-deep)', fontSize: 12.5, lineHeight: 1.45 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
            <span>Couldn&apos;t read the bill — {reconError}</span>
          </div>
        )}

        <div id="podxItems" className={`sheet${billingOpen ? ' billing' : ''}`}>
          <table>
            <colgroup>
              <col style={{ width: 44 }} /><col /><col style={{ width: '8%' }} /><col style={{ width: '7%' }} /><col style={{ width: '10%' }} /><col style={{ width: '11%' }} />
              <col className="bill-col" style={{ width: '8%' }} /><col className="bill-col" style={{ width: '10%' }} /><col className="bill-col" style={{ width: '11%' }} />
            </colgroup>
            <thead><tr>
              <th>#</th><th>Item</th><th className="num">Qty</th><th>Unit</th><th className="num">Rate</th><th className="num">Amount</th>
              <th className="bill-col num">Billed qty</th><th className="bill-col num">Billed rate</th><th className="bill-col num">Billed amt</th>
            </tr></thead>
            <tbody>
              {billedLines.map(({ li, oq, orr, bq, br, amt, why, ordAmt }, i) => (
                <tr key={li.id}>
                  <td className="n">{li.line_number ?? i + 1}</td>
                  <td className="item"><b>{li.item_name}</b>{li.specification ? <small>{li.specification}</small> : null}</td>
                  <td className="num">{oq}</td>
                  <td><span className="unit">{li.unit || '—'}</span></td>
                  <td className="num dim">{inr0(orr)}</td>
                  <td className="num amt">{inr0(Number(li.total_amount) || ordAmt)}</td>
                  <td className="bill-col"><div className="cell"><input className="mono" inputMode="decimal" placeholder={String(oq)} value={billedQty[String(li.id)] ?? ''} disabled={hasBill && !billEditOpen} onChange={(e) => setBilledQty(p => ({ ...p, [String(li.id)]: e.target.value }))} /></div></td>
                  <td className="bill-col"><div className="cell"><input className="mono" inputMode="decimal" placeholder={String(orr)} value={billedRate[String(li.id)] ?? ''} disabled={hasBill && !billEditOpen} onChange={(e) => setBilledRate(p => ({ ...p, [String(li.id)]: e.target.value }))} /></div></td>
                  <td className={`bill-col num${why.length ? ' diff' : (amt === ordAmt ? ' ok-match' : '')}`}>{inr0(amt)}{why.length ? <span className="why">{why.join(' · ')}</span> : null}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} style={{ textAlign: 'right' }}>Order value</td>
                <td className="num">{inr0(subTotal)}</td>
                <td className="bill-col" colSpan={2} style={{ textAlign: 'right' }}>Billed value</td>
                <td className="bill-col num">{inr0(billedTotal)}</td>
              </tr>
              {gstValue > 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'right' }}>GST</td>
                  <td className="num">{inr0(gstValue)}</td>
                  <td className="bill-col" colSpan={3} />
                </tr>
              )}
              <tr className="grand">
                <td colSpan={5} style={{ textAlign: 'right' }}>Grand total {gstValue > 0 ? <span className="dim" style={{ fontWeight: 400, fontSize: 12 }}>incl. GST</span> : <span className="dim" style={{ fontWeight: 400, fontSize: 12 }}>GST not applied</span>}</td>
                <td className="num">{inr0(orderValue)}</td>
                <td className="bill-col" colSpan={2} style={{ textAlign: 'right' }}>Difference</td>
                <td className="bill-col num" style={{ color: billedDiff > 0 ? 'var(--terra)' : 'var(--sage)' }}>{billedDiff ? (billedDiff > 0 ? '+' : '−') + inr0(Math.abs(billedDiff)) : 'Matches order'}</td>
              </tr>
            </tfoot>
          </table>

          {/* Bill header row */}
          <div className={`inline${billingOpen && (!hasBill || billEditOpen) ? ' open' : ''}`}>
            <div className="f"><label>Bill / invoice no</label><input placeholder="INV-…" value={refBillNo} onChange={(e) => setRefBillNo(e.target.value)} /></div>
            <div className="f"><label>Bill date</label><input type="date" value={refBillDate} onChange={(e) => setRefBillDate(e.target.value)} /></div>
            <div className="f"><label>Bill amount</label><input className="mono" inputMode="decimal" placeholder="₹" style={{ textAlign: 'right' }} value={refBillAmt} onChange={(e) => setRefBillAmt(e.target.value)} /></div>
            <div className="f"><label>Document</label>
              <div className={`up${refBillFile ? ' has' : ''}`} tabIndex={0} onClick={() => refBillFileInputRef.current?.click()}>
                <svg viewBox="0 0 24 24"><path d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" /></svg>
                <span>{refBillFile ? refBillFile.name : (billEditOpen && (po.vendor_bill_url || po.vendor_bill_doc_url) ? 'Replace bill — PDF / photo' : 'Upload PDF / photo')}</span>
              </div>
              <input ref={refBillFileInputRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={(e) => setRefBillFile(e.target.files?.[0] || null)} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn ghost" onClick={() => { setBillingOpen(false); setBillEditOpen(false); }}>Discard</button>
              <button className="btn primary" disabled={savingBill} onClick={saveRefBill}>{savingBill ? <span className="spinner" /> : billEditOpen ? 'Update bill' : 'Save bill'}</button>
            </div>
          </div>

          {/* Payment row */}
          <div className={`inline pay${payRowOpen ? ' open' : ''}`}>
            <div className="f"><label>Amount</label><input className="mono" inputMode="decimal" style={{ textAlign: 'right' }} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} /></div>
            <div className="f"><label>Paid on</label><input type="date" defaultValue={new Date().toISOString().split('T')[0]} /></div>
            <div className="f"><label>Mode</label>
              <select value={payMode} onChange={(e) => setPayMode(e.target.value as any)}>
                <option value="UPI">UPI</option><option value="NEFT">NEFT / RTGS</option><option value="Cash">Cash</option><option value="Cheque">Cheque</option>
              </select>
            </div>
            <div className="f"><label>Reference / note</label><input placeholder="UTR, cheque no, or who paid" value={payRef} onChange={(e) => setPayRef(e.target.value)} /></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn ghost" onClick={() => setPayRowOpen(false)}>Discard</button>
              <button className="btn primary" disabled={recordPayment.isPending || !(parseFloat(payAmount) > 0)} onClick={() => recordPayment.mutate(undefined, { onSuccess: () => setPayRowOpen(false) })}>{recordPayment.isPending ? <span className="spinner" /> : 'Save payment'}</button>
            </div>
          </div>
        </div>

        {/* money */}
        <div className="money">
          <div><small>Ordered</small><span className="mono">{inr0(orderValue)}</span><div className="sub">{fmtDate(po.date_issued)}</div></div>
          <div><small>Billed</small><span className="mono">{billForBalance > 0 ? inr0(billForBalance) : '—'}</span><div className="sub">{billForBalance > 0 ? (hasBill ? (billNo || 'Vendor bill') : 'Read from bill · not yet saved') + (billForBalance > subTotal ? ` · ${inr0(billForBalance - subTotal)} over order` : ' · matches order') : 'Estimate used until bill arrives'}</div></div>
          <div><small>Paid</small><span className="mono">{inr0(paidTotal)}</span><div className="sub">{paidTotal > 0 ? `${activeTxns.length} payment${activeTxns.length !== 1 ? 's' : ''}` : 'No payments'}</div></div>
          <div className={`bal ${balNum > 0 ? 'owe' : 'nil'}`}><small>Balance to vendor</small><span className="mono">{balNum > 0 ? inr0(balNum) : (balNum < 0 ? 'Over by ' + inr0(-balNum) : 'Nil')}</span><div className="sub">{balNum > 0 ? (billForBalance > 0 ? 'Against vendor bill' : 'On credit · against estimate') : (balNum < 0 ? 'Refund or adjust next PO' : 'Settled in full')}</div></div>
        </div>

        {/* activity */}
        <div className="sec"><h2>Activity</h2></div>
        <div className="sheet"><ul className="log">
          {activity.map((a, i) => (
            <li key={i}><span className="mono">{logTime(a.when)}</span><i style={a.first ? { background: 'var(--terra)', boxShadow: '0 0 0 1px var(--terra)' } : undefined} /><span><b>{a.who}</b> {a.what}</span></li>
          ))}
        </ul></div>
      </div>

      <ReceiveAtSiteDrawer
        isOpen={showReceiveModal}
        onClose={() => setShowReceiveModal(false)}
        session={session}
        poDateIssued={po.date_issued}
        po={{
          po_id: poId!,
          org_id: po.org_id,
          project_id: po.project_id,
          stakeholder_id: po.stakeholder_id,
          stakeholder_name: vendor?.name || 'Vendor',
          line_items: (lineItems ?? []).map((li: any) => ({
            id: String(li.id),
            item_name: li.item_name,
            unit: li.unit || 'Nos',
            quantity_ordered: Number(li.quantity_ordered) || 0,
            unit_rate: Number(li.unit_rate) || 0,
            qty_received_so_far: recvByLine[String(li.id)] || 0,
          })),
        }}
        onSuccess={() => {
          setShowReceiveModal(false);
          qc.invalidateQueries({ queryKey: ['po_detail', poId] });
          qc.invalidateQueries({ queryKey: ['po_grn', poId] });
          qc.invalidateQueries({ queryKey: ['po_grn_items', poId] });
          qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
          fireCelebration();
          showSnackbar('📦 Receipt recorded');
        }}
      />
    </div>
  );
}
