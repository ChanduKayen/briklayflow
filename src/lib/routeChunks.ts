// The bottom tab bar's destinations, as import thunks.
//
// Each tab is its own lazy chunk — Transactions 24 kB, For review 33 kB, POs 11 kB, Payables 16 kB
// gzipped. Tapping a cold tab means fetching that before anything can render, which is the pause
// between tabs. These thunks are shared: App builds its lazy() routes from them AND warms them on
// idle, so the prefetch primes exactly the module the route will await rather than a lookalike.
//
// A dynamic import is idempotent — the second call returns the module already in the cache — so
// prefetching costs one fetch and every later tap is a cache hit.
export const loadLedger = () => import('../pages/Ledger');
export const loadLogbook = () => import('../pages/Logbook');
export const loadPurchaseOrders = () => import('../pages/PurchaseOrders');
export const loadPayables = () => import('../pages/Payables');

/** Route path → the chunk behind it, for prefetching on idle or on first touch. */
export const TAB_CHUNKS: Record<string, () => Promise<unknown>> = {
  '/ledger': loadLedger,
  '/logbook': loadLogbook,
  '/purchase-orders': loadPurchaseOrders,
  '/payables': loadPayables,
};

const warmed = new Set<string>();

/** Warm one route's chunk. Safe to call repeatedly — it only ever fetches once. */
export function warmRoute(path: string): void {
  const load = TAB_CHUNKS[path];
  if (!load || warmed.has(path)) return;
  warmed.add(path);
  // A failed prefetch must stay silent: the route still works, it just loads on demand.
  void load().catch(() => warmed.delete(path));
}

/** Warm every tab, one at a time while the browser is idle, so the first paint keeps the network. */
export function warmAllTabs(): () => void {
  const paths = Object.keys(TAB_CHUNKS);
  let i = 0;
  let cancelled = false;
  type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  const w = window as IdleWindow;
  let handle: number | undefined;
  const schedule = (fn: () => void) => {
    handle = w.requestIdleCallback ? w.requestIdleCallback(fn, { timeout: 2500 }) : window.setTimeout(fn, 300);
  };
  const step = () => {
    if (cancelled || i >= paths.length) return;
    warmRoute(paths[i++]);
    schedule(step);
  };
  schedule(step);
  return () => {
    cancelled = true;
    if (handle == null) return;
    if (w.cancelIdleCallback) w.cancelIdleCallback(handle); else window.clearTimeout(handle);
  };
}
