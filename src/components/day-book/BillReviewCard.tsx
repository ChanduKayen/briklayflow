/**
 * BillReviewCard — the Day Book voucher for a BILL captured over WhatsApp (ai_extracted.kind === 'BILL').
 *
 * A bill is NOT a Day Book transaction: approving it files a row into the first-class `bills` table (and,
 * when a payment rode with it, one attached payment transaction). The card states EXACTLY what "Save" will
 * do — "Save bill" vs "Save bill + log ₹paid" — so approving a record is never confused with logging money
 * (the presentation worry). A bill legally needs a vendor, so that is the one field the card insists on;
 * everything else (site, total, bill no.) is pre-filled from the read and editable here, like today.
 */
import { useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { RoughEntry } from '../../types';
import type { StakeholderLite, ProjectLite } from './ReviewCard';
import { V, font, nums, display, mono } from './tokens';
import { WhatsAppGlyph } from './atoms';
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

  const [vendorId, setVendorId] = useState<string>(vendorMatch?.stakeholder_id ?? '');
  const [vendorName, setVendorName] = useState<string>(vendorMatch?.name ?? '');
  // Site is optional and silent — if the AI clearly matched one it links; otherwise none. Set in the bill detail.
  const [projectId] = useState<string>(projMatch?.project_id ?? '');
  const [amount, setAmount] = useState<string>(ai.bill_total != null ? String(ai.bill_total) : '');
  const [busy, setBusy] = useState(false);
  const [msgOpen, setMsgOpen] = useState(false);

  // Vendors first, then everyone else — the "type a name / add new" picker, same as the payee field.
  const vendorItems = useMemo<PickerItem[]>(() => {
    const mk = (s: StakeholderLite): PickerItem => ({ id: s.stakeholder_id, name: s.name, tag: s.type });
    const isV = (s: StakeholderLite) => !s.type || /vendor|supplier/i.test(s.type);
    return [...stakeholders.filter(isV).map(mk), ...stakeholders.filter((s) => !isV(s)).map(mk)];
  }, [stakeholders]);

  const paid = ai.payment?.amount != null && ai.payment.amount > 0 ? ai.payment.amount : null;
  const total = parseFloat(String(amount).replace(/[^\d.]/g, '')) || 0;
  const archived = entry.status === 'POSTED' || entry.status === 'DISMISSED';

  // The one gap that blocks: no vendor. The total is editable; a positive total is required to save.
  const canSave = Boolean(vendorId) && total > 0 && !busy;
  const saveLabel = paid ? `Save bill + log ${'₹' + inr(paid)}` : 'Save bill';

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
    if (!canSave) { onError(vendorId ? 'Add the bill amount first.' : 'Pick the vendor first.'); return; }
    setBusy(true);
    try {
      await fileBill(entry, orgId, { vendorId, projectId: projectId || null, amount: total, paidAmount: paid });
      onFiled();
    } catch (e) { onError(errMessage(e, 'Could not save the bill')); }
    finally { setBusy(false); }
  }

  // ── archived: a compact, muted strip (mirrors ReviewCard's filed row) ──
  if (archived) {
    const done = entry.status === 'POSTED';
    return (
      <div style={{ background: V.surface, border: `1px solid ${V.line}`, borderRadius: 12, padding: '11px 14px', opacity: 0.7, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 15 }}>🧾</span>
        <span style={{ ...font, fontSize: 13.5, fontWeight: 600, color: V.ink }}>{ai.vendor_name || vendorMatch?.name || 'Vendor'}</span>
        <span style={{ ...font, ...nums, fontSize: 13, color: V.faint }}>{ai.bill_total != null ? '₹' + inr(ai.bill_total) : ''}</span>
        <span className="flex-1" />
        <span style={{ ...font, fontSize: 11, fontWeight: 600, color: done ? V.sage : V.faint }}>{done ? '✓ In Bills' : 'Set aside'}</span>
      </div>
    );
  }

  const badge = paid ? 'BILL + PAYMENT' : 'BILL';
  const lines = Array.isArray(ai.lines) ? ai.lines : [];

  return (
    <div style={{ background: V.surface, border: `1px solid ${V.line}`, borderRadius: 16, padding: 16 }}>
      {/* header: what this is */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ ...mono, fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', color: V.terra, background: 'rgba(200,96,58,.10)', borderRadius: 6, padding: '3px 7px' }}>🧾 {badge}</span>
        {ai.bill_no && <span style={{ ...mono, fontSize: 11, color: V.faint }}>No. {ai.bill_no}</span>}
        <span className="flex-1" />
        <WhatsAppGlyph />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: docUrl ? '1fr 84px' : '1fr', gap: 14 }}>
        <div className="min-w-0">
          {/* the fact */}
          <div style={{ ...display, fontSize: 18, fontWeight: 700, color: V.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {vendorName || ai.vendor_name || 'Vendor'}
          </div>
          <div style={{ ...font, ...nums, fontSize: 15, fontWeight: 600, color: V.ink, marginTop: 2 }}>
            {total > 0 ? '₹' + inr(total) : '—'}{paid ? <span style={{ color: V.sage, fontWeight: 700 }}> · {'₹' + inr(paid)} paid</span> : <span style={{ color: V.faint, fontWeight: 500 }}> · for record</span>}
          </div>
          {lines.length > 0 && (
            <div style={{ ...font, fontSize: 12, color: V.faint, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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

      {/* the fields the bill needs — vendor (required) + total (editable). Site stays optional and is set
          in the Day Book / bill detail, not on this card. */}
      <div style={{ ...font, fontSize: 11, color: V.faint, marginTop: 14 }}>
        Vendor{!vendorId && <span style={{ color: V.terra }}> · needed</span>}
        <SearchPicker
          items={vendorItems}
          valueName={vendorName || null}
          placeholder="Select or type a vendor…"
          initialQuery={ai.vendor_name}
          onSelect={(id, name) => { setVendorId(id); setVendorName(name); }}
          onCreate={(name) => void createVendor(name)}
          createKind="vendor"
        />
      </div>
      <label style={{ ...font, fontSize: 11, color: V.faint, display: 'block', marginTop: 8 }}>
        Bill amount
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="Total on the bill" style={{ ...sel, ...nums }} />
      </label>

      {/* the action — states exactly what Save does */}
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

const sel: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 8,
  border: `1px solid ${V.line}`, background: '#fff', fontSize: 13.5, color: V.ink,
};
