import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { usePeek } from '../context/PeekContext';
import { useUserProfile } from '../App';
import { useOrgId } from '../lib/auth/AuthProvider';
import { useSnackbar } from '../components/Snackbar';
import { DashboardSkeleton } from '../components/SkeletonLoader';
import { TxnRow } from '../components/TxnRow';
import { Edit2, X, ChevronRight } from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAmt(n: number): string {
  if (n >= 10_00_000) return `₹${(n / 10_00_000).toFixed(1)}Cr`;
  if (n >= 1_00_000)  return `₹${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000)     return `₹${Math.round(n / 1_000)}K`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const p = new Date(d);
  if (isNaN(p.getTime())) return d;
  return p.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isClientReceipt(cat: string) {
  const u = (cat ?? '').toUpperCase().replace(/[\s_-]/g, '');
  return u === 'CLIENTRECEIPT' || u === 'CLIENTRCPT';
}
function isExcludedFromSpent(cat: string) {
  const u = (cat ?? '').toUpperCase().replace(/[\s_-]/g, '');
  return isClientReceipt(cat) || u.includes('FUNDING') || u.includes('INFLOW');
}

function genTxnId() {
  return `TXN-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
}

// ── AnimatedNumber ────────────────────────────────────────────────────────────

function AnimatedNumber({ value, format = fmtAmt }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(0);
  const fired = useRef(false);
  const raf   = useRef<number | null>(null);
  useEffect(() => {
    if (value <= 0) { setShown(0); return; }
    if (fired.current) { setShown(value); return; }
    fired.current = true;
    const dur = 700; const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / dur, 1);
      setShown(Math.round(value * (1 - (1 - p) ** 3)));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [value]);
  return <>{format(shown)}</>;
}

// ── Status config ──────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { accent: string; badge: string; dot: string }> = {
  Active:    { accent: '#C8603A', badge: 'rgba(200,96,58,0.10)', dot: '#C8603A' },
  'On Hold': { accent: '#d97706', badge: 'rgba(217,119,6,0.10)',  dot: '#d97706' },
  Completed: { accent: '#2563eb', badge: 'rgba(37,99,235,0.10)',  dot: '#2563eb' },
};

const WO_STATUS_CFG: Record<string, { bg: string; color: string }> = {
  Draft:     { bg: 'rgba(100,116,139,0.10)', color: '#64748b' },
  Assigned:  { bg: 'rgba(59,130,246,0.10)',  color: '#3b82f6' },
  Issued:    { bg: 'rgba(139,92,246,0.10)',  color: '#7c3aed' },
  Active:    { bg: 'rgba(245,158,11,0.10)',  color: '#d97706' },
  Closed:    { bg: 'rgba(16,185,129,0.10)',  color: '#059669' },
  Cancelled: { bg: 'rgba(239,68,68,0.10)',   color: '#dc2626' },
};

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, accent, icon }: {
  label: string; value: number | null; sub?: string; accent?: boolean; icon?: string;
}) {
  return (
    <div style={{
      background: '#fff', borderRadius: 16, padding: '18px 20px',
      border: '1px solid rgba(0,0,0,0.06)',
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        {icon && (
          <div style={{
            width: 32, height: 32, borderRadius: 10,
            background: accent ? 'rgba(200,96,58,0.10)' : 'rgba(0,0,0,0.04)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: accent ? '#C8603A' : 'rgba(0,0,0,0.40)' }}>{icon}</span>
          </div>
        )}
        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)' }}>
          {label}
        </p>
      </div>
      <p style={{
        fontSize: 24, fontWeight: 800, fontFamily: 'Manrope, sans-serif',
        color: accent ? '#C8603A' : '#0b1c30', letterSpacing: '-0.02em', lineHeight: 1, marginBottom: 4,
      }}>
        {value === null ? '—' : <AnimatedNumber value={value} />}
      </p>
      {sub && <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', marginTop: 2 }}>{sub}</p>}
    </div>
  );
}

// ── Nav tile ──────────────────────────────────────────────────────────────────

function NavTile({ icon, label, count, href, color = '#C8603A' }: {
  icon: string; label: string; count?: number; href: string; color?: string;
}) {
  const [hov, setHov] = useState(false);
  return (
    <Link to={href} style={{ textDecoration: 'none' }}>
      <div
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          background: '#fff', borderRadius: 14, padding: '16px',
          border: `1.5px solid ${hov ? color : 'rgba(0,0,0,0.06)'}`,
          cursor: 'pointer', transition: 'all 180ms',
          boxShadow: hov ? `0 4px 16px ${color}20` : '0 1px 4px rgba(0,0,0,0.04)',
          transform: hov ? 'translateY(-1px)' : 'translateY(0)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10, flexShrink: 0,
          background: hov ? `${color}14` : 'rgba(0,0,0,0.04)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 180ms',
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: hov ? color : 'rgba(0,0,0,0.40)', transition: 'color 180ms' }}>{icon}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#0b1c30', lineHeight: 1, marginBottom: 2 }}>{label}</p>
          {count !== undefined && (
            <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)' }}>{count} {count === 1 ? 'entry' : 'entries'}</p>
          )}
        </div>
        <ChevronRight size={14} style={{ color: 'rgba(0,0,0,0.25)', flexShrink: 0, transition: 'color 180ms', ...(hov ? { color } : {}) }} />
      </div>
    </Link>
  );
}

// ── Quick Transaction Drawer ──────────────────────────────────────────────────

const TXN_CATEGORIES: Record<string, string[]> = {
  worker:   ['Labour', 'Mason', 'Carpenter', 'Electrician', 'Plumber', 'Painter', 'Steel Fixer'],
  material: ['Cement', 'Steel', 'Bricks & Blocks', 'Sand & Aggregate', 'Tiles & Flooring', 'Plumbing Materials', 'Electrical Materials', 'Paint & Putty'],
  expense:  ['Transport', 'Equipment Hire', 'Site Expenses', 'Admin & Misc'],
};

function QuickTransactionDrawer({ projectId, projectName, onClose, onSuccess }: {
  projectId: string; projectName: string; onClose: () => void; onSuccess: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { show: showSnackbar } = useSnackbar();
  const orgId = useOrgId();
  const [txnType, setTxnType] = useState<'worker' | 'material' | 'expense'>('worker');
  const [stkId, setStkId] = useState('');
  const [stkSearch, setStkSearch] = useState('');
  const [showSug, setShowSug] = useState(false);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'Cash' | 'UPI' | 'NEFT' | 'Cheque'>('Cash');
  const [category, setCategory] = useState('');
  const [remarks, setRemarks] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);
  const stkRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (stkRef.current && !stkRef.current.contains(e.target as Node)) setShowSug(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const selName = stkId ? stkSearch : '';
  const { data: stakeholders = [] } = useQuery({
    queryKey: ['stk_quick', txnType],
    queryFn: async () => {
      const catMap: Record<string, string[]> = { worker: ['Worker', 'Contractor'], material: ['Vendor', 'Supplier'], expense: ['Vendor', 'Supplier', 'Others'] };
      const { data } = await supabase.from('stakeholders').select('stakeholder_id, name, category').in('category', catMap[txnType]).order('name');
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const filtStk = stkSearch && !stkId ? stakeholders.filter((s: any) => s.name.toLowerCase().includes(stkSearch.toLowerCase())).slice(0, 8) : [];

  const handleSave = async () => {
    if (!amount || Number(amount) <= 0) { showSnackbar('Enter a valid amount', { type: 'error' }); return; }
    setSaving(true);
    try {
      const txnId = genTxnId();
      const { error: rpcError } = await supabase.rpc('insert_transaction_with_allocations', {
        p_txn: {
          txn_id:         txnId,
          org_id:         orgId,
          date,
          category:       category || TXN_CATEGORIES[txnType][0],
          payment_mode:   mode,
          total_amount:   Number(amount),
          remarks,
          stakeholder_id: stkId || null,
          ai_flag_status: 'Clean',
          ai_flag_data:   {},
        },
        p_allocations: [{ project_id: projectId, allocated_amount: Number(amount) }],
      });
      if (rpcError) throw rpcError;
      qc.invalidateQueries({ queryKey: ['project_allocs_v2', projectId] });
      showSnackbar('Transaction added');
      onSuccess();
    } catch (e: any) {
      showSnackbar(e.message || 'Failed to save', { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex' }}>
      <div style={{ flex: 1, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div style={{
        width: '100%', maxWidth: 400, background: '#fff', height: '100%', overflowY: 'auto',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column',
        animation: 'slideInRight 260ms cubic-bezier(0.34,1.56,0.64,1)',
      }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: 16, fontWeight: 700, color: '#0b1c30', fontFamily: 'Manrope, sans-serif' }}>Quick Transaction</p>
            <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.40)', marginTop: 1 }}>{projectName}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(0,0,0,0.40)', display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18, flex: 1 }}>
          {/* Type selector */}
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)', marginBottom: 8 }}>Type</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {(['worker', 'material', 'expense'] as const).map(t => (
                <button key={t} onClick={() => { setTxnType(t); setStkId(''); setStkSearch(''); setCategory(''); }}
                  style={{
                    padding: '8px', borderRadius: 10, fontSize: 12, fontWeight: txnType === t ? 600 : 400,
                    border: `1.5px solid ${txnType === t ? '#C8603A' : 'rgba(0,0,0,0.08)'}`,
                    background: txnType === t ? 'rgba(200,96,58,0.08)' : 'transparent',
                    color: txnType === t ? '#C8603A' : 'rgba(0,0,0,0.50)', cursor: 'pointer', transition: 'all 150ms',
                  }}>
                  {t === 'worker' ? 'Worker' : t === 'material' ? 'Material' : 'Expense'}
                </button>
              ))}
            </div>
          </div>

          {/* Payee */}
          <div ref={stkRef} style={{ position: 'relative' }}>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)', marginBottom: 8 }}>
              {txnType === 'worker' ? 'Worker' : 'Vendor'}
            </p>
            <input type="text" value={selName || stkSearch}
              onChange={e => { setStkSearch(e.target.value); setStkId(''); setShowSug(true); }}
              onFocus={() => setShowSug(true)}
              placeholder={`Search ${txnType === 'worker' ? 'worker' : 'vendor'}…`}
              style={{ width: '100%', height: 44, padding: '0 14px', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.10)', fontSize: 14, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
              onBlur={e => (e.target.style.borderColor = 'rgba(0,0,0,0.10)')}
            />
            {showSug && filtStk.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: '1px solid rgba(0,0,0,0.10)', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.08)', zIndex: 50, overflow: 'hidden', maxHeight: 200, overflowY: 'auto' }}>
                {filtStk.map((s: any) => (
                  <button key={s.stakeholder_id} onClick={() => { setStkId(s.stakeholder_id); setStkSearch(s.name); setShowSug(false); }}
                    style={{ width: '100%', textAlign: 'left', padding: '10px 14px', fontSize: 13, color: '#0b1c30', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.03)'}
                    onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}>
                    <span style={{ fontWeight: 500 }}>{s.name}</span>
                    <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)' }}>{s.category}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Amount */}
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)', marginBottom: 8 }}>Amount</p>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 18, fontWeight: 700, color: 'rgba(0,0,0,0.30)' }}>₹</span>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0"
                style={{ width: '100%', height: 52, paddingLeft: 30, paddingRight: 14, borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.10)', fontSize: 20, fontWeight: 700, outline: 'none', fontFamily: 'Geist Mono, monospace', boxSizing: 'border-box' }}
                onFocus={e => (e.target.style.borderColor = '#C8603A')}
                onBlur={e => (e.target.style.borderColor = 'rgba(0,0,0,0.10)')}
              />
            </div>
          </div>

          {/* Category */}
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)', marginBottom: 8 }}>Category</p>
            <select value={category} onChange={e => setCategory(e.target.value)}
              style={{ width: '100%', height: 44, padding: '0 14px', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.10)', fontSize: 14, outline: 'none', fontFamily: 'inherit', appearance: 'none', cursor: 'pointer', boxSizing: 'border-box' }}
              onFocus={e => (e.target.style.borderColor = '#C8603A')}
              onBlur={e => (e.target.style.borderColor = 'rgba(0,0,0,0.10)')}>
              {TXN_CATEGORIES[txnType].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Mode + Date */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)', marginBottom: 8 }}>Mode</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                {(['Cash', 'UPI', 'NEFT', 'Cheque'] as const).map(m => (
                  <button key={m} onClick={() => setMode(m)}
                    style={{
                      padding: '6px', borderRadius: 8, fontSize: 11, fontWeight: mode === m ? 600 : 400,
                      border: `1.5px solid ${mode === m ? '#C8603A' : 'rgba(0,0,0,0.08)'}`,
                      background: mode === m ? 'rgba(200,96,58,0.08)' : 'transparent',
                      color: mode === m ? '#C8603A' : 'rgba(0,0,0,0.50)', cursor: 'pointer', transition: 'all 150ms',
                    }}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)', marginBottom: 8 }}>Date</p>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                style={{ width: '100%', height: 44, padding: '0 10px', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.10)', fontSize: 12, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                onFocus={e => (e.target.style.borderColor = '#C8603A')}
                onBlur={e => (e.target.style.borderColor = 'rgba(0,0,0,0.10)')}
              />
            </div>
          </div>

          {/* Remarks */}
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)', marginBottom: 8 }}>Remarks</p>
            <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} placeholder="Optional note…"
              style={{ width: '100%', padding: '10px 14px', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.10)', fontSize: 13, outline: 'none', fontFamily: 'inherit', resize: 'none', boxSizing: 'border-box' }}
              onFocus={e => (e.target.style.borderColor = '#C8603A')}
              onBlur={e => (e.target.style.borderColor = 'rgba(0,0,0,0.10)')}
            />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => navigate(`/ledger/new?project=${projectId}`)}
              style={{ flex: '0 0 auto', height: 48, padding: '0 16px', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.10)', background: 'transparent', color: 'rgba(0,0,0,0.50)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
              Full form
            </button>
            <button onClick={handleSave} disabled={saving || !amount}
              style={{
                flex: 1, height: 48, borderRadius: 12, border: 'none',
                background: !saving && amount ? '#C8603A' : 'rgba(0,0,0,0.06)',
                color: !saving && amount ? '#fff' : 'rgba(0,0,0,0.25)',
                fontSize: 14, fontWeight: 600, cursor: !saving && amount ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit', transition: 'all 200ms',
              }}>
              {saving ? 'Saving…' : 'Save Transaction'}
            </button>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ProjectDetail({ session }: { session: Session }) {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { openPeek } = usePeek();
  const { data: profile } = useUserProfile(session.user.id);
  const isPrincipal = profile?.role === 'principal';
  const canManage = isPrincipal || profile?.role === 'management';
  const { show: showSnackbar } = useSnackbar();
  const qc = useQueryClient();

  const [showEditSheet, setShowEditSheet] = useState(false);
  const [showQuickTxn, setShowQuickTxn] = useState(false);
  const [editName, setEditName] = useState('');
  const [editLoc, setEditLoc] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editStatus, setEditStatus] = useState('Active');
  const [mounted, setMounted] = useState(false);

  useEffect(() => { const t = setTimeout(() => setMounted(true), 40); return () => clearTimeout(t); }, []);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: project, isLoading: loadingProject } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('*').eq('project_id', projectId).single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!projectId,
  });

  const { data: workOrders = [] } = useQuery({
    queryKey: ['project_wos_v2', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('work_orders').select('*, stakeholders(name)').eq('project_id', projectId).order('created_at', { ascending: false });
      return data as any[] ?? [];
    },
    enabled: !!projectId,
  });

  const { data: purchaseOrders = [] } = useQuery({
    queryKey: ['project_pos_v2', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('purchase_orders').select('*, stakeholders(name)').eq('project_id', projectId).order('created_at', { ascending: false });
      return data as any[] ?? [];
    },
    enabled: !!projectId,
  });

  const { data: allocations = [], isLoading: loadingTxns } = useQuery({
    queryKey: ['project_allocs_v2', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('txn_allocations').select(`allocated_amount, transactions(txn_id, date, category, status, payment_mode, total_amount, remarks, stakeholders(name, type, category))`).eq('project_id', projectId);
      return (data ?? []).filter((a: any) => a.transactions?.status === 'Active') as any[];
    },
    enabled: !!projectId,
  });

  const { data: budgetLines = [] } = useQuery({
    queryKey: ['project_budgets_total', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('project_budgets').select('planned_amount').eq('project_id', projectId);
      return data as any[] ?? [];
    },
    enabled: !!projectId,
  });

  // ── Computed ───────────────────────────────────────────────────────────────

  const totalBudget = budgetLines.reduce((s: number, b: any) => s + Number(b.planned_amount), 0);
  const totalSpent  = allocations.reduce((s: number, a: any) => isExcludedFromSpent(a.transactions?.category ?? '') ? s : s + Number(a.allocated_amount), 0);

  const openWOs = workOrders.filter((wo: any) => !['Closed', 'Cancelled'].includes(wo.status));
  const openPOs = purchaseOrders.filter((po: any) => !['PAID', 'CANCELLED', 'TALLIED'].includes(po.status));

  const totalCommitted = [
    ...openWOs.map((wo: any) => Number(wo.order_value) || 0),
    ...openPOs.map((po: any) => Number(po.vendor_bill_amount || 0) || Number(po.total_value || 0) || 0),
  ].reduce((s, v) => s + v, 0);

  const remaining    = totalBudget > 0 ? Math.max(0, totalBudget - totalSpent - totalCommitted) : null;
  const spentPct     = totalBudget > 0 ? Math.min((totalSpent / totalBudget) * 100, 100) : 0;
  const committedPct = totalBudget > 0 ? Math.min((totalCommitted / totalBudget) * 100, Math.max(0, 100 - spentPct)) : 0;

  // Unique transactions (deduplicated)
  const uniqueTxns = (() => {
    const seen = new Set<string>();
    return allocations.map(a => a.transactions).filter((t: any) => { if (!t || seen.has(t.txn_id)) return false; seen.add(t.txn_id); return true; });
  })();

  const updateProject = useMutation({
    mutationFn: async (updates: any) => {
      const { error } = await supabase.from('projects').update(updates).eq('project_id', projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['sidebar_projects'] });
      setShowEditSheet(false);
      showSnackbar('Project updated');
    },
    onError: (e: any) => showSnackbar(e.message || 'Update failed', { type: 'error' }),
  });

  if (loadingProject) return <div className="p-4 md:p-8"><DashboardSkeleton /></div>;
  if (!project) return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <p style={{ color: 'rgba(0,0,0,0.40)', fontSize: 15 }}>Project not found.</p>
    </div>
  );

  const cfg = STATUS_CFG[project.status] ?? STATUS_CFG['Active'];

  return (
    <div style={{ padding: '28px 24px 80px', maxWidth: 1100, margin: '0 auto' }}>
      {loadingTxns && <div className="mb-4"><DashboardSkeleton /></div>}

      {/* ── Project header ──────────────────────────────────────────────── */}
      <div style={{
        background: '#fff', borderRadius: 20, border: '1px solid rgba(0,0,0,0.06)',
        overflow: 'hidden', marginBottom: 20,
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        opacity: mounted ? 1 : 0, transform: mounted ? 'none' : 'translateY(8px)',
        transition: 'opacity 300ms, transform 300ms',
      }}>
        {/* Accent bar */}
        <div style={{ height: 4, background: `linear-gradient(90deg, ${cfg.accent} 0%, ${cfg.accent}80 100%)` }} />

        <div style={{ padding: '24px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Breadcrumb */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', cursor: 'pointer' }} onClick={() => navigate('/projects')}>Projects</span>
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.20)' }}>/</span>
              <span style={{ fontSize: 12, color: '#0b1c30', fontWeight: 600 }}>{project.name}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0b1c30', letterSpacing: '-0.02em', fontFamily: 'Manrope, sans-serif' }}>
                {project.name}
              </h1>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: cfg.dot, background: cfg.badge, padding: '4px 10px', borderRadius: 99, display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot, display: 'inline-block' }} />
                {project.status}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'rgba(0,0,0,0.45)' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 15 }}>location_on</span>
                {project.site_location}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'rgba(0,0,0,0.40)' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 15 }}>calendar_today</span>
                Started {fmtDate(project.start_date)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'rgba(0,0,0,0.35)', fontFamily: 'Geist Mono, monospace' }}>
                {project.project_id}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={() => setShowQuickTxn(true)}
              style={{ height: 38, padding: '0 16px', borderRadius: 99, background: '#C8603A', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 150ms' }}
              onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#a84e2d'}
              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = '#C8603A'}>
              <span style={{ fontSize: 18, fontWeight: 300, lineHeight: 1 }}>+</span>
              Transaction
            </button>
            {canManage && (
              <button onClick={() => { setEditName(project.name); setEditLoc(project.site_location); setEditDate(project.start_date?.split('T')[0] ?? ''); setEditStatus(project.status); setShowEditSheet(true); }}
                style={{ width: 38, height: 38, borderRadius: 99, background: 'rgba(0,0,0,0.05)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(0,0,0,0.45)', transition: 'all 150ms' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.08)'; (e.currentTarget as HTMLButtonElement).style.color = '#0b1c30' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.05)'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(0,0,0,0.45)' }}>
                <Edit2 size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Financial metrics ───────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        {totalBudget > 0 && (
          <MetricCard label="Budget" value={totalBudget} icon="account_balance" />
        )}
        <MetricCard label="Spent" value={totalSpent} accent icon="payments" />
        <MetricCard label="Committed" value={totalCommitted} icon="pending_actions" sub={`${openWOs.length} WOs + ${openPOs.length} POs`} />
        {remaining !== null && (
          <MetricCard label="Available" value={remaining} icon="savings" />
        )}
      </div>

      {/* ── Budget progress bar ─────────────────────────────────────────── */}
      {totalBudget > 0 && (
        <div style={{ background: '#fff', borderRadius: 16, padding: '18px 24px', border: '1px solid rgba(0,0,0,0.06)', marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.50)' }}>Budget utilization</p>
            <p style={{ fontSize: 12, fontFamily: 'Geist Mono, monospace', color: 'rgba(0,0,0,0.40)' }}>
              {Math.round(spentPct + committedPct)}% used
            </p>
          </div>
          <div style={{ height: 8, background: 'rgba(0,0,0,0.06)', borderRadius: 99, overflow: 'hidden', position: 'relative' }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, height: '100%',
              width: `${mounted ? spentPct : 0}%`,
              background: '#C8603A', borderRadius: 99,
              transition: 'width 800ms cubic-bezier(0.34,1.56,0.64,1)',
            }} />
            <div style={{
              position: 'absolute', top: 0, height: '100%',
              left: `${mounted ? spentPct : 0}%`,
              width: `${mounted ? committedPct : 0}%`,
              background: 'rgba(200,96,58,0.30)',
              transition: 'left 800ms cubic-bezier(0.34,1.56,0.64,1), width 800ms cubic-bezier(0.34,1.56,0.64,1)',
            }} />
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
            {[
              { color: '#C8603A', label: 'Spent', pct: spentPct },
              { color: 'rgba(200,96,58,0.40)', label: 'Committed', pct: committedPct },
              { color: 'rgba(0,0,0,0.08)', label: 'Available', pct: Math.max(0, 100 - spentPct - committedPct) },
            ].map(l => (
              <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: l.color, flexShrink: 0 }} />
                {l.label} ({Math.round(l.pct)}%)
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Nav tiles ───────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10, marginBottom: 24 }}>
        <NavTile href={`/projects/${projectId}/transactions`} icon="swap_horiz" label="Transactions" count={uniqueTxns.length} />
        <NavTile href={`/projects/${projectId}/work-orders`} icon="assignment" label="Work Orders" count={workOrders.length} />
        <NavTile href={`/projects/${projectId}/purchase-orders`} icon="shopping_bag" label="Purchase Orders" count={purchaseOrders.length} />
        <NavTile href={`/projects/${projectId}/inventory`} icon="inventory_2" label="Inventory" color="#7c3aed" />
        <NavTile href={`/projects/${projectId}/boqs`} icon="format_list_numbered" label="BOQs" color="#2563eb" />
        <NavTile href={`/projects/${projectId}/inward`} icon="local_shipping" label="Inward Register" color="#059669" />
      </div>

      {/* ── Recent activity ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>

        {/* Recent transactions */}
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(0,0,0,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#0b1c30' }}>Recent Transactions</p>
            <Link to={`/projects/${projectId}/transactions`} style={{ fontSize: 12, color: '#C8603A', textDecoration: 'none', fontWeight: 500 }}>See all →</Link>
          </div>
          {uniqueTxns.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center' }}>
              <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.30)' }}>No transactions yet</p>
            </div>
          ) : (
            uniqueTxns.slice(0, 5).map((txn: any) => (
              <TxnRow key={txn.txn_id} txn={txn} onClick={() => openPeek('TRANSACTION', txn.txn_id)} />
            ))
          )}
        </div>

        {/* Recent work orders */}
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(0,0,0,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#0b1c30' }}>Work Orders</p>
            <Link to={`/projects/${projectId}/work-orders`} style={{ fontSize: 12, color: '#C8603A', textDecoration: 'none', fontWeight: 500 }}>See all →</Link>
          </div>
          {workOrders.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center' }}>
              <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.30)' }}>No work orders yet</p>
            </div>
          ) : (
            workOrders.slice(0, 5).map((wo: any) => {
              const badge = WO_STATUS_CFG[wo.status] ?? { bg: 'rgba(0,0,0,0.06)', color: 'rgba(0,0,0,0.45)' };
              return (
                <div key={wo.wo_id}
                  onClick={() => navigate(`/work-orders/${wo.wo_id}`)}
                  style={{ padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, transition: 'background 120ms' }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,0,0,0.015)'}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: '#0b1c30', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wo.stakeholders?.name ?? '—'}</p>
                    <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', fontFamily: 'Geist Mono, monospace' }}>{wo.wo_id}</p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: badge.bg, color: badge.color }}>{wo.status}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'Geist Mono, monospace', color: '#0b1c30' }}>₹{Number(wo.order_value || 0).toLocaleString('en-IN')}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Edit sheet ──────────────────────────────────────────────────── */}
      {showEditSheet && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={() => setShowEditSheet(false)}>
          <div style={{ width: '100%', maxWidth: 440, background: '#fff', borderRadius: 20, boxShadow: '0 24px 64px rgba(0,0,0,0.15)', overflow: 'hidden', animation: 'wizardSlideIn 250ms cubic-bezier(0.34,1.56,0.64,1)' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontSize: 16, fontWeight: 700, color: '#0b1c30', fontFamily: 'Manrope, sans-serif' }}>Edit Project</p>
              <button onClick={() => setShowEditSheet(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(0,0,0,0.40)', display: 'flex' }}><X size={18} /></button>
            </div>
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { label: 'Project Name', value: editName, set: setEditName },
                { label: 'Site Location', value: editLoc, set: setEditLoc },
              ].map(f => (
                <div key={f.label}>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)', marginBottom: 6 }}>{f.label}</label>
                  <input value={f.value} onChange={e => f.set(e.target.value)}
                    style={{ width: '100%', height: 44, padding: '0 14px', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.10)', fontSize: 14, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                    onFocus={e => (e.target.style.borderColor = '#C8603A')} onBlur={e => (e.target.style.borderColor = 'rgba(0,0,0,0.10)')} />
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)', marginBottom: 6 }}>Start Date</label>
                  <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                    style={{ width: '100%', height: 44, padding: '0 14px', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.10)', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                    onFocus={e => (e.target.style.borderColor = '#C8603A')} onBlur={e => (e.target.style.borderColor = 'rgba(0,0,0,0.10)')} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)', marginBottom: 6 }}>Status</label>
                  <select value={editStatus} onChange={e => setEditStatus(e.target.value)}
                    style={{ width: '100%', height: 44, padding: '0 14px', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.10)', fontSize: 13, outline: 'none', fontFamily: 'inherit', appearance: 'none', cursor: 'pointer', boxSizing: 'border-box' }}
                    onFocus={e => (e.target.style.borderColor = '#C8603A')} onBlur={e => (e.target.style.borderColor = 'rgba(0,0,0,0.10)')}>
                    <option value="Active">Active</option>
                    <option value="On Hold">On Hold</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                <button onClick={() => setShowEditSheet(false)}
                  style={{ flex: '0 0 auto', height: 46, padding: '0 18px', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.10)', background: 'transparent', color: 'rgba(0,0,0,0.50)', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>
                  Cancel
                </button>
                <button onClick={() => updateProject.mutate({ name: editName, site_location: editLoc, start_date: editDate, status: editStatus })} disabled={updateProject.isPending}
                  style={{ flex: 1, height: 46, borderRadius: 12, border: 'none', background: '#0b1c30', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', opacity: updateProject.isPending ? 0.5 : 1 }}>
                  {updateProject.isPending ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Quick transaction drawer ────────────────────────────────────── */}
      {showQuickTxn && (
        <QuickTransactionDrawer
          projectId={projectId}
          projectName={project?.name ?? ''}
          onClose={() => setShowQuickTxn(false)}
          onSuccess={() => setShowQuickTxn(false)}
        />
      )}

      <style>{`
        @keyframes wizardSlideIn {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
