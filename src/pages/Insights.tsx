/**
 * Insights — the money page. One scrollable view that answers "where is my money
 * going?" at a glance, then lets the owner drill in:
 *   · KPI band            money out / in / net / this-month burn (with vs-previous delta)
 *   · By category (donut) MAT / WRK / GEN split, expandable into divisions
 *   · By project (bars)   ranked spend with budget-vs-actual
 *   · Over time           monthly out-vs-in trend
 *   · Top payees          who you pay most
 *   · Payment modes       cash / UPI / bank / cheque split
 *   · Leakage             spend not tied to any project
 *
 * Charts are hand-built SVG/CSS (no chart dependency). Amounts roll up from active
 * transactions: total_amount drives category/time/payee/mode totals; per-project
 * spend uses txn_allocations.allocated_amount (a txn can split across projects).
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams, useLocation } from 'react-router-dom';
import {
  IconArrowUpRight, IconArrowDownRight, IconTrendingUp, IconTrendingDown,
  IconWallet, IconChevronDown, IconAlertTriangle, IconFilter, IconX,
  IconArrowLeft, IconArrowRight, IconChartBar,
} from '@tabler/icons-react';
import { supabase } from '../lib/supabase';
import { useOrgId } from '../lib/auth/AuthProvider';
import { getCostCode } from '../lib/costCodes';
import { deriveDirection, payeeLabel } from '../lib/transactions';
import { PageSkeleton } from '../components/SkeletonLoader';

// ── palette ──────────────────────────────────────────────────────────────────
const INK = '#0b1c30';
const INK_SOFT = 'rgba(11,28,48,0.55)';
const FAINT = 'rgba(11,28,48,0.40)';
const LINE = 'rgba(11,28,48,0.08)';
const OUT = '#C45B39';      // spend / money out (terracotta)
const IN = '#2F7A4F';       // receipts / money in (green)
const CAT = { MAT: '#3B6FB0', WRK: '#C9863F', GEN: '#6B7280', Other: '#B7AEA2' } as const;
type CatKey = keyof typeof CAT;

const card: React.CSSProperties = {
  background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16,
  boxShadow: '0 8px 30px rgba(11,28,48,0.04)', padding: 20,
};
const h3: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: INK, margin: 0, letterSpacing: '-0.01em' };
const cap: React.CSSProperties = { fontSize: 11, color: FAINT, fontFamily: 'Manrope, sans-serif' };

// ── formatting ───────────────────────────────────────────────────────────────
const inrC = (n: number) => {
  const v = Math.round(n);
  const a = Math.abs(v);
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(2).replace(/\.?0+$/, '')}Cr`;
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(2).replace(/\.?0+$/, '')}L`;
  if (a >= 1e3) return `₹${(v / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return `₹${v.toLocaleString('en-IN')}`;
};
const inrFull = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

type Period = 'month' | 'quarter' | 'fy' | 'all';
const PERIODS: { key: Period; label: string }[] = [
  { key: 'month', label: 'This month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'fy', label: 'This FY' },
  { key: 'all', label: 'All time' },
];

// current + matched previous window (for the delta), as ISO date strings
function ranges(period: Period) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  let start: Date, prevStart: Date | null = null, prevEnd: Date | null = null;
  if (period === 'month') {
    start = new Date(y, m, 1); prevStart = new Date(y, m - 1, 1); prevEnd = start;
  } else if (period === 'quarter') {
    start = new Date(y, m - 2, 1); prevStart = new Date(y, m - 5, 1); prevEnd = start;
  } else if (period === 'fy') {
    const fy = m >= 3 ? y : y - 1;        // Indian FY starts 1 Apr
    start = new Date(fy, 3, 1); prevStart = new Date(fy - 1, 3, 1); prevEnd = start;
  } else {
    start = new Date(2000, 0, 1);
  }
  return {
    start: ymd(start), end: ymd(new Date(y, m, now.getDate() + 1)),
    prevStart: prevStart ? ymd(prevStart) : null,
    prevEnd: prevEnd ? ymd(prevEnd) : null,
  };
}

export default function Insights() {
  const orgId = useOrgId();
  // page state lives in the URL so the txn-detail "Back" can return to the exact
  // drill-down spot (period, explore mode, group-by, focus, expanded rows).
  const [sp, setSp] = useSearchParams();
  const period = (sp.get('p') as Period) || 'month';
  const showExplore = sp.get('x') === '1';
  const patchParams = (u: Record<string, string | null>) =>
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(u)) { if (v == null || v === '') n.delete(k); else n.set(k, v); }
      return n;
    }, { replace: true });
  const setPeriod = (p: Period) => patchParams({ p });
  const setShowExplore = (v: boolean) => patchParams({ x: v ? '1' : null });
  const [expandedCat, setExpandedCat] = useState<CatKey | null>(null);

  const { data: txns, isLoading } = useQuery({
    queryKey: ['insights_txns', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('txn_id, date, category, remarks, total_amount, payment_mode, status, stakeholder_id, ai_flag_data, stakeholders(name, type), txn_allocations(project_id, allocated_amount, order_type)')
        .eq('org_id', orgId)
        .eq('status', 'Active');
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: projects } = useQuery({
    queryKey: ['insights_projects', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('project_id, name').eq('org_id', orgId);
      if (error) throw error;
      return (data ?? []) as { project_id: string; name: string }[];
    },
  });

  const { data: budgets } = useQuery({
    queryKey: ['insights_budgets', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.from('project_budgets').select('project_id, planned_amount').eq('org_id', orgId);
      if (error) throw error;
      return (data ?? []) as { project_id: string; planned_amount: number }[];
    },
  });

  const projName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of projects ?? []) m[p.project_id] = p.name;
    return m;
  }, [projects]);

  const budgetByProject = useMemo(() => {
    const m: Record<string, number> = {};
    for (const b of budgets ?? []) m[b.project_id] = (m[b.project_id] || 0) + Number(b.planned_amount || 0);
    return m;
  }, [budgets]);

  const agg = useMemo(() => {
    const all = txns ?? [];
    const r = ranges(period);
    const inWin = (d: string, s: string, e: string) => d >= s && d < e;
    const cur = all.filter((t) => t.date && inWin(t.date, r.start, r.end));

    // headline totals (txn-level, accurate)
    let out = 0, inn = 0, thisMonthOut = 0;
    const monthStart = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    for (const t of cur) {
      const amt = Number(t.total_amount || 0);
      if (deriveDirection(t) === 'in') inn += amt;
      else { out += amt; if (t.date >= monthStart) thisMonthOut += amt; }
    }

    // previous-window out, for the delta
    let prevOut = 0;
    if (r.prevStart && r.prevEnd) {
      for (const t of all) {
        if (t.date && inWin(t.date, r.prevStart, r.prevEnd) && deriveDirection(t) === 'out')
          prevOut += Number(t.total_amount || 0);
      }
    }

    // by category (OUT) → top-level type + division drilldown
    const byType: Record<CatKey, number> = { MAT: 0, WRK: 0, GEN: 0, Other: 0 };
    const byDiv: Record<CatKey, Record<string, { name: string; value: number }>> = { MAT: {}, WRK: {}, GEN: {}, Other: {} };
    // by project (OUT, via allocations) + unlinked leakage
    const byProject: Record<string, number> = {};
    let unlinked = 0;
    // payees + modes (OUT)
    const byPayee: Record<string, number> = {};
    const byMode: Record<string, number> = {};
    // monthly trend (in & out)
    const byMonth: Record<string, { out: number; in: number }> = {};

    for (const t of cur) {
      const amt = Number(t.total_amount || 0);
      const dir = deriveDirection(t);
      const mo = t.date.slice(0, 7);
      (byMonth[mo] ||= { out: 0, in: 0 })[dir] += amt;
      if (dir === 'in') continue;

      const found = t.category ? getCostCode(t.category) : null;
      const type: CatKey = (found?.division.type as CatKey) || 'Other';
      byType[type] += amt;
      if (found) {
        const dc = found.division.code, dn = found.division.name;
        (byDiv[type][dc] ||= { name: dn, value: 0 }).value += amt;
      } else {
        (byDiv.Other['—'] ||= { name: 'Uncategorised', value: 0 }).value += amt;
      }

      const allocs: any[] = t.txn_allocations ?? [];
      if (allocs.length === 0) unlinked += amt;
      else for (const a of allocs) byProject[a.project_id] = (byProject[a.project_id] || 0) + Number(a.allocated_amount || 0);

      byPayee[payeeLabel(t)] = (byPayee[payeeLabel(t)] || 0) + amt;
      if (t.payment_mode) byMode[t.payment_mode] = (byMode[t.payment_mode] || 0) + amt;
    }

    const catSegments = (['MAT', 'WRK', 'GEN', 'Other'] as CatKey[])
      .filter((k) => byType[k] > 0)
      .map((k) => ({ key: k, label: catLabel(k), value: byType[k], color: CAT[k] }))
      .sort((a, b) => b.value - a.value);

    const projectRows = Object.entries(byProject)
      .map(([id, spend]) => ({ id, name: projName[id] || id, spend, budget: budgetByProject[id] || 0 }))
      .sort((a, b) => b.spend - a.spend);

    const payeeRows = Object.entries(byPayee).map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value).slice(0, 6);

    const modeRows = Object.entries(byMode).map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    const months = Object.keys(byMonth).sort().slice(-6).map((m) => ({ m, ...byMonth[m] }));

    return { out, inn, net: inn - out, thisMonthOut, prevOut, catSegments, byDiv, projectRows, payeeRows, modeRows, months, unlinked };
  }, [txns, period, projName, budgetByProject]);

  const showDelta = period !== 'all' && agg.prevOut > 0;
  const deltaPct = showDelta ? ((agg.out - agg.prevOut) / agg.prevOut) * 100 : 0;
  const empty = !isLoading && agg.out === 0 && agg.inn === 0;

  return (
    <div className="mobile-main-pb" style={{ padding: 24, maxWidth: 1080, margin: '0 auto', fontFamily: 'Manrope, sans-serif' }}>
      {/* header + period switch */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 22 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: INK, margin: 0 }}>Insights</h1>
          <p style={{ fontSize: 13, color: INK_SOFT, margin: '3px 0 0' }}>Where your money is going.</p>
        </div>
        <div style={{ display: 'inline-flex', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 3 }}>
          {PERIODS.map((p) => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              style={{
                padding: '6px 12px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, border: 'none', cursor: 'pointer',
                background: period === p.key ? INK : 'transparent', color: period === p.key ? '#fff' : INK_SOFT,
                transition: 'background .15s ease',
              }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <PageSkeleton />}

      {empty && (
        <div style={{ ...card, textAlign: 'center', padding: 48, color: FAINT }}>
          <IconWallet size={28} style={{ opacity: 0.4 }} />
          <p style={{ marginTop: 10, fontSize: 14, color: INK_SOFT }}>No transactions in this period yet.</p>
        </div>
      )}

      {!isLoading && !empty && showExplore && (
        <div className="ins-fade">
          <button onClick={() => setShowExplore(false)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 14, padding: '6px 4px', border: 'none', background: 'transparent', cursor: 'pointer', color: INK_SOFT, fontSize: 13, fontWeight: 600, fontFamily: 'Manrope, sans-serif' }}>
            <IconArrowLeft size={15} /> Overview
          </button>
          <Explore txns={txns ?? []} period={period} projName={projName} />
        </div>
      )}

      {!isLoading && !empty && !showExplore && (
        <>
          {/* ── KPI band ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 14 }}>
            <Kpi label="Money out" value={inrC(agg.out)} tone={OUT} icon={<IconArrowUpRight size={15} />}
              delta={showDelta ? deltaPct : null} deltaGoodWhenDown />
            <Kpi label="Money in" value={inrC(agg.inn)} tone={IN} icon={<IconArrowDownRight size={15} />} />
            <Kpi label="Net" value={`${agg.net < 0 ? '−' : ''}${inrC(Math.abs(agg.net))}`} tone={agg.net >= 0 ? IN : OUT}
              icon={agg.net >= 0 ? <IconTrendingUp size={15} /> : <IconTrendingDown size={15} />} />
            <Kpi label="Spent this month" value={inrC(agg.thisMonthOut)} tone={INK} icon={<IconWallet size={15} />} />
          </div>

          {/* ── leakage callout ── */}
          {agg.unlinked > 0 && (
            <Link to="/ledger" style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, padding: '14px 18px', textDecoration: 'none', background: 'rgba(196,91,57,0.05)', borderColor: 'rgba(196,91,57,0.2)' }}>
              <IconAlertTriangle size={18} color={OUT} />
              <span style={{ fontSize: 13, color: INK }}>
                <b>{inrFull(agg.unlinked)}</b> of spend isn’t linked to any project — <span style={{ color: OUT, fontWeight: 600 }}>review &amp; allocate ›</span>
              </span>
            </Link>
          )}

          {/* ── row: category donut + monthly trend ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 14 }}>
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <h3 style={h3}>Where it’s going</h3>
                <span style={cap}>by category</span>
              </div>
              <CategoryBreakdown segments={agg.catSegments} byDiv={agg.byDiv} total={agg.out}
                expanded={expandedCat} onToggle={(k) => setExpandedCat((c) => (c === k ? null : k))} />
            </div>

            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <h3 style={h3}>Over time</h3>
                <span style={{ display: 'inline-flex', gap: 12 }}>
                  <Dot c={OUT} t="Out" /><Dot c={IN} t="In" />
                </span>
              </div>
              <MonthlyTrend months={agg.months} />
            </div>
          </div>

          {/* ── the hero CTA into the full drill-down explorer ── */}
          <ExploreCTA onClick={() => setShowExplore(true)} />
        </>
      )}
    </div>
  );
}

// ── Explore CTA — the one button that opens the full drill-down ────────────────
function ExploreCTA({ onClick }: { onClick: () => void }) {
  return (
    <button className="ins-cta" onClick={onClick}>
      <span className="ins-cta__sheen" aria-hidden />
      <span className="ins-cta__icon"><IconChartBar size={22} /></span>
      <span className="ins-cta__text">
        <span className="ins-cta__title">Explore in detail</span>
        <span className="ins-cta__sub">Break spend down by category, project &amp; payee — drill to every bill</span>
      </span>
      <span className="ins-cta__arrow"><IconArrowRight size={20} /></span>
    </button>
  );
}

// ── labels ───────────────────────────────────────────────────────────────────
function catLabel(k: CatKey) {
  return k === 'MAT' ? 'Materials' : k === 'WRK' ? 'Works & labour' : k === 'GEN' ? 'General expenses' : 'Uncategorised';
}

// human category for a stored cost code: GEN → its head name, MAT/WRK → division name.
function catLabelOf(t: any): string {
  const code = t?.category;
  if (!code) return 'Uncategorised';
  const f = getCostCode(code);
  if (!f) return String(code);
  return f.division.type === 'GEN' ? f.item.name : f.division.name;
}

const MONTHS3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDay(d: string) {
  const p = (d || '').split('-');
  return p.length === 3 ? `${Number(p[2])} ${MONTHS3[Number(p[1]) - 1]}` : d;
}

// ── Explore: "group spend by A, then break down by B, then the real transactions" ──
type Dim = 'category' | 'project' | 'payee';
const DIM_OPTS: { key: Dim; label: string }[] = [
  { key: 'category', label: 'Category' },
  { key: 'project', label: 'Project' },
  { key: 'payee', label: 'Payee' },
];

function Explore({ txns, period, projName }: { txns: any[]; period: Period; projName: Record<string, string> }) {
  // all explore state lives in the URL → the txn-detail "Back" restores this exact view
  const [sp, setSp] = useSearchParams();
  const loc = useLocation();
  const a = (sp.get('a') as Dim) || 'category';
  const b = (sp.get('b') as Dim) || 'payee';
  const focusDim = (sp.get('fd') as Dim | 'all') || 'all';
  const focusVal = sp.get('fv') || '';
  const openA = sp.get('oa');
  const openB = sp.get('ob');   // key: `${aVal}∥${bVal}`
  const backTo = loc.pathname + loc.search;

  const patch = (u: Record<string, string | null>) =>
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(u)) { if (v == null || v === '') n.delete(k); else n.set(k, v); }
      return n;
    }, { replace: true });

  const setOpenA = (v: string | null) => patch({ oa: v, ob: null });
  const setOpenB = (v: string | null) => patch({ ob: v });
  const setFocusVal = (v: string) => patch({ fv: v || null, oa: null, ob: null });

  // keep the two grouping axes distinct (and distinct from the focus dim)
  const setAxisA = (v: Dim) => patch({ a: v, ...(v === b ? { b: DIM_OPTS.find((d) => d.key !== v && d.key !== focusDim)!.key } : {}), oa: null, ob: null });
  const setAxisB = (v: Dim) => patch({ b: v, ...(v === a ? { a: DIM_OPTS.find((d) => d.key !== v && d.key !== focusDim)!.key } : {}), oa: null, ob: null });

  // pick a focus dimension → fix it, group by the OTHER two automatically
  const focusByDim = (d: Dim | 'all') => {
    if (d === 'all') { patch({ fd: null, fv: null, oa: null, ob: null }); return; }
    const o = DIM_OPTS.filter((x) => x.key !== d).map((x) => x.key);
    patch({ fd: d, fv: null, a: o[0], b: o[1], oa: null, ob: null });
  };
  // tap a group row → scope to it and re-pivot on the remaining two dims
  const focusOn = (dim: Dim, value: string) => {
    const o = DIM_OPTS.filter((x) => x.key !== dim).map((x) => x.key);
    patch({ fd: dim, fv: value, a: o[0], b: o[1], oa: null, ob: null });
  };
  const clearFocus = () => patch({ fd: null, fv: null, oa: null, ob: null });

  const dimVal = (dim: Dim, t: any, projLabel: string) =>
    dim === 'category' ? catLabelOf(t) : dim === 'payee' ? payeeLabel(t) : projLabel;

  // value list for the focus dropdown — the dim's values ranked by spend
  const focusValues = useMemo(() => {
    if (focusDim === 'all') return [] as string[];
    const r = ranges(period);
    const tally: Record<string, number> = {};
    for (const t of txns) {
      if (!t.date || t.date < r.start || t.date >= r.end || deriveDirection(t) === 'in') continue;
      if (focusDim === 'project') {
        const allocs: any[] = t.txn_allocations ?? [];
        if (!allocs.length) tally['Unlinked / no project'] = (tally['Unlinked / no project'] || 0) + Number(t.total_amount || 0);
        else for (const al of allocs) { const pl = projName[al.project_id] || al.project_id || 'Unlinked / no project'; tally[pl] = (tally[pl] || 0) + Number(al.allocated_amount || 0); }
      } else {
        const v = focusDim === 'category' ? catLabelOf(t) : payeeLabel(t);
        tally[v] = (tally[v] || 0) + Number(t.total_amount || 0);
      }
    }
    return Object.entries(tally).sort((x, y) => y[1] - x[1]).map(([k]) => k);
  }, [txns, period, focusDim, projName]);

  const model = useMemo(() => {
    const r = ranges(period);
    const useProject = a === 'project' || b === 'project' || focusDim === 'project';
    const active = focusDim !== 'all' && !!focusVal;

    type Rec = { a: string; b: string; amount: number; t: any };
    const recs: Rec[] = [];
    for (const t of txns) {
      if (!t.date || t.date < r.start || t.date >= r.end) continue;
      if (deriveDirection(t) === 'in') continue;            // spend only
      const total = Number(t.total_amount || 0);
      const emit = (pl: string, amt: number) => {
        if (active) {
          const fv = focusDim === 'project' ? pl : focusDim === 'category' ? catLabelOf(t) : payeeLabel(t);
          if (fv !== focusVal) return;
        }
        recs.push({ a: dimVal(a, t, pl), b: dimVal(b, t, pl), amount: amt, t });
      };
      if (useProject) {
        const allocs: any[] = t.txn_allocations ?? [];
        if (!allocs.length) emit('Unlinked / no project', total);
        else for (const al of allocs) emit(projName[al.project_id] || al.project_id || 'Unlinked / no project', Number(al.allocated_amount || 0));
      } else {
        emit('', total);
      }
    }

    const grand = recs.reduce((s, x) => s + x.amount, 0);
    const aMap = new Map<string, { total: number; txns: Set<string>; b: Map<string, { total: number; recs: Rec[] }> }>();
    for (const rec of recs) {
      const ag = aMap.get(rec.a) ?? { total: 0, txns: new Set<string>(), b: new Map() };
      ag.total += rec.amount; ag.txns.add(rec.t.txn_id);
      const bg = ag.b.get(rec.b) ?? { total: 0, recs: [] };
      bg.total += rec.amount; bg.recs.push(rec);
      ag.b.set(rec.b, bg); aMap.set(rec.a, ag);
    }
    const rows = [...aMap.entries()]
      .map(([name, v]) => ({
        name, total: v.total, count: v.txns.size,
        subs: [...v.b.entries()].map(([bn, bv]) => ({ name: bn, total: bv.total, recs: bv.recs.sort((x, y) => (y.t.date || '').localeCompare(x.t.date || '')) }))
          .sort((x, y) => y.total - x.total),
      }))
      .sort((x, y) => y.total - x.total);
    return { rows, grand };
  }, [txns, period, a, b, focusDim, focusVal, projName]);

  const aLabel = DIM_OPTS.find((d) => d.key === a)!.label;
  const bLabel = DIM_OPTS.find((d) => d.key === b)!.label;
  const focusActive = focusDim !== 'all' && !!focusVal;

  return (
    <div>
      {/* group-by + filter control */}
      <div style={{ ...card, padding: '14px 18px', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: INK_SOFT, fontWeight: 500 }}>Group by</span>
          <DimSelect value={a} onChange={setAxisA} />
          <span style={{ fontSize: 13, color: FAINT }}>then</span>
          <DimSelect value={b} onChange={setAxisB} />
          <span style={{ flex: 1, minWidth: 12 }} />
          <span style={{ fontSize: 12, color: FAINT }}>Total spend&nbsp;</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: INK }}>{inrC(model.grand)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 11, paddingTop: 11, borderTop: `1px solid ${LINE}` }}>
          <IconFilter size={14} color={FAINT} />
          <span style={{ fontSize: 13, color: INK_SOFT, fontWeight: 500 }}>Filter by</span>
          <FocusDimSelect value={focusDim} onChange={focusByDim} />
          {focusDim !== 'all' && (
            <select value={focusVal} onChange={(e) => setFocusVal(e.target.value)}
              style={selectStyle}>
              <option value="">Choose…</option>
              {focusValues.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          )}
          {focusActive && (
            <button onClick={clearFocus}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: 99, border: 'none', cursor: 'pointer', background: 'rgba(196,91,57,0.1)', color: OUT, fontSize: 12, fontWeight: 600 }}>
              {focusVal} <IconX size={12} />
            </button>
          )}
        </div>
      </div>

      {model.rows.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: 36, color: FAINT, fontSize: 13 }}>No spend to break down here.</div>
      ) : (
        <div style={{ ...card, padding: 6 }}>
          {model.rows.map((row, i) => {
            const aOpen = openA === row.name;
            const pct = model.grand ? Math.round((row.total / model.grand) * 100) : 0;
            return (
              <div key={row.name} style={{ borderTop: i ? `1px solid ${LINE}` : 'none' }}>
                {/* level 1 — group A */}
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button onClick={() => setOpenA(aOpen ? null : row.name)}
                    style={{ display: 'flex', alignItems: 'center', gap: 11, flex: 1, minWidth: 0, padding: '13px 4px 13px 12px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}>
                    <IconChevronDown size={15} color={FAINT} style={{ flexShrink: 0, transform: aOpen ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: INK, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{inrC(row.total)}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1 }}><Track><Fill w={pct} c={OUT} /></Track></div>
                        <span style={{ fontSize: 11, color: FAINT, width: 64, textAlign: 'right', flexShrink: 0 }}>{pct}% · {row.count} txn{row.count > 1 ? 's' : ''}</span>
                      </div>
                    </div>
                  </button>
                  <FocusBtn onClick={() => focusOn(a, row.name)} title={`Focus on ${row.name}`} />
                </div>

                {/* level 2 — group B within A */}
                {aOpen && (
                  <div style={{ paddingLeft: 30, paddingBottom: 8 }}>
                    {row.subs.map((sub) => {
                      const bKey = `${row.name}∥${sub.name}`;
                      const bOpen = openB === bKey;
                      const bw = row.total ? (sub.total / row.total) * 100 : 0;
                      return (
                        <div key={bKey}>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            <button onClick={() => setOpenB(bOpen ? null : bKey)}
                              style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 1, minWidth: 0, padding: '9px 4px 9px 10px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}>
                              <IconChevronDown size={13} color={FAINT} style={{ flexShrink: 0, transform: bOpen ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }} />
                              <span style={{ fontSize: 12.5, color: INK_SOFT, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub.name}</span>
                              <div style={{ width: 80, flexShrink: 0 }}><Track><Fill w={bw} c="rgba(196,91,57,0.55)" /></Track></div>
                              <span style={{ fontSize: 12.5, fontWeight: 600, color: INK, width: 64, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{inrC(sub.total)}</span>
                            </button>
                            <FocusBtn onClick={() => focusOn(b, sub.name)} title={`Focus on ${sub.name}`} />
                          </div>

                          {/* level 3 — the actual transactions */}
                          {bOpen && (
                            <div style={{ paddingLeft: 22, paddingBottom: 6 }}>
                              {sub.recs.map((rec, ri) => (
                                <Link key={rec.t.txn_id + ri} to={`/ledger/${rec.t.txn_id}`}
                                  state={{ backTo, backLabel: 'Insights' }}
                                  className="ins-txn"
                                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', textDecoration: 'none', borderRadius: 8 }}>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 12.5, color: INK_SOFT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {rec.t.remarks?.trim() || payeeLabel(rec.t)}
                                    </div>
                                    {/* txn no · date — a small ledger reference, for trust */}
                                    <div style={{ fontSize: 10.5, color: FAINT, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                                      {rec.t.txn_id} · {fmtDay(rec.t.date)}
                                    </div>
                                  </div>
                                  <span style={{ fontSize: 12.5, fontWeight: 600, color: OUT, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{inrFull(rec.amount)}</span>
                                </Link>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p style={{ ...cap, marginTop: 10, paddingLeft: 4 }}>
        Money out{focusActive ? ` · ${focusVal}` : ''} · grouped by {aLabel.toLowerCase()}, then {bLabel.toLowerCase()}. Tap a row to drill in, or ⊕ to focus.
      </p>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  appearance: 'none', WebkitAppearance: 'none', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 9,
  padding: '6px 26px 6px 11px', fontSize: 13, fontWeight: 600, color: INK, cursor: 'pointer', fontFamily: 'Manrope, sans-serif',
  maxWidth: 200, textOverflow: 'ellipsis',
  backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%230b1c3066\' stroke-width=\'2.5\'%3E%3Cpath d=\'M6 9l6 6 6-6\'/%3E%3C/svg%3E")',
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
};

function FocusBtn({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} title={title}
      style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, marginRight: 6, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', color: FAINT }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(11,28,48,0.05)'; e.currentTarget.style.color = OUT; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = FAINT; }}>
      <IconFilter size={14} />
    </button>
  );
}

function DimSelect({ value, onChange }: { value: Dim; onChange: (v: Dim) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Dim)} style={selectStyle}>
      {DIM_OPTS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
    </select>
  );
}

function FocusDimSelect({ value, onChange }: { value: Dim | 'all'; onChange: (v: Dim | 'all') => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Dim | 'all')} style={selectStyle}>
      <option value="all">Nothing (all spend)</option>
      {DIM_OPTS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
    </select>
  );
}

// ── KPI card ─────────────────────────────────────────────────────────────────
function Kpi({ label, value, tone, icon, delta, deltaGoodWhenDown }: {
  label: string; value: string; tone: string; icon: React.ReactNode; delta?: number | null; deltaGoodWhenDown?: boolean;
}) {
  const up = (delta ?? 0) >= 0;
  const good = deltaGoodWhenDown ? !up : up;
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: tone, marginBottom: 8 }}>
        <span style={{ display: 'inline-flex', width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', background: hexA(tone, 0.1) }}>{icon}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: INK_SOFT, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      </div>
      <p style={{ fontSize: 24, fontWeight: 700, color: INK, margin: 0, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      {delta != null && (
        <p style={{ margin: '6px 0 0', fontSize: 11.5, fontWeight: 600, color: good ? IN : OUT, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          {up ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}% <span style={{ color: FAINT, fontWeight: 400 }}>vs last</span>
        </p>
      )}
    </div>
  );
}

// ── category donut + drilldown ────────────────────────────────────────────────
function CategoryBreakdown({ segments, byDiv, total, expanded, onToggle }: {
  segments: { key: CatKey; label: string; value: number; color: string }[];
  byDiv: Record<CatKey, Record<string, { name: string; value: number }>>;
  total: number; expanded: CatKey | null; onToggle: (k: CatKey) => void;
}) {
  if (!segments.length) return <p style={{ ...cap, padding: '20px 0' }}>No outgoing spend in this period.</p>;
  const divs = expanded
    ? Object.values(byDiv[expanded]).sort((a, b) => b.value - a.value)
    : [];
  const divMax = Math.max(...divs.map((d) => d.value), 1);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: 152, height: 152, flexShrink: 0 }}>
          <Donut segments={segments} size={152} stroke={20} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 10, color: FAINT, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total out</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: INK, letterSpacing: '-0.02em' }}>{inrC(total)}</span>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          {segments.map((s) => {
            const pct = total ? Math.round((s.value / total) * 100) : 0;
            const on = expanded === s.key;
            return (
              <button key={s.key} onClick={() => onToggle(s.key)}
                style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 6px', borderRadius: 8, border: 'none', cursor: 'pointer', background: on ? 'rgba(11,28,48,0.04)' : 'transparent', textAlign: 'left' }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: INK, fontWeight: 500, flex: 1 }}>{s.label}</span>
                <span style={{ fontSize: 12.5, color: INK, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{inrC(s.value)}</span>
                <span style={{ fontSize: 11, color: FAINT, width: 30, textAlign: 'right' }}>{pct}%</span>
                <IconChevronDown size={13} color={FAINT} style={{ transform: on ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
              </button>
            );
          })}
        </div>
      </div>

      {expanded && divs.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${LINE}` }}>
          <p style={{ ...cap, marginBottom: 10 }}>{catLabel(expanded)} · breakdown</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {divs.map((d) => (
              <div key={d.name}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: INK_SOFT }}>{d.name}</span>
                  <span style={{ fontSize: 12, color: INK, fontWeight: 600 }}>{inrC(d.value)}</span>
                </div>
                <Track><Fill w={(d.value / divMax) * 100} c={CAT[expanded]} /></Track>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Donut({ segments, size = 152, stroke = 20 }: { segments: { value: number; color: string }[]; size?: number; stroke?: number }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(11,28,48,0.05)" strokeWidth={stroke} />
        {segments.map((s, i) => {
          const dash = (s.value / total) * c;
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={stroke}
              strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-acc} />
          );
          acc += dash;
          return el;
        })}
      </g>
    </svg>
  );
}

// ── monthly trend (paired bars) ───────────────────────────────────────────────
function MonthlyTrend({ months }: { months: { m: string; out: number; in: number }[] }) {
  if (!months.length) return <p style={{ ...cap, padding: '20px 0' }}>Not enough history yet.</p>;
  const max = Math.max(...months.flatMap((x) => [x.out, x.in]), 1);
  const H = 132;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: H }}>
      {months.map((x) => {
        const [yy, mm] = x.m.split('-');
        const label = new Date(Number(yy), Number(mm) - 1).toLocaleString('default', { month: 'short' });
        return (
          <div key={x.m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: H - 22, width: '100%', justifyContent: 'center' }}>
              <Bar h={(x.out / max) * (H - 22)} c={OUT} title={`Out ${inrFull(x.out)}`} />
              <Bar h={(x.in / max) * (H - 22)} c={IN} title={`In ${inrFull(x.in)}`} />
            </div>
            <span style={{ fontSize: 10.5, color: FAINT }}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function Bar({ h, c, title }: { h: number; c: string; title: string }) {
  return <div title={title} style={{ width: 14, height: Math.max(h, 2), background: c, borderRadius: '4px 4px 0 0', transition: 'height .2s' }} />;
}

// ── tiny primitives ───────────────────────────────────────────────────────────
function Track({ children }: { children: React.ReactNode }) {
  return <div style={{ height: 7, background: 'rgba(11,28,48,0.06)', borderRadius: 99, overflow: 'hidden' }}>{children}</div>;
}
function Fill({ w, c }: { w: number; c: string }) {
  return <div style={{ height: '100%', width: `${Math.max(w, 1.5)}%`, background: c, borderRadius: 99, transition: 'width .3s ease' }} />;
}
function Dot({ c, t }: { c: string; t: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: INK_SOFT }}><span style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{t}</span>;
}
function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
