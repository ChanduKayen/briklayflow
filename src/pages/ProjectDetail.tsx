import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Breadcrumb from '../components/Breadcrumb';
import { TxnRow } from '../components/TxnRow';
import { usePeek } from '../context/PeekContext';
import { useUserProfile } from '../App';
import { useSnackbar } from '../components/Snackbar';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const p = new Date(d);
  if (isNaN(p.getTime())) return d;
  return p.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtShortDate(d: string) {
  const p = new Date(d);
  return isNaN(p.getTime()) ? '' : p.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function fmtLakh(n: number): string {
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000)    return `₹${Math.round(n / 1_000)}K`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function genTxnId() {
  return `TXN-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
}

function isClientReceipt(category: string): boolean {
  const u = (category ?? '').toUpperCase().replace(/[\s_\-]/g, '');
  return u === 'CLIENTRECEIPT' || u === 'CLIENTRCPT';
}

function isExcludedFromSpent(category: string): boolean {
  const u = (category ?? '').toUpperCase().replace(/[\s_\-]/g, '');
  return isClientReceipt(category) || u.includes('FUNDING') || u.includes('INFLOW');
}

function applyDateFilter(dateStr: string, filter: string): boolean {
  if (filter === 'all') return true;
  const d = new Date(dateStr);
  const now = new Date();
  if (filter === 'week') {
    const ago = new Date(); ago.setDate(ago.getDate() - 7);
    return d >= ago;
  }
  if (filter === 'month') {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  if (filter === 'last_month') {
    const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const e = new Date(now.getFullYear(), now.getMonth(), 0);
    return d >= s && d <= e;
  }
  return true;
}

// ── AnimatedNumber ────────────────────────────────────────────────────────────

function AnimatedNumber({ value, format = fmtLakh }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(0);
  const fired = useRef(false);
  const raf   = useRef<number | null>(null);

  useEffect(() => {
    if (value <= 0) { setShown(0); return; }
    if (fired.current) { setShown(value); return; }
    fired.current = true;
    const duration = 600;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      setShown(Math.round(value * (1 - (1 - p) ** 3)));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [value]);

  return <>{format(shown)}</>;
}

// ── Status maps ───────────────────────────────────────────────────────────────

const WO_STATUS: Record<string, string> = {
  Draft:     'bg-slate-100 text-slate-500',
  Assigned:  'bg-blue-50 text-blue-600',
  Issued:    'bg-violet-50 text-violet-700',
  Active:    'bg-amber-50 text-amber-600',
  Closed:    'bg-emerald-50 text-emerald-600',
  Cancelled: 'bg-rose-50 text-rose-600',
};

const PO_STATUS: Record<string, string> = {
  ORDERED:   'bg-blue-50 text-blue-600',
  BILLED:    'bg-amber-50 text-amber-700',
  PARTIAL:   'bg-orange-50 text-orange-600',
  PAID:      'bg-green-50 text-green-700',
  CANCELLED: 'bg-gray-100 text-gray-400',
};

const PROJECT_STATUS: Record<string, string> = {
  Active:    'bg-emerald-50 text-emerald-700',
  'On Hold': 'bg-amber-50 text-amber-700',
  Completed: 'bg-blue-50 text-blue-700',
};

// ── Filter chip ───────────────────────────────────────────────────────────────

function FilterPill({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`h-7 px-3 rounded-full text-[11px] font-medium whitespace-nowrap transition-all ${
        active
          ? 'bg-[#D97757]/[0.08] text-[#D97757] border border-[#D97757]/20'
          : 'border border-outline-variant/25 text-on-surface-variant/55 hover:border-outline-variant/50'
      }`}
    >
      {label}
    </button>
  );
}

// ── Search input ──────────────────────────────────────────────────────────────

function SearchInput({
  value, onChange, placeholder = 'Search…',
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[14px] text-on-surface-variant/35 pointer-events-none">
        search
      </span>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-7 pl-7 pr-7 w-40 rounded-full border border-outline-variant/25 bg-white text-[12px] text-on-surface outline-none focus:border-[#D97757]/40 focus:w-52 transition-[width] duration-200"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant/30 hover:text-on-surface"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

// ── WO Row ────────────────────────────────────────────────────────────────────

function WORowCard({ wo, onClick }: { wo: any; onClick: () => void }) {
  const orderVal = Number(wo.order_value) || 0;
  return (
    <div
      onClick={onClick}
      style={{ minHeight: 64 }}
      className="flex items-center justify-between px-4 py-3.5 border-b border-black/[0.05] last:border-0 cursor-pointer hover:bg-surface-container-low/40 transition-colors"
    >
      <div className="flex-1 min-w-0 mr-4">
        <p className="text-[11px] font-mono text-on-surface-variant/35 leading-none mb-0.5">{wo.wo_id}</p>
        <p className="text-[14px] font-[500] text-on-surface truncate">{wo.stakeholders?.name || '—'}</p>
        {wo.scope_of_work && (
          <p className="text-[12px] text-on-surface-variant/50 truncate mt-0.5">{wo.scope_of_work}</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${WO_STATUS[wo.status] || 'bg-surface-container text-on-surface'}`}>
            {wo.status}
          </span>
          <span className="text-[13px] font-semibold font-mono text-on-surface">
            ₹{orderVal.toLocaleString('en-IN')}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── PO Row ────────────────────────────────────────────────────────────────────

function PORowCard({ po, onClick }: { po: any; onClick: () => void }) {
  const billAmt  = Number(po.vendor_bill_amount) || 0;
  const orderVal = Number(po.total_value) || Number(po.order_value) || 0;
  const items: any[] = po.po_line_items ?? [];
  const preview = (() => {
    if (!items.length) return '';
    const names = items.slice(0, 2).map((li: any) => li.item_name || li.description).filter(Boolean);
    const extra = items.length - 2;
    return names.join(', ') + (extra > 0 ? ` +${extra} more` : '');
  })();

  return (
    <div
      onClick={onClick}
      style={{ minHeight: 64 }}
      className="flex items-center justify-between px-4 py-3.5 border-b border-black/[0.05] last:border-0 cursor-pointer hover:bg-surface-container-low/40 transition-colors"
    >
      <div className="flex-1 min-w-0 mr-4">
        <p className="text-[11px] font-mono text-on-surface-variant/35 leading-none mb-0.5">{po.po_id}</p>
        <p className="text-[14px] font-[500] text-on-surface truncate">{po.stakeholders?.name || '—'}</p>
        {preview && <p className="text-[12px] text-on-surface-variant/50 truncate mt-0.5">{preview}</p>}
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${PO_STATUS[po.status] || 'bg-surface-container text-on-surface'}`}>
            {(po.status || '').charAt(0) + (po.status || '').slice(1).toLowerCase()}
          </span>
          <span className={`text-[13px] font-semibold font-mono ${billAmt > 0 ? 'text-emerald-700' : 'text-on-surface/60'}`}>
            ₹{(billAmt > 0 ? billAmt : orderVal).toLocaleString('en-IN')}
          </span>
        </div>
        {po.received_at_site && (
          <p className="text-[11px] text-purple-600">✓ Received {fmtShortDate(po.received_at_site)}</p>
        )}
      </div>
    </div>
  );
}

// ── Financial Strip Cell ──────────────────────────────────────────────────────

function FinCell({
  label, amount, sub, subAccent = false, onClick,
}: {
  label: string; amount: number | null; sub?: string;
  subAccent?: boolean; onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`px-4 py-4 ${onClick ? 'cursor-pointer hover:bg-surface-container-low/50 transition-colors' : ''}`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-1.5 whitespace-nowrap">
        {label}
      </p>
      <p className="text-[20px] font-semibold tabular-nums text-on-surface leading-none mb-1">
        {amount === null ? '—' : <AnimatedNumber value={amount} />}
      </p>
      {sub && (
        <p className={`text-[11px] whitespace-nowrap ${subAccent ? 'text-amber-600' : 'text-on-surface-variant/40'}`}>
          {sub}
        </p>
      )}
    </div>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

type TabKey = 'overview' | 'transactions' | 'work_orders' | 'purchase_orders';

function TabBar({ active, onChange, tabs }: {
  active: TabKey;
  onChange: (k: TabKey) => void;
  tabs: { key: TabKey; label: string; count?: number }[];
}) {
  return (
    <div className="flex border-b border-outline-variant/20 overflow-x-auto no-scrollbar">
      {tabs.map(tab => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`relative px-4 py-2.5 text-[13px] font-[500] whitespace-nowrap transition-colors ${
            active === tab.key ? 'text-[#D97757]' : 'text-on-surface-variant/50 hover:text-on-surface'
          }`}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className={`ml-1 text-[12px] ${active === tab.key ? 'text-[#D97757]/60' : 'text-on-surface-variant/30'}`}>
              ({tab.count})
            </span>
          )}
          {active === tab.key && (
            <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#D97757] rounded-t-sm" />
          )}
        </button>
      ))}
    </div>
  );
}

// ── QuickTransactionDrawer ────────────────────────────────────────────────────

const TXN_CATEGORIES: Record<string, string[]> = {
  worker:   ['Labour', 'Mason', 'Carpenter', 'Electrician', 'Plumber', 'Painter', 'Steel Fixer'],
  material: ['Cement', 'Steel', 'Bricks & Blocks', 'Sand & Aggregate', 'Tiles & Flooring', 'Plumbing Materials', 'Electrical Materials', 'Paint & Putty', 'Waterproofing'],
  expense:  ['Transport', 'Equipment Hire', 'Site Expenses', 'Admin & Misc'],
};

function QuickTransactionDrawer({
  projectId, projectName, onClose, onSuccess,
}: {
  projectId: string; projectName: string;
  onClose: () => void; onSuccess: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { show: showSnackbar } = useSnackbar();

  const [txnType, setTxnType]   = useState<'worker' | 'material' | 'expense'>('worker');
  const [stkId, setStkId]       = useState('');
  const [stkSearch, setStkSearch] = useState('');
  const [showSug, setShowSug]   = useState(false);
  const [amount, setAmount]     = useState('');
  const [mode, setMode]         = useState<'Cash' | 'UPI' | 'NEFT' | 'Cheque'>('Cash');
  const [category, setCategory] = useState('');
  const [remarks, setRemarks]   = useState('');
  const [date, setDate]         = useState(new Date().toISOString().split('T')[0]);
  const [saving, setSaving]     = useState(false);
  const stkRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (stkRef.current && !stkRef.current.contains(e.target as Node)) setShowSug(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [onClose]);

  const { data: stakeholders = [] } = useQuery({
    queryKey: ['stakeholders'],
    queryFn: async () => {
      const { data } = await supabase.from('stakeholders').select('stakeholder_id, name, type, category');
      return data as any[];
    },
  });

  const stkType = txnType === 'worker' ? 'Worker' : 'Vendor';
  const filtStk = stakeholders.filter(s =>
    s.type === stkType &&
    s.name.toLowerCase().includes(stkSearch.toLowerCase())
  ).slice(0, 8);
  const selName = stakeholders.find(s => s.stakeholder_id === stkId)?.name || '';
  const cats = TXN_CATEGORIES[txnType] || [];

  const handleSave = async () => {
    if (!stkId || !amount || Number(amount) <= 0) return;
    setSaving(true);
    const txnId = genTxnId();
    const { error } = await supabase.from('transactions').insert({
      txn_id: txnId,
      stakeholder_id: stkId,
      date,
      total_amount: Number(amount),
      payment_mode: mode,
      category: category || txnType,
      remarks: remarks.trim() || null,
      ai_flag_status: 'Clean',
      ai_flag_data: {},
    });
    if (error) {
      showSnackbar(error.message || 'Failed to save', { type: 'error' });
      setSaving(false);
      return;
    }
    await supabase.from('txn_allocations').insert({
      txn_id: txnId,
      project_id: projectId,
      allocated_amount: Number(amount),
    });
    qc.invalidateQueries({ queryKey: ['project_allocs_v2', projectId] });
    showSnackbar(`Transaction saved — ${txnId}`);
    setSaving(false);
    onSuccess();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full sm:w-[480px] max-h-[90vh] flex flex-col bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/15 shrink-0">
          <div>
            <p className="text-[15px] font-semibold text-on-surface">New Transaction</p>
            <p className="text-[12px] text-on-surface-variant/50 mt-0.5">{projectName}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { onClose(); navigate('/ledger/new', { state: { projectId } }); }}
              className="text-[12px] text-[#D97757] hover:underline"
            >
              Full form ↗
            </button>
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-container-high transition-colors text-on-surface-variant">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* Type selector */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">Type</p>
            <div className="grid grid-cols-3 gap-2">
              {(['worker', 'material', 'expense'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => { setTxnType(t); setStkId(''); setStkSearch(''); setCategory(''); }}
                  className={`py-2.5 rounded-xl text-[12px] font-medium transition-all ${
                    txnType === t
                      ? 'bg-[#D97757]/[0.08] text-[#D97757] border border-[#D97757]/20'
                      : 'border border-outline-variant/25 text-on-surface-variant/60 hover:border-outline-variant/50'
                  }`}
                >
                  {t === 'worker' ? 'Worker' : t === 'material' ? 'Material' : 'Expense'}
                </button>
              ))}
            </div>
          </div>

          {/* Payee */}
          <div ref={stkRef} className="relative">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">
              {txnType === 'worker' ? 'Worker' : 'Vendor'}
            </p>
            <input
              type="text"
              value={selName || stkSearch}
              onChange={e => { setStkSearch(e.target.value); setStkId(''); setShowSug(true); }}
              onFocus={() => setShowSug(true)}
              placeholder={`Search ${txnType === 'worker' ? 'worker' : 'vendor'}…`}
              className="w-full h-9 px-3 rounded-xl border border-outline-variant/25 text-[13px] outline-none focus:border-[#D97757]/40 bg-white"
            />
            {showSug && filtStk.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-outline-variant/20 rounded-xl shadow-lg z-50 overflow-hidden max-h-48 overflow-y-auto">
                {filtStk.map(s => (
                  <button
                    key={s.stakeholder_id}
                    onClick={() => { setStkId(s.stakeholder_id); setStkSearch(s.name); setShowSug(false); }}
                    className="w-full text-left px-3 py-2.5 hover:bg-surface-container-low text-[13px] text-on-surface flex items-center justify-between"
                  >
                    <span className="font-[500]">{s.name}</span>
                    <span className="text-[11px] text-on-surface-variant/40">{s.category}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Amount */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">Amount</p>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[16px] font-bold text-on-surface-variant/40">₹</span>
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0"
                className="w-full h-11 pl-7 pr-3 rounded-xl border border-outline-variant/25 text-[18px] font-semibold outline-none focus:border-[#D97757]/40 tabular-nums"
              />
            </div>
          </div>

          {/* Mode + Date side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">Mode</p>
              <div className="grid grid-cols-2 gap-1">
                {(['Cash', 'UPI', 'NEFT', 'Cheque'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                      mode === m
                        ? 'bg-[#D97757]/[0.08] text-[#D97757] border border-[#D97757]/20'
                        : 'border border-outline-variant/20 text-on-surface-variant/55'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">Date</p>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full h-9 px-3 rounded-xl border border-outline-variant/25 text-[12px] outline-none focus:border-[#D97757]/40"
              />
            </div>
          </div>

          {/* Category */}
          {cats.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">Category</p>
              <div className="flex flex-wrap gap-1.5">
                {cats.map(c => (
                  <button
                    key={c}
                    onClick={() => setCategory(category === c ? '' : c)}
                    className={`h-7 px-2.5 rounded-full text-[11px] font-medium transition-all ${
                      category === c
                        ? 'bg-[#D97757]/[0.08] text-[#D97757] border border-[#D97757]/20'
                        : 'border border-outline-variant/20 text-on-surface-variant/55 hover:border-outline-variant/40'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Note */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">Note (optional)</p>
            <input
              type="text"
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              placeholder="Brief note…"
              className="w-full h-9 px-3 rounded-xl border border-outline-variant/25 text-[13px] outline-none focus:border-[#D97757]/40"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-outline-variant/15 shrink-0 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 h-10 rounded-xl border border-outline-variant/30 text-[13px] font-medium text-on-surface-variant/60"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!stkId || !amount || Number(amount) <= 0 || saving}
            className="flex-1 h-10 rounded-xl bg-[#D97757] text-white text-[13px] font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {saving ? 'Saving…' : 'Save Transaction'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ProjectDetail({ session }: { session: Session }) {
  const { projectId } = useParams();
  const navigate      = useNavigate();
  const { openPeek }  = usePeek();
  const { data: profile } = useUserProfile(session.user.id);

  // FIX 3: default to transactions tab
  const [activeTab,   setActiveTab]  = useState<TabKey>('transactions');
  const [mounted,     setMounted]    = useState(false);
  const [showNewTxn,  setShowNewTxn] = useState(false);

  // WO filters
  const [woFilter, setWoFilter]   = useState<string[]>([]);
  const [woSearch, setWoSearch]   = useState('');

  // PO filters
  const [poFilter, setPoFilter]   = useState<string[]>([]);
  const [poSearch, setPoSearch]   = useState('');

  // Transaction filters
  const [txnSearch,  setTxnSearch]  = useState('');
  const [txnMode,    setTxnMode]    = useState('');
  const [txnDate,    setTxnDate]    = useState('all');

  const isPrincipal = profile?.role === 'principal' || profile?.role === 'management';
  const canManage   = isPrincipal || profile?.role === 'accountant';

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 40);
    return () => clearTimeout(t);
  }, []);

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: project, isLoading: loadingProject } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('*').eq('project_id', projectId).single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!projectId,
  });

  const { data: workOrders = [], isLoading: loadingWOs } = useQuery({
    queryKey: ['project_wos_v2', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_orders')
        .select('*, stakeholders(name, category)')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!projectId,
  });

  const { data: purchaseOrders = [], isLoading: loadingPOs } = useQuery({
    queryKey: ['project_pos_v2', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('*, stakeholders(name, category), po_line_items(id, item_name, description, amount)')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) {
        const { data: d2, error: e2 } = await supabase
          .from('purchase_orders')
          .select('*, stakeholders(name, category)')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false });
        if (e2) throw e2;
        return d2 as any[];
      }
      return data as any[];
    },
    enabled: !!projectId,
  });

  const { data: allocations = [], isLoading: loadingTxns } = useQuery({
    queryKey: ['project_allocs_v2', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('txn_allocations')
        .select(`
          allocated_amount,
          transactions(
            txn_id, date, category, status, payment_mode,
            total_amount, remarks, bill_doc_url,
            stakeholders(name, type, category)
          )
        `)
        .eq('project_id', projectId);
      if (error) throw error;
      return (data ?? []).filter((a: any) => a.transactions?.status === 'Active');
    },
    enabled: !!projectId,
  });

  const { data: clientInvoices = [] } = useQuery({
    queryKey: ['project_invoices_v2', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_invoices')
        .select('invoice_id, total_amount, paid_amount, status')
        .eq('project_id', projectId)
        .neq('status', 'Void')
        .neq('status', 'Cancelled');
      if (error) return [];
      return data as any[];
    },
    enabled: !!projectId && isPrincipal,
  });

  const { data: budgetLines = [] } = useQuery({
    queryKey: ['project_budgets_total', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_budgets')
        .select('planned_amount')
        .eq('project_id', projectId);
      if (error) return [];
      return data as any[];
    },
    enabled: !!projectId,
  });

  // ── Computed ──────────────────────────────────────────────────────────────

  const totalBudget = budgetLines.reduce((s: number, b: any) => s + Number(b.planned_amount), 0);

  const totalSpent = allocations.reduce((s: number, a: any) => {
    if (isExcludedFromSpent(a.transactions?.category ?? '')) return s;
    return s + Number(a.allocated_amount);
  }, 0);

  // FIX 1: committed — all WOs except Closed/Cancelled (includes Draft/Assigned/Issued/Active)
  const committedWOs = workOrders.filter((wo: any) =>
    !['Closed', 'Cancelled', 'CLOSED', 'CANCELLED'].includes(wo.status)
  );
  const openPOs = purchaseOrders.filter((po: any) =>
    !['PAID', 'CANCELLED'].includes(po.status)
  );
  const totalCommitted = [
    ...committedWOs.map((wo: any) => Number(wo.order_value) || 0),
    ...openPOs.map((po: any) =>
      Number(po.vendor_bill_amount) || Number(po.total_value) || Number(po.order_value) || 0
    ),
  ].reduce((s: number, v: number) => s + v, 0);

  const totalBilled = clientInvoices.reduce((s: number, i: any) => s + Number(i.total_amount), 0);

  // FIX 1: received — exact match on CLIENT-RECEIPT category
  const totalReceived = allocations
    .filter((a: any) => isClientReceipt(a.transactions?.category ?? ''))
    .reduce((s: number, a: any) => s + Number(a.allocated_amount), 0);

  const outstanding  = Math.max(0, totalBilled - totalReceived);
  const spentPct     = totalBudget > 0 ? Math.min((totalSpent / totalBudget) * 100, 100) : 0;
  const committedPct = totalBudget > 0 ? Math.min((totalCommitted / totalBudget) * 100, 100 - spentPct) : 0;
  const remaining    = totalBudget > 0 ? Math.max(0, totalBudget - totalSpent - totalCommitted) : 0;

  const activeWOs = workOrders.filter((wo: any) =>
    ['Active', 'Issued', 'Assigned'].includes(wo.status)
  );

  // Sorted allocations (newest first)
  const sortedAllocations = [...allocations].sort((a: any, b: any) =>
    new Date(b.transactions?.date ?? 0).getTime() - new Date(a.transactions?.date ?? 0).getTime()
  );

  // FIX 4: filtered transactions
  const filteredTxns = sortedAllocations.filter((a: any) => {
    const txn = a.transactions;
    if (!txn) return false;
    if (txnMode && txn.payment_mode !== txnMode) return false;
    if (!applyDateFilter(txn.date, txnDate)) return false;
    if (txnSearch) {
      const q = txnSearch.toLowerCase();
      const nameMatch = (txn.stakeholders?.name ?? '').toLowerCase().includes(q);
      const noteMatch = (txn.remarks ?? '').toLowerCase().includes(q);
      const idMatch   = (txn.txn_id ?? '').toLowerCase().includes(q);
      if (!nameMatch && !noteMatch && !idMatch) return false;
    }
    return true;
  });

  // FIX 4: filtered WOs
  const filteredWOs = workOrders.filter((wo: any) => {
    if (woFilter.length && !woFilter.includes(wo.status)) return false;
    if (woSearch) {
      const q = woSearch.toLowerCase();
      const nameMatch = (wo.stakeholders?.name ?? '').toLowerCase().includes(q);
      const idMatch   = (wo.wo_id ?? '').toLowerCase().includes(q);
      const scopeMatch = (wo.scope_of_work ?? '').toLowerCase().includes(q);
      if (!nameMatch && !idMatch && !scopeMatch) return false;
    }
    return true;
  });

  // FIX 4: filtered POs
  const filteredPOs = purchaseOrders.filter((po: any) => {
    if (poFilter.length && !poFilter.includes(po.status)) return false;
    if (poSearch) {
      const q = poSearch.toLowerCase();
      const nameMatch = (po.stakeholders?.name ?? '').toLowerCase().includes(q);
      const idMatch   = (po.po_id ?? '').toLowerCase().includes(q);
      if (!nameMatch && !idMatch) return false;
    }
    return true;
  });

  // ── Guards ────────────────────────────────────────────────────────────────

  if (loadingProject) {
    return (
      <div className="flex justify-center items-center min-h-[50vh]">
        <Loader2 className="animate-spin text-primary/30" size={32} />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="max-w-[900px] mx-auto px-6 pt-8">
        <div className="bg-error-container text-on-error-container p-6 rounded-xl text-[14px]">Project not found.</div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'overview',        label: 'Overview' },
    { key: 'transactions',    label: 'Transactions',    count: allocations.length },
    { key: 'work_orders',     label: 'Work Orders',     count: workOrders.length },
    { key: 'purchase_orders', label: 'Purchase Orders', count: purchaseOrders.length },
  ];

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-[900px] mx-auto px-4 md:px-6 pt-6 pb-16">

        {/* Breadcrumb */}
        <div className={`transition-opacity duration-300 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
          <Breadcrumb items={[{ label: 'Projects', href: '/projects' }, { label: project.name }]} />
        </div>

        {/* ── ZONE 1: HEADER ──────────────────────────────────────────────── */}
        <div className={`mt-5 transition-all duration-300 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'}`}>

          <div className="flex items-start gap-3 flex-wrap mb-1.5">
            <h1 className="text-[24px] font-bold tracking-[-0.03em] text-on-surface leading-tight">{project.name}</h1>
            <span className={`mt-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${PROJECT_STATUS[project.status] || 'bg-surface-container-high text-on-surface-variant'}`}>
              {project.status?.toUpperCase()}
            </span>
          </div>

          {project.site_location && (
            <p className="text-[14px] text-on-surface-variant/55 mb-3">{project.site_location}</p>
          )}
          {project.client_name && (
            <div className="mb-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant/35 mb-0.5">Client</p>
              <p className="text-[14px] font-[500] text-on-surface">{project.client_name}</p>
            </div>
          )}
          <p className="text-[13px] text-on-surface-variant/45 mb-4">
            {project.start_date && <>Started {fmtDate(project.start_date)}</>}
            {project.project_id && <> · <span className="font-mono">{project.project_id}</span></>}
          </p>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap mb-5">
            <button
              onClick={() => {}}
              className="h-8 px-3 rounded-lg border border-outline-variant/30 text-[12px] font-medium text-on-surface-variant/65 hover:border-outline-variant/60 hover:text-on-surface transition-colors"
            >
              Edit
            </button>
            {/* FIX 2: open drawer instead of navigate */}
            <button
              onClick={() => setShowNewTxn(true)}
              className="h-8 px-3 rounded-lg border border-outline-variant/30 text-[12px] font-medium text-on-surface-variant/65 hover:border-outline-variant/60 hover:text-on-surface transition-colors"
            >
              + Transaction
            </button>
            {canManage && (
              <>
                <button
                  onClick={() => navigate('/work-orders/new', { state: { projectId } })}
                  className="h-8 px-3 rounded-lg border border-outline-variant/30 text-[12px] font-medium text-on-surface-variant/65 hover:border-outline-variant/60 hover:text-on-surface transition-colors"
                >
                  + WO
                </button>
                <button
                  onClick={() => navigate('/purchase-orders/new', { state: { projectId } })}
                  className="h-8 px-3 rounded-lg border border-outline-variant/30 text-[12px] font-medium text-on-surface-variant/65 hover:border-outline-variant/60 hover:text-on-surface transition-colors"
                >
                  + PO
                </button>
              </>
            )}
          </div>

          <div className="h-px bg-outline-variant/15 mb-6" />
        </div>

        {/* ── ZONE 2: FINANCIAL STRIP ──────────────────────────────────────── */}
        <div className={`transition-all duration-300 delay-75 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>

          <div className="border border-outline-variant/20 rounded-xl overflow-x-auto mb-3 bg-white shadow-sm">
            <div className="grid grid-cols-5 divide-x divide-outline-variant/15 min-w-[520px]">
              <FinCell
                label="Budget"
                amount={totalBudget > 0 ? totalBudget : null}
                sub={totalBudget > 0 ? 'set' : 'not set'}
              />
              <FinCell
                label="Spent"
                amount={totalSpent}
                sub={`${allocations.length} payment${allocations.length !== 1 ? 's' : ''}`}
              />
              <FinCell
                label="Committed"
                amount={totalCommitted}
                sub={`${committedWOs.length} WO · ${openPOs.length} PO open`}
              />
              <FinCell
                label="Billed"
                amount={isPrincipal ? totalBilled : null}
                sub={isPrincipal
                  ? (clientInvoices.length > 0 ? `${clientInvoices.length} invoice${clientInvoices.length !== 1 ? 's' : ''}` : 'no invoices')
                  : 'restricted'}
              />
              <FinCell
                label="Received"
                amount={isPrincipal ? totalReceived : null}
                sub={isPrincipal
                  ? (outstanding > 0 ? `${fmtLakh(outstanding)} outstanding` : 'fully collected')
                  : 'restricted'}
                subAccent={isPrincipal && outstanding > 0}
              />
            </div>
          </div>

          {totalBudget > 0 && (
            <div className="mb-6">
              <div className="h-1.5 bg-outline-variant/15 rounded-full overflow-hidden flex">
                <div className="h-full bg-[#D97757] transition-all duration-700" style={{ width: `${spentPct}%` }} />
                <div className="h-full bg-amber-300/80 transition-all duration-700 delay-100" style={{ width: `${committedPct}%` }} />
              </div>
              <p className="text-[11px] text-on-surface-variant/40 mt-1.5">
                <span className="text-on-surface/70 font-[500]">{fmtLakh(remaining)}</span> remaining of {fmtLakh(totalBudget)} budget
              </p>
            </div>
          )}
        </div>

        {/* ── ZONE 3: TABS ─────────────────────────────────────────────────── */}
        <div className={`transition-all duration-300 delay-100 ${mounted ? 'opacity-100' : 'opacity-0'}`}>

          <TabBar active={activeTab} onChange={setActiveTab} tabs={tabs} />

          <div className="mt-6">

            {/* ── OVERVIEW ───────────────────────────────────────────────── */}
            {activeTab === 'overview' && (
              <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-8">
                <div className="space-y-7 min-w-0">
                  <section>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/35">Recent Activity</p>
                      <button onClick={() => setActiveTab('transactions')} className="text-[12px] text-[#D97757] hover:underline">View all →</button>
                    </div>
                    {loadingTxns ? (
                      <p className="text-[13px] text-on-surface-variant/30 py-3">Loading…</p>
                    ) : sortedAllocations.length === 0 ? (
                      <p className="text-[13px] text-on-surface-variant/40 py-3">No transactions yet.</p>
                    ) : (
                      <div className="bg-white rounded-xl border border-outline-variant/15 overflow-hidden">
                        {sortedAllocations.slice(0, 5).map((alloc: any, idx: number) => (
                          <TxnRow
                            key={`${alloc.transactions?.txn_id}-${idx}`}
                            txn={alloc.transactions}
                            context="project"
                            variant="compact"
                            onClick={() => openPeek('TRANSACTION', alloc.transactions?.txn_id)}
                          />
                        ))}
                      </div>
                    )}
                  </section>

                  <section>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/35">Active Work Orders</p>
                      <button onClick={() => setActiveTab('work_orders')} className="text-[12px] text-[#D97757] hover:underline">View all →</button>
                    </div>
                    {loadingWOs ? (
                      <p className="text-[13px] text-on-surface-variant/30 py-3">Loading…</p>
                    ) : activeWOs.length === 0 ? (
                      <p className="text-[13px] text-on-surface-variant/40 py-3">No active work orders.</p>
                    ) : (
                      <div className="bg-white rounded-xl border border-outline-variant/15 overflow-hidden">
                        {activeWOs.slice(0, 3).map((wo: any) => (
                          <WORowCard key={wo.wo_id} wo={wo} onClick={() => openPeek('WO', wo.wo_id)} />
                        ))}
                      </div>
                    )}
                  </section>
                </div>

                <div className="space-y-7">
                  <section>
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/35 mb-3">Project Details</p>
                    <div className="space-y-3">
                      {([
                        project.client_name   && { label: 'Client',    value: project.client_name,   mono: false },
                        project.site_location && { label: 'Location',  value: project.site_location, mono: false },
                        project.start_date    && { label: 'Started',   value: fmtDate(project.start_date), mono: false },
                        project.project_id    && { label: 'Reference', value: project.project_id,    mono: true },
                        project.project_type  && { label: 'Type',      value: project.project_type,  mono: false },
                        project.area_sqft     && { label: 'Area',      value: `${Number(project.area_sqft).toLocaleString('en-IN')} sqft`, mono: false },
                      ] as ({ label: string; value: string; mono: boolean } | false)[]).filter(Boolean).map(row => {
                        const r = row as { label: string; value: string; mono: boolean };
                        return (
                          <div key={r.label}>
                            <p className="text-[10px] text-on-surface-variant/35 mb-0.5 uppercase tracking-wide">{r.label}</p>
                            <p className={`text-[13px] text-on-surface ${r.mono ? 'font-mono' : 'font-[450]'}`}>{r.value}</p>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  <section>
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/35 mb-3">Quick Stats</p>
                    <div className="space-y-2.5">
                      {([
                        { label: 'Active WOs',        value: activeWOs.length },
                        { label: 'Open POs',           value: openPOs.length },
                        { label: 'Total transactions', value: allocations.length },
                        totalBudget > 0 && { label: 'Budget used', value: `${Math.round((totalSpent / totalBudget) * 100)}%` },
                      ] as ({ label: string; value: string | number } | false)[]).filter(Boolean).map(stat => {
                        const s = stat as { label: string; value: string | number };
                        return (
                          <div key={s.label} className="flex items-center justify-between">
                            <span className="text-[13px] text-on-surface-variant/55">{s.label}</span>
                            <span className="text-[13px] font-[600] text-on-surface tabular-nums">{s.value}</span>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                </div>
              </div>
            )}

            {/* ── TRANSACTIONS ───────────────────────────────────────────── */}
            {activeTab === 'transactions' && (
              <div>
                {/* FIX 4: filter row */}
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Mode pills */}
                    <FilterPill label="All modes" active={txnMode === ''} onClick={() => setTxnMode('')} />
                    {['Cash', 'UPI', 'NEFT', 'Cheque'].map(m => (
                      <FilterPill key={m} label={m} active={txnMode === m} onClick={() => setTxnMode(txnMode === m ? '' : m)} />
                    ))}
                    {/* Date select */}
                    <select
                      value={txnDate}
                      onChange={e => setTxnDate(e.target.value)}
                      className="h-7 pl-2 pr-6 rounded-full border border-outline-variant/25 text-[11px] text-on-surface-variant/60 bg-white outline-none focus:border-[#D97757]/40 appearance-none"
                    >
                      <option value="all">All time</option>
                      <option value="week">This week</option>
                      <option value="month">This month</option>
                      <option value="last_month">Last month</option>
                    </select>
                    <SearchInput value={txnSearch} onChange={setTxnSearch} placeholder="Search payee…" />
                  </div>
                  <button
                    onClick={() => setShowNewTxn(true)}
                    className="h-8 px-3.5 rounded-xl bg-[#D97757] text-white text-[12px] font-semibold flex items-center gap-1 shrink-0"
                  >
                    <span className="material-symbols-outlined text-[15px]">add</span>
                    Add
                  </button>
                </div>

                {/* Count */}
                {(txnSearch || txnMode || txnDate !== 'all') && (
                  <p className="text-[11px] text-on-surface-variant/35 mb-3">
                    {filteredTxns.length} of {allocations.length} transactions
                  </p>
                )}

                {loadingTxns ? (
                  <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-primary/25" size={24} /></div>
                ) : filteredTxns.length === 0 ? (
                  <div className="py-16 text-center">
                    <span className="material-symbols-outlined text-[48px] text-on-surface-variant/10 block mb-3">receipt</span>
                    <p className="text-[14px] font-[500] text-on-surface/40">
                      {allocations.length === 0 ? 'No transactions yet' : 'No results'}
                    </p>
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-outline-variant/15 overflow-hidden shadow-sm">
                    {filteredTxns.map((alloc: any, idx: number) => (
                      <TxnRow
                        key={`${alloc.transactions?.txn_id}-${idx}`}
                        txn={alloc.transactions}
                        context="project"
                        variant="full"
                        onClick={() => openPeek('TRANSACTION', alloc.transactions?.txn_id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── WORK ORDERS ────────────────────────────────────────────── */}
            {activeTab === 'work_orders' && (
              <div>
                {/* FIX 4: filter row */}
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {['Draft', 'Assigned', 'Issued', 'Active', 'Closed', 'Cancelled'].map(s => (
                      <FilterPill
                        key={s} label={s}
                        active={woFilter.includes(s)}
                        onClick={() => setWoFilter(f => f.includes(s) ? f.filter(x => x !== s) : [...f, s])}
                      />
                    ))}
                    {woFilter.length > 0 && (
                      <button onClick={() => setWoFilter([])} className="text-[11px] text-on-surface-variant/35 hover:text-error transition-colors">Clear</button>
                    )}
                    <SearchInput value={woSearch} onChange={setWoSearch} placeholder="Search contractor…" />
                  </div>
                  {canManage && (
                    <button
                      onClick={() => navigate('/work-orders/new', { state: { projectId } })}
                      className="h-8 px-3.5 rounded-xl bg-[#D97757] text-white text-[12px] font-semibold flex items-center gap-1 shrink-0"
                    >
                      <span className="material-symbols-outlined text-[15px]">add</span>
                      New WO
                    </button>
                  )}
                </div>

                {(woSearch || woFilter.length > 0) && (
                  <p className="text-[11px] text-on-surface-variant/35 mb-3">{filteredWOs.length} of {workOrders.length} work orders</p>
                )}

                {loadingWOs ? (
                  <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-primary/25" size={24} /></div>
                ) : filteredWOs.length === 0 ? (
                  <div className="py-16 text-center">
                    <span className="material-symbols-outlined text-[48px] text-on-surface-variant/10 block mb-3">engineering</span>
                    <p className="text-[14px] font-[500] text-on-surface/40">
                      {workOrders.length === 0 ? 'No work orders yet' : 'No results'}
                    </p>
                    {canManage && workOrders.length === 0 && (
                      <button onClick={() => navigate('/work-orders/new', { state: { projectId } })} className="mt-4 bk-btn text-[13px]">
                        + Create first work order
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-outline-variant/15 overflow-hidden shadow-sm">
                    {filteredWOs.map((wo: any) => (
                      <WORowCard key={wo.wo_id} wo={wo} onClick={() => openPeek('WO', wo.wo_id)} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── PURCHASE ORDERS ─────────────────────────────────────────── */}
            {activeTab === 'purchase_orders' && (
              <div>
                {/* FIX 4: filter row */}
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {['ORDERED', 'BILLED', 'PARTIAL', 'PAID', 'CANCELLED'].map(s => (
                      <FilterPill
                        key={s} label={s.charAt(0) + s.slice(1).toLowerCase()}
                        active={poFilter.includes(s)}
                        onClick={() => setPoFilter(f => f.includes(s) ? f.filter(x => x !== s) : [...f, s])}
                      />
                    ))}
                    {poFilter.length > 0 && (
                      <button onClick={() => setPoFilter([])} className="text-[11px] text-on-surface-variant/35 hover:text-error transition-colors">Clear</button>
                    )}
                    <SearchInput value={poSearch} onChange={setPoSearch} placeholder="Search vendor…" />
                  </div>
                  {canManage && (
                    <button
                      onClick={() => navigate('/purchase-orders/new', { state: { projectId } })}
                      className="h-8 px-3.5 rounded-xl bg-[#D97757] text-white text-[12px] font-semibold flex items-center gap-1 shrink-0"
                    >
                      <span className="material-symbols-outlined text-[15px]">add</span>
                      New PO
                    </button>
                  )}
                </div>

                {(poSearch || poFilter.length > 0) && (
                  <p className="text-[11px] text-on-surface-variant/35 mb-3">{filteredPOs.length} of {purchaseOrders.length} purchase orders</p>
                )}

                {loadingPOs ? (
                  <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-primary/25" size={24} /></div>
                ) : filteredPOs.length === 0 ? (
                  <div className="py-16 text-center">
                    <span className="material-symbols-outlined text-[48px] text-on-surface-variant/10 block mb-3">receipt_long</span>
                    <p className="text-[14px] font-[500] text-on-surface/40">
                      {purchaseOrders.length === 0 ? 'No purchase orders yet' : 'No results'}
                    </p>
                    {canManage && purchaseOrders.length === 0 && (
                      <button onClick={() => navigate('/purchase-orders/new', { state: { projectId } })} className="mt-4 bk-btn text-[13px]">
                        + Create first purchase order
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-outline-variant/15 overflow-hidden shadow-sm">
                    {filteredPOs.map((po: any) => (
                      <PORowCard key={po.po_id} po={po} onClick={() => openPeek('PO', po.po_id)} />
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </div>

      {/* FIX 2: Quick transaction drawer */}
      {showNewTxn && project && (
        <QuickTransactionDrawer
          projectId={project.project_id}
          projectName={project.name}
          onClose={() => setShowNewTxn(false)}
          onSuccess={() => {}}
        />
      )}
    </div>
  );
}
