import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { LinearProgress } from '../components/LinearProgress';
import type { ClientInvoice, InvoiceStatus, Stakeholder, Project } from '../types';

const STATUS_TABS: { label: string; value: InvoiceStatus | 'All' }[] = [
  { label: 'All',     value: 'All'     },
  { label: 'Draft',   value: 'Draft'   },
  { label: 'Sent',    value: 'Sent'    },
  { label: 'Partial', value: 'Partial' },
  { label: 'Paid',    value: 'Paid'    },
  { label: 'Overdue', value: 'Overdue' },
];

const STATUS_STYLE: Record<InvoiceStatus, string> = {
  Draft:   'bg-surface-container-highest text-on-surface-variant',
  Sent:    'bg-blue-50 text-blue-700',
  Partial: 'bg-amber-50 text-amber-700',
  Paid:    'bg-secondary-container text-on-secondary-container',
  Overdue: 'bg-error-container text-error',
  Void:      'bg-surface-container text-on-surface-variant/40',
  Cancelled: 'bg-gray-100 text-gray-500',
};

const TYPE_LABEL: Record<string, string> = {
  invoice:     'Tax Invoice',
  proforma:    'Proforma',
  advance:     'Advance',
  credit_note: 'Credit Note',
  receipt:     'Receipt',
};

function fmt(n: number) {
  return `₹${n.toLocaleString('en-IN')}`;
}

export default function Invoices() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'All'>('All');
  const [search, setSearch] = useState('');

  const { data: invoices, isLoading } = useQuery({
    queryKey: ['client_invoices'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_invoices')
        .select('*')
        .order('created_at', { ascending: false });
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

  const filtered = (invoices ?? []).filter(inv => {
    if (statusFilter !== 'All' && inv.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !inv.invoice_id.toLowerCase().includes(q) &&
        !clientName(inv.client_id).toLowerCase().includes(q) &&
        !(inv.subject ?? '').toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const totalOutstanding = (invoices ?? [])
    .filter(i => !['Paid', 'Void'].includes(i.status))
    .reduce((s, i) => s + Math.max(0, i.total_amount - i.paid_amount), 0);

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div>
          <h2 className="text-[24px] font-bold text-on-surface tracking-tight">Invoices</h2>
          <p className="text-[12px] text-on-surface-variant/50 mt-1">
            {invoices?.length ?? 0} invoices
            {totalOutstanding > 0 && (
              <span className="ml-2 text-amber-600 font-semibold">· {fmt(totalOutstanding)} outstanding</span>
            )}
          </p>
        </div>
        <Link
          to="/invoices/new"
          className="bk-btn hidden md:flex items-center gap-2 h-9 px-4 rounded-xl text-[13px]"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          New Invoice
        </Link>
      </div>

      {/* Search + Status filter */}
      <div className="flex flex-col md:flex-row gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant/40 pointer-events-none">search</span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search invoices…"
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

      {/* List */}
      {isLoading && <LinearProgress className="mb-4" />}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-24">
          <span className="material-symbols-outlined text-[64px] text-on-surface-variant/15 block mb-4">description</span>
          <p className="text-[15px] font-semibold text-on-surface-variant/40">
            {search || statusFilter !== 'All' ? 'No invoices match your filters' : 'No invoices yet'}
          </p>
          {!search && statusFilter === 'All' && (
            <Link to="/invoices/new" className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-primary font-semibold hover:underline">
              <span className="material-symbols-outlined text-[16px]">add</span>
              Create your first invoice
            </Link>
          )}
        </div>
      )}

      <div className="space-y-2">
        {filtered.map(inv => {
          const outstanding = Math.max(0, inv.total_amount - inv.paid_amount);
          return (
            <div
              key={inv.invoice_id}
              onClick={() => navigate(`/invoices/${inv.invoice_id}`)}
              className="bg-white rounded-xl border border-black/[0.06] shadow-sm hover:shadow-md transition-shadow cursor-pointer p-4 flex flex-col md:flex-row md:items-center gap-3"
            >
              {/* Left: ID + type + subject */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-data-mono text-[13px] font-bold text-on-surface">{inv.invoice_id}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant uppercase tracking-wide">
                    {TYPE_LABEL[inv.invoice_type] ?? inv.invoice_type}
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[inv.status]}`}>
                    {inv.status}
                  </span>
                </div>
                <p className="text-[13px] text-on-surface-variant mt-1 truncate">
                  {clientName(inv.client_id)}
                  {inv.project_id && (
                    <span className="text-on-surface-variant/40"> · {projectName(inv.project_id)}</span>
                  )}
                  {inv.subject && (
                    <span className="text-on-surface-variant/50"> · {inv.subject}</span>
                  )}
                </p>
              </div>

              {/* Right: amounts + date */}
              <div className="flex md:flex-col items-center md:items-end gap-3 md:gap-0.5 shrink-0">
                <span className="font-data-mono text-[15px] font-bold text-on-surface">
                  {fmt(inv.total_amount)}
                </span>
                {outstanding > 0 && inv.status !== 'Void' && (
                  <span className="font-data-mono text-[11px] text-amber-600 font-semibold">
                    {fmt(outstanding)} due
                  </span>
                )}
                <span className="text-[11px] text-on-surface-variant/40 md:mt-1">
                  {new Date(inv.invoice_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* FAB mobile */}
      <Link to="/invoices/new" className="bk-fab md:hidden" title="New Invoice">
        <span className="material-symbols-outlined text-[24px]">add</span>
      </Link>
    </div>
  );
}
