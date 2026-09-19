/**
 * Parties on a phone — the "Briklay · Parties" reference, wired to the directory itself.
 *
 * The reference is a phone book with money in it, and it behaves like one: search first, A to Z
 * underneath, always, with a letter rail to jump. The order never changes, so a name is where it was
 * yesterday; money is a FILTER (tap the header figure, or a pill), never a re-sort.
 *
 * What the artifact stands in for, and what it reads here:
 *   owe / ahead / paid  → usePartyMoney, the same three figures (and the same query keys) the desktop
 *                         Parties page reads, so the two can never disagree by a rupee.
 *   trade · phone ·
 *   bank · also-known-as → stakeholders.category / contact / bank_details / aliases
 *   pending              → a party with neither a phone nor a trade: added, never checked.
 *   the row              → opens their ledger.  the ⋯ → the party itself, edited in place.
 *   hold to delete       → refused outright when they have transactions, orders or bills on file;
 *                          those carry money history a delete would orphan (the desktop's own guard).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useOrgId } from '../../lib/auth/AuthProvider';
import { usePartyMoney, paidOf, outstandingOf, creditOf } from '../../lib/partyMoney';
import { useSoftKeyboard } from '../../lib/useSoftKeyboard';
import { useSheetDrag } from '../../lib/sheetDrag';
import { useSheetFlag } from '../../lib/sheetFlag';
import { usePullToRefresh, useLiveCount } from '../../lib/usePullToRefresh';
import { renameWalletHolder } from '../../lib/walletApi';
import type { Stakeholder, StakeholderType } from '../../types';
import { PMX_CSS } from './pmxCss';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const esc = (t: unknown) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const initials = (n: string) => n.replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
const hapt = (p: number | number[]) => { try { navigator.vibrate?.(p as number); } catch { /* not every phone has it */ } };

const CHEV = '<svg class="c" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

/** The artifact's lowercase kinds ↔ the column's own words. */
const KIND: Record<string, StakeholderType> = { vendor: 'Vendor', worker: 'Worker', client: 'Client' };
const kindOf = (t: string | null | undefined): 'vendor' | 'worker' | 'client' =>
  t === 'Worker' ? 'worker' : t === 'Client' ? 'client' : 'vendor';
const TYPES: [string, string][] = [['vendor', 'Vendor'], ['worker', 'Worker'], ['client', 'Client']];
const GSTS = ['Regular', 'Composition', 'Unregistered'];

/** A phone as the column keeps it: ten digits, shown 98480 12321. */
const tenDigits = (v: string) => v.replace(/\D/g, '').replace(/^(91|0)(?=\d{10})/, '').slice(0, 10);
const pretty = (d: string) => (d.length > 5 ? d.slice(0, 5) + ' ' + d.slice(5) : d);

/** One party, as this page thinks about it. */
interface P {
  id: string; name: string; type: 'vendor' | 'worker' | 'client'; trade: string; phone: string;
  bank: string; aka: string; gst: string;
  owe: number; ahead: number; paid: number; pending: boolean;
}

export default function PartiesMobile() {
  const orgId = useOrgId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const money = usePartyMoney(orgId);
  const kb = useSoftKeyboard();

  const { data: rows } = useQuery({
    queryKey: ['stakeholders', orgId],
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('stakeholders').select('*').eq('org_id', orgId!)
        .is('merged_into', null).order('created_at', { ascending: false });
      if (error) throw error;
      return data as Stakeholder[];
    },
  });

  const PARTIES = useMemo<P[]>(() => (rows ?? []).map((s) => ({
    id: s.stakeholder_id,
    name: s.name,
    type: kindOf(s.type),
    trade: s.category || '',
    phone: s.contact || '',
    bank: s.bank_details || '',
    aka: (s.aliases ?? []).join(', '),
    gst: s.gst_reg_type || 'Unregistered',
    owe: outstandingOf(money, s.stakeholder_id),
    ahead: creditOf(money, s.stakeholder_id),
    paid: paidOf(money, s.stakeholder_id),
    // "Pending" is the artifact's own rule: added but never checked — no phone, and no trade.
    pending: !s.contact && !s.category,
  })), [rows, money]);

  const [type, setType] = useState<'all' | 'vendor' | 'worker' | 'client'>('all');
  const [query, setQuery] = useState('');
  const [only, setOnly] = useState<'' | 'owe' | 'ahead' | 'pending'>('');
  const [litId, setLitId] = useState('');
  const [compact, setCompact] = useState(false);
  const [tuck, setTuck] = useState(false);
  const [folded, setFolded] = useState(false);
  const [panel, setPanel] = useState<null | { kind: 'card'; id: string } | { kind: 'new' } | { kind: 'menu' }>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);

  useSheetFlag(!!panel);

  const rootRef = useRef<HTMLDivElement>(null);
  const qRef = useRef<HTMLInputElement>(null);
  const holdToolsRef = useRef(0);

  // Pull the book down from the top and it reads the directory again.
  const liveCount = useLiveCount(PARTIES.length);
  const { view: pullView } = usePullToRefresh({
    attachTo: rootRef, noun: 'party', count: liveCount,
    onRefresh: () => qc.refetchQueries({ type: 'active' }),
  });

  const say = useCallback((text: string, undo?: () => void) => setToast({ text, undo }), []);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.undo ? 4500 : 2100);
    return () => window.clearTimeout(t);
  }, [toast]);

  const TOTALS = useMemo(() => ({
    all: PARTIES.length,
    vendor: PARTIES.filter((p) => p.type === 'vendor').length,
    worker: PARTIES.filter((p) => p.type === 'worker').length,
    client: PARTIES.filter((p) => p.type === 'client').length,
  }), [PARTIES]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, '');
    return PARTIES.filter((p) => (type === 'all' || p.type === type)
      && (!only || (only === 'owe' ? p.owe > 0 : only === 'ahead' ? p.ahead > 0 : p.pending))
      && (!q || (p.name + p.trade + p.phone + p.aka).toLowerCase().replace(/\s+/g, '').includes(q)));
  }, [PARTIES, type, only, query]);

  const owed = useMemo(() => PARTIES.filter((p) => p.owe > 0), [PARTIES]);
  const totalOwed = owed.reduce((a, p) => a + p.owe, 0);
  const totalAhead = PARTIES.reduce((a, p) => a + p.ahead, 0);
  const nPending = PARTIES.filter((p) => p.pending).length;

  // ── the list, drawn the artifact's way ──────────────────────────────────────
  const rowHTML = (p: P) => {
    const meta = (p.pending ? '<i class="ring"></i>pending · ' : '')
      + (p.type === 'worker' ? 'Worker' : p.type === 'client' ? 'Client' : 'Vendor')
      + (p.trade ? ' · ' + esc(p.trade) : '') + (p.phone && !p.trade ? ' · ' + esc(p.phone) : '');
    const fig = p.owe ? `<span class="fig"><b>${inr(p.owe)}</b><small>you owe</small></span>`
      : p.ahead ? `<span class="fig ahead"><b>${inr(p.ahead)}</b><small>paid ahead</small></span>`
      : p.paid ? `<span class="fig paid"><b>${inr(p.paid)}</b><small>paid so far</small></span>` : '';
    return `<div class="row${p.id === litId ? ' lit' : ''}" data-id="${esc(p.id)}">`
      + `<button type="button" class="go" data-go><span class="av${p.type === 'worker' ? ' w' : ''}">${esc(initials(p.name))}</span>`
      + `<span class="nm"><b>${esc(p.name)}</b><span>${meta}</span></span>${fig}</button>`
      + `<button type="button" class="dots" data-card aria-label="${esc(p.name)}: call, WhatsApp, details"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg></button></div>`;
  };

  const filtered = !!query.trim() || !!only;
  const plain = !filtered;
  const letters = useMemo(() => {
    if (!plain) return [];
    return [...new Set(visible.map((p) => (p.name[0] || '?').toUpperCase()))].sort();
  }, [visible, plain]);

  const listHTML = useMemo(() => {
    if (!visible.length) {
      return type === 'client' && !filtered
        ? '<div class="empty"><b>No clients yet</b>Add the people who pay you, and what they owe shows up here.<br><button type="button" data-new="client">Add a client</button></div>'
        : `<div class="empty"><b>Nobody by that name</b>${query.trim() ? `Add “${esc(query.trim())}” as a new party?<br><button type="button" data-new="">Add them</button>` : 'Nothing to show here.'}</div>`;
    }
    if (plain) {
      const az = [...visible].sort((a, b) => a.name.localeCompare(b.name));
      return letters.map((L) => `<div class="sec" id="pmx-L-${L}"><h2>${L}</h2><span></span></div>`
        + `<div class="card">${az.filter((p) => (p.name[0] || '?').toUpperCase() === L).map(rowHTML).join('')}</div>`).join('');
    }
    const s = [...visible].sort((a, b) => a.name.localeCompare(b.name));
    return '<div style="height:12px"></div><div class="card wide">' + s.map(rowHTML).join('') + '</div>';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, plain, letters, type, filtered, query, litId]);

  const resultHTML = only
    ? ({ owe: `<b>${visible.length}</b> you owe money to.`,
         ahead: `<b>${visible.length}</b> paid more than their bills add up to. Usually the bills are missing, or not linked to the payments.`,
         pending: `<b>${visible.length}</b> added but not checked yet: no phone, no trade, or never confirmed.` }[only])
      + '<button type="button" data-clear>Show all</button>'
    : query.trim() ? `<b>${visible.length}</b> ${visible.length === 1 ? 'match' : 'matches'}` : '';

  const only_ = (k: 'owe' | 'ahead' | 'pending') => {
    setOnly((o) => (o === k ? '' : k));
    hapt(5);
    holdToolsRef.current = Date.now() + 1200;
    setTuck(false);
  };

  // ── scroll: slim header, quick-return tools, folding capsule ────────────────
  useEffect(() => {
    let lastY = 0;
    const onScroll = () => {
      const y = window.scrollY;
      const hero = rootRef.current?.querySelector('.hero') as HTMLElement | null;
      const past = y > (hero?.offsetHeight ?? 220) - 54;
      const d = y - lastY;
      setCompact(past);
      if (Math.abs(d) > 6) {
        setFolded(d > 0 && y > 60);
        setTuck(d > 0 && past && document.activeElement !== qRef.current && Date.now() > holdToolsRef.current);
        lastY = y;
      }
      if (!past) setTuck(false);
      if (y < 8) setFolded(false);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ── the letter rail: slide a thumb down the edge ────────────────────────────
  const railRef = useRef<HTMLDivElement>(null);
  const [railLetter, setRailLetter] = useState('');
  useEffect(() => {
    const rail = railRef.current; if (!rail) return;
    let on = false, last = '';
    const hit = (clientY: number) => {
      const el = document.elementFromPoint(rail.getBoundingClientRect().left + 10, clientY) as HTMLElement | null;
      const L = el?.dataset?.l; if (!L || L === last) return;
      last = L; setRailLetter(L); hapt(3);
      const t = document.getElementById('pmx-L-' + L);
      if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 150 });
    };
    const end = () => { on = false; last = ''; setRailLetter(''); };
    const down = (e: PointerEvent) => { on = true; try { rail.setPointerCapture(e.pointerId); } catch { /* older webviews */ } hit(e.clientY); };
    const move = (e: PointerEvent) => { if (on) hit(e.clientY); };
    rail.addEventListener('pointerdown', down);
    rail.addEventListener('pointermove', move);
    ['pointerup', 'pointercancel'].forEach((n) => rail.addEventListener(n, end));
    return () => {
      rail.removeEventListener('pointerdown', down); rail.removeEventListener('pointermove', move);
      ['pointerup', 'pointercancel'].forEach((n) => rail.removeEventListener(n, end));
    };
  }, [letters.length]);

  // ── the list's own taps ─────────────────────────────────────────────────────
  const onList = useCallback((e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const n = t.closest('[data-new]') as HTMLElement | null;
    if (n) { setPanel({ kind: 'new' }); return; }
    const r = t.closest('.row') as HTMLElement | null; if (!r) return;
    const id = r.dataset.id!;
    if (t.closest('[data-card]')) { setPanel({ kind: 'card', id }); return; }
    if (t.closest('[data-go]')) navigate(`/stakeholders/${encodeURIComponent(id)}`);
  }, [navigate]);

  // The rows are markup, not elements, so the whole <main> is rebuilt whenever this string changes.
  // Holding the ELEMENT in a memo means an unrelated re-render (the keyboard opening, a chip) cannot
  // rewrite it: a rewrite between a finger going down and coming up detaches the row under it, and
  // the browser then fires no click at all — the tap is silently eaten.
  const listEl = useMemo(
    () => <main onClick={onList} dangerouslySetInnerHTML={{ __html: listHTML }} />,
    [listHTML, onList],
  );

  const closePanel = useCallback(() => setPanel(null), []);
  const panelDrag = useSheetDrag<HTMLElement>(closePanel, !!panel);

  const current = panel?.kind === 'card' ? PARTIES.find((p) => p.id === panel.id) ?? null : null;

  return (
    <div className={`pmx${kb.open ? ' kb' : ''}`} ref={rootRef}>
      <style>{PMX_CSS}</style>
      {pullView}

      <div className={`compact${compact ? ' on' : ''}`}><b>Parties</b><span>{inr(totalOwed)}<small>you owe</small></span></div>

      <div className="view">
        <header className="hero">
          <div className="hero-top">
            <h1>Parties</h1>
            <button type="button" className="icb" aria-label="Export, bulk add and more" onClick={() => setPanel({ kind: 'menu' })}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
            </button>
          </div>
          <button type="button" className="owed" onClick={() => only_('owe')}><span>{inr(totalOwed)}</span><small>you owe</small></button>
          <p className="sub">to {owed.length} of {TOTALS.all} parties · {TOTALS.vendor} vendors · {TOTALS.worker} workers</p>
          <div className="pills">
            <button type="button" className="pill" aria-pressed={only === 'ahead'} onClick={() => only_('ahead')}>
              <i className="ring" /><b>{inr(totalAhead)}</b> paid ahead of bills
            </button>
            <button type="button" className="pill" aria-pressed={only === 'pending'} onClick={() => only_('pending')}>
              <b>{nPending}</b> pending
            </button>
          </div>
        </header>

        <div className={`tools${tuck ? ' tuck' : ''}`}>
          <label className="find">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
            <input ref={qRef} type="search" autoComplete="off" enterKeyHint="search" placeholder="Name, phone or trade"
              aria-label="Search parties" value={query} onChange={(e) => setQuery(e.target.value)} onFocus={() => setTuck(false)} />
          </label>
          <div className="chips" role="group" aria-label="Show">
            {([['all', 'All'], ['vendor', 'Vendors'], ['worker', 'Workers'], ['client', 'Clients']] as const).map(([k, l]) => (
              <button key={k} type="button" className="chip" aria-pressed={k === type} onClick={() => { setType(k); hapt(4); }}>
                {l}<em>{TOTALS[k]}</em>
              </button>
            ))}
          </div>
          {!!resultHTML && (
            <p className="result" onClick={(e) => { if ((e.target as HTMLElement).closest('[data-clear]')) { setOnly(''); setQuery(''); } }}
              dangerouslySetInnerHTML={{ __html: resultHTML }} />
          )}
        </div>

        {listEl}
      </div>

      <div className={`rail${!plain || !visible.length ? ' hide' : ''}`} ref={railRef} aria-label="Jump to a letter">
        {letters.map((L) => (
          <button key={L} type="button" tabIndex={-1} data-l={L} className={railLetter === L ? 'on' : ''}>{L}</button>
        ))}
      </div>
      <div className={`letter${railLetter ? ' on' : ''}`} aria-hidden="true">{railLetter}</div>

      <div className={`scrim${panel ? ' on' : ''}`} onClick={closePanel} />
      {/* A sheet that is parked off-screen is not a dialog, and must not read as one: the pull-to-
          refresh gate treats any on-screen [role="dialog"] as something covering the page, so a
          closed sheet that kept the role silently killed pull-to-refresh for the whole page. */}
      <section className={`panel${panel ? ' on' : ''}`} {...(panel ? { role: 'dialog' as const, 'aria-modal': true } : {})} ref={panelDrag}>
        <div className="grab" aria-hidden="true"><i /></div>
        {panel?.kind === 'menu' && <MenuBody onSay={say} onClose={closePanel} />}
        {panel?.kind === 'new' && (
          <NewBody parties={PARTIES} seed={query.trim()} seedType={type !== 'all' ? type : 'vendor'} orgId={orgId}
            onClose={closePanel} onOpen={(id) => setPanel({ kind: 'card', id })}
            onDone={(id, name, pending) => {
              closePanel(); setLitId(id); setType('all'); setOnly(''); setQuery('');
              qc.invalidateQueries({ queryKey: ['stakeholders'] });
              say(`${name} added${pending ? '. Pending until they have a phone or trade.' : ''}`);
            }} />
        )}
        {panel?.kind === 'card' && current && (
          <CardBody p={current} orgId={orgId} onClose={closePanel} onSay={say}
            onSaved={(id) => { closePanel(); setLitId(id); qc.invalidateQueries({ queryKey: ['stakeholders'] }); say('Saved'); }}
            onDeleted={(name) => { closePanel(); qc.invalidateQueries({ queryKey: ['stakeholders'] }); say(`${name} deleted`); }}
            onLedger={(id) => { closePanel(); navigate(`/stakeholders/${encodeURIComponent(id)}`); }} />
        )}
      </section>

      <button type="button" data-page-cta className={`fab${folded ? ' folded' : ''}${panel ? ' away' : ''}`} aria-label="New party"
        onClick={() => setPanel({ kind: 'new' })}>
        <span className="ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></span>
        <span className="lbl">Party</span>
      </button>

      <div className={`toast${toast ? ' on' : ''}`} role="status">
        <span>{toast?.text ?? ''}</span>
        {toast?.undo && <button type="button" onClick={() => { const u = toast.undo!; setToast(null); hapt(5); u(); }}>Undo</button>}
      </div>
    </div>
  );
}

// ── the ⋯ menu ────────────────────────────────────────────────────────────────
function MenuBody({ onSay, onClose }: { onSay: (s: string) => void; onClose: () => void }) {
  return (
    <>
      <div className="p-head"><div className="t"><h2>Parties</h2></div>
        <button type="button" className="x" aria-label="Close" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <div className="menu">
        <button type="button" onClick={() => onSay('Add many at once from a sheet, or straight from your contacts')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 11a4 4 0 1 0-8 0M4 20a8 8 0 0 1 12-7M18 14v6M15 17h6" /></svg>Bulk add</button>
        <button type="button" onClick={() => onSay('Exports what is shown as CSV')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" /></svg>Export what is shown</button>
        <button type="button" onClick={() => onSay('Finds parties that look like the same person and merges their ledgers')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4v6a6 6 0 0 0 6 6h6M18 4v4M14 12l4 4-4 4" /></svg>Find duplicates</button>
      </div>
    </>
  );
}

// ── the party itself, edited in place ─────────────────────────────────────────
function CardBody({ p, orgId, onClose, onSay, onSaved, onDeleted, onLedger }: {
  p: P; orgId: string | null | undefined; onClose: () => void; onSay: (s: string, undo?: () => void) => void;
  onSaved: (id: string) => void; onDeleted: (name: string) => void; onLedger: (id: string) => void;
}) {
  const [draft, setDraft] = useState<P>(p);
  const [open, setOpen] = useState('');
  const [dirty, setDirty] = useState(false);
  const [changed, setChanged] = useState('');
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);
  const holdRef = useRef(0);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => { editRef.current?.focus({ preventScroll: true }); }, [open]);

  const set = (k: keyof P, v: string) => { setDraft((d) => ({ ...d, [k]: v })); setDirty(true); };
  const tel = draft.phone.replace(/\D/g, '');

  async function save() {
    if (!dirty || busy) return;
    setBusy(true);
    try {
      const isVendor = draft.type === 'vendor';
      const payload: Record<string, unknown> = {
        name: draft.name.trim(), type: KIND[draft.type], category: draft.trade.trim() || '',
        contact: draft.phone.trim() || null, bank_details: draft.bank.trim() || null,
        aliases: draft.aka.split(',').map((x) => x.trim()).filter(Boolean),
        gst_reg_type: isVendor ? draft.gst : null,
      };
      const { error } = await supabase.from('stakeholders').update(payload).eq('stakeholder_id', p.id);
      if (error) throw error;
      // A wallet keeps a copy of its holder's name, so a rename here has to reach it too.
      if (orgId && draft.name.trim() !== p.name) void renameWalletHolder(orgId, p.id, draft.name.trim());
      hapt(8);
      onSaved(p.id);
    } catch (e) { setBusy(false); onSay(e instanceof Error ? e.message : 'Could not save'); }
  }

  /** A party with money history cannot be deleted — it would orphan the records. The desktop's guard. */
  async function reallyDelete() {
    const [tx, wo, po, bl] = await Promise.all([
      supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('stakeholder_id', p.id).neq('status', 'Voided'),
      supabase.from('work_orders').select('*', { count: 'exact', head: true }).eq('stakeholder_id', p.id).neq('status', 'Cancelled'),
      supabase.from('purchase_orders').select('*', { count: 'exact', head: true }).eq('stakeholder_id', p.id).neq('status', 'Cancelled'),
      supabase.from('bills').select('*', { count: 'exact', head: true }).eq('stakeholder_id', p.id),
    ]);
    if (((tx.count || 0) + (wo.count || 0) + (po.count || 0) + (bl.count || 0)) > 0) {
      onSay('They have entries in Book. A party with a ledger cannot be deleted.');
      return;
    }
    const clr = await supabase.from('transactions').update({ stakeholder_id: null }).eq('stakeholder_id', p.id);
    if (clr.error) { onSay(clr.error.message); return; }
    const { error } = await supabase.from('stakeholders').delete().eq('stakeholder_id', p.id);
    if (error) { onSay(error.message); return; }
    hapt([14, 40, 24]);
    onDeleted(p.name);
  }

  const startHold = (e: React.PointerEvent) => {
    e.preventDefault();
    if (p.paid || p.owe) { onSay('They have entries in Book. A party with a ledger cannot be deleted.'); return; }
    setHeld(true); hapt(6);
    holdRef.current = window.setTimeout(() => { setHeld(false); void reallyDelete(); }, 1000);
  };
  const stopHold = () => { if (!held) return; window.clearTimeout(holdRef.current); setHeld(false); onSay('Keep holding to delete'); };

  // Plain render helpers, deliberately NOT components: a component defined in the body is a new type
  // on every render, so React would unmount the open field on each keystroke and take the focus with it.
  const row = (k: string, label: string, value: string, pick: React.ReactNode, mono?: boolean) => (
    <div key={k}>
      <button type="button" className={`rowS${open === k ? ' open' : ''}`} onClick={() => { setOpen((o) => (o === k ? '' : k)); hapt(3); }}>
        <span className="l">{label}</span>
        <span className={`v${value ? '' : ' none'}${mono && value ? ' mono' : ''}${changed === k ? ' chg' : ''}`}>{value || 'Add'}</span>
        <span dangerouslySetInnerHTML={{ __html: CHEV }} />
      </button>
      {open === k && <div className="pick">{pick}</div>}
    </div>
  );
  const inp = (k: keyof P, ph: string) => (
    <input className="inp" ref={editRef} type="text" autoComplete="off" enterKeyHint="done"
      placeholder={ph} value={String(draft[k])} onChange={(e) => set(k, e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') { setOpen(''); setChanged(String(k)); } }} />
  );

  return (
    <>
      <div className="p-head">
        <span className="av">{initials(draft.name)}</span>
        <div className="t"><h2>{draft.name || 'Unnamed'}</h2>
          <span>{(p.pending ? 'Pending · ' : '') + (TYPES.find((t) => t[0] === draft.type)?.[1] ?? 'Vendor') + (draft.trade ? ' · ' + draft.trade : '')}</span>
        </div>
        <button type="button" className="x" aria-label="Close" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>

      <div className="two">
        <div><small>Paid so far</small><b>{inr(p.paid)}</b></div>
        <div><small>{p.ahead ? 'Paid ahead of bills' : 'You owe'}</small>
          <b className={p.owe ? 'owe' : ''}>{p.owe ? inr(p.owe) : p.ahead ? inr(p.ahead) : 'Nothing'}</b></div>
      </div>

      <div className="acts">
        <button type="button" className="pri" onClick={() => onLedger(p.id)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h10a2 2 0 0 1 2 2v15H8a2 2 0 0 1-2-2v-15Z" /><path d="M9.5 8h5M9.5 11.5h5" /></svg>Ledger</button>
        {tel ? (
          <>
            <a className="wa" href={`https://wa.me/91${tel}`} target="_blank" rel="noopener">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.6-1.2A9 9 0 1 0 12 3Z" /></svg>Chat</a>
            <a href={`tel:+91${tel}`}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4 1.5v3A1.5 1.5 0 0 1 18.5 19 14.5 14.5 0 0 1 5 5.5 1.5 1.5 0 0 1 6.5 4Z" /></svg>Call</a>
          </>
        ) : (
          <button type="button" style={{ gridColumn: 'span 2', opacity: .7 }} onClick={() => setOpen('phone')}>Add a phone to call or chat</button>
        )}
      </div>

      {row('name', 'Name', draft.name, inp('name', 'Name'))}
      {row('type', 'They are a', TYPES.find((t) => t[0] === draft.type)?.[1] ?? '', (
        <div className="seg">{TYPES.map(([k, l]) => (
          <button key={k} type="button" aria-pressed={k === draft.type}
            onClick={() => { setDraft((d) => ({ ...d, type: k as P['type'] })); setDirty(true); setOpen(''); setChanged('type'); hapt(4); }}>{l}</button>
        ))}</div>
      ))}
      {row('trade', 'Trade or role', draft.trade, inp('trade', 'Mason, steel, transport…'))}
      {row('phone', 'Phone', draft.phone ? '+91 ' + draft.phone : '', (
        <div className="tel"><span>+91</span>
          <input ref={editRef} type="tel" inputMode="numeric" maxLength={11} autoComplete="off" enterKeyHint="done"
            placeholder="98480 12321" value={draft.phone}
            onChange={(e) => set('phone', pretty(tenDigits(e.target.value)))}
            onKeyDown={(e) => { if (e.key === 'Enter') { setOpen(''); setChanged('phone'); } }} />
        </div>
      ), true)}
      {row('bank', 'Bank or UPI', draft.bank, inp('bank', 'Account no. or UPI id'), true)}
      {row('aka', 'Also known as', draft.aka, (
        <>
          {inp('aka', 'Sreenu, Srinu mestri…')}
          <p className="hint">Never shown. Used so WhatsApp messages and search still find them under other names.</p>
        </>
      ))}
      {draft.type === 'vendor' && row('gst', 'GST', draft.gst, (
        <div className="seg">{GSTS.map((g) => (
          <button key={g} type="button" aria-pressed={g === draft.gst} style={{ fontSize: 13 }}
            onClick={() => { setDraft((d) => ({ ...d, gst: g })); setDirty(true); setOpen(''); setChanged('gst'); hapt(4); }}>{g}</button>
        ))}</div>
      ))}

      <div className="foot">
        <button type="button" className={`big${busy ? ' ok' : ''}`} disabled={!dirty || busy} onClick={save}>
          {busy ? 'Saved' : dirty ? 'Save changes' : 'No changes'}
        </button>
      </div>
      <button type="button" className={`del${held ? ' hold' : ''}`}
        onContextMenu={(e) => e.preventDefault()} onPointerDown={startHold}
        onPointerUp={stopHold} onPointerLeave={stopHold} onPointerCancel={stopHold}>
        <span>Hold to delete this party</span>
      </button>
    </>
  );
}

// ── a new party: a name is enough to start paying them ────────────────────────
function NewBody({ parties, seed, seedType, orgId, onOpen, onDone, onClose }: {
  parties: P[]; seed: string; seedType: 'vendor' | 'worker' | 'client'; orgId: string | null | undefined;
  onOpen: (id: string) => void; onDone: (id: string, name: string, pending: boolean) => void; onClose: () => void;
}) {
  const [name, setName] = useState(seed);
  const [kind, setKind] = useState<'vendor' | 'worker' | 'client'>(seedType);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!seed) nameRef.current?.focus({ preventScroll: true }); }, [seed]);

  /** Already here under another spelling? Say so before a second ledger is created for one person. */
  const twin = useMemo(() => {
    const k = name.toLowerCase().replace(/[^a-z]/g, '');
    if (k.length < 4) return null;
    return parties.find((p) => {
      const n = p.name.toLowerCase().replace(/[^a-z]/g, ''), a = p.aka.toLowerCase().replace(/[^a-z]/g, '');
      return n.startsWith(k.slice(0, 6)) || k.startsWith(n.slice(0, 6)) || (!!a && a.includes(k.slice(0, 5)));
    }) ?? null;
  }, [name, parties]);

  async function add() {
    const clean = name.trim();
    if (!clean || busy || !orgId) return;
    setBusy(true);
    try {
      const id = `STK-${Math.floor(1000 + Math.random() * 9000)}`;
      const { error } = await supabase.from('stakeholders').insert([{
        stakeholder_id: id, org_id: orgId, name: clean, type: KIND[kind], category: '',
        contact: phone.trim() || null, aliases: [],
        gst_reg_type: kind === 'vendor' ? 'Unregistered' : null,
      }]);
      if (error) throw error;
      hapt(8);
      onDone(id, clean, !phone.trim());
    } catch (e) { setBusy(false); setErr(e instanceof Error ? e.message : 'Could not add'); }
  }

  return (
    <>
      <div className="p-head"><div className="t"><h2>New party</h2>
        <span>The rest can wait. A name is enough to start paying them.</span></div>
        <button type="button" className="x" aria-label="Close" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <label className="lab" htmlFor="pmx-name">Name</label>
      <input className="inp" id="pmx-name" ref={nameRef} type="text" autoComplete="off" autoCapitalize="words"
        enterKeyHint="next" placeholder="Person or firm" value={name} onChange={(e) => setName(e.target.value)} />
      {twin && (
        <div className="twin"><b>{twin.name}</b> is already here{twin.trade ? ` (${twin.trade.toLowerCase()})` : ''}. Same one?
          <button type="button" onClick={() => onOpen(twin.id)}>Yes, open them</button>
        </div>
      )}
      <span className="lab">They are a</span>
      <div className="seg">{TYPES.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={k === kind} onClick={() => { setKind(k as typeof kind); hapt(4); }}>{l}</button>
      ))}</div>
      <label className="lab" htmlFor="pmx-phone">Phone, if you have it</label>
      <div className="tel"><span>+91</span>
        <input id="pmx-phone" type="tel" inputMode="numeric" maxLength={11} autoComplete="off" enterKeyHint="done"
          placeholder="98480 12321" value={phone} onChange={(e) => setPhone(pretty(tenDigits(e.target.value)))} />
      </div>
      {err && <p className="hint">{err}</p>}
      <div className="foot">
        <button type="button" className={`big${busy ? ' ok' : ''}`} disabled={!name.trim() || busy} onClick={add}>
          {busy ? 'Added' : 'Add party'}
        </button>
      </div>
    </>
  );
}
