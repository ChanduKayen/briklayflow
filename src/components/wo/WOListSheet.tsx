// Contracts list — the exact visual of the purchase-orders list (POListSheet), wired to
// work-order data. Scoped under .polx so it shares the PO list's stylesheet verbatim; only
// one list is ever mounted at a time, so the duplicate <style> can't collide.
//
// Used by the main /work-orders page (pass projectId to scope to one project).
import type React from 'react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

// Identical to POListSheet's POLX_CSS (same .polx scope) so the two lists render pixel-for-pixel alike.
const POLX_CSS = `
.polx{
  --cream:#F6F2EA; --paper:#FFFDF9; --paper-2:#FBF8F2;
  --ink:#2F2622; --ink-2:#6E635B; --ink-3:#A39A91;
  --line:#E4DCD0; --line-2:#EFE9DF;
  --terra:#C4613A; --terra-deep:#A94E2B; --terra-tint:#F8E7DE;
  --sage:#5F7F5B; --sage-tint:#E7EFE4;
  --gold:#B8862E; --gold-tint:#F7EEDA;
  --r:8px; --ease:cubic-bezier(.2,.7,.2,1);
  --shadow:0 1px 2px rgba(47,38,34,.04),0 8px 24px -18px rgba(47,38,34,.25);
  --serif:Georgia,'Times New Roman',serif;
  --sans:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  --mono:ui-monospace,'SF Mono',Menlo,Consolas,monospace;
  background:#FBF9F6;color:var(--ink);font:15px/1.45 var(--sans);-webkit-font-smoothing:antialiased;min-height:100vh;
}
.polx *{box-sizing:border-box}
.polx button,.polx input{font:inherit;color:inherit}
.polx input::placeholder{color:var(--ink-3)}
.polx .mono{font-family:var(--mono);font-feature-settings:"tnum";font-variant-numeric:tabular-nums}
.polx .page{max-width:100%;margin:0 auto;padding:26px 32px 80px}
.polx .top{display:flex;align-items:center;gap:14px;margin-bottom:18px}
.polx h1{font:600 28px/1.1 var(--serif);margin:0;letter-spacing:-.01em}
.polx .top .count{font:500 13px var(--mono);color:var(--ink-2);background:var(--paper);border:1px solid var(--line);padding:5px 9px;border-radius:6px}
.polx .figs{display:grid;grid-template-columns:repeat(4,1fr);background:var(--paper);border:1px solid var(--line);border-radius:10px;overflow:hidden;box-shadow:var(--shadow);margin-bottom:18px}
.polx .figs>div{padding:14px 20px 12px;border-right:1px solid var(--line-2);position:relative;cursor:pointer;transition:background .15s}
.polx .figs>div:hover{background:var(--paper-2)}
.polx .figs>div:last-child{border-right:0}
.polx .figs>div::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:var(--line-2)}
.polx .figs .terra::before{background:var(--terra)}.polx .figs .gold::before{background:var(--gold)}.polx .figs .sage::before{background:var(--sage)}
.polx .figs small{display:block;font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2);margin-bottom:4px}
.polx .figs .mono{font-size:22px;font-weight:500;letter-spacing:-.01em}
.polx .figs .sub{font-size:12.5px;color:var(--ink-3);margin-top:2px}
.polx .figs .terra .mono{color:var(--terra)}
.polx .tools{display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.polx .search{position:relative;flex:1;min-width:240px;max-width:380px}
.polx .search svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:15px;height:15px;stroke:var(--ink-3);fill:none;stroke-width:1.8}
.polx .search input{width:100%;height:38px;border:1px solid var(--line);border-radius:var(--r);background:var(--paper);padding:0 12px 0 34px;outline:none;transition:border-color .15s,box-shadow .15s}
.polx .search input:focus{border-color:var(--terra);box-shadow:0 0 0 3px var(--terra-tint)}
.polx .chips{display:flex;gap:6px;flex-wrap:wrap}
.polx .chip{height:34px;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:var(--paper);color:var(--ink-2);cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-size:13.5px;font-weight:500;transition:background .15s,color .15s,border-color .15s,transform .12s}
.polx .chip:hover{background:var(--paper-2);border-color:var(--ink-3)}
.polx .chip:active{transform:scale(.96)}
.polx .chip .n{font-family:var(--mono);font-size:12px;color:var(--ink-3)}
.polx .chip.on{background:var(--ink);border-color:var(--ink);color:var(--paper)}
.polx .chip.on .n{color:rgba(255,253,249,.6)}
.polx .chip.on.warn{background:var(--terra);border-color:var(--terra)}
.polx .btn{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 16px;border-radius:var(--r);border:1px solid var(--terra);background:var(--terra);color:#fff;font-weight:500;cursor:pointer;transition:background .16s,transform .12s var(--ease),box-shadow .16s}
.polx .btn:hover{background:var(--terra-deep);border-color:var(--terra-deep);transform:translateY(-1px);box-shadow:0 6px 16px -8px rgba(196,97,58,.7)}
.polx .btn:active{transform:translateY(0) scale(.97);box-shadow:none;background:#93441F}
.polx .btn svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2}
.polx .sheet{background:var(--paper);border:1px solid var(--line);border-radius:10px;overflow:hidden;box-shadow:var(--shadow)}
.polx table{width:100%;border-collapse:collapse;table-layout:fixed}
.polx thead th{position:sticky;top:0;z-index:2;font-weight:500;font-size:12px;color:var(--ink-2);text-align:left;padding:10px 12px;background:var(--paper-2);border-bottom:1px solid var(--line);letter-spacing:.02em;white-space:nowrap;cursor:pointer;user-select:none;transition:color .15s}
.polx thead th:hover{color:var(--ink)}
.polx thead th .arr{display:inline-block;width:0;margin-left:4px;opacity:0;transition:opacity .15s;font-size:10px}
.polx thead th.sorted .arr{opacity:1}
.polx thead th.num,.polx td.num{text-align:right}
.polx tbody tr{cursor:pointer;transition:background .12s}
.polx tbody tr:hover td{background:var(--paper-2)}
.polx td{padding:10px 12px;border-bottom:1px solid var(--line-2);vertical-align:middle;height:58px}
.polx tbody tr:last-child td{border-bottom:0}
.polx .po b{display:block;font-weight:600;letter-spacing:-.005em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.polx .po .mono{font-size:12px;color:var(--ink-3)}
.polx .items{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:0}
.polx .items span.t{overflow:hidden;text-overflow:ellipsis;min-width:0}
.polx .items .more{display:inline-block;font:500 11px/1 var(--mono);color:var(--ink-2);background:var(--paper-2);border:1px solid var(--line-2);padding:3px 6px;border-radius:4px;margin-left:6px;vertical-align:1px;cursor:help}
.polx .items .more:hover{background:var(--terra-tint);border-color:transparent;color:var(--terra)}
.polx .site{color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.polx .when{white-space:nowrap}.polx .when small{display:block;color:var(--ink-3);font-size:12px}
.polx .dim{color:var(--ink-3)}
.polx .val{font-weight:500}
.polx .val small{display:block;font-size:11.5px;font-family:var(--sans);font-weight:400;color:var(--ink-3)}
.polx .val small.over{color:var(--terra)}
.polx .bal.owe{color:var(--terra);font-weight:500}.polx .bal.adv{color:var(--sage);font-weight:500}.polx .bal.nil{color:var(--sage)}.polx .bal small{font-size:10.5px;font-weight:600;opacity:.72;margin-left:1px}
.polx .dlv{white-space:nowrap}
.polx .dlv .late{color:var(--terra);font-weight:500}
.polx .dlv .due{color:var(--gold);font-weight:500}
.polx .dlv .ok{color:var(--sage);font-weight:500}
.polx .dlv .sent{color:#3b7bb5;font-weight:500}
.polx .dlv .none{color:var(--ink-2)}
.polx .dlv small{display:block;color:var(--ink-3);font-size:12px}
.polx .dlv small b{font-weight:500}
.polx .dlv .partial{display:inline-flex;align-items:center;gap:8px;font-weight:500;color:var(--gold)}
.polx .dlv .partial i{width:44px;height:6px;border-radius:3px;background:var(--line-2);position:relative;overflow:hidden}
.polx .dlv .partial i::after{content:"";position:absolute;left:0;top:0;bottom:0;width:var(--w);background:var(--gold);border-radius:3px}
.polx .dlv[data-tip]{cursor:help}
.polx tr.cancelled td{color:var(--ink-3)}.polx tr.cancelled .po b{text-decoration:line-through;color:var(--ink-3)}
.polx td.act{width:150px;text-align:right}
.polx .empty{padding:48px 20px;text-align:center;color:var(--ink-3)}
.polx .foot{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:var(--paper-2);border-top:1px solid var(--line);font-size:13px;color:var(--ink-2)}
.polx .foot .mono{color:var(--ink)}
.polx .tip{position:fixed;z-index:80;background:var(--ink);color:var(--paper);border-radius:8px;padding:8px 4px;min-width:220px;max-width:320px;font-size:13px;box-shadow:0 12px 30px -10px rgba(47,38,34,.5);pointer-events:none}
.polx .tip h4{margin:0 0 4px;padding:2px 10px;font:500 11px var(--sans);letter-spacing:.12em;text-transform:uppercase;color:rgba(255,253,249,.55)}
.polx .tip ul{list-style:none;margin:0;padding:0}
.polx .tip li{display:flex;align-items:center;gap:8px;padding:5px 10px;border-radius:5px}
.polx .tip li .q{font-family:var(--mono);color:rgba(255,253,249,.7);font-size:12px;white-space:nowrap}
.polx .tip li.r{color:rgba(255,253,249,.45)}.polx .tip li.r .q{color:rgba(255,253,249,.35)}
.polx .tip li .g{width:14px;flex:none;text-align:center}.polx .tip li .nm{flex:1}
.polx .tip li.r .g::before{content:"✓";color:#9DBB98}
.polx .tip li.p .g::before{content:"○";color:#E0B45B}
.polx .tip::after{content:"";position:absolute;left:18px;top:-5px;width:10px;height:10px;background:var(--ink);transform:rotate(45deg);border-radius:2px}
@media (max-width:980px){
  .polx .page{padding:16px 14px 60px}
  .polx .figs{grid-template-columns:1fr 1fr}
  .polx .sheet{overflow-x:auto}.polx table{min-width:1080px}
}
@media (prefers-reduced-motion:reduce){.polx *{animation-duration:.01ms !important;transition-duration:.01ms !important}}
`;

interface Stage { n: string; q: string; done: boolean }
interface WORow {
  id: string; worker: string; workerCat: string;
  site: string; issued: string;
  stages: Stage[]; scope: string;
  value: number; paid: number;
  status: string; cancelled: boolean;
}

const fmt = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const D = (s: string | null) => (s ? new Date(s) : new Date(NaN));
const dstr = (d: Date) => (isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));

const DONE_STATUS = new Set(['Paid']);        // a milestone counts as "done" once it's Paid

function useWOListData(projectId?: string) {
  const wosQ = useQuery({
    queryKey: ['wo_list_sheet', projectId ?? 'all'],
    queryFn: async () => {
      let q = supabase
        .from('work_orders')
        .select('wo_id, status, date_issued, created_at, order_value, scope_of_work, stakeholder_id, project_id, projects(name), stakeholders(name, category)')
        .order('created_at', { ascending: false });
      if (projectId) q = q.eq('project_id', projectId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
  const wos = wosQ.data ?? [];
  const woIds = wos.map((w: any) => w.wo_id);

  const milesQ = useQuery({
    queryKey: ['wo_list_miles', woIds],
    enabled: woIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wo_milestones')
        .select('wo_id, seq_no, name, status, planned_amount')
        .in('wo_id', woIds)
        .order('seq_no', { ascending: true });
      if (error) throw error;
      const m: Record<string, any[]> = {};
      (data ?? []).forEach((r: any) => { (m[r.wo_id] ||= []).push(r); });
      return m;
    },
  });

  const paidQ = useQuery({
    queryKey: ['wo_list_paid', projectId ?? 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('txn_allocations')
        .select('order_ref, allocated_amount, transactions!inner(status)')
        .eq('order_type', 'WO')
        .neq('transactions.status', 'Voided');
      if (error) throw error;
      const m: Record<string, number> = {};
      (data ?? []).forEach((r: any) => { if (r.order_ref) m[r.order_ref] = (m[r.order_ref] || 0) + (Number(r.allocated_amount) || 0); });
      return m;
    },
  });

  const rows: WORow[] = useMemo(() => {
    const miles = milesQ.data ?? {};
    const paid = paidQ.data ?? {};
    return wos.map((w: any): WORow => {
      const ms = (miles[w.wo_id] ?? []) as any[];
      const stages: Stage[] = ms.map(m => ({
        n: m.name || 'Stage',
        q: fmt(Number(m.planned_amount) || 0),
        done: DONE_STATUS.has(m.status),
      }));
      return {
        id: w.wo_id,
        worker: w.stakeholders?.name || 'Worker',
        workerCat: w.stakeholders?.category || '',
        site: w.projects?.name || '',
        issued: w.date_issued || w.created_at,
        stages,
        scope: w.scope_of_work || '',
        value: Number(w.order_value) || 0,
        paid: paid[w.wo_id] || 0,
        status: w.status || 'Draft',
        cancelled: w.status === 'Cancelled',
      };
    });
  }, [wos, milesQ.data, paidQ.data]);

  return { rows, isLoading: wosQ.isLoading };
}

export default function WOListSheet({ projectId }: { projectId?: string }) {
  const navigate = useNavigate();
  const { rows, isLoading } = useWOListData(projectId);
  const [filter, setFilter] = useState<'all' | 'active' | 'open' | 'closed'>('all');
  const [sortK, setSortK] = useState<'worker' | 'site' | 'issued' | 'progress' | 'value' | 'balance'>('issued');
  const [sortDir, setSortDir] = useState(-1);
  const [q, setQ] = useState('');
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);

  const balance = (p: WORow) => p.value - p.paid;
  const pctPaid = (p: WORow) => (p.value > 0 ? Math.min(100, Math.round((p.paid / p.value) * 100)) : 0);
  const doneStages = (p: WORow) => p.stages.filter(s => s.done).length;
  const closed = (p: WORow) => p.status === 'Closed';
  const openLive = (p: WORow) => !p.cancelled && !closed(p);

  const balCell = (p: WORow) => {
    if (p.cancelled) return <span className="dim">—</span>;
    const b = balance(p);
    if (b > 0.5) return <span className="bal owe">{fmt(b)}<small>Cr</small></span>;
    if (b < -0.5) return <span className="bal adv">{fmt(-b)}<small>Dr</small></span>;
    return <span className="bal nil">—</span>;
  };

  const FILTERS: Record<string, (p: WORow) => boolean> = {
    all: () => true,
    active: (p) => p.status === 'Active',
    open: openLive,
    closed,
  };
  const KEY: Record<string, (p: WORow) => number | string> = {
    worker: (p) => p.worker,
    site: (p) => p.site,
    issued: (p) => D(p.issued).getTime(),
    progress: (p) => (closed(p) ? 2 : p.paid > 0 ? 1 : 0),
    value: (p) => p.value,
    balance: (p) => balance(p),
  };

  const list = useMemo(() => {
    let l = rows.filter(FILTERS[filter]);
    if (q) l = l.filter(p => (p.worker + p.id + p.site + p.scope + p.stages.map(s => s.n).join(' ')).toLowerCase().includes(q));
    l = l.slice().sort((a, b) => { const x = KEY[sortK](a), y = KEY[sortK](b); return (x > y ? 1 : x < y ? -1 : 0) * sortDir; });
    return l;
  }, [rows, filter, q, sortK, sortDir]);

  const live = useMemo(() => rows.filter(openLive), [rows]);
  const fActive = rows.filter(p => p.status === 'Active').length;
  const fOpenCount = live.length;
  const fCommitted = live.reduce((a, p) => a + p.value, 0);
  const fBal = live.reduce((a, p) => a + Math.max(0, balance(p)), 0);
  const cAll = rows.length;
  const cActive = fActive;
  const cOpen = fOpenCount;
  const cClosed = rows.filter(closed).length;
  const footTotal = list.reduce((a, p) => a + (p.cancelled ? 0 : p.value), 0);

  const openWO = (id: string) => navigate(`/work-orders/${id}`, { state: projectId ? { from: 'project', projectId } : { from: 'list' } });
  const onSort = (k: typeof sortK) => {
    if (sortK === k) setSortDir(d => d * -1);
    else { setSortK(k); setSortDir(k === 'issued' || k === 'value' || k === 'balance' || k === 'progress' ? -1 : 1); }
  };
  const arr = (k: string) => (sortK === k ? (sortDir < 0 ? '▼' : '▲') : '▲');

  const progressCell = (p: WORow): React.ReactNode => {
    if (p.cancelled) return <span className="dim">—</span>;
    const pct = pctPaid(p);
    let status: React.ReactNode;
    if (closed(p)) status = <><span className="ok">✓ Closed</span><small>{p.paid > 0 ? `${fmt(p.paid)} paid` : 'no payments'}</small></>;
    else if (pct >= 100) status = <><span className="ok">✓ Fully paid</span><small>{p.stages.length ? `${p.stages.length} stage${p.stages.length > 1 ? 's' : ''}` : ''}</small></>;
    else if (p.paid > 0) status = (
      <>
        <span className="partial"><i style={{ ['--w' as any]: `${pct}%` }} />{pct}% paid</span>
        <small>{fmt(p.paid)} of {fmt(p.value)}{p.stages.length ? ` · ${doneStages(p)}/${p.stages.length} stages` : ''}</small>
      </>
    );
    else status = <><span className="none">{p.status}</span><small>{p.stages.length ? `${p.stages.length} stage${p.stages.length > 1 ? 's' : ''} · not started` : 'not started'}</small></>;
    return <div className="dlv">{status}</div>;
  };

  function showTip(e: React.MouseEvent, id: string) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ id, x: Math.max(8, r.left - 14), y: r.bottom + 10 });
  }
  const tipRow = tip ? rows.find(r => r.id === tip.id) : null;

  return (
    <div className="polx">
      <style>{POLX_CSS}</style>
      <div className="page">
        <div className="top">
          <h1>Contracts</h1>
          <span className="count">{rows.length}</span>
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => navigate('/work-orders/new', projectId ? { state: { projectId } } : undefined)}>
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>New contract
          </button>
        </div>

        <div className="figs">
          <div className="terra" onClick={() => setFilter('active')}><small>Active</small><span className="mono">{fActive}</span><div className="sub">work in progress</div></div>
          <div className="gold" onClick={() => setFilter('open')}><small>Open</small><span className="mono">{fOpenCount}</span><div className="sub">not yet closed</div></div>
          <div onClick={() => setFilter('open')}><small>Committed</small><span className="mono">{fmt(fCommitted)}</span><div className="sub">value of live contracts</div></div>
          <div className="sage" onClick={() => setFilter('all')}><small>Balance to workers</small><span className="mono">{fmt(fBal)}</span><div className="sub">across live contracts</div></div>
        </div>

        <div className="tools">
          <div className="search">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input placeholder="Worker, WO number, stage, site" value={q} onChange={(e) => setQ(e.target.value.trim().toLowerCase())} />
          </div>
          <div className="chips">
            <button className={`chip${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>All <span className="n">{cAll}</span></button>
            <button className={`chip warn${filter === 'active' ? ' on' : ''}`} onClick={() => setFilter('active')}>Active <span className="n">{cActive}</span></button>
            <button className={`chip${filter === 'open' ? ' on' : ''}`} onClick={() => setFilter('open')}>Open <span className="n">{cOpen}</span></button>
            <button className={`chip${filter === 'closed' ? ' on' : ''}`} onClick={() => setFilter('closed')}>Closed <span className="n">{cClosed}</span></button>
          </div>
        </div>

        <div className="sheet">
          <table>
            <colgroup><col style={{ width: '18%' }} /><col style={{ width: '20%' }} /><col style={{ width: '13%' }} /><col style={{ width: '11%' }} /><col style={{ width: '14%' }} /><col style={{ width: '12%' }} /><col style={{ width: '12%' }} /></colgroup>
            <thead><tr>
              <th className={sortK === 'worker' ? 'sorted' : ''} onClick={() => onSort('worker')}>Worker · WO<span className="arr">{arr('worker')}</span></th>
              <th style={{ cursor: 'default' }}>Stages</th>
              <th className={sortK === 'site' ? 'sorted' : ''} onClick={() => onSort('site')}>Site<span className="arr">{arr('site')}</span></th>
              <th className={sortK === 'issued' ? 'sorted' : ''} onClick={() => onSort('issued')}>Issued<span className="arr">{arr('issued')}</span></th>
              <th className={sortK === 'progress' ? 'sorted' : ''} onClick={() => onSort('progress')}>Progress<span className="arr">{arr('progress')}</span></th>
              <th className={`num${sortK === 'value' ? ' sorted' : ''}`} onClick={() => onSort('value')}>Value<span className="arr">{arr('value')}</span></th>
              <th className={`num${sortK === 'balance' ? ' sorted' : ''}`} onClick={() => onSort('balance')} title="Owed to worker = Credit · Advance = Debit">Balance<span className="arr">{arr('balance')}</span></th>
            </tr></thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="empty">Loading…</td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={7} className="empty">Nothing here. {filter === 'active' ? 'No active contracts right now.' : 'Try another filter.'}</td></tr>
              ) : list.map((p) => {
                const shown = p.stages.slice(0, 2).map(s => s.n).join(', ') || p.scope;
                const rest = Math.max(0, p.stages.length - 2);
                const siteShort = p.site.replace(' Residence', '').replace("'s", '');
                return (
                  <tr key={p.id} tabIndex={0} className={p.cancelled ? 'cancelled' : ''} onClick={() => openWO(p.id)} onKeyDown={(e) => { if (e.key === 'Enter') openWO(p.id); }}>
                    <td className="po"><b>{p.worker}</b><span className="mono">{p.id}</span></td>
                    <td><div className="items"><span className="t">{shown || <span className="dim">No stages</span>}</span>{rest > 0 && <span className="more" onMouseEnter={(e) => showTip(e, p.id)} onMouseLeave={() => setTip(null)}>+{rest} stage{rest > 1 ? 's' : ''}</span>}</div></td>
                    <td className="site" title={p.site}>{siteShort}</td>
                    <td className="when">{dstr(D(p.issued))}<small>{p.workerCat}</small></td>
                    <td>{progressCell(p)}</td>
                    <td className="num val">{p.cancelled ? <span className="dim">{fmt(p.value)}</span> : fmt(p.value)}</td>
                    <td className="num">{balCell(p)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="foot">
            <span>{list.length} contract{list.length !== 1 ? 's' : ''}{filter !== 'all' || q ? ' shown' : ''}</span>
            <span>Showing total <span className="mono">{fmt(footTotal)}</span></span>
          </div>
        </div>
      </div>

      {tip && tipRow && createPortal(
        <div className="polx"><div className="tip show" role="tooltip" style={{ left: tip.x, top: tip.y, opacity: 1, transform: 'none' }}>
          <h4>{tipRow.stages.length} stage{tipRow.stages.length !== 1 ? 's' : ''}</h4>
          <ul>{tipRow.stages.map((s, k) => (<li key={k} className={s.done ? 'r' : 'p'}><span className="g" /><span className="nm">{s.n}</span><span className="q">{s.q}</span></li>))}</ul>
        </div></div>,
        document.body,
      )}
    </div>
  );
}
