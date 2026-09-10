/**
 * Record a bill through the one pipeline, from whichever door asked.
 *
 * The Bills page's desktop table and its phone list both open the same New-bill modal, and both
 * commit the same way — billIntake, where the dedupe lives. This is that commit, in one place, so
 * the two surfaces cannot drift into two behaviours.
 */
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useOrgId, useAuth } from '../../lib/auth/AuthProvider';
import { useUserProfile } from '../../App';
import { useSnackbar } from '../Snackbar';
import { intakeCommit } from '../../lib/billIntake';
import type { BillDraft } from './NewBillModal';
import type { DuplicateBill } from '../../lib/billsApi';

export function useMintBill(): (d: BillDraft) => Promise<{ duplicate?: DuplicateBill } | void> {
  const orgId = useOrgId();
  const { userId } = useAuth();
  const { data: profile } = useUserProfile(userId ?? '');
  const { show } = useSnackbar();
  const qc = useQueryClient();

  return useCallback(async (d: BillDraft) => {
    const who = profile as { full_name?: string; name?: string } | undefined;
    const res = await intakeCommit(
      // NOTE: useAuth().userId is the ORG MEMBERSHIP id, not an auth.users id — writing it to
      // bills.created_by (FK → auth.users) violates the constraint. Provenance rides on
      // created_by_name; leave created_by null rather than send a non-auth id.
      { orgId, source: 'bills_page', file: d.file, vendorId: d.vendorId, projectId: d.projectId,
        createdBy: null, createdByName: who?.full_name ?? who?.name ?? null },
      { vendor: d.vendorName, billNo: d.billNo, billDate: d.billDate, amount: d.amount, lines: d.lines },
      d.vendorId, { allowDuplicate: d.allowDuplicate },
    );
    // The modal offers the reconcile ("open it") and the override; hand it the collision and let it ask.
    if (res.status === 'duplicate') return { duplicate: res.existing };
    show('Bill added');
    qc.invalidateQueries({ queryKey: ['bills'] });
    qc.invalidateQueries({ queryKey: ['party_ledger'] });
    qc.invalidateQueries({ queryKey: ['weekly_payments'] });
    qc.invalidateQueries({ queryKey: ['party_topay_map'] });
  }, [orgId, profile, show, qc]);
}
