import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import type { Project } from '../types'
import { supabase } from '../lib/supabase'
import { useUserProfile } from '../App'
import { useSnackbar } from '../components/Snackbar'
import { LinearProgress } from '../components/LinearProgress'
import { Edit2, Trash2 } from 'lucide-react'

function fmtAmt(n: number) {
  if (n >= 10_00_000) return `₹${(n / 10_00_000).toFixed(1)}Cr`
  if (n >= 1_00_000)  return `₹${(n / 1_00_000).toFixed(1)}L`
  if (n >= 1_000)     return `₹${Math.round(n / 1_000)}K`
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

const STATUS_CONFIG: Record<string, { accent: string; badge: string; dot: string }> = {
  Active:    { accent: '#C8603A', badge: 'rgba(200,96,58,0.10)', dot: '#C8603A' },
  'On Hold': { accent: '#d97706', badge: 'rgba(217,119,6,0.10)',  dot: '#d97706' },
  Completed: { accent: '#2563eb', badge: 'rgba(37,99,235,0.10)',  dot: '#2563eb' },
}

function ProjectCard({
  project,
  stats,
  woCount,
  canManage,
  onEdit,
  onDelete,
}: {
  project: Project
  stats: { spent: number; txnCount: number } | undefined
  woCount: number
  canManage: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const navigate = useNavigate()
  const [hovered, setHovered] = useState(false)
  const cfg = STATUS_CONFIG[project.status] ?? STATUS_CONFIG['Active']
  const spent = stats?.spent ?? 0
  const txnCount = stats?.txnCount ?? 0

  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: 20,
        border: '1px solid rgba(0,0,0,0.06)',
        overflow: 'hidden',
        position: 'relative',
        cursor: 'pointer',
        transition: 'box-shadow 200ms, transform 200ms',
        boxShadow: hovered
          ? '0 8px 32px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)'
          : '0 1px 4px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.04)',
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => navigate(`/projects/${project.project_id}`)}
    >
      {/* Top accent bar */}
      <div style={{ height: 3, background: cfg.accent, opacity: project.status === 'Completed' ? 0.5 : 1 }} />

      <div style={{ padding: '20px 20px 0' }}>
        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{
              fontSize: 16, fontWeight: 700, color: '#0b1c30',
              letterSpacing: '-0.01em', lineHeight: 1.3, marginBottom: 3,
              fontFamily: 'Manrope, sans-serif',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {project.name}
            </h3>
            <p style={{ fontSize: 11, fontFamily: 'Geist Mono, monospace', color: 'rgba(0,0,0,0.30)', letterSpacing: '0.04em' }}>
              {project.project_id}
            </p>
          </div>
          <span style={{
            flexShrink: 0,
            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: cfg.dot, background: cfg.badge,
            padding: '3px 8px', borderRadius: 99,
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot, display: 'inline-block' }} />
            {project.status}
          </span>
        </div>

        {/* Meta */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>location_on</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.site_location}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>calendar_today</span>
            <span>Started {fmtDate(project.start_date)}</span>
          </div>
        </div>
      </div>

      {/* Stats strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
        borderTop: '1px solid rgba(0,0,0,0.05)',
        margin: '0 0',
      }}>
        {[
          { value: fmtAmt(spent), label: 'spent', colored: spent > 0 },
          { value: woCount === 0 ? '—' : String(woCount), label: 'open WOs', colored: woCount > 0 },
          { value: txnCount === 0 ? '—' : String(txnCount), label: 'transactions', colored: txnCount > 0 },
        ].map((s, i) => (
          <div key={i} style={{
            padding: '14px 8px',
            textAlign: 'center',
            borderRight: i < 2 ? '1px solid rgba(0,0,0,0.05)' : 'none',
          }}>
            <p style={{
              fontSize: 15, fontWeight: 700, fontFamily: 'Geist Mono, monospace',
              color: s.colored ? '#0b1c30' : 'rgba(0,0,0,0.20)',
              letterSpacing: '-0.02em', lineHeight: 1,
              marginBottom: 4,
            }}>
              {s.value}
            </p>
            <p style={{ fontSize: 10, color: 'rgba(0,0,0,0.30)', fontWeight: 500, letterSpacing: '0.02em', textTransform: 'uppercase' }}>
              {s.label}
            </p>
          </div>
        ))}
      </div>

      {/* Edit/Delete controls */}
      {canManage && (
        <div
          style={{
            position: 'absolute', top: 14, right: 14,
            display: 'flex', gap: 4,
            opacity: hovered ? 1 : 0,
            transition: 'opacity 150ms',
            background: 'rgba(255,255,255,0.95)',
            backdropFilter: 'blur(4px)',
            borderRadius: 10, padding: 4,
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            border: '1px solid rgba(0,0,0,0.08)',
          }}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={onEdit}
            style={{
              width: 28, height: 28, borderRadius: 7, border: 'none',
              background: 'transparent', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(0,0,0,0.45)', transition: 'all 150ms',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.05)'; (e.currentTarget as HTMLButtonElement).style.color = '#0b1c30' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(0,0,0,0.45)' }}
          >
            <Edit2 size={13} />
          </button>
          <button
            onClick={onDelete}
            style={{
              width: 28, height: 28, borderRadius: 7, border: 'none',
              background: 'transparent', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(0,0,0,0.45)', transition: 'all 150ms',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(229,62,62,0.08)'; (e.currentTarget as HTMLButtonElement).style.color = '#e53e3e' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(0,0,0,0.45)' }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

function EditProjectSheet({
  project,
  onSave,
  onCancel,
}: {
  project: Project
  onSave: (updates: Partial<Project>) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(project.name)
  const [loc, setLoc]   = useState(project.site_location)
  const [date, setDate] = useState(project.start_date?.split('T')[0] ?? '')
  const [status, setStatus] = useState<'Active' | 'Completed' | 'On Hold'>(project.status)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }} onClick={onCancel}>
      <div
        style={{
          width: '100%', maxWidth: 460,
          background: '#fff', borderRadius: 20,
          boxShadow: '0 24px 64px rgba(0,0,0,0.15)',
          overflow: 'hidden',
          animation: 'wizardSlideIn 250ms cubic-bezier(0.34,1.56,0.64,1)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '24px 24px 0', borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: 16 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, color: '#0b1c30', fontFamily: 'Manrope, sans-serif' }}>Edit Project</h3>
        </div>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[
            { label: 'Project Name', value: name, onChange: setName, placeholder: 'Project name' },
            { label: 'Site Location', value: loc, onChange: setLoc, placeholder: 'Site location' },
          ].map(f => (
            <div key={f.label}>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)', marginBottom: 6 }}>{f.label}</label>
              <input
                value={f.value} onChange={e => f.onChange(e.target.value)} placeholder={f.placeholder}
                style={{ width: '100%', height: 44, padding: '0 14px', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.10)', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                onFocus={e => (e.target.style.borderColor = '#C8603A')}
                onBlur={e => (e.target.style.borderColor = 'rgba(0,0,0,0.10)')}
              />
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)', marginBottom: 6 }}>Start Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                style={{ width: '100%', height: 44, padding: '0 14px', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.10)', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                onFocus={e => (e.target.style.borderColor = '#C8603A')}
                onBlur={e => (e.target.style.borderColor = 'rgba(0,0,0,0.10)')}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)', marginBottom: 6 }}>Status</label>
              <select value={status} onChange={e => setStatus(e.target.value as any)}
                style={{ width: '100%', height: 44, padding: '0 14px', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.10)', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', appearance: 'none', cursor: 'pointer' }}
                onFocus={e => (e.target.style.borderColor = '#C8603A')}
                onBlur={e => (e.target.style.borderColor = 'rgba(0,0,0,0.10)')}
              >
                <option value="Active">Active</option>
                <option value="On Hold">On Hold</option>
                <option value="Completed">Completed</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
            <button onClick={onCancel}
              style={{ flex: '0 0 auto', height: 44, padding: '0 20px', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.10)', background: 'transparent', cursor: 'pointer', fontSize: 14, color: 'rgba(0,0,0,0.50)', fontFamily: 'inherit' }}>
              Cancel
            </button>
            <button onClick={() => onSave({ name, site_location: loc, start_date: date, status })}
              style={{ flex: 1, height: 44, borderRadius: 12, border: 'none', background: '#0b1c30', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'inherit' }}>
              Save Changes
            </button>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes wizardSlideIn {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  )
}

export default function Projects({ session }: { session: Session }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: profile } = useUserProfile(session.user.id)
  const { show: showSnackbar } = useSnackbar()
  const canManage = profile?.role === 'management' || profile?.role === 'principal'

  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [filter, setFilter] = useState<'all' | 'Active' | 'On Hold' | 'Completed'>('all')

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as Project[]
    },
  })

  const { data: allocData = [] } = useQuery({
    queryKey: ['project_card_allocs'],
    queryFn: async () => {
      const { data } = await supabase
        .from('txn_allocations')
        .select('project_id, allocated_amount, transactions(txn_id, status, category)')
      return (data ?? []) as any[]
    },
  })

  const { data: woData = [] } = useQuery({
    queryKey: ['project_card_wos'],
    queryFn: async () => {
      const { data } = await supabase.from('work_orders').select('project_id, status')
      return (data ?? []) as { project_id: string; status: string }[]
    },
  })

  const projectStats = (() => {
    const s: Record<string, { spent: number; txnCount: number }> = {}
    for (const a of allocData) {
      if (a.transactions?.status !== 'Active') continue
      const cat = (a.transactions?.category ?? '').toUpperCase().replace(/[\s_-]/g, '')
      if (cat === 'CLIENTRECEIPT' || cat.includes('FUNDING') || cat.includes('INFLOW')) continue
      if (!s[a.project_id]) s[a.project_id] = { spent: 0, txnCount: 0 }
      s[a.project_id].spent += Number(a.allocated_amount) || 0
      s[a.project_id].txnCount++
    }
    return s
  })()

  const openWOs = woData.reduce((acc, wo) => {
    if (['Draft', 'Issued', 'Active', 'Assigned'].includes(wo.status)) acc[wo.project_id] = (acc[wo.project_id] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const updateProject = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Project> }) => {
      const { error } = await supabase.from('projects').update(updates).eq('project_id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['sidebar_projects'] })
      setEditingProject(null)
      showSnackbar('Project updated')
    },
    onError: (e: any) => showSnackbar(e.message || 'Update failed', { type: 'error' }),
  })

  const deleteProject = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('projects').delete().eq('project_id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['sidebar_projects'] })
      showSnackbar('Project deleted')
    },
    onError: (e: any) => showSnackbar(e.message || 'Cannot delete — check for linked records', { type: 'error' }),
  })

  const filtered = filter === 'all' ? projects : projects.filter(p => p.status === filter)
  const counts = {
    all:       projects.length,
    Active:    projects.filter(p => p.status === 'Active').length,
    'On Hold': projects.filter(p => p.status === 'On Hold').length,
    Completed: projects.filter(p => p.status === 'Completed').length,
  }

  return (
    <div style={{ padding: '32px 24px 64px', maxWidth: 1280, margin: '0 auto' }}>
      {isLoading && <LinearProgress />}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0b1c30', letterSpacing: '-0.02em', lineHeight: 1, fontFamily: 'Manrope, sans-serif', marginBottom: 6 }}>
            Projects
          </h1>
          <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.40)' }}>
            {projects.length} {projects.length === 1 ? 'project' : 'projects'} total
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => navigate('/projects/new')}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              height: 40, padding: '0 18px',
              borderRadius: 99, border: 'none',
              background: '#C8603A', color: '#fff',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 2px 12px rgba(200,96,58,0.30)',
              transition: 'all 150ms',
              letterSpacing: '-0.01em',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#a84e2d'; (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.02)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#C8603A'; (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
          >
            <span style={{ fontSize: 18, fontWeight: 300, lineHeight: 1 }}>+</span>
            New Project
          </button>
        )}
      </div>

      {/* Filter tabs */}
      {projects.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 24, flexWrap: 'wrap' }}>
          {(['all', 'Active', 'On Hold', 'Completed'] as const).map(f => {
            const count = counts[f]
            if (f !== 'all' && count === 0) return null
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  height: 32, padding: '0 14px',
                  borderRadius: 99,
                  border: `1.5px solid ${filter === f ? (f === 'Active' ? '#C8603A' : f === 'On Hold' ? '#d97706' : f === 'Completed' ? '#2563eb' : '#0b1c30') : 'rgba(0,0,0,0.08)'}`,
                  background: filter === f ? (f === 'Active' ? 'rgba(200,96,58,0.08)' : f === 'On Hold' ? 'rgba(217,119,6,0.08)' : f === 'Completed' ? 'rgba(37,99,235,0.08)' : 'rgba(11,28,48,0.06)') : 'transparent',
                  color: filter === f ? (f === 'Active' ? '#C8603A' : f === 'On Hold' ? '#d97706' : f === 'Completed' ? '#2563eb' : '#0b1c30') : 'rgba(0,0,0,0.45)',
                  fontSize: 12, fontWeight: filter === f ? 600 : 400,
                  cursor: 'pointer', transition: 'all 150ms',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {f === 'all' ? 'All' : f}
                <span style={{ fontSize: 11, opacity: 0.7 }}>{count}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Grid */}
      {filtered.length === 0 && !isLoading ? (
        <div style={{ paddingTop: 80, textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 28, color: 'rgba(0,0,0,0.25)' }}>domain</span>
          </div>
          <p style={{ fontSize: 16, fontWeight: 600, color: 'rgba(0,0,0,0.45)', marginBottom: 6 }}>
            {filter === 'all' ? 'No projects yet' : `No ${filter} projects`}
          </p>
          <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.30)', marginBottom: 24 }}>
            {filter === 'all' ? 'Create your first project to get started.' : 'Try a different filter.'}
          </p>
          {filter === 'all' && canManage && (
            <button
              onClick={() => navigate('/projects/new')}
              style={{ height: 40, padding: '0 20px', borderRadius: 99, background: '#C8603A', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Create First Project
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {filtered.map(p => (
            <ProjectCard
              key={p.project_id}
              project={p}
              stats={projectStats[p.project_id]}
              woCount={openWOs[p.project_id] ?? 0}
              canManage={canManage}
              onEdit={() => setEditingProject(p)}
              onDelete={() => {
                if (window.confirm(`Delete "${p.name}"? This will fail if there are linked records.`)) {
                  deleteProject.mutate(p.project_id)
                }
              }}
            />
          ))}
        </div>
      )}

      {editingProject && (
        <EditProjectSheet
          project={editingProject}
          onSave={updates => updateProject.mutate({ id: editingProject.project_id, updates })}
          onCancel={() => setEditingProject(null)}
        />
      )}
    </div>
  )
}
