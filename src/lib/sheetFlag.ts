// One flag for "a card is up".
//
// The app's dark surfaces all come from the same night binding, so a slide-up card landing on a page's
// dark sticky header puts two near-blacks against each other — measured at 1.06:1, which no shadow,
// scrim or gradient can separate (a scrim over a dark surface has almost nothing left to take away).
// The card's own rim-light gives it an edge, and this flag does the rest: while a card is up the page's
// fixed dark headers slide out from behind it, so the two never meet at all.
//
// Refcounted, because a nav composer can open over a page's own panel — and because the nav's cards
// float above every page, a flag on the document is the only place both can see.
import { useEffect } from 'react';

let up = 0;
function apply() {
  const el = document.documentElement;
  if (up > 0) el.dataset.sheet = 'up';
  else delete el.dataset.sheet;
}

/** While `open`, the page's dark fixed headers get out of the way. The last card down clears it. */
export function useSheetFlag(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    up += 1; apply();
    return () => { up = Math.max(0, up - 1); apply(); };
  }, [open]);
}
