/**
 * DocPeek — the paper an entry carries, looked at without leaving the list.
 *
 * A bill or a payment proof is the whole reason an entry can be trusted, and until now the row only
 * hinted at one with a paper clip you could not press. The row now carries a small sheet — the paper
 * itself, folded corner and all, with a second sheet behind it when there are two — and pressing it
 * lifts the document onto the night ground, where it is the only thing on screen.
 *
 * Nothing is signed until it is looked at: the row holds the stored URL, and the signed one is
 * fetched when the peek opens (Supabase public-object URLs expire, so they are signed per look).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isPdf, useSignedDocs, type Paper } from './docSigning';

export function DocPeek({ papers, at = 0, title, sub, onClose, onOpenEntry }: {
  papers: Paper[];
  /** which one was tapped */
  at?: number;
  title: string; sub: string;
  onClose: () => void;
  onOpenEntry?: () => void;
}) {
  const [i, setI] = useState(at);
  const [on, setOn] = useState(false);
  const [broke, setBroke] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const paper = papers[i];

  useEffect(() => { const r = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(r); }, []);
  // Signed per look, by the one signer — the paper waits rather than flashing a broken image.
  const src = paper?.url ?? '';
  const signed = useSignedDocs(src ? [src] : []);
  const url = signed[src] ?? null;
  const failed = (src in signed && !url) || broke === src;

  const close = useCallback(() => { setOn(false); setTimeout(onClose, 220); }, [onClose]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [close]);

  // drag it down to put it back
  const drag = useRef({ y0: 0, dy: 0, on: false });
  const start = (e: React.TouchEvent) => { const el = wrapRef.current; if (!el) return; drag.current = { y0: e.touches[0].clientY, dy: 0, on: true }; el.style.transition = 'none'; };
  const move = (e: React.TouchEvent) => { const el = wrapRef.current; if (!el || !drag.current.on) return; drag.current.dy = e.touches[0].clientY - drag.current.y0; el.style.transform = `translateY(${drag.current.dy * 0.9}px)`; el.style.opacity = String(Math.max(0.3, 1 - Math.abs(drag.current.dy) / 420)); };
  const end = () => { const el = wrapRef.current; if (!el || !drag.current.on) return; drag.current.on = false; el.style.transition = ''; el.style.transform = ''; el.style.opacity = ''; if (Math.abs(drag.current.dy) > 90) close(); };

  return (
    <div className={`lmx-peek${on ? ' on' : ''}`} role="dialog" aria-modal="true" aria-label={`${paper?.kind ?? 'Document'} — ${title}`}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <button type="button" className="pk-x" aria-label="Close" onClick={close}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>

      <div ref={wrapRef} className="pk-paper" onTouchStart={start} onTouchMove={move} onTouchEnd={end} onTouchCancel={end}>
        {!url && !failed && <div className="pk-wait" aria-label="Opening"><i /><i /><i /></div>}
        {failed && <div className="pk-gone">This file could not be opened.<br />It may have been removed.</div>}
        {url && (isPdf(paper.url)
          ? <object data={url} type="application/pdf" aria-label={`${paper.kind} (PDF)`}><div className="pk-gone">A PDF. Open it to read.</div></object>
          : <img alt={`${paper.kind} for ${title}`} src={url} onError={() => setBroke(src)} />)}
      </div>

      <div className="pk-foot">
        {papers.length > 1 && (
          <div className="pk-seg" role="group" aria-label="Which paper">
            {papers.map((x, n) => <button key={x.kind} type="button" aria-pressed={n === i} onClick={() => setI(n)}>{x.kind}</button>)}
          </div>
        )}
        <div className="pk-cap"><span className="what"><b>{paper?.kind}</b> · {title}</span><span className="when">{sub}</span></div>
        <div className="pk-acts">
          {onOpenEntry && <button type="button" onClick={() => { close(); setTimeout(onOpenEntry, 230); }}>Open the entry</button>}
          {url && <a href={url} target="_blank" rel="noreferrer" download>{isPdf(paper.url) ? 'Open the PDF' : 'Download'}</a>}
        </div>
      </div>
    </div>
  );
}
