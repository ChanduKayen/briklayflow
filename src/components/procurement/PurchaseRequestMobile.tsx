/**
 * PURCHASE REQUEST — the detail screen, ported from the reference prototype verbatim.
 *
 * The reference answers three questions, in this order, and never mixes them:
 *   1  Did it come through?   the message, who sent it, when, the photo itself, and the count of what was read.
 *   2  What do I still owe?   one short list. Hollow ring = still to add, sage tick = done. The page's one
 *                             button always does the next thing on that list.
 *   3  What was read?         the items, numbered as on the quote.
 *
 * WHY THIS FILE IS IMPERATIVE. The reference paints with innerHTML and drives its own DOM: the item
 * card turns by cloning the next card beside the current one and riding both on the finger, then
 * animating the card's HEIGHT to the new content; the hero counts up on rAF; the panel measures
 * itself mid-gesture. Re-expressing that as React state would be a rewrite, and a rewrite is where
 * an "exact" port stops being exact. So the component owns one root, renders the shell, and runs the
 * reference's own painting functions against it — the same functions, the same names, in the same
 * order — with the prototype's hard-coded S replaced by the request that was loaded, and its two
 * writes (pick a project/supplier, save) handed back out through props.
 *
 * The one deliberate substitution: the reference ships a copy of the app's own nav bar. Here the real
 * MobileNavBar is that bar — the same capsule, the same five tabs, with live counts — and the item
 * toolbar is lent to it through navTakeover, which is exactly the reference's "the tabs step down,
 * the actions step up".
 */
import { useEffect, useMemo, useRef } from 'react';
import { navTakeover } from '../nav/txDraft';
import { PQR_CSS } from './pqrCss';
import { rankPayeeName } from '../../lib/payeeSearch';
import { scoreProjectName } from '../../lib/projectSearch';

/* ---------- what the page is given ---------- */
export interface PqrItem {
  /** the purchase_request_items row this came from; empty for one the user just added */
  rowId: string;
  name: string; qty: string; unit: string;
  w: string; h: string; brand: string; spec: string; note: string;
  /** the quote line verbatim, as the reader saw it */
  raw: string;
  /** which of these the reader supplied rather than a person */
  read: Record<string, number>;
}
export interface PqrRequest {
  from: string; when: string; said: string; pages: number; photo: string;
  project: string; payee: string; items: PqrItem[];
}
export interface PqrOption { name: string; sub: string }
/** A supplier the quote flow can ask. `suggested` floats it to the top (bought-from before). */
export interface PqrSupplier { id?: string; name: string; sub: string; phone: string; suggested?: boolean }
export interface PurchaseRequestMobileProps {
  request: PqrRequest;
  projects: PqrOption[];
  payees: PqrOption[];
  /** the org's suppliers, for the Request-quotes flow */
  suppliers: PqrSupplier[];
  /** true while the reader is still working — the hero scans and the items are skeletons */
  reading?: boolean;
  /** hidden from a supervisor: they raise requests, they do not place orders */
  canOrder?: boolean;
  onBack: () => void;
  /** a name the org does not have yet; the page has already added it to its own list */
  onCreatePayee: (name: string) => void;
  /** project, supplier and the items as they now stand. Resolves when the write lands. Auto-saved. */
  onSave: (out: { project: string; payee: string; items: PqrItem[] }) => Promise<void>;
  /** raise the PO — resolves when it lands (the host navigates to the PO list, highlighted); REJECTS with
   *  a message we surface. */
  onCreatePO: () => void | Promise<void>;
  /** send the quote request to the picked suppliers on WhatsApp; REJECTS with a message we surface. */
  onSendQuotes: (out: { recipients: { id?: string; name: string; phone: string }[]; note: string; replyBy: string }) => Promise<void>;
  /** "Add a page" from the request's own menu — a second sheet of the same quote. Return a sentence
   *  and the page says it, for a host that has nowhere to put one yet. */
  onAddPage: () => string | void;
}

const UNITS = ['Nos', 'Set', 'Sqft', 'Rft', 'Kg', 'Bag'];

export default function PurchaseRequestMobile(p: PurchaseRequestMobileProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const actsRef = useRef<HTMLDivElement | null>(null);
  // The toolbar the bar borrows. One node for the life of the page, painted into imperatively by
  // paintActs, so the reference's markup for it is the reference's markup.
  const actsNode = useMemo(() => (
    <div className="pqr-acts" ref={actsRef} role="toolbar" aria-label="This item" />
  ), []);
  // Props the running page reads. Kept on a ref so the effect below mounts once — the reference is
  // one long-lived screen, and re-running it would restart the reading beat.
  const pRef = useRef(p); pRef.current = p;

  useEffect(() => {
    const root = rootRef.current; if (!root) return;
    const P0 = pRef.current;

    /* ---------- the reference's own helpers ---------- */
    const $ = (s: string) => (s === '#acts' ? actsRef.current : root.querySelector(s)) as HTMLElement | null;
    const buzz = (v: number | number[]) => { try { navigator.vibrate && navigator.vibrate(v as number); } catch (e) { /* no haptics */ } };
    const esc = (t: unknown) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
    const initials = (n: string) => n.replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    const num = (v: unknown) => +String(v == null ? '' : v).replace(/[^\d.]/g, '') || 0;
    const sqft = (w: number, h: number) => (w && h ? +((w / 1000) * (h / 1000) * 10.7639).toFixed(2) : 0);
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const CHEV = '<svg class="c" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
    const TICK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
    const X = '<button type="button" class="x" data-close aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';
    const WA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.6-1.2A9 9 0 1 0 12 3Z"/></svg>';

    /* ---------- what came in from WhatsApp ---------- */
    const PHOTO = P0.request.photo;
    // The org's projects/suppliers arrive from their OWN queries, often AFTER this (imperative) component
    // has mounted. This effect runs once, so we must NOT capture them here — read the LATEST props at use
    // time via pRef, or the picker shows an empty list. `addedPayees` holds a just-created party until the
    // parent's state round-trips it back through props.
    const addedPayees: [string, string][] = [];
    const currentProjects = (): [string, string][] => pRef.current.projects.map((x) => [x.name, x.sub]);
    const currentPayees = (): [string, string][] => [...addedPayees, ...pRef.current.payees.map((x) => [x.name, x.sub] as [string, string])];
    let uid = 0;
    const IT = (name: string, qty: number, o?: Partial<PqrItem>): PqrItem & { id: number } =>
      Object.assign({ id: ++uid, rowId: '', name, qty: String(qty), unit: 'Nos', w: '', h: '', brand: '', spec: '', note: '', raw: '', read: {} as Record<string, number> }, o || {});
    type Row = PqrItem & { id: number };
    const S = {
      from: P0.request.from, when: P0.request.when, said: P0.request.said, pages: P0.request.pages,
      reading: !!P0.reading, project: P0.request.project, payee: P0.request.payee, saved: '',
      quoted: null as string[] | null,   // suppliers a quote request went to (after the quote flow)
      items: P0.request.items.map((it) => Object.assign({ id: ++uid }, it)) as Row[],
    };
    const specOf = (it: Row) => [it.w && it.h ? it.w + ' × ' + it.h + ' mm' : '', it.brand, it.spec].filter(Boolean).join(' · ');
    const hasSpec = (it: Row) => !!(it.w && it.h) || !!it.spec || !!it.brand;
    const areaOf = (it: Row) => sqft(num(it.w), num(it.h)) * (num(it.qty) || 0);
    const totalArea = () => +S.items.reduce((a, i) => a + areaOf(i), 0).toFixed(2);
    const gaps = () => S.items.filter((i) => !hasSpec(i));
    const todo = () => (S.project ? 0 : 1) + (S.payee ? 0 : 1);
    // "Resolved" = the name is a REAL record on file (picked from the list, or just added as a party) —
    // NOT a raw name the reader guessed off the quote. Only a resolved one earns the green tick; an
    // unresolved one must be saved or picked before we proceed.
    const norm = (s: string) => (s || '').trim().toLowerCase();
    const payeeOk = () => !!S.payee.trim() && currentPayees().some((x) => norm(x[0]) === norm(S.payee));
    const projOk = () => !!S.project.trim() && currentProjects().some((x) => norm(x[0]) === norm(S.project));
    let shown = 0, lit = 0, flashKey = '', settling = false;

    /* Kept as you go — no Save button. Every change schedules a debounced write; a burst is one save. */
    let saveT = 0, saving = false, pendingSave = false;
    async function doSave() {
      if (saving) { pendingSave = true; return; }
      saving = true; pendingSave = false;
      try { await pRef.current.onSave({ project: S.project, payee: S.payee, items: S.items.map((it) => ({ ...it })) }); }
      catch (e) { /* keep the local edit on screen; the next change retries the write */ }
      finally { saving = false; if (pendingSave) void doSave(); }
    }
    function scheduleSave() { clearTimeout(saveT); saveT = window.setTimeout(() => { void doSave(); }, 800); }

    /* ---------- 1. did it come through? ---------- */
    function paintHero() {
      const n = S.items.length;
      ($('#hero') as HTMLElement).innerHTML = '<div class="hbar"><button type="button" data-back><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>Requests</button><button type="button" class="dots" data-menu aria-label="More"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button></div>' +
        '<h1>Purchase request</h1>' +
        '<div class="origin">' + WA + '<span>' + (S.saved ? 'Saved ' + esc(S.saved) + ' · ' : '') + 'From <b>' + esc(S.from) + '</b> · ' + esc(S.when) + '</span></div>' +
        '<div class="came"><button type="button" class="paper' + (S.reading ? '' : ' done') + '" data-photo aria-label="See the quote"><img src="' + PHOTO + '" alt=""><span class="scan"></span><span class="pg">' + S.pages + (S.pages > 1 ? ' pages' : ' page') + '</span></button>' +
        '<div class="readout">' + (S.reading ? '<div class="n" style="font-family:var(--sans);font-size:17px;font-weight:600"><span class="livedot"></span>Reading the quote</div>'
          : '<div class="n"><span id="heroN">' + shown + '</span><small>items read from the quote</small></div><p>' + (S.quoted && S.quoted.length ? 'Quotes requested. Kept as you go.' : !S.project ? 'Pick the project, then quote or order.' : 'Kept as you go. Ask for quotes, or make the order.') + '</p>') + '</div></div>';
      if (!S.reading && shown < n && !calm) { const t0 = performance.now(), from = shown; const step = (t: number) => { const k = Math.min(1, (t - t0) / 600); shown = Math.round(from + (n - from) * (1 - Math.pow(1 - k, 3))); const el = $('#heroN'); if (el) el.textContent = String(shown); if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); } else shown = n;
      ($('#cSum') as HTMLElement).textContent = S.reading ? 'reading' : n + ' items' + (todo() ? ' · ' + todo() + ' to add' : '');
    }

    /* ---------- 2. what do I still owe?  3. what was read? ---------- */
    // `ok` = the value is a real, on-file record (green tick). A value that is set but NOT on file is
    // "unsaved" — shown plainly (no green), with a nudge to save or pick it.
    const todoRow = (key: string, label: string, value: string, ask: string, o?: { soft?: boolean; ok?: boolean }) => {
      const ok = !!(o && o.ok), unsaved = !!value && !ok;
      const cls = value ? (ok ? ' done' : ' unsaved') : '';
      return '<button type="button" class="todo' + cls + ((o || {}).soft ? ' soft' : '') + (flashKey === key ? ' flash' : '') + '" data-todo="' + key + '">'
        + '<span class="mark" aria-hidden="true">' + TICK + '</span>'
        + '<span class="t"><span>' + label + '</span><b class="' + (value ? (unsaved ? 'uns' : '') : 'ask') + '">' + esc(value || ask) + '</b>'
        + (unsaved ? '<small class="uns-note">Not saved — tap to save it or pick from the list</small>' : '')
        + '</span>' + CHEV + '</button>';
    };
    function itemRow(it: Row, i: number) {
      const spec = specOf(it);
      return '<button type="button" class="it' + (lit === it.id ? ' lit' : '') + (P && P.kind === 'item' && P.it === it ? ' editing' : '') + '" data-item="' + it.id + '" style="' + (P && P.kind ? 'animation:none' : 'animation-delay:' + Math.min(i, 9) * 110 + 'ms') + '"><span class="no">' + (i + 1) + '</span><span class="b"><b>' + (esc(it.name) || 'Unnamed item') + '</b><span>' + (spec ? esc(spec) : 'Name and count only') + '</span></span><span class="q">' + esc(it.qty) + '<small>' + esc(it.unit) + '</small></span>' + CHEV + '</button>';
    }
    function paintMain() {
      if (S.reading) { ($('#main') as HTMLElement).innerHTML = '<div class="sec"><h2>Items</h2><span>reading</span></div><div class="card" id="itemsCard">' + [1, 2, 3].map(() => '<div class="sk"><i class="a"></i><span class="t"><i></i><i></i></span><i class="e"></i></div>').join('') + '</div>'; return; }
      const g = gaps(), n = S.items.length;
      ($('#main') as HTMLElement).innerHTML =
        (S.saved ? '' : '<div class="sec' + (settling ? ' late' : '') + '" style="' + (settling ? 'animation-delay:' + (Math.min(n, 9) * 110 + 300) + 'ms' : '') + '"><h2>Still to add</h2><span><b>' + (2 - todo()) + '</b> of 2</span></div>' +
          '<div class="card' + (todo() ? '' : ' ok') + (settling ? ' late' : '') + '" style="' + (settling ? 'animation-delay:' + (Math.min(n, 9) * 110 + 300) + 'ms' : '') + '">' +
          todoRow('project', 'Project', S.project, 'Which site is this for?', { ok: projOk() }) +
          todoRow('payee', 'Supplier', S.payee, 'Needed for a PO · not for quotes', { ok: payeeOk(), soft: true }) +
          (S.project ? '<div class="alldone">' + TICK + 'Kept as you go. Ask for quotes, or make the order.</div>' : '') + '</div>') +
        (S.quoted && S.quoted.length ? '<div class="qstate"><i class="dotq"></i><div><b>Quotes requested from ' + S.quoted.length + (S.quoted.length === 1 ? ' supplier' : ' suppliers') + '</b><span>' + esc(S.quoted.join(', ')) + ' · replies land here</span></div></div>' : '') +
        '<div class="sec"><h2>On the quote</h2><span><b>' + n + '</b> items' + (totalArea() ? ' · <b>' + totalArea() + '</b> sqft' : '') + '</span></div>' +
        (S.said ? '<p class="said2"><i>“' + esc(S.said) + '”</i> <span>· ' + esc(S.from.split(' ')[0]) + ', with the photo</span></p>' : '') +
        '<div class="card" id="itemsCard">' + S.items.map(itemRow).join('') + '</div>' +
        (S.saved ? '' : '<button type="button" class="addit" data-additem><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Add an item the quote missed</button>') +
        '<p class="foot-note">' + (n - g.length) + ' came with size and spec' + (g.length ? ', ' + g.length + ' with name and count only' : '') + '. Numbered as on the quote. Tap an item to check it.</p>';
      lit = 0; flashKey = '';
    }
    function paintDock() {
      const d = $('#dock') as HTMLElement; d.classList.toggle('late', settling); d.style.animationDelay = settling ? (Math.min(S.items.length, 9) * 110 + 500) + 'ms' : '';
      if (S.reading) { d.innerHTML = ''; return; }
      // A supervisor raises requests; placing the order or asking for quotes is not theirs to do.
      if (P0.canOrder === false) { d.innerHTML = ''; return; }
      // No review/save step: edits are kept as you go. Once the project is set, the two real next
      // actions sit here directly — ask for quotes, or make the order. (A supplier is needed for a PO,
      // not for quotes, so it does not gate this.) After quotes go out, the left button becomes "Ask more".
      if (S.quoted && S.quoted.length) { d.innerHTML = '<div class="pair"><button type="button" class="g" data-rfq>Ask more</button><button type="button" class="p" data-po>Create PO</button></div>'; return; }
      d.innerHTML = !S.project ? '<button type="button" class="next" data-todo="project">Choose the project</button>'
        : '<div class="pair"><button type="button" class="g" data-rfq>Request quotes</button><button type="button" class="p" data-po>Create PO</button></div>';
    }
    function paint() { paintHero(); paintMain(); paintDock(); }

    /* ---------- reading: items land one by one, then the page settles ---------- */
    let dead = false;
    async function read() {
      paint(); if (!S.reading) return;
      await sleep(calm ? 200 : 1600); if (dead) return;
      S.reading = false; settling = true; paint(); settling = false;
      if (!calm) { for (let i = 0; i < S.items.length; i++) { setTimeout(() => buzz(3), i * 110); } }
    }

    /* ---------- panels ---------- */
    const panel = $('#panel') as HTMLElement, scrim = $('#scrim') as HTMLElement;
    type Pan = { kind: string; q?: string; it?: Row; edit?: string; brandAll?: boolean } | null;
    let P: Pan = null, nudged = false;
    function openPanel(html: string) { ($('#pBody') as HTMLElement).innerHTML = html; panel.scrollTop = 0; panel.classList.add('on'); scrim.classList.add('on'); ($('#dock') as HTMLElement).classList.add('away'); if (!quiet) buzz(8); }
    function closePanel() { panel.classList.remove('on', 'short', 'full'); const b = $('#pBody') as HTMLElement; b.style.transform = ''; b.style.opacity = ''; root!.classList.remove('card'); document.body.classList.remove('pqr-card'); b.className = ''; scrim.classList.remove('light'); root!.querySelectorAll('.it.editing').forEach((r) => r.classList.remove('editing')); scrim.classList.remove('on'); ($('#dock') as HTMLElement).classList.remove('away'); (document.activeElement as HTMLElement | null)?.blur(); P = null; navTakeover.release(); }
    scrim.addEventListener('click', closePanel);
    let swallowClick = false;
    (() => {                                                                          /* swipe: the next item rides in beside the current one, on the finger; release finishes the same motion */
      let x0 = 0, y0 = 0, dx = 0, on = false, took = false, t0 = 0, nxt: Row | null = null, dir = 0; const body = $('#pBody') as HTMLElement;
      const prep = (d: number) => { const i = S.items.indexOf(P!.it as Row), t = S.items[i + d]; nxt = t || null; dir = d; let inc = $('#pIn') as HTMLElement | null; if (!inc) { inc = document.createElement('div'); inc.id = 'pIn'; panel.appendChild(inc); } inc.innerHTML = t ? itemHTML(t, '') : ''; inc.style.transition = 'none'; };
      panel.addEventListener('pointerdown', (e) => {
        if (turning || !P || P.kind !== 'item' || P.edit || (e.target as HTMLElement).closest('.grab, input, textarea, select')) return;
        on = true; took = false; x0 = e.clientX; y0 = e.clientY; dx = 0; dir = 0; t0 = performance.now(); body.classList.remove('nudge');
      });
      panel.addEventListener('pointermove', (e) => {
        if (!on) return; const mx = e.clientX - x0, my = e.clientY - y0;
        if (!took) { if (Math.abs(mx) < 6 || Math.abs(mx) < Math.abs(my)) return; took = true; try { panel.setPointerCapture(e.pointerId); } catch (x) { /* not capturable */ } panel.style.height = panel.offsetHeight + 'px'; panel.style.overflow = 'hidden'; }
        const d = mx < 0 ? 1 : -1; if (d !== dir) prep(d);
        const w = panel.clientWidth; dx = nxt ? mx : mx * .2;
        body.style.transition = 'none'; body.style.transform = 'translateX(' + dx + 'px)';
        const inc = $('#pIn'); if (inc && nxt) inc.style.transform = 'translateX(' + (dir * w + dx) + 'px)';
        e.preventDefault();
      });
      const end = () => {
        if (!on) return; on = false; if (!took) return; took = false;
        const v = dx / Math.max(1, performance.now() - t0), go = nxt && (Math.abs(dx) > 56 || (Math.abs(dx) > 24 && Math.abs(v) > .3));
        swallowClick = true; setTimeout(() => { swallowClick = false; }, 300);
        if (go) { turnTo(nxt as Row, dir, dx); return; }
        const w = panel.clientWidth, inc = $('#pIn'), ease = 'transform .32s cubic-bezier(.22,.8,.24,1)';
        body.style.transition = ease; body.style.transform = ''; if (inc) { inc.style.transition = ease; inc.style.transform = 'translateX(' + dir * w + 'px)'; }
        setTimeout(() => { body.style.transition = ''; if (inc) inc.remove(); panel.style.height = ''; panel.style.overflow = ''; }, 340);
      };
      panel.addEventListener('pointerup', end); panel.addEventListener('pointercancel', end);
      panel.addEventListener('click', (e) => { if (swallowClick) { e.stopPropagation(); e.preventDefault(); } }, true);
    })();
    (() => {                                                                          /* pull it down to put it away. A tap on the handle closes too. */
      let y0 = 0, dy = 0, on = false; const grab = panel.querySelector('.grab') as HTMLElement;
      grab.addEventListener('pointerdown', (e) => { on = true; y0 = e.clientY; dy = 0; panel.style.transition = 'none'; try { grab.setPointerCapture(e.pointerId); } catch (x) { /* not capturable */ } });
      grab.addEventListener('pointermove', (e) => { if (!on) return; dy = Math.max(0, e.clientY - y0); panel.style.transform = 'translateY(' + dy * .85 + 'px)'; });
      const end = () => { if (!on) return; on = false; panel.style.transition = ''; panel.style.transform = ''; if (dy > 60) { if (P && P.kind === 'item') { commitItem(); syncAll(); paintMain(); paintDock(); } closePanel(); } else if (dy < 6) { if (P && P.kind === 'item') { commitItem(); syncAll(); paintMain(); paintDock(); } closePanel(); } };
      grab.addEventListener('pointerup', end); grab.addEventListener('pointercancel', end);
    })();
    /* the keyboard: a browser may shrink the page (Android) or slide over it (iOS). Either way, typing in the card is the whole screen. */
    let typing = false;
    const setKb = () => { const vv = window.visualViewport, gap = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0; const up = typing || gap > 80; root!.classList.toggle('kb', up); document.body.classList.toggle('pqr-kb', up); root!.style.setProperty('--kb', (gap > 80 ? gap - 12 : 0) + 'px'); };
    const onFocusIn = (e: Event) => { const t = e.target as HTMLElement; if (t.matches && t.matches('input:not([type=search]), textarea') && panel.contains(t)) { typing = true; setKb(); } };
    const onFocusOut = () => { setTimeout(() => { const f = document.activeElement as HTMLElement | null; typing = !!(f && f.matches('input, textarea') && panel.contains(f)); setKb(); }, 80); };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    const vv = window.visualViewport;
    const onVv = () => { setKb(); const ed = panel.querySelector('#pBody .ed, #pBody .edwrap, #pBody .name.editing'); if (ed) setTimeout(() => ed.scrollIntoView({ block: 'nearest' }), 60); };
    if (vv) { vv.addEventListener('resize', onVv); vv.addEventListener('scroll', setKb); }

    /* project / payee: one list, the current one marked, a new party if the name is not there */
    function openPick(kind: string, prefill?: string) {
      // prefill (the raw name off the quote) seeds the search so "Add '<name>' as a new party" is offered
      // straight away — the nudge's "save it" path.
      P = { kind, q: prefill ? prefill.trim() : '' }; openPanel(''); paintPick();
      setTimeout(() => { const f = $('#pq') as HTMLInputElement | null; if (f && kind === 'payee') f.focus({ preventScroll: true }); }, 320);
    }
    function paintPick() {
      const isP = P!.kind === 'project';
      const q = ((P!.q as string) || '').trim();
      const base = isP ? currentProjects() : currentPayees();
      // Rank by best match (the shared matchers), so the most-matched supplier/project is at the top —
      // and a fuzzy hit ("sreenu" → "Srinu") surfaces, which a raw substring filter would hide.
      let list = base;
      if (q) {
        const ql = q.toLowerCase();
        const rank = (n: string) => (isP ? scoreProjectName(ql, n) : rankPayeeName(ql, n));
        list = base
          .map((x) => ({ x, r: rank(x[0]), inc: x[0].toLowerCase().includes(ql) }))
          .filter((o) => o.inc || o.r >= 0.3)
          .sort((a, b) => (b.r - a.r) || (a.x[0].length - b.x[0].length))
          .map((o) => o.x);
      }
      const cur = isP ? S.project : S.payee;
      ($('#pBody') as HTMLElement).innerHTML = '<div class="p-head"><div class="t"><h2>' + (isP ? 'Which project?' : 'Which supplier?') + '</h2><span>' + (isP ? 'The site this material is for' : 'The one who sent this quote') + '</span></div>' + X + '</div>' +
        (isP ? '' : '<label class="find"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg><input id="pq" type="text" autocomplete="off" autocapitalize="words" enterkeyhint="search" placeholder="Search or add a supplier" value="' + esc(P!.q) + '"></label>') +
        list.map((x) => '<button type="button" class="opt" data-pick="' + esc(x[0]) + '" aria-pressed="' + (x[0] === cur) + '"><span class="av">' + esc(initials(x[0])) + '</span><span class="m"><b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span></span><span class="r"></span></button>').join('') +
        (!isP && (P!.q as string).trim() && !list.some((x) => x[0].toLowerCase() === (P!.q as string).trim().toLowerCase()) ? '<button type="button" class="opt add" data-create="' + esc((P!.q as string).trim()) + '"><span class="av">+</span><span class="m"><b>Add “' + esc((P!.q as string).trim()) + '”</b><span>as a new party</span></span></button>' : '') +
        (!list.length && !(P!.q as string).trim() ? '<p class="slipnote">Nothing here yet.</p>' : '');
    }
    function setPick(kind: string, name: string) {
      if (kind === 'project') S.project = name; else S.payee = name;
      flashKey = kind; buzz(8); closePanel(); paint(); scheduleSave();
      const r = root!.querySelector('.todo[data-todo="' + kind + '"]'); if (r) r.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
    }

    /* an item: read first, edit on a tap */
    const PEN = '<svg class="pen" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4Z"/><path d="m13 7 4 4"/></svg>';
    const OK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
    let quiet = false;                                                                /* openPanel buzzes on open; not when we are only turning the page */
    function openItem(id: number) {
      const it = S.items.find((x) => x.id === id); if (!it) return;
      const fresh = !(P && P.kind === 'item');
      P = { kind: 'item', it, edit: '', brandAll: false }; openPanel(''); panel.classList.add('short'); scrim.classList.add('light'); root!.classList.add('card'); document.body.classList.add('pqr-card'); paintItem();
      // The toolbar is React's to mount, and it is not in the DOM on the tick the card opens — so the
      // first paintActs writes into nothing. Paint it again once the bar has it.
      navTakeover.offer(actsNode);
      requestAnimationFrame(() => { if (P && P.kind === 'item') paintActs(); });
      if (fresh && !nudged && S.items.length > 1 && !calm) { nudged = true; const b0 = $('#pBody') as HTMLElement; b0.classList.add('nudge'); b0.addEventListener('animationend', () => b0.classList.remove('nudge'), { once: true }); }
    }
    /* turn to another item: the current content and the next one slide as one sheet, then the card takes the new height */
    let turning = false;
    function turnTo(nxt: Row, dir: number, fromDx?: number) {
      if (turning || !nxt) return; turning = true;
      const body = $('#pBody') as HTMLElement, w = panel.clientWidth, h0 = panel.offsetHeight;
      commitItem(); syncAll();
      let inc = $('#pIn') as HTMLElement | null; if (!inc) { inc = document.createElement('div'); inc.id = 'pIn'; panel.appendChild(inc); }
      if (!inc.innerHTML) { inc.innerHTML = itemHTML(nxt, ''); inc.style.transform = 'translateX(' + (dir * w + (fromDx || 0)) + 'px)'; }
      panel.style.height = h0 + 'px'; panel.style.overflow = 'hidden';
      buzz(6);
      const ease = 'transform .34s cubic-bezier(.22,.8,.24,1)';
      requestAnimationFrame(() => {
        body.style.transition = ease; inc!.style.transition = ease;
        body.style.transform = 'translateX(' + (-dir * w) + 'px)'; inc!.style.transform = 'translateX(0)';
        setTimeout(() => {
          quiet = true; P = { kind: 'item', it: nxt, edit: '', brandAll: false }; body.style.transition = ''; body.style.transform = ''; body.style.opacity = '';
          body.innerHTML = inc!.innerHTML; inc!.remove(); paintActs(); quiet = false; turning = false;
          const here = root!.querySelector('.it[data-item="' + nxt.id + '"]') as HTMLElement | null; root!.querySelectorAll('.it.editing').forEach((r) => r.classList.remove('editing')); if (here) { here.classList.add('editing'); ($('#view') as HTMLElement).scrollTo({ top: here.offsetTop - 70, behavior: calm ? 'auto' : 'smooth' }); }
          panel.style.transition = 'height .28s cubic-bezier(.22,.8,.24,1)'; panel.style.height = 'auto'; const h1 = panel.offsetHeight; panel.style.height = h0 + 'px'; void panel.offsetHeight; panel.style.height = h1 + 'px';
          setTimeout(() => { panel.style.transition = ''; panel.style.height = ''; panel.style.overflow = ''; }, 300);
        }, 350);
      });
    }
    function itemHTML(it: Row, e: string) {
      const i = S.items.indexOf(it), n = S.items.length, a = sqft(num(it.w), num(it.h));
      const line = (k: string, label: string, v: string, ph: string) => e === k ? '' : '<button type="button" class="ln" data-edit="' + k + '"><span class="l">' + label + (v && it.read[k === 'size' ? 'w' : k] ? '<em>from the quote</em>' : '') + '</span><span class="v' + (v ? '' : ' none') + '">' + (v || ph) + '</span>' + PEN + '</button>';
      const field = (k: string, label: string, inner: string) => e === k ? '<div class="ed"><span class="l">' + label + '</span>' + inner + '<button type="button" class="ok" data-commit aria-label="Done">' + OK + '</button></div>' : '';
      const inp = (k: string, ph: string, mode?: string) => '<input class="inp" data-f="' + k + '" type="text"' + (mode ? ' inputmode="' + mode + '"' : '') + ' autocomplete="off" autocapitalize="sentences" enterkeyhint="done" placeholder="' + ph + '" value="' + esc((it as unknown as Record<string, string>)[k]) + '">';
      const sizeV = it.w && it.h ? esc(it.w + ' × ' + it.h + ' mm') + (a ? '<small>' + a + ' sqft each · ' + (a * (num(it.qty) || 0)).toFixed(2) + ' total</small>' : '') : '';
      const missing = ['brand', 'note'].filter((k) => !(it as unknown as Record<string, string>)[k] && e !== k);
      return '<div class="ihead"><span class="no">' + (i + 1) + '</span><div class="t">' +
          (e === 'name' ? '<div class="name editing"><textarea data-f="name" rows="2" placeholder="Item name" aria-label="Item name">' + esc(it.name) + '</textarea></div>'
            : '<button type="button" class="name" data-edit="name"><b class="' + (!it.name ? 'empty' : it.name.length > 22 ? 'long' : '') + '">' + (esc(it.name) || 'Tap to name this item') + '</b>' + PEN + '</button>') +
          '<span class="sub">Item ' + (i + 1) + ' of ' + n + (it.raw ? ' · read from the quote' : '') + '</span></div>' +
          '<div class="inav"><button type="button" data-step="-1"' + (i ? '' : ' disabled') + ' aria-label="Previous item"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><button type="button" data-step="1"' + (i < n - 1 ? '' : ' disabled') + ' aria-label="Next item"><svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg></button>' + X.replace('class="x"', 'class="x" style="margin:0"') + '</div></div>' +
        (e === 'name' ? '<div class="ed" style="justify-content:flex-end;padding-top:8px"><button type="button" class="ok" data-commit aria-label="Done">' + OK + '</button></div>' : '') +
        '<div class="ipips" aria-hidden="true">' + S.items.map((x, k) => '<i class="' + (x === it ? 'cur' : k < i ? 'was' : '') + '"></i>').join('') + '</div>' +
        '<div class="icount"><span class="l">Quantity</span><div class="fig"><span>×</span><b id="qtyFig">' + esc(it.qty) + '</b></div><div class="st"><button type="button" data-q="-1" aria-label="One less">−</button><button type="button" data-q="1" aria-label="One more">+</button></div>' +
          '<select data-f="unit" aria-label="Unit">' + UNITS.map((u) => '<option' + (u === it.unit ? ' selected' : '') + '>' + u + '</option>').join('') + '</select></div>' +
        line('size', 'Size', sizeV, 'Tap to add width × height') + field('size', 'Size', '<div class="two"><input class="inp" data-f="w" type="text" inputmode="numeric" placeholder="Width" value="' + esc(it.w) + '" aria-label="Width in mm"><span>×</span><input class="inp" data-f="h" type="text" inputmode="numeric" placeholder="Height" value="' + esc(it.h) + '" aria-label="Height in mm"><span>mm</span></div>') +
        line('spec', 'Specification', esc(it.spec), 'Tap to add, e.g. 8mm clear glass') + field('spec', 'Specification', inp('spec', 'e.g. 8mm clear glass · BS 45')) +
        (it.brand || e === 'brand' ? line('brand', 'Brand', esc(it.brand), '') + (e === 'brand' ? '<div class="edwrap">' + field('brand', 'Brand', inp('brand', 'e.g. Jindal, Saint-Gobain')) + '<button type="button" class="sw" data-brandall aria-pressed="' + (P && P.brandAll) + '"><i></i>Same for all ' + n + ' items</button></div>' : '') : '') +
        (it.note || e === 'note' ? line('note', 'Note', esc(it.note), '') + field('note', 'Note', inp('note', 'Anything the vendor should know')) : '') +
        (missing.length ? '<div class="more">' + missing.map((k) => '<button type="button" data-edit="' + k + '">+ ' + (k === 'brand' ? 'Brand' : 'Note') + '</button>').join('') + '</div>' : '') +
        (e ? '' : '<p class="tip"><b>‹</b> swipe <b>›</b> for other items · tap a line to change it</p>') +
        '<div style="height:6px"></div>';
    }
    function paintItem() {
      const it = P!.it as Row, e = P!.edit as string; ($('#pBody') as HTMLElement).innerHTML = itemHTML(it, e);
      paintActs();
      const here = root!.querySelector('.it[data-item="' + it.id + '"]') as HTMLElement | null; root!.querySelectorAll('.it.editing').forEach((r) => r.classList.remove('editing')); if (here && !e) { here.classList.add('editing'); ($('#view') as HTMLElement).scrollTo({ top: here.offsetTop - 70, behavior: calm ? 'auto' : 'smooth' }); }
      if (e) { const f = panel.querySelector('#pBody [data-f]:not(select)') as HTMLInputElement | null; if (f) { f.focus({ preventScroll: true }); if (f.setSelectionRange && f.type !== 'number') { const L = f.value.length; try { f.setSelectionRange(L, L); } catch (x) { /* not selectable */ } } setTimeout(() => { const ed = panel.querySelector('#pBody .ed, #pBody .edwrap, #pBody .name.editing'); if (ed) ed.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 120); } }
    }
    function paintActs() {
      const el = actsRef.current; if (!el) return;
      const it = P!.it as Row, i = S.items.indexOf(it), n = S.items.length, last = i >= n - 1;
      el.innerHTML = '<button type="button" class="ic" data-photo aria-label="See the photo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.2-2h6.6l1.2 2h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z"/><circle cx="12" cy="13" r="3.2"/></svg></button>' +
        '<button type="button" class="ic del" data-remove aria-label="Remove this item"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7"/></svg></button>' +
        (last ? '<button type="button" class="ghost" data-step="-1"><svg class="c2" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>Previous</button><button type="button" class="go sage" data-advance><svg class="c2" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>Done</button>'
          : '<button type="button" class="ghost" data-close>Done</button><button type="button" class="go" data-advance>Next<svg class="c2" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button>');
    }
    function commitItem() {
      const it = P!.it as Row; panel.querySelectorAll('#pBody [data-f]').forEach((el) => { const k = (el as HTMLElement).dataset.f as string, v = (el as HTMLInputElement).value.trim(); const rec = it as unknown as Record<string, string>; if (rec[k] !== v) { rec[k] = v; if (it.read[k]) it.read[k] = 0; if (k === 'w' || k === 'h') it.read.w = 0; } });
      if (P!.brandAll && it.brand) S.items.forEach((x) => { x.brand = it.brand; });
    }
    function syncRow(it: Row) { const r = root!.querySelector('.it[data-item="' + it.id + '"]'); if (!r) return; (r as HTMLElement).outerHTML = itemRow(it, S.items.indexOf(it)); paintHero(); const sp = root!.querySelector('#main .sec:last-of-type span'); if (sp) sp.innerHTML = '<b>' + S.items.length + '</b> items' + (totalArea() ? ' · <b>' + totalArea() + '</b> sqft' : ''); scheduleSave(); }
    function syncAll() { S.items.forEach(syncRow); }

    /* Create PO — a light confirm (supplier required), then the host raises the order and takes us to the
       PO list with the new order highlighted. No review/save step: the request was kept as you went. */
    function openPO() {
      if (!payeeOk()) { buzz([20, 40, 20]); openPick('payee', S.payee); say('Pick the supplier for the PO, or add it'); return; }
      P = { kind: 'po' };
      openPanel('<div class="p-head"><div class="t"><h2>Create the PO</h2><span>Raised under ' + esc(S.project) + ' for ' + esc(S.payee) + '.</span></div>' + X + '</div>' +
        '<div class="rowS plain"><span class="l">Supplier</span><span class="v">' + esc(S.payee) + '</span></div>' +
        '<div class="rowS plain"><span class="l">Project</span><span class="v">' + esc(S.project) + '</span></div>' +
        '<div class="rowS plain"><span class="l">Items</span><span class="v mono">' + S.items.length + (totalArea() ? ' · ' + totalArea() + ' sqft' : '') + '</span></div>' +
        '<div class="rowS plain"><span class="l">Came in</span><span class="v">WhatsApp · ' + esc(S.from) + '</span></div>' +
        '<div class="foot"><button type="button" class="big" data-makepo>Create PO</button></div><button type="button" class="quiet" data-close>Change something first</button>');
    }
    async function makePO() {
      const b = panel.querySelector('[data-makepo]') as HTMLButtonElement | null; if (!b || b.disabled) return;
      b.disabled = true; b.textContent = 'Creating…';
      try {
        if (saveT) { clearTimeout(saveT); await doSave(); }   // land any pending edits first
        await pRef.current.onCreatePO();                       // the host navigates to the PO list, highlighted
        if (dead) return; b.classList.add('ok'); b.textContent = 'Created'; buzz([10, 40, 18]);
      } catch (err) {
        b.disabled = false; b.textContent = 'Create PO'; say((err as Error)?.message || 'Could not create it — try again');
      }
    }

    /* ---------- request quotes: pick suppliers · the message · send (the reference's flow) ---------- */
    type QState = { step: 1 | 2 | 3; picked: string[]; q: string; hi: number; lastHi: string | null; adding: string; note: string; by: string; sent: boolean };
    let Q: QState | null = null;
    const qAdded: Record<string, string> = {};   // suppliers added in the flow: name -> phone
    const supList = () => pRef.current.suppliers || [];
    const supByName = (name: string) => supList().find((x) => x.name === name);
    const sugg = () => supList().filter((x) => x.suggested);
    function qList() {
      const k = (Q!.q || '').trim().toLowerCase();
      const all = supList();
      if (k) return all.filter((x) => x.name.toLowerCase().includes(k) || (x.sub || '').toLowerCase().includes(k));
      const s = sugg(); return s.concat(all.filter((x) => !s.includes(x)));
    }
    function openQuotes() {
      Q = { step: 1, picked: [], q: '', hi: 0, lastHi: null, adding: '', note: '', by: '2 days', sent: false };
      // Do NOT auto-focus the search — the keyboard only comes up when the field is tapped.
      P = { kind: 'quotes' }; openPanel(''); paintQ();
    }
    function paintQ(keep?: boolean) {
      const y = panel.scrollTop, n = S.items.length;
      if (Q!.step === 1) {
        const list = qList(), k = Q!.q.trim(), exact = supList().some((x) => x.name.toLowerCase() === k.toLowerCase()), sug = sugg();
        ($('#pBody') as HTMLElement).innerHTML = '<div class="p-head"><div class="t"><h2>Request quotes</h2><span>For ' + n + ' items · ' + esc(S.project || 'no project yet') + '</span></div>' + X + '</div>' +
          '<div class="qtop"><label class="qfind"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg><input id="qq" type="text" autocomplete="off" autocapitalize="words" enterkeyhint="done" placeholder="Type a supplier&#39;s name" value="' + esc(Q!.q) + '" aria-label="Supplier"></label>' +
          '<div class="chips2" id="qchips">' + Q!.picked.map((pn) => '<span class="chp' + (Q!.lastHi === pn ? ' last' : '') + '">' + esc(pn) + '<button type="button" data-unpick="' + esc(pn) + '" aria-label="Remove"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></span>').join('') + '</div></div>' +
          (Q!.adding ? '<div class="newsup"><div class="tel"><span>+91</span><input id="qtel" type="tel" inputmode="numeric" maxlength="11" placeholder="98480 12321" aria-label="Phone"></div><p>' + esc(Q!.adding) + ' will get the request on this number and be saved as a supplier.</p><button type="button" class="chip" data-addsup style="margin-top:10px" aria-pressed="true">Add and tick</button></div>' : '') +
          (!k && sug.length ? '<p class="qsec">Suggested · you have bought from them</p>' : '') +
          list.map((x, i) => (!k && sug.length && i === sug.length ? '<p class="qsec">Others</p>' : '') + '<button type="button" class="sup' + (k && i === Q!.hi ? ' hi' : '') + '" data-pick="' + esc(x.name) + '" aria-pressed="' + Q!.picked.includes(x.name) + '"><span class="av">' + initials(x.name) + '</span><span class="m"><b>' + esc(x.name) + '</b><span>' + esc(x.sub || '') + '</span></span><span class="tk">' + TICK + '</span></button>').join('') +
          (k && !exact ? '<button type="button" class="sup add" data-adding="' + esc(k) + '"><span class="av">+</span><span class="m"><b>Add “' + esc(k) + '”</b><span>New supplier, with a phone number</span></span></button>' : '') +
          '<div class="qfoot"><button type="button" class="big" data-qnext' + (Q!.picked.length ? '' : ' disabled') + '>' + (Q!.picked.length ? 'Next · ' + Q!.picked.length + (Q!.picked.length === 1 ? ' supplier' : ' suppliers') : 'Pick a supplier') + '</button></div>';
      } else if (Q!.step === 2) {
        const site = esc(S.project || 'Briklay');
        ($('#pBody') as HTMLElement).innerHTML = '<div class="p-head"><button type="button" class="x" data-qback aria-label="Back" style="margin:-6px 0 0 -8px"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button><div class="t"><h2>What they will get</h2><span>A WhatsApp message with a link. Rates come back as a quote here.</span></div>' + X + '</div>' +
          '<p class="msgto">To ' + Q!.picked.map(esc).join(', ') + ' · each gets their own</p>' +
          '<div class="msg"><div class="body"><h4>Quotation Request</h4><p>Hello ' + esc(Q!.picked[0] || 'Supplier') + ',</p><p>requesting your quotation for ' + esc(S.items[0]?.name || 'materials') + (n > 1 ? ', ' + esc(S.items[1]?.name || '') : '') + (n > 2 ? ' +' + (n - 2) + ' more (' + n + ' items)' : '') + ', delivery to ' + site + '.' + (Q!.note ? ' ' + esc(Q!.note) : '') + '</p><p>Tap the button to fill your rates — no login needed. Reply by ' + esc(Q!.by.toLowerCase()) + '.</p><div class="meta"><span>Sent via Briklay App</span></div></div><div class="cta"><svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 13v6H5V6h6"/></svg>Give Quotation</div></div>' +
          '<div class="onlink"><span class="mini"><i></i><i></i><i></i><u></u></span><p><b>On the link:</b> your ' + n + ' items with sizes and specs, a box for each rate, and one tap to send it back. Their quote lands on this request.</p></div>' +
          '<div class="qrow"><span class="l">Note</span><input id="qnote" type="text" autocomplete="off" enterkeyhint="done" placeholder="Delivery to site, GST…" value="' + esc(Q!.note) + '"></div>' +
          '<div class="qrow"><span class="l">Reply by</span><div class="chips">' + ['Tomorrow', '2 days', 'This week'].map((b) => '<button type="button" class="chip" data-by="' + b + '" aria-pressed="' + (b === Q!.by) + '">' + b + '</button>').join('') + '</div></div>' +
          '<div class="qfoot"><button type="button" class="big" data-qsend>Send to ' + Q!.picked.length + (Q!.picked.length === 1 ? ' supplier' : ' suppliers') + '</button></div>';
      } else {
        ($('#pBody') as HTMLElement).innerHTML = '<div class="p-head"><div class="t"><h2>' + (Q!.sent ? 'Quotes requested' : 'Sending…') + '</h2><span>' + (Q!.sent ? 'Their rates will land on this request.' : 'Reaching each supplier on WhatsApp') + '</span></div>' + X + '</div>' +
          '<div class="qsent">' + Q!.picked.map((pn, i) => '<div class="sentl" data-sent="' + i + '"><span class="tk">' + TICK + '</span><span class="m"><b>' + esc(pn) + '</b><span>' + esc(supByName(pn)?.phone || qAdded[pn] || 'new number') + '</span></span></div>').join('') + '</div>' +
          '<div class="qfoot"><button type="button" class="big' + (Q!.sent ? ' ok' : ' busy') + '" data-close' + (Q!.sent ? '' : ' disabled') + '>' + (Q!.sent ? 'Done · ' + Q!.picked.length + (Q!.picked.length === 1 ? ' request sent' : ' requests sent') : 'Sending…') + '</button></div>';
      }
      // The sent/summary step gracefully expands to a full page (not a short card).
      panel.classList.toggle('full', Q!.step === 3);
      if (keep) panel.scrollTop = y;
    }
    function qPick(name: string) {
      const i = Q!.picked.indexOf(name); if (i >= 0) Q!.picked.splice(i, 1); else Q!.picked.push(name);
      Q!.lastHi = null; buzz(4); Q!.q = ''; Q!.hi = 0;
      // Only keep the keyboard up if the user was typing in the search; a tap on a row must not raise it.
      const wasTyping = document.activeElement === $('#qq');
      paintQ(true);
      if (wasTyping) { const f = $('#qq') as HTMLInputElement | null; f && f.focus({ preventScroll: true }); }
    }
    async function qSend() {
      Q!.step = 3; paintQ(); (document.activeElement as HTMLElement | null)?.blur();
      const recipients = Q!.picked.map((name) => { const s = supByName(name); return { id: s?.id, name, phone: s?.phone || qAdded[name] || '' }; });
      try {
        await pRef.current.onSendQuotes({ recipients, note: Q!.note, replyBy: Q!.by });
      } catch (err) {
        if (dead) return; say((err as Error)?.message || 'Could not send the requests — try again'); Q!.step = 2; paintQ(); return;
      }
      if (dead) return;
      for (let i = 0; i < Q!.picked.length; i++) { await sleep(calm ? 0 : 420); if (dead) return; const r = root!.querySelector('[data-sent="' + i + '"]'); r && r.classList.add('ok'); buzz(4); }
      await sleep(calm ? 0 : 260); if (dead) return; Q!.sent = true; S.quoted = Q!.picked.slice(); paintQ(); buzz([10, 40, 18]); paintDock(); paintMain();
    }

    /* ---------- one listener each side ---------- */
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!el) return;
      if (!root!.contains(el) && !(actsRef.current && actsRef.current.contains(el))) return;   // the page and the toolbar it lent, nothing else
      if (el.hasAttribute('data-back')) { pRef.current.onBack(); return; }
      // The reference's own three, word for word. Two of them are real here: reading the quote again
      // replays the read, and keeping it as a draft is simply leaving — nothing is written until Save.
      if (el.hasAttribute('data-menu')) { openPanel('<div class="p-head"><div class="t"><h2>This request</h2></div>' + X + '</div><button type="button" class="opt" data-addpage><span class="av">+</span><span class="m"><b>Add a page</b><span>If the quote runs onto another sheet</span></span></button><button type="button" class="opt" data-reread><span class="av">↻</span><span class="m"><b>Read the quote again</b></span></button><button type="button" class="opt" data-draft><span class="av">⌄</span><span class="m"><b>Keep as draft, finish later</b></span></button>'); P = { kind: 'menu' }; return; }
      if (el.hasAttribute('data-addpage')) { closePanel(); const m = pRef.current.onAddPage(); if (m) say(m); return; }
      if (el.hasAttribute('data-reread')) { closePanel(); S.reading = true; shown = 0; paint(); void read(); return; }
      if (el.hasAttribute('data-draft')) { closePanel(); pRef.current.onBack(); return; }
      if (el.hasAttribute('data-photo')) { ($('#viewerImg') as HTMLImageElement).src = PHOTO; ($('#viewer') as HTMLElement).classList.add('on'); return; }
      if (el.id === 'viewerClose') { ($('#viewer') as HTMLElement).classList.remove('on'); return; }
      // The two next actions: Request quotes opens the supplier flow; Create PO the light confirm.
      if (el.hasAttribute('data-rfq')) { openQuotes(); return; }
      if (el.hasAttribute('data-po')) { openPO(); return; }
      if (el.hasAttribute('data-makepo')) { void makePO(); return; }
      // The quote panel's own buttons (only while it is the open panel).
      if (Q && P && P.kind === 'quotes') {
        if (el.dataset.pick) { qPick(el.dataset.pick); return; }
        if (el.dataset.unpick) { Q.picked = Q.picked.filter((x) => x !== el.dataset.unpick); Q.lastHi = null; buzz(3); paintQ(true); return; }
        if (el.dataset.adding) { Q.adding = el.dataset.adding; paintQ(true); const t = $('#qtel') as HTMLInputElement | null; t && t.focus(); return; }
        if (el.hasAttribute('data-addsup')) { const tel = ($('#qtel') as HTMLInputElement | null)?.value || ''; const nm = Q.adding; qAdded[nm] = tel.trim(); if (!Q.picked.includes(nm)) Q.picked.push(nm); Q.adding = ''; Q.q = ''; buzz(6); paintQ(true); say(nm + ' added'); return; }
        if (el.hasAttribute('data-qnext')) { if (!Q.picked.length) return; Q.step = 2; buzz(6); paintQ(); return; }
        if (el.hasAttribute('data-qback')) { Q.step = 1; paintQ(); return; }
        if (el.dataset.by) { Q.by = el.dataset.by; paintQ(true); return; }
        if (el.hasAttribute('data-qsend')) { Q.note = ($('#qnote') as HTMLInputElement | null)?.value || Q.note; void qSend(); return; }
      }
      if (el.hasAttribute('data-close')) { if (P && P.kind === 'item') { commitItem(); syncAll(); paintMain(); paintDock(); } closePanel(); return; }
      if (el.dataset.todo === 'project' || el.dataset.todo === 'payee') { openPick(el.dataset.todo); return; }
      if (el.dataset.item) { openItem(+el.dataset.item); return; }
      if (el.hasAttribute('data-additem')) { const it = IT('', 1); S.items.push(it); paintMain(); paintHero(); openItem(it.id); P!.edit = 'name'; paintItem(); return; }
      if (!P) return;
      if (P.kind !== 'item') {
        if (el.dataset.pick) { setPick(P.kind, el.dataset.pick); return; }
        if (el.dataset.create) { addedPayees.unshift([el.dataset.create, 'New party']); pRef.current.onCreatePayee(el.dataset.create); setPick('payee', el.dataset.create); say(el.dataset.create + ' added to your parties'); return; }
        return;
      }
      const it = P.it as Row;
      if (el.dataset.edit) { commitItem(); P.edit = el.dataset.edit; buzz(3); paintItem(); return; }
      if (el.hasAttribute('data-commit')) { commitItem(); P.edit = ''; buzz(4); paintItem(); syncAll(); return; }
      if (el.dataset.q) { commitItem(); it.qty = String(Math.max(1, (num(it.qty) || 1) + +el.dataset.q)); buzz(4); paintItem(); const q = $('#qtyFig'); if (q) q.classList.add('pop'); syncRow(it); return; }
      if (el.hasAttribute('data-brandall')) { P.brandAll = !P.brandAll; el.setAttribute('aria-pressed', String(P.brandAll)); buzz(4); return; }
      if (el.dataset.step) { const nxt = S.items[S.items.indexOf(it) + +el.dataset.step]; if (nxt) turnTo(nxt, +el.dataset.step); return; }
      if (el.hasAttribute('data-advance')) {
        commitItem(); syncAll(); const nxt = S.items[S.items.indexOf(it) + 1];
        if (nxt) { lit = it.id; turnTo(nxt, 1); } else { closePanel(); lit = it.id; paintMain(); paintDock(); say('All ' + S.items.length + ' items checked'); }
        return;
      }
      if (el.hasAttribute('data-remove')) { const i = S.items.indexOf(it); S.items.splice(i, 1); closePanel(); paint(); scheduleSave(); say('Item removed', () => { S.items.splice(i, 0, it); paint(); scheduleSave(); }); }
    };
    const onInput = (e: Event) => {
      const t = e.target as HTMLInputElement;
      if (P && P.kind === 'item' && t.dataset && t.dataset.f) { commitItem(); syncRow(P.it as Row); if (t.tagName === 'TEXTAREA') { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; } }
      if (P && P.kind === 'payee' && t.id === 'pq') { P.q = t.value; const y = panel.scrollTop; paintPick(); panel.scrollTop = y; const f = $('#pq') as HTMLInputElement; f.focus({ preventScroll: true }); f.setSelectionRange(f.value.length, f.value.length); }
      if (Q && P && P.kind === 'quotes') {
        if (t.id === 'qq') { Q.q = t.value; Q.hi = 0; Q.adding = ''; Q.lastHi = null; const y = panel.scrollTop; paintQ(true); panel.scrollTop = y; const f = $('#qq') as HTMLInputElement; f.focus({ preventScroll: true }); f.setSelectionRange(f.value.length, f.value.length); }
        else if (t.id === 'qnote') { Q.note = t.value; }
      }
    };
    const onChange = (e: Event) => { const t = e.target as HTMLSelectElement; if (P && P.kind === 'item' && t.dataset.f === 'unit') { (P.it as Row).unit = t.value; syncRow(P.it as Row); } };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (($('#viewer') as HTMLElement).classList.contains('on')) ($('#viewer') as HTMLElement).classList.remove('on'); else if (panel.classList.contains('on')) closePanel(); return; }
      // Quote step 1: type-ahead — Enter ticks the top match (or opens add), arrows move, Backspace unpicks.
      if (Q && P && P.kind === 'quotes' && Q.step === 1 && (e.target as HTMLElement).id === 'qq') {
        const list = qList(), k = Q.q.trim();
        if (e.key === 'Enter') { e.preventDefault(); if (k && list[Q.hi]) qPick(list[Q.hi].name); else if (k) { Q.adding = k; paintQ(true); const tel = $('#qtel') as HTMLInputElement | null; tel && tel.focus(); } else if (Q.picked.length) { Q.step = 2; paintQ(); } return; }
        if (e.key === 'ArrowDown' && k) { e.preventDefault(); Q.hi = Math.min(list.length - 1, Q.hi + 1); paintQ(true); ($('#qq') as HTMLInputElement).focus({ preventScroll: true }); return; }
        if (e.key === 'ArrowUp' && k) { e.preventDefault(); Q.hi = Math.max(0, Q.hi - 1); paintQ(true); ($('#qq') as HTMLInputElement).focus({ preventScroll: true }); return; }
        if (e.key === 'Backspace' && !k && Q.picked.length) { e.preventDefault(); if (Q.lastHi === Q.picked[Q.picked.length - 1]) { Q.picked.pop(); Q.lastHi = null; buzz(3); } else Q.lastHi = Q.picked[Q.picked.length - 1]; paintQ(true); ($('#qq') as HTMLInputElement).focus({ preventScroll: true }); return; }
        return;
      }
      if (e.key !== 'Enter' || !P) return;
      const t = e.target as HTMLInputElement;
      if (P.kind === 'item' && t.dataset && t.dataset.f) { e.preventDefault(); const all = [...panel.querySelectorAll('#pBody .inp[data-f]')] as HTMLInputElement[], j = all.indexOf(t); if (j >= 0 && j < all.length - 1) all[j + 1].focus(); else { commitItem(); P.edit = ''; paintItem(); syncAll(); } }
      if (P.kind === 'payee' && t.id === 'pq') { const first = panel.querySelector('[data-pick],[data-create]') as HTMLElement | null; if (first) first.click(); }
    };
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('keydown', onKey);
    const view = $('#view') as HTMLElement;
    const onScroll = () => { ($('#compact') as HTMLElement).classList.toggle('on', view.scrollTop > ($('#hero') as HTMLElement).offsetHeight - 54); };
    view.addEventListener('scroll', onScroll, { passive: true });

    let toastT = 0; let undoFn: (() => void) | null = null;
    function say(text: string, undo?: () => void) { ($('#toastText') as HTMLElement).textContent = text; undoFn = undo || null; ($('#toastBtn') as HTMLElement).hidden = !undo; ($('#toast') as HTMLElement).classList.add('on'); clearTimeout(toastT); toastT = window.setTimeout(() => ($('#toast') as HTMLElement).classList.remove('on'), undo ? 4500 : 2100); }
    const toastBtn = $('#toastBtn') as HTMLElement;
    const onUndo = () => { ($('#toast') as HTMLElement).classList.remove('on'); if (undoFn) { buzz(5); undoFn(); undoFn = null; } };
    toastBtn.addEventListener('click', onUndo);

    void read();

    return () => {
      dead = true;
      if (saveT) { clearTimeout(saveT); void doSave(); }   // land the last edit if the screen closes mid-debounce
      document.removeEventListener('click', onClick);
      document.removeEventListener('input', onInput);
      document.removeEventListener('change', onChange);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      if (vv) { vv.removeEventListener('resize', onVv); vv.removeEventListener('scroll', setKb); }
      clearTimeout(toastT);
      document.body.classList.remove('pqr-kb');
      document.body.classList.remove('pqr-card');
      navTakeover.release();
    };
    // The page mounts once, with the request it was given: the reference is one long-lived screen and
    // its own state is the record from here on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The document scrolls behind a fixed full-screen layer otherwise.
  useEffect(() => { const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = prev; }; }, []);

  return (
    <div className="pqr" ref={rootRef}>
      <style>{PQR_CSS}</style>
      <div className="compact" id="compact"><button type="button" data-back aria-label="Back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg></button><b>Purchase request</b><span id="cSum" /></div>

      <div className="view" id="view">
        <header className="hero" id="hero" />
        <main id="main" />
      </div>

      <div className="dock" id="dock" />
      <div className="scrim" id="scrim" />
      <section className="panel" id="panel" role="dialog" aria-modal="true"><div className="grab" aria-hidden="true"><i /></div><div id="pBody" /></section>
      <div className="viewer" id="viewer" role="dialog" aria-modal="true" aria-label="The quote"><img id="viewerImg" alt="The quote that was sent on WhatsApp" /><p>The quote, as it came in on WhatsApp</p><button type="button" id="viewerClose" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button></div>

      <div className="toast" id="toast" role="status"><span id="toastText" /><button type="button" id="toastBtn" hidden>Undo</button></div>
    </div>
  );
}
