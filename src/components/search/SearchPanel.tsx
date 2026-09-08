/**
 * The panel under the bar: what is elsewhere, and what you can do — never what the page is already
 * showing you. On a phone the page is behind a sheet, so there its hits are listed here too.
 */
import { useEffect, useRef } from 'react';
import type { Engine } from './searchEngine';

// Highlight the matched run, the way the reference marks it — terracotta, not a yellow block.
function Mark({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

export default function SearchPanel({ e, listPageRows }: { e: Engine; listPageRows: boolean }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.querySelector('[data-hot="1"]')?.scrollIntoView({ block: 'nearest' }); }, [e.hot]);

  const { query, hot, setHot, pick, scope, scopeRows, shownElsewhere, actions, pageHits, idxOf, closeSearch } = e;

  const row = (key: string, i: number, icon: string, title: string, sub: string, right: string, onClick: () => void, kbd?: string) => (
    <button
      type="button" key={key} className={`item${i === hot ? ' hot' : ''}`} data-hot={i === hot ? '1' : undefined}
      onMouseEnter={() => setHot(i)} onClick={onClick}
    >
      <div className="iv">{icon}</div>
      <div className="imid"><b><Mark text={title} q={query} /></b>{sub && <span>{sub}</span>}</div>
      {kbd ? <span className="kbd">{kbd}</span> : right ? <div className="iright">{right}</div> : null}
    </button>
  );

  return (
    <div className="panel">
      <div className="plist" ref={listRef}>
        {listPageRows && pageHits > 0 && scope && (
          <>
            <div className="sect">{pageHits} on {scope.label.toLowerCase()}</div>
            {scopeRows.slice(0, 12).map((r, i) => row(
              `p${r.id}`, idxOf('page', i), r.title.slice(0, 1).toUpperCase(), r.title, r.sub ?? '', r.right ?? '',
              () => { closeSearch(); r.onPick(); },
            ))}
          </>
        )}

        {/* On desktop the page itself is showing them — say how many and point down. */}
        {!listPageRows && !!query && pageHits > 0 && scope && (
          <div className="pgcount">{pageHits} on this page <span>— filtered below ↓</span></div>
        )}

        {shownElsewhere.length > 0 && (
          <>
            <div className="sect">Across Briklay</div>
            {shownElsewhere.map((x, i) => row(x.id, idxOf('else', i), x.icon, x.title, x.sub, x.right, () => pick({ kind: 'else', e: x })))}
          </>
        )}

        {actions.length > 0 && (
          <>
            <div className="sect">Actions</div>
            {actions.map((a, i) => row(`a${a.key}`, idxOf('act', i), a.icon, a.title, '', '', () => pick({ kind: 'act', a }), a.key))}
          </>
        )}

        {!!query && pageHits === 0 && shownElsewhere.length === 0 && actions.length === 0 && (
          <div className="empty">Nothing matches “{query}”.</div>
        )}
      </div>

      <div className="pfoot">
        {listPageRows ? (
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
  );
}
