/**
 * THE SITE DESK, UNDER A PROJECT.
 *
 * This is not a second desk. It is the SAME page (SiteDeskV2), which has always scoped everything it
 * shows — problems, the plan, the pending queue, the building rail, the detail panel — to one site.
 * All it ever needed was for somebody to tell it which one, and where its own links should point.
 *
 * So this file does exactly two things, and then gets out of the way:
 *
 *   1. TRANSLATES THE KEY. A project route is addressed by project_id (PRJ-CHAKRI-7K2Q); the desk is
 *      addressed by project_code (CHAK), because that is what its refs are minted from (CHAK-14) and
 *      therefore what every link, every badge and every WhatsApp message already says. One lookup.
 *
 *   2. HANDS OVER THE ADDRESS. `basePath` keeps every link the desk draws inside the project it is
 *      standing in. Without it, clicking a problem would quietly walk you out to /desk and you would
 *      never notice you had left.
 *
 * A project with no project_code CANNOT have a desk — refs are minted from the code, so there is
 * nothing to address its rows with. That is not an error state to render; it is a door we do not put
 * on the wall (the tile is hidden). If somebody types the URL anyway, we say so plainly.
 */
import { Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { PageSkeleton } from '../components/SkeletonLoader';
import SiteDeskV2 from './SiteDeskV2';
import ProjectDetail from './ProjectDetail';
import { SITE_DESK_ENABLED } from '../lib/desk/flag';

/**
 * WHERE A PROJECT OPENS.
 *
 * The Overview was a lobby: a page you passed through on the way to the page you wanted. Nine tiles and
 * a summary, and the summary was of work that lives one click deeper. So it is not the front door any
 * more — THE SITE DESK IS. Opening a project puts you in front of the work.
 *
 * The overview's one irreplaceable job — editing the project itself: its name, its site, its dates, its
 * supervisor — survives as "Project settings", at the bottom of the rail where a settings page belongs.
 * Deleting the page outright would have taken the only door to that with it.
 *
 * A project with no short code cannot have a desk (its refs are numbered from the code), so it lands on
 * the old page and keeps the old entries. Nothing is ever stranded.
 */
export function ProjectHome({ session }: { session: Session }) {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, isLoading } = useProjectCode(projectId);

  if (isLoading) return <PageSkeleton />;
  if (SITE_DESK_ENABLED && project?.project_code?.trim()) {
    return <Navigate to={`/projects/${projectId}/desk/plan`} replace />;
  }
  return <ProjectDetail session={session} />;
}

/** The project's short code — the key the whole Site Desk is addressed by. */
export function useProjectCode(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project_code', projectId],
    enabled: !!projectId,
    staleTime: 5 * 60_000,          // a code is forever (refs are minted from it) — do not re-ask
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('project_code, name')
        .eq('project_id', projectId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as { project_code: string | null; name: string | null } | null;
    },
  });
}

export default function ProjectDesk({ session, tab }: { session: Session; tab: 'problems' | 'plan' }) {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, isLoading } = useProjectCode(projectId);

  if (isLoading) return <PageSkeleton />;

  const code = project?.project_code?.trim();
  if (!code) {
    return (
      <div className="mx-auto py-16 px-6 text-center" style={{ maxWidth: 460 }}>
        <p style={{ fontFamily: 'Georgia, serif', fontSize: '1.15rem', color: '#1E1A15' }}>
          This project has no site code yet
        </p>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: '#6B6258' }}>
          The Site Desk numbers everything it tracks from the project&rsquo;s short code — CHAK-14, CHAK-15 —
          so a project without one has nothing to number. Add a code to the project and the desk opens.
        </p>
      </div>
    );
  }

  return (
    <SiteDeskV2
      session={session}
      tab={tab}
      lockedSite={code}
      basePath={`/projects/${projectId}/desk`}
    />
  );
}
