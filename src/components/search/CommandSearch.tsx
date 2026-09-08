/**
 * COMMAND SEARCH — one search, summoned with the space bar, on every page.
 *
 * It replaces the command centre, which was a dark modal that covered the page and searched five
 * tables. This one starts where you already are: the page you are on filters live underneath, the
 * panel carries only what is ELSEWHERE in Briklay, and the actions sit at the bottom. Nothing is
 * duplicated between the two — a party you can already see is not repeated in a dropdown over it.
 *
 * On a phone there is no space bar and no room to watch a page filter behind a dropdown, so the
 * whole thing becomes a sheet and the page's own hits are listed inside it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useIsMobile } from '../../lib/useIsMobile';
import { useSheetDrag } from '../../lib/sheetDrag';
import { useSearch, type ScopeRow } from './searchScope';
import { CSX_CSS, CSX_ROW_CSS } from './csxCss';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

interface Elsewhere { id: string; title: string; sub: string; right: string; icon: string; go: () => void }
interface Action { title: string; key: string; icon: string; href: string }

// Highlight the matched run, the way the reference marks it — terracotta, not a yellow block.
function Mark({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

export default function CommandSearch() {
  const { open } = useSearch();
  const isMobile = useIsMobile();
  if (!open) return null;
  return <Search isMobile={isMobile} />;
}

function Search({ isMobile }: { isMobile: boolean }) {
  const { scope, closeSearch } = useSearch();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [hot, setHot] = useState(0);
  const [elsewhere, setElsewhere] = useState<Elsewhere[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sheetRef = useSheetDrag<HTMLDivElement>(closeSearch, isMobile);

  const query = q.trim();
  const scopeRows = useMemo(() => scope?.rows ?? [], [scope]);

  // The page filters as you type — it IS the local result list. Restore it on the way out, so
  // dismissing the search never leaves a page mysteriously filtered.
  const setPageQuery = scope?.setQuery;
  useEffect(() => { setPageQuery?.(query); }, [query, setPageQuery]);
  useEffect(() => () => { setPageQuery?.(''); }, [setPageQuery]);

  useEffect(() => { const t = window.setTimeout(() => inputRef.current?.focus(), 30); return () => window.clearTimeout(t); }, []);

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

  // ── one keyboard path over page rows, then the panel ────────────────────────
  type Nav = { kind: 'page'; row: ScopeRow } | { kind: 'else'; e: Elsewhere } | { kind: 'act'; a: Action };
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
  // with data-search-row; nothing else is asked of them.
  const hotNav = nav[hot];
  const hotRowId = hotNav?.kind === 'page' ? hotNav.row.id : null;
  useEffect(() => {
    if (isMobile) return;
    document.querySelectorAll('[data-search-hot]').forEach(el => el.removeAttribute('data-search-hot'));
    if (!hotRowId) return;
    const el = document.querySelector(`[data-search-row="${CSS.escape(hotRowId)}"]`);
    if (!el) return;
    el.setAttribute('data-search-hot', '1');
    el.scrollIntoView({ block: 'nearest' });
    return () => el.removeAttribute('data-search-hot');
  }, [hotRowId, isMobile]);
  useEffect(() => () => { document.querySelectorAll('[data-search-hot]').forEach(el => el.removeAttribute('data-search-hot')); }, []);

  useEffect(() => {
    listRef.current?.querySelector('[data-hot="1"]')?.scrollIntoView({ block: 'nearest' });
  }, [hot]);

  const pageHits = scopeRows.length;
  const idxOf = (kind: Nav['kind'], i: number) => (kind === 'page' ? i : kind === 'else' ? scopeRows.length + i : scopeRows.length + shownElsewhere.length + i);
  const placeholder = scope ? `Search ${scope.label.toLowerCase()} — or everything` : 'Search Briklay';
  const showPanel = isMobile || !!shownElsewhere.length || !!actions.length || (!!query && pageHits > 0);

  const rowItem = (key: string, i: number, icon: string, title: string, sub: string, right: string, onClick: () => void, kbd?: string) => (
    <button
      type="button" key={key} className={`item${i === hot ? ' hot' : ''}`} data-hot={i === hot ? '1' : undefined}
      onMouseEnter={() => setHot(i)} onClick={onClick}
    >
      <div className="iv">{icon}</div>
      <div className="imid"><b><Mark text={title} q={query} /></b>{sub && <span>{sub}</span>}</div>
      {kbd ? <span className="kbd">{kbd}</span> : right ? <div className="iright">{right}</div> : null}
    </button>
  );

  return createPortal(
    <div className={`csx${isMobile ? ' sheet' : ''}`} role="dialog" aria-modal="true" aria-label="Search">
      <style>{CSX_CSS}</style>
      <div className="veil" onClick={closeSearch} />

      <div className="searchwrap" ref={isMobile ? sheetRef : undefined}>
        <div className="bar">
          <span className="ic">⌕</span>
          {scope && !isMobile && <span className="scope">{scope.label} first</span>}
          <input
            ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setHot(0); }}
            placeholder={placeholder} autoComplete="off" autoCorrect="off" spellCheck={false}
            aria-label="Search"
          />
          {/* No key chip while searching — the reference drops it, and the footer already says esc. */}
          {isMobile && <button className="x" onClick={closeSearch} aria-label="Close">✕</button>}
        </div>

        {showPanel && (
          <div className="panel">
            <div className="plist" ref={listRef}>
              {/* On a phone the page is behind a sheet, so its hits are listed here instead. */}
              {isMobile && pageHits > 0 && scope && (
                <>
                  <div className="sect">{pageHits} on {scope.label.toLowerCase()}</div>
                  {scopeRows.slice(0, 12).map((r, i) => rowItem(
                    `p${r.id}`, idxOf('page', i), r.title.slice(0, 1).toUpperCase(), r.title, r.sub ?? '', r.right ?? '',
                    () => { closeSearch(); r.onPick(); },
                  ))}
                </>
              )}

              {/* On desktop the page itself is showing them — say how many and point down. */}
              {!isMobile && !!query && pageHits > 0 && scope && (
                <div className="pgcount">{pageHits} on this page <span>— filtered below ↓</span></div>
              )}

              {shownElsewhere.length > 0 && (
                <>
                  <div className="sect">Across Briklay</div>
                  {shownElsewhere.map((e, i) => rowItem(e.id, idxOf('else', i), e.icon, e.title, e.sub, e.right, () => pick({ kind: 'else', e })))}
                </>
              )}

              {actions.length > 0 && (
                <>
                  <div className="sect">Actions</div>
                  {actions.map((a, i) => rowItem(`a${a.key}`, idxOf('act', i), a.icon, a.title, '', '', () => pick({ kind: 'act', a }), a.key))}
                </>
              )}

              {!!query && pageHits === 0 && shownElsewhere.length === 0 && actions.length === 0 && (
                <div className="empty">Nothing matches “{query}”.</div>
              )}
            </div>

            <div className="pfoot">
              {isMobile ? (
                <span className="tail">{scope ? `${scope.label} first · rest of Briklay below` : 'Everything in Briklay'}</span>
              ) : (
                <>
                  <span><span className="kbd">↑↓</span>navigate</span>
                  <span><span className="kbd">↵</span>open</span>
                  <span><span className="kbd">esc</span>dismiss</span>
                  <span className="tail">{scope ? 'This page filters live · rest of Briklay above' : 'Everything in Briklay'}</span>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** The page-row highlight, injected once at the app root (it has to reach outside this component). */
export function SearchRowStyles() {
  return <style>{CSX_ROW_CSS}</style>;
}
