/**
 * The two surfaces a page-mounted bar cannot be.
 *
 *  · On a phone: a full-screen sheet. There is no space bar to press and no room to watch a list
 *    filter behind a dropdown, so the page's own hits are listed inside it.
 *  · On a page with no bar of its own: the bar floats near the top, so space still searches
 *    everywhere in Briklay from anywhere in Briklay.
 *
 * Where a page HAS lent the search a bar, this stands down entirely — that bar is the search.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useIsMobile } from '../../lib/useIsMobile';
import { useSheetDrag } from '../../lib/sheetDrag';
import { useSearch } from './searchScope';
import { useSearchEngine } from './searchEngine';
import SearchPanel from './SearchPanel';
import { CSX_CSS, CSX_ROW_CSS } from './csxCss';

export default function CommandSearch() {
  const { open, hasBar } = useSearch();
  const isMobile = useIsMobile();
  if (!open) return null;
  if (!isMobile && hasBar) return null;      // the page's own bar is the search
  return <Surface isMobile={isMobile} />;
}

function Surface({ isMobile }: { isMobile: boolean }) {
  const e = useSearchEngine({ listPageRows: isMobile });
  const inputRef = useRef<HTMLInputElement>(null);
  const sheetRef = useSheetDrag<HTMLDivElement>(e.closeSearch, isMobile);
  useEffect(() => { const t = window.setTimeout(() => inputRef.current?.focus(), 30); return () => window.clearTimeout(t); }, []);

  const placeholder = e.scope ? `Search ${e.scope.label.toLowerCase()} — or everything` : 'Search Briklay';

  return createPortal(
    <div className={`csx${isMobile ? ' sheet' : ' floating'}`} role="dialog" aria-modal="true" aria-label="Search">
      <style>{CSX_CSS}</style>
      <div className="veil" onClick={e.closeSearch} />

      <div className="searchwrap" ref={isMobile ? sheetRef : undefined}>
        <div className="bar">
          <span className="ic">⌕</span>
          {e.scope && !isMobile && <span className="scope">{e.scope.label} first</span>}
          <input
            ref={inputRef} value={e.rawQuery} onChange={(ev) => e.setQuery(ev.target.value)}
            placeholder={placeholder} autoComplete="off" autoCorrect="off" spellCheck={false} aria-label="Search"
          />
          {isMobile && <button className="x" onClick={e.closeSearch} aria-label="Close">✕</button>}
        </div>
        <SearchPanel e={e} listPageRows={isMobile} />
      </div>
    </div>,
    document.body,
  );
}

/** The page-row highlight, injected once at the app root (it has to reach outside this component). */
export function SearchRowStyles() {
  return <style>{CSX_ROW_CSS}</style>;
}
