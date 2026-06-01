import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Prefetch hooks for list→detail navigations. Each hook returns a function
 * that, given an id, yields {onTouchStart, onMouseEnter, onPointerDown}
 * handlers to spread onto a row. By the time the user's tap fires onClick,
 * the detail-page cache is usually warm and the page paints instantly.
 *
 * IMPORTANT: each prefetch must execute the EXACT same query as the detail
 * page's first useQuery (including joins) so the cached row shape matches
 * what the detail page reads. Otherwise the detail page renders cached
 * partial data, errors on missing joins, then refetches to recover.
 *
 * Each (id) is fetched at most once per 30 seconds to avoid stampedes on
 * fast finger drags through a list.
 */

function makePrefetchProps(prefetch: () => void) {
  return {
    onTouchStart: prefetch,
    onMouseEnter: prefetch,
    onPointerDown: prefetch,
  } as const;
}

const PREFETCH_TTL_MS = 30_000;

function useThrottledPrefetch() {
  const seen = useRef<Map<string, number>>(new Map());
  return useCallback((id: string, fire: () => void) => {
    const last = seen.current.get(id) ?? 0;
    if (Date.now() - last < PREFETCH_TTL_MS) return;
    seen.current.set(id, Date.now());
    fire();
  }, []);
}

// ── PO detail (matches PurchaseOrderDetail.tsx#380) ────────────────────
export function usePrefetchPO() {
  const qc = useQueryClient();
  const throttle = useThrottledPrefetch();
  return useCallback((poId: string) => {
    if (!poId) return makePrefetchProps(() => {});
    return makePrefetchProps(() => {
      throttle(poId, () => {
        qc.prefetchQuery({
          queryKey: ['po_detail', poId],
          queryFn: async () => {
            const { data, error } = await supabase
              .from('purchase_orders')
              .select('*, projects(name, site_location), stakeholders(name, category, gstin, is_approved)')
              .eq('po_id', poId)
              .single();
            if (error) throw error;
            return data;
          },
          staleTime: 60_000,
        });
      });
    });
  }, [qc, throttle]);
}

// ── WO detail (matches WorkOrderDetail.tsx#178) ────────────────────────
export function usePrefetchWO() {
  const qc = useQueryClient();
  const throttle = useThrottledPrefetch();
  return useCallback((woId: string) => {
    if (!woId) return makePrefetchProps(() => {});
    return makePrefetchProps(() => {
      throttle(woId, () => {
        qc.prefetchQuery({
          queryKey: ['wo', woId],
          queryFn: async () => {
            const { data, error } = await supabase
              .from('work_orders')
              .select(`
                *,
                projects(name, site_location),
                stakeholders(name, category, contact),
                wo_milestones(*)
              `)
              .eq('wo_id', woId)
              .single();
            if (error) throw error;
            return data;
          },
          staleTime: 60_000,
        });
      });
    });
  }, [qc, throttle]);
}

// ── Transaction detail (matches TransactionDetail.tsx#583) ─────────────
export function usePrefetchTxn() {
  const qc = useQueryClient();
  const throttle = useThrottledPrefetch();
  return useCallback((txnId: string) => {
    if (!txnId) return makePrefetchProps(() => {});
    return makePrefetchProps(() => {
      throttle(txnId, () => {
        qc.prefetchQuery({
          queryKey: ['transaction', txnId],
          queryFn: async () => {
            const { data, error } = await supabase
              .from('transactions')
              .select('*, stakeholders(*)')
              .eq('txn_id', txnId)
              .single();
            if (error) throw error;
            return data;
          },
          staleTime: 60_000,
        });
      });
    });
  }, [qc, throttle]);
}

// ── Stakeholder detail (matches StakeholderDetail.tsx#102) ─────────────
export function usePrefetchStakeholder() {
  const qc = useQueryClient();
  const throttle = useThrottledPrefetch();
  return useCallback((stakeholderId: string) => {
    if (!stakeholderId) return makePrefetchProps(() => {});
    return makePrefetchProps(() => {
      throttle(stakeholderId, () => {
        qc.prefetchQuery({
          queryKey: ['stakeholder', stakeholderId],
          queryFn: async () => {
            const { data, error } = await supabase
              .from('stakeholders').select('*')
              .eq('stakeholder_id', stakeholderId).single();
            if (error) throw error;
            return data;
          },
          staleTime: 5 * 60 * 1000,
        });
      });
    });
  }, [qc, throttle]);
}
