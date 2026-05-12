import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { LinearProgress } from '../components/LinearProgress';
import type { ClientInvoice, InvoiceStatus, Stakeholder, Project } from '../types';

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_TABS: { label: string; value: InvoiceStatus | 'All' }[] = [
  { label: 'All',           value: 'All'     },
  { label: 'Draft',         value: 'Draft'   },
  { label: 'Sent',          value: 'Sent'    },
  { label: 'Partially Paid',value: 'Partial' },
  { label: 'Paid',          value: 'Paid'    },
  { label: 'Overdue',       value: 'Overdue' },
];

const STATUS_STYLE: Record<string, string> = {
  Draft:     'bg-surface-container-highest text-on-surface-variant',
  Sent:      'bg-blue-50 text-blue-700',
  Partial:   'bg-amber-50 text-amber-700',
  Paid:      'bg-secondary-container text-on-secondary-container',
  Overdue:   'bg-error-container text-error',
  Void:      'bg-surface-container text-on-surface-variant/40',
  Cancelled: 'bg-surface-container text-on-surface-variant/40',
};

const STATUS_LABEL: Record<string, string> = {
  Draft:     'Draft',
  Sent:      'Sent',
  Partial:   'Partially Paid',
  Paid:      'Paid',
  Overdue:   'Overdue',
  Void:      'Cancelled',
  Cancelled: 'Cancelled',
};


function fmt(n: number) {
  return `₹${Number(n).toLocaleString('en-IN')}`;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDue(d?: string) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function isOverdue(inv: ClientInvoice) {
  if (!inv.due_date) return false;
  return new Date(inv.due_date) < new Date() && !['Paid', 'Void', 'Cancelled'].includes(inv.status);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Billing() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'All'>('All');
  const [search, setSearch] = useState('');

  const { data: bills, isLoading } = useQuery({
    queryKey: ['client_invoices'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_invoices')
        .select('*')
        .order('invoice_date', { ascending: false });
      if (error) throw error;
      return data as ClientInvoice[];
    },
  });

  const { data: stakeholders } = useQuery({
    queryKey: ['stakeholders'],
    queryFn: async () => {
      const { data } = await supabase.from('stakeholders').select('stakeholder_id, name, type');
      return data as Pick<Stakeholder, 'stakeholder_id' | 'name' | 'type'>[];
    },
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('project_id, name');
      return data as Pick<Project, 'project_id' | 'name'>[];
    },
  });

  const clientName = (id?: string) =>
    stakeholders?.find(s => s.stakeholder_id === id)?.name ?? '—';
  const projectName = (id?: string) =>
    projects?.find(p => p.project_id === id)?.name ?? '—';

  // ── Summary stats ─────────────────────────────────────────────────────────
  const allActive = (bills ?? []).filter(b => !['Void', 'Cancelled'].includes(b.status));
  const totalRaised    = allActive.reduce((s, b) => s + Number(b.total_amount), 0);
  const totalReceived  = allActive.reduce((s, b) => s + Number(b.paid_amount), 0);
  const totalOutstanding = totalRaised - totalReceived;

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filtered = (bills ?? []).filter(inv => {
    if (statusFilter !== 'All' && inv.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !inv.invoice_id.toLowerCase().includes(q) &&
        !clientName(inv.client_id).toLowerCase().includes(q) &&
        !(inv.subject ?? '').toLowerCase().includes(q) &&
        !(inv.milestone_name ?? '').toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div>
          <h2 className="text-[24px] font-bold text-on-surface tracking-tight">Billing</h2>
          <p className="text-[12px] text-on-surface-variant/50 mt-1 flex flex-wrap gap-x-3">
            <span>{(bills ?? []).length} bills</span>
            {totalRaised > 0 && <span>· {fmt(totalRaised)} raised</span>}
            {totalReceived > 0 && <span>· <span className="text-secondary font-semibold">{fmt(totalReceived)} received</span></span>}
            {totalOutstanding > 0 && <span>· <span className="text-amber-600 font-semibold">{fmt(totalOutstanding)} outstanding</span></span>}
          </p>
        </div>
        <Link
          to="/billing/new"
          className="bk-btn hidden md:flex items-center gap-2 h-9 px-4 rounded-xl text-[13px]"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          Raise Bill
        </Link>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant/40 pointer-events-none">search</span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search bills…"
            className="bk-input pl-9 w-full"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
                statusFilter === tab.value
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <LinearProgress className="mb-4" />}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-24">
          <span className="material-symbols-outlined text-[64px] text-on-surface-variant/15 block mb-4">receipt</span>
          <p className="text-[15px] font-semibold text-on-surface-variant/40">
            {search || statusFilter !== 'All' ? 'No bills match your filters' : 'No bills yet'}
          </p>
          {!search && statusFilter === 'All' && (
            <Link to="/billing/new" className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-primary font-semibold hover:underline">
              <span className="material-symbols-outlined text-[16px]">add</span>
              Raise your first bill
            </Link>
          )}
        </div>
      )}

      {/* ── Desktop Table ────────────────────────────────────────────────────── */}
      {filtered.length > 0 && (
        <>
          <div className="hidden md:block bg-white rounded-2xl border border-black/[0.06] shadow-sm overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-outline-variant/[0.08] bg-surface-container-low/40">
                  <th className="px-5 py-3 text-left text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-wide">Bill No</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-wide">Date</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-wide">Client</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-wide">Project</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-wide">Milestone</th>
                  <th className="px-4 py-3 text-right text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-wide">Amount</th>
                  <th className="px-4 py-3 text-right text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-wide">Received</th>
                  <th className="px-4 py-3 text-right text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-wide">Outstanding</th>
                  <th className="px-5 py-3 text-left text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/[0.06]">
                {filtered.map(inv => {
                  const outstanding = Math.max(0, Number(inv.total_amount) - Number(inv.paid_amount));
                  const overdue = isOverdue(inv);
                  const fullyPaid = outstanding === 0 && Number(inv.paid_amount) > 0;

                  return (
                    <tr
                      key={inv.invoice_id}
                      onClick={() => navigate(`/billing/${inv.invoice_id}`)}
                      className="hover:bg-surface-container-low/40 transition-colors cursor-pointer h-[52px]"
                    >
                      {/* Bill No */}
                      <td className="px-5 py-3">
                        <p className="font-data-mono text-[13px] font-bold text-on-surface">{inv.invoice_id}</p>
                        {inv.due_date && (
                          <p className={`text-[11px] mt-0.5 ${overdue ? 'text-error font-semibold' : 'text-on-surface-variant/40'}`}>
                            {overdue ? 'Overdue' : `Due ${fmtDue(inv.due_date)}`}
                          </p>
                        )}
                      </td>

                      {/* Date */}
                      <td className="px-4 py-3 text-[12px] text-on-surface-variant whitespace-nowrap">
                        {fmtDate(inv.invoice_date)}
                      </td>

                      {/* Client */}
                      <td className="px-4 py-3">
                        <p className="text-[13px] font-semibold text-on-surface">{clientName(inv.client_id)}</p>
                      </td>

                      {/* Project */}
                      <td className="px-4 py-3 max-w-[160px]">
                        <p className="text-[12px] text-on-surface-variant truncate">{projectName(inv.project_id)}</p>
                      </td>

                      {/* Milestone */}
                      <td className="px-4 py-3 max-w-[140px]">
                        {inv.milestone_name ? (
                          <p className="text-[12px] text-on-surface-variant/60 truncate">{inv.milestone_name}</p>
                        ) : (
                          <span className="text-[12px] text-on-surface-variant/25 italic">—</span>
                        )}
                      </td>

                      {/* Amount */}
                      <td className="px-4 py-3 text-right">
                        <span className="font-data-mono text-[13px] font-semibold text-on-surface">{fmt(Number(inv.total_amount))}</span>
                      </td>

                      {/* Received */}
                      <td className="px-4 py-3 text-right">
                        <span className={`font-data-mono text-[13px] ${fullyPaid ? 'text-secondary font-semibold' : 'text-on-surface-variant'}`}>
                          {Number(inv.paid_amount) > 0 ? fmt(Number(inv.paid_amount)) : '—'}
                        </span>
                      </td>

                      {/* Outstanding */}
                      <td className="px-4 py-3 text-right">
                        {outstanding > 0 ? (
                          <span className={`font-data-mono text-[13px] font-semibold ${overdue ? 'text-error' : 'text-amber-600'}`}>
                            {fmt(outstanding)}
                          </span>
                        ) : (
                          <span className="text-[13px] text-on-surface-variant/25">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-5 py-3">
                        <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${STATUS_STYLE[inv.status] ?? STATUS_STYLE.Draft}`}>
                          {STATUS_LABEL[inv.status] ?? inv.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Mobile Cards ─────────────────────────────────────────────────── */}
          <div className="md:hidden space-y-2">
            {filtered.map(inv => {
              const outstanding = Math.max(0, Number(inv.total_amount) - Number(inv.paid_amount));
              const overdue = isOverdue(inv);

              return (
                <div
                  key={inv.invoice_id}
                  onClick={() => navigate(`/billing/${inv.invoice_id}`)}
                  className="bg-white rounded-xl border border-black/[0.06] shadow-sm hover:shadow-md transition-shadow cursor-pointer p-4"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-data-mono text-[13px] font-bold text-on-surface">{inv.invoice_id}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[inv.status] ?? STATUS_STYLE.Draft}`}>
                          {STATUS_LABEL[inv.status] ?? inv.status}
                        </span>
                      </div>
                      <p className="text-[12px] text-on-surface-variant mt-1 truncate">
                        {clientName(inv.client_id)}
                        {inv.project_id && (
                          <span className="text-on-surface-variant/40"> · {projectName(inv.project_id)}</span>
                        )}
                      </p>
                      {inv.milestone_name && (
                        <p className="text-[11px] text-on-surface-variant/50 mt-0.5 truncate">{inv.milestone_name}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-data-mono text-[15px] font-bold text-on-surface">{fmt(Number(inv.total_amount))}</p>
                      {outstanding > 0 && inv.status !== 'Void' && (
                        <p className={`font-data-mono text-[11px] font-semibold ${overdue ? 'text-error' : 'text-amber-600'}`}>
                          {fmt(outstanding)} due
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-on-surface-variant/40 mt-1">
                    <span>{fmtDate(inv.invoice_date)}</span>
                    {inv.due_date && (
                      <span className={overdue ? 'text-error font-semibold' : ''}>
                        {overdue ? 'Overdue' : `Due ${fmtDue(inv.due_date)}`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* FAB mobile */}
      <Link to="/billing/new" className="bk-fab md:hidden" title="Raise Bill">
        <span className="material-symbols-outlined text-[24px]">add</span>
      </Link>
    </div>
  );
}
