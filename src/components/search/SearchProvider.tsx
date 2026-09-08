import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SearchCtx, type Scope } from './searchScope';

/**
 * Holds whether the panel is up, which page has lent it its rows, and what is typed.
 *
 * The query outlives the panel on purpose: dismissing the panel leaves the page filtered and the
 * text sitting in the bar, the way any search box behaves. It clears when the page changes — a
 * filter belongs to the list it was typed against.
 */
export default function SearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope | null>(null);
  const [query, setQuery] = useState('');
  const [hasBar, setHasBar] = useState(false);
  const barFocus = useRef<(() => void) | null>(null);
  const lastLabel = useRef<string | null>(null);

  // The page filters live. This is driven from here, not from the panel, so the filter survives the
  // panel closing.
  const setPageQuery = scope?.setQuery;
  useEffect(() => { setPageQuery?.(query); }, [query, setPageQuery]);

  const publish = useCallback((s: Scope | null) => {
    setScope(s);
    // A different list than the one the query was typed against — start clean.
    if (s && s.label !== lastLabel.current) { lastLabel.current = s.label; setQuery(''); }
  }, []);

  const registerBar = useCallback((focus: (() => void) | null) => {
    barFocus.current = focus;
    setHasBar(!!focus);
  }, []);

  const openSearch = useCallback(() => {
    setOpen(true);
    // Land in the page's own bar when it has one, so the caret appears where the search already is.
    if (barFocus.current) window.setTimeout(() => barFocus.current?.(), 0);
  }, []);

  const value = useMemo(() => ({
    open, scope, query, setQuery, hasBar,
    openSearch,
    closeSearch: () => setOpen(false),
    publish, registerBar,
  }), [open, scope, query, hasBar, openSearch, publish, registerBar]);

  return <SearchCtx.Provider value={value}>{children}</SearchCtx.Provider>;
}
