import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { PageSkeleton } from '../components/SkeletonLoader';
import { V, font } from '../components/day-book/tokens';

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN');
const initialsOf = (name: string) =>
  (name || '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '—';

/** Status → warm tone, mirroring the web orders palette (done=sage, waiting=amber,
 *  closed=muted, otherwise neutral). Keeps the mobile cards consistent with desktop. */
function statusTone(status: string): { color: string; bg: string } {
  const s = (status || '').toLowerCase();
  if (/tallied|complete|closed|approved|paid|delivered|done/.test(s)) return { color: V.sage, bg: V.sageWash };
  if (/cancel|void|reject/.test(s))                                   return { color: V.faint, bg: V.field };
  if (/draft|pending|await|quote|sent/.test(s))                       return { color: V.ask, bg: V.askWash };
  return { color: V.inkSoft, bg: V.field };
}

export default function Orders({ session: _ }: { session: Session }) {
  const [tab, setTab] = useState<'po' | 'wo'>('po');
  const navigate = useNavigate();

  const { data: pos, isLoading: posLoading } = useQuery({
    queryKey: ['orders_pos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
          po_id, date_issued, total_value, order_value, status,
          stakeholders(name),
          po_line_items(item_name)
        `)
        .order('created_at', { ascending: false })
        .limit(60);
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: wos, isLoading: wosLoading } = useQuery({
    queryKey: ['orders_wos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_orders')
        .select(`
          wo_id, date_issued, scope_of_work, order_value, status,
          stakeholders(name)
        `)
        .order('created_at', { ascending: false })
        .limit(60);
      if (error) throw error;
      return data as any[];
    },
  });

  const list    = tab === 'po' ? (pos ?? []) : (wos ?? []);
  const loading = tab === 'po' ? posLoading  : wosLoading;

  return (
    <div className="px-4 pt-4 pb-24" style={{ background: V.page, minHeight: '100vh', ...font }}>
      {/* Segmented toggle — warm sliding pill (the one feature kept from the simple view) */}
      <div className="relative flex p-1 rounded-xl mb-4" style={{ background: V.field }}>
        <span
          aria-hidden
          className="absolute top-1 bottom-1 rounded-lg"
          style={{
            width: 'calc(50% - 4px)', left: 4, background: V.surface,
            boxShadow: '0 1px 3px rgba(30,26,21,0.12)',
            transform: tab === 'wo' ? 'translateX(100%)' : 'none',
            transition: 'transform .22s cubic-bezier(.3,.7,.3,1)',
          }}
        />
        {(['po', 'wo'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="relative z-10 flex-1 h-9 text-[13px] font-semibold rounded-lg"
            style={{ color: tab === t ? V.terraDeep : V.faint, transition: 'color .2s ease' }}
          >
            {t === 'po' ? 'Purchase Orders' : 'Work Orders'}
          </button>
        ))}
      </div>

      {loading && <div className="mb-4"><PageSkeleton /></div>}

      <div className="space-y-2.5">
        {list.map((row: any) => {
          const isPo  = tab === 'po';
          const id    = isPo ? row.po_id : row.wo_id;
          const path  = isPo ? `/purchase-orders/${id}` : `/work-orders/${id}`;
          const party = (row.stakeholders as any)?.name ?? '—';
          const items = isPo ? (row.po_line_items ?? []) : null;
          const title = isPo ? party : (row.scope_of_work || id);
          const sub   = isPo
            ? (items.length > 0 ? items.map((i: any) => i.item_name).join(', ') : id)
            : party;
          const value = Number(isPo ? (row.total_value ?? row.order_value ?? 0) : (row.order_value ?? 0));
          const tone  = statusTone(row.status);
          const date  = row.date_issued
            ? new Date(row.date_issued).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
            : null;

          return (
            <button
              key={id}
              type="button"
              onClick={() => navigate(path)}
              className="w-full text-left rounded-2xl p-3.5 active:scale-[0.99] transition-transform"
              style={{ background: V.surface, border: `1px solid ${V.line}`, boxShadow: '0 1px 2px rgba(30,26,21,0.04)' }}
            >
              <div className="flex items-start gap-3">
                <span
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-[12px] font-semibold"
                  style={{ background: V.terraWash, color: V.terraDeep }}
                  aria-hidden
                >
                  {initialsOf(party !== '—' ? party : title)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-medium truncate" style={{ color: V.ink }}>{title}</p>
                    <p className="text-[14px] font-semibold tabular-nums shrink-0" style={{ color: V.ink }}>{inr(value)}</p>
                  </div>
                  <p className="text-[12px] truncate mt-0.5" style={{ color: V.sys }}>{sub} · {id}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: tone.bg, color: tone.color }}>
                      {row.status}
                    </span>
                    {date && <span className="text-[11px] tabular-nums" style={{ color: V.faint }}>{date}</span>}
                  </div>
                </div>
              </div>
            </button>
          );
        })}

        {!loading && list.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-[14px]" style={{ color: V.faint }}>No {tab === 'po' ? 'purchase orders' : 'work orders'} yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
