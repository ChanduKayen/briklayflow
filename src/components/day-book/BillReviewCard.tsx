/**
 * BillReviewCard — the Day Book voucher for a BILL captured over WhatsApp (ai_extracted.kind === 'BILL').
 *
 * A bill is NOT a Day Book transaction: approving it files a row into the first-class `bills` table (and,
 * when a payment rode with it or is added here, one attached payment transaction). Same visual language as
 * the transaction voucher (tokens: display/mono/font, the V palette): the NatureChip, the ruled fields, the
 * one terracotta action. The button states EXACTLY what Save does — "Save bill" vs "Save bill + log ₹paid".
 * Vendor and site are BOTH required; a payment is optional and offered right here.
 */
import { useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { RoughEntry } from '../../types';
import type { StakeholderLite, ProjectLite } from './ReviewCard';
import { V, font, nums, display, mono } from './tokens';
import { WhatsAppGlyph, NatureChip } from './atoms';
import { fileBill, createParty, errMessage } from './fileEntry';
import { useSignedDocUrl } from '../../lib/storage';
import { SearchPicker, type PickerItem } from './SearchPicker';

const inr = (n: number) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const low = (s: string | null | undefined) => (s ?? '').toLowerCase().trim();

/** Best existing vendor match for the read name — exact, then containment either way. */
function guessVendor(name: string | null | undefined, stakeholders: StakeholderLite[]): StakeholderLite | null {
  const n = low(name);
  if (!n) return null;
  const vendors = stakeholders.filter((s) => !s.type || /vendor|supplier/i.test(s.type));
  const pool = vendors.length ? vendors : stakeholders;
  return pool.find((s) => low(s.name) === n)
    || pool.find((s) => low(s.name).includes(n) || n.includes(low(s.name)))
    || null;
}

export function BillReviewCard({
  entry, orgId, canManage, stakeholders, projects, onFiled, onDismiss, onLightbox, onError, onVendorCreated,
}: {
  entry: RoughEntry;
  orgId: string;
  canManage: boolean;
  stakeholders: StakeholderLite[];
  projects: ProjectLite[];
  onFiled: () => void;
  onDismiss: () => void;
  onLightbox: (url: string) => void;
  onError: (message: string) => void;
  /** A vendor was just created inline — let the page refresh its stakeholder list. */
  onVendorCreated?: () => void;
}) {
  const ai = (entry.ai_extracted || {}) as RoughEntry['ai_extracted'];
  const docUrl = useSignedDocUrl(entry.raw_image_url) ?? entry.raw_image_url ?? null;

  const vendorMatch = useMemo(() => guessVendor(ai.vendor_name, stakeholders), [ai.vendor_name, stakeholders]);
  const projMatch = useMemo(() => {
    const p = low(ai.project_raw);
    return p ? projects.find((x) => low(x.name) === p || low(x.name).includes(p) || p.includes(low(x.name))) ?? null : null;
  }, [ai.project_raw, projects]);

  const capturedPaid = ai.payment?.amount != null && ai.payment.amount > 0 ? ai.payment.amount : null;

  const [vendorId, setVendorId] = useState<string>(vendorMatch?.stakeholder_id ?? '');
  const [vendorName, setVendorName] = useState<string>(vendorMatch?.name ?? '');
  const [projectId, setProjectId] = useState<string>(projMatch?.project_id ?? '');
  const [projectName, setProjectName] = useState<string>(projMatch?.name ?? '');
  const [amount, setAmount] = useState<string>(ai.bill_total != null ? String(ai.bill_total) : '');
  const [paidOn, setPaidOn] = useState<boolean>(!!capturedPaid);           // "was this bill paid?"
  const [paidAmt, setPaidAmt] = useState<string>(capturedPaid != null ? String(capturedPaid) : '');
  const [busy, setBusy] = useState(false);
  const [msgOpen, setMsgOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);   // lift the card above its neighbours while a list is open

  const vendorItems = useMemo<PickerItem[]>(() => {
    const mk = (s: StakeholderLite): PickerItem => ({ id: s.stakeholder_id, name: s.name, tag: s.type });
    const isV = (s: StakeholderLite) => !s.type || /vendor|supplier/i.test(s.type);
    return [...stakeholders.filter(isV).map(mk), ...stakeholders.filter((s) => !isV(s)).map(mk)];
  }, [stakeholders]);
  const projectItems = useMemo<PickerItem[]>(() => projects.map((p) => ({ id: p.project_id, name: p.name })), [projects]);

  const total = parseFloat(String(amount).replace(/[^\d.]/g, '')) || 0;
  const paidVal = parseFloat(String(paidAmt).replace(/[^\d.]/g, '')) || 0;
  const effectivePaid = paidOn && paidVal > 0 ? paidVal : null;
  const archived = entry.status === 'POSTED' || entry.status === 'DISMISSED';

  // Both vendor AND site are required; a positive total is required; if paying, a positive paid amount too.
  const canSave = Boolean(vendorId) && Boolean(projectId) && total > 0 && (!paidOn || paidVal > 0) && !busy;
  const saveLabel = effectivePaid ? `Save bill + log ${'₹' + inr(effectivePaid)}` : 'Save bill';

  function whatsMissing(): string {
    if (!vendorId) return 'Pick the vendor first.';
    if (!projectId) return 'Pick the site first.';
    if (!(total > 0)) return 'Add the bill amount first.';
    if (paidOn && !(paidVal > 0)) return 'Add the amount paid, or untick "Also paid".';
    return 'Could not save the bill';
  }

  async function createVendor(name: string) {
    const nm = name.trim();
    if (!nm) return;
    try {
      const v = await createParty(nm, 'Vendor', orgId);
      setVendorId(v.id); setVendorName(v.name);
      onVendorCreated?.();
    } catch (e) { onError(errMessage(e, 'Could not add the vendor')); }
  }

  async function save() {
    if (!canSave) { onError(whatsMissing()); return; }
    setBusy(true);
    try {
      await fileBill(entry, orgId, { vendorId, projectId, amount: total, paidAmount: effectivePaid });
      onFiled();
    } catch (e) { onError(errMessage(e, 'Could not save the bill')); }
    finally { setBusy(false); }
  }

  // ── archived: a compact, muted strip (mirrors ReviewCard's filed row) ──
  if (archived) {
    const done = entry.status === 'POSTED';
    return (
      <div style={{ background: V.surface, border: `1px solid ${V.line}`, borderRadius: 12, padding: '11px 14px', opacity: 0.7, display: 'flex', alignItems: 'center', gap: 10 }}>
        <NatureChip label={capturedPaid ? 'Bill · Paid' : 'Bill'} tone="terra" />
        <span style={{ ...font, fontSize: 13.5, fontWeight: 600, color: V.ink }}>{ai.vendor_name || vendorMatch?.name || 'Vendor'}</span>
        <span style={{ ...font, ...nums, fontSize: 13, color: V.faint }}>{ai.bill_total != null ? '₹' + inr(ai.bill_total) : ''}</span>
        <span className="flex-1" />
        <span style={{ ...font, fontSize: 11, fontWeight: 600, color: done ? V.sage : V.faint }}>{done ? '✓ In Bills' : 'Set aside'}</span>
      </div>
    );
  }

  const lines = Array.isArray(ai.lines) ? ai.lines : [];

  return (
    <div style={{ position: 'relative', zIndex: pickerOpen ? 50 : undefined, background: V.surface, border: `1px solid ${V.line}`, borderRadius: 16, padding: 16 }}>
      {/* header: the nature chip (elegant), the bill number, and the channel signature */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <NatureChip label={effectivePaid ? 'Bill · Paid' : 'Bill'} tone="terra" />
        {ai.bill_no && <span style={{ ...mono, fontSize: 10.5, color: V.faint, letterSpacing: '.04em' }}>Nº {ai.bill_no}</span>}
        <span className="flex-1" />
        <WhatsAppGlyph />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: docUrl ? '1fr 84px' : '1fr', gap: 14 }}>
        <div className="min-w-0">
          {/* THE FACT — vendor as the headline, the figure in the ledger's display voice */}
          <div style={{ ...display, fontSize: 19, fontWeight: 600, color: V.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {vendorName || ai.vendor_name || 'Vendor'}
          </div>
          <div style={{ ...display, ...nums, fontSize: 20, fontWeight: 600, color: V.ink, marginTop: 3 }}>
            {total > 0 ? <><span style={{ ...font, fontSize: 13, color: V.sys, marginRight: 1 }}>₹</span>{inr(total)}</> : <span style={{ ...font, fontSize: 13, color: V.faint }}>amount not set</span>}
            {effectivePaid
              ? <span style={{ ...font, fontSize: 12.5, color: V.sage, fontWeight: 600, marginLeft: 8 }}>· {'₹' + inr(effectivePaid)} paid</span>
              : <span style={{ ...font, fontSize: 12.5, color: V.faint, fontWeight: 500, marginLeft: 8 }}>· for record</span>}
          </div>
          {lines.length > 0 && (
            <div style={{ ...font, fontSize: 12, color: V.faint, marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {lines.slice(0, 3).map((l) => l?.name).filter(Boolean).join(', ')}{lines.length > 3 ? ` +${lines.length - 3} more` : ''}
            </div>
          )}
          {entry.raw_text && (
            <div style={{ marginTop: 8 }}>
              <button type="button" onClick={() => setMsgOpen((o) => !o)} style={{ ...font, fontSize: 11.5, color: V.faint, background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <WhatsAppGlyph /> {msgOpen ? 'Hide message' : 'See message'}
              </button>
              {msgOpen && <div style={{ ...font, fontSize: 12.5, color: V.sys, marginTop: 6, fontStyle: 'italic', borderLeft: `2px solid ${V.line}`, paddingLeft: 10 }}>“{entry.raw_text}”</div>}
            </div>
          )}
        </div>
        {docUrl && (
          <button onClick={() => onLightbox(docUrl)} title="View the bill" style={{ width: 84, height: 84, borderRadius: 10, overflow: 'hidden', border: `1px solid ${V.line}`, background: '#0001', flexShrink: 0 }}>
            <img src={docUrl} alt="Bill" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </button>
        )}
      </div>

      {/* THE FIELDS — vendor + site are both required; the total is editable. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
        <div style={fieldLabel}>
          Vendor{!vendorId && <span style={{ color: V.terra }}> · needed</span>}
          <SearchPicker
            items={vendorItems}
            valueName={vendorName || null}
            placeholder="Select or type a vendor…"
            initialQuery={ai.vendor_name}
            onSelect={(id, name) => { setVendorId(id); setVendorName(name); }}
            onCreate={(name) => void createVendor(name)}
            createKind="vendor"
            onOpenChange={setPickerOpen}
          />
        </div>
        <div style={fieldLabel}>
          Site{!projectId && <span style={{ color: V.terra }}> · needed</span>}
          <SearchPicker
            items={projectItems}
            valueName={projectName || null}
            placeholder="Select the site…"
            initialQuery={ai.project_raw}
            onSelect={(id, name) => { setProjectId(id); setProjectName(name); }}
            onOpenChange={setPickerOpen}
          />
        </div>
      </div>
      <label style={{ ...fieldLabel, display: 'block', marginTop: 10 }}>
        Bill amount
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="Total on the bill" style={{ ...sel, ...nums }} />
      </label>

      {/* THE PAYMENT — optional, offered right here so a paid bill is logged in one approval. */}
      <div style={{ marginTop: 12, background: V.field, borderRadius: 10, padding: '10px 12px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', ...font, fontSize: 13, color: V.ink, fontWeight: 600 }}>
          <input type="checkbox" checked={paidOn} onChange={(e) => setPaidOn(e.target.checked)} style={{ accentColor: V.terra, width: 16, height: 16 }} />
          Also record a payment for this bill
        </label>
        {paidOn && (
          <label style={{ ...fieldLabel, display: 'block', marginTop: 8 }}>
            Amount paid{!(paidVal > 0) && <span style={{ color: V.terra }}> · needed</span>}
            <input value={paidAmt} onChange={(e) => setPaidAmt(e.target.value)} inputMode="numeric" placeholder="How much was paid" style={{ ...sel, ...nums }} />
            {total > 0 && paidVal > 0 && paidVal < total && (
              <span style={{ ...font, fontSize: 11, color: V.sys, display: 'block', marginTop: 4 }}>Partial — {'₹' + inr(total - paidVal)} will stay unpaid on the bill.</span>
            )}
          </label>
        )}
      </div>

      {/* THE ACTION — states exactly what Save does */}
      {canManage && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={save} disabled={!canSave} style={{
            flex: 1, ...font, fontSize: 14, fontWeight: 700, color: '#fff', background: canSave ? V.terra : V.line,
            border: 'none', borderRadius: 10, padding: '11px 12px', cursor: canSave ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          }}>
            <Check size={16} /> {busy ? 'Saving…' : saveLabel}
          </button>
          <button onClick={onDismiss} title="Not a bill" style={{ ...font, fontSize: 13, color: V.faint, background: 'none', border: `1px solid ${V.line}`, borderRadius: 10, padding: '0 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <X size={15} /> Not a bill
          </button>
        </div>
      )}
    </div>
  );
}

const fieldLabel: React.CSSProperties = { fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 11, color: V.faint };
const sel: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 8,
  border: `1px solid ${V.line}`, background: '#fff', fontSize: 13.5, color: V.ink,
};
