/**
 * THE PAGE IS THE LOCAL RESULT LIST.
 *
 * That is the whole idea of this search: what you are looking at filters as you type, and the panel
 * only carries what is elsewhere. So a page doesn't get searched — it lends itself to the search:
 * it says what it is called, hands over the rows it is currently showing, and takes back the query
 * to filter itself with. Two lines at a call site, and the page keeps owning its own filtering.
 *
 * The query lives HERE, not inside the panel, because a search you have run is a state the page is
 * in: dismiss the panel and the text stays in the bar and the list stays filtered, until you clear
 * it or leave the page.
 *
 * (Context and hooks live here, apart from the provider component, so a page importing the hook
 * never drags a component into its module graph.)
 */
import { createContext, useContext, useEffect, useRef } from 'react';

export interface ScopeRow {
  id: string;
  title: string;
  sub?: string;
  right?: string;
  onPick: () => void;
}

export interface Scope {
  /** What this page calls itself: "Parties", "Bills", "Purchase orders". */
  label: string;
  /** The rows currently showing — already filtered by the page itself. */
  rows: ScopeRow[];
  /** Hand the query back so the page filters live. */
  setQuery: (q: string) => void;
}

/**
 * Space in, space out.
 *
 * The space bar opened this; while the box is still empty it is also the way out, so a thumb that
 * reached for it once can reach for it again without hunting for escape. The moment there is a word
 * in the box, space goes back to being a space — "vizag tmt" has one in the middle of it.
 */
export function spaceOut(query: string, close: () => void) {
  return (e: { key: string; preventDefault: () => void }) => {
    if (e.key === ' ' && !query) { e.preventDefault(); close(); }
  };
}

export interface SearchCtxValue {
  open: boolean;
  scope: Scope | null;
  /** What is typed. Survives dismissing the panel; cleared on leaving the page or on ✕. */
  query: string;
  setQuery: (q: string) => void;
  openSearch: () => void;
  closeSearch: () => void;
  /** The space bar's own door: in when shut, out again while nothing has been typed. */
  toggleSearch: () => void;
  publish: (s: Scope | null) => void;
  /** A page-mounted bar registers how to focus itself, so the space bar lands in the right place. */
  registerBar: (focus: (() => void) | null) => void;
  /** True while a page has its own bar mounted — the root overlay stands down. */
  hasBar: boolean;
}

export const SearchCtx = createContext<SearchCtxValue | null>(null);

export function useSearch(): SearchCtxValue {
  const c = useContext(SearchCtx);
  if (!c) throw new Error('useSearch must be inside SearchProvider');
  return c;
}

/**
 * Lend this page to the search.
 *
 * `rows` are the ones on screen right now; `setQuery` is the page's own filter. Put
 * `data-search-row={id}` on the row element and the keyboard will light it up and scroll to it —
 * no highlight state needed in the page.
 */
export function useSearchScope(label: string, rows: ScopeRow[], setQuery: (q: string) => void) {
  const ctx = useContext(SearchCtx);

  // The callback a page passes is usually an inline arrow — a new identity every render. Keep the
  // latest behind a ref so publishing can depend on the rows alone.
  const setQueryRef = useRef(setQuery);
  useEffect(() => { setQueryRef.current = setQuery; });

  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  // Republish when the visible set actually changes, not on every render — otherwise the provider's
  // setState would re-render the page, which would republish, for ever.
  const sig = rows.map(r => r.id).join(' ');
  const publish = ctx?.publish;
  useEffect(() => {
    if (!publish) return;
    publish({ label, rows: rowsRef.current, setQuery: (q: string) => setQueryRef.current(q) });
    return () => publish(null);
    // rowsRef is read at publish time; `sig` is what says the visible set changed.
  }, [publish, label, sig]);
}
