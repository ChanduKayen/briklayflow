/**
 * THE BAR SITS WHERE THE PAGE'S SEARCH ALREADY SAT.
 *
 * Not a palette that flies in over the middle of the screen — the search is part of the page, in
 * the place your eye already goes. Pressing space puts the caret in it; typing filters the list
 * below and opens the panel over it; escape closes the panel and leaves the text and the filter
 * exactly where they are, the way any search box behaves.
 *
 * While it is open the bar is drawn again in a portal, positioned on top of its own resting box.
 * That is what lets the veil dim the page and the panel escape the table, card or scoped stylesheet
 * the page happens to have put its search inside — without the bar moving a pixel.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearch } from './searchScope';
import { useSearchEngine } from './searchEngine';
import SearchPanel from './SearchPanel';
import { useIsMobile } from '../../lib/useIsMobile';
import { CSX_CSS } from './csxCss';

export default function SearchBar({ label, className }: { label: string; className?: string }) {
  const { open, openSearch, closeSearch, query, setQuery, registerBar, scope } = useSearch();
  const isMobile = useIsMobile();
  const restRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<{ x: number; y: number; w: number } | null>(null);
  const [visible, setVisible] = useState(false);

  // A page may mount two of these — one in its desktop toolbar, one in its phone toolbar — with CSS
  // hiding whichever doesn't apply. Only the one actually on screen is the search: a box with no
  // width never registers and never draws.
  useEffect(() => {
    const el = restRef.current;
    if (!el) return;
    const check = () => setVisible(el.getBoundingClientRect().width > 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Tell the provider how to focus this bar, so the space bar lands here rather than opening a
  // floating one somewhere else.
  const focus = useCallback(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (!visible) return;
    registerBar(focus);
    return () => registerBar(null);
  }, [registerBar, focus, visible]);

  // Keep the drawn bar exactly over the resting one, through scrolling and resizing.
  const measure = useCallback(() => {
    const el = restRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ x: r.left, y: r.top, w: r.width });
  }, []);
  useLayoutEffect(() => { if (open && !isMobile) measure(); }, [open, isMobile, measure]);
  useEffect(() => {
    if (!open || isMobile) return;
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => { window.removeEventListener('scroll', measure, true); window.removeEventListener('resize', measure); };
  }, [open, isMobile, measure]);

  const showOverlay = open && !isMobile && visible;

  return (
    <>
      <div className={`csx-rest${className ? ' ' + className : ''}`} ref={restRef}
        style={showOverlay ? { visibility: 'hidden' } : undefined}>
        <style>{CSX_CSS}</style>
        <div className="bar" onClick={openSearch}>
          <span className="ic">⌕</span>
          <input
            ref={showOverlay ? undefined : inputRef}
            value={query} onChange={(e) => setQuery(e.target.value)} onFocus={openSearch}
            // On a phone the typing happens in the sheet; tapping here only opens it, so the
            // keyboard doesn't come up against a field that is about to be covered.
            readOnly={isMobile}
            placeholder={`Search ${label} — or everything`}
            autoComplete="off" autoCorrect="off" spellCheck={false} aria-label={`Search ${label}`}
          />
          {query
            ? <button className="clr" onClick={(e) => { e.stopPropagation(); setQuery(''); }} aria-label="Clear search">✕</button>
            : <span className="kbd">space</span>}
        </div>
      </div>

      {showOverlay && rect && <Overlay rect={rect} label={label} scopeLabel={scope?.label ?? null} onClose={closeSearch} />}
    </>
  );
}

/** The open state: the veil, the same bar drawn on top of its resting box, and the panel under it. */
function Overlay({ rect, label, scopeLabel, onClose }:
  { rect: { x: number; y: number; w: number }; label: string; scopeLabel: string | null; onClose: () => void }) {
  const e = useSearchEngine({ listPageRows: false });
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = window.setTimeout(() => inputRef.current?.focus(), 0); return () => window.clearTimeout(t); }, []);

  return createPortal(
    <div className="csx anchored" role="dialog" aria-label="Search">
      <style>{CSX_CSS}</style>
      <div className="veil" onClick={onClose} />
      <div className="searchwrap" style={{ left: rect.x, top: rect.y, width: rect.w }}>
        <div className="bar">
          <span className="ic">⌕</span>
          {scopeLabel && <span className="scope">{scopeLabel} first</span>}
          <input
            ref={inputRef} value={e.rawQuery} onChange={(ev) => e.setQuery(ev.target.value)}
            placeholder={`Search ${label} — or everything`}
            autoComplete="off" autoCorrect="off" spellCheck={false} aria-label={`Search ${label}`}
          />
        </div>
        <SearchPanel e={e} listPageRows={false} />
      </div>
    </div>,
    document.body,
  );
}
