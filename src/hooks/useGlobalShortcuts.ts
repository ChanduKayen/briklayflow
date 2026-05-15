import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const NAV_SHORTCUTS: Record<string, string> = {
  't': '/ledger',
  'w': '/work-orders',
  'p': '/purchase-orders',
  'l': '/logbook',
};

const CREATE_EVENTS: Record<string, string> = {
  '/ledger':          'shortcut:new-transaction',
  '/work-orders':     'shortcut:new-wo',
  '/purchase-orders': 'shortcut:new-po',
  '/logbook':         'shortcut:focus-logbook',
};

function isEditable(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as HTMLElement;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function useGlobalShortcuts(openCommandBar: () => void) {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) {
        // Cmd/Ctrl+K → command bar
        if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
          if (isEditable(e.target)) return;
          e.preventDefault();
          openCommandBar();
        }
        return;
      }

      if (isEditable(e.target)) return;

      const key = e.key.toLowerCase();

      // Space → command bar
      if (e.key === ' ') {
        e.preventDefault();
        openCommandBar();
        return;
      }

      // / → create shortcut for current page
      if (e.key === '/') {
        const eventName = CREATE_EVENTS[location.pathname];
        if (eventName) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent(eventName));
        }
        return;
      }

      // T/W/P/L → navigate
      const dest = NAV_SHORTCUTS[key];
      if (dest) {
        e.preventDefault();
        if (location.pathname !== dest) {
          navigate(dest);
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, location.pathname, openCommandBar]);
}
