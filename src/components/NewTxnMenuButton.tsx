/**
 * NewTxnMenuButton — the main "New transaction" CTA. On hover (or tap) it reveals a small menu with
 * Money O·ut / Money I·n and jumps straight into entry with that direction, bypassing the picker.
 * The underlined O / I are keyboard shortcuts while the menu is open.
 *
 * A transparent padding "bridge" above the card (paddingTop, not a margin gap) keeps the whole
 * hover target contiguous, and a short close delay forgives the mouse crossing that gap — so the
 * menu no longer vanishes before you can reach it.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { DirLabel } from './NewTxnFab';

const OUT = '#C4613A';
const IN = '#5F7F5B';

export function NewTxnMenuButton({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<'out' | 'in' | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);

  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const openNow = () => { cancelClose(); setOpen(true); };
  const closeSoon = () => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 140); };

  const go = (direction: 'out' | 'in') => { cancelClose(); setOpen(false); navigate('/ledger/new', { state: { direction } }); };

  useEffect(() => () => cancelClose(), []);

  // Close on a click/tap outside (so a CLICK-opened menu can be dismissed without a hover-out).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'o') { e.preventDefault(); go('out'); }
      else if (k === 'i') { e.preventDefault(); go('in'); }
      else if (k === 'escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const row = (kind: 'out' | 'in', icon: string, accent: string) => {
    const on = hovered === kind;
    return (
      <button
        type="button"
        onClick={() => go(kind)}
        onMouseEnter={() => setHovered(kind)}
        onMouseLeave={() => setHovered(null)}
        className="w-full flex items-center gap-3 text-left"
        style={{
          padding: '10px 11px',
          borderRadius: 12,
          background: on ? accent + '14' : 'transparent',
          color: on ? accent : '#3A2F28',
          fontSize: 13.5,
          fontWeight: 600,
          transition: 'background .14s ease, color .14s ease',
        }}
      >
        <span
          className="inline-flex items-center justify-center rounded-full shrink-0"
          style={{
            width: 30, height: 30,
            background: on ? accent : accent + '1F',
            color: on ? '#fff' : accent,
            transition: 'background .14s ease, color .14s ease',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 17 }}>{icon}</span>
        </span>
        <span className="flex-1"><DirLabel dir={kind} /></span>
      </button>
    );
  };

  return (
    <span ref={wrapRef} className="relative inline-flex" onMouseEnter={openNow} onMouseLeave={closeSoon}>
      {/* Click OPENS the options (same menu hover shows) — never toggles the just-hovered menu shut. */}
      <button type="button" onClick={() => setOpen(true)} className={className} style={style}>
        {children}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50"
          style={{ paddingTop: 8 }}
          onMouseEnter={openNow}
          onMouseLeave={closeSoon}
        >
          <div
            style={{
              minWidth: 214,
              padding: 6,
              borderRadius: 16,
              background: '#FFFEFB',
              border: '1px solid #EBE3D6',
              boxShadow: '0 22px 48px -18px rgba(47,38,34,.30), 0 3px 10px rgba(47,38,34,.06)',
              transformOrigin: 'top right',
              animation: 'ntmIn .16s cubic-bezier(.16,1,.3,1)',
            }}
          >
            <style>{`@keyframes ntmIn{from{opacity:0;transform:translateY(-4px) scale(.97)}to{opacity:1;transform:none}}`}</style>
            {row('out', 'north_east', OUT)}
            <div style={{ height: 1, margin: '2px 10px', background: 'linear-gradient(90deg,transparent,#EFE7DA,transparent)' }} />
            {row('in', 'south_west', IN)}
          </div>
        </div>
      )}
    </span>
  );
}
