import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { IconReceipt2, IconFileInvoice, IconHammer, IconUserPlus } from '@tabler/icons-react';
import { hidesGlobalFab } from '../lib/bottomChrome';

const OPTIONS = [
  { icon: IconFileInvoice, label: 'New Purchase Order', path: '/purchase-orders/new', highlight: false },
  { icon: IconHammer,      label: 'New Contract',     path: '/work-orders/new',     highlight: false },
  { icon: IconUserPlus,    label: 'New Party',          path: '/stakeholders?new=1',  highlight: false },
  { icon: IconReceipt2,    label: 'New Transaction',    path: '/ledger/new',          highlight: true  },
];

const TERRACOTTA = '#C8603A';

export function FloatingActionButton() {
  const [open, setOpen]     = useState(false);
  const [visible, setVisible] = useState(false);
  const navigate             = useNavigate();
  const location             = useLocation();
  const ref                  = useRef<HTMLDivElement>(null);
  const timerRef             = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Two-phase open: mount panel first tick, then trigger CSS transition
  const handleOpen = () => {
    setVisible(true);
    timerRef.current = setTimeout(() => setOpen(true), 10);
  };

  const handleClose = () => {
    setOpen(false);
    timerRef.current = setTimeout(() => setVisible(false), 220);
  };

  const toggle = () => (visible ? handleClose() : handleOpen());

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) handleClose();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [visible]);

  const go = (path: string) => { navigate(path); handleClose(); };

  // Pages that own the bottom corner — full-screen create forms, detail pages with their own
  // action bar, and lists with their own create button (the Ledger's NewTxnFab, the PO list's
  // "New PO" pill) — get no generic FAB, so nothing ever stacks on top of their buttons.
  if (hidesGlobalFab(location.pathname)) return null;

  return (
    <div
      className="md:hidden"
      ref={ref}
      style={{ position: 'fixed', bottom: 76, right: 16, zIndex: 49 }}
    >
      {/* Options panel */}
      {visible && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 10px)',
            right: 0,
            width: 210,
            background: 'white',
            borderRadius: 14,
            boxShadow: '0 8px 32px rgba(0,0,0,0.13), 0 2px 8px rgba(0,0,0,0.07)',
            overflow: 'hidden',
            transformOrigin: 'bottom right',
            transform: open ? 'scale(1) translateY(0)' : 'scale(0.88) translateY(8px)',
            opacity: open ? 1 : 0,
            transition: 'transform 200ms cubic-bezier(0.0,0,0.2,1), opacity 200ms cubic-bezier(0.0,0,0.2,1)',
          }}
        >
          {OPTIONS.map((opt, i) => {
            const Icon = opt.icon;
            const isLast = i === OPTIONS.length - 1;
            return (
              <button
                key={opt.path}
                onClick={() => go(opt.path)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  width: '100%',
                  padding: opt.highlight ? '12px 16px' : '11px 16px',
                  background: opt.highlight ? 'rgba(200,96,58,0.05)' : 'transparent',
                  border: 'none',
                  borderTop: opt.highlight ? '0.5px solid rgba(200,96,58,0.12)' : 'none',
                  borderBottom: isLast ? 'none' : '0.5px solid rgba(0,0,0,0.06)',
                  cursor: 'pointer', textAlign: 'left',
                  WebkitTapHighlightColor: 'transparent',
                }}
                onTouchStart={e => (e.currentTarget.style.background = 'rgba(200,96,58,0.10)')}
                onTouchEnd={e => (e.currentTarget.style.background = opt.highlight ? 'rgba(200,96,58,0.05)' : 'transparent')}
              >
                <div style={{
                  width: 30, height: 30, borderRadius: 8,
                  background: opt.highlight ? 'rgba(200,96,58,0.12)' : 'rgba(200,96,58,0.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <Icon size={15} strokeWidth={1.75} style={{ color: TERRACOTTA }} />
                </div>
                <span style={{
                  fontSize: 13,
                  fontWeight: opt.highlight ? 600 : 500,
                  color: opt.highlight ? TERRACOTTA : '#1a1a1a',
                  letterSpacing: '-0.01em',
                }}>
                  {opt.label}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* FAB button */}
      <button
        onClick={toggle}
        style={{
          width: 52, height: 52,
          borderRadius: '50%',
          background: open ? '#1a1a1a' : TERRACOTTA,
          border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: open
            ? '0 4px 16px rgba(0,0,0,0.25)'
            : `0 4px 16px rgba(200,96,58,0.40), 0 2px 6px rgba(0,0,0,0.12)`,
          transition: 'background 220ms, box-shadow 220ms',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span style={{
          display: 'block',
          color: '#fff',
          fontSize: 24,
          fontWeight: 300,
          lineHeight: 1,
          transform: open ? 'rotate(45deg)' : 'rotate(0deg)',
          transition: 'transform 220ms cubic-bezier(0.0,0,0.2,1)',
        }}>+</span>
      </button>
    </div>
  );
}
