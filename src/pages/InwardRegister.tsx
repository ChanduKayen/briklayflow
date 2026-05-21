import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useUserProfile } from '../App';
import { useOrgId } from '../lib/auth/AuthProvider';
import { useSnackbar } from '../components/Snackbar';
import { PageSkeleton } from '../components/SkeletonLoader';
import ReceiveAtSiteDrawer from '../components/ReceiveAtSiteDrawer';
import { downloadGRNChallan } from '../lib/grnChallan';


function fmtShortDate(d: string | null | undefined) {
  if (!d) return '';
  const p = new Date(d);
  if (isNaN(p.getTime())) return '';
  return p.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function InwardRegister({ session, lockedProjectId: propLockedProjectId }: { session: Session; lockedProjectId?: string }) {
  const navigate   = useNavigate();
  const location   = useLocation();
  const qc         = useQueryClient();
  const orgId      = useOrgId();
  const { data: profile } = useUserProfile(session.user.id);
  const { show: showSnackbar } = useSnackbar();

  // Prop (from ProjectInward) takes priority; state is the fallback (legacy redirect path)
  const lockedProjectId = propLockedProjectId ?? ((location.state as any)?.projectId as string | undefined);

  const [filterProject,  setFilterProject]  = useState(lockedProjectId ?? '');
  const [filterVendor,   setFilterVendor]   = useState('');
  const [dateFrom,       setDateFrom]        = useState('');
  const [dateTo,         setDateTo]          = useState('');
  const [expandedGrn,    setExpandedGrn]    = useState<string | null>(null);
  const [drawerPO,       setDrawerPO]       = useState<any | null>(null);

  const canManage = profile?.role === 'management' || profile?.role === 'principal' || profile?.role === 'accountant';

  // ── GRN list ────────────────────────────────────────────────────────────────

  const { data: grns, isLoading } = useQuery({
    queryKey: ['inward_grns', orgId, filterProject, filterVendor, dateFrom, dateTo],
    queryFn: async () => {
      let q = supabase
        .from('po_grn')
        .select(`
          grn_id, po_id, project_id, receipt_date, dc_number, vehicle_number,
          driver_name, remarks, received_by, created_at,
          stakeholders(name),
          projects(name),
          po_grn_items(grn_item_id, item_name, unit, qty_received, qty_ordered, unit_rate, condition, remarks)
        `)
        .order('created_at', { ascending: false });

      if (filterProject) q = q.eq('project_id', filterProject);
      if (dateFrom)      q = q.gte('receipt_date', dateFrom);
      if (dateTo)        q = q.lte('receipt_date', dateTo);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).filter((g: any) =>
        !filterVendor || g.stakeholders?.name?.toLowerCase().includes(filterVendor.toLowerCase())
      );
    },
    enabled: !!orgId,
  });

  // ── Projects for filter dropdown ─────────────────────────────────────────────

  const { data: projects } = useQuery({
    queryKey: ['projects_simple', orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from('projects')
        .select('project_id, name')
        .order('name');
      return data ?? [];
    },
    enabled: !!orgId,
  });

  // ── Summary stats (this month) ───────────────────────────────────────────────

  const thisMonthStart = new Date();
  thisMonthStart.setDate(1);
  thisMonthStart.setHours(0, 0, 0, 0);

  const thisMonthGrns  = (grns ?? []).filter(
    (g: any) => new Date(g.created_at) >= thisMonthStart
  );
  const totalThisMonth = thisMonthGrns.length;

  const valueThisMonth = thisMonthGrns.reduce((sum: number, g: any) => {
    const v = (g.po_grn_items ?? []).reduce(
      (s: number, i: any) => s + Number(i.qty_received ?? 0) * Number(i.unit_rate ?? 0), 0
    );
    return sum + v;
  }, 0);

  const discrepancies = (grns ?? []).reduce((count: number, g: any) => {
    const hasBad = (g.po_grn_items ?? []).some((i: any) => i.condition !== 'good');
    return hasBad ? count + 1 : count;
  }, 0);

  const pendingPOs = new Set(
    (grns ?? [])
      .filter((g: any) => {
        const items = g.po_grn_items ?? [];
        const totalOrdered  = items.reduce((s: number, i: any) => s + Number(i.qty_ordered  ?? 0), 0);
        const totalReceived = items.reduce((s: number, i: any) => s + Number(i.qty_received ?? 0), 0);
        return totalReceived < totalOrdered;
      })
      .map((g: any) => g.po_id)
  ).size;

  const hasFilters = (!lockedProjectId && !!filterProject) || !!filterVendor || !!dateFrom || !!dateTo;

  return (
    <div className="min-h-screen bg-surface-container-low/30">
      <div className="max-w-[1200px] mx-auto px-4 md:px-6 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            {lockedProjectId && (
              <div className="flex items-center gap-1.5 mb-2">
                <button
                  onClick={() => navigate(`/projects/${lockedProjectId}`)}
                  className="text-[12px] text-on-surface-variant/50 hover:text-primary transition-colors"
                >
                  {projects?.find((p: any) => p.project_id === lockedProjectId)?.name ?? 'Project'}
                </button>
                <span className="text-[12px] text-on-surface-variant/25">/</span>
                <span className="text-[12px] text-on-surface font-semibold">Inward Register</span>
              </div>
            )}
            <h2 className="text-[22px] font-bold text-on-surface tracking-tight">Inward Register</h2>
            <p className="text-[12px] text-on-surface-variant/45 mt-1">
              {lockedProjectId
                ? `Material receipts for ${projects?.find((p: any) => p.project_id === lockedProjectId)?.name ?? 'this project'}`
                : 'All material receipts at site'}
            </p>
          </div>
          {canManage && (
            <button
              onClick={() => navigate(lockedProjectId ? `/projects/${lockedProjectId}/purchase-orders` : '/purchase-orders')}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                height: 32, padding: '0 16px 0 12px',
                borderRadius: 99, border: 'none',
                background: '#C8603A', cursor: 'pointer',
                fontSize: 13, fontWeight: 500, color: '#fff',
              }}
            >
              <span style={{ fontSize: 17, fontWeight: 300 }}>+</span>
              New receipt
            </button>
          )}
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Receipts this month', value: totalThisMonth, icon: 'receipt_long', color: 'text-primary' },
            {
              label: 'Value received',
              value: valueThisMonth >= 100000
                ? `₹${(valueThisMonth / 100000).toFixed(1)}L`
                : valueThisMonth > 0 ? `₹${valueThisMonth.toLocaleString('en-IN')}` : '₹0',
              icon:  'currency_rupee', color: 'text-green-700',
            },
            { label: 'Pending POs',       value: pendingPOs,    icon: 'hourglass_empty', color: 'text-amber-600' },
            { label: 'Discrepancies',     value: discrepancies, icon: 'warning',         color: 'text-red-500'   },
          ].map(card => (
            <div key={card.label} className="bg-white rounded-2xl border border-black/[0.05] shadow-sm px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={`material-symbols-outlined text-[16px] ${card.color}`}>{card.icon}</span>
                <p className="text-[10px] font-medium text-on-surface-variant/50 uppercase tracking-wide">{card.label}</p>
              </div>
              <p className={`text-[22px] font-bold tabular-nums ${card.color}`}>{card.value}</p>
            </div>
          ))}
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {!lockedProjectId && (
            <select
              value={filterProject}
              onChange={e => setFilterProject(e.target.value)}
              className="h-8 px-3 rounded-full border border-outline-variant/20 text-[12px] bg-white focus:outline-none focus:border-primary/40"
            >
              <option value="">All projects</option>
              {(projects ?? []).map((p: any) => (
                <option key={p.project_id} value={p.project_id}>{p.name}</option>
              ))}
            </select>
          )}

          <input
            type="text"
            value={filterVendor}
            onChange={e => setFilterVendor(e.target.value)}
            placeholder="Vendor search…"
            className="h-8 px-3 rounded-full border border-outline-variant/20 text-[12px] bg-white focus:outline-none focus:border-primary/40 w-36"
          />

          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="h-8 px-3 rounded-full border border-outline-variant/20 text-[12px] bg-white focus:outline-none focus:border-primary/40"
          />
          <span className="text-[11px] text-on-surface-variant/40">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="h-8 px-3 rounded-full border border-outline-variant/20 text-[12px] bg-white focus:outline-none focus:border-primary/40"
          />

          {hasFilters && (
            <button
              onClick={() => { if (!lockedProjectId) setFilterProject(''); setFilterVendor(''); setDateFrom(''); setDateTo(''); }}
              className="text-[11px] text-on-surface-variant/40 hover:text-primary transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {isLoading && <PageSkeleton />}

        {!isLoading && (grns ?? []).length === 0 && (
          <div className="text-center py-20">
            <span className="material-symbols-outlined text-[44px] block mb-3 text-on-surface-variant/15">local_shipping</span>
            <p className="text-[14px] font-medium text-on-surface/40">
              {hasFilters ? 'No receipts match your filters' : 'No receipts yet'}
            </p>
            <p className="text-[12px] mt-1 text-on-surface-variant/30">
              {hasFilters ? 'Try adjusting the filters' : 'Record site receipts from the Purchase Orders page'}
            </p>
            {hasFilters && (
              <button
                onClick={() => { if (!lockedProjectId) setFilterProject(''); setFilterVendor(''); setDateFrom(''); setDateTo(''); }}
                className="mt-4 text-[13px] font-medium text-primary hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* GRN list */}
        {(grns ?? []).length > 0 && (
          <div className="space-y-2">
            {(grns ?? []).map((grn: any) => {
              const items     = grn.po_grn_items ?? [];
              const hasBad    = items.some((i: any) => i.condition !== 'good');
              const preview   = items.slice(0, 3).map((i: any) => `${i.qty_received} ${i.unit} ${i.item_name}`).join(', ')
                + (items.length > 3 ? ` +${items.length - 3} more` : '');
              const isExpanded = expandedGrn === grn.grn_id;

              return (
                <div
                  key={grn.grn_id}
                  className="bg-white rounded-2xl border border-black/[0.05] shadow-sm overflow-hidden"
                >
                  {/* Card header — tap to expand */}
                  <div
                    role="button"
                    className="w-full text-left px-4 pt-3.5 pb-3 hover:bg-surface-container-low/30 transition-colors cursor-pointer"
                    onClick={() => setExpandedGrn(isExpanded ? null : grn.grn_id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-mono text-[12px] font-bold text-primary">{grn.grn_id}</p>
                          {hasBad && (
                            <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                              Discrepancy
                            </span>
                          )}
                        </div>
                        <p className="text-[13px] font-semibold text-on-surface leading-snug">
                          {grn.stakeholders?.name ?? '—'}
                        </p>
                        <p className="text-[11px] text-on-surface-variant/50 mt-0.5 line-clamp-1">{preview}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[11px] font-medium text-on-surface/70">{fmtShortDate(grn.receipt_date)}</p>
                        <p className="text-[10px] text-on-surface-variant/35 mt-0.5">{grn.projects?.name ?? '—'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-2">
                      <p className="text-[11px] text-on-surface-variant/40 font-mono truncate flex-1">
                        {[grn.dc_number && `DC: ${grn.dc_number}`, grn.vehicle_number].filter(Boolean).join(' · ')}
                      </p>
                      <button
                        title="Download challan"
                        onClick={e => {
                          e.stopPropagation();
                          downloadGRNChallan({
                            grn_id:         grn.grn_id,
                            po_id:          grn.po_id,
                            vendor_name:    grn.stakeholders?.name ?? '—',
                            project_name:   grn.projects?.name ?? '—',
                            receipt_date:   grn.receipt_date,
                            dc_number:      grn.dc_number,
                            vehicle_number: grn.vehicle_number,
                            driver_name:    grn.driver_name,
                            remarks:        grn.remarks,
                            items: items.map((i: any) => ({
                              item_name:    i.item_name,
                              unit:         i.unit,
                              qty_ordered:  Number(i.qty_ordered),
                              qty_received: Number(i.qty_received),
                              unit_rate:    i.unit_rate != null ? Number(i.unit_rate) : null,
                              condition:    i.condition,
                              remarks:      i.remarks ?? null,
                            })),
                          });
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: 24, height: 24, borderRadius: 7, border: 'none',
                          background: 'rgba(11,28,48,0.06)', cursor: 'pointer',
                          transition: 'background 0.15s', flexShrink: 0,
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(11,28,48,0.13)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(11,28,48,0.06)')}
                      >
                        <span className="material-symbols-outlined text-[13px] text-on-surface/45">download</span>
                      </button>
                      <span className="material-symbols-outlined text-[15px] text-on-surface-variant/25 shrink-0">
                        {isExpanded ? 'expand_less' : 'expand_more'}
                      </span>
                    </div>
                  </div>

                  {/* Expanded item list */}
                  {isExpanded && (
                    <div className="border-t border-outline-variant/[0.06] px-4 py-3">
                      <div className="space-y-2 mb-3">
                        {items.map((item: any) => (
                          <div key={item.grn_item_id} className="flex items-center justify-between text-[12px]">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span className="text-on-surface truncate">{item.item_name}</span>
                              {item.condition !== 'good' && (
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded capitalize shrink-0 ${
                                  item.condition === 'damaged' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                                }`}>{item.condition}</span>
                              )}
                            </div>
                            <span className="font-mono font-semibold text-on-surface ml-3 shrink-0">
                              {item.qty_received} {item.unit}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-3 pt-2 border-t border-outline-variant/[0.06]">
                        <button
                          onClick={() => navigate(`/purchase-orders/${grn.po_id}`, lockedProjectId ? { state: { from: 'project', projectId: lockedProjectId, projectName: projects?.find((p: any) => p.project_id === lockedProjectId)?.name } } : undefined)}
                          className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                        >
                          <span className="material-symbols-outlined text-[13px]">receipt_long</span>
                          View PO {grn.po_id}
                        </button>
                        <button
                          title="Download challan"
                          onClick={() => downloadGRNChallan({
                            grn_id:        grn.grn_id,
                            po_id:         grn.po_id,
                            vendor_name:   grn.stakeholders?.name ?? '—',
                            project_name:  grn.projects?.name ?? '—',
                            receipt_date:  grn.receipt_date,
                            dc_number:     grn.dc_number,
                            vehicle_number: grn.vehicle_number,
                            driver_name:   grn.driver_name,
                            remarks:       grn.remarks,
                            items: items.map((i: any) => ({
                              item_name:    i.item_name,
                              unit:         i.unit,
                              qty_ordered:  Number(i.qty_ordered),
                              qty_received: Number(i.qty_received),
                              unit_rate:    i.unit_rate != null ? Number(i.unit_rate) : null,
                              condition:    i.condition,
                              remarks:      i.remarks ?? null,
                            })),
                          })}
                          className="flex items-center gap-1 text-[11px] font-medium text-on-surface-variant/50 hover:text-primary transition-colors"
                        >
                          <span className="material-symbols-outlined text-[13px]">download</span>
                          Challan
                        </button>
                        {grn.remarks && (
                          <p className="text-[11px] text-on-surface-variant/50 italic flex-1 truncate">{grn.remarks}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Receive at site drawer (triggered from here if needed) */}
      {drawerPO && (
        <ReceiveAtSiteDrawer
          isOpen={!!drawerPO}
          po={drawerPO}
          session={session}
          onClose={() => setDrawerPO(null)}
          onSuccess={(grnId) => {
            setDrawerPO(null);
            qc.invalidateQueries({ queryKey: ['inward_grns'] });
            showSnackbar(`GRN ${grnId} recorded`);
          }}
        />
      )}
    </div>
  );
}
