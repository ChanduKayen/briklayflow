import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useUserProfile } from '../App'
import { LinearProgress } from '../components/LinearProgress'

const PAGE_SIZE = 25

type DatePreset = 'today' | 'week' | 'month' | 'last_month' | 'quarter' | 'fy' | 'all' | 'custom'

const STATUS_BADGE: Record<string, string> = {
  Draft:     'bg-slate-100 text-slate-500',
  Assigned:  'bg-blue-50 text-blue-600',
  Issued:    'bg-violet-50 text-violet-700',
  Active:    'bg-amber-50 text-amber-600',
  Closed:    'bg-emerald-50 text-emerald-600',
  Cancelled: 'bg-rose-50 text-rose-600',
}

const ALL_STATUSES = ['Draft', 'Assigned', 'Issued', 'Active', 'Closed', 'Cancelled']

function getDateRange(preset: DatePreset, customFrom: string, customTo: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  switch (preset) {
    case 'today': return { from: today, to: today }
    case 'week': { const mon = new Date(today); mon.setDate(today.getDate() - ((today.getDay() + 6) % 7)); return { from: mon, to: today } }
    case 'month': return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: new Date(today.getFullYear(), today.getMonth() + 1, 0) }
    case 'last_month': return { from: new Date(today.getFullYear(), today.getMonth() - 1, 1), to: new Date(today.getFullYear(), today.getMonth(), 0) }
    case 'quarter': { const qm = Math.floor(today.getMonth() / 3) * 3; return { from: new Date(today.getFullYear(), qm, 1), to: new Date(today.getFullYear(), qm + 3, 0) } }
    case 'fy': { const fyY = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1; return { from: new Date(fyY, 3, 1), to: new Date(fyY + 1, 2, 31) } }
    case 'custom': return { from: customFrom ? new Date(customFrom) : null, to: customTo ? new Date(customTo) : null }
    default: return { from: null, to: null }
  }
}

export default function ProjectWorkOrders({ session }: { session: Session }) {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { data: profile } = useUserProfile(session.user.id)
  const canManage = profile?.role === 'management' || profile?.role === 'principal'

  const [searchTerm, setSearchTerm] = useState('')
  const [sortKey, setSortKey] = useState<'wo_id' | 'date_issued' | 'stakeholder' | 'order_value' | 'status'>('date_issued')
  const [sortAsc, setSortAsc] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string[]>([])
  const [filterWorker, setFilterWorker] = useState<string[]>([])
  const [datePreset, setDatePreset] = useState<DatePreset>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [activeFilterDropdown, setActiveFilterDropdown] = useState<string | null>(null)
  const [chipDropPos, setChipDropPos] = useState<{ top: number; left: number } | null>(null)
  const [showDateDropdown, setShowDateDropdown] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const filterBarRef    = useRef<HTMLDivElement>(null)
  const dateDropdownRef = useRef<HTMLDivElement>(null)
  const chipDropRef     = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as Node
      if ((filterBarRef.current && !filterBarRef.current.contains(t)) && (!chipDropRef.current || !chipDropRef.current.contains(t)))
        setActiveFilterDropdown(null)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  useEffect(() => {
    const h = () => setActiveFilterDropdown(null)
    window.addEventListener('scroll', h, true)
    return () => window.removeEventListener('scroll', h, true)
  }, [])

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (dateDropdownRef.current && !dateDropdownRef.current.contains(e.target as Node)) setShowDateDropdown(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  useEffect(() => { setSelectedIds(new Set()); setVisibleCount(PAGE_SIZE) }, [searchTerm, filterStatus, filterWorker, datePreset, customFrom, customTo])

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('name').eq('project_id', projectId!).single()
      return data
    },
    enabled: !!projectId,
  })

  const { data: workOrders = [], isLoading, isError } = useQuery({
    queryKey: ['project_wos', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_orders')
        .select('*, stakeholders(name, category)')
        .eq('project_id', projectId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as any[]
    },
    enabled: !!projectId,
  })

  const uniqueWorkers = Array.from(new Set(workOrders.map((w: any) => w.stakeholders?.name).filter(Boolean))) as string[]
  const { from: dateFrom, to: dateTo } = getDateRange(datePreset, customFrom, customTo)

  const filtered = workOrders.filter((wo: any) => {
    const term = searchTerm.toLowerCase()
    if (term && !wo.wo_id.toLowerCase().includes(term) && !(wo.stakeholders?.name || '').toLowerCase().includes(term) && !(wo.scope_of_work || '').toLowerCase().includes(term)) return false
    if (filterStatus.length && !filterStatus.includes(wo.status)) return false
    if (filterWorker.length && !filterWorker.includes(wo.stakeholders?.name || '')) return false
    if (dateFrom && dateTo) { const d = new Date(wo.date_issued); d.setHours(0, 0, 0, 0); if (d < dateFrom || d > dateTo) return false }
    return true
  })

  const sorted = [...filtered].sort((a: any, b: any) => {
    let aVal: any, bVal: any
    if (sortKey === 'stakeholder') { aVal = a.stakeholders?.name || ''; bVal = b.stakeholders?.name || '' }
    else if (sortKey === 'order_value') { aVal = Number(a.order_value); bVal = Number(b.order_value) }
    else { aVal = a[sortKey] ?? ''; bVal = b[sortKey] ?? '' }
    if (aVal < bVal) return sortAsc ? -1 : 1
    if (aVal > bVal) return sortAsc ? 1 : -1
    return 0
  })

  const visible = sorted.slice(0, visibleCount)
  const toggleSort = (key: typeof sortKey) => { if (sortKey === key) setSortAsc(a => !a); else { setSortKey(key); setSortAsc(true) } }
  const sortIcon = (key: string) => sortKey !== key
    ? <span className="material-symbols-outlined text-[13px] opacity-25">unfold_more</span>
    : <span className="material-symbols-outlined text-[13px] text-primary">{sortAsc ? 'arrow_upward' : 'arrow_downward'}</span>

  const allSelected  = sorted.length > 0 && sorted.every((w: any) => selectedIds.has(w.wo_id))
  const someSelected = sorted.some((w: any) => selectedIds.has(w.wo_id))
  const selectedCount = selectedIds.size
  const toggleAll = () => { if (allSelected) setSelectedIds(new Set()); else setSelectedIds(new Set(sorted.map((w: any) => w.wo_id))) }
  const toggleOne = (id: string) => setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })

  const fmtDShort = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  const dateShortLabel = (() => {
    if (datePreset === 'all') return null
    if (datePreset === 'custom' && dateFrom && dateTo) return `${fmtDShort(dateFrom)} – ${fmtDShort(dateTo)}`
    const now = new Date()
    if (datePreset === 'today')      return 'Today'
    if (datePreset === 'week')       return 'This Week'
    if (datePreset === 'month')      return now.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
    if (datePreset === 'last_month') { const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1); return lm.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) }
    if (datePreset === 'quarter')    return 'This Quarter'
    if (datePreset === 'fy')         { const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; return `FY ${fy}–${String(fy + 1).slice(2)}` }
    return null
  })()

  const hasAnyFilter = searchTerm !== '' || filterStatus.length > 0 || filterWorker.length > 0 || datePreset !== 'all'
  const clearAllFilters = () => { setSearchTerm(''); setFilterStatus([]); setFilterWorker([]); setDatePreset('all'); setCustomFrom(''); setCustomTo('') }

  const totalValue = filtered.reduce((s: number, w: any) => s + Number(w.order_value), 0)
  const activeCount = filtered.filter((w: any) => w.status === 'Active').length

  const exportCSV = () => {
    const rows: any[] = selectedCount > 0 ? workOrders.filter((w: any) => selectedIds.has(w.wo_id)) : sorted
    const header = ['WO ID', 'Date Issued', 'Worker', 'Scope', 'Value (₹)', 'Status']
    const csvRows = rows.map((w: any) => [w.wo_id, new Date(w.date_issued).toLocaleDateString('en-IN'), w.stakeholders?.name || '', w.scope_of_work || '', w.order_value, w.status])
    const csv = [header, ...csvRows].map(r => r.map((v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `work-orders-${new Date().toISOString().split('T')[0]}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const renderFilterChip = (key: string, label: string, options: string[], current: string[], setFilter: (v: string[]) => void) => {
    const isActive = current.length > 0
    const isOpen   = activeFilterDropdown === key
    const displayLabel = current.length === 1 ? current[0] : current.length > 1 ? `${label}: ${current.length}` : label
    return (
      <div key={key}>
        <button
          onClick={(e) => {
            if (!isOpen) { const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setChipDropPos({ top: rect.bottom + 6, left: rect.left }) }
            setActiveFilterDropdown(isOpen ? null : key)
          }}
          className={`flex items-center gap-1 h-8 px-3 rounded-full text-[12px] font-medium border transition-all whitespace-nowrap ${isActive ? 'border-primary/30 bg-primary/5 text-primary' : 'border-outline-variant/25 bg-white text-on-surface-variant/70 hover:border-outline-variant/50'}`}>
          <span className="truncate max-w-[140px]">{displayLabel}</span>
          {isActive
            ? <span className="hover:opacity-60 flex items-center ml-0.5" onClick={e => { e.stopPropagation(); setFilter([]) }}><span className="material-symbols-outlined text-[13px]">close</span></span>
            : <span className="material-symbols-outlined text-[13px]">expand_more</span>}
        </button>
        {isOpen && chipDropPos && createPortal(
          <div ref={chipDropRef} className="w-52 bg-white border border-black/[0.08] rounded-xl shadow-lg overflow-hidden" style={{ position: 'fixed', top: chipDropPos.top, left: chipDropPos.left, zIndex: 9999 }}>
            <div className="px-3 py-2 border-b border-black/[0.05] flex gap-3">
              <button className="text-[11px] font-semibold text-primary" onClick={() => setFilter([...options])}>Select all</button>
              <button className="text-[11px] font-semibold text-on-surface-variant/50" onClick={() => setFilter([])}>Clear</button>
            </div>
            <div className="py-1 max-h-52 overflow-y-auto">
              {options.map(opt => (
                <label key={opt} className="flex items-center gap-2.5 px-3 py-2 hover:bg-surface-container-low/50 cursor-pointer"
                  onClick={() => setFilter(current.includes(opt) ? current.filter(v => v !== opt) : [...current, opt])}>
                  <div className={`w-4 h-4 rounded-[4px] border-2 flex items-center justify-center transition-colors flex-shrink-0 ${current.includes(opt) ? 'bg-primary border-primary' : 'border-outline-variant/40'}`}>
                    {current.includes(opt) && <span className="material-symbols-outlined text-[10px] text-on-primary" style={{ fontVariationSettings: "'FILL' 1, 'wght' 700" }}>check</span>}
                  </div>
                  <span className="text-[13px] text-on-surface select-none truncate">{opt}</span>
                </label>
              ))}
            </div>
          </div>, document.body
        )}
      </div>
    )
  }

  const thCls  = 'px-4 py-3 text-left text-[11px] font-semibold text-on-surface-variant/45 uppercase tracking-[0.07em]'
  const thSort = `${thCls} cursor-pointer hover:text-primary transition-colors`

  return (
    <div className="min-h-screen bg-surface-container-low/30">
      <div className="max-w-[1280px] mx-auto px-4 md:px-6 py-8">

        {/* Header */}
        <div className="flex items-start justify-between mb-7">
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <button onClick={() => navigate(`/projects/${projectId}`)} className="text-[12px] text-on-surface-variant/50 hover:text-primary transition-colors">{project?.name ?? 'Project'}</button>
              <span className="text-[12px] text-on-surface-variant/25">/</span>
              <span className="text-[12px] text-on-surface font-semibold">Work Orders</span>
            </div>
            <h1 className="text-[24px] font-bold text-on-surface tracking-tight leading-none">Work Orders</h1>
            <p className="text-[12px] text-on-surface-variant/50 mt-1.5 font-medium">
              {filtered.length} order{filtered.length !== 1 ? 's' : ''}
              {totalValue > 0 && <> · ₹{totalValue.toLocaleString('en-IN')}</>}
              {activeCount > 0 && <> · <span className="text-amber-600 font-semibold">{activeCount} active</span></>}
            </p>
          </div>
          {canManage && (
            <button
              onClick={() => navigate('/work-orders/new', { state: { projectId, from: 'project', projectName: project?.name } })}
              style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 16px 0 12px', borderRadius: 99, border: 'none', background: '#C8603A', cursor: 'pointer', outline: 'none', fontSize: 13, fontWeight: 500, color: '#fff', boxShadow: '0 1px 2px rgba(200,96,58,0.25)', transition: 'opacity 120ms, box-shadow 120ms' }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '0.88'; e.currentTarget.style.boxShadow = '0 3px 8px rgba(200,96,58,0.35)' }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(200,96,58,0.25)' }}>
              <span style={{ fontSize: 17, fontWeight: 300, lineHeight: 1 }}>+</span>
              New Work Order
            </button>
          )}
        </div>

        {/* Filter bar */}
        <div ref={filterBarRef} className="flex items-center gap-2 mb-5 overflow-x-auto no-scrollbar md:flex-wrap flex-nowrap pb-0.5">

          {/* Date chip */}
          <div className="relative" ref={dateDropdownRef}>
            <button onClick={() => setShowDateDropdown(d => !d)}
              className={`flex items-center gap-1 h-8 px-3 rounded-full text-[12px] font-medium border transition-all whitespace-nowrap ${datePreset !== 'all' ? 'border-primary/30 bg-primary/5 text-primary' : 'border-outline-variant/25 bg-white text-on-surface-variant/70 hover:border-outline-variant/50'}`}>
              <span className="material-symbols-outlined text-[14px]">calendar_month</span>
              {dateShortLabel || 'All time'}
              {datePreset !== 'all'
                ? <span className="hover:opacity-60 flex items-center ml-0.5" onClick={e => { e.stopPropagation(); setDatePreset('all'); setCustomFrom(''); setCustomTo('') }}><span className="material-symbols-outlined text-[13px]">close</span></span>
                : <span className="material-symbols-outlined text-[13px]">expand_more</span>}
            </button>
            {showDateDropdown && (
              <div className="absolute top-full left-0 mt-1.5 w-52 bg-white border border-black/[0.08] rounded-xl shadow-lg z-50 overflow-hidden">
                {([
                  { id: 'today' as DatePreset, label: 'Today' },
                  { id: 'week' as DatePreset, label: 'This Week' },
                  { id: 'month' as DatePreset, label: 'This Month' },
                  { id: 'last_month' as DatePreset, label: 'Last Month' },
                  { id: 'quarter' as DatePreset, label: 'This Quarter' },
                  { id: 'fy' as DatePreset, label: 'This FY' },
                  { id: 'all' as DatePreset, label: 'All Time' },
                ] as { id: DatePreset; label: string }[]).map(p => (
                  <button key={p.id} onClick={() => { setDatePreset(p.id); setShowDateDropdown(false) }}
                    className="w-full flex items-center justify-between px-4 py-2 text-[13px] text-left hover:bg-surface-container-low/60 transition-colors">
                    <span className={datePreset === p.id ? 'text-primary font-semibold' : 'text-on-surface'}>{p.label}</span>
                    {datePreset === p.id && <span className="material-symbols-outlined text-[15px] text-primary">check</span>}
                  </button>
                ))}
                <div className="border-t border-black/[0.05]" />
                <button onClick={() => setDatePreset('custom')} className="w-full flex items-center justify-between px-4 py-2 text-[13px] text-left hover:bg-surface-container-low/60 transition-colors">
                  <span className={datePreset === 'custom' ? 'text-primary font-semibold' : 'text-on-surface'}>Custom Range</span>
                  {datePreset === 'custom' ? <span className="material-symbols-outlined text-[15px] text-primary">check</span> : <span className="material-symbols-outlined text-[15px] text-on-surface-variant/30">chevron_right</span>}
                </button>
                {datePreset === 'custom' && (
                  <div className="px-3 pb-3 pt-1 space-y-2 border-t border-black/[0.05] bg-surface-container-low/40">
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] font-bold text-on-surface-variant/50 w-7 shrink-0">FROM</label>
                      <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="bk-input py-1 text-[12px] flex-1" />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] font-bold text-on-surface-variant/50 w-7 shrink-0">TO</label>
                      <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="bk-input py-1 text-[12px] flex-1" />
                    </div>
                    {customFrom && customTo && <button onClick={() => setShowDateDropdown(false)} className="w-full py-1.5 bk-btn text-[12px] rounded-lg">Apply</button>}
                  </div>
                )}
              </div>
            )}
          </div>

          {renderFilterChip('status', 'Status', ALL_STATUSES, filterStatus, setFilterStatus)}
          {renderFilterChip('worker', 'Worker', uniqueWorkers, filterWorker, setFilterWorker)}

          {/* Search */}
          <div className="relative">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[15px] text-on-surface-variant/40 pointer-events-none">search</span>
            <input type="text" placeholder="Search…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} autoComplete="new-password"
              className="h-8 pl-8 pr-3 w-32 focus:w-52 transition-[width] duration-200 rounded-full border border-outline-variant/25 bg-white text-[12px] text-on-surface outline-none focus:border-primary/30 focus:ring-1 focus:ring-primary/10" />
          </div>

          <button onClick={exportCSV} className="hidden md:flex items-center gap-1.5 h-8 px-3 rounded-full border border-outline-variant/25 bg-white text-[12px] font-medium text-on-surface-variant/55 hover:border-outline-variant/50 hover:text-on-surface/75 transition-all shrink-0">
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>download</span>
            Export
          </button>

          {hasAnyFilter && (
            <button onClick={clearAllFilters} className="ml-auto text-[12px] font-medium text-on-surface-variant/45 hover:text-error transition-colors whitespace-nowrap">Clear all</button>
          )}
        </div>

        {/* Mobile cards */}
        <div className="md:hidden">
          {isLoading ? <div className="py-2"><LinearProgress /></div>
          : isError ? (
            <div className="py-20 text-center">
              <span className="material-symbols-outlined text-[56px] text-on-surface-variant/15 block mb-4">error_outline</span>
              <p className="text-[15px] font-medium text-on-surface/50">Failed to load work orders</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center">
              <span className="material-symbols-outlined text-[56px] text-on-surface-variant/15 block mb-4">{hasAnyFilter ? 'search_off' : 'file_present'}</span>
              <p className="text-[15px] font-medium text-on-surface/50">No work orders found</p>
              {hasAnyFilter && <button onClick={clearAllFilters} className="mt-5 h-11 px-5 rounded-full border border-outline-variant/30 text-[13px] font-medium text-on-surface-variant/60">Clear filters</button>}
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {filtered.map((wo: any) => {
                  const issued = new Date(wo.date_issued)
                  const isCurrentYear = issued.getFullYear() === new Date().getFullYear()
                  const dateStr = issued.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(!isCurrentYear ? { year: 'numeric' } : {}) })
                  return (
                    <div key={wo.wo_id} className={`bg-white rounded-xl border border-black/[0.06] p-3 cursor-pointer bk-row-ripple ${wo.status === 'Cancelled' ? 'opacity-50' : ''}`} onClick={() => navigate(`/work-orders/${wo.wo_id}`)}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[13px] font-data-mono text-on-surface-variant/60">{wo.wo_id}</span>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[wo.status] || 'bg-surface-container text-on-surface'}`}>{wo.status}</span>
                      </div>
                      <p className="text-[15px] font-[500] text-on-surface mb-0.5">
                        {wo.stakeholders?.name || '—'}
                        {wo.stakeholders?.category && <span className="text-[13px] font-normal text-on-surface-variant/60 ml-1">· {wo.stakeholders.category}</span>}
                      </p>
                      {wo.scope_of_work && <p className="text-[13px] text-on-surface-variant mb-2">{wo.scope_of_work}</p>}
                      <div className="flex items-center justify-between">
                        <span className="text-[15px] font-bold font-data-mono text-on-surface">₹{Number(wo.order_value).toLocaleString('en-IN')}</span>
                        <span className="text-[13px] text-on-surface-variant">{dateStr}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
              {filtered.length > visibleCount && (
                <button onClick={() => setVisibleCount(c => c + PAGE_SIZE)} className="w-full mt-3 py-3 rounded-xl border border-outline-variant/30 text-[13px] font-semibold text-primary">
                  Load more ({filtered.length - visibleCount} remaining)
                </button>
              )}
            </>
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block bg-white rounded-2xl border border-black/[0.06] shadow-sm overflow-hidden">
          {isLoading ? <div className="py-2"><LinearProgress /></div>
          : isError ? (
            <div className="py-20 text-center">
              <span className="material-symbols-outlined text-[56px] text-on-surface-variant/15 block mb-4">error_outline</span>
              <p className="text-[15px] font-medium text-on-surface/50">Failed to load work orders</p>
              <p className="text-[12px] text-on-surface-variant/35 mt-1.5">There was a problem fetching data</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="py-20 text-center">
              <span className="material-symbols-outlined text-[56px] text-on-surface-variant/15 block mb-4">{hasAnyFilter ? 'search_off' : 'file_present'}</span>
              <p className="text-[15px] font-medium text-on-surface/50">No work orders found</p>
              {hasAnyFilter && (
                <>
                  <p className="text-[12px] text-on-surface-variant/35 mt-1.5">Try adjusting your filters</p>
                  <button onClick={clearAllFilters} className="mt-5 h-8 px-4 rounded-full border border-outline-variant/30 text-[12px] font-medium text-on-surface-variant/60 hover:border-primary/30 hover:text-primary transition-colors">Clear filters</button>
                </>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse min-w-[600px]">
                <thead>
                  <tr className="border-b border-black/[0.06] bg-surface-container-low/30">
                    <th className="w-10 px-3 py-3 align-middle">
                      <div className="flex flex-col items-center gap-1">
                        <input type="checkbox" checked={allSelected} ref={el => { if (el) el.indeterminate = someSelected && !allSelected }} onChange={toggleAll} className="w-3.5 h-3.5 rounded border-outline-variant/50 text-primary focus:ring-primary cursor-pointer" />
                        {selectedCount > 0 && <span className="text-[9px] font-bold text-primary">{selectedCount}</span>}
                      </div>
                    </th>
                    <th className={thSort} onClick={() => toggleSort('date_issued')}><div className="flex items-center gap-1">Date {sortIcon('date_issued')}</div></th>
                    <th className={thSort} onClick={() => toggleSort('stakeholder')}><div className="flex items-center gap-1">Worker {sortIcon('stakeholder')}</div></th>
                    <th className={thCls}>Scope</th>
                    <th className={`${thSort} text-right`} onClick={() => toggleSort('order_value')}><div className="flex items-center justify-end gap-1">Value {sortIcon('order_value')}</div></th>
                    <th className={thSort} onClick={() => toggleSort('status')}><div className="flex items-center gap-1">Status {sortIcon('status')}</div></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((wo: any, idx: number) => {
                    const isChecked = selectedIds.has(wo.wo_id)
                    const issued = new Date(wo.date_issued)
                    const isCurrentYear = issued.getFullYear() === new Date().getFullYear()
                    const dateStr = issued.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(!isCurrentYear ? { year: 'numeric' } : {}) })
                    return (
                      <tr key={wo.wo_id}
                        style={{ height: '52px', animationDelay: `${Math.min(idx, 20) * 18}ms` }}
                        className={`border-b border-black/[0.04] last:border-0 hover:bg-surface-container-low/40 transition-colors cursor-pointer bk-row-ripple wo-row-animate ${isChecked ? 'bg-primary/[0.02]' : ''} ${wo.status === 'Cancelled' ? 'opacity-50' : ''}`}
                        onClick={() => navigate(`/work-orders/${wo.wo_id}`)}>
                        <td className="px-3 align-middle w-10" onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={isChecked} onChange={() => toggleOne(wo.wo_id)} className="w-3.5 h-3.5 rounded border-outline-variant/50 text-primary focus:ring-primary cursor-pointer" />
                        </td>
                        <td className="px-4 align-middle"><span className="text-[13px] text-on-surface/80 font-medium whitespace-nowrap">{dateStr}</span></td>
                        <td className="px-4 align-middle">
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium text-on-surface truncate leading-tight">{wo.stakeholders?.name || '—'}</p>
                            <p className="text-[11px] text-on-surface-variant/45 font-data-mono leading-tight mt-0.5">{wo.wo_id}</p>
                          </div>
                        </td>
                        <td className="px-4 align-middle max-w-[260px]"><span className="text-[12px] text-on-surface-variant/55 leading-snug line-clamp-2">{wo.scope_of_work || '—'}</span></td>
                        <td className="px-4 align-middle text-right"><span className="text-[14px] font-bold font-data-mono text-on-surface">₹{Number(wo.order_value).toLocaleString('en-IN')}</span></td>
                        <td className="px-4 align-middle">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${STATUS_BADGE[wo.status] || 'bg-surface-container-high text-on-surface'}`}>{wo.status}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!isLoading && sorted.length > visibleCount && (
            <div className="px-6 py-4 border-t border-black/[0.04] flex items-center justify-between bg-surface-container-lowest/30">
              <span className="text-[12px] text-on-surface-variant/40">Showing {Math.min(visibleCount, sorted.length)} of {sorted.length}</span>
              <button onClick={() => setVisibleCount(c => c + PAGE_SIZE)} className="text-[12px] font-semibold text-primary hover:underline">Load more</button>
            </div>
          )}
        </div>

      </div>

      {canManage && (
        <button className="bk-fab md:hidden" onClick={() => navigate('/work-orders/new', { state: { projectId, from: 'project', projectName: project?.name } })} title="New Work Order">
          <span className="material-symbols-outlined text-[24px]">add</span>
        </button>
      )}

      {selectedCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pb-4 px-4 pointer-events-none">
          <div className="pointer-events-auto bg-on-surface/95 backdrop-blur-sm text-surface rounded-2xl shadow-2xl px-5 py-3 flex items-center gap-3 flex-wrap animate-in slide-in-from-bottom-4 duration-200">
            <span className="text-[13px] font-semibold whitespace-nowrap text-surface/90">{selectedCount} selected</span>
            <div className="w-px h-5 bg-surface/20" />
            <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold bg-surface/10 hover:bg-surface/20 transition-colors">
              <span className="material-symbols-outlined text-[16px]">download</span>Export CSV
            </button>
            <button onClick={() => setSelectedIds(new Set())} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[12px] font-bold hover:bg-surface/10 transition-colors ml-1 text-surface/60 hover:text-surface">
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
