/**
 * NEW BILL — the one door, wearing one face.
 *
 * Three places in the app record a vendor bill: the Bills page, a PO's "record the bill", and a
 * payment being attached to the paper it settles. They used to look like three different products —
 * an OS file picker, a form with boxed inputs, and a silent upload that filed a bill without ever
 * showing you what it had read.
 *
 * This is that moment, once: drop the paper and Briklay reads it, the fields ink themselves in with
 * a tick, and the footer says — before you commit — exactly what this does to what you owe.
 *
 * What it deliberately does NOT own is the write. Each door commits through its own path (the Bills
 * register mints through the intake pipeline; a PO also stamps its own row), so bringing them onto
 * one design cannot quietly move anyone's money. The modal reads, confirms and hands over a draft.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useOrgId } from '../../lib/auth/AuthProvider';
import { searchPayees } from '../../lib/payeeSearch';
import { extractBill, findDuplicateBill, type ExtractedBill, type DuplicateBill } from '../../lib/billsApi';
import { useIsMobile } from '../../lib/useIsMobile';
import { useSheetDrag } from '../../lib/sheetDrag';
import { NBX_CSS } from './nbxCss';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
// Half the vendors in this trade end in an s — Steels, Traders, Industries — and "Steels's balance"
// reads like a typo. Take the possessive the way it is written.
const poss = (n: string) => (/s$/i.test(n) ? `${n}\u2019` : `${n}\u2019s`);
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

// ── the reference's own date reader: type it any way, or pick it ───────────────────────────────────
// "19/9" · "19-09-26" · "19 sept" · "sept 19" · "today" · "yesterday" all resolve; a bare day/month with
// no year takes the most recent past occurrence; nothing in the future. Ported from the Add-bill design.
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad2 = (n: number) => String(n).padStart(2, '0');
const today0 = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const daysAgo = (n: number) => { const t = today0(); return new Date(t.getFullYear(), t.getMonth(), t.getDate() - n); };
const iso = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const shortDMY = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
const longDate = (d: Date) => `${DOW[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
const relDate = (d: Date) => { const n = Math.round((today0().getTime() - d.getTime()) / 864e5); return n === 0 ? 'today' : n === 1 ? 'yesterday' : (n > 1 && n < 7) ? `${n} days ago` : ''; };
type ParsedDate = { empty?: boolean; err?: boolean; future?: boolean; d?: Date };
function parseBillDate(t: string): ParsedDate {
  const s = (t || '').trim().toLowerCase();
  const T = today0();
  if (!s) return { empty: true };
  if (s === 'today' || s === 'tod') return { d: T };
  if (s === 'yesterday' || s === 'yday' || s === 'ydy') return { d: daysAgo(1) };
  const mabbr = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  let d: number | null = null, m: number | null = null, y: number | null = null, mm: RegExpMatchArray | null;
  mm = s.match(/^(\d{1,2})\s*[/\-.\s]\s*(\d{1,2})(?:\s*[/\-.\s]\s*(\d{2,4}))?$/);
  if (mm) { d = +mm[1]; m = +mm[2] - 1; y = mm[3] ? +mm[3] : null; }
  if (d === null) { mm = s.match(/^(\d{1,2})\s*([a-z]{3,})\.?,?\s*(\d{2,4})?$/); if (mm) { const i = mabbr.indexOf(mm[2].slice(0, 3)); if (i >= 0) { d = +mm[1]; m = i; y = mm[3] ? +mm[3] : null; } } }
  if (d === null) { mm = s.match(/^([a-z]{3,})\s*(\d{1,2}),?\s*(\d{2,4})?$/); if (mm) { const i = mabbr.indexOf(mm[1].slice(0, 3)); if (i >= 0) { d = +mm[2]; m = i; y = mm[3] ? +mm[3] : null; } } }
  if (d === null || m === null) return { err: true };
  if (y === null) { y = T.getFullYear(); if (new Date(y, m, d) > T) y -= 1; } else if (y < 100) y += 2000;
  const dt = new Date(y, m, d);
  if (dt.getMonth() !== m || dt.getDate() !== d) return { err: true };
  if (dt > T) return { future: true, d: dt };
  return { d: dt };
}
// ₹ grouping the Indian way, from a digits string.
const indianAmt = (v: string) => {
  const s = String(v || '').replace(/^0+(?=\d)/, '');
  if (!s) return '';
  if (s.length <= 3) return s;
  return s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3);
};

export interface BillDraft {
  file: File | null;
  vendorId: string; vendorName: string;
  billNo: string | null; billDate: string | null; amount: number;
  projectId: string | null;
  lines: ExtractedBill['lines'];
  allowDuplicate: boolean;
}

interface Vendor { stakeholder_id: string; name: string }

export interface NewBillModalProps {
  open: boolean;
  onClose: () => void;
  /** 'New bill' on the Bills page; a door with context names what it is doing instead. */
  title?: string;
  /** Doors that already know who is billing (a PO, a payment) show the party rather than ask. */
  lockVendor?: { id: string; name: string } | null;
  /** A pre-known site — the PO's project. Shown, not asked. The name is looked up if not given. */
  lockProject?: { id: string; name?: string } | null;
  /** A file the page already has in hand (dragged onto the Bills page): read it straight away. */
  initialFile?: File | null;
  /** Extraction the door has already done — skip straight to the confirmed form. */
  initialExtract?: ExtractedBill | null;
  /** Bills page multi-drop: how many more are waiting behind this one. */
  queueMore?: number;
  /** Offered when the same vendor + number is already on the books. */
  onOpenBill?: (billId: string) => void;
  /** What that offer is called. A door mid-payment reconciles rather than navigates. */
  openBillLabel?: string;
  /** The door's own write. Return a duplicate to surface it instead of closing. */
  commit: (d: BillDraft) => Promise<{ duplicate?: DuplicateBill } | void>;
  /** A door that opens on top of another overlay says how high to stack (default 120). */
  stackAbove?: number;
}

type Stage = 'pick' | 'reading' | 'form';
const READ_STEPS = ['Finding the vendor', 'Reading the number & date', 'Reading the amount'];

export default function NewBillModal(props: NewBillModalProps) {
  const { open } = props;
  const isMobile = useIsMobile();
  if (!open) return null;
  return <Modal {...props} isMobile={isMobile} />;
}

function Modal({
  onClose, title = 'New bill', lockVendor = null, lockProject = null, initialFile = null,
  initialExtract = null, queueMore = 0, onOpenBill, openBillLabel = 'Open it', commit, stackAbove, isMobile,
}: NewBillModalProps & { isMobile: boolean }) {
  const orgId = useOrgId();

  // Opens straight on the form (the reference's board 1) — the photo drop is an option inside it, not a
  // gate in front of it. A file the door arrives with still reads first.
  const [stage, setStage] = useState<Stage>(initialFile ? 'reading' : 'form');
  const [readStep, setReadStep] = useState(READ_STEPS[0]);
  const [readError, setReadError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(initialFile);
  const [over, setOver] = useState(false);

  // The vendor is settled in three ways and they must not fight: the door already knows it, the
  // reading guessed it, or the user picked it. So the pick is the only state — the guess is derived,
  // and the moment a key is pressed the guess stops applying.
  const [vendorPick, setVendorPick] = useState<{ id: string; name: string } | null>(lockVendor);
  const [vqTyped, setVqTyped] = useState<string | null>(null);
  const [taOpen, setTaOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdName, setCreatedName] = useState<string | null>(null);

  const [billNo, setBillNo] = useState(initialExtract?.billNo ?? '');
  // The date is free text the reference's reader parses; the calendar and the echo derive from it.
  const [dateText, setDateText] = useState(initialExtract?.billDate ? shortDMY(new Date(initialExtract.billDate + 'T00:00:00')) : '');
  const [calOpen, setCalOpen] = useState(false);
  const [calView, setCalView] = useState(() => { const t = today0(); return { y: t.getFullYear(), m: t.getMonth() }; });
  const [amount, setAmount] = useState(initialExtract?.amount ? String(Math.round(initialExtract.amount)) : '');
  const [projectId, setProjectId] = useState(lockProject?.id ?? '');
  const [lines, setLines] = useState<ExtractedBill['lines']>(initialExtract?.lines ?? []);
  const [inked, setInked] = useState<Record<string, boolean>>({});
  const [nudge, setNudge] = useState(false);   // Add pressed while something's missing → flag the gaps
  const pd = parseBillDate(dateText);
  const billDateISO = pd.d && !pd.future ? iso(pd.d) : null;

  const [dup, setDup] = useState<DuplicateBill | null>(null);
  const [dupAck, setDupAck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filed, setFiled] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const vendorRowRef = useRef<HTMLDivElement>(null);
  const sheetRef = useSheetDrag<HTMLDivElement>(onClose, isMobile);

  // ── the org's parties, and what each is already owed ─────────────────────────
  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ['bill_vendors'],
    queryFn: async () => ((await supabase.from('stakeholders').select('stakeholder_id, name, aliases').eq('type', 'Vendor').is('merged_into', null).order('name')).data ?? []) as Vendor[],
  });
  // v_party_balance is the single source the party ledger's own hero reads, so the number promised
  // here is the number the ledger will show a second later.
  const { data: dues = {} } = useQuery<Record<string, number>>({
    queryKey: ['party_topay_map'],
    queryFn: async () => {
      const { data } = await supabase.from('v_party_balance').select('stakeholder_id, to_pay');
      const m: Record<string, number> = {};
      (data ?? []).forEach((r: { stakeholder_id: string; to_pay: number | string }) => { m[r.stakeholder_id] = Number(r.to_pay) || 0; });
      return m;
    },
    staleTime: 30_000,
  });
  const { data: projects = [] } = useQuery<{ project_id: string; name: string }[]>({
    queryKey: ['projects_active_min'],
    queryFn: async () => ((await supabase.from('projects').select('project_id, name').eq('status', 'Active').order('name')).data ?? []) as { project_id: string; name: string }[],
  });
  const lockProjectName = lockProject ? (lockProject.name ?? projects.find(p => p.project_id === lockProject.id)?.name ?? 'This site') : '';

  // A bill read in the background arrives with a vendor NAME; match it to a real party here, where
  // the party list lives. Derived, not stored, so it can't outlive the name it came from.
  const guess = useMemo(() => {
    if (vendorPick || vqTyped !== null || !initialExtract?.vendor || !vendors.length) return null;
    const hit = searchPayees(vendors, initialExtract.vendor)[0];
    return hit ? { id: hit.stakeholder_id, name: hit.name } : null;
  }, [vendorPick, vqTyped, initialExtract, vendors]);

  const vendorId = vendorPick?.id ?? guess?.id ?? '';
  const amt = Number(amount.replace(/[^\d]/g, '')) || 0;
  const vendorName = vendorPick?.name ?? guess?.name ?? '';
  const vq = vqTyped ?? vendorPick?.name ?? guess?.name ?? initialExtract?.vendor ?? '';

  // ── reading the paper ────────────────────────────────────────────────────────
  const read = useCallback(async (f: File) => {
    setFile(f); setStage('reading'); setReadError(null); setReadStep(READ_STEPS[0]);
    try {
      // A stuck reader must surface as an error, not an endless "Reading the bill…".
      const ex = await Promise.race([
        extractBill(f),
        new Promise<never>((_, rej) => window.setTimeout(() => rej(new Error('Reading it took too long — the reader may be unavailable')), 60_000)),
      ]);
      setStage('form');
      // Each field inks itself in, in the order a person reads a bill.
      const ink = (k: string) => setInked(s => ({ ...s, [k]: true }));
      if (ex.vendor && !lockVendor) {
        const hit = searchPayees(vendors, ex.vendor)[0];
        if (hit) { setVendorPick({ id: hit.stakeholder_id, name: hit.name }); ink('vendor'); }
        else setVqTyped(ex.vendor);
      } else if (lockVendor) ink('vendor');
      setLines(ex.lines);
      window.setTimeout(() => { if (ex.billNo) { setBillNo(ex.billNo); ink('no'); } }, 260);
      window.setTimeout(() => { if (ex.billDate) { setDateText(shortDMY(new Date(ex.billDate + 'T00:00:00'))); ink('date'); } }, 480);
      window.setTimeout(() => { if (ex.amount) { setAmount(String(Math.round(ex.amount))); ink('amt'); } }, 700);
    } catch (e) {
      setStage('pick');
      setReadError((e as Error)?.message || 'Could not read that one');
    }
  }, [vendors, lockVendor]);

  // Read the file the page arrived with.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current || !initialFile) return;
    startedRef.current = true;
    void read(initialFile);
  }, [initialFile, read]);

  // Walk the reading steps while the extractor works; hold on the last one until it answers.
  useEffect(() => {
    if (stage !== 'reading') return;
    const t1 = window.setTimeout(() => setReadStep(READ_STEPS[1]), 1050);
    const t2 = window.setTimeout(() => setReadStep(READ_STEPS[2]), 2100);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [stage]);

  // ── the duplicate guard ──────────────────────────────────────────────────────
  useEffect(() => {
    const n = billNo.trim();
    let live = true;
    // Everything, including clearing a warning the edit has just invalidated, happens after the
    // keystrokes settle — so typing a number never fires a query per character. The fingerprint is
    // the DOCUMENT (number, or header name + amount + date), org-wide, so the same paper is caught
    // even when another door filed it under a different party — and before one is named here.
    const t = window.setTimeout(() => {
      if (!live) return;
      setDup(null); setDupAck(false);
      if (!orgId || (!n && !(amt > 0.5))) return;
      void findDuplicateBill({ orgId, billNo: n || null, amount: amt, billDate: billDateISO, vendorName: vendorName || vq || null })
        // A warning that can't be fetched must not become an unhandled rejection — or block filing.
        .then(d => { if (live) setDup(d); }, () => { /* no warning available */ });
    }, 260);
    return () => { live = false; window.clearTimeout(t); };
  }, [orgId, billNo, amt, billDateISO, vendorName, vq]);

  // Close the typeahead on an outside click, the way a menu is expected to behave.
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!vendorRowRef.current?.contains(e.target as Node)) setTaOpen(false); };
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (taOpen) setTaOpen(false); else onClose(); } };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [taOpen, onClose]);

  // ── the consequence, in money ────────────────────────────────────────────────
  const before = vendorId ? (dues[vendorId] ?? 0) : 0;
  const isNewParty = !!createdName && createdName === vendorName;

  const consequence = useMemo(() => {
    if (!vendorId && !amt) return <>A bill raises what you owe — drop it in and watch.</>;
    if (vendorId && !amt) return <>Billing <b>{vendorName}</b> — enter the amount.</>;
    if (!vendorId && amt) return <>{inr(amt)} — name the vendor and it lands on their ledger.</>;
    if (isNewParty) return <>Creates <b>{vendorName}</b> and opens their ledger at <b className="up">{inr(amt)} due</b></>;
    return <>{poss(vendorName)} balance: <b>{inr(before)}</b> → <b className="up">{inr(before + amt)} due</b></>;
  }, [vendorId, amt, vendorName, before, isNewParty]);

  const matches = useMemo(() => (vq.trim() ? searchPayees(vendors, vq).slice(0, 3) : vendors.slice(0, 3)), [vendors, vq]);

  // What the bill still needs, in the order a person fills it (site stays optional — a bill can be
  // unassigned). The date is required and must read as a real, non-future day.
  const missing: string[] = [];
  if (!vendorId) missing.push('vendor');
  if (!amt) missing.push('amount');
  if (!billDateISO) missing.push('date');
  const miss = (k: string) => nudge && missing.indexOf(k) >= 0;
  const dateBad = !!dateText.trim() && (pd.err || pd.future);
  const canSave = missing.length === 0 && (!dup || dupAck) && !saving && !filed;
  // the live status line the reference shows beside the button
  let statusText = '', statusTone: 'ok' | 'warn' | 'idle' = 'idle';
  if (dateBad) { statusText = 'Fix the bill date first'; statusTone = 'warn'; }
  else if (missing.length) { statusText = 'Still needed: ' + missing.join(' · '); statusTone = nudge ? 'warn' : 'idle'; }
  else { statusText = 'Ready · ' + inr(amt) + ' to ' + vendorName; statusTone = 'ok'; }

  // ── creating a party we have never billed before ─────────────────────────────
  const createVendor = async (name: string) => {
    const n = name.trim();
    if (!n || creating) return;
    setCreating(true);
    try {
      const { data, error } = await supabase.from('stakeholders')
        .insert([{ org_id: orgId, name: n, type: 'Vendor' }]).select('stakeholder_id, name').single();
      if (error) throw error;
      const v = data as Vendor;
      setVendorPick({ id: v.stakeholder_id, name: v.name }); setVqTyped(null); setCreatedName(v.name);
      setInked(s => ({ ...s, vendor: true })); setTaOpen(false);
    } catch (e) {
      setSaveError((e as Error)?.message || 'Could not create that party');
    } finally { setCreating(false); }
  };

  // ── file it ──────────────────────────────────────────────────────────────────
  const file_ = async () => {
    if (!canSave) { setNudge(true); return; }   // flag the gaps instead of failing silently
    setSaving(true); setSaveError(null);
    try {
      const res = await commit({
        file, vendorId, vendorName, projectId: projectId || null, lines,
        billNo: billNo.trim() || null, billDate: billDateISO, amount: amt,
        allowDuplicate: !!dup && dupAck,
      });
      if (res && 'duplicate' in res && res.duplicate) { setDup(res.duplicate); setDupAck(false); setSaving(false); return; }
      setFiled(true);
      window.setTimeout(() => { setLeaving(true); window.setTimeout(onClose, 400); }, 550);
    } catch (e) {
      setSaving(false);
      setSaveError((e as Error)?.message || 'Could not file the bill');
    }
  };

  const pick = (f: File | null | undefined) => { if (f) void read(f); };
  const rowCls = (k: string, filled: boolean) => `frow${filled ? ' filled' : ''}${inked[k] ? ' inked' : ''}`;

  // ── the date field's echo + calendar (the reference's boards 3 & 4) ──
  const onFormKey = (e: { key: string; preventDefault: () => void }) => { if (e.key === 'Enter') { e.preventDefault(); void file_(); } };
  const setDate = (d: Date) => { setDateText(shortDMY(d)); setCalOpen(false); setCalView({ y: d.getFullYear(), m: d.getMonth() }); };
  let dateEcho = '', dateEchoTone: 'ok' | 'warn' | 'idle' = 'idle';
  if (pd.empty) dateEcho = 'e.g. 19/9 · 19-09-26 · yesterday';
  else if (pd.err) { dateEcho = `Can’t read “${dateText.trim()}” — try 19/09/2026`; dateEchoTone = 'warn'; }
  else if (pd.future && pd.d) { dateEcho = `${longDate(pd.d)} is after today`; dateEchoTone = 'warn'; }
  else if (pd.d) { const r = relDate(pd.d); dateEcho = `→ ${longDate(pd.d)}${r ? ' · ' + r : ''}`; dateEchoTone = 'ok'; }
  const calT = today0();
  const calCells = (() => {
    const { y, m } = calView;
    const offset = (new Date(y, m, 1).getDay() + 6) % 7;      // Monday-first
    const dim = new Date(y, m + 1, 0).getDate();
    const total = Math.ceil((offset + dim) / 7) * 7;
    const sameDay = (a: Date | undefined, b: Date) => !!a && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const out: { key: number; label: string; disabled: boolean; sel: boolean; today: boolean; d: Date | null }[] = [];
    for (let i = 0; i < total; i++) {
      const n = i - offset + 1;
      if (n < 1 || n > dim) { out.push({ key: i, label: '', disabled: true, sel: false, today: false, d: null }); continue; }
      const d = new Date(y, m, n);
      out.push({ key: i, label: String(n), disabled: d > calT, sel: !pd.future && sameDay(pd.d, d), today: sameDay(calT, d), d });
    }
    return out;
  })();
  const calNextDisabled = calView.y > calT.getFullYear() || (calView.y === calT.getFullYear() && calView.m >= calT.getMonth());
  const shiftMonth = (delta: number) => setCalView(v => { const d = new Date(v.y, v.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

  return createPortal(
    <div className={`nbx${isMobile ? ' sheet' : ''}`} role="dialog" aria-modal="true" aria-label={title}
      style={stackAbove ? { zIndex: stackAbove } : undefined}>
      <style>{NBX_CSS}</style>
      <div className="backdrop" onClick={onClose} />

      <div className={`modal${leaving ? ' leaving' : ''}`} ref={isMobile ? sheetRef : undefined}>
        {isMobile && <div className="grab" />}
        <div className="m-head">
          <b>{title}</b>
          {queueMore > 0 && <span className="qn">{queueMore} more</span>}
          <button className="m-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="m-body">
          {stage !== 'form' && (
            <>
              {stage === 'pick' && (
                <>
                  {readError && (
                    <div className="readfail">
                      <b>That one wouldn&rsquo;t read.</b>
                      {readError}. Try a clearer photo — or type the figures in below.
                    </div>
                  )}
                  <button
                    type="button" className={`dropzone${over ? ' over' : ''}`}
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                    onDragLeave={() => setOver(false)}
                    onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]); }}
                  >
                    <div className="dz-ic">⇪</div>
                    <b>Drop the bill — Briklay reads it</b>
                    <span>Photo or PDF · vendor, number, date and amount fill themselves</span>
                  </button>
                  <div className="orline">or</div>
                  <button className="manual-link" onClick={() => setStage('form')}>Type it in manually</button>
                </>
              )}
              {stage === 'reading' && (
                <div className="reading">
                  <div className="rd-doc"><i /></div>
                  <div><b>Reading the bill…</b><span>{readStep}</span></div>
                </div>
              )}
            </>
          )}

          {stage === 'form' && (
            <>
              <button
                type="button" className={`dropmini${over ? ' over' : ''}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]); }}
              >
                <span className="dz-ic">⇪</span>
                <span><b>Drop a photo or PDF</b> — the fields fill themselves</span>
              </button>
              {readError && <div className="readfail">{readError}. Type the figures in below.</div>}

              <div className={rowCls('vendor', !!vendorId)} ref={vendorRowRef}>
                <div className="flabel">Vendor <span className="ftick">✓</span></div>
                {lockVendor ? (
                  <div className="locked">
                    <div className="ta-av">{lockVendor.name.slice(0, 1)}</div>
                    {lockVendor.name}
                    {before > 0 && <em>{inr(before)} due</em>}
                  </div>
                ) : (
                  <>
                    <input
                      className="finput" value={vq} autoComplete="off" placeholder="Start typing a party…"
                      onChange={(e) => { setVqTyped(e.target.value); setVendorPick(null); setCreatedName(null); setTaOpen(true); }}
                      onFocus={() => setTaOpen(true)}
                    />
                    {taOpen && !vendorId && (
                      <div className="ta">
                        {matches.map(m => (
                          <button
                            type="button" className="ta-item" key={m.stakeholder_id}
                            onClick={() => { setVendorPick({ id: m.stakeholder_id, name: m.name }); setVqTyped(null); setCreatedName(null); setTaOpen(false); setInked(s => ({ ...s, vendor: true })); }}
                          >
                            <div className="ta-av">{m.name.slice(0, 1)}</div>{m.name}
                            <span>{inr(dues[m.stakeholder_id] ?? 0)} due</span>
                          </button>
                        ))}
                        {vq.trim() && !matches.some(m => m.name.toLowerCase() === vq.trim().toLowerCase()) && (
                          <button type="button" className="ta-item ta-new" onClick={() => void createVendor(vq)}>
                            ＋ {creating ? 'Creating…' : <>Create &ldquo;{vq.trim()}&rdquo;</>}
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {dup && (
                <div className="dupe">⚠&nbsp;<span>
                  {dup.billNo ? <>A bill <b>{dup.billNo}</b></> : <>This bill</>}
                  {dup.vendorName ? <> under <b>{dup.vendorName}</b></> : null} is already on the books
                  {dup.amount ? <> ({inr(dup.amount)}{dup.billDate ? `, ${fmtDate(dup.billDate)}` : ''})</> : null}
                  {dup.via === 'amount' ? <> — same amount &amp; date</> : null}.
                  {onOpenBill && <> <button type="button" className="lnk" onClick={() => onOpenBill(dup.id)}>{openBillLabel}</button></>} — or change the number if this is a different bill.
                  <label className="anyway">
                    <input type="checkbox" checked={dupAck} onChange={(e) => setDupAck(e.target.checked)} />
                    It&rsquo;s a different bill — add anyway
                  </label>
                </span></div>
              )}

              <div className="f2">
                <div className={rowCls('no', !!billNo.trim())}>
                  <div className="flabel">Bill / invoice no <span className="ftick">✓</span></div>
                  <input className="finput" value={billNo} placeholder="—" autoComplete="off" onChange={(e) => setBillNo(e.target.value)} onKeyDown={onFormKey} />
                </div>
                <div className={`frow${billDateISO ? ' filled' : ''}${inked['date'] ? ' inked' : ''}${miss('date') ? ' miss' : ''}`}>
                  <div className="flabel">Bill date <span className="ftick">✓</span>
                    <span className="dquick">
                      <button type="button" onMouseDown={(e) => { e.preventDefault(); setDate(today0()); }}>Today</button>
                      <button type="button" onMouseDown={(e) => { e.preventDefault(); setDate(daysAgo(1)); }}>Yesterday</button>
                    </span>
                  </div>
                  <div className="datewrap">
                    <input className={`finput${dateBad ? ' bad' : ''}`} value={dateText} autoComplete="off" placeholder="19/9 or yesterday"
                      onChange={(e) => { setDateText(e.target.value); const p = parseBillDate(e.target.value); if (p.d) setCalView({ y: p.d.getFullYear(), m: p.d.getMonth() }); }}
                      onKeyDown={(e) => { if (e.key === 'Escape' && calOpen) { e.preventDefault(); setCalOpen(false); } else onFormKey(e); }} />
                    <button type="button" className={`calbtn${calOpen ? ' on' : ''}`} aria-label="Open calendar"
                      onMouseDown={(e) => { e.preventDefault(); const base = pd.d && !pd.future ? pd.d : today0(); setCalView({ y: base.getFullYear(), m: base.getMonth() }); setCalOpen(o => !o); }}>
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
                    </button>
                    {calOpen && (
                      <div className="cal">
                        <div className="cal-top">
                          <span className="cal-mo">{MONTHS_LONG[calView.m]} <em>{calView.y}</em></span>
                          <span className="cal-nav">
                            <button type="button" aria-label="Previous month" onMouseDown={(e) => { e.preventDefault(); shiftMonth(-1); }}>‹</button>
                            <button type="button" aria-label="Next month" disabled={calNextDisabled} onMouseDown={(e) => { e.preventDefault(); if (!calNextDisabled) shiftMonth(1); }}>›</button>
                          </span>
                        </div>
                        <div className="cal-grid">
                          {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(w => <span key={w} className="cal-wd">{w}</span>)}
                          {calCells.map(c => (
                            <button key={c.key} type="button" disabled={c.disabled || !c.d}
                              className={`cal-day${c.sel ? ' sel' : ''}${c.today ? ' today' : ''}${!c.d ? ' blank' : ''}`}
                              onMouseDown={(e) => { e.preventDefault(); if (c.d && !c.disabled) setDate(c.d); }}>{c.label}</button>
                          ))}
                        </div>
                        <div className="cal-foot"><span>No future dates</span></div>
                      </div>
                    )}
                  </div>
                  <div className={`decho ${dateEchoTone}`}>{dateEcho}</div>
                </div>
              </div>

              <div className={`frow amtrow${amt > 0 ? ' filled' : ''}${inked['amt'] ? ' inked' : ''}${miss('amount') ? ' miss' : ''}`}>
                <div className="flabel">Amount <span className="ftick">✓</span></div>
                <div className="amtline">
                  <span className="rs">₹</span>
                  <input
                    className="finput big" inputMode="numeric" value={indianAmt(amount)} placeholder="0"
                    onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, '').slice(0, 10))} onKeyDown={onFormKey}
                  />
                </div>
                <div className="ahint">{(() => {
                  const t = (x: number) => String(parseFloat(x.toFixed(2)));
                  if (amt >= 1e7) return '= ' + t(amt / 1e7) + ' crore';
                  if (amt >= 1e5) return '= ' + t(amt / 1e5) + ' lakh';
                  if (amt >= 1e3) return '= ' + t(amt / 1e3) + ' thousand';
                  return 'Total on the bill, incl. GST';
                })()}</div>
              </div>

              <div className="frow">
                <div className="flabel">Site <span className="opt">optional</span></div>
                {lockProject ? (
                  <div className="locked">{lockProjectName}</div>
                ) : (
                  <div className="chips">
                    {projects.map(p => (
                      <button type="button" key={p.project_id} className={`chip${projectId === p.project_id ? ' on' : ''}`}
                        onClick={() => setProjectId(projectId === p.project_id ? '' : p.project_id)}>
                        {projectId === p.project_id && <span className="ck">✓</span>}{p.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {saveError && <div className="readfail">{saveError}</div>}
            </>
          )}
        </div>

        <div className="m-foot">
          <div className="consequence">{stage === 'form' ? consequence : <>A bill raises what you owe — drop it in and watch.</>}</div>
          <div className="actions">
            {stage === 'form' && <span className={`fstatus ${statusTone}`}>{statusText}</span>}
            <button className="btn-quiet" onClick={onClose}>Discard</button>
            <button className={`btn${filed ? ' ok' : ''}${!canSave && !filed ? ' dim' : ''}`} aria-disabled={!canSave} onClick={() => void file_()}>
              <span>{filed ? '✓ Filed' : saving ? 'Filing…' : 'Add bill'}</span>
              {!filed && !saving && <span className="kbd">↵ Enter</span>}
            </button>
          </div>
        </div>
      </div>

      <input
        ref={fileRef} type="file" accept="image/*,application/pdf" hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; pick(f); }}
      />
    </div>,
    document.body,
  );
}
