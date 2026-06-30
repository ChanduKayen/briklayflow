import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

// ─────────────────────────────────────────────────────────────────────────
// S1-1 — the shared loading/error gate. So any data boundary's loading and
// error states can ALWAYS fail and recover — never a perpetual spinner.
//
//   • data present → proceed (cache-first: stale data shows immediately while a
//     background refetch runs; we never block on refetch).
//   • loading, no data → the skeleton (or a calm default) …
//   • …but if loading drags past `timeoutMs` (12s) OR the query errors → a RETRY
//     CARD: "Couldn’t load — tap to retry," with a retry button + a home escape.
//
// Two shapes:
//   • useQueryGate(...) → returns the gate node, or null to proceed. Ideal for
//     screens that early-return their loader: `const g = useQueryGate(...); if (g) return g;`
//   • <QueryGate ...>{success}</QueryGate> → wrapper form.
//
// Additive: changes nothing about WHAT a query fetches or how success renders —
// only the loading/error envelope.
// ─────────────────────────────────────────────────────────────────────────

export interface QueryGateOpts {
  isLoading: boolean;
  isError?: boolean;
  /** True when there is data to show (incl. stale cache) → proceed regardless. */
  hasData?: boolean;
  refetch?: () => void;
  /** Shown while genuinely loading with no data; defaults to a calm spinner. */
  skeleton?: ReactNode;
  /** Watchdog: flip a hung load to the retry card after this many ms. */
  timeoutMs?: number;
  /** Short label, e.g. "your tasks". */
  label?: string;
}

function RetryCard({ label, onRetry }: { label?: string; onRetry: () => void }) {
  const navigate = useNavigate();
  return (
    <div role="alert" style={{
      minHeight: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      <div style={{ maxWidth: 360, textAlign: 'center' }}>
        <div style={{
          width: 46, height: 46, margin: '0 auto 14px', borderRadius: 14, display: 'grid', placeItems: 'center',
          background: '#FBECE3', color: '#A8451F', fontSize: 22,
        }}>⟳</div>
        <p style={{ color: '#1E1A15', fontSize: '1.02rem', fontWeight: 600, margin: 0 }}>
          Couldn’t load{label ? ` ${label}` : ''}
        </p>
        <p style={{ color: '#6B6258', fontSize: '0.86rem', lineHeight: 1.55, marginTop: 6 }}>
          The connection stalled. Your data is safe — tap retry.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
          <button onClick={onRetry} style={{
            padding: '9px 18px', borderRadius: 11, border: 'none', cursor: 'pointer',
            background: '#C2592F', color: '#fff', fontWeight: 600, fontSize: '0.88rem',
          }}>Retry</button>
          <button onClick={() => navigate('/')} style={{
            padding: '9px 18px', borderRadius: 11, cursor: 'pointer',
            background: '#fff', color: '#5A4E43', border: '1px solid #E5DED2', fontWeight: 500, fontSize: '0.88rem',
          }}>Home</button>
        </div>
      </div>
    </div>
  );
}

function DefaultSpinner() {
  return (
    <div style={{ minHeight: 220, display: 'grid', placeItems: 'center' }} aria-busy="true">
      <span style={{
        width: 26, height: 26, borderRadius: '50%', display: 'block',
        border: '2.5px solid #EBE2D4', borderTopColor: '#C2592F', animation: 'qg-spin .8s linear infinite',
      }} />
      <style>{'@keyframes qg-spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}

/** Returns the gate node (skeleton or retry card), or null when it's safe to render the success UI. */
export function useQueryGate(opts: QueryGateOpts): ReactNode | null {
  const { isLoading, isError, hasData, refetch, skeleton, timeoutMs = 12_000, label } = opts;
  const [timedOut, setTimedOut] = useState(false);

  // Watchdog — only while genuinely loading with nothing to show. Cleared the moment the load
  // resolves, errors, or data arrives, so a normal load never trips it.
  useEffect(() => {
    if (!isLoading || hasData) { setTimedOut(false); return; }
    const t = setTimeout(() => setTimedOut(true), timeoutMs);
    return () => clearTimeout(t);
  }, [isLoading, hasData, timeoutMs]);

  if (hasData) return null;                          // cache-first: anything to show → proceed
  if (isError || timedOut) return <RetryCard label={label} onRetry={() => { setTimedOut(false); refetch?.(); }} />;
  if (isLoading) return <>{skeleton ?? <DefaultSpinner />}</>;
  return null;
}

export function QueryGate(props: QueryGateOpts & { children: ReactNode }) {
  const gate = useQueryGate(props);
  return <>{gate ?? props.children}</>;
}
