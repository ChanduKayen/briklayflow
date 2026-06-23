import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { PeekModal } from './PeekModal';
import { PeekSkeleton, DataField } from './PeekSkeleton';

interface ProjectPeekProps { projectId: string; onClose: () => void; }

export function ProjectPeek({ projectId, onClose }: ProjectPeekProps) {
  const { data: project, isLoading } = useQuery({
    queryKey: ['project_peek', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects').select('*')
        .eq('project_id', projectId).single();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['project_peek_stats', projectId],
    queryFn: async () => {
      const [txnRes, woRes] = await Promise.all([
        supabase.from('txn_allocations')
          .select('allocated_amount, transactions!inner(status)')
          .eq('project_id', projectId)
          .neq('transactions.status', 'Voided'),
        supabase.from('work_orders')
          .select('wo_id')
          .eq('project_id', projectId)
          .in('status', ['Active', 'Issued', 'Assigned', 'ACTIVE', 'ISSUED', 'ASSIGNED']),
      ]);
      return {
        totalSpent: (txnRes.data || []).reduce((s: number, a: any) => s + Number(a.allocated_amount || 0), 0),
        activeWOs: woRes.data?.length ?? 0,
      };
    },
    enabled: !!project,
  });

  return (
    <PeekModal
      title={project?.name || 'Project'}
      subtitle={project?.site_location}
      fullPageHref={`/projects/${projectId}`}
      onClose={onClose}
    >
      {isLoading ? (
        <PeekSkeleton />
      ) : !project ? (
        <p className="text-center text-on-surface-variant py-12 text-body-sm">Project not found.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div>
            <p className="text-[20px] font-bold text-on-surface">{project.name}</p>
            {project.site_location && <p className="text-[13px] text-on-surface-variant mt-0.5">{project.site_location}</p>}
            {project.status && (
              <span className={`inline-block mt-2 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                project.status === 'Active'    ? 'bg-secondary-container text-on-secondary-container'
                : project.status === 'Completed' ? 'bg-green-100 text-green-800'
                : 'bg-surface-container-high text-on-surface-variant'
              }`}>{project.status}</span>
            )}
          </div>

          <hr className="border-outline-variant/20" />

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-surface-container-low p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant mb-1">Total Spent</p>
              <p className="text-[18px] font-bold font-data-mono text-on-surface">
                ₹{(stats?.totalSpent || 0).toLocaleString('en-IN')}
              </p>
            </div>
            <div className="rounded-xl bg-surface-container-low p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant mb-1">Active Contracts</p>
              <p className="text-[18px] font-bold text-on-surface">{stats?.activeWOs ?? '—'}</p>
            </div>
          </div>

          {project.client_name  && <DataField label="Client"      value={project.client_name} />}
          {project.description  && <DataField label="Description" value={project.description} />}
        </div>
      )}
    </PeekModal>
  );
}
