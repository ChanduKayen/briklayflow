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

  const [stage, setStage] = useState<Stage>(initialExtract ? 'form' : initialFile ? 'reading' : 'pick');
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
  const [billDate, setBillDate] = useState(initialExtract?.billDate ?? '');
  const [amount, setAmount] = useState(initialExtract?.amount ? String(Math.round(initialExtract.amount)) : '');
  const [projectId, setProjectId] = useState(lockProject?.id ?? '');
  const [lines, setLines] = useState<ExtractedBill['lines']>(initialExtract?.lines ?? []);
  const [inked, setInked] = useState<Record<string, boolean>>({});

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
    queryFn: async () => ((await supabase.from('stakeholders').select('stakeholder_id, name').eq('type', 'Vendor').order('name')).data ?? []) as Vendor[],
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
      window.setTimeout(() => { if (ex.billDate) { setBillDate(ex.billDate); ink('date'); } }, 480);
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
      void findDuplicateBill({ orgId, billNo: n || null, amount: amt, billDate: billDate || null, vendorName: vendorName || vq || null })
        // A warning that can't be fetched must not become an unhandled rejection — or block filing.
        .then(d => { if (live) setDup(d); }, () => { /* no warning available */ });
    }, 260);
    return () => { live = false; window.clearTimeout(t); };
  }, [orgId, billNo, amt, billDate, vendorName, vq]);

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
  const canSave = !!vendorId && amt > 0 && (!dup || dupAck) && !saving && !filed;

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
    if (!canSave) return;
    setSaving(true); setSaveError(null);
    try {
      const res = await commit({
        file, vendorId, vendorName, projectId: projectId || null, lines,
        billNo: billNo.trim() || null, billDate: billDate || null, amount: amt,
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
                  <input className="finput" value={billNo} placeholder="—" autoComplete="off" onChange={(e) => setBillNo(e.target.value)} />
                </div>
                <div className={rowCls('date', !!billDate)}>
                  <div className="flabel">Bill date <span className="ftick">✓</span></div>
                  <input className="finput" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
                </div>
              </div>

              <div className="f2">
                <div className={rowCls('amt', amt > 0)}>
                  <div className="flabel">Amount <span className="ftick">✓</span></div>
                  <input
                    className="finput big" inputMode="numeric" value={amount} placeholder="0"
                    onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
                  />
                </div>
                <div className="frow">
                  <div className="flabel">Site <span className="opt">optional</span></div>
                  {lockProject ? (
                    <div className="locked">{lockProjectName}</div>
                  ) : (
                    <select className="finput" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                      <option value="">No site / unassigned</option>
                      {projects.map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
                    </select>
                  )}
                </div>
              </div>

              {saveError && <div className="readfail">{saveError}</div>}
            </>
          )}
        </div>

        <div className="m-foot">
          <div className="consequence">{stage === 'form' ? consequence : <>A bill raises what you owe — drop it in and watch.</>}</div>
          <div className="actions">
            <button className="btn-quiet" onClick={onClose}>Discard</button>
            <button className={`btn${filed ? ' ok' : ''}`} disabled={!canSave} onClick={() => void file_()}>
              {filed ? '✓ Filed' : saving ? 'Filing…' : 'Add bill'}
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
