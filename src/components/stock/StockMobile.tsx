/**
 * Stock on a phone.
 *
 * The desktop page is a table — five columns, a hover-select, a side drawer. On a phone held in one
 * hand on a site, that is unreadable and untappable, so the same three beats are kept in the same
 * order and re-cut for a thumb:
 *
 *   the fact     how much is here, and where it is standing — the card's own two lines
 *   the story    arrived → used → left, as one bar under the name
 *   the action   "− Used" / "+ Arrived" on the row, which become a stepper in place
 *
 * The site filter is the strip in the band rather than a dropdown: on a phone the thing you change
 * most often should not be behind a menu. A material opens its ledger as a sheet, not a drawer.
 *
 * It owns no stock state. Everything it shows is the page's, and everything it does it does through
 * the page's own handlers, so the two surfaces cannot drift into two answers.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { usePullToRefresh, useLiveCount } from '../../lib/usePullToRefresh';
import { useSnackbar } from '../Snackbar';
import { useSheetDrag } from '../../lib/sheetDrag';
import { STKM_CSS } from './stkmCss';

export interface StkMat {
  item_key: string; inventory_id: string | null; item_name: string; unit: string | null;
  project_id: string; site: string; rowKey: string;
  on_hand: number; total_out: number; used_since: number; avg_rate: number | null;
  last_delivery_at: string | null; last_delivery_qty: number | null; last_movement_at: string | null;
  category: string | null; alert_qty: number | null; aliases: string[] | null; stock_value: number;
}
interface LEntry { entry_id: string; direction: string; kind: string; qty: number; unit_rate: number | null; note: string | null; created_at: string; ref_type: string | null; ref_id: string | null }

export interface StockMobileProps {
  /** every pile the page loaded, before the site filter — the strip counts against this */
  allMats: StkMat[];
  /** the piles after the site filter — what the list shows */
  mats: StkMat[];
  sites: { project_id: string; name: string; n: number }[];
  site: string; onSite: (id: string) => void;
  locked: boolean; lockedName?: string;
  queueCount: number; queueSite: string; onSort: () => void; onPickSite: () => void;
  onRaisePo: () => void;
  onNew: () => void;
  /** record a movement against this pile, at its own site */
  onMove: (m: StkMat, kind: 'in' | 'out', qty: number) => Promise<void>;
  onAlert: (m: StkMat, value: string) => Promise<void>;
  onRefresh: () => Promise<unknown>;
  isLoading: boolean;
}

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const fmt = (n: number) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 });
const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
const dstr = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');
const dayNo = (s: string | null) => (s ? new Date(s).setHours(0, 0, 0, 0) : 0);
const DAY = 86400000;
const isLow = (m: StkMat) => m.alert_qty != null && m.alert_qty > 0 && m.on_hand <= m.alert_qty;
const catOf = (m: StkMat) => m.category?.trim() || 'Uncategorised';
/** "About 8 days left, at ~5 bag a day" — the desktop page's own reading, unchanged. */
function lasts(m: StkMat): { text: string; sub: string; kind: string } | null {
  if (!m.last_delivery_at) return null;
  const today = new Date().setHours(0, 0, 0, 0), li = dayNo(m.last_delivery_at);
  const used = m.used_since || 0, days = Math.max(1, Math.round((today - li) / DAY));
  if (!used) return { text: li >= today ? 'Arrived today' : 'Nothing used since it arrived', sub: 'no usage since ' + dstr(m.last_delivery_at), kind: li >= today ? 'new' : 'dim' };
  const perDay = used / days, left = m.on_hand / perDay;
  return { text: 'About ' + (left < 1 ? 'a day' : Math.round(left) + ' days') + ' left', sub: 'at ~' + fmt(perDay) + ' ' + (m.unit ?? '') + ' a day since ' + dstr(m.last_delivery_at), kind: left < 5 ? 'low' : left < 12 ? '' : 'ok' };
}

const TICK = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
const X = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>;

export default function StockMobile(p: StockMobileProps) {
  const { show } = useSnackbar();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const [onlyLow, setOnlyLow] = useState(false);
  const [open, setOpen] = useState<StkMat | null>(null);
  const [entry, setEntry] = useState<{ key: string; kind: 'in' | 'out'; qty: string; where: 'row' | 'sheet' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [dfilter, setDfilter] = useState<'all' | 'in' | 'out'>('all');
  const [alertVal, setAlertVal] = useState('');

  const lowList = useMemo(() => p.mats.filter(isLow), [p.mats]);
  const cats = useMemo(() => [...new Set(p.mats.map(catOf))], [p.mats]);
  const visible = useMemo(() => p.mats.filter((m) => (cat === 'All' || catOf(m) === cat) && (!onlyLow || isLow(m)) && (!q || m.item_name.toLowerCase().includes(q.toLowerCase()))), [p.mats, cat, onlyLow, q]);
  const totalValue = p.mats.reduce((a, m) => a + (Number(m.stock_value) || 0), 0);
  const latest = useMemo(() => p.mats.map((m) => m.last_delivery_at).filter(Boolean).sort().reverse()[0] ?? null, [p.mats]);

  // Pull the page down and it reads the yard again.
  const live = useLiveCount(p.mats.length);
  const { view: pullView } = usePullToRefresh({ attachTo: rootRef, noun: 'material', count: live, onRefresh: p.onRefresh });

  // The open material's movements — at ITS site, which across sites is not the page's.
  const ledger = useQuery({
    queryKey: ['stock_ledger_item', open?.rowKey],
    enabled: !!open,
    queryFn: async () => {
      let query = supabase.from('stock_ledger').select('entry_id, direction, kind, qty, unit_rate, note, created_at, ref_type, ref_id').eq('project_id', open!.project_id);
      query = open!.inventory_id ? query.eq('inventory_id', open!.inventory_id) : query.is('inventory_id', null).eq('unit', open!.unit ?? '').ilike('item_name', open!.item_name);
      const { data } = await query.order('created_at', { ascending: false });
      return (data ?? []) as LEntry[];
    },
  });

  // the open sheet follows its row when the numbers move under it
  useEffect(() => { if (open) { const fresh = p.mats.find((m) => m.rowKey === open.rowKey); if (fresh) setOpen(fresh); } }, [p.mats]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) setAlertVal(open.alert_qty ? String(open.alert_qty) : ''); }, [open?.rowKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeSheet = () => { setOpen(null); setEntry(null); };
  const sheetRef = useSheetDrag<HTMLElement>(closeSheet, !!open);

  const save = async () => {
    if (!entry || busy) return;
    const m = p.mats.find((x) => x.rowKey === entry.key); if (!m) return;
    const val = parseFloat(entry.qty); if (!(val > 0)) return;
    setBusy(true);
    // The write is the page's and it throws on refusal — on a phone, in a yard, that must land as a
    // sentence rather than an unhandled rejection with the number silently unchanged.
    try { await p.onMove(m, entry.kind, val); setFlash(m.rowKey); setTimeout(() => setFlash(null), 1500); setEntry(null); }
    catch (e) { show((e as Error)?.message || 'Could not record it', { type: 'error' }); }
    finally { setBusy(false); }
  };
  const step = (d: number) => setEntry((e) => (e ? { ...e, qty: String(Math.max(0, (parseFloat(e.qty) || 0) + d)) } : e));

  const stepper = (m: StkMat, where: 'row' | 'sheet') => {
    const e = entry && entry.key === m.rowKey && entry.where === where ? entry : null;
    if (!e) return null;
    return (
      <div className={`ent ${e.kind}`}>
        <span className="k">{e.kind === 'out' ? '− Used' : '+ Arrived'}</span>
        <button type="button" className="stp" onClick={() => step(-1)}>−</button>
        <input autoFocus inputMode="decimal" placeholder="how many" value={e.qty}
          onChange={(ev) => setEntry({ ...e, qty: ev.target.value })}
          onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); void save(); } else if (ev.key === 'Escape') setEntry(null); }} />
        <button type="button" className="stp" onClick={() => step(1)}>+</button>
        <span className="u">{m.unit}</span>
        <button type="button" className={`ok${parseFloat(e.qty) > 0 ? ' ready' : ''}`} disabled={busy} onClick={() => void save()}>{TICK}</button>
        <button type="button" className="x" onClick={() => setEntry(null)}>{X}</button>
      </div>
    );
  };

  const scope = p.locked ? (p.lockedName ?? 'this site') : p.site ? (p.sites.find((s) => s.project_id === p.site)?.name ?? '') : `${p.sites.length} site${p.sites.length === 1 ? '' : 's'}`;

  return (
    <div className="stkm" ref={rootRef}>
      <style>{STKM_CSS}</style>
      {pullView}

      <header className="band">
        <div className="bin">
          <div className="brow">
            <h1>Stock</h1>
            <button type="button" className="new" onClick={p.onNew}><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>New</button>
          </div>
          <div className="big">{inr(totalValue)}<small>{p.locked || p.site ? 'on site · ' + scope : 'across ' + scope}</small></div>
          <div className="facts">
            <b>{p.mats.length}</b> materials<i>·</i>
            <b className={lowList.length ? 'low' : ''}>{lowList.length}</b> running low<i>·</i>
            last delivery <b>{latest ? dstr(latest) : '—'}</b>
          </div>
        </div>
        {!p.locked && p.sites.length > 1 && (
          <div className="sites">
            <button type="button" className={p.site ? '' : 'on'} onClick={() => p.onSite('')}>All sites<em>{p.allMats.length}</em></button>
            {p.sites.map((s) => <button type="button" key={s.project_id} className={p.site === s.project_id ? 'on' : ''} onClick={() => p.onSite(s.project_id)}>{s.name}<em>{s.n}</em></button>)}
          </div>
        )}
      </header>

      {(p.queueCount > 0 || lowList.length > 0) && (
        <section className="needs">
          {p.queueCount > 0 && (
            <div className="ln">
              <span className="ic clay"><svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z" /><path d="M9 12h6M9 16h6" /></svg></span>
              <span className="tx"><b>{p.queueCount} arrival{p.queueCount === 1 ? '' : 's'}</b> came in without a clear material</span>
              {p.queueSite ? <a onClick={p.onSort}>Sort</a> : <a onClick={p.onPickSite}>Pick a site</a>}
            </div>
          )}
          {lowList.length > 0 && (
            <div className="ln">
              <span className="ic amber"><svg viewBox="0 0 24 24"><path d="M12 3v11" /><path d="m7 9 5 5 5-5" /><path d="M4 20h16" /></svg></span>
              <span className="tx"><b>{lowList.slice(0, 2).map((m) => m.item_name).join(', ')}</b>{lowList.length > 2 ? ` +${lowList.length - 2}` : ''} {lowList.length === 1 ? 'is' : 'are'} running low</span>
              <a onClick={p.onRaisePo}>Raise a PO</a>
            </div>
          )}
        </section>
      )}

      <label className="find">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input placeholder="Search materials" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="cats">
        <button type="button" className={cat === 'All' ? 'on' : ''} onClick={() => setCat('All')}>All<em>{p.mats.length}</em></button>
        {cats.map((c) => <button type="button" key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}<em>{p.mats.filter((m) => catOf(m) === c).length}</em></button>)}
        <button type="button" className={onlyLow ? 'on' : ''} onClick={() => setOnlyLow((v) => !v)}>Running low<em>{lowList.length}</em></button>
      </div>

      {p.isLoading ? <div className="empty">Reading the yard…</div>
        : p.mats.length === 0 ? <div className="empty">No stock yet. When goods are received {p.locked || p.site ? 'at this site' : 'on any of your sites'}, they appear here.</div>
        : visible.length === 0 ? <div className="empty">Nothing matches. Clear the filters to see all {p.mats.length} materials.</div>
        : (cat === 'All' ? cats : [cat]).map((c) => {
          const its = visible.filter((m) => catOf(m) === c);
          if (!its.length) return null;
          const val = its.reduce((a, m) => a + (Number(m.stock_value) || 0), 0);
          return (
            <div key={c}>
              <div className="grp"><h3>{c}</h3><span>{val ? <><b>{inr(val)}</b> on site</> : `${its.length} material${its.length === 1 ? '' : 's'}`}</span></div>
              <div className="card">
                {its.map((m) => {
                  const low = isLow(m), lt = lasts(m);
                  const li = m.last_delivery_qty ?? 0, us = m.used_since ?? 0;
                  const ent = entry && entry.key === m.rowKey && entry.where === 'row';
                  return (
                    <div className={`it${low ? ' low' : ''}${flash === m.rowKey ? ' flash' : ''}`} key={m.rowKey}
                      onClick={(e) => { if ((e.target as HTMLElement).closest('button,input')) return; setOpen(m); }}>
                      <div className="top">
                        <span className="av">{initials(m.item_name)}</span>
                        <span className="nm">
                          <b>{m.item_name}</b>
                          <span>
                            {!p.locked && !p.site && m.site ? <><b className="at">{m.site}</b> · </> : null}
                            {low && <b className="lo">Running low</b>}{low && lt ? ' · ' : ''}
                            {lt ? <b className={lt.kind === 'new' ? 'ok' : lt.kind === 'ok' ? 'ok' : ''}>{lt.text}</b> : (!low ? 'Nothing has arrived yet' : '')}
                            {lt && lt.kind !== 'dim' && lt.kind !== 'new' ? ' · ' + lt.sub : ''}
                          </span>
                        </span>
                        <span className="qty"><b className={low ? 'low' : ''}>{fmt(m.on_hand)}</b><span>{m.unit}</span></span>
                      </div>
                      {li > 0 && (<>
                        <div className="bar"><i className="u" style={{ width: Math.min(100, us / li * 100) + '%' }} /><i className="l" style={{ width: Math.max(0, (li - us) / li * 100) + '%' }} /></div>
                        <div className="since">arrived <b>{fmt(li)}</b> · used <b>{fmt(us)}</b> since {dstr(m.last_delivery_at)}</div>
                      </>)}
                      {ent ? stepper(m, 'row') : (
                        <div className="acts">
                          <button type="button" className="pill out" onClick={() => setEntry({ key: m.rowKey, kind: 'out', qty: '', where: 'row' })}>− Used</button>
                          <button type="button" className="pill in" onClick={() => setEntry({ key: m.rowKey, kind: 'in', qty: '', where: 'row' })}>+ Arrived</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

      <div className={`stkm-scrim${open ? ' on' : ''}`} onClick={closeSheet} />
      <aside className={`stkm-sheet${open ? ' on' : ''}`} ref={sheetRef} role="dialog" aria-modal="true" aria-label="Material">
        {open && (() => {
          const m = open, low = isLow(m), lt = lasts(m), ar = m.avg_rate ?? 0;
          const raw = ledger.data ?? [];
          let bal = m.on_hand;
          const withBal = raw.map((e) => { const r = { ...e, bal }; bal += e.direction === 'in' ? -e.qty : e.qty; return r; })
            .filter((e) => dfilter === 'all' || (dfilter === 'in' ? e.direction === 'in' : e.direction === 'out'));
          const days = [...new Set(withBal.map((e) => e.created_at.slice(0, 10)))];
          const ent = entry && entry.key === m.rowKey && entry.where === 'sheet';
          return (<>
            <div className="grab" aria-hidden="true"><i /></div>
            <div className="sh">
              <div className="t">
                <div className="cat">{catOf(m)}</div>
                <h2>{m.item_name}</h2>
                <div className="at2">{m.site ? 'at ' + m.site + ' · ' : ''}counted in {m.unit}</div>
              </div>
              <button type="button" className="x" onClick={closeSheet} aria-label="Close">{X}</button>
            </div>
            <div className={`fig${low ? ' low' : ''}`}>{fmt(m.on_hand)}<small>{m.unit}{low ? ' · running low' : ' on site'}</small></div>
            {lt && <div className={`lasts ${lt.kind === 'low' ? 'warn' : lt.kind === 'ok' || lt.kind === 'new' ? 'ok' : ''}`}><b>{lt.text}</b>{lt.sub}</div>}
            {ent ? stepper(m, 'sheet') : (
              <div className="sacts">
                <button type="button" className="out" onClick={() => setEntry({ key: m.rowKey, kind: 'out', qty: '', where: 'sheet' })}>− Used</button>
                <button type="button" className="in" onClick={() => setEntry({ key: m.rowKey, kind: 'in', qty: '', where: 'sheet' })}>+ Arrived</button>
              </div>
            )}
            <div className="sfacts">
              <div className="sfact"><span>Average rate</span><b>{ar ? inr(ar) : '—'}</b></div>
              <div className="sfact"><span>Value here</span><b>{ar ? inr(ar * m.on_hand) : '—'}</b></div>
              <div className="sfact"><span>Used since</span><b>{fmt(m.used_since)}</b></div>
            </div>
            <div className="alert">Tell me when it drops below
              <input inputMode="numeric" value={alertVal} onChange={(e) => setAlertVal(e.target.value)} onBlur={() => { p.onAlert(m, alertVal).catch((e) => show((e as Error)?.message || 'Could not set the alert', { type: 'error' })); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              {m.unit}
            </div>
            <h4>What came and went</h4>
            <div className="fl">{(['all', 'in', 'out'] as const).map((f) => <button type="button" key={f} className={dfilter === f ? 'on' : ''} onClick={() => setDfilter(f)}>{f === 'all' ? 'All' : f === 'in' ? 'Arrived' : 'Used'}</button>)}</div>
            {ledger.isLoading ? <div className="none">Loading…</div>
              : days.length === 0 ? <div className="none">Nothing here yet.</div>
              : days.map((day) => (
                <div key={day}>
                  <div className="day">{dstr(day)}</div>
                  {withBal.filter((e) => e.created_at.slice(0, 10) === day).map((e) => {
                    const isIn = e.direction === 'in', adj = e.kind === 'adjustment';
                    const sub = isIn ? (e.ref_id || 'manual, no bill') + (e.unit_rate ? ' · ' + inr(e.unit_rate) + '/' + (m.unit ?? '') : '') : (e.note || 'entered');
                    return (
                      <div className={`e ${adj ? 'adj' : e.direction}`} key={e.entry_id}>
                        <div className="w"><b><i />{isIn ? 'Arrived' : adj ? 'Adjusted' : 'Used'}</b><small>{sub}</small></div>
                        <div className="q">{isIn ? '+' : '−'}{fmt(e.qty)}</div>
                        <div className="bal">{fmt(e.bal)}</div>
                      </div>
                    );
                  })}
                </div>
              ))}
          </>);
        })()}
      </aside>
    </div>
  );
}
