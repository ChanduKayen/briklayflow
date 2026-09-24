// Mobile Contract (Work Order) DETAIL — an exact port of the contracts-mobile reference, wired to real
// data. Mirrors WorkOrderDetail's reads (['wo'], ['wo_wage_settled'], ['wo_allocations']) and derivation
// (stage rows, payment groups, activity), and wires the reference's flows to the real, sanctioned ones:
//   • Release payment → insert_transaction_with_allocations (a real worker payment, allocated to stages)
//   • Link            → linkPaymentToContract (attach an already-recorded payment)
//   • Re-adjust       → adjustContractPayment (place an open advance onto stages + certify)
//   • Close / Reopen  → work_orders.status
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { useUserProfile } from '../../App';
import { useOrgId } from '../../lib/auth/AuthProvider';
import { wagesSetAgainstContract } from '../../lib/attendanceApi';
import { loadContractLinkablePayments, linkPaymentToContract, adjustContractPayment } from '../../lib/payableAttribution';
import type { LinkablePayment } from '../../lib/billsApi';
import { CONTRACTS_MOBILE_CSS } from './contractsMobileCss';

function inr(n: number) { const s = String(Math.round(Math.abs(n))); if (s.length <= 3) return s; return s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3); }
const rs = (n: number) => '₹' + inr(Math.round(n));
const MS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
const D = (v: string | null) => v ? new Date(v) : null;
const fD = (d: Date) => `${d.getDate()} ${MS[d.getMonth()]} ${d.getFullYear()}`;
const fT = (d: Date) => `${d.getDate()} ${MS[d.getMonth()]} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const SETTLE_TOL = 50;
const DONE_STATUSES = new Set(['Completed', 'Approved', 'Paid']);
const clean = (s: string | null | undefined) => { const t = (s ?? '').trim(); return /^(n\/?a|none|nil|-)$/i.test(t) ? '' : t; };

interface StageRow { id: string | null; name: string; note: string; agreed: number; paid: number; bal: number; done: boolean; estP: number; measured: boolean; measText: string }
interface PayGroup { txnId: string; date: string | null; mode: string; note: string; total: number; open: number; byMs: Record<string, number> }

export default function ContractMobileDetail({ session }: { session: Session }) {
  const { woId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const orgId = useOrgId();
  const { data: profile } = useUserProfile(session.user.id);
  const [toastMsg, setToastMsg] = useState('');
  const toast = (m: string) => { setToastMsg(m); window.clearTimeout((toast as any)._t); (toast as any)._t = window.setTimeout(() => setToastMsg(''), 2600); };
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', h, { passive: true });
    return () => window.removeEventListener('scroll', h);
  }, []);
  const [showAll, setShowAll] = useState(false);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | 'release' | 'menu' | 'link' | { adjust: PayGroup }>(null);

  const { data: wo, isLoading } = useQuery({
    queryKey: ['wo', woId],
    enabled: !!woId,
    queryFn: async () => (await supabase.from('work_orders')
      .select('*, projects(name, site_location), stakeholders(name, category, contact), wo_milestones(*)')
      .eq('wo_id', woId).single()).data as any,
  });
  const { data: wage } = useQuery({
    queryKey: ['wo_wage_settled', woId],
    enabled: !!woId,
    queryFn: () => wagesSetAgainstContract(woId as string),
  });
  const { data: allocs = [] } = useQuery({
    queryKey: ['wo_allocations', woId],
    enabled: !!woId,
    queryFn: async () => {
      const { data } = await supabase.from('txn_allocations')
        .select('*, transactions(txn_id, date, status, total_amount, payment_mode, category, remarks)')
        .eq('order_type', 'WO').eq('order_ref', woId);
      return (data ?? []).filter((a: any) => a.transactions?.status !== 'Voided');
    },
  });

  const settledByMs: Record<string, number> = (wage as any)?.byMilestone ?? {};
  const settledTotal: number = (wage as any)?.total ?? 0;

  const model = useMemo(() => {
    if (!wo) return null;
    const orderValue = Number(wo.order_value || 0);
    const ms = [...(wo.wo_milestones ?? [])].sort((a: any, b: any) => (a.seq_no || 0) - (b.seq_no || 0));
    const milestonePayments: Record<string, number> = {};
    let totalPaid = 0;
    (allocs as any[]).forEach((a) => { totalPaid += Number(a.allocated_amount || 0); if (a.milestone_id) milestonePayments[a.milestone_id] = (milestonePayments[a.milestone_id] || 0) + Number(a.allocated_amount || 0); });
    const balance = orderValue - totalPaid;
    const sumPlanned = ms.reduce((t: number, m: any) => t + Number(m.planned_amount || 0), 0);
    const singlePhase = ms.length === 1 && Number(ms[0].planned_amount || 0) < 1 && orderValue > 0;

    let rows: StageRow[] = ms.map((m: any) => {
      const agreed = singlePhase ? orderValue : Number(m.planned_amount || 0);
      const paid = milestonePayments[m.milestone_id] || 0;
      const settled = settledByMs[m.milestone_id] || 0;
      const bal = agreed - paid;
      const workDone = DONE_STATUSES.has(m.status);
      const estP = agreed > 0 ? (workDone ? 1 : Math.min(1, Math.max(paid, settled) / agreed)) : 0;
      const measured = !!m.unit_type && m.unit_type !== 'LS';
      const measText = measured ? `${m.quantity ?? ''} ${m.unit_type} × ${rs(Number(m.rate || 0))}` : 'Lump sum';
      return { id: m.milestone_id, name: m.name || 'Stage', note: clean(m.trigger_condition) || clean(m.description), agreed, paid, bal, done: bal <= SETTLE_TOL && agreed > 0, estP, measured, measText };
    });
    // No milestones but a value → one synthetic "Full contract" row (advances land with milestone_id null).
    if (rows.length === 0 && orderValue > 0) {
      const paid = totalPaid;
      rows = [{ id: null, name: 'Full contract', note: '', agreed: orderValue, paid, bal: orderValue - paid, done: orderValue - paid <= SETTLE_TOL, estP: Math.min(1, paid / orderValue), measured: false, measText: 'Lump sum' }];
    }
    const workDoneEst = rows.reduce((t, s) => t + s.estP * s.agreed, 0);
    const workAhead = workDoneEst - totalPaid;

    // Payments grouped per transaction.
    const byTxn: Record<string, PayGroup> = {};
    (allocs as any[]).forEach((a) => {
      const t = a.transactions; if (!t) return;
      const g = byTxn[t.txn_id] ??= { txnId: t.txn_id, date: t.date, mode: t.payment_mode || '', note: clean(t.remarks), total: 0, open: 0, byMs: {} };
      const amt = Number(a.allocated_amount || 0); g.total += amt;
      if (a.milestone_id) g.byMs[a.milestone_id] = (g.byMs[a.milestone_id] || 0) + amt; else g.open += amt;
    });
    const payGroups = Object.values(byTxn).sort((a, b) => (D(b.date)?.getTime() || 0) - (D(a.date)?.getTime() || 0));

    // Activity timeline.
    const act: { at: Date; who: string; what: string }[] = [];
    if (wo.created_at) act.push({ at: new Date(wo.created_at), who: '', what: `created this contract · ${ms.length || 1} stage${ms.length === 1 ? '' : 's'} ${rs(orderValue)}` });
    (wo.status_history ?? []).forEach((h: any) => { if (h?.at) act.push({ at: new Date(h.at), who: h.by || '', what: `marked ${String(h.status || '').toLowerCase()}` }); });
    payGroups.forEach((g) => { const names = Object.keys(g.byMs).map((mid) => rows.find((r) => r.id === mid)?.name).filter(Boolean); if (g.date) act.push({ at: new Date(g.date), who: '', what: `released ${rs(g.total)}${names.length ? ' against ' + names.slice(0, 2).join(', ') : ''}` }); });
    act.sort((a, b) => b.at.getTime() - a.at.getTime());

    const closed = wo.status === 'Closed' || wo.status === 'Cancelled';
    const st: 'progress' | 'new' | 'closed' = closed ? 'closed' : (totalPaid > 0 || workDoneEst > 0) ? 'progress' : 'new';
    return { orderValue, rows, totalPaid, balance, workDoneEst, workAhead, payGroups, act, closed, singlePhase, sumPlanned, st };
  }, [wo, allocs, settledByMs]);

  const refreshMoney = () => {
    ['wo_allocations', 'wo_wage_settled'].forEach((k) => qc.invalidateQueries({ queryKey: [k, woId] }));
    qc.invalidateQueries({ queryKey: ['wo', woId] });
    ['cm_wo_paid', 'cm_wo_head', 'transactions', 'party_ledger'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    if (wo?.stakeholder_id) qc.invalidateQueries({ queryKey: ['stakeholder_txns', wo.stakeholder_id] });
  };

  const canAct = profile?.role === 'management' || profile?.role === 'principal' || profile?.role === 'accountant';
  const isDraft = wo?.status === 'Draft';
  const releasable = !!model && !model.closed && !isDraft && canAct;

  const approve = useMutation({
    mutationFn: async () => {
      const hist = [...(wo.status_history ?? []), { status: 'Assigned', at: new Date().toISOString(), by: session.user.id }];
      const { error } = await supabase.from('work_orders').update({ status: 'Assigned', status_history: hist }).eq('wo_id', woId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['wo', woId] }); qc.invalidateQueries({ queryKey: ['cm_wo_head'] }); toast('Contract approved — releases are open'); },
    onError: (e) => toast((e as Error).message || 'Could not approve'),
  });

  if (isLoading || !model || !wo) {
    return <div className="cmx"><style>{CONTRACTS_MOBILE_CSS}</style><section className="view v-detail"><div className="empty">Loading…</div></section></div>;
  }

  const m = model;
  const gap = m.workDoneEst - m.totalPaid; const tol = m.orderValue * 0.02;
  let note: { cls: string; text: React.ReactNode };
  if (m.closed) note = { cls: 'ok', text: <>Contract closed{m.balance > SETTLE_TOL ? ` with ${rs(m.balance)} unpaid` : ' and fully settled'}.</> };
  else if (!m.totalPaid && !m.workDoneEst) note = { cls: 'warn', text: 'No work or payments yet.' };
  else if (Math.abs(gap) <= tol) note = { cls: 'ok', text: 'Payments are in step with work done.' };
  else if (gap < 0) note = { cls: 'warn', text: <>Paid <b>{rs(-gap)}</b> ahead of work done — treat it as an advance.</> };
  else note = { cls: 'due', text: <><b>{rs(gap)}</b> of finished work isn’t paid yet.</> };
  const stages = showAll ? m.rows : m.rows.slice(0, 4);
  const worker = wo.stakeholders?.name || 'Worker';
  const trade = wo.stakeholders?.category || '';
  const siteName = wo.projects?.name || '';
  const start = D(wo.date_issued) || D(wo.created_at);

  return (
    <div className="cmx">
      <style>{CONTRACTS_MOBILE_CSS}</style>
      <section className="view v-detail">
        <div className={`appbar ${scrolled ? 'scrolled' : ''}`}>
          <button className="icon-btn" aria-label="Back to contracts" onClick={() => navigate('/work-orders')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <span className="ab-title">{worker} · <span className="mono">{wo.wo_id}</span></span>
          <button className="icon-btn" aria-label="More actions" onClick={() => setSheet('menu')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
          </button>
        </div>

        <div className="d-hero">
          <div className="crumb"><span>{wo.wo_id}</span></div>
          <h1 className="d-name">{worker}{trade ? <span className="d-trade">{trade}</span> : null}</h1>
          <div className="d-meta"><b>{siteName}</b>{start ? ` · started ${fD(start)}` : ''}</div>
          <div style={{ marginTop: 10 }}><StatusPill st={m.st} /></div>
          {clean(wo.scope_of_work) ? <p className="d-scope"><span>Scope</span>{clean(wo.scope_of_work)}</p> : null}
        </div>

        <div className="money">
          <div className="m-row">
            <div><div className="eyebrow">{m.balance > SETTLE_TOL ? 'Outstanding' : 'Fully paid'}</div><div className={`m-big ${m.balance > SETTLE_TOL ? '' : 'zero'}`}>{rs(Math.max(0, m.balance))}</div></div>
            <div className="m-agreed"><div className="eyebrow">Agreed</div><span className="mono">{rs(m.orderValue)}</span></div>
          </div>
          <div className="bar"><i className="done" style={{ width: `${m.orderValue ? Math.min(100, m.workDoneEst / m.orderValue * 100) : 0}%` }} /><i className="paid" style={{ width: `${m.orderValue ? Math.min(100, m.totalPaid / m.orderValue * 100) : 0}%` }} /></div>
          <div className="m-leg">
            <div><i style={{ background: 'var(--green)' }} />Paid · {m.payGroups.length} release{m.payGroups.length === 1 ? '' : 's'}<b>{rs(m.totalPaid)}</b></div>
            <div><i style={{ background: 'var(--green-soft)' }} />Work done (est.)<b>~{rs(m.workDoneEst)}</b></div>
          </div>
          {settledTotal > 0 && <div className="sc-nums" style={{ margin: '12px 0 0' }}><span>Set against day wages <b>{rs(settledTotal)}</b></span></div>}
          <div className={`m-note ${note.cls}`}><NoteIcon cls={note.cls} /><span>{note.text}</span></div>
        </div>

        <div className="sec"><span className="eyebrow">Stages</span><span className="n">{m.rows.length}</span></div>
        <div className="stg-list">
          {stages.map((s, i) => {
            const pd = s.agreed ? s.estP * 100 : 0, pp = s.agreed ? s.paid / s.agreed * 100 : 0;
            return (
              <div className="sc" key={s.id || i} style={{ animationDelay: `${Math.min(i, 6) * 30}ms` }}>
                <div className="sc-top"><span className="s-num">{i + 1}</span>
                  <div className="sc-name">{s.name}<small>{s.measText}{s.note ? ' · ' + s.note : ''}</small></div>
                  <div className={`sc-bal ${s.bal <= SETTLE_TOL ? 'done' : ''}`}>{s.bal <= SETTLE_TOL ? 'Paid' : rs(s.bal)}<small>{s.bal <= SETTLE_TOL ? 'in full' : 'left'}</small></div>
                </div>
                <div className="bar"><i className="done" style={{ width: `${pd}%` }} /><i className="paid" style={{ width: `${pp}%` }} /></div>
                <div className="sc-nums"><span>Agreed <b>{rs(s.agreed)}</b></span><span>Paid <b>{rs(s.paid)}</b></span><span>Done <b>{Math.round(pd)}%</b></span></div>
              </div>
            );
          })}
        </div>
        {!showAll && m.rows.length > 4 && <><div style={{ height: 10 }} /><button className="more-btn" onClick={() => setShowAll(true)}>Show all {m.rows.length} stages</button></>}

        <div className="sec"><span className="eyebrow">Payments</span><span className="n">{m.payGroups.length}</span></div>
        {m.payGroups.length ? (
          <div className="pay-list">
            {m.payGroups.map((g) => {
              const tags = Object.entries(g.byMs).slice(0, 3);
              const isOpen = openNote === g.txnId;
              return (
                <article className={`pay ${isOpen ? 'open' : ''}`} key={g.txnId}>
                  <div className="pay-top"><span className="pay-amt">{rs(g.total)}</span><span className="pay-date">{g.date ? fD(new Date(g.date)) : ''}</span></div>
                  <div className="tags">
                    {g.mode ? <span className="tag">{g.mode}</span> : null}
                    {tags.map(([mid, amt]) => <span className="tag g" key={mid}>{m.rows.find((r) => r.id === mid)?.name || 'Stage'} <b>{rs(amt)}</b></span>)}
                    {g.open > 0.5 ? <span className="tag">Advance <b>{rs(g.open)}</b></span> : null}
                  </div>
                  {g.note ? <p className="pay-note">{g.note}</p> : null}
                  <div className="pay-foot">
                    {g.note && g.note.length > 90
                      ? <button className="linkbtn" onClick={() => setOpenNote(isOpen ? null : g.txnId)}>{isOpen ? 'Show less' : 'Show more'}</button>
                      : <span className="ref mono">{g.txnId}</span>}
                    {releasable && m.rows.length > 0 && g.open > 0.5 && <button className="linkbtn" onClick={() => setSheet({ adjust: g })}>Re-adjust</button>}
                  </div>
                </article>
              );
            })}
          </div>
        ) : <div className="nopay">No payments yet.</div>}

        <div className="sec"><span className="eyebrow">Activity</span></div>
        <ul className="tl">{m.act.map((a, i) => <li key={i}><time>{fT(a.at)}</time>{a.who ? <b>{a.who}</b> : null}{a.who ? ' ' : ''}{a.what}</li>)}</ul>

        {m.closed ? <div style={{ height: 32 }} />
          : isDraft
            ? <div className="actbar" style={{ gridTemplateColumns: '1fr' }}><button className="btn btn-primary" disabled={!canAct || approve.isPending} onClick={() => approve.mutate()}>{approve.isPending ? 'Approving…' : 'Approve & start releases'}</button></div>
            : releasable
              ? <div className="actbar">
                  <button className="btn btn-ghost" onClick={() => setSheet('link')}>Link</button>
                  <button className="btn btn-primary" onClick={() => setSheet('release')}>Release payment</button>
                </div>
              : <div style={{ height: 32 }} />}
      </section>

      {sheet === 'release' && <ReleaseSheet wo={wo} model={m} orgId={orgId ?? ''} onClose={() => setSheet(null)} onDone={(msg) => { setSheet(null); refreshMoney(); toast(msg); }} />}
      {sheet === 'link' && <LinkSheet wo={wo} orgId={orgId ?? ''} target={Math.max(0, m.balance)} onClose={() => setSheet(null)} onDone={(msg) => { setSheet(null); refreshMoney(); toast(msg); }} />}
      {sheet && typeof sheet === 'object' && 'adjust' in sheet && <AdjustSheet wo={wo} group={sheet.adjust} stages={m.rows.filter((r) => r.id).map((r) => ({ id: r.id as string, name: r.name }))} onClose={() => setSheet(null)} onDone={(msg) => { setSheet(null); refreshMoney(); toast(msg); }} />}
      {sheet === 'menu' && <MenuSheet wo={wo} outstanding={Math.max(0, m.balance)} canAct={canAct} onClose={() => setSheet(null)}
        onLink={() => setSheet('link')} onToast={toast}
        onClosed={() => { setSheet(null); qc.invalidateQueries({ queryKey: ['wo', woId] }); qc.invalidateQueries({ queryKey: ['cm_wo_head'] }); }} session={session} />}

      <div className={`toast ${toastMsg ? 'show' : ''}`} role="status">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        <span>{toastMsg}</span>
      </div>
    </div>
  );
}

function StatusPill({ st }: { st: 'progress' | 'new' | 'closed' }) {
  const map = { progress: ['In progress', 'p-progress'], new: ['Not started', 'p-new'], closed: ['Closed', 'p-closed'] } as const;
  const [t, k] = map[st];
  return <span className={`pill ${k}`}>{t}</span>;
}
function NoteIcon({ cls }: { cls: string }) {
  return cls === 'ok'
    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17h.01" /></svg>;
}

// ── bottom sheet shell ───────────────────────────────────────────────────────
function Sheet({ children, onClose }: { children: (close: () => void) => React.ReactNode; onClose: () => void }) {
  const [shown, setShown] = useState(false);
  useMemo(() => { requestAnimationFrame(() => requestAnimationFrame(() => setShown(true))); return null; }, []);
  const close = () => { setShown(false); setTimeout(onClose, 380); };
  return (
    <>
      <div className={`sb ${shown ? 'show' : ''}`} onClick={close} />
      <div className={`sheet ${shown ? 'open' : ''}`} role="dialog" aria-modal="true">
        <div className="sh-handle" aria-hidden="true"><span /></div>
        {children(close)}
      </div>
    </>
  );
}
const XBtn = ({ onClick }: { onClick: () => void }) => (
  <button className="icon-btn" aria-label="Close" onClick={onClick}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
);

// ── Release payment (creates a real worker payment allocated to stages) ──────────
function ReleaseSheet({ wo, model, orgId, onClose, onDone }: { wo: any; model: any; orgId: string; onClose: () => void; onDone: (m: string) => void }) {
  const open = model.rows.filter((r: StageRow) => r.id && r.bal > SETTLE_TOL);
  const gap = Math.max(0, model.workDoneEst - model.totalPaid);
  const [amt, setAmt] = useState(0);
  const [stage, setStage] = useState<'auto' | string>('auto');
  const [mode, setMode] = useState('NEFT');
  const [day, setDay] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const release = async (close: () => void) => {
    if (!amt || busy) return;
    setBusy(true);
    try {
      // Distribute across open stages (chosen-first or oldest-first); leftover is an open advance.
      const order: StageRow[] = stage === 'auto' ? open : [open.find((o: StageRow) => o.id === stage), ...open.filter((o: StageRow) => o.id !== stage)].filter(Boolean) as StageRow[];
      const allocations: any[] = []; let left = amt;
      for (const s of order) { if (left <= 0) break; const room = Math.max(0, s.bal); const take = Math.min(room, left); if (take > 0) { allocations.push({ project_id: wo.project_id, order_type: 'WO', order_ref: wo.wo_id, milestone_id: s.id, allocated_amount: take }); left -= take; } }
      if (left > 0) allocations.push({ project_id: wo.project_id, order_type: 'WO', order_ref: wo.wo_id, milestone_id: null, allocated_amount: left });
      const dt = new Date(); dt.setDate(dt.getDate() - day);
      const txnId = `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const { data, error } = await supabase.rpc('insert_transaction_with_allocations', {
        p_txn: { txn_id: txnId, org_id: orgId, stakeholder_id: wo.stakeholder_id, date: dt.toISOString().split('T')[0], total_amount: amt, payment_mode: mode, category: 'Running Bill', remarks: [wo.stakeholders?.name, note.trim()].filter(Boolean).join(' · '), ai_flag_status: 'Clean' },
        p_allocations: allocations,
      });
      if (error) throw error;
      const r = data as { success?: boolean; error?: string } | null;
      if (!r?.success) throw new Error(r?.error || 'Could not record the payment');
      close();
      onDone(`Released ${rs(amt)} to ${wo.stakeholders?.name || 'worker'}`);
    } catch (e) { setBusy(false); onDone((e as Error).message || 'Could not release'); }
  };

  const hint = (() => {
    if (!amt) return { t: 'Type an amount, or tap one below', warn: false };
    if (stage !== 'auto') { const s = open.find((o: StageRow) => o.id === stage); const left = s ? s.bal : 0; return amt > left ? { t: `${rs(amt - left)} more than ${s?.name} has left`, warn: true } : { t: `${rs(left - amt)} left on ${s?.name} after this`, warn: false }; }
    const over = amt - model.balance;
    return over > 0 ? { t: `${rs(over)} more than outstanding — this becomes an advance`, warn: true } : { t: `${rs(model.balance - amt)} outstanding after this`, warn: false };
  })();

  return (
    <Sheet onClose={onClose}>
      {(close: () => void) => (
        <>
          <div className="sh-head"><div><h3 className="sh-title">Release payment</h3><p className="sh-sub">to {wo.stakeholders?.name || 'worker'} · {rs(Math.max(0, model.balance))} outstanding</p></div><XBtn onClick={close} /></div>
          <div className="sh-body">
            <label className="big-amt"><span>₹</span><input ref={inputRef} inputMode="numeric" autoComplete="off" placeholder="0" aria-label="Amount" value={amt ? inr(amt) : ''} onChange={(e) => setAmt(+e.target.value.replace(/\D/g, '') || 0)} /></label>
            <div className={`amt-hint ${hint.warn ? 'warn' : ''}`}>{hint.t}</div>
            <div className="ochips" style={{ marginTop: 4 }}>
              {gap > 0 && <button className="qc" onClick={() => setAmt(Math.round(gap))}>Work done gap {rs(gap)}</button>}
              {model.balance > 0 && <button className="qc" onClick={() => setAmt(Math.round(model.balance))}>Full balance {rs(model.balance)}</button>}
              <button className="qc" onClick={() => setAmt(25000)}>₹25,000</button>
            </div>
            <span className="flabel">Against</span>
            <div className="ochips">
              <button className={`oc`} aria-pressed={stage === 'auto'} onClick={() => setStage('auto')}>Oldest stage first</button>
              {open.slice(0, 6).map((s: StageRow) => <button className="oc" key={s.id} aria-pressed={stage === s.id} onClick={() => setStage(s.id as string)}>{s.name} <small>{rs(s.bal)}</small></button>)}
            </div>
            <span className="flabel">Paid by</span>
            <div className="ochips">{['Cash', 'UPI', 'NEFT', 'CRED', 'Cheque'].map((x) => <button className="oc" key={x} aria-pressed={mode === x} onClick={() => setMode(x)}>{x}</button>)}</div>
            <span className="flabel">Date</span>
            <div className="ochips">{[['Today', 0], ['Yesterday', 1], ['2 days ago', 2]].map(([l, d]) => <button className="oc" key={l as string} aria-pressed={day === d} onClick={() => setDay(d as number)}>{l}</button>)}</div>
            <span className="flabel">Note <span style={{ color: 'var(--text-3)' }}>· optional</span></span>
            <input className="inp" placeholder="e.g. paid via CRED, ref 6630…" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="sh-foot"><button className={`btn btn-primary ${amt ? '' : 'off'}`} disabled={!amt || busy} onClick={() => release(close)}>{busy ? 'Releasing…' : amt ? `Release ${rs(amt)}` : 'Enter an amount'}</button></div>
        </>
      )}
    </Sheet>
  );
}

// ── Link an already-recorded payment ────────────────────────────────────────────
function LinkSheet({ wo, orgId, target, onClose, onDone }: { wo: any; orgId: string; target: number; onClose: () => void; onDone: (m: string) => void }) {
  const { data: pays = [], isLoading } = useQuery({
    queryKey: ['cm_linkable', wo.wo_id, target],
    queryFn: () => loadContractLinkablePayments(wo.stakeholder_id, wo.project_id, target),
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const link = async (p: LinkablePayment, close: () => void) => {
    setBusyId(p.txnId);
    try { await linkPaymentToContract(orgId, p, wo.wo_id, wo.project_id, Math.min(p.free, target || p.free)); close(); onDone(`Linked ${rs(Math.min(p.free, target || p.free))}`); }
    catch (e) { setBusyId(null); onDone((e as Error).message || 'Could not link'); }
  };
  return (
    <Sheet onClose={onClose}>
      {(close: () => void) => (
        <>
          <div className="sh-head"><div><h3 className="sh-title">Link a payment</h3><p className="sh-sub">already recorded for {wo.stakeholders?.name || 'this worker'}</p></div><XBtn onClick={close} /></div>
          <div className="sh-body">
            {isLoading ? <div className="empty">Loading…</div>
              : pays.length === 0 ? <div className="nopay" style={{ margin: 0 }}>No loose payments to link. Record one in the Book, or use Release payment.</div>
                : <div className="pay-list" style={{ padding: 0 }}>
                    {pays.map((p) => (
                      <button className="pay" key={p.txnId} style={{ textAlign: 'left', width: '100%' }} disabled={!!busyId} onClick={() => link(p, close)}>
                        <div className="pay-top"><span className="pay-amt">{rs(p.free)}</span><span className="pay-date">{p.date ? fD(new Date(p.date)) : ''}</span></div>
                        <div className="tags"><span className="tag">{p.mode || 'Payment'}</span>{p.sameProject ? <span className="tag g">same site</span> : null}{busyId === p.txnId ? <span className="tag">Linking…</span> : null}</div>
                        {p.note ? <p className="pay-note">{p.note}</p> : null}
                      </button>
                    ))}
                  </div>}
          </div>
        </>
      )}
    </Sheet>
  );
}

// ── Re-adjust an open advance onto stages (+ certify) ────────────────────────────
function AdjustSheet({ wo, group, stages, onClose, onDone }: { wo: any; group: PayGroup; stages: { id: string; name: string }[]; onClose: () => void; onDone: (m: string) => void }) {
  const [parts, setParts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const placeable = group.open;
  const placed = Object.values(parts).reduce((t, v) => t + (v || 0), 0);
  const left = placeable - placed;
  const apply = async (close: () => void) => {
    if (busy || placed <= 0) return;
    setBusy(true);
    try {
      await adjustContractPayment(group.txnId, wo.wo_id, Object.entries(parts).filter(([, v]) => v > 0).map(([milestoneId, amount]) => ({ milestoneId, amount })));
      close(); onDone(`Placed ${rs(placed)} across stages`);
    } catch (e) { setBusy(false); onDone((e as Error).message || 'Could not adjust'); }
  };
  return (
    <Sheet onClose={onClose}>
      {(close: () => void) => (
        <>
          <div className="sh-head"><div><h3 className="sh-title">Place on stages</h3><p className="sh-sub">{rs(placeable)} advance from this payment · confirms the work as done</p></div><XBtn onClick={close} /></div>
          <div className="sh-body">
            {stages.map((s) => (
              <div key={s.id} style={{ marginBottom: 10 }}>
                <span className="flabel" style={{ margin: '0 0 6px' }}>{s.name}</span>
                <label className="money-inp" style={{ height: 48 }}><span>₹</span><input inputMode="numeric" placeholder="0" value={parts[s.id] ? inr(parts[s.id]) : ''} onChange={(e) => setParts((p) => ({ ...p, [s.id]: +e.target.value.replace(/\D/g, '') || 0 }))} /></label>
              </div>
            ))}
            <div className={`amt-hint ${left < -0.5 ? 'warn' : ''}`}>{left < -0.5 ? `${rs(-left)} more than the advance` : `${rs(Math.max(0, left))} of the advance left`}</div>
          </div>
          <div className="sh-foot"><button className={`btn btn-primary ${placed > 0 && left >= -0.5 ? '' : 'off'}`} disabled={busy || placed <= 0 || left < -0.5} onClick={() => apply(close)}>{busy ? 'Placing…' : `Place ${rs(placed)} & confirm`}</button></div>
        </>
      )}
    </Sheet>
  );
}

// ── More menu (Link / Edit / Close-Reopen) ───────────────────────────────────────
function MenuSheet({ wo, outstanding, canAct, onClose, onLink, onToast, onClosed, session }: { wo: any; outstanding: number; canAct: boolean; onClose: () => void; onLink: () => void; onToast: (m: string) => void; onClosed: () => void; session: Session }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const closed = wo.status === 'Closed' || wo.status === 'Cancelled';
  const toggleClose = async () => {
    if (!closed && outstanding > SETTLE_TOL && !armed) { setArmed(true); return; }
    setBusy(true);
    const next = closed ? 'Assigned' : 'Closed';
    const hist = [...(wo.status_history ?? []), { status: next, at: new Date().toISOString(), by: session.user.id }];
    const { error } = await supabase.from('work_orders').update({ status: next, status_history: hist }).eq('wo_id', wo.wo_id);
    setBusy(false);
    if (error) { onToast(error.message); return; }
    onClosed(); onToast(closed ? 'Contract reopened' : 'Contract closed');
  };
  return (
    <Sheet onClose={onClose}>
      {(close: () => void) => (
        <>
          <div className="sh-head"><div><h3 className="sh-title">{wo.stakeholders?.name || 'Contract'}</h3><p className="sh-sub mono">{wo.wo_id}</p></div><XBtn onClick={close} /></div>
          <div className="menu">
            <button onClick={() => { close(); onLink(); }}><Ico k="link" /><span>Link a payment from Book<small>Attach a payment already recorded</small></span></button>
            <button onClick={() => { close(); onToast('Edit stages & amounts on the desktop contract page for now'); }}><Ico k="edit" /><span>Edit contract<small>Stages, amounts, scope</small></span></button>
            {canAct && <button className={closed ? '' : 'danger'} disabled={busy} onClick={toggleClose}><Ico k="lock" /><span>{closed ? 'Reopen contract' : armed ? 'Tap again to close' : 'Close contract'}<small>{closed ? 'Allow releases again' : armed ? `${rs(outstanding)} will stay unpaid` : outstanding > SETTLE_TOL ? `${rs(outstanding)} is still unpaid` : 'Everything is paid'}</small></span></button>}
          </div>
          <div style={{ height: 'calc(8px + env(safe-area-inset-bottom))' }} />
        </>
      )}
    </Sheet>
  );
}
function Ico({ k }: { k: 'link' | 'edit' | 'lock' }) {
  const p = k === 'link' ? <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    : k === 'edit' ? <path d="M4 20h4L19 9l-4-4L4 16z" />
    : <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>;
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">{p}</svg>;
}
