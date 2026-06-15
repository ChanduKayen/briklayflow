import { QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';

// ─────────────────────────────────────────────────────────────────────────
// Briklay cache strategy
//
// Construction-site users on flaky 3G/4G. We want:
//   - Page navigation: instant from cache, refetch in background.
//   - Browser refresh: instant from localStorage, refetch in background.
//   - Stale data is acceptable for a few minutes; never block the UI.
//
// Skeleton loaders should fire ONLY when there is no cached data anywhere
// (first ever visit, or after a 24h gap). After that, the user always sees
// data immediately and the GlobalRefetchIndicator handles "is it refreshing".
// ─────────────────────────────────────────────────────────────────────────

export const PERSIST_KEY_PREFIXES = [
  // Lists
  'purchase-orders',
  'purchase_orders_enhanced',
  'po-list',
  'work-orders',
  'work_orders',
  'wo-list',
  'transactions',
  'ledger',
  'txn-list',
  'projects',
  'sidebar_projects',
  'stakeholders',
  'inward-register',
  'logbook',
  // Day Book queries — keys must be listed verbatim (prefix match only):
  // without these the Day Book never hydrates from localStorage, so every
  // reload shows a skeleton and blocks on a full network fetch.
  'rough_entries',
  'daybook_stakeholders',
  'daybook_projects',
  'bills',
  'invoices',
  'sku_directory',
  'sku-directory',
  'available_skus',
  'available-skus',
  // Badge / counts
  'nav_wo_pending',
  'nav_po_untallied',
  'nav_bill_overdue',
  'inbox_badge',
  // Detail records
  'po_detail',
  'po_line_items',
  'po_grn',
  'po_payment_totals',
  'po_receipt_summary',
  'purchase-order',
  'work-order',
  'wo',
  'wo_allocations',
  'transaction',
  'txn_allocations',
  'stakeholder',
  'stakeholder_txns',
  'stakeholder_wos',
  'stakeholder_po_bills',
  'project',
  'bill',
  'invoice',
  // Reference / org
  'profile',
  'cost-codes',
] as const;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache-first: data is fresh for 2 minutes; stale data is still shown
      // immediately while a background refetch runs.
      staleTime: 2 * 60 * 1000,
      // Keep in memory long enough that the persister can hydrate from it,
      // and that off-screen pages still hit cache on return.
      gcTime: 24 * 60 * 60 * 1000, // 24h — required for persistence
      refetchOnMount: 'always',
      refetchOnWindowFocus: 'always',
      refetchOnReconnect: 'always',
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
      networkMode: 'offlineFirst',
    },
    mutations: {
      retry: 1,
      networkMode: 'offlineFirst',
    },
  },
});

// ─────────────────────────────────────────────────────────────────────────
// localStorage persister
//
// shouldDehydrateQuery: only persist queries whose keys are in the allow-list.
// This keeps the cache small and avoids persisting transient/UI-only queries.
// Anything user-or-org-specific is keyed by the supabase user id elsewhere,
// so wiping localStorage on sign-out is safe.
// ─────────────────────────────────────────────────────────────────────────

export const persister =
  typeof window !== 'undefined'
    ? createSyncStoragePersister({
        storage: window.localStorage,
        key: 'briklay-query-cache',
        throttleTime: 1000,
        serialize: (data) => JSON.stringify(data),
        deserialize: (data) => JSON.parse(data),
      })
    : undefined;

export function shouldPersistQuery(queryKey: readonly unknown[]): boolean {
  const head = queryKey[0];
  if (typeof head !== 'string') return false;
  return PERSIST_KEY_PREFIXES.some((p) => head === p || head.startsWith(p));
}

/** Wipe persisted cache, e.g. on sign-out. */
export function clearPersistedCache() {
  try {
    window.localStorage.removeItem('briklay-query-cache');
  } catch {
    // ignore quota/privacy errors
  }
}
