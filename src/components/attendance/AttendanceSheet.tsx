// Attendance — a live, per-project labour muster, rebuilt to the redesign artifact:
// one cream "sheet" (a table), a segmented site filter, a sticky day-circle header, a group row per
// site, worker / contract rows, a morphing "Add worker" pill, an editor popover (per-skill steppers),
// a row menu, and a toast with undo. Wired to Supabase through attendanceApi exactly as before — every
// cell edit, rate change, add and certify persists — and it keeps the live features the artifact does
// not depict: the settled-week freeze, the rate card (a right slide-in), WhatsApp-sourced marks, and
// the contract crew's certify flow (the artifact CertifyDialog / PutOnContractDialog). The grid render
// stays imperative (a faithful port of the reference) inside a scoped `.atdx` root.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useOrgId } from '../../lib/auth/AuthProvider';
import { useSnackbar } from '../Snackbar';
import {
  loadWeek, loadParties, mondayOf, weekDates, weekLabel,
  saveCell, saveRate, setCategoryRate, setDirectRate, setCrewBasis, addCrew,
  accruedDayWagesForCrew, accruedDayWagesForDirect, removeCrew, removeDirectWorker,
  cardIsEmpty, seedRateCard, SUPERVISOR_KEY, autoSettleCrewWages,
  type SiteRow, type RateCard, type Cell, type CrewRow, type StageRow,
} from '../../lib/attendanceApi';
import { searchPayees } from '../../lib/payeeSearch';
import { createParty } from '../day-book/fileEntry';
import { CertifyDialog, type CertifyCrewCtx } from './CertifyDialog';
import { PutOnContractDialog, type PocCtx } from './PutOnContractDialog';
import { WagesOnContractDialog, type WagesAskCtx } from './WagesOnContractDialog';
import { loadWageContracts, wagesAgainstLabel, type WageContract } from './wagesOnContract';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const fmtQ = (n: number) => (+n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
/** Each site gets a colour, in the artifact's order, so its dot and its chip agree. */
const SITE_DOT = ['#C4552D', '#6F7F5E', '#B9892E', '#4F6B8A'];
/** The pills carry a short name — drop a trailing "Apartments"/"Residence" like the artifact. */
const shortSite = (label: string) => label.replace(/ (Apartments|Residence)$/, '');
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// LOCAL date, not UTC — matches attendanceApi's `iso` so today's column lines up with the muster week.
const isoOf = (d: Date) => `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;

// Which org rate-card cell a rate edit lands on — rates are two-way linked to the card.
type CardCell = { key: string; kind: 'skilled' | 'hm' | 'hf' };

// ── in-memory row models the imperative grid resolves against ──────────────────
type Line = { label: string; rate: number; cells: Cell[]; subject: PersistSubject };
type PersistSubject =
  | { type: 'crew_category'; category_id: string }
  | { type: 'direct'; direct_worker_id: string };
type WorkerRow = { id: string; siteId: string; name: string; trade: string; lines: Line[]; contractWages: boolean; crew?: CrewRow; direct?: SiteRow['direct'][number] };
type ContractRow = { id: string; siteId: string; crew: CrewRow; si: number; ci: number };

export default function AttendanceSheet({ session }: { session: Session }) {
  const orgId = useOrgId();
  const { show: showSnackbar } = useSnackbar();
  const byName = (session.user?.user_metadata?.name as string) || (session.user?.user_metadata?.full_name as string) || session.user?.email || 'Office';

  const rootRef = useRef<HTMLDivElement>(null);
  const DATA = useRef<SiteRow[]>([]);
  const CARD = useRef<RateCard | null>(null);
  const PARTIES = useRef<{ stakeholder_id: string; name: string; category: string | null }[]>([]);
  const filterRef = useRef<string>('all');
  const seededRef = useRef(false);
  const WROWS = useRef<Map<string, WorkerRow>>(new Map());
  const CROWS = useRef<Map<string, ContractRow>>(new Map());
  const addState = useRef<{ site: string | null; picked: any | null; exp: boolean }>({ site: null, picked: null, exp: false });

  const [monday, setMonday] = useState<Date>(() => mondayOf(new Date()));
  const [rcOpen, setRcOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [certCtx, setCertCtx] = useState<CertifyCrewCtx | null>(null);
  const [pocCtx, setPocCtx] = useState<PocCtx | null>(null);
  // The one question a wages engagement leaves open — asked only when the party actually holds a
  // contract on this site, so it never appears where there is nothing to set the wages against.
  const [wagesAsk, setWagesAsk] = useState<{ ctx: WagesAskCtx; contracts: WageContract[] } | null>(null);

  const dates = weekDates(monday);
  const todayISO = isoOf(new Date());
  const TODAY = todayISO > dates[6] ? 6 : todayISO < dates[0] ? -1 : dates.indexOf(todayISO);
  // A fully-passed week is SETTLED — its wages are netted and paid; freeze its cells (read-only).
  const locked = isoOf(monday) < isoOf(mondayOf(new Date()));
  const isThisWeek = isoOf(monday) === isoOf(mondayOf(new Date()));

  // ── rate helpers (read the live CARD) ────────────────────────────────────────
  const rateFor = useCallback((trade: string | null, cat: string): number => {
    const C = CARD.current; if (!C) return 0;
    if (cat === 'Supervisor') return C.supervisor ?? 0;
    if (cat === 'Helper · male') return (trade ? C.trades[trade]?.hm : null) ?? C.unskilled.hm ?? 0;
    if (cat === 'Helper · female') return (trade ? C.trades[trade]?.hf : null) ?? C.unskilled.hf ?? 0;
    return C.trades[cat]?.skilled ?? 700;
  }, []);
  const mixFor = useCallback((trade: string | null): string[] => {
    if (!trade) return ['Helper · male', 'Helper · female'];
    const t = CARD.current?.trades[trade];
    const femaleHelper = !t || t.hf != null;
    return [trade, 'Helper · male', ...(femaleHelper ? ['Helper · female'] : [])];
  }, []);
  const TRADE_ALIASES: Record<string, string> = {
    'painting worker': 'Painter', 'polish worker': 'Painter', 'wood polish worker': 'Painter', 'painter': 'Painter',
    'tile fitter': 'Tiler', 'marble fixer': 'Tiler', 'granite fixer': 'Tiler', 'tiler': 'Tiler',
    'shuttering carpenter': 'Carpenter', 'carpenter': 'Carpenter', 'modular kitchen installer': 'Carpenter', 'wardrobe installer': 'Carpenter',
    'bar bender / reinforcement': 'Bar bender', 'bar bender': 'Bar bender',
    'mason': 'Mason', 'stone mason': 'Mason', 'concrete worker': 'Mason',
    'electrician': 'Electrician', 'plumber': 'Plumber',
  };
  const resolveTrade = useCallback((category: string | null): string | null => {
    const c = (category || '').trim(); if (!c) return null;
    const lc = c.toLowerCase();
    if (/helper|unskilled|labour|labor|supervisor|guard|housekeep|cleaner|driver|operator|material handler|security/.test(lc)) return null;
    return TRADE_ALIASES[lc] || c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── load a week + render ──────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      let [{ sites, card }, parties] = await Promise.all([loadWeek(monday), loadParties()]);
      if (cardIsEmpty(card) && !seededRef.current) {
        seededRef.current = true;
        try { await seedRateCard(orgId); const r2 = await loadWeek(monday); sites = r2.sites; card = r2.card; } catch { /* best-effort */ }
      }
      DATA.current = sites; CARD.current = card; PARTIES.current = parties;
      deriveRates();
      setLoading(false);
      requestAnimationFrame(() => { render(); if (rcOpen) renderCard(); });
    } catch (e: any) {
      setErr(e?.message || 'Could not load attendance'); setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monday]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!loading && rcOpen) renderCard(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rcOpen, loading]);

  const q = (sel: string) => rootRef.current?.querySelector(sel) as HTMLElement | null;
  const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const fail = (e: any) => { showSnackbar(e?.message || 'Could not save', { type: 'error' }); load(); };

  // ── build the worker-row / contract-row models for a site ─────────────────────
  const lineVal = (l: Line, i: number) => { const c = l.cells[i]; return (c && c !== 'off') ? c.v : 0; };
  const rowDays = (r: WorkerRow) => r.lines.reduce((s, l) => s + l.cells.reduce((s2, _c, i) => s2 + lineVal(l, i), 0), 0);
  const rowWage = (r: WorkerRow) => r.lines.reduce((s, l) => s + l.cells.reduce((s2, _c, i) => s2 + lineVal(l, i) * l.rate, 0), 0);
  const dayVal = (r: WorkerRow, i: number) => r.lines.reduce((s, l) => s + lineVal(l, i), 0);
  const dayWage = (r: WorkerRow, i: number) => r.lines.reduce((s, l) => s + lineVal(l, i) * l.rate, 0);
  const dayWa = (r: WorkerRow, i: number) => r.lines.some(l => { const c = l.cells[i]; return c && c !== 'off' && c.src === 'wa'; });

  // A phase's completion reflects what's actually accounted against it — the GREATER of the ₹ certified
  // (work approved) and the ₹ already paid (allocations). A phase paid but not yet formally certified is
  // still work done and money out, so it must not read 0. twEarned stays this-week's newly-certified ₹.
  function stageMath(st: StageRow) {
    const budget = st.type === 'lump' ? (st.amount || 0) : (st.total || 0) * (st.rate || 0);
    const earned = Math.max(st.certified || 0, st.paid || 0);
    const certified = st.certified || 0;
    const before = Math.min(certified, st.certifiedBefore || 0);
    const twEarned = Math.max(0, certified - before);
    const pct = budget > 0 ? Math.min(100, Math.round(earned / budget * 100)) : 0;
    const done = st.type === 'measured' && st.rate ? earned / st.rate : (st.amount ? earned / st.amount * 100 : 0);
    return { budget, earned, certified, paid: st.paid || 0, twEarned, pct, done, total: st.total || 0, unit: st.unit || '', isLS: st.type === 'lump' };
  }
  const woWeek = (crew: CrewRow) => crew.stages.reduce((a, st) => a + stageMath(st).twEarned, 0);
  const uiStage = (crew: CrewRow): number => {
    const anyc = crew as any;
    if (anyc._uiStage == null || anyc._uiStage >= crew.stages.length) {
      const first = crew.stages.findIndex(st => { const m = stageMath(st); return m.earned < m.budget; });
      anyc._uiStage = first < 0 ? 0 : first;
    }
    return anyc._uiStage;
  };
  const crewLabel = (crew: CrewRow) => crew.d || 'Contract';

  // Classify a crew: a %/measured contract → its own contract row; everything else (labour, or a
  // contract kept on daily wages) → a worker row that still musters days.
  const isContractRow = (crew: CrewRow) => crew.basis === 'contract' && crew.accrualBasis !== 'day';

  function buildSiteRows(site: SiteRow, si: number) {
    const workers: WorkerRow[] = [];
    const contracts: ContractRow[] = [];
    site.crews.forEach((crew, ci) => {
      if (isContractRow(crew)) {
        contracts.push({ id: `${si}.${ci}`, siteId: site.site, crew, si, ci });
        return;
      }
      const wages = crew.basis === 'contract' && crew.accrualBasis === 'day';
      const target = crew.stages[0];
      const trade = wages && target ? `${crew.trade || crew.d || 'Labour'} · ${wagesAgainstLabel(target.n)}` : (crew.trade || crew.d || 'Labour');
      workers.push({
        id: `c${si}.${ci}`, siteId: site.site, name: crew.n, trade,
        contractWages: wages, crew,
        lines: crew.cats.map(cat => ({ label: cat.n, rate: cat.rate, cells: cat.cells, subject: { type: 'crew_category', category_id: cat.id } })),
      });
    });
    site.direct.forEach((w, wi) => {
      workers.push({
        id: `d${si}.${wi}`, siteId: site.site, name: w.n, trade: w.d || w.cat || 'Labour', contractWages: false, direct: w,
        lines: [{ label: w.cat || 'Day', rate: w.rate, cells: w.cells, subject: { type: 'direct', direct_worker_id: w.id } }],
      });
    });
    return { workers, contracts };
  }

  // ── the grid render (faithful port of the artifact) ──────────────────────────
  function render() {
    const thead = q('#thead'); const grid = q('#grid'); if (!thead || !grid) return;
    WROWS.current.clear(); CROWS.current.clear();
    const filter = filterRef.current;

    thead.innerHTML = `<tr><th>Worker</th>${DAYS.map((d, i) => {
      const dt = new Date(dates[i]);
      const fillable = !locked && i < TODAY && i !== 6;
      return `<th class="${i === TODAY ? 'today ' : ''}${fillable ? 'fillable' : ''}"${fillable ? ` data-fill="${i}"` : ''}>${d}<span class="d">${dt.getDate()}</span></th>`;
    }).join('')}<th class="tot">Days</th><th class="tot">This week</th><th></th></tr>`;

    grid.querySelectorAll('tbody').forEach(b => b.remove());
    let totD = 0, totM = 0, gaps = 0;
    const A = addState.current;

    for (let si = 0; si < DATA.current.length; si++) {
      const site = DATA.current[si];
      if (filter !== 'all' && filter !== site.site) continue;
      const dot = SITE_DOT[si % SITE_DOT.length];
      const { workers, contracts } = buildSiteRows(site, si);
      let sd = 0, sm = 0;
      workers.forEach(r => { sd += rowDays(r); sm += rowWage(r); });
      contracts.forEach(c => { sm += woWeek(c.crew); });
      totD += sd; totM += sm;
      // gaps: past working days a labour row left unmarked
      workers.forEach(r => {
        for (let i = 0; i < TODAY; i++) { if (i === 6) continue; if (dayVal(r, i) <= 0) gaps++; }
      });

      let html = `<tr class="group"><th colspan="11" style="--c:${dot}"><div class="g"><span class="dot"></span><span class="name">${escapeHtml(site.label)}</span>${site.hint ? `<span class="place">${escapeHtml(site.hint)}</span>` : ''}</div></th></tr>`;

      if (!workers.length && !contracts.length) {
        html += `<tr class="empty"><td colspan="11">Nobody on this week's sheet yet — the site can WhatsApp attendance in, or <a data-add="${site.site}">add someone</a> below.</td></tr>`;
      }

      workers.forEach(r => {
        WROWS.current.set(r.id, r);
        const days = rowDays(r), wage = rowWage(r);
        html += `<tr class="worker" data-row="${r.id}"><td class="who"><span class="n">${escapeHtml(r.name)}</span><span class="t">${escapeHtml(r.trade)}</span></td>`;
        for (let i = 0; i < 7; i++) {
          const isFuture = i > TODAY || i === 6;
          const val = dayVal(r, i);
          let cls = 'cell', inner = '';
          if (!isFuture) {
            if (val > 0) {
              cls += ' filled';
              inner = val === 0.5 ? '½' : fmtQ(val);
              const nz = r.lines.map(l => lineVal(l, i)).filter(v => v > 0);
              if (nz.length > 1) inner += `<span class="sub">${nz.map(v => fmtQ(v)).join(' + ')}</span>`;
              if (dayWa(r, i)) inner += '<span class="src"></span>';
            } else if (i < TODAY) cls += ' gap';
          }
          const title = val > 0 ? `${inr(dayWage(r, i))} · ${DAYS[i]} ${new Date(dates[i]).getDate()}` : '';
          const editable = !isFuture && !locked;
          html += `<td class="day ${i === TODAY ? 'today' : ''} ${isFuture ? 'future' : ''}"><div class="${cls}" ${editable ? `tabindex="0" data-w="${r.id}" data-i="${i}"` : ''} title="${title}">${inner}</div></td>`;
        }
        html += `<td class="tot days ${days ? '' : 'zero'}">${days ? fmtQ(days) : '—'}</td><td class="tot ${wage ? '' : 'zero'}">${wage ? inr(wage) : '—'}</td><td class="menu"><button data-menu="${r.id}" aria-label="Row menu">⋯</button></td></tr>`;
      });

      contracts.forEach(c => {
        CROWS.current.set(c.id, c);
        const crew = c.crew; const ki = uiStage(crew); const st = crew.stages[ki];
        if (!st) {
          html += `<tr class="contract" data-c="${c.id}"><td class="who"><span class="n">${escapeHtml(crew.n)}</span><span class="tag">contract</span></td><td colspan="7" class="cwork" data-cert="${c.id}"><div class="cw"><span class="num">No stages on this contract</span></div></td><td class="tot days zero">—</td><td class="tot zero"><span class="amt">—</span></td><td class="menu"><button data-menu-c="${c.id}" aria-label="Row menu">⋯</button></td></tr>`;
          return;
        }
        const m = stageMath(st);
        const qty = m.isLS ? `<b>${fmtQ(m.done)}%</b> of lump sum` : `<b>${fmtQ(m.done)}</b> / ${fmtQ(m.total)} ${m.unit}`;
        const stSel = `<select class="sel mini stage" data-stsel="${c.id}">${crew.stages.map((x, i) => { const mm = stageMath(x); return `<option value="${i}" ${i === ki ? 'selected' : ''}>${escapeHtml(x.n)} — ${mm.pct}% done${mm.pct >= 100 ? ' ✓' : ''}</option>`; }).join('')}</select>`;
        html += `<tr class="contract" data-c="${c.id}">
          <td class="who"><span class="n">${escapeHtml(crew.n)}</span><span class="tag">contract</span><br><span class="sel mini wo" title="${escapeHtml(crew.woId || '')}">${escapeHtml(crewLabel(crew))}</span></td>
          <td colspan="7" class="cwork" data-cert="${c.id}"><div class="cw">${stSel}<span class="bar" title="${inr(m.earned)} of ${inr(m.budget)}"><i style="width:${m.pct}%"></i></span><span class="num">${qty}</span></div></td>
          <td class="tot days zero">—</td><td class="tot ${m.twEarned ? '' : 'zero'}"><span class="amt">${m.twEarned ? inr(m.twEarned) : '—'}</span><span class="of">${inr(m.earned)} to date</span></td>
          <td class="menu"><button data-menu-c="${c.id}" aria-label="Row menu">⋯</button></td></tr>`;
      });

      // add-worker row
      if (A.site === site.site && A.picked) {
        const p = A.picked;
        html += `<tr class="addrow"><td colspan="8"><div class="ask"><div class="askhd">Add <b>${escapeHtml(p.name)}</b> <span>· ${escapeHtml(p.category || 'Worker')}</span></div><div class="cards">
          <button class="card" data-mode="wages"><span class="ci">₹</span><span class="ct">On daily wages</span><span class="cs">Days × rate from the rate card. Helpers counted alongside.</span></button>
          <button class="card" data-mode="contract"><span class="ci">§</span><span class="ct">On contract</span><span class="cs">Certify stages as work completes — pick the contract next.</span></button>
        </div><button class="cancel" data-addcancel>cancel</button></div></td><td class="tot days sum ${sd ? '' : 'zero'}">${sd ? fmtQ(sd) : '—'}</td><td class="tot sum ${sm ? '' : 'zero'}">${sm ? inr(sm) : '—'}</td><td class="menu"></td></tr>`;
      } else {
        const exp = A.site === site.site;
        html += `<tr class="addrow"><td colspan="8"><div class="morph ${exp && A.exp ? 'exp' : ''}" data-site="${site.site}">
          <button class="plus" data-add="${site.site}" aria-label="Add worker">+</button>
          <button class="label" data-add="${site.site}">Add worker</button>
          <input ${exp ? 'id="addinput"' : ''} placeholder="Search a worker or crew by name…" autocomplete="off" ${exp ? '' : 'tabindex="-1"'}>
          <button class="close" data-addcancel aria-label="Cancel">×</button>
          ${exp ? '<div class="picker" id="picker"></div>' : ''}
        </div></td><td class="tot days sum ${sd ? '' : 'zero'}">${sd ? fmtQ(sd) : '—'}</td><td class="tot sum ${sm ? '' : 'zero'}">${sm ? inr(sm) : '—'}</td><td class="menu"></td></tr>`;
      }

      const tb = document.createElement('tbody');
      if (grid.querySelector('tbody')) html = `<tr class="spacer"><td colspan="11"></td></tr>` + html;
      tb.innerHTML = html; grid.appendChild(tb);
    }

    if (!DATA.current.some(s => filter === 'all' || filter === s.site) || !DATA.current.length) {
      // no matching site: leave an empty note
    }

    // summary
    const sm = q('#summary');
    if (sm) {
      sm.innerHTML = `<b>${fmtQ(totD)}</b> worker-days · <b>${inr(totM)}</b> this week${gaps ? ` · <span class="gaps" id="gapjump">${gaps} past ${gaps === 1 ? 'day' : 'days'} not marked</span>` : (TODAY > 0 ? ' · every past day is marked' : '')}`;
      const gj = q('#gapjump');
      if (gj) gj.onclick = () => { const first = rootRef.current?.querySelector('.cell.gap') as HTMLElement | null; if (first) { first.scrollIntoView({ block: 'center', behavior: 'smooth' }); first.focus(); first.classList.add('flash'); setTimeout(() => first.classList.remove('flash'), 600); } };
    }
    // site pills
    const nav = q('#sites');
    if (nav) {
      nav.innerHTML = `<button class="pill ${filter === 'all' ? 'on' : ''}" data-f="all">All sites</button>` +
        DATA.current.map((s, i) => `<button class="pill ${filter === s.site ? 'on' : ''}" data-f="${s.site}" style="--c:${SITE_DOT[i % SITE_DOT.length]}"><span class="dot"></span>${escapeHtml(shortSite(s.label))}</button>`).join('');
    }

    bind();
    // Restore focus into the search field while adding.
    if (A.site && !A.picked) {
      const inp = q('#addinput') as HTMLInputElement | null;
      if (inp) {
        if (!A.exp) { requestAnimationFrame(() => { A.exp = true; (q(`.morph[data-site="${A.site}"]`))?.classList.add('exp'); setTimeout(() => inp.focus(), 120); }); }
        else inp.focus();
        inp.oninput = () => renderPicker(inp.value);
        inp.onkeydown = (e) => {
          const hi = q('.picker button.hi');
          if (e.key === 'Enter' && hi) { (hi as HTMLButtonElement).click(); }
          else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const bs = [...rootRef.current!.querySelectorAll('.picker button')] as HTMLElement[];
            let idx = bs.findIndex(b => b.classList.contains('hi'));
            idx = e.key === 'ArrowDown' ? Math.min(bs.length - 1, idx + 1) : Math.max(0, idx - 1);
            bs.forEach(b => b.classList.remove('hi')); bs[idx]?.classList.add('hi');
          } else if (e.key === 'Escape') collapseAdd();
        };
        renderPicker(inp.value);
      }
    }
  }

  // ── add-worker picker ──────────────────────────────────────────────────────
  function renderPicker(query: string) {
    const A = addState.current; const menu = q('#picker'); if (!menu) return;
    const site = DATA.current.find(s => s.site === A.site); if (!site) return;
    const have = new Set([...site.crews.map(c => c.n), ...site.direct.map(w => w.n)]);
    const avail = PARTIES.current.filter(p => !have.has(p.name));
    const list = (query.trim() ? searchPayees(avail, query.trim()) : avail).slice(0, 8) as typeof avail;
    menu.innerHTML = list.map((p, i) => `<button class="${i === 0 ? 'hi' : ''}" data-pick="${escapeHtml(p.stakeholder_id)}">${escapeHtml(p.name)}<span class="tr">${escapeHtml(p.category || 'Worker')}</span></button>`).join('') +
      `<button class="new ${list.length ? '' : 'hi'}" data-new>+ New party${query.trim() ? ` "${escapeHtml(query.trim())}"` : ''} — added to Parties & this site</button>`;
  }
  function collapseAdd() {
    const A = addState.current;
    const m = q('.morph.exp');
    if (m && !A.picked) { m.classList.remove('exp'); m.querySelector('.picker')?.remove(); setTimeout(() => { A.site = null; A.picked = null; A.exp = false; render(); }, 260); }
    else { A.site = null; A.picked = null; A.exp = false; render(); }
  }

  // ── persistence ──────────────────────────────────────────────────────────────
  async function persistCell(subject: PersistSubject, projectId: string, i: number, value: number, row?: WorkerRow) {
    try {
      await saveCell(orgId, projectId, dates[i], subject, value, byName);
      if (row?.contractWages && row.crew) await foldWages([row.crew.crewId]);
    } catch (e) { fail(e); }
  }
  // A crew whose wages come off a contract settles as the days are marked: each new day's wage is
  // certified against the contract's next phase (so what is left to certify falls by that much) and
  // the day stops accruing a wage of its own. Only what an approval actually covers is settled.
  async function foldWages(crewIds: string[]) {
    const ids = [...new Set(crewIds)];
    if (!ids.length) return;
    let any = false;
    for (const id of ids) {
      try { const r = await autoSettleCrewWages(id, orgId); if (r && (r.approved > 0 || r.pending > 0)) any = true; }
      catch { /* the contract keeps its own record — a failed fold just leaves the day as wages */ }
    }
    if (any) await load();
  }
  const deriveRates = () => {
    const C = CARD.current; if (!C) return;
    for (const s of DATA.current) {
      for (const cr of s.crews) for (const cat of cr.cats) cat.rate = rateFor(cr.trade, cat.n);
      for (const w of s.direct) w.rate = rateFor(resolveTrade(w.cat), w.cat);
    }
  };
  const editRate = (cell: CardCell, v: number) => {
    const C = CARD.current; if (!C) return;
    const before = new Map<string, number>();
    for (const s of DATA.current) { for (const cr of s.crews) for (const cat of cr.cats) before.set('c' + cat.id, cat.rate); for (const w of s.direct) before.set('d' + w.id, w.rate); }
    if (cell.key === 'unskilled') C.unskilled[cell.kind as 'hm' | 'hf'] = v;
    else if (cell.key === 'supervisor') C.supervisor = v;
    else (C.trades[cell.key] ||= { skilled: null, hm: null, hf: null })[cell.kind] = v;
    C.since[cell.key + '.' + cell.kind] = 'today';
    saveRate(orgId, cell.key, cell.kind, v).catch(fail);
    deriveRates();
    const jobs: Promise<void>[] = [];
    for (const s of DATA.current) {
      for (const cr of s.crews) for (const cat of cr.cats) if (before.get('c' + cat.id) !== cat.rate) jobs.push(setCategoryRate(cat.id, cat.rate, false));
      for (const w of s.direct) if (before.get('d' + w.id) !== w.rate) jobs.push(setDirectRate(w.id, w.rate, false));
    }
    if (jobs.length) Promise.all(jobs).catch(fail);
  };

  // Click a past day header → mark every empty labour cell present (1). Only fills gaps.
  function fillDay(i: number) {
    if (locked || i < 0 || i > 6) return;
    let marked = 0; const saves: Promise<void>[] = []; const folds: string[] = [];
    DATA.current.forEach(site => {
      if (filterRef.current !== 'all' && filterRef.current !== site.site) return;
      const mark = (cells: Cell[], subject: PersistSubject) => { const c = cells[i]; if (c === 'off' || c) return; cells[i] = { v: 1, src: 'office', by: byName, at: 'just now' }; marked++; saves.push(saveCell(orgId, site.site, dates[i], subject, 1, byName)); };
      site.crews.forEach(crew => {
        if (isContractRow(crew)) return;
        const before = marked;
        crew.cats.forEach(cat => mark(cat.cells, { type: 'crew_category', category_id: cat.id }));
        if (marked > before && crew.basis === 'contract' && crew.accrualBasis === 'day') folds.push(crew.crewId);
      });
      site.direct.forEach(w => mark(w.cells, { type: 'direct', direct_worker_id: w.id }));
    });
    render();
    Promise.all(saves).then(() => foldWages(folds)).catch(fail);
    const dayName = new Date(dates[i]).toLocaleString('en-US', { weekday: 'long' });
    toast(marked ? `Marked ${marked} present on ${dayName} — tap any cell to adjust` : `Everyone already marked on ${dayName}`);
  }

  // ── the editor popover (one popup for a lone worker or a whole gang) ──────────
  const editor = () => q('#editor')!;
  const rowmenu = () => q('#rowmenu')!;
  function closeAll() { editor().classList.remove('open'); rowmenu().classList.remove('open'); rootRef.current?.querySelectorAll('.menu-open').forEach(x => x.classList.remove('menu-open')); }
  function place(el: HTMLElement, anchor: HTMLElement) {
    const r = anchor.getBoundingClientRect();
    el.style.left = Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - el.offsetWidth - 12) + 'px';
    el.style.top = (r.bottom + window.scrollY + 6) + 'px';
  }
  const focusCell = (rowId: string, i: number) => (q(`.cell[data-w="${rowId}"][data-i="${i}"]`))?.focus();

  function openEditor(r: WorkerRow, i: number, cellEl: HTMLElement, keep = false) {
    const el = editor();
    const dt = new Date(dates[i]);
    const pos = { t: el.style.top, l: el.style.left };
    el.innerHTML = `<div class="hd"><b>${escapeHtml(r.name)}</b><span>${DAYS[i]} ${dt.getDate()}</span></div>` +
      r.lines.map((l, j) => `<div class="cat"><span><span class="k">${escapeHtml(l.label)}</span><span class="r">${inr(l.rate)}</span></span><span class="step"><button data-j="${j}" data-d="-1">−</button><input data-j="${j}" value="${lineVal(l, i)}" inputmode="decimal"><button data-j="${j}" data-d="1">+</button></span></div>`).join('') +
      `<div class="ft"><span>${dayVal(r, i) ? `<span class="amt">${inr(dayWage(r, i))}</span> for the day` : 'nobody yet'}</span><button data-clear>clear</button></div><div class="hint">Saves as you go · Esc to close</div>`;
    el.classList.add('open');
    if (keep) { el.style.top = pos.t; el.style.left = pos.l; } else place(el, cellEl);
    const setLine = (j: number, v: number) => {
      const l = r.lines[j]; v = Math.max(0, v);
      l.cells[i] = v > 0 ? { v, src: 'office', by: byName, at: 'just now' } : null;
      persistCell(l.subject, r.siteId, i, v, r);
    };
    const commitAll = () => {
      [...el.querySelectorAll('input')].forEach((inp, j) => setLine(j, parseFloat((inp as HTMLInputElement).value) || 0));
      render();
      const c = q(`.cell[data-w="${r.id}"][data-i="${i}"]`);
      if (c) openEditor(r, i, c as HTMLElement, true);
    };
    el.querySelectorAll('button[data-d]').forEach(b => (b as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      const j = +(b as HTMLElement).dataset.j!; const inp = el.querySelector(`input[data-j="${j}"]`) as HTMLInputElement;
      inp.value = String(Math.max(0, (parseFloat(inp.value) || 0) + +(b as HTMLElement).dataset.d!));
      commitAll();
    });
    el.querySelectorAll('input').forEach(inp => {
      (inp as HTMLInputElement).onchange = commitAll;
      (inp as HTMLInputElement).onkeydown = (e) => { if (e.key === 'Enter') { commitAll(); closeAll(); focusCell(r.id, i); } };
    });
    (el.querySelector('[data-clear]') as HTMLElement).onclick = (e) => { e.stopPropagation(); r.lines.forEach(l => { l.cells[i] = null; persistCell(l.subject, r.siteId, i, 0, r); }); render(); closeAll(); };
    if (!keep) { const first = el.querySelector('input') as HTMLInputElement; first?.focus(); first?.select(); }
  }

  function openWorkerMenu(r: WorkerRow, btn: HTMLElement) {
    const el = rowmenu();
    el.innerHTML = `<button data-rates>Rates for ${escapeHtml((r.trade.split(' · ')[0] || r.trade).toLowerCase())}</button><button data-wa>Message on WhatsApp</button><hr><button data-ctr>Put on a contract…</button><hr><button class="danger" data-rm>Remove from this week</button>`;
    (el.querySelector('[data-rates]') as HTMLElement).onclick = () => { closeAll(); setRcOpen(true); };
    (el.querySelector('[data-wa]') as HTMLElement).onclick = () => { closeAll(); toast('Message on WhatsApp'); };
    (el.querySelector('[data-ctr]') as HTMLElement).onclick = () => { closeAll(); openPutOnContract(r); };
    (el.querySelector('[data-rm]') as HTMLElement).onclick = async () => {
      closeAll();
      const days = rowDays(r);
      try {
        if (r.crew) await removeCrew(r.crew.crewId); else if (r.direct) await removeDirectWorker(r.direct.id);
        await load();
        toast(`${r.name} taken off this week's sheet${days ? ` · ${fmtQ(days)} marked ${days === 1 ? 'day' : 'days'} cleared` : ''} · earlier weeks unchanged`);
      } catch (e) { fail(e); }
    };
    btn.closest('tr')?.classList.add('menu-open'); el.classList.add('open'); place(el, btn);
  }

  function openContractMenu(c: ContractRow, btn: HTMLElement) {
    const el = rowmenu();
    el.innerHTML = `<button data-open>Open contract</button><button data-wa>Message on WhatsApp</button><hr><button data-back>Move back to daily wages…</button><hr><button class="danger" data-rmc>Remove from this week</button>`;
    (el.querySelector('[data-open]') as HTMLElement).onclick = () => { closeAll(); toast('Opens the contract'); };
    (el.querySelector('[data-wa]') as HTMLElement).onclick = () => { closeAll(); toast('Message on WhatsApp'); };
    (el.querySelector('[data-back]') as HTMLElement).onclick = async () => {
      closeAll();
      try { await setCrewBasis(c.crew.crewId, 'labour'); await load(); toast('Back to daily wages from today'); } catch (e) { fail(e); }
    };
    (el.querySelector('[data-rmc]') as HTMLElement).onclick = async () => {
      closeAll();
      try { await removeCrew(c.crew.crewId); await load(); toast(`${c.crew.n} taken off this week's sheet · certified work stays on the contract`); } catch (e) { fail(e); }
    };
    btn.closest('tr')?.classList.add('menu-open'); el.classList.add('open'); place(el, btn);
  }

  function openCertify(c: ContractRow) {
    const crew = c.crew;
    setCertCtx({
      orgId, projectId: c.siteId, projectName: DATA.current[c.si]?.label,
      crewId: crew.crewId, stakeholderId: crew.stakeholderId ?? null, partyName: crew.n,
      woId: crew.woId ?? null, woLabel: crewLabel(crew), stages: crew.stages, stageIndex: uiStage(crew),
    });
  }

  async function openPutOnContract(r: WorkerRow) {
    if (r.crew) {
      const accrued = await accruedDayWagesForCrew(r.crew.crewId).catch(() => ({ days: 0, amount: 0 }));
      setPocCtx({ kind: 'crew', orgId, projectId: r.siteId, stakeholderId: r.crew.stakeholderId ?? null, crewId: r.crew.crewId, name: r.name, accrued });
    } else if (r.direct) {
      const w = r.direct;
      const accrued = await accruedDayWagesForDirect(w.id, w.rate).catch(() => ({ days: 0, amount: 0 }));
      setPocCtx({ kind: 'direct', orgId, projectId: r.siteId, stakeholderId: w.stakeholderId ?? null, name: w.n, accrued, worker: { id: w.id, name: w.n, category: w.cat, rate: w.rate, stakeholderId: w.stakeholderId ?? null }, trade: resolveTrade(w.cat) });
    }
  }

  function setCell(r: WorkerRow, i: number, n: number) {
    const l = r.lines[0]; if (!l) return;
    l.cells[i] = n > 0 ? { v: n, src: 'office', by: byName, at: 'just now' } : null;
    persistCell(l.subject, r.siteId, i, n, r); render(); focusCell(r.id, i);
  }

  // ── delegated interactions ────────────────────────────────────────────────────
  function bind() {
    const grid = q('#grid'); if (!grid) return;
    grid.querySelectorAll('[data-fill]').forEach(th => (th as HTMLElement).onclick = () => fillDay(+(th as HTMLElement).dataset.fill!));
    grid.querySelectorAll('[data-stsel]').forEach(sel => (sel as HTMLSelectElement).onchange = (e) => {
      e.stopPropagation();
      const c = CROWS.current.get((sel as HTMLElement).dataset.stsel!); if (!c) return;
      (c.crew as any)._uiStage = +(sel as HTMLSelectElement).value; render();
    });
    grid.querySelectorAll('[data-stsel]').forEach(sel => (sel as HTMLElement).onclick = (e) => e.stopPropagation());
  }

  // A single document click handles the rest (delegation), like the artifact.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const root = rootRef.current; if (!root) return;
      const t = e.target as HTMLElement;
      if (!root.contains(t) && !t.closest('.editor,.rowmenu')) { return; }
      const pill = t.closest('[data-f]'); if (pill) { filterRef.current = (pill as HTMLElement).dataset.f!; addState.current = { site: null, picked: null, exp: false }; render(); return; }
      const add = t.closest('[data-add]'); if (add) { e.preventDefault(); const s = (add as HTMLElement).dataset.add!; const A = addState.current; if (A.site === s) return; A.site = s; A.picked = null; A.exp = false; render(); return; }
      if (t.closest('[data-addcancel]')) { collapseAdd(); return; }
      const pick = t.closest('[data-pick]'); if (pick) { const id = (pick as HTMLElement).dataset.pick!; addState.current.picked = PARTIES.current.find(x => x.stakeholder_id === id) || null; render(); (q('.card[data-mode="wages"]'))?.focus(); return; }
      if (t.closest('[data-new]')) { void createNewParty(); return; }
      const md = t.closest('[data-mode]'); if (md) { void chooseMode((md as HTMLElement).dataset.mode as 'wages' | 'contract'); return; }
      const cell = t.closest('.cell[data-w]'); if (cell) { e.stopPropagation(); closeAll(); const r = WROWS.current.get((cell as HTMLElement).dataset.w!); if (r) openEditor(r, +(cell as HTMLElement).dataset.i!, cell as HTMLElement); return; }
      const mc = t.closest('button[data-menu-c]'); if (mc) { e.stopPropagation(); closeAll(); const c = CROWS.current.get((mc as HTMLElement).dataset.menuC!); if (c) openContractMenu(c, mc as HTMLElement); return; }
      const mb = t.closest('button[data-menu]'); if (mb) { e.stopPropagation(); closeAll(); const r = WROWS.current.get((mb as HTMLElement).dataset.menu!); if (r) openWorkerMenu(r, mb as HTMLElement); return; }
      const cb = t.closest('[data-cert]'); if (cb && !t.closest('select')) { const c = CROWS.current.get((cb as HTMLElement).dataset.cert!); if (c) openCertify(c); return; }
      if (!t.closest('.editor,.rowmenu,.morph')) closeAll();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeAll(); if (addState.current.site) collapseAdd(); return; }
      const cell = (document.activeElement as HTMLElement)?.closest?.('.cell[data-w]') as HTMLElement | null;
      if (!cell || editor().classList.contains('open')) return;
      const r = WROWS.current.get(cell.dataset.w!); const i = +cell.dataset.i!; if (!r) return;
      const move = (dr: number, dc: number) => {
        const rows = [...rootRef.current!.querySelectorAll('tr.worker')] as HTMLElement[];
        const idx = rows.findIndex(x => x.dataset.row === r.id);
        const nr = rows[idx + dr]; const ni = Math.max(0, Math.min(Math.min(TODAY, 5), i + dc));
        (nr || rows[idx])?.querySelector(`.cell[data-i="${ni}"]`)?.classList && ((nr || rows[idx])?.querySelector(`.cell[data-i="${ni}"]`) as HTMLElement)?.focus();
      };
      if (e.key === 'ArrowRight') { e.preventDefault(); move(0, 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); move(0, -1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); move(1, 0); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1, 0); }
      else if (/^[0-9]$/.test(e.key)) { e.preventDefault(); setCell(r, i, +e.key); }
      else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); setCell(r, i, 0); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor(r, i, cell); }
    };
    const onScroll = () => { if (editor().classList.contains('open') || rowmenu().classList.contains('open')) closeAll(); };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); window.removeEventListener('scroll', onScroll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monday, TODAY, locked]);

  async function createNewParty() {
    const A = addState.current; const inp = q('#addinput') as HTMLInputElement | null;
    const name = (inp?.value || '').trim(); if (!name) return;
    try { const c = await createParty(name, 'Worker', orgId); A.picked = { stakeholder_id: c.id, name: c.name, category: null }; PARTIES.current.push({ stakeholder_id: c.id, name: c.name, category: null }); render(); }
    catch (e) { fail(e); }
  }

  // Both add a crew (trade row + helpers, so the editor's per-skill steppers make sense). "On contract"
  // then opens the put-on-contract dialog for the fresh crew — which loads that party's real contracts.
  async function chooseMode(mode: 'wages' | 'contract') {
    const A = addState.current; const p = A.picked; const siteId = A.site; if (!p || !siteId) return;
    const trade = resolveTrade(p.category);
    const cats = mixFor(trade).map(c => ({ category: c, rate: rateFor(trade, c) }));
    A.site = null; A.picked = null; A.exp = false;
    try {
      const newCrewId = await addCrew(orgId, siteId, p.name, trade, cats, p.stakeholder_id || undefined);
      await load();
      const site = DATA.current.find(s => s.site === siteId);
      const crew = site && site.crews.find(c => c.crewId === newCrewId);
      if (mode === 'contract') {
        if (crew) {
          const accrued = await accruedDayWagesForCrew(crew.crewId).catch(() => ({ days: 0, amount: 0 }));
          setPocCtx({ kind: 'crew', orgId, projectId: siteId, stakeholderId: crew.stakeholderId ?? null, crewId: crew.crewId, name: crew.n, accrued });
        }
      } else if (crew) {
        // Wages — but this party may already hold a contract here, and then it matters whether the
        // day's wage comes off it or stands beside it. Ask only when there is something to ask about.
        const contracts = await loadWageContracts(siteId, crew.stakeholderId ?? null).catch(() => []);
        if (contracts.length) {
          setWagesAsk({ ctx: { orgId, projectId: siteId, stakeholderId: crew.stakeholderId ?? null, crewId: crew.crewId, name: crew.n }, contracts });
        }
      }
    } catch (e) { fail(e); }
  }

  // ── rate card (a right slide-in) ───────────────────────────────────────────────
  function renderCard() {
    const table = q('#atdxRcTable'); const C = CARD.current; if (!table || !C) return;
    const fmt = (n: number | null) => n == null ? '<span class="rc-dash">—</span>' : n.toLocaleString('en-IN');
    const cell = (key: string, field: string, v: number | null) => `<td><div class="cc" data-rc="${key}" data-f="${field}"><span class="v mono">${fmt(v)}</span>${C.since[key + '.' + field] ? `<span class="since">${C.since[key + '.' + field]}</span>` : ''}</div></td>`;
    const trades = Object.keys(C.trades);
    table.innerHTML =
      `<thead><tr><th class="cat">Worker type</th><th>Skilled<span class="p">per day</span></th><th>Helper · male<span class="p">per day</span></th><th>Helper · female<span class="p">per day</span></th></tr></thead><tbody>` +
      `<tr class="grp"><td colspan="4">Skilled trades — and the helpers who work under them</td></tr>` +
      (trades.length ? trades.map(t => `<tr><td class="cat">${escapeHtml(t)}</td>${cell(t, 'skilled', C.trades[t].skilled)}${cell(t, 'hm', C.trades[t].hm)}${cell(t, 'hf', C.trades[t].hf)}</tr>`).join('')
        : `<tr><td class="cat" colspan="4" class="rc-none">No trades yet — add one below.</td></tr>`) +
      `<tr class="grp"><td colspan="4">Unskilled — general labour, no trade</td></tr>` +
      `<tr><td class="cat">Unskilled labour</td><td><div class="cc rc-off"><span class="v mono rc-dash">—</span></div></td>${cell('unskilled', 'hm', C.unskilled.hm)}${cell('unskilled', 'hf', C.unskilled.hf)}</tr>` +
      `<tr class="grp"><td colspan="4">Supervision</td></tr>` +
      `<tr><td class="cat">Supervisor</td>${cell('supervisor', 'skilled', C.supervisor)}<td></td><td></td></tr></tbody>`;
    table.querySelectorAll('[data-rc]').forEach(div => (div as HTMLElement).onclick = () => {
      if (div.querySelector('input')) return;
      const key = (div as HTMLElement).dataset.rc!, f = (div as HTMLElement).dataset.f! as 'skilled' | 'hm' | 'hf';
      const cur = key === 'unskilled' ? C.unskilled[f as 'hm' | 'hf'] : key === 'supervisor' ? C.supervisor : C.trades[key][f];
      div.innerHTML = `<input class="mono" value="${cur ?? ''}" inputmode="numeric">`;
      const inp = div.querySelector('input') as HTMLInputElement; inp.focus(); inp.select();
      const commit = () => { const v = parseInt(inp.value.replace(/,/g, ''), 10); if (!isNaN(v)) { editRate({ key, kind: f }, v); render(); } renderCard(); };
      inp.onblur = commit;
      inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.onblur = null; renderCard(); } };
    });
  }
  function addDepartment() {
    const name = prompt('Department / trade name (e.g. Welder, Fabricator)')?.trim();
    if (!name || !CARD.current) return;
    if (CARD.current.trades[name] || name === SUPERVISOR_KEY) { toast('That department already exists.'); return; }
    CARD.current.trades[name] = { skilled: null, hm: null, hf: null };
    renderCard();
  }

  // ── the artifact's toast (with undo affordance reserved) ──────────────────────
  const toast = (m: string) => {
    const t = q('#toast'); if (!t) { showSnackbar(m); return; }
    t.textContent = m; t.classList.add('on');
    const anyT = t as any; clearTimeout(anyT._h); anyT._h = setTimeout(() => t.classList.remove('on'), 2600);
  };

  return (
    <div className={`atdx${locked ? ' wk-locked' : ''}${rcOpen ? ' rc-open' : ''}`} ref={rootRef}>
      <style>{ATDX_CSS}</style>
      {certCtx && <CertifyDialog ctx={certCtx} onClose={() => setCertCtx(null)} onDone={() => { setCertCtx(null); load(); }} onToast={toast} />}
      {pocCtx && <PutOnContractDialog ctx={pocCtx} onClose={() => setPocCtx(null)} onDone={() => { setPocCtx(null); load(); }} onError={(m) => { setPocCtx(null); fail(new Error(m)); }} onToast={toast} />}
      {wagesAsk && <WagesOnContractDialog ctx={wagesAsk.ctx} contracts={wagesAsk.contracts} onClose={() => setWagesAsk(null)} onDone={() => { setWagesAsk(null); load(); }} onError={(m) => { setWagesAsk(null); fail(new Error(m)); }} onToast={toast} />}

      <div className="page">
        <header className="top">
          <div>
            <h1>Attendance</h1>
            <p className="summary" id="summary" />
          </div>
          <div className="right">
            <div className="week">
              <button aria-label="Previous week" onClick={() => setMonday(m => { const d = new Date(m); d.setDate(d.getDate() - 7); return d; })}>‹</button>
              <span className="range">{weekLabel(monday)}</span>
              <button aria-label="Next week" onClick={() => setMonday(m => { const d = new Date(m); d.setDate(d.getDate() + 7); return d; })}>›</button>
              <button className="now" onClick={() => setMonday(mondayOf(new Date()))} disabled={isThisWeek}>{isThisWeek ? 'this week' : 'jump to now'}</button>
            </div>
            {locked && <span className="lockchip" title="This week is settled — its wages are already netted in the ledger and paid.">🔒 Settled</span>}
            <button className="link" onClick={() => setRcOpen(true)}>Rate card</button>
          </div>
        </header>

        <nav className="sites" id="sites" />

        <div className="sheet">
          <div className="scroll">
            <table id="grid">
              <colgroup>
                <col className="c-name" /><col className="c-day" /><col className="c-day" /><col className="c-day" /><col className="c-day" /><col className="c-day" /><col className="c-day" /><col className="c-day" /><col className="c-days" /><col className="c-amt" /><col className="c-menu" />
              </colgroup>
              <thead id="thead" />
            </table>
          </div>
        </div>

        {loading && (
          <div className="sheet" aria-hidden style={{ marginTop: 14 }}>
            {[0, 1].map(bi => (
              <div key={bi} style={{ padding: '10px 22px' }}>
                {[0, 1, 2].map(ri => (
                  <div key={ri} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0' }}>
                    <span className="sk-bar" style={{ width: `${28 + ri * 10}%` }} />
                    {[0, 1, 2, 3, 4, 5, 6].map(d => <span key={d} className="sk-cell" />)}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        {err && <div className="state">{err} · <button className="retry" onClick={() => load()}>retry</button></div>}

        <section className="notes">
          <h3>How the sheet behaves</h3>
          <ul>
            <li>Tap a day — the counter opens on it, saves as you go, <kbd>Esc</kbd> or tap away closes it. Same popup for one man or a gang of twelve.</li>
            <li><kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> move like a spreadsheet. <kbd>Backspace</kbd> clears. <kbd>Esc</kbd> closes anything.</li>
            <li>Dashed cells are past days nobody marked. The count in the summary jumps to the first one; a past day-header marks everyone present.</li>
            <li>Add worker sits as the last row of each site. Pick a name, answer one question — wages or contract — and it's on the sheet.</li>
            <li>Removing someone (⋯) only takes them off <i>this week's</i> sheet — earlier weeks and their payments are untouched.</li>
            <li>A party on contract sits in the same columns, tagged <i>contract</i>. Tap the stage bar to certify in that stage's own unit; it works out the ₹.</li>
          </ul>
        </section>
      </div>

      <div className="editor" id="editor" role="dialog" />
      <div className="rowmenu" id="rowmenu" />
      <div className="toast" id="toast" />

      {/* rate card — slides in from the right */}
      <div className={`rcdrawer${rcOpen ? ' open' : ''}`} aria-hidden={!rcOpen}>
        <div className="rcd-scrim" onClick={() => setRcOpen(false)} />
        <aside className="rcd-panel" role="dialog" aria-label="Rate card">
          <div className="rcd-head"><div><b>Rate card</b><span>Daily rates by worker type — change from today; earlier weeks keep the old rate.</span></div><button className="rcd-x" onClick={() => setRcOpen(false)} aria-label="Close">×</button></div>
          <div className="rcd-body"><table id="atdxRcTable" /></div>
          <div className="rcd-foot"><button onClick={addDepartment}>+ Add department</button></div>
        </aside>
      </div>
    </div>
  );
}

const ATDX_CSS = `
.atdx{
  --paper:#FCFAF6; --cream:#F4F0E8; --cream-2:#EDE7DC; --ink:#1E1915; --walnut:#6E5F51; --mute:#A0958A;
  --hair:rgba(70,50,30,.10); --hair-2:rgba(70,50,30,.18);
  --terra:#C4552D; --terra-ink:#A8431F; --terra-soft:#FBEEE7;
  --sage:#7F927A; --sage-soft:#E8EEE1; --sage-ink:#4A5F45;
  --gap:rgba(70,50,30,.22); --today:#FFF7F1;
  --r-xs:6px; --r-s:8px; --r-m:12px; --r-l:16px;
  --ease:cubic-bezier(.2,.8,.2,1);
  --shadow-1:0 1px 2px rgba(50,35,20,.05),0 0 0 1px var(--hair);
  --shadow-2:0 12px 40px rgba(50,35,20,.12),0 2px 6px rgba(50,35,20,.06),0 0 0 1px var(--hair);
  --shadow-3:0 28px 80px rgba(50,35,20,.20),0 6px 18px rgba(50,35,20,.08);
  background:var(--cream); color:var(--ink);
  font-family:"DM Sans",-apple-system,system-ui,sans-serif;font-size:14px;line-height:1.45;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;min-height:100vh}
.atdx *{box-sizing:border-box}
.atdx button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
.atdx .mono{font-family:"DM Mono",ui-monospace,SFMono-Regular,Menlo,monospace;font-feature-settings:"tnum"}
.atdx :focus-visible{outline:2px solid var(--terra);outline-offset:2px;border-radius:var(--r-xs)}

.atdx .page{max-width:1160px;margin:0 auto;padding:44px 32px 120px}

/* top */
.atdx .top{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap}
.atdx .top h1{font-family:"Playfair Display",Georgia,serif;font-weight:500;font-size:38px;line-height:1;margin:0 0 12px;letter-spacing:-.015em}
.atdx .summary{margin:0;color:var(--walnut);font-size:15px;letter-spacing:-.005em}
.atdx .summary b{color:var(--ink);font-weight:500;font-family:"DM Mono",monospace;font-size:14px}
.atdx .summary .gaps{color:var(--terra-ink);cursor:pointer;border-bottom:1px solid transparent;transition:border-color .15s var(--ease)}
.atdx .summary .gaps:hover{border-bottom-color:var(--terra)}
.atdx .right{display:flex;align-items:center;gap:10px}
.atdx .week{display:flex;align-items:center;height:36px;border-radius:999px;background:var(--paper);box-shadow:var(--shadow-1);padding:0 4px}
.atdx .week>button{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;color:var(--walnut);font-size:16px;line-height:1;transition:background .15s var(--ease)}
.atdx .week>button:hover{background:var(--cream);color:var(--ink)}
.atdx .week .range{font-family:"Playfair Display",Georgia,serif;font-size:16px;padding:0 4px;min-width:104px;text-align:center;letter-spacing:-.01em}
.atdx .week .now{font-size:12.5px;color:var(--mute);padding:0 10px 0 6px;width:auto}
.atdx .week .now:not(:disabled):hover{color:var(--ink)}
.atdx .week .now:disabled{cursor:default}
.atdx .lockchip{font-size:12px;font-weight:500;color:var(--terra-ink);background:var(--terra-soft);border-radius:999px;padding:6px 12px}
.atdx .link{color:var(--walnut);padding:0 10px;height:36px;display:inline-flex;align-items:center;border-radius:999px;transition:background .15s var(--ease),color .15s}
.atdx .link:hover{color:var(--ink);background:var(--paper)}

/* site filter: segmented */
.atdx .sites{display:inline-flex;gap:2px;margin:28px 0 16px;padding:3px;border-radius:999px;background:var(--cream-2);flex-wrap:wrap}
.atdx .pill{display:inline-flex;align-items:center;gap:8px;height:30px;padding:0 13px;border-radius:999px;color:var(--walnut);font-weight:500;font-size:13.5px;transition:color .15s var(--ease),background .15s var(--ease),box-shadow .15s var(--ease)}
.atdx .pill .dot{width:6px;height:6px;border-radius:50%;background:var(--c,var(--mute))}
.atdx .pill:hover{color:var(--ink)}
.atdx .pill.on{background:var(--paper);color:var(--ink);box-shadow:0 1px 3px rgba(50,35,20,.10),0 0 0 .5px var(--hair)}

/* sheet */
/* No clip on the sheet: the app reserves a 220px rail, so on a narrower window the table can be
   wider than the content area — clipping would hide the Days / This-week columns with no way to
   reach them. Left visible, the page scrolls to them and the sticky header + add-worker dropdown
   both keep working. Corners stay rounded via the first/last cells' own radii. */
.atdx .sheet{background:var(--cream);border-radius:var(--r-l)}
.atdx tbody td,.atdx tbody th{background:var(--paper)}
.atdx tbody tr.spacer td{background:var(--cream)}
.atdx .scroll{overflow:visible}
.atdx table{width:100%;border-collapse:separate;border-spacing:0;min-width:900px}
.atdx th,.atdx td{text-align:left;font-weight:400;vertical-align:middle}
.atdx thead th{position:sticky;top:0;z-index:3;background:rgba(244,240,232,.92);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:inset 0 -1px var(--hair-2);
  padding:12px 0 10px;font-size:12px;color:var(--walnut);text-align:center;font-weight:500;letter-spacing:.01em}
.atdx thead th:first-child{text-align:left;padding-left:22px;color:var(--mute);font-weight:500}
.atdx thead th .d{display:block;font-family:"DM Mono",monospace;font-size:17px;color:var(--ink);margin:3px auto 0;font-weight:500;width:28px;height:28px;line-height:28px;border-radius:50%}
.atdx thead th.today{color:var(--terra-ink)}
.atdx thead th.today .d{background:var(--terra);color:#fff}
.atdx thead th.fillable{cursor:pointer}
.atdx thead th.fillable:hover .d{background:var(--cream-2)}
.atdx thead th.tot{text-align:right;padding-right:18px;color:var(--mute)}
.atdx thead th.tot:last-of-type{padding-right:52px}

.atdx td.day{box-shadow:inset 1px 0 rgba(70,50,30,.045)}
.atdx td.who + td.day{box-shadow:none}
.atdx tr.worker td.day,.atdx tr.contract td.day{box-shadow:inset 1px 0 rgba(70,50,30,.045),inset 0 -1px var(--hair)}
.atdx tr.worker td.who + td.day{box-shadow:inset 0 -1px var(--hair)}

.atdx col.c-name{width:270px} .atdx col.c-day{width:66px} .atdx col.c-days{width:58px} .atdx col.c-amt{width:110px} .atdx col.c-menu{width:40px}

.atdx tr.spacer td{height:18px;background:var(--cream);box-shadow:none;padding:0}
.atdx tr.group th{position:sticky;top:69px;z-index:2;background:var(--paper);box-shadow:inset 0 -1px var(--hair);padding:16px 22px 10px;text-align:left}
.atdx tr.group .g{display:flex;align-items:baseline;gap:10px}
.atdx tr.group .g .dot{width:7px;height:7px;border-radius:50%;background:var(--c);align-self:center}
.atdx tr.group .g .name{font-family:"Playfair Display",Georgia,serif;font-size:18px;font-weight:500;letter-spacing:-.01em}
.atdx tr.group .g .place{color:var(--mute);font-size:13px}

/* add worker morph */
.atdx tr.addrow td{padding:10px 22px 14px;box-shadow:inset 0 1px rgba(70,50,30,.06)}
.atdx tr.addrow td.tot{padding-left:0;padding-right:18px}
.atdx tr.addrow td.tot.sum{color:var(--walnut);font-weight:400;font-size:13px}
.atdx tr.addrow td.tot.sum.zero{color:var(--mute)}
.atdx tbody tr:last-child td{box-shadow:inset 0 1px rgba(70,50,30,.06)}
.atdx .morph{position:relative;display:inline-flex;align-items:center;height:36px;width:128px;border-radius:999px;background:var(--paper);box-shadow:0 1px 2px rgba(50,35,20,.08),0 0 0 1px var(--hair);padding:0 6px 0 5px;overflow:visible;transition:width .32s var(--ease),box-shadow .2s var(--ease),transform .2s var(--ease)}
.atdx .morph:not(.exp):hover{box-shadow:0 3px 10px rgba(50,35,20,.12),0 0 0 1px var(--hair-2);transform:translateY(-1px)}
.atdx .morph:not(.exp):hover .plus{transform:rotate(90deg)}
.atdx .morph .plus{flex:none;width:24px;height:24px;border-radius:50%;background:var(--terra);color:#fff;display:grid;place-items:center;font-size:17px;line-height:1;transition:transform .3s var(--ease),background .2s}
.atdx .morph .label{white-space:nowrap;font-size:13px;font-weight:500;color:var(--ink);padding:0 10px 0 9px;letter-spacing:-.005em;transition:opacity .15s var(--ease)}
.atdx .morph input{width:0;opacity:0;border:0;background:transparent;outline:0;font:inherit;color:var(--ink);padding:0;transition:width .32s var(--ease),opacity .2s var(--ease) .08s}
.atdx .morph input::placeholder{color:var(--mute)}
.atdx .morph .close{width:0;opacity:0;overflow:hidden;color:var(--mute);font-size:18px;line-height:1;border-radius:50%;transition:opacity .2s var(--ease),width .32s var(--ease),background .15s}
.atdx .morph.exp{width:420px;box-shadow:0 3px 12px rgba(50,35,20,.10),0 0 0 1.5px var(--terra)}
.atdx .morph.exp .plus{transform:rotate(45deg);background:var(--terra-ink)}
.atdx .morph.exp .label{opacity:0;width:0;padding:0 0 0 10px;pointer-events:none}
.atdx .morph.exp input{width:100%;flex:1;opacity:1;padding:0 6px}
.atdx .morph.exp .close{width:26px;height:26px;opacity:1;display:grid;place-items:center}
.atdx .morph.exp .close:hover{background:var(--cream-2);color:var(--ink)}
.atdx .picker{position:absolute;top:calc(100% + 8px);left:0;z-index:15;width:400px;background:var(--paper);border-radius:var(--r-m);box-shadow:var(--shadow-2);padding:6px;max-height:300px;overflow:auto;animation:atdx-pop .18s var(--ease)}
.atdx .picker button{display:flex;width:100%;text-align:left;padding:9px 12px;border-radius:var(--r-s);gap:8px;align-items:baseline;transition:background .12s var(--ease)}
.atdx .picker button:hover,.atdx .picker button.hi{background:var(--cream)}
.atdx .picker button .tr{color:var(--mute);font-size:12.5px;margin-left:auto}
.atdx .picker button.new{color:var(--terra-ink);box-shadow:inset 0 1px var(--hair);border-radius:0 0 var(--r-s) var(--r-s);margin-top:4px;padding-top:11px}
.atdx .ask{display:flex;align-items:center;gap:18px;flex-wrap:wrap;animation:atdx-pop .18s var(--ease)}
.atdx .askhd{font-size:14px;color:var(--walnut);white-space:nowrap}
.atdx .askhd b{color:var(--ink);font-weight:500}
.atdx .askhd span{color:var(--mute)}
.atdx .cards{display:flex;gap:10px;flex-wrap:wrap}
.atdx .card{display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;column-gap:12px;text-align:left;width:300px;padding:12px 16px 13px 14px;border-radius:14px;background:var(--cream);box-shadow:inset 0 0 0 1px transparent;transition:background .15s var(--ease),box-shadow .15s var(--ease),transform .15s var(--ease)}
.atdx .card .ci{grid-row:1/3;align-self:start;width:28px;height:28px;border-radius:8px;background:var(--paper);display:grid;place-items:center;font-family:"DM Mono",monospace;font-size:13px;color:var(--walnut);margin-top:1px;box-shadow:var(--shadow-1)}
.atdx .card .ct{font-weight:500}
.atdx .card .cs{font-size:12.5px;color:var(--walnut);line-height:1.4;margin-top:2px}
.atdx .card:hover,.atdx .card:focus-visible{background:var(--paper);box-shadow:inset 0 0 0 1.5px var(--terra);outline:0}
.atdx .card:active{transform:scale(.99)}
.atdx .card.dim{opacity:.55}
.atdx .card.dim:hover{background:var(--cream);box-shadow:none}
.atdx .cancel{color:var(--mute);font-size:13.5px;transition:color .15s}
.atdx .cancel:hover{color:var(--ink)}

/* rows */
.atdx tr.worker td,.atdx tr.contract td{height:50px;box-shadow:inset 0 -1px var(--hair);transition:background .15s var(--ease)}
.atdx tbody tr.group:first-child th,.atdx tbody tr.spacer + tr.group th{border-radius:var(--r-l) var(--r-l) 0 0}
.atdx tbody tr:last-child td:first-child{border-bottom-left-radius:var(--r-l)}
.atdx tbody tr:last-child td:last-child{border-bottom-right-radius:var(--r-l)}
.atdx tr.worker:hover td,.atdx tr.contract:hover td{background:#F8F5EE}
.atdx td.who{padding-left:22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.atdx td.who .n{font-weight:500;letter-spacing:-.005em}
.atdx td.who .t,.atdx td.who .tag{color:var(--mute);margin-left:9px;font-size:13px}
.atdx td.day{text-align:center;padding:6px 4px}
.atdx td.day .cell{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;height:38px;border-radius:var(--r-s);
  font-family:"DM Mono",monospace;font-size:15px;color:var(--ink);cursor:pointer;user-select:none;outline:0;
  transition:background .15s var(--ease),transform .15s var(--ease),box-shadow .15s var(--ease)}
.atdx td.day .cell:focus-visible{outline:0;box-shadow:0 0 0 2px var(--paper),0 0 0 4px var(--terra)}
.atdx td.day .cell:active{transform:scale(.96)}
.atdx td.day .cell .sub{font-size:10px;color:var(--sage-ink);opacity:.7;line-height:1;margin-top:2px;letter-spacing:.02em}
.atdx td.day .cell .src{position:absolute;top:5px;right:7px;width:5px;height:5px;border-radius:50%;background:var(--sage)}
.atdx td.day .cell.filled{background:var(--sage-soft);color:var(--sage-ink);font-weight:500}
.atdx td.day .cell.filled:hover{background:#DFE7D6}
.atdx td.day .cell.gap{border:1px dashed var(--gap)}
.atdx td.day .cell.gap::before,.atdx td.day.today .cell:not(.filled)::before{content:"+";font-family:"DM Sans";font-size:14px;color:var(--mute);opacity:0;transition:opacity .15s var(--ease)}
.atdx td.day .cell.gap:hover{border-color:var(--hair-2);background:var(--cream)}
.atdx td.day .cell.gap:hover::before{opacity:1}
.atdx td.day.today .cell:not(.filled){background:var(--today);box-shadow:inset 0 0 0 1px rgba(196,85,45,.28)}
.atdx td.day.today .cell:not(.filled):hover{box-shadow:inset 0 0 0 1px var(--terra)}
.atdx td.day.today .cell:not(.filled):hover::before{opacity:1;color:var(--terra-ink)}
.atdx td.day.future .cell{cursor:default;border:1px dashed var(--hair)}
.atdx td.day .cell.flash{animation:atdx-flash .6s var(--ease)}
@keyframes atdx-flash{0%{box-shadow:0 0 0 0 rgba(196,85,45,.5)}100%{box-shadow:0 0 0 12px rgba(196,85,45,0)}}
.atdx td.tot{text-align:right;padding-right:18px;font-family:"DM Mono",monospace;color:var(--walnut);white-space:nowrap;font-size:13.5px}
.atdx td.tot.days{color:var(--ink)}
.atdx td.tot.zero{color:var(--mute)}
.atdx td.menu{text-align:right;padding-right:12px}
.atdx td.menu button{width:28px;height:28px;border-radius:var(--r-xs);color:var(--walnut);display:inline-grid;place-items:center;opacity:0;transition:opacity .15s var(--ease),background .15s}
.atdx tr:hover td.menu button,.atdx td.menu button:focus-visible,.atdx .menu-open td.menu button{opacity:1}
.atdx td.menu button:hover{background:var(--cream-2);color:var(--ink)}

.atdx tr.empty td{padding:14px 22px 18px;color:var(--mute);box-shadow:none}
.atdx tr.empty td a{color:var(--terra-ink);cursor:pointer;border-bottom:1px solid var(--terra-soft)}

/* contract row */
.atdx tr.contract td{height:60px}
.atdx tr.contract td.who{white-space:normal;line-height:1.35}
.atdx .sel.mini{appearance:none;-webkit-appearance:none;width:auto;max-width:100%;padding:2px 20px 2px 6px;font:inherit;font-size:12.5px;color:var(--mute);border:0;border-radius:var(--r-xs);background:transparent url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M1 1l3 3 3-3' stroke='%23A0958A' fill='none' stroke-width='1.3'/%3E%3C/svg%3E") no-repeat right 6px center;margin-left:-6px;outline:0;transition:background .15s var(--ease),color .15s}
.atdx select.sel.mini:hover{background-color:var(--cream-2);color:var(--ink)}
.atdx select.sel.mini:focus-visible{outline:2px solid var(--terra);outline-offset:1px}
.atdx .sel.mini.wo{display:inline-block;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:none;padding-left:0;margin-left:0}
.atdx td.cwork{padding:6px 4px;cursor:pointer}
.atdx td.cwork .cw{display:flex;align-items:center;gap:14px;min-width:0;height:38px;border:1px dashed var(--gap);border-radius:var(--r-s);padding:0 12px 0 4px;transition:border-color .15s var(--ease),background .15s var(--ease)}
.atdx td.cwork:hover .cw{border-color:var(--hair-2);background:var(--cream)}
.atdx td.cwork .sel.mini.stage{color:var(--ink);font-weight:500;font-size:13px;max-width:46%;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:0}
.atdx td.cwork .bar{flex:1;height:4px;border-radius:2px;background:var(--cream-2);position:relative;min-width:60px;overflow:hidden}
.atdx td.cwork .bar i{position:absolute;inset:0 auto 0 0;background:var(--sage);border-radius:2px;transition:width .3s var(--ease),background .15s}
.atdx td.cwork:hover .bar i{background:var(--terra)}
.atdx td.cwork .num{font-family:"DM Mono",monospace;color:var(--walnut);white-space:nowrap;font-size:13px}
.atdx td.cwork .num b{color:var(--ink);font-weight:500}
.atdx tr.contract td.tot .amt{display:block;color:var(--walnut)}
.atdx tr.contract td.tot.zero .amt{color:var(--mute)}
.atdx tr.contract td.tot .of{display:block;font-size:11px;color:var(--mute);margin-top:1px}

/* popovers */
.atdx .editor,.atdx .rowmenu{position:absolute;z-index:20;background:var(--paper);border-radius:var(--r-m);box-shadow:var(--shadow-2);display:none;transform-origin:top left}
.atdx .editor.open,.atdx .rowmenu.open{display:block;animation:atdx-pop .18s var(--ease)}
.atdx .editor{padding:12px 12px 10px;width:256px}
.atdx .editor .hd{display:flex;justify-content:space-between;color:var(--mute);font-size:12.5px;margin-bottom:8px;padding:0 4px}
.atdx .editor .hd b{color:var(--ink);font-weight:500}
.atdx .editor .cat{display:flex;align-items:center;justify-content:space-between;padding:5px 4px}
.atdx .editor .cat .k{font-size:13.5px}
.atdx .editor .cat .r{color:var(--mute);font-size:12px;font-family:"DM Mono",monospace;margin-left:6px}
.atdx .step{display:inline-flex;align-items:center;border-radius:var(--r-s);background:var(--cream-2);padding:2px}
.atdx .step button{width:26px;height:26px;border-radius:6px;color:var(--walnut);font-size:15px;transition:background .15s var(--ease),transform .1s}
.atdx .step button:hover{background:var(--paper);color:var(--ink)}
.atdx .step button:active{transform:scale(.92)}
.atdx .step input{width:34px;height:26px;text-align:center;border:0;background:transparent;font-family:"DM Mono",monospace;font-size:14px;color:var(--ink);outline:0}
.atdx .editor .ft{display:flex;justify-content:space-between;align-items:center;box-shadow:inset 0 1px var(--hair);margin-top:8px;padding:9px 4px 0;font-size:12.5px;color:var(--mute)}
.atdx .editor .ft .amt{font-family:"DM Mono",monospace;color:var(--ink)}
.atdx .editor .ft button:hover{color:var(--terra-ink)}
.atdx .editor .hint{font-size:11.5px;color:var(--mute);margin-top:6px;padding:0 4px;opacity:.8}
.atdx .rowmenu{padding:6px;width:212px}
.atdx .rowmenu button{display:block;width:100%;text-align:left;padding:8px 10px;border-radius:var(--r-s);font-size:13.5px;transition:background .12s var(--ease)}
.atdx .rowmenu button:hover{background:var(--cream)}
.atdx .rowmenu button.danger{color:var(--terra-ink)}
.atdx .rowmenu hr{border:0;border-top:1px solid var(--hair);margin:5px 6px}

/* toast */
.atdx .toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%) translateY(10px);opacity:0;background:rgba(30,25,21,.92);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#F6F1E9;padding:11px 18px;border-radius:999px;font-size:13.5px;transition:.22s var(--ease);z-index:95;white-space:nowrap;box-shadow:0 8px 30px rgba(0,0,0,.25);pointer-events:none}
.atdx .toast.on{transform:translateX(-50%);opacity:1}

/* notes */
.atdx .notes{margin-top:56px;color:var(--walnut);font-size:13.5px;max-width:680px;line-height:1.55}
.atdx .notes h3{font-family:"Playfair Display",Georgia,serif;font-weight:500;font-size:18px;color:var(--ink);margin:0 0 10px}
.atdx .notes ul{margin:0;padding-left:18px}
.atdx .notes li{margin:6px 0}
.atdx kbd{font-family:"DM Mono",monospace;font-size:11.5px;border-radius:5px;padding:1px 6px;background:var(--paper);box-shadow:var(--shadow-1)}

/* states + skeleton */
.atdx .state{padding:40px 18px;text-align:center;color:var(--terra-ink);font-size:14px}
.atdx .state .retry{text-decoration:underline;color:var(--terra-ink)}
.atdx .sk-bar,.atdx .sk-cell{display:inline-block;background:linear-gradient(90deg,var(--cream-2) 25%,var(--paper) 50%,var(--cream-2) 75%);background-size:200% 100%;animation:atdx-sk 1.5s ease-in-out infinite;border-radius:6px}
.atdx .sk-bar{height:11px}
.atdx .sk-cell{width:44px;height:32px;margin-left:10px;border-radius:8px}
@keyframes atdx-sk{0%{background-position:200% 0}100%{background-position:-200% 0}}

/* settled week: freeze the sheet */
.atdx.wk-locked .sheet tbody{opacity:.66;filter:saturate(.65)}
.atdx.wk-locked .cell{pointer-events:none;cursor:default}

/* rate card drawer */
.atdx .rcdrawer{position:fixed;inset:0;z-index:88;pointer-events:none}
.atdx .rcdrawer.open{pointer-events:auto}
.atdx .rcd-scrim{position:absolute;inset:0;background:rgba(40,28,18,.24);opacity:0;transition:opacity .28s var(--ease)}
.atdx .rcdrawer.open .rcd-scrim{opacity:1}
.atdx .rcd-panel{position:absolute;top:0;right:0;bottom:0;width:min(460px,92vw);background:var(--paper);box-shadow:-24px 0 70px -30px rgba(40,28,18,.5);
  transform:translateX(100%);transition:transform .34s var(--ease);display:flex;flex-direction:column;overflow:hidden}
.atdx .rcdrawer.open .rcd-panel{transform:none}
.atdx .rcd-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:22px 22px 14px;box-shadow:inset 0 -1px var(--hair)}
.atdx .rcd-head b{font-family:"Playfair Display",Georgia,serif;font-weight:500;font-size:20px;display:block}
.atdx .rcd-head span{color:var(--mute);font-size:12.5px;display:block;margin-top:3px;max-width:320px}
.atdx .rcd-x{width:30px;height:30px;border-radius:50%;color:var(--walnut);font-size:20px;display:grid;place-items:center;flex:none}
.atdx .rcd-x:hover{background:var(--cream-2);color:var(--ink)}
.atdx .rcd-body{flex:1;overflow:auto;padding:8px 0}
.atdx #atdxRcTable{width:100%;min-width:0;border-collapse:separate;border-spacing:0}
.atdx #atdxRcTable th{font-size:12px;font-weight:500;color:var(--mute);padding:8px 10px;text-align:right;box-shadow:inset 0 -1px var(--hair)}
.atdx #atdxRcTable th.cat{text-align:left;padding-left:22px;width:180px}
.atdx #atdxRcTable th .p{display:block;font-size:11px;color:var(--mute)}
.atdx #atdxRcTable td{padding:0;text-align:right;box-shadow:inset 0 -1px var(--hair);height:42px;background:var(--paper)}
.atdx #atdxRcTable td.cat{text-align:left;padding-left:22px;font-size:14px}
.atdx #atdxRcTable tr.grp td{background:var(--cream);height:28px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);text-align:left;padding-left:22px}
.atdx #atdxRcTable .cc{display:flex;justify-content:flex-end;align-items:baseline;gap:6px;padding:0 16px;height:100%;cursor:text}
.atdx #atdxRcTable .cc:hover{background:var(--cream)}
.atdx #atdxRcTable .cc.rc-off{cursor:default}
.atdx #atdxRcTable .cc .v{font-weight:500;font-family:"DM Mono",monospace}
.atdx #atdxRcTable .rc-dash{color:var(--hair-2)}
.atdx #atdxRcTable .cc .since{font-size:11px;color:var(--terra-ink)}
.atdx #atdxRcTable .cc input{width:64px;text-align:right;border:0;border-bottom:1.5px solid var(--walnut);background:transparent;font-size:14px;padding:0;font-family:"DM Mono",monospace}
.atdx #atdxRcTable .cc input:focus{outline:none}
.atdx .rcd-foot{padding:14px 22px;box-shadow:inset 0 1px var(--hair)}
.atdx .rcd-foot button{color:var(--walnut);font-weight:500;font-size:13.5px}
.atdx .rcd-foot button:hover{color:var(--ink)}

@keyframes atdx-pop{from{opacity:0;transform:translateY(-4px) scale(.97)}to{opacity:1;transform:none}}

@media (max-width:760px){
  .atdx .page{padding:24px 14px 80px}
  .atdx .top h1{font-size:32px}
  .atdx col.c-name{width:200px}
  .atdx .sites{display:flex;overflow-x:auto}
}
@media (prefers-reduced-motion:reduce){.atdx *{animation:none!important;transition:none!important}}
`;
