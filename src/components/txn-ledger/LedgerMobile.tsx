/**
 * LedgerMobile — Transactions on a phone, ported from the reference prototype
 * (claude.ai/artifact/NwLbqWpJbQbMpzduWJSPGV) value for value.
 *
 *   header  answers one question: how much went out, lately. The period is a choice (14 days ·
 *           month · all), not a fixed "all time". "In" appears only when there is any. Tap a bar to
 *           see that day. Two quiet pills carry what needs attention: entries not linked to a bill
 *           (the hollow clay ring = check this) and money sitting in wallets. Import and export live
 *           under ⋯; New transaction is the action capsule, so the header does not repeat it.
 *   rows    two lines, not three. Amounts are ink, not red: when everything is an outflow, red says
 *           nothing. A party gets initials; an entry with no party gets a dashed ring (that IS
 *           information).
 *   source  paid straight from you = nothing to mark. Spent from a wallet = a small named tag. A
 *           top-up is a transfer, not an expense: arrow mark, grey amount, left out of the day's
 *           total — as the ledger already counts it.
 *   ledger  each day still closes with the double rule; a wallet opens as its own ledger, with what
 *           was left after each line.
 *   select  long-press. The mark turns into a tick, the top bar counts and sums, and the nav bar
 *           BECOMES the action bar. Nothing floats over the rows you are choosing. Void must be
 *           held, never tapped.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../../lib/supabase';
import { useSnackbar } from '../Snackbar';
import { navTakeover } from '../nav/txDraft';
import type { WalletBalance } from '../../lib/walletApi';
import { LMX_CSS } from './lmxCss';
import { DocPeek } from './DocPeek';
import { useSignedDocs, isPdf, type Paper } from './docSigning';
import { useSheetDrag } from '../../lib/sheetDrag';
import { useSheetFlag } from '../../lib/sheetFlag';
import { toEntry, type Entry, type LedgerRaw } from './toEntry';
import { useOrgId } from '../../lib/auth/AuthProvider';
import { PayableOptions } from '../payables/PayableOptions';
import { applyAttribution, prefetchAttrTargets, type Selection } from '../../lib/payableAttribution';
import { useQueryClient } from '@tanstack/react-query';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const initials = (n: string) => n.replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const shortSite = (s: string) => s.replace(' Residence', '').replace(' Apartments', '');
/** The paper an entry carries, bill first — it is the one that explains the money. */
const papersOf = (e: Entry): Paper[] => [
  ...(e.bill ? [{ kind: 'Bill' as const, url: e.bill }] : []),
  ...(e.proof ? [{ kind: 'Proof' as const, url: e.proof }] : []),
];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

const WALLET_ICON = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7.5a2 2 0 0 1 2-2h10v3" /><path d="M4.5 7.5v9a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-13" /><path d="M15.6 13.5h.01" /></svg>;
const TICK = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
const CHEVR = <svg className="c" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>;
const CROSS = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>;

type Period = '14' | 'month' | 'all';
type Cut = 'all' | 'direct' | 'wallet';
type Panel = null | { kind: 'entry'; e: Entry } | { kind: 'wallets' } | { kind: 'filters' } | { kind: 'more' } | { kind: 'category' } | { kind: 'site' };

export function LedgerMobile({ rows, wallets, categories, sites, loading, refetch, onOpenEntry, onCompose, onImport, onSettle, session }: {
  rows: LedgerRaw[];
  wallets: WalletBalance[];
  /** the categories a bulk re-categorise may choose from: [code, label] */
  categories: [string, string][];
  sites: { id: string; name: string }[];
  loading: boolean;
  refetch: () => void;
  onOpenEntry: (id: string) => void;
  onCompose: () => void;
  onImport: () => void;
  /** counting what is left and closing a wallet is its own page */
  onSettle: () => void;
  session: { user: { id: string } };
}) {
  const { show } = useSnackbar();
  const [period, setPeriod] = useState<Period>('14');
  const [cut, setCut] = useState<Cut>('all');
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(-1);
  const [ledger, setLedger] = useState('');              // a wallet holder's own ledger
  const [F, setF] = useState<{ site: string; clip: boolean; min: number }>({ site: '', clip: false, min: 0 });
  const [panel, setPanel] = useState<Panel>(null);
  const qc = useQueryClient();
  useSheetFlag(!!panel);   // the page's dark headers step aside while a card is up
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [compact, setCompact] = useState(false);
  const [tuck, setTuck] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [peek, setPeek] = useState<{ e: Entry; at: number } | null>(null);
  const qRef = useRef<HTMLInputElement | null>(null);

  const buzz = (ms: number | number[] = 6) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };
  const toastT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((text: string, undo?: () => void) => {
    setToast({ text, undo });
    if (toastT.current) clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast(null), undo ? 4500 : 1900);
  }, []);
  useEffect(() => () => { if (toastT.current) clearTimeout(toastT.current); }, []);

  const all = useMemo(() => rows.map(toEntry), [rows]);

  // ── the period the header answers for ──
  const since = useMemo(() => {
    if (period === 'all') return '';
    const d = new Date();
    if (period === 'month') { d.setDate(1); return d.toISOString().slice(0, 10); }
    d.setDate(d.getDate() - 13);
    return d.toISOString().slice(0, 10);
  }, [period]);
  const inPeriod = useMemo(() => all.filter((e) => !e.voided && (!since || e.date >= since)), [all, since]);
  const head = useMemo(() => {
    const out = inPeriod.filter((e) => e.dir === 'out' && e.src !== 'topup').reduce((a, e) => a + e.amt, 0);
    const money = inPeriod.filter((e) => e.dir === 'in' && e.src !== 'topup').reduce((a, e) => a + e.amt, 0);
    return { out, in: money, n: inPeriod.length };
  }, [inPeriod]);

  // last 14 days of outflow, as a share of the busiest
  const bars = useMemo(() => {
    const days: { key: string; label: string; total: number }[] = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({ key, label: `${d.getDate()} ${MON[d.getMonth()]}`, total: 0 });
    }
    const byKey = new Map(days.map((d) => [d.key, d]));
    for (const e of all) { if (e.voided || e.src === 'topup' || e.dir !== 'out') continue; const d = byKey.get(e.date); if (d) d.total += e.amt; }
    const top = Math.max(1, ...days.map((d) => d.total));
    return days.map((d) => ({ ...d, pct: Math.round(d.total / top * 100) }));
  }, [all]);

  const notLinked = useMemo(() => all.filter((e) => !e.voided && !e.linked && e.src !== 'topup').length, [all]);
  const inWallets = useMemo(() => wallets.reduce((a, w) => a + w.balance, 0), [wallets]);

  // ── what is shown ──
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((e) => {
      if (e.voided) return false;
      if (ledger) { if (e.wallet !== ledger) return false; if (cut === 'wallet' && e.src !== 'wallet') return false; if (cut === 'direct' && e.src !== 'topup') return false; }
      else {
        if (since && e.date < since) return false;
        if (cut !== 'all' && e.src !== cut) return false;
        if (unlinkedOnly && (e.linked || e.src === 'topup')) return false;
      }
      if (F.site && e.siteId !== F.site) return false;
      if (F.clip && !e.clip) return false;
      if (e.amt < F.min) return false;
      if (q && !`${e.name} ${e.site} ${e.note} ${e.wallet} ${e.amt}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, ledger, cut, unlinkedOnly, since, F, query]);

  const nF = (F.site ? 1 : 0) + (F.clip ? 1 : 0) + (F.min ? 1 : 0);
  const filtered = cut !== 'all' || !!query.trim() || unlinkedOnly || nF > 0;

  // a wallet's ledger: what was left after each line, walked back from today's balance
  const leftAfter = useMemo(() => {
    if (!ledger) return {} as Record<string, number> & { opening?: number };
    const w = wallets.find((x) => x.holderName === ledger);
    const out: Record<string, number> & { opening?: number } = {};
    let b = w?.balance ?? 0;
    for (const e of all.filter((x) => x.wallet === ledger && !x.voided)) { out[e.id] = b; b -= e.src === 'topup' ? e.amt : -e.amt; }
    out.opening = b;
    return out;
  }, [ledger, all, wallets]);

  const days = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of visible) { const k = e.date; if (!map.has(k)) map.set(k, []); map.get(k)!.push(e); }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [visible]);
  const today = new Date().toISOString().slice(0, 10);

  // ── scroll: the compact header, the tools that step aside ──
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY, heroH = document.querySelector<HTMLElement>('.lmx .hero')?.offsetHeight ?? 320;
      const past = y > heroH - 54;
      setCompact(past);
      const d = y - last;
      if (Math.abs(d) > 6) {
        const busy = document.activeElement === qRef.current;   // never hide it while he is typing in it
        setTuck(d > 0 && past && !busy);
        last = y;
      }
      if (!past) setTuck(false);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ── select ──
  const press = useRef<{ t: ReturnType<typeof setTimeout> | null; el: HTMLElement | null; x: number; y: number; fired: boolean }>({ t: null, el: null, x: 0, y: 0, fired: false });
  const cancelPress = () => { if (press.current.t) clearTimeout(press.current.t); press.current.el?.classList.remove('press'); press.current.t = null; };
  const enterSelect = (id?: string) => { setSelecting(true); setSel(new Set(id ? [id] : [])); };
  const exitSelect = useCallback(() => { setSelecting(false); setSel(new Set()); }, []);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); if (!n.size) setSelecting(false); return n; });
  const selectedAll = useMemo(() => all.filter((e) => sel.has(e.id)), [all, sel]);
  const allShown = visible.length > 0 && visible.every((e) => sel.has(e.id));

  // ── the writes ──
  const doVoid = async () => {
    const ids = [...sel], before = selectedAll.map((e) => ({ id: e.id, status: e.status }));
    const total = selectedAll.reduce((a, e) => a + e.amt, 0);
    setGone(new Set(ids));
    buzz([14, 40, 24]);
    setTimeout(() => { void (async () => {
      try {
        const { error } = await supabase.from('transactions').update({ status: 'Voided', voided_by: session.user.id, voided_at: new Date().toISOString() }).in('txn_id', ids);
        if (error) throw error;
        exitSelect(); setGone(new Set()); refetch();
        say(`${ids.length} ${ids.length === 1 ? 'entry' : 'entries'} voided · ${inr(total)}`, async () => {
          for (const b of before) await supabase.from('transactions').update({ status: b.status, voided_by: null, voided_at: null }).eq('txn_id', b.id);
          refetch(); say('Put back');
        });
      } catch (e) { setGone(new Set()); show((e as Error)?.message || 'Could not void', { type: 'error' }); }
    })(); }, 480);
  };
  const doCategory = async (code: string) => {
    const ids = [...sel];
    try {
      const { error } = await supabase.from('transactions').update({ category: code }).in('txn_id', ids).neq('status', 'Voided');
      if (error) throw error;
      setPanel(null); exitSelect(); refetch(); say(`${ids.length} ${ids.length === 1 ? 'entry' : 'entries'} re-categorised`);
    } catch (e) { show((e as Error)?.message || 'Could not update', { type: 'error' }); }
  };
  const doSite = async (projectId: string) => {
    // A split entry names more than one site; moving it to one would quietly collapse the split.
    const movable = selectedAll.filter((e) => e.allocs === 1 && !e.voided);
    const skipped = selectedAll.length - movable.length;
    if (!movable.length) { show('These entries are split across sites — open one to move it', { type: 'error' }); return; }
    try {
      const { error } = await supabase.from('txn_allocations').update({ project_id: projectId }).in('txn_id', movable.map((e) => e.id));
      if (error) throw error;
      setPanel(null); exitSelect(); refetch();
      say(`${movable.length} moved${skipped ? ` · ${skipped} left alone (split)` : ''}`);
    } catch (e) { show((e as Error)?.message || 'Could not move them', { type: 'error' }); }
  };
  const csv = (list: Entry[], name: string) => {
    const head2 = ['Date', 'Party', 'Site', 'Note', 'Amount', 'Direction', 'Paid from', 'Category', 'Bill'];
    const body = list.map((e) => [e.date, e.name, e.site, e.note, e.amt, e.dir, e.src === 'wallet' ? `${e.wallet}'s wallet` : e.src === 'topup' ? 'transfer' : `you · ${e.via}`, e.cat, e.linked ? 'linked' : '']);
    const text = [head2, ...body].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `${name}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  // ── the bar, borrowed while selecting ──
  const voidRef = useRef<HTMLButtonElement | null>(null);
  const holdT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acts: ReactNode = useMemo(() => {
    const n = sel.size;
    const stop = () => { const v = voidRef.current; if (!v?.classList.contains('hold')) return; if (holdT.current) clearTimeout(holdT.current); v.classList.remove('hold'); say('Keep holding to void'); };
    return (
      <>
        <button type="button" className="tab" disabled={!n} onClick={() => { csv(selectedAll, `transactions-${n}`); say(`CSV of ${n} ${n === 1 ? 'entry' : 'entries'} downloaded`); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" /></svg><span>Export</span>
        </button>
        <button type="button" className="tab" disabled={!n} onClick={() => setPanel({ kind: 'category' })}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h7v6H4zM13 12.5h7v6h-7z" /><circle cx="16.5" cy="8.5" r="3" /><path d="m4.5 18.5 3-5 3 5h-6Z" /></svg><span>Category</span>
        </button>
        <button type="button" className="tab" disabled={!n} onClick={() => setPanel({ kind: 'site' })}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20.5h16" /><path d="M6 20.5V9l6-4.5L18 9v11.5" /><path d="M10 20.5v-6h4v6" /></svg><span>Site</span>
        </button>
        <button ref={voidRef} type="button" className="tab void" disabled={!n}
          onContextMenu={(ev) => ev.preventDefault()}
          onPointerDown={(ev) => { ev.preventDefault(); if (!n) return; voidRef.current?.classList.add('hold'); buzz(6); holdT.current = setTimeout(() => { voidRef.current?.classList.remove('hold'); void doVoid(); }, 900); }}
          onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="m6.5 17.5 11-11" /></svg><span>Hold to void</span>
        </button>
      </>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, selectedAll, say]);
  // Only the bar binds the takeover; a page offers. (Binding here once clobbered the bar's own
  // handler whenever the page mounted after it — which is always, since the bar outlives the page.)
  useEffect(() => { navTakeover.offer(selecting ? acts : null); }, [selecting, acts]);
  useEffect(() => () => navTakeover.release(), []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key !== 'Escape') return; if (panel) setPanel(null); else if (selecting) exitSelect(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [panel, selecting, exitSelect]);

  // Hardware / browser BACK closes whatever is open — a peek, a panel, the selection, a wallet ledger —
  // instead of leaving the page. One guard history entry is pushed while any layer is open, and consumed
  // again when the layer closes by other means (tap X, scrim), so back stays in step with the screen.
  const layer = peek ? 'peek' : panel ? 'panel' : selecting ? 'sel' : ledger ? 'ledger' : '';
  const guardRef = useRef(false);
  useEffect(() => {
    if (layer && !guardRef.current) { guardRef.current = true; try { window.history.pushState({ lmxLayer: true }, ''); } catch { /* ignore */ } }
    else if (!layer && guardRef.current) { guardRef.current = false; try { if ((window.history.state as { lmxLayer?: boolean } | null)?.lmxLayer) window.history.back(); } catch { /* ignore */ } }
  }, [layer]);
  useEffect(() => {
    const onPop = () => {
      guardRef.current = false;            // our guard entry was just popped
      if (peek) setPeek(null); else if (panel) setPanel(null); else if (selecting) exitSelect(); else if (ledger) setLedger('');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [peek, panel, selecting, ledger, exitSelect]);

  // ── rows ──
  const openWallet = (name: string) => {
    setLedger(name); setCut('all'); setUnlinkedOnly(false); setQuery(''); setF({ site: '', clip: false, min: 0 }); setPanel(null);
    buzz(6); window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const rowEl = (e: Entry) => {
    const on = sel.has(e.id);
    const front = e.src === 'topup'
      ? <span className="f move"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h14M13 7l5 5-5 5" /></svg></span>
      : e.party ? <span className="f">{initials(e.name)}</span> : <span className="f none" title="No party named" />;
    // a wallet transfer names its direction (a recharge vs a settlement), not just "moved"
    const meta = e.src === 'topup'
      ? (e.walletDir === 'out' ? 'Wallet → Bank · returned' : 'Bank → Wallet · advance')
      : shortSite(e.site) + (e.note ? ` · ${e.note}` : '');
    const amt = ledger ? (e.src === 'topup' ? '+' : '−') + inr(e.amt) : inr(e.amt);
    const amtCls = ledger ? (e.src === 'topup' ? ' in' : '') : e.src === 'topup' ? ' move' : e.dir === 'in' ? ' in' : '';
    return (
      <button key={e.id} type="button" className={`row${on ? ' sel' : ''}${gone.has(e.id) ? ' gone' : ''}`} aria-pressed={on}
        onContextMenu={(ev) => ev.preventDefault()}
        onPointerDown={(ev) => {
          press.current = { t: null, el: ev.currentTarget, x: ev.clientX, y: ev.clientY, fired: false };
          if (selecting) return;
          ev.currentTarget.classList.add('press');
          press.current.t = setTimeout(() => { press.current.fired = true; press.current.el?.classList.remove('press'); buzz(14); enterSelect(e.id); }, 430);
        }}
        onPointerMove={(ev) => { if (Math.abs(ev.clientX - press.current.x) > 8 || Math.abs(ev.clientY - press.current.y) > 8) cancelPress(); }}
        onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerLeave={cancelPress}
        onClick={(ev) => {
          if (press.current.fired) { press.current.fired = false; return; }
          if (!selecting && (ev.target as HTMLElement).closest('.clipx')) { buzz(5); setPeek({ e, at: 0 }); return; }
          if (!selecting && (ev.target as HTMLElement).closest('.wtag')) { openWallet(e.wallet); return; }
          if (selecting) { toggle(e.id); buzz(4); return; }
          // Warm the attribution options so tapping "Payable for"/"Bill for" opens instantly.
          if (e.stakeholderId && e.src !== 'topup' && e.dir === 'out') {
            prefetchAttrTargets(qc, { id: e.stakeholderId, type: e.payeeType === 'Vendor' ? 'Vendor' : 'Worker' }, e.siteId, e.date, e.amt);
          }
          setPanel({ kind: 'entry', e });
        }}>
        <span className="mark" aria-hidden="true">{front}<span className="k">{TICK}</span></span>
        <span className="tx">
          <span className="t1"><b>{ledger && e.src === 'topup' ? 'Top-up from you' : e.name}</b><span className={`amt${amtCls}`}>{amt}</span></span>
          <span className="t2">
            <span className="meta">{meta}</span>
            <span className="tags">
              {e.clip && (
                <span className="clipx" role="button" tabIndex={-1} aria-label={`See the ${papersOf(e)[0].kind.toLowerCase()}`}
                  onPointerDownCapture={(ev) => ev.stopPropagation()}
                  onClick={(ev) => { ev.stopPropagation(); if (!selecting) { buzz(5); setPeek({ e, at: 0 }); } }}>
                  {papersOf(e).length > 1 && <i className="sheet back" />}
                  <i className="sheet" />
                </span>
              )}
              {ledger
                ? <span className="bal">left {inr(leftAfter[e.id] ?? 0)}</span>
                : e.src === 'wallet' && e.wallet ? <span className="wtag" role="button" tabIndex={-1}
                    title={`${e.wallet}'s wallet`} aria-label={`${e.wallet}'s wallet`}
                    onPointerDownCapture={(ev) => ev.stopPropagation()}
                    onClick={(ev) => { ev.stopPropagation(); if (!selecting) openWallet(e.wallet); }}>{WALLET_ICON}{initials(e.wallet)}</span> : null}
            </span>
          </span>
        </span>
      </button>
    );
  };

  const wallet = wallets.find((w) => w.holderName === ledger);
  const given = ledger ? all.filter((e) => e.wallet === ledger && e.src === 'topup' && !e.voided).reduce((a, e) => a + e.amt, 0) : 0;
  const spent = ledger ? all.filter((e) => e.wallet === ledger && e.src === 'wallet' && !e.voided).reduce((a, e) => a + e.amt, 0) : 0;
  const CHIPS: [Cut | 'unlinked', string][] = ledger ? [['all', 'All'], ['wallet', 'Spends'], ['direct', 'Top-ups']] : [['all', 'All'], ['direct', 'By you'], ['wallet', 'Wallets'], ['unlinked', 'Not linked']];
  const busiest = useMemo(() => Math.max(0, ...bars.map((b) => b.total)), [bars]);
  const entries = `${head.n} ${head.n === 1 ? 'entry' : 'entries'}`;
  const subLine = picked >= 0
    ? `${bars[picked].label} · ${bars[picked].total ? `${inr(bars[picked].total)} out` : 'nothing'}`
    : period === '14' ? `last 14 days · ${entries}${busiest ? ` · busiest day ${inr(busiest)}` : ''}`
    : period === 'month' ? `${MON[new Date().getMonth()]} so far · ${entries}`
    : `All time · ${entries}`;

  return (
    <div className={`lmx${selecting ? ' selecting' : ''}`}>
      <style>{LMX_CSS}</style>

      <div className={`lmx-compact${compact && !selecting ? ' on' : ''}`}>
        <b>{ledger ? `${ledger}'s wallet` : 'Transactions'}</b>
        <span>{ledger ? inr(wallet?.balance ?? 0) : inr(head.out)}
          <small className={filtered ? 'f' : ''}>{filtered ? `filtered · ${visible.length}` : ledger ? 'left' : period === '14' ? '14 days' : period === 'month' ? 'this month' : 'all time'}</small>
        </span>
      </div>

      <div className={`lmx-selbar${selecting ? ' on' : ''}`}>
        <button type="button" className="x" aria-label="Stop selecting" onClick={exitSelect}>{CROSS}</button>
        <div className="n" aria-live="polite"><b>{sel.size} selected</b><span>{inr(selectedAll.reduce((a, e) => a + e.amt, 0))}</span></div>
        <button type="button" className="all" onClick={() => { if (allShown) { exitSelect(); return; } setSel(new Set(visible.map((e) => e.id))); buzz(5); }}>
          {allShown ? 'Clear' : `All ${visible.length} shown`}
        </button>
      </div>

      <header className={`hero${ledger ? ' wl-hero' : ''}`}>
        {ledger && <button type="button" className="wback" onClick={() => { setLedger(''); setCut('all'); buzz(4); window.scrollTo({ top: 0 }); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>All transactions
        </button>}
        <div className="hero-top">
          <h1>{ledger ? `${ledger}'s wallet` : 'Transactions'}</h1>
          {!ledger && <button type="button" className="icb" aria-label="Import, export and more" onClick={() => setPanel({ kind: 'more' })}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
          </button>}
        </div>

        {!ledger && (
          <>
            <div className="period" role="group" aria-label="Period">
              {(['14', 'month', 'all'] as Period[]).map((p) => (
                <button key={p} type="button" aria-pressed={period === p} onClick={() => { setPeriod(p); setPicked(-1); buzz(4); }}>
                  {p === '14' ? '14 days' : p === 'month' ? 'This month' : 'All time'}
                </button>
              ))}
            </div>
            <div className="out"><span>{inr(head.out)}</span><small>out</small>{head.in > 0 && <span className="in">{inr(head.in)} in</span>}</div>
          </>
        )}
        {ledger && <div className="wbal"><span>{inr(wallet?.balance ?? 0)}</span><small>left in the wallet</small></div>}
        <p className="sub">{ledger ? `given ${inr(given)} · spent ${inr(spent)} · in these entries` : subLine}</p>
        {ledger && (
          <div className="wacts">
            <button type="button" className="pri" onClick={onCompose}>Top up</button>
            <button type="button" onClick={onSettle}>Settle</button>
            <button type="button" onClick={() => { csv(all.filter((e) => e.wallet === ledger && !e.voided), `${ledger}-wallet`); say('Wallet ledger downloaded'); }}>Share</button>
          </div>
        )}

        {!ledger && (
          <>
            <div className="bars" role="group" aria-label="Last 14 days, tap a day">
              {bars.map((b, i) => (
                <button key={b.key} type="button" className={i === 13 ? 'today' : ''} aria-pressed={i === picked} aria-label={b.label}
                  onClick={() => {
                    const next = picked === i ? -1 : i; setPicked(next); buzz(4);
                    if (next >= 0) setTimeout(() => document.querySelector(`[data-d="${b.key}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
                  }}>
                  <i style={{ height: `${Math.max(4, b.pct)}%` }} />
                </button>
              ))}
            </div>
            <div className="pills">
              <button type="button" className="pill" aria-pressed={unlinkedOnly} onClick={() => { setUnlinkedOnly((v) => !v); buzz(5); }}>
                <i className="ring" /><b>{notLinked}</b> not linked
              </button>
              <button type="button" className="pill" onClick={() => setPanel({ kind: 'wallets' })}>{WALLET_ICON}<b>{inr(inWallets)}</b> in wallets</button>
            </div>
          </>
        )}
      </header>

      <div className={`tools${tuck ? ' tuck' : ''}`}>
        <label className="find">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
          <input ref={qRef} type="search" autoComplete="off" enterKeyHint="search" placeholder="Search entries" aria-label="Search transactions"
            value={query} onChange={(ev) => setQuery(ev.target.value)} onFocus={() => setTuck(false)} />
          {query && <button type="button" className="clr" aria-label="Clear" onClick={() => { setQuery(''); qRef.current?.focus(); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>}
          <button type="button" className={`flt${nF ? ' on' : ''}`} onClick={() => setPanel({ kind: 'filters' })}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>
            <span>{nF ? `${nF} on` : 'Filters'}</span>
          </button>
        </label>
        <div className="chips" role="group" aria-label="Show">
          {CHIPS.map(([k, label]) => (
            <button key={k} type="button" className="chip"
              aria-pressed={k === 'unlinked' ? unlinkedOnly : cut === k && !(k === 'all' && unlinkedOnly)}
              onClick={() => { if (k === 'unlinked') setUnlinkedOnly((v) => !v); else { setCut(k as Cut); if (k === 'all') setUnlinkedOnly(false); } buzz(4); }}>
              {label}
            </button>
          ))}
        </div>
        {filtered && <p className="result"><b>{visible.length}</b> {visible.length === 1 ? 'entry' : 'entries'} · <b>{inr(visible.filter((e) => e.src !== 'topup' && e.dir === 'out').reduce((a, e) => a + e.amt, 0))}</b> spent</p>}
      </div>

      <main>
        {loading && !all.length && <div className="empty">Reading the book…</div>}
        {days.map(([key, list]) => {
          const spend = list.filter((e) => e.src !== 'topup' && e.dir === 'out').reduce((a, e) => a + e.amt, 0);
          const whole = list.length === all.filter((e) => e.date === key && !e.voided).length;
          const d = list[0];
          return (
            <div key={key}>
              <div className="day" data-d={key}>
                <h2>{d.day} <span>· {d.dow}</span></h2>
                <button type="button" className="dayall" onClick={() => {
                  const ids = list.map((e) => e.id), allIn = ids.every((i) => sel.has(i));
                  setSel((s) => { const n = new Set(s); ids.forEach((i) => (allIn ? n.delete(i) : n.add(i))); if (!n.size) setSelecting(false); return n; });
                  buzz(5);
                }}>{list.every((e) => sel.has(e.id)) ? 'Clear day' : 'Select day'}</button>
              </div>
              <div className="card">
                {list.map(rowEl)}
                <div className="close">
                  <em>{ledger ? 'Left at close' : whole ? (key === today ? 'Today so far' : 'Day closed') : 'These entries'}</em>
                  <b>{inr(ledger ? (leftAfter[list[0].id] ?? 0) : spend)}</b>
                </div>
              </div>
            </div>
          );
        })}
        {ledger && cut === 'all' && !query.trim() && days.length > 0 && (
          <p className="result" style={{ margin: '16px 24px 0' }}>Balance before these entries · <b>{inr(leftAfter.opening ?? 0)}</b></p>
        )}
        {!loading && !days.length && <div className="empty"><b>Nothing matches</b>Try a party, a site, or an amount.</div>}
      </main>

      <div className={`lmx-toast${toast ? ' on' : ''}`} role="status">
        <span>{toast?.text ?? ''}</span>
        {toast?.undo && <button type="button" onClick={() => { const u = toast.undo!; setToast(null); buzz(5); u(); }}>Undo</button>}
      </div>

      {peek && <DocPeek papers={papersOf(peek.e)} at={peek.at} title={peek.e.name} sub={`${peek.e.day} · ${inr(peek.e.amt)}`}
        onClose={() => setPeek(null)} onOpenEntry={() => onOpenEntry(peek.e.id)} />}

      {panel && <div className="lmx-scrim on" onClick={() => setPanel(null)} />}
      {panel && <PanelView
        panel={panel} close={() => setPanel(null)} refetch={refetch} wallets={wallets} sites={sites} categories={categories} F={F} setF={setF}
        shown={visible.length} openWallet={openWallet} onOpenEntry={onOpenEntry} onPeek={(e, at) => setPeek({ e, at })} onImport={onImport}
        onExportShown={() => { csv(visible, 'transactions'); say('Downloaded what is shown'); }}
        onSelect={() => { setPanel(null); enterSelect(); say('Tap entries to select them'); }}
        onCategory={doCategory} onSite={doSite} n={sel.size}
      />}
    </div>
  );
}

/**
 * What this entry carries, under its own line. Shut it reads "Bill and proof"; opened it lays the
 * papers out as thumbnails — the documents themselves, not icons — and one of those opens it full.
 */
function Attachments({ e, onPeek }: { e: Entry; onPeek: (at: number) => void }) {
  const [open, setOpen] = useState(false);
  const papers = papersOf(e);
  const signed = useSignedDocs(open ? papers.map((p) => p.url) : []);
  const label = papers.length === 0 ? 'None'
    : papers.length === 2 ? 'Bill and proof'
    : papers[0].kind;
  return (
    <>
      <button type="button" className={`s sx${open ? ' open' : ''}`} disabled={!papers.length}
        aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>Attachment</span>
        <b className={papers.length ? '' : 'none'}>{label}</b>
        {!!papers.length && <svg className="c" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>}
      </button>
      {open && (
        <div className="thumbs">
          {papers.map((paper, n) => {
            const url = signed[paper.url];
            return (
              <button key={paper.kind} type="button" className="th" onClick={() => onPeek(n)} aria-label={`Open the ${paper.kind.toLowerCase()}`}>
                <span className="sh">
                  {url && !isPdf(paper.url) && <img alt="" src={url} />}
                  {url && isPdf(paper.url) && <span className="pdf">PDF</span>}
                  {!url && <span className="load" />}
                </span>
                <em>{paper.kind}</em>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── the panels: the bar opens, as everywhere ──────────────────────────────────
function PanelView({ panel, close, refetch, wallets, sites, categories, F, setF, shown, openWallet, onOpenEntry, onPeek, onImport, onExportShown, onSelect, onCategory, onSite, n }: {
  panel: NonNullable<Panel>; close: () => void; refetch: () => void; wallets: WalletBalance[]; sites: { id: string; name: string }[]; categories: [string, string][];
  F: { site: string; clip: boolean; min: number }; setF: (f: { site: string; clip: boolean; min: number }) => void;
  shown: number; openWallet: (n: string) => void; onOpenEntry: (id: string) => void; onPeek: (e: Entry, at: number) => void; onImport: () => void;
  onExportShown: () => void; onSelect: () => void; onCategory: (code: string) => void; onSite: (id: string) => void; n: number;
}) {
  const orgId = useOrgId();
  const [attrStep, setAttrStep] = useState(false);   // the entry card's "next state": choose the payable
  const [on, setOn] = useState(false);
  useEffect(() => { const r = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(r); }, []);
  // Pull it down to put it back — from anywhere on the sheet (sheetDrag), which stands aside while
  // you are part-way down the panel's own scroll.
  const drag = useSheetDrag<HTMLElement>(close, on);
  const X = <button type="button" className="x" aria-label="Close" onClick={close}>{CROSS}</button>;
  const held = wallets.reduce((a, w) => a + w.balance, 0);
  const top = Math.max(1, ...wallets.map((w) => w.balance));

  let body: ReactNode;
  if (panel.kind === 'entry') {
    const e = panel.e;
    const from = e.src === 'wallet' ? `${e.wallet}'s wallet` : e.src === 'topup' ? `You → ${e.wallet}'s wallet` : `You · ${e.via || '—'}`;
    // A party payment out can be attributed to a payable — the row below is the entry point, and
    // tapping it turns THIS card into its next state (the options), not a new screen.
    const isVendorEntry = e.payeeType === 'Vendor';
    const canAttr = e.src !== 'topup' && !!e.stakeholderId && e.dir === 'out';
    const rowLabel = isVendorEntry ? 'Bill for' : 'Payable for';
    const onAttr = (sel: Selection) => { void (async () => {
      setAttrStep(false);
      if (sel.type !== 'skip') {
        try { await applyAttribution(e.id, orgId ?? '', e.amt, e.siteId || null, sel); }
        catch (err) { window.alert(err instanceof Error ? err.message : 'Could not attribute'); }
      }
      refetch(); close();
    })(); };

    body = attrStep && canAttr ? (
      <>
        <div className="p-head">
          <button type="button" className="x" aria-label="Back" onClick={() => setAttrStep(false)} style={{ order: -1 }}>{CHEVR}</button>
          <div className="t"><h2>{rowLabel}</h2><span>{e.name}{e.site ? ` · ${e.site}` : ''} · {inr(e.amt)}</span></div>{X}
        </div>
        <PayableOptions
          payee={{ id: e.stakeholderId as string, name: e.name, type: isVendorEntry ? 'Vendor' : 'Worker' }}
          projectId={e.siteId} projectName={e.site || null} txnDate={e.date} amount={e.amt} selfPaid={e.amt}
          allowSkip={false} onConfirm={onAttr}
        />
      </>
    ) : (
      <>
        <div className="p-head"><div className="t"><h2>{e.name}</h2><span>{e.day}, {e.dow}</span></div>{X}</div>
        <div className="figure"><span>₹</span>{Math.round(e.amt).toLocaleString('en-IN')}</div>
        {e.src === 'topup'
          ? <div className="s"><span>Kind</span><b>Top-up · not an expense</b></div>
          : <><div className="s"><span>Site</span><b>{e.site || '—'}</b></div><div className="s"><span>Category</span><b>{e.cat || '—'}</b></div></>}
        <div className="s"><span>Paid from</span><b>{from}</b></div>
        {canAttr ? (
          <button type="button" className="s sx" onClick={() => setAttrStep(true)}>
            <span>{rowLabel}</span>
            <b className={e.linked ? '' : 'warn'}>{e.linked ? 'Linked · change' : 'Choose'}</b>
            <svg className="c" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          </button>
        ) : e.src !== 'topup' ? (
          <div className="s"><span>Bill</span><b className={e.linked ? '' : 'warn'}>{e.linked ? 'Linked' : 'Not linked'}</b></div>
        ) : null}
        <Attachments e={e} onPeek={(at) => { close(); onPeek(e, at); }} />
        {e.wa && <p className="quote">WhatsApp: “{e.wa}”</p>}
        <div className="p-acts">
          <button type="button" className="pri" onClick={() => { close(); onOpenEntry(e.id); }}>Open the entry</button>
        </div>
      </>
    );
  } else if (panel.kind === 'wallets') {
    body = (
      <>
        <div className="p-head"><div className="t"><h2>Wallets</h2><span>{inr(held)} held by {wallets.length} {wallets.length === 1 ? 'person' : 'people'} · tap one for its ledger</span></div>{X}</div>
        {wallets.map((w) => (
          <button key={w.walletId} type="button" className="wl" onClick={() => openWallet(w.holderName)}>
            <span className="av">{initials(w.holderName)}</span>
            <span className="m"><b>{w.holderName}</b><span className="bar"><i style={{ width: `${Math.round(w.balance / top * 100)}%` }} /></span></span>
            <em>{inr(w.balance)}</em>{CHEVR}
          </button>
        ))}
        {!wallets.length && <p className="quote">Nobody is holding site cash right now.</p>}
      </>
    );
  } else if (panel.kind === 'filters') {
    body = (
      <>
        <div className="p-head"><div className="t"><h2>Filters</h2><span>On top of All · By you · Wallets · Not linked</span></div>{X}</div>
        <p className="fsec">Site</p>
        <div className="fchips">{sites.map((s) => (
          <button key={s.id} type="button" className="fchip" aria-pressed={F.site === s.id} onClick={() => setF({ ...F, site: F.site === s.id ? '' : s.id })}>{shortSite(s.name)}</button>
        ))}</div>
        <p className="fsec">Amount</p>
        <div className="fchips">{([[0, 'Any'], [10000, '₹10,000 and up'], [100000, '₹1 lakh and up']] as [number, string][]).map(([v, l]) => (
          <button key={v} type="button" className="fchip" aria-pressed={F.min === v} onClick={() => setF({ ...F, min: v })}>{l}</button>
        ))}</div>
        <p className="fsec">Papers</p>
        <div className="fchips"><button type="button" className="fchip" aria-pressed={F.clip} onClick={() => setF({ ...F, clip: !F.clip })}>Has a bill or proof</button></div>
        <div className="p-acts">
          <button type="button" className="sec" onClick={() => setF({ site: '', clip: false, min: 0 })}>Clear</button>
          <button type="button" className="pri" onClick={close}>Show {shown} entries</button>
        </div>
      </>
    );
  } else if (panel.kind === 'more') {
    body = (
      <>
        <div className="p-head"><div className="t"><h2>Transactions</h2></div>{X}</div>
        <div className="menu">
          <button type="button" onClick={() => { close(); onImport(); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14" /></svg>Import entries</button>
          <button type="button" onClick={() => { close(); onExportShown(); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" /></svg>Export what is shown</button>
          <button type="button" onClick={onSelect}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></svg>Select entries</button>
        </div>
      </>
    );
  } else if (panel.kind === 'category') {
    body = (
      <>
        <div className="p-head"><div className="t"><h2>Category</h2><span>For {n} {n === 1 ? 'entry' : 'entries'}</span></div>{X}</div>
        <div className="fchips">{categories.map(([code, label]) => (
          <button key={code} type="button" className="fchip" onClick={() => onCategory(code)}>{label}</button>
        ))}</div>
      </>
    );
  } else {
    body = (
      <>
        <div className="p-head"><div className="t"><h2>Site</h2><span>Move {n} {n === 1 ? 'entry' : 'entries'}</span></div>{X}</div>
        <div className="fchips">{sites.map((s) => (
          <button key={s.id} type="button" className="fchip" onClick={() => onSite(s.id)}>{shortSite(s.name)}</button>
        ))}</div>
      </>
    );
  }
  return <section ref={drag} className={`lmx-panel${on ? ' on' : ''}`} role="dialog" aria-modal="true"><div className="grab" aria-hidden="true"><i /></div>{body}</section>;
}
