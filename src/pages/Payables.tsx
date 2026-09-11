/**
 * Payments — the weekly run, drawn as the paymentsrunredesign reference draws it.
 *
 * Three cards, one grammar: who · for, balance b/f, this week, after, and one action. The figure
 * in the middle is editable because the run is a proposal until somebody agrees to it; every other
 * column exists to say where that figure came from and what it leaves behind. A row opens to show
 * the days, the stage readings or the bills underneath it.
 *
 * What the reference could not know, settled with the author:
 *  · WEEK MATRIX is the payee × site grid that landed alongside this work — the same week, pivoted.
 *    The toggle in the nav switches between the two; everything above it is shared.
 *  · Paying a figure that is NOT the computed one still asks why in a popover, not the reference's
 *    two-button strip: paying MORE is an advance (a third answer), and the reason is written onto
 *    the transaction so there is a sentence to read months later.
 *  · ✓ Paid can be undone, and undoing it VOIDS the transaction that was recorded — the one void
 *    the ledger has. It asks first.
 *  · The reference's own ≤720px rules are the phone layout; there is no second design.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useOrgId } from '../lib/auth/AuthProvider';
import { useSnackbar } from '../components/Snackbar';
import { searchPayees } from '../lib/payeeSearch';
import { useSearchScope } from '../components/search/searchScope';
import SearchBar from '../components/search/SearchBar';
import { createParty } from '../components/day-book/fileEntry';
import {
  loadWeeklyPayments, recordWeeklyPayment, settleWeeklyPaymentOnLedger, loadWeeklyPaid,
  undoWeeklyPayment, mondayOf, weekLabel,
  loadRecurring, recurringToRow, addRecurring, removeRecurring, loadVendorRows,
  type PayRow, type PaySection, type RunPaid,
} from '../lib/weeklyPaymentsApi';
import { PYR_CSS } from '../components/payables/pyrCss';
import { isNewLedgerOrg } from '../lib/ledgerRead';
import { addAdjustment } from '../lib/partyLedgerApi';
import { PendingCertifications } from '../components/attendance/PendingCertifications';
import { LedgerCutoverControl } from '../components/attendance/LedgerCutoverControl';
import { useUserProfile } from '../App';
import { RateCardPanel } from '../components/attendance/RateCardPanel';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const MODES = ['UPI', 'NEFT', 'Cash', 'Cheque'];

/** The four site dots the reference paints, in its order. A project takes the next one along. */
const SITE_DOT = ['var(--asm)', 'var(--chak)', 'var(--shyam)', 'var(--sound)'];

type Diff = { kind: 'carry' | 'advance' | 're'; reason: string };
/** A party as the pickers here need it — the stakeholders columns those queries select. */
export interface PartyLite { stakeholder_id: string; name: string; type?: string | null; category?: string | null }

export default function Payables({ session }: { session: Session }) {
  const orgId = useOrgId();
  const { show: showSnackbar } = useSnackbar();
  const { data: profile } = useUserProfile(session.user.id);
  const isManager = profile?.role === 'management' || profile?.role === 'principal';
  const [monday, setMonday] = useState<Date>(() => mondayOf(new Date()));
  const [plan, setPlan] = useState<Record<string, number>>({});
  const [paid, setPaid] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [diffs, setDiffs] = useState<Record<string, Diff>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [why, setWhy] = useState<string | null>(null);       // row key with an open why-popover
  const [mode, setMode] = useState('UPI');
  const [busy, setBusy] = useState<string | null>(null);
  const [extra, setExtra] = useState<Record<string, PayRow[]>>({});  // ad-hoc "Add a payment" rows, per project
  const [view, setView] = useState<'run' | 'matrix'>('run');   // the Run list vs the Week matrix
  const [band, setBand] = useState<'all' | 'workers' | 'vendors' | 'fixed'>('workers');   // matrix band filter
  const [rateOpen, setRateOpen] = useState(false);            // the rate-card overlay (opened from the nav link)
  const navigate = useNavigate();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['weekly_payments', monday.toISOString().slice(0, 10)],
    queryFn: () => loadWeeklyPayments(monday),
  });
  // A past (or future) week is a read-only RECORD of that week's activity — the live balance is "now",
  // so we never let you pay or carry against it here; the ledger holds the live position.
  const readOnly = data ? !data.isCurrentWeek : false;
  const { data: newLedger } = useQuery({
    queryKey: ['org_new_ledger', orgId],
    queryFn: () => isNewLedgerOrg(orgId),
    enabled: !!orgId,
  });
  // What this run has already settled, read back from the payments themselves. Without it a
  // wage row — whose figure comes from the attendance register — returns at its full amount on
  // the next load, with no sign it has been paid.
  const { data: serverPaid = {} as Record<string, RunPaid>, refetch: refetchPaid } = useQuery({
    queryKey: ['weekly_paid', monday.toISOString().slice(0, 10)],
    queryFn: () => loadWeeklyPaid(monday),
  });
  const { data: recurring, refetch: refetchRec } = useQuery({ queryKey: ['recurring_payments'], queryFn: loadRecurring });
  const { data: vendorRows } = useQuery({ queryKey: ['vendor_payables'], queryFn: loadVendorRows });
  const { data: parties } = useQuery({
    queryKey: ['payables_parties'],
    queryFn: async () => (await supabase.from('stakeholders').select('stakeholder_id, name, type, category').order('name')).data ?? [] as any[],
  });
  const { data: projects } = useQuery({
    queryKey: ['projects_active_min'],
    queryFn: async () => (await supabase.from('projects').select('project_id, name').eq('status', 'Active').order('name')).data ?? [],
  });

  // One Workers group (all projects, project shown as a column) + a Vendors section (open bills)
  // + a Recurring & fixed section. Labour is no longer split into a card per project.
  const allSections: PaySection[] = useMemo(() => {
    const labourRows = (data?.sections ?? []).flatMap(s => s.rows);
    const extraRows  = Object.values(extra).flat();
    const workerRows = [...labourRows, ...extraRows]
      .sort((a, b) => a.projectName.localeCompare(b.projectName) || b.thisWeek - a.thisWeek);
    const out: PaySection[] = [];
    if ((data?.sections ?? []).length || workerRows.length)
      out.push({ projectId: '__workers__', projectName: readOnly ? `Workers — ${weekLabel(monday)}` : 'Workers — this week', rows: workerRows });
    if ((vendorRows ?? []).length) out.push({ projectId: '__vendors__', projectName: 'Vendors — bills to pay', rows: vendorRows! });
    const recRows = (recurring ?? []).map(recurringToRow);
    if (recRows.length) out.push({ projectId: '__recurring__', projectName: 'Recurring & fixed', rows: recRows });
    return out;
  }, [data, vendorRows, recurring, extra, readOnly, monday]);

  // The one search filters the run itself — every section's rows at once — and lends what is left
  // to the panel above, which carries the rest of Briklay.
  const [q, setQ] = useState('');
  const sections = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return allSections;
    return allSections
      .map(sec => ({ ...sec, rows: sec.rows.filter(r => `${r.party} ${r.trade ?? ''} ${r.projectName ?? ''} ${r.basis ?? ''}`.toLowerCase().includes(t)) }))
      .filter(sec => sec.rows.length > 0);
  }, [allSections, q]);

  useSearchScope('Payables', useMemo(() => sections.flatMap(sec => sec.rows.map(r => ({
    id: r.key, title: r.party, sub: `${r.trade || ''}${r.projectName ? ' · ' + r.projectName : ''}`.replace(/^ · /, ''),
    onPick: () => setExpanded(new Set([r.key])),
  }))), [sections]), setQ);

  const paidOf = (r: PayRow): number | null => paid[r.key] ?? serverPaid[r.key]?.amount ?? null;
  const planned = (r: PayRow) => paidOf(r) ?? plan[r.key] ?? Math.round(r.thisWeek);
  const owed = (r: PayRow) => r.balanceBf + r.thisWeek;
  const afterOf = (r: PayRow, isPaid: boolean): { v: number; m: string; cls: string } | null => {
    // "This week's figure is actually ₹X" (re-agreed): the paid amount IS the correct figure, so the
    // difference is NOT carried/advanced — only any prior balance remains. Otherwise the shortfall/
    // surplus carries as usual (kind 'carry' / 'advance', or an unexplained change).
    const reAgreed = diffs[r.key]?.kind === 're';
    const thisWeekFig = reAgreed ? planned(r) : r.thisWeek;
    const rem = (r.balanceBf + thisWeekFig) - planned(r);
    if (isPaid) {
      if (Math.abs(rem) < 1) return { v: 0, m: 'settled', cls: 'zero' };
      return rem > 0 ? { v: rem, m: 'carried', cls: '' } : { v: -rem, m: 'advance to them', cls: '' };
    }
    // Not paid yet — never say "settled". A pure wage row has no running balance to show.
    if (r.balanceBf < 1 && Math.abs(rem) < 1) return null;
    if (Math.abs(rem) < 1) return { v: 0, m: 'clears the balance', cls: 'zero' };
    return rem > 0 ? { v: rem, m: 'would carry', cls: '' } : { v: -rem, m: 'advance', cls: '' };
  };

  const totals = useMemo(() => {
    let pl = 0, pd = 0, n = 0;
    sections.forEach(s => s.rows.forEach(r => { pl += planned(r); const done = paidOf(r); if (done) pd += done; else if (planned(r)) n++; }));
    return { planned: pl, paid: pd, left: pl - pd, count: n };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, plan, paid, serverPaid]);

  // The matrix view's headline retotals to the chosen band (the mock's stats follow the filter).
  const matrixBandOf = (pid: string) => pid === '__vendors__' ? 'vendors' : pid === '__recurring__' ? 'fixed' : 'workers';
  const matrixStats = useMemo(() => {
    let pl = 0, pd = 0;
    allSections.forEach(sec => {
      if (band !== 'all' && matrixBandOf(sec.projectId) !== band) return;
      sec.rows.forEach(r => { pl += Math.round(r.thisWeek); pd += (paidOf(r) || 0); });
    });
    return { planned: pl, paid: pd, left: pl - pd };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSections, band, paid, serverPaid]);
  const headStats = view === 'matrix' ? matrixStats : totals;

  // The one place a payment is recorded. The desktop row and the phone's pay sheet both come
  // through here, so a payment made on a phone is the same transaction, settled the same way.
  const payRow = async (r: PayRow, amt: number, reason: string, note: string) => {
    if (!amt) return;
    setBusy(r.key);
    try {
      const txnId = await recordWeeklyPayment(orgId, r, amt, mode, reason, monday, note);
      if (newLedger) { try { await settleWeeklyPaymentOnLedger(txnId, r, amt, monday); } catch (e: any) { showSnackbar(`Paid, but ledger link failed: ${e?.message || 'error'}`, { type: 'error' }); } }
      setPaid(p => ({ ...p, [r.key]: amt }));
      showSnackbar(`Paid ${inr(amt)} to ${r.party}`);
      refetch(); refetchPaid();
    } catch (e: any) {
      showSnackbar(e?.message || 'Could not record the payment', { type: 'error' });
      throw e;                                   // the sheet keeps itself open so it can be retried
    } finally { setBusy(null); }
  };
  const doPay = (r: PayRow) => payRow(r, planned(r), diffs[r.key]?.reason || '', notes[r.key] ?? '').catch(() => {});

  // ✓ Paid, clicked again. The row was marked by RECORDING a transaction, so taking it back is
  // voiding that transaction — asked for once, because it is money either way.
  const undoRow = async (r: PayRow) => {
    const ids = serverPaid[r.key]?.txnIds ?? [];
    if (!ids.length) { setPaid(p => { const n = { ...p }; delete n[r.key]; return n; }); return; }
    if (!window.confirm(`Undo the ${inr(paidOf(r) || 0)} paid to ${r.party}? The payment is voided on the ledger.`)) return;
    setBusy(r.key);
    try {
      await undoWeeklyPayment(ids);
      setPaid(p => { const n = { ...p }; delete n[r.key]; return n; });
      showSnackbar(`Payment to ${r.party} voided`);
      refetch(); refetchPaid();
    } catch (e) { showSnackbar((e as Error)?.message || 'Could not undo that payment', { type: 'error' }); }
    finally { setBusy(null); }
  };

  /** Nothing was earned this week, but something is owed from before: the amount typed is against
   *  the carry, not a departure from a computed figure. */
  const againstCarry = (r: PayRow) => Math.round(r.thisWeek) === 0 && r.balanceBf > 0.5;

  const onMark = (r: PayRow) => {
    if (!againstCarry(r) && Math.abs(planned(r) - r.thisWeek) >= 1 && !diffs[r.key]) { setWhy(r.key); return; }
    doPay(r);
  };

  const shiftWeek = (d: number) => setMonday(m => { const x = new Date(m); x.setDate(x.getDate() + d * 7); return x; });


  // Every project gets one of the reference's four dots, and keeps it across sections.
  const dotOf = (() => {
    const seen = new Map<string, string>();
    return (projectId: string) => {
      if (!seen.has(projectId)) seen.set(projectId, SITE_DOT[seen.size % SITE_DOT.length]);
      return seen.get(projectId)!;
    };
  })();

  /** Every site this row's money touches. A wage row is one; a vendor's bills can be several. */
  const sitesOf = (r: PayRow): { id: string; name: string }[] => {
    const seen = new Map<string, string>();
    (r.bills ?? []).forEach(b => { if (b.projectId && b.projectName) seen.set(b.projectId, b.projectName); });
    if (!seen.size && r.projectName) seen.set(r.projectId, r.projectName);
    return [...seen].map(([id, name]) => ({ id, name }));
  };

  // Where a row's "open ledger" / "open bills" link goes.
  const openSource = (r: PayRow) => {
    if (r.bills && r.stakeholderId) navigate(`/bills?party=${r.stakeholderId}`);
    else if (r.stakeholderId) navigate(`/ledger?stakeholder=${r.stakeholderId}`);
  };

  // The detail line, in the reference's shape: the days of the week for a wage row, the stage
  // readings for a contract, the bills for a vendor — whatever produced the figure — and then the
  // arithmetic that landed on it. The old expansion said the same things in a two-column box; the
  // reference gives one line of `em`-labelled pairs, and everything fits in it.
  const dline = (r: PayRow): React.ReactNode[] => {
    const out = sourceLine(r);
    const arith = (r.att?.ledger ?? r.stage?.ledger ?? []) as [string, number][];
    arith.forEach(([t, v], i) => out.push(<span key={`a${i}`}><em>{t.toLowerCase()}</em>{v < 0 ? `− ${inr(-v)}` : inr(v)}</span>));
    out.push(<span key="tw"><em>this week</em>{inr(Math.round(r.thisWeek))}</span>);
    const amt = planned(r), d = Math.round(r.thisWeek) - amt;
    if (Math.abs(d) >= 1) {
      const dk = diffs[r.key];
      out.push(<span key="pay"><em>paying</em>{inr(amt)}{dk
        ? ` · ${dk.kind === 'carry' ? `${inr(Math.abs(d))} carried` : dk.kind === 'advance' ? `${inr(Math.abs(d))} advance` : 're-agreed'}${dk.reason ? ` — ${dk.reason}` : ''}`
        : ' · say why'}</span>);
    }
    return out;
  };

  const sourceLine = (r: PayRow): React.ReactNode[] => {
    if (r.att) {
      const out = r.att.days.map((dn, i) => {
        const cells = r.att!.cats.map(c => c.cells[i]).filter((v): v is number => !!v);
        return cells.length ? <span key={dn}><em>{dn.toLowerCase()}</em>{cells.join('+')}</span> : null;
      }).filter(Boolean) as React.ReactNode[];
      out.push(<span key="rate"><em>rate</em>{r.att.cats.map(c => `${c.name.toLowerCase()} ₹${c.rate}`).join(' · ')}</span>);
      return out;
    }
    if (r.stage) return r.stage.readings.map(([n, m, v], i) => <span key={i}><em>{n.toLowerCase()}</em>{m} · {inr(v)}</span>);
    if (r.bills) return r.bills.map((b, i) => (
      <span key={i}><em>bill {b.no}</em>{inr(b.balance)}{b.date ? ` · ${new Date(b.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }).toLowerCase()}` : ''}</span>
    ));
    if (r.kind === 'recurring') return [<span key="c"><em>cycle</em>{r.basis}</span>];
    return [<span key="b"><em>basis</em>{r.basis}</span>];
  };

  const SEC_FOOT: Record<string, string> = { __workers__: 'workers', __vendors__: 'vendors', __recurring__: 'recurring' };
  const rowsAll = sections.flatMap(s2 => s2.rows);
  const paidCount = rowsAll.filter(r => paidOf(r) != null).length;

  return (
    <div className="pyr-page">
    <div className="pyr">
      <style>{PYR_CSS}</style>
      <div className="wrap">

        <div className="masthead">
          <h1>Payments</h1>
          <div className="stats">
            <div className="stat"><b>{inr(headStats.planned)}</b><span>planned</span></div>
            <div className="stat pd"><b>{inr(headStats.paid)}</b><span>paid</span></div>
            <div className="stat due"><b>{inr(headStats.left)}</b><span>still to pay</span></div>
          </div>
        </div>

        <div className="nav">
          <div className="wk">
            <button className="arrow" aria-label="Previous week" onClick={() => shiftWeek(-1)}>‹</button>
            <b>{weekLabel(monday)}</b>
            <button className="arrow" aria-label="Next week" onClick={() => shiftWeek(1)}>›</button>
          </div>
          <a onClick={() => setMonday(mondayOf(new Date()))} role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') setMonday(mondayOf(new Date())); }}
            style={{ cursor: 'pointer' }}>this week</a>
          {/* The day rates that produced the labour figures — a link here, opened over the page. */}
          {orgId && <a className="ratelink" onClick={() => setRateOpen(true)} role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') setRateOpen(true); }} style={{ cursor: 'pointer' }}>rate card</a>}
          <div className="toggle" role="tablist">
            <button className={view === 'run' ? 'on' : ''} role="tab" aria-selected={view === 'run'} onClick={() => setView('run')}>Run</button>
            {/* The same week, pivoted: who is owed what, on which site. */}
            <button className={view === 'matrix' ? 'on' : ''} role="tab" aria-selected={view === 'matrix'} onClick={() => setView('matrix')}>Week matrix</button>
          </div>
        </div>

        <div className="searchrow">
          <SearchBar label="the run" />
          <span className="s-count">{q.trim() ? `${rowsAll.length} row${rowsAll.length === 1 ? '' : 's'}` : ''}</span>
        </div>

        {view === 'matrix' && (
          <div className="chips">
            {([['all', 'All'], ['workers', 'Workers'], ['vendors', 'Vendors'], ['fixed', 'Recurring & staff']] as const).map(([k, label]) => (
              <button key={k} className={`chip-f${band === k ? ' on' : ''}`} onClick={() => setBand(k)}>{label}</button>
            ))}
          </div>
        )}

        {orgId && <div className="cutover"><LedgerCutoverControl orgId={orgId} isManager={isManager} /></div>}
        {readOnly && <div className="readonly">A past week — a record of what was logged and paid then. The live balance is on each party&apos;s ledger.</div>}

        {/* Work awaiting sign-off — approving here mints the obligation into the run below. It draws
            nothing when the inbox is empty, so it gets no card of its own to leave behind. */}
        {view === 'run' && orgId && session.user?.id && <PendingCertifications orgId={orgId} userId={session.user.id} />}

        {isLoading && <div className="state">Loading the week…</div>}
        {error && <div className="state" style={{ color: 'var(--red)' }}>Could not load — {(error as { message?: string } | null)?.message || 'try again'}</div>}
        {!isLoading && !error && sections.length === 0 && <div className="state">No active projects yet — create a project to start the payment run.</div>}

        {/* ═══ WEEK MATRIX — payee × site, bands, live totals (see payments-week-matrix mock) ═══ */}
        {view === 'matrix' && !isLoading && !error && sections.length > 0 && (
          <WeekMatrix allSections={allSections} paidOf={paidOf} band={band} />
        )}

        {view === 'run' && sections.map(section => {
          const sPlan = section.rows.reduce((a, r) => a + planned(r), 0);
          const sLeft = section.rows.reduce((a, r) => a + (paidOf(r) != null ? 0 : planned(r)), 0);
          return (
            <div className="card-sec" key={section.projectId}>
              <div className="sec-head">
                <h2>{section.projectId === '__workers__' ? 'Workers' : section.projectName}</h2>
                <span className="tot">{inr(sPlan)}<small>this week</small></span>
              </div>
              <div className="colkey"><span>who · for</span><span>balance b/f</span><span>this week</span><span>after</span><span /></div>

              {section.rows.length === 0 && section.projectId === '__workers__' &&
                <div className="emptyrow">No labour on the attendance sheet this week — add a payment below.</div>}

              {section.rows.map(r => {
                const settled = paidOf(r), isPaid = settled != null, isExp = expanded.has(r.key);
                const af = afterOf(r, isPaid), amt = planned(r);
                // A row with no work this week is being paid against what it carries — there is no
                // computed figure to differ from, so nothing to explain. The "after" column already
                // says what the payment leaves behind.
                const unexplained = !againstCarry(r) && Math.abs(amt - r.thisWeek) >= 1 && !diffs[r.key];
                const working = busy === r.key;
                return (
                  <div className={`prow${isPaid ? ' paid' : ''}${isExp ? ' open' : ''}${!amt ? ' zero' : ''}`} key={r.key} data-search-row={r.key}>
                    <div className="prow-main" onClick={(e) => {
                      if ((e.target as HTMLElement).closest('input,button,a,select,.amt-wrap')) return;
                      setExpanded(s2 => { const n = new Set(s2); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; });
                    }}>
                      <div className="pwho">
                        <div className="avatar">{(r.party.trim()[0] || '?').toUpperCase()}</div>
                        <div className="id">
                          <span className="nm">{r.party}
                            {/* A vendor's open bills can sit on more than one site, and the row is one
                                net payable across all of them — so it wears a chip for each. */}
                            {sitesOf(r).map(sn => <span className="site" key={sn.id} style={{ ['--site-c' as string]: dotOf(sn.id) }}>{sn.name}</span>)}
                          </span>
                          <span className="why">
                            {r.trade ? `${r.trade} · ` : ''}{r.basis}
                            {(r.advance ?? 0) > 0.5 && ` · ${inr(r.advance!)} paid ahead`}
                            {(r.withoutBills ?? 0) > 0.5 && ` · ${inr(r.withoutBills!)} paid without bills`}
                            {r.stakeholderId && <> · <a onClick={() => openSource(r)} role="button" tabIndex={0}
                              onKeyDown={(e) => { if (e.key === 'Enter') openSource(r); }} style={{ cursor: 'pointer' }}>
                              {r.bills ? 'open bills' : 'open ledger'}</a></>}
                          </span>
                        </div>
                      </div>

                      <div className={`bf${r.balanceBf ? '' : ' none'}`}>
                        {r.balanceBf ? <>{inr(r.balanceBf)}<small>carried</small></> : '—'}
                      </div>

                      <div className="amt-wrap">
                        <span className="cur">₹</span>
                        {isPaid || readOnly
                          ? <input value={(isPaid ? settled! : Math.round(r.thisWeek) || 0).toLocaleString('en-IN')} readOnly tabIndex={-1} />
                          : <input inputMode="numeric" value={amt ? amt.toLocaleString('en-IN') : ''} placeholder="0"
                              onFocus={(e) => e.currentTarget.select()}
                              onChange={(e) => { const v = parseInt(e.target.value.replace(/[^\d]/g, ''), 10) || 0; setPlan(p => ({ ...p, [r.key]: v })); setDiffs(d => { const n = { ...d }; delete n[r.key]; return n; }); }}
                              onBlur={() => { window.setTimeout(() => { if (!paid[r.key] && !againstCarry(r) && Math.abs(planned(r) - r.thisWeek) >= 1 && !diffs[r.key] && why !== r.key) setWhy(r.key); }, 120); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />}
                        {why === r.key && !isPaid && (
                          <WhyPopover row={r} planned={amt} owed={owed(r)}
                            onPutBack={() => { setPlan(p => ({ ...p, [r.key]: Math.round(r.thisWeek) })); setDiffs(d => { const n = { ...d }; delete n[r.key]; return n; }); setWhy(null); }}
                            onDone={(diff) => { setDiffs(d => ({ ...d, [r.key]: diff })); setWhy(null); }} />
                        )}
                      </div>

                      <div className={`after${af ? '' : ' none'}`}>
                        {af ? <>{inr(af.v)}<small>{af.m}</small></> : '—'}
                      </div>

                      <div className="act">
                        {readOnly && !isPaid
                          ? <button className="paybtn" disabled>record</button>
                          : <button className={`paybtn${working ? ' working' : ''}`}
                              disabled={!isPaid && (!amt || unexplained)}
                              title={unexplained ? 'say what the difference is first' : isPaid ? 'click to undo — this voids the payment' : ''}
                              onClick={(e) => { e.stopPropagation(); if (isPaid) void undoRow(r); else onMark(r); }}>
                              {working ? 'Paying' : isPaid ? '✓ Paid' : 'Mark paid'}
                            </button>}
                      </div>

                      {/* The reference asks about a difference here; Briklay asks in the popover above. */}
                      <div className="ask" />
                    </div>

                    <div className="detail">
                      <div className="dline">{dline(r)}</div>
                      <div className="note">
                        <input placeholder="note — kept with this row…" value={notes[r.key] ?? ''} disabled={isPaid}
                          onChange={(e) => setNotes(n => ({ ...n, [r.key]: e.target.value }))} />
                      </div>
                    </div>
                  </div>
                );
              })}

              {section.projectId === '__workers__' && (
                <AddPaymentRow projects={(projects ?? []) as { project_id: string; name: string }[]} parties={(parties ?? []) as PartyLite[]} orgId={orgId}
                  onError={(m) => showSnackbar(m, { type: 'error' })}
                  onPersisted={() => { showSnackbar('Payment request added to the ledger'); refetch(); }}
                  onAdd={(row) => setExtra(x => ({ ...x, [row.projectId]: [...(x[row.projectId] ?? []), row] }))} />
              )}

              <div className="sec-foot">
                <span>{SEC_FOOT[section.projectId] ?? 'this section'} · still to pay</span>
                <b className="sf">{inr(sLeft)}</b>
              </div>
            </div>
          );
        })}

        {view === 'run' && <RecurringManager orgId={orgId} recurring={recurring ?? []} projects={(projects ?? []) as { project_id: string; name: string }[]}
          onChanged={() => refetchRec()} onError={(m) => showSnackbar(m, { type: 'error' })} />}

        {view === 'run' && <div className="closing">
          <span className="l">The run closes when every row is marked.</span>
          <span className="r">
            <span>{paidCount} of {rowsAll.length} paid</span>
            <span className="paybyc">pay by
              <select value={mode} onChange={(e) => setMode(e.target.value)}>{MODES.map(m => <option key={m}>{m}</option>)}</select>
            </span>
            <span>still to pay <b>{inr(totals.left)}</b></span>
          </span>
        </div>}

      </div>

      {/* The rate card, opened over the run rather than sitting inside it. */}
      {rateOpen && orgId && (
        <div className="rate-ov" onClick={() => setRateOpen(false)}>
          <div className="rate-modal" onClick={(e) => e.stopPropagation()}>
            <button className="rate-x" onClick={() => setRateOpen(false)} aria-label="Close">✕</button>
            <RateCardPanel orgId={orgId} isManager={isManager} />
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

// Manage the standing recurring/fixed lines that surface on the run each week.
function RecurringManager({ orgId, recurring, projects, onChanged, onError, defaultOpen = false }: {
  orgId: string; recurring: import('../lib/weeklyPaymentsApi').Recurring[];
  projects: { project_id: string; name: string }[]; onChanged: () => void; onError: (m: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [f, setF] = useState({ project_id: '', who: '', party: '', label: '', amount: '', cadence: 'weekly' as 'weekly' | 'monthly' });
  const [busy, setBusy] = useState(false);
  const { data: parties } = useQuery({
    queryKey: ['payables_parties'],
    queryFn: async () => (await supabase.from('stakeholders').select('stakeholder_id, name, type').order('name')).data ?? [],
  });
  const amt = parseInt((f.amount || '').replace(/[^\d]/g, ''), 10) || 0;
  const whoOk = f.who && (f.who !== '__other' || f.party.trim());
  const ready = !!f.project_id && !!whoOk && amt > 0;
  const add = async () => {
    if (!ready) return; setBusy(true);
    const picked = (parties ?? []).find((p: any) => p.stakeholder_id === f.who) as any;
    const partyName = f.who === '__other' ? f.party.trim() : (picked?.name || '');
    const stakeholderId = f.who === '__other' ? null : f.who;
    try {
      await addRecurring(orgId, { projectId: f.project_id, stakeholderId, partyName, label: f.label.trim(), amount: amt, cadence: f.cadence, category: 'Recurring' });
      setF({ project_id: '', who: '', party: '', label: '', amount: '', cadence: 'weekly' }); setOpen(false); onChanged();
    } catch (e: any) { onError(e?.message || 'Could not add the recurring payment'); } finally { setBusy(false); }
  };
  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Stop the recurring payment for ${name}?`)) return;
    try { await removeRecurring(id); onChanged(); } catch (e: any) { onError(e?.message || 'Could not remove'); }
  };
  return (
    <div className="card-sec">
      <div className="sec-head"><h2>Recurring &amp; fixed — manage</h2><span className="tot">{recurring.length}<small>standing line{recurring.length !== 1 ? 's' : ''}</small></span></div>
      <div className="recbody">
        {recurring.map(r => (
          <div className="recitem" key={r.id}>
            <span><b>{r.partyName}</b>{r.label ? ` · ${r.label}` : ''} <span className="rm-proj">· {r.projectName} · {r.cadence}</span></span>
            <span className="mono">{inr(r.amount)}</span>
            <button className="rm-x" title="Stop this recurring payment" onClick={() => remove(r.id, r.partyName)}>×</button>
          </div>
        ))}
        {recurring.length === 0 && <div className="recitem" style={{ color: 'var(--walnut-3)' }}>No recurring payments yet — add rent, a watchman, a utility, a weekly supervisor.</div>}
        {open ? (
          <div className="recform">
            <select value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}><option value="">Project…</option>{projects.map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}</select>
            <select value={f.who} onChange={(e) => setF({ ...f, who: e.target.value })}>
              <option value="">Who…</option>
              {(parties ?? []).map((p: any) => <option key={p.stakeholder_id} value={p.stakeholder_id}>{p.name}{p.type ? ` · ${p.type}` : ''}</option>)}
              <option value="__other">Other (a utility, rent)…</option>
            </select>
            {f.who === '__other' && <input placeholder="Name — e.g. Office rent, Power bill" value={f.party} onChange={(e) => setF({ ...f, party: e.target.value })} />}
            <input placeholder="note (optional)" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
            <input className="amt mono" placeholder="₹ amount" inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            <select value={f.cadence} onChange={(e) => setF({ ...f, cadence: e.target.value as 'weekly' | 'monthly' })}><option value="weekly">weekly</option><option value="monthly">monthly</option></select>
            <button className="go" disabled={!ready || busy} onClick={add}>{busy ? '…' : 'Add'}</button>
            <button className="x" onClick={() => setOpen(false)}>cancel</button>
          </div>
        ) : (
          <button className="addreq" onClick={() => setOpen(true)}>+ Add a recurring payment</button>
        )}
      </div>
    </div>
  );
}

// A type-to-search party picker — ranked suggestions + "create new", the same pattern the
// transaction payee field and the attendance add flow use. Scoped to workers here.
function PartySearch({ parties, orgId, onPick, onError }: { parties: any[]; orgId: string; onPick: (p: { id: string | null; name: string }) => void; onError: (m: string) => void }) {
  const [q, setQ] = useState('');
  const [openList, setOpenList] = useState(false);
  const [busy, setBusy] = useState(false);
  const workers = useMemo(() => parties.filter(p => p.type === 'Worker'), [parties]);
  const matches = (q.trim() ? searchPayees(workers as any, q) : workers).slice(0, 8);
  const pick = (p: { id: string | null; name: string }) => { setQ(p.name); setOpenList(false); onPick(p); };
  const create = async () => {
    if (busy || !q.trim()) return; setBusy(true);
    try { const c = await createParty(q.trim(), 'Worker', orgId); pick({ id: c.id, name: c.name }); }
    catch (e: any) { onError(e?.message || 'Could not create the party'); } finally { setBusy(false); }
  };
  return (
    <div className="psrch">
      <input value={q} placeholder="Search a worker…" autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setOpenList(true); onPick({ id: null, name: '' }); }}
        onFocus={() => setOpenList(true)} onBlur={() => setTimeout(() => setOpenList(false), 150)} />
      {openList && (
        <div className="psrch-menu">
          {matches.map((m: any) => (
            <button key={m.stakeholder_id} className="psrch-item" onMouseDown={(e) => { e.preventDefault(); pick({ id: m.stakeholder_id, name: m.name }); }}>{m.name}{m.category ? <small> · {m.category}</small> : null}</button>
          ))}
          {q.trim() && <button className="psrch-item psrch-create" onMouseDown={(e) => { e.preventDefault(); create(); }}>{matches.length ? 'Not here? ' : ''}Create <b>{q.trim()}</b> · new worker</button>}
          {!q.trim() && matches.length === 0 && <div className="psrch-empty">Type a name to search…</div>}
        </div>
      )}
    </div>
  );
}

// "Add a payment request" — an ad-hoc row for something the register doesn't know. Now that all
// workers live in one group, the payment must say which site it belongs to, so it carries a project picker.
function AddPaymentRow({ projects, parties, orgId, onError, onAdd, onPersisted, defaultOpen = false }: { projects: { project_id: string; name: string }[]; parties: any[]; orgId: string; onError: (m: string) => void; onAdd: (row: PayRow) => void; onPersisted?: () => void; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [projectId, setProjectId] = useState('');
  const [picked, setPicked] = useState<{ id: string | null; name: string }>({ id: null, name: '' });
  const [amount, setAmount] = useState(''); const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const amt = parseInt(amount.replace(/[^\d]/g, ''), 10) || 0;
  const ready = !!projectId && !!picked.name.trim() && amt > 0;
  const add = async () => {
    if (!ready || busy) return;
    const projectName = projects.find(p => p.project_id === projectId)?.name || projectId;
    // A payment request for a KNOWN party is a real obligation — persist it as a certified-side party
    // adjustment so it enters the ledger (v_party_balance → the party page + this run's carry) and can be
    // removed later. Only a party-less request stays an ephemeral local row.
    if (picked.id) {
      setBusy(true);
      try {
        await addAdjustment(orgId, picked.id, { projectId, adjDate: new Date().toISOString().slice(0, 10), side: 'certified', amount: amt, note: note.trim() || 'Payment request' });
        setProjectId(''); setPicked({ id: null, name: '' }); setAmount(''); setNote(''); setOpen(false);
        onPersisted?.();
      } catch (e) { onError((e as Error)?.message || 'Could not add the payment request'); }
      finally { setBusy(false); }
      return;
    }
    onAdd({ key: `x-${projectId}-${Date.now()}`, projectId, projectName, stakeholderId: picked.id, party: picked.name.trim(), trade: note.trim() || 'added here', kind: 'wages', basis: 'added here · not from the register', thisWeek: amt, balanceBf: 0, woId: null, milestoneId: null });
    setProjectId(''); setPicked({ id: null, name: '' }); setAmount(''); setNote(''); setOpen(false);
  };
  return (
    <div className="addreq-wrap">
      {open ? (
        <div className="addform">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">Site…</option>{projects.map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}</select>
          <PartySearch parties={parties} orgId={orgId} onPick={setPicked} onError={onError} />
          <input className="amt mono" placeholder="₹ amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className="note" placeholder="for what — e.g. advance, flat 501 tiles" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="go" disabled={!ready || busy} onClick={add}>{busy ? 'Adding…' : 'Add payment'}</button>
          <button className="x" onClick={() => setOpen(false)}>cancel</button>
        </div>
      ) : (
        <button className="addreq" onClick={() => setOpen(true)}>+ Add a payment request</button>
      )}
    </div>
  );
}

// The "why is it different" popover.
function WhyPopover({ row, planned, onPutBack, onDone }: { row: PayRow; planned: number; owed: number; onPutBack: () => void; onDone: (d: Diff) => void }) {
  const d = row.thisWeek - planned;
  const less = d > 0;
  const opts: [Diff['kind'], string, string][] = less
    ? [['carry', 'Still owed to them', `${inr(d)} of this week's work carries to next week`], ['re', `This week's figure is actually ${inr(planned)}`, 'Not the computed amount — say why below']]
    : [['advance', 'Advance on next week', `${inr(-d)} over this week's work — recovers next week`], ['re', `This week's figure is actually ${inr(planned)}`, 'Not the computed amount — say why below']];
  const [kind, setKind] = useState<Diff['kind']>(opts[0][0]);
  const [reason, setReason] = useState('');
  const needReason = kind === 're';
  return (
    <div className="pop" onClick={(e) => e.stopPropagation()}>
      <div className="h">This week's figure is <b className="mono">{inr(row.thisWeek)}</b>. Paying <b className="mono">{inr(planned)}</b> — the {inr(Math.abs(d))} {less ? 'less' : 'more'} is…</div>
      {opts.map(([k, t, dd]) => (
        <label key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
          <input type="radio" checked={kind === k} onChange={() => setKind(k)} />
          <span><div className="t">{t}</div><div className="d">{dd}</div></span>
        </label>
      ))}
      {needReason && <textarea className="why" rows={2} placeholder="Why is it different? e.g. 2nd floor plaster redone at their cost" value={reason} onChange={(e) => setReason(e.target.value)} />}
      <div className="acts"><button className="cancel" onClick={onPutBack}>put it back</button><button className="ok" disabled={needReason && !reason.trim()} onClick={() => onDone({ kind, reason: reason.trim() })}>Done</button></div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WEEK MATRIX — payee × site, banded (Workers / Vendors / Recurring), with live totals.
// Mock: payments-week-matrix.html. Pivots the run's `allSections` (party × site rows) into a grid;
// Mark-paid is the SAME real payment as the run (doPay).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const SITE_PALETTE = ['#B5472F', '#7C8B72', '#B9892C', '#5D7183', '#8A6A9B', '#4F8A8B', '#C08552', '#6B7A4F'];
const BAND_DEFS: { key: 'workers' | 'vendors' | 'fixed'; label: string; pid: string }[] = [
  { key: 'workers', label: 'Workers', pid: '__workers__' },
  { key: 'vendors', label: 'Vendors — bills to pay', pid: '__vendors__' },
  { key: 'fixed', label: 'Recurring & fixed', pid: '__recurring__' },
];
interface MxCell { rows: PayRow[]; thisWeek: number; paid: number; meta: string }
interface MxPayee { key: string; name: string; meta: string; cells: Record<string, MxCell>; due: number; paid: number }

// How a cell's figure is worked out — the lines shown when a card is expanded.
function cellDerivation(c: MxCell): { lines: [string, number][]; total: number } {
  const lines: [string, number][] = [];
  c.rows.forEach(r => {
    if (r.att) r.att.ledger.forEach(([l, v]) => lines.push([l, v]));
    else if (r.stage) r.stage.readings.forEach(([n, d, e]) => lines.push([`${n} · ${d}`, e]));
    else if (r.bills?.length) r.bills.forEach(b => lines.push([`Bill ${b.no}${b.date ? ` · ${b.date}` : ''}`, b.balance]));
    else lines.push([r.basis || 'this week', Math.round(r.thisWeek)]);
  });
  return { lines, total: c.thisWeek };
}

function WeekMatrix({ allSections, paidOf, band }: {
  allSections: PaySection[];
  paidOf: (r: PayRow) => number | null;
  band: 'all' | 'workers' | 'vendors' | 'fixed';
}) {
  const [hover, setHover] = useState<{ row: string | null; col: number | null }>({ row: null, col: null });
  const [open, setOpen] = useState<string | null>(null);   // the one expanded cell — `${payee}|${site}`

  // ── pivot — strictly what is owed THIS WEEK, by whom, on which site ───────────────────────────
  const model = useMemo(() => {
    const rowsFor = (pid: string) => allSections.find(s => s.projectId === pid)?.rows ?? [];
    // Sites = every project that carries money this week, in first-seen order.
    const siteOrder: string[] = [];
    const siteName: Record<string, string> = {};
    allSections.forEach(s => s.rows.forEach(r => {
      if (r.thisWeek <= 0) return;
      if (!(r.projectId in siteName)) { siteName[r.projectId] = r.projectName; siteOrder.push(r.projectId); }
    }));
    const sites = siteOrder.map((id, i) => ({ id, name: siteName[id], color: SITE_PALETTE[i % SITE_PALETTE.length] }));

    const bands = BAND_DEFS.map(bd => {
      const byPayee = new Map<string, MxPayee>();
      rowsFor(bd.pid).forEach(r => {
        if (r.thisWeek <= 0) return;
        const key = r.stakeholderId ?? r.party;
        let p = byPayee.get(key);
        if (!p) { p = { key, name: r.party, meta: r.trade || '', cells: {}, due: 0, paid: 0 }; byPayee.set(key, p); }
        let cell = p.cells[r.projectId];
        if (!cell) { cell = { rows: [], thisWeek: 0, paid: 0, meta: r.basis }; p.cells[r.projectId] = cell; }
        cell.rows.push(r);
        cell.thisWeek += Math.round(r.thisWeek);
        cell.paid += (paidOf(r) || 0);
      });
      const payees = [...byPayee.values()].filter(p => Object.values(p.cells).some(c => c.thisWeek > 0));
      payees.forEach(p => {
        const cs = Object.values(p.cells);
        p.due = cs.reduce((a, c) => a + c.thisWeek, 0);
        p.paid = cs.reduce((a, c) => a + c.paid, 0);
        const nSites = cs.filter(c => c.thisWeek > 0).length;
        p.meta = [p.meta, nSites > 1 ? `${nSites} sites` : null].filter(Boolean).join(' · ');
      });
      const total = payees.reduce((a, p) => a + p.due, 0);
      const paid = payees.reduce((a, p) => a + p.paid, 0);
      return { ...bd, payees, total, paid };
    }).filter(b => b.payees.length > 0);

    return { sites, bands };
  }, [allSections, paidOf]);

  const shown = band === 'all' ? model.bands : model.bands.filter(b => b.key === band);
  const sites = model.sites;
  const N = sites.length;
  const gridStyle = { gridTemplateColumns: `196px repeat(${N}, minmax(140px,1fr)) 156px` } as CSSProperties;

  // visible per-site + grand (respect the band filter)
  const visSite: Record<string, { plan: number; paid: number }> = {};
  sites.forEach(s => { visSite[s.id] = { plan: 0, paid: 0 }; });
  shown.forEach(b => b.payees.forEach(p => Object.entries(p.cells).forEach(([sid, c]) => {
    if (visSite[sid]) { visSite[sid].plan += c.thisWeek; visSite[sid].paid += c.paid; }
  })));
  const grandPlan = Object.values(visSite).reduce((a, v) => a + v.plan, 0);
  const grandPaid = Object.values(visSite).reduce((a, v) => a + v.paid, 0);

  const hl = (row: string | null, col: number | null) =>
    ((col != null && hover.col === col) || (row != null && hover.row === row)) ? ' hl' : '';
  const enter = (row: string | null, col: number | null) => setHover({ row, col });
  const leave = () => setHover({ row: null, col: null });

  return (
    <div className="wkm" onMouseLeave={leave}>
      <style>{WKM_CSS}</style>

      <div className="sheet">
        <div className="grid" style={gridStyle}>
          {/* header */}
          <div className={`c who head${hl('__head__', null)}`} onMouseEnter={() => enter('__head__', null)}>who × site</div>
          {sites.map((s, i) => (
            <div key={s.id} className={`c head${hl(null, i)}`} onMouseEnter={() => enter('__head__', i)}>
              <span className="site-nm"><span className="dot" style={{ background: s.color }} />{s.name}</span>
            </div>
          ))}
          <div className="c head paycol">to settle</div>

          {shown.map(b => (
            <div className="row" key={b.key}>
              {/* The band title only earns its row when several bands share the sheet (the "All" view);
                  with one band chosen, the chip already names it. */}
              {band === 'all' && (
                <div className="c band"><h3>{b.label}</h3><span className="bt"><b>{inr(b.total)}</b> this week{b.paid ? ` · ${inr(b.paid)} paid` : ''}</span></div>
              )}
              {b.payees.map(p => (
                <div className="rowline" key={p.key}>
                  <div className={`c who${hl(p.key, null)}`} onMouseEnter={() => enter(p.key, null)}>
                    <span className="nm">{p.name}</span>{p.meta ? <span className="meta">{p.meta}</span> : null}
                  </div>
                  {sites.map((s, i) => {
                    const c = p.cells[s.id];
                    const cls = `c${hl(p.key, i)}`;
                    if (!c || c.thisWeek <= 0) {
                      return <div key={s.id} className={cls} onMouseEnter={() => enter(p.key, i)}><span className="none">—</span></div>;
                    }
                    const paid = c.rows.length > 0 && c.rows.every(r => paidOf(r) != null);
                    const cellKey = `${p.key}|${s.id}`;
                    const isOpen = open === cellKey;
                    const d = isOpen ? cellDerivation(c) : null;
                    return (
                      <div key={s.id} className={cls} onMouseEnter={() => enter(p.key, i)}>
                        <div
                          className={`pcell${paid ? ' paid' : ''}${isOpen ? ' open' : ''}`}
                          style={{ '--site-c': s.color } as CSSProperties}
                          role="button" tabIndex={0}
                          onClick={() => setOpen(o => o === cellKey ? null : cellKey)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => o === cellKey ? null : cellKey); } }}
                        >
                          <div className="amt">{inr(c.thisWeek)}</div>
                          <div className="meta">{c.meta}</div>
                          {d && (
                            <div className="pderiv">
                              {d.lines.map(([l, v], k) => (
                                <div className="dl" key={k}><span className="dlabel">{l}</span><span className="dv">{inr(v)}</span></div>
                              ))}
                              <div className="dl dtot"><span className="dlabel">this week</span><span className="dv">{inr(d.total)}</span></div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div className={`c pay${hl(p.key, null)}`} onMouseEnter={() => enter(p.key, null)}>
                    {p.due - p.paid > 0 ? (
                      <>
                        <span className="amt">{inr(p.due - p.paid)}</span>
                        {p.paid ? <span className="sub">{inr(p.paid)} paid</span> : null}
                      </>
                    ) : (
                      <><span className="ok">✓ settled</span><span className="sub">{inr(p.paid)} paid</span></>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}

          {/* footer */}
          <div className={`c who foot${hl('__foot__', null)}`} onMouseEnter={() => enter('__foot__', null)}>site outgo</div>
          {sites.map((s, i) => {
            const v = visSite[s.id]; const due = v.plan - v.paid;
            return (
              <div key={s.id} className={`c foot${hl(null, i)}`} onMouseEnter={() => enter('__foot__', i)}>
                {v.plan ? <>
                  <span className="amt" style={due === 0 ? { color: 'var(--wkm-paid)' } : undefined}>{inr(due)}</span>
                  <span className="sub">{v.paid ? `${inr(v.paid)} paid of ${inr(v.plan)}` : `of ${inr(v.plan)} planned`}</span>
                </> : <span className="none">—</span>}
              </div>
            );
          })}
          <div className="c foot grand"><span className="amt">{inr(grandPlan - grandPaid)}</span><span className="sub">still to pay · {inr(grandPlan)} planned</span></div>
        </div>
      </div>

      <p className="hint">Row end = what you hand each person this week · bottom = each site&apos;s outgo · click a cell to see how it&apos;s worked out</p>
    </div>
  );
}

const WKM_CSS = `
.wkm{--wkm-card:#FBF9F3;--wkm-card2:#F7F3EA;--wkm-ink:#27221A;--wkm-ink2:#736B5D;--wkm-ink3:#A79E8D;
  --wkm-line:#E4DDCE;--wkm-line2:#EFE9DC;--wkm-due:#B5472F;--wkm-paid:#66794F;
  --wkm-serif:"Source Serif 4",Georgia,serif;--wkm-mono:"IBM Plex Mono",ui-monospace,monospace;--wkm-sans:"Karla",system-ui,sans-serif;
  font-family:var(--wkm-sans);color:var(--wkm-ink);margin-top:6px}
.wkm .chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.wkm .chip-f{border:1px solid var(--wkm-line);background:var(--wkm-card);border-radius:999px;padding:6px 15px;font:500 12.5px var(--wkm-sans);color:var(--wkm-ink2);cursor:pointer}
.wkm .chip-f:hover{color:var(--wkm-ink)}
.wkm .chip-f.on{background:var(--wkm-ink);border-color:var(--wkm-ink);color:var(--wkm-card)}
.wkm .sheet{border:1px solid var(--wkm-line);border-radius:14px;background:var(--wkm-card);overflow-x:auto}
.wkm .grid{display:grid;min-width:1000px}
.wkm .row,.wkm .rowline{display:contents}
.wkm .c{border-top:1px solid var(--wkm-line2);display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;min-height:46px;padding:5px 8px}
.wkm .c.who{position:sticky;left:0;background:var(--wkm-card);z-index:3;align-items:flex-start;justify-content:center;padding:7px 14px;border-right:1px solid var(--wkm-line2)}
.wkm .who .nm{font-family:var(--wkm-serif);font-weight:600;font-size:13.5px;line-height:1.2}
.wkm .who .meta{font-size:10.5px;color:var(--wkm-ink2);margin-top:1px}
.wkm .c.head{min-height:38px;background:var(--wkm-card2);border-top:0;gap:5px}
.wkm .c.who.head{background:var(--wkm-card2);font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--wkm-ink2);font-weight:500}
.wkm .c.head .site-nm{display:flex;align-items:center;gap:7px;font-family:var(--wkm-serif);font-weight:600;font-size:13.5px;color:var(--wkm-ink)}
.wkm .c.head .site-nm .dot{width:7px;height:7px;border-radius:50%}
.wkm .c.head.paycol{align-items:flex-end;padding-right:16px;font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--wkm-ink2);gap:3px}
.wkm .c.band{grid-column:1 / -1;flex-direction:row;justify-content:space-between;background:var(--wkm-card2);border-top:1px solid var(--wkm-line);min-height:32px;padding:6px 16px}
.wkm .c.band h3{font-family:var(--wkm-serif);font-weight:600;font-size:14px}
.wkm .c.band .bt{font-family:var(--wkm-mono);font-size:11.5px;color:var(--wkm-ink2)}
.wkm .c.band .bt b{color:var(--wkm-ink);font-weight:500}
.wkm .pcell{width:100%;background:transparent;border:1px solid transparent;border-radius:8px;padding:4px 10px 4px 12px;position:relative;text-align:left;cursor:pointer;transition:border-color .15s ease,background .15s ease}
.wkm .pcell::before{content:"";position:absolute;left:1px;top:5px;bottom:5px;width:2px;border-radius:2px;background:var(--site-c);opacity:.7}
.wkm .pcell .amt{font-family:var(--wkm-mono);font-weight:500;font-size:13.5px;color:var(--wkm-ink)}
.wkm .pcell .meta{font-family:var(--wkm-sans);font-size:10px;color:var(--wkm-ink3);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wkm .pcell:hover{border-color:var(--wkm-line2);background:rgba(255,255,255,.55)}
.wkm .pcell.open{border-color:var(--wkm-line);background:rgba(255,255,255,.8);box-shadow:0 4px 14px rgba(39,34,26,.06)}
.wkm .pcell.paid .amt{color:var(--wkm-paid)}
.wkm .pcell.paid::before{opacity:.35}
/* click-to-expand derivation — a soft inset panel, hairline-separated */
.wkm .pderiv{margin-top:6px;padding-top:6px;border-top:1px solid var(--wkm-line2);animation:wkm-deriv .18s ease}
.wkm .pderiv .dl{display:flex;justify-content:space-between;gap:10px;font-family:var(--wkm-mono);font-size:10.5px;color:var(--wkm-ink2);padding:1.5px 0}
.wkm .pderiv .dl .dlabel{font-family:var(--wkm-sans);color:var(--wkm-ink3);white-space:normal}
.wkm .pderiv .dl .dv{color:var(--wkm-ink2);flex:none}
.wkm .pderiv .dtot{margin-top:3px;padding-top:4px;border-top:1px dotted var(--wkm-line);color:var(--wkm-ink)}
.wkm .pderiv .dtot .dlabel{color:var(--wkm-ink2);font-weight:600}
.wkm .pderiv .dtot .dv{color:var(--wkm-ink);font-weight:600}
@keyframes wkm-deriv{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
.wkm .c .none{font-family:var(--wkm-mono);font-size:12px;color:var(--wkm-ink3)}
.wkm .c.pay{align-items:flex-end;padding-right:16px;gap:2px;border-left:1px solid var(--wkm-line2);background:rgba(247,243,234,.55)}
.wkm .c.pay .amt{font-family:var(--wkm-mono);font-weight:500;font-size:13.5px;letter-spacing:-.01em}
.wkm .c.pay .sub{font-family:var(--wkm-mono);font-size:9.5px;color:var(--wkm-ink3)}
.wkm .c.pay .ok{font:600 11.5px var(--wkm-sans);color:var(--wkm-paid)}
.wkm .c.head.paycol,.wkm .c.foot.grand{border-left:1px solid var(--wkm-line2)}
.wkm .c.foot{background:var(--wkm-card2);border-top:1px solid var(--wkm-line);min-height:46px;gap:2px}
.wkm .c.foot .amt{font-family:var(--wkm-mono);font-weight:600;font-size:13.5px}
.wkm .c.foot .sub{font-family:var(--wkm-mono);font-size:10.5px;color:var(--wkm-ink2)}
.wkm .c.who.foot{background:var(--wkm-card2);align-items:flex-start;font:500 10.5px var(--wkm-sans);letter-spacing:.13em;text-transform:uppercase;color:var(--wkm-ink2)}
.wkm .c.foot.grand{align-items:flex-end;padding-right:18px}
.wkm .c.foot.grand .amt{font-size:15px;color:var(--wkm-due)}
.wkm .c.hl{background:rgba(120,104,76,.045)}
.wkm .c.foot.hl,.wkm .c.head.hl{background:rgba(120,104,76,.07)}
.wkm .c.who.hl{background:rgba(120,104,76,.03)}
.wkm .hint{margin-top:12px;font-size:12px;color:var(--wkm-ink3)}
`;
