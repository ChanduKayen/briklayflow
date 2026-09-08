/**
 * What the search knows, apart from how it looks.
 *
 * SEARCH FINDS; IT DOESN'T CREATE.
 * Typing a name gives you two things and nothing else: what is on the page in front of you, and —
 * when that name is a party — the other places in Briklay that party lives. The first is the
 * obvious move (stay here, see the matches); the rest are the upgrades (their ledger, their orders,
 * their bills). There is no "New purchase order" row, because a search box is not where anyone
 * starts an order, and no cross-table sweep of six tables, because that was six queries to answer
 * a question the page in front of you had already answered.
 *
 * Two surfaces render this — the bar a page mounts in its own header, and the sheet a phone gets —
 * so the order of the rows and the keyboard path through them live here once.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { searchPayees } from '../../lib/payeeSearch';
import { useSearch, type ScopeRow } from './searchScope';
import { crossCutsFor, type CrossCut } from './partyRoutes';

export interface Party { id: string; name: string; type: string; category: string | null }
export type { CrossCut };
export { crossCutsFor };
export type Nav =
  | { kind: 'page' }                      // stay here — the page is already filtered
  | { kind: 'row'; row: ScopeRow }        // one of the page's rows (the phone lists them)
  | { kind: 'cut'; cut: CrossCut }        // this party, somewhere else
  | { kind: 'party'; party: Party };      // another party who also matches

export function useSearchEngine(opts: { listPageRows: boolean }) {
  const { scope, closeSearch, query: q, setQuery } = useSearch();
  const navigate = useNavigate();
  const [hot, setHot] = useState(0);
  const [parties, setParties] = useState<Party[]>([]);

  const query = q.trim();
  const scopeRows = useMemo(() => scope?.rows ?? [], [scope]);

  // ── who this name belongs to ────────────────────────────────────────────────
  // One query, not six. Ranked by the same matcher the payee fields use, so "vizag tmt" beats
  // "vizag steels plumbing" here exactly as it does when recording a payment.
  useEffect(() => {
    if (query.length < 2) return;
    let live = true;
    const t = window.setTimeout(async () => {
      try {
        const { data } = await supabase.from('stakeholders')
          .select('stakeholder_id, name, type, category').ilike('name', `%${query}%`).limit(8);
        if (!live) return;
        const ranked = searchPayees((data ?? []) as { name: string }[], query) as unknown as
          { stakeholder_id: string; name: string; type: string; category: string | null }[];
        setParties(ranked.slice(0, 3).map(s => ({ id: s.stakeholder_id, name: s.name, type: s.type, category: s.category })));
      } catch { if (live) setParties([]); }
    }, 200);
    return () => { live = false; window.clearTimeout(t); };
  }, [query]);

  // Results are only ever shown for the query that fetched them, so a cleared box shows nothing
  // rather than the last search's leftovers.
  const shownParties = useMemo(() => (query.length >= 2 ? parties : []), [query, parties]);
  const party = shownParties[0] ?? null;
  const others = shownParties.slice(1);
  const cuts = useMemo(() => (party ? crossCutsFor(party) : []), [party]);
  const pageHits = scopeRows.length;

  // ── the ladder: stay here, then this party elsewhere, then anyone else who matched ──────────
  const nav = useMemo<Nav[]>(() => [
    ...(opts.listPageRows
      ? scopeRows.slice(0, 12).map(row => ({ kind: 'row', row }) as Nav)
      : (query && pageHits > 0 ? [{ kind: 'page' } as Nav] : [])),
    ...cuts.map(cut => ({ kind: 'cut', cut }) as Nav),
    ...others.map(p => ({ kind: 'party', party: p }) as Nav),
  ], [opts.listPageRows, scopeRows, query, pageHits, cuts, others]);

  const pick = useCallback((n: Nav | undefined) => {
    if (!n) return;
    closeSearch();                                   // the page keeps the filter; only the panel goes
    if (n.kind === 'row') n.row.onPick();
    else if (n.kind === 'cut') navigate(n.cut.href);
    else if (n.kind === 'party') navigate(`/stakeholders/${n.party.id}`);
    // 'page' — nothing to navigate to: the results are already behind the panel.
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
  const hotRowId = hotNav?.kind === 'row' ? hotNav.row.id : null;
  useEffect(() => {
    if (!opts.listPageRows) return;
    document.querySelectorAll('[data-search-hot]').forEach(el => el.removeAttribute('data-search-hot'));
    if (!hotRowId) return;
    const el = document.querySelector(`[data-search-row="${CSS.escape(hotRowId)}"]`);
    if (!el) return;
    el.setAttribute('data-search-hot', '1');
    return () => el.removeAttribute('data-search-hot');
  }, [hotRowId, opts.listPageRows]);
  useEffect(() => () => { document.querySelectorAll('[data-search-hot]').forEach(el => el.removeAttribute('data-search-hot')); }, []);

  const setQueryAndReset = useCallback((v: string) => { setQuery(v); setHot(0); }, [setQuery]);

  return {
    scope, query, rawQuery: q, setQuery: setQueryAndReset, closeSearch,
    hot, setHot, nav, pick, scopeRows, pageHits,
    party, others, cuts,
    /** Index of a nav entry, so a rendered row and the keyboard agree on what is hot. */
    idxOf: (kind: Nav['kind'], i: number) => {
      const head = opts.listPageRows ? Math.min(scopeRows.length, 12) : (query && pageHits > 0 ? 1 : 0);
      if (kind === 'page' || kind === 'row') return i;
      if (kind === 'cut') return head + i;
      return head + cuts.length + i;
    },
  };
}

export type Engine = ReturnType<typeof useSearchEngine>;
