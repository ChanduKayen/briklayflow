/**
 * TrackChip — the gentle nudge that gets a payment attributed to a trackable
 * structure (a job = work order, or an order = purchase order). Tap the chip to
 * open an elegant panel: create a new one in a tap (a Draft you refine in Jobs),
 * or track it under an existing job/order. Scoped to the row's "not linked" slot.
 */
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useOrgId } from '../../lib/auth/AuthProvider';
import { Hammer, Package, ChevronRight, ChevronDown, Check, Plus } from 'lucide-react';
import { V, font, serif, nums, terraGrad } from './ledgerTokens';

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const inrShort = (n: number) => {
  const v = Number(n || 0);
  if (v >= 100000) return '₹' + (v / 100000).toFixed(v % 100000 === 0 ? 0 : 1) + 'L';
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
};
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

type Kind = 'WO' | 'PO';

export function TrackChip({ txn, onLinked }: { txn: any; onLinked: () => void }) {
  const orgId = useOrgId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [done, setDone] = useState<{ title: string; sub: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left?: number; right: number }>({ top: 0, right: 0 });
  const fail = (e: any) => { setErr(e?.message || e?.error_description || 'Could not do that — try again'); setBusy(false); };

  const type = txn.stakeholders?.type as string | undefined;
  const kind: Kind = type === 'Vendor' ? 'PO' : 'WO';
  const projectId: string | null = txn.txn_allocations?.[0]?.project_id ?? null;
  const projectName: string | null = txn.txn_allocations?.[0]?.projects?.name ?? null;
  const allocId: string | null = txn.txn_allocations?.[0]?.allocation_id ?? null;
  const stakeholderId: string | null = txn.stakeholder_id ?? null;
  const payee = txn.stakeholders?.name || 'this payee';
  const trade = (txn.stakeholders?.category || '') as string;
  const amount = Number(txn.total_amount) || 0;

  const noun = kind === 'PO' ? 'order' : 'job';
  const nudge = kind === 'PO' ? 'Are you tracking this purchase?' : 'Are you tracking this job?';
  const nudgeTe = kind === 'PO' ? 'ఈ కొనుగోలు ట్రాక్ అవుతుందా?' : 'ఈ పని ట్రాక్ అవుతుందా?';
  const suggested = cap(trade) || (kind === 'PO' ? 'Materials' : 'Site work');
  const NewIcon = kind === 'PO' ? Package : Hammer;

  // Essential details, collected before a draft is created — never a blind one-tap.
  const [name, setName] = useState(suggested);
  const [cost, setCost] = useState('');
  const [hasPhases, setHasPhases] = useState(false);
  const [phName, setPhName] = useState('');
  const [phAmt, setPhAmt] = useState('');

  const computePos = () => {
    const el = btnRef.current; if (!el) return null;
    const r = el.getBoundingClientRect();
    const mob = window.innerWidth < 640;
    const top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - 180));
    return mob ? { top, left: 8, right: 8 } : { top, right: Math.max(8, window.innerWidth - r.right) };
  };
  const toggle = () => {
    if (!open) { const p = computePos(); if (p) setPos(p); setErr(null); }
    setOpen((o) => !o);
  };
  const close = () => { setOpen(false); setExpanded(null); };

  // keep the panel attached to the chip while the page scrolls; close if it leaves view
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const el = btnRef.current; if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) { setOpen(false); return; }
      const p = computePos(); if (p) setPos(p);
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => { window.removeEventListener('scroll', reposition, true); window.removeEventListener('resize', reposition); };
  }, [open]);

  // existing jobs/orders for this payee + project, and what's been paid against each
  const { data, isLoading } = useQuery({
    queryKey: ['track', kind, projectId, stakeholderId],
    enabled: open && !!projectId && !!stakeholderId,
    queryFn: async () => {
      if (kind === 'WO') {
        const { data: wos } = await supabase.from('work_orders')
          .select('wo_id, scope_of_work, order_value, status, wo_milestones(milestone_id, name, seq_no, planned_amount)')
          .eq('project_id', projectId).eq('stakeholder_id', stakeholderId)
          .not('status', 'in', '("Closed","Cancelled")').order('date_issued', { ascending: false });
        const ids = (wos ?? []).map((w: any) => w.wo_id);
        const { data: paid } = ids.length
          ? await supabase.from('txn_allocations').select('order_ref, milestone_id, allocated_amount').eq('order_type', 'WO').in('order_ref', ids)
          : { data: [] as any[] };
        return { rows: wos ?? [], paid: paid ?? [] };
      }
      const { data: pos } = await supabase.from('purchase_orders')
        .select('po_id, status, order_value, total_value, vendor_bill_amount')
        .eq('project_id', projectId).eq('stakeholder_id', stakeholderId)
        .in('status', ['ORDERED', 'BILLED', 'PARTIAL']).order('created_at', { ascending: false });
      const ids = (pos ?? []).map((p: any) => p.po_id);
      const { data: paid } = ids.length
        ? await supabase.from('txn_allocations').select('order_ref, allocated_amount').eq('order_type', 'PO').in('order_ref', ids)
        : { data: [] as any[] };
      return { rows: pos ?? [], paid: paid ?? [] };
    },
  });

  // UNTRACKED spend with this payee ON THIS PROJECT — payments not yet linked to any
  // job/order. This is the case the panel is making (not all spend, only the loose ends).
  const { data: spend } = useQuery({
    queryKey: ['track_spend', stakeholderId, projectId],
    enabled: open && !!stakeholderId && !!projectId,
    queryFn: async () => {
      const { data: txns } = await supabase.from('transactions').select('txn_id').eq('stakeholder_id', stakeholderId).neq('status', 'Voided');
      const ids = (txns ?? []).map((t: any) => t.txn_id);
      const { data: allocs } = ids.length
        ? await supabase.from('txn_allocations').select('allocated_amount').eq('project_id', projectId).is('order_type', null).in('txn_id', ids)
        : { data: [] as any[] };
      const total = (allocs ?? []).reduce((s: number, a: any) => s + Number(a.allocated_amount || 0), 0);
      return { total, count: (allocs ?? []).length };
    },
  });

  const paidFor = (ref: string, milestoneId?: string) =>
    (data?.paid ?? []).filter((p: any) => p.order_ref === ref && (milestoneId === undefined || p.milestone_id === milestoneId))
      .reduce((s: number, p: any) => s + Number(p.allocated_amount || 0), 0);

  const rows = data?.rows ?? [];

  const finish = (title: string, sub: string) => {
    setDone({ title, sub });
    qc.invalidateQueries({ queryKey: ['ledger'] });
    qc.invalidateQueries({ queryKey: ['transactions'] });
    setTimeout(() => { onLinked(); close(); setDone(null); setBusy(false); }, 2600);
  };

  const noAlloc = () => { setErr("This payment isn't on a project yet — open it to set one, then track it."); };
  const attach = async (orderRef: string, milestoneId: string | null, label: string) => {
    if (busy) return;
    if (!allocId) return noAlloc();
    setBusy(true); setErr(null);
    try {
      const { error } = await supabase.from('txn_allocations').update({ order_type: kind, order_ref: orderRef, milestone_id: milestoneId }).eq('allocation_id', allocId);
      if (error) throw error;
      finish('Tracked', `${inr(amount)} added to ${label}`);
    } catch (e) { fail(e); }
  };

  const createJob = async () => {
    if (busy) return;
    if (!allocId) return noAlloc();
    const scope = name.trim() || suggested;
    const value = Number(cost) || amount;
    setBusy(true); setErr(null);
    try {
      const milestones = hasPhases
        ? [{ seq_no: 1, name: phName.trim() || 'Phase 1', unit_type: 'LS', quantity: 1, rate: null, planned_amount: Number(phAmt) || value, ai_extracted: false }]
        : [{ seq_no: 1, name: 'Full Payment', unit_type: 'LS', quantity: 1, rate: null, planned_amount: value, ai_extracted: false }];
      const { data: res, error } = await supabase.rpc('create_work_order', {
        p_org_id: orgId, p_project_id: projectId, p_stakeholder_id: stakeholderId,
        p_scope: scope, p_order_value: value,
        p_date_issued: new Date().toISOString().slice(0, 10), p_source: 'manual', p_milestones: milestones,
      });
      if (error || !res?.success) throw new Error(res?.error || 'create failed');
      await supabase.from('txn_allocations').update({ order_type: 'WO', order_ref: res.wo_id, milestone_id: null }).eq('allocation_id', allocId);
      finish(`${scope} job created`, `Draft saved${projectName ? ` · ${projectName}` : ''} — refine its phases in Jobs`);
    } catch (e) { fail(e); }
  };

  const createOrder = async () => {
    if (busy) return;
    if (!allocId) return noAlloc();
    const item = name.trim() || suggested;
    const value = Number(cost) || amount;
    setBusy(true); setErr(null);
    try {
      const poData = {
        org_id: orgId, project_id: projectId, stakeholder_id: stakeholderId,
        items: [{ description: item, qty: 1, unit: 'LS', rate: value, amount: value }],
        order_value: value, total_value: value, gst_value: 0, status: 'ORDERED',
        date_issued: new Date().toISOString().slice(0, 10), expected_delivery: null, delivery_location: null,
        payment_terms_days: 30, ordered_by: null, vendor_notes: null, internal_notes: null,
      };
      const lineItems = [{
        line_number: 1, category_id: null, item_name: item, specification: null, unit: 'LS',
        quantity_ordered: 1, unit_rate: value, basic_amount: value, discount_percent: 0, discount_amount: 0,
        gst_rate: 0, cgst: 0, sgst: 0, igst: 0, total_amount: value,
      }];
      const { data: res, error } = await supabase.rpc('create_purchase_order', { p_po_data: poData, p_line_items: lineItems });
      if (error || !res?.success) throw new Error(res?.error || 'create failed');
      await supabase.from('txn_allocations').update({ order_type: 'PO', order_ref: res.po_id, milestone_id: null }).eq('allocation_id', allocId);
      finish(`${item} order started`, `Tracked${projectName ? ` · ${projectName}` : ''} — add items & details in Orders`);
    } catch (e) { fail(e); }
  };

  const Pill = ({ children }: { children: React.ReactNode }) => (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full" style={{ border: `1px solid ${V.line}`, color: V.sys, ...font, ...nums, fontSize: 11.5 }}>{children}</span>
  );

  return (
    <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        className="db-track-pulse inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md min-w-0"
        style={{ background: V.askWash, border: `1px solid ${V.askLine}`, color: V.ask, maxWidth: 250, ...font }}
      >
        <NewIcon size={11} className="shrink-0" /> <span className="truncate">{nudge}</span> <ChevronDown size={11} className="shrink-0" style={{ opacity: 0.7 }} />
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={(e) => { e.stopPropagation(); close(); }} />
          <div
            className="db-track-pop-in rounded-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ position: 'fixed', top: pos.top, left: pos.left, right: pos.right, zIndex: 9999, width: pos.left === undefined ? 'min(94vw, 430px)' : undefined, background: V.surface, border: `1px solid ${V.line}`, boxShadow: '0 24px 60px rgba(30,26,21,0.22)' }}
          >
            {done ? (
              <div className="px-6 py-10 text-center">
                <span className="inline-flex items-center justify-center w-12 h-12 rounded-full db-track-pop" style={{ background: V.sageWash }}>
                  <Check size={24} style={{ color: '#2F5D34' }} strokeWidth={3} />
                </span>
                <p className="mt-3.5 db-track-rise" style={{ color: '#2F5D34', ...serif, fontSize: 18, animationDelay: '.2s' }}>{done.title}</p>
                <p className="mt-1 db-track-rise" style={{ color: V.faint, ...font, fontSize: 12, lineHeight: 1.5, animationDelay: '.34s' }}>{done.sub}</p>
              </div>
            ) : (
              <>
                {/* header */}
                <div className="px-5 pt-5 pb-4">
                  <p style={{ color: V.ink, ...serif, fontSize: 21, lineHeight: 1.15 }}>{nudge}</p>
                  <p className="mt-0.5" style={{ color: V.faint, ...font, fontSize: 12.5 }}>{nudgeTe}</p>
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    <Pill>{payee}</Pill>
                    <Pill>{inr(amount)}</Pill>
                    {projectName && <Pill>{projectName}</Pill>}
                  </div>
                </div>

                <div style={{ maxHeight: '62vh', overflowY: 'auto', borderTop: `1px solid ${V.line}` }}>
                  {/* NEW — the elegant one-tap create */}
                  <div className="m-3.5 rounded-xl p-3.5" style={{ background: V.terraWash, border: `1px solid ${V.askLine}` }}>
                    <p className="uppercase" style={{ color: V.terra, ...font, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}>New {noun}</p>
                    <p className="mt-2 mb-2.5" style={{ color: V.sys, ...font, fontSize: 12, lineHeight: 1.55 }}>
                      {kind === 'WO'
                        ? <>A <span style={{ fontWeight: 600, color: V.ink }}>job</span> is {payee}'s task with a scope and budget — tie payments to it to see what's paid, what's still due, and never overpay.</>
                        : <>An <span style={{ fontWeight: 600, color: V.ink }}>order</span> is your purchase from {payee} — tie payments to it to see how much is paid vs still owed, even across part-payments.</>}
                      {spend && spend.count > 0 && (
                        <span style={{ color: V.faint }}> {inr(spend.total)} across {spend.count} here isn't tracked yet.</span>
                      )}
                    </p>

                    {/* the essentials — editable, not blind */}
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg shrink-0" style={{ background: V.surface, border: `1px solid ${V.askLine}` }}>
                        <NewIcon size={16} style={{ color: V.terraDeep }} />
                      </span>
                      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={suggested} className="bk-track-title" />
                    </div>
                    <label className="block mt-2.5">
                      <span style={{ color: V.faint, ...font, fontSize: 10.5 }}>{kind === 'WO' ? 'Total job cost' : 'Order value'}</span>
                      <div className="bk-track-field mt-1">
                        <span style={{ color: V.faint, ...font }}>₹</span>
                        <input value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder={`e.g. ${amount.toLocaleString('en-IN')}`} className="bk-track-in" />
                      </div>
                    </label>
                    {kind === 'WO' && (
                      <>
                        <label className="flex items-center gap-2 mt-2.5" style={{ color: V.sys, ...font, fontSize: 12 }}>
                          <input type="checkbox" checked={hasPhases} onChange={(e) => setHasPhases(e.target.checked)} /> Pay it in phases?
                        </label>
                        {hasPhases && (
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <div className="bk-track-field"><input value={phName} onChange={(e) => setPhName(e.target.value)} placeholder="First phase" className="bk-track-in" /></div>
                            <div className="bk-track-field"><span style={{ color: V.faint, ...font }}>₹</span><input value={phAmt} onChange={(e) => setPhAmt(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="amount" className="bk-track-in" /></div>
                          </div>
                        )}
                      </>
                    )}

                    <button
                      type="button"
                      onClick={kind === 'WO' ? createJob : createOrder}
                      disabled={busy}
                      className="w-full mt-3 py-2.5 rounded-xl"
                      style={{ background: terraGrad, color: '#fff', ...font, fontSize: 14, fontWeight: 600, opacity: busy ? 0.6 : 1 }}
                    >
                      {busy ? 'Working…' : `Create & track this ${noun}`}
                    </button>
                    {err && <p className="mt-2" style={{ color: V.terra, ...font, fontSize: 11.5, lineHeight: 1.4 }}>{err}</p>}
                  </div>

                  {/* OR — existing */}
                  {(isLoading || rows.length > 0) && (
                    <div className="flex items-center gap-3 px-5 pb-1">
                      <span className="flex-1" style={{ borderTop: `1px solid ${V.line}` }} />
                      <span className="uppercase" style={{ color: V.faint, ...font, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em' }}>Or track under existing</span>
                      <span className="flex-1" style={{ borderTop: `1px solid ${V.line}` }} />
                    </div>
                  )}
                  {isLoading && <p className="px-5 py-3" style={{ color: V.faint, ...font, fontSize: 12 }}>Looking…</p>}

                  {kind === 'WO' && rows.map((w: any) => {
                    const phases = (w.wo_milestones ?? []).slice().sort((a: any, b: any) => (a.seq_no || 0) - (b.seq_no || 0));
                    const isOpen = expanded === w.wo_id;
                    const hasPhases = phases.length > 0;
                    return (
                      <div key={w.wo_id}>
                        <button type="button" onClick={() => hasPhases ? setExpanded(isOpen ? null : w.wo_id) : attach(w.wo_id, null, w.scope_of_work || 'the job')} disabled={busy} className="w-full text-left px-5 py-3 flex items-center gap-3 hover:bg-black/[0.02]">
                          <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg shrink-0" style={{ background: V.field }}><Hammer size={15} style={{ color: V.sys }} /></span>
                          <span className="flex-1 min-w-0">
                            <span className="block truncate" style={{ color: V.ink, ...font, fontSize: 14, fontWeight: 500 }}>{w.scope_of_work || 'Job'}</span>
                            <span className="block truncate" style={{ color: V.faint, ...font, ...nums, fontSize: 12 }}>Work{projectName ? ` · ${projectName}` : ''} · {inrShort(paidFor(w.wo_id))} so far</span>
                          </span>
                          {hasPhases ? (isOpen ? <ChevronDown size={16} style={{ color: V.faint }} /> : <ChevronRight size={16} style={{ color: V.faint }} />) : <ChevronRight size={16} style={{ color: V.faint }} />}
                        </button>
                        {isOpen && phases.map((m: any) => {
                          const left = Math.max(0, Number(m.planned_amount || 0) - paidFor(w.wo_id, m.milestone_id));
                          return (
                            <button type="button" key={m.milestone_id} onClick={() => attach(w.wo_id, m.milestone_id, m.name || 'phase')} disabled={busy} className="w-full text-left pl-[68px] pr-5 py-2.5 flex items-center gap-2 hover:bg-black/[0.02]">
                              <span className="flex-1 min-w-0">
                                <span className="block truncate" style={{ color: V.inkSoft, ...font, fontSize: 13 }}>{m.name || `Phase ${m.seq_no}`}</span>
                                <span className="block" style={{ color: V.faint, ...font, ...nums, fontSize: 11 }}>{inrShort(left)} left of {inrShort(m.planned_amount)}</span>
                              </span>
                              <Plus size={14} style={{ color: '#2F5D34' }} />
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}

                  {kind === 'PO' && rows.map((p: any) => {
                    const commit = Number(p.total_value || p.order_value || p.vendor_bill_amount || 0);
                    return (
                      <button type="button" key={p.po_id} onClick={() => attach(p.po_id, null, p.po_id)} disabled={busy} className="w-full text-left px-5 py-3 flex items-center gap-3 hover:bg-black/[0.02]">
                        <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg shrink-0" style={{ background: V.field }}><Package size={15} style={{ color: V.sys }} /></span>
                        <span className="flex-1 min-w-0">
                          <span className="block truncate" style={{ color: V.ink, ...font, fontSize: 14, fontWeight: 500 }}>{p.po_id}</span>
                          <span className="block truncate" style={{ color: V.faint, ...font, ...nums, fontSize: 12 }}>Order{projectName ? ` · ${projectName}` : ''} · {inrShort(commit)} so far</span>
                        </span>
                        <ChevronRight size={16} style={{ color: V.faint }} />
                      </button>
                    );
                  })}

                  <button type="button" onClick={close} className="w-full py-3.5 text-center" style={{ color: V.faint, ...font, fontSize: 12.5 }}>Skip for now</button>
                </div>
              </>
            )}
          </div>
        </>,
        document.body,
      )}
    </span>
  );
}

export const TRACK_CHIP_CSS = `
@keyframes dbTrackPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(188,75,39,0.0); } 50% { box-shadow: 0 0 0 3px rgba(188,75,39,0.10); } }
.db-track-pulse { animation: dbTrackPulse 3.4s ease-in-out infinite; }
.db-track-pulse:hover { animation: none; background: ${V.terraWash} !important; }
@keyframes dbTrackPopIn { from { opacity: 0; transform: translateY(-8px) scale(.97); } to { opacity: 1; transform: none; } }
.db-track-pop-in { animation: dbTrackPopIn .28s cubic-bezier(.2,.8,.2,1) both; transform-origin: top right; }
@keyframes dbTrackPop { 0% { opacity: 0; transform: scale(0); } 55% { opacity: 1; transform: scale(1.12); } 100% { transform: scale(1); } }
.db-track-pop { animation: dbTrackPop .6s cubic-bezier(.2,.9,.3,1.25) both; }
@keyframes dbTrackRise { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: none; } }
.db-track-rise { animation: dbTrackRise .55s ease both; }
.bk-track-title { flex: 1; min-width: 0; background: transparent; border: 0; outline: none; color: ${V.ink}; font-size: 16px; font-weight: 600; }
.bk-track-field { display: flex; align-items: center; gap: 6px; background: ${V.surface}; border: 1px solid ${V.askLine}; border-radius: 10px; padding: 7px 10px; }
.bk-track-in { flex: 1; min-width: 0; background: transparent; border: 0; outline: none; color: ${V.ink}; font-size: 16px; }
`;
