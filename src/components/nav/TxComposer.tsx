/**
 * TxComposer — "New transaction", ported from the reference prototype
 * (claude.ai/artifact/NWiS9bYDvcRRDWMQo4K4Ps) value for value.
 *
 * The bar opens, exactly as it does for More: same panel, same colour, same size. One question at a
 * time.
 *   1  who       recents first (most payments go to someone you already pay); search or add below
 *   2  how much  only the number. Our own keypad, so the panel never jumps for a keyboard. The
 *                amount is read back in words.
 *   3  the rest  site, paid via, note, bill and proof. Pre-filled from the last time you paid this
 *                party, so it is usually just "File it".
 *
 * The title is the sentence so far; its parts are tappable to go back. Three dots say where you are:
 * cream = answered, clay = now, hollow = to come. Close it half-way and nothing is lost: the action
 * capsule becomes "Resume draft". Filing hands over to the capsule's own states (see navAction).
 *
 * Everything the panel does not ask — a split across projects, a cost code, a linked WO/PO — is one
 * tap away: "Split across projects, and more" carries what has been answered into the full form.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useOrgId } from '../../lib/auth/AuthProvider';
import { navAction } from './navAction';
import { VIA, emptyDraft, genStkId, genTxnId, fmt, initials, words, today, shift, type PayMode, type TxDraft } from './txDraft';

const ARROW = <path d="M15 5l-7 7 7 7" />;
const CROSS = <path d="M6 6l12 12M18 6 6 18" />;
const CHEV = <svg className="c" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>;
const CAM = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.2-2h6.6l1.2 2h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z" /><circle cx="12" cy="13" r="3.2" /></svg>;

type Party = { id: string; name: string; type: string; last?: number; site?: string; siteName?: string; via?: PayMode };

export function TxComposer({ draft, onDraft, onClose }: {
  /** null = shut. Opening with a draft resumes exactly where it was left. */
  draft: TxDraft | null;
  onDraft: (d: TxDraft | null) => void;
  /** keep = the draft survives, and the capsule offers to resume it */
  onClose: (keep: boolean) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const orgId = useOrgId();
  const open = !!draft;
  const T = draft ?? emptyDraft();
  const set = (patch: Partial<TxDraft>) => onDraft({ ...T, ...patch });

  const panelRef = useRef<HTMLElement | null>(null);
  const slipRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [back, setBack] = useState(false);   // the step moved backwards: the body slides in from the left

  const buzz = (ms: number | number[] = 6) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };
  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── who you pay: everyone, with the recents (and what you last paid them) in front ──
  const { data: parties = [] } = useQuery<Party[]>({
    queryKey: ['txc_parties'],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => {
      const [{ data: stks }, { data: recent }] = await Promise.all([
        supabase.from('stakeholders').select('stakeholder_id, name, type').is('merged_into', null).order('name'),
        supabase.from('transactions')
          .select('stakeholder_id, total_amount, date, payment_mode, txn_allocations(project_id)')
          .not('stakeholder_id', 'is', null).order('date', { ascending: false }).limit(300),
      ]);
      const byId = new Map<string, Party>();
      for (const s of (stks ?? []) as { stakeholder_id: string; name: string; type: string }[]) {
        byId.set(s.stakeholder_id, { id: s.stakeholder_id, name: s.name, type: s.type });
      }
      const order: Party[] = [];
      for (const r of (recent ?? []) as { stakeholder_id: string; total_amount: number; payment_mode: string; txn_allocations: { project_id: string }[] }[]) {
        const p = byId.get(r.stakeholder_id);
        if (!p || p.last !== undefined) continue;
        p.last = Number(r.total_amount) || 0;
        p.site = r.txn_allocations?.[0]?.project_id ?? '';
        p.via = (VIA as string[]).includes(r.payment_mode) ? (r.payment_mode as PayMode) : 'UPI';
        order.push(p);                                   // most payments go to someone you already pay
      }
      return [...order, ...[...byId.values()].filter((p) => p.last === undefined)];
    },
  });
  const { data: sites = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['txc_sites'],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('project_id, name').order('name');
      return ((data ?? []) as { project_id: string; name: string }[]).map((p) => ({ id: p.project_id, name: p.name }));
    },
  });
  const siteName = useCallback((id: string) => sites.find((s) => s.id === id)?.name ?? '', [sites]);

  // ── step 1: search ──
  const [q, setQ] = useState('');
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? parties.filter((p) => p.name.toLowerCase().includes(needle)) : parties.filter((p) => p.last !== undefined);
  }, [parties, q]);
  const exact = parties.some((p) => p.name.toLowerCase() === q.trim().toLowerCase());

  const choose = (p: Party | null, name?: string) => {
    buzz(6); setQ(''); setBack(false);
    (document.activeElement as HTMLElement | null)?.blur();
    if (p) {
      onDraft({
        ...T, partyId: p.id, party: p.name, partyType: p.type, step: 2, open: '',
        ...(p.site ? { site: p.site, siteName: siteName(p.site), via: p.via ?? T.via, hinted: true } : { site: '', siteName: '', hinted: false }),
      });
    } else {
      onDraft({ ...T, partyId: '', party: name ?? '', partyType: '', step: 2, open: '', site: '', siteName: '', hinted: false });
    }
  };

  // ── step 2: our own keypad, so the panel never jumps for a keyboard ──
  const [tick, setTick] = useState(0);
  const amtN = parseInt(T.amt || '0', 10);
  const press = (k: string) => {
    if (k === 'go') { if (amtN > 0) { buzz(8); setBack(false); set({ step: 3, open: T.site ? '' : 'site' }); } return; }
    let amt = T.amt;
    if (k === 'del') amt = amt.slice(0, -1);
    else if (k === '000') { if (amt && (amt + '000').length <= 9) amt += '000'; }
    else if ((amt + k).length <= 9) amt = (amt === '' && k === '0') ? '' : amt + k;
    buzz(3); setTick((n) => n + 1); set({ amt });
  };
  useEffect(() => {
    if (!open || T.step !== 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Enter') press('go');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // ── step 3: the line you opened comes to the top of the slip, never under the button ──
  const [changed, setChanged] = useState('');
  useLayoutEffect(() => {
    const sl = slipRef.current, r = sl?.querySelector<HTMLElement>('.rowS.open');
    if (!sl || !r) return;
    const pk = r.nextElementSibling as HTMLElement | null;
    const top = r.offsetTop;
    const bottom = (pk?.classList.contains('pick') ? pk.offsetTop + pk.offsetHeight : top + r.offsetHeight) + 6;
    let y = sl.scrollTop;
    if (bottom > y + sl.clientHeight) y = bottom - sl.clientHeight;   // only as far as needed
    if (top < y) y = top;
    if (y !== sl.scrollTop) sl.scrollTo({ top: y, behavior: calm ? 'auto' : 'smooth' });
  }, [T.open, calm]);
  const row = (key: string, patch: Partial<TxDraft>) => { buzz(4); setChanged(key); onDraft({ ...T, ...patch, open: '' }); };

  // ── filing ──
  const file = () => {
    if (!T.site) { set({ open: 'site' }); return; }
    onClose(false);
    void doFile(T);
  };
  /** The save itself, over the draft it was given — so a retry files exactly what was typed. */
  const doFile = async (d: TxDraft) => {
    navAction.working('Filing');
    try {
      const txnId = genTxnId();
      const upload = async (f: File | null, folder: string) => {
        if (!f) return null;
        const name = `${txnId}-${folder}-${Date.now()}.${f.name.split('.').pop()}`;
        const { error } = await supabase.storage.from('documents').upload(`${folder}/${name}`, f);
        if (error) throw error;
        return supabase.storage.from('documents').getPublicUrl(`${folder}/${name}`).data.publicUrl;
      };
      const [bill_doc_url, proof_document_url] = await Promise.all([upload(d.bill, 'bills'), upload(d.proof, 'proofs')]);
      let stakeholder_id = d.partyId;
      if (!stakeholder_id && d.party.trim()) {                      // "Add “…”" — a party is made, then paid
        const { data, error } = await supabase.from('stakeholders').insert([{
          stakeholder_id: genStkId(), name: d.party.trim(),
          type: d.dir === 'in' ? 'Client' : 'Vendor', category: 'General', org_id: orgId,
        }]).select().single();
        if (error) throw error;
        stakeholder_id = (data as { stakeholder_id: string }).stakeholder_id;
        qc.invalidateQueries({ queryKey: ['stakeholders'] });
      }
      const isIn = d.dir === 'in';
      const payload = {
        txn_id: txnId, stakeholder_id: stakeholder_id || null, date: d.date, total_amount: amountOf(d),
        payment_mode: d.via, category: isIn ? 'CLIENT-RECEIPT' : '', remarks: d.note.trim(),
        bill_doc_url, proof_document_url, ai_flag_status: 'Clean',
        ai_flag_data: isIn ? { type: 'client_receipt' } : {}, org_id: orgId,
      };
      const allocations = [{ project_id: d.site, order_type: null, order_ref: null, milestone_id: null, allocated_amount: amountOf(d) }];
      const { error } = await supabase.rpc('insert_transaction_with_allocations', { p_txn: payload, p_allocations: allocations });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['ledger'] });
      qc.invalidateQueries({ queryKey: ['txc_parties'] });
      navAction.done(`Filed ₹${fmt(d.amt)}`);
      onDraft(null);
    } catch (e) {
      // never pretends to have tried: offline is hollow at once, and settles into "Resume draft"
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { navAction.offline('Offline · kept as draft', () => onDraft({ ...d })); return; }
      navAction.failed("Couldn't file · Retry", () => void doFile(d));   // a tap retries, nothing typed is lost
      console.error('[TxComposer] file failed', e);
    }
  };
  const amountOf = (d: TxDraft) => parseInt(d.amt || '0', 10);

  // ── close: Escape, and a pull on the grab handle ──
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(true); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);
  const drag = useRef({ y0: 0, dy: 0, on: false });
  const dragStart = (e: React.TouchEvent) => { const el = panelRef.current; if (!el) return; drag.current = { y0: e.touches[0].clientY, dy: 0, on: true }; el.style.transition = 'none'; };
  const dragMove = (e: React.TouchEvent) => { const el = panelRef.current; if (!el || !drag.current.on) return; drag.current.dy = Math.max(0, e.touches[0].clientY - drag.current.y0); el.style.transform = `translateY(${drag.current.dy * 0.8}px)`; };
  const dragEnd = () => { const el = panelRef.current; if (!el || !drag.current.on) return; drag.current.on = false; el.style.transition = ''; el.style.transform = ''; if (drag.current.dy > 70) onClose(true); };

  // the body slides in from the right going forward, from the left coming back
  useEffect(() => { const b = bodyRef.current; if (!b) return; b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; }, [T.step]);

  const goStep = (n: 1 | 2 | 3) => { setBack(n < T.step); set({ step: n, open: '' }); };
  const height = T.step === 3 ? (T.open ? 548 : 506) : 548;

  const dots = [1, 2, 3].map((i) => <i key={i} className={i < T.step ? 'was' : i === T.step ? 'now' : ''} />);
  const title = T.step === 1
    ? (T.dir === 'out' ? 'Who are you paying?' : 'Who paid you?')
    : T.step === 2
      ? <>{T.dir === 'out' ? 'How much to ' : 'How much from '}<button type="button" onClick={() => goStep(1)}>{T.party}</button>?</>
      : <><button type="button" onClick={() => goStep(2)}>₹{fmt(T.amt)}</button> {T.dir === 'out' ? 'to ' : 'from '}<button type="button" onClick={() => goStep(1)}>{T.party}</button></>;

  const slipRow = (key: string, label: string, value: string, o: { none?: boolean; mono?: boolean; pick: React.ReactNode }) => (
    <div key={key}>
      <button type="button" className={`rowS${T.open === key ? ' open' : ''}`} aria-expanded={T.open === key}
        onClick={() => { buzz(3); set({ open: T.open === key ? '' : key }); }}>
        <span className="l">{label}</span>
        <span className={`v${o.none ? ' none' : ''}${o.mono ? ' mono' : ''}${changed === key ? ' chg' : ''}`}>{value}</span>
        {CHEV}
      </button>
      {T.open === key && <div className="pick">{o.pick}</div>}
    </div>
  );
  const opt = (list: string[], cur: string, on: (x: string) => void) => list.map((x) => (
    <button key={x} type="button" className="opt" aria-pressed={x === cur} onClick={() => on(x)}><i />{x}</button>
  ));

  if (!open) return null;
  const docs = [T.bill && 'Bill', T.proof && 'Proof'].filter(Boolean) as string[];

  return (
    <>
      <div className="tx-scrim on" onClick={() => onClose(true)} />
      <section ref={panelRef} className="tx on" role="dialog" aria-modal="true" aria-label="New transaction"
        style={{ ['--h' as string]: `${height}px` } as React.CSSProperties}>
        <div className="grab" aria-hidden="true" onTouchStart={dragStart} onTouchMove={dragMove} onTouchEnd={dragEnd} onTouchCancel={dragEnd}><i /></div>
        <div className="tx-head">
          <button type="button" className="ico" aria-label={T.step === 1 ? 'Close' : 'Back'}
            onClick={() => (T.step === 1 ? onClose(true) : goStep((T.step - 1) as 1 | 2))}>
            <svg viewBox="0 0 24 24" aria-hidden="true">{T.step === 1 ? CROSS : ARROW}</svg>
          </button>
          <h2>{title}</h2>
          <div className="steps" aria-hidden="true">{dots}</div>
        </div>

        <div ref={bodyRef} className={`tx-body s${T.step}${back ? ' back' : ''}`}>
          {T.step === 1 && (
            <>
              <label className="find">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
                <input type="text" autoComplete="off" autoCapitalize="words" enterKeyHint="search"
                  placeholder="Search or add a party" aria-label="Search or add a party"
                  value={q} onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (matches[0]) choose(matches[0]); else if (q.trim()) choose(null, q.trim()); } }} />
              </label>
              <div className="caprow">
                <small className="cap">{q ? (matches.length ? 'Matches' : 'No one by that name yet') : 'Recent · last paid'}</small>
                <button type="button" className={`dir${T.dir === 'in' ? ' in' : ''}`} onClick={() => set({ dir: T.dir === 'out' ? 'in' : 'out' })}>
                  <span>{T.dir === 'out' ? 'Money out' : 'Money in'}</span>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg>
                </button>
              </div>
              <div className="people">
                {matches.slice(0, 8).map((p) => (
                  <button key={p.id} type="button" className="who" onClick={() => choose(p)}>
                    <i className="av2">{initials(p.name)}</i><b>{p.name}</b>
                    {p.last !== undefined && <em>₹{p.last.toLocaleString('en-IN')}</em>}
                  </button>
                ))}
                {q.trim() && !exact && (
                  <button type="button" className="who add" onClick={() => choose(null, q.trim())}>
                    <i className="av2">+</i><b>Add “{q.trim()}”</b><em>new party</em>
                  </button>
                )}
              </div>
            </>
          )}

          {T.step === 2 && (() => {
            const last = parties.find((p) => p.id === T.partyId)?.last;
            return (
              <>
                <div className="amt2">
                  <div className="line">
                    <div className={`fig${(T.amt || '').length > 7 ? ' long' : ''}${tick ? ' tick' : ''}`} key={tick}>
                      <span>₹</span><b className={T.amt ? '' : 'zero'}>{fmt(T.amt)}</b>
                    </div>
                    <button type="button" className="del" aria-label="Delete" disabled={!T.amt} onClick={() => press('del')}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h10a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 19 19H9l-6-7 6-7Z" /><path d="m12 9.5 5 5M17 9.5l-5 5" /></svg>
                    </button>
                  </div>
                  <p>{amtN ? words(amtN) + ' rupees' : 'Only the number. The rest is already filled in.'}</p>
                  {last !== undefined && <button type="button" className="last" onClick={() => { buzz(6); setTick((n) => n + 1); set({ amt: String(last) }); }}>Same as last time · ₹{last.toLocaleString('en-IN')}</button>}
                </div>
                <div className="pad3" onPointerDown={(e) => {
                  const k = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-k]');
                  if (!k || k.disabled) return;
                  e.preventDefault(); k.classList.add('hit'); setTimeout(() => k.classList.remove('hit'), 110); press(k.dataset.k!);
                }}>
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0'].map((k) => (
                    <button key={k} type="button" className={`k3${k === '000' ? ' z' : ''}`} data-k={k}>{k}</button>
                  ))}
                  <button type="button" className="k3 go" data-k="go" disabled={!(amtN > 0)}>
                    Next<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                  </button>
                </div>
              </>
            );
          })()}

          {T.step === 3 && (
            <>
              <p className="why">{T.hinted ? `Filled in from your last payment to ${T.party}. Tap a line only if it is different.` : (T.site ? 'Tap a line to change it.' : 'One thing to pick: the site.')}</p>
              <div className="slip" ref={slipRef}>
                {slipRow('site', 'Site', T.site ? T.siteName : 'Choose', {
                  none: !T.site,
                  pick: opt(sites.map((s) => s.name), T.siteName, (name) => { const s = sites.find((x) => x.name === name)!; row('site', { site: s.id, siteName: s.name, hinted: false }); }),
                })}
                {slipRow('via', 'Paid via', T.via, {
                  pick: <div className="seg">{VIA.map((x) => <button key={x} type="button" aria-pressed={x === T.via} onClick={() => row('via', { via: x, hinted: false })}>{x}</button>)}</div>,
                })}
                {slipRow('date', 'Date', T.dateWord === 'Earlier' ? new Date(T.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : T.dateWord, {
                  pick: (
                    <div className="chips">
                      <button type="button" className="chip2" aria-pressed={T.dateWord === 'Today'} onClick={() => row('date', { dateWord: 'Today', date: today() })}>Today</button>
                      <button type="button" className="chip2" aria-pressed={T.dateWord === 'Yesterday'} onClick={() => row('date', { dateWord: 'Yesterday', date: shift(1) })}>Yesterday</button>
                      <label className="chip2 as-label" aria-pressed={T.dateWord === 'Earlier'}>Earlier
                        <input type="date" max={today()} value={T.date} onChange={(e) => e.target.value && row('date', { dateWord: 'Earlier', date: e.target.value })} />
                      </label>
                    </div>
                  ),
                })}
                {slipRow('note', 'Note', T.note || 'Add', {
                  pick: <input className="note" type="text" autoComplete="off" enterKeyHint="done" placeholder="What is it for?" aria-label="What is it for?"
                    autoFocus value={T.note} onChange={(e) => set({ note: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') set({ open: '' }); }} />,
                })}
                {slipRow('docs', 'Bill, proof', docs.length ? docs.join(' and ') + ' added' : 'Add', {
                  pick: (
                    <div className="extras">
                      {([['bill', 'Bill'], ['proof', 'Payment proof']] as const).map(([k, l]) => (
                        <label key={k} className={`xtra${T[k] ? ' has' : ''}`}>
                          {CAM}<span>{T[k] ? l + ' added' : l}</span>
                          <input type="file" accept="image/*,application/pdf" aria-label={`Add ${l.toLowerCase()}`}
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) { buzz(6); set({ [k]: f } as Partial<TxDraft>); } }} />
                        </label>
                      ))}
                    </div>
                  ),
                })}
              </div>
              <div className="file">
                <button type="button" className="btnF" onClick={file}>File it</button>
                <button type="button" className="all" onClick={() => {
                  onClose(false); onDraft(null);
                  navigate('/ledger/new', { state: { direction: T.dir, stakeholderId: T.partyId || undefined, stakeholderName: T.party || undefined } });
                }}>Split across projects, and more</button>
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}

