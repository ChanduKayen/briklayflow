/**
 * NewTxnMenuButton — the main "New transaction" CTA, upgraded to reveal Money O·ut / Money I·n on
 * hover (or tap) and jump straight into entry with that direction — bypassing the picker step. The
 * underlined O / I are keyboard shortcuts while the menu is open.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { DirLabel } from './NewTxnFab';

const CSS = `
.ntm-opt{transition:background .14s ease,color .14s ease,transform .1s ease}
.ntm-opt:active{transform:scale(.98)}
.ntm-out:hover{background:#F8E7DE !important;color:#A94E2B !important}
.ntm-in:hover{background:#E7EFE4 !important;color:#4C6349 !important}
.ntm-k{text-decoration:underline;text-underline-offset:2px;text-decoration-thickness:1.5px}
`;

export function NewTxnMenuButton({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const go = (direction: 'out' | 'in') => { setOpen(false); navigate('/ledger/new', { state: { direction } }); };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'o') { e.preventDefault(); go('out'); }
      else if (k === 'i') { e.preventDefault(); go('in'); }
      else if (k === 'escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const row = (kind: 'out' | 'in', icon: string, accent: string) => (
    <button
      type="button"
      onClick={() => go(kind)}
      className={`ntm-opt ntm-${kind} w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left`}
      style={{ color: '#2F2622', fontSize: 13, fontWeight: 600 }}
    >
      <span className="inline-flex items-center justify-center rounded-full shrink-0" style={{ width: 24, height: 24, background: accent + '22', color: accent }}>
        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>{icon}</span>
      </span>
      <DirLabel dir={kind} />
    </button>
  );

  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <style>{CSS}</style>
      <button type="button" onClick={() => setOpen((o) => !o)} className={className} style={style}>
        {children}
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-2 z-50 p-1.5 rounded-xl"
          style={{ background: '#FFFDF9', border: '1px solid #E4DCD0', boxShadow: '0 16px 40px -14px rgba(47,38,34,.32)', minWidth: 168 }}
        >
          {row('out', 'north_east', '#C4613A')}
          {row('in', 'south_west', '#5F7F5B')}
        </div>
      )}
    </span>
  );
}
