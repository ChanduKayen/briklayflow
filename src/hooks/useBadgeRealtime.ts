import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/**
 * Subscribe to postgres_changes on tables that feed sidebar / bottom-tab
 * badge counts and invalidate the corresponding React Query keys when rows
 * change. This replaces polling: counts update the moment another user
 * creates a PO, a WO, or a bill, and there are zero requests when nothing
 * changes.
 *
 * Mount once from App.tsx — the channel is global and unique per session.
 *
 * Keys invalidated (must match SidebarContent + BottomTabBar):
 *   - nav_wo_pending      ← work_orders
 *   - nav_po_untallied    ← purchase_orders
 *   - nav_bill_overdue    ← client_invoices
 *   - inbox_badge         ← rough_entries (also has its own sub in Logbook)
 */
export function useBadgeRealtime(enabled: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    const channel = supabase
      .channel('briklay-badge-counts')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'work_orders' },
        () => qc.invalidateQueries({ queryKey: ['nav_wo_pending'] })
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'purchase_orders' },
        () => qc.invalidateQueries({ queryKey: ['nav_po_untallied'] })
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'client_invoices' },
        () => qc.invalidateQueries({ queryKey: ['nav_bill_overdue'] })
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rough_entries' },
        () => qc.invalidateQueries({ queryKey: ['inbox_badge'] })
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, qc]);
}
