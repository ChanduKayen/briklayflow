import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconReceipt2, IconFileInvoice, IconHammer, IconUserPlus, IconBook } from '@tabler/icons-react';

const ACTIONS = [
  { icon: IconReceipt2,    label: 'New Transaction',    path: '/ledger/new' },
  { icon: IconFileInvoice, label: 'New Purchase Order', path: '/purchase-orders/new' },
  { icon: IconHammer,      label: 'New Work Order',     path: '/work-orders/new' },
  { icon: IconUserPlus,    label: 'New Party',          path: '/stakeholders?new=1' },
  { icon: IconBook,        label: 'Day book',           path: '/logbook' },
];

export function QuickActionsOverlay({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement>(null);
  const swipeStartY = useRef<number | null>(null);

  if (!isOpen) return null;

  const go = (path: string) => { navigate(path); onClose(); };

  return (
    <div
      className="md:hidden"
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'qa-overlay-in 200ms ease both',
      }}
      onClick={onClose}
    >
      <div
        ref={cardRef}
        onClick={e => e.stopPropagation()}
        onTouchStart={e => { swipeStartY.current = e.touches[0].clientY; }}
        onTouchEnd={e => {
          if (swipeStartY.current !== null) {
            const dy = e.changedTouches[0].clientY - swipeStartY.current;
            if (dy > 50) onClose();
          }
          swipeStartY.current = null;
        }}
        style={{
          background: 'white', borderRadius: 16, padding: '20px 24px',
          width: 260, boxShadow: '0 16px 40px rgba(0,0,0,0.16)',
        }}
      >
        <p style={{
          fontSize: 11, color: 'rgba(0,0,0,0.38)', letterSpacing: '0.07em',
          textTransform: 'uppercase', marginBottom: 4,
        }}>
          quick actions
        </p>
        {ACTIONS.map((action, i) => {
          const Icon = action.icon;
          return (
            <button
              key={action.path}
              onClick={() => go(action.path)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 0', width: '100%',
                background: 'transparent', border: 'none', cursor: 'pointer',
                borderBottom: i < ACTIONS.length - 1 ? '0.5px solid rgba(0,0,0,0.08)' : 'none',
              }}
            >
              <Icon size={18} strokeWidth={1.5} style={{ color: '#006c49', flexShrink: 0 }} />
              <span style={{ fontSize: 14, color: '#0b1c30', textAlign: 'left' }}>{action.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
