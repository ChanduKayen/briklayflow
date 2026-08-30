/**
 * NewTxnFab — a bottom-right floating button for recording a transaction. On hover (or tap) it
 * expands to two actions, **Money O·ut** and **Money I·n**, each with its own hover state; the
 * underlined O / I are keyboard shortcuts (press O → out, I → in) while it's open. Clicking one
 * jumps straight into the entry form with that direction pre-selected (skipping the picker).
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

const CSS = `
.ntf-main{transition:transform .15s ease,box-shadow .18s ease}
.ntf-main:hover{transform:scale(1.05)}
.ntf-main:active{transform:scale(.94)}
.ntf-opt{transition:background .15s ease,color .15s ease,transform .12s ease,box-shadow .16s ease}
.ntf-opt:active{transform:scale(.97)}
.ntf-out:hover{background:#C4613A !important;color:#fff !important;box-shadow:0 10px 24px -10px rgba(196,97,58,.6)}
.ntf-in:hover{background:#5F7F5B !important;color:#fff !important;box-shadow:0 10px 24px -10px rgba(95,127,91,.6)}
.ntf-out:hover .ntf-ic,.ntf-in:hover .ntf-ic{background:rgba(255,255,255,.2);color:#fff}
.ntf-k{text-decoration:underline;text-underline-offset:2px;text-decoration-thickness:1.5px}
`;

/** "Money Out"/"Money In" with the shortcut letter underlined (inline style so it works anywhere). */
const UNDERLINE: CSSProperties = { textDecoration: 'underline', textUnderlineOffset: 2, textDecorationThickness: 1.5 };
export function DirLabel({ dir }: { dir: 'out' | 'in' }): ReactNode {
  return dir === 'out'
    ? <>Money <span style={UNDERLINE}>O</span>ut</>
    : <>Money <span style={UNDERLINE}>I</span>n</>;
}

export function NewTxnFab() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const go = (direction: 'out' | 'in') => { setOpen(false); navigate('/ledger/new', { state: { direction } }); };

  // While open, O / I are shortcuts.
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

  const opt = (kind: 'out' | 'in', icon: string, accent: string) => (
    <button
      type="button"
      onClick={() => go(kind)}
      className={`ntf-opt ntf-${kind} inline-flex items-center gap-2.5 pl-3.5 pr-2 py-2 rounded-full`}
      style={{ background: '#FFFDF9', border: '1px solid #E4DCD0', color: '#2F2622', boxShadow: '0 8px 22px -12px rgba(47,38,34,.35)', fontSize: 13, fontWeight: 600 }}
    >
      <span><DirLabel dir={kind} /></span>
      <span className="ntf-ic inline-flex items-center justify-center rounded-full" style={{ width: 26, height: 26, background: accent + '22', color: accent }}>
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{icon}</span>
      </span>
    </button>
  );

  return (
    <div
      className="fixed z-40 flex flex-col items-end gap-3"
      style={{ right: 'calc(20px + env(safe-area-inset-right))', bottom: 'calc(20px + env(safe-area-inset-bottom))' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <style>{CSS}</style>
      <div className={`flex flex-col items-end gap-2.5 transition-all duration-200 ${open ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}>
        {opt('in', 'south_west', '#5F7F5B')}
        {opt('out', 'north_east', '#C4613A')}
      </div>
      <button
        type="button"
        aria-label="New transaction"
        onClick={() => setOpen((o) => !o)}
        className="ntf-main inline-flex items-center justify-center rounded-full"
        style={{ width: 56, height: 56, background: '#C8603A', color: '#fff', boxShadow: '0 16px 34px -14px rgba(196,97,58,.7)' }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 26, transition: 'transform .2s ease', transform: open ? 'rotate(45deg)' : 'none' }}>add</span>
      </button>
    </div>
  );
}
