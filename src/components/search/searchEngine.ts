/**
 * What the search knows, apart from how it looks.
 *
 * Two surfaces render this: the bar a page mounts in its own header, and the full-screen sheet a
 * phone gets. Both need the same three lists in the same order and the same keyboard path through
 * them, so the logic lives here once.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useSearch, type ScopeRow } from './searchScope';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

export interface Elsewhere { id: string; title: string; sub: string; right: string; icon: string; go: () => void }
export interface Action { title: string; key: string; icon: string; href: string }
export type Nav = { kind: 'page'; row: ScopeRow } | { kind: 'else'; e: Elsewhere } | { kind: 'act'; a: Action };

export function useSearchEngine(opts: { listPageRows: boolean }) {
  const { scope, closeSearch, query: q, setQuery } = useSearch();
  const navigate = useNavigate();
  const [hot, setHot] = useState(0);
  const [elsewhere, setElsewhere] = useState<Elsewhere[]>([]);

  const query = q.trim();
  const scopeRows = useMemo(() => scope?.rows ?? [], [scope]);

  // ── everything else in Briklay ──────────────────────────────────────────────
  useEffect(() => {
    if (!query) return;              // nothing to fetch; the render below ignores stale results
    let live = true;
    const like = `%${query}%`;
    const t = window.setTimeout(async () => {
      try {
        const [stk, proj, po, wo, bill, txn] = await Promise.all([
          supabase.from('stakeholders').select('stakeholder_id, name, type, category').ilike('name', like).limit(4),
          supabase.from('projects').select('project_id, name, status').ilike('name', like).limit(3),
          supabase.from('purchase_orders').select('po_id, total_value, stakeholders(name)').ilike('po_id', like).limit(3),
          supabase.from('work_orders').select('wo_id, scope_of_work').ilike('wo_id', like).limit(2),
          supabase.from('bills').select('id, bill_no, amount, stakeholders(name)').ilike('bill_no', like).limit(3),
          supabase.from('transactions').select('txn_id, total_amount, date, stakeholders(name)').ilike('txn_id', like).limit(2),
        ]);
        if (!live) return;
        const named = (r: { stakeholders?: { name?: string } | { name?: string }[] | null }) => {
          const s = r.stakeholders;
          return (Array.isArray(s) ? s[0]?.name : s?.name) ?? '';
        };
        setElsewhere([
          ...(stk.data ?? []).map((s) => ({
            id: `stk${s.stakeholder_id}`, title: s.name, sub: `Parties · ${s.type}${s.category ? ' · ' + s.category : ''}`,
            right: '', icon: '◍', go: () => navigate(`/stakeholders/${s.stakeholder_id}`),
          })),
          ...(bill.data ?? []).map((b) => ({
            id: `bl${b.id}`, title: `Bill ${b.bill_no ?? ''}`.trim(), sub: `Bills${named(b) ? ' · ' + named(b) : ''}`,
            right: inr(Number(b.amount)), icon: '▤', go: () => navigate(`/bills/${encodeURIComponent('bl~' + b.id)}`),
          })),
          ...(po.data ?? []).map((p) => ({
            id: `po${p.po_id}`, title: p.po_id, sub: `Purchase orders${named(p) ? ' · ' + named(p) : ''}`,
            right: inr(Number(p.total_value)), icon: '▦', go: () => navigate(`/purchase-orders/${p.po_id}`),
          })),
          ...(txn.data ?? []).map((t2) => ({
            id: `tx${t2.txn_id}`, title: named(t2) || t2.txn_id,
            sub: `Transactions${t2.date ? ' · ' + new Date(t2.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}`,
            right: inr(Number(t2.total_amount)), icon: '⇄', go: () => navigate(`/ledger/${t2.txn_id}`),
          })),
          ...(wo.data ?? []).map((w) => ({
            id: `wo${w.wo_id}`, title: w.wo_id, sub: `Contracts${w.scope_of_work ? ' · ' + w.scope_of_work : ''}`,
            right: '', icon: '▤', go: () => navigate(`/work-orders/${w.wo_id}`),
          })),
          ...(proj.data ?? []).map((p) => ({
            id: `pj${p.project_id}`, title: p.name, sub: `Sites${p.status ? ' · ' + p.status : ''}`,
            right: '', icon: '⌂', go: () => navigate(`/projects/${p.project_id}`),
          })),
        ].slice(0, 6));
      } catch { if (live) setElsewhere([]); }
    }, 220);
    return () => { live = false; window.clearTimeout(t); };
  }, [query, navigate]);

  const actions = useMemo<Action[]>(() => {
    const all: Action[] = [
      { title: 'New Transaction', key: 'T', icon: '⇄', href: '/ledger/new' },
      { title: 'New Purchase Order', key: 'P', icon: '▦', href: '/purchase-orders/new' },
      { title: 'Add New Party', key: 'N', icon: '＋', href: '/stakeholders?new=1' },
      { title: 'New Contract', key: 'C', icon: '▤', href: '/work-orders/new' },
    ];
    if (!query) return all.slice(0, 3);
    return all.filter(a => a.title.toLowerCase().includes(query.toLowerCase())).slice(0, 3);
  }, [query]);

  // Results are only ever shown for the query that fetched them — so a cleared box shows nothing
  // rather than the last search's leftovers, without an effect racing to blank the state.
  const shownElsewhere = useMemo(() => (query ? elsewhere : []), [query, elsewhere]);
  const nav = useMemo<Nav[]>(() => [
    ...scopeRows.map(row => ({ kind: 'page', row }) as Nav),
    ...shownElsewhere.map(e => ({ kind: 'else', e }) as Nav),
    ...actions.map(a => ({ kind: 'act', a }) as Nav),
  ], [scopeRows, shownElsewhere, actions]);

  const pick = useCallback((n: Nav | undefined) => {
    if (!n) return;
    closeSearch();
    if (n.kind === 'page') n.row.onPick();
    else if (n.kind === 'else') n.e.go();
    else navigate(n.a.href);
  }, [closeSearch, navigate]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeSearch(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setHot(i => (nav.length ? (i + 1) % nav.length : 0)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHot(i => (nav.length ? (i - 1 + nav.length) % nav.length : 0)); return; }
      if (e.key === 'Enter') { e.preventDefault(); pick(nav[hot]); }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [nav, hot, pick, closeSearch]);

  // The highlight lives OUT ON THE PAGE, because the page is the result list. Pages mark their rows
  // with data-search-row; nothing else is asked of them. (Not on a phone — the sheet covers it.)
  const hotNav = nav[hot];
  const hotRowId = hotNav?.kind === 'page' ? hotNav.row.id : null;
  useEffect(() => {
    if (opts.listPageRows) return;
    document.querySelectorAll('[data-search-hot]').forEach(el => el.removeAttribute('data-search-hot'));
    if (!hotRowId) return;
    const el = document.querySelector(`[data-search-row="${CSS.escape(hotRowId)}"]`);
    if (!el) return;
    el.setAttribute('data-search-hot', '1');
    el.scrollIntoView({ block: 'nearest' });
    return () => el.removeAttribute('data-search-hot');
  }, [hotRowId, opts.listPageRows]);
  useEffect(() => () => { document.querySelectorAll('[data-search-hot]').forEach(el => el.removeAttribute('data-search-hot')); }, []);

  const setQueryAndReset = useCallback((v: string) => { setQuery(v); setHot(0); }, [setQuery]);

  return {
    scope, query, rawQuery: q, setQuery: setQueryAndReset, closeSearch,
    hot, setHot, nav, pick, scopeRows, shownElsewhere, actions,
    pageHits: scopeRows.length,
    idxOf: (kind: Nav['kind'], i: number) =>
      (kind === 'page' ? i : kind === 'else' ? scopeRows.length + i : scopeRows.length + shownElsewhere.length + i),
  };
}

export type Engine = ReturnType<typeof useSearchEngine>;
