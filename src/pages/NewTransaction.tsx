import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import type { Stakeholder, Project } from '../types';
import type { Session } from '@supabase/supabase-js';
import { WORKER_TRADE_GROUPS, VENDOR_TRADE_GROUPS, OTHER_TRADE } from '../lib/trades';
import { useSnackbar } from '../components/Snackbar';
import { CostCodePicker } from '../components/CostCodePicker';
import { getCostCode, costCodeLabel, ALL_COST_CODES } from '../lib/costCodes';

// ── Constants ─────────────────────────────────────────────────────────────────

// Smart COA defaults by transaction type
const COA_DEFAULTS: Record<string, { type: 'MAT' | 'WRK'; division?: string }> = {
  worker:   { type: 'WRK', division: 'WRK-21' },
  material: { type: 'MAT' },
  expense:  { type: 'WRK', division: 'WRK-22' },
};

type TxnType = 'worker' | 'material' | 'expense' | 'client_receipt';
type PayMode = 'NEFT' | 'UPI' | 'Cheque' | 'Cash';
interface AllocDraft { id: string; project_id: string; order_type: 'WO' | 'PO' | ''; order_ref: string; allocated_amount: number; }

function genTxnId() {
  return `TXN-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
}

// ── Section label ─────────────────────────────────────────────────────────────
function SectionLabel({ n, title }: { n: string; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-3 ml-0.5">
      <span className="text-[10px] font-bold text-on-surface-variant/40 tabular-nums">{n}</span>
      <span className="h-px flex-1 bg-outline-variant/20" />
      <span className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-[0.1em]">{title}</span>
    </div>
  );
}

// ── Obligation types + balance helpers ───────────────────────────────────────

interface SelectedObligation {
  type: 'WO_PHASE' | 'WO' | 'PO';
  wo_id?: string;
  phase_id?: string;
  po_id?: string;
  label: string;
  balance: number;
}

function getWOBalance(wo: any): number { return Number(wo.order_value || 0); }
function getPhaseBalance(phase: any): number { return Number(phase.planned_amount || 0); }
function getPOBalance(po: any): number { return Number(po.vendor_bill_amount || po.total_value || 0); }

// ── NoObligationsState ────────────────────────────────────────────────────────

function NoObligationsState({ projectId, onSkip }: { projectId: string; onSkip: () => void }) {
  const nav = useNavigate();
  return (
    <div className="mt-3 rounded-xl border border-dashed border-outline-variant/30 p-6 text-center">
      <span className="material-symbols-outlined text-[32px] text-on-surface-variant/20 mb-2 block">link_off</span>
      <p className="text-[14px] font-medium text-on-surface mb-1">No open WOs or POs</p>
      <p className="text-[12px] text-on-surface-variant/50 mb-4">Create one to link this payment, or record without linking.</p>
      <div className="flex gap-2 justify-center flex-wrap">
        <button type="button" onClick={() => nav(`/work-orders/new?project=${projectId}`)}
          className="px-4 py-2 rounded-lg border border-outline-variant/30 text-[13px] font-medium text-on-surface hover:bg-surface-container transition-colors">
          + Work Order
        </button>
        <button type="button" onClick={() => nav(`/purchase-orders/new?project=${projectId}`)}
          className="px-4 py-2 rounded-lg border border-outline-variant/30 text-[13px] font-medium text-on-surface hover:bg-surface-container transition-colors">
          + Purchase Order
        </button>
        <button type="button" onClick={onSkip}
          className="px-4 py-2 rounded-lg text-[13px] text-on-surface-variant/50 hover:text-on-surface transition-colors">
          Record without linking
        </button>
      </div>
    </div>
  );
}

// ── WOObligationRow ───────────────────────────────────────────────────────────

function WOObligationRow({ wo, selectedObligation, expanded, onToggleExpand, onSelect }: {
  wo: any; selectedObligation: SelectedObligation | null;
  expanded: boolean; onToggleExpand: () => void;
  onSelect: (ob: SelectedObligation) => void;
}) {
  const hasPhases = (wo.wo_milestones?.length || 0) > 0;
  const woBalance = getWOBalance(wo);
  const isSelected = selectedObligation?.wo_id === wo.wo_id && !selectedObligation?.phase_id;

  return (
    <div className={isSelected ? 'bg-[rgba(200,96,58,0.04)]' : ''}>
      <div
        className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-black/[0.02] transition-colors"
        onClick={hasPhases ? onToggleExpand : () => onSelect({
          type: 'WO', wo_id: wo.wo_id,
          label: `${wo.wo_id} · ${wo.stakeholders?.name || ''}`,
          balance: woBalance,
        })}
      >
        <div className="w-5 shrink-0 flex items-center justify-center">
          {hasPhases ? (
            <span className="material-symbols-outlined text-[16px] text-on-surface-variant/40">
              {expanded ? 'expand_more' : 'chevron_right'}
            </span>
          ) : isSelected ? (
            <div className="w-4 h-4 rounded-full bg-[#C8603A] flex items-center justify-center">
              <span className="material-symbols-outlined text-white text-[10px]" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
            </div>
          ) : (
            <div className="w-4 h-4 rounded-full border-2 border-outline-variant/40" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-medium text-on-surface truncate">{wo.stakeholders?.name || 'Unknown'}</p>
            <span className="font-data-mono text-[10px] text-on-surface-variant/40 shrink-0">{wo.wo_id}</span>
          </div>
          {wo.scope_of_work && (
            <p className="text-[11px] text-on-surface-variant/50 truncate mt-0.5">{(wo.scope_of_work as string).slice(0, 60)}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className={`text-[13px] font-medium font-data-mono ${woBalance > 0 ? 'text-on-surface' : 'text-on-surface-variant/40'}`}>
            {woBalance > 0 ? `₹${woBalance.toLocaleString('en-IN')}` : 'Settled'}
          </p>
          {hasPhases && <p className="text-[10px] text-on-surface-variant/40">{wo.wo_milestones.length} phases</p>}
        </div>
      </div>

      {hasPhases && expanded && (
        <div className="border-t border-black/[0.04] bg-black/[0.01]">
          {wo.wo_milestones.map((phase: any) => {
            const balance = getPhaseBalance(phase);
            const isPhaseSelected = selectedObligation?.phase_id === phase.milestone_id;
            const settled = phase.status === 'PAID' || phase.status === 'Paid';
            return (
              <div key={phase.milestone_id}
                className={`pl-9 pr-4 py-3 flex items-center gap-3 border-b border-black/[0.03] last:border-0 transition-colors
                  ${settled ? 'opacity-50 cursor-not-allowed' : isPhaseSelected ? 'bg-[rgba(200,96,58,0.06)] cursor-pointer' : 'cursor-pointer hover:bg-black/[0.02]'}`}
                onClick={() => {
                  if (settled) return;
                  onSelect({ type: 'WO_PHASE', wo_id: wo.wo_id, phase_id: phase.milestone_id, label: `${phase.name} · ${wo.wo_id}`, balance });
                }}
              >
                <div className="w-4 shrink-0 flex items-center justify-center">
                  {isPhaseSelected ? (
                    <div className="w-4 h-4 rounded-full bg-[#C8603A] flex items-center justify-center">
                      <span className="material-symbols-outlined text-white text-[10px]" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
                    </div>
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 border-outline-variant/40" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-on-surface">{phase.name}</p>
                  {phase.qty && phase.unit_type && (
                    <p className="text-[10px] text-on-surface-variant/40 mt-0.5">
                      {phase.qty} {phase.unit_type}{phase.rate ? ` × ₹${Number(phase.rate).toLocaleString('en-IN')}` : ''}
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="text-[13px] font-medium font-data-mono text-on-surface">₹{balance.toLocaleString('en-IN')}</p>
                  {settled
                    ? <p className="text-[10px] text-[#16A34A] font-medium">Settled ✓</p>
                    : <p className="text-[10px] text-[#C8603A] font-medium">due</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── POObligationRow ───────────────────────────────────────────────────────────

function POObligationRow({ po, selectedObligation, onSelect }: {
  po: any; selectedObligation: SelectedObligation | null;
  onSelect: (ob: SelectedObligation) => void;
}) {
  const balance = getPOBalance(po);
  const isSelected = selectedObligation?.po_id === po.po_id;
  return (
    <div
      className={`px-4 py-3 flex items-center gap-3 transition-colors
        ${balance <= 0 ? 'opacity-50 cursor-not-allowed' : isSelected ? 'bg-[rgba(200,96,58,0.06)] cursor-pointer' : 'cursor-pointer hover:bg-black/[0.02]'}`}
      onClick={() => {
        if (balance <= 0) return;
        onSelect({ type: 'PO', po_id: po.po_id, label: `${po.po_id} · ${po.stakeholders?.name || ''}`, balance });
      }}
    >
      <div className="w-5 shrink-0 flex items-center justify-center">
        {isSelected ? (
          <div className="w-4 h-4 rounded-full bg-[#C8603A] flex items-center justify-center">
            <span className="material-symbols-outlined text-white text-[10px]" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
          </div>
        ) : (
          <div className="w-4 h-4 rounded-full border-2 border-outline-variant/40" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-[13px] font-medium text-on-surface">{po.stakeholders?.name || 'Unknown'}</p>
          <span className="font-data-mono text-[10px] text-on-surface-variant/40 shrink-0">{po.po_id}</span>
        </div>
        {po.po_line_items?.[0] && (
          <p className="text-[11px] text-on-surface-variant/50 truncate mt-0.5">
            {po.po_line_items[0].item_name || po.po_line_items[0].description || po.po_line_items[0].name || ''}
            {po.po_line_items.length > 1 && ` +${po.po_line_items.length - 1} more`}
          </p>
        )}
      </div>
      <div className="text-right shrink-0 ml-3">
        {balance > 0
          ? <><p className="text-[13px] font-medium font-data-mono text-on-surface">₹{balance.toLocaleString('en-IN')}</p><p className="text-[10px] text-[#C8603A] font-medium">due</p></>
          : <p className="text-[12px] text-[#16A34A] font-medium">Settled ✓</p>}
      </div>
    </div>
  );
}

// ── LinkingPanel ──────────────────────────────────────────────────────────────

function LinkingPanel({ wos, pos, loading, selectedObligation, onSelect, onSkip, projectId }: {
  wos: any[]; pos: any[]; loading: boolean;
  selectedObligation: SelectedObligation | null;
  onSelect: (ob: SelectedObligation) => void;
  onSkip: () => void; projectId: string;
}) {
  const [expandedWOs, setExpandedWOs] = useState<string[]>([]);
  const hasData = wos.length > 0 || pos.length > 0;

  if (loading) {
    return (
      <div className="mt-3 rounded-xl border border-outline-variant/20 p-4 space-y-3">
        <div className="h-3 w-36 bg-surface-container-highest rounded animate-pulse" />
        <div className="h-12 bg-surface-container-highest rounded-lg animate-pulse" />
        <div className="h-12 bg-surface-container-highest rounded-lg animate-pulse" />
      </div>
    );
  }

  if (!hasData) return <NoObligationsState projectId={projectId} onSkip={onSkip} />;

  return (
    <div className="mt-3 rounded-xl border border-outline-variant/20 overflow-hidden">
      <div className="px-4 py-2.5 bg-black/[0.02] border-b border-outline-variant/[0.08]">
        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/50">
          Link to Work Order or Purchase Order
        </p>
        <p className="text-[11px] text-on-surface-variant/40 mt-0.5">Select what this payment is for</p>
      </div>

      <div className="divide-y divide-outline-variant/[0.06]">
        {wos.length > 0 && (
          <div>
            <div className="px-4 py-1.5 bg-black/[0.01]">
              <p className="text-[9px] font-bold uppercase tracking-wide text-on-surface-variant/40">
                Work Orders ({wos.length})
              </p>
            </div>
            {wos.map((wo: any) => (
              <WOObligationRow key={wo.wo_id} wo={wo} selectedObligation={selectedObligation}
                expanded={expandedWOs.includes(wo.wo_id)}
                onToggleExpand={() => setExpandedWOs(prev =>
                  prev.includes(wo.wo_id) ? prev.filter(id => id !== wo.wo_id) : [...prev, wo.wo_id]
                )}
                onSelect={onSelect} />
            ))}
          </div>
        )}
        {pos.length > 0 && (
          <div>
            <div className="px-4 py-1.5 bg-black/[0.01]">
              <p className="text-[9px] font-bold uppercase tracking-wide text-on-surface-variant/40">
                Purchase Orders ({pos.length})
              </p>
            </div>
            {pos.map((po: any) => (
              <POObligationRow key={po.po_id} po={po} selectedObligation={selectedObligation} onSelect={onSelect} />
            ))}
          </div>
        )}
      </div>

      <div className="px-4 py-2.5 border-t border-outline-variant/[0.08] bg-black/[0.01]">
        <button type="button" onClick={onSkip}
          className="text-[12px] text-on-surface-variant/40 hover:text-on-surface transition-colors hover:underline underline-offset-2">
          Skip — record without linking
        </button>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NewTransaction({ session: _session }: { session: Session }) {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();

  const initialProjectId = (location.state as any)?.projectId || '';
  const initialStakeholderId = (location.state as any)?.stakeholderId || '';

  // ── Type ──────────────────────────────────────────────────────────────────
  const [txnType, setTxnType] = useState<TxnType | null>(null);

  // ── Core form ────────────────────────────────────────────────────────────
  const [txnId, setTxnId] = useState(genTxnId);
  const [txnIdCopied, setTxnIdCopied] = useState(false);
  const [stkId, setStkId] = useState(initialStakeholderId);
  const [stkSearch, setStkSearch] = useState('');
  const [showSug, setShowSug] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newStkTrade, setNewStkTrade] = useState('');
  const [newStkTradeOther, setNewStkTradeOther] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [mode, setMode] = useState<PayMode>('NEFT');
  const [totalAmt, setTotalAmt] = useState<number>(0);
  const [category, setCategory] = useState('');
  const [remarks, setRemarks] = useState('');
  const [billFile, setBillFile] = useState<File | null>(null);
  const [allocs, setAllocs] = useState<AllocDraft[]>([
    { id: '1', project_id: initialProjectId, order_type: '', order_ref: '', allocated_amount: 0 },
  ]);
  const [splitMode, setSplitMode] = useState(false);

  // ── Budget warning state ─────────────────────────────────────────────────
  const [budgetWarning, setBudgetWarning] = useState<{
    code: string; codeName: string; planned: number; currentSpent: number; newTotal: number; overBy: number;
  } | null>(null);
  const [pendingSaveMode, setPendingSaveMode] = useState<'new' | 'exit' | null>(null);

  // ── Obligation linking state ─────────────────────────────────────────────
  const [selectedObligation, setSelectedObligation] = useState<SelectedObligation | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [loadingObligations, setLoadingObligations] = useState(false);
  const [projectWOs, setProjectWOs] = useState<any[]>([]);
  const [projectPOs, setProjectPOs] = useState<any[]>([]);
  const [amountTouched, setAmountTouched] = useState(false);

  // ── Client receipt smart suggestion state ────────────────────────────────
  const [dismissedReceiptSuggestion, setDismissedReceiptSuggestion] = useState(false);
  const [dismissedMilestoneSuggestion, setDismissedMilestoneSuggestion] = useState(false);
  const [receiptDescription, setReceiptDescription] = useState('');
  const [receiptRef, setReceiptRef] = useState('');

  // ── AI cost-code suggestion state ────────────────────────────────────────
  const [aiCodeState, setAiCodeState] = useState<'idle' | 'loading' | 'suggested' | 'none'>('idle');
  const [aiSuggestedCode, setAiSuggestedCode] = useState<string | null>(null);
  const aiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── High-volume state ────────────────────────────────────────────────────
  const [recentPayees, setRecentPayees] = useState<{ id: string; name: string; type: string }[]>([]);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const { show: showSnackbar } = useSnackbar();
  const payeeRef = useRef<HTMLInputElement>(null);
  const stkDropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (txnType) setTimeout(() => payeeRef.current?.focus(), 60);
  }, [txnType]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (stkDropRef.current && !stkDropRef.current.contains(e.target as Node)) setShowSug(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSave('exit'); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: stakeholders } = useQuery({
    queryKey: ['stakeholders'],
    queryFn: async () => { const { data } = await supabase.from('stakeholders').select('*'); return data as Stakeholder[]; },
  });
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => { const { data } = await supabase.from('projects').select('*'); return data as Project[]; },
  });
  // Fetch WOs + POs filtered by stakeholder + project
  const selectedProjectId = !splitMode ? (allocs[0]?.project_id || '') : '';
  useEffect(() => {
    if (!selectedProjectId || !stkId || txnType === 'expense' || txnType === 'client_receipt') {
      setProjectWOs([]); setProjectPOs([]); setSelectedObligation(null); setSkipped(false);
      return;
    }
    let cancelled = false;
    setLoadingObligations(true);
    setSelectedObligation(null); setSkipped(false);
    Promise.all([
      supabase
        .from('work_orders')
        .select('wo_id, scope_of_work, order_value, status, stakeholders(name, category), wo_milestones(*)')
        .eq('project_id', selectedProjectId)
        .eq('stakeholder_id', stkId)
        .in('status', ['Active', 'Issued', 'Assigned', 'ACTIVE', 'ISSUED', 'ASSIGNED'])
        .order('date_issued', { ascending: false }),
      supabase
        .from('purchase_orders')
        .select('po_id, status, vendor_bill_amount, total_value, stakeholders(name, category), po_line_items(*)')
        .eq('project_id', selectedProjectId)
        .eq('stakeholder_id', stkId)
        .in('status', ['ORDERED', 'BILLED', 'PARTIAL'])
        .order('created_at', { ascending: false }),
    ]).then(([{ data: wos, error: woErr }, { data: pos, error: poErr }]) => {
      if (woErr) console.error('[LinkingPanel] WO fetch error:', woErr);
      if (poErr) console.error('[LinkingPanel] PO fetch error:', poErr);
      if (!cancelled) { setProjectWOs(wos || []); setProjectPOs(pos || []); setLoadingObligations(false); }
    });
    return () => { cancelled = true; };
  }, [selectedProjectId, stkId, txnType]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const tgtType = txnType === 'worker' ? 'Worker' : txnType === 'material' ? 'Vendor' : txnType === 'client_receipt' ? 'Client' : '';
  const filtStk = (stakeholders || []).filter(
    (s) => (tgtType ? s.type === tgtType : true) && s.name.toLowerCase().includes(stkSearch.toLowerCase())
  );
  const selName = stakeholders?.find((s) => s.stakeholder_id === stkId)?.name || '';
  const filteredRecents = recentPayees.filter((p) => !tgtType || p.type === tgtType);

  const effectiveAllocs = splitMode ? allocs : [{ ...allocs[0], allocated_amount: totalAmt }];
  const totalAlloc = effectiveAllocs.reduce((s, a) => s + (Number(a.allocated_amount) || 0), 0);
  const remaining = Number(totalAmt) - totalAlloc;
  const isOver = splitMode && remaining < 0;
  const isFullyAllocated = splitMode && remaining === 0 && totalAmt > 0;

  // ── Mutations ────────────────────────────────────────────────────────────
  const createStakeholder = useMutation({
    mutationFn: async (fd: FormData) => {
      const type = txnType === 'worker' ? 'Worker' : 'Vendor';
      const firstName = (fd.get('first_name') as string || '').trim();
      const lastName = (fd.get('last_name') as string || '').trim();
      const fullName = lastName ? `${firstName} ${lastName}` : firstName;
      const ns = {
        stakeholder_id: `STK-${Math.floor(1000 + Math.random() * 9000)}`,
        name: fullName,
        type,
        category: newStkTrade === OTHER_TRADE ? (newStkTradeOther.trim() || 'Other') : (newStkTrade || 'General'),
        contact: fd.get('contact') as string,
      };
      const { data, error } = await supabase.from('stakeholders').insert([ns]).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['stakeholders'] });
      setStkId(d.stakeholder_id); setStkSearch(d.name);
      setShowCreate(false); setShowSug(false);
      setNewStkTrade(''); setNewStkTradeOther('');
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to save stakeholder', { type: 'error' }),
  });

  const createTxn = useMutation({
    mutationFn: async ({ saveMode }: { saveMode: 'new' | 'exit' }) => {
      const isClientReceipt = txnType === 'client_receipt';
      let bill_doc_url: string | null = null;
      if (billFile) {
        const ext = billFile.name.split('.').pop();
        const filename = `${txnId}-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from('documents').upload(`bills/${filename}`, billFile);
        if (uploadError) throw uploadError;
        const { data: pubData } = supabase.storage.from('documents').getPublicUrl(`bills/${filename}`);
        bill_doc_url = pubData.publicUrl;
      }
      const effectiveCategory = isClientReceipt ? 'CLIENT-RECEIPT' : category;
      const effectiveRemarks = isClientReceipt
        ? (receiptDescription.trim() || (receiptRef.trim() ? `Ref: ${receiptRef.trim()}` : ''))
        : remarks || '';
      const payload = {
        txn_id: txnId, stakeholder_id: stkId, date, total_amount: totalAmt,
        payment_mode: mode,
        category: effectiveCategory,
        remarks: effectiveRemarks, bill_doc_url,
        ai_flag_status: 'Clean',
        ai_flag_data: {},
      };
      const mapped = effectiveAllocs.map((a) => {
        if (isClientReceipt) {
          return { project_id: a.project_id, order_type: null, order_ref: null, milestone_id: null, allocated_amount: a.allocated_amount };
        }
        let order_type: string | null = null, order_ref: string | null = null, milestone_id: string | null = null;
        if (selectedObligation?.type === 'WO' || selectedObligation?.type === 'WO_PHASE') {
          order_type = 'WO'; order_ref = selectedObligation.wo_id || null; milestone_id = selectedObligation.phase_id || null;
        } else if (selectedObligation?.type === 'PO') {
          order_type = 'PO'; order_ref = selectedObligation.po_id || null;
        }
        return { project_id: a.project_id, order_type, order_ref, milestone_id, allocated_amount: a.allocated_amount };
      });
      const { error } = await supabase.rpc('insert_transaction_with_allocations', { p_txn: payload, p_allocations: mapped });
      if (error) throw error;
      return { savedId: txnId, saveMode };
    },
    onSuccess: ({ savedId, saveMode }) => {
      qc.invalidateQueries({ queryKey: ['ledger'] });
      qc.invalidateQueries({ queryKey: ['po_payment_totals'] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      const stk = stakeholders?.find((s) => s.stakeholder_id === stkId);
      if (stk) setRecentPayees((prev) => [{ id: stk.stakeholder_id, name: stk.name, type: stk.type }, ...prev.filter((p) => p.id !== stk.stakeholder_id)].slice(0, 5));
      if (saveMode === 'exit') {
        navigate('/ledger');
      } else {
        const keptProject = allocs[0]?.project_id || '';
        setTxnId(genTxnId()); setStkId(''); setStkSearch(''); setShowSug(false); setShowCreate(false);
        setNewStkTrade(''); setNewStkTradeOther('');
        setTotalAmt(0); setCategory(''); setRemarks(''); setBillFile(null);
        setSaveAttempted(false); setSplitMode(false);
        setDate(new Date().toISOString().split('T')[0]);
        setAllocs([{ id: Math.random().toString(), project_id: keptProject, order_type: '', order_ref: '', allocated_amount: 0 }]);
        setSelectedObligation(null); setSkipped(false); setAmountTouched(false);
        setProjectWOs([]); setProjectPOs([]);
        setAiCodeState('idle'); setAiSuggestedCode(null);
        setDismissedReceiptSuggestion(false);
        setDismissedMilestoneSuggestion(false);
        setReceiptDescription('');
        setReceiptRef('');
        showSnackbar(`${savedId} saved`, { action: { label: 'View', onClick: () => navigate(`/ledger/${savedId}`) } });
        setTimeout(() => payeeRef.current?.focus(), 80);
      }
    },
  });

  const addAlloc = () => setAllocs((prev) => [...prev, { id: Math.random().toString(), project_id: '', order_type: '', order_ref: '', allocated_amount: 0 }]);
  const rmAlloc = (id: string) => setAllocs((prev) => prev.filter((a) => a.id !== id));
  const upAlloc = (id: string, updates: Partial<AllocDraft>) => setAllocs((prev) => prev.map((a) => (a.id === id ? { ...a, ...updates } : a)));

  const suggestCostCode = async (text: string) => {
    if (!text || text.trim().length < 5) { setAiCodeState('idle'); return; }
    setAiCodeState('loading');
    setAiSuggestedCode(null);
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    if (!apiKey) { setAiCodeState('idle'); return; }
    const codeList = ALL_COST_CODES.map(c => `${c.code}: ${c.name}`).join('\n');
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 15,
          messages: [
            { role: 'system', content: 'You classify Indian construction payment remarks into cost codes. Return ONLY the single best matching code (e.g. "WRK-07-02") or "NONE" if ambiguous. Nothing else.' },
            { role: 'user', content: `Remark: "${text.trim()}"\n\nCost codes:\n${codeList}` },
          ],
        }),
      });
      const data = await res.json();
      const result = (data.choices?.[0]?.message?.content || 'NONE').trim().replace(/["'.]/g, '').toUpperCase();
      if (result === 'NONE' || !getCostCode(result)) {
        setAiSuggestedCode(null);
        setAiCodeState('none');
      } else {
        setAiSuggestedCode(result);
        setAiCodeState('suggested');
      }
    } catch {
      setAiCodeState('idle');
    }
  };

  const handleSave = async (saveMode: 'new' | 'exit') => {
    setSaveAttempted(true);
    if (txnType === 'client_receipt') {
      if (!stkId || !totalAmt || totalAmt <= 0) return;
      if (effectiveAllocs.some((a) => !a.project_id)) return;
      createTxn.mutate({ saveMode });
      return;
    }
    if (!stkId || !totalAmt || totalAmt <= 0 || !remarks.trim() || isOver) return;
    if (effectiveAllocs.some((a) => !a.project_id)) return;

    // Budget check — only for single-allocation with a cost code
    if (!splitMode && category && allocs[0]?.project_id) {
      const pid = allocs[0].project_id;
      const { data: budgetLine } = await supabase
        .from('project_budgets')
        .select('planned_amount')
        .eq('project_id', pid)
        .eq('cost_code', category)
        .maybeSingle();

      if (budgetLine?.planned_amount) {
        const { data: allocData } = await supabase
          .from('txn_allocations')
          .select('allocated_amount, transactions(status, category)')
          .eq('project_id', pid);
        const currentSpent = (allocData || [])
          .filter((a: any) => a.transactions?.status === 'Active' && a.transactions?.category === category)
          .reduce((s: number, a: any) => s + Number(a.allocated_amount), 0);
        const newTotal = currentSpent + totalAmt;
        if (newTotal > Number(budgetLine.planned_amount)) {
            const ccFound = getCostCode(category);
          setBudgetWarning({
            code: category,
            codeName: ccFound ? `${category} · ${ccFound.item.name}` : category,
            planned: Number(budgetLine.planned_amount),
            currentSpent,
            newTotal,
            overBy: newTotal - Number(budgetLine.planned_amount),
          });
          setPendingSaveMode(saveMode);
          return;
        }
      }
    }

    createTxn.mutate({ saveMode });
  };

  const missingPayee = saveAttempted && !stkId;
  const missingAmount = saveAttempted && totalAmt <= 0;
  const missingRemarks = saveAttempted && !remarks.trim() && txnType !== 'client_receipt';
  const missingProject = saveAttempted && effectiveAllocs.some((a) => !a.project_id);

  // ── Smart suggestion: completed phase linked ─────────────────────────────
  const completedMilestoneLinked = !dismissedMilestoneSuggestion &&
    (txnType === 'worker' || txnType === 'material') &&
    selectedObligation?.type === 'WO_PHASE' &&
    (() => {
      const wo = projectWOs.find(w => w.wo_id === selectedObligation?.wo_id);
      const phase = wo?.wo_milestones?.find((m: any) => m.milestone_id === selectedObligation?.phase_id);
      return phase?.status === 'Completed' || phase?.status === 'Approved';
    })();


  const handleRaiseBillFromReceiptNav = () => {
    navigate('/billing/new', {
      state: {
        clientId: stkId,
        amount: totalAmt,
        projectId: allocs[0]?.project_id || '',
        date,
      },
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-surface-container-low/50">
      <div className="max-w-xl mx-auto px-4 pt-8 pb-36">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-start gap-3 mb-10">
          <button
            onClick={() => navigate('/ledger')}
            className="mt-0.5 p-2 hover:bg-white/80 rounded-xl transition-colors text-on-surface-variant shrink-0"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-[22px] font-bold text-on-surface tracking-tight leading-tight">New Transaction</h1>
            <p className="text-[11px] text-on-surface-variant/50 font-data-mono mt-1">{txnId}</p>
          </div>
        </div>

        {/* ── Type selector ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
          {([
            { key: 'worker'         as TxnType, icon: 'engineering',   label: 'Worker',   sub: 'Payment',  accent: 'text-primary',   sel: 'border-primary/60 bg-primary/5'    },
            { key: 'material'       as TxnType, icon: 'shopping_cart', label: 'Material', sub: 'Purchase', accent: 'text-tertiary',  sel: 'border-tertiary/60 bg-tertiary/5'  },
            { key: 'expense'        as TxnType, icon: 'receipt_long',  label: 'General',  sub: 'Expense',  accent: 'text-error',     sel: 'border-error/60 bg-error/5'        },
            { key: 'client_receipt' as TxnType, icon: 'payments',      label: 'Client',   sub: 'Receipt',  accent: 'text-secondary', sel: 'border-secondary/60 bg-secondary/5' },
          ]).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                if (txnType !== t.key) {
                  setTxnType(t.key); setStkId(''); setStkSearch('');
                  setCategory(''); setSaveAttempted(false);
                  setNewStkTrade(''); setNewStkTradeOther('');
                  setDismissedReceiptSuggestion(false);
                  setDismissedMilestoneSuggestion(false);
                }
              }}
              className={`relative p-4 rounded-2xl border-2 text-left transition-all duration-150 ${
                txnType === t.key
                  ? `${t.sel} shadow-sm`
                  : 'border-outline-variant/20 bg-white hover:border-outline-variant/40 hover:shadow-sm'
              }`}
            >
              <span className={`material-symbols-outlined text-[30px] mb-2.5 block transition-colors ${txnType === t.key ? t.accent : 'text-on-surface-variant/40'}`}>
                {t.icon}
              </span>
              <p className={`text-[13px] font-semibold leading-none ${txnType === t.key ? 'text-on-surface' : 'text-on-surface-variant/60'}`}>{t.label}</p>
              <p className={`text-[11px] mt-1 leading-none ${txnType === t.key ? 'text-on-surface-variant/70' : 'text-on-surface-variant/35'}`}>{t.sub}</p>
              {txnType === t.key && (
                <span className="absolute top-2.5 right-2.5 material-symbols-outlined text-[16px] text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Empty state ─────────────────────────────────────────────────── */}
        {!txnType && (
          <div className="text-center py-20">
            <span className="material-symbols-outlined text-[64px] text-on-surface-variant/15 block mb-4">touch_app</span>
            <p className="text-body-md text-on-surface-variant/40">Select a type above to begin</p>
          </div>
        )}

        {/* ── Form ────────────────────────────────────────────────────────── */}
        {txnType && (
          <div className="space-y-8">

            {/* ━━ 01 · Payment / Receipt Details ━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <div>
              <SectionLabel n="01" title={txnType === 'client_receipt' ? 'Receipt Details' : 'Payment Details'} />
              <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm">
                <div className="p-6 space-y-6">

                  {/* Payee / Client */}
                  <div className="relative" ref={stkDropRef}>
                    <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">
                      {txnType === 'worker' ? 'Worker' : txnType === 'material' ? 'Vendor' : txnType === 'client_receipt' ? 'Client' : 'Payee'}
                      {missingPayee && <span className="text-error ml-1.5">required</span>}
                    </label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant/35 pointer-events-none">search</span>
                      <input
                        ref={payeeRef}
                        type="text"
                        value={stkId ? selName : stkSearch}
                        onChange={(e) => { setStkSearch(e.target.value); if (stkId) setStkId(''); setShowSug(true); setShowCreate(false); }}
                        onFocus={() => setShowSug(true)}
                        placeholder={`Search ${tgtType ? tgtType.toLowerCase() : 'payee'}…`}
                        className={`bk-input pl-10 pr-10 ${missingPayee ? 'border-error' : ''}`}
                        autoComplete="new-password"
                      />
                      {stkId && (
                        <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                      )}
                    </div>

                    {/* Dropdown */}
                    {showSug && !stkId && (
                      <div className="absolute left-0 right-0 top-full bg-white border border-black/[0.08] rounded-xl mt-1 z-30 shadow-lg max-h-60 overflow-y-auto">
                        {filteredRecents.length > 0 && !stkSearch && (
                          <>
                            <div className="px-4 pt-3 pb-1 text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest">Recent</div>
                            {filteredRecents.map((p) => (
                              <div key={p.id} onClick={() => { setStkId(p.id); setStkSearch(p.name); setShowSug(false); }}
                                className="px-4 py-2.5 hover:bg-surface-container-low/60 cursor-pointer flex items-center gap-3">
                                <span className="material-symbols-outlined text-[14px] text-on-surface-variant/40">history</span>
                                <span className="text-[13px] font-medium text-on-surface">{p.name}</span>
                              </div>
                            ))}
                            <div className="mx-4 border-t border-outline-variant/15 my-1" />
                          </>
                        )}
                        {filtStk.map((s) => (
                          <div key={s.stakeholder_id} onClick={() => { setStkId(s.stakeholder_id); setStkSearch(s.name); setShowSug(false); }}
                            className="px-4 py-3 hover:bg-surface-container-low/60 cursor-pointer border-b border-outline-variant/[0.08] last:border-0">
                            <p className="text-[13px] font-semibold text-on-surface">{s.name}</p>
                            <p className="text-[11px] text-on-surface-variant/50 mt-0.5">{s.category}</p>
                          </div>
                        ))}
                        {filtStk.length === 0 && stkSearch && (
                          <div className="px-4 py-4 text-[13px] text-on-surface-variant/50 text-center">No matches for "{stkSearch}"</div>
                        )}
                        <div onClick={() => setShowCreate(true)}
                          className="px-4 py-3 cursor-pointer flex items-center gap-2.5 text-primary border-t border-outline-variant/15 hover:bg-primary/[0.04]">
                          <span className="material-symbols-outlined text-[17px]">person_add</span>
                          <span className="text-[13px] font-semibold">Add new{stkSearch ? ` "${stkSearch}"` : ''}</span>
                        </div>
                      </div>
                    )}

                    {/* Inline quick-add */}
                    {showCreate && !stkId && (
                      <div className="mt-2 border border-outline-variant/30 rounded-2xl p-5 bg-surface-container-lowest/60">
                        <p className="text-[12px] font-semibold text-on-surface mb-4">Quick-add {tgtType || 'stakeholder'}</p>
                        <div className="grid grid-cols-2 gap-3 mb-4">
                          <div>
                            <label className="text-[10px] font-medium text-on-surface-variant/60 block mb-1.5">First name</label>
                            <input id="stk_fn" className="bk-input" placeholder="First" defaultValue={stkSearch.split(' ')[0] || ''} autoFocus />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium text-on-surface-variant/60 block mb-1.5">Last name</label>
                            <input id="stk_ln" className="bk-input" placeholder="Last" defaultValue={stkSearch.split(' ').slice(1).join(' ') || ''} />
                          </div>
                        </div>
                        <div className="mb-4">
                          <label className="text-[10px] font-medium text-on-surface-variant/60 block mb-1.5">
                            Trade <span className="text-red-500">*</span>
                          </label>
                          <select className="bk-input" value={newStkTrade} onChange={(e) => { setNewStkTrade(e.target.value); setNewStkTradeOther(''); }}>
                            <option value="" disabled>Select trade…</option>
                            {(txnType === 'worker' ? WORKER_TRADE_GROUPS : VENDOR_TRADE_GROUPS).map((g) => (
                              <optgroup key={g.group} label={g.group}>
                                {g.trades.map((t) => <option key={t} value={t}>{t}</option>)}
                              </optgroup>
                            ))}
                          </select>
                          {newStkTrade === OTHER_TRADE && (
                            <input className="bk-input mt-2" placeholder="Specify trade…" value={newStkTradeOther} onChange={(e) => setNewStkTradeOther(e.target.value)} autoFocus />
                          )}
                        </div>
                        <div className="mb-5">
                          <label className="text-[10px] font-medium text-on-surface-variant/60 block mb-1.5">Contact (optional)</label>
                          <input id="stk_contact" className="bk-input" placeholder="Phone" />
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button type="button" className="bk-btn-ghost px-4 py-2 rounded-xl text-[13px]" onClick={() => { setShowCreate(false); setNewStkTrade(''); setNewStkTradeOther(''); }}>Cancel</button>
                          <button
                            type="button"
                            className="bk-btn px-4 py-2 rounded-xl text-[13px] disabled:opacity-50"
                            disabled={
                              !newStkTrade ||
                              (newStkTrade === OTHER_TRADE && !newStkTradeOther.trim()) ||
                              createStakeholder.isPending
                            }
                            onClick={() => { const fd = new FormData(); fd.append('first_name', (document.getElementById('stk_fn') as HTMLInputElement).value); fd.append('last_name', (document.getElementById('stk_ln') as HTMLInputElement).value); fd.append('contact', (document.getElementById('stk_contact') as HTMLInputElement).value); createStakeholder.mutate(fd); }}
                          >
                            {createStakeholder.isPending ? 'Saving…' : 'Save & select'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Client Receipt: Reference + Description fields */}
                  {txnType === 'client_receipt' && (
                    <>
                      <div>
                        <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Reference / UTR <span className="text-on-surface-variant/35">(optional)</span></label>
                        <input
                          type="text"
                          value={receiptRef}
                          onChange={e => setReceiptRef(e.target.value)}
                          className="bk-input"
                          placeholder="UTR / cheque / reference number"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Description <span className="text-on-surface-variant/35">(optional)</span></label>
                        <input
                          type="text"
                          value={receiptDescription}
                          onChange={e => setReceiptDescription(e.target.value)}
                          className="bk-input"
                          placeholder="What this payment is for…"
                        />
                      </div>
                    </>
                  )}

                  {/* Amount — hero field */}
                  <div>
                    <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">
                      {txnType === 'client_receipt' ? 'Amount Received' : 'Amount'}{missingAmount && <span className="text-error ml-1.5">required</span>}
                    </label>
                    <div className="relative">
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[28px] font-bold text-on-surface-variant/25 font-data-mono leading-none select-none">₹</span>
                      <input
                        type="number" inputMode="decimal" step="0.01" min="0"
                        value={totalAmt || ''}
                        onChange={(e) => { setAmountTouched(true); setTotalAmt(parseFloat(e.target.value) || 0); }}
                        onFocus={(e) => e.target.select()}
                        className={`w-full pl-8 pr-2 py-2 text-[36px] font-bold font-data-mono bg-transparent border-b-2 outline-none transition-colors placeholder:text-on-surface-variant/20 ${
                          missingAmount ? 'border-error text-error' : 'border-outline-variant/30 text-on-surface focus:border-primary'
                        }`}
                        placeholder="0"
                      />
                    </div>
                  </div>

                  {/* Date + Mode */}
                  <div className="grid grid-cols-2 gap-5">
                    <div>
                      <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Date</label>
                      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bk-input" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Payment mode</label>
                      <div className="flex rounded-xl overflow-hidden border border-outline-variant/25">
                        {(['NEFT', 'UPI', 'Cheque', 'Cash'] as PayMode[]).map((m, i) => (
                          <button key={m} type="button" onClick={() => setMode(m)}
                            className={`flex-1 py-2.5 text-[12px] font-semibold transition-colors ${
                              mode === m ? 'bg-primary text-on-primary' : 'bg-white text-on-surface-variant/60 hover:bg-surface-container-low/60'
                            } ${i > 0 ? 'border-l border-outline-variant/25' : ''}`}>
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            </div>

            {/* ━━ 02 · Categorise (hidden for client_receipt) ━━━━━━━━━━━━━ */}
            {txnType !== 'client_receipt' && <div>
              <SectionLabel n="02" title="Categorise" />
              <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm">
                <div className="p-6 space-y-5">

                  {/* Cost code picker — optional, AI-assisted */}
                  <div>
                    <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2.5">
                      Cost Code <span className="text-on-surface-variant/35">(optional)</span>
                    </label>
                    <CostCodePicker
                      value={category}
                      onChange={(v) => { setCategory(v); setAiCodeState('idle'); setAiSuggestedCode(null); }}
                      defaultType={txnType ? COA_DEFAULTS[txnType]?.type : 'MAT'}
                      defaultDivision={txnType ? COA_DEFAULTS[txnType]?.division : undefined}
                      error={false}
                    />

                    {/* AI suggestion chip */}
                    {!category && aiCodeState !== 'idle' && (
                      <div className="mt-2.5">
                        {aiCodeState === 'loading' && (
                          <div className="flex items-center gap-2 text-[11px] text-on-surface-variant/40">
                            <Loader2 className="animate-spin shrink-0" size={12} />
                            Reading remarks…
                          </div>
                        )}
                        {aiCodeState === 'suggested' && aiSuggestedCode && (
                          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-primary/[0.04] border border-primary/15">
                            <span className="material-symbols-outlined text-[16px] text-primary shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] text-on-surface-variant/50 mb-0.5">AI suggests</p>
                              <p className="text-[12px] font-medium text-on-surface">{costCodeLabel(aiSuggestedCode)}</p>
                            </div>
                            <div className="flex gap-1.5 shrink-0">
                              <button type="button"
                                onClick={() => { setCategory(aiSuggestedCode!); setAiCodeState('idle'); setAiSuggestedCode(null); }}
                                className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[12px] font-semibold hover:opacity-90 transition-opacity">
                                Apply
                              </button>
                              <button type="button"
                                onClick={() => { setAiCodeState('idle'); setAiSuggestedCode(null); }}
                                className="px-2.5 py-1.5 rounded-lg text-[12px] text-on-surface-variant/50 hover:text-on-surface hover:bg-surface-container transition-colors">
                                Dismiss
                              </button>
                            </div>
                          </div>
                        )}
                        {aiCodeState === 'none' && (
                          <div className="flex items-center gap-2 text-[11px] text-on-surface-variant/35">
                            <span className="material-symbols-outlined text-[13px]">help_outline</span>
                            Couldn't determine cost code from remarks — select manually if needed
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Remarks — required */}
                  <div>
                    <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">
                      Remarks
                      {missingRemarks
                        ? <span className="text-error ml-1.5">required</span>
                        : <span className="text-on-surface-variant/35 ml-1">(what is this payment for?)</span>}
                    </label>
                    <textarea
                      value={remarks}
                      onChange={(e) => {
                        setRemarks(e.target.value);
                        if (category) return; // already has a code
                        if (aiDebounceRef.current) clearTimeout(aiDebounceRef.current);
                        if (e.target.value.trim().length >= 5) {
                          setAiCodeState('idle');
                          aiDebounceRef.current = setTimeout(() => suggestCostCode(e.target.value), 1000);
                        } else {
                          setAiCodeState('idle');
                          setAiSuggestedCode(null);
                        }
                      }}
                      className={`bk-input w-full min-h-[72px] resize-none ${missingRemarks ? 'border-error' : ''}`}
                      placeholder="e.g. Payment for tile fixing in bathroom, 2nd floor…"
                      rows={3}
                    />
                  </div>

                  {/* TXN ID */}
                  <div className="flex items-center gap-2 py-2">
                    <span className="text-[10px] font-medium text-on-surface-variant/40 shrink-0">TXN ID</span>
                    <span className="font-data-mono text-[12px] text-on-surface-variant/50 flex-1">{txnId}</span>
                    <button type="button" onClick={() => { navigator.clipboard.writeText(txnId); setTxnIdCopied(true); setTimeout(() => setTxnIdCopied(false), 2000); }}
                      className="text-[11px] text-on-surface-variant/40 hover:text-primary transition-colors flex items-center gap-1">
                      {txnIdCopied
                        ? <><span className="material-symbols-outlined text-[13px] text-secondary">check</span><span className="text-secondary">Copied</span></>
                        : <span className="material-symbols-outlined text-[14px]">content_copy</span>}
                    </button>
                  </div>

                </div>
              </div>
            </div>}

            {/* ━━ 03 · Project Allocation ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <div>
              <div className="flex items-center gap-2.5 mb-3 ml-0.5">
                <span className="text-[10px] font-bold text-on-surface-variant/40 tabular-nums">03</span>
                <span className="h-px flex-1 bg-outline-variant/20" />
                <span className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-[0.1em]">Project Allocation</span>
                {splitMode && totalAmt > 0 && txnType !== 'client_receipt' && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ml-1 ${
                    isOver ? 'bg-error-container text-error' :
                    isFullyAllocated ? 'bg-secondary-container text-on-secondary-container' :
                    'bg-surface-container-highest text-on-surface-variant'
                  }`}>
                    {isOver ? `₹${Math.abs(remaining).toLocaleString()} over` : isFullyAllocated ? 'Balanced' : `₹${remaining.toLocaleString()} left`}
                  </span>
                )}
              </div>

              {/* Client Receipt: simple project picker only */}
              {txnType === 'client_receipt' ? (
                <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-5">
                  <div>
                    <label className={`block text-[11px] font-medium mb-1.5 ${missingProject && !allocs[0]?.project_id ? 'text-error' : 'text-on-surface-variant/60'}`}>
                      Project / Site{missingProject && !allocs[0]?.project_id && <span className="ml-1.5">required</span>}
                    </label>
                    <select
                      value={allocs[0]?.project_id || ''}
                      onChange={(e) => setAllocs([{ ...allocs[0], project_id: e.target.value }])}
                      className={`bk-input ${missingProject && !allocs[0]?.project_id ? 'border-error' : ''}`}
                    >
                      <option value="">Select project…</option>
                      {projects?.map((p) => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
                    </select>
                  </div>
                </div>
              ) : (
              <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm overflow-hidden">

                {effectiveAllocs.map((a, idx) => {

                  return (
                    <div key={a.id} className={`p-5 space-y-4 ${idx > 0 ? 'border-t border-black/[0.04]' : ''}`}>

                      {/* Split header */}
                      {splitMode && (
                        <div className="flex items-center justify-between -mb-1">
                          <span className="text-[11px] font-semibold text-on-surface-variant/50">Split {idx + 1}</span>
                          {allocs.length > 1 && (
                            <button type="button" onClick={() => rmAlloc(a.id)}
                              className="text-[12px] text-error/60 hover:text-error transition-colors flex items-center gap-1">
                              <span className="material-symbols-outlined text-[14px]">remove_circle</span>Remove
                            </button>
                          )}
                        </div>
                      )}

                      {/* Project picker */}
                      <div>
                        <label className={`block text-[11px] font-medium mb-1.5 ${missingProject && !a.project_id ? 'text-error' : 'text-on-surface-variant/60'}`}>
                          Project / Site{missingProject && !a.project_id && <span className="ml-1.5">required</span>}
                        </label>
                        <select
                          value={a.project_id}
                          onChange={(e) => upAlloc(a.id, { project_id: e.target.value, order_type: '', order_ref: '' })}
                          className={`bk-input ${missingProject && !a.project_id ? 'border-error' : ''}`}
                        >
                          <option value="">Select project…</option>
                          {projects?.map((p) => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
                        </select>
                      </div>

                      {/* Linking Panel — replaces old WO/PO dropdowns */}
                      {!splitMode && txnType !== 'expense' && a.project_id && !skipped && (
                        <LinkingPanel
                          wos={projectWOs}
                          pos={projectPOs}
                          loading={loadingObligations}
                          selectedObligation={selectedObligation}
                          onSelect={(ob) => {
                            setSelectedObligation(ob);
                            setSkipped(false);
                            if (!amountTouched) setTotalAmt(ob.balance);
                          }}
                          onSkip={() => { setSelectedObligation(null); setSkipped(true); }}
                          projectId={a.project_id}
                        />
                      )}

                      {/* Relink button shown after skip */}
                      {!splitMode && txnType !== 'expense' && a.project_id && skipped && (
                        <button type="button"
                          onClick={() => { setSkipped(false); setSelectedObligation(null); }}
                          className="flex items-center gap-1.5 text-[12px] text-on-surface-variant/50 hover:text-primary transition-colors">
                          <span className="material-symbols-outlined text-[14px]">link</span>
                          Link to a Work Order or PO
                        </button>
                      )}

                      {/* Split amount */}
                      {splitMode && (
                        <div>
                          <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-1.5">Amount for this split</label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] font-bold text-on-surface-variant/30 font-data-mono select-none">₹</span>
                            <input type="number" step="0.01" min="0"
                              value={a.allocated_amount || ''}
                              onChange={(e) => upAlloc(a.id, { allocated_amount: parseFloat(e.target.value) || 0 })}
                              onFocus={(e) => e.target.select()}
                              className={`bk-input pl-7 font-data-mono ${isOver ? 'border-error' : ''}`}
                              placeholder="0" />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Split controls footer */}
                <div className="px-5 py-3.5 border-t border-black/[0.04] bg-surface-container-lowest/40">
                  {!splitMode ? (
                    <button type="button"
                      onClick={() => { setSplitMode(true); setAllocs((prev) => [{ ...prev[0], allocated_amount: 0 }]); }}
                      className="flex items-center gap-2 text-[12px] text-on-surface-variant/50 hover:text-primary transition-colors">
                      <span className="material-symbols-outlined text-[16px]">call_split</span>
                      Split across multiple projects
                    </button>
                  ) : (
                    <div className="flex items-center justify-between">
                      <button type="button" onClick={addAlloc}
                        className="flex items-center gap-1.5 text-[13px] font-medium text-primary/70 hover:text-primary transition-colors">
                        <span className="material-symbols-outlined text-[16px]">add_circle</span>
                        Add another project
                      </button>
                      <button type="button" onClick={() => { setSplitMode(false); setAllocs((prev) => [{ ...prev[0], allocated_amount: 0 }]); }}
                        className="flex items-center gap-1 text-[12px] text-on-surface-variant/40 hover:text-on-surface-variant transition-colors">
                        <span className="material-symbols-outlined text-[13px]">close</span>
                        Remove split
                      </button>
                    </div>
                  )}
                </div>
              </div>
              )}
            </div>

            {/* ━━ Smart Suggestions ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            {txnType === 'client_receipt' && !dismissedReceiptSuggestion && stkId && totalAmt > 0 && allocs[0]?.project_id && (
              <div className="p-4 rounded-xl border border-outline-variant/20 bg-surface-container-low/60">
                <div className="flex items-start gap-3">
                  <span className="text-[18px]">💡</span>
                  <div className="flex-1">
                    <p className="text-[13px] font-semibold text-on-surface">Raise a bill for this receipt?</p>
                    <p className="text-[12px] text-on-surface-variant/70 mt-1">
                      Client receipts are often linked to a billing milestone. Create a bill to maintain clean records.
                    </p>
                    <div className="flex gap-2 mt-3">
                      <button onClick={handleRaiseBillFromReceiptNav} className="text-[12px] font-semibold text-primary hover:underline flex items-center gap-1">
                        Raise Bill <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                      </button>
                      <button onClick={() => setDismissedReceiptSuggestion(true)} className="text-[12px] text-on-surface-variant/50 hover:text-on-surface-variant transition-colors ml-2">
                        Skip, just record
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {(txnType === 'worker' || txnType === 'material') && !dismissedMilestoneSuggestion && completedMilestoneLinked && (
              <div className="p-4 rounded-xl border border-outline-variant/20 bg-surface-container-low/60">
                <div className="flex items-start gap-3">
                  <span className="text-[18px]">💡</span>
                  <div className="flex-1">
                    <p className="text-[13px] font-semibold text-on-surface">This milestone may be billable</p>
                    <p className="text-[12px] text-on-surface-variant/70 mt-1">
                      The linked milestone is marked complete. Raise a bill to your client for this work?
                    </p>
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => navigate('/billing/new')} className="text-[12px] font-semibold text-primary hover:underline flex items-center gap-1">
                        Raise Bill <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                      </button>
                      <button onClick={() => setDismissedMilestoneSuggestion(true)} className="text-[12px] text-on-surface-variant/50 hover:text-on-surface-variant transition-colors ml-2">
                        Not now
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ━━ 04 · Proof Document ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <div>
              <SectionLabel n="04" title="Proof Document" />
              <input type="file" id="proof-upload" onChange={(e) => setBillFile(e.target.files?.[0] || null)} className="hidden" accept=".pdf,.jpg,.jpeg,.png" />
              <label htmlFor="proof-upload"
                className={`flex items-center gap-4 p-5 bg-white rounded-2xl border-2 border-dashed cursor-pointer transition-all group ${
                  billFile ? 'border-secondary/40 bg-secondary-container/10' : 'border-outline-variant/25 hover:border-primary/30 hover:bg-primary/[0.02]'
                }`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                  billFile ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-high text-on-surface-variant/50 group-hover:text-primary'
                }`}>
                  <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: billFile ? "'FILL' 1" : "'FILL' 0" }}>
                    {billFile ? 'attach_file' : 'upload_file'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-on-surface truncate">
                    {billFile ? billFile.name : 'Attach proof'}
                  </p>
                  <p className="text-[11px] text-on-surface-variant/40 mt-0.5">
                    {billFile ? `${(billFile.size / 1024).toFixed(0)} KB` : 'PDF, JPG or PNG · optional'}
                  </p>
                </div>
                {billFile && (
                  <button type="button" onClick={(e) => { e.preventDefault(); setBillFile(null); }}
                    className="p-1.5 hover:bg-error-container/20 rounded-lg transition-colors shrink-0">
                    <span className="material-symbols-outlined text-[16px] text-error/60">close</span>
                  </button>
                )}
              </label>
            </div>

            {/* Unlinked warning */}
            {saveAttempted && !selectedObligation && !skipped &&
              (txnType === 'worker' || txnType === 'material') &&
              allocs[0]?.project_id && (
              <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200/60 rounded-xl">
                <span className="material-symbols-outlined text-amber-500 text-[16px] shrink-0 mt-0.5">warning</span>
                <div>
                  <p className="text-[12px] font-medium text-amber-800">Not linked to a Work Order or Purchase Order</p>
                  <p className="text-[11px] text-amber-700/70 mt-0.5">This payment won't appear in any WO or PO balance. That's fine for general expenses.</p>
                </div>
              </div>
            )}

            {/* Error */}
            {createTxn.isError && (
              <div className="p-4 bg-error-container text-on-error-container rounded-xl text-[13px] font-medium">
                {(createTxn.error as any)?.message || 'Error saving transaction'}
              </div>
            )}

          </div>
        )}
      </div>

      {/* ── Budget over-limit confirmation dialog ──────────────────────────── */}
      {budgetWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-elevation-16 w-full max-w-sm p-6 space-y-4">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-error text-[24px] shrink-0 mt-0.5">warning</span>
              <div>
                <p className="text-[15px] font-bold text-on-surface">Over budget</p>
                <p className="text-[12px] text-on-surface-variant/60 mt-0.5">{budgetWarning.codeName}</p>
              </div>
            </div>
            <div className="bg-error/[0.06] rounded-xl p-3 space-y-1.5 text-[12px]">
              <div className="flex justify-between">
                <span className="text-on-surface-variant/60">Budget target</span>
                <span className="font-data-mono font-semibold">₹{budgetWarning.planned.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant/60">Already spent</span>
                <span className="font-data-mono">₹{budgetWarning.currentSpent.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant/60">This transaction</span>
                <span className="font-data-mono">₹{totalAmt.toLocaleString('en-IN')}</span>
              </div>
              <div className="border-t border-error/20 pt-1.5 flex justify-between">
                <span className="font-semibold text-error">Over budget by</span>
                <span className="font-data-mono font-bold text-error">₹{budgetWarning.overBy.toLocaleString('en-IN')}</span>
              </div>
            </div>
            <div className="flex gap-2.5">
              <button type="button"
                onClick={() => { setBudgetWarning(null); setPendingSaveMode(null); }}
                className="flex-1 px-4 py-2.5 rounded-xl border border-outline-variant/30 text-[13px] font-medium text-on-surface-variant hover:bg-surface-container transition-colors">
                Cancel
              </button>
              <button type="button"
                onClick={() => {
                  const mode = pendingSaveMode;
                  setBudgetWarning(null);
                  setPendingSaveMode(null);
                  if (mode) createTxn.mutate({ saveMode: mode });
                }}
                className="flex-1 px-4 py-2.5 rounded-xl bg-error text-on-error text-[13px] font-semibold hover:opacity-90 transition-opacity">
                Save anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bottom Action Bar ───────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-md border-t border-black/[0.06] shadow-sm">
        <div className="max-w-xl mx-auto px-4 py-3.5 flex items-center gap-3">
          <button type="button" onClick={() => navigate('/ledger')}
            className="text-[13px] font-medium text-on-surface-variant/60 hover:text-on-surface px-3 py-2 rounded-xl hover:bg-surface-container-low/60 transition-colors">
            Cancel
          </button>
          <div className="flex-1" />
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2.5">
              <button type="button" onClick={() => handleSave('new')} disabled={!txnType || createTxn.isPending}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-primary/30 text-primary text-[13px] font-semibold hover:bg-primary/5 transition-colors disabled:opacity-35">
                {createTxn.isPending && (createTxn.variables as any)?.saveMode === 'new'
                  ? <Loader2 className="animate-spin" size={14} />
                  : <span className="material-symbols-outlined text-[16px]">add</span>}
                Save & new
              </button>
              <button type="button" onClick={() => handleSave('exit')} disabled={!txnType || createTxn.isPending}
                className="bk-btn flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-35">
                {createTxn.isPending && (createTxn.variables as any)?.saveMode === 'exit'
                  ? <Loader2 className="animate-spin" size={14} />
                  : <span className="material-symbols-outlined text-[16px]">check</span>}
                Save & exit
              </button>
            </div>
            <p className="text-[10px] text-on-surface-variant/35 mr-0.5">⌘ Enter</p>
          </div>
        </div>
      </div>
    </div>
  );
}
