import { useState, useRef, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────
interface LineItemProp { id: string; item_name: string; unit: string; quantity_ordered: number; unit_rate: number; qty_received_so_far: number }
interface POProp { po_id: string; org_id: string; project_id: string; stakeholder_id: string; stakeholder_name: string; line_items: LineItemProp[] }
interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (grnId: string) => void;
  po: POProp;
  session: Session;
  /** The PO's issue date — a receipt photo taken BEFORE this is flagged as stale proof. */
  poDateIssued?: string | null;
}
interface RItem extends LineItemProp { received: number; damaged: number; rejected: number; splitOpen: boolean; note: string }
interface ReceiptPhoto { file: File; preview: string; takenAt: string | null; stale: boolean }

// ── Helpers ───────────────────────────────────────────────────────────────────
const todayStr = () => new Date().toISOString().split('T')[0];
const fmt = (n: number) => Number(Math.max(0, Math.round(n))).toLocaleString('en-IN');
function babaiRef() {
  const d = new Date(); const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0'); const dd = String(d.getDate()).padStart(2, '0');
  return `DC-${yy}${mm}${dd}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
}
async function readPhotoDate(file: File): Promise<string | null> {
  const exif = await readExifDate(file).catch(() => null);
  if (exif) return exif;
  if (file.lastModified) return new Date(file.lastModified).toISOString().split('T')[0];
  return null;
}
async function readExifDate(file: File): Promise<string | null> {
  if (!/jpe?g/i.test(file.type)) return null;
  const dv = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
  if (dv.byteLength < 4 || dv.getUint16(0) !== 0xFFD8) return null;
  let off = 2;
  while (off < dv.byteLength - 4) {
    const marker = dv.getUint16(off);
    if ((marker & 0xFF00) !== 0xFF00) break;
    const size = dv.getUint16(off + 2);
    if (marker === 0xFFE1 && dv.getUint32(off + 4) === 0x45786966) return parseTiffDate(dv, off + 10);
    off += 2 + size;
  }
  return null;
}
function parseTiffDate(dv: DataView, tiff: number): string | null {
  const le = dv.getUint16(tiff) === 0x4949;
  const u16 = (o: number) => dv.getUint16(o, le);
  const u32 = (o: number) => dv.getUint32(o, le);
  const readAscii = (ifd: number, want: number): { val: string | null; exifPtr: number } => {
    let exifPtr = 0, val: string | null = null;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      if (tag === 0x8769) exifPtr = tiff + u32(e + 8);
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
    const r0 = readAscii(ifd0, 0x0132);
    let raw = r0.val;
    if (r0.exifPtr) { const rE = readAscii(r0.exifPtr, 0x9003); if (rE.val) raw = rE.val; }
    const m = raw?.match(/^(\d{4}):(\d{2}):(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  } catch { return null; }
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap');
.ras{position:fixed;inset:0;z-index:9998;display:flex;align-items:center;justify-content:center;padding:24px 16px;
  background:rgba(31,42,48,.45);
  --sheet:#fbfaf7;--line:#e4e0d8;--line-strong:#cfc9bf;--ink:#1f2a30;--ink-2:#5a6670;--ink-3:#8b959c;--field:#ffffff;
  --good:#2f6b4a;--good-bg:#e9f2ec;--damage:#a8611c;--damage-bg:#fbf0e3;--reject:#9c3b32;--reject-bg:#f9e9e7;--focus:#1f2a30;--r:10px;
  font-family:"DM Sans",system-ui,-apple-system,sans-serif;font-optical-sizing:auto;color:var(--ink);font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased}
.ras *{box-sizing:border-box;margin:0}
.ras button,.ras input,.ras textarea{font:inherit;color:inherit}
.ras button{background:none;border:0;cursor:pointer;padding:0}
.ras .num{font-variant-numeric:tabular-nums}
.ras .sheet{width:100%;max-width:540px;max-height:92vh;background:var(--sheet);border:1px solid var(--line);border-radius:16px;
  box-shadow:0 1px 2px rgba(31,42,48,.04),0 12px 40px -20px rgba(31,42,48,.25);display:flex;flex-direction:column;overflow:hidden;
  animation:rasIn .22s cubic-bezier(.16,1,.3,1)}
@keyframes rasIn{from{opacity:0;transform:translateY(8px) scale(.99)}to{opacity:1;transform:none}}
.ras .head{padding:22px 24px 18px;display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid var(--line);flex:none}
.ras .head h1{font-size:20px;font-weight:600;letter-spacing:-.01em}
.ras .head .po{color:var(--ink-2);margin-top:2px}
.ras .head .po b{font-weight:500;color:var(--ink)}
.ras .close{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;color:var(--ink-3);flex:none}
.ras .close:hover{background:var(--line);color:var(--ink)}
.ras .body{padding:8px 24px 24px;display:flex;flex-direction:column;gap:22px;overflow-y:auto}
.ras .muted{color:var(--ink-2)}
.ras .quiet{color:var(--ink-3);font-size:13px}
.ras .linkish{color:var(--ink-2);text-decoration:underline;text-decoration-color:var(--line-strong);text-underline-offset:3px;font-size:14px}
.ras .linkish:hover{color:var(--ink);text-decoration-color:var(--ink)}
.ras .when{padding-top:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ras .when input[type=date]{border:0;background:transparent;padding:2px 4px;border-radius:6px;color:var(--ink);font-weight:500}
.ras .when input[type=date]:hover{background:var(--line)}
.ras .item{border:1px solid var(--line);border-radius:14px;background:var(--field);overflow:hidden}
.ras .item-top{padding:18px 18px 14px;display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.ras .item-top h2{font-size:17px;font-weight:600}
.ras .item-top .sub{color:var(--ink-2);margin-top:2px;font-size:14px}
.ras .qty{display:flex;align-items:baseline;gap:8px;flex:none}
.ras .qty input{width:5.2ch;min-width:96px;text-align:right;font-size:34px;font-weight:600;letter-spacing:-.02em;border:0;border-bottom:2px solid var(--line-strong);background:transparent;padding:0 2px 2px}
.ras .qty input:focus{outline:none;border-bottom-color:var(--ink)}
.ras .qty .unit{color:var(--ink-2);font-size:15px;font-weight:500}
.ras .presets{display:flex;gap:6px;padding:0 18px 14px;flex-wrap:wrap}
.ras .chip{border:1px solid var(--line);border-radius:999px;padding:4px 11px;font-size:13px;color:var(--ink-2);background:var(--sheet)}
.ras .chip:hover{border-color:var(--line-strong);color:var(--ink)}
.ras .chip[aria-pressed=true]{background:var(--ink);color:#fff;border-color:var(--ink)}
.ras .cond{border-top:1px solid var(--line);padding:12px 18px;display:flex;justify-content:space-between;align-items:center;gap:12px}
.ras .cond .ok{display:flex;align-items:center;gap:8px;color:var(--good);font-weight:500}
.ras .cond .ok svg{flex:none}
.ras .split{border-top:1px solid var(--line);padding:14px 18px 16px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
.ras .sp{border-radius:var(--r);padding:10px 12px;display:flex;flex-direction:column;gap:2px}
.ras .sp label{font-size:13px;font-weight:500}
.ras .sp input{width:100%;border:0;background:transparent;font-size:22px;font-weight:600;letter-spacing:-.01em;padding:0}
.ras .sp input:focus{outline:none}
.ras .sp.good{background:var(--good-bg);color:var(--good)}
.ras .sp.damage{background:var(--damage-bg);color:var(--damage)}
.ras .sp.reject{background:var(--reject-bg);color:var(--reject)}
.ras .split-note{grid-column:1/-1;font-size:13px;color:var(--ink-2);display:flex;justify-content:space-between;gap:12px}
.ras .split-note.bad{color:var(--reject)}
.ras .balance{padding:10px 18px 14px;font-size:13px;color:var(--ink-2);border-top:1px dashed var(--line)}
.ras .balance b{color:var(--ink);font-weight:500}
.ras .field{display:flex;flex-direction:column;gap:6px}
.ras .field label{font-size:14px;font-weight:500}
.ras .input{display:flex;align-items:center;border:1px solid var(--line);background:var(--field);border-radius:var(--r);padding:0 12px;height:44px;gap:8px}
.ras .input:focus-within{border-color:var(--ink)}
.ras .input input{flex:1;border:0;background:transparent;padding:0;min-width:0}
.ras .input input:focus{outline:none}
.ras .input input::placeholder{color:var(--ink-3)}
.ras .input .tag{font-size:12px;color:var(--ink-3);white-space:nowrap}
.ras .ref-line{display:flex;justify-content:space-between;gap:12px;font-size:13px;color:var(--ink-2)}
.ras .photos{display:flex;gap:10px;flex-wrap:wrap}
.ras .tile{width:76px;height:76px;border-radius:var(--r);border:1px dashed var(--line-strong);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:var(--ink-2);font-size:12px;background:var(--field)}
.ras .tile:hover{border-color:var(--ink);color:var(--ink)}
.ras .tile.shot{border:1px solid var(--line);color:#fff;position:relative;cursor:default;background-size:cover;background-position:center}
.ras .tile.shot span.lbl{position:absolute;left:6px;bottom:5px;font-size:11px;text-shadow:0 1px 2px rgba(0,0,0,.5)}
.ras .tile.shot .x{position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:50%;background:rgba(31,42,48,.65);color:#fff;display:grid;place-items:center;font-size:12px}
.ras .tile.shot .old{position:absolute;top:4px;left:4px;background:var(--reject);color:#fff;font-size:8.5px;font-weight:700;padding:1px 4px;border-radius:5px}
.ras .stale{display:flex;align-items:flex-start;gap:7px;margin-top:8px;background:var(--reject-bg);border:1px solid #e7c9c4;border-radius:var(--r);padding:8px 10px;font-size:12px;color:var(--reject);line-height:1.45}
.ras details{border-top:1px solid var(--line);padding-top:16px}
.ras summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;color:var(--ink-2);font-size:14px}
.ras summary::-webkit-details-marker{display:none}
.ras summary svg{transition:transform .15s}
.ras details[open] summary svg{transform:rotate(90deg)}
.ras .extras{display:grid;grid-template-columns:1fr 1fr;gap:12px 10px;margin-top:14px}
.ras .extras .field.full{grid-column:1/-1}
.ras textarea{width:100%;border:1px solid var(--line);background:var(--field);border-radius:var(--r);padding:10px 12px;min-height:72px;resize:vertical}
.ras textarea:focus{outline:none;border-color:var(--ink)}
.ras textarea::placeholder{color:var(--ink-3)}
.ras .foot{background:var(--sheet);border-top:1px solid var(--line);padding:14px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex:none}
.ras .summary{font-size:14px;color:var(--ink-2);min-width:0}
.ras .summary b{color:var(--ink);font-weight:500}
.ras .summary .warn{color:var(--damage)}
.ras .actions{display:flex;align-items:center;gap:14px;flex:none}
.ras .ghost{color:var(--ink-2);padding:10px 4px}
.ras .ghost:hover{color:var(--ink)}
.ras .primary{background:var(--ink);color:#fff;border-radius:999px;padding:11px 20px;font-weight:500;transition:background .15s,opacity .15s;display:inline-flex;align-items:center;gap:8px}
.ras .primary:hover{background:#0f171b}
.ras .primary:disabled{background:var(--line-strong);color:#fff;cursor:not-allowed}
.ras .saved{padding:48px 24px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px}
.ras .saved .ring{width:56px;height:56px;border-radius:50%;background:var(--good-bg);color:var(--good);display:grid;place-items:center}
.ras .saved h2{font-size:20px;font-weight:600}
.ras .saved p{color:var(--ink-2);max-width:34ch}
.ras .spin{width:15px;height:15px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:rasSpin .7s linear infinite}
@keyframes rasSpin{to{transform:rotate(360deg)}}
@media (max-width:480px){.ras{padding:0}.ras .sheet{max-width:none;border-radius:0;border:0;min-height:100vh;max-height:100vh}.ras .split{grid-template-columns:1fr}.ras .extras{grid-template-columns:1fr}.ras .qty input{font-size:30px;min-width:84px}}
@media (prefers-reduced-motion:reduce){.ras *{transition:none!important;animation:none!important}}
`;

const XIcon = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13" /></svg>;
const Tick = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3 3 7-7" /></svg>;
const Chevron = () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 2l4 4-4 4" /></svg>;

export default function ReceiveAtSiteDrawer({ isOpen, onClose, onSuccess, po, session, poDateIssued }: Props) {
  const [receiptDate, setReceiptDate] = useState<string>(todayStr);
  const [dc, setDc] = useState('');
  const [usingRef, setUsingRef] = useState(false);
  const [vehicle, setVehicle] = useState('');
  const [driver, setDriver] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<RItem[]>(() => po.line_items.map((li) => {
    const pending = Math.max(0, li.quantity_ordered - li.qty_received_so_far);
    return { ...li, received: pending, damaged: 0, rejected: 0, splitOpen: false, note: '' };
  }));
  const [photos, setPhotos] = useState<ReceiptPhoto[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Line items load from a separate query, so re-seed a fresh form every time the modal OPENS —
  // otherwise the one-time useState initializer can capture an empty list and show no items.
  useEffect(() => {
    if (!isOpen) return;
    setItems(po.line_items.map((li) => {
      const pending = Math.max(0, li.quantity_ordered - li.qty_received_so_far);
      return { ...li, received: pending, damaged: 0, rejected: 0, splitOpen: false, note: '' };
    }));
    setReceiptDate(todayStr()); setDc(''); setUsingRef(false); setVehicle(''); setDriver(''); setNotes('');
    setPhotos([]); setSaved(null); setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const up = (id: string, patch: Partial<RItem>) => setItems((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const goodOf = (it: RItem) => Math.max(0, it.received - it.damaged - it.rejected);
  const pendingOf = (it: RItem) => Math.max(0, it.quantity_ordered - it.qty_received_so_far);

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    const added: ReceiptPhoto[] = [];
    for (const file of Array.from(files)) {
      const takenAt = await readPhotoDate(file);
      const stale = !!(takenAt && poDateIssued && takenAt < String(poDateIssued).split('T')[0]);
      added.push({ file, preview: URL.createObjectURL(file), takenAt, stale });
    }
    setPhotos((prev) => [...prev, ...added]);
  };
  const removePhoto = (i: number) => setPhotos((prev) => { const p = prev[i]; if (p) URL.revokeObjectURL(p.preview); return prev.filter((_, idx) => idx !== i); });
  const staleCount = photos.filter((p) => p.stale).length;

  // date hint
  const dateHint = (() => {
    if (receiptDate === todayStr()) return 'today';
    const diff = Math.round((+new Date(todayStr()) - +new Date(receiptDate)) / 86400000);
    return diff === 1 ? 'yesterday' : diff > 1 ? `${diff} days ago` : 'in the future';
  })();

  // readiness
  const anyReceived = items.some((it) => it.received > 0);
  const anyOver = items.some((it) => it.damaged + it.rejected > it.received);
  const problems: string[] = [];
  if (!anyReceived) problems.push('enter how much arrived');
  if (anyOver) problems.push('fix the damaged/rejected split');
  if (!dc.trim()) problems.push('add the challan number');
  const ready = problems.length === 0;

  const totalReceived = items.reduce((s, it) => s + it.received, 0);
  const notGood = items.reduce((s, it) => s + it.damaged + it.rejected, 0);

  const handleSubmit = async () => {
    if (!ready || submitting) return;
    setSubmitting(true);
    const p_items: any[] = [];
    for (const it of items) {
      if (it.received <= 0) continue;
      const base = { po_line_item_id: it.id, item_name: it.item_name, unit: it.unit, qty_ordered: it.quantity_ordered, unit_rate: it.unit_rate };
      const good = goodOf(it);
      if (it.damaged > 0 || it.rejected > 0) {
        if (good > 0) p_items.push({ ...base, qty_received: good, condition: 'good', remarks: null });
        if (it.damaged > 0) p_items.push({ ...base, qty_received: it.damaged, condition: 'damaged', remarks: it.note || null });
        if (it.rejected > 0) p_items.push({ ...base, qty_received: it.rejected, condition: 'rejected', remarks: it.note || null });
      } else {
        p_items.push({ ...base, qty_received: it.received, condition: 'good', remarks: null });
      }
    }
    const { data, error } = await supabase.rpc('create_grn', {
      p_org_id: po.org_id, p_po_id: po.po_id, p_project_id: po.project_id, p_stakeholder_id: po.stakeholder_id,
      p_receipt_date: receiptDate, p_dc_number: dc || null, p_vehicle_number: vehicle || null,
      p_driver_name: driver || null, p_remarks: notes || null, p_received_by: session.user.id, p_items,
    }).single();
    const res = data as { success?: boolean; grn_id?: string; error?: string } | null;
    if (error || !res?.success || !res.grn_id) { setSubmitting(false); return; }
    const grnId = res.grn_id;
    // photos (best-effort)
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
      } catch { /* non-fatal */ }
    }
    const savedMsg = `${fmt(totalReceived)} ${po.line_items.length === 1 ? po.line_items[0].unit : 'items'} recorded against ${po.po_id}.`;
    setSaved(savedMsg);
    setTimeout(() => onSuccess(grnId), 1200);
  };

  return (
    <div className="ras" onClick={onClose}>
      <style>{CSS}</style>
      <section className="sheet" onClick={(e) => e.stopPropagation()} aria-labelledby="ras-title">
        {saved ? (
          <div className="saved" aria-live="polite">
            <div className="ring"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></div>
            <h2>Receipt saved</h2>
            <p>{saved}</p>
          </div>
        ) : (
          <>
            <header className="head">
              <div>
                <h1 id="ras-title">Receive at site</h1>
                <div className="po"><b>{po.po_id}</b> from {po.stakeholder_name}</div>
              </div>
              <button className="close" aria-label="Close" onClick={onClose}><XIcon /></button>
            </header>

            <div className="body">
              <div className="when">
                <span className="muted">Arrived on</span>
                <input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} aria-label="Date received" />
                <span className="quiet">{dateHint}</span>
              </div>

              {/* one hero article per line item */}
              {items.map((it) => {
                const pending = pendingOf(it);
                const good = goodOf(it);
                const over = it.damaged + it.rejected > it.received;
                const remain = pending - it.received;
                const q = it.received;
                const presets = [
                  { label: 'Full order', v: pending },
                  { label: 'Half', v: Math.round(pending / 2) },
                  { label: 'Nothing came', v: 0 },
                ];
                return (
                  <article className="item" key={it.id}>
                    <div className="item-top">
                      <div>
                        <h2>{it.item_name}</h2>
                        <div className="sub">Ordered <span className="num">{fmt(it.quantity_ordered)}</span> {it.unit}{it.qty_received_so_far > 0 ? ` · ${fmt(it.qty_received_so_far)} received so far` : ' · nothing received yet'}</div>
                      </div>
                      <div className="qty">
                        <input className="num" type="number" inputMode="numeric" min={0} step={1}
                          value={it.received === 0 ? 0 : it.received}
                          onChange={(e) => { const v = Math.max(0, parseInt(e.target.value, 10) || 0); up(it.id, it.splitOpen ? { received: v } : { received: v, damaged: 0, rejected: 0 }); }}
                          aria-label="Quantity received today" />
                        <span className="unit">{it.unit}</span>
                      </div>
                    </div>

                    <div className="presets" role="group" aria-label="Quick quantities">
                      {presets.map((p) => (
                        <button key={p.label} className="chip" aria-pressed={q === p.v}
                          onClick={() => up(it.id, it.splitOpen ? { received: p.v } : { received: p.v, damaged: 0, rejected: 0 })}>{p.label}</button>
                      ))}
                    </div>

                    <div className="cond">
                      {!it.splitOpen && <div className="ok"><Tick /><span>All in good condition</span></div>}
                      {it.splitOpen && <span className="quiet" style={{ fontSize: 14 }} />}
                      <button className="linkish" aria-expanded={it.splitOpen}
                        onClick={() => up(it.id, it.splitOpen ? { splitOpen: false, damaged: 0, rejected: 0 } : { splitOpen: true })}>
                        {it.splitOpen ? 'All good after all' : 'Some damaged or rejected?'}
                      </button>
                    </div>

                    {it.splitOpen && (
                      <div className="split">
                        <div className="sp good"><label>Good</label><input className="num" type="number" inputMode="numeric" min={0}
                          value={good} onChange={(e) => { const g = Math.max(0, parseInt(e.target.value, 10) || 0); up(it.id, { received: g + it.damaged + it.rejected }); }} /></div>
                        <div className="sp damage"><label>Damaged</label><input className="num" type="number" inputMode="numeric" min={0}
                          value={it.damaged} onChange={(e) => up(it.id, { damaged: Math.max(0, parseInt(e.target.value, 10) || 0) })} /></div>
                        <div className="sp reject"><label>Rejected</label><input className="num" type="number" inputMode="numeric" min={0}
                          value={it.rejected} onChange={(e) => up(it.id, { rejected: Math.max(0, parseInt(e.target.value, 10) || 0) })} /></div>
                        <div className={`split-note${over ? ' bad' : ''}`}>
                          {over
                            ? <span>Damaged + rejected can&apos;t exceed what arrived ({fmt(it.received)}).</span>
                            : <><span>{fmt(good)} good · {fmt(it.damaged)} damaged · {fmt(it.rejected)} rejected</span><span>= {fmt(it.received)} received</span></>}
                        </div>
                      </div>
                    )}

                    <div className="balance">
                      {q === 0
                        ? <>Nothing recorded — <b>{fmt(pending)} {it.unit}</b> still pending on this line.</>
                        : remain > 0
                          ? <>After this receipt, <b>{fmt(remain)} {it.unit}</b> remain on this line.</>
                          : remain === 0
                            ? <>This completes the line. <b>Nothing remains.</b></>
                            : <><b>{fmt(-remain)} {it.unit}</b> more than pending — the office will see this as an excess.</>}
                    </div>
                  </article>
                );
              })}

              {/* challan */}
              <div className="field">
                <label htmlFor="ras-dc">Vendor&apos;s challan number</label>
                <div className="input">
                  <input id="ras-dc" type="text" placeholder="As printed on the delivery challan" autoComplete="off"
                    value={dc} onChange={(e) => { setDc(e.target.value); if (e.target.value !== dc) setUsingRef(false); }} />
                  <span className="tag">{usingRef ? 'Briklay reference' : dc ? 'From vendor' : ''}</span>
                </div>
                <div className="ref-line">
                  {usingRef
                    ? <span>Using a Briklay reference. <button className="linkish" onClick={() => { setUsingRef(false); setDc(''); }}>Enter the vendor&apos;s number instead</button></span>
                    : <span>No challan came with the load? <button className="linkish" onClick={() => { setDc(babaiRef()); setUsingRef(true); }}>Use a Briklay reference</button></span>}
                </div>
              </div>

              {/* photos */}
              <div className="field">
                <label>Photos</label>
                <div className="photos">
                  {photos.map((p, i) => (
                    <div key={i} className="tile shot" style={{ backgroundImage: `url(${p.preview})` }}>
                      {p.stale && <span className="old">OLD</span>}
                      <span className="lbl">{i === 0 ? 'Challan' : `Stack ${i}`}</span>
                      <button className="x" aria-label="Remove photo" onClick={() => removePhoto(i)}>×</button>
                    </div>
                  ))}
                  <button className="tile" onClick={() => photoInputRef.current?.click()}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><circle cx="12" cy="12.5" r="3.2" /></svg>
                    Add
                  </button>
                  <input ref={photoInputRef} type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }} onChange={(e) => { void addPhotos(e.target.files); e.target.value = ''; }} />
                </div>
                {staleCount > 0
                  ? <div className="stale">{staleCount} photo{staleCount !== 1 ? 's were' : ' was'} taken before this PO was raised — check it&apos;s proof of <em>this</em> delivery.</div>
                  : <div className="quiet">The challan and the stack are usually enough.</div>}
              </div>

              {/* extras */}
              <details>
                <summary><Chevron /> Vehicle, driver, notes</summary>
                <div className="extras">
                  <div className="field"><label htmlFor="ras-veh">Vehicle number</label><div className="input"><input id="ras-veh" placeholder="AP 05 …" value={vehicle} onChange={(e) => setVehicle(e.target.value)} /></div></div>
                  <div className="field"><label htmlFor="ras-drv">Driver</label><div className="input"><input id="ras-drv" placeholder="Name or phone" value={driver} onChange={(e) => setDriver(e.target.value)} /></div></div>
                  <div className="field full"><label htmlFor="ras-notes">Notes</label><textarea id="ras-notes" placeholder="Anything the office should know about this load" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
                </div>
              </details>
            </div>

            <footer className="foot">
              <div className="summary">
                {problems.length
                  ? <>To save, {problems.join(', then ')}.</>
                  : <><b>{fmt(totalReceived)} {po.line_items.length === 1 ? po.line_items[0].unit : 'received'}</b> · {notGood ? <span className="warn">{fmt(notGood)} not good</span> : 'all good'} · {photos.length ? `${photos.length} photo${photos.length > 1 ? 's' : ''}` : <span className="warn">no photo</span>}</>}
              </div>
              <div className="actions">
                <button className="ghost" onClick={onClose}>Cancel</button>
                <button className="primary" onClick={handleSubmit} disabled={!ready || submitting}>{submitting ? <><span className="spin" /> Saving…</> : 'Save receipt'}</button>
              </div>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
