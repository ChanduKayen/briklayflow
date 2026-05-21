import { useParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import InwardRegister from './InwardRegister'

export default function ProjectInward({ session }: { session: Session }) {
  const { projectId } = useParams<{ projectId: string }>()
  if (!projectId) return null
  return <InwardRegister session={session} lockedProjectId={projectId} />
}
