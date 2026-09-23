/**
 * A plain search bar: it filters the page it sits on. Nothing else.
 *
 * It writes to the search query the provider relays into this page's own filter, so typing narrows
 * the list below and clearing it restores the list. No overlay, no cross-page panel, no space-to-open
 * — a search box behaves the way a search box is expected to.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearch } from './searchScope';
import { CSX_CSS } from './csxCss';

export default function SearchBar({ label, className }: { label: string; className?: string }) {
  const { query, setQuery, registerBar } = useSearch();
  const restRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(false);

  // A page may mount two of these (a desktop toolbar one, a phone toolbar one) with CSS hiding
  // whichever doesn't apply. Only the one actually on screen counts as the bar.
  useEffect(() => {
    const el = restRef.current;
    if (!el) return;
    const check = () => setVisible(el.getBoundingClientRect().width > 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Register so a Cmd/K lands the caret here, and so the floating palette stands down on this page.
  const focus = useCallback(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (!visible) return;
    registerBar(focus);
    return () => registerBar(null);
  }, [registerBar, focus, visible]);

  return (
    <div className={`csx-rest${className ? ' ' + className : ''}`} ref={restRef}>
      <style>{CSX_CSS}</style>
      <div className="bar">
        <span className="ic">⌕</span>
        <input
          ref={inputRef}
          value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${label}`}
          autoComplete="off" autoCorrect="off" spellCheck={false} aria-label={`Search ${label}`}
        />
        {query
          ? <button className="clr" onClick={(e) => { e.stopPropagation(); setQuery(''); }} aria-label="Clear search">✕</button>
          : null}
      </div>
    </div>
  );
}
