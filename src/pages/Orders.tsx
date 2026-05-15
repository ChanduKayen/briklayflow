import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { LinearProgress } from '../components/LinearProgress';

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
    <div className="px-4 pt-4 pb-24">
      {/* Segmented toggle */}
      <div style={{
        display: 'flex', background: 'rgba(0,0,0,0.05)',
        borderRadius: 8, padding: 3, marginBottom: 16,
      }}>
        {(['po', 'wo'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, height: 32, borderRadius: 6,
              fontSize: 11, fontWeight: 500,
              border: tab === t ? '0.5px solid rgba(0,0,0,0.1)' : 'none',
              background: tab === t ? '#000' : 'transparent',
              color: tab === t ? '#fff' : 'rgba(0,0,0,0.55)',
              cursor: 'pointer', transition: 'all 150ms',
            }}
          >
            {t === 'po' ? 'Purchase Orders' : 'Work Orders'}
          </button>
        ))}
      </div>

      {loading && <LinearProgress />}

      <div className="space-y-2">
        {list.map((row: any) => {
          const isPo   = tab === 'po';
          const id     = isPo ? row.po_id : row.wo_id;
          const path   = isPo ? `/purchase-orders/${id}` : `/work-orders/${id}`;
          const items  = isPo ? (row.po_line_items ?? []) : null;
          const party  = (row.stakeholders as any)?.name ?? '—';
          const title  = isPo ? party : (row.scope_of_work || row.wo_id);
          const sub    = isPo
            ? (items.length > 0 ? items.map((i: any) => i.item_name).join(', ') : id)
            : ((row.stakeholders as any)?.name ?? id);
          const value  = Number(isPo ? (row.total_value ?? row.order_value ?? 0) : (row.order_value ?? 0));

          return (
            <div
              key={id}
              onClick={() => navigate(path)}
              className="bg-white rounded-xl border border-black/[0.06] p-3 cursor-pointer active:bg-surface-container-low"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-on-surface truncate">{title}</p>
                  <p className="text-[11px] text-on-surface-variant/55 mt-0.5 line-clamp-1">{sub} · {id}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[13px] font-medium font-data-mono">
                    ₹{value.toLocaleString('en-IN')}
                  </p>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant">
                    {row.status}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {!loading && list.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-[14px] text-on-surface-variant/50">No {tab === 'po' ? 'purchase orders' : 'work orders'} found</p>
          </div>
        )}
      </div>
    </div>
  );
}
