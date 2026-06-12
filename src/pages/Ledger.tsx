import { useState, useRef, useEffect, type ReactNode, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { usePeek } from '../context/PeekContext';
import type { Stakeholder, Project } from '../types';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import { useSnackbar } from '../components/Snackbar';
import { getCostCode } from '../lib/costCodes';
import { Plus, Search, Download, Paperclip } from 'lucide-react';
import { ShortcutTicker } from '../components/ShortcutTicker';
import { ImageLightbox } from '../components/ImageLightbox';
import { PageSkeleton } from '../components/SkeletonLoader';
import { deriveDirection, isNotLinked, resolveAnchor, type TxnAnchor, type TxnDirection } from '../lib/transactions';
import { V, font, serif, nums, terraGrad } from '../components/txn-ledger/ledgerTokens';
import { DirMedallion, Amount, AnchorChip, FilterChip, FlowBar } from '../components/txn-ledger/LedgerAtoms';

const PAGE_SIZE = 25;
const inr = (n: number) => Math.round(n).toLocaleString('en-IN');

function CreateHint({ message, children }: { message: string; children: ReactNode }) {
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => { timer.current = setTimeout(() => setShow(true), 300); }}
      onMouseLeave={() => { if (timer.current) clearTimeout(timer.current); setShow(false); }}
    >
      {children}
      {show && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none whitespace-nowrap">
          <div style={{ background: 'rgba(11,28,48,0.88)', color: 'white', fontSize: 11, padding: '6px 10px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
            <span style={{ fontFamily: 'monospace', fontSize: 10, border: '1px solid rgba(255,255,255,0.2)', borderRadius: 4, padding: '1px 5px', lineHeight: 1, color: 'rgba(255,255,255,0.6)' }}>/</span>
            <span style={{ color: 'rgba(255,255,255,0.8)' }}>{message}</span>
          </div>
          <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '5px solid rgba(11,28,48,0.88)' }} />
        </div>
      )}
    </div>
  );
}

/* ---------- the entry: machine-set, threaded on the spine ---------- */

type EntryProps = {
  dir: TxnDirection;
  payee: string;
  context: string;
  anchor: TxnAnchor;
  remark: string | null;
  amount: string;
  attach: boolean;
  voided: boolean;
  flagged: boolean;
  selected: boolean;
  selectionMode: boolean;
  sumSelected: boolean;
  onRowClick: () => void;
  onToggleSelect: (e: MouseEvent) => void;
  onAnchorClick: (e: MouseEvent) => void;
  onAmountDown: (e: MouseEvent) => void;
  onAmountEnter: () => void;
  onAttach?: (e: MouseEvent) => void;
};

function EntryRow(p: EntryProps) {
  const [hover, setHover] = useState(false);
  const showCheck = p.selectionMode || hover;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={p.onRowClick}
      className="grid items-center gap-3 px-4 rounded-xl relative cursor-pointer"
      style={{
        gridTemplateColumns: '28px minmax(0,1.4fr) minmax(0,1.6fr) 24px 130px',
        height: 56,
        background: p.sumSelected ? V.terraWash : hover ? V.field : 'transparent',
        opacity: p.voided ? 0.45 : 1,
        transition: 'background .15s',
      }}
    >
      {/* hover-revealed bulk checkbox in the left gutter */}
      <button
        type="button"
        onClick={p.onToggleSelect}
        aria-label={p.selected ? 'Deselect' : 'Select'}
        className="absolute flex items-center justify-center rounded"
        style={{
          left: 1, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14,
          border: `1.5px solid ${p.selected ? V.terra : V.line}`,
          background: p.selected ? V.terra : V.surface,
          opacity: showCheck ? 1 : 0, transition: 'opacity .15s', zIndex: 2,
        }}
      >
        {p.selected && <span style={{ color: '#fff', fontSize: 9, lineHeight: 1 }}>✓</span>}
      </button>

      <DirMedallion dir={p.dir} />

      <div className="min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: V.ink, ...font }}>
          {p.payee}
          {p.voided && <span className="ml-1.5 text-xs" style={{ color: V.faint, ...font }}>· voided</span>}
        </p>
        <p className="text-xs truncate" style={{ color: V.faint, ...font }}>{p.context}</p>
      </div>

      <div className="min-w-0 flex items-center gap-2">
        <AnchorChip anchor={p.anchor} onClick={(e) => { e.stopPropagation(); p.onAnchorClick(e); }} />
        {p.flagged && (
          <span className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: V.askWash, border: `1px solid ${V.askLine}`, color: V.ask, ...font }}>flagged</span>
        )}
        {p.remark && <span className="text-xs truncate" style={{ color: V.sys, ...font }}>{p.remark}</span>}
      </div>

      <span className="flex justify-center">
        {p.attach && (
          <button type="button" onClick={(e) => { e.stopPropagation(); p.onAttach?.(e); }} aria-label="Attachment">
            <Paperclip size={13} style={{ color: V.faint }} />
          </button>
        )}
      </span>

      <div
        data-cell-select
        onMouseDown={(e) => { e.stopPropagation(); p.onAmountDown(e); }}
        onMouseEnter={p.onAmountEnter}
        style={{ userSelect: 'none' }}
      >
        <Amount dir={p.dir} value={p.amount} />
      </div>
    </div>
  );
}

export default function Ledger({ session }: { session: Session }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { openPeek } = usePeek();
  const [searchParams] = useSearchParams();
  const { data: profile } = useUserProfile(session.user.id);

  type DatePreset = 'today' | 'week' | 'month' | 'last_month' | 'quarter' | 'fy' | 'all' | 'custom';
  const [filterFlagged] = useState(() => searchParams.get('flagged') === 'true');
  const [filterNeedsAction] = useState(() => searchParams.get('needs_action') === 'true');
  const [filterUnlinked, setFilterUnlinked] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterProject, setFilterProject] = useState<string[]>([]);
  const [filterType, setFilterType] = useState<string[]>([]);
  const [activeFilterDropdown, setActiveFilterDropdown] = useState<string | null>(null);
  const [chipDropPos, setChipDropPos] = useState<{ top: number; left: number } | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>('month');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Direction-aware drag-to-sum: a Set of txn_ids the accountant rubber-bands.
  const [sumSel, setSumSel] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);

  const [selectedTxnIds, setSelectedTxnIds] = useState<Set<string>>(new Set());
  const [showRecategorize, setShowRecategorize] = useState(false);
  const [showVoidAll, setShowVoidAll] = useState(false);
  const [recatCategory, setRecatCategory] = useState('');

  const ALL_CATEGORIES = ['Advance', 'Running Bill', 'Final Settlement', 'Retention Release',
    'Material Supply', 'PO Advance', 'PO Settlement', 'Transport & Handling',
    'Site Overhead', 'Labour Welfare', 'Tools & Equipment', 'Professional Fees', 'Utilities', 'Other'];

  const { data: ledger, isLoading } = useQuery({
    queryKey: ['ledger'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*, stakeholders(name, type, category), txn_allocations(project_id, allocated_amount, order_type, order_ref, projects(name))')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const { data: _stakeholders } = useQuery({ queryKey: ['stakeholders'], queryFn: async () => { const { data } = await supabase.from('stakeholders').select('*'); return data as Stakeholder[]; } });
  const { data: _projects } = useQuery({ queryKey: ['projects'], queryFn: async () => { const { data } = await supabase.from('projects').select('*'); return data as Project[]; } });

  const { show: showSnackbar } = useSnackbar();

  const voidAllMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('transactions').update({ status: 'Voided', voided_by: session.user.id, voided_at: new Date().toISOString() }).in('txn_id', ids);
      if (error) throw error;
    },
    onSuccess: (_d, ids) => {
      qc.invalidateQueries({ queryKey: ['ledger'] }); setSelectedTxnIds(new Set()); setShowVoidAll(false);
      showSnackbar(`${ids.length} transaction${ids.length !== 1 ? 's' : ''} voided`);
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to void', { type: 'error' }),
  });

  const recatMutation = useMutation({
    mutationFn: async ({ ids, category }: { ids: string[]; category: string }) => {
      const { error } = await supabase.from('transactions').update({ category }).in('txn_id', ids);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ledger'] }); setSelectedTxnIds(new Set()); setShowRecategorize(false); setRecatCategory(''); showSnackbar('Category updated'); },
    onError: (err: any) => showSnackbar(err.message || 'Failed to update', { type: 'error' }),
  });

  const filterBarRef = useRef<HTMLDivElement>(null);
  const chipDropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: globalThis.MouseEvent) => {
      const t = e.target as Node;
      if (
        (filterBarRef.current && !filterBarRef.current.contains(t)) &&
        (!chipDropRef.current || !chipDropRef.current.contains(t))
      ) setActiveFilterDropdown(null);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => {
    const h = () => setActiveFilterDropdown(null);
    window.addEventListener('scroll', h, true);
    return () => window.removeEventListener('scroll', h, true);
  }, []);

  // drag-to-sum: end on mouseup, clear when clicking away from an amount cell
  useEffect(() => {
    const handleMouseUp = () => setIsDragging(false);
    const handleClickOutside = (e: globalThis.MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-cell-select]')) setSumSel(new Set());
    };
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousedown', handleClickOutside);
    return () => { window.removeEventListener('mouseup', handleMouseUp); window.removeEventListener('mousedown', handleClickOutside); };
  }, []);

  useEffect(() => {
    setSelectedTxnIds(new Set());
    setVisibleCount(PAGE_SIZE);
  }, [searchTerm, filterProject, filterType, datePreset, filterFlagged, filterNeedsAction, filterUnlinked]);

  useEffect(() => {
    const handler = () => navigate('/ledger/new');
    window.addEventListener('shortcut:new-transaction', handler);
    return () => window.removeEventListener('shortcut:new-transaction', handler);
  }, [navigate]);

  const MATERIAL_CATEGORIES_LEGACY = ['Material Supply', 'PO Advance', 'PO Settlement', 'Transport & Handling'];

  const getNeedsAction = (txn: any): 'link_wo' | 'link_po' | false => {
    if (txn.status === 'Voided') return false;
    const stkType = txn.stakeholders?.type;
    if (stkType !== 'Worker' && stkType !== 'Vendor') return false;
    const allocs = txn.txn_allocations || [];
    if (allocs.length === 0) return false;
    const hasUnlinked = allocs.some((a: any) => !a.order_type);
    if (!hasUnlinked) return false;
    return stkType === 'Worker' ? 'link_wo' : 'link_po';
  };

  const getTxnType = (txn: any): string => {
    if (deriveDirection(txn) === 'in') return 'Client Receipt';
    if (txn.stakeholders?.type === 'Worker') return 'Worker Payment';
    if (txn.stakeholders?.type === 'Vendor') {
      const cc = getCostCode(txn.category);
      if (cc?.division.type === 'MAT') return 'Material Purchase';
      if (MATERIAL_CATEGORIES_LEGACY.includes(txn.category)) return 'Material Purchase';
    }
    return 'General Expense';
  };

  const getDateRange = (preset: DatePreset): { from: Date | null; to: Date | null } => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    switch (preset) {
      case 'today': return { from: today, to: today };
      case 'week': { const mon = new Date(today); mon.setDate(today.getDate() - ((today.getDay() + 6) % 7)); return { from: mon, to: today }; }
      case 'month': return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: new Date(today.getFullYear(), today.getMonth() + 1, 0) };
      case 'last_month': return { from: new Date(today.getFullYear(), today.getMonth() - 1, 1), to: new Date(today.getFullYear(), today.getMonth(), 0) };
      case 'quarter': { const qm = Math.floor(today.getMonth() / 3) * 3; return { from: new Date(today.getFullYear(), qm, 1), to: new Date(today.getFullYear(), qm + 3, 0) }; }
      case 'fy': { const fyY = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1; return { from: new Date(fyY, 3, 1), to: new Date(fyY + 1, 2, 31) }; }
      case 'custom': return { from: null, to: null };
      default: return { from: null, to: null };
    }
  };

  const activeDateRange = getDateRange(datePreset);

  const periodLabel = (() => {
    const now = new Date();
    if (datePreset === 'all') return 'All time';
    if (datePreset === 'today') return 'Today';
    if (datePreset === 'week') return 'This week';
    if (datePreset === 'month') return now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    if (datePreset === 'last_month') { const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1); return lm.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); }
    if (datePreset === 'quarter') return 'This quarter';
    if (datePreset === 'fy') { const fyY = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; return `FY ${fyY}-${String(fyY + 1).slice(2)}`; }
    return 'Custom';
  })();

  // ── Filtering (per transaction; project filter matches any allocation) ───────
  const passesBase = (txn: any): boolean => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = !term || txn.txn_id.toLowerCase().includes(term) || txn.stakeholders?.name?.toLowerCase().includes(term) || txn.category?.toLowerCase().includes(term) || (txn.remarks || '').toLowerCase().includes(term);
    const matchesFlagged = filterFlagged ? txn.ai_flag_status === 'Flagged' : true;
    const matchesNeedsAction = filterNeedsAction ? !!getNeedsAction(txn) : true;
    const matchesType = filterType.length ? filterType.includes(getTxnType(txn)) : true;
    const matchesProject = filterProject.length ? (txn.txn_allocations || []).some((a: any) => filterProject.includes(a.projects?.name || '')) : true;
    const matchesDate = (() => {
      const { from, to } = activeDateRange;
      if (!from || !to) return true;
      const d = new Date(txn.date); d.setHours(0, 0, 0, 0);
      return d >= from && d <= to;
    })();
    return matchesSearch && matchesFlagged && matchesNeedsAction && matchesType && matchesProject && matchesDate;
  };

  const baseRows = (ledger || []).filter(passesBase);
  const unlinkedCount = baseRows.filter(isNotLinked).length;
  const filteredTransactions = filterUnlinked ? baseRows.filter(isNotLinked) : baseRows;

  // ── Aggregations over the FULL filtered set (never the visible slice) ────────
  let monthOut = 0, monthIn = 0;
  for (const t of filteredTransactions) {
    if (deriveDirection(t) === 'in') monthIn += Number(t.total_amount); else monthOut += Number(t.total_amount);
  }
  const monthTotal = monthIn + monthOut;
  const outPct = monthTotal > 0 ? (monthOut / monthTotal) * 100 : 0;
  const monthNet = monthIn - monthOut;
  const netLabel = `${monthNet < 0 ? '−' : '+'} ₹${inr(Math.abs(monthNet))}`;

  const sortedTxns = [...filteredTransactions].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (a.created_at || '') < (b.created_at || '') ? 1 : -1;
  });

  const dayTotals = new Map<string, { out: number; in: number }>();
  for (const t of sortedTxns) {
    const cur = dayTotals.get(t.date) ?? { out: 0, in: 0 };
    if (deriveDirection(t) === 'in') cur.in += Number(t.total_amount); else cur.out += Number(t.total_amount);
    dayTotals.set(t.date, cur);
  }

  const visibleTxns = sortedTxns.slice(0, visibleCount);
  const visibleDays: { date: string; rows: any[] }[] = [];
  for (const t of visibleTxns) {
    const last = visibleDays[visibleDays.length - 1];
    if (!last || last.date !== t.date) visibleDays.push({ date: t.date, rows: [t] });
    else last.rows.push(t);
  }

  // ── Selection / bulk ─────────────────────────────────────────────────────────
  const selectedCount = selectedTxnIds.size;

  const toggleTxn = (id: string) => {
    setSelectedTxnIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const selectedTxns = (ledger || []).filter(t => selectedTxnIds.has(t.txn_id));
  const selectedCategories = Array.from(new Set(selectedTxns.map((t: any) => t.category).filter(Boolean))) as string[];
  const hasAmendedSelected = selectedTxns.some((t: any) => (t as any).amendments?.length > 0);
  const voidableSelected = selectedTxns.filter((t: any) => t.status !== 'Voided');

  // ── Drag-to-sum, direction-aware ────────────────────────────────────────────
  const sumRows = (ledger || []).filter((t: any) => sumSel.has(t.txn_id));
  let sumOut = 0, sumIn = 0;
  for (const t of sumRows) { if (deriveDirection(t) === 'in') sumIn += Number(t.total_amount); else sumOut += Number(t.total_amount); }
  const sumNet = sumIn - sumOut;

  const exportCSV = () => {
    const txnsToExport = selectedCount > 0 ? selectedTxns : filteredTransactions;
    const rows = txnsToExport.flatMap((t: any) => {
      const allocs: any[] = t.txn_allocations || [];
      const dir = deriveDirection(t);
      if (allocs.length === 0) return [[t.txn_id, t.date, t.stakeholders?.name || '', getTxnType(t), dir, t.category || '', t.payment_mode || '', t.total_amount, '', t.status]];
      return allocs.map((a: any) => [t.txn_id, t.date, t.stakeholders?.name || '', getTxnType(t), dir, t.category || '', t.payment_mode || '', t.total_amount, a.projects?.name || '', t.status]);
    });
    const header = ['TXN ID', 'Date', 'Payee', 'Type', 'Direction', 'Category', 'Mode', 'Amount', 'Project', 'Status'];
    const csv = [header, ...rows].map(r => r.map((v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `briklay-transactions-${new Date().toISOString().split('T')[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const uniqueProjects = Array.from(new Set((ledger || []).flatMap((t: any) => (t.txn_allocations || []).map((a: any) => a.projects?.name).filter(Boolean)))) as string[];
  const uniqueTypes = ['Worker Payment', 'Material Purchase', 'General Expense', 'Client Receipt'];

  // ── Filter chip + dropdown (reference look, multi-select body) ───────────────
  const openDrop = (key: string, e: MouseEvent) => {
    if (activeFilterDropdown === key) { setActiveFilterDropdown(null); return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setChipDropPos({ top: rect.bottom + 6, left: rect.left });
    setActiveFilterDropdown(key);
  };

  const multiDropdown = (options: string[], current: string[], setFilter: (f: string[]) => void) =>
    chipDropPos && createPortal(
      <div ref={chipDropRef} className="rounded-xl overflow-hidden" style={{ position: 'fixed', top: chipDropPos.top, left: chipDropPos.left, zIndex: 9999, width: 220, background: V.surface, border: `1px solid ${V.line}`, boxShadow: '0 10px 30px rgba(30,26,21,0.12)' }}>
        <div className="px-3 py-2 flex gap-4" style={{ borderBottom: `1px solid ${V.line}` }}>
          <button className="text-xs font-semibold" style={{ color: V.terraDeep, ...font }} onClick={() => setFilter([...options])}>Select all</button>
          <button className="text-xs font-semibold" style={{ color: V.faint, ...font }} onClick={() => setFilter([])}>Clear</button>
        </div>
        <div className="py-1 max-h-60 overflow-y-auto">
          {options.length === 0 && <p className="px-3 py-2 text-xs" style={{ color: V.faint, ...font }}>None</p>}
          {options.map(opt => (
            <button key={opt} type="button" className="w-full flex items-center gap-2.5 px-3 py-2 text-left" style={{ ...font }}
              onClick={() => setFilter(current.includes(opt) ? current.filter(v => v !== opt) : [...current, opt])}>
              <span className="flex items-center justify-center rounded shrink-0" style={{ width: 16, height: 16, border: `1.5px solid ${current.includes(opt) ? V.terra : V.line}`, background: current.includes(opt) ? V.terra : 'transparent' }}>
                {current.includes(opt) && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
              </span>
              <span className="text-sm truncate" style={{ color: V.ink }}>{opt}</span>
            </button>
          ))}
        </div>
      </div>,
      document.body,
    );

  const datePresets: { k: DatePreset; label: string }[] = [
    { k: 'today', label: 'Today' }, { k: 'week', label: 'This week' }, { k: 'month', label: 'This month' },
    { k: 'last_month', label: 'Last month' }, { k: 'quarter', label: 'This quarter' }, { k: 'fy', label: 'Financial year' }, { k: 'all', label: 'All time' },
  ];

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: V.page, ...font }}>
      <div className="mx-auto px-5 sm:px-8 py-8" style={{ maxWidth: 880 }}>

        {/* header */}
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl" style={{ color: V.ink, ...serif }}>Transactions</h1>
            <p className="text-sm mt-2" style={{ color: V.sys, ...font, ...nums }}>
              {periodLabel} · {filteredTransactions.length} {filteredTransactions.length === 1 ? 'entry' : 'entries'}
            </p>
            <FlowBar inLabel={inr(monthIn)} outLabel={inr(monthOut)} net={netLabel} outPct={outPct} />
          </div>
          <div className="flex flex-col items-end gap-1">
            <CreateHint message="press / to create a new transaction">
              <button
                onClick={() => navigate('/ledger/new')}
                className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl"
                style={{ background: terraGrad, color: '#fff', ...font }}
              >
                <Plus size={15} /> New transaction
              </button>
            </CreateHint>
            <div className="hidden md:block">
              <ShortcutTicker hints={[
                { key: '/', label: 'new transaction' },
                { key: 'T', label: 'view transactions' },
                { key: 'P', label: 'view purchase orders' },
                { key: 'W', label: 'view work orders' },
                { key: 'L', label: 'view logbook' },
                { key: '⟵ hold', label: 'long press screen for quick actions' },
              ]} className="w-full" />
            </div>
          </div>
        </div>

        {/* filters */}
        <div ref={filterBarRef} className="flex items-center gap-2 flex-wrap mt-7">
          <FilterChip active onClick={(e: any) => openDrop('date', e)}>{periodLabel}</FilterChip>
          {activeFilterDropdown === 'date' && chipDropPos && createPortal(
            <div ref={chipDropRef} className="rounded-xl overflow-hidden py-1" style={{ position: 'fixed', top: chipDropPos.top, left: chipDropPos.left, zIndex: 9999, width: 200, background: V.surface, border: `1px solid ${V.line}`, boxShadow: '0 10px 30px rgba(30,26,21,0.12)' }}>
              {datePresets.map(d => (
                <button key={d.k} type="button" className="w-full text-left px-3 py-2 text-sm" style={{ color: datePreset === d.k ? V.terraDeep : V.ink, background: datePreset === d.k ? V.terraWash : 'transparent', ...font }}
                  onClick={() => { setDatePreset(d.k); setActiveFilterDropdown(null); }}>
                  {d.label}
                </button>
              ))}
            </div>,
            document.body,
          )}

          <FilterChip active={filterType.length > 0} onClick={(e: any) => openDrop('type', e)}>
            {filterType.length === 1 ? filterType[0] : filterType.length > 1 ? `Type: ${filterType.length}` : 'Type'}
          </FilterChip>
          {activeFilterDropdown === 'type' && multiDropdown(uniqueTypes, filterType, setFilterType)}

          <FilterChip active={filterProject.length > 0} onClick={(e: any) => openDrop('project', e)}>
            {filterProject.length === 1 ? filterProject[0] : filterProject.length > 1 ? `Project: ${filterProject.length}` : 'Project'}
          </FilterChip>
          {activeFilterDropdown === 'project' && multiDropdown(uniqueProjects, filterProject, setFilterProject)}

          {unlinkedCount > 0 && (
            <FilterChip tone="ask" active={filterUnlinked} onClick={() => setFilterUnlinked(v => !v)}>
              {unlinkedCount} not linked
            </FilterChip>
          )}

          <span className="flex-1" />

          <div className="inline-flex items-center gap-2 px-3 rounded-full" style={{ background: V.surface, border: `1px solid ${V.line}`, height: 36, minWidth: 200 }}>
            <Search size={14} style={{ color: V.faint }} />
            <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search payee, order, remark" className="bg-transparent text-sm outline-none flex-1" style={{ color: V.ink, ...font }} />
          </div>
          <button onClick={exportCSV} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full" style={{ background: V.surface, border: `1px solid ${V.line}`, color: V.inkSoft, ...font }}>
            <Download size={13} style={{ color: V.faint }} /> Export
          </button>
        </div>

        {/* the day-book */}
        {isLoading ? (
          <div className="mt-7"><PageSkeleton /></div>
        ) : visibleDays.length === 0 ? (
          <p className="text-sm text-center mt-16" style={{ color: V.faint, ...font }}>No transactions for this period.</p>
        ) : (
          visibleDays.map(day => {
            const tot = dayTotals.get(day.date) ?? { out: 0, in: 0 };
            const weekday = new Date(day.date).toLocaleDateString('en-IN', { weekday: 'long' });
            const dshort = new Date(day.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
            return (
              <section className="mt-7" key={day.date}>
                <p className="px-4 py-2 text-sm sticky top-0" style={{ background: V.page, color: V.ink, zIndex: 2, ...serif }}>
                  {dshort} <span className="text-xs" style={{ color: V.faint, ...font }}>· {weekday}</span>
                </p>
                <div className="rounded-2xl pt-1 overflow-hidden relative" style={{ background: V.surface, border: '1px solid #E3DDD4' }}>
                  {/* the spine: one thread of money through the day */}
                  <div aria-hidden="true" className="absolute" style={{ left: 29, top: 16, bottom: 64, width: 1, background: V.line }} />

                  {day.rows.map((txn: any) => {
                    const dir = deriveDirection(txn);
                    const primaryAlloc = (txn.txn_allocations || []).find((a: any) => a.order_type) ?? null;
                    const anchor: TxnAnchor = dir === 'in'
                      ? resolveAnchor(txn, null)
                      : isNotLinked(txn) ? null : resolveAnchor(txn, primaryAlloc);
                    const projName = (txn.txn_allocations || [])[0]?.projects?.name || null;
                    const trade = txn.stakeholders?.category || null;
                    const party = txn.stakeholders?.type || null;
                    const ctxParts = [party, trade];
                    if (!(filterProject.length === 1) && projName) ctxParts.push(projName);
                    const context = ctxParts.filter(Boolean).join(' · ');
                    const proofUrl = txn.bill_doc_url || (txn as any).proof_document_url || null;
                    return (
                      <EntryRow
                        key={txn.txn_id}
                        dir={dir}
                        payee={txn.stakeholders?.name || 'Unknown'}
                        context={context}
                        anchor={anchor}
                        remark={null}
                        amount={inr(Number(txn.total_amount))}
                        attach={!!proofUrl}
                        voided={txn.status === 'Voided'}
                        flagged={txn.ai_flag_status === 'Flagged' && txn.status !== 'Voided'}
                        selected={selectedTxnIds.has(txn.txn_id)}
                        selectionMode={selectedCount > 0}
                        sumSelected={sumSel.has(txn.txn_id)}
                        onRowClick={() => navigate(`/ledger/${txn.txn_id}`)}
                        onToggleSelect={(e) => { e.stopPropagation(); toggleTxn(txn.txn_id); }}
                        onAnchorClick={() => openPeek('TRANSACTION', txn.txn_id)}
                        onAttach={() => proofUrl && setLightboxUrl(proofUrl)}
                        onAmountDown={() => { setIsDragging(true); setSumSel(new Set([txn.txn_id])); }}
                        onAmountEnter={() => { if (isDragging) setSumSel(prev => new Set(prev).add(txn.txn_id)); }}
                      />
                    );
                  })}

                  {/* ruling off: the bookkeeper closes the day */}
                  <div className="flex items-baseline justify-between px-4 py-3 mt-1" style={{ borderTop: `1px solid ${V.line}` }}>
                    <p className="text-sm" style={{ color: V.inkSoft, ...serif, fontStyle: 'italic' }}>Day closed</p>
                    <div className="text-right">
                      <p className="text-sm" style={{ color: V.inkSoft, ...serif, ...nums }}>
                        <span style={{ color: V.terraDeep }}>− ₹{inr(tot.out)}</span>
                        <span className="mx-2" style={{ color: V.faint }}>·</span>
                        <span style={{ color: V.sage }}>+ ₹{inr(tot.in)}</span>
                      </p>
                      <div className="mt-1.5 ml-auto" style={{ width: 148, borderTop: `1px solid ${V.inkSoft}`, borderBottom: `1px solid ${V.inkSoft}`, height: 4 }} />
                    </div>
                  </div>
                </div>
              </section>
            );
          })
        )}

        {/* load more */}
        {!isLoading && sortedTxns.length > visibleCount && (
          <div className="flex items-center justify-between mt-6 px-1">
            <span className="text-xs" style={{ color: V.faint, ...font }}>Showing {visibleTxns.length} of {sortedTxns.length}</span>
            <button onClick={() => setVisibleCount(c => c + PAGE_SIZE)} className="text-sm font-semibold" style={{ color: V.terraDeep, ...font }}>Load more</button>
          </div>
        )}
      </div>

      {/* direction-aware drag-to-sum panel */}
      {sumSel.size > 1 && selectedCount === 0 && (
        <div className="fixed bottom-4 right-4 rounded-xl shadow-lg p-3 z-50" style={{ background: 'rgba(255,255,255,0.97)', border: `1px solid ${V.line}`, ...font }}>
          <p className="text-xs" style={{ color: V.faint }}>{sumSel.size} selected</p>
          <p className="text-[15px] font-medium mt-0.5" style={{ ...nums, color: sumNet < 0 ? V.terraDeep : V.sage }}>
            net {sumNet < 0 ? '−' : '+'} ₹{inr(Math.abs(sumNet))}
          </p>
          <p className="text-xs mt-0.5" style={{ ...nums }}>
            <span style={{ color: V.terraDeep }}>− ₹{inr(sumOut)}</span>
            <span className="mx-1.5" style={{ color: V.line }}>·</span>
            <span style={{ color: V.sage }}>+ ₹{inr(sumIn)}</span>
          </p>
        </div>
      )}

      <ImageLightbox url={lightboxUrl} title="Payment Proof" onClose={() => setLightboxUrl(null)} />

      {/* bulk action bar */}
      {selectedCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pb-4 px-4 pointer-events-none">
          <div className="pointer-events-auto bg-on-surface/95 backdrop-blur-sm text-surface rounded-2xl shadow-2xl px-5 py-3 flex items-center gap-3 flex-wrap animate-in slide-in-from-bottom-4 duration-200">
            <span className="text-[13px] font-semibold whitespace-nowrap text-surface/90">{selectedCount} selected</span>
            <div className="w-px h-5 bg-surface/20" />
            <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold bg-surface/10 hover:bg-surface/20 transition-colors">
              <span className="material-symbols-outlined text-[16px]">download</span>Export CSV
            </button>
            <button onClick={() => { setRecatCategory(''); setShowRecategorize(true); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold bg-surface/10 hover:bg-surface/20 transition-colors">
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
            {selectedCategories.length > 1 ? (
              <p className="text-body-sm text-on-surface-variant mb-4">
                <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded text-[11px] font-bold mr-1">
                  <span className="material-symbols-outlined text-[13px]">warning</span>Mixed types
                </span>
                Current: <span className="font-semibold">{selectedCategories.join(', ')}</span>
              </p>
            ) : (
              <p className="text-body-sm text-on-surface-variant mb-4">Current: <span className="font-semibold">{selectedCategories[0] || '—'}</span></p>
            )}
            <div className="space-y-2 mb-5">
              <label className="text-label-caps font-label-caps text-on-surface-variant">NEW CATEGORY</label>
              <select value={recatCategory} onChange={e => setRecatCategory(e.target.value)} className="bk-input w-full">
                <option value="">Select category…</option>
                {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowRecategorize(false)} className="bk-btn-ghost px-4 py-2 rounded-xl text-body-sm">Cancel</button>
              <button disabled={!recatCategory || recatMutation.isPending}
                onClick={() => recatMutation.mutate({ ids: Array.from(selectedTxnIds), category: recatCategory })}
                className="bk-btn px-4 py-2 rounded-xl text-body-sm disabled:opacity-50">
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
              <div className="w-10 h-10 rounded-full bg-error-container flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-error">block</span>
              </div>
              <div>
                <h3 className="text-headline-sm font-bold">Void {voidableSelected.length} transaction{voidableSelected.length !== 1 ? 's' : ''}?</h3>
                <p className="text-body-sm text-on-surface-variant mt-1">This cannot be undone.</p>
              </div>
            </div>
            {hasAmendedSelected && (
              <div className="mb-4 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-amber-800 text-[12px]">
                <span className="material-symbols-outlined text-[16px]">warning</span>
                Some transactions have amendments — voiding will also void their amendments.
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
              <button disabled={voidAllMutation.isPending}
                onClick={() => voidAllMutation.mutate(voidableSelected.map((t: any) => t.txn_id))}
                className="px-4 py-2 rounded-xl text-body-sm font-bold bg-error text-on-error hover:bg-error/90 transition-colors disabled:opacity-50">
                {voidAllMutation.isPending ? 'Voiding…' : `Void ${voidableSelected.length}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
