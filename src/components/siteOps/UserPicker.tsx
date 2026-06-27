// Shared org-member picker — used for supervisor assignment (project) and owner assignment
// (task + issue). Members are app users (user_profiles), not free-text contacts. Picking
// marks the field as a human decision (owner_source='manual') at the call site.

import { useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

const INK = '#221A13', INK_SOFT = 'rgba(34,26,19,0.55)', INK_FAINT = 'rgba(34,26,19,0.34)'
const TERRA = '#C8603A', LINE = 'rgba(34,26,19,0.10)', CREAM = '#FBF9F6', SERIF = "'Playfair Display', Georgia, serif"

export interface OrgMember { id: string; name: string | null; role: string | null }

const ROLE_COLOR: Record<string, string> = {
  principal: '#C45B39', management: '#3b82f6', supervisor: '#14b8a6', accountant: '#8b5cf6',
}
export function initialsOf(name: string | null): string {
  return (name ?? '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || '?'
}

/** Org members (cached). Shared by every picker. */
export function useOrgMembers(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ['org_members', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('user_profiles').select('id, name, role').eq('org_id', orgId)
      if (error) throw error
      return (data ?? []) as OrgMember[]
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  })
}

export function MemberAvatar({ name, role, size = 28 }: { name: string | null; role?: string | null; size?: number }) {
  return (
    <span style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: (role && ROLE_COLOR[role]) ? ROLE_COLOR[role] : 'rgba(34,26,19,0.12)', color: '#fff', fontSize: size * 0.38, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {initialsOf(name)}
    </span>
  )
}

export function UserPicker({ orgId, currentId, title = 'Assign', onPick, onClose, allowUnassign = true }: {
  orgId: string; currentId: string | null
  title?: string
  onPick: (id: string | null) => void
  onClose: () => void
  allowUnassign?: boolean
}) {
  const { data: members = [], isLoading } = useOrgMembers(orgId)
  const [q, setQ] = useState('')
  const filtered = members.filter((m) => (m.name ?? '').toLowerCase().includes(q.toLowerCase()))

  const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 12, cursor: 'pointer', border: '1px solid transparent', textAlign: 'left', background: 'transparent', width: '100%' }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(34,26,19,0.32)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, maxHeight: '80vh', display: 'flex', flexDirection: 'column', background: CREAM, borderRadius: 20, border: `1px solid ${LINE}`, boxShadow: '0 24px 64px rgba(34,26,19,0.28)', padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 600, color: INK, margin: 0 }}>{title}</h3>
          <button onClick={onClose} aria-label="Close" style={{ width: 28, height: 28, border: 'none', background: 'transparent', color: INK_FAINT, fontSize: 19, cursor: 'pointer' }}>×</button>
        </div>
        <input
          autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members…"
          style={{ fontSize: 14, color: INK, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 12px', outline: 'none', marginBottom: 8 }}
        />
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {allowUnassign && (
            <button onClick={() => onPick(null)} style={{ ...row, color: INK_SOFT }}>
              <span style={{ width: 28, height: 28, borderRadius: '50%', border: `1.5px dashed ${INK_FAINT}`, flexShrink: 0 }} />
              <span style={{ fontSize: 14 }}>Unassign</span>
            </button>
          )}
          {isLoading && <p style={{ fontSize: 13, color: INK_FAINT, padding: 12 }}>Loading…</p>}
          {filtered.map((m) => {
            const on = m.id === currentId
            return (
              <button key={m.id} onClick={() => onPick(m.id)} style={{ ...row, borderColor: on ? TERRA : 'transparent', background: on ? `${TERRA}0d` : 'transparent' }}>
                <MemberAvatar name={m.name} role={m.role} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: INK }}>{m.name ?? 'Unnamed'}</span>
                  {m.role && <span style={{ display: 'block', fontSize: 11.5, color: INK_FAINT, textTransform: 'capitalize' }}>{m.role}</span>}
                </span>
                {on && <span style={{ color: TERRA, fontSize: 15 }}>✓</span>}
              </button>
            )
          })}
          {!isLoading && filtered.length === 0 && <p style={{ fontSize: 13, color: INK_FAINT, padding: 12 }}>No members found.</p>}
        </div>
      </div>
    </div>
  )
}
