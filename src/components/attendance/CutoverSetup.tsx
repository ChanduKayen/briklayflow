/**
 * CutoverSetup — the ledger go-live in ONE elegant place. Set the org's cutover DATE, then walk every
 * party (vendor / worker) and record where they stand as of it: a BALANCE we still owe, an ADVANCE they
 * hold, or SETTLED (square at the line). Before the cutover a cut party is settled by that one figure;
 * after it, live accrual takes over. A party left untouched keeps its full history.
 *
 * Reuses stakeholder_opening_balances (as_of = the cutover date). Each row can open the party's full
 * running ledger in a side slide-over (the same StakeholderLedgerDrawer used across the app), so the
 * carried figure and the payments behind it are one tap apart.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';
import { V, font, serif, nums } from '../txn-ledger/ledgerTokens';
import { useSnackbar } from '../Snackbar';
import { saveOpeningBalance } from '../../lib/partyLedgerApi';
import { loadLedgerCutover, setLedgerCutover, loadOpeningBalances, removeOpeningBalance } from '../../lib/workCertification';
import { mergeStakeholders } from '../../lib/stakeholderMerge';
import StakeholderLedgerDrawer from '../StakeholderLedgerDrawer';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const initials = (name: string) =>
  (name || '').trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

type Party = { stakeholder_id: string; name: string; type: string; category: string | null };

export function CutoverSetup({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { show } = useSnackbar();
  const { data: cutover, refetch: refetchCut } = useQuery({ queryKey: ['ledger_cutover', orgId], queryFn: () => loadLedgerCutover(orgId) });
  const { data: openings = [], refetch: refetchOpen } = useQuery({ queryKey: ['opening_balances'], queryFn: loadOpeningBalances });
  const { data: parties = [], refetch: refetchParties } = useQuery({
    queryKey: ['cutover_parties'],
    queryFn: async () => (await supabase.from('stakeholders').select('stakeholder_id, name, type, category').in('type', ['Vendor', 'Worker']).is('merged_into', null).order('name')).data as Party[] ?? [],
  });

  const [dateVal, setDateVal] = useState<string>(cutover ?? new Date().toISOString().slice(0, 10));
  const [dateOpen, setDateOpen] = useState(false);
  const [q, setQ] = useState('');
  const [typeTab, setTypeTab] = useState<'all' | 'Vendor' | 'Worker'>('all');
  // Default to the parties that still need a cutover — the ones without an opening yet ("unsettled").
  // Working through them, each drops off as it's set. Toggle off to see everyone.
  const [onlyPending, setOnlyPending] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ledgerFor, setLedgerFor] = useState<string | null>(null);
  // The row that just saved — flashes green, then focus moves to the next party (fast run-through).
  const [justSaved, setJustSaved] = useState<string | null>(null);
  // Per-row transient entry state. Every row is inline-editable, SETTLED by default. `mode` is the row's
  // explicit choice this session ('settled' | 'expanded'); with none, it derives from the loaded opening.
  // All clear on save so the row then reflects the freshly-loaded opening.
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [dirs, setDirs] = useState<Record<string, 'work_owed' | 'paid_ahead'>>({});
  const [mode, setMode] = useState<Record<string, 'settled' | 'expanded'>>({});
  // ── merge: pick several duplicate parties, fold them into one under a chosen name ──
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeName, setMergeName] = useState('');           // '' = dialog closed
  const [mergeOpen, setMergeOpen] = useState(false);

  // stakeholder_id -> its opening ({ direction, total }); total 0 = SETTLED (cut off, square).
  const openMap = useMemo(() => {
    const m = new Map<string, { direction: 'work_owed' | 'paid_ahead'; total: number }>();
    for (const o of openings) m.set(o.stakeholderId, { direction: o.direction, total: o.total });
    return m;
  }, [openings]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return parties
      .filter(p => typeTab === 'all' || p.type === typeTab)
      .filter(p => !needle || p.name.toLowerCase().includes(needle))
      // "unsettled" = no opening set yet. Keep the row just saved (for its green flash) and the one
      // being edited, so nothing vanishes out from under the cursor mid-flow.
      .filter(p => !onlyPending || !openMap.has(p.stakeholder_id) || justSaved === p.stakeholder_id || !!mode[p.stakeholder_id]);
  }, [parties, q, typeTab, onlyPending, openMap, justSaved, mode]);

  // How many still need a cutover (respecting the type filter) — shown on the toggle.
  const pendingCount = useMemo(
    () => parties.filter(p => (typeTab === 'all' || p.type === typeTab) && !openMap.has(p.stakeholder_id)).length,
    [parties, typeTab, openMap],
  );

  // Header counts — how far along the cutover is.
  const stats = useMemo(() => {
    let owed = 0, advance = 0, settled = 0;
    for (const o of openings) {
      if (o.total === 0) settled++;
      else if (o.direction === 'work_owed') owed++;
      else advance++;
    }
    return { owed, advance, settled, set: openings.length };
  }, [openings]);

  const saveDate = async (d: string | null) => {
    setBusy(true);
    try {
      await setLedgerCutover(orgId, d);
      show(d ? `Ledger opens ${fmtDate(d)}` : 'Cutover cleared');
      setDateOpen(false); refetchCut();
      qc.invalidateQueries({ queryKey: ['weekly_payments'] }); qc.invalidateQueries({ queryKey: ['party_ledger'] });
    } catch (e) { show((e as Error)?.message || 'Could not set the date', { type: 'error' }); }
    finally { setBusy(false); }
  };

  // ── a row's effective values: the transient entry state overrides the loaded opening ──
  const rowAmount = (id: string, op?: { direction: 'work_owed' | 'paid_ahead'; total: number }) =>
    amounts[id] ?? (op && op.total > 0 ? String(op.total) : '');
  const rowDir = (id: string, op?: { direction: 'work_owed' | 'paid_ahead'; total: number }): 'work_owed' | 'paid_ahead' =>
    dirs[id] ?? op?.direction ?? 'work_owed';
  // Expanded = the row is entering a balance/advance (settled otherwise). The row's own choice wins;
  // with none, it derives from the loaded opening (a set balance/advance opens expanded).
  const rowExpanded = (id: string, op?: { direction: 'work_owed' | 'paid_ahead'; total: number }) =>
    mode[id] ? mode[id] === 'expanded' : (!!op && op.total > 0);
  const expandRow = (id: string) => setMode(m => (m[id] === 'expanded' ? m : { ...m, [id]: 'expanded' }));
  // Back to settled: forget any typed amount and collapse the balance/advance choice.
  const collapseRow = (id: string) => {
    setAmounts(a => { const n = { ...a }; delete n[id]; return n; });
    setDirs(d => { const n = { ...d }; delete n[id]; return n; });
    setMode(m => ({ ...m, [id]: 'settled' }));
  };

  const setRowAmount = (id: string, v: string) => setAmounts(a => ({ ...a, [id]: v }));
  const setRowDir = (id: string, d: 'work_owed' | 'paid_ahead') => setDirs(x => ({ ...x, [id]: d }));

  // Save one row. Settled (no amount) → a zero opening; a value → balance/advance per the row's direction.
  // `chain` (Enter) moves focus straight into the next party's amount so entry never breaks stride.
  const saveRow = async (p: Party, op: { direction: 'work_owed' | 'paid_ahead'; total: number } | undefined, chain: boolean) => {
    const id = p.stakeholder_id;
    const exp = rowExpanded(id, op);
    const total = exp ? (parseInt(rowAmount(id, op).replace(/[^\d]/g, ''), 10) || 0) : 0;
    const direction: 'work_owed' | 'paid_ahead' = total > 0 ? rowDir(id, op) : 'work_owed';
    setBusy(true);
    try {
      await saveOpeningBalance(orgId, id, {
        asOf: cutover ?? dateVal, direction, total, bySite: {},
        note: total > 0 ? 'Opening balance at cutover' : 'Settled at cutover',
      });
      show(`${p.name} — ${total > 0 ? (direction === 'paid_ahead' ? `advance ${inr(total)}` : `balance ${inr(total)}`) : 'settled'}`);
      refetchOpen();
      qc.invalidateQueries({ queryKey: ['party_ledger'] }); qc.invalidateQueries({ queryKey: ['weekly_payments'] });
      // green tick on this row, then hand off to the next party.
      setJustSaved(id);
      window.setTimeout(() => setJustSaved(curr => (curr === id ? null : curr)), 950);
      setAmounts(a => { const n = { ...a }; delete n[id]; return n; });
      setDirs(d => { const n = { ...d }; delete n[id]; return n; });
      setMode(m => { const n = { ...m }; delete n[id]; return n; });
      const idx = list.findIndex(x => x.stakeholder_id === id);
      const next = idx >= 0 ? list[idx + 1] : undefined;
      if (next) requestAnimationFrame(() => {
        document.getElementById(`cut-row-${next.stakeholder_id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        if (chain) (document.getElementById(`cut-amt-${next.stakeholder_id}`) as HTMLInputElement | null)?.focus();
      });
    } catch (e) { show((e as Error)?.message || 'Could not save', { type: 'error' }); }
    finally { setBusy(false); }
  };

  const clearOpening = async (p: Party) => {
    setBusy(true);
    try {
      await removeOpeningBalance(p.stakeholder_id);
      show(`${p.name} — full history restored`);
      setAmounts(a => { const n = { ...a }; delete n[p.stakeholder_id]; return n; });
      setMode(m => { const n = { ...m }; delete n[p.stakeholder_id]; return n; });
      refetchOpen();
      qc.invalidateQueries({ queryKey: ['party_ledger'] }); qc.invalidateQueries({ queryKey: ['weekly_payments'] });
    } catch (e) { show((e as Error)?.message || 'Could not remove', { type: 'error' }); }
    finally { setBusy(false); }
  };

  // ── merge duplicates ──
  const toggleSelect = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selList = parties.filter(p => selected.has(p.stakeholder_id));
  const openMerge = () => {
    if (selected.size < 2) return;
    const longest = selList.map(p => p.name).reduce((a, b) => (b.length > a.length ? b : a), selList[0]?.name ?? '');
    setMergeName(longest);
    setMergeOpen(true);
  };
  const doMerge = async () => {
    const ids = selList.map(p => p.stakeholder_id);
    const name = mergeName.trim();
    if (ids.length < 2 || !name) return;
    // keep the party already named as chosen (if any) as the survivor, else the first selected
    const survivor = selList.find(p => p.name.trim() === name)?.stakeholder_id ?? ids[0];
    const losers = ids.filter(id => id !== survivor);
    setBusy(true);
    try {
      await mergeStakeholders(orgId, survivor, losers, name);
      show(`Merged ${ids.length} parties into ${name}`);
      setMergeOpen(false); setSelecting(false); setSelected(new Set());
      refetchParties(); refetchOpen();
      qc.invalidateQueries({ queryKey: ['party_ledger'] });
      qc.invalidateQueries({ queryKey: ['stakeholders'] });
      qc.invalidateQueries({ queryKey: ['payables'] });
    } catch (e) { show((e as Error)?.message || 'Could not merge', { type: 'error' }); }
    finally { setBusy(false); }
  };

  return createPortal(
    <>
      <style>{`
        @keyframes cutSaved { 0% { background: ${V.sageWash}; } 65% { background: ${V.sageWash}; } 100% { background: transparent; } }
        .cut-saved { animation: cutSaved .95s ease both; }
        @keyframes cutTick { 0% { transform: scale(.7); opacity: 0; } 55% { transform: scale(1.12); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
        .cut-tick { display: inline-flex; align-items: center; gap: 5px; animation: cutTick .3s cubic-bezier(.2,.9,.3,1.5) both; }
        @media (prefers-reduced-motion: reduce) { .cut-saved, .cut-tick { animation: none; } }
        /* the state segments and the amount field share ONE look: same height, radius, border */
        .cut-ctl { height: 36px; box-sizing: border-box; border-radius: 10px; border: 1px solid ${V.line}; background: ${V.surface}; font-size: 13px; font-weight: 600; color: ${V.sys}; }
        button.cut-ctl { padding: 0 14px; cursor: pointer; display: inline-flex; align-items: center; white-space: nowrap; transition: background .12s ease, color .12s ease, border-color .12s ease; }
        button.cut-ctl:hover { background: ${V.field}; color: ${V.ink}; border-color: #DED8CF; }
        button.cut-ctl.on { background: ${V.terraWash}; border-color: ${V.terra}; color: ${V.terraDeep}; }
        button.cut-ctl.on:hover { background: ${V.terraWash}; color: ${V.terraDeep}; }
        input.cut-ctl { padding: 0 11px; outline: none; font-weight: 500; color: ${V.ink}; font-variant-numeric: tabular-nums; }
        input.cut-ctl:focus { border-color: ${V.terra}; }
      `}</style>
      <div style={{ ...font, position: 'fixed', inset: 0, zIndex: ledgerFor ? 40 : 90, background: 'rgba(20,16,12,0.42)', display: 'grid', placeItems: 'center', padding: 16 }} onClick={onClose}>
        <div onClick={(e) => e.stopPropagation()}
          style={{ width: 'min(680px,100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', background: V.surface, border: `1px solid ${V.line}`, borderRadius: 18, boxShadow: '0 24px 70px -22px rgba(20,16,12,0.55)', overflow: 'hidden' }}>

          {/* ── header: title + the org cutover date, set inline ── */}
          <div style={{ padding: '18px 20px 14px', borderBottom: `1px solid ${V.line}` }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 19, fontWeight: 500, color: V.ink, ...serif }}>Ledger cutover</p>
                <p style={{ fontSize: 12.5, color: V.sys, marginTop: 3, lineHeight: 1.5 }}>
                  Record where each party stands as of the cutover — a balance owed, an advance held, or settled.
                  Everyone left untouched keeps their full history.
                </p>
              </div>
              {/* the date pill */}
              <div style={{ flexShrink: 0, textAlign: 'right' }}>
                {!dateOpen ? (
                  <button onClick={() => { setDateVal(cutover ?? dateVal); setDateOpen(true); }}
                    style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, background: V.field, border: `1px solid ${V.line}`, borderRadius: 12, padding: '8px 12px', cursor: 'pointer' }}>
                    <span style={{ fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: V.faint }}>Cutover date</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: cutover ? V.ink : V.faint, ...nums }}>{cutover ? fmtDate(cutover) : 'Not set'}</span>
                  </button>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                    <input type="date" value={dateVal} onChange={(e) => setDateVal(e.target.value)}
                      style={{ padding: '7px 10px', borderRadius: 9, border: `1px solid ${V.line}`, fontSize: 13.5, color: V.ink, outline: 'none' }} />
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {cutover && <button disabled={busy} onClick={() => saveDate(null)} style={{ fontSize: 12, color: V.sys, background: 'none', border: 0, cursor: 'pointer' }}>clear</button>}
                      <button disabled={busy} onClick={() => setDateOpen(false)} style={{ fontSize: 12, color: V.sys, background: 'none', border: 0, cursor: 'pointer' }}>cancel</button>
                      <button disabled={busy || !dateVal} onClick={() => saveDate(dateVal)}
                        style={{ fontSize: 12.5, fontWeight: 600, color: '#fff', background: V.terra, border: 0, borderRadius: 999, padding: '6px 13px', cursor: 'pointer' }}>Save</button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* progress line */}
            {stats.set > 0 && (
              <div style={{ display: 'flex', gap: 14, marginTop: 12, fontSize: 12, color: V.sys, flexWrap: 'wrap' }}>
                <span><b style={{ color: V.terraDeep, ...nums }}>{stats.owed}</b> owed</span>
                <span><b style={{ color: V.sage, ...nums }}>{stats.advance}</b> advance</span>
                <span><b style={{ color: V.ink, ...nums }}>{stats.settled}</b> settled</span>
                <span style={{ color: V.faint }}>· {stats.set} of {parties.length} set</span>
              </div>
            )}
          </div>

          {/* ── toolbar: search + unsettled toggle + type tabs ── */}
          <div style={{ padding: '12px 20px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderBottom: `1px solid ${V.line}` }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a vendor or worker…"
              style={{ flex: 1, minWidth: 180, padding: '8px 12px', borderRadius: 10, border: `1px solid ${V.line}`, fontSize: 13.5, color: V.ink, outline: 'none', background: V.page }} />
            <button onClick={() => setOnlyPending(v => !v)}
              style={{ fontSize: 12.5, fontWeight: 600, padding: '7px 12px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap', border: `1px solid ${onlyPending ? V.terra : V.line}`, background: onlyPending ? V.terraWash : V.surface, color: onlyPending ? V.terraDeep : V.sys }}>
              {onlyPending ? `Unsettled · ${pendingCount}` : 'Showing all'}
            </button>
            <div style={{ display: 'flex', background: V.field, borderRadius: 10, padding: 3, gap: 2 }}>
              {(['all', 'Vendor', 'Worker'] as const).map(t => (
                <button key={t} onClick={() => setTypeTab(t)}
                  style={{ fontSize: 12.5, fontWeight: 600, padding: '5px 11px', borderRadius: 7, border: 0, cursor: 'pointer', background: typeTab === t ? V.surface : 'transparent', color: typeTab === t ? V.ink : V.sys, boxShadow: typeTab === t ? '0 1px 3px rgba(20,16,12,0.08)' : 'none' }}>
                  {t === 'all' ? 'All' : t === 'Vendor' ? 'Vendors' : 'Workers'}
                </button>
              ))}
            </div>
            {/* merge duplicates — enter select mode, tick the duplicates, fold them into one */}
            <button onClick={() => { setSelecting(v => !v); setSelected(new Set()); }}
              style={{ fontSize: 12.5, fontWeight: 600, padding: '7px 12px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap', border: `1px solid ${selecting ? V.terra : V.line}`, background: selecting ? V.terraWash : V.surface, color: selecting ? V.terraDeep : V.sys }}>
              {selecting ? 'Cancel merge' : 'Merge duplicates'}
            </button>
          </div>

          {/* ── the party list ── */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {list.length === 0 && (
              <p style={{ fontSize: 13, color: V.faint, textAlign: 'center', padding: '32px 20px' }}>
                {parties.length === 0 ? 'No vendors or workers yet.'
                  : q.trim() ? 'No one matches that search.'
                  : onlyPending ? 'Everyone has a cutover set. Toggle to “Showing all” to review them.'
                  : 'No one to show.'}
              </p>
            )}
            {list.map((p, i) => {
              const id = p.stakeholder_id;
              const op = openMap.get(id);
              const exp = rowExpanded(id, op);
              const amt = rowAmount(id, op);
              const dir = rowDir(id, op);
              const saved = justSaved === id;
              const sel = selected.has(id);
              return (
                <div key={id} id={`cut-row-${id}`}
                  className={saved ? 'cut-saved' : undefined}
                  onClick={selecting ? () => toggleSelect(id) : undefined}
                  style={{ borderTop: i ? `1px solid ${V.line}` : 'none', background: sel ? V.terraWash : exp ? V.page : 'transparent', transition: 'background .12s ease', cursor: selecting ? 'pointer' : 'default' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px 10px 20px', flexWrap: 'wrap' }}>
                    {/* select checkbox (merge mode) */}
                    {selecting && (
                      <span aria-hidden style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 6, border: `1.5px solid ${sel ? V.terra : V.line}`, background: sel ? V.terra : V.surface, display: 'grid', placeItems: 'center' }}>
                        {sel && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                      </span>
                    )}
                    {/* identity */}
                    <span style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', background: V.field, color: V.inkSoft, fontSize: 12, fontWeight: 600 }}>{initials(p.name)}</span>
                    <div style={{ flex: 1, minWidth: 120 }}>
                      <p style={{ fontSize: 14, fontWeight: 500, color: V.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</p>
                      <p style={{ fontSize: 11.5, color: V.faint, marginTop: 1 }}>
                        {p.type}{p.category ? ` · ${p.category}` : ''}
                        {op && cutover && <> · as of {fmtDate(cutover)}</>}
                      </p>
                    </div>

                    {selecting ? null : saved ? (
                      /* the just-saved row briefly reads a green ✓ */
                      <span className="cut-tick" style={{ fontSize: 12, fontWeight: 600, color: V.sage, background: V.sageWash, borderRadius: 999, padding: '5px 12px', whiteSpace: 'nowrap' }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                        Saved
                      </span>
                    ) : (
                      <>
                        {/* state control — three matched, clickable segments (SETTLED selected by default) */}
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          <button type="button" className={`cut-ctl${exp && dir === 'work_owed' ? ' on' : ''}`}
                            onClick={() => { setRowDir(id, 'work_owed'); expandRow(id); requestAnimationFrame(() => document.getElementById(`cut-amt-${id}`)?.focus()); }}>We owe</button>
                          <button type="button" className={`cut-ctl${exp && dir === 'paid_ahead' ? ' on' : ''}`}
                            onClick={() => { setRowDir(id, 'paid_ahead'); expandRow(id); requestAnimationFrame(() => document.getElementById(`cut-amt-${id}`)?.focus()); }}>Advance</button>
                          <button type="button" className={`cut-ctl${!exp ? ' on' : ''}`}
                            onClick={() => collapseRow(id)}>Settled</button>
                        </div>

                        {/* amount — same look as the segments; clicking it opens the balance/advance choice */}
                        <input id={`cut-amt-${id}`} className="cut-ctl" inputMode="numeric" value={exp ? amt : ''}
                          onFocus={() => expandRow(id)}
                          onChange={(e) => { expandRow(id); setRowAmount(id, e.target.value); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveRow(p, op, true); } }}
                          placeholder={exp ? '₹ amount' : 'settled'}
                          style={{ width: 116, flexShrink: 0 }} />

                        {/* the tick IS the save */}
                        <button disabled={busy} onClick={() => saveRow(p, op, false)} title="Save" aria-label="Save"
                          style={{ flexShrink: 0, width: 36, height: 36, borderRadius: '50%', border: 0, cursor: 'pointer', background: V.terra, color: '#fff', display: 'grid', placeItems: 'center' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                        </button>

                        <button onClick={() => setLedgerFor(id)} title="Open ledger"
                          style={{ flexShrink: 0, fontSize: 12.5, fontWeight: 600, color: V.inkSoft, background: 'none', border: 0, cursor: 'pointer', whiteSpace: 'nowrap', padding: '4px 2px' }}>Ledger →</button>

                        {op && (
                          <button disabled={busy} onClick={() => clearOpening(p)} title="Remove — keep full history"
                            style={{ flexShrink: 0, fontSize: 15, color: V.faint, background: 'none', border: 0, cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}>×</button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── footer — the merge action bar in select mode, else Done ── */}
          {selecting ? (
            <div style={{ padding: '12px 20px', borderTop: `1px solid ${V.line}`, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 13, color: V.sys }}>
                {selected.size === 0 ? 'Tick the duplicates to merge' : `${selected.size} selected`}
              </span>
              <span style={{ flex: 1 }} />
              <button onClick={() => { setSelecting(false); setSelected(new Set()); }}
                style={{ fontSize: 13, fontWeight: 600, color: V.sys, background: 'none', border: 0, cursor: 'pointer' }}>Cancel</button>
              <button disabled={selected.size < 2} onClick={openMerge}
                style={{ fontSize: 13, fontWeight: 600, color: '#fff', background: selected.size < 2 ? V.faint : V.terra, border: 0, borderRadius: 999, padding: '9px 20px', cursor: selected.size < 2 ? 'default' : 'pointer' }}>
                Merge {selected.size >= 2 ? selected.size : ''} →
              </button>
            </div>
          ) : (
            <div style={{ padding: '12px 20px', borderTop: `1px solid ${V.line}`, display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ fontSize: 13, fontWeight: 600, color: V.ink, background: V.field, border: `1px solid ${V.line}`, borderRadius: 999, padding: '9px 22px', cursor: 'pointer' }}>Done</button>
            </div>
          )}
        </div>
      </div>

      {/* merge dialog — name the survivor, confirm the fold */}
      {mergeOpen && (
        <div style={{ ...font, position: 'fixed', inset: 0, zIndex: 95, background: 'rgba(20,16,12,0.5)', display: 'grid', placeItems: 'center', padding: 16 }} onClick={() => setMergeOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(440px,100%)', background: V.surface, border: `1px solid ${V.line}`, borderRadius: 16, boxShadow: '0 24px 70px -22px rgba(20,16,12,0.55)', overflow: 'hidden' }}>
            <div style={{ padding: '18px 20px 12px' }}>
              <p style={{ fontSize: 18, fontWeight: 500, color: V.ink, ...serif }}>Merge {selList.length} into one</p>
              <p style={{ fontSize: 12.5, color: V.sys, marginTop: 4, lineHeight: 1.5 }}>
                Their ledgers, bills, orders and balances fold into a single party under the name below. The
                others are hidden. This can’t be casually undone.
              </p>
            </div>
            <div style={{ padding: '0 20px 8px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {selList.map(p => (
                  <span key={p.stakeholder_id} style={{ fontSize: 12, color: V.sys, background: V.field, borderRadius: 999, padding: '4px 10px' }}>{p.name}</span>
                ))}
              </div>
              <label style={{ fontSize: 12, color: V.faint }}>Keep as</label>
              <input value={mergeName} autoFocus onChange={(e) => setMergeName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && mergeName.trim()) doMerge(); }}
                placeholder="Name to carry"
                style={{ width: '100%', marginTop: 5, padding: '10px 12px', borderRadius: 10, border: `1px solid ${V.line}`, fontSize: 14, color: V.ink, outline: 'none', background: V.page }} />
            </div>
            <div style={{ padding: '12px 20px 16px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setMergeOpen(false)} style={{ fontSize: 13, fontWeight: 600, color: V.sys, background: 'none', border: 0, cursor: 'pointer' }}>Cancel</button>
              <button disabled={busy || !mergeName.trim()} onClick={doMerge}
                style={{ fontSize: 13, fontWeight: 600, color: '#fff', background: V.terra, border: 0, borderRadius: 999, padding: '9px 20px', cursor: 'pointer' }}>
                {busy ? 'Merging…' : 'Merge'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* the party's full running ledger, as a side slide-over (sits above this modal) */}
      <StakeholderLedgerDrawer isOpen={!!ledgerFor} stakeholderId={ledgerFor ?? ''} onClose={() => setLedgerFor(null)} />
    </>,
    document.body,
  );
}
