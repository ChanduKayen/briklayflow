/**
 * What is already owed to this party ON THIS SITE, read the moment before a Day Book entry is filed.
 *
 * A payment is about to be booked to a party + a site; before it lands, this answers "and what did
 * we already owe them here?" — the same per-(party, site) figure the weekly run and the party ledger
 * roll up (v_party_site_balance.to_pay). For a VENDOR that pending is against bills, and the file
 * flow can then offer to attach the payment to them; for a WORKER it is derived from attendance /
 * work done, so it is shown as context only (there is no bill to attach).
 *
 * Keyed by (party, site) so cards for the same payee+site share one read. Degrades to 0 on any error
 * or a missing view — the preview simply doesn't show, never blocks the file.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

export function usePayablePreview(payeeId: string | null, projectId: string | null) {
  return useQuery<number>({
    queryKey: ['daybook_payable', payeeId ?? '', projectId ?? ''],
    enabled: !!payeeId && !!projectId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_party_site_balance')
        .select('to_pay')
        .eq('stakeholder_id', payeeId as string)
        .eq('project_id', projectId as string)
        .maybeSingle();
      if (error) return 0;
      return Number((data as { to_pay?: number } | null)?.to_pay) || 0;
    },
  });
}
