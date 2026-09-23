/**
 * PayablesMobile — the weekly run on a phone, ported from the reference prototype
 * (claude.ai/artifact/FnHwFKvEjCHFDSme2NmL8E) value for value.
 *
 * A weekly run is a pipeline, so the page is one:  approve → pay → paid
 *   hero      what this week costs, and how far along it is (one bar: paid · approved · waiting)
 *   one list  everyone stays where they are. The row's own button moves the payment along, in place:
 *             Approve → Mark paid → (tick, mode). Same spot, same shape. Nobody jumps around while
 *             you work down the list.
 *   filters   All · Approve · Pay · Paid are a way of LOOKING (for whoever only pays), not rooms you
 *             must walk between.
 *   row       two lines. Who and how much; what for and where. The amount shown is what you pay THIS
 *             week; anything older rides beside it as "+₹49,300 earlier".
 *   quiet     people owed from earlier with no work this week are not rows with dead buttons. They
 *             fold into one line.
 *   flags     a vendor being paid with no bill on file carries the hollow clay ring: "check this".
 *
 * The middle stage is real: an approval is a row in payment_approvals (see paymentApprovals.ts), so
 * a supervisor's approval is waiting for whoever pays, on their phone, not just on this one. Paying
 * is still the transaction the desktop run records — same call, same stamp, same ledger.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { recordWeeklyPayment, settleWeeklyPaymentOnLedger, undoWeeklyPayment, mondayOf, weekLabel, type PayRow, type RunPaid } from '../../lib/weeklyPaymentsApi';
import { approve as approveRow, unapprove as unapproveRow, isMissingTable, type Approval } from '../../lib/paymentApprovals';
import { addAdjustment } from '../../lib/partyLedgerApi';
import { PYM_CSS } from './pymCss';
import { useSheetDrag } from '../../lib/sheetDrag';
import { useSheetFlag } from '../../lib/sheetFlag';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const grouped = (n: number) => Math.round(Number(n) || 0).toLocaleString('en-IN');
const MODES = ['NEFT', 'UPI', 'Cheque', 'Cash'];
/** The reference's four site colours, taken in order by the sites this run touches. */
const SITE_INK = ['#7E9A77', '#B5472A', '#C08A2B', '#8793A3'];

const TICK = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
const CHEV = <svg className="c" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>;
const ARROW = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>;
const CROSS = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>;

type Stage = 'approve' | 'pay' | 'paid';
type Item = {
  row: PayRow; key: string; kind: 'worker' | 'vendor';
  name: string; role: string; site: string;
  week: number; carried: number; amount: number;
  basis: string; nobill: number; stage: Stage; via: string;
};
const owed = (it: Item) => it.week + it.carried;
/** owed from earlier, nothing proposed this week */
const quiet = (it: Item) => it.stage === 'approve' && it.amount === 0;

type Panel =
  | { view: 'pay'; it: Item; amt: number; approved: boolean }
  | { view: 'keys'; it: Item; amt: number; typed: string; approved: boolean }
  | { view: 'paid'; it: Item; open: string; via: string; date: string; dateWord: 'Today' | 'Earlier'; proof: File | null }
  | { view: 'weeks' };

export function PayablesMobile({
  rows, paid, approvals, monday, setMonday, readOnly, newLedger, orgId, who, onDone, loading, projects, parties, onAdd,
}: {
  rows: PayRow[];
  paid: Record<string, RunPaid>;
  approvals: Record<string, Approval>;
  monday: Date;
  setMonday: (d: Date) => void;
  readOnly: boolean;
  newLedger: boolean;
  orgId: string;
  who: { id?: string | null; name?: string | null };
  /** something was written: reload the run, the paid stamps and the approvals */
  onDone: () => void;
  loading: boolean;
  /** the sites + parties the "add a payment request" form offers */
  projects: { project_id: string; name: string }[];
  parties: { stakeholder_id: string; name: string; type?: string | null; category?: string | null }[];
  /** show the just-added request in the run right away (ephemeral row, like the desktop) */
  onAdd?: (row: PayRow) => void;
}) {
  const [stage, setStage] = useState<'all' | Stage>('all');
  const [foldOpen, setFoldOpen] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [addOpen, setAddOpen] = useState(false);   // the "add a payment request" sheet
  useSheetFlag(!!panel || addOpen);
  const [busy, setBusy] = useState<string | null>(null);
  const [folded, setFolded] = useState(false);
  const [fab, setFab] = useState<{ cls: string; label: string } | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  /** rows mid-flight: the button shows its tick where it stands before the list settles */
  const [flying, setFlying] = useState<Record<string, { cls: 'done' | 'leave'; word: string }>>({});
  const [arrived, setArrived] = useState('');
  const [bumped, setBumped] = useState<string[]>([]);

  const buzz = (ms: number | number[] = 6) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };
  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const toastT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((text: string, undo?: () => void) => {
    setToast({ text, undo });
    if (toastT.current) clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast(null), undo ? 4200 : 1900);
  }, []);
  useEffect(() => () => { if (toastT.current) clearTimeout(toastT.current); }, []);

  // ── the run, as the page thinks of it ──
  const items: Item[] = useMemo(() => {
    const siteOf = new Map<string, string>();
    rows.forEach((r) => { if (r.projectName && !siteOf.has(r.projectName)) siteOf.set(r.projectName, SITE_INK[siteOf.size % SITE_INK.length]); });
    return rows.map((r) => {
      const ap = approvals[r.key];
      const st: Stage = paid[r.key] ? 'paid' : ap ? 'pay' : 'approve';
      const amount = st === 'paid' ? paid[r.key].amount : ap ? ap.amount : r.thisWeek;
      return {
        row: r, key: r.key, kind: r.kind === 'vendor' ? 'vendor' : 'worker',
        name: r.party, role: r.trade || (r.kind === 'vendor' ? 'Vendor' : 'Worker'), site: r.projectName || '',
        week: r.thisWeek, carried: r.balanceBf || 0, amount,
        basis: r.basis, nobill: r.withoutBills || 0, stage: st,
        // a paid row wears how it actually went out, not how it was approved
        via: paid[r.key]?.mode || ap?.via || (r.kind === 'vendor' ? 'NEFT' : 'UPI'),
      };
    });
  }, [rows, approvals, paid]);
  const siteInk = useMemo(() => {
    const m: Record<string, string> = {};
    items.forEach((i) => { if (i.site && !m[i.site]) m[i.site] = SITE_INK[Object.keys(m).length % SITE_INK.length]; });
    return m;
  }, [items]);

  const counts = useMemo(() => {
    const approve = items.filter((i) => i.stage === 'approve' && !quiet(i)).length;
    const pay = items.filter((i) => i.stage === 'pay').length;
    const done = items.filter((i) => i.stage === 'paid').length;
    return { approve, pay, paid: done, all: approve + pay + done };
  }, [items]);
  const prevCounts = useRef(counts);
  useEffect(() => {
    const up = (['approve', 'pay', 'paid'] as const).filter((k) => counts[k] > prevCounts.current[k]);
    prevCounts.current = counts;
    if (!up.length) return;
    setBumped(up);
    const t = setTimeout(() => setBumped([]), 500);
    return () => clearTimeout(t);
  }, [counts]);

  const totals = useMemo(() => {
    const sum = (st: Stage) => items.filter((i) => i.stage === st).reduce((a, i) => a + i.amount, 0);
    const p = sum('paid'), a = sum('pay'), w = sum('approve');
    return { p, a, w, all: p + a + w || 1 };
  }, [items]);

  const inStage = stage === 'all' ? items : items.filter((i) => i.stage === stage);
  const active = inStage.filter((i) => !quiet(i));
  const folded2 = inStage.filter(quiet);
  const showFold = (stage === 'approve' || stage === 'all') && folded2.length > 0;

  // ── writing ──
  const doApprove = async (it: Item, amount: number, via: string) => {
    setBusy(it.key);
    try {
      await approveRow(orgId, monday, { rowKey: it.key, amount, via, partyName: it.name }, who);
      onDone();
      return true;
    } catch (e) {
      say(isMissingTable(e) ? 'Approvals need migration 20260921000000 applied' : ((e as Error)?.message || 'Could not approve'));
      return false;
    } finally { setBusy(null); }
  };
  const doUnapprove = async (it: Item) => {
    setBusy(it.key);
    try { await unapproveRow(orgId, monday, it.key); onDone(); } catch (e) { say((e as Error)?.message || 'Could not send it back'); } finally { setBusy(null); }
  };
  const doPay = async (it: Item, p: Extract<Panel, { view: 'paid' }>) => {
    setBusy(it.key);
    try {
      let proofUrl: string | null = null;
      if (p.proof) {
        const name = `${it.key.replace(/[^\w-]/g, '')}-${Date.now()}.${p.proof.name.split('.').pop()}`;
        const { error } = await supabase.storage.from('documents').upload(`proofs/${name}`, p.proof);
        if (error) throw error;
        proofUrl = supabase.storage.from('documents').getPublicUrl(`proofs/${name}`).data.publicUrl;
      }
      const txnId = await recordWeeklyPayment(orgId, it.row, it.amount, p.via, 'Weekly run', monday, '', { proofUrl, date: p.date });
      if (newLedger) { try { await settleWeeklyPaymentOnLedger(txnId, it.row, it.amount, monday); } catch { /* the payment stands; the link is reported by the desktop run */ } }
      onDone();
      return true;
    } catch (e) {
      say((e as Error)?.message || 'Could not record the payment');
      return false;
    } finally { setBusy(null); }
  };
  const undoPaid = (it: Item) => async () => {
    const ids = paid[it.key]?.txnIds ?? [];
    if (!ids.length) return;
    try { await undoWeeklyPayment(ids); onDone(); say('Payment voided'); } catch (e) { say((e as Error)?.message || 'Could not undo it'); }
  };

  /** Move a row along where it stands: the button ticks, then the list catches up. */
  const moveOn = async (it: Item, run: () => Promise<boolean>, word: string, note: string, undo: () => void) => {
    if (calm) { if (await run()) say(note, undo); return; }
    setFlying((f) => ({ ...f, [it.key]: { cls: 'done', word } }));
    buzz(8);
    const ok = await run();
    if (!ok) { setFlying((f) => { const n = { ...f }; delete n[it.key]; return n; }); return; }
    if (stage !== 'all') setTimeout(() => setFlying((f) => ({ ...f, [it.key]: { cls: 'leave', word } })), 520);
    setTimeout(() => {
      setFlying((f) => { const n = { ...f }; delete n[it.key]; return n; });
      setArrived(it.key); setTimeout(() => setArrived(''), 600);
      say(note, undo);
    }, stage === 'all' ? 760 : 960);
  };

  // ── the action capsule: approve everything proposed, in one go ──
  const proposals = items.filter((i) => i.stage === 'approve' && !quiet(i));
  const fabShown = (stage === 'approve' || stage === 'all') && proposals.length > 1 && !panel && !readOnly;
  const fabRef = useRef<HTMLButtonElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const fabLabel = fab ? fab.label : `Approve all ${proposals.length}`;
  useEffect(() => {
    const m = measureRef.current, f = fabRef.current;
    if (!m || !f) return;
    m.textContent = fabLabel;
    f.style.setProperty('--w', `${Math.ceil(48 + m.getBoundingClientRect().width + 22)}px`);
  }, [fabLabel]);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY, d = y - last;
      if (Math.abs(d) > 5) { setFolded(d > 0 && y > 60); last = y; }
      if (y < 8) setFolded(false);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const approveAll = async () => {
    if (fab || !proposals.length) return;
    const list = proposals.slice();
    const total = list.reduce((a, i) => a + i.amount, 0);
    buzz(8);
    setFab({ cls: 'working', label: 'Approving' });
    list.forEach((it, k) => setTimeout(() => setFlying((f) => ({ ...f, [it.key]: { cls: stage === 'all' ? 'done' : 'leave', word: 'Approved' } })), 250 + k * 70));
    let ok = 0;
    for (const it of list) { if (await approveRow(orgId, monday, { rowKey: it.key, amount: it.amount, via: it.via, partyName: it.name }, who).then(() => true).catch(() => false)) ok++; }
    if (!ok) {
      setFlying({}); setFab(null);
      say('Approvals need migration 20260921000000 applied');
      return;
    }
    setTimeout(() => {
      setFab({ cls: 'done', label: `Approved ${inr(total)}` });
      buzz(8); setFlying({}); onDone();
    }, 250 + list.length * 70 + 420);
    setTimeout(() => {
      setFab(null);
      say(`${ok} approved. Mark each one paid as it goes out.`, async () => {
        for (const it of list) await unapproveRow(orgId, monday, it.key).catch(() => {});
        onDone();
      });
    }, 250 + list.length * 70 + 2300);
  };

  // ── the panel ──
  const openPay = (it: Item) => { setPanel({ view: 'pay', it, amt: it.amount || owed(it), approved: false }); buzz(8); };
  const openPaid = (it: Item) => { setPanel({ view: 'paid', it, open: '', via: it.via, date: new Date().toISOString().slice(0, 10), dateWord: 'Today', proof: null }); buzz(8); };
  const closePanel = useCallback(() => setPanel(null), []);
  useEffect(() => {
    if (!panel) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') closePanel(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [panel, closePanel]);

  const key = (k: string, el?: HTMLElement) => {
    if (!panel || panel.view !== 'keys') return;
    if (el) { el.classList.add('hit'); setTimeout(() => el.classList.remove('hit'), 110); }
    if (k === 'go') {
      const n = parseInt(panel.typed || '0', 10);
      if (n > 0) { buzz(8); setPanel({ view: 'pay', it: panel.it, amt: n, approved: panel.approved }); }
      return;
    }
    let typed = panel.typed;
    if (k === 'del') typed = typed.slice(0, -1);
    else if (k === '000') { if (typed && (typed + '000').length <= 9) typed += '000'; }
    else if ((typed + k).length <= 9) typed = (typed === '' && k === '0') ? '' : typed + k;
    buzz(3);
    setPanel({ ...panel, typed });
  };

  // ── paint ──
  const metaOf = (it: Item) => (
    <span className="meta">
      {it.nobill > 0 && <><i className="ring" /><span className="warn">No bill on file</span> · </>}
      {it.role}
      {it.carried > 0 && it.amount < owed(it) && <> · <span className="earlier">+{inr(owed(it) - it.amount)} earlier</span></>}
      {it.site && <> · <i className="site" style={{ background: siteInk[it.site] }} />{it.site.replace(' Residence', '').replace(' Apartments', '')}</>}
    </span>
  );
  const rowEl = (it: Item) => {
    const fly = flying[it.key];
    const act = fly?.cls === 'done'
      ? <button type="button" className="act done" disabled>{TICK}{fly.word}</button>
      : it.stage === 'approve'
        ? <button type="button" className="act" disabled={busy === it.key || readOnly}
            onClick={() => { if (!it.amount) { openPay(it); return; } void moveOn(it, () => doApprove(it, it.amount, it.via), 'Approved', `${inr(it.amount)} approved for ${it.name.split(' ')[0]}`, () => void doUnapprove(it)); }}>
            {it.amount ? 'Approve' : 'Set amount'}
          </button>
        : it.stage === 'pay'
          ? <button type="button" className="act pay" disabled={busy === it.key} onClick={() => openPaid(it)}>Mark paid</button>
          : <button type="button" className="paidtag" onClick={() => say(`${inr(it.amount)} to ${it.name.split(' ')[0]} · filed in Book`, undoPaid(it))}>{TICK}{it.via}</button>;
    return (
      <div key={it.key} className={`row${fly?.cls === 'leave' ? ' leave' : ''}${arrived === it.key ? ' back' : ''}${it.stage === 'paid' ? ' ispaid' : ''}`}>
        <span className="av" aria-hidden="true">{(it.name || '?').charAt(0).toUpperCase()}</span>
        <div className="body">
          <button type="button" className="body" style={{ gap: 0 }} aria-label={`${it.name}, details`}
            onClick={() => (it.stage === 'approve' ? openPay(it) : it.stage === 'pay' ? openPaid(it) : say('Opens this payment in Book'))}>
            <span className="l1"><b>{it.name}</b><span className={`amt${it.amount ? '' : ' zero'}`}>{inr(it.amount)}</span></span>
          </button>
          <span className="l2">{metaOf(it)}{act}</span>
        </div>
      </div>
    );
  };

  const EMPTY: Record<string, [string, string]> = {
    all: ['Nothing to pay this week', 'Wages and bills that fall due will appear here.'],
    approve: ['All approved for this week', "New requests and next week's wages will appear here."],
    pay: ['Nothing waiting to be paid', 'Approve a payment and it queues here for whoever pays.'],
    paid: ['Nothing paid yet this week', 'Payments you mark as paid are filed in Book and listed here.'],
  };
  const stageIdx = ['all', 'approve', 'pay', 'paid'].indexOf(stage);

  return (
    <div className="pym">
      <style>{PYM_CSS}</style>

      <header className="hero">
        <div className="hero-top">
          <h1>Payables</h1>
          <button type="button" className="week" onClick={() => { buzz(5); setPanel({ view: 'weeks' }); }}>
            {weekLabel(monday)}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
        </div>
        <div className="sum">{inr(totals.p + totals.a + totals.w)}<small>this week</small></div>
        <div className="run" aria-hidden="true">
          <i className="p" style={{ flexGrow: totals.p / totals.all * 100 }} />
          <i className="a" style={{ flexGrow: totals.a / totals.all * 100 }} />
          <i className="w" style={{ flexGrow: totals.w / totals.all * 100 }} />
        </div>
        <div className="legend">
          <span><i style={{ background: '#8FC79A' }} />Paid <b>{inr(totals.p)}</b></span>
          <span><i style={{ background: 'rgb(250,248,243)' }} />Approved <b>{inr(totals.a)}</b></span>
          <span><i style={{ boxShadow: 'inset 0 0 0 1.5px rgba(250,248,243,.5)' }} />Waiting <b>{inr(totals.w)}</b></span>
        </div>
      </header>

      <div className="stages">
        <div className="seg3" role="group" aria-label="Stage">
          <i className="thumb3" style={{ transform: `translateX(${stageIdx * 100}%)` }} />
          {(['all', 'approve', 'pay', 'paid'] as const).map((s) => (
            <button key={s} type="button" aria-pressed={stage === s} onClick={() => { if (s !== stage) { setStage(s); buzz(5); } }}>
              {s === 'all' ? 'All' : s === 'approve' ? 'Approve' : s === 'pay' ? 'Pay' : 'Paid'}
              <em className={bumped.includes(s) ? 'bump' : ''}>{counts[s]}</em>
            </button>
          ))}
        </div>
      </div>

      <main aria-live="polite">
        {loading && !items.length && <div className="loading">Reading the week…</div>}
        {([['worker', 'Workers'], ['vendor', 'Vendors']] as const).map(([k, label]) => {
          const list = active.filter((i) => i.kind === k);
          if (!list.length) return null;
          return (
            <div key={k}>
              <div className="sec"><b>{label}</b><span>{inr(list.reduce((a, i) => a + i.amount, 0))}</span></div>
              <div className="card">{list.map(rowEl)}</div>
            </div>
          );
        })}
        {showFold && (
          <div>
            <div className="sec"><b>Owed from earlier</b><span>{inr(folded2.reduce((a, i) => a + owed(i), 0))}</span></div>
            <div className="card">
              <button type="button" className="fold" aria-expanded={foldOpen} onClick={() => { setFoldOpen((v) => !v); buzz(3); }}>
                <span className="t">
                  <b>{folded2.length} {folded2.length === 1 ? 'person' : 'people'}, no work this week</b>
                  <span>Nothing proposed. Open to pay any of them.</span>
                </span>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
              </button>
              {foldOpen && folded2.map(rowEl)}
            </div>
          </div>
        )}
        {!loading && !active.length && !showFold && (
          <div className="empty"><b>{EMPTY[stage][0]}</b><span>{EMPTY[stage][1]}</span></div>
        )}
        {(stage === 'approve' || stage === 'all') && !readOnly && (
          <button type="button" className="addreq" onClick={() => { setAddOpen(true); buzz(8); }}>+ Add a payment request</button>
        )}
      </main>

      <button ref={fabRef} type="button" className={`pym-fab ${fab?.cls ?? ''}${fabShown || fab ? '' : ' away'}${folded && !fab ? ' folded' : ''}`}
        aria-label={fabLabel} onClick={() => void approveAll()}>
        <span className="ic">{TICK}<i className="pip" /></span>
        <span className="lbl">{fabLabel}</span>
      </button>
      <span className="pym-measure" ref={measureRef} aria-hidden="true" />

      <div className={`pym-toast${toast ? ' on' : ''}`} role="status">
        <span>{toast?.text ?? ''}</span>
        {toast?.undo && <button type="button" onClick={() => { const u = toast.undo!; setToast(null); buzz(5); u(); }}>Undo</button>}
      </div>

      {panel && <div className="pym-scrim on" onClick={closePanel} />}
      {panel && <PanelView
        panel={panel} setPanel={setPanel} close={closePanel} siteInk={siteInk} busy={busy} say={say} keyPress={key}
        onApprove={async (it, amt, via) => { const ok = await doApprove(it, amt, via); return ok; }}
        onUnapprove={doUnapprove} onPay={doPay} monday={monday} setMonday={setMonday}
      />}

      {addOpen && <div className="pym-scrim on" onClick={() => setAddOpen(false)} />}
      {addOpen && (
        <AddPayableSheet
          orgId={orgId} projects={projects} parties={parties}
          close={() => setAddOpen(false)}
          onAdd={onAdd}
          onAdded={() => { setAddOpen(false); say('Payment request added'); onDone(); }}
        />
      )}
    </div>
  );
}

// ── add a payment request — a payable OBLIGATION, in the composer's own card language ──────────────
// Not a transaction (money out), a PAYABLE: for a known party it persists as a certified-side ledger
// adjustment (addAdjustment) — the same write the desktop run uses — so it enters v_party_balance and
// this week's carry. The old mobile button opened the money-out composer, which recorded a payment.
function AddPayableSheet({ orgId, projects, parties, close, onAdd, onAdded }: {
  orgId: string;
  projects: { project_id: string; name: string }[];
  parties: { stakeholder_id: string; name: string; type?: string | null; category?: string | null }[];
  close: () => void;
  onAdd?: (row: PayRow) => void;
  onAdded: () => void;
}) {
  const [on, setOn] = useState(false);
  useEffect(() => { const r = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(r); }, []);
  const drag = useSheetDrag<HTMLElement>(close, on);
  const [projectId, setProjectId] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const buzz = (ms: number | number[] = 6) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };

  const amt = parseInt(amount.replace(/[^\d]/g, ''), 10) || 0;
  const ready = !!projectId && !!picked && amt > 0;
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [] as typeof parties;
    return parties.filter((p) => p.name.toLowerCase().includes(t)).slice(0, 8);
  }, [q, parties]);

  const submit = async () => {
    if (!ready || busy || !picked) return;
    setBusy(true); setErr(null);
    try {
      await addAdjustment(orgId, picked.id, {
        projectId, adjDate: new Date().toISOString().slice(0, 10), side: 'certified', amount: amt, note: note.trim() || 'Payment request',
      });
      // Show it in the run at once — an ephemeral row, exactly like the desktop's "Add a payment".
      // The refetch (onAdded → onDone) then replaces it with the real one from the register.
      const projectName = projects.find((p) => p.project_id === projectId)?.name ?? '';
      onAdd?.({
        key: `x-${projectId}-${Date.now()}`, projectId, projectName, stakeholderId: picked.id,
        party: picked.name.trim(), trade: note.trim() || 'added here', kind: 'wages',
        basis: 'added here · not from the register', thisWeek: amt, balanceBf: 0, woId: null, milestoneId: null,
      } as PayRow);
      buzz([10, 40, 18]);
      onAdded();
    } catch (e) { setErr((e as Error)?.message || 'Could not add the payment request'); setBusy(false); }
  };

  return (
    <section ref={drag} className={`pym-panel add${on ? ' on' : ''}`} role="dialog" aria-modal="true" aria-label="Add a payment request" style={{ ['--h' as string]: 'auto' } as React.CSSProperties}>
      <div className="grab" aria-hidden="true"><i /></div>
      <div className="p-head">
        <button type="button" className="ico" aria-label="Close" onClick={close}>{CROSS}</button>
        <div className="t"><h2>Add a payment request</h2><span>What we owe — not a payment yet</span></div>
      </div>
      <div className="p-body">
        <div className="addf">
          <label className="fl">
            <span>Site</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Choose a site…</option>
              {projects.map((p) => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
            </select>
          </label>

          <label className="fl">
            <span>Party</span>
            {picked ? (
              <button type="button" className="picked" onClick={() => { setPicked(null); setQ(''); }}>
                {picked.name}<i>change</i>
              </button>
            ) : (
              <input type="text" placeholder="Search a worker or vendor…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
            )}
            {!picked && matches.length > 0 && (
              <div className="pmenu">
                {matches.map((m) => (
                  <button key={m.stakeholder_id} type="button" onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setPicked({ id: m.stakeholder_id, name: m.name }); setQ(''); buzz(4); }}>
                    <b>{m.name}</b>{m.category || m.type ? <span>{m.category || m.type}</span> : null}
                  </button>
                ))}
              </div>
            )}
          </label>

          <div className="frow">
            <label className="fl amtf">
              <span>Amount</span>
              <div className="amtin"><em>₹</em><input inputMode="numeric" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            </label>
          </div>

          <label className="fl">
            <span>For what</span>
            <input type="text" placeholder="e.g. advance · flat 501 tiles" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
      </div>
      <div className="foot">
        {err && <p className="ferr">{err}</p>}
        <button type="button" className="big" disabled={!ready || busy} onClick={submit}>
          {busy ? 'Adding…' : ready ? `Add ₹${grouped(amt)} request` : 'Add payment request'}
        </button>
      </div>
    </section>
  );
}

// ── the panel: one row's own business ──────────────────────────────────────────
function PanelView({ panel, setPanel, close, busy, say, keyPress, onApprove, onUnapprove, onPay, monday, setMonday }: {
  panel: Panel; setPanel: (p: Panel | null) => void; close: () => void; siteInk: Record<string, string>;
  busy: string | null; say: (t: string, u?: () => void) => void; keyPress: (k: string, el?: HTMLElement) => void;
  onApprove: (it: Item, amt: number, via: string) => Promise<boolean>;
  onUnapprove: (it: Item) => Promise<void>;
  onPay: (it: Item, p: Extract<Panel, { view: 'paid' }>) => Promise<boolean>;
  monday: Date; setMonday: (d: Date) => void;
}) {
  const [on, setOn] = useState(false);
  useEffect(() => { const r = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(r); }, []);
  // Pull it down to put it back — from anywhere on the sheet, not only the handle (sheetDrag).
  const drag = useSheetDrag<HTMLElement>(close, on);
  const buzz = (ms: number | number[] = 6) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };
  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [ok, setOk] = useState(false);
  // The week list is anchored to today, which render may not read — so it is measured once, here.
  const [weeks, setWeeks] = useState<Date[]>([]);
  useEffect(() => { const r = requestAnimationFrame(() => setWeeks(Array.from({ length: 9 }, (_, i) => mondayOf(new Date(Date.now() - (i - 1) * 7 * 864e5))))); return () => cancelAnimationFrame(r); }, []);

  if (panel.view === 'weeks') {
    const cur = mondayOf(monday).toISOString().slice(0, 10);
    return (
      <section ref={drag} className={`pym-panel${on ? ' on' : ''}`} role="dialog" aria-modal="true" aria-label="Pick a week" style={{ ['--h' as string]: '520px' } as React.CSSProperties}>
        <div className="grab" aria-hidden="true"><i /></div>
        <div className="p-head">
          <button type="button" className="ico" aria-label="Close" onClick={close}>{CROSS}</button>
          <div className="t"><h2>Which week</h2><span>The run is Monday to Saturday</span></div>
        </div>
        <div className="p-body">
          <div className="weeks">
            {weeks.map((w, i) => {
              const k = w.toISOString().slice(0, 10);
              return (
                <button key={k} type="button" aria-pressed={k === cur} onClick={() => { buzz(5); setMonday(w); setPanel(null); }}>
                  {weekLabel(w)}<em>{i === 1 ? 'this week' : i === 0 ? 'next week' : i === 2 ? 'last week' : `${i - 1} weeks ago`}</em>
                </button>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  const it = panel.it;
  const head = (close2: boolean, back?: () => void) => (
    <div className="p-head">
      <button type="button" className="ico" aria-label={close2 ? 'Close' : 'Back'} onClick={close2 ? close : back}>{close2 ? CROSS : ARROW}</button>
      <div className="t"><h2>{it.name}</h2><span>{it.role}{it.site ? ` · ${it.site}` : ''}</span></div>
    </div>
  );

  if (panel.view === 'keys') {
    const n = parseInt(panel.typed || '0', 10), over = n > owed(it);
    return (
      <section ref={drag} className={`pym-panel${on ? ' on' : ''}`} role="dialog" aria-modal="true" aria-label="Another amount" style={{ ['--h' as string]: '548px' } as React.CSSProperties}
        onPointerDown={(e) => { const k = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-k]'); if (!k || k.disabled) return; e.preventDefault(); keyPress(k.dataset.k!, k); }}>
        <div className="grab" aria-hidden="true"><i /></div>
        {head(false, () => setPanel({ view: 'pay', it, amt: panel.amt, approved: panel.approved }))}
        <div className="p-body">
          <div className="amt2">
            <div className="line">
              <div className="fig"><span>₹</span><b className={n ? '' : 'zero'}>{grouped(n)}</b></div>
              <button type="button" className="del" aria-label="Delete" onClick={() => keyPress('del')}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h10a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 19 19H9l-6-7 6-7Z" /><path d="m12 9.5 5 5M17 9.5l-5 5" /></svg>
              </button>
            </div>
            <p style={over ? { color: 'var(--clay-hi)' } : undefined}>{over ? `${inr(n - owed(it))} more than is owed: it will sit as an advance` : `of ${inr(owed(it))} owed`}</p>
          </div>
          <div className="pad3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0'].map((k) => (
              <button key={k} type="button" className={`k3${k === '000' ? ' z' : ''}`} data-k={k}>{k}</button>
            ))}
            <button type="button" className="k3 go" data-k="go" disabled={!n}>Done</button>
          </div>
        </div>
      </section>
    );
  }

  if (panel.view === 'pay') {
    const which = panel.amt === it.week && it.week ? 'week' : panel.amt === owed(it) ? 'all' : 'other';
    const setAmt = (amt: number) => { buzz(4); setPanel({ ...panel, amt }); };
    return (
      <section ref={drag} className={`pym-panel${on ? ' on' : ''}`} role="dialog" aria-modal="true" aria-labelledby="pymTitle"
        style={{ ['--h' as string]: `${it.nobill ? 590 : it.carried ? 520 : 480}px` } as React.CSSProperties}>
        <div className="grab" aria-hidden="true"><i /></div>
        {head(true)}
        <div className="p-body">
          <div className="owes">
            <div><span>This week</span><em>{it.basis}</em><b>{inr(it.week)}</b></div>
            {it.carried > 0 && <div><span>From earlier</span><em>carried over</em><b>{inr(it.carried)}</b></div>}
            <div className="tot"><span>Owed in all</span><em /><b>{inr(owed(it))}</b></div>
          </div>
          <div className="payamt">
            <small>Pay now</small>
            <div className="fig"><span>₹</span><b>{grouped(panel.amt)}</b></div>
            <div className="chips">
              {it.week > 0 && <button type="button" className="chip" aria-pressed={which === 'week'} onClick={() => setAmt(it.week)}>This week</button>}
              {(it.carried > 0 || !it.week) && <button type="button" className="chip" aria-pressed={which === 'all'} onClick={() => setAmt(owed(it))}>Everything {inr(owed(it))}</button>}
              <button type="button" className="chip" aria-pressed={which === 'other'} onClick={() => setPanel({ view: 'keys', it, amt: panel.amt, typed: '', approved: panel.approved })}>
                {which === 'other' ? 'Change amount' : 'Another amount'}
              </button>
            </div>
          </div>
          {it.nobill > 0 && (
            <div className="flag">
              <b>No bill on file for this</b>
              {inr(it.nobill)} has already been paid to {it.name} without bills.
              <br /><button type="button" onClick={() => say(`Opens WhatsApp with a bill request to ${it.name}`)}>Ask for the bill on WhatsApp</button>
            </div>
          )}
          <div className="foot">
            {/* one button, two jobs: approve, then (if you are also the one paying) mark paid */}
            <button type="button" className={`big${ok ? ' ok' : ''}`} disabled={busy === it.key}
              onClick={async () => {
                if (panel.approved) { setPanel({ view: 'paid', it: { ...it, amount: panel.amt, stage: 'pay' }, open: '', via: it.via, date: new Date().toISOString().slice(0, 10), dateWord: 'Today', proof: null }); return; }
                if (!(await onApprove(it, panel.amt, it.via))) return;
                buzz(8); setOk(true);
                setTimeout(() => { setOk(false); setPanel({ ...panel, approved: true }); }, calm ? 0 : 900);
              }}>
              {ok ? TICK : null}<span>{ok ? 'Approved' : panel.approved ? 'Paying it yourself? Mark paid' : `Approve ${inr(panel.amt)}`}</span>
            </button>
            <button type="button" className="linkb" onClick={() => {
              if (panel.approved) { close(); say(`${inr(panel.amt)} approved for ${it.name.split(' ')[0]}`, () => void onUnapprove(it)); return; }
              say(it.kind === 'vendor' ? "Opens this vendor's bills" : 'Opens the ledger');
            }}>{panel.approved ? 'Done for now' : it.kind === 'vendor' ? 'Open bills' : 'Open ledger'}</button>
          </div>
        </div>
      </section>
    );
  }

  // mark paid: the slip
  const p = panel;
  const row = (k: string, l: string, v: string, pick: React.ReactNode) => (
    <div key={k}>
      <button type="button" className={`rowS${p.open === k ? ' open' : ''}`} onClick={() => { buzz(3); setPanel({ ...p, open: p.open === k ? '' : k }); }}>
        <span className="l">{l}</span><span className="v">{v}</span>{CHEV}
      </button>
      {p.open === k && <div className="pick">{pick}</div>}
    </div>
  );
  return (
    <section ref={drag} className={`pym-panel${on ? ' on' : ''}`} role="dialog" aria-modal="true" aria-label="Mark paid"
      style={{ ['--h' as string]: `${p.open ? 520 : 470}px` } as React.CSSProperties}>
      <div className="grab" aria-hidden="true"><i /></div>
      {head(true)}
      <div className="p-body">
        <div className="payamt" style={{ margin: '0 0 8px' }}>
          <small>Approved to pay</small>
          <div className="fig"><span>₹</span><b>{grouped(it.amount)}</b></div>
        </div>
        {row('via', 'Paid via', p.via, (
          <div className="seg">{MODES.map((x) => (
            <button key={x} type="button" aria-pressed={x === p.via} onClick={() => { buzz(4); setPanel({ ...p, via: x, open: '' }); }}>{x}</button>
          ))}</div>
        ))}
        {row('date', 'Date', p.dateWord === 'Today' ? 'Today' : new Date(p.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), (
          <div className="chips">
            <button type="button" className="chip" aria-pressed={p.dateWord === 'Today'} onClick={() => { buzz(4); setPanel({ ...p, dateWord: 'Today', date: new Date().toISOString().slice(0, 10), open: '' }); }}>Today</button>
            <label className="chip" aria-pressed={p.dateWord === 'Earlier'} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>Earlier
              <input type="date" max={new Date().toISOString().slice(0, 10)} value={p.date} style={{ position: 'absolute', inset: 0, opacity: 0 }}
                onChange={(e) => { if (e.target.value) { buzz(4); setPanel({ ...p, dateWord: 'Earlier', date: e.target.value, open: '' }); } }} />
            </label>
          </div>
        ))}
        {row('proof', 'Proof', p.proof ? 'Added' : 'Add', (
          <label className={`xtra${p.proof ? ' has' : ''}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.2-2h6.6l1.2 2h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z" /><circle cx="12" cy="13" r="3.2" /></svg>
            <span>{p.proof ? 'Screenshot added' : 'Screenshot or photo'}</span>
            <input type="file" accept="image/*,application/pdf" aria-label="Add payment proof"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) { buzz(6); setPanel({ ...p, proof: f }); } }} />
          </label>
        ))}
        <div className="foot">
          <button type="button" className={`big${ok ? ' ok' : ''}`} disabled={busy === it.key}
            onClick={async () => {
              if (!(await onPay(it, p))) return;
              buzz([12, 40, 22]); setOk(true);
              setTimeout(() => { close(); say(`${inr(it.amount)} to ${it.name.split(' ')[0]} · filed in Book`); }, calm ? 0 : 800);
            }}>
            {ok ? TICK : null}<span>{ok ? 'Paid' : `Mark paid ${inr(it.amount)}`}</span>
          </button>
          <button type="button" className="linkb" onClick={async () => { close(); await onUnapprove(it); say('Sent back to Approve'); }}>Send back to Approve</button>
        </div>
      </div>
    </section>
  );
}
