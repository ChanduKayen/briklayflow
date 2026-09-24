// Mobile Contracts (Work Orders) LIST — an exact port of the contracts-mobile reference, wired to real
// work orders. Stages = wo_milestones, paid = WO txn allocations, "work done" = milestones in a done
// status. The reference's own tab bar is dropped (the app's nav is used); the FAB routes to New.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { CONTRACTS_MOBILE_CSS } from './contractsMobileCss';

// Indian-grouped rupee formatting — matches the reference exactly.
function inr(n: number) { const s = String(Math.round(n)); if (s.length <= 3) return s; return s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3); }
const rs = (n: number) => '₹' + inr(Math.max(0, Math.round(n)));

const DONE = new Set(['Completed', 'Approved', 'Paid']);   // a milestone that counts as work done

export interface WoCard {
  id: string; worker: string; trade: string; wo: string; site: string;
  stages: string[]; agreed: number; paid: number; done: number;
  pctPaid: number; pctDone: number; out: number; status: 'progress' | 'new' | 'closed'; closed: boolean;
}

// One shared loader — mirrors WOListSheet's three reads, plus a milestone-status "done" sum for the bar.
export function useContractCards() {
  const head = useQuery({
    queryKey: ['cm_wo_head'],
    queryFn: async () => (await supabase.from('work_orders')
      .select('wo_id, status, date_issued, created_at, order_value, scope_of_work, stakeholder_id, project_id, projects(name), stakeholders(name, category)')
      .order('created_at', { ascending: false })).data ?? [],
  });
  const ids = (head.data ?? []).map((r: any) => r.wo_id);
  const miles = useQuery({
    queryKey: ['cm_wo_miles', ids],
    enabled: ids.length > 0,
    queryFn: async () => (await supabase.from('wo_milestones')
      .select('wo_id, seq_no, name, status, planned_amount').in('wo_id', ids).order('seq_no')).data ?? [],
  });
  const paid = useQuery({
    queryKey: ['cm_wo_paid'],
    queryFn: async () => (await supabase.from('txn_allocations')
      .select('order_ref, allocated_amount, transactions!inner(status)')
      .eq('order_type', 'WO').neq('transactions.status', 'Voided')).data ?? [],
  });

  const cards: WoCard[] = useMemo(() => {
    const milesBy: Record<string, any[]> = {};
    (miles.data ?? []).forEach((m: any) => { (milesBy[m.wo_id] ??= []).push(m); });
    const paidBy: Record<string, number> = {};
    (paid.data ?? []).forEach((a: any) => { paidBy[a.order_ref] = (paidBy[a.order_ref] || 0) + Number(a.allocated_amount || 0); });
    return (head.data ?? []).map((r: any) => {
      const ms = milesBy[r.wo_id] ?? [];
      const agreed = Number(r.order_value || 0);
      const p = paidBy[r.wo_id] || 0;
      const done = ms.reduce((t, m) => t + (DONE.has(m.status) ? Number(m.planned_amount || 0) : 0), 0);
      const closed = r.status === 'Closed' || r.status === 'Cancelled';
      const status: WoCard['status'] = closed ? 'closed' : (p > 0 || done > 0) ? 'progress' : 'new';
      return {
        id: r.wo_id, worker: r.stakeholders?.name || 'Worker', trade: r.stakeholders?.category || '',
        wo: r.wo_id, site: r.projects?.name || '', stages: ms.map((m) => m.name).filter(Boolean),
        agreed, paid: p, done, out: Math.max(0, agreed - p),
        pctPaid: agreed ? Math.min(100, p / agreed * 100) : 0,
        pctDone: agreed ? Math.min(100, done / agreed * 100) : 0,
        status, closed,
      };
    });
  }, [head.data, miles.data, paid.data]);

  return { cards, isLoading: head.isLoading };
}

const FILTERS: [WoCard['status'] | 'all', string][] = [['all', 'All'], ['progress', 'In progress'], ['new', 'Not started'], ['closed', 'Closed']];

export default function ContractsMobile() {
  const navigate = useNavigate();
  const { cards, isLoading } = useContractCards();
  const [filter, setFilter] = useState<WoCard['status'] | 'all'>('all');
  const [query, setQuery] = useState('');

  const counts = useMemo(() => {
    const c = { all: cards.length, progress: 0, new: 0, closed: 0 } as Record<string, number>;
    cards.forEach((x) => { c[x.status]++; });
    return c;
  }, [cards]);

  const live = cards.filter((c) => !c.closed);
  const committed = live.reduce((t, c) => t + c.agreed, 0);
  const paidSum = live.reduce((t, c) => t + c.paid, 0);

  const rows = useMemo(() => {
    const ql = query.trim().toLowerCase();
    return cards.filter((c) => (filter === 'all' || c.status === filter) &&
      (!ql || [c.worker, c.wo, c.site, ...c.stages].join(' ').toLowerCase().includes(ql)));
  }, [cards, filter, query]);

  return (
    <div className="cmx">
      <style>{CONTRACTS_MOBILE_CSS}</style>
      <section className="view v-list">
        <header className="l-head"><h1 className="t1">Contracts</h1><span className="count">{cards.length}</span></header>

        <div className="sum">
          <div className="sum-top"><span className="eyebrow">Balance to workers</span><span className="sum-live">{live.length} live contracts</span></div>
          <div className="sum-amt">{rs(committed - paidSum)}</div>
          <div className="sum-cap">still to pay across live contracts</div>
          <div className="bar" aria-hidden="true"><i style={{ width: `${committed ? paidSum / committed * 100 : 0}%` }} /></div>
          <div className="sum-legend"><span><b>{rs(paidSum)}</b> paid</span><span>of <b>{rs(committed)}</b> committed</span></div>
        </div>

        <div className="l-sticky">
          <label className={`search ${query ? 'has' : ''}`}>
            <span className="sr">Search contracts</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input type="search" placeholder="Worker, WO, site or stage" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" enterKeyHint="search" />
            <button type="button" className="icon-btn" aria-label="Clear search" onClick={() => setQuery('')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </label>
          <div className="filters" role="group" aria-label="Filter">
            {FILTERS.map(([k, t]) => (
              <button key={k} className="fchip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{t}<span>{counts[k]}</span></button>
            ))}
          </div>
        </div>

        <div className="l-list">
          {isLoading ? <div className="empty">Loading…</div>
            : rows.length ? rows.map((c, i) => <Card key={c.id} c={c} i={i} onOpen={() => navigate(`/work-orders/${c.id}`)} />)
              : <div className="empty">No contracts match{query ? ` “${query}”` : ''}.</div>}
        </div>
        {rows.length > 0 && <p className="l-foot">{rows.length} contract{rows.length > 1 ? 's' : ''} · {rs(rows.reduce((t, c) => t + c.agreed, 0))} agreed</p>}
      </section>
    </div>
  );
}

function Card({ c, i, onOpen }: { c: WoCard; i: number; onOpen: () => void }) {
  const shown = c.stages.slice(0, 2).join(', '); const extra = c.stages.length - 2;
  const ST = { progress: ['In progress', 'p-progress'], new: ['Not started', 'p-new'], closed: ['Closed', 'p-closed'] } as const;
  const [label, cls] = ST[c.status];
  return (
    <button className={`cc ${c.closed ? 'closed' : ''}`} style={{ ['--i' as string]: Math.min(i, 12) }} onClick={onOpen}>
      <div className="cc-top"><span className="cc-name">{c.worker}</span><span className={`pill ${cls}`}>{label}</span></div>
      <div className="cc-meta"><span className="mono">{c.wo}</span><span>·</span><span>{c.site}</span></div>
      <div className="cc-stages">{shown || '—'}{extra > 0 ? <span className="more">+{extra} stages</span> : null}</div>
      <div className="bar" aria-hidden="true"><i className="done" style={{ width: `${c.pctDone}%` }} /><i className="paid" style={{ width: `${c.pctPaid}%` }} /></div>
      <div className="cc-money">
        <span><b>{rs(c.paid)}</b> of {rs(c.agreed)} paid</span>
        {c.closed ? <span className="settled">Settled</span> : <span className="due"><b>{rs(c.out)}</b> due</span>}
      </div>
    </button>
  );
}
