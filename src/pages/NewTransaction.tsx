import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import type { Stakeholder, Project } from '../types';
import type { Session } from '@supabase/supabase-js';
import { WORKER_TRADE_GROUPS, VENDOR_TRADE_GROUPS, OTHER_TRADE } from '../lib/trades';
import { useSnackbar } from '../components/Snackbar';
import { useOrgId } from '../lib/auth/AuthProvider';
import { CostCodePicker } from '../components/CostCodePicker';
import { getCostCode, costCodeLabel, ALL_COST_CODES } from '../lib/costCodes';
import { autoCloseWOIfFullyPaid } from '../lib/woAutoClose';

// ── New Transaction UI redesign — four-voice + money-direction tokens ──────────
// Visual only (NewTransaction_v1.jsx reference). Applied via inline styles; never
// read by any handler/mutation/query. worker/material/expense = OUT, receipt = IN.
const VOICE = {
  user: '#1E1A15', userSoft: '#3D3830',
  system: '#6B6258', systemFaint: '#9A9186',
  ask: '#8A5A0B', askDeep: '#6B4407', askWash: '#FBF3E0', askLine: '#E5C98F',
  confirm: '#2F5D34', confirmWash: '#E9F2E7',
  out: '#9A3B1F', outWash: '#FAEFE9', outLine: '#E8C5B4',
  inn: '#2F5D34', innWash: '#E9F2E7', innLine: '#BFD8BC',
  page: '#FBFAF8', surface: '#FFFFFF', field: '#F4F2EE', line: '#E8E4DE',
};
const VNUMS = { fontVariantNumeric: 'tabular-nums' as const };

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
      <span className="text-[10px] font-bold tabular-nums" style={{ color: VOICE.systemFaint }}>{n}</span>
      <span className="h-px flex-1" style={{ background: VOICE.line }} />
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: VOICE.system }}>{title}</span>
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
function getPOBalance(po: any): number { return Number(po.vendor_bill_amount || po.total_value || po.order_value || 0); }

// ── NoObligationsState ────────────────────────────────────────────────────────

function NoObligationsState({ onSkip, onOpenWO, onOpenPO, txnType }: {
  onSkip: () => void;
  onOpenWO: () => void;
  onOpenPO: () => void;
  txnType?: string | null;
}) {
  const showWO = txnType === 'worker' || (!txnType);
  const showPO = txnType === 'material' || (!txnType);
  return (
    <div className="mt-3 rounded-xl border border-dashed border-outline-variant/30 p-6 text-center">
      <span className="material-symbols-outlined text-[32px] text-on-surface-variant/20 mb-2 block">link_off</span>
      <p className="text-[14px] font-medium text-on-surface mb-1">
        {txnType === 'worker' ? 'No open Work Orders' : txnType === 'material' ? 'No open Purchase Orders' : 'No open WOs or POs'}
      </p>
      <p className="text-[12px] text-on-surface-variant/50 mb-4">Create one to link this payment, or record without linking.</p>
      <div className="flex gap-2 justify-center flex-wrap">
        {showWO && (
          <button type="button" onClick={onOpenWO}
            className="px-4 py-2 rounded-lg border border-[#C8603A]/30 bg-[#C8603A]/[0.03] text-[13px] font-semibold text-[#C8603A] hover:bg-[#C8603A]/[0.07] transition-colors flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px]">engineering</span>
            New Work Order
          </button>
        )}
        {showPO && (
          <button type="button" onClick={onOpenPO}
            className="px-4 py-2 rounded-lg border border-[#006c49]/30 bg-[#006c49]/[0.03] text-[13px] font-semibold text-[#006c49] hover:bg-[#006c49]/[0.07] transition-colors flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px]">shopping_cart</span>
            New Purchase Order
          </button>
        )}
        <button type="button" onClick={onSkip}
          className="px-4 py-2 rounded-lg text-[13px] text-on-surface-variant/50 hover:text-on-surface transition-colors">
          Record without linking
        </button>
      </div>
    </div>
  );
}

// ── WOObligationRow ───────────────────────────────────────────────────────────

function WOObligationRow({ wo, selectedObligation, expanded, onToggleExpand, onSelect, milestonePayments }: {
  wo: any; selectedObligation: SelectedObligation | null;
  expanded: boolean; onToggleExpand: () => void;
  onSelect: (ob: SelectedObligation) => void;
  milestonePayments: Record<string, number>;
}) {
  const hasPhases = (wo.wo_milestones?.length || 0) > 0;
  const woBalance = getWOBalance(wo);
  const isSelected = selectedObligation?.wo_id === wo.wo_id && !selectedObligation?.phase_id;

  return (
    <div className={`transition-colors duration-200 ${isSelected ? 'bg-[#C8603A]/[0.02]' : ''}`}>
      <div
        className="px-5 py-3.5 flex items-center gap-3 cursor-pointer hover:bg-black/[0.01] transition-colors relative group"
        onClick={hasPhases ? onToggleExpand : () => onSelect({
          type: 'WO', wo_id: wo.wo_id,
          label: `${wo.wo_id} · ${wo.stakeholders?.name || ''}`,
          balance: woBalance,
        })}
      >
        <div className="w-5 shrink-0 flex items-center justify-center relative z-10">
          {hasPhases ? (
            <span className={`material-symbols-outlined text-[18px] text-on-surface-variant/40 transition-transform duration-200 ${expanded ? 'rotate-90 text-[#C8603A]' : ''}`}>
              chevron_right
            </span>
          ) : isSelected ? (
            <div className="w-4 h-4 rounded-full bg-[#C8603A] flex items-center justify-center shadow-[0_2px_6px_rgba(200,96,58,0.3)]">
              <span className="material-symbols-outlined text-white text-[10px]" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
            </div>
          ) : (
            <div className="w-4 h-4 rounded-full border border-black/15 bg-white group-hover:border-[#C8603A]/50 transition-colors" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-semibold text-on-surface truncate group-hover:text-primary transition-colors">{wo.stakeholders?.name || 'Unknown'}</p>
            <span className="font-data-mono text-[9px] px-1.5 py-0.5 rounded bg-black/[0.03] text-on-surface-variant/50 shrink-0 font-bold uppercase tracking-wider">{wo.wo_id}</span>
          </div>
          {wo.scope_of_work && (
            <p className="text-[11px] text-on-surface-variant/45 truncate mt-0.5">{(wo.scope_of_work as string)}</p>
          )}
        </div>
        <div className="text-right shrink-0 ml-3">
          <p className={`text-[13px] font-bold font-data-mono ${woBalance > 0 ? 'text-on-surface' : 'text-on-surface-variant/30'}`}>
            {woBalance > 0 ? `₹${woBalance.toLocaleString('en-IN')}` : 'Settled'}
          </p>
          {hasPhases && (
            <span className="inline-block text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-black/[0.06] text-on-surface-variant/40 mt-1 bg-black/[0.01]">
              {wo.wo_milestones.length} phases
            </span>
          )}
        </div>
      </div>

      {hasPhases && expanded && (
        <div className="relative border-t border-black/[0.03] bg-black/[0.005] pb-1.5">
          {/* Absolute branch connector line */}
          <div className="absolute left-[24px] top-0 bottom-6 w-px border-l border-dashed border-black/15 pointer-events-none" />

          {wo.wo_milestones.map((phase: any) => {
            const balance = getPhaseBalance(phase);
            const isPhaseSelected = selectedObligation?.phase_id === phase.milestone_id;
            const settled = phase.status === 'PAID' || phase.status === 'Paid';
            const paid = milestonePayments[phase.milestone_id] || 0;
            const due = balance - paid;
            return (
              <div key={phase.milestone_id}
                className={`pl-10 pr-5 py-3 flex items-center gap-3 transition-colors relative group
                  ${settled ? 'opacity-40 cursor-not-allowed bg-black/[0.01]' : isPhaseSelected ? 'bg-[#C8603A]/[0.04] cursor-pointer' : 'cursor-pointer hover:bg-black/[0.01]'}`}
                onClick={() => {
                  if (settled) return;
                  onSelect({ type: 'WO_PHASE', wo_id: wo.wo_id, phase_id: phase.milestone_id, label: `${phase.name} · ${wo.wo_id}`, balance });
                }}
              >
                {/* Horizontal branch point indicator */}
                <div className="absolute left-[24px] top-1/2 -translate-y-1/2 w-2 h-px bg-black/15 pointer-events-none" />

                <div className="w-5 shrink-0 flex items-center justify-center relative z-10">
                  {isPhaseSelected ? (
                    <div className="w-4 h-4 rounded-full bg-[#C8603A] flex items-center justify-center shadow-[0_2px_6px_rgba(200,96,58,0.3)]">
                      <span className="material-symbols-outlined text-white text-[10px]" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
                    </div>
                  ) : (
                    <div className="w-2.5 h-2.5 rounded-full border border-black/20 bg-white group-hover:border-[#C8603A]/50 transition-colors" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] font-medium text-on-surface group-hover:text-primary transition-colors">{phase.name}</p>
                  {phase.qty && phase.unit_type && (
                    <p className="text-[10px] text-on-surface-variant/40 mt-0.5 font-medium">
                      {phase.qty} {phase.unit_type}{phase.rate ? ` × ₹${Number(phase.rate).toLocaleString('en-IN')}` : ''}
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0 ml-3 flex flex-col items-end">
                  <p className="text-[12.5px] font-bold font-data-mono text-on-surface">₹{balance.toLocaleString('en-IN')}</p>
                  <div className="mt-1">
                    {settled ? (
                      <span className="px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-600/10">Settled</span>
                    ) : due < 0 ? (
                      <span className="px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-600/10">Overpaid</span>
                    ) : due === 0 ? (
                      <span className="px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-600/10">Paid</span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider bg-[#C8603A]/5 text-[#C8603A] border border-[#C8603A]/10">₹{due.toLocaleString('en-IN')} Due</span>
                    )}
                  </div>
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
  const isPaid = po.status === 'PAID';
  const isCancelled = po.status === 'CANCELLED';
  const hasBill = po.vendor_bill_amount && Number(po.vendor_bill_amount) > 0;
  
  // Use bill amount if present, otherwise estimated PO value
  const rawBalance = getPOBalance(po);
  
  const isSelected = selectedObligation?.po_id === po.po_id;
  const isLinkable = !isPaid && !isCancelled;

  return (
    <div
      className={`px-5 py-3.5 flex items-center gap-3 transition-colors duration-200 group
        ${!isLinkable ? 'opacity-40 cursor-not-allowed bg-black/[0.01]' : isSelected ? 'bg-[#006c49]/[0.02] cursor-pointer' : 'cursor-pointer hover:bg-black/[0.01]'}`}
      onClick={() => {
        if (!isLinkable) return;
        onSelect({ type: 'PO', po_id: po.po_id, label: `${po.po_id} · ${po.stakeholders?.name || ''}`, balance: rawBalance });
      }}
    >
      <div className="w-5 shrink-0 flex items-center justify-center relative z-10">
        {isSelected ? (
          <div className="w-4 h-4 rounded-full bg-[#006c49] flex items-center justify-center shadow-[0_2px_6px_rgba(0,108,73,0.3)]">
            <span className="material-symbols-outlined text-white text-[10px]" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
          </div>
        ) : (
          <div className="w-4 h-4 rounded-full border border-black/15 bg-white group-hover:border-[#006c49]/50 transition-colors" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-[13px] font-semibold text-on-surface group-hover:text-primary transition-colors">{po.stakeholders?.name || 'Unknown'}</p>
          <span className="font-data-mono text-[9px] px-1.5 py-0.5 rounded bg-black/[0.03] text-on-surface-variant/50 shrink-0 font-bold uppercase tracking-wider">{po.po_id}</span>
        </div>
        {po.po_line_items?.[0] && (
          <p className="text-[11px] text-on-surface-variant/45 truncate mt-0.5">
            {po.po_line_items[0].item_name || po.po_line_items[0].description || po.po_line_items[0].name || ''}
            {po.po_line_items.length > 1 && ` +${po.po_line_items.length - 1} more`}
          </p>
        )}
      </div>
      <div className="text-right shrink-0 ml-3 flex flex-col items-end">
        <p className="text-[13px] font-bold font-data-mono text-on-surface">
          ₹{rawBalance.toLocaleString('en-IN')}
        </p>
        <div className="mt-1">
          {isPaid ? (
            <span className="px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-600/10">Settled</span>
          ) : isCancelled ? (
            <span className="px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider bg-red-50 text-red-700 border border-red-600/10">Cancelled</span>
          ) : (
            <span className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider border ${
              hasBill 
                ? 'bg-[#006c49]/5 text-[#006c49] border-[#006c49]/10' 
                : 'bg-amber-50 text-amber-700 border-amber-600/10'
            }`}>
              {hasBill ? 'Due' : 'Est. Advance'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── LinkingPanel ──────────────────────────────────────────────────────────────

function LinkingPanel({ wos, pos, loading, selectedObligation, onSelect, onSkip, onOpenWO, onOpenPO, txnType }: {
  wos: any[]; pos: any[]; loading: boolean;
  selectedObligation: SelectedObligation | null;
  onSelect: (ob: SelectedObligation) => void;
  onSkip: () => void;
  onOpenWO: () => void;
  onOpenPO: () => void;
  txnType?: string | null;
}) {
  const [expandedWOs, setExpandedWOs] = useState<string[]>([]);
  const [milestonePayments, setMilestonePayments] = useState<Record<string, number>>({});
  const hasData = wos.length > 0 || pos.length > 0;

  useEffect(() => {
    if (wos.length === 0) { setMilestonePayments({}); return; }
    const woIds = wos.map((w: any) => w.wo_id);
    supabase.from('txn_allocations')
      .select('milestone_id, allocated_amount')
      .in('order_ref', woIds)
      .eq('order_type', 'WO')
      .not('milestone_id', 'is', null)
      .then(({ data }) => {
        const map: Record<string, number> = {};
        for (const row of (data || [])) {
          map[row.milestone_id] = (map[row.milestone_id] || 0) + Number(row.allocated_amount);
        }
        setMilestonePayments(map);
      });
  }, [wos]);

  if (loading) {
    return (
      <div className="mt-4 rounded-2xl border border-black/[0.05] p-5 space-y-4 bg-stone-50/20 shadow-sm animate-pulse">
        <div className="h-3 w-40 bg-black/[0.06] rounded-full" />
        <div className="h-12 bg-black/[0.04] rounded-xl" />
        <div className="h-12 bg-black/[0.04] rounded-xl" />
      </div>
    );
  }

  if (!hasData) return <NoObligationsState onSkip={onSkip} onOpenWO={onOpenWO} onOpenPO={onOpenPO} txnType={txnType} />;

  return (
    <div className="mt-4 rounded-2xl border border-black/[0.05] overflow-hidden bg-white shadow-[0_8px_30px_rgb(0,0,0,0.015)]">
      <div className="px-5 py-3.5 bg-black/[0.01] border-b border-black/[0.03]">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-on-surface-variant/40">
          Obligations Ledger
        </p>
        <p className="text-[12px] text-on-surface-variant/60 font-medium mt-0.5">Select a ledger item to link this payment</p>
      </div>

      <div className="divide-y divide-black/[0.04]">
        {wos.length > 0 && (
          <div>
            <div className="px-5 py-2 bg-black/[0.005] border-b border-black/[0.015] flex items-center justify-between">
              <p className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant/35">
                Work Orders ({wos.length})
              </p>
              <button type="button" onClick={onOpenWO}
                className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-[#C8603A]/70 hover:text-[#C8603A] transition-colors">
                <span className="material-symbols-outlined text-[12px]">add</span>
                New WO
              </button>
            </div>
            <div className="divide-y divide-black/[0.03]">
              {wos.map((wo: any) => (
                <WOObligationRow key={wo.wo_id} wo={wo} selectedObligation={selectedObligation}
                  expanded={expandedWOs.includes(wo.wo_id)}
                  onToggleExpand={() => setExpandedWOs(prev =>
                    prev.includes(wo.wo_id) ? prev.filter(id => id !== wo.wo_id) : [...prev, wo.wo_id]
                  )}
                  onSelect={onSelect} milestonePayments={milestonePayments} />
              ))}
            </div>
          </div>
        )}
        {pos.length > 0 && (
          <div>
            <div className="px-5 py-2 bg-black/[0.005] border-b border-black/[0.015] flex items-center justify-between">
              <p className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant/35">
                Purchase Orders ({pos.length})
              </p>
              <button type="button" onClick={onOpenPO}
                className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-[#006c49]/70 hover:text-[#006c49] transition-colors">
                <span className="material-symbols-outlined text-[12px]">add</span>
                New PO
              </button>
            </div>
            <div className="divide-y divide-black/[0.03]">
              {pos.map((po: any) => (
                <POObligationRow key={po.po_id} po={po} selectedObligation={selectedObligation} onSelect={onSelect} />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-black/[0.04] bg-black/[0.005]">
        <button type="button" onClick={onSkip}
          className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant/40 hover:text-primary transition-colors flex items-center gap-1.5">
          <span>Skip & Record Unlinked</span>
          <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
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

  const initialProjectId      = (location.state as any)?.projectId      || '';
  const initialStakeholderId  = (location.state as any)?.stakeholderId  || '';
  const initialTxnType        = (location.state as any)?.txnType        || null;
  const initialStkName        = (location.state as any)?.stakeholderName || '';

  // ── Type ──────────────────────────────────────────────────────────────────
  const [txnType, setTxnType] = useState<TxnType | null>(initialTxnType as TxnType | null);

  // ── Core form ────────────────────────────────────────────────────────────
  const [txnId, setTxnId] = useState(genTxnId);
  const [txnIdCopied, setTxnIdCopied] = useState(false);
  const [stkId, setStkId]     = useState(initialStakeholderId);
  const [stkSearch, setStkSearch] = useState(initialStkName);
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

  // ── Inline WO/PO drawer state ────────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState<'WO' | 'PO' | null>(null);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  // WO form state
  const [woScope, setWoScope] = useState('');
  const [woValue, setWoValue] = useState(0);
  const [woDate, setWoDate] = useState(new Date().toISOString().split('T')[0]);
  // PO form state
  const [poDesc, setPoDesc] = useState('');
  const [poValue, setPoValue] = useState(0);
  const [poDate, setPoDate] = useState(new Date().toISOString().split('T')[0]);
  const [poGstRate, setPoGstRate] = useState(18);

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
  const orgId = useOrgId();
  const payeeRef = useRef<HTMLInputElement>(null);
  const stkDropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus payee field when a type is selected (or pre-selected on mount)
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

  useEffect(() => {
    if (stakeholders && stakeholders.length > 0 && recentPayees.length === 0) {
      const initialRecents = stakeholders.slice(0, 10).map((s) => ({
        id: s.stakeholder_id,
        name: s.name,
        type: s.type,
      }));
      setRecentPayees(initialRecents);
    }
  }, [stakeholders, recentPayees.length]);
  // Fetch WOs for workers, POs for vendors — scoped to the selected project + stakeholder
  const selectedProjectId = !splitMode ? (allocs[0]?.project_id || '') : '';
  useEffect(() => {
    if (!selectedProjectId || !stkId || txnType === 'expense' || txnType === 'client_receipt') {
      setProjectWOs([]); setProjectPOs([]); setSelectedObligation(null); setSkipped(false);
      return;
    }
    let cancelled = false;
    setLoadingObligations(true);
    // Only clear selection if this isn't a post-creation refetch
    if (!createdOrderId) { setSelectedObligation(null); setSkipped(false); }

    if (txnType === 'worker') {
      // Worker payment → show only their WOs for this project
      supabase
        .from('work_orders')
        .select('wo_id, scope_of_work, order_value, status, stakeholders(name, category), wo_milestones(*)')
        .eq('project_id', selectedProjectId)
        .eq('stakeholder_id', stkId)
        .not('status', 'in', '("Closed","Cancelled")')
        .order('created_at', { ascending: false })
        .then(({ data: wos, error: woErr }) => {
          if (woErr) console.error('[LinkingPanel] WO fetch error:', woErr);
          if (!cancelled) {
            setProjectWOs(wos || []);
            setProjectPOs([]);
            setLoadingObligations(false);
            // Auto-select newly created WO
            if (createdOrderId && wos) {
              const match = wos.find((w: any) => w.wo_id === createdOrderId);
              if (match) {
                const bal = getWOBalance(match);
                setSelectedObligation({ type: 'WO', wo_id: match.wo_id, label: `${match.wo_id} · ${(match.stakeholders as any)?.name || ''}`, balance: bal });
                if (!amountTouched) setTotalAmt(bal);
                setCreatedOrderId(null);
              }
            }
          }
        });
    } else {
      // Material payment → show only their POs for this project
      supabase
        .from('purchase_orders')
        .select('po_id, status, vendor_bill_amount, total_value, order_value, stakeholders(name, category), po_line_items(*)')
        .eq('project_id', selectedProjectId)
        .eq('stakeholder_id', stkId)
        .order('created_at', { ascending: false })
        .then(({ data: pos, error: poErr }) => {
          if (poErr) console.error('[LinkingPanel] PO fetch error:', poErr);
          if (!cancelled) {
            setProjectWOs([]);
            setProjectPOs(pos || []);
            setLoadingObligations(false);
            // Auto-select newly created PO
            if (createdOrderId && pos) {
              const match = pos.find((p: any) => p.po_id === createdOrderId);
              if (match) {
                const bal = getPOBalance(match);
                setSelectedObligation({ type: 'PO', po_id: match.po_id, label: `${match.po_id} · ${(match.stakeholders as any)?.name || ''}`, balance: bal });
                if (!amountTouched) setTotalAmt(bal);
                setCreatedOrderId(null);
              }
            }
          }
        });
    }
    return () => { cancelled = true; };
  }, [selectedProjectId, stkId, txnType, refetchTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

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
        org_id: orgId,
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
      let effectiveCategory = isClientReceipt ? 'CLIENT-RECEIPT' : category;
      let effectiveRemarks = '';

      if (isClientReceipt) {
        effectiveRemarks = receiptDescription.trim() || (receiptRef.trim() ? `Ref: ${receiptRef.trim()}` : '');
      } else {
        let prefix = '';
        if (selectedObligation) {
          if (selectedObligation.type === 'WO_PHASE') {
            const wo = projectWOs.find((w: any) => w.wo_id === selectedObligation.wo_id);
            const phase = wo?.wo_milestones?.find((m: any) => m.milestone_id === selectedObligation.phase_id);
            const phaseName = phase?.name || selectedObligation.phase_id;
            prefix = `[${selectedObligation.wo_id} - ${phaseName}]`;
          } else if (selectedObligation.type === 'WO') {
            prefix = `[${selectedObligation.wo_id}]`;
          } else if (selectedObligation.type === 'PO') {
            prefix = `[${selectedObligation.po_id}]`;
          }
        }

        const baseRemarks = (remarks || '').trim();
        if (baseRemarks) {
          effectiveRemarks = prefix ? `${prefix} - ${baseRemarks}` : baseRemarks;
        } else {
          effectiveRemarks = prefix ? prefix : '';
        }
      }

      if (selectedObligation?.type === 'PO') {
        const selPO = projectPOs.find((p: any) => p.po_id === selectedObligation.po_id);
        if (selPO && !Number(selPO.vendor_bill_amount)) {
          effectiveCategory = 'PO Advance';
          if (!effectiveRemarks.includes('[PO Advance]')) {
            effectiveRemarks = `[PO Advance] ${effectiveRemarks}`.trim();
          }
        }
      }
      const payload = {
        txn_id: txnId, stakeholder_id: stkId, date, total_amount: totalAmt,
        payment_mode: mode,
        category: effectiveCategory,
        remarks: effectiveRemarks, bill_doc_url,
        ai_flag_status: 'Clean',
        ai_flag_data: {},
        org_id: orgId,
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
      const autoCloseWoId = (selectedObligation?.type === 'WO' || selectedObligation?.type === 'WO_PHASE')
        ? (selectedObligation.wo_id ?? null) : null;
      return { savedId: txnId, saveMode, autoCloseWoId };
    },
    onSuccess: ({ savedId, saveMode, autoCloseWoId }) => {
      qc.invalidateQueries({ queryKey: ['ledger'] });
      qc.invalidateQueries({ queryKey: ['po_payment_totals'] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      if (autoCloseWoId) autoCloseWOIfFullyPaid(autoCloseWoId, qc);
      const stk = stakeholders?.find((s) => s.stakeholder_id === stkId);
      if (stk) setRecentPayees((prev) => [{ id: stk.stakeholder_id, name: stk.name, type: stk.type }, ...prev.filter((p) => p.id !== stk.stakeholder_id)].slice(0, 5));
      if (saveMode === 'exit') {
        navigate(initialProjectId ? `/projects/${initialProjectId}/transactions` : '/ledger');
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

  // ── Drawer helpers ────────────────────────────────────────────────────────
  const openDrawer = (type: 'WO' | 'PO') => {
    setDrawerOpen(type);
    setCelebrating(false);
    setCreatedOrderId(null);
    // Pre-populate values from parent transaction
    if (type === 'WO') {
      setWoScope('');
      setWoValue(totalAmt || 0);
      setWoDate(date);
    } else {
      setPoDesc('');
      setPoValue(totalAmt || 0);
      setPoDate(date);
      setPoGstRate(18);
    }
  };

  const closeDrawer = () => {
    setDrawerOpen(null);
    setCelebrating(false);
  };

  const handleCreateWO = async () => {
    if (!woScope.trim() || !woValue || woValue <= 0) {
      showSnackbar('Please fill in scope and order value', { type: 'error' }); return;
    }
    const pid = selectedProjectId;
    const sid = stkId;
    if (!pid || !sid) {
      showSnackbar('Select a project and worker first', { type: 'error' }); return;
    }
    setCreatingOrder(true);
    try {
      const { data, error } = await supabase.rpc('create_work_order', {
        p_org_id:         orgId,
        p_project_id:     pid,
        p_stakeholder_id: sid,
        p_scope:          woScope.trim(),
        p_order_value:    woValue,
        p_date_issued:    woDate,
        p_source:         'manual',
        p_milestones:     [{ seq_no: 1, name: 'Full Payment', unit_type: 'LS', quantity: 1, rate: null, planned_amount: woValue, ai_extracted: false }],
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error ?? 'Failed to create work order');
      const newId = data.wo_id as string;
      setCelebrating(true);
      setCreatedOrderId(newId);
      setTimeout(() => {
        setDrawerOpen(null);
        setCelebrating(false);
        setRefetchTrigger(t => t + 1);
      }, 1900);
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to create work order', { type: 'error' });
    } finally {
      setCreatingOrder(false);
    }
  };

  const handleCreatePO = async () => {
    if (!poDesc.trim() || !poValue || poValue <= 0) {
      showSnackbar('Please fill in description and order value', { type: 'error' }); return;
    }
    const pid = selectedProjectId;
    const sid = stkId;
    if (!pid || !sid) {
      showSnackbar('Select a project and vendor first', { type: 'error' }); return;
    }
    setCreatingOrder(true);
    try {
      const taxable = poValue / (1 + poGstRate / 100);
      const totalGST = poValue - taxable;
      const cgst = totalGST / 2;
      const sgst = totalGST / 2;
      const poData = {
        org_id:             orgId,
        project_id:         pid,
        stakeholder_id:     sid,
        items:              [{ description: poDesc.trim(), qty: 1, unit: 'LS', rate: taxable, amount: taxable }],
        order_value:        taxable,
        total_value:        poValue,
        gst_value:          totalGST,
        status:             'ORDERED',
        date_issued:        poDate,
        expected_delivery:  null,
        delivery_location:  null,
        payment_terms_days: 30,
        ordered_by:         null,
        vendor_notes:       null,
        internal_notes:     null,
      };
      const lineItemRows = [{
        line_number:      1,
        category_id:      null,
        item_name:        poDesc.trim(),
        specification:    null,
        unit:             'LS',
        quantity_ordered: 1,
        unit_rate:        taxable,
        basic_amount:     taxable,
        discount_percent: 0,
        discount_amount:  0,
        gst_rate:         poGstRate,
        cgst:             cgst,
        sgst:             sgst,
        igst:             0,
        total_amount:     poValue,
      }];
      const { data, error: rpcError } = await supabase.rpc('create_purchase_order', { p_po_data: poData, p_line_items: lineItemRows });
      if (rpcError) throw rpcError;
      if (!data?.success) throw new Error(data?.error ?? 'Failed to create purchase order');
      const newId = data.po_id as string;
      setCelebrating(true);
      setCreatedOrderId(newId);
      setTimeout(() => {
        setDrawerOpen(null);
        setCelebrating(false);
        setRefetchTrigger(t => t + 1);
      }, 1900);
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to create purchase order', { type: 'error' });
    } finally {
      setCreatingOrder(false);
    }
  };

  const suggestCostCode = async (text: string) => {
    if (!text || text.trim().length < 5) { setAiCodeState('idle'); return; }
    setAiCodeState('loading');
    setAiSuggestedCode(null);
    try {
      const { data, error } = await supabase.functions.invoke('sku-matcher', {
        body: {
          action:     'suggestCostCode',
          remark:     text.trim(),
          cost_codes: ALL_COST_CODES.map(c => ({ code: c.code, name: c.name })),
        },
      });
      if (error) throw error;
      const result = String((data as any)?.code || 'NONE').toUpperCase();
      if (result === 'NONE' || !getCostCode(result)) {
        setAiSuggestedCode(null);
        setAiCodeState('none');
      } else {
        setCategory(result);
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

    // Bug 6: WO linked at header level but has phases — user must select a specific phase
    if (selectedObligation?.type === 'WO') {
      const wo = projectWOs.find((w: any) => w.wo_id === selectedObligation.wo_id);
      if ((wo?.wo_milestones?.length || 0) > 0) return;
    }

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
  const needsPhaseSelection = !!(
    selectedObligation?.type === 'WO' &&
    (projectWOs.find((w: any) => w.wo_id === selectedObligation.wo_id)?.wo_milestones?.length || 0) > 0
  );

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
    <div className="min-h-screen" style={{ background: VOICE.page }}>
      <div className="mx-auto px-4 pt-8 pb-36" style={{ maxWidth: 720 }}>

        {/* ── Header — voice restyle (back + copy handlers unchanged) ──────── */}
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => navigate(initialProjectId ? `/projects/${initialProjectId}/transactions` : '/ledger')}
            className="p-2 -ml-2 rounded-xl transition-colors shrink-0"
            style={{ color: VOICE.user }}
            aria-label="Back"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1 className="text-xl font-medium flex-1 tracking-tight" style={{ color: VOICE.user }}>New transaction</h1>
          <span className="text-xs px-2.5 py-1 rounded-full inline-flex items-center gap-1.5" style={{ background: VOICE.field, color: VOICE.system, ...VNUMS }}>
            {txnId}
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(txnId);
                setTxnIdCopied(true);
                setTimeout(() => setTxnIdCopied(false), 2000);
              }}
              className="flex items-center shrink-0"
              style={{ color: VOICE.systemFaint }}
              title="Copy Transaction ID"
              aria-label="Copy transaction number"
            >
              <span className="material-symbols-outlined text-[13px]">
                {txnIdCopied ? 'check' : 'content_copy'}
              </span>
            </button>
            {txnIdCopied && (
              <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: VOICE.confirm }}>Copied</span>
            )}
          </span>
        </div>

        {/* ── Type selector — direction-encoded cards (visual redesign) ──── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-10">
          {([
            { key: 'worker'         as TxnType, icon: 'engineering',   label: 'Worker payment',    dir: 'out' as const },
            { key: 'material'       as TxnType, icon: 'shopping_cart', label: 'Material purchase', dir: 'out' as const },
            { key: 'expense'        as TxnType, icon: 'receipt_long',  label: 'General expense',   dir: 'out' as const },
            { key: 'client_receipt' as TxnType, icon: 'payments',      label: 'Client receipt',    dir: 'in'  as const },
          ]).map((t) => {
            const isSelected = txnType === t.key;
            const c = t.dir === 'in' ? VOICE.inn : VOICE.out;
            const wash = t.dir === 'in' ? VOICE.innWash : VOICE.outWash;
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={isSelected}
                onClick={() => {
                  if (txnType !== t.key) {
                    setTxnType(t.key); setStkId(''); setStkSearch('');
                    setCategory(''); setSaveAttempted(false);
                    setNewStkTrade(''); setNewStkTradeOther('');
                    setDismissedReceiptSuggestion(false);
                    setDismissedMilestoneSuggestion(false);
                  }
                }}
                className="rounded-xl px-3 py-3 text-left transition-transform active:scale-[0.98]"
                style={isSelected
                  ? { background: wash, border: `1.5px solid ${c}` }
                  : { background: VOICE.surface, border: `1px solid ${VOICE.line}` }}
              >
                <span
                  className="material-symbols-outlined text-[18px]"
                  style={{ color: isSelected ? c : VOICE.systemFaint, fontVariationSettings: isSelected ? "'FILL' 1" : "'FILL' 0" }}
                >
                  {t.icon}
                </span>
                <p className="text-sm font-medium mt-1.5" style={{ color: isSelected ? c : VOICE.user }}>{t.label}</p>
                <p className="text-xs mt-0.5 inline-flex items-center gap-1" style={{ color: isSelected ? c : VOICE.systemFaint }}>
                  <span className="material-symbols-outlined text-[12px]">{t.dir === 'in' ? 'south_west' : 'north_east'}</span>
                  money {t.dir === 'in' ? 'in' : 'out'}
                </p>
              </button>
            );
          })}
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

            {/* Hero Amount Input */}
            <div className="text-center py-6 mb-2 relative">
              <div className="inline-block relative">
                <div className="flex items-baseline justify-center gap-1.5">
                  <span className="text-3xl md:text-4xl font-light select-none" style={{ color: txnType === 'client_receipt' ? VOICE.inn : VOICE.out }}>{txnType === 'client_receipt' ? '+' : '−'}</span>
                  <span className="text-4xl md:text-5xl font-light select-none font-sans" style={{ color: VOICE.systemFaint }}>₹</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={totalAmt || ''}
                    onChange={(e) => { setAmountTouched(true); setTotalAmt(parseFloat(e.target.value) || 0); }}
                    onFocus={(e) => e.target.select()}
                    placeholder="0"
                    className={`w-auto min-w-[120px] max-w-full text-5xl md:text-6xl font-bold font-data-mono text-center bg-transparent border-none outline-none focus:ring-0 placeholder:text-on-surface-variant/15 transition-all text-on-surface ${
                      missingAmount ? 'text-error' : ''
                    }`}
                    style={{
                      width: totalAmt ? `${Math.max(3, String(totalAmt).length) * 0.62}em` : '2.5em',
                    }}
                  />
                </div>
                {/* Subtle custom bottom glow / elegant hairline divider */}
                <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-black/[0.06] to-transparent mt-2 rounded-full" />
                <p className="text-xs mt-2" style={{ color: VOICE.systemFaint }}>{txnType === 'client_receipt' ? 'money coming in' : 'money going out'}</p>
                {missingAmount && (
                  <span className="block mt-2 text-[10px] font-bold text-error uppercase tracking-wider animate-fadeIn">
                    Amount is required
                  </span>
                )}
              </div>
            </div>

            {/* ━━ 01 · Payment / Receipt Details ━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <div>
              <SectionLabel n="01" title={txnType === 'client_receipt' ? 'Receipt Details' : 'Payment Details'} />
              <div className="bg-white rounded-2xl border border-black/[0.05] shadow-[0_8px_30px_rgb(0,0,0,0.02)]">
                <div className="p-6 space-y-6">

                  {/* Payee / Client */}
                  <div className="relative" ref={stkDropRef}>
                    <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2.5">
                      {txnType === 'worker' ? 'Worker' : txnType === 'material' ? 'Vendor' : txnType === 'client_receipt' ? 'Client' : 'Payee'}
                      {missingPayee && <span className="text-error ml-1.5">required</span>}
                    </label>

                    {/* Quick-Payee Avatars */}
                    {filteredRecents.length > 0 && !stkId && (
                      <div className="mb-4">
                        <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1.5 pt-0.5">
                          {filteredRecents.map((p) => {
                            const initials = p.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                            const hue = p.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360;
                            const gradientStyle = {
                              background: `linear-gradient(135deg, hsl(${hue}, 85%, 90%), hsl(${(hue + 60) % 360}, 80%, 80%))`,
                              color: `hsl(${hue}, 70%, 25%)`
                            };
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => { setStkId(p.id); setStkSearch(p.name); setShowSug(false); }}
                                className="flex flex-col items-center shrink-0 w-16 group transition-all duration-200 active:scale-95"
                              >
                                <div
                                  className="w-11 h-11 rounded-full flex items-center justify-center text-[13px] font-bold shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-white group-hover:scale-105 group-hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] transition-all duration-200"
                                  style={gradientStyle}
                                >
                                  {initials}
                                </div>
                                <span className="text-[9.5px] font-semibold text-on-surface-variant/75 mt-1.5 truncate w-full text-center group-hover:text-on-surface leading-tight">
                                  {p.name.split(' ')[0]}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant/35 pointer-events-none">search</span>
                      <input
                        ref={payeeRef}
                        type="text"
                        value={stkId ? selName : stkSearch}
                        onChange={(e) => { setStkSearch(e.target.value); if (stkId) setStkId(''); setShowSug(true); setShowCreate(false); }}
                        onFocus={() => setShowSug(true)}
                        placeholder={`Search ${tgtType ? tgtType.toLowerCase() : 'payee'}…`}
                        className={`bk-input pl-10 pr-10 focus:ring-4 focus:ring-primary/5 transition-all duration-200 ${missingPayee ? 'border-error' : 'border-outline-variant/30'}`}
                        autoComplete="new-password"
                      />
                      {stkId && (
                        <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                      )}
                    </div>

                    {/* Dropdown */}
                    {showSug && !stkId && (
                      <div className="absolute left-0 right-0 top-full bg-white border border-black/[0.08] rounded-xl mt-1 z-30 shadow-lg max-h-60 overflow-y-auto animate-peek-in">
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
                      <div className="mt-3 border border-black/[0.05] rounded-2xl p-5 bg-surface-container-lowest shadow-[0_4px_20px_rgba(0,0,0,0.01)] animate-peek-in">
                        <p className="text-[12px] font-semibold text-on-surface mb-4">Quick-add {tgtType || 'stakeholder'}</p>
                        <div className="grid grid-cols-2 gap-3 mb-4">
                          <div>
                            <label className="text-[10px] font-semibold text-on-surface-variant/60 block mb-1.5 uppercase tracking-wide">First name</label>
                            <input id="stk_fn" className="bk-input focus:ring-4 focus:ring-primary/5 transition-all duration-200" placeholder="First" defaultValue={stkSearch.split(' ')[0] || ''} autoFocus />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-on-surface-variant/60 block mb-1.5 uppercase tracking-wide">Last name</label>
                            <input id="stk_ln" className="bk-input focus:ring-4 focus:ring-primary/5 transition-all duration-200" placeholder="Last" defaultValue={stkSearch.split(' ').slice(1).join(' ') || ''} />
                          </div>
                        </div>
                        <div className="mb-4">
                          <label className="text-[10px] font-semibold text-on-surface-variant/60 block mb-1.5 uppercase tracking-wide">
                            Trade <span className="text-red-500">*</span>
                          </label>
                          <select className="bk-input focus:ring-4 focus:ring-primary/5 transition-all duration-200" value={newStkTrade} onChange={(e) => { setNewStkTrade(e.target.value); setNewStkTradeOther(''); }}>
                            <option value="" disabled>Select trade…</option>
                            {(txnType === 'worker' ? WORKER_TRADE_GROUPS : VENDOR_TRADE_GROUPS).map((g) => (
                              <optgroup key={g.group} label={g.group}>
                                {g.trades.map((t) => <option key={t} value={t}>{t}</option>)}
                              </optgroup>
                            ))}
                          </select>
                          {newStkTrade === OTHER_TRADE && (
                            <input className="bk-input mt-2 focus:ring-4 focus:ring-primary/5 transition-all duration-200" placeholder="Specify trade…" value={newStkTradeOther} onChange={(e) => setNewStkTradeOther(e.target.value)} autoFocus />
                          )}
                        </div>
                        <div className="mb-5">
                          <label className="text-[10px] font-semibold text-on-surface-variant/60 block mb-1.5 uppercase tracking-wide">Contact (optional)</label>
                          <input id="stk_contact" className="bk-input focus:ring-4 focus:ring-primary/5 transition-all duration-200" placeholder="Phone" />
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button type="button" className="bk-btn-ghost px-4 py-2 rounded-xl text-[13px] border border-outline-variant/30" onClick={() => { setShowCreate(false); setNewStkTrade(''); setNewStkTradeOther(''); }}>Cancel</button>
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
                          className="bk-input focus:ring-4 focus:ring-primary/5 transition-all duration-200"
                          placeholder="UTR / cheque / reference number"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Description <span className="text-on-surface-variant/35">(optional)</span></label>
                        <input
                          type="text"
                          value={receiptDescription}
                          onChange={e => setReceiptDescription(e.target.value)}
                          className="bk-input focus:ring-4 focus:ring-primary/5 transition-all duration-200"
                          placeholder="What this payment is for…"
                        />
                      </div>
                    </>
                  )}

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
              <div className="bg-white rounded-2xl border border-black/[0.05] shadow-[0_8px_30px_rgb(0,0,0,0.02)]">
                <div className="p-5 space-y-4">

                  {/* Cost code picker — optional, AI-assisted */}
                  <div>
                    <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">
                      Cost Code <span className="text-on-surface-variant/35">(optional)</span>
                    </label>
                    <CostCodePicker
                      value={category}
                      onChange={(v) => { setCategory(v); setAiCodeState('idle'); setAiSuggestedCode(null); }}
                      defaultType={txnType ? COA_DEFAULTS[txnType]?.type : 'MAT'}
                      defaultDivision={txnType ? COA_DEFAULTS[txnType]?.division : undefined}
                      error={false}
                    />

                    {/* AI suggestion chip (auto-applied with Undo) */}
                    {aiCodeState !== 'idle' && (
                      <div className="animate-fadeIn">
                        {aiCodeState === 'loading' && (
                          <div className="mt-2 text-[11px] text-on-surface-variant/40 pl-1 flex items-center gap-2">
                            <Loader2 className="animate-spin shrink-0" size={12} />
                            Analyzing remarks with AI…
                          </div>
                        )}
                        {aiCodeState === 'suggested' && aiSuggestedCode && category === aiSuggestedCode && (
                          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-indigo-600 font-semibold pl-1 animate-fadeIn">
                            <span className="material-symbols-outlined text-[13px] animate-pulse" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
                            <span>AI auto-selected cost code: <strong className="font-bold">{costCodeLabel(aiSuggestedCode)}</strong></span>
                            <button type="button"
                              onClick={() => { setCategory(''); setAiCodeState('idle'); setAiSuggestedCode(null); }}
                              className="ml-2 underline hover:text-indigo-800 transition-colors font-bold shrink-0">
                              Undo
                            </button>
                          </div>
                        )}
                        {aiCodeState === 'none' && (
                          <div className="mt-2 text-[11px] text-on-surface-variant/35 pl-1 flex items-center gap-1.5 animate-fadeIn">
                            <span className="material-symbols-outlined text-[13px]">help_outline</span>
                            No matching cost code found for this remark.
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
                      className={`bk-input w-full min-h-[72px] resize-none focus:ring-4 focus:ring-primary/5 transition-all duration-200 ${missingRemarks ? 'border-error' : 'border-outline-variant/30'}`}
                      placeholder="e.g. Payment for tile fixing in bathroom, 2nd floor…"
                      rows={2}
                    />
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

              {/* Premium Slim Visual progress bar for split mode */}
              {splitMode && totalAmt > 0 && txnType !== 'client_receipt' && (
                <div className="mb-4 bg-white border border-black/[0.05] rounded-2xl p-4 shadow-[0_8px_30px_rgb(0,0,0,0.015)] space-y-2.5">
                  <div className="h-2 w-full bg-black/[0.04] rounded-full overflow-hidden flex shadow-inner">
                    {effectiveAllocs.map((a, i) => {
                      const amt = Number(a.allocated_amount) || 0;
                      const pct = totalAmt > 0 ? (amt / totalAmt) * 100 : 0;
                      const colors = [
                        'bg-[#C45B39]', // Terracotta / Worker
                        'bg-[#006C49]', // Sage / Vendor
                        'bg-[#6366F1]', // Indigo / General
                        'bg-[#0EA5E9]', // Aqua / Client
                        'bg-[#F59E0B]', // Amber
                      ];
                      const color = colors[i % colors.length];
                      return pct > 0 ? (
                        <div
                          key={a.id}
                          className={`h-full transition-all duration-300 ${color}`}
                          style={{ width: `${pct}%` }}
                          title={`Split ${i + 1}: ₹${amt.toLocaleString()}`}
                        />
                      ) : null;
                    })}
                    {remaining > 0 && (
                      <div
                        className="h-full bg-black/[0.06] transition-all duration-300"
                        style={{ width: `${(remaining / totalAmt) * 100}%` }}
                        title={`Unallocated: ₹${remaining.toLocaleString()}`}
                      />
                    )}
                  </div>
                  
                  <div className="flex items-center justify-between text-[11px] font-semibold">
                    <span className="text-on-surface-variant/40">Total: ₹{totalAmt.toLocaleString('en-IN')}</span>
                    <span className="font-bold">
                      {isOver ? (
                        <span className="text-error uppercase tracking-wider text-[9.5px]">Over-allocated by ₹{Math.abs(remaining).toLocaleString('en-IN')}</span>
                      ) : isFullyAllocated ? (
                        <span className="text-[#006C49] uppercase tracking-wider text-[9.5px] flex items-center gap-1">
                          <span className="material-symbols-outlined text-[13px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                          Balanced
                        </span>
                      ) : (
                        <span className="text-primary uppercase tracking-wider text-[9.5px]">₹{remaining.toLocaleString('en-IN')} left to allocate</span>
                      )}
                    </span>
                  </div>
                </div>
              )}

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
                        <>
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
                            onOpenWO={() => openDrawer('WO')}
                            onOpenPO={() => openDrawer('PO')}
                            txnType={txnType}
                          />
                          {needsPhaseSelection && (
                            <div className="mt-3 p-4 rounded-xl border border-amber-200/50 bg-amber-50/50 text-amber-800 animate-fadeIn">
                              <div className="flex items-start gap-2.5">
                                <span className="material-symbols-outlined text-[18px] text-amber-600 mt-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
                                <div className="flex-1 text-[12px] leading-relaxed">
                                  <p className="font-semibold text-amber-900">Select a phase or milestone to continue.</p>
                                  <p className="mt-0.5 text-amber-800/80">This Work Order has phases. Expand it above and select the specific phase to link this payment to.</p>
                                </div>
                              </div>
                            </div>
                          )}
                          {(() => {
                            if (selectedObligation?.type === 'PO') {
                              const selPO = projectPOs.find((p: any) => p.po_id === selectedObligation.po_id);
                              if (selPO && !Number(selPO.vendor_bill_amount)) {
                                return (
                                  <div className="mt-3 p-4 rounded-xl border border-amber-200/50 bg-amber-50/50 text-amber-800 animate-fadeIn">
                                    <div className="flex items-start gap-2.5">
                                      <span className="material-symbols-outlined text-[18px] text-amber-600 mt-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
                                      <div className="flex-1 text-[12px] leading-relaxed">
                                        <p className="font-semibold text-amber-900">No bill copy or amount has been recorded for this Purchase Order yet.</p>
                                        <p className="mt-0.5 text-amber-800/80">This payment will be registered as a <strong>PO Advance</strong> in the ledger and PO details.</p>
                                      </div>
                                    </div>
                                  </div>
                                );
                              }
                            }
                            return null;
                          })()}
                        </>
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
              
              {billFile ? (
                <div className="flex items-center gap-3.5 p-4 rounded-2xl border border-black/[0.05] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.015)] animate-fadeIn">
                  {/* File Type icon/badge */}
                  <div className="w-12 h-12 rounded-xl bg-black/[0.02] border border-black/[0.04] flex flex-col items-center justify-center shrink-0">
                    <span className="text-[9px] font-extrabold uppercase tracking-widest text-on-surface-variant/40 leading-none">
                      {billFile.name.split('.').pop()?.slice(0, 3)}
                    </span>
                    <span className="material-symbols-outlined text-[18px] text-on-surface-variant/30 mt-1">description</span>
                  </div>
                  
                  {/* Metadata */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-on-surface truncate" title={billFile.name}>
                      {billFile.name}
                    </p>
                    <p className="text-[10px] text-on-surface-variant/40 font-bold font-data-mono mt-0.5">
                      {(billFile.size / 1024).toFixed(0)} KB
                    </p>
                  </div>

                  {/* Remove action button */}
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setBillFile(null); }}
                    className="w-8 h-8 rounded-xl hover:bg-red-50 text-on-surface-variant/40 hover:text-red-600 transition-colors flex items-center justify-center shrink-0 active:scale-95"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
              ) : (
                <label htmlFor="proof-upload"
                  className="flex flex-col items-center justify-center border-2 border-dashed border-black/[0.06] hover:border-[#006c49]/30 rounded-2xl p-8 bg-white/40 backdrop-blur-md cursor-pointer transition-all duration-300 group text-center shadow-[0_8px_30px_rgb(0,0,0,0.01)] hover:bg-white/[0.6]"
                >
                  <div className="w-12 h-12 rounded-full bg-black/[0.02] group-hover:bg-[#006c49]/[0.04] flex items-center justify-center transition-colors mb-3">
                    <span className="material-symbols-outlined text-[22px] text-on-surface-variant/35 group-hover:text-[#006c49] transition-transform duration-300 group-hover:-translate-y-1">
                      cloud_upload
                    </span>
                  </div>
                  <p className="text-[13px] font-semibold text-on-surface group-hover:text-[#006c49] transition-colors">
                    Upload proof document
                  </p>
                  <p className="text-[11px] text-on-surface-variant/40 mt-1">
                    PDF, JPG or PNG up to 10MB · optional
                  </p>
                </label>
              )}
            </div>

            {/* Unlinked warning */}
            {saveAttempted && !selectedObligation && !skipped &&
              (txnType === 'worker' || txnType === 'material') &&
              allocs[0]?.project_id && (
              <div className="flex items-start gap-3 p-4 bg-amber-50/40 border border-amber-200/30 rounded-2xl animate-fadeIn">
                <span className="material-symbols-outlined text-amber-600 text-[18px] shrink-0 mt-0.5">warning</span>
                <div className="flex-1 text-[12px] leading-relaxed">
                  <p className="font-bold text-amber-900">Unlinked payment recorded</p>
                  <p className="text-amber-800/80 mt-0.5">This payment won't be linked to a specific Work Order or Purchase Order balance. That's fine for general expenses.</p>
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

      {/* ── Inline WO / PO Slide-Over Drawer ─────────────────────────────────── */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes drawerFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes scaleUpCheck {
          0%   { transform: scale(0) rotate(-15deg); opacity: 0; }
          60%  { transform: scale(1.15) rotate(3deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg);  opacity: 1; }
        }
        @keyframes confettiRing {
          0%   { transform: scale(0.3); opacity: 0.9; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        @keyframes confettiRingOuter {
          0%   { transform: scale(0.2); opacity: 0.6; }
          100% { transform: scale(2.8); opacity: 0; }
        }
        @keyframes fadeUpIn {
          from { transform: translateY(8px); opacity: 0; }
          to   { transform: translateY(0);   opacity: 1; }
        }
        .drawer-slide { animation: slideInRight 0.38s cubic-bezier(0.32,0,0.08,1) both; }
        .drawer-backdrop { animation: drawerFadeIn 0.25s ease both; }
        .celebrate-check { animation: scaleUpCheck 0.55s cubic-bezier(0.34,1.56,0.64,1) 0.1s both; }
        .celebrate-ring  { animation: confettiRing 0.9s cubic-bezier(0.22,1,0.36,1) 0.05s both; }
        .celebrate-ring-outer { animation: confettiRingOuter 1.1s cubic-bezier(0.22,1,0.36,1) 0.15s both; }
        .celebrate-text  { animation: fadeUpIn 0.4s ease 0.5s both; }
      `}</style>

      {drawerOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-[2px] drawer-backdrop"
            onClick={creatingOrder ? undefined : closeDrawer}
          />

          {/* Drawer panel */}
          <div className="fixed right-0 top-0 bottom-0 z-[61] w-full max-w-md bg-white shadow-[−24px_0_80px_rgba(0,0,0,0.12)] drawer-slide flex flex-col overflow-hidden">

            {/* Drawer header */}
            <div className={`px-6 pt-6 pb-4 border-b border-black/[0.05] flex items-center gap-3 shrink-0 ${
              drawerOpen === 'WO' ? 'bg-gradient-to-br from-[#C8603A]/[0.04] to-transparent' : 'bg-gradient-to-br from-[#006c49]/[0.04] to-transparent'
            }`}>
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                drawerOpen === 'WO' ? 'bg-[#C8603A]/10' : 'bg-[#006c49]/10'
              }`}>
                <span className={`material-symbols-outlined text-[20px] ${
                  drawerOpen === 'WO' ? 'text-[#C8603A]' : 'text-[#006c49]'
                }`} style={{ fontVariationSettings: "'FILL' 1" }}>
                  {drawerOpen === 'WO' ? 'engineering' : 'shopping_cart'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-[15px] font-bold text-on-surface">
                  {drawerOpen === 'WO' ? 'New Work Order' : 'New Purchase Order'}
                </h2>
                <p className="text-[11px] text-on-surface-variant/50 mt-0.5">
                  {drawerOpen === 'WO' ? 'Quick-create & link to this transaction' : 'Quick-create & link to this transaction'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                disabled={creatingOrder}
                className="w-8 h-8 rounded-xl hover:bg-black/[0.04] flex items-center justify-center text-on-surface-variant/40 hover:text-on-surface transition-colors disabled:opacity-30"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Drawer body (scrollable) */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

              {/* Context badge — locked fields */}
              {(selectedProjectId || stkId) && (
                <div className="flex flex-wrap gap-2">
                  {selectedProjectId && projects?.find(p => p.project_id === selectedProjectId) && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/[0.03] border border-black/[0.06] text-[11px] font-semibold text-on-surface-variant/60">
                      <span className="material-symbols-outlined text-[13px] text-on-surface-variant/40">location_city</span>
                      {projects!.find(p => p.project_id === selectedProjectId)?.name}
                    </span>
                  )}
                  {stkId && stakeholders?.find(s => s.stakeholder_id === stkId) && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/[0.03] border border-black/[0.06] text-[11px] font-semibold text-on-surface-variant/60">
                      <span className="material-symbols-outlined text-[13px] text-on-surface-variant/40">
                        {drawerOpen === 'WO' ? 'engineering' : 'store'}
                      </span>
                      {stakeholders!.find(s => s.stakeholder_id === stkId)?.name}
                    </span>
                  )}
                </div>
              )}

              {drawerOpen === 'WO' ? (
                /* ── WO Form ── */
                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-on-surface-variant/60 mb-2 uppercase tracking-wide">
                      Scope of Work <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={woScope}
                      onChange={e => setWoScope(e.target.value)}
                      rows={3}
                      className="bk-input w-full resize-none focus:ring-4 focus:ring-[#C8603A]/10 transition-all duration-200"
                      placeholder="e.g. Plastering work — 2nd floor walls and ceiling…"
                      autoFocus
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-on-surface-variant/60 mb-2 uppercase tracking-wide">
                        Order Value (₹) <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] font-bold text-on-surface-variant/30 font-data-mono">₹</span>
                        <input
                          type="number" step="1" min="0"
                          value={woValue || ''}
                          onChange={e => setWoValue(parseFloat(e.target.value) || 0)}
                          onFocus={e => e.target.select()}
                          className="bk-input pl-7 font-data-mono focus:ring-4 focus:ring-[#C8603A]/10 transition-all duration-200"
                          placeholder="0"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-on-surface-variant/60 mb-2 uppercase tracking-wide">Date Issued</label>
                      <input
                        type="date" value={woDate}
                        onChange={e => setWoDate(e.target.value)}
                        className="bk-input focus:ring-4 focus:ring-[#C8603A]/10 transition-all duration-200"
                      />
                    </div>
                  </div>
                  {/* Summary block */}
                  {woValue > 0 && (
                    <div className="rounded-xl border border-[#C8603A]/10 bg-[#C8603A]/[0.02] p-4">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#C8603A]/60 mb-2">Order Summary</p>
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] text-on-surface-variant/60">Lump-sum · Full Payment</span>
                        <span className="text-[14px] font-bold font-data-mono text-[#C8603A]">₹{woValue.toLocaleString('en-IN')}</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* ── PO Form ── */
                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-on-surface-variant/60 mb-2 uppercase tracking-wide">
                      Item / Description <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={poDesc}
                      onChange={e => setPoDesc(e.target.value)}
                      rows={3}
                      className="bk-input w-full resize-none focus:ring-4 focus:ring-[#006c49]/10 transition-all duration-200"
                      placeholder="e.g. TMT Steel Bars 12mm Fe-500 grade…"
                      autoFocus
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-on-surface-variant/60 mb-2 uppercase tracking-wide">
                        Total Value (₹ incl. GST) <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] font-bold text-on-surface-variant/30 font-data-mono">₹</span>
                        <input
                          type="number" step="1" min="0"
                          value={poValue || ''}
                          onChange={e => setPoValue(parseFloat(e.target.value) || 0)}
                          onFocus={e => e.target.select()}
                          className="bk-input pl-7 font-data-mono focus:ring-4 focus:ring-[#006c49]/10 transition-all duration-200"
                          placeholder="0"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-on-surface-variant/60 mb-2 uppercase tracking-wide">GST Rate</label>
                      <div className="flex gap-1.5">
                        {[0, 5, 12, 18, 28].map(r => (
                          <button key={r} type="button"
                            onClick={() => setPoGstRate(r)}
                            className={`flex-1 py-2 rounded-lg text-[11px] font-bold transition-colors ${
                              poGstRate === r
                                ? 'bg-[#006c49] text-white'
                                : 'bg-black/[0.03] text-on-surface-variant/50 hover:bg-black/[0.06]'
                            }`}
                          >{r}%</button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-on-surface-variant/60 mb-2 uppercase tracking-wide">Date Issued</label>
                    <input
                      type="date" value={poDate}
                      onChange={e => setPoDate(e.target.value)}
                      className="bk-input focus:ring-4 focus:ring-[#006c49]/10 transition-all duration-200"
                    />
                  </div>
                  {/* Tax breakdown */}
                  {poValue > 0 && (
                    <div className="rounded-xl border border-[#006c49]/10 bg-[#006c49]/[0.02] p-4 space-y-1.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#006c49]/60 mb-2">Tax Breakdown</p>
                      {(() => {
                        const taxable = poValue / (1 + poGstRate / 100);
                        const totalGST = poValue - taxable;
                        return (
                          <>
                            <div className="flex justify-between text-[11px]">
                              <span className="text-on-surface-variant/50">Taxable amount</span>
                              <span className="font-data-mono font-semibold">₹{taxable.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                            </div>
                            {poGstRate > 0 && (
                              <>
                                <div className="flex justify-between text-[11px]">
                                  <span className="text-on-surface-variant/50">CGST ({poGstRate / 2}%)</span>
                                  <span className="font-data-mono">₹{(totalGST / 2).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                </div>
                                <div className="flex justify-between text-[11px]">
                                  <span className="text-on-surface-variant/50">SGST ({poGstRate / 2}%)</span>
                                  <span className="font-data-mono">₹{(totalGST / 2).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                </div>
                              </>
                            )}
                            <div className="border-t border-[#006c49]/10 pt-1.5 flex justify-between text-[12px] font-bold">
                              <span className="text-[#006c49]">Total</span>
                              <span className="font-data-mono text-[#006c49]">₹{poValue.toLocaleString('en-IN')}</span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Drawer footer */}
            <div className="px-6 py-4 border-t border-black/[0.05] bg-black/[0.005] shrink-0">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={closeDrawer}
                  disabled={creatingOrder}
                  className="flex-1 py-2.5 rounded-xl border border-black/[0.08] text-[13px] font-semibold text-on-surface-variant hover:bg-black/[0.03] transition-colors disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={drawerOpen === 'WO' ? handleCreateWO : handleCreatePO}
                  disabled={creatingOrder}
                  className={`flex-[2] py-2.5 rounded-xl text-[13px] font-bold text-white transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50 shadow-sm ${
                    drawerOpen === 'WO'
                      ? 'bg-[#C8603A] hover:bg-[#B54E2A] shadow-[#C8603A]/20'
                      : 'bg-[#006c49] hover:bg-[#005438] shadow-[#006c49]/20'
                  }`}
                >
                  {creatingOrder ? (
                    <><Loader2 className="animate-spin" size={15} /> Creating…</>
                  ) : (
                    <><span className="material-symbols-outlined text-[17px]">check</span>Create {drawerOpen === 'WO' ? 'Work Order' : 'Purchase Order'}</>
                  )}
                </button>
              </div>
            </div>

            {/* ── Celebration Overlay ── */}
            {celebrating && (
              <div className="absolute inset-0 z-[70] flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
                {/* Radial rings */}
                <div className="relative flex items-center justify-center">
                  <div className={`absolute w-32 h-32 rounded-full border-2 celebrate-ring ${
                    drawerOpen === 'WO' ? 'border-[#C8603A]/20' : 'border-[#006c49]/20'
                  }`} />
                  <div className={`absolute w-44 h-44 rounded-full border celebrate-ring-outer ${
                    drawerOpen === 'WO' ? 'border-[#C8603A]/10' : 'border-[#006c49]/10'
                  }`} />
                  {/* Check circle */}
                  <div className={`w-20 h-20 rounded-full flex items-center justify-center celebrate-check shadow-lg ${
                    drawerOpen === 'WO' ? 'bg-[#C8603A]' : 'bg-[#006c49]'
                  }`}>
                    <span className="material-symbols-outlined text-white text-[40px]" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
                  </div>
                </div>
                {/* Text */}
                <div className="mt-6 text-center celebrate-text">
                  <p className="text-[16px] font-bold text-on-surface">
                    {drawerOpen === 'WO' ? 'Work Order Created' : 'Purchase Order Created'}
                  </p>
                  {createdOrderId && (
                    <p className={`text-[12px] font-data-mono font-bold mt-1 ${
                      drawerOpen === 'WO' ? 'text-[#C8603A]' : 'text-[#006c49]'
                    }`}>{createdOrderId}</p>
                  )}
                  <p className="text-[11px] text-on-surface-variant/50 mt-1.5">Linking to your transaction…</p>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Bottom Action Bar — voice restyle (handlers unchanged) ──────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 backdrop-blur-xl" style={{ background: 'rgba(255,255,255,0.9)', borderTop: `1px solid ${VOICE.line}` }}>
        <div className="mx-auto px-5 py-4 flex items-center gap-3" style={{ maxWidth: 720 }}>
          {txnType && (
            <div>
              <p className="text-sm font-medium" style={{ color: txnType === 'client_receipt' ? VOICE.inn : VOICE.out, ...VNUMS }}>
                {txnType === 'client_receipt' ? '+' : '−'} {totalAmt > 0 ? `₹${totalAmt.toLocaleString('en-IN')}` : '₹0'}
              </p>
              <p className="text-xs" style={{ color: VOICE.systemFaint }}>draft</p>
            </div>
          )}
          <button type="button" onClick={() => navigate('/ledger')}
            className="text-[13px] font-bold px-4 py-2.5 rounded-xl transition-all duration-200 active:scale-95"
            style={{ color: VOICE.system }}>
            Cancel
          </button>
          <div className="flex-1" />
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2.5">
              <button type="button" onClick={() => handleSave('new')} disabled={!txnType || createTxn.isPending}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-black/15 text-on-surface text-[13px] font-bold hover:bg-black/[0.02] transition-all duration-200 active:scale-95 disabled:opacity-35 disabled:pointer-events-none">
                {createTxn.isPending && (createTxn.variables as any)?.saveMode === 'new'
                  ? <Loader2 className="animate-spin" size={14} />
                  : <span className="material-symbols-outlined text-[16px]">add</span>}
                Save & new
              </button>
              <button type="button" onClick={() => handleSave('exit')} disabled={!txnType || createTxn.isPending}
                className="bk-btn flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-[13px] font-bold transition-all duration-200 active:scale-95 disabled:opacity-35 disabled:pointer-events-none shadow-[0_4px_12px_rgba(0,0,0,0.05)]">
                {createTxn.isPending && (createTxn.variables as any)?.saveMode === 'exit'
                  ? <Loader2 className="animate-spin" size={14} />
                  : <span className="material-symbols-outlined text-[16px]">check</span>}
                Save & exit
              </button>
            </div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant/30 mr-1 select-none">⌘ Enter</p>
          </div>
        </div>
      </div>
    </div>
  );
}
