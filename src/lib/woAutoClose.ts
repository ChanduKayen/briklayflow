import { QueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

export async function autoCloseWOIfFullyPaid(woId: string, qc: QueryClient): Promise<void> {
  const { data: wo } = await supabase
    .from('work_orders')
    .select('order_value, status')
    .eq('wo_id', woId)
    .single();

  if (!wo || Number(wo.order_value) <= 0) return;
  if (['Closed', 'Cancelled', 'Settled'].includes(wo.status)) return;

  const { data: allocs } = await supabase
    .from('txn_allocations')
    .select('allocated_amount')
    .eq('order_ref', woId)
    .eq('order_type', 'WO');

  const totalPaid = (allocs || []).reduce((s: number, a: any) => s + Number(a.allocated_amount), 0);

  if (totalPaid >= Number(wo.order_value)) {
    const { error } = await supabase
      .from('work_orders')
      .update({ status: 'Closed' })
      .eq('wo_id', woId);
    if (!error) {
      qc.invalidateQueries({ queryKey: ['work_order', woId] });
      qc.invalidateQueries({ queryKey: ['project_wos_v2'] });
      qc.invalidateQueries({ queryKey: ['orders_wos'] });
      qc.invalidateQueries({ queryKey: ['wo_allocations', woId] });
    }
  }
}
