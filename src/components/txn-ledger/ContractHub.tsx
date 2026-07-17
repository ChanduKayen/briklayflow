/**
 * ContractHub — the contents of the panel that opens from the worker/job
 * "Are you tracking this transaction?" trigger. A faithful port of the
 * reference (txn-rows / track-flow) hub: add to an open contract, start a new
 * one, or step out to labour/daily-wage — each path animating into a
 * confirmation that shows the money moving.
 *
 * Layout / spacing / copy / animation follow the reference; colour + type are
 * mapped onto Briklay's existing ledger tokens (terracotta palette, Georgia
 * display, DM Sans body) so it sits inside the ledger without a font clash.
 *
 * All data flows through ../../lib/trackingApi (the single swappable seam).
 * Scope: WORKER (Work Order) transactions only — vendors keep the PO panel.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOrgId } from '../../lib/auth/AuthProvider';
import { V, font, serif, nums } from './ledgerTokens';
import {
  getTrackingOptions, attachToContract, createContract, markDailyWage, fileAsLabour, splitAcrossPhases,
  generateContractTitle, type OpenContract, type ContractPhase, type TrackTxn,
} from '../../lib/trackingApi';

const rupee = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

// Cubic-ease tween used for the count-down / count-up figures.
function tweenVal(from: number, to: number, dur: number, onStep: (v: number) => void) {
  const t0 = performance.now();
  const tick = (now: number) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    onStep(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// The last segment is the contract's short name ("Farmhouse — RCC structure" → "RCC structure").
const shortContractName = (name: string) => (name.includes(' — ') ? name.split(' — ').pop()! : name);

// A proper, detailed scope example — seeded by the payee's trade so the builder sees
// the kind of detail worth writing (what work, where, what's included). Seeded by the
// transaction note when there is one. The clearer the scope, the better it can be named.
function samplePlaceholder(note: string | null, trade: string | null, projectName: string | null): string {
  const at = projectName ? ` at ${projectName}` : '';
  if (note) return `e.g. ${note}${at} — add what's included so the whole scope is clear (work, where, materials, finishing).`;
  const t = (trade || '').toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/carpen|joinery|wardrobe|kitchen/, `All carpentry & joinery${at} — main & internal doors with frames, windows, wardrobes and staircase railing, including fixing, fittings and finish.`],
    [/mason|brick|block|stone/, `Brick & block masonry for the full structure${at} — external & internal walls, lintels and parapet, including scaffolding and curing, up to slab level.`],
    [/steel|fabricat|weld/, `Steel fabrication & erection${at} — MS railings, grills and staircase, including cutting, welding, primer and on-site installation.`],
    [/electric/, `Complete electrical${at} — concealed conduiting, wiring, switchboards, DB and fixtures across all floors, including testing.`],
    [/plumb|sanitary/, `Plumbing & sanitary for the whole building${at} — concealed lines, drainage, fixtures and fittings, including testing and commissioning.`],
    [/paint|polish/, `Interior & exterior painting${at} — surface prep, putty, primer and two finish coats on all walls, ceilings and grills.`],
    [/tile|marble|granite|floor/, `Flooring & tiling${at} — floor and wall tiles, skirting and staircase, including levelling, fixing and grouting.`],
  ];
  const found = map.find(([re]) => re.test(t));
  return `e.g. ${found ? found[1] : `Describe the full scope${at} — what work, where, and what's included (materials, labour, finishing). The clearer the scope, the better we can name and track it.`}`;
}

type Confirm =
  | { type: 'contract'; title: string; sub: string; total: number; oldBal: number; newBal: number; pay: number }
  | { type: 'nmr'; sub: string; rate: number; days: number; pay: number }
  | { type: 'oneoff'; sub: string };

const Check = (
  <svg viewBox="0 0 24 24" className="ch-check"><path d="M5 13l4 4L19 7" /></svg>
);

export function ContractHub({ txn, onClose, onLinked }: { txn: TrackTxn; onClose: () => void; onLinked: () => void }) {
  const orgId = useOrgId();

  const amount = Number(txn?.total_amount) || 0;
  const payee = txn?.stakeholders?.name || 'this payee';
  const note = (txn?.remarks || '').trim() || null;
  const trade = txn?.stakeholders?.category || null;
  const projectName = txn?.txn_allocations?.[0]?.projects?.name || null;
  const projSuffix = projectName ? ` · ${projectName}` : '';

  const { data, isLoading } = useQuery({
    queryKey: ['trackOptions', txn?.txn_id],
    queryFn: () => getTrackingOptions(txn),
    staleTime: 0,
  });
  const openContracts = data?.openContracts ?? [];

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cval, setCval] = useState('');
  const [cdesc, setCdesc] = useState('');
  const [labourOpen, setLabourOpen] = useState(false);
  const [rate, setRate] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [phasesOpen, setPhasesOpen] = useState(false);
  const [phaseRows, setPhaseRows] = useState<Array<{ id: string; name: string; amount: string }>>([]);
  // A just-created multi-phase contract awaiting "which phase is this payment for?".
  const [pending, setPending] = useState<{ woId: string; total: number; title: string; phases: ContractPhase[] } | null>(null);
  const [naming, setNaming] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  // When open contracts exist, the new-contract form stays behind a button so the list
  // (the likely choice) is the focus; tapping "Create a new contract" reveals it.
  const [creatingNew, setCreatingNew] = useState(false);

  const showDesc = cval.replace(/[^0-9]/g, '').length > 0;
  const contractValue = parseInt(cval.replace(/[^0-9]/g, ''), 10) || 0;
  const allocated = phaseRows.reduce((s, r) => s + (parseInt(r.amount.replace(/[^0-9]/g, ''), 10) || 0), 0);
  const overAllocated = phasesOpen && contractValue > 0 && allocated > contractValue;

  const openPhases = () => {
    setPhasesOpen(true);
    if (phaseRows.length === 0) {
      setPhaseRows([{ id: Math.random().toString(36).slice(2), name: '', amount: '' }, { id: Math.random().toString(36).slice(2), name: '', amount: '' }]);
    }
  };
  const addPhaseRow = () => setPhaseRows((rows) => [...rows, { id: Math.random().toString(36).slice(2), name: '', amount: '' }]);
  const updatePhase = (id: string, field: 'name' | 'amount', value: string) =>
    setPhaseRows((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: field === 'amount' ? value.replace(/[^0-9]/g, '') : value } : r)));
  const removePhase = (id: string) =>
    setPhaseRows((rows) => {
      const next = rows.filter((r) => r.id !== id);
      if (next.length === 0) setPhasesOpen(false);
      return next;
    });

  const fail = (e: unknown) => { setErr((e as { message?: string })?.message || 'Could not do that — try again'); setBusy(false); };

  const addExisting = async (c: OpenContract, milestoneId: string | null) => {
    if (busy) return; setBusy(true); setErr(null);
    try {
      const res = await attachToContract(txn, c, milestoneId);
      setConfirm({ type: 'contract', title: `Added to ${shortContractName(c.name)}`, sub: payee, total: c.total, oldBal: c.balance, newBal: res.balance, pay: amount });
    } catch (e) { fail(e); }
  };

  // Tapping a contract card: one phase → auto-allocate to it; no phases → contract level;
  // many phases → expand the phase picker instead of attaching.
  const onCardTap = (c: OpenContract) => {
    if (c.phases.length > 1) { setExpanded((id) => (id === c.woId ? null : c.woId)); return; }
    addExisting(c, c.phases[0]?.milestoneId ?? null);
  };

  // Split the payment across several phases of an existing contract.
  const splitExisting = async (c: OpenContract, parts: Array<{ milestoneId: string; amount: number }>) => {
    if (busy) return; setBusy(true); setErr(null);
    try {
      await splitAcrossPhases(txn, c.woId, parts, orgId);
      setConfirm({ type: 'contract', title: `Added to ${shortContractName(c.name)}`, sub: payee, total: c.total, oldBal: c.balance, newBal: Math.max(0, c.balance - amount), pay: amount });
    } catch (e) { fail(e); }
  };

  const addNew = async () => {
    if (busy) return;
    const value = contractValue;
    if (!value) { setErr('Enter the agreed contract value first.'); return; }
    if (overAllocated) { setErr('Phases add up to more than the contract value.'); return; }
    const desc = cdesc.trim() || `${note || (trade ? trade + ' work' : 'Full scope')}${projectName ? ` — ${projectName}` : ''}`;
    const phases = phasesOpen
      ? phaseRows
          .map((r) => ({ name: r.name, amount: parseInt(r.amount.replace(/[^0-9]/g, ''), 10) || 0 }))
          .filter((p) => p.amount > 0)
      : [];
    setBusy(true); setErr(null); setNaming(true);
    try {
      const title = await generateContractTitle(desc, trade, projectName);
      setNaming(false);
      const res = await createContract({ orgId, txn, value, description: desc, title, phases: phases.length ? phases : undefined });
      if (res.attached) {
        setConfirm({ type: 'contract', title: 'Contract started', sub: res.title, total: res.total, oldBal: res.total, newBal: res.balance, pay: amount });
      } else {
        // multi-phase: ask which phase this payment belongs to (like an existing contract)
        setPending({ woId: res.woId, total: res.total, title: res.title, phases: res.phases });
        setBusy(false);
      }
    } catch (e) { setNaming(false); fail(e); }
  };

  // Place the payment into a chosen phase of the just-created contract.
  const pickPhase = async (milestoneId: string) => {
    if (busy || !pending) return; setBusy(true); setErr(null);
    const c: OpenContract = { woId: pending.woId, name: pending.title, total: pending.total, balance: pending.total, paidPct: 0, phases: pending.phases };
    try {
      await attachToContract(txn, c, milestoneId);
      setConfirm({ type: 'contract', title: 'Contract started', sub: pending.title, total: pending.total, oldBal: pending.total, newBal: Math.max(0, pending.total - amount), pay: amount });
    } catch (e) { fail(e); }
  };

  // Split the payment across phases of the just-created contract.
  const splitPending = async (parts: Array<{ milestoneId: string; amount: number }>) => {
    if (busy || !pending) return; setBusy(true); setErr(null);
    try {
      await splitAcrossPhases(txn, pending.woId, parts, orgId);
      setConfirm({ type: 'contract', title: 'Contract started', sub: pending.title, total: pending.total, oldBal: pending.total, newBal: Math.max(0, pending.total - amount), pay: amount });
    } catch (e) { fail(e); }
  };

  const addNMR = async () => {
    if (busy) return;
    const r = parseInt(rate.replace(/[^0-9]/g, ''), 10) || 0;
    if (!r) { setErr('Enter the daily rate first.'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await markDailyWage(txn, { rate: r });
      setConfirm({ type: 'nmr', sub: `${payee}${projSuffix}`, rate: res.rate, days: res.days, pay: res.amount });
    } catch (e) { fail(e); }
  };

  const addOneoff = async () => {
    if (busy) return; setBusy(true); setErr(null);
    try {
      await fileAsLabour(txn);
      setConfirm({ type: 'oneoff', sub: `${payee}${projSuffix}` });
    } catch (e) { fail(e); }
  };

  const done = () => { onLinked(); onClose(); };

  if (confirm) return <ConfirmView p={confirm} onDone={done} />;

  // Step 2 for a new multi-phase contract: which phase does this payment belong to?
  if (pending) {
    return (
      <div className="ch-root" style={{ ...font }}>
        <div className="ch-h" style={{ ...serif }}>Which phase is this payment for?</div>
        <div className="ch-help">
          <b>{pending.title}</b> is set up. Place this {rupee(amount)} payment in a phase — you can track the rest as you pay.
        </div>
        <PhasePicker phases={pending.phases} payment={amount} busy={busy} variant="standalone" onPick={pickPhase} onSplit={splitPending} />
        {err && <p className="ch-err">{err}</p>}
      </div>
    );
  }

  // New-contract form: agreed value → reveals description, optional phases, Track balance.
  // Gated behind "Create a new contract" when open contracts exist; shown directly when none.
  const newContractForm = (
    <>
      <div className="ch-optrow">
        <span className="ch-orl">New contract</span>
        <span className="ch-crow">
          <span className="ch-cu">₹</span>
          <input
            inputMode="numeric"
            placeholder="agreed value e.g. 8,00,000"
            value={cval}
            onChange={(e) => setCval(e.target.value.replace(/[^0-9,]/g, ''))}
            style={{ ...nums }}
          />
        </span>
      </div>
      <div className={`ch-newcx${showDesc ? ' ch-newcx--show' : ''}`}>
        <div className="ch-ndlab">What's this contract for? <span>name it so the team recognises it later</span></div>
        <textarea
          className="ch-ndesc"
          rows={2}
          value={cdesc}
          onChange={(e) => setCdesc(e.target.value)}
          placeholder={samplePlaceholder(note, trade, projectName)}
        />

        {/* optional split into phases — a quiet inline reveal, no second form */}
        {phasesOpen ? (
          <div className="ch-phzone">
            <div className="ch-phhead">
              <span>Phases</span>
              <span className={`ch-phalloc${overAllocated ? ' ch-phalloc--over' : ''}`} style={{ ...nums }}>
                {rupee(allocated)} of {rupee(contractValue)}
              </span>
            </div>
            {phaseRows.map((r, i) => (
              <div className="ch-phrow" key={r.id}>
                <input
                  className="ch-phname"
                  value={r.name}
                  onChange={(e) => updatePhase(r.id, 'name', e.target.value)}
                  placeholder={i === 0 ? 'phase name e.g. Foundation' : 'next phase'}
                />
                <span className="ch-phamt">
                  <span className="ch-cu">₹</span>
                  <input inputMode="numeric" value={r.amount} onChange={(e) => updatePhase(r.id, 'amount', e.target.value)} placeholder="amount" style={{ ...nums }} />
                </span>
                <button type="button" className="ch-phx" aria-label="Remove phase" onClick={() => removePhase(r.id)}>×</button>
              </div>
            ))}
            <button type="button" className="ch-phadd" onClick={addPhaseRow}>+ add a phase</button>
            <span className="ch-phbar"><i className={overAllocated ? 'ch-phbar--over' : ''} style={{ width: `${contractValue > 0 ? Math.min(100, (allocated / contractValue) * 100) : 0}%` }} /></span>
          </div>
        ) : (
          <button type="button" className="ch-phlink" onClick={openPhases}>
            Split into phases <span className="ch-phlink-arr">→</span>
          </button>
        )}

        <button type="button" className="ch-cbtn ch-ndbtn" disabled={busy || overAllocated} onClick={addNew}>{naming ? 'Naming your contract…' : 'Link payment'}</button>
        {overAllocated && <span className="ch-phhint">Phases exceed the contract by {rupee(allocated - contractValue)}</span>}
        {!phasesOpen && contractValue > 0 && amount > contractValue && (
          <span className="ch-phhint">This {rupee(amount)} payment is {rupee(amount - contractValue)} more than the contract value.</span>
        )}
      </div>
    </>
  );

  return (
    <div className="ch-root" style={{ ...font }}>
      <div className="ch-h" style={{ ...serif }}>Track this as a contract with {payee}?</div>
      <div className="ch-help">
        A subcontract has a <b>fixed value</b> — we'll show the balance burn down as you pay.
        Daily labour doesn't need this.
      </div>

      {/* THE ONE-TIME EXIT, AT THE HEAD. Moved out of the payment ROW (it made every worker line a
          two-button fork) and off the bottom of this panel (buried under the labour flow). It sits up
          top now, as one calm, complete option: a standalone payout that is simply not a contract. */}
      <button type="button" className="ch-onetime" disabled={busy} onClick={addOneoff}>
        <span className="ch-ot-ic">₹</span>
        <span className="ch-ot-tx">
          <span className="ch-ot-1">One-time payment</span>
          <span className="ch-ot-2">A standalone payout — no contract, nothing to track</span>
        </span>
        <span className="ch-ot-arr">→</span>
      </button>

      {isLoading ? (
        <p className="ch-help" style={{ marginBottom: 0 }}>Looking for open contracts…</p>
      ) : openContracts.length > 0 ? (
        <>
          {/* Existing open contracts — pick one… */}
          <div className="ch-sub">Add to an open contract</div>
          <div className="ch-clist">
            {openContracts.map((c, i) => {
              const multi = c.phases.length > 1;
              const isOpen = expanded === c.woId;
              return (
                <div className="ch-cwrap" key={c.woId}>
                  <button type="button" className="ch-crow2" disabled={busy} onClick={() => onCardTap(c)}>
                    <span className="ch-cnum" style={{ ...nums }}>{i + 1}</span>
                    <span className="ch-cnm">
                      <span className="ch-c1">{shortContractName(c.name)}</span>
                      <span className="ch-c2" style={{ ...nums }}>
                        {c.paidPct}% paid · {payee}{multi ? ` · ${c.phases.length} phases` : ''}
                      </span>
                    </span>
                    <span className="ch-cbal">
                      <span className="ch-cb1" style={{ ...nums }}>{rupee(c.balance)} <i>left</i></span>
                      <span className="ch-barm"><i style={{ width: `${c.paidPct}%` }} /></span>
                      <span className="ch-cbmeta" style={{ ...nums }}>of {rupee(c.total)}</span>
                    </span>
                    <span className="ch-cadd">{multi ? (isOpen ? '▾' : '▸') : '→'}</span>
                  </button>
                  {!multi && amount > c.balance && (
                    <div className="ch-coverflow">This {rupee(amount)} is {rupee(amount - c.balance)} over the {rupee(c.balance)} left on this contract.</div>
                  )}
                  {multi && isOpen && (
                    <PhasePicker phases={c.phases} payment={amount} busy={busy} variant="nested" onPick={(m) => addExisting(c, m)} onSplit={(parts) => splitExisting(c, parts)} />
                  )}
                </div>
              );
            })}
          </div>

          {/* …or create a new one — revealed on tap, so the list stays the focus */}
          {creatingNew ? newContractForm : (
            <button type="button" className="ch-newbtn" onClick={() => setCreatingNew(true)}>
              <span className="ch-newbtn-plus">+</span> Create a new contract
            </button>
          )}
        </>
      ) : (
        <>
          {/* No open contracts for this payee/site — say so, then create as usual */}
          <p className="ch-empty">
            No open contracts with <b>{payee}</b>{projectName ? <> at <b>{projectName}</b></> : null} yet.
          </p>
          {newContractForm}
        </>
      )}

      {/* C — labour exit (quiet inline link) */}
      <div className={`ch-lzone${labourOpen ? ' ch-lzone--open' : ''}`}>
        {labourOpen ? (
          <>
            <div className="ch-lhead">How is the labour paid? <span>— it's not a contract</span></div>
            <div className="ch-optrow">
              <span className="ch-orl">🗓 Daily wage <span className="ch-od">· NMR</span></span>
              <span className="ch-crow">
                <span className="ch-cu">₹</span>
                <input
                  inputMode="numeric"
                  placeholder="rate e.g. 800"
                  value={rate}
                  onChange={(e) => setRate(e.target.value.replace(/[^0-9]/g, ''))}
                  style={{ ...nums }}
                />
                <span className="ch-cu2">/ day</span>
              </span>
              <button type="button" className="ch-cbtn ch-ghost" disabled={busy} onClick={addNMR}>Use this</button>
            </div>
            {/* the one-off exit moved to the head of the panel — this zone is now just the daily-wage path */}
          </>
        ) : (
          <button type="button" className="ch-ltoggle" onClick={() => setLabourOpen(true)}>
            Not a contract? <span className="ch-lr">It's labour or daily wage →</span>
          </button>
        )}
      </div>

      {err && <p className="ch-err">{err}</p>}
    </div>
  );
}

function ConfirmView({ p, onDone }: { p: Confirm; onDone: () => void }) {
  const numRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const pctRef = useRef<HTMLSpanElement>(null);
  const daysRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const reduce = prefersReduced();
    if (p.type === 'contract') {
      const usedNew = p.total > 0 ? Math.round(((p.total - p.newBal) / p.total) * 100) : 0;
      if (reduce) {
        if (numRef.current) numRef.current.textContent = rupee(p.newBal);
        if (barRef.current) barRef.current.style.width = usedNew + '%';
        if (pctRef.current) pctRef.current.textContent = usedNew + '% paid';
      } else {
        if (barRef.current) requestAnimationFrame(() => requestAnimationFrame(() => { if (barRef.current) barRef.current.style.width = usedNew + '%'; }));
        tweenVal(p.oldBal, p.newBal, 1050, (v) => { if (numRef.current) numRef.current.textContent = rupee(v); });
        tweenVal(0, usedNew, 1050, (v) => { if (pctRef.current) pctRef.current.textContent = Math.round(v) + '% paid'; });
      }
    } else if (p.type === 'nmr') {
      if (reduce) { if (daysRef.current) daysRef.current.textContent = String(Math.round(p.days)); }
      else tweenVal(0, p.days, 1000, (v) => { if (daysRef.current) daysRef.current.textContent = v.toFixed(0); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="ch-confirm" style={{ ...font }}>
      <div className="ch-seal">{Check}</div>

      {p.type === 'oneoff' && (
        <>
          <div className="ch-cf-title" style={{ ...serif }}>Filed as labour</div>
          <div className="ch-cf-sub">{p.sub}</div>
          <div className="ch-cf-foot">No tracking object — it just lands in the project's cost breakdown.</div>
        </>
      )}

      {p.type === 'nmr' && (
        <>
          <div className="ch-cf-title" style={{ ...serif }}>Logged as daily wage</div>
          <div className="ch-cf-sub">{p.sub}</div>
          <div className="ch-cf-card">
            <div className="ch-cf-line"><span>Added to the muster</span><span className="ch-pos" style={{ ...nums }}>+ {rupee(p.pay)}</span></div>
            <div className="ch-cf-big">≈ <b ref={daysRef} style={{ ...serif, ...nums }}>0</b> <span>days · at ₹{p.rate}/day</span></div>
          </div>
          <div className="ch-cf-foot">No budget cap — the muster runs on days × rate and keeps accruing.</div>
        </>
      )}

      {p.type === 'contract' && (
        <>
          <div className="ch-cf-title" style={{ ...serif }}>{p.title}</div>
          <div className="ch-cf-sub">{p.sub}</div>
          <div className="ch-cf-card">
            <div className="ch-cf-line"><span>This payment</span><span className="ch-pos" style={{ ...nums }}>+ {rupee(p.pay)}</span></div>
            <div className="ch-cf-big"><b ref={numRef} style={{ ...serif, ...nums }}>{rupee(p.oldBal)}</b> <span>remaining</span></div>
            <div className="ch-cf-bar"><i ref={barRef} /></div>
            <div className="ch-cf-meta"><span ref={pctRef} style={{ ...nums }}>0% paid</span><span style={{ ...nums }}>of {rupee(p.total)}</span></div>
          </div>
        </>
      )}

      <button type="button" className="ch-cf-done" onClick={onDone}>Done</button>
    </div>
  );
}

// The phase chooser, shared by an existing multi-phase contract and a just-created
// one. Tap a phase to place the whole payment (overflow is flagged, never blocked), or
// reveal the distribute editor to split the payment across phases (must sum to the
// payment). Same gesture/markup as the new-contract phase editor.
function PhasePicker({ phases, payment, busy, variant, onPick, onSplit }: {
  phases: ContractPhase[];
  payment: number;
  busy: boolean;
  variant: 'nested' | 'standalone';
  onPick: (milestoneId: string) => void;
  onSplit: (parts: Array<{ milestoneId: string; amount: number }>) => void;
}) {
  const greedy = (): Record<string, string> => {
    const out: Record<string, string> = {};
    let rem = payment;
    phases.forEach((ph, i) => {
      const g = i === phases.length - 1 ? Math.max(0, rem) : Math.min(ph.left, Math.max(0, rem));
      out[ph.milestoneId] = g > 0 ? String(g) : '';
      rem -= g;
    });
    return out;
  };
  const [splitOpen, setSplitOpen] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const open = () => { setAmounts(greedy()); setSplitOpen(true); };
  const setAmt = (id: string, v: string) => setAmounts((a) => ({ ...a, [id]: v.replace(/[^0-9]/g, '') }));
  const sum = phases.reduce((s, ph) => s + (parseInt(amounts[ph.milestoneId] || '0', 10) || 0), 0);
  const parts = phases
    .map((ph) => ({ milestoneId: ph.milestoneId, amount: parseInt(amounts[ph.milestoneId] || '0', 10) || 0 }))
    .filter((p) => p.amount > 0);

  const cls = `ch-phases${variant === 'standalone' ? ' ch-phases--standalone' : ''}`;

  if (splitOpen) {
    return (
      <div className={cls}>
        <div className="ch-phhead">
          <span>Place {rupee(payment)}</span>
          <span className={`ch-phalloc${sum > payment ? ' ch-phalloc--over' : ''}`} style={{ ...nums }}>{rupee(sum)} of {rupee(payment)}</span>
        </div>
        {phases.map((ph) => {
          const amt = parseInt(amounts[ph.milestoneId] || '0', 10) || 0;
          const over = amt > ph.left;
          return (
            <div className="ch-phrow" key={ph.milestoneId}>
              <span className="ch-pnm">{ph.name} <i className="ch-pleftlabel" style={{ ...nums }}>left {rupee(ph.left)}</i></span>
              <span className={`ch-phamt${over ? ' ch-phamt--over' : ''}`}>
                <span className="ch-cu">₹</span>
                <input inputMode="numeric" value={amounts[ph.milestoneId] || ''} onChange={(e) => setAmt(ph.milestoneId, e.target.value)} placeholder="0" style={{ ...nums }} />
              </span>
            </div>
          );
        })}
        <span className="ch-phbar"><i className={sum > payment ? 'ch-phbar--over' : ''} style={{ width: `${payment > 0 ? Math.min(100, (sum / payment) * 100) : 0}%` }} /></span>
        <div className={`ch-diststat${sum !== payment ? ' ch-diststat--off' : ''}`} style={{ ...nums }}>
          {sum === payment ? '✓ fully placed' : sum < payment ? `${rupee(payment - sum)} left to place` : `${rupee(sum - payment)} over`}
        </div>
        <button type="button" className="ch-cbtn ch-ndbtn" disabled={busy || sum !== payment || sum === 0} onClick={() => onSplit(parts)}>Place payment →</button>
      </div>
    );
  }

  return (
    <div className={cls}>
      {variant === 'nested' && <div className="ch-psub">Which phase is this for?</div>}
      {phases.map((ph) => {
        const over = payment > ph.left;
        return (
          <button type="button" key={ph.milestoneId} className="ch-prow" disabled={busy} onClick={() => onPick(ph.milestoneId)}>
            <span className="ch-pnm">{ph.name}</span>
            <span className="ch-pleft" style={{ ...nums }}>
              {rupee(ph.left)} left{over ? <span className="ch-pover"> · {rupee(payment - ph.left)} over</span> : <> of {rupee(ph.planned)}</>}
            </span>
            <span className="ch-padd">+</span>
          </button>
        );
      })}
      <button type="button" className="ch-phlink ch-splitlink" onClick={open}>Split across phases <span className="ch-phlink-arr">→</span></button>
    </div>
  );
}

// Keyframes + structural CSS for the hub. Injected once alongside TRACK_CHIP_CSS.
export const CONTRACT_HUB_CSS = `
.ch-root{padding:20px 20px 18px}
.ch-h{font-size:18px;line-height:1.25;color:${V.ink};margin-bottom:8px;letter-spacing:-.01em}
.ch-help{font-size:12.5px;color:${V.sys};line-height:1.6;max-width:480px;margin-bottom:20px}
.ch-help b{color:${V.terraDeep};font-weight:600}
.ch-sub{font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:${V.faint};margin:0 0 10px}
.ch-onetime{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:${V.field};border:1px solid ${V.line};border-radius:12px;padding:11px 13px;margin:0 0 16px;cursor:pointer;transition:.16s cubic-bezier(.22,1,.36,1);font-family:inherit}
.ch-onetime:hover{border-color:${V.sage};background:${V.sageWash};transform:translateY(-1px);box-shadow:0 8px 20px -14px rgba(60,110,83,.4)}
.ch-onetime:active{transform:translateY(0)}
.ch-onetime:disabled{opacity:.6;cursor:default;transform:none;box-shadow:none}
.ch-ot-ic{width:30px;height:30px;flex:0 0 auto;border-radius:8px;background:${V.surface};border:1px solid ${V.line};display:grid;place-items:center;font-size:14px;font-weight:700;color:${V.sys};transition:.16s}
.ch-ot-tx{flex:1;min-width:0;display:block}
.ch-ot-1{display:block;font-size:13px;font-weight:600;color:${V.ink}}
.ch-ot-2{display:block;font-size:11px;color:${V.faint};margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ch-ot-arr{flex:0 0 auto;color:${V.faint};font-size:15px;transition:.16s}
.ch-onetime:hover .ch-ot-arr{color:${V.sage};transform:translateX(2px)}
.ch-onetime:hover .ch-ot-ic{border-color:${V.sage};color:${V.sage}}
.ch-clist{display:flex;flex-direction:column;gap:9px}
.ch-newbtn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:14px;background:${V.surface};border:1.5px dashed ${V.line};border-radius:12px;padding:13px;font-size:12.5px;font-weight:600;color:${V.terraDeep};cursor:pointer;transition:.16s;font-family:inherit}
.ch-newbtn:hover{border-color:${V.terra};background:${V.terraWash}}
.ch-newbtn-plus{font-size:16px;line-height:1;color:${V.terra}}
.ch-empty{font-size:12.5px;color:${V.sys};line-height:1.55;margin:0 0 15px;padding:12px 14px;background:${V.field};border-radius:12px}
.ch-empty b{color:${V.inkSoft};font-weight:600}
.ch-crow2{display:flex;align-items:center;gap:13px;width:100%;text-align:left;background:${V.surface};border:1px solid ${V.line};border-left:3px solid #ebcab9;border-radius:13px;padding:14px 16px;cursor:pointer;transition:.18s cubic-bezier(.22,1,.36,1);position:relative}
.ch-cnum{font-size:11px;font-weight:600;color:${V.faint};min-width:13px;text-align:right;flex:0 0 auto}
.ch-crow2:hover{border-color:#dba78d;border-left-color:${V.terra};transform:translateY(-1px);box-shadow:0 10px 26px -14px rgba(192,81,44,.45)}
.ch-crow2:active{transform:translateY(0) scale(.995)}
.ch-crow2:disabled{cursor:default;opacity:.6}
.ch-cnm{flex:1;min-width:0;display:block}
.ch-c1{display:block;font-weight:600;font-size:14px;letter-spacing:-.005em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${V.ink}}
.ch-c2{display:block;color:${V.faint};font-size:11.5px;margin-top:3px}
.ch-cbal{text-align:right;flex:0 0 auto;min-width:118px}
.ch-cb1{display:block;font-size:14px;color:${V.terraDeep};font-weight:600;white-space:nowrap}
.ch-cb1 i{font-style:normal;color:${V.faint};font-weight:500;font-size:11px;margin-left:2px}
.ch-barm{display:block;height:6px;border-radius:4px;background:#eee3d4;overflow:hidden;margin-top:7px}
.ch-barm>i{display:block;height:100%;background:linear-gradient(90deg,${V.terra},#dd7d52);border-radius:4px}
.ch-cbmeta{display:block;font-size:10.5px;color:${V.faint};margin-top:5px}
.ch-cadd{color:${V.faint};font-size:17px;flex:0 0 auto;transition:.18s;transform:translateX(-2px)}
.ch-crow2:hover .ch-cadd{color:${V.terra};transform:translateX(2px)}
.ch-cwrap{display:block}
.ch-phases{margin:7px 2px 2px;padding:4px 4px 6px;display:flex;flex-direction:column;gap:3px;border-left:2px solid ${V.line};margin-left:6px;padding-left:10px}
.ch-phases--standalone{border-left:0;margin-left:0;padding-left:0;margin-top:4px}
.ch-psub{font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${V.faint};margin:2px 0 4px}
.ch-prow{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:transparent;border:0;border-radius:9px;padding:9px 11px;cursor:pointer;transition:.14s}
.ch-prow:hover{background:#fffaf4}
.ch-prow:disabled{cursor:default;opacity:.6}
.ch-pnm{flex:1;min-width:0;font-size:13px;color:${V.inkSoft};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ch-pleftlabel{font-style:normal;color:${V.faint};font-weight:400;font-size:11px;margin-left:4px}
.ch-pleft{font-size:11px;color:${V.faint};white-space:nowrap;flex:0 0 auto}
.ch-pover{color:${V.terra};font-weight:600}
.ch-padd{color:${V.terra};font-size:15px;font-weight:600;flex:0 0 auto;line-height:1}
.ch-splitlink{margin-top:9px;padding-left:2px}
.ch-coverflow{margin:6px 2px 2px 9px;font-size:11px;color:${V.terra};line-height:1.45}
.ch-diststat{margin-top:8px;font-size:11.5px;color:${V.sage};font-weight:600}
.ch-diststat--off{color:${V.terra}}
.ch-orline{display:flex;align-items:center;gap:13px;margin:18px 0 14px;color:${V.faint};font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase}
.ch-orline::before,.ch-orline::after{content:"";height:1px;background:${V.line};flex:1}
.ch-optrow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.ch-orl{font-size:12.5px;font-weight:600;color:${V.ink};width:150px;flex:0 0 auto;display:flex;align-items:center;gap:7px}
.ch-od{color:${V.faint};font-weight:400;font-size:11px}
.ch-crow{display:flex;align-items:center;border:1.5px solid ${V.line};border-radius:10px;overflow:hidden;background:${V.surface};flex:1;min-width:150px;max-width:250px;transition:.14s}
.ch-crow:focus-within{border-color:${V.terra};box-shadow:0 0 0 3px rgba(192,81,44,.1)}
.ch-cu{padding:10px 11px;background:${V.field};color:${V.sys};font-weight:600;border-right:1px solid ${V.line}}
.ch-cu2{padding:10px 11px;background:${V.field};color:${V.sys};font-weight:500;border-left:1px solid ${V.line};white-space:nowrap}
.ch-crow input{flex:1;border:0;outline:0;padding:10px 11px;font-size:13.5px;font-weight:500;color:${V.ink};min-width:0;background:transparent}
.ch-cbtn{background:${V.terra};color:#fff;border:0;border-radius:10px;padding:10px 16px;font-size:12px;font-weight:600;cursor:pointer;flex:0 0 auto;transition:.14s}
.ch-cbtn:hover{background:${V.terraDeep};transform:translateY(-1px)}
.ch-cbtn:active{transform:translateY(0)}
.ch-cbtn:disabled{opacity:.6;cursor:default;transform:none}
.ch-ghost{background:${V.surface};border:1.5px solid ${V.terra};color:${V.terraDeep}}
.ch-ghost:hover{background:${V.terraWash}}
.ch-newcx{max-height:0;opacity:0;overflow:hidden;transform:translateY(-5px);transition:max-height .4s cubic-bezier(.22,1,.36,1),opacity .3s ease,transform .3s ease}
.ch-newcx--show{max-height:1200px;opacity:1;transform:none;margin-top:13px}
.ch-ndlab{font-size:12px;font-weight:600;color:${V.ink};margin-bottom:9px}
.ch-ndlab span{color:${V.faint};font-weight:400;font-size:11px}
.ch-ndesc{width:100%;max-width:440px;border:1.5px solid ${V.line};border-radius:11px;padding:11px 13px;font-size:13px;line-height:1.5;font-weight:500;color:${V.ink};background:${V.surface};resize:vertical;outline:0;transition:.14s;display:block;font-family:inherit}
.ch-ndesc:focus{border-color:${V.terra};box-shadow:0 0 0 3px rgba(192,81,44,.1)}
.ch-ndesc::placeholder{color:#c0b6a7}
.ch-ndbtn{margin-top:13px}
.ch-phlink{display:flex;width:fit-content;max-width:100%;align-items:center;gap:6px;margin-top:12px;background:transparent;border:0;padding:0;font-size:12px;font-weight:500;color:${V.sys};cursor:pointer;transition:.14s;font-family:inherit}
.ch-phlink:hover{color:${V.terraDeep}}
.ch-phlink-arr{color:${V.faint};transition:.14s}
.ch-phlink:hover .ch-phlink-arr{color:${V.terra};transform:translateX(2px)}
.ch-phzone{margin-top:14px;animation:chCfIn .26s cubic-bezier(.22,1,.36,1)}
.ch-phhead{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px}
.ch-phhead>span:first-child{font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:${V.faint}}
.ch-phalloc{font-size:11.5px;color:${V.sys}}
.ch-phalloc--over{color:${V.terra};font-weight:600}
.ch-phrow{display:flex;align-items:center;gap:8px;margin-bottom:7px}
.ch-phname{flex:1;min-width:0;border:1.5px solid ${V.line};border-radius:9px;padding:9px 11px;font-size:12.5px;color:${V.ink};background:${V.surface};outline:0;transition:.14s;font-family:inherit}
.ch-phname:focus{border-color:${V.terra};box-shadow:0 0 0 3px rgba(192,81,44,.1)}
.ch-phname::placeholder{color:#c0b6a7}
.ch-phamt{display:flex;align-items:center;border:1.5px solid ${V.line};border-radius:9px;overflow:hidden;background:${V.surface};width:140px;flex:0 0 auto;transition:.14s}
.ch-phamt:focus-within{border-color:${V.terra};box-shadow:0 0 0 3px rgba(192,81,44,.1)}
.ch-phamt--over{border-color:${V.terra}}
.ch-phamt .ch-cu{padding:9px 10px;font-size:12.5px}
.ch-phamt input{flex:1;min-width:0;border:0;outline:0;padding:9px 10px;font-size:12.5px;font-weight:500;color:${V.ink};background:transparent}
.ch-phamt input::placeholder{color:#c0b6a7}
.ch-phx{flex:0 0 auto;background:transparent;border:0;color:${V.faint};font-size:18px;line-height:1;cursor:pointer;padding:0 2px;transition:.14s}
.ch-phx:hover{color:${V.terra}}
.ch-phadd{background:transparent;border:0;padding:2px 0;font-size:12px;font-weight:500;color:${V.terraDeep};cursor:pointer;font-family:inherit}
.ch-phadd:hover{text-decoration:underline}
.ch-phbar{display:block;height:5px;border-radius:4px;background:#eee3d4;overflow:hidden;margin-top:10px}
.ch-phbar>i{display:block;height:100%;background:linear-gradient(90deg,${V.terra},#dd7d52);border-radius:4px;transition:width .35s cubic-bezier(.22,1,.36,1)}
.ch-phbar>i.ch-phbar--over{background:linear-gradient(90deg,#b3402a,#c0512c)}
.ch-phhint{display:block;margin-top:8px;font-size:11px;color:${V.terra}}
.ch-lzone{margin-top:16px;padding-top:14px;border-top:1px solid ${V.line}}
.ch-ltoggle{background:transparent;border:0;padding:0;font-size:12.5px;font-weight:500;color:${V.sys};cursor:pointer;display:inline-flex;align-items:center;gap:7px;transition:.14s}
.ch-ltoggle:hover{color:${V.terraDeep}}
.ch-lr{color:${V.faint};font-weight:400;font-size:12px;display:inline-flex;align-items:center;gap:5px}
.ch-ltoggle:hover .ch-lr{color:${V.terra}}
.ch-lhead{font-size:12.5px;font-weight:600;color:${V.ink};margin-bottom:13px}
.ch-lhead span{color:${V.faint};font-weight:400}
.ch-dismiss{background:transparent;border:0;color:${V.faint};font-size:12.5px;font-weight:500;cursor:pointer;padding:2px;text-align:left;font-family:inherit}
.ch-dismiss:hover{color:${V.sys}}
.ch-oneoff{margin-top:13px;display:block}
.ch-err{margin-top:12px;color:${V.terra};font-size:11.5px;line-height:1.4}

.ch-confirm{display:flex;flex-direction:column;align-items:center;text-align:center;padding:28px 18px 22px;animation:chCfIn .32s cubic-bezier(.22,1,.36,1)}
@keyframes chCfIn{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}
.ch-seal{width:66px;height:66px;border-radius:50%;background:${V.terraWash};display:grid;place-items:center;margin-bottom:15px;position:relative}
.ch-check{width:33px;height:33px}
.ch-check path{stroke:${V.terra};stroke-width:2.7;fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:32;stroke-dashoffset:32;animation:chDraw .55s .12s cubic-bezier(.65,0,.35,1) forwards}
@keyframes chDraw{to{stroke-dashoffset:0}}
.ch-seal::after{content:"";position:absolute;inset:-6px;border-radius:50%;border:2px solid ${V.terra};opacity:0;animation:chRing .85s .05s ease-out forwards}
@keyframes chRing{0%{transform:scale(.55);opacity:.5}100%{transform:scale(1.22);opacity:0}}
.ch-cf-title{font-size:21px;line-height:1.2;color:${V.ink};letter-spacing:-.01em}
.ch-cf-sub{color:${V.faint};font-size:12.5px;margin-top:4px}
.ch-cf-card{margin-top:19px;width:100%;max-width:392px;background:${V.surface};border:1px solid ${V.line};border-radius:15px;padding:16px 18px;text-align:left;box-shadow:0 12px 34px -20px rgba(60,42,28,.34)}
.ch-cf-line{display:flex;justify-content:space-between;align-items:baseline;font-size:12.5px;color:${V.sys}}
.ch-pos{color:${V.terraDeep};font-weight:600}
.ch-cf-big{margin-top:13px;display:flex;align-items:baseline;gap:8px}
.ch-cf-big b{font-size:27px;color:${V.ink};letter-spacing:-.01em}
.ch-cf-big span{color:${V.faint};font-size:12.5px}
.ch-cf-bar{height:8px;border-radius:5px;background:#eee3d4;overflow:hidden;margin-top:14px}
.ch-cf-bar>i{display:block;height:100%;width:0;background:linear-gradient(90deg,${V.terra},#dd7d52);border-radius:5px;transition:width 1.05s cubic-bezier(.22,1,.36,1)}
.ch-cf-meta{display:flex;justify-content:space-between;font-size:11px;color:${V.faint};margin-top:9px}
.ch-cf-done{margin-top:21px;background:${V.terra};color:#fff;border:0;border-radius:11px;padding:11px 30px;font-size:13.5px;font-weight:600;cursor:pointer;transition:.14s}
.ch-cf-done:hover{background:${V.terraDeep}}
.ch-cf-foot{margin-top:13px;font-size:11.5px;color:${V.faint};max-width:360px;line-height:1.5}
@media(prefers-reduced-motion:reduce){
  .ch-confirm{animation:none}
  .ch-check path{animation:none;stroke-dashoffset:0}
  .ch-seal::after{animation:none;opacity:0}
  .ch-cf-bar>i{transition:none}
}
`;
