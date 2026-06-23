import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import type { Project } from '../types';
import { useSnackbar } from './Snackbar';
import { useOrgId } from '../lib/auth/AuthProvider';
import { CostCodePicker } from './CostCodePicker';
import { getCostCode, costCodeLabel, ALL_COST_CODES } from '../lib/costCodes';
import { autoCloseWOIfFullyPaid } from '../lib/woAutoClose';

// ── Types ─────────────────────────────────────────────────────────────────────

type PayMode = 'NEFT' | 'UPI' | 'Cheque' | 'Cash';

interface SelectedObligation {
  type: 'WO_PHASE' | 'WO' | 'PO';
  wo_id?: string;
  phase_id?: string;
  po_id?: string;
  label: string;
  balance: number;
}

function genTxnId() {
  return `TXN-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
}

function getWOBalance(wo: any): number { return Number(wo.order_value || 0); }
function getPOBalance(po: any): number { return Number(po.vendor_bill_amount || po.total_value || po.order_value || 0); }

// ── Props ─────────────────────────────────────────────────────────────────────

interface QuickTransactionSheetProps {
  stakeholder: { stakeholder_id: string; name: string; type: string };
  onClose: () => void;
  onSuccess: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function QuickTransactionSheet({ stakeholder, onClose, onSuccess }: QuickTransactionSheetProps) {
  const qc = useQueryClient();
  const orgId = useOrgId();
  const { show: showSnackbar } = useSnackbar();
  const aiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derive transaction type from stakeholder type
  const txnType = stakeholder.type === 'Worker' ? 'worker'
    : stakeholder.type === 'Client' ? 'client_receipt'
    : 'material';

  const txnTypeLabel = txnType === 'worker' ? 'Worker Payment'
    : txnType === 'client_receipt' ? 'Client Receipt'
    : 'Material Purchase';

  const accentColor = txnType === 'worker' ? '#C8603A'
    : txnType === 'client_receipt' ? '#0EA5E9'
    : '#006c49';

  // ── Form state ──────────────────────────────────────────────────────────────
  const [txnId]                 = useState(genTxnId);
  const [totalAmt, setTotalAmt] = useState(0);
  const [date, setDate]         = useState(new Date().toISOString().split('T')[0]);
  const [mode, setMode]         = useState<PayMode>('NEFT');
  const [projectId, setProjectId] = useState('');
  const [remarks, setRemarks]   = useState('');
  const [category, setCategory] = useState('');
  const [billFile, setBillFile] = useState<File | null>(null);
  const [receiptRef, setReceiptRef]               = useState('');
  const [receiptDescription, setReceiptDescription] = useState('');

  // Obligation state
  const [selectedObligation, setSelectedObligation] = useState<SelectedObligation | null>(null);
  const [skipped, setSkipped]                       = useState(false);
  const [loadingObligations, setLoadingObligations] = useState(false);
  const [projectWOs, setProjectWOs]                 = useState<any[]>([]);
  const [projectPOs, setProjectPOs]                 = useState<any[]>([]);
  const [amountTouched, setAmountTouched]           = useState(false);
  const [expandedWOs, setExpandedWOs]               = useState<string[]>([]);

  // AI cost code
  const [aiCodeState, setAiCodeState]     = useState<'idle' | 'loading' | 'suggested' | 'none'>('idle');
  const [aiSuggestedCode, setAiSuggestedCode] = useState<string | null>(null);

  // Submit state
  const [saving, setSaving]               = useState(false);
  const [saveAttempted, setSaveAttempted] = useState(false);

  // ── Queries ─────────────────────────────────────────────────────────────────
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => { const { data } = await supabase.from('projects').select('*'); return data as Project[]; },
  });

  // Fetch obligations when project is selected
  useEffect(() => {
    if (!projectId || txnType === 'client_receipt') {
      setProjectWOs([]); setProjectPOs([]); setSelectedObligation(null); setSkipped(false); return;
    }
    let cancelled = false;
    setLoadingObligations(true);
    setSelectedObligation(null); setSkipped(false);

    if (txnType === 'worker') {
      supabase.from('work_orders')
        .select('wo_id, scope_of_work, order_value, status, stakeholders(name, category), wo_milestones(*)')
        .eq('project_id', projectId)
        .eq('stakeholder_id', stakeholder.stakeholder_id)
        .not('status', 'in', '("Closed","Cancelled")')
        .order('created_at', { ascending: false })
        .then(({ data: wos }) => {
          if (!cancelled) { setProjectWOs(wos || []); setProjectPOs([]); setLoadingObligations(false); }
        });
    } else {
      supabase.from('purchase_orders')
        .select('po_id, status, vendor_bill_amount, total_value, order_value, stakeholders(name, category), po_line_items(*)')
        .eq('project_id', projectId)
        .eq('stakeholder_id', stakeholder.stakeholder_id)
        .order('created_at', { ascending: false })
        .then(({ data: pos }) => {
          if (!cancelled) { setProjectWOs([]); setProjectPOs(pos || []); setLoadingObligations(false); }
        });
    }
    return () => { cancelled = true; };
  }, [projectId, txnType, stakeholder.stakeholder_id]);

  // ── AI cost code suggestion ──────────────────────────────────────────────────
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
        setAiSuggestedCode(null); setAiCodeState('none');
      } else {
        setCategory(result); setAiSuggestedCode(result); setAiCodeState('suggested');
      }
    } catch { setAiCodeState('idle'); }
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async (saveMode: 'new' | 'exit') => {
    setSaveAttempted(true);
    const isClient = txnType === 'client_receipt';
    if (!totalAmt || totalAmt <= 0) return;
    if (!projectId) return;
    if (!isClient && !remarks.trim()) return;

    setSaving(true);
    try {
      // Upload file
      let bill_doc_url: string | null = null;
      if (billFile) {
        const ext = billFile.name.split('.').pop();
        const filename = `${txnId}-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from('documents').upload(`bills/${filename}`, billFile);
        if (uploadError) throw uploadError;
        const { data: pubData } = supabase.storage.from('documents').getPublicUrl(`bills/${filename}`);
        bill_doc_url = pubData.publicUrl;
      }

      // Build remarks prefix from obligation
      let effectiveCategory = isClient ? 'CLIENT-RECEIPT' : category;
      let effectiveRemarks = '';
      if (isClient) {
        effectiveRemarks = receiptDescription.trim() || (receiptRef.trim() ? `Ref: ${receiptRef.trim()}` : '');
      } else {
        let prefix = '';
        if (selectedObligation?.type === 'WO_PHASE') {
          const wo = projectWOs.find((w: any) => w.wo_id === selectedObligation.wo_id);
          const phase = wo?.wo_milestones?.find((m: any) => m.milestone_id === selectedObligation.phase_id);
          prefix = `[${selectedObligation.wo_id} - ${phase?.name || selectedObligation.phase_id}]`;
        } else if (selectedObligation?.type === 'WO') {
          prefix = `[${selectedObligation.wo_id}]`;
        } else if (selectedObligation?.type === 'PO') {
          prefix = `[${selectedObligation.po_id}]`;
        }
        const base = remarks.trim();
        effectiveRemarks = prefix ? (base ? `${prefix} - ${base}` : prefix) : base;
      }

      if (selectedObligation?.type === 'PO') {
        const selPO = projectPOs.find((p: any) => p.po_id === selectedObligation.po_id);
        if (selPO && !Number(selPO.vendor_bill_amount)) {
          effectiveCategory = 'PO Advance';
          if (!effectiveRemarks.includes('[PO Advance]')) effectiveRemarks = `[PO Advance] ${effectiveRemarks}`.trim();
        }
      }

      const payload = {
        txn_id: txnId, stakeholder_id: stakeholder.stakeholder_id, date, total_amount: totalAmt,
        payment_mode: mode, category: effectiveCategory, remarks: effectiveRemarks,
        bill_doc_url, ai_flag_status: 'Clean', ai_flag_data: {}, org_id: orgId,
      };

      let order_type: string | null = null, order_ref: string | null = null, milestone_id: string | null = null;
      if (selectedObligation?.type === 'WO' || selectedObligation?.type === 'WO_PHASE') {
        order_type = 'WO'; order_ref = selectedObligation.wo_id || null; milestone_id = selectedObligation.phase_id || null;
      } else if (selectedObligation?.type === 'PO') {
        order_type = 'PO'; order_ref = selectedObligation.po_id || null;
      }

      const allocations = [{ project_id: projectId, order_type: isClient ? null : order_type, order_ref: isClient ? null : order_ref, milestone_id: isClient ? null : milestone_id, allocated_amount: totalAmt }];
      const { error } = await supabase.rpc('insert_transaction_with_allocations', { p_txn: payload, p_allocations: allocations });
      if (error) throw error;

      // Auto-close WO if applicable
      const autoCloseWoId = (selectedObligation?.type === 'WO' || selectedObligation?.type === 'WO_PHASE') ? (selectedObligation.wo_id ?? null) : null;
      if (autoCloseWoId) autoCloseWOIfFullyPaid(autoCloseWoId, qc);

      qc.invalidateQueries({ queryKey: ['ledger'] });
      qc.invalidateQueries({ queryKey: ['stakeholder_txns', stakeholder.stakeholder_id] });
      qc.invalidateQueries({ queryKey: ['po_payment_totals'] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });

      showSnackbar(`${txnId} saved`);
      onSuccess();
      if (saveMode === 'exit') {
        onClose();
      }
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to save transaction', { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // ── Validation ───────────────────────────────────────────────────────────────
  const missingAmount  = saveAttempted && (!totalAmt || totalAmt <= 0);
  const missingProject = saveAttempted && !projectId;
  const missingRemarks = saveAttempted && !remarks.trim() && txnType !== 'client_receipt';

  const COA_DEFAULTS: Record<string, { type: 'MAT' | 'WRK'; division?: string }> = {
    worker:   { type: 'WRK', division: 'WRK-21' },
    material: { type: 'MAT' },
    expense:  { type: 'WRK', division: 'WRK-22' },
    client_receipt: { type: 'MAT' },
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @keyframes qtsSlideIn {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes qtsFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .qts-slide { animation: qtsSlideIn 0.38s cubic-bezier(0.32,0,0.08,1) both; }
        .qts-backdrop { animation: qtsFadeIn 0.25s ease both; }
      `}</style>

      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[3px] qts-backdrop"
        onClick={saving ? undefined : onClose}
      />

      {/* Sheet Panel */}
      <div className="fixed right-0 top-0 bottom-0 z-[61] w-full max-w-[520px] bg-white shadow-[-32px_0_80px_rgba(0,0,0,0.14)] qts-slide flex flex-col overflow-hidden">

        {/* ── Header ── */}
        <div className="px-6 pt-5 pb-4 border-b border-black/[0.05] shrink-0"
          style={{ background: `linear-gradient(135deg, ${accentColor}08 0%, transparent 60%)` }}>
          <div className="flex items-center gap-3">
            {/* Party Avatar */}
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0 border"
              style={{
                background: `linear-gradient(135deg, ${accentColor}18, ${accentColor}08)`,
                color: accentColor,
                borderColor: `${accentColor}25`,
              }}>
              {stakeholder.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[15px] font-bold text-on-surface truncate">{stakeholder.name}</h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border"
                  style={{ background: `${accentColor}10`, color: accentColor, borderColor: `${accentColor}25` }}>
                  <span className="material-symbols-outlined text-[11px]">
                    {txnType === 'worker' ? 'engineering' : txnType === 'client_receipt' ? 'payments' : 'shopping_cart'}
                  </span>
                  {txnTypeLabel}
                </span>
              </div>
              <p className="text-[10.5px] text-on-surface-variant/50 mt-0.5 font-data-mono">{txnId}</p>
            </div>
            <button type="button" onClick={onClose} disabled={saving}
              className="w-8 h-8 rounded-xl hover:bg-black/[0.05] flex items-center justify-center text-on-surface-variant/40 hover:text-on-surface transition-colors shrink-0 disabled:opacity-30">
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        {/* ── Scrollable Body ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Hero Amount */}
          <div className="text-center py-4">
            <div className="inline-block relative">
              <div className="flex items-baseline justify-center gap-1.5">
                <span className="text-4xl font-light text-on-surface-variant/30 select-none">₹</span>
                <input
                  type="number" inputMode="decimal" step="0.01" min="0"
                  value={totalAmt || ''}
                  onChange={e => { setAmountTouched(true); setTotalAmt(parseFloat(e.target.value) || 0); }}
                  onFocus={e => e.target.select()}
                  placeholder="0"
                  autoFocus
                  className={`w-auto min-w-[100px] max-w-full text-5xl font-bold font-data-mono text-center bg-transparent border-none outline-none focus:ring-0 placeholder:text-on-surface-variant/15 text-on-surface ${missingAmount ? 'text-error' : ''}`}
                  style={{ width: totalAmt ? `${Math.max(3, String(Math.round(totalAmt)).length) * 0.62}em` : '2.5em' }}
                />
              </div>
              <div className="h-0.5 w-full rounded-full mt-2"
                style={{ background: `linear-gradient(to right, transparent, ${accentColor}30, transparent)` }} />
              {missingAmount && <span className="block mt-2 text-[10px] font-bold text-error uppercase tracking-wider">Amount required</span>}
            </div>
          </div>

          {/* Date + Mode */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-semibold text-on-surface-variant/60 mb-2 uppercase tracking-wide">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="bk-input" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-on-surface-variant/60 mb-2 uppercase tracking-wide">Mode</label>
              <div className="flex rounded-xl overflow-hidden border border-outline-variant/25">
                {(['NEFT', 'UPI', 'Cheque', 'Cash'] as PayMode[]).map((m, i) => (
                  <button key={m} type="button" onClick={() => setMode(m)}
                    className={`flex-1 py-2 text-[11px] font-semibold transition-colors ${mode === m ? 'text-white' : 'bg-white text-on-surface-variant/50 hover:bg-surface-container-low/60'} ${i > 0 ? 'border-l border-outline-variant/25' : ''}`}
                    style={mode === m ? { background: accentColor } : {}}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Client Receipt extras */}
          {txnType === 'client_receipt' && (
            <>
              <div>
                <label className="block text-[11px] font-semibold text-on-surface-variant/60 mb-2 uppercase tracking-wide">Reference / UTR <span className="normal-case font-normal text-on-surface-variant/35">(optional)</span></label>
                <input type="text" value={receiptRef} onChange={e => setReceiptRef(e.target.value)} className="bk-input" placeholder="UTR / cheque / reference number" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-on-surface-variant/60 mb-2 uppercase tracking-wide">Description <span className="normal-case font-normal text-on-surface-variant/35">(optional)</span></label>
                <input type="text" value={receiptDescription} onChange={e => setReceiptDescription(e.target.value)} className="bk-input" placeholder="What this payment is for…" />
              </div>
            </>
          )}

          {/* Project */}
          <div>
            <label className={`block text-[11px] font-semibold mb-2 uppercase tracking-wide ${missingProject ? 'text-error' : 'text-on-surface-variant/60'}`}>
              Project / Site{missingProject && <span className="ml-1.5 normal-case font-normal">required</span>}
            </label>
            <select value={projectId} onChange={e => { setProjectId(e.target.value); setSelectedObligation(null); setSkipped(false); }}
              className={`bk-input ${missingProject ? 'border-error' : ''}`}>
              <option value="">Select project…</option>
              {projects?.map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
            </select>
          </div>

          {/* Obligation Linking */}
          {projectId && txnType !== 'client_receipt' && !skipped && (
            <div>
              <label className="block text-[11px] font-semibold text-on-surface-variant/60 mb-2 uppercase tracking-wide">
                Link to {txnType === 'worker' ? 'Contract' : 'Purchase Order'}
              </label>
              {loadingObligations ? (
                <div className="rounded-xl border border-black/[0.05] p-4 space-y-2 animate-pulse">
                  <div className="h-3 w-32 bg-black/[0.06] rounded-full" />
                  <div className="h-10 bg-black/[0.04] rounded-lg" />
                </div>
              ) : (projectWOs.length === 0 && projectPOs.length === 0) ? (
                <div className="rounded-xl border border-dashed border-outline-variant/30 p-4 text-center">
                  <span className="material-symbols-outlined text-[24px] text-on-surface-variant/20 block mb-1">link_off</span>
                  <p className="text-[12px] text-on-surface-variant/50">No open obligations. <button type="button" onClick={() => setSkipped(true)} className="text-primary underline">Record without linking</button></p>
                </div>
              ) : (
                <div className="rounded-xl border border-black/[0.05] overflow-hidden bg-white shadow-sm">
                  <div className="divide-y divide-black/[0.04]">
                    {/* WO rows */}
                    {projectWOs.map((wo: any) => {
                      const hasPhases = (wo.wo_milestones?.length || 0) > 0;
                      const isExpanded = expandedWOs.includes(wo.wo_id);
                      const isSelected = selectedObligation?.wo_id === wo.wo_id && !selectedObligation?.phase_id;
                      const bal = getWOBalance(wo);
                      return (
                        <div key={wo.wo_id} className={isSelected ? 'bg-[#C8603A]/[0.02]' : ''}>
                          <div className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-black/[0.01] transition-colors group"
                            onClick={() => {
                              if (hasPhases) {
                                setExpandedWOs(prev => prev.includes(wo.wo_id) ? prev.filter(id => id !== wo.wo_id) : [...prev, wo.wo_id]);
                              } else {
                                setSelectedObligation({ type: 'WO', wo_id: wo.wo_id, label: `${wo.wo_id} · ${stakeholder.name}`, balance: bal });
                                if (!amountTouched) setTotalAmt(bal);
                              }
                            }}>
                            <div className="w-5 shrink-0 flex items-center justify-center">
                              {hasPhases ? (
                                <span className={`material-symbols-outlined text-[18px] text-on-surface-variant/40 transition-transform ${isExpanded ? 'rotate-90 text-[#C8603A]' : ''}`}>chevron_right</span>
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
                                <p className="text-[13px] font-semibold text-on-surface truncate">{wo.scope_of_work || 'Contract'}</p>
                                <span className="font-data-mono text-[9px] px-1.5 py-0.5 rounded bg-black/[0.03] text-on-surface-variant/50 shrink-0 font-bold uppercase tracking-wider">{wo.wo_id}</span>
                              </div>
                              {hasPhases && <p className="text-[10px] text-on-surface-variant/40 mt-0.5">{wo.wo_milestones.length} phases</p>}
                            </div>
                            <p className="text-[12px] font-bold font-data-mono text-on-surface shrink-0">{bal > 0 ? `₹${bal.toLocaleString('en-IN')}` : 'Settled'}</p>
                          </div>
                          {/* Phase expansion */}
                          {hasPhases && isExpanded && (
                            <div className="border-t border-black/[0.03] bg-black/[0.005]">
                              {wo.wo_milestones.map((phase: any) => {
                                const pbal = Number(phase.planned_amount || 0);
                                const isPhaseSelected = selectedObligation?.phase_id === phase.milestone_id;
                                const settled = phase.status === 'PAID' || phase.status === 'Paid';
                                return (
                                  <div key={phase.milestone_id}
                                    className={`pl-10 pr-4 py-2.5 flex items-center gap-3 transition-colors ${settled ? 'opacity-40 cursor-not-allowed' : isPhaseSelected ? 'bg-[#C8603A]/[0.04] cursor-pointer' : 'cursor-pointer hover:bg-black/[0.01]'}`}
                                    onClick={() => {
                                      if (settled) return;
                                      setSelectedObligation({ type: 'WO_PHASE', wo_id: wo.wo_id, phase_id: phase.milestone_id, label: `${phase.name} · ${wo.wo_id}`, balance: pbal });
                                      if (!amountTouched) setTotalAmt(pbal);
                                    }}>
                                    <div className="w-5 shrink-0 flex items-center justify-center">
                                      {isPhaseSelected ? (
                                        <div className="w-4 h-4 rounded-full bg-[#C8603A] flex items-center justify-center shadow-[0_2px_6px_rgba(200,96,58,0.3)]">
                                          <span className="material-symbols-outlined text-white text-[10px]" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
                                        </div>
                                      ) : (
                                        <div className="w-2.5 h-2.5 rounded-full border border-black/20 bg-white" />
                                      )}
                                    </div>
                                    <p className="flex-1 text-[12px] font-medium text-on-surface">{phase.name}</p>
                                    <p className="text-[12px] font-bold font-data-mono text-on-surface">₹{pbal.toLocaleString('en-IN')}</p>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {/* PO rows */}
                    {projectPOs.map((po: any) => {
                      const isSelected = selectedObligation?.po_id === po.po_id;
                      const isPaid = po.status === 'PAID';
                      const isCancelled = po.status === 'CANCELLED';
                      const isLinkable = !isPaid && !isCancelled;
                      const bal = getPOBalance(po);
                      return (
                        <div key={po.po_id}
                          className={`px-4 py-3 flex items-center gap-3 transition-colors group ${!isLinkable ? 'opacity-40 cursor-not-allowed' : isSelected ? 'bg-[#006c49]/[0.02] cursor-pointer' : 'cursor-pointer hover:bg-black/[0.01]'}`}
                          onClick={() => {
                            if (!isLinkable) return;
                            setSelectedObligation({ type: 'PO', po_id: po.po_id, label: `${po.po_id} · ${stakeholder.name}`, balance: bal });
                            if (!amountTouched) setTotalAmt(bal);
                          }}>
                          <div className="w-5 shrink-0 flex items-center justify-center">
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
                              <p className="text-[13px] font-semibold text-on-surface truncate">
                                {po.po_line_items?.[0]?.item_name || po.po_line_items?.[0]?.description || 'Purchase Order'}
                              </p>
                              <span className="font-data-mono text-[9px] px-1.5 py-0.5 rounded bg-black/[0.03] text-on-surface-variant/50 shrink-0 font-bold">{po.po_id}</span>
                            </div>
                            {po.po_line_items?.length > 1 && <p className="text-[10px] text-on-surface-variant/40 mt-0.5">+{po.po_line_items.length - 1} more items</p>}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[12px] font-bold font-data-mono text-on-surface">₹{bal.toLocaleString('en-IN')}</p>
                            {isPaid && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-600/10 mt-1 block">Settled</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* PO Advance warning */}
                  {selectedObligation?.type === 'PO' && (() => {
                    const selPO = projectPOs.find((p: any) => p.po_id === selectedObligation.po_id);
                    if (selPO && !Number(selPO.vendor_bill_amount)) return (
                      <div className="m-3 p-3 rounded-lg border border-amber-200/50 bg-amber-50/50 text-[11px] text-amber-800 flex items-start gap-2">
                        <span className="material-symbols-outlined text-[16px] text-amber-600 shrink-0 mt-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
                        <span>No bill recorded yet — this will be registered as a <strong>PO Advance</strong>.</span>
                      </div>
                    );
                    return null;
                  })()}
                  <div className="px-4 py-2.5 border-t border-black/[0.04] bg-black/[0.005]">
                    <button type="button" onClick={() => { setSelectedObligation(null); setSkipped(true); }}
                      className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant/40 hover:text-primary transition-colors flex items-center gap-1.5">
                      <span>Skip & Record Unlinked</span>
                      <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Relink button */}
          {projectId && txnType !== 'client_receipt' && skipped && (
            <button type="button" onClick={() => { setSkipped(false); setSelectedObligation(null); }}
              className="flex items-center gap-1.5 text-[12px] text-on-surface-variant/50 hover:text-primary transition-colors">
              <span className="material-symbols-outlined text-[14px]">link</span>
              Link to a Contract or PO
            </button>
          )}

          {/* Categorise: Cost Code + Remarks */}
          {txnType !== 'client_receipt' && (
            <>
              {/* Cost Code */}
              <div>
                <label className="block text-[11px] font-semibold text-on-surface-variant/60 mb-2 uppercase tracking-wide">
                  Cost Code <span className="normal-case font-normal text-on-surface-variant/35">(optional)</span>
                </label>
                <CostCodePicker
                  value={category}
                  onChange={v => { setCategory(v); setAiCodeState('idle'); setAiSuggestedCode(null); }}
                  defaultType={COA_DEFAULTS[txnType]?.type || 'MAT'}
                  defaultDivision={COA_DEFAULTS[txnType]?.division}
                  error={false}
                />
                {aiCodeState !== 'idle' && (
                  <div className="mt-2 animate-fadeIn">
                    {aiCodeState === 'loading' && (
                      <div className="text-[11px] text-on-surface-variant/40 pl-1 flex items-center gap-2">
                        <Loader2 className="animate-spin shrink-0" size={12} /> Analyzing with AI…
                      </div>
                    )}
                    {aiCodeState === 'suggested' && aiSuggestedCode && category === aiSuggestedCode && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-indigo-600 font-semibold pl-1">
                        <span className="material-symbols-outlined text-[13px] animate-pulse" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
                        <span>AI: <strong>{costCodeLabel(aiSuggestedCode)}</strong></span>
                        <button type="button" onClick={() => { setCategory(''); setAiCodeState('idle'); setAiSuggestedCode(null); }}
                          className="ml-2 underline hover:text-indigo-800 font-bold">Undo</button>
                      </div>
                    )}
                    {aiCodeState === 'none' && (
                      <div className="mt-1.5 text-[11px] text-on-surface-variant/35 pl-1 flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[13px]">help_outline</span>
                        No matching cost code found.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Remarks */}
              <div>
                <label className={`block text-[11px] font-semibold mb-2 uppercase tracking-wide ${missingRemarks ? 'text-error' : 'text-on-surface-variant/60'}`}>
                  Remarks{missingRemarks ? <span className="ml-1.5 normal-case font-normal">required</span> : <span className="ml-1 normal-case font-normal text-on-surface-variant/35">(what is this payment for?)</span>}
                </label>
                <textarea
                  value={remarks}
                  onChange={e => {
                    setRemarks(e.target.value);
                    if (category) return;
                    if (aiDebounceRef.current) clearTimeout(aiDebounceRef.current);
                    if (e.target.value.trim().length >= 5) {
                      setAiCodeState('idle');
                      aiDebounceRef.current = setTimeout(() => suggestCostCode(e.target.value), 1000);
                    } else {
                      setAiCodeState('idle'); setAiSuggestedCode(null);
                    }
                  }}
                  className={`bk-input w-full min-h-[72px] resize-none focus:ring-4 focus:ring-primary/5 transition-all duration-200 ${missingRemarks ? 'border-error' : 'border-outline-variant/30'}`}
                  placeholder="e.g. Payment for tile fixing in bathroom, 2nd floor…"
                  rows={2}
                />
              </div>
            </>
          )}

          {/* Proof Document */}
          <div>
            <label className="block text-[11px] font-semibold text-on-surface-variant/60 mb-2 uppercase tracking-wide">
              Proof Document <span className="normal-case font-normal text-on-surface-variant/35">(optional)</span>
            </label>
            <input type="file" id="qts-proof" onChange={e => setBillFile(e.target.files?.[0] || null)} className="hidden" accept=".pdf,.jpg,.jpeg,.png" />
            {billFile ? (
              <div className="flex items-center gap-3 p-3 rounded-xl border border-black/[0.05] bg-white shadow-sm">
                <div className="w-10 h-10 rounded-lg bg-black/[0.02] border border-black/[0.04] flex flex-col items-center justify-center shrink-0">
                  <span className="text-[8px] font-extrabold uppercase tracking-widest text-on-surface-variant/40">{billFile.name.split('.').pop()?.slice(0, 3)}</span>
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant/30 mt-0.5">description</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold text-on-surface truncate">{billFile.name}</p>
                  <p className="text-[10px] text-on-surface-variant/40 font-data-mono">{(billFile.size / 1024).toFixed(0)} KB</p>
                </div>
                <button type="button" onClick={() => setBillFile(null)}
                  className="w-7 h-7 rounded-lg hover:bg-red-50 text-on-surface-variant/40 hover:text-red-600 transition-colors flex items-center justify-center">
                  <span className="material-symbols-outlined text-[16px]">delete</span>
                </button>
              </div>
            ) : (
              <label htmlFor="qts-proof"
                className="flex items-center gap-3 p-4 rounded-xl border-2 border-dashed border-black/[0.06] hover:border-primary/30 bg-white/40 cursor-pointer transition-all duration-200 group hover:bg-white/60">
                <div className="w-9 h-9 rounded-full bg-black/[0.02] group-hover:bg-primary/[0.04] flex items-center justify-center transition-colors shrink-0">
                  <span className="material-symbols-outlined text-[20px] text-on-surface-variant/35 group-hover:text-primary transition-colors group-hover:-translate-y-0.5 transition-transform">cloud_upload</span>
                </div>
                <div>
                  <p className="text-[12px] font-semibold text-on-surface group-hover:text-primary transition-colors">Upload proof document</p>
                  <p className="text-[10px] text-on-surface-variant/40 mt-0.5">PDF, JPG or PNG · optional</p>
                </div>
              </label>
            )}
          </div>

        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t border-black/[0.05] bg-black/[0.005] shrink-0">
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={onClose} disabled={saving}
              className="px-4 py-2.5 rounded-xl border border-black/[0.08] text-[13px] font-semibold text-on-surface-variant hover:bg-black/[0.03] transition-colors disabled:opacity-40">
              Cancel
            </button>
            <button type="button" onClick={() => handleSave('new')} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-black/15 text-on-surface text-[13px] font-bold hover:bg-black/[0.02] transition-all duration-200 active:scale-95 disabled:opacity-35 disabled:pointer-events-none">
              {saving ? <Loader2 className="animate-spin" size={14} /> : <span className="material-symbols-outlined text-[16px]">add</span>}
              Save & new
            </button>
            <button type="button" onClick={() => handleSave('exit')} disabled={saving}
              className="flex-1 bk-btn flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-bold transition-all duration-200 active:scale-95 disabled:opacity-35 disabled:pointer-events-none shadow-sm">
              {saving ? <Loader2 className="animate-spin" size={14} /> : <span className="material-symbols-outlined text-[16px]">check</span>}
              Save & close
            </button>
          </div>
          <p className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant/25 text-right mt-2 select-none">⌘ Enter to save</p>
        </div>
      </div>
    </>
  );
}
