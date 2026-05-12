import { createContext, useContext, useState, useCallback, useRef } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

interface SnackbarItem {
  id: string;
  text: string;
  action?: { label: string; onClick: () => void };
  type?: 'default' | 'error';
}

interface SnackbarContextType {
  show: (
    text: string,
    opts?: { action?: { label: string; onClick: () => void }; type?: 'default' | 'error' }
  ) => void;
}

// ── Context ────────────────────────────────────────────────────────────────

const SnackbarContext = createContext<SnackbarContextType>({ show: () => {} });

export function useSnackbar() {
  return useContext(SnackbarContext);
}

// ── Provider ───────────────────────────────────────────────────────────────

const AUTO_DISMISS_MS = 3200;

export function SnackbarProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<SnackbarItem | null>(null);
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setExiting(true);
    setTimeout(() => { setCurrent(null); setExiting(false); }, 200);
  }, []);

  const show = useCallback<SnackbarContextType['show']>((text, opts) => {
    // Always replace — one snackbar at a time
    if (timerRef.current) clearTimeout(timerRef.current);
    const item: SnackbarItem = { id: Math.random().toString(36).slice(2), text, ...opts };
    setCurrent(item);
    setExiting(false);
    timerRef.current = setTimeout(dismiss, AUTO_DISMISS_MS);
  }, [dismiss]);

  return (
    <SnackbarContext.Provider value={{ show }}>
      {children}

      {current && (
        <div
          key={current.id}
          role="status"
          aria-live="polite"
          className={`fixed bottom-6 left-1/2 z-[200] flex items-center gap-3 px-4 py-3 rounded-xl shadow-snackbar min-w-[280px] max-w-[480px] ${
            exiting ? 'animate-snackbar-out' : 'animate-snackbar-in'
          } ${
            current.type === 'error'
              ? 'bg-on-surface text-error-container'
              : 'bg-on-surface text-surface'
          }`}
        >
          {/* Message */}
          <span className="flex-1 text-[13px] font-medium leading-snug">{current.text}</span>

          {/* Optional action */}
          {current.action && (
            <button
              onClick={() => { current.action!.onClick(); dismiss(); }}
              className="text-[13px] font-bold text-secondary shrink-0 hover:opacity-75 transition-opacity ml-2"
            >
              {current.action.label}
            </button>
          )}

          {/* Dismiss */}
          <button onClick={dismiss} className="p-0.5 hover:opacity-60 transition-opacity shrink-0 ml-1">
            <span className="material-symbols-outlined text-[15px] opacity-40">close</span>
          </button>
        </div>
      )}
    </SnackbarContext.Provider>
  );
}
