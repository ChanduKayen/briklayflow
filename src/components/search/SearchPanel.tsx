/**
 * The ladder under the bar.
 *
 *   1. Stay here — the page behind is already filtered to what you typed. The obvious move, and it
 *      is drawn as one: filled mark, terracotta, no chevron, because it goes nowhere.
 *   2. Then this party, elsewhere: their ledger, their orders, their bills. Quieter rows with a
 *      chevron — each one is a step up and out of the page you are on.
 *   3. Then anyone else the name matched, in case the top one wasn't who you meant.
 *
 * On a phone the page is behind a sheet, so step one becomes the rows themselves.
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

  const { query, hot, setHot, pick, scope, scopeRows, pageHits, party, others, cuts, idxOf } = e;
  const nothing = !!query && pageHits === 0 && !party;

  const row = (
    key: string, i: number, icon: string, title: React.ReactNode, sub: string,
    onClick: () => void, cls = '',
  ) => (
    <button
      type="button" key={key} className={`item${cls ? ' ' + cls : ''}${i === hot ? ' hot' : ''}`}
      data-hot={i === hot ? '1' : undefined} onMouseEnter={() => setHot(i)} onClick={onClick}
    >
      <div className="iv">{icon}</div>
      <div className="imid"><b>{title}</b>{sub && <span>{sub}</span>}</div>
      {cls === 'primary' ? null : <span className="go">→</span>}
    </button>
  );

  return (
    <div className="panel">
      <div className="plist" ref={listRef}>
        {/* 1 · what is on the page you are already looking at */}
        {listPageRows && pageHits > 0 && scope && (
          <>
            <div className="sect">{pageHits} on {scope.label.toLowerCase()}</div>
            {scopeRows.slice(0, 12).map((r, i) => row(
              `r${r.id}`, idxOf('row', i), r.title.slice(0, 1).toUpperCase(),
              <Mark text={r.title} q={query} />, r.sub ?? '',
              () => pick({ kind: 'row', row: r }),
            ))}
          </>
        )}
        {!listPageRows && !!query && pageHits > 0 && scope && row(
          'page', idxOf('page', 0), '⌕',
          <>{pageHits} on this page</>, `${scope.label} — filtered below`,
          () => pick({ kind: 'page' }), 'primary',
        )}

        {/* 2 · the same party, everywhere else they live */}
        {party && cuts.length > 0 && (
          <>
            <div className="sect">{party.name}</div>
            {cuts.map((c, i) => row(c.key, idxOf('cut', i), c.icon, c.title, '', () => pick({ kind: 'cut', cut: c })))}
          </>
        )}

        {/* 3 · in case the top one wasn't who you meant */}
        {others.length > 0 && (
          <>
            <div className="sect">Also matching</div>
            {others.map((p, i) => row(
              `o${p.id}`, idxOf('party', i), p.name.slice(0, 1).toUpperCase(),
              <Mark text={p.name} q={query} />, `${p.type}${p.category ? ' · ' + p.category : ''}`,
              () => pick({ kind: 'party', party: p }),
            ))}
          </>
        )}

        {nothing && <div className="empty">Nothing matches “{query}”.</div>}
        {!query && <div className="empty">Type a name — this page filters as you go.</div>}
      </div>

      <div className="pfoot">
        {listPageRows ? (
          <span className="tail">{scope ? `${scope.label} first · then who it belongs to` : 'Search Briklay'}</span>
        ) : (
          <>
            <span><span className="kbd">↑↓</span>navigate</span>
            <span><span className="kbd">↵</span>open</span>
            <span><span className="kbd">esc</span>dismiss</span>
            <span className="tail">{scope ? 'This page filters live · the party is above' : 'Search Briklay'}</span>
          </>
        )}
      </div>
    </div>
  );
}
