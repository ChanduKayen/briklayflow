/**
 * BillComposer — "Add a bill", ported from the reference prototype
 * (claude.ai/artifact/NWiS9bYDvcRRDWMQo4K4Ps) value for value.
 *
 * Same panel as the transaction composer, same three dots: capture → read → check.
 *   capture     camera first. Or a file. Or the truth about this product: forward it on WhatsApp and
 *               it files itself.
 *   read        the bill itself is on screen while a ledger rule passes over it; each field arrives
 *               as it is read, not all at once.
 *   check       the same slip. What was read is filled in. What the reader was unsure of carries a
 *               hollow clay ring and asks to be checked — and the photo stays one tap away, because
 *               you check a bill against the bill.
 *   same bill   one shake, and the two bills side by side: keep one. Never a silent double entry.
 *   unreadable  says so, and offers the two honest exits: retake, or type it.
 *
 * It reads and commits through the app's own pipeline — extractBill for the read, findDuplicateBill
 * for the collision, intakeCommit for the write — so a bill added from here and one added from the
 * Bills page are the same record, deduped by the same fingerprint.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useOrgId, useAuth } from '../../lib/auth/AuthProvider';
import { useSnackbar } from '../Snackbar';
import { extractBill, findDuplicateBill, type ExtractedBill } from '../../lib/billsApi';
import { intakeCommit } from '../../lib/billIntake';
import { searchPayees } from '../../lib/payeeSearch';
import { navAction } from './navAction';
import { useSheetDrag } from '../../lib/sheetDrag';
import { fmt, initials, type BillState } from './txDraft';
import { unsureOf } from './billUnsure';
import { useSheetFlag } from '../../lib/sheetFlag';

const CHEV = <svg className="c" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>;
const CAM = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.2-2h6.6l1.2 2h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z" /><circle cx="12" cy="13" r="3.2" /></svg>;
const FILE = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7l4 4v13H7v-17Z" /><path d="M14 3.5v4h4" /></svg>;

/** A stand-in sheet for a PDF, or for a photo whose object URL has gone. */
const SHEET = (
  <svg className="sheet" viewBox="0 0 128 176" aria-hidden="true">
    <rect width="128" height="176" fill="#F4EFE6" />
    <rect x="14" y="14" width="56" height="7" rx="2" fill="#2B211A" opacity=".8" />
    <rect x="14" y="26" width="38" height="4" rx="2" fill="#2B211A" opacity=".35" />
    <rect x="86" y="14" width="28" height="16" rx="3" fill="#B5472A" opacity=".75" />
    {[48, 60, 72, 84, 96, 108, 120].map((y, i) => (
      <g key={y}>
        <rect x="14" y={y} width={52 + (i * 13) % 24} height="3.5" rx="1.75" fill="#2B211A" opacity=".3" />
        <rect x="92" y={y} width="22" height="3.5" rx="1.75" fill="#2B211A" opacity=".3" />
      </g>
    ))}
    <path d="M14 134h100" stroke="#2B211A" strokeOpacity=".25" strokeDasharray="3 3" />
    <rect x="14" y="144" width="30" height="5" rx="2" fill="#2B211A" opacity=".5" />
    <rect x="80" y="142" width="34" height="8" rx="2" fill="#2B211A" opacity=".85" />
  </svg>
);

const READ_ROWS: [keyof BillState['f'], string][] = [['vendor', 'Vendor'], ['no', 'Bill no.'], ['date', 'Bill date'], ['amount', 'Amount']];
const shownDate = (iso: string) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export function BillComposer({ bill, onBill, onClose, lock = null, onFiled }: {
  bill: BillState | null;
  onBill: (b: BillState | null) => void;
  onClose: (keep: boolean) => void;
  /** A door that already knows who is billing, and for which site, says so instead of asking — a
   *  payment being pointed at the bill it settles knows both. The read still fills the number, the
   *  date and the amount; it may not change the party or the site, or the bill would file itself
   *  away from the payment that opened this. */
  lock?: { vendorId: string; vendorName: string; projectId: string; projectName: string } | null;
  /** The bill that was just filed — for a caller that has something to do with it. */
  onFiled?: (billId: string) => void;
}) {
  const orgId = useOrgId();
  const { userId } = useAuth();
  const qc = useQueryClient();
  const { show } = useSnackbar();
  const open = !!bill;
  useSheetFlag(open);   // the page's dark headers step aside while the card is up
  const B = bill;

  const slipRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const seq = useRef(0);               // which read is the live one: a retake must not be overtaken

  const buzz = (ms: number | number[] = 6) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };
  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const set = useCallback((patch: Partial<BillState>) => { onBill(B ? { ...B, ...patch } : null); }, [B, onBill]);
  // What a fresh state starts as: empty, or already knowing the party and the site.
  const seed = useMemo(() => ({
    vendorId: lock?.vendorId ?? '',
    vendor: lock?.vendorName ?? '',
    site: lock?.projectId ?? '',
    siteName: lock?.projectName ?? '',
  }), [lock]);

  const { data: sites = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['txc_sites'], enabled: open, staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('project_id, name').order('name');
      return ((data ?? []) as { project_id: string; name: string }[]).map((p) => ({ id: p.project_id, name: p.name }));
    },
  });
  const { data: vendors = [] } = useQuery<{ stakeholder_id: string; name: string; aliases?: string[] }[]>({
    queryKey: ['bc_vendors'], enabled: open, staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from('stakeholders').select('stakeholder_id, name, aliases').eq('type', 'Vendor').is('merged_into', null).order('name');
      return (data ?? []) as { stakeholder_id: string; name: string; aliases?: string[] }[];
    },
  });
  const { data: profile } = useQuery<{ full_name?: string; name?: string } | null>({
    queryKey: ['profile', userId ?? ''], enabled: !!userId && open,
    queryFn: async () => (await supabase.from('user_profiles').select('*').eq('id', userId!).maybeSingle()).data as { full_name?: string } | null,
  });

  // ── the read ──
  const readNow = useCallback(async (file: File) => {
    const mine = ++seq.current;
    const url = file.type.startsWith('image/') ? URL.createObjectURL(file) : '';
    onBill({
      stage: 'reading', file, img: url, vendorId: seed.vendorId, lines: [], unsure: [], openRow: '', dupe: null, kept: false, viewer: false,
      f: { vendor: seed.vendor, no: '', date: '', amount: '', site: seed.site, siteName: seed.siteName }, got: [],
    });
    try {
      const read: ExtractedBill = await extractBill(file);
      if (seq.current !== mine) return;
      const f = {
        vendor: lock ? seed.vendor : read.vendor ?? '', no: read.billNo ?? '', date: read.billDate ?? '',
        amount: read.amount ? String(Math.round(read.amount)) : '', site: seed.site, siteName: seed.siteName,
      };
      // link the party the header names, the way every other door does
      const hit = read.vendor ? (searchPayees(vendors as never, read.vendor)[0] as { stakeholder_id?: string; name?: string } | undefined) : undefined;
      const dupe = await findDuplicateBill({ orgId, billNo: f.no, amount: Number(f.amount || 0), billDate: f.date || null, vendorName: f.vendor || null });
      if (seq.current !== mine) return;
      if (dupe) buzz([10, 40, 10]);
      onBill({
        stage: 'check', file, img: url, vendorId: lock ? seed.vendorId : hit?.stakeholder_id ?? '', lines: read.lines,
        unsure: unsureOf(f).filter((k) => !(lock && (k === 'vendor' || k === 'site'))), openRow: '', dupe, kept: false, viewer: false,
        f: { ...f, vendor: lock ? seed.vendor : hit?.name ?? f.vendor }, got: [],
      });
    } catch {
      if (seq.current !== mine) return;
      buzz([10, 40, 10]);
      onBill({
        stage: 'bad', file, img: url, vendorId: seed.vendorId, lines: [], unsure: [], openRow: '', dupe: null, kept: false, viewer: false,
        f: { vendor: seed.vendor, no: '', date: '', amount: '', site: seed.site, siteName: seed.siteName }, got: [],
      });
    }
  }, [onBill, orgId, vendors, lock, seed]);

  // each field arrives as it is read, not all at once
  useEffect(() => {
    if (!B || B.stage !== 'check' || B.got.length >= READ_ROWS.length) return;
    const t = setTimeout(() => { if (B.got.length < READ_ROWS.length) { buzz(3); onBill({ ...B, got: [...B.got, READ_ROWS[B.got.length][0]] }); } }, B.got.length ? 170 : 40);
    return () => clearTimeout(t);
  }, [B, onBill]);

  // the line you opened comes to the top of the slip, never under the button
  useLayoutEffect(() => {
    const sl = slipRef.current, r = sl?.querySelector<HTMLElement>('.rowS.open');
    if (!sl || !r) return;
    const pk = r.nextElementSibling as HTMLElement | null;
    const top = r.offsetTop;
    const bottom = (pk?.classList.contains('pick') ? pk.offsetTop + pk.offsetHeight : top + r.offsetHeight) + 6;
    let y = sl.scrollTop;
    if (bottom > y + sl.clientHeight) y = bottom - sl.clientHeight;
    if (top < y) y = top;
    if (y !== sl.scrollTop) sl.scrollTo({ top: y, behavior: calm ? 'auto' : 'smooth' });
  }, [B?.openRow, calm]);

  useEffect(() => { const b = bodyRef.current; if (!b) return; b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; }, [B?.stage]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key !== 'Escape') return; if (B?.viewer) set({ viewer: false }); else onClose(true); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose, B?.viewer, set]);

  // Pull it down to put it away — from anywhere on the sheet, not just the handle (sheetDrag).
  const panelDrag = useSheetDrag<HTMLElement>(() => onClose(B?.stage === 'check'), open);

  // ── the write ──
  const save = (d: BillState) => {
    if (!d.f.site) { onBill({ ...d, openRow: 'site' }); show('Pick the site first'); return; }
    if (!d.vendorId) { onBill({ ...d, openRow: 'vendor' }); show('Say who billed you'); return; }
    onClose(false);
    void commit(d, d.kept);        // the pipeline fingerprints it again; only "it's different" waives that
  };
  const commit = async (d: BillState, allowDuplicate: boolean) => {
    navAction.working('Saving');
    try {
      const extracted: ExtractedBill = {
        vendor: d.f.vendor.trim() || null, billNo: d.f.no.trim() || null, billDate: d.f.date || null,
        amount: parseInt(d.f.amount || '0', 10), lines: d.lines,
      };
      const who = profile ?? undefined;
      const res = await intakeCommit(
        { orgId, source: 'bills_page', file: d.file, vendorId: d.vendorId, projectId: d.f.site || null,
          createdBy: null, createdByName: who?.full_name ?? who?.name ?? null },
        extracted, d.vendorId, { allowDuplicate },
      );
      if (res.status === 'duplicate') {           // never a silent double entry: bring it back and show both
        navAction.reset();
        onBill({ ...d, stage: 'check', dupe: res.existing, openRow: '' });
        buzz([10, 40, 10]);
        return;
      }
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['party_ledger'] });
      qc.invalidateQueries({ queryKey: ['party_topay_map'] });
      navAction.done(`Saved ₹${fmt(d.f.amount)}`);
      if (res.status === 'minted') onFiled?.(res.billId);
      onBill(null);
    } catch (e) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { navAction.offline('Offline · kept as draft', () => onBill({ ...d })); return; }
      navAction.failed("Couldn't save · Retry", () => void commit(d, allowDuplicate));
      console.error('[BillComposer] save failed', e);
    }
  };

  const height = B?.stage === 'capture' ? 424 : B?.stage === 'reading' ? 376 : B?.stage === 'bad' ? 420 : 548;
  const step = B?.stage === 'capture' ? 1 : B?.stage === 'reading' || B?.stage === 'bad' ? 2 : 3;
  const img = B?.img ?? '';
  const paper = useMemo(() => (img ? <img alt="" src={img} /> : SHEET), [img]);

  const slipRow = (key: string, label: string, value: string, o: { none?: boolean; mono?: boolean; pick: React.ReactNode }) => {
    if (!B) return null;
    const unsure = B.unsure.includes(key);
    const on = B.openRow === key;
    return (
      <div key={key}>
        <button type="button" className={`rowS${on ? ' open' : ''}${unsure ? ' unsure' : ''}`} aria-expanded={on}
          onClick={() => { buzz(3); set({ openRow: on ? '' : key }); }}>
          <span className="l">{unsure && <i className="ring" aria-label="Check this" />}{label}</span>
          <span className={`v${o.none ? ' none' : ''}${o.mono ? ' mono' : ''}`}>{value}</span>
          {CHEV}
        </button>
        {on && <div className="pick">{o.pick}</div>}
      </div>
    );
  };
  /** An edited field is a checked field: the ring goes when you touch it. */
  const edit = (key: 'vendor' | 'no' | 'date' | 'amount', v: string) => {
    if (!B) return;
    set({ f: { ...B.f, [key]: key === 'amount' ? v.replace(/\D/g, '') : v }, unsure: B.unsure.filter((x) => x !== key) });
  };
  const field = (key: 'no' | 'date' | 'amount', mode?: string) => B && (
    <>
      <input className="note" type={key === 'date' ? 'date' : 'text'} inputMode={mode as never} autoComplete="off" enterKeyHint="done"
        value={B.f[key]} aria-label="Edit" autoFocus={key !== 'date'}
        onChange={(e) => edit(key, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') set({ openRow: '' }); }} />
      {B.unsure.includes(key) && <button type="button" className="ok" onClick={() => { buzz(4); set({ unsure: B.unsure.filter((x) => x !== key), openRow: '' }); }}>It&rsquo;s right</button>}
    </>
  );

  if (!B) return null;
  const left = B.unsure.length;

  return (
    <>
      <div className="tx-scrim on" onClick={() => onClose(true)} />
      <section ref={panelDrag} className="tx on" role="dialog" aria-modal="true" aria-label="Add a bill"
        style={{ ['--h' as string]: `${height}px` } as React.CSSProperties}>
        <div className="grab" aria-hidden="true"><i /></div>
        <div className="tx-head">
          <button type="button" className="ico" aria-label={B.stage === 'reading' || B.stage === 'bad' ? 'Back' : 'Close'}
            onClick={() => (B.stage === 'reading' || B.stage === 'bad' ? (seq.current++, onBill({ ...B, stage: 'capture', file: null, img: '' })) : onClose(B.stage === 'check'))}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {B.stage === 'reading' || B.stage === 'bad' ? <path d="M15 5l-7 7 7 7" /> : <path d="M6 6l12 12M18 6 6 18" />}
            </svg>
          </button>
          <h2>{B.stage === 'reading' ? <><i className="livedot" />Reading the bill</> : B.dupe ? 'You may have this bill' : B.stage === 'check' ? 'Check the bill' : 'Add a bill'}</h2>
          <div className="steps" aria-hidden="true">{[1, 2, 3].map((i) => <i key={i} className={i < step ? 'was' : i === step ? 'now' : ''} />)}</div>
        </div>

        <div ref={bodyRef} className={`tx-body s${step === 3 ? 3 : 1}`}>
          {B.stage === 'capture' && (
            <>
              <div className="capl">
                <label className="rowC main">
                  <i className="ic">{CAM}</i>
                  <span className="tt"><b>Take a photo</b><span>Lay it flat, fill the frame</span></span>{CHEV}
                  <input type="file" accept="image/*" capture="environment" aria-label="Take a photo of the bill"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) { buzz(6); void readNow(f); } }} />
                </label>
                <label className="rowC">
                  <i className="ic">{FILE}</i>
                  <span className="tt"><b>Choose a photo or PDF</b><span>From this phone</span></span>{CHEV}
                  <input type="file" accept="image/*,application/pdf" aria-label="Choose a bill file"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) { buzz(6); void readNow(f); } }} />
                </label>
              </div>
              <button type="button" className="manLink" onClick={() => {
                buzz(4);
                onBill({
                  stage: 'check', file: null, img: '', vendorId: seed.vendorId, lines: [],
                  unsure: (['vendor', 'no', 'date', 'amount'] as string[]).filter((k) => !(lock && k === 'vendor')),
                  openRow: lock ? 'amount' : 'vendor', dupe: null, kept: false, viewer: false,
                  f: { vendor: seed.vendor, no: '', date: '', amount: '', site: seed.site, siteName: seed.siteName }, got: READ_ROWS.map(([k]) => k),
                });
              }}>or enter it manually</button>
              <p className="waLine">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.6-1.2A9 9 0 1 0 12 3Z" /></svg>
                <span>Or forward the bill to Briklay on WhatsApp. It reads it and files it here by itself.</span>
              </p>
            </>
          )}

          {B.stage === 'reading' && (
            <div className="reading">
              <div className="paper">{paper}<div className="scan" /></div>
              <div className="got">
                {READ_ROWS.map(([, label]) => <div key={label}><small>{label}</small><i style={{ width: label === 'Vendor' ? '90%' : '60%' }} /></div>)}
              </div>
            </div>
          )}

          {B.stage === 'bad' && (
            <>
              <div className="sorry">
                <i className="hol" />
                <h3>Couldn&rsquo;t read this one</h3>
                <p>The photo is blurred or part of the bill is cut off. Nothing has been saved.</p>
              </div>
              <div className="file two">
                <button type="button" className="ghostF" onClick={() => onBill({ ...B, stage: 'check', unsure: ['vendor', 'no', 'date', 'amount'], openRow: 'vendor', got: READ_ROWS.map(([k]) => k) })}>Type it in</button>
                <button type="button" className="btnF" onClick={() => { seq.current++; onBill({ ...B, stage: 'capture', file: null, img: '' }); }}>Retake</button>
              </div>
            </>
          )}

          {B.stage === 'check' && (
            <>
              <div className="billtop">
                <button type="button" className="thumb" aria-label="See the bill" onClick={() => set({ viewer: true })}>{paper}</button>
                <div className="t">
                  <b><span>₹</span>{fmt(B.f.amount)}</b>
                  <em>{B.f.vendor || 'Vendor'}{B.vendorId ? ' · existing party' : ''}</em>
                </div>
              </div>

              {B.dupe && (
                <div className="dupe">
                  <h3>Same vendor, same number, same amount</h3>
                  <p>Saving it again would count ₹{fmt(B.f.amount)} twice.</p>
                  <div className="pair">
                    <div><small>Already in Bills</small><b>₹{Math.round(B.dupe.amount).toLocaleString('en-IN')}</b><span>No. {B.dupe.billNo ?? '—'}</span><span>{B.dupe.billDate ? shownDate(B.dupe.billDate) : '—'}</span></div>
                    <div><small>This one</small><b>₹{fmt(B.f.amount)}</b><span>No. {B.f.no || '—'}</span><span>Just now · photo</span></div>
                  </div>
                </div>
              )}

              {!B.dupe && (
                <p className="why">
                  {left
                    ? `Read from the photo. ${left === 1 ? 'One line' : `${left} lines`} I'm not sure of: check ${left === 1 ? 'it' : 'them'} against the bill.`
                    : (B.f.site ? 'Read from the photo. Tap a line only if it is wrong.' : "Read from the photo. The site isn't on the bill: pick it.")}
                </p>
              )}

              {!B.dupe && (
                <div className="slip" ref={slipRef}>
                  {slipRow('vendor', 'Vendor', B.f.vendor || 'Choose', {
                    none: !B.f.vendor,
                    pick: (
                      <>
                        <input className="note" type="text" autoComplete="off" autoCapitalize="words" enterKeyHint="search" autoFocus
                          placeholder="Search vendors" aria-label="Search vendors" value={B.f.vendor}
                          onChange={(e) => set({ f: { ...B.f, vendor: e.target.value }, vendorId: '', unsure: B.unsure.filter((x) => x !== 'vendor') })} />
                        <div className="people" style={{ maxHeight: 190 }}>
                          {(B.f.vendor.trim() ? (searchPayees(vendors as never, B.f.vendor) as { stakeholder_id: string; name: string }[]) : vendors).slice(0, 8).map((v) => (
                            <button key={v.stakeholder_id} type="button" className="who"
                              onClick={() => { buzz(4); set({ vendorId: v.stakeholder_id, f: { ...B.f, vendor: v.name }, unsure: B.unsure.filter((x) => x !== 'vendor'), openRow: '' }); }}>
                              <i className="av2">{initials(v.name)}</i><b>{v.name}</b>
                            </button>
                          ))}
                        </div>
                      </>
                    ),
                  })}
                  {slipRow('no', 'Bill no.', B.f.no || 'Add', { mono: !!B.f.no, none: !B.f.no, pick: field('no') })}
                  {slipRow('date', 'Bill date', B.f.date ? shownDate(B.f.date) : 'Add', { none: !B.f.date, pick: field('date') })}
                  {slipRow('amount', 'Amount', B.f.amount ? `₹${fmt(B.f.amount)}` : 'Add', { mono: !!B.f.amount, none: !B.f.amount, pick: field('amount', 'numeric') })}
                  {slipRow('site', 'Site', B.f.site ? B.f.siteName : 'Choose', {
                    none: !B.f.site,
                    pick: sites.map((s) => (
                      <button key={s.id} type="button" className="opt" aria-pressed={s.id === B.f.site}
                        onClick={() => { buzz(4); set({ f: { ...B.f, site: s.id, siteName: s.name }, openRow: '' }); }}><i />{s.name}</button>
                    )),
                  })}
                  {B.lines.length > 0 && slipRow('items', 'Items', `${B.lines.length} ${B.lines.length === 1 ? 'line' : 'lines'}`, {
                    pick: <div className="items">{B.lines.map((l, i) => (
                      <div key={i}><span>{l.name}{l.qty ? ` · ${l.qty}${l.unit ? ' ' + l.unit : ''} × ₹${Math.round(l.rate).toLocaleString('en-IN')}` : ''}</span><span>₹{Math.round(l.amount).toLocaleString('en-IN')}</span></div>
                    ))}</div>,
                  })}
                </div>
              )}

              {B.dupe ? (
                <div className="file two">
                  <button type="button" className="ghostF" onClick={() => { buzz(4); set({ dupe: null, kept: true, unsure: [...new Set([...B.unsure, 'no'])], openRow: 'no' }); show('Kept. Check the number before saving.'); }}>It&rsquo;s different</button>
                  <button type="button" className="btnF" onClick={() => { onClose(false); onBill(null); navAction.reset(); show('Discarded. The first one stays.'); }}>Same bill, discard</button>
                </div>
              ) : (
                <div className="file">
                  <button type="button" className="btnF" onClick={() => save(B)}>{left ? `Save · ${left} to check` : 'Save bill'}</button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {B.viewer && (
        <div className="viewer" role="dialog" aria-modal="true" aria-label="The bill" onClick={(e) => { if (e.target === e.currentTarget) set({ viewer: false }); }}>
          <div className="big">{paper}</div>
          <button type="button" aria-label="Close" onClick={() => set({ viewer: false })}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
      )}
    </>
  );
}
