import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { usePeek } from '../context/PeekContext'
import { useUserProfile } from '../App'
import { useSnackbar } from '../components/Snackbar'
import { PageSkeleton } from '../components/SkeletonLoader'
import { getCostCode } from '../lib/costCodes'
import { formatTxn } from '../lib/formatTxn'
import { IconPaperclip } from '@tabler/icons-react'
import { ImageLightbox } from '../components/ImageLightbox'

const PAGE_SIZE = 25

type DatePreset = 'today' | 'week' | 'month' | 'last_month' | 'quarter' | 'fy' | 'all' | 'custom'

const MATERIAL_CATEGORIES_LEGACY = ['Material Supply', 'PO Advance', 'PO Settlement', 'Transport & Handling']

function getTxnType(txn: any): string {
  if (txn.stakeholders?.type === 'Worker') return 'Worker Payment'
  if (txn.stakeholders?.type === 'Vendor') {
    const cc = getCostCode(txn.category)
    if (cc?.division.type === 'MAT') return 'Material Purchase'
    if (MATERIAL_CATEGORIES_LEGACY.includes(txn.category)) return 'Material Purchase'
  }
  return 'General Expense'
}

function getNeedsAction(txn: any): 'link_wo' | 'link_po' | false {
  if (txn.status === 'Voided') return false
  const stkType = txn.stakeholders?.type
  if (stkType !== 'Worker' && stkType !== 'Vendor') return false
  const allocs = txn.txn_allocations || []
  if (allocs.length === 0) return false
  const hasUnlinked = allocs.some((a: any) => !a.order_type)
  if (!hasUnlinked) return false
  return stkType === 'Worker' ? 'link_wo' : 'link_po'
}

function getDateRange(preset: DatePreset, customFrom: string, customTo: string): { from: Date | null; to: Date | null } {
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

export default function ProjectTransactions({ session }: { session: Session }) {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { openPeek } = usePeek()
  const qc = useQueryClient()
  const { data: profile } = useUserProfile(session.user.id)
  const { show: showSnackbar } = useSnackbar()

  const [searchTerm, setSearchTerm] = useState('')
  const [sortKey, setSortKey] = useState<'txn_id' | 'date' | 'type' | 'stakeholder' | 'category' | 'payment_mode' | 'total_amount' | 'status'>('date')
  const [sortAsc, setSortAsc] = useState(false)
  const [filterStakeholder, setFilterStakeholder] = useState<string[]>([])
  const [filterCategory, setFilterCategory] = useState<string[]>([])
  const [filterStatus, setFilterStatus] = useState<string[]>([])
  const [filterType, setFilterType] = useState<string[]>([])
  const [filterFlagged, setFilterFlagged] = useState(false)
  const [filterNeedsAction, setFilterNeedsAction] = useState(false)
  const [activeFilterDropdown, setActiveFilterDropdown] = useState<string | null>(null)
  const [chipDropPos, setChipDropPos] = useState<{ top: number; left: number } | null>(null)
  const [datePreset, setDatePreset] = useState<DatePreset>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [showDateDropdown, setShowDateDropdown] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [selectedTxnIds, setSelectedTxnIds] = useState<Set<string>>(new Set())
  const [showRecategorize, setShowRecategorize] = useState(false)
  const [showVoidAll, setShowVoidAll] = useState(false)
  const [recatCategory, setRecatCategory] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())

  const filterBarRef    = useRef<HTMLDivElement>(null)
  const chipDropRef     = useRef<HTMLDivElement>(null)
  const dateDropdownRef = useRef<HTMLDivElement>(null)

  const ALL_CATEGORIES = ['Advance', 'Running Bill', 'Final Settlement', 'Retention Release',
    'Material Supply', 'PO Advance', 'PO Settlement', 'Transport & Handling',
    'Site Overhead', 'Labour Welfare', 'Tools & Equipment', 'Professional Fees', 'Utilities', 'Other']

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as Node
      if ((filterBarRef.current && !filterBarRef.current.contains(t)) && (!chipDropRef.current || !chipDropRef.current.contains(t))) setActiveFilterDropdown(null)
    }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  useEffect(() => {
    const h = () => setActiveFilterDropdown(null)
    window.addEventListener('scroll', h, true); return () => window.removeEventListener('scroll', h, true)
  }, [])

  useEffect(() => {
    const h = (e: MouseEvent) => { if (dateDropdownRef.current && !dateDropdownRef.current.contains(e.target as Node)) setShowDateDropdown(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  useEffect(() => {
    const handleMouseUp = () => setIsDragging(false)
    const handleClickOutside = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('[data-cell-select]')) setSelectedRows(new Set()) }
    window.addEventListener('mouseup', handleMouseUp); window.addEventListener('mousedown', handleClickOutside)
    return () => { window.removeEventListener('mouseup', handleMouseUp); window.removeEventListener('mousedown', handleClickOutside) }
  }, [])

  useEffect(() => { setSelectedTxnIds(new Set()); setVisibleCount(PAGE_SIZE) }, [searchTerm, filterStakeholder, filterCategory, filterStatus, filterType, datePreset, customFrom, customTo, filterFlagged, filterNeedsAction])

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('name').eq('project_id', projectId!).single()
      return data
    },
    enabled: !!projectId,
  })

  // Fetch all allocations for this project with full transaction data
  const { data: allocData = [], isLoading, isError } = useQuery({
    queryKey: ['project_txns_v2', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('txn_allocations')
        .select(`
          *,
          transactions!inner(
            *,
            stakeholders(name, type, category),
            txn_allocations(*, projects(name))
          )
        `)
        .eq('project_id', projectId!)
      if (error) throw error
      return (data ?? []).filter((a: any) => a.transactions !== null) as any[]
    },
    enabled: !!projectId,
  })

  // Build grouped rows: group allocations by txn_id
  const txnGroupMap = new Map<string, { txn: any; alloc: any }[]>()
  for (const a of allocData) {
    const txn = a.transactions
    if (!txn) continue
    if (!txnGroupMap.has(txn.txn_id)) txnGroupMap.set(txn.txn_id, [])
    txnGroupMap.get(txn.txn_id)!.push({ txn, alloc: a })
  }

  const uniqueTypes = ['Worker Payment', 'Material Purchase', 'General Expense']

  const activeDateRange = getDateRange(datePreset, customFrom, customTo)

  // Filter transactions
  const filteredTxnIds = Array.from(txnGroupMap.keys()).filter(txnId => {
    const rows = txnGroupMap.get(txnId)!
    const txn = rows[0].txn
    const term = searchTerm.toLowerCase()
    if (term && !txn.txn_id.toLowerCase().includes(term) && !(txn.stakeholders?.name || '').toLowerCase().includes(term) && !(txn.category || '').toLowerCase().includes(term)) return false
    if (filterStakeholder.length && !filterStakeholder.includes(txn.stakeholders?.name || '')) return false
    if (filterCategory.length && !filterCategory.includes(txn.category || '')) return false
    if (filterStatus.length && !filterStatus.includes(txn.status || '')) return false
    if (filterFlagged && txn.ai_flag_status !== 'Flagged') return false
    if (filterNeedsAction && !getNeedsAction(txn)) return false
    if (filterType.length && !filterType.includes(getTxnType(txn))) return false
    const { from, to } = activeDateRange
    if (from && to) { const d = new Date(txn.date); d.setHours(0, 0, 0, 0); if (d < from || d > to) return false }
    return true
  })

  type ExpandedRow = { txn: any; alloc: any | null; isFirstInGroup: boolean; groupSize: number }

  const allExpandedRows: ExpandedRow[] = filteredTxnIds.flatMap(txnId => {
    const rows = txnGroupMap.get(txnId)!
    return rows.map((r, i) => ({ txn: r.txn, alloc: r.alloc, isFirstInGroup: i === 0, groupSize: rows.length }))
  })

  // Sort
  const sortedRows: ExpandedRow[] = (() => {
    const groups = Array.from(new Map(allExpandedRows.map(r => [r.txn.txn_id, txnGroupMap.get(r.txn.txn_id)!.map((x, i) => ({ txn: x.txn, alloc: x.alloc, isFirstInGroup: i === 0, groupSize: txnGroupMap.get(r.txn.txn_id)!.length }))])).values())
    groups.sort((ga, gb) => {
      const a = ga[0], b = gb[0]
      let aVal: any, bVal: any
      if (sortKey === 'stakeholder') { aVal = a.txn.stakeholders?.name || ''; bVal = b.txn.stakeholders?.name || '' }
      else if (sortKey === 'type') { aVal = getTxnType(a.txn); bVal = getTxnType(b.txn) }
      else if (sortKey === 'total_amount') { aVal = Number(a.txn.total_amount); bVal = Number(b.txn.total_amount) }
      else { aVal = a.txn[sortKey]; bVal = b.txn[sortKey] }
      if (aVal < bVal) return sortAsc ? -1 : 1
      if (aVal > bVal) return sortAsc ? 1 : -1
      return 0
    })
    // only include groups whose txn_id is in filteredTxnIds
    return groups.filter(g => filteredTxnIds.includes(g[0].txn.txn_id)).flat()
  })()

  const visibleRows = sortedRows.slice(0, visibleCount)
  const filteredTransactions = filteredTxnIds.map(id => txnGroupMap.get(id)![0].txn)

  const toggleSort = (key: typeof sortKey) => { if (sortKey === key) setSortAsc(a => !a); else { setSortKey(key); setSortAsc(true) } }
  const renderSortIcon = (key: string) => sortKey !== key
    ? <span className="material-symbols-outlined text-[13px] opacity-25">unfold_more</span>
    : <span className="material-symbols-outlined text-[13px] text-primary">{sortAsc ? 'arrow_upward' : 'arrow_downward'}</span>

  const visibleTxnIds = Array.from(new Set(sortedRows.map(r => r.txn.txn_id)))
  const allVisibleSelected = visibleTxnIds.length > 0 && visibleTxnIds.every(id => selectedTxnIds.has(id))
  const someVisibleSelected = visibleTxnIds.some(id => selectedTxnIds.has(id))
  const selectedCount = selectedTxnIds.size
  const toggleAllVisible = () => { if (allVisibleSelected) setSelectedTxnIds(new Set()); else setSelectedTxnIds(new Set(visibleTxnIds)) }
  const toggleTxn = (id: string) => setSelectedTxnIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })

  const allTxns = Array.from(txnGroupMap.values()).flatMap(g => g.map(x => x.txn))
  const selectedTxns = allTxns.filter((t: any) => selectedTxnIds.has(t.txn_id))
  const selectedCategories = Array.from(new Set(selectedTxns.map((t: any) => t.category).filter(Boolean))) as string[]
  const hasAmendedSelected = selectedTxns.some((t: any) => (t as any).amendments?.length > 0)
  const voidableSelected = selectedTxns.filter((t: any) => t.status !== 'Voided')

  const fmtDShort = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  const dateShortLabel = (() => {
    if (datePreset === 'all') return null
    if (datePreset === 'custom') { const { from, to } = activeDateRange; if (from && to) return `${fmtDShort(from)} – ${fmtDShort(to)}`; return null }
    const now = new Date()
    if (datePreset === 'today') return 'Today'
    if (datePreset === 'week') return 'This Week'
    if (datePreset === 'month') return now.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
    if (datePreset === 'last_month') { const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1); return lm.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) }
    if (datePreset === 'quarter') return 'This Quarter'
    if (datePreset === 'fy') { const fyY = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; return `FY ${fyY}–${String(fyY + 1).slice(2)}` }
    return null
  })()

  const hasAnyFilter = filterFlagged || filterNeedsAction || filterStakeholder.length > 0 || filterCategory.length > 0 || filterStatus.length > 0 || filterType.length > 0 || datePreset !== 'all' || searchTerm !== ''
  const clearAllFilters = () => { setDatePreset('all'); setCustomFrom(''); setCustomTo(''); setFilterFlagged(false); setFilterNeedsAction(false); setFilterStakeholder([]); setFilterCategory([]); setFilterStatus([]); setFilterType([]); setSearchTerm('') }

  const voidAllMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('transactions').update({ status: 'Voided', voided_by: session.user.id, voided_at: new Date().toISOString() }).in('txn_id', ids)
      if (error) throw error
    },
    onSuccess: (_d, ids) => { qc.invalidateQueries({ queryKey: ['project_txns_v2', projectId] }); setSelectedTxnIds(new Set()); setShowVoidAll(false); showSnackbar(`${ids.length} transaction${ids.length !== 1 ? 's' : ''} voided`) },
    onError: (err: any) => showSnackbar(err.message || 'Failed to void', { type: 'error' }),
  })

  const recatMutation = useMutation({
    mutationFn: async ({ ids, category }: { ids: string[]; category: string }) => {
      const { error } = await supabase.from('transactions').update({ category }).in('txn_id', ids)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['project_txns_v2', projectId] }); setSelectedTxnIds(new Set()); setShowRecategorize(false); setRecatCategory(''); showSnackbar('Category updated') },
    onError: (err: any) => showSnackbar(err.message || 'Failed to update', { type: 'error' }),
  })

  const renderFilterChip = (filterKey: string, label: string, options: string[], currentFilter: string[], setFilter: (f: string[]) => void) => {
    const isActive = currentFilter.length > 0
    const isOpen = activeFilterDropdown === filterKey
    const displayLabel = currentFilter.length === 1 ? currentFilter[0] : currentFilter.length > 1 ? `${label}: ${currentFilter.length}` : label
    return (
      <div>
        <button
          onClick={(e) => {
            if (!isOpen) { const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setChipDropPos({ top: rect.bottom + 6, left: rect.left }) }
            setActiveFilterDropdown(isOpen ? null : filterKey)
          }}
          className={`flex items-center gap-1 h-8 px-3 rounded-full text-[12px] font-medium border transition-all whitespace-nowrap ${isActive ? 'border-primary/30 bg-primary/5 text-primary' : 'border-outline-variant/25 bg-white text-on-surface-variant/70 hover:border-outline-variant/50'}`}>
          <span className="truncate max-w-[140px]">{displayLabel}</span>
          {isActive
            ? <span className="hover:opacity-60 flex items-center ml-0.5" onClick={(e) => { e.stopPropagation(); setFilter([]) }}><span className="material-symbols-outlined text-[13px]">close</span></span>
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
                  onClick={() => setFilter(currentFilter.includes(opt) ? currentFilter.filter(v => v !== opt) : [...currentFilter, opt])}>
                  <div className={`w-4 h-4 rounded-[4px] border-2 flex items-center justify-center transition-colors flex-shrink-0 ${currentFilter.includes(opt) ? 'bg-primary border-primary' : 'border-outline-variant/40'}`}>
                    {currentFilter.includes(opt) && <span className="material-symbols-outlined text-[10px] text-on-primary" style={{ fontVariationSettings: "'FILL' 1, 'wght' 700" }}>check</span>}
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

  const typeBadge = (txn: any) => {
    const type = getTxnType(txn)
    const meta: Record<string, { short: string; cls: string }> = {
      'Worker Payment':    { short: 'Worker',   cls: 'bg-blue-50 text-blue-600' },
      'Material Purchase': { short: 'Material', cls: 'bg-amber-50 text-amber-600' },
      'General Expense':   { short: 'Expense',  cls: 'bg-slate-100 text-slate-500' },
    }
    const { short, cls } = meta[type] || { short: type, cls: 'bg-surface-container-high text-on-surface' }
    return <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${cls}`}>{short}</span>
  }

  const statusBadge = (txn: any) => {
    const s = txn.status
    const cls: Record<string, string> = { Active: 'bg-emerald-50 text-emerald-600', Voided: 'bg-slate-100 text-slate-400', Amended: 'bg-purple-50 text-purple-600' }
    const needsAction = getNeedsAction(txn)
    const isManualFlagged = txn.ai_flag_status === 'Flagged' && s !== 'Voided'
    return (
      <div className="flex items-center gap-1">
        {needsAction && <span className="material-symbols-outlined text-[13px] text-amber-400 cursor-pointer hover:text-amber-600 transition-colors shrink-0" onClick={e => { e.stopPropagation(); openPeek('TRANSACTION', txn.txn_id) }}>link_off</span>}
        {isManualFlagged && <span className="material-symbols-outlined text-[12px] text-red-400 shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>flag</span>}
        <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${cls[s] || 'bg-surface-container-high text-on-surface'}`}>{s}</span>
      </div>
    )
  }

  const exportCSV = () => {
    const txnsToExport = selectedCount > 0 ? selectedTxns : filteredTransactions
    const rows = txnsToExport.flatMap((t: any) => {
      const allocs: any[] = t.txn_allocations || []
      if (allocs.length === 0) return [[t.txn_id, t.date, t.stakeholders?.name || '', getTxnType(t), t.category || '', t.payment_mode || '', t.total_amount, t.status]]
      return allocs.map((a: any) => [t.txn_id, t.date, t.stakeholders?.name || '', getTxnType(t), t.category || '', t.payment_mode || '', t.total_amount, a.projects?.name || '', t.status])
    })
    const header = ['TXN ID', 'Date', 'Payee', 'Type', 'Category', 'Mode', 'Amount', 'Project', 'Status']
    const csv = [header, ...rows].map((r: any[]) => r.map((v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `transactions-${new Date().toISOString().split('T')[0]}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const selectedAmounts = Array.from(selectedRows).map(idx => { const row = sortedRows[idx]; if (!row) return 0; return row.alloc ? Number(row.alloc.allocated_amount) : Number(row.txn.total_amount) })
  const sum = selectedAmounts.reduce((a, b) => a + b, 0)
  const avg = selectedAmounts.length ? sum / selectedAmounts.length : 0

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
              <span className="text-[12px] text-on-surface font-semibold">Transactions</span>
            </div>
            <h1 className="text-[24px] font-bold text-on-surface tracking-tight leading-none">Transactions</h1>
            <p className="text-[12px] text-on-surface-variant/50 mt-1.5 font-medium">
              {filteredTransactions.length} transaction{filteredTransactions.length !== 1 ? 's' : ''} · ₹{filteredTransactions.reduce((s: number, t: any) => s + Number(t.total_amount), 0).toLocaleString('en-IN')}
            </p>
          </div>
          <button onClick={() => navigate('/ledger/new', { state: { projectId, projectName: project?.name } })}
            style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 16px 0 12px', borderRadius: 99, border: 'none', background: '#C8603A', cursor: 'pointer', outline: 'none', fontSize: 13, fontWeight: 500, color: '#fff', boxShadow: '0 1px 2px rgba(200,96,58,0.25)', transition: 'opacity 120ms, box-shadow 120ms' }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.88'; e.currentTarget.style.boxShadow = '0 3px 8px rgba(200,96,58,0.35)' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(200,96,58,0.25)' }}>
            <span style={{ fontSize: 17, fontWeight: 300, lineHeight: 1 }}>+</span>
            New Transaction
          </button>
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
                ? <span className="hover:opacity-60 flex items-center ml-0.5" onClick={(e) => { e.stopPropagation(); setDatePreset('all'); setCustomFrom(''); setCustomTo('') }}><span className="material-symbols-outlined text-[13px]">close</span></span>
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
                ]).map(p => (
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
                    <div className="flex items-center gap-2"><label className="text-[10px] font-bold text-on-surface-variant/50 w-7 shrink-0">FROM</label><input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="bk-input py-1 text-[12px] flex-1" /></div>
                    <div className="flex items-center gap-2"><label className="text-[10px] font-bold text-on-surface-variant/50 w-7 shrink-0">TO</label><input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="bk-input py-1 text-[12px] flex-1" /></div>
                    {customFrom && customTo && <button onClick={() => setShowDateDropdown(false)} className="w-full py-1.5 bk-btn text-[12px] rounded-lg">Apply</button>}
                  </div>
                )}
              </div>
            )}
          </div>

          {renderFilterChip('type', 'Type', uniqueTypes, filterType, setFilterType)}

          {/* Status chip */}
          {(() => {
            const isStatusActive = filterStatus.length > 0 || filterFlagged || filterNeedsAction
            const isOpen = activeFilterDropdown === 'status'
            const activeCount = filterStatus.length + (filterFlagged ? 1 : 0) + (filterNeedsAction ? 1 : 0)
            const displayLabel = activeCount === 0 ? 'Status' : activeCount === 1
              ? (filterNeedsAction && !filterFlagged && filterStatus.length === 0 ? 'Needs Action' : filterFlagged && !filterNeedsAction && filterStatus.length === 0 ? 'Flagged' : filterStatus[0])
              : `Status: ${activeCount}`
            return (
              <div>
                <button
                  onClick={(e) => {
                    if (!isOpen) { const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setChipDropPos({ top: rect.bottom + 6, left: rect.left }) }
                    setActiveFilterDropdown(isOpen ? null : 'status')
                  }}
                  className={`flex items-center gap-1 h-8 px-3 rounded-full text-[12px] font-medium border transition-all whitespace-nowrap ${isStatusActive ? 'border-primary/30 bg-primary/5 text-primary' : 'border-outline-variant/25 bg-white text-on-surface-variant/70 hover:border-outline-variant/50'}`}>
                  <span className="truncate max-w-[140px]">{displayLabel}</span>
                  {isStatusActive
                    ? <span className="hover:opacity-60 flex items-center ml-0.5" onClick={(e) => { e.stopPropagation(); setFilterStatus([]); setFilterFlagged(false); setFilterNeedsAction(false) }}><span className="material-symbols-outlined text-[13px]">close</span></span>
                    : <span className="material-symbols-outlined text-[13px]">expand_more</span>}
                </button>
                {isOpen && chipDropPos && createPortal(
                  <div ref={chipDropRef} className="w-48 bg-white border border-black/[0.08] rounded-xl shadow-lg overflow-hidden" style={{ position: 'fixed', top: chipDropPos.top, left: chipDropPos.left, zIndex: 9999 }}>
                    <div className="px-3 py-2 border-b border-black/[0.05] flex gap-3">
                      <button className="text-[11px] font-semibold text-primary" onClick={() => { setFilterStatus(['Active', 'Voided', 'Amended']); setFilterFlagged(true); setFilterNeedsAction(true) }}>All</button>
                      <button className="text-[11px] font-semibold text-on-surface-variant/50" onClick={() => { setFilterStatus([]); setFilterFlagged(false); setFilterNeedsAction(false) }}>Clear</button>
                    </div>
                    <div className="py-1">
                      {(['Active', 'Needs Action', 'Flagged', 'Amended', 'Voided'] as string[]).map(opt => {
                        const isChecked = opt === 'Flagged' ? filterFlagged : opt === 'Needs Action' ? filterNeedsAction : filterStatus.includes(opt)
                        return (
                          <label key={opt} className="flex items-center gap-2.5 px-3 py-2 hover:bg-surface-container-low/50 cursor-pointer"
                            onClick={() => { if (opt === 'Flagged') setFilterFlagged(!filterFlagged); else if (opt === 'Needs Action') setFilterNeedsAction(!filterNeedsAction); else setFilterStatus(filterStatus.includes(opt) ? filterStatus.filter(s => s !== opt) : [...filterStatus, opt]) }}>
                            <div className={`w-4 h-4 rounded-[4px] border-2 flex items-center justify-center transition-colors flex-shrink-0 ${isChecked ? 'bg-primary border-primary' : 'border-outline-variant/40'}`}>
                              {isChecked && <span className="material-symbols-outlined text-[10px] text-on-primary" style={{ fontVariationSettings: "'FILL' 1, 'wght' 700" }}>check</span>}
                            </div>
                            <span className={`text-[13px] select-none ${opt === 'Needs Action' ? 'text-amber-600' : opt === 'Flagged' ? 'text-red-600' : 'text-on-surface'}`}>{opt}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>, document.body
                )}
              </div>
            )
          })()}

          {/* Search */}
          <div className="relative">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[15px] text-on-surface-variant/40 pointer-events-none">search</span>
            <input type="text" placeholder="Search…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} autoComplete="new-password"
              className="h-8 pl-8 pr-3 w-32 focus:w-52 transition-[width] duration-200 rounded-full border border-outline-variant/25 bg-white text-[12px] text-on-surface outline-none focus:border-primary/30 focus:ring-1 focus:ring-primary/10" />
          </div>

          <button onClick={exportCSV} className="hidden md:flex items-center gap-1.5 h-8 px-3 rounded-full border border-outline-variant/25 bg-white text-[12px] font-medium text-on-surface-variant/55 hover:border-outline-variant/50 hover:text-on-surface/75 transition-all shrink-0">
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>download</span>Export
          </button>

          {hasAnyFilter && <button onClick={clearAllFilters} className="ml-auto text-[12px] font-medium text-on-surface-variant/45 hover:text-error transition-colors whitespace-nowrap">Clear all</button>}
        </div>

        {/* Mobile cards */}
        <div className="md:hidden">
          {isLoading ? <div className="py-2"><PageSkeleton /></div>
          : isError ? (
            <div className="py-20 text-center">
              <span className="material-symbols-outlined text-[56px] text-on-surface-variant/15 block mb-4">error_outline</span>
              <p className="text-[15px] font-medium text-on-surface/50">Failed to load transactions</p>
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="py-20 text-center">
              <span className="material-symbols-outlined text-[56px] text-on-surface-variant/15 block mb-4">{hasAnyFilter ? 'search_off' : 'receipt_long'}</span>
              <p className="text-[15px] font-medium text-on-surface/50">No transactions found</p>
              {hasAnyFilter && <button onClick={clearAllFilters} className="mt-5 h-11 px-5 rounded-full border border-outline-variant/30 text-[13px] font-medium text-on-surface-variant/60">Clear filters</button>}
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {filteredTransactions.slice(0, visibleCount).map((txn: any) => {
                  const txnDate = new Date(txn.date)
                  const isCurrentYear = txnDate.getFullYear() === new Date().getFullYear()
                  const dateStr = txnDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(!isCurrentYear ? { year: 'numeric' } : {}) })
                  const type = getTxnType(txn)
                  const typeColors: Record<string, string> = { 'Worker Payment': 'bg-blue-50 text-blue-600', 'Material Purchase': 'bg-amber-50 text-amber-600', 'General Expense': 'bg-slate-100 text-slate-500' }
                  return (
                    <div key={txn.txn_id} className={`bg-white rounded-xl border border-black/[0.06] p-3 cursor-pointer bk-row-ripple ${txn.status === 'Voided' ? 'opacity-50' : ''}`} onClick={() => navigate(`/ledger/${txn.txn_id}`, { state: { from: 'project', projectId, projectName: project?.name } })}>
                      <div className="flex items-start justify-between mb-1.5">
                        <span className="text-[15px] font-[500] text-on-surface leading-tight line-clamp-1 flex-1 mr-3">{formatTxn(txn, 'global').primary}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          {getNeedsAction(txn) && <span className="material-symbols-outlined text-amber-400 text-[13px]">link_off</span>}
                          <span className="text-[15px] font-bold font-data-mono text-on-surface">₹{Number(txn.total_amount).toLocaleString('en-IN')}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${typeColors[type] ?? 'bg-surface-container text-on-surface'}`}>{type}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] text-on-surface-variant">{dateStr}{txn.payment_mode ? ` · ${txn.payment_mode}` : ''}</span>
                        {statusBadge(txn)}
                      </div>
                    </div>
                  )
                })}
              </div>
              {filteredTransactions.length > visibleCount && (
                <button onClick={() => setVisibleCount(c => c + PAGE_SIZE)} className="w-full mt-3 py-3 rounded-xl border border-outline-variant/30 text-[13px] font-semibold text-primary">
                  Load more ({filteredTransactions.length - visibleCount} remaining)
                </button>
              )}
            </>
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block bg-white rounded-2xl border border-black/[0.06] shadow-sm overflow-hidden">
          {isLoading ? <div className="py-2"><PageSkeleton /></div>
          : isError ? (
            <div className="py-20 text-center">
              <span className="material-symbols-outlined text-[56px] text-on-surface-variant/15 block mb-4">error_outline</span>
              <p className="text-[15px] font-medium text-on-surface/50">Failed to load transactions</p>
              <p className="text-[12px] text-on-surface-variant/35 mt-1.5">There was a problem fetching data</p>
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="py-20 text-center">
              <span className="material-symbols-outlined text-[56px] text-on-surface-variant/15 block mb-4">{hasAnyFilter ? 'search_off' : 'receipt_long'}</span>
              <p className="text-[15px] font-medium text-on-surface/50">No transactions found</p>
              {hasAnyFilter && (
                <>
                  <p className="text-[12px] text-on-surface-variant/35 mt-1.5">Try adjusting your filters</p>
                  <button onClick={clearAllFilters} className="mt-5 h-8 px-4 rounded-full border border-outline-variant/30 text-[12px] font-medium text-on-surface-variant/60 hover:border-primary/30 hover:text-primary transition-colors">Clear filters</button>
                </>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse min-w-[780px]">
                <thead>
                  <tr className="border-b border-black/[0.06] bg-surface-container-low/30">
                    <th className="w-10 px-3 py-3 align-middle">
                      <div className="flex flex-col items-center gap-1">
                        <input type="checkbox" checked={allVisibleSelected} ref={el => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected }} onChange={toggleAllVisible} className="w-3.5 h-3.5 rounded border-outline-variant/50 text-primary focus:ring-primary cursor-pointer" />
                        {selectedCount > 0 && <span className="text-[9px] font-bold text-primary">{selectedCount}</span>}
                      </div>
                    </th>
                    <th className={thSort} onClick={() => toggleSort('date')}><div className="flex items-center gap-1">Date {renderSortIcon('date')}</div></th>
                    <th className={thSort} onClick={() => toggleSort('stakeholder')}><div className="flex items-center gap-1">Payee {renderSortIcon('stakeholder')}</div></th>
                    <th className={thCls}>Trade</th>
                    <th className={thSort} onClick={() => toggleSort('type')}><div className="flex items-center gap-1">Type {renderSortIcon('type')}</div></th>
                    <th className={thCls}>Remarks</th>
                    <th className={`${thSort} text-right`} onClick={() => toggleSort('total_amount')}><div className="flex items-center justify-end gap-1">Amount {renderSortIcon('total_amount')}</div></th>
                    <th className="w-12 px-3 py-3 text-center"><IconPaperclip size={13} className="opacity-35 mx-auto" /></th>
                    <th className={thSort} onClick={() => toggleSort('status')}><div className="flex items-center gap-1">Status {renderSortIcon('status')}</div></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(({ txn, alloc, isFirstInGroup, groupSize }, idx) => {
                    const isSplit = groupSize > 1
                    const rowAmount = alloc ? Number(alloc.allocated_amount) : Number(txn.total_amount)
                    const isChecked = selectedTxnIds.has(txn.txn_id)
                    const txnType = getTxnType(txn)
                    const splitAccentCls = isSplit ? txnType === 'Worker Payment' ? 'border-l-2 border-l-blue-200' : txnType === 'Material Purchase' ? 'border-l-2 border-l-amber-200' : 'border-l-2 border-l-slate-200' : ''
                    const txnDate = new Date(txn.date)
                    const isCurrentYear = txnDate.getFullYear() === new Date().getFullYear()
                    const dateStr = txnDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(!isCurrentYear ? { year: 'numeric' } : {}) })
                    const tradeLabel = txn.stakeholders?.category || ''
                    const proofUrl = txn.proof_document_url || txn.bill_doc_url || null

                    return (
                      <tr key={`${txn.txn_id}-${alloc?.allocation_id ?? 'none'}-${idx}`}
                        className={`border-b border-black/[0.04] last:border-0 hover:bg-surface-container-low/40 transition-colors cursor-pointer bk-row-ripple ${splitAccentCls} ${isChecked ? 'bg-primary/[0.02]' : ''} ${txn.status === 'Voided' ? 'opacity-40' : ''} ${!isFirstInGroup ? 'bg-surface-container-lowest/60' : ''}`}
                        style={{ height: '52px' }}
                        onClick={() => navigate(`/ledger/${txn.txn_id}`, { state: { from: 'project', projectId, projectName: project?.name } })}>
                        <td className="px-3 align-middle w-10" onClick={e => e.stopPropagation()}>
                          {isFirstInGroup && <input type="checkbox" checked={isChecked} onChange={() => toggleTxn(txn.txn_id)} className="w-3.5 h-3.5 rounded border-outline-variant/50 text-primary focus:ring-primary cursor-pointer" />}
                        </td>
                        <td className="px-4 align-middle">
                          {isFirstInGroup && <span className="text-[13px] text-on-surface/80 font-medium whitespace-nowrap">{dateStr}</span>}
                        </td>
                        <td className="px-4 align-middle">
                          {isFirstInGroup && (
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[13px] font-medium text-on-surface truncate">{txn.stakeholders?.name || '—'}</span>
                              <div className="flex items-center gap-1 shrink-0">
                                {txn.bill_doc_url && <span className="material-symbols-outlined text-[12px] text-on-surface-variant/30">attachment</span>}
                                {txn.remarks && <span className="material-symbols-outlined text-[12px] text-on-surface-variant/30">notes</span>}
                                {isSplit && <span className="text-[10px] font-bold text-primary/50 bg-primary/5 px-1.5 py-0.5 rounded-full leading-none">SPLIT</span>}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-4 align-middle">
                          {isFirstInGroup && tradeLabel && <span className="text-[12px] text-on-surface-variant/55 whitespace-nowrap">{tradeLabel}</span>}
                        </td>
                        <td className="px-4 align-middle">
                          {isFirstInGroup && typeBadge(txn)}
                        </td>
                        <td className="px-4 align-middle max-w-[220px]">
                          {isFirstInGroup && txn.remarks ? (
                            <span className="text-[12px] text-on-surface-variant/55 leading-snug line-clamp-2" title={txn.remarks}>
                              {txn.remarks}
                            </span>
                          ) : (
                            isFirstInGroup && <span className="text-[12px] text-on-surface-variant/25">—</span>
                          )}
                        </td>
                        <td data-cell-select="true"
                          className={`px-4 align-middle text-right cursor-cell select-none transition-colors ${selectedRows.has(idx) ? 'bg-primary/5 text-primary' : ''}`}
                          onMouseDown={(e) => { e.stopPropagation(); setIsDragging(true); setSelectedRows(new Set([idx])) }}
                          onMouseEnter={() => { if (isDragging) setSelectedRows(prev => new Set(prev).add(idx)) }}
                          onClick={(e) => e.stopPropagation()}>
                          <span className="text-[14px] font-bold font-data-mono text-on-surface">₹{rowAmount.toLocaleString('en-IN')}</span>
                        </td>
                        <td className="px-3 align-middle w-12 text-center" onClick={(e) => e.stopPropagation()}>
                          {isFirstInGroup && proofUrl && (
                            <img src={proofUrl} alt="proof" className="w-8 h-8 rounded-md object-cover cursor-pointer border border-black/[0.08] hover:opacity-80 transition-opacity mx-auto" onClick={(e) => { e.stopPropagation(); setLightboxUrl(proofUrl) }} />
                          )}
                        </td>
                        <td className="px-4 align-middle">
                          {isFirstInGroup && statusBadge(txn)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!isLoading && sortedRows.length > visibleCount && (
            <div className="px-6 py-4 border-t border-black/[0.04] flex items-center justify-between bg-surface-container-lowest/30">
              <span className="text-[12px] text-on-surface-variant/40">Showing {Math.min(visibleCount, sortedRows.length)} of {sortedRows.length}</span>
              <button onClick={() => setVisibleCount(c => c + PAGE_SIZE)} className="text-[12px] font-semibold text-primary hover:underline">Load more</button>
            </div>
          )}
        </div>

      </div>

      {/* Amount drag selection stats */}
      {selectedRows.size > 1 && selectedCount === 0 && (
        <div className="fixed bottom-4 right-4 bg-white/95 backdrop-blur-sm border border-outline-variant/20 rounded-xl shadow-lg p-3 flex gap-6 z-50 animate-in slide-in-from-bottom-4">
          <div className="flex flex-col"><span className="text-[10px] font-bold text-on-surface-variant/50 uppercase">Count</span><span className="font-data-mono font-bold text-[15px]">{selectedRows.size}</span></div>
          <div className="flex flex-col"><span className="text-[10px] font-bold text-on-surface-variant/50 uppercase">Avg</span><span className="font-data-mono font-bold text-[15px]">₹{avg.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span></div>
          <div className="flex flex-col"><span className="text-[10px] font-bold text-on-surface-variant/50 uppercase">Sum</span><span className="font-data-mono font-bold text-[15px] text-primary">₹{sum.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span></div>
        </div>
      )}

      <ImageLightbox url={lightboxUrl} title="Payment Proof" onClose={() => setLightboxUrl(null)} />

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pb-4 px-4 pointer-events-none">
          <div className="pointer-events-auto bg-on-surface/95 backdrop-blur-sm text-surface rounded-2xl shadow-2xl px-5 py-3 flex items-center gap-3 flex-wrap animate-in slide-in-from-bottom-4 duration-200">
            <span className="text-[13px] font-semibold whitespace-nowrap text-surface/90">{selectedCount} selected</span>
            <div className="w-px h-5 bg-surface/20" />
            <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold bg-surface/10 hover:bg-surface/20 transition-colors">
              <span className="material-symbols-outlined text-[16px]">download</span>Export CSV
            </button>
            <button onClick={() => { setRecatCategory(''); setShowRecategorize(true) }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold bg-surface/10 hover:bg-surface/20 transition-colors">
              <span className="material-symbols-outlined text-[16px]">category</span>Re-categorize
            </button>
            {(profile?.role === 'management' || profile?.role === 'accountant') && voidableSelected.length > 0 && (
              <button onClick={() => setShowVoidAll(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold bg-error/80 hover:bg-error transition-colors text-white">
                <span className="material-symbols-outlined text-[16px]">block</span>Void All
              </button>
            )}
            <button onClick={() => setSelectedTxnIds(new Set())} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[12px] font-bold hover:bg-surface/10 transition-colors ml-1 text-surface/60 hover:text-surface">
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        </div>
      )}

      {/* Re-categorize modal */}
      {showRecategorize && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowRecategorize(false)}>
          <div className="bg-surface-container-lowest rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <h3 className="text-headline-sm font-bold mb-1">Re-categorize {selectedCount} transaction{selectedCount !== 1 ? 's' : ''}</h3>
            {selectedCategories.length > 1
              ? <p className="text-body-sm text-on-surface-variant mb-4"><span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded text-[11px] font-bold mr-1"><span className="material-symbols-outlined text-[13px]">warning</span>Mixed types</span>Current: <span className="font-semibold">{selectedCategories.join(', ')}</span></p>
              : <p className="text-body-sm text-on-surface-variant mb-4">Current: <span className="font-semibold">{selectedCategories[0] || '—'}</span></p>}
            <div className="space-y-2 mb-5">
              <label className="text-label-caps font-label-caps text-on-surface-variant">NEW CATEGORY</label>
              <select value={recatCategory} onChange={e => setRecatCategory(e.target.value)} className="bk-input w-full">
                <option value="">Select category…</option>
                {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowRecategorize(false)} className="bk-btn-ghost px-4 py-2 rounded-xl text-body-sm">Cancel</button>
              <button disabled={!recatCategory || recatMutation.isPending} onClick={() => recatMutation.mutate({ ids: Array.from(selectedTxnIds), category: recatCategory })} className="bk-btn px-4 py-2 rounded-xl text-body-sm disabled:opacity-50">
                {recatMutation.isPending ? 'Applying…' : `Apply to all ${selectedCount}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Void all modal */}
      {showVoidAll && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowVoidAll(false)}>
          <div className="bg-surface-container-lowest rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-error-container flex items-center justify-center shrink-0"><span className="material-symbols-outlined text-error">block</span></div>
              <div>
                <h3 className="text-headline-sm font-bold">Void {voidableSelected.length} transaction{voidableSelected.length !== 1 ? 's' : ''}?</h3>
                <p className="text-body-sm text-on-surface-variant mt-1">This cannot be undone.</p>
              </div>
            </div>
            {hasAmendedSelected && (
              <div className="mb-4 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-amber-800 text-[12px]">
                <span className="material-symbols-outlined text-[16px]">warning</span>Some transactions have amendments — voiding will also void their amendments.
              </div>
            )}
            <div className="mb-5 max-h-40 overflow-y-auto bg-surface-container-low rounded-xl border border-outline-variant/30 p-3 space-y-1">
              {voidableSelected.map((t: any) => (
                <div key={t.txn_id} className="flex items-center justify-between text-body-sm">
                  <span className="font-data-mono">{t.txn_id}</span>
                  <span className="text-on-surface-variant text-[12px]">₹{Number(t.total_amount).toLocaleString('en-IN')}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowVoidAll(false)} className="bk-btn-ghost px-4 py-2 rounded-xl text-body-sm">Cancel</button>
              <button disabled={voidAllMutation.isPending} onClick={() => voidAllMutation.mutate(voidableSelected.map((t: any) => t.txn_id))} className="px-4 py-2 rounded-xl text-body-sm font-bold bg-error text-on-error hover:bg-error/90 transition-colors disabled:opacity-50">
                {voidAllMutation.isPending ? 'Voiding…' : `Void ${voidableSelected.length}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
