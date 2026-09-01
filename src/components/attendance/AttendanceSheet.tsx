// Attendance — a live, per-project labour muster. This is the exact visual and
// interaction model of the attendance.html reference, wired to Supabase via
// attendanceApi: the reference's in-memory DATA/CARD are loaded from the labour_*
// tables, and every cell edit / rate change / add persists back. The grid render
// stays imperative (a faithful port of the reference script) inside a scoped root.
import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { useOrgId } from '../../lib/auth/AuthProvider';
import { useSnackbar } from '../Snackbar';
import {
  loadWeek, loadParties, mondayOf, weekDates, weekLabel,
  saveCell, saveRate, setCategoryRate, setDirectRate, setCrewBasis, addCategory, addDirectWorker, addCrew,
  loadWorkOrdersForProject, linkCrewToWorkOrder,
  cardIsEmpty, seedRateCard, SUPERVISOR_KEY,
  type SiteRow, type RateCard, type Cell,
} from '../../lib/attendanceApi';
import { searchPayees } from '../../lib/payeeSearch';
import { createParty } from '../day-book/fileEntry';

const ATDX_CSS = `
.atdx{background:var(--cream);color:var(--walnut);font:15px/1.45 "DM Sans",system-ui,sans-serif;-webkit-font-smoothing:antialiased;padding:34px 28px 80px;
  --cream:#f6f2ea;--paper:#fdfbf7;--line:#e6dfd2;--line-2:#d5cbb9;--walnut:#3b2f27;--walnut-2:#6d5f54;--walnut-3:#9c9083;
  --terracotta:#b8613a;--terracotta-bg:#f7e9e1;--sage:#5f7a5e;--sage-bg:#e9efe6;--slate:#5b6b78;--slate-bg:#e8ecef}
.atdx *{box-sizing:border-box}
.atdx button,.atdx input,.atdx select{font:inherit;color:inherit}
.atdx button{background:none;border:0;cursor:pointer;padding:0}
.atdx :focus-visible{outline:2px solid var(--walnut);outline-offset:2px;border-radius:6px}
.atdx .mono{font-family:"DM Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}
.atdx .wrap{width:100%;max-width:1180px;margin:0 auto}
.atdx .top{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-bottom:18px;flex-wrap:wrap}
.atdx h1{font:400 38px/1.05 "Playfair Display",serif}
.atdx .lede{color:var(--walnut-2);margin-top:8px;font-size:15px;max-width:640px}
.atdx .lede .wa{color:#25a55a;font-weight:500}
.atdx .week{display:flex;align-items:center;gap:10px}
.atdx .week .nav{width:32px;height:32px;border-radius:50%;border:1px solid var(--line);color:var(--walnut-2);display:grid;place-items:center}
.atdx .week .range{font:500 18px "Playfair Display",serif;min-width:170px;text-align:center}
.atdx .week .today{font-size:13px;color:var(--walnut-2);text-decoration:underline;text-decoration-color:var(--line-2);text-underline-offset:3px;margin-left:6px}
.atdx .summ{display:flex;gap:26px;margin:0 0 18px;padding:14px 18px;background:var(--paper);border:1px solid var(--line);border-radius:12px;align-items:center;flex-wrap:wrap}
.atdx .summ .s .l{font-size:12px;color:var(--walnut-3)}
.atdx .summ .s .v{font-size:19px;font-weight:500;margin-top:1px}
.atdx .summ .s .v.warn{color:var(--terracotta)}
.atdx .summ .sp{flex:1}
.atdx .filters{display:flex;gap:6px;flex-wrap:wrap}
.atdx .chip{border:1px solid var(--line);border-radius:999px;padding:4px 11px;font-size:13px;color:var(--walnut-2);background:var(--paper)}
.atdx .chip[aria-pressed=true]{background:var(--walnut);color:var(--paper);border-color:var(--walnut)}
.atdx .reg{background:var(--paper);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.atdx table{width:100%;border-collapse:collapse}
.atdx th,.atdx td{padding:0;text-align:center}
.atdx thead th{font-size:12px;font-weight:500;color:var(--walnut-3);padding:10px 6px;border-bottom:1px solid var(--line)}
.atdx thead th .dn{display:block;font:500 15px "Playfair Display",serif;color:var(--walnut-2);margin-top:1px}
.atdx thead th.is-today,.atdx thead th.is-today .dn{color:var(--terracotta)}
.atdx thead th.sun,.atdx td.sun{background:#f9f6f0}
.atdx th.name{text-align:left;padding-left:18px;width:290px}
.atdx th.tot{text-align:right;padding-right:18px;width:220px}
.atdx td.cell{width:72px;position:relative;font-size:15px}
.atdx td.cell.is-today{box-shadow:inset 2px 0 0 var(--terracotta-bg),inset -2px 0 0 var(--terracotta-bg)}
.atdx tr.gap td{background:var(--cream);height:16px;padding:0;border:0}
.atdx tr.site td{background:var(--paper);text-align:left;padding:13px 18px 11px;font:500 16px "Playfair Display",serif;letter-spacing:0;text-transform:none;color:var(--walnut);border-top:2px solid var(--line-2);box-shadow:inset 4px 0 0 var(--terracotta)}
.atdx tr.site td span{letter-spacing:0;text-transform:none;font:400 12.5px "DM Sans",sans-serif;color:var(--walnut-3);margin-left:12px}
.atdx .wageslbl{margin-top:6px;font-size:12px;color:var(--walnut-3)}
.atdx .oncontract{font-size:12px;color:var(--terracotta);font-weight:500;text-decoration:underline;text-decoration-color:color-mix(in srgb,var(--terracotta) 40%,transparent);text-underline-offset:2px}
.atdx .oncontract:hover{text-decoration-color:var(--terracotta)}
.atdx .ocsel{font-size:12.5px}
.atdx tr.crew td{border-top:1px solid var(--line);padding-top:8px}
.atdx tr.crew td.name{text-align:left;padding:12px 18px 4px}
.atdx tr.crew .n{font-weight:600}
.atdx tr.crew .d{font-size:12.5px;color:var(--walnut-3)}
.atdx tr.crew td.cell{font-size:15px;font-weight:600;height:38px}
.atdx tr.crew td.tot{text-align:right;padding:10px 18px 2px;font-size:13.5px}
.atdx tr.crew td.tot .v{font-weight:600}
.atdx tr.crew td.tot .u{font-size:12.5px;color:var(--walnut-3)}
.atdx tr.crew td.tot .u b{color:var(--sage);font-weight:500}
.atdx .seg{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:2px;background:var(--cream);margin-top:6px}
.atdx .seg button{padding:2px 10px;border-radius:999px;font-size:12px;color:var(--walnut-3)}
.atdx .seg button[aria-pressed=true]{background:var(--paper);color:var(--walnut);font-weight:500;box-shadow:0 1px 2px rgba(59,47,39,.08)}
.atdx tr.sub td{height:38px}
.atdx tr.sub td.name{text-align:left;padding:0 18px 0 34px;font-size:13.5px;color:var(--walnut-2)}
.atdx tr.sub td.name .rt{font-size:12px;color:var(--walnut-3);margin-left:6px}
.atdx .rt[data-rate]{cursor:text;border-bottom:1px dashed transparent}
.atdx .rt[data-rate]:hover{border-bottom-color:var(--line-2);color:var(--walnut)}
.atdx .rt input{width:54px;border:0;border-bottom:1px solid var(--walnut);background:transparent;font:inherit;padding:0}
.atdx .rt input:focus{outline:none}
.atdx tr.sub td.name .st{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--walnut-3);margin-left:8px}
.atdx tr.sub td.tot{text-align:right;padding:0 18px;font-size:12.5px;color:var(--walnut-3)}
.atdx tr.sub td.tot b{color:var(--walnut);font-weight:500}
.atdx tr.sub.last td{padding-bottom:8px}
.atdx .stsel{appearance:none;-webkit-appearance:none;border:0;background:transparent;font:inherit;color:var(--walnut-2);padding:2px 18px 2px 0;cursor:pointer;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%239c9083' stroke-width='1.4'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 2px center;max-width:230px;text-overflow:ellipsis}
.atdx .stsel:hover{color:var(--walnut)}
.atdx .stsel:focus{outline:none;border-bottom:1px solid var(--walnut)}
.atdx .stsel.ghost{color:var(--walnut-3);font-size:13px}
.atdx .c{width:100%;height:100%;display:grid;place-items:center;cursor:text;border-radius:8px;min-height:34px}
.atdx .c:hover{background:var(--cream)}
.atdx .c.wa{font-weight:500;color:var(--walnut)}
.atdx .c.office{color:var(--walnut-2)}
.atdx .c.gap{color:var(--terracotta);font-size:14px}
.atdx .c.off{color:var(--line-2);cursor:default}
.atdx .c.paid::after{content:"";position:absolute;bottom:4px;left:50%;transform:translateX(-50%);width:14px;height:2px;border-radius:1px;background:var(--sage);opacity:.55}
.atdx .c input{width:48px;text-align:center;border:0;border-bottom:1.5px solid var(--walnut);background:transparent;font-size:15px;padding:0}
.atdx .c input:focus{outline:none}
.atdx .c .half{color:var(--walnut-2)}
.atdx .c .zero{color:var(--line-2)}
.atdx .c.qty{font-size:13.5px}
.atdx .c.qty small{font-size:11px;color:var(--walnut-3);margin-left:2px}
.atdx .bar{height:4px;background:var(--line);border-radius:2px;margin-top:5px;position:relative;overflow:hidden;width:120px;margin-left:auto}
.atdx .bar i{position:absolute;left:0;top:0;bottom:0;background:var(--slate)}
.atdx .bar b{position:absolute;top:0;bottom:0;background:var(--terracotta)}
.atdx tr.direct td{border-top:1px solid var(--line);height:46px}
.atdx tr.direct td.name{text-align:left;padding:8px 18px}
.atdx tr.direct .n{font-weight:500}
.atdx tr.direct .d{font-size:12.5px;color:var(--walnut-3)}
.atdx tr.direct td.tot{text-align:right;padding:8px 18px;font-size:13.5px}
.atdx tr.direct td.tot .v{font-weight:500}
.atdx tr.direct td.tot .u{font-size:12.5px;color:var(--walnut-3)}
.atdx tr.direct td.tot .u b{color:var(--sage);font-weight:500}
.atdx tr.add td{border-top:1px solid var(--line);text-align:left;padding:18px 18px 20px;background:var(--cream)}
.atdx tr.add button.pill{height:40px;padding:0 18px 0 14px;font-size:14px;font-weight:500;border-radius:10px;display:inline-flex;align-items:center;gap:9px;border:1px solid var(--line-2);background:var(--paper);color:var(--walnut)}
.atdx tr.add button.pill:hover{border-color:var(--walnut)}
.atdx tr.add button.pill.main{background:var(--walnut);color:var(--paper);border-color:var(--walnut)}
.atdx tr.add button.pill.main:hover{background:#2a211b}
.atdx tr.add .new{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.atdx tr.add .new input,.atdx tr.add .new select{height:38px;border:1px solid var(--line-2);border-radius:9px;background:var(--paper);padding:0 12px;font-size:14px}
.atdx tr.add .new input:focus,.atdx tr.add .new select:focus{outline:none;border-color:var(--walnut)}
.atdx tr.add .new input{width:200px}
.atdx tr.add .x{font-size:13px;color:var(--walnut-3);margin-left:4px}
.atdx .pp{position:relative;display:inline-block}
.atdx .psearch{height:38px;border:1px solid var(--line-2);border-radius:9px;background:var(--paper);padding:0 12px;font-size:14px;width:260px}
.atdx .psearch:focus{outline:none;border-color:var(--walnut)}
.atdx .ppmenu{position:absolute;left:0;top:calc(100% + 4px);z-index:5;min-width:280px;background:var(--paper);border:1px solid var(--line-2);border-radius:10px;box-shadow:0 10px 28px -12px rgba(59,47,39,.35);padding:4px;max-height:300px;overflow:auto}
.atdx .ppitem{display:block;width:100%;text-align:left;padding:8px 10px;border-radius:7px;font-size:13.5px;color:var(--walnut)}
.atdx .ppitem:hover{background:var(--cream)}
.atdx .ppitem small{color:var(--walnut-3)}
.atdx .ppitem.ppcreate{color:var(--walnut-2);border-top:1px solid var(--line);margin-top:2px;font-weight:500}
.atdx .ppitem.ppcreate b{color:var(--walnut)}
.atdx .ppempty{padding:8px 10px;color:var(--walnut-3);font-size:13px}
.atdx .tip{position:absolute;z-index:3;background:var(--walnut);color:var(--paper);font-size:12.5px;padding:7px 10px;border-radius:8px;white-space:nowrap;pointer-events:none;transform:translate(-50%,-110%);left:50%;top:0;display:none}
.atdx td.cell:hover .tip{display:block}
.atdx .legend{display:flex;gap:22px;padding:12px 18px;font-size:12.5px;color:var(--walnut-3);border-top:1px solid var(--line);flex-wrap:wrap}
.atdx .legend span{display:inline-flex;align-items:center;gap:7px}
.atdx .legend .sw{width:22px;text-align:center;font-size:14px}
.atdx .legend .sw.wa{font-weight:500;color:var(--walnut)}
.atdx .legend .sw.off{color:var(--walnut-2)}
.atdx .legend .sw.gap{color:var(--terracotta)}
.atdx .legend .pl{width:14px;height:2px;background:var(--sage);opacity:.6;display:inline-block}
.atdx .rc{background:var(--paper);border:1px solid var(--line);border-radius:14px;overflow:hidden;margin-bottom:18px}
.atdx .rc-h{display:flex;align-items:baseline;gap:14px;padding:14px 18px 10px;flex-wrap:wrap}
.atdx .rc-h .t{font:500 18px "Playfair Display",serif}
.atdx .rc-h .s{font-size:13px;color:var(--walnut-3)}
.atdx .rc th{font-size:12px;font-weight:500;color:var(--walnut-3);padding:8px 10px;text-align:right;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.atdx .rc th.cat{text-align:left;padding-left:18px;width:200px}
.atdx .rc th .p{display:block;font:500 14px "Playfair Display",serif;color:var(--walnut-2)}
.atdx .rc td{padding:0;text-align:right;border-bottom:1px solid var(--line);height:40px}
.atdx .rc td.cat{text-align:left;padding-left:18px;font-size:14px}
.atdx .rc tr.grp td{background:var(--cream);height:28px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--walnut-3);text-align:left;padding-left:18px}
.atdx .rc .cc{display:flex;justify-content:flex-end;align-items:baseline;gap:6px;padding:0 14px;height:100%;cursor:text;width:100%}
.atdx .rc .cc:hover{background:rgba(59,47,39,.04)}
.atdx .rc .cc .v{font-weight:500}
.atdx .rc .cc .since{font-size:11px;color:var(--walnut-3)}
.atdx .rc .cc input{width:60px;text-align:right;border:0;border-bottom:1.5px solid var(--walnut);background:transparent;font-size:14px;padding:0}
.atdx .rc .cc input:focus{outline:none}
.atdx .rc-f{padding:11px 18px;font-size:13px;border-top:1px solid var(--line)}
.atdx .rc-f button{color:var(--walnut-2);font-weight:500;display:inline-flex;align-items:center;gap:6px}
.atdx .rc-f button:hover{color:var(--walnut)}
.atdx .state{padding:60px 18px;text-align:center;color:var(--walnut-3);font-size:14px}
.atdx .hide{display:none!important}
`;

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const isoOf = (d: Date) => d.toISOString().slice(0, 10);

export default function AttendanceSheet({ session }: { session: Session }) {
  const orgId = useOrgId();
  const navigate = useNavigate();
  const { show: showSnackbar } = useSnackbar();
  const byName = (session.user?.user_metadata?.name as string) || (session.user?.user_metadata?.full_name as string) || session.user?.email || 'Office';

  const rootRef = useRef<HTMLDivElement>(null);
  const DATA = useRef<SiteRow[]>([]);
  const CARD = useRef<RateCard | null>(null);
  const PARTIES = useRef<{ stakeholder_id: string; name: string; category: string | null }[]>([]);
  const filterRef = useRef<string>('all');
  const seededRef = useRef(false);

  const [monday, setMonday] = useState<Date>(() => mondayOf(new Date()));
  const [rcOpen, setRcOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const dates = weekDates(monday);
  const todayISO = isoOf(new Date());
  const TODAY = todayISO > dates[6] ? 6 : todayISO < dates[0] ? -1 : dates.indexOf(todayISO);

  // ── rate helpers (ported from the reference, reading the live CARD) ──────────
  const rateFor = useCallback((trade: string | null, cat: string): number => {
    const C = CARD.current; if (!C) return 0;
    if (cat === 'Supervisor') return C.supervisor ?? 0;
    if (cat === 'Helper · male') return (trade ? C.trades[trade]?.hm : null) ?? C.unskilled.hm ?? 0;
    if (cat === 'Helper · female') return (trade ? C.trades[trade]?.hf : null) ?? C.unskilled.hf ?? 0;
    return C.trades[cat]?.skilled ?? 0;
  }, []);
  const mixFor = useCallback((trade: string | null): string[] =>
    trade ? [trade, 'Helper · male', 'Helper · female'].filter(c => c !== 'Helper · female' || (CARD.current?.trades[trade]?.hf ?? null) != null)
          : ['Helper · male', 'Helper · female'], []);

  // ── load a week + build the in-memory model, then render ─────────────────────
  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      let [{ sites, card }, parties] = await Promise.all([loadWeek(monday), loadParties()]);
      // First visit for a fresh org: seed the starter rate card, then re-read so the
      // page opens with sensible defaults instead of an empty card.
      if (cardIsEmpty(card) && !seededRef.current) {
        seededRef.current = true;
        try { await seedRateCard(orgId); const r2 = await loadWeek(monday); sites = r2.sites; card = r2.card; } catch { /* seeding is best-effort */ }
      }
      DATA.current = sites; CARD.current = card; PARTIES.current = parties;
      setLoading(false);
      requestAnimationFrame(() => { render(); if (rcOpen) renderCard(); });
    } catch (e: any) {
      setErr(e?.message || 'Could not load attendance'); setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monday]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!loading && rcOpen) renderCard(); if (!loading && !rcOpen) { const t = rootRef.current?.querySelector('#atdxRc') as HTMLElement | null; if (t) t.hidden = true; } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rcOpen, loading]);

  // ── grid render (faithful port) ──────────────────────────────────────────────
  const q = (sel: string) => rootRef.current?.querySelector(sel) as HTMLElement | null;
  const col = (i: number) => (i === TODAY ? ' is-today' : '') + (i === 6 ? ' sun' : '');
  const sum = (cells: Cell[]) => cells.reduce((s, c) => s + ((c && c !== 'off') ? c.v : 0), 0);
  const tip = (c: any) => c.by ? `<div class="tip">${c.v} · ${c.by} · ${c.at || ''}${c.photo ? ' · photo' : ''}</div>` : '';

  function numCell(c: Cell, i: number, ref: string, paidThrough?: number) {
    if (c === 'off') return `<td class="cell${col(i)}"><div class="c off">·</div></td>`;
    if (!c) return `<td class="cell${col(i)}"><div class="c ${i <= TODAY ? 'gap' : 'off'}" data-edit="${ref}">${i <= TODAY ? '—' : ''}</div></td>`;
    const paid = paidThrough != null && i <= paidThrough ? ' paid' : '';
    return `<td class="cell${col(i)}"><div class="c ${c.src}${paid}" data-edit="${ref}">${c.v === 0 ? '<span class="zero">0</span>' : c.v}${tip(c)}</div></td>`;
  }
  function dayCell(c: Cell, i: number, ref: string) {
    if (c === 'off') return `<td class="cell${col(i)}"><div class="c off">·</div></td>`;
    if (!c) return `<td class="cell${col(i)}"><div class="c ${i <= TODAY ? 'gap' : 'off'}" data-cycle="${ref}">${i <= TODAY ? '—' : ''}</div></td>`;
    const t = c.v === 1 ? '1' : c.v === 0.5 ? '<span class="half">½</span>' : '<span class="zero">0</span>';
    return `<td class="cell${col(i)}"><div class="c ${c.src} mono" data-cycle="${ref}">${t}${c.at ? `<div class="tip">${c.at}</div>` : ''}</div></td>`;
  }
  function qtyCell(c: Cell, i: number, ref: string, unit?: string) {
    if (c === 'off') return `<td class="cell${col(i)}"><div class="c off">·</div></td>`;
    if (!c) return `<td class="cell${col(i)}"><div class="c off qty" data-edit="${ref}"></div></td>`;
    return `<td class="cell${col(i)}"><div class="c ${c.src} qty" data-edit="${ref}">${c.v}<small>${unit || ''}</small>${tip(c)}</div></td>`;
  }
  function pctCell(c: Cell, i: number, ref: string, prev: number) {
    if (c === 'off') return `<td class="cell${col(i)}"><div class="c off">·</div></td>`;
    if (!c) return `<td class="cell${col(i)}"><div class="c off qty" data-edit="${ref}"></div></td>`;
    const drop = c.v < prev ? ' style="color:var(--terracotta)"' : '';
    return `<td class="cell${col(i)}"><div class="c ${c.src} qty" data-edit="${ref}"${drop}>${c.v}<small>%</small>${tip(c)}</div></td>`;
  }
  const latestPct = (st: any) => st.cells.reduce((p: number, c: Cell) => (c && c !== 'off') ? c.v : p, st.before);
  function stageMath(st: any) {
    if (st.type === 'lump') {
      const pct = latestPct(st), earned = (st.amount || 0) * pct / 100;
      return { earned, prog: pct / 100, pct, label: `<b>${pct}%</b> of ${inr(st.amount || 0)} · ${inr(earned)}` };
    }
    const done = st.before + sum(st.cells), earned = done * (st.rate || 0);
    return { earned, prog: st.total ? done / st.total : 0, pct: st.total ? Math.round(done / st.total * 100) : 0,
             label: `<b>${done.toLocaleString('en-IN')}</b> / ${(st.total || 0).toLocaleString('en-IN')} ${st.unit || ''} · ${inr(earned)}` };
  }

  function render() {
    const body = q('#atdxBody'); if (!body) return;
    let wd = 0, wv = 0, we = 0, gaps = 0;
    body.innerHTML = DATA.current.map((site, si) => {
      // A clear gap band before every project except the first, so sites read as separate blocks.
      let html = si > 0 ? `<tr class="gap" data-site="${site.site}"><td colspan="9"></td></tr>` : '';
      html += `<tr class="site" data-site="${site.site}"><td colspan="9">${site.label}${site.hint ? `<span>${site.hint}</span>` : ''}</td></tr>`;
      site.crews.forEach((crew, ci) => {
        const days = sum(crew.head); wd += days;
        crew.head.forEach((c, i) => { if (!c && i <= TODAY) gaps++; });
        const wage = crew.cats.reduce((s, cat) => s + sum(cat.cells) * cat.rate, 0);
        const earned = crew.stages.reduce((s, st) => s + stageMath(st).earned - st.paid, 0);
        const onContract = crew.basis === 'contract';
        if (onContract) we += earned; else wv += wage;
        const seg = crew.contract
          ? `<div class="seg"><button data-basis="${si}.${ci}.contract" aria-pressed="${onContract}">Contract</button><button data-basis="${si}.${ci}.labour" aria-pressed="${!onContract}">Labour</button></div>`
          : `<div class="wageslbl" data-wageslbl="${si}.${ci}">Daily wages · not on a contract · <button class="oncontract" data-oncontract="${si}.${ci}">put on contract</button></div>`;
        html += `<tr class="crew" data-site="${site.site}">
          <td class="name"><div class="n">${crew.n}</div><div class="d">${crew.d}${crew.contract ? ' · contract' : ''}</div>${seg}</td>
          ${crew.head.map((c, i) => numCell(c, i, `${si}.h${ci}`, crew.paidThrough)).join('')}
          <td class="tot"><div class="v">${days} worker-days</div><div class="u">${onContract
            ? `<b>earned, unpaid</b> ${inr(earned)}`
            : (wage ? `<b>wages, unpaid</b> ${inr(wage)}` : '')}</div></td></tr>`;
        if (onContract) {
          (crew as any).shown = (crew as any).shown || crew.stages.map((_st, ki) => ki).filter((ki) => {
            const m = stageMath(crew.stages[ki]); const st = crew.stages[ki];
            return !((m.pct >= 100 && m.earned - st.paid <= 0) || (m.pct === 0 && !st.cells.some(c => c && c !== 'off')));
          });
          const opts = (sel: number) => crew.stages.map((st, ki) => `<option value="${ki}" ${ki === sel ? 'selected' : ''} ${(crew as any).shown.includes(ki) && ki !== sel ? 'disabled' : ''}>${st.n}${stageMath(st).pct >= 100 ? ' · done' : ''}</option>`).join('')
            + `<option disabled>──────</option><option value="new">+ Add a stage…</option>`;
          (crew as any).shown.forEach((ki: number, n: number) => {
            const st = crew.stages[ki], ref = `${si}.s${ci}.${ki}`, m = stageMath(st);
            let prev = st.before;
            const cells = st.type === 'lump'
              ? st.cells.map((c, i) => { const h = pctCell(c, i, ref, prev); if (c && c !== 'off') prev = c.v; return h; }).join('')
              : st.cells.map((c, i) => qtyCell(c, i, ref, st.unit)).join('');
            const denom = st.type === 'lump' ? (st.amount || 1) : ((st.total || 0) * (st.rate || 0) || 1);
            html += `<tr class="sub" data-site="${site.site}">
              <td class="name"><select class="stsel" data-swap="${si}.${ci}.${n}">${opts(ki)}</select><span class="st">${st.type === 'lump' ? 'lump sum' : `per ${st.unit || ''}`}</span></td>${cells}
              <td class="tot">${m.label}<div class="bar"><i style="width:${Math.min(100, m.prog * 100)}%"></i><b style="left:0;width:${Math.min(100, st.paid / denom * 100)}%"></b></div></td></tr>`;
          });
          const hidden = crew.stages.length - (crew as any).shown.length;
          html += `<tr class="sub last" data-site="${site.site}"><td class="name" colspan="8" id="stadd-${si}-${ci}">
            <select class="stsel ghost" data-swap="${si}.${ci}.new"><option value="" selected>+ Stage…${hidden ? ` (${hidden} more on this contract)` : ''}</option>${opts(-1)}</select></td>
            <td class="tot"></td></tr>`;
        } else {
          crew.cats.forEach((cat, ki) => {
            const ref = `${si}.c${ci}.${ki}`;
            html += `<tr class="sub" data-site="${site.site}">
              <td class="name">${cat.n}<span class="rt mono" data-rate="${ref}" title="click to change rate">₹${cat.rate}</span>${cat.own ? '<span class="st" title="differs from the rate card">own rate</span>' : ''}</td>
              ${cat.cells.map((c, i) => numCell(c, i, ref, crew.paidThrough)).join('')}
              <td class="tot mono">${sum(cat.cells)} × ${inr(cat.rate)}</td></tr>`;
          });
          const have = crew.cats.map(c => c.n);
          const catOpts = ['Mason', 'Carpenter', 'Bar bender', 'Painter', 'Tiler', 'Electrician', 'Plumber', 'Helper · male', 'Helper · female']
            .filter(n => !have.includes(n)).map(n => `<option value="${n}">${n}</option>`).join('');
          html += `<tr class="sub last" data-site="${site.site}"><td class="name" colspan="8">
            <select class="stsel ghost" data-addcat="${si}.${ci}"><option value="" selected>+ Category…</option>${catOpts}<option disabled>──────</option><option value="custom">Other…</option></select></td><td class="tot"></td></tr>`;
        }
      });
      site.direct.forEach((w, wi) => {
        const d = sum(w.cells), amt = d * w.rate; wd += d; wv += amt;
        w.cells.forEach((c, i) => { if (!c && i <= TODAY) gaps++; });
        html += `<tr class="direct" data-site="${site.site}">
          <td class="name"><div class="n">${w.n}</div><div class="d">${w.d} · <span class="rt mono" data-rate="${si}.d${wi}" title="click to change rate" style="margin-left:0">₹${w.rate}</span>/day · direct</div></td>
          ${w.cells.map((c, i) => dayCell(c, i, `${si}.d${wi}`)).join('')}
          <td class="tot"><div class="v">${d} ${d === 1 ? 'day' : 'days'}</div><div class="u"><b>wages, unpaid</b> ${inr(amt)}</div></td></tr>`;
      });
      html += `<tr class="add" data-site="${site.site}"><td colspan="9" id="add-${si}"><button class="pill" data-addw="${si}">+ Add worker</button> <button class="pill" data-addc="${si}">+ Add crew</button></td></tr>`;
      return html;
    }).join('') || `<tr><td colspan="9" class="state">No active projects yet — create a project to start tracking attendance.</td></tr>`;
    const setTxt = (id: string, v: string) => { const el = q('#' + id); if (el) el.textContent = v; };
    setTxt('atdxWd', String(wd)); setTxt('atdxWv', inr(wv)); setTxt('atdxWe', inr(we)); setTxt('atdxGaps', String(gaps));
    bind(); applyFilter();
  }

  // ── resolve a cell ref to its in-memory target + persistence subject ─────────
  function resolve(ref: string) {
    const [si, part, ki] = ref.split('.'); const site = DATA.current[+si];
    if (part[0] === 'h') { const crew = site.crews[+part.slice(1)]; return { cells: crew.head, projectId: site.site, subject: { type: 'crew_head' as const, crew_id: crew.crewId } }; }
    if (part[0] === 'c') { const cat = site.crews[+part.slice(1)].cats[+ki]; return { cells: cat.cells, target: cat, projectId: site.site, subject: { type: 'crew_category' as const, category_id: cat.id } }; }
    if (part[0] === 's') { const st = site.crews[+part.slice(1)].stages[+ki]; return { cells: st.cells, projectId: site.site, subject: { type: 'stage' as const, milestone_id: st.milestoneId } }; }
    const w = site.direct[+part.slice(1)]; return { cells: w.cells, target: w, projectId: site.site, subject: { type: 'direct' as const, direct_worker_id: w.id } };
  }
  const colOf = (div: Element) => [...(div.closest('tr')!.querySelectorAll('td.cell'))].indexOf(div.closest('td')!);
  const fail = (e: any) => { showSnackbar(e?.message || 'Could not save', { type: 'error' }); load(); };

  async function persistCell(subject: any, projectId: string, i: number, value: number) {
    try { await saveCell(orgId, projectId, dates[i], subject, value, byName); } catch (e) { fail(e); }
  }

  function bind() {
    const body = q('#atdxBody'); if (!body) return;
    body.querySelectorAll('[data-edit]').forEach(div => div.addEventListener('click', () => {
      if (div.querySelector('input')) return;
      const t = resolve((div as HTMLElement).dataset.edit!), i = colOf(div);
      const cur = t.cells[i] && t.cells[i] !== 'off' ? (t.cells[i] as any).v : '';
      div.innerHTML = `<input class="mono" value="${cur}" inputmode="numeric">`;
      const inp = div.querySelector('input') as HTMLInputElement; inp.focus(); inp.select();
      const commit = () => { const v = parseFloat(inp.value); if (!isNaN(v)) { t.cells[i] = { v, src: 'office', by: byName, at: 'just now' }; persistCell(t.subject, t.projectId, i, v); } render(); };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.removeEventListener('blur', commit); render(); } });
    }));
    body.querySelectorAll('[data-cycle]').forEach(div => div.addEventListener('click', () => {
      const t = resolve((div as HTMLElement).dataset.cycle!), i = colOf(div), c = t.cells[i];
      let v: number;
      if (!c || c === 'off') { v = 1; t.cells[i] = { v, src: 'office', by: byName, at: 'just now' }; }
      else { v = c.v === 1 ? 0.5 : c.v === 0.5 ? 0 : 1; t.cells[i] = { v, src: 'office', by: byName, at: 'just now' }; }
      persistCell(t.subject, t.projectId, i, v); render();
    }));
    body.querySelectorAll('[data-swap]').forEach(sel => sel.addEventListener('change', () => {
      const [si, ci, slot] = (sel as HTMLElement).dataset.swap!.split('.'), crew = DATA.current[+si].crews[+ci] as any;
      const val = (sel as HTMLSelectElement).value;
      if (val === 'new') { showSnackbar('Add stages from the contract for this crew, then they show up here.'); (sel as HTMLSelectElement).value = ''; return; }
      if (val === '') return;
      const ki = +val;
      if (slot === 'new') crew.shown.push(ki); else crew.shown[+slot] = ki;
      render();
    }));
    body.querySelectorAll('[data-rate]').forEach(sp => sp.addEventListener('click', () => {
      if (sp.querySelector('input')) return;
      const t = resolve((sp as HTMLElement).dataset.rate!); const target = t.target as any; if (!target) return;
      sp.innerHTML = `₹<input class="mono" value="${target.rate}" inputmode="numeric">`;
      const inp = sp.querySelector('input') as HTMLInputElement; inp.focus(); inp.select();
      const commit = () => {
        const v = parseInt(inp.value.replace(/,/g, ''), 10);
        if (!isNaN(v)) {
          target.rate = v; target.own = true;
          const save = t.subject.type === 'crew_category' ? setCategoryRate(t.subject.category_id, v) : setDirectRate((t.subject as any).direct_worker_id, v);
          save.catch(fail);
        }
        render();
      };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.removeEventListener('blur', commit); render(); } });
    }));
    body.querySelectorAll('[data-addcat]').forEach(sel => sel.addEventListener('change', async () => {
      const [si, ci] = (sel as HTMLElement).dataset.addcat!.split('.'), crew = DATA.current[+si].crews[+ci];
      let n = (sel as HTMLSelectElement).value; if (!n) return;
      if (n === 'custom') { n = prompt('Category name') || ''; if (!n) { render(); return; } }
      try { await addCategory(orgId, crew.crewId, n, rateFor(crew.trade, n)); await load(); } catch (e) { fail(e); }
    }));
    body.querySelectorAll('[data-basis]').forEach(b => b.addEventListener('click', () => {
      const [si, ci, basis] = (b as HTMLElement).dataset.basis!.split('.'); const crew = DATA.current[+si].crews[+ci];
      crew.basis = basis as 'contract' | 'labour'; setCrewBasis(crew.crewId, crew.basis).catch(fail); render();
    }));
    body.querySelectorAll('[data-addw]').forEach(b => b.addEventListener('click', () => addWorkerForm(+(b as HTMLElement).dataset.addw!)));
    body.querySelectorAll('[data-addc]').forEach(b => b.addEventListener('click', () => addCrewForm(+(b as HTMLElement).dataset.addc!)));
    body.querySelectorAll('[data-oncontract]').forEach(b => b.addEventListener('click', () => { const [si, ci] = (b as HTMLElement).dataset.oncontract!.split('.'); onContractForm(+si, +ci); }));
  }

  // Put a wage crew on a contract: link an existing work order (reveals its stages + the
  // Contract/Labour toggle), or start a new contract prefilled for this crew's project + party.
  async function onContractForm(si: number, ci: number) {
    const crew = DATA.current[si].crews[ci]; const site = DATA.current[si];
    const lbl = q(`[data-wageslbl="${si}.${ci}"]`); if (!lbl) return;
    lbl.textContent = 'Loading contracts…';
    let wos;
    try { wos = await loadWorkOrdersForProject(site.site); } catch (e) { fail(e); return; }
    // Contracts for this crew's party come first.
    wos.sort((a, b) => Number(b.stakeholderId === crew.stakeholderId) - Number(a.stakeholderId === crew.stakeholderId));
    const opts = wos.map(w => `<option value="${w.wo_id}">${escapeHtml(w.label)}${w.orderValue ? ` · ${inr(w.orderValue)}` : ''}</option>`).join('');
    lbl.innerHTML = `<select class="stsel ocsel"><option value="">Link a contract…</option>${opts}<option value="__new">+ New contract…</option></select> <button class="x ocx">cancel</button>`;
    const sel = lbl.querySelector('.ocsel') as HTMLSelectElement;
    (lbl.querySelector('.ocx') as HTMLButtonElement).addEventListener('click', () => render());
    sel.addEventListener('change', async () => {
      if (sel.value === '__new') { navigate('/work-orders/new', { state: { projectId: site.site, stakeholderId: crew.stakeholderId } }); return; }
      if (!sel.value) return;
      try { await linkCrewToWorkOrder(crew.crewId, sel.value); await load(); } catch (e) { fail(e); }
    });
    sel.focus();
  }

  // A single search box: type a name → ranked party matches (same searchPayees the
  // transaction payee field uses) → pick one, or create a new party if not found.
  const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  type Party = { stakeholder_id: string; name: string; category: string | null };
  function partyPicker(si: number, placeholder: string, excludeNames: string[], onPick: (p: Party) => Promise<void>) {
    const td = q('#add-' + si); if (!td) return;
    td.innerHTML = `<span class="new"><span class="pp">
        <input class="psearch" placeholder="${placeholder}" autocomplete="off">
        <div class="ppmenu" style="display:none"></div>
      </span><button class="x">cancel</button></span>`;
    const input = td.querySelector('.psearch') as HTMLInputElement;
    const menu = td.querySelector('.ppmenu') as HTMLElement;
    (td.querySelector('.x') as HTMLButtonElement).addEventListener('click', () => render());
    const avail = () => PARTIES.current.filter(p => !excludeNames.includes(p.name));
    let busy = false;
    const commit = async (p: Party) => { if (busy) return; busy = true; menu.style.display = 'none'; try { await onPick(p); } catch (e) { busy = false; fail(e); } };
    const draw = () => {
      const query = input.value.trim();
      const matches = (query ? searchPayees(avail(), query) : avail()).slice(0, 8);
      const rows = matches.map(m => `<button class="ppitem" data-id="${m.stakeholder_id}">${escapeHtml(m.name)}${m.category ? `<small> · ${escapeHtml(m.category)}</small>` : ''}</button>`).join('');
      const create = query ? `<button class="ppitem ppcreate" data-create="1">${matches.length ? 'Not here? ' : ''}Create <b>${escapeHtml(query)}</b> · new party</button>` : '';
      menu.innerHTML = (rows + create) || `<div class="ppempty">Type a name to search…</div>`;
      menu.style.display = 'block';
      menu.querySelectorAll('[data-id]').forEach(b => b.addEventListener('mousedown', e => { e.preventDefault(); const p = PARTIES.current.find(x => x.stakeholder_id === (b as HTMLElement).dataset.id); if (p) commit(p); }));
      const cb = menu.querySelector('[data-create]');
      if (cb) cb.addEventListener('mousedown', async e => {
        e.preventDefault(); if (busy) return; busy = true;
        try { const c = await createParty(query, 'Worker', orgId); busy = false; await commit({ stakeholder_id: c.id, name: c.name, category: null }); }
        catch (err) { busy = false; fail(err); }
      });
    };
    input.addEventListener('input', draw);
    input.addEventListener('focus', draw);
    input.addEventListener('blur', () => setTimeout(() => { menu.style.display = 'none'; }, 150));
    input.focus();
  }

  function addWorkerForm(si: number) {
    partyPicker(si, 'Search a worker by name…', DATA.current[si].direct.map(w => w.n), async (p) => {
      const cat = p.category || 'Helper · male';
      await addDirectWorker(orgId, DATA.current[si].site, p.name, cat, rateFor(null, cat), p.stakeholder_id || undefined);
      await load();
    });
  }

  function addCrewForm(si: number) {
    partyPicker(si, 'Search a crew / contractor by name…', DATA.current[si].crews.map(c => c.n), async (p) => {
      const trade = p.category && CARD.current?.trades[p.category] ? p.category : null;
      const cats = mixFor(trade).map(c => ({ category: c, rate: rateFor(trade, c) }));
      await addCrew(orgId, DATA.current[si].site, p.name, trade, cats, p.stakeholder_id || undefined);
      await load();
    });
  }

  // Add a new department (trade) to the rate card. It appears immediately with empty
  // rates; typing a rate into any cell persists that (trade, kind) row (saveRate).
  function addDepartment() {
    const name = prompt('Department / trade name (e.g. Welder, Fabricator)')?.trim();
    if (!name || !CARD.current) return;
    if (CARD.current.trades[name] || name === SUPERVISOR_KEY) { showSnackbar('That department already exists.'); return; }
    CARD.current.trades[name] = { skilled: null, hm: null, hf: null };
    if (!rcOpen) setRcOpen(true); else renderCard();
  }

  // ── rate card ────────────────────────────────────────────────────────────────
  function renderCard() {
    const rc = q('#atdxRc'); const table = q('#atdxRcTable'); const C = CARD.current; if (!rc || !table || !C) return;
    rc.hidden = false;
    const fmt = (n: number | null) => n == null ? '<span style="color:var(--line-2)">—</span>' : n.toLocaleString('en-IN');
    const cell = (key: string, field: string, v: number | null) => `<td><div class="cc" data-rc="${key}" data-f="${field}"><span class="v mono">${fmt(v)}</span>${C.since[key + '.' + field] ? `<span class="since">${C.since[key + '.' + field]}</span>` : ''}</div></td>`;
    const trades = Object.keys(C.trades);
    table.innerHTML =
      `<thead><tr><th class="cat">Worker type</th><th>Skilled<span class="p">per day</span></th><th>Helper · male<span class="p">per day</span></th><th>Helper · female<span class="p">per day</span></th></tr></thead><tbody>` +
      `<tr class="grp"><td colspan="4">Skilled trades — and the helpers who work under them</td></tr>` +
      (trades.length ? trades.map(t => `<tr><td class="cat">${t}</td>${cell(t, 'skilled', C.trades[t].skilled)}${cell(t, 'hm', C.trades[t].hm)}${cell(t, 'hf', C.trades[t].hf)}</tr>`).join('')
                     : `<tr><td class="cat" colspan="4" style="color:var(--walnut-3);font-size:13px">No trades yet — add one below.</td></tr>`) +
      `<tr class="grp"><td colspan="4">Unskilled — general labour, no trade</td></tr>` +
      `<tr><td class="cat">Unskilled labour</td><td><div class="cc" style="cursor:default"><span class="v mono" style="color:var(--line-2)">—</span></div></td>${cell('unskilled', 'hm', C.unskilled.hm)}${cell('unskilled', 'hf', C.unskilled.hf)}</tr>` +
      `<tr class="grp"><td colspan="4">Supervision</td></tr>` +
      `<tr><td class="cat">Supervisor</td>${cell('supervisor', 'skilled', C.supervisor)}<td></td><td></td></tr></tbody>`;
    table.querySelectorAll('[data-rc]').forEach(div => div.addEventListener('click', () => {
      if (div.querySelector('input')) return;
      const key = (div as HTMLElement).dataset.rc!, f = (div as HTMLElement).dataset.f! as 'skilled' | 'hm' | 'hf';
      const cur = key === 'unskilled' ? C.unskilled[f as 'hm' | 'hf'] : key === 'supervisor' ? C.supervisor : C.trades[key][f];
      div.innerHTML = `<input class="mono" value="${cur ?? ''}" inputmode="numeric">`;
      const inp = div.querySelector('input') as HTMLInputElement; inp.focus(); inp.select();
      const commit = () => {
        const v = parseInt(inp.value.replace(/,/g, ''), 10);
        if (!isNaN(v)) {
          if (key === 'unskilled') C.unskilled[f as 'hm' | 'hf'] = v; else if (key === 'supervisor') C.supervisor = v; else C.trades[key][f] = v;
          C.since[key + '.' + f] = 'today';
          saveRate(orgId, key, f, v).catch(fail);
        }
        renderCard();
      };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.removeEventListener('blur', commit); renderCard(); } });
    }));
  }

  // ── site filter ──────────────────────────────────────────────────────────────
  function applyFilter() {
    const f = filterRef.current;
    rootRef.current?.querySelectorAll('#atdxBody tr').forEach(tr => (tr as HTMLElement).classList.toggle('hide', f !== 'all' && (tr as HTMLElement).dataset.site !== f));
  }

  const sites = DATA.current;

  return (
    <div className="atdx" ref={rootRef}>
      <style>{ATDX_CSS}</style>
      <div className="wrap">
        <div className="top">
          <div>
            <h1>Attendance</h1>
            <p className="lede">What your supervisors send on <span className="wa">WhatsApp</span> fills in here — headcounts, and work done. Click any cell to correct it. Payables reads what's unpaid.</p>
          </div>
          <div className="week">
            <button className="nav" aria-label="Previous week" onClick={() => setMonday(m => { const d = new Date(m); d.setDate(d.getDate() - 7); return d; })}>‹</button>
            <span className="range">{weekLabel(monday)}</span>
            <button className="nav" aria-label="Next week" onClick={() => setMonday(m => { const d = new Date(m); d.setDate(d.getDate() + 7); return d; })}>›</button>
            <button className="today" onClick={() => setMonday(mondayOf(new Date()))}>this week</button>
            <button className="today" style={{ marginLeft: 14 }} onClick={() => setRcOpen(o => !o)}>{rcOpen ? 'hide rate card' : 'rate card'}</button>
          </div>
        </div>

        <div className="summ">
          <div className="s"><div className="l">Worker-days so far</div><div className="v mono" id="atdxWd">—</div></div>
          <div className="s"><div className="l">Wage value (labour basis)</div><div className="v mono" id="atdxWv">—</div></div>
          <div className="s"><div className="l">Work earned (contract basis)</div><div className="v mono" id="atdxWe">—</div></div>
          <div className="s"><div className="l">Gaps to fill</div><div className="v mono warn" id="atdxGaps">—</div></div>
          <div className="sp" />
          <div className="filters" role="group">
            {[{ k: 'all', l: 'All sites' }, ...sites.map(s => ({ k: s.site, l: s.label }))].map((c, i) => (
              <button key={c.k} className="chip" aria-pressed={i === 0} onClick={(e) => {
                filterRef.current = c.k;
                rootRef.current?.querySelectorAll('.filters .chip').forEach(x => x.setAttribute('aria-pressed', String(x === e.currentTarget)));
                applyFilter();
              }}>{c.l}</button>
            ))}
          </div>
        </div>

        <section className="rc" id="atdxRc" hidden>
          <div className="rc-h"><span className="t">Rate card</span><span className="s">Daily rates by worker type. A trade's helpers can cost differently from general unskilled labour. Click to change — from today; earlier weeks keep the old rate.</span></div>
          <table id="atdxRcTable" />
          <div className="rc-f"><button onClick={addDepartment}>+ Add department</button></div>
        </section>

        <div className="reg">
          <table>
            <thead>
              <tr>
                <th className="name">Crew · worker</th>
                {dates.map((d, i) => {
                  const dt = new Date(d);
                  const cls = (i === TODAY ? 'is-today' : '') + (i === 6 ? ' sun' : '');
                  return <th key={d} className={cls.trim() || undefined}>{dt.toLocaleString('en-US', { weekday: 'short' })}<span className="dn">{dt.getDate()}</span></th>;
                })}
                <th className="tot">This week</th>
              </tr>
            </thead>
            <tbody id="atdxBody" />
          </table>
          <div className="legend">
            <span><b className="sw wa">3</b> from site</span>
            <span><b className="sw off">3</b> typed by office</span>
            <span><b className="sw gap">—</b> working day, nothing yet</span>
            <span><i className="pl" /> already paid</span>
            <span><b className="sw wa" style={{ fontSize: 12 }}>70%</b> stage reading, on the day it was assessed</span>
            <span>Direct workers: <b className="mono">1</b> full · <b className="mono">½</b> half · <b className="mono">0</b> absent — click to cycle</span>
          </div>
        </div>

        {loading && <div className="state">Loading attendance…</div>}
        {err && <div className="state" style={{ color: 'var(--terracotta)' }}>{err} · <button style={{ textDecoration: 'underline' }} onClick={() => load()}>retry</button></div>}
      </div>
    </div>
  );
}
