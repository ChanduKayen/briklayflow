/**
 * TrackChip — the gentle nudge that gets a payment attributed to a trackable
 * structure (a job = work order, or an order = purchase order). Tap the chip to
 * open an elegant panel: create a new one in a tap (a Draft you refine in Jobs),
 * or track it under an existing job/order. Scoped to the row's "not linked" slot.
 */
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { Hammer, Package, ChevronRight, ChevronDown, ChevronUp, Check, Plus, HelpCircle, Receipt, Wallet, Lightbulb, Clock } from 'lucide-react';

// A draft / unapproved order can't take a payment yet — shown faded, tagged "Awaiting
// approval", and not selectable until it's approved.
const isAwaiting = (s: any) => /draft|pending|await/i.test(String(s || ''));
import { V, font, serif, nums, terraGrad } from './ledgerTokens';
import { WhyTrackModal } from './WhyTrack';
import { ContractHub, CONTRACT_HUB_CSS } from './ContractHub';

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const inrShort = (n: number) => {
  const v = Number(n || 0);
  if (v >= 100000) return '₹' + (v / 100000).toFixed(v % 100000 === 0 ? 0 : 1) + 'L';
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
};
type Kind = 'WO' | 'PO';

export function TrackChip({ txn, onLinked }: { txn: any; onLinked: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [done, setDone] = useState<{ title: string; sub: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showWhy, setShowWhy] = useState(false);
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
  const amount = Number(txn.total_amount) || 0;

  const noun = kind === 'PO' ? 'order' : 'job';
  const nudge = kind === 'PO' ? 'Are you tracking this purchase?' : 'Are you tracking this job?';
  const NewIcon = kind === 'PO' ? Package : Hammer;

  // Creation happens on the full PO/WO page — not inline. The button morphs to a
  // gentle "taking you there…" while we navigate, carrying the payment's context.
  const [navigating, setNavigating] = useState(false);
  // The "New …" card collapses to one line when existing orders are available (attach
  // is the likely intent); it opens fully when there's nothing to track under yet.
  const [createOpen, setCreateOpen] = useState<boolean | null>(null);

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
  const close = () => { setOpen(false); setExpanded(null); setShowWhy(false); };

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
  const { data, isLoading, error: loadErr } = useQuery({
    queryKey: ['track', kind, projectId, stakeholderId],
    enabled: open && !!projectId && !!stakeholderId,
    // Always re-read when the panel opens — a job/order just created on the full page
    // must show up immediately, not only after a hard refresh.
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      if (kind === 'WO') {
        // Fetch the WOs WITHOUT embedding milestones — an embed that fails (relationship
        // / RLS) would null the whole query and silently hide every job. Milestones are
        // pulled separately and grafted on; if THAT fails, jobs still show (attach at WO level).
        const { data: wos, error: woErr } = await supabase.from('work_orders')
          .select('wo_id, scope_of_work, order_value, status')
          .eq('project_id', projectId).eq('stakeholder_id', stakeholderId)
          .not('status', 'in', '("Closed","Cancelled")').order('date_issued', { ascending: false });
        if (woErr) throw woErr;
        const ids = (wos ?? []).map((w: any) => w.wo_id);
        const { data: ms } = ids.length
          ? await supabase.from('wo_milestones').select('wo_id, milestone_id, name, seq_no, planned_amount').in('wo_id', ids)
          : { data: [] as any[] };
        const byWo: Record<string, any[]> = {};
        (ms ?? []).forEach((m: any) => { (byWo[m.wo_id] ||= []).push(m); });
        const rows = (wos ?? []).map((w: any) => ({ ...w, wo_milestones: byWo[w.wo_id] ?? [] }));
        const { data: paid } = ids.length
          ? await supabase.from('txn_allocations').select('order_ref, milestone_id, allocated_amount').eq('order_type', 'WO').in('order_ref', ids)
          : { data: [] as any[] };
        return { rows, paid: paid ?? [] };
      }
      const { data: pos } = await supabase.from('purchase_orders')
        .select('po_id, status, order_value, total_value, vendor_bill_amount')
        .eq('project_id', projectId).eq('stakeholder_id', stakeholderId)
        .not('status', 'in', '("CANCELLED","Cancelled","cancelled")').order('created_at', { ascending: false });
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

  // Why an order can't take this payment yet: it's still a draft (awaiting approval),
  // or it's approved but no vendor bill has been entered (you can't pay against nothing).
  // A job (WO) has no bill stage, so only the approval gate applies.
  const blockReason = (r: any): null | 'approval' | 'bill' => {
    if (isAwaiting(r.status)) return 'approval';
    if (kind === 'PO') {
      const hasBill = /billed|partial/i.test(String(r.status || '')) || Number(r.vendor_bill_amount || 0) > 0;
      if (!hasBill) return 'bill';
    }
    return null;
  };
  // Eligible orders first, the faded blocked ones after.
  const rows = [...(data?.rows ?? [])].sort((a: any, b: any) => Number(!!blockReason(a)) - Number(!!blockReason(b)));
  // Expanded by default only when there's nothing to track under yet; user toggle wins.
  const showCreate = createOpen ?? (!isLoading && rows.length === 0);
  const collapsedLine = kind === 'PO'
    ? 'Create a Purchase order — track bills, materials, payments for this order'
    : `Create a Job (Work Order) for ${payee}${projectName ? ` in ${projectName}` : ''} with its own scope, milestones and budgets`;

  // A faded tag shown in place of the chevron for orders that can't take the payment yet.
  const AwaitingTag = ({ reason }: { reason: 'approval' | 'bill' }) => (
    <span className="inline-flex items-center gap-1 shrink-0" style={{ color: V.faint, ...font, fontSize: 10.5, fontWeight: 600 }}>
      {reason === 'bill' ? <Receipt size={11} /> : <Clock size={11} />} {reason === 'bill' ? 'Awaiting bill entry' : 'Awaiting approval'}
    </span>
  );

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

  // No inline creation — hand off to the full PO/WO page with this payment's
  // context (project + party + the originating txn, so that page can link the
  // payment back once the order is saved). A short morph makes the jump feel calm.
  const goCreate = () => {
    if (navigating) return;
    setNavigating(true);
    const path = kind === 'PO' ? '/purchase-orders/new' : '/work-orders/new';
    // Where Back / Save should return to: the ledger with THIS payment's row focused
    // (?txn=… scrolls to and rings it), so the breadcrumb reads Ledger → New … → back
    // to the exact row that started it — not the project-level list.
    const params = new URLSearchParams(window.location.search);
    params.set('txn', txn.txn_id);
    const here = `${window.location.pathname}?${params.toString()}`;
    const state = {
      projectId: projectId ?? undefined,
      stakeholderId: stakeholderId ?? undefined,
      returnTo: here,
      returnLabel: 'Ledger',
      fromTxn: { txnId: txn.txn_id, allocationId: allocId, amount, payeeName: payee },
    };
    setTimeout(() => navigate(path, { state }), 700);
  };

  // A small capability row for the purchase-order explainer (materials · bills · quotes).
  const Cap = ({ icon: Icon, children }: { icon: typeof Package; children: React.ReactNode }) => (
    <div className="flex items-start gap-2" style={{ color: V.sys, ...font, fontSize: 12, lineHeight: 1.45 }}>
      <Icon size={13} style={{ color: V.terraDeep, marginTop: 1 }} className="shrink-0" />
      <span>{children}</span>
    </div>
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
            style={{ position: 'fixed', top: pos.top, left: pos.left, right: pos.right, zIndex: 9999, width: pos.left === undefined ? (kind === 'WO' ? 'min(94vw, 480px)' : 'min(94vw, 430px)') : undefined, maxHeight: kind === 'WO' ? '85vh' : undefined, overflowY: kind === 'WO' ? 'auto' : undefined, background: V.surface, border: `1px solid ${V.line}`, boxShadow: '0 24px 60px rgba(30,26,21,0.22)' }}
          >
            {/* WORKER (Work Order) → the new contract hub; VENDOR (PO) keeps the existing panel.
                Cast avoids narrowing `kind` to 'PO' in the untouched else branch below. */}
            {(kind as string) === 'WO' ? (
              <ContractHub txn={txn} onClose={close} onLinked={onLinked} />
            ) : done ? (
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
                  <div className="flex items-start justify-between gap-3">
                    <p style={{ color: V.ink, ...serif, fontSize: 21, lineHeight: 1.15 }}>{nudge}</p>
                    <button type="button" onClick={() => setShowWhy(true)} className="shrink-0 inline-flex items-center gap-1 mt-1" style={{ color: V.terraDeep, ...font, fontSize: 11.5, fontWeight: 600 }}>
                      <HelpCircle size={12} /> Why track?
                    </button>
                  </div>
                </div>

                <div style={{ maxHeight: '62vh', overflowY: 'auto', borderTop: `1px solid ${V.line}` }}>
                  {/* NEW — collapses to one line when existing orders are available */}
                  <div className="m-3.5 rounded-xl p-3.5" style={{ background: V.terraWash, border: `1px solid ${V.askLine}` }}>
                    <button type="button" onClick={() => setCreateOpen(!showCreate)} className="w-full flex items-start justify-between gap-3 text-left">
                      <span className="min-w-0">
                        <span className="uppercase block" style={{ color: V.terra, ...font, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}>New {noun}</span>
                        {!showCreate && <span className="block mt-1" style={{ color: V.sys, ...font, fontSize: 12, lineHeight: 1.4 }}>{collapsedLine}</span>}
                      </span>
                      {showCreate
                        ? <ChevronUp size={16} className="shrink-0" style={{ color: V.faint, marginTop: 1 }} />
                        : <ChevronDown size={16} className="shrink-0" style={{ color: V.faint, marginTop: 1 }} />}
                    </button>

                    {showCreate && (
                      <div className="mt-2">
                        {kind === 'WO' ? (
                          <p style={{ color: V.sys, ...font, fontSize: 12, lineHeight: 1.55 }}>
                            Create a <span style={{ fontWeight: 600, color: V.ink }}>Job</span> <span style={{ color: V.faint }}>(Work Order)</span> for {payee}{projectName && <> in {projectName}</>} with its own scope, milestones and budgets.
                          </p>
                        ) : (
                          <>
                            <p className="mb-2" style={{ color: V.sys, ...font, fontSize: 12, lineHeight: 1.5 }}>
                              You've already paid {payee}, so a bill exists. A <span style={{ fontWeight: 600, color: V.ink }}>purchase order</span> keeps the whole buy in one place:
                            </p>
                            <div className="grid gap-1.5">
                              <Cap icon={Receipt}>Attach bills for this order — our AI auto-verifies them like an accountant</Cap>
                              <Cap icon={Package}>Track material delivery for this order</Cap>
                              <Cap icon={Wallet}>Group multiple payments under one order &amp; scope</Cap>
                            </div>
                            <p className="mt-2.5 flex items-start gap-1.5" style={{ color: V.faint, ...font, fontSize: 11, lineHeight: 1.45, fontStyle: 'italic' }}>
                              <Lightbulb size={12} style={{ color: V.terraDeep, marginTop: 1 }} className="shrink-0" />
                              <span><span style={{ fontWeight: 600, fontStyle: 'normal', color: V.sys }}>Tip:</span> next time, create the purchase order before you pay — so you can compare quotes from vendors.</span>
                            </p>
                          </>
                        )}
                        {spend && spend.count > 0 && (
                          <p className="mt-2" style={{ color: V.faint, ...font, fontSize: 11.5, lineHeight: 1.5 }}>{inr(spend.total)} across {spend.count} payment{spend.count > 1 ? 's' : ''} here isn't tracked yet.</p>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={goCreate}
                      disabled={navigating}
                      className="w-full mt-3 py-2.5 rounded-xl"
                      style={{ background: terraGrad, color: '#fff', ...font, fontSize: 14, fontWeight: 600, opacity: navigating ? 0.92 : 1, transition: 'opacity .3s ease' }}
                    >
                      {navigating ? (
                        <span className="inline-flex items-center justify-center gap-2 db-track-fade">
                          <span className="db-track-spin" style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.35)', borderTopColor: '#fff', display: 'inline-block' }} />
                          Taking you to the {kind === 'PO' ? 'purchase order' : 'work order'} page…
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center gap-2">
                          <NewIcon size={15} /> Create a new {kind === 'PO' ? 'purchase order' : 'work order'}
                        </span>
                      )}
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
                  {loadErr && <p className="px-5 py-3" style={{ color: V.terra, ...font, fontSize: 11.5, lineHeight: 1.4 }}>Couldn't load existing {kind === 'PO' ? 'orders' : 'jobs'} — {(loadErr as any)?.message || 'try again'}</p>}

                  {kind === 'WO' && rows.map((w: any) => {
                    const phases = (w.wo_milestones ?? []).slice().sort((a: any, b: any) => (a.seq_no || 0) - (b.seq_no || 0));
                    const isOpen = expanded === w.wo_id;
                    const hasPhases = phases.length > 0;
                    const block = blockReason(w);
                    return (
                      <div key={w.wo_id}>
                        <button type="button" onClick={() => { if (block) return; hasPhases ? setExpanded(isOpen ? null : w.wo_id) : attach(w.wo_id, null, w.scope_of_work || 'the job'); }} disabled={busy || !!block} className="w-full text-left px-5 py-3 flex items-center gap-3 hover:bg-black/[0.02] disabled:hover:bg-transparent" style={{ opacity: block ? 0.5 : 1, cursor: block ? 'default' : undefined }}>
                          <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg shrink-0" style={{ background: V.field }}><Hammer size={15} style={{ color: V.sys }} /></span>
                          <span className="flex-1 min-w-0">
                            <span className="block truncate" style={{ color: V.ink, ...font, fontSize: 14, fontWeight: 500 }}>{w.scope_of_work || 'Job'}</span>
                            <span className="block truncate" style={{ color: V.faint, ...font, ...nums, fontSize: 12 }}>Work{projectName ? ` · ${projectName}` : ''} · {inrShort(paidFor(w.wo_id))} so far</span>
                          </span>
                          {block ? <AwaitingTag reason={block} /> : hasPhases ? (isOpen ? <ChevronDown size={16} style={{ color: V.faint }} /> : <ChevronRight size={16} style={{ color: V.faint }} />) : <ChevronRight size={16} style={{ color: V.faint }} />}
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
                    const st = p.status ? String(p.status).charAt(0).toUpperCase() + String(p.status).slice(1).toLowerCase() : 'Order';
                    const block = blockReason(p);
                    return (
                      <button type="button" key={p.po_id} onClick={() => { if (!block) attach(p.po_id, null, p.po_id); }} disabled={busy || !!block} className="w-full text-left px-5 py-3 flex items-center gap-3 hover:bg-black/[0.02] disabled:hover:bg-transparent" style={{ opacity: block ? 0.5 : 1, cursor: block ? 'default' : undefined }}>
                        <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg shrink-0" style={{ background: V.field }}><Package size={15} style={{ color: V.sys }} /></span>
                        <span className="flex-1 min-w-0">
                          <span className="block truncate" style={{ color: V.ink, ...font, fontSize: 14, fontWeight: 500 }}>{p.po_id}</span>
                          <span className="block truncate" style={{ color: V.faint, ...font, ...nums, fontSize: 12 }}>{st}{projectName ? ` · ${projectName}` : ''}{commit ? ` · ${inrShort(commit)} order` : ''}</span>
                        </span>
                        {block ? <AwaitingTag reason={block} /> : <ChevronRight size={16} style={{ color: V.faint }} />}
                      </button>
                    );
                  })}

                  <button type="button" onClick={close} className="w-full py-3.5 text-center" style={{ color: V.faint, ...font, fontSize: 12.5 }}>Skip for now</button>
                </div>
              </>
            )}
          </div>
          {showWhy && <WhyTrackModal kind={kind} onClose={() => setShowWhy(false)} />}
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
@keyframes dbTrackSpin { to { transform: rotate(360deg); } }
.db-track-spin { animation: dbTrackSpin .7s linear infinite; }
@keyframes dbTrackFade { from { opacity: 0; } to { opacity: 1; } }
.db-track-fade { animation: dbTrackFade .3s ease both; }
.bk-track-title { flex: 1; min-width: 0; background: transparent; border: 0; outline: none; color: ${V.ink}; font-size: 16px; font-weight: 600; }
.bk-track-field { display: flex; align-items: center; gap: 6px; background: ${V.surface}; border: 1px solid ${V.askLine}; border-radius: 10px; padding: 7px 10px; }
.bk-track-in { flex: 1; min-width: 0; background: transparent; border: 0; outline: none; color: ${V.ink}; font-size: 16px; }
` + CONTRACT_HUB_CSS;
