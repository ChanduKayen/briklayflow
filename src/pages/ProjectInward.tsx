import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'

export default function ProjectInward({ session: _session }: { session: Session }) {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()

  useEffect(() => {
    navigate('/inward-register', { replace: true })
  }, [navigate, projectId])

  return null
}
