import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

/**
 * Thin 2px progress bar fixed to the very top of the viewport. Renders only
 * while at least one background fetch (or mutation) is in flight.
 *
 * Visible behind the topbar's frosted glass — intentionally subtle. The point
 * is to give a passive signal that fresh data is on the way without ever
 * blocking the cached UI underneath.
 *
 * To avoid flashing on lightning-fast queries we wait ~250ms before showing.
 */
export default function GlobalRefetchIndicator() {
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const active = fetching + mutating > 0;
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!active) {
      setShow(false);
      return;
    }
    const id = window.setTimeout(() => setShow(true), 250);
    return () => window.clearTimeout(id);
  }, [active]);

  if (!show) return null;

  return (
    <div
      aria-hidden
      className="fixed top-0 left-0 right-0 z-[200] pointer-events-none"
      style={{ height: 2 }}
    >
      <div className="bk-linear-progress" style={{ height: 2, background: 'transparent' }}>
        <div
          className="bk-linear-progress-track"
          style={{ background: 'rgba(196,91,57,0.65)' }}
        />
      </div>
    </div>
  );
}
