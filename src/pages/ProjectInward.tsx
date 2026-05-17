import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export default function ProjectInward({ session: _session }: { session: Session }) {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('name').eq('project_id', projectId!).single()
      return data
    },
    enabled: !!projectId,
  })

  return (
    <div style={{ padding: '28px 24px 64px', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', cursor: 'pointer' }} onClick={() => navigate(`/projects/${projectId}`)}>
            {project?.name ?? 'Project'}
          </span>
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.20)' }}>/</span>
          <span style={{ fontSize: 12, color: '#0b1c30', fontWeight: 600 }}>Inward Register</span>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0b1c30', letterSpacing: '-0.02em', fontFamily: 'Manrope, sans-serif' }}>Inward Register</h1>
      </div>

      <div style={{
        textAlign: 'center',
        background: '#fff', borderRadius: 20, border: '1px solid rgba(0,0,0,0.06)',
        padding: '80px 40px',
      }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 28, color: 'rgba(0,0,0,0.25)' }}>local_shipping</span>
        </div>
        <p style={{ fontSize: 17, fontWeight: 700, color: '#0b1c30', marginBottom: 8, fontFamily: 'Manrope, sans-serif' }}>Inward register coming soon</p>
        <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.40)', maxWidth: 320, margin: '0 auto', lineHeight: 1.6 }}>
          Log every material and equipment delivery to site — vendor, vehicle, challan number, quantity, and receiver sign-off.
        </p>
      </div>
    </div>
  )
}
