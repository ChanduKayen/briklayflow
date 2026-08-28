import { useState, useEffect, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import { X, Plus, Minus, ChevronDown, Loader2, RefreshCw, Camera, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { V, font } from './txn-ledger/ledgerTokens';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LineItemProp {
  id: string;
  item_name: string;
  unit: string;
  quantity_ordered: number;
  unit_rate: number;
  qty_received_so_far: number;
}

interface POProp {
  po_id: string;
  org_id: string;
  project_id: string;
  stakeholder_id: string;
  stakeholder_name: string;
  line_items: LineItemProp[];
}

interface DrawerItem extends LineItemProp {
  qty_this_delivery: number;
  condition: 'good' | 'damaged' | 'rejected';
  item_remarks: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (grnId: string) => void;
  po: POProp;
  session: Session;
  /** The PO's issue date — a receipt photo taken BEFORE this is flagged as stale proof. */
  poDateIssued?: string | null;
}

interface ReceiptPhoto { file: File; preview: string; takenAt: string | null; stale: boolean }

// ── Helpers ───────────────────────────────────────────────────────────────────

const todayStr = () => new Date().toISOString().split('T')[0];

function autoDC() {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 9000) + 1000);
  return `DC-${yy}${mm}${dd}-${seq}`;
}

/** Read a photo's own capture date. Tries EXIF DateTimeOriginal/DateTime (JPEG); falls back to the
 *  file's last-modified date. Returns YYYY-MM-DD or null. */
async function readPhotoDate(file: File): Promise<string | null> {
  const exif = await readExifDate(file).catch(() => null);
  if (exif) return exif;
  if (file.lastModified) return new Date(file.lastModified).toISOString().split('T')[0];
  return null;
}

async function readExifDate(file: File): Promise<string | null> {
  if (!/jpe?g/i.test(file.type)) return null;
  const dv = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
  if (dv.byteLength < 4 || dv.getUint16(0) !== 0xFFD8) return null; // not a JPEG
  let off = 2;
  while (off < dv.byteLength - 4) {
    const marker = dv.getUint16(off);
    if ((marker & 0xFF00) !== 0xFF00) break;
    const size = dv.getUint16(off + 2);
    if (marker === 0xFFE1 && dv.getUint32(off + 4) === 0x45786966) { // APP1 "Exif"
      return parseTiffDate(dv, off + 10);
    }
    off += 2 + size;
  }
  return null;
}

function parseTiffDate(dv: DataView, tiff: number): string | null {
  const le = dv.getUint16(tiff) === 0x4949; // "II" little-endian
  const u16 = (o: number) => dv.getUint16(o, le);
  const u32 = (o: number) => dv.getUint32(o, le);
  const readAscii = (ifd: number, want: number): { val: string | null; exifPtr: number } => {
    let exifPtr = 0, val: string | null = null;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      if (tag === 0x8769) exifPtr = tiff + u32(e + 8);          // Exif IFD pointer
      if (tag === want && type === 2) {
        const p = count > 4 ? tiff + u32(e + 8) : e + 8;
        let s = '';
        for (let j = 0; j < count - 1 && p + j < dv.byteLength; j++) s += String.fromCharCode(dv.getUint8(p + j));
        val = s;
      }
    }
    return { val, exifPtr };
  };
  try {
    const ifd0 = tiff + u32(tiff + 4);
    const r0 = readAscii(ifd0, 0x0132);                         // DateTime (IFD0)
    let raw = r0.val;
    if (r0.exifPtr) { const rE = readAscii(r0.exifPtr, 0x9003); if (rE.val) raw = rE.val; } // DateTimeOriginal
    const m = raw?.match(/^(\d{4}):(\d{2}):(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  } catch { return null; }
}

const SECTION_LABEL: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: V.faint, letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 8px' };

// ── ItemCard ──────────────────────────────────────────────────────────────────

function ItemCard({ item, idx, updateItem }: { item: DrawerItem; idx: number; updateItem: (idx: number, patch: Partial<DrawerItem>) => void }) {
  const pendingQty = Math.max(0, item.quantity_ordered - item.qty_received_so_far);
  const isActive   = item.qty_this_delivery > 0;

  const step = (delta: number) => updateItem(idx, { qty_this_delivery: Math.max(0, Math.min(item.quantity_ordered, (item.qty_this_delivery || 0) + delta)) });

  const COND = [
    { key: 'good',     label: 'Good',     wash: V.sageWash,  line: V.sage,     text: V.sage },
    { key: 'damaged',  label: 'Damaged',  wash: V.askWash,   line: V.askLine,  text: V.ask },
    { key: 'rejected', label: 'Rejected', wash: V.terraWash, line: V.terra,    text: V.terraDeep },
  ] as const;

  return (
    <div style={{ background: isActive ? V.surface : V.field, border: `1px solid ${isActive ? 'rgba(188,75,39,0.35)' : V.line}`, borderRadius: 14, padding: '12px 12px 11px', transition: 'background .18s ease, border-color .18s ease' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: V.ink, lineHeight: 1.35, margin: 0 }}>{item.item_name}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, fontSize: 11, color: V.faint }}>
            <span>Ordered <strong style={{ color: V.sys }}>{item.quantity_ordered}</strong> {item.unit}</span>
            {pendingQty > 0 && pendingQty < item.quantity_ordered && <span style={{ color: V.ask }}>· Pending {pendingQty}</span>}
          </div>
        </div>

        {/* Stepper */}
        <div style={{ display: 'flex', alignItems: 'center', background: isActive ? V.terraWash : V.field, borderRadius: 12, border: `1px solid ${isActive ? 'rgba(188,75,39,0.30)' : V.line}`, overflow: 'hidden' }}>
          <button onClick={() => step(-1)} style={{ width: 34, height: 40, background: 'transparent', border: 'none', cursor: 'pointer', color: item.qty_this_delivery > 0 ? V.terra : V.faint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Minus size={15} /></button>
          <input
            type="number" min={0} max={item.quantity_ordered}
            value={item.qty_this_delivery || ''}
            onChange={e => updateItem(idx, { qty_this_delivery: parseFloat(e.target.value) || 0 })}
            placeholder="0"
            style={{ width: 42, height: 40, textAlign: 'center', fontSize: 16, fontWeight: 700, color: V.ink, background: 'transparent', border: 'none', outline: 'none', fontVariantNumeric: 'tabular-nums' }}
          />
          <button onClick={() => step(1)} style={{ width: 34, height: 40, background: 'transparent', border: 'none', cursor: 'pointer', color: item.qty_this_delivery < item.quantity_ordered ? V.terra : V.faint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Plus size={15} /></button>
        </div>
      </div>

      {/* Condition pills */}
      <div style={{ display: 'flex', gap: 6 }}>
        {COND.map(c => {
          const active = item.condition === c.key;
          return (
            <button key={c.key} onClick={() => updateItem(idx, { condition: c.key })}
              style={{ height: 28, paddingInline: 11, borderRadius: 99, fontSize: 11.5, fontWeight: active ? 600 : 500, background: active ? c.wash : 'transparent', color: active ? c.text : V.faint, border: `1px solid ${active ? c.line : V.line}`, cursor: 'pointer', transition: 'all .15s' }}>
              {c.label}
            </button>
          );
        })}
      </div>

      {item.condition !== 'good' && (
        <input type="text" value={item.item_remarks} onChange={e => updateItem(idx, { item_remarks: e.target.value })} placeholder="Describe the issue…"
          style={{ width: '100%', height: 36, paddingInline: 12, marginTop: 8, fontSize: 12, color: V.ink, background: V.field, borderRadius: 10, border: `1px solid ${V.askLine}`, outline: 'none', boxSizing: 'border-box', ...font }} />
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ReceiveAtSiteDrawer({ isOpen, onClose, onSuccess, po, session, poDateIssued }: Props) {
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);

  const [receiptDate,   setReceiptDate]   = useState<string>(todayStr);
  const [dcMode,        setDcMode]        = useState<'auto' | 'manual'>('auto');
  const [dcAuto,        setDcAuto]        = useState<string>(() => autoDC());
  const [dcManual,      setDcManual]      = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [driverName,    setDriverName]    = useState('');
  const [remarks,       setRemarks]       = useState('');
  const [showTransport, setShowTransport] = useState(false);

  const [items, setItems] = useState<DrawerItem[]>(() =>
    po.line_items.map(li => ({ ...li, qty_this_delivery: 0, condition: 'good', item_remarks: '' })));

  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const [photos, setPhotos] = useState<ReceiptPhoto[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const staleCount = photos.filter(p => p.stale).length;

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    const added: ReceiptPhoto[] = [];
    for (const file of Array.from(files)) {
      const takenAt = await readPhotoDate(file);
      const stale = !!(takenAt && poDateIssued && takenAt < String(poDateIssued).split('T')[0]);
      added.push({ file, preview: URL.createObjectURL(file), takenAt, stale });
    }
    setPhotos(prev => [...prev, ...added]);
  };
  const removePhoto = (i: number) => setPhotos(prev => { const p = prev[i]; if (p) URL.revokeObjectURL(p.preview); return prev.filter((_, idx) => idx !== i); });

  const dcNumber = dcMode === 'auto' ? dcAuto : dcManual;
  const activeCount = items.filter(i => i.qty_this_delivery > 0).length;

  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClosing(false);
    requestAnimationFrame(() => requestAnimationFrame(() => setMounted(true)));
  }, [isOpen]);

  const handleClose = () => { setClosing(true); setTimeout(onClose, 320); };

  const handleSubmit = async () => {
    if (activeCount === 0) { setError('Enter a quantity for at least one item'); return; }
    setError(null);
    setSubmitting(true);

    const { data, error: rpcError } = await supabase
      .rpc('create_grn', {
        p_org_id:         po.org_id,
        p_po_id:          po.po_id,
        p_project_id:     po.project_id,
        p_stakeholder_id: po.stakeholder_id,
        p_receipt_date:   receiptDate,
        p_dc_number:      dcNumber || null,
        p_vehicle_number: vehicleNumber || null,
        p_driver_name:    driverName || null,
        p_remarks:        remarks || null,
        p_received_by:    session.user.id,
        p_items:          items.filter(i => i.qty_this_delivery > 0).map(i => ({
          po_line_item_id: i.id, item_name: i.item_name, unit: i.unit,
          qty_ordered: i.quantity_ordered, qty_received: i.qty_this_delivery,
          unit_rate: i.unit_rate, condition: i.condition, remarks: i.item_remarks || null,
        })),
      })
      .single();

    const res = data as { success?: boolean; grn_id?: string; error?: string } | null;
    if (rpcError || !res?.success || !res.grn_id) {
      setSubmitting(false);
      setError(res?.error ?? rpcError?.message ?? 'Failed to save receipt');
      return;
    }

    const grnId = res.grn_id;

    // Attach receipt photos + their capture dates (best-effort — the GRN is already saved).
    if (photos.length) {
      try {
        const uploaded: Array<{ url: string; taken_at: string | null; stale: boolean }> = [];
        for (let i = 0; i < photos.length; i++) {
          const p = photos[i];
          const ext = p.file.type === 'application/pdf' ? 'pdf' : 'jpg';
          const path = `po-receipts/${grnId}_${i}_${Date.now()}.${ext}`;
          const { error: upErr } = await supabase.storage.from('documents').upload(path, p.file, { contentType: p.file.type });
          if (!upErr) { const { data: pub } = supabase.storage.from('documents').getPublicUrl(path); uploaded.push({ url: pub.publicUrl, taken_at: p.takenAt, stale: p.stale }); }
        }
        if (uploaded.length) await supabase.from('po_grn').update({ receipt_photos: uploaded }).eq('grn_id', grnId);
      } catch { /* non-fatal — the receipt is saved even if photos fail */ }
    }

    setSubmitting(false);
    onSuccess(grnId);
  };

  const updateItem = (idx: number, patch: Partial<DrawerItem>) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));

  if (!isOpen && !closing) return null;
  const sheetVisible = mounted && !closing;

  const chipInput: React.CSSProperties = { height: 42, paddingInline: 12, fontSize: 13, color: V.ink, background: V.surface, borderRadius: 12, border: `1px solid ${V.line}`, outline: 'none', boxSizing: 'border-box', ...font };

  return (
    <>
      {/* Backdrop */}
      <div onClick={handleClose} style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(30,26,21,0.45)', opacity: sheetVisible ? 1 : 0, transition: 'opacity 0.3s ease' }} />

      {/* Sheet */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999, background: V.page, borderRadius: '20px 20px 0 0', maxHeight: '92vh', display: 'flex', flexDirection: 'column', transform: sheetVisible ? 'translateY(0)' : 'translateY(100%)', transition: 'transform 0.38s cubic-bezier(0.32,0.72,0,1)', boxShadow: '0 -20px 60px rgba(30,26,21,0.22)', ...font }}>

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div style={{ padding: '8px 16px 14px', borderBottom: `1px solid ${V.line}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
            <div style={{ width: 36, height: 4, borderRadius: 99, background: V.line }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: V.ink, margin: 0 }}>Receive at site</p>
              <p style={{ fontSize: 12, color: V.sys, marginTop: 2 }}>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{po.po_id}</span> · {po.stakeholder_name}
              </p>
            </div>
            <button onClick={handleClose} aria-label="Close" style={{ padding: 6, borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer', color: V.faint, flexShrink: 0 }}><X size={16} /></button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: V.surface, border: `1px solid ${V.line}`, borderRadius: 10, padding: '5px 10px' }}>
              <input type="date" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: 12, fontWeight: 500, color: V.ink, width: 118, ...font }} />
            </div>
            {activeCount > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: V.terraWash, border: '1px solid rgba(188,75,39,0.25)', borderRadius: 10, padding: '5px 10px', fontSize: 12, fontWeight: 600, color: V.terraDeep }}>
                {activeCount} item{activeCount !== 1 ? 's' : ''} to receive
              </div>
            )}
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 120px' }}>

          {/* DC number */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <p style={SECTION_LABEL}>Delivery challan no.</p>
              <div style={{ display: 'flex', background: V.field, borderRadius: 20, padding: 2, gap: 2 }}>
                {(['auto', 'manual'] as const).map(mode => (
                  <button key={mode} onClick={() => setDcMode(mode)}
                    style={{ height: 24, paddingInline: 12, borderRadius: 18, fontSize: 11, fontWeight: dcMode === mode ? 600 : 400, background: dcMode === mode ? V.surface : 'transparent', color: dcMode === mode ? V.ink : V.faint, border: 'none', cursor: 'pointer', boxShadow: dcMode === mode ? '0 1px 3px rgba(30,26,21,0.10)' : 'none', transition: 'all .18s', textTransform: 'capitalize' }}>
                    {mode === 'auto' ? 'Auto-generate' : 'Manual'}
                  </button>
                ))}
              </div>
            </div>
            {dcMode === 'auto' ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: V.surface, borderRadius: 12, border: `1px solid ${V.line}`, padding: '10px 14px' }}>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, fontWeight: 600, color: V.ink }}>{dcAuto}</span>
                <button onClick={() => setDcAuto(autoDC())} title="Regenerate" style={{ background: V.field, border: 'none', cursor: 'pointer', width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: V.sys }}><RefreshCw size={13} /></button>
              </div>
            ) : (
              <input type="text" value={dcManual} onChange={e => setDcManual(e.target.value)} placeholder="e.g. DC/2026/1234" autoFocus style={{ ...chipInput, width: '100%' }} />
            )}
          </div>

          {/* Transport (collapsible) */}
          <button onClick={() => setShowTransport(v => !v)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: V.surface, borderRadius: 12, border: `1px solid ${V.line}`, padding: '10px 14px', cursor: 'pointer', marginBottom: showTransport ? 0 : 16, borderBottomLeftRadius: showTransport ? 0 : 12, borderBottomRightRadius: showTransport ? 0 : 12, transition: 'border-radius .2s' }}>
            <span style={{ fontSize: 12.5, fontWeight: 500, color: V.sys }}>Transport details {(vehicleNumber || driverName) ? '· filled' : '(optional)'}</span>
            <ChevronDown size={16} style={{ color: V.faint, transform: showTransport ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
          </button>
          {showTransport && (
            <div style={{ background: V.surface, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, border: `1px solid ${V.line}`, borderTop: 'none', padding: '12px 14px 14px', marginBottom: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10.5, color: V.faint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Vehicle no.</span>
                <input type="text" value={vehicleNumber} onChange={e => setVehicleNumber(e.target.value)} placeholder="AP 05 TG XXXX" style={{ ...chipInput, height: 38, background: V.field, textTransform: 'uppercase' }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10.5, color: V.faint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Driver name</span>
                <input type="text" value={driverName} onChange={e => setDriverName(e.target.value)} placeholder="Optional" style={{ ...chipInput, height: 38, background: V.field }} />
              </label>
            </div>
          )}

          {/* Items */}
          <div style={{ marginBottom: 16 }}>
            <p style={SECTION_LABEL}>What arrived today</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map((item, idx) => <ItemCard key={item.id} item={item} idx={idx} updateItem={updateItem} />)}
            </div>
          </div>

          {/* Photo proof */}
          <div style={{ marginBottom: 16 }}>
            <p style={SECTION_LABEL}>Photo proof</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {photos.map((p, i) => (
                <div key={i} style={{ position: 'relative', width: 76, height: 76, borderRadius: 12, overflow: 'hidden', border: `1px solid ${p.stale ? V.terra : V.line}` }}>
                  <img src={p.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  {p.stale && <span style={{ position: 'absolute', top: 3, left: 3, background: V.terraDeep, color: '#fff', fontSize: 8.5, fontWeight: 700, padding: '1px 4px', borderRadius: 5 }}>OLD</span>}
                  <button onClick={() => removePhoto(i)} style={{ position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: '50%', background: 'rgba(30,26,21,0.6)', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><X size={11} /></button>
                </div>
              ))}
              <button onClick={() => photoInputRef.current?.click()} style={{ width: 76, height: 76, borderRadius: 12, border: `1px dashed ${V.askLine}`, background: V.surface, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, color: V.terraDeep }}>
                <Camera size={18} />
                <span style={{ fontSize: 10 }}>Add</span>
              </button>
            </div>
            <input ref={photoInputRef} type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }} onChange={e => { void addPhotos(e.target.files); e.target.value = ''; }} />
            {staleCount > 0 && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginTop: 8, background: V.terraWash, border: `1px solid rgba(188,75,39,0.3)`, borderRadius: 10, padding: '8px 10px' }}>
                <AlertTriangle size={14} style={{ color: V.terra, flexShrink: 0, marginTop: 1 }} />
                <p style={{ fontSize: 11.5, color: V.terraDeep, margin: 0, lineHeight: 1.45 }}>
                  {staleCount} photo{staleCount !== 1 ? 's were' : ' was'} taken before this PO was raised — check it&apos;s proof of <em>this</em> delivery.
                </p>
              </div>
            )}
          </div>

          {/* Notes */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            <span style={SECTION_LABEL}>Notes</span>
            <textarea rows={2} value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="e.g. 80 bags to follow per vendor call"
              style={{ padding: '10px 12px', borderRadius: 12, fontSize: 13, color: V.ink, background: V.surface, border: `1px solid ${V.line}`, outline: 'none', resize: 'none', lineHeight: 1.5, ...font }} />
          </label>

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: V.terraWash, border: `1px solid rgba(188,75,39,0.3)`, borderRadius: 12, padding: '10px 14px' }}>
              <AlertTriangle size={15} style={{ color: V.terra, flexShrink: 0 }} />
              <p style={{ fontSize: 12, color: V.terraDeep, margin: 0 }}>{error}</p>
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: V.surface, borderTop: `1px solid ${V.line}`, padding: '12px 16px', paddingBottom: 'max(12px, env(safe-area-inset-bottom))', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <button onClick={handleClose} style={{ fontSize: 13, fontWeight: 500, color: V.sys, background: 'transparent', border: 'none', cursor: 'pointer', ...font }}>Cancel</button>
          <button onClick={handleSubmit} disabled={submitting || activeCount === 0}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 12, fontSize: 13, fontWeight: 600, color: activeCount > 0 && !submitting ? '#fff' : V.faint, background: activeCount > 0 && !submitting ? V.terra : V.line, border: 'none', cursor: activeCount > 0 && !submitting ? 'pointer' : 'default', transition: 'background .16s', ...font }}>
            {submitting ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <>Save receipt</>}
          </button>
        </div>
      </div>
    </>
  );
}
