/**
 * THE LEDGER, UNDER A PROJECT.
 *
 * This is not a second transactions page. It is THE transactions page (Ledger), locked to one project.
 *
 * The project used to have a ledger of its own — ProjectTransactions: a second, smaller table with its
 * own columns, its own filters, its own idea of what a payment looks like. Two ledgers is two places to
 * fix the next bug, and the one nobody is looking at rots. Worse, it meant the same payment could be
 * described two different ways by the same product, which is the one thing a book of account may never
 * do: a figure must read the same wherever you open the book.
 *
 * And the global page had always been able to do this — it has filtered by project since the day it was
 * written. It only ever needed telling WHICH project, and then to stop offering the choice.
 *
 * The allocations carry the project's NAME (txn_allocations → projects.name), so that is the key; the
 * project_code, which the Site Desk is addressed by, is a different key for a different job.
 */
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { PageSkeleton } from '../components/SkeletonLoader';
import Ledger from './Ledger';

export default function ProjectLedger({ session }: { session: Session }) {
  const { projectId } = useParams<{ projectId: string }>();

  const { data: project, isLoading } = useQuery({
    queryKey: ['project_name', projectId],
    enabled: !!projectId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects').select('name').eq('project_id', projectId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as { name: string | null } | null;
    },
  });

  if (isLoading) return <PageSkeleton />;

  // A project with no name cannot be matched against an allocation, so it gets the whole ledger rather
  // than an empty one pretending to be its own. (Nothing in the app can create one, but the page must
  // not lie if something ever does.)
  return <Ledger session={session} lockedProject={project?.name ?? undefined} />;
}
