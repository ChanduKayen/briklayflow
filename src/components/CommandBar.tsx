import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  IconSearch, IconX, IconChevronRight,
  IconArrowsExchange, IconClipboardList, IconShoppingBag,
  IconBuildingEstate, IconUsersGroup, IconUser, IconFileInvoice, IconNotebook,
} from '@tabler/icons-react';
import { supabase } from '../lib/supabase';
import { useCommandBar } from '../context/CommandBarContext';
import { usePeek } from '../context/PeekContext';

// ─── Types ────────────────────────────────────────────────────────────────────

type ResultType = 'project' | 'person' | 'work_order' | 'purchase_order' | 'transaction';

interface SearchResult {
  type: ResultType;
  id: string;
  primary: string;
  secondary?: string;
}

type ListEntry =
  | { kind: 'header'; label: string }
  | { kind: 'result'; result: SearchResult; flatIdx: number };

interface ActionItem {
  label: string;
  Icon: React.ElementType;
  href: string;
  iconBg: string;
  iconColor: string;
  accent?: boolean;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const TYPE_CFG: Record<ResultType, { Icon: React.ElementType; bg: string; color: string; label: string; section: string }> = {
  project:        { Icon: IconBuildingEstate, bg: 'rgba(59,130,246,0.15)',  color: '#60A5FA', label: 'Project',     section: 'PROJECTS'        },
  person:         { Icon: IconUser,           bg: 'rgba(168,85,247,0.15)',  color: '#C084FC', label: 'Person',      section: 'PEOPLE'          },
  work_order:     { Icon: IconClipboardList,  bg: 'rgba(245,158,11,0.15)', color: '#FCD34D', label: 'Work Order',  section: 'WORK ORDERS'     },
  purchase_order: { Icon: IconShoppingBag,    bg: 'rgba(16,185,129,0.15)', color: '#34D399', label: 'P.O.',        section: 'PURCHASE ORDERS' },
  transaction:    { Icon: IconArrowsExchange, bg: 'rgba(239,68,68,0.15)',  color: '#F87171', label: 'Transaction', section: 'TRANSACTIONS'    },
};

const RESULT_ORDER: ResultType[] = ['project', 'person', 'work_order', 'purchase_order', 'transaction'];

function getContextAction(path: string) {
  if (path === '/')                         return { label: 'Logbook Inbox',  Icon: IconNotebook,        href: '/logbook' };
  if (path.startsWith('/logbook'))          return { label: 'Go to Ledger',   Icon: IconArrowsExchange,  href: '/ledger' };
  if (path.startsWith('/ledger'))           return { label: 'Add New Party',   Icon: IconUsersGroup,      href: '/stakeholders' };
  if (path.startsWith('/work-orders'))      return { label: 'New Project',     Icon: IconBuildingEstate,  href: '/projects' };
  if (path.startsWith('/purchase-orders'))  return { label: 'Add New Party',   Icon: IconUsersGroup,      href: '/stakeholders' };
  if (path.startsWith('/billing'))          return { label: 'New Invoice',     Icon: IconFileInvoice,     href: '/invoices/new' };
  if (path.startsWith('/stakeholders'))     return { label: 'New Project',     Icon: IconBuildingEstate,  href: '/projects' };
  if (path.startsWith('/projects'))         return { label: 'Add New Party',   Icon: IconUsersGroup,      href: '/stakeholders' };
  if (path.startsWith('/financials'))       return { label: 'Open Ledger',     Icon: IconArrowsExchange,  href: '/ledger' };
  return                                           { label: 'Logbook Inbox',  Icon: IconNotebook,        href: '/logbook' };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommandBar() {
  const { isOpen, close, placeholderPool } = useCommandBar();
  const { openPeek } = usePeek();
  const navigate = useNavigate();
  const location = useLocation();

  const [query,       setQuery]       = useState('');
  const [results,     setResults]     = useState<SearchResult[]>([]);
  const [searching,   setSearching]   = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [phIdx,       setPhIdx]       = useState(0);
  const [phVisible,   setPhVisible]   = useState(true);

  const inputRef   = useRef<HTMLInputElement>(null);
  const bodyRef    = useRef<HTMLDivElement>(null);
  const cancelRef  = useRef(false);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Action rows (empty state) ──────────────────────────────────────────────
  const actions = useMemo<ActionItem[]>(() => {
    const ctx = getContextAction(location.pathname);
    return [
      { label: 'New Transaction',    Icon: IconArrowsExchange, href: '/ledger/new',          iconBg: 'rgba(239,68,68,0.15)',  iconColor: '#F87171' },
      { label: 'New Work Order',     Icon: IconClipboardList,  href: '/work-orders/new',     iconBg: 'rgba(245,158,11,0.15)', iconColor: '#FCD34D' },
      { label: 'New Purchase Order', Icon: IconShoppingBag,    href: '/purchase-orders/new', iconBg: 'rgba(16,185,129,0.15)', iconColor: '#34D399' },
      { ...ctx, iconBg: 'rgba(200,96,58,0.18)', iconColor: '#E8825A', accent: true },
    ];
  }, [location.pathname]);

  // ── Focus + reset ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setSelectedIdx(-1);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [isOpen]);

  // ── Placeholder cycling ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !placeholderPool.length) return;
    const iv = setInterval(() => {
      setPhVisible(false);
      setTimeout(() => { setPhIdx(i => (i + 1) % placeholderPool.length); setPhVisible(true); }, 150);
    }, 1800);
    return () => clearInterval(iv);
  }, [isOpen, placeholderPool]);

  // ── Debounced search ───────────────────────────────────────────────────────
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    cancelRef.current = true;
    if (!query.trim()) { setResults([]); setSearching(false); return; }
    setSearching(true);
    cancelRef.current = false;
    const q = `%${query.trim()}%`;
    timerRef.current = setTimeout(async () => {
      try {
        const [projRes, stkRes, woRes, poRes, txnRes] = await Promise.all([
          supabase.from('projects').select('project_id, name, status').ilike('name', q).limit(4),
          supabase.from('stakeholders').select('stakeholder_id, name, category').ilike('name', q).limit(4),
          supabase.from('work_orders').select('wo_id, scope_of_work').ilike('wo_id', q).limit(3),
          supabase.from('purchase_orders').select('po_id, status').ilike('po_id', q).limit(3),
          supabase.from('transactions').select('txn_id, category, stakeholders(name)').ilike('txn_id', q).limit(3),
        ]);
        if (cancelRef.current) return;
        setResults([
          ...(projRes.data || []).map(p => ({ type: 'project'        as ResultType, id: p.project_id,     primary: p.name,   secondary: p.status })),
          ...(stkRes.data  || []).map(s => ({ type: 'person'         as ResultType, id: s.stakeholder_id, primary: s.name,   secondary: s.category })),
          ...(woRes.data   || []).map(w => ({ type: 'work_order'     as ResultType, id: w.wo_id,          primary: w.wo_id,  secondary: w.scope_of_work })),
          ...(poRes.data   || []).map(p => ({ type: 'purchase_order' as ResultType, id: p.po_id,          primary: p.po_id,  secondary: p.status })),
          ...(txnRes.data  || []).map(t => ({ type: 'transaction' as ResultType, id: t.txn_id, primary: (t.stakeholders as any)?.name || t.category || t.txn_id, secondary: t.txn_id })),
        ]);
        setSearching(false);
        setSelectedIdx(-1);
      } catch { if (!cancelRef.current) setSearching(false); }
    }, 220);
  }, [query]);

  // ── Display list ──────────────────────────────────────────────────────────
  const displayList = useMemo<ListEntry[]>(() => {
    const groups: Partial<Record<ResultType, SearchResult[]>> = {};
    for (const r of results) (groups[r.type] ??= []).push(r);
    const entries: ListEntry[] = [];
    let fi = 0;
    for (const type of RESULT_ORDER) {
      const g = groups[type];
      if (!g?.length) continue;
      entries.push({ kind: 'header', label: TYPE_CFG[type].section });
      for (const r of g) entries.push({ kind: 'result', result: r, flatIdx: fi++ });
    }
    return entries;
  }, [results]);

  // ── Activate result ────────────────────────────────────────────────────────
  const activateResult = useCallback((r: SearchResult) => {
    close();
    switch (r.type) {
      case 'project':        navigate(`/projects/${r.id}`); break;
      case 'person':         openPeek('STAKEHOLDER', r.id); break;
      case 'work_order':     openPeek('WO', r.id);          break;
      case 'purchase_order': openPeek('PO', r.id);          break;
      case 'transaction':    openPeek('TRANSACTION', r.id); break;
    }
  }, [close, navigate, openPeek]);

  // ── Keyboard navigation ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const isQuerying = !!query.trim();
    const maxIdx = isQuerying ? results.length - 1 : actions.length - 1;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape')    { close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, maxIdx)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, -1));     return; }
      if (e.key === 'Enter' && selectedIdx >= 0) {
        e.preventDefault();
        if (isQuerying) {
          const hit = results[selectedIdx];
          if (hit) activateResult(hit);
        } else {
          const action = actions[selectedIdx];
          if (action) { close(); navigate(action.href); }
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, close, query, results, actions, selectedIdx, activateResult, navigate]);

  // ── Scroll selected into view ──────────────────────────────────────────────
  useEffect(() => {
    if (selectedIdx < 0 || !bodyRef.current) return;
    const el = bodyRef.current.querySelector(`[data-ridx="${selectedIdx}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  // ── Computed ───────────────────────────────────────────────────────────────
  const curPh    = placeholderPool[phIdx % Math.max(1, placeholderPool.length)];
  const phText   = curPh
    ? `Search for ${curPh.text.length > 28 ? curPh.text.slice(0, 28) + '…' : curPh.text}…`
    : 'Search for anything…';
  const isQuerying = !!query.trim();
  const hasResults = isQuerying && results.length > 0;
  const noResults  = isQuerying && !searching && results.length === 0;

  return (
    <>
      {isOpen && (
        <div className="cmdbar-overlay" onClick={close}>
          <div className="cmdbar-bar animate-cmdbar-in" onClick={e => e.stopPropagation()}>

            {/* ── Search input ──────────────────────────────────────────── */}
            <div className="cmdbar-input-row">
              <IconSearch size={17} className="cmdbar-search-icon" strokeWidth={2} />
              <div className="cmdbar-input-wrap">
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => {
                    // Space on empty input → close
                    if (e.key === ' ' && !query) { e.preventDefault(); close(); }
                  }}
                  className="cmdbar-input"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                {!query && (
                  <span className="cmdbar-placeholder" style={{ opacity: phVisible ? 1 : 0 }}>
                    {phText}
                  </span>
                )}
              </div>

              {/* Right side: type label (fades with placeholder) */}
              {!query && curPh && (
                <span className="cmdbar-type-label" style={{ opacity: phVisible ? 1 : 0 }}>
                  {curPh.type}
                </span>
              )}

              {/* Clear button when typing */}
              {query && (
                <button
                  className="cmdbar-clear"
                  onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                >
                  <IconX size={11} />
                </button>
              )}
            </div>

            {/* ── Divider ───────────────────────────────────────────────── */}
            <div className="cmdbar-divider" />

            {/* ── Body ─────────────────────────────────────────────────── */}
            <div ref={bodyRef} className="cmdbar-body">

              {/* Empty state: quick action rows */}
              {!isQuerying && (
                <div className="cmdbar-actions-wrap">
                  <div className="cmdbar-section-label">QUICK ACTIONS</div>
                  {actions.map((action, idx) => {
                    const sel = idx === selectedIdx;
                    return (
                      <div
                        key={action.label}
                        data-ridx={idx}
                        className={`cmdbar-action-row${sel ? ' is-selected' : ''}${action.accent ? ' is-accent' : ''}`}
                        onMouseEnter={() => setSelectedIdx(idx)}
                        onMouseLeave={() => setSelectedIdx(-1)}
                        onClick={() => { close(); navigate(action.href); }}
                      >
                        <div className="cmdbar-row-icon" style={{ background: action.iconBg }}>
                          <action.Icon size={14} style={{ color: action.iconColor }} />
                        </div>
                        <span className="cmdbar-action-label">{action.label}</span>
                        <IconChevronRight size={13} className="cmdbar-action-arrow" strokeWidth={2} />
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Query state: search results */}
              {isQuerying && (
                <>
                  {searching && !hasResults && (
                    <p className="cmdbar-empty">Searching…</p>
                  )}
                  {noResults && (
                    <p className="cmdbar-empty">
                      No results for "<span style={{ color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>{query}</span>"
                    </p>
                  )}
                  {displayList.map((entry, i) => {
                    if (entry.kind === 'header') {
                      return <div key={`h-${i}`} className="cmdbar-section-label">{entry.label}</div>;
                    }
                    const { result: r, flatIdx } = entry;
                    const cfg = TYPE_CFG[r.type];
                    const sel = flatIdx === selectedIdx;
                    return (
                      <div
                        key={`${r.type}-${r.id}`}
                        data-ridx={flatIdx}
                        className={`cmdbar-result-row${sel ? ' is-selected' : ''}`}
                        onMouseEnter={() => setSelectedIdx(flatIdx)}
                        onClick={() => activateResult(r)}
                      >
                        <div className="cmdbar-row-icon" style={{ background: cfg.bg }}>
                          <cfg.Icon size={14} style={{ color: cfg.color }} />
                        </div>
                        <div className="cmdbar-result-text">
                          <span className="cmdbar-result-primary">{r.primary}</span>
                          {r.secondary && (
                            <>
                              <span className="cmdbar-result-dot">·</span>
                              <span className="cmdbar-result-secondary">{r.secondary}</span>
                            </>
                          )}
                        </div>
                        <span className="cmdbar-result-type">{cfg.label}</span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>

            {/* ── Footer ────────────────────────────────────────────────── */}
            <div className="cmdbar-footer">
              <span className="cmdbar-footer-hint">
                <kbd className="cmdbar-kbd">esc</kbd>
                <span>dismiss</span>
              </span>
              <span className="cmdbar-footer-sep" />
              <span className="cmdbar-footer-hint">
                <kbd className="cmdbar-kbd">↑</kbd>
                <kbd className="cmdbar-kbd">↓</kbd>
                <span>navigate</span>
              </span>
              <span className="cmdbar-footer-sep" />
              <span className="cmdbar-footer-hint">
                <kbd className="cmdbar-kbd">↵</kbd>
                <span>open</span>
              </span>
            </div>

          </div>
        </div>
      )}

      <MobilePill />
    </>
  );
}

// ─── Mobile pill trigger ──────────────────────────────────────────────────────

function MobilePill() {
  const { open } = useCommandBar();
  return (
    <button className="cmdbar-mobile-pill" onClick={open} aria-label="Search">
      <IconSearch size={15} style={{ color: 'rgba(255,255,255,0.55)', flexShrink: 0 }} />
      <span>Search</span>
    </button>
  );
}
