import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  IconSearch, IconX,
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

// ─── Config maps ──────────────────────────────────────────────────────────────

const TYPE_CFG: Record<ResultType, {
  Icon: React.ElementType;
  bg: string;
  color: string;
  label: string;
  sectionLabel: string;
}> = {
  project: {
    Icon: IconBuildingEstate,
    bg: 'rgba(59,130,246,0.15)', color: '#60A5FA',
    label: 'PROJECT', sectionLabel: 'PROJECTS',
  },
  person: {
    Icon: IconUser,
    bg: 'rgba(168,85,247,0.15)', color: '#C084FC',
    label: 'PERSON', sectionLabel: 'PEOPLE',
  },
  work_order: {
    Icon: IconClipboardList,
    bg: 'rgba(245,158,11,0.15)', color: '#FCD34D',
    label: 'WORK ORDER', sectionLabel: 'WORK ORDERS',
  },
  purchase_order: {
    Icon: IconShoppingBag,
    bg: 'rgba(16,185,129,0.15)', color: '#34D399',
    label: 'PURCHASE ORDER', sectionLabel: 'PURCHASE ORDERS',
  },
  transaction: {
    Icon: IconArrowsExchange,
    bg: 'rgba(239,68,68,0.15)', color: '#F87171',
    label: 'TRANSACTION', sectionLabel: 'TRANSACTIONS',
  },
};

const RESULT_ORDER: ResultType[] = ['project', 'person', 'work_order', 'purchase_order', 'transaction'];

interface ContextChip { label: string; Icon: React.ElementType; href: string; }

function getContextChip(path: string): ContextChip {
  if (path === '/')                           return { label: 'Logbook Inbox',    Icon: IconNotebook,        href: '/logbook' };
  if (path.startsWith('/logbook'))            return { label: 'Go to Ledger',      Icon: IconArrowsExchange,  href: '/ledger' };
  if (path.startsWith('/ledger'))             return { label: 'Raise Bill',         Icon: IconFileInvoice,     href: '/billing/new' };
  if (path.startsWith('/work-orders'))        return { label: 'New Project',        Icon: IconBuildingEstate,  href: '/projects' };
  if (path.startsWith('/purchase-orders'))    return { label: 'Raise Bill',         Icon: IconFileInvoice,     href: '/billing/new' };
  if (path.startsWith('/billing'))            return { label: 'New Invoice',        Icon: IconFileInvoice,     href: '/invoices/new' };
  if (path.startsWith('/stakeholders'))       return { label: 'New Project',        Icon: IconBuildingEstate,  href: '/projects' };
  if (path.startsWith('/projects'))           return { label: 'New Stakeholder',    Icon: IconUsersGroup,      href: '/stakeholders' };
  if (path.startsWith('/financials'))         return { label: 'Go to Ledger',       Icon: IconArrowsExchange,  href: '/ledger' };
  return                                             { label: 'Logbook Inbox',    Icon: IconNotebook,        href: '/logbook' };
}

// ─── CommandBar ───────────────────────────────────────────────────────────────

export function CommandBar() {
  const { isOpen, close, placeholderPool } = useCommandBar();
  const { openPeek } = usePeek();
  const navigate = useNavigate();
  const location = useLocation();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [phIdx, setPhIdx] = useState(0);
  const [phVisible, setPhVisible] = useState(true);

  const inputRef  = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const cancelRef  = useRef(false);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Focus + reset on open ──────────────────────────────────────────────────
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
      setTimeout(() => {
        setPhIdx(i => (i + 1) % placeholderPool.length);
        setPhVisible(true);
      }, 150);
    }, 1800);
    return () => clearInterval(iv);
  }, [isOpen, placeholderPool]);

  // ── Debounced search ───────────────────────────────────────────────────────
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    cancelRef.current = true;

    if (!query.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    cancelRef.current = false;
    const q = `%${query.trim()}%`;

    timerRef.current = setTimeout(async () => {
      try {
        const [projRes, stkRes, woRes, poRes, txnRes] = await Promise.all([
          supabase.from('projects').select('project_id, name, status').ilike('name', q).limit(4),
          supabase.from('stakeholders').select('stakeholder_id, name, category').ilike('name', q).limit(4),
          supabase.from('work_orders').select('wo_id, scope_of_work, status').ilike('wo_id', q).limit(3),
          supabase.from('purchase_orders').select('po_id, status').ilike('po_id', q).limit(3),
          supabase.from('transactions').select('txn_id, category, total_amount').ilike('txn_id', q).limit(3),
        ]);
        if (cancelRef.current) return;

        setResults([
          ...(projRes.data || []).map(p => ({ type: 'project' as ResultType, id: p.project_id, primary: p.name, secondary: p.status })),
          ...(stkRes.data  || []).map(s => ({ type: 'person'  as ResultType, id: s.stakeholder_id, primary: s.name, secondary: s.category })),
          ...(woRes.data   || []).map(w => ({ type: 'work_order' as ResultType, id: w.wo_id, primary: w.wo_id, secondary: w.scope_of_work })),
          ...(poRes.data   || []).map(p => ({ type: 'purchase_order' as ResultType, id: p.po_id, primary: p.po_id, secondary: p.status })),
          ...(txnRes.data  || []).map(t => ({ type: 'transaction' as ResultType, id: t.txn_id, primary: t.txn_id, secondary: t.category })),
        ]);
        setSearching(false);
        setSelectedIdx(-1);
      } catch {
        if (!cancelRef.current) setSearching(false);
      }
    }, 220);
  }, [query]);

  // ── Display list with section headers ─────────────────────────────────────
  const displayList = useMemo<ListEntry[]>(() => {
    const groups: Partial<Record<ResultType, SearchResult[]>> = {};
    for (const r of results) {
      (groups[r.type] ??= []).push(r);
    }
    const entries: ListEntry[] = [];
    let fi = 0;
    for (const type of RESULT_ORDER) {
      const g = groups[type];
      if (!g?.length) continue;
      entries.push({ kind: 'header', label: TYPE_CFG[type].sectionLabel });
      for (const r of g) entries.push({ kind: 'result', result: r, flatIdx: fi++ });
    }
    return entries;
  }, [results]);

  // ── Activate result ────────────────────────────────────────────────────────
  const activateResult = useCallback((r: SearchResult) => {
    close();
    switch (r.type) {
      case 'project':       navigate(`/projects/${r.id}`);        break;
      case 'person':        openPeek('STAKEHOLDER', r.id);        break;
      case 'work_order':    openPeek('WO', r.id);                 break;
      case 'purchase_order':openPeek('PO', r.id);                 break;
      case 'transaction':   openPeek('TRANSACTION', r.id);        break;
    }
  }, [close, navigate, openPeek]);

  // ── Keyboard navigation ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx(i => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx(i => Math.max(i - 1, -1));
      } else if (e.key === 'Enter' && selectedIdx >= 0) {
        e.preventDefault();
        const hit = results[selectedIdx];
        if (hit) activateResult(hit);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, close, results, selectedIdx, activateResult]);

  // ── Scroll selected into view ──────────────────────────────────────────────
  useEffect(() => {
    if (selectedIdx < 0 || !resultsRef.current) return;
    const el = resultsRef.current.querySelector(`[data-ridx="${selectedIdx}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  const contextChip = useMemo(() => getContextChip(location.pathname), [location.pathname]);

  const handleChip = (href: string) => { close(); navigate(href); };

  // ── Computed ───────────────────────────────────────────────────────────────
  const curPh    = placeholderPool[phIdx % Math.max(1, placeholderPool.length)];
  const phText   = curPh
    ? `Search for ${curPh.text.length > 30 ? curPh.text.slice(0, 30) + '…' : curPh.text}…`
    : 'Search for anything…';
  const hasResults = query.trim() && results.length > 0;
  const isEmpty    = query.trim() && !searching && results.length === 0;

  return (
    <>
      {/* ── Overlay ── */}
      {isOpen && (
        <div
          className="cmdbar-overlay"
          onClick={close}
        >
          {/* ── Bar ── */}
          <div
            className="cmdbar-bar animate-cmdbar-in"
            onClick={e => e.stopPropagation()}
          >

            {/* ── Input row ── */}
            <div className="cmdbar-input-row">
              <IconSearch size={18} className="cmdbar-search-icon" />

              <div className="cmdbar-input-wrap">
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  className="cmdbar-input"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                {!query && (
                  <span
                    className="cmdbar-placeholder"
                    style={{ opacity: phVisible ? 1 : 0 }}
                  >
                    {phText}
                  </span>
                )}
              </div>

              {!query && curPh && (
                <span
                  className="cmdbar-type-label"
                  style={{ opacity: phVisible ? 1 : 0 }}
                >
                  {curPh.type}
                </span>
              )}

              {query && (
                <button className="cmdbar-clear" onClick={() => { setQuery(''); inputRef.current?.focus(); }}>
                  <IconX size={11} />
                </button>
              )}
            </div>

            {/* ── Divider ── */}
            <div className="cmdbar-divider" />

            {/* ── Results ── */}
            {query && (
              <div ref={resultsRef} className="cmdbar-results">
                {searching && !hasResults && (
                  <p className="cmdbar-empty">Searching…</p>
                )}
                {isEmpty && (
                  <p className="cmdbar-empty">No results for "{query}"</p>
                )}
                {displayList.map((entry, i) => {
                  if (entry.kind === 'header') {
                    return (
                      <div key={`h-${i}`} className="cmdbar-section-label">
                        {entry.label}
                      </div>
                    );
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
                      <div className="cmdbar-result-icon" style={{ background: cfg.bg }}>
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
              </div>
            )}

            {/* Divider above chips when results are shown */}
            {hasResults && <div className="cmdbar-divider" />}

            {/* ── Action chips ── */}
            <div className="cmdbar-chips-row">
              {([
                { label: 'New Transaction',   Icon: IconArrowsExchange, href: '/ledger/new' },
                { label: 'New Work Order',     Icon: IconClipboardList,  href: '/work-orders/new' },
                { label: 'New Purchase Order', Icon: IconShoppingBag,    href: '/purchase-orders/new' },
              ] as const).map(c => (
                <Chip key={c.label} label={c.label} Icon={c.Icon} onClick={() => handleChip(c.href)} />
              ))}
              <Chip label={contextChip.label} Icon={contextChip.Icon} onClick={() => handleChip(contextChip.href)} accent />
            </div>

          </div>
        </div>
      )}

      {/* ── Mobile pill (always rendered, hidden on desktop via CSS) ── */}
      <MobilePill />
    </>
  );
}

// ─── Chip ─────────────────────────────────────────────────────────────────────

function Chip({ label, Icon, onClick, accent }: {
  label: string;
  Icon: React.ElementType;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`cmdbar-chip${accent ? ' is-accent' : ''}`}
    >
      <Icon size={14} className="cmdbar-chip-icon" />
      <span className="cmdbar-chip-label">{label}</span>
    </button>
  );
}

// ─── Mobile pill trigger ──────────────────────────────────────────────────────

function MobilePill() {
  const { open } = useCommandBar();
  return (
    <button className="cmdbar-mobile-pill" onClick={open} aria-label="Open command bar">
      <IconSearch size={16} style={{ color: 'rgba(255,255,255,0.55)', flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.01em' }}>Search</span>
    </button>
  );
}
