/**
 * Attendance on a phone — the briklayattendancemobile1 reference, wired to Supabase.
 *
 * The reference is a day-at-a-time muster: one day is selected in the strip at the top, the list
 * below shows every site's workers for THAT day, and you swipe sideways to move through the week.
 * Everything past the tap — the crew breakdown, adding a worker, editing rates — happens in one
 * bottom sheet. That model, its markup and its script are ported here as they are; only the data
 * underneath changes, from the reference's literal SITES to the live week out of attendanceApi.
 *
 * Where the app knows something the reference could not:
 *  · The week is Monday-first, as everywhere else in Briklay, so the strip reads Mon…Sun.
 *  · A crew on a contract is not mustered by headcount — its counter reads overall progress and
 *    its sheet lists the contract's stages, each one opening the certification wizard.
 *  · Wage-type prefills come from the org's own rate card rather than the reference's hardcoded
 *    trade templates.
 * The render stays imperative (innerHTML + delegated listeners) exactly as the reference's script
 * is, inside a scoped root — the same shape as the desktop AttendanceSheet next door.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { useOrgId } from '../../lib/auth/AuthProvider';
import { useSnackbar } from '../Snackbar';
import {
  loadWeek, loadParties, mondayOf, weekDates, weekLabel,
  saveCell, addCategory, addDirectWorker, addCrew,
  renameCrew, updateCategory, updateDirectWorker,
  loadWorkOrdersForProject, linkCrewToWorkOrder, promoteDirectToCrew,
  removeCrew, removeDirectWorker, removeCategory,
  cardIsEmpty, seedRateCard,
  type SiteRow, type CrewRow, type DirectRow, type RateCard, type Cell, type StageRow,
} from '../../lib/attendanceApi';
import { searchPayees } from '../../lib/payeeSearch';
import { createParty } from '../day-book/fileEntry';
import { CertificationWizard, type CertifyContext } from './CertificationWizard';
import { ATMX_CSS } from './atmxCss';

/* The reference's site dots, in its order. */
const SITE_DOT = ['#BE3E22', '#6E8260', '#B98A2F', '#5E7A8A'];
/* A single worker's counter cycles through the day: nothing → a day → a day and a half → two. */
const CYCLE = [1, 1.5, 2, 0];

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const hapt = (ms: number | number[]) => { try { navigator.vibrate?.(ms as number); } catch { /* not every phone has it */ } };
const val = (c: Cell) => (c && c !== 'off') ? c.v : 0;
/** Half days are real, so a count can be 1.5 — print it, without float dust. */
const num = (n: number) => String(Math.round(n * 100) / 100);

/** One wage type of one worker: what it is called, what it costs, and its seven days. */
interface WType { t: string; rate: number; cells: Cell[]; catId?: string }
/** A row in the phone's list. A crew and a single worker are the same thing here, with more or
 *  fewer wage types; a crew on a contract carries stages instead. */
interface MWorker {
  si: number; wi: number; key: string;
  name: string; trade: string;
  types: WType[];
  onContract: boolean;
  crew?: CrewRow; direct?: DirectRow;
  stages: StageRow[];
  projectId: string;
}

const crewTrade = (crew: CrewRow, types: WType[]) =>
  types.length > 1 ? `${crew.trade || types[0]?.t || 'Labour'} crew` : (types[0]?.t || crew.d || 'Labour');

function workersOf(site: SiteRow, si: number): MWorker[] {
  const out: MWorker[] = [];
  site.crews.forEach((crew, ci) => {
    const types: WType[] = crew.cats.map(cat => ({ t: cat.n, rate: cat.rate, cells: cat.cells, catId: cat.id }));
    const onContract = crew.basis === 'contract';
    out.push({
      si, wi: ci, key: `c${ci}`, name: crew.n,
      trade: onContract ? `${crew.d || crew.trade || 'Contract'} · contract` : crewTrade(crew, types),
      types, onContract, crew, stages: crew.stages, projectId: site.site,
    });
  });
  site.direct.forEach((w, di) => {
    out.push({
      si, wi: di, key: `d${di}`, name: w.n, trade: w.d || w.cat,
      types: [{ t: w.cat, rate: w.rate, cells: w.cells }],
      onContract: false, direct: w, stages: [], projectId: site.site,
    });
  });
  return out;
}

const countOf = (w: MWorker, di: number) => w.types.reduce((s, t) => s + val(t.cells[di]), 0);
const costOf = (w: MWorker, di: number) => w.types.reduce((s, t) => s + val(t.cells[di]) * t.rate, 0);
const waAt = (w: MWorker, di: number): string | null => {
  for (const t of w.types) { const c = t.cells[di]; if (c && c !== 'off' && c.src === 'wa') return c.at || ''; }
  return null;
};
/** A day off on the sheet is not a gap — nobody was expected. */
const isOff = (w: MWorker, di: number) => w.types.length > 0 && w.types.every(t => t.cells[di] === 'off');

// Contract progress — the same arithmetic the desktop sheet uses, so both surfaces agree.
const latestPct = (st: StageRow) => st.cells.reduce((p: number, c: Cell) => (c && c !== 'off') ? c.v : p, st.before);
function stageMath(st: StageRow) {
  if (st.type === 'lump') {
    const pct = latestPct(st), earned = (st.amount || 0) * pct / 100;
    return { earned, pct, label: `${pct}% of ${inr(st.amount || 0)} · ${inr(earned)}` };
  }
  const done = st.before + st.cells.reduce((s, c) => s + val(c), 0);
  const earned = done * (st.rate || 0);
  return { earned, pct: st.total ? Math.round(done / st.total * 100) : 0,
           label: `${done.toLocaleString('en-IN')} / ${(st.total || 0).toLocaleString('en-IN')} ${st.unit || ''} · ${inr(earned)}` };
}
function contractPct(w: MWorker) {
  const value = w.stages.reduce((s, st) => s + (st.type === 'lump' ? (st.amount || 0) : (st.total || 0) * (st.rate || 0)), 0);
  const earned = w.stages.reduce((s, st) => s + stageMath(st).earned, 0);
  return { pct: value ? Math.round(earned / value * 100) : 0, earned };
}

const CONTRACT_IC = '<svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10.5 13h6M10.5 16.5h4"/></svg>';

export default function AttendanceMobile({ session }: { session: Session }) {
  const orgId = useOrgId();
  const navigate = useNavigate();
  const { show: showSnackbar } = useSnackbar();
  const byName = (session.user?.user_metadata?.name as string) || (session.user?.user_metadata?.full_name as string) || session.user?.email || 'Office';

  const rootRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const DATA = useRef<SiteRow[]>([]);
  const CARD = useRef<RateCard | null>(null);
  const PARTIES = useRef<{ stakeholder_id: string; name: string; category: string | null }[]>([]);
  const selRef = useRef(0);
  const seededRef = useRef(false);
  const pending = useRef<{ sel: number; dir: number } | null>(null);   // a week change mid-swipe

  const [monday, setMonday] = useState<Date>(() => mondayOf(new Date()));
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [certCtx, setCertCtx] = useState<CertifyContext | null>(null);

  const dates = weekDates(monday);
  const todayISO = new Date().toISOString().slice(0, 10);
  const TODAY = todayISO > dates[6] ? 6 : todayISO < dates[0] ? -1 : dates.indexOf(todayISO);

  // ── rate helpers — the wage-type prefills come from the org's own card ───────
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
    return [trade, 'Helper · male', ...(!t || t.hf != null ? ['Helper · female'] : [])];
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

  const q = <T extends HTMLElement>(sel: string) => rootRef.current?.querySelector(sel) as T | null;
  const sheetEl = () => portalRef.current?.querySelector('#sheet') as HTMLElement;
  const shadeEl = () => portalRef.current?.querySelector('#shade') as HTMLElement;
  const fail = (e: unknown) => { showSnackbar((e as Error)?.message || 'Could not save', { type: 'error' }); void load(); };

  const toastTimer = useRef<number | null>(null);
  const toast = (t: string) => {
    const el = portalRef.current?.querySelector('#toast') as HTMLElement | null; if (!el) return;
    el.textContent = t; el.classList.add('show');
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => el.classList.remove('show'), 2400);
  };

  // ── load a week, then paint ──────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [week, parties] = await Promise.all([loadWeek(monday), loadParties()]);
      let { sites, card } = week;
      if (cardIsEmpty(card) && !seededRef.current) {
        seededRef.current = true;
        try { await seedRateCard(orgId); const r2 = await loadWeek(monday); sites = r2.sites; card = r2.card; } catch { /* best effort */ }
      }
      DATA.current = sites; CARD.current = card; PARTIES.current = parties;
      setLoading(false);
      requestAnimationFrame(() => {
        const p = pending.current; pending.current = null;
        selRef.current = p ? p.sel : (TODAY >= 0 ? TODAY : 0);
        renderStrip(); renderList();
        if (p) slideIn(p.dir); else resetSlide();
      });
    } catch (e) {
      setErr((e as Error)?.message || 'Could not load attendance'); setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monday]);

  useEffect(() => { void load(); }, [load]);

  /* ---------- date strip ---------- */
  function renderStrip() {
    const ds = q('#datestrip'); if (!ds) return;
    const sel = selRef.current;
    ds.innerHTML = dates.map((iso, i) => {
      const dt = new Date(iso);
      return `<div class="day ${i === sel ? 'sel' : ''} ${i === TODAY ? 'today' : ''} ${i > TODAY ? 'future' : ''}" data-i="${i}">
      <small>${dt.toLocaleString('en-US', { weekday: 'short' })}</small><b>${dt.getDate()}</b><span class="u"></span></div>`;
    }).join('');
    ds.querySelectorAll('.day').forEach(el => el.addEventListener('click', () => go(+(el as HTMLElement).dataset.i!)));
  }
  function go(i: number) { if (i === selRef.current) return; slideTo(i, i > selRef.current ? 1 : -1); }

  /* the list follows the finger; release commits or springs back */
  function resetSlide() {
    const el = q('#list'); if (!el) return;
    el.style.transition = 'none'; el.style.transform = 'translateX(0)';
  }
  function slideIn(dir: number) {
    const el = q('#list'); if (!el) return;
    const w = el.offsetWidth;
    el.style.transition = 'none';
    el.style.transform = `translateX(${dir * w}px)`;              /* the new day waits offstage */
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = 'transform .32s cubic-bezier(.2,.85,.25,1)';
      el.style.transform = 'translateX(0)';                       /* and slides in */
    }));
  }
  function slideTo(target: number, dir: number) {
    const el = q('#list'); if (!el) return;
    const w = el.offsetWidth;
    hapt(6);
    el.style.transition = 'transform .18s cubic-bezier(.4,0,.8,.5)';
    el.style.transform = `translateX(${-dir * w}px)`;             /* the current day exits */
    window.setTimeout(() => {
      // Past either end of the week there is always another week — carry into it rather than
      // leaving the phone stuck on the week it opened with.
      if (target < 0 || target > 6) {
        pending.current = { sel: target < 0 ? 6 : 0, dir };
        setMonday(m => { const d = new Date(m); d.setDate(d.getDate() + (target < 0 ? -7 : 7)); return d; });
        return;                                                   /* the reload finishes the move */
      }
      selRef.current = target; renderStrip(); renderList();
      slideIn(dir);
    }, 180);
  }

  useEffect(() => {
    const listEl = q('#list'); if (!listEl) return;
    let sX: number | null = null, sYv = 0, axis: 'h' | 'v' | null = null, curX = 0, t0 = 0;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length > 1) return;
      sX = e.touches[0].clientX; sYv = e.touches[0].clientY; axis = null; curX = 0;
      t0 = performance.now();
      listEl.style.transition = 'none';
    };
    const onMove = (e: TouchEvent) => {
      if (sX === null) return;
      const dx = e.touches[0].clientX - sX, dy = e.touches[0].clientY - sYv;
      if (!axis) {
        if (Math.abs(dx) > Math.abs(dy) + 6) axis = 'h';
        else if (Math.abs(dy) > Math.abs(dx) + 6) axis = 'v';
      }
      if (axis !== 'h') return;
      e.preventDefault();                                   /* horizontal owns this gesture */
      curX = dx;
      listEl.style.transform = `translateX(${curX}px)`;
    };
    const onEnd = () => {
      if (sX === null) return;
      const v = curX / Math.max(performance.now() - t0, 1);  /* px/ms — flick detection */
      const dir = curX < 0 ? 1 : -1;
      const target = selRef.current + dir;
      sX = null; axis = null;
      if (Math.abs(curX) > 70 || Math.abs(v) > 0.45) slideTo(target, dir);
      else {
        listEl.style.transition = 'transform .28s cubic-bezier(.2,.8,.25,1)';
        listEl.style.transform = 'translateX(0)';
      }
      curX = 0;
    };
    listEl.addEventListener('touchstart', onStart, { passive: true });
    listEl.addEventListener('touchmove', onMove, { passive: false });
    listEl.addEventListener('touchend', onEnd);
    return () => {
      listEl.removeEventListener('touchstart', onStart);
      listEl.removeEventListener('touchmove', onMove);
      listEl.removeEventListener('touchend', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monday]);

  /* ---------- list ---------- */
  function renderList() {
    const list = q('#list'); if (!list) return;
    const sel = selRef.current;
    const future = sel > TODAY;
    list.innerHTML = '';
    DATA.current.forEach((site, si) => {
      const workers = workersOf(site, si);
      const wage = workers.filter(w => !w.onContract);
      const card = document.createElement('div');
      card.className = 'sitecard';
      const onsite = wage.reduce((s, w) => s + countOf(w, sel), 0);
      const amt = wage.reduce((s, w) => s + costOf(w, sel), 0);
      const gaps = wage.filter(w => countOf(w, sel) === 0 && !isOff(w, sel)).length;
      card.innerHTML = `<div class="shead">
        <span class="sdot" style="background:${SITE_DOT[si % SITE_DOT.length]}"></span>
        <b>${esc(site.label)}</b>
        <span class="scount">${onsite ? num(onsite) + ' · ' + inr(amt) : ''}</span>
        ${(!future && gaps > 0 && workers.length) ? '<button class="markall">Mark all</button>' : ''}
        <button class="addbtn" title="Add worker">＋</button>
      </div>` +
      (!workers.length ? `<div class="siteempty">Nothing yet — <b>add a worker</b> or wait for WhatsApp.</div>` : '');
      card.querySelector('.addbtn')!.addEventListener('click', () => openAddSheet(si));
      if (!workers.length) {
        card.querySelector('.siteempty b')!.addEventListener('click', () => openAddSheet(si));
        list.appendChild(card); return;
      }
      workers.forEach(w => {
        const c = countOf(w, sel);
        const cp = w.onContract ? contractPct(w) : null;
        const row = document.createElement('div');
        row.className = 'wrow';
        const face = cp ? `${cp.pct}%` : (c ? (w.types.length > 1 ? w.types.map(t => val(t.cells[sel])).filter(v => v > 0).map(num).join('+') : num(c)) : '＋');
        const filled = cp ? cp.pct > 0 : c > 0;
        row.innerHTML = `
          <div class="wav">${esc((w.name.trim()[0] || '?').toUpperCase())}${waAt(w, sel) !== null && c > 0 ? '<span class="src"></span>' : ''}</div>
          <div class="wmid">
            <b>${esc(w.name)}</b>
            <span class="sub">${esc(w.trade)}</span>
            <div class="weekdots">${dates.map((_d, di) =>
              `<span class="wd ${(w.onContract ? 0 : countOf(w, di)) ? 'on' : ''} ${di === sel ? 'tod' : ''}"></span>`).join('')}</div>
          </div>
          <button class="ctr ${filled ? 'filled' : ''} ${(future && !cp) ? 'ro' : ''}">${face}</button>`;
        const ctr = row.querySelector('.ctr')!;
        ctr.addEventListener('click', e => {
          e.stopPropagation();
          hapt(8);
          if (w.onContract) { openContractSheet(w); return; }
          if (w.types.length > 1) { openWorkerSheet(w); return; }
          const t = w.types[0]; if (!t) return;
          const next = CYCLE[(CYCLE.indexOf(val(t.cells[sel])) + 1) % CYCLE.length] ?? 1;
          t.cells[sel] = { v: next, src: 'office', by: byName, at: 'just now' };
          void persist(w, 0, sel, next);
          renderList(); refreshStats();
        });
        row.addEventListener('click', () => w.onContract ? openContractSheet(w) : openWorkerSheet(w));
        card.appendChild(row);
      });
      const ma = card.querySelector('.markall');
      if (ma) ma.addEventListener('click', () => {
        let n = 0;
        wage.forEach(w => {
          if (countOf(w, sel) !== 0 || isOff(w, sel) || !w.types.length) return;
          w.types[0].cells[sel] = { v: 1, src: 'office', by: byName, at: 'just now' }; n++;
          void persist(w, 0, sel, 1);
        });
        hapt([10, 30, 10]);
        renderList(); refreshStats();
        toast(`${site.label.split(' ')[0]}: marked ${n} present`);
      });
      list.appendChild(card);
    });
    refreshStats();
  }

  /** Write one wage type's day back. */
  async function persist(w: MWorker, ti: number, di: number, value: number) {
    const t = w.types[ti]; if (!t) return;
    const subject = t.catId
      ? { type: 'crew_category' as const, category_id: t.catId }
      : { type: 'direct' as const, direct_worker_id: w.direct!.id };
    try { await saveCell(orgId, w.projectId, dates[di], subject, value, byName); } catch (e) { fail(e); }
  }

  /* ---------- the sheet ---------- */
  function closeSheet() {
    sheetEl()?.classList.remove('show'); shadeEl()?.classList.remove('show');
    renderList();
  }

  useEffect(() => {
    const sheet = sheetEl(), shade = shadeEl();
    if (!sheet || !shade) return;
    const onShade = () => closeSheet();
    shade.addEventListener('click', onShade);

    /* swipe-down to dismiss — the drag starts from the handle / header zone */
    let sY = 0, dY = 0, dragging = false;
    const down = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.grab, .sh-head')) return;   /* the body scrolls; the handle drags */
      sY = e.clientY; dY = 0; dragging = true;
      sheet.style.transition = 'none';
      sheet.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      dY = Math.max(0, e.clientY - sY);
      sheet.style.transform = `translateY(${dY}px)`;
      shade.style.opacity = String(Math.max(0, 1 - dY / 380));
    };
    const end = () => {
      if (!dragging) return;
      dragging = false;
      sheet.style.transition = ''; sheet.style.transform = ''; shade.style.opacity = '';
      if (dY > 110) { hapt(8); closeSheet(); }
      dY = 0;
    };
    sheet.addEventListener('pointerdown', down);
    sheet.addEventListener('pointermove', move);
    sheet.addEventListener('pointerup', end);
    sheet.addEventListener('pointercancel', end);
    return () => {
      shade.removeEventListener('click', onShade);
      sheet.removeEventListener('pointerdown', down);
      sheet.removeEventListener('pointermove', move);
      sheet.removeEventListener('pointerup', end);
      sheet.removeEventListener('pointercancel', end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showSheet = () => { sheetEl()?.classList.add('show'); shadeEl()?.classList.add('show'); };

  /* ---------- add worker: pick from parties ---------- */
  function openAddSheet(si: number) {
    const sheet = sheetEl(); if (!sheet) return;
    const site = DATA.current[si];
    sheet.innerHTML = `<div class="grab"></div>
      <div class="sh-head"><b>Add worker</b><span>${esc(site.label)}</span></div>
      <input class="f-in" id="aw-q" placeholder="Search your workers…" autocomplete="off" style="margin-top:8px">
      <div class="picklist" id="aw-list"></div>`;
    showSheet();
    const qEl = sheet.querySelector('#aw-q') as HTMLInputElement;
    const listEl = sheet.querySelector('#aw-list') as HTMLElement;
    window.setTimeout(() => qEl.focus(), 380);

    const onSite = workersOf(site, si).map(w => w.name.toLowerCase());
    let busy = false;
    function renderPicks() {
      const query = qEl.value.trim();
      const hits = (query ? searchPayees(PARTIES.current, query) : PARTIES.current).slice(0, 30);
      let html = hits.map(p => {
        const on = onSite.includes(p.name.toLowerCase());
        const trade = resolveTrade(p.category);
        const sub = on ? 'already on this site'
          : p.category ? `${p.category} · ${inr(rateFor(trade, p.category))}/day from your rate card`
          : 'no engagements yet';
        return `<div class="pick ${on ? 'onsite' : ''}" data-id="${p.stakeholder_id}">
          <div class="wav">${esc((p.name.trim()[0] || '?').toUpperCase())}</div>
          <div class="pm"><b>${esc(p.name)}</b><span>${esc(sub)}</span></div>
          <span class="prate">›</span></div>`;
      }).join('');
      if (query && !hits.some(p => p.name.toLowerCase() === query.toLowerCase()))
        html += `<div class="pick newrow" id="aw-new"><div class="wav">＋</div>
          <div class="pm"><b>New party “${esc(query)}”</b><span>then set wage types for this site</span></div></div>`;
      listEl.innerHTML = html || `<div class="siteempty">No workers found — type a name to create one.</div>`;

      listEl.querySelectorAll('.pick[data-id]').forEach(el => el.addEventListener('click', () => {
        const p = PARTIES.current.find(x => x.stakeholder_id === (el as HTMLElement).dataset.id);
        if (p) engagementForm(si, p);
      }));
      const nw = listEl.querySelector('#aw-new');
      if (nw) nw.addEventListener('click', async () => {
        if (busy) return; busy = true;
        try {
          const c = await createParty(query, 'Worker', orgId);
          PARTIES.current = [...PARTIES.current, { stakeholder_id: c.id, name: c.name, category: null }];
          busy = false;
          engagementForm(si, { stakeholder_id: c.id, name: c.name, category: null });
        } catch (e) { busy = false; fail(e); }
      });
    }
    qEl.addEventListener('input', renderPicks);
    renderPicks();
  }

  /* step 2 — the engagement: wage types for THIS site. The party's stakeholder category carries
     the shape; the rates come off the org's rate card and are editable before they are saved. */
  type Party = { stakeholder_id: string; name: string; category: string | null };
  function engagementForm(si: number, party: Party) {
    const sheet = sheetEl(); if (!sheet) return;
    const site = DATA.current[si];
    const trade0 = resolveTrade(party.category);
    const seedCat = party.category || 'Helper · male';
    let types: { t: string; rate: number | '' }[] = [{ t: party.category || '', rate: party.category ? rateFor(trade0, seedCat) : '' }];
    let mode: 'solo' | 'team' = 'solo';
    sheet.innerHTML = `<div class="grab"></div>
      <div class="sh-head"><b>${esc(party.name)}</b><span>${esc(site.label.split(' ')[0])}</span></div>
      <div class="f-lab" style="margin-top:10px">How are they working at this site?</div>
      <div class="seg">
        <button id="ng-solo">Works alone</button>
        <button id="ng-team">With a team</button>
      </div>
      ${party.category ? `<div class="wk-week" style="margin:0 0 8px">rates from your rate card — adjust if this site pays differently</div>` : ''}
      <div id="ng-types"></div>
      <button class="addtype" id="ng-addtype">＋ Add wage type</button>
      <button class="sh-done" id="ng-add">Add to ${esc(site.label.split(' ')[0])}</button>`;
    const twrap = sheet.querySelector('#ng-types') as HTMLElement;
    const addTypeBtn = sheet.querySelector('#ng-addtype') as HTMLElement;
    const bSolo = sheet.querySelector('#ng-solo') as HTMLElement, bTeam = sheet.querySelector('#ng-team') as HTMLElement;

    function setMode(m: 'solo' | 'team') {
      mode = m;
      bSolo.classList.toggle('on', m === 'solo');
      bTeam.classList.toggle('on', m === 'team');
      if (m === 'solo' && types.length > 1) types = [types[0]];      /* alone = one wage type */
      if (m === 'team' && types.length === 1) {
        /* the full team laid out immediately: their trade + the helpers the rate card carries */
        const tr = resolveTrade(types[0].t) || trade0;
        const mix = mixFor(tr);
        if (!types[0].t) types[0].t = mix[0];
        if (!types[0].rate) types[0].rate = rateFor(tr, types[0].t);
        mix.slice(1).forEach(c => types.push({ t: c, rate: rateFor(tr, c) }));
      }
      addTypeBtn.style.display = m === 'team' ? 'block' : 'none';
      renderTypes();
    }
    bSolo.addEventListener('click', () => { setMode('solo'); hapt(6); });
    bTeam.addEventListener('click', () => { setMode('team'); hapt(6); });

    function renderTypes() {
      twrap.innerHTML = types.map((t, ti) => `<div class="trow">
        <input class="f-in" data-ti="${ti}" data-f="t" value="${esc(String(t.t))}" placeholder="${mode === 'solo' ? 'Trade — Mason, Plumber…' : (ti === 0 ? 'Skilled — Mason, Tiler…' : 'Type')}">
        <input class="f-in mono" data-ti="${ti}" data-f="rate" value="${t.rate}" placeholder="₹/day" inputmode="numeric" style="max-width:110px">
        ${mode === 'team' ? `<button class="tdel" data-ti="${ti}" ${types.length < 2 ? 'disabled' : ''}>✕</button>` : ''}
      </div>`).join('');
      twrap.querySelectorAll('.f-in').forEach(inp => inp.addEventListener('input', () => {
        const el = inp as HTMLInputElement, t = types[+el.dataset.ti!];
        if (el.dataset.f === 'rate') { el.value = el.value.replace(/[^\d]/g, ''); t.rate = +el.value || ''; }
        else t.t = el.value;
      }));
      twrap.querySelectorAll('.tdel').forEach(b => b.addEventListener('click', () => {
        types.splice(+(b as HTMLElement).dataset.ti!, 1); renderTypes();
      }));
    }

    setMode(mode);
    if (!party.category) window.setTimeout(() => (twrap.querySelector('.f-in') as HTMLInputElement | null)?.focus(), 380);
    addTypeBtn.addEventListener('click', () => { types.push({ t: '', rate: '' }); renderTypes(); });
    (sheet.querySelector('#ng-add') as HTMLButtonElement).addEventListener('click', async () => {
      let clean = types.filter(t => String(t.t).trim() && +t.rate > 0).map(t => ({ t: String(t.t).trim(), rate: +t.rate }));
      if (mode === 'solo') clean = clean.slice(0, 1);
      if (!clean.length) { toast('Set the trade and rate'); return; }
      const btn = sheet.querySelector('#ng-add') as HTMLButtonElement;
      btn.disabled = true; btn.textContent = 'Adding…';
      try {
        if (mode === 'solo') {
          await addDirectWorker(orgId, site.site, party.name, clean[0].t, clean[0].rate, party.stakeholder_id || undefined);
        } else {
          await addCrew(orgId, site.site, party.name, resolveTrade(clean[0].t),
            clean.map(c => ({ category: c.t, rate: c.rate })), party.stakeholder_id || undefined);
        }
        hapt([10, 30, 10]);
        closeSheet();
        toast(party.name + ' added — tap the row to mark today');
        await load();
      } catch (e) { btn.disabled = false; btn.textContent = `Add to ${site.label.split(' ')[0]}`; fail(e); }
    });
  }

  /* ---------- worker action sheet ---------- */
  function openWorkerSheet(w: MWorker) {
    const sheet = sheetEl(); if (!sheet) return;
    const sel = selRef.current;
    const dt = new Date(dates[sel]);
    const dayLbl = `${dt.toLocaleString('en-US', { weekday: 'short' })} ${dt.getDate()}`;
    const waT = waAt(w, sel);
    sheet.innerHTML = `<div class="grab"></div>
      <div class="sh-head"><b>${esc(w.name)}</b><span>${dayLbl}</span></div>
      ${waT !== null && countOf(w, sel) ? `<div class="sh-src">● filed from WhatsApp${waT ? ` at ${esc(waT)}` : ''}</div>` : ''}
      ${w.types.map((t, ti) => `<div class="srow">
        <div class="t">${esc(t.t)}<small>${inr(t.rate)}/day</small></div>
        <div class="step"><button data-ti="${ti}" data-d="-1">−</button><b id="s-${ti}">${num(val(t.cells[sel]))}</b><button data-ti="${ti}" data-d="1">＋</button></div>
      </div>`).join('')}
      <div class="sh-foot"><span id="s-c"></span><span id="s-amt"></span></div>
      <div id="s-musterwrap"></div>
      <div class="weekline">
        <div class="weekdots">${dates.map((_d, di) => `<span class="wd ${countOf(w, di) ? 'on' : ''} ${di === sel ? 'tod' : ''}"></span>`).join('')}</div>
        <span id="s-week"></span>
      </div>
      <div class="divider"></div>
      <div class="quietacts">
        <button class="qa" id="a-edit">Edit rates</button>
        ${w.onContract ? '' : '<button class="qa" id="a-con">Put on contract</button>'}
        <button class="qa danger" id="a-del">Remove</button>
      </div>
      <div style="height:8px"></div>
      <button class="sh-done">Done</button>`;
    showSheet();

    const foot = () => {
      (sheet.querySelector('#s-c') as HTMLElement).textContent = num(countOf(w, sel)) + ' on site';
      (sheet.querySelector('#s-amt') as HTMLElement).textContent = inr(costOf(w, sel));
      const wd2 = dates.reduce((s, _d, di) => s + countOf(w, di), 0);
      const amt2 = dates.reduce((s, _d, di) => s + costOf(w, di), 0);
      (sheet.querySelector('#s-week') as HTMLElement).textContent = `${num(wd2)} days this week · ${inr(amt2)}`;
      sheet.querySelectorAll('.weekline .wd').forEach((el, di) => el.classList.toggle('on', countOf(w, di) > 0));

      /* week muster: per-type worker-days × rate — the Saturday settlement */
      const mw = sheet.querySelector('#s-musterwrap') as HTMLElement;
      if (w.types.length > 1) {
        const lines = w.types.map(t => {
          const days = t.cells.reduce((s, c) => s + val(c), 0);
          return { t: t.t, days, amt: days * t.rate };
        }).filter(l => l.days > 0);
        mw.innerHTML = lines.length ? `<div class="muster">
          <div class="m-lab">Week muster · settle with ${esc(w.name.split(' ')[0])}</div>
          ${lines.map(l => `<div class="m-row"><span>${esc(l.t)} · ${num(l.days)} day${l.days > 1 ? 's' : ''} </span><b>${inr(l.amt)}</b></div>`).join('')}
          <div class="m-tot"><span>To pay</span><b>${inr(lines.reduce((s, l) => s + l.amt, 0))}</b></div>
        </div>` : '';
      } else mw.innerHTML = '';
    };
    sheet.querySelectorAll('.step button').forEach(b => b.addEventListener('click', () => {
      hapt(6);
      const ti = +(b as HTMLElement).dataset.ti!, d = +(b as HTMLElement).dataset.d!;
      const t = w.types[ti];
      const v = Math.max(0, val(t.cells[sel]) + d);
      t.cells[sel] = { v, src: 'office', by: byName, at: 'just now' };
      (sheet.querySelector('#s-' + ti) as HTMLElement).textContent = num(v);
      void persist(w, ti, sel, v);
      foot();
    }));
    (sheet.querySelector('.sh-done') as HTMLElement).addEventListener('click', closeSheet);
    foot();

    (sheet.querySelector('#a-edit') as HTMLElement).addEventListener('click', () => openEditor(w));
    sheet.querySelector('#a-con')?.addEventListener('click', () => openContractPicker(w));
    const del = sheet.querySelector('#a-del') as HTMLElement;
    let armed = false;
    del.addEventListener('click', async () => {
      if (!armed) { armed = true; del.textContent = 'Remove — sure?'; del.style.opacity = '1'; return; }
      try {
        if (w.crew) await removeCrew(w.crew.crewId); else await removeDirectWorker(w.direct!.id);
        hapt(20); closeSheet();
        toast(`${w.name} removed from ${DATA.current[w.si].label.split(' ')[0]}`);
        await load();
      } catch (e) { fail(e); }
    });
  }

  /* editor: the name and the wage types — the only two things about an engagement you change later */
  function openEditor(w: MWorker) {
    const sheet = sheetEl(); if (!sheet) return;
    const isCrew = !!w.crew;
    const types = w.types.map(t => ({ t: t.t, rate: t.rate as number | '', catId: t.catId }));
    sheet.innerHTML = `<div class="grab"></div>
      <div class="sh-head"><b>Edit worker</b><span>${esc(DATA.current[w.si].label.split(' ')[0])}</span></div>
      <div class="f-lab">Name</div>
      <input class="f-in" id="ed-name" value="${esc(w.name)}" autocomplete="off">
      <div class="f-lab">Wage types</div>
      <div id="ed-types"></div>
      ${isCrew ? `<button class="addtype" id="ed-addtype">＋ Add wage type</button>` : ''}
      <button class="sh-done" id="ed-save">Save</button>`;
    const twrap = sheet.querySelector('#ed-types') as HTMLElement;
    function renderTypes() {
      twrap.innerHTML = types.map((t, ti) => `<div class="trow">
        <input class="f-in" data-ti="${ti}" data-f="t" value="${esc(String(t.t))}" placeholder="Type — Mason, Helper…">
        <input class="f-in mono" data-ti="${ti}" data-f="rate" value="${t.rate}" placeholder="₹/day" inputmode="numeric" style="max-width:110px">
        <button class="tdel" data-ti="${ti}" ${(!isCrew || types.length < 2) ? 'disabled' : ''}>✕</button>
      </div>`).join('');
      twrap.querySelectorAll('.f-in').forEach(inp => inp.addEventListener('input', () => {
        const el = inp as HTMLInputElement, t = types[+el.dataset.ti!];
        if (el.dataset.f === 'rate') { el.value = el.value.replace(/[^\d]/g, ''); t.rate = +el.value || ''; }
        else t.t = el.value;
      }));
      twrap.querySelectorAll('.tdel').forEach(b => b.addEventListener('click', () => {
        types.splice(+(b as HTMLElement).dataset.ti!, 1); renderTypes();
      }));
    }
    renderTypes();
    sheet.querySelector('#ed-addtype')?.addEventListener('click', () => { types.push({ t: '', rate: '', catId: undefined }); renderTypes(); });
    (sheet.querySelector('#ed-save') as HTMLButtonElement).addEventListener('click', async () => {
      const clean = types.filter(t => String(t.t).trim() && +t.rate > 0);
      if (!clean.length) { toast('Every wage type needs a name and rate'); return; }
      const name = (sheet.querySelector('#ed-name') as HTMLInputElement).value.trim() || w.name;
      const btn = sheet.querySelector('#ed-save') as HTMLButtonElement;
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        if (isCrew) {
          if (name !== w.name) await renameCrew(w.crew!.crewId, name);
          const kept = new Set(clean.map(t => t.catId).filter(Boolean) as string[]);
          for (const old of w.types) if (old.catId && !kept.has(old.catId)) await removeCategory(old.catId);
          for (const t of clean) {
            if (t.catId) {
              const was = w.types.find(x => x.catId === t.catId)!;
              if (was.t !== t.t || was.rate !== +t.rate) await updateCategory(t.catId, { category: String(t.t).trim(), rate: +t.rate });
            } else await addCategory(orgId, w.crew!.crewId, String(t.t).trim(), +t.rate);
          }
        } else {
          const t = clean[0];
          await updateDirectWorker(w.direct!.id, { name, category: String(t.t).trim(), rate: +t.rate });
        }
        hapt(10); closeSheet(); toast('Saved');
        await load();
      } catch (e) { btn.disabled = false; btn.textContent = 'Save'; fail(e); }
    });
  }

  /* ---------- put on contract: link this party's work order for this project ---------- */
  async function openContractPicker(w: MWorker) {
    const sheet = sheetEl(); if (!sheet) return;
    const site = DATA.current[w.si];
    const stakeholderId = w.crew?.stakeholderId ?? w.direct?.stakeholderId ?? null;
    sheet.innerHTML = `<div class="grab"></div>
      <div class="sh-head"><b>Put on contract</b><span>${esc(w.name)}</span></div>
      <div class="siteempty">Loading contracts…</div>`;
    showSheet();
    let wos;
    try { wos = await loadWorkOrdersForProject(site.site); } catch (e) { fail(e); return; }
    wos = stakeholderId ? wos.filter(x => x.stakeholderId === stakeholderId) : [];
    const startNew = () => { closeSheet(); navigate('/work-orders/new', { state: { projectId: site.site, stakeholderId } }); };
    const newRow = `<div class="pick newrow" id="oc-new"><div class="wav">＋</div>
      <div class="pm"><b>Start a contract</b><span>opens the contract form for this party</span></div></div>`;
    sheet.innerHTML = `<div class="grab"></div>
      <div class="sh-head"><b>Put on contract</b><span>${esc(w.name)}</span></div>
      ${wos.length ? '' : `<div class="siteempty">No contract for this party on ${esc(site.label)} yet.</div>`}
      <div class="picklist">${wos.map(x => `<div class="pick" data-wo="${x.wo_id}">
        <div class="wav">${CONTRACT_IC.replace('<svg', '<svg style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.7"')}</div>
        <div class="pm"><b>${esc(x.label)}</b><span>every phase of this contract</span></div>
        <span class="prate">${x.orderValue ? inr(x.orderValue) : ''}</span></div>`).join('')}${newRow}</div>`;
    sheet.querySelector('#oc-new')!.addEventListener('click', startNew);
    sheet.querySelectorAll('.pick[data-wo]').forEach(el => el.addEventListener('click', async () => {
      const woId = (el as HTMLElement).dataset.wo!;
      try {
        if (w.crew) await linkCrewToWorkOrder(w.crew.crewId, woId, null);
        else await promoteDirectToCrew(orgId, site.site,
          { id: w.direct!.id, name: w.direct!.n, category: w.direct!.cat, rate: w.direct!.rate, stakeholderId: w.direct!.stakeholderId },
          woId, resolveTrade(w.direct!.cat), null);
        hapt(10); closeSheet(); toast(`${w.name} is on that contract`);
        await load();
      } catch (e) { fail(e); }
    }));
  }

  /* ---------- a crew on a contract: its stages, not a headcount ---------- */
  function openContractSheet(w: MWorker) {
    const sheet = sheetEl(); if (!sheet) return;
    const { pct, earned } = contractPct(w);
    const site = DATA.current[w.si];
    sheet.innerHTML = `<div class="grab"></div>
      <div class="sh-head"><b>${esc(w.name)}</b><span>contract</span></div>
      ${w.stages.length ? w.stages.map((st, ki) => {
        const m = stageMath(st);
        return `<div class="srow" data-stage="${ki}">
          <div class="t">${esc(st.n)}<small>${esc(m.label)}</small></div>
          <div class="step"><b>${m.pct}%</b></div><span class="ch">›</span>
        </div>`;
      }).join('') : `<div class="siteempty">No phases on this contract yet — add them on the contract itself.</div>`}
      <div class="sh-foot"><span>overall</span><span>${pct}% · ${inr(earned)}</span></div>
      <div class="divider"></div>
      <div class="quietacts">
        <button class="qa" id="a-open">Open the contract</button>
        <button class="qa danger" id="a-del">Remove</button>
      </div>
      <div style="height:8px"></div>
      <button class="sh-done">Done</button>`;
    showSheet();
    sheet.querySelectorAll('[data-stage]').forEach(el => el.addEventListener('click', () => {
      const st = w.stages[+(el as HTMLElement).dataset.stage!];
      closeSheet();
      setCertCtx({
        orgId, projectId: site.site, projectName: site.label,
        woId: w.crew!.woId ?? null, milestoneId: st.milestoneId, crewId: w.crew!.crewId,
        stakeholderId: w.crew!.stakeholderId ?? null, partyName: w.name, milestoneName: st.n,
        kind: st.type === 'lump' ? 'lump' : 'measured',
        planned: st.amount || 0, rate: st.rate || 0, unit: st.unit,
        priorReading: st.type === 'lump' ? (st.before || 0) : 0,
      });
    }));
    (sheet.querySelector('.sh-done') as HTMLElement).addEventListener('click', closeSheet);
    (sheet.querySelector('#a-open') as HTMLElement).addEventListener('click', () => {
      closeSheet();
      navigate(w.crew!.woId ? `/work-orders/${w.crew!.woId}` : '/work-orders');
    });
    const del = sheet.querySelector('#a-del') as HTMLElement;
    let armed = false;
    del.addEventListener('click', async () => {
      if (!armed) { armed = true; del.textContent = 'Remove — sure?'; del.style.opacity = '1'; return; }
      try { await removeCrew(w.crew!.crewId); hapt(20); closeSheet(); toast(`${w.name} removed`); await load(); }
      catch (e) { fail(e); }
    });
  }

  /* ---------- stats ---------- */
  function refreshStats() {
    const sel = selRef.current;
    let c = 0, amt = 0, gaps = 0;
    DATA.current.forEach((site, si) => workersOf(site, si).forEach(w => {
      if (w.onContract) return;
      c += countOf(w, sel); amt += costOf(w, sel);
      if (sel <= TODAY && countOf(w, sel) === 0 && !isOff(w, sel)) gaps++;
    }));
    const set = (id: string, v: string) => { const el = q('#' + id); if (el) el.textContent = v; };
    set('st-count', num(c)); set('st-amt', inr(amt)); set('st-gaps', String(gaps));
  }

  return (
    <div className="atmx-page">
    <div className="atmx" ref={rootRef}>
      <style>{ATMX_CSS}</style>

      <div className="top">
        <div className="trow"><h1>Attendance</h1><span className="wklink">{weekLabel(monday)}</span></div>
        <div className="stats">
          <div className="stat"><b id="st-count">0</b><span>on site</span></div>
          <div className="stat"><b id="st-amt">₹0</b><span>accrued</span></div>
          <div className="stat gap"><b id="st-gaps">0</b><span>gaps</span></div>
        </div>
      </div>

      <div className="datestrip" id="datestrip" />
      <div id="list" />

      {loading && <div className="siteempty" style={{ padding: '14px 18px' }}>Loading attendance…</div>}
      {err && <div className="siteempty" style={{ padding: '14px 18px', color: 'var(--clay)' }}>
        {err} · <b onClick={() => load()}>retry</b></div>}

      {createPortal(
        <div className="atmx atmx-portal" ref={portalRef}>
          <style>{ATMX_CSS}</style>
          <div id="shade" />
          <div className="sheet" id="sheet" />
          <div id="toast" />
        </div>, document.body)}

      {certCtx && <CertificationWizard ctx={certCtx}
        onClose={() => setCertCtx(null)}
        onDone={() => { setCertCtx(null); void load(); }}
        onReading={(value, date) => {
          if (certCtx.projectId && certCtx.milestoneId)
            void saveCell(orgId, certCtx.projectId, date, { type: 'stage', milestone_id: certCtx.milestoneId }, value, byName).catch(() => {});
        }} />}
    </div>
    </div>
  );
}
