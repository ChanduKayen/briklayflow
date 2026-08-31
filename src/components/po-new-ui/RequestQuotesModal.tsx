// RequestQuotesModal — pick which vendors to ask for a quotation. Shows your vendors
// (defaulting to the trade you're buying), each with an editable mobile number; you can
// add a vendor by name + number on the spot (saved as a reusable Vendor). "Send" fires
// the approved request_for_quotation WhatsApp template to each, with a no-login link to
// enter their rates. Sibling of SendToVendorModal.
//
// Design: scoped .rqx stylesheet on the app's cream/terracotta system — sage = a picked
// vendor, terracotta = the primary action (+ a vendor that still needs a number), gold =
// the chosen deadline.
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useSnackbar } from '../Snackbar';

export interface RfqLineItem { line?: number; item_name?: string; unit?: string; qty?: number | string; spec?: string }

interface Props {
  orgId: string;
  projectId?: string | null;
  deliveryLocation?: string | null;
  tradeCategory?: string | null;     // the vendor trade to default the list to
  items: RfqLineItem[];
  rfqId?: string;                    // append mode: add vendors to an existing enquiry
  onClose: () => void;
  onSent?: (rfqId: string) => void;
}

interface Vendor { stakeholder_id: string; name: string; category: string | null; contact: string | null }

// A loose trade match: share a meaningful word (e.g. "Plumbing") between the buy trade
// and the vendor's category. Falls back to showing everyone if we can't tell.
function tradeWords(s: string | null | undefined): string[] {
  return (s ?? '').toLowerCase().replace(/[^a-z ]+/g, ' ').split(/\s+/)
    .filter((w) => w.length > 3 && !['materials', 'material', 'supplier', 'vendor', 'trader', 'store', 'shop', 'works'].includes(w));
}

const IcSearch = () => <svg className="ic" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>;
const IcPhone = () => <svg className="ic" viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="18" rx="2.4" /><path d="M11 18.5h2" /></svg>;
const IcPlane = () => <svg className="ic" viewBox="0 0 24 24"><path d="M21 3L3 10.5l6 2.5 2.5 6L21 3z" /><path d="M9 13l3-3" /></svg>;
const IcCheck = () => <svg className="ic" viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>;
const IcClose = () => <svg className="ic" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>;
const IcCaret = () => <svg className="ic caret" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>;

// preset deadlines: today / tomorrow / +3 days, all at 6 pm
function at6pm(addDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + addDays);
  d.setHours(18, 0, 0, 0);
  return d.toISOString();
}
function niceDate(isoDate: string): string {
  const d = new Date(isoDate.length <= 10 ? isoDate + 'T18:00:00' : isoDate);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const RQX_CSS = `
.rqx{position:fixed;inset:0;z-index:100;display:flex;align-items:flex-end;justify-content:center;
  background:rgba(30,26,21,.5);backdrop-filter:blur(3px);
  --cream:#F6F2EA;--paper:#FFFDF9;--paper-2:#FBF8F2;
  --ink:#2F2622;--ink-2:#6E635B;--ink-3:#A39A91;
  --line:#E4DCD0;--line-2:#EFE9DF;--line-strong:#CFC5B8;
  --terra:#C4613A;--terra-deep:#A94E2B;--terra-tint:#F8E7DE;
  --sage:#5F7F5B;--sage-deep:#4E6B4A;--sage-tint:#E9F0E5;
  --gold:#B8862E;--gold-tint:#F7EEDA;
  --serif:Georgia,'Times New Roman',serif;--sans:system-ui,-apple-system,'Segoe UI',sans-serif;--mono:ui-monospace,'SF Mono',Menlo,monospace;
  --ease:cubic-bezier(.4,0,.2,1);font-family:var(--sans);color:var(--ink)}
@media(min-width:640px){.rqx{align-items:center}}
.rqx *{box-sizing:border-box}
.rqx .scrim{position:absolute;inset:0}
.rqx .box{position:relative;width:100%;max-width:560px;max-height:94vh;display:flex;flex-direction:column;
  background:var(--paper);border-radius:24px 24px 0 0;box-shadow:0 24px 60px -20px rgba(30,26,21,.5);animation:rqxup .28s var(--ease)}
@media(min-width:640px){.rqx .box{border-radius:24px}}
@keyframes rqxup{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}
@media(prefers-reduced-motion:reduce){.rqx .box{animation:none}}
.rqx .ic{width:100%;height:100%;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}

/* header */
.rqx .hd{padding:22px 24px 16px;position:relative;flex-shrink:0}
.rqx .hd h3{margin:0;font-family:var(--serif);font-size:22px;font-weight:600;letter-spacing:-.01em;color:var(--ink)}
.rqx .hd p{margin:5px 0 0;font-size:13px;line-height:1.5;color:var(--ink-2)}
.rqx .x{position:absolute;top:18px;right:18px;width:30px;height:30px;padding:7px;border:0;background:transparent;border-radius:8px;color:var(--ink-3);cursor:pointer;transition:background .15s,color .15s}
.rqx .x:hover{background:var(--paper-2);color:var(--ink)}

/* body */
.rqx .body{flex:1;overflow-y:auto;padding:4px 24px 20px}

/* search + segmented trade filter */
.rqx .filters{display:flex;gap:10px;align-items:center;margin-bottom:16px}
.rqx .search{position:relative;flex:1;min-width:0}
.rqx .search .ic{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:16px;height:16px;stroke:var(--ink-3)}
.rqx .search input{width:100%;height:40px;border:1px solid var(--line);border-radius:999px;background:var(--paper-2);
  padding:0 14px 0 36px;font-size:14px;font-family:inherit;color:var(--ink);outline:none;transition:border-color .15s,box-shadow .15s}
.rqx .search input::placeholder{color:var(--ink-3)}
.rqx .search input:focus{border-color:var(--terra);box-shadow:0 0 0 3px var(--terra-tint);background:var(--paper)}
.rqx .seg{height:36px;padding:0 13px;border-radius:999px;border:1px solid var(--line);background:var(--paper);color:var(--ink-2);
  cursor:pointer;display:inline-flex;align-items:center;gap:7px;font-size:13.5px;font-weight:500;white-space:nowrap;transition:background .15s,color .15s,border-color .15s}
.rqx .seg:hover{border-color:var(--ink-3)}
.rqx .seg .n{font-family:var(--mono);font-size:11.5px;color:var(--ink-3);background:var(--paper-2);border-radius:999px;padding:1px 6px;transition:background .15s,color .15s}
.rqx .seg.on{background:var(--ink);border-color:var(--ink);color:var(--paper)}
.rqx .seg.on .n{background:rgba(255,255,255,.18);color:var(--paper)}

/* eyebrow rows */
.rqx .eyerow{display:flex;align-items:center;justify-content:space-between;margin:0 0 10px}
.rqx .eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-2)}
.rqx .eyebrow::before{content:"";width:3px;height:12px;border-radius:2px;background:var(--terra)}
.rqx .linkbtn{background:none;border:0;padding:0;font-family:inherit;font-size:12px;font-weight:500;color:var(--ink-2);
  text-decoration:underline;text-underline-offset:2px;cursor:pointer;transition:color .15s}
.rqx .linkbtn:hover{color:var(--terra)}

/* vendor cards */
.rqx .vlist{display:flex;flex-direction:column;gap:8px}
.rqx .vrow{display:flex;align-items:center;gap:13px;padding:12px 14px;border:1.5px solid var(--line);border-radius:14px;background:var(--paper);transition:border-color .16s,background .16s}
.rqx .vrow.on{border-color:var(--sage);background:var(--sage-tint)}
.rqx .vrow.need{border-color:var(--terra)}
.rqx .cbx{width:22px;height:22px;flex-shrink:0;border-radius:7px;border:2px solid var(--line-strong);background:transparent;
  display:grid;place-items:center;cursor:pointer;padding:0;transition:background .15s,border-color .15s}
.rqx .cbx:hover{border-color:var(--sage)}
.rqx .cbx.on{background:var(--sage);border-color:var(--sage)}
.rqx .cbx .ic{width:13px;height:13px;stroke:#fff;stroke-width:3}
.rqx .vmain{min-width:0;flex:1}
.rqx .vmain b{display:block;font-size:14.5px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rqx .vmain span{display:block;font-size:12px;margin-top:1px;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rqx .vrow.on .vmain span{color:var(--sage-deep)}
.rqx .vmain span.warn{color:var(--terra)}
/* phone field */
.rqx .phone{display:inline-flex;align-items:center;gap:6px;flex-shrink:0;border:1px solid var(--line);border-radius:10px;background:var(--paper);padding:7px 10px;transition:border-color .15s,box-shadow .15s}
.rqx .phone:focus-within{border-color:var(--terra);box-shadow:0 0 0 3px var(--terra-tint)}
.rqx .phone .ic{width:14px;height:14px;stroke:var(--ink-3);flex-shrink:0}
.rqx .phone input{width:130px;border:0;background:transparent;outline:none;font-family:var(--mono);font-size:13px;color:var(--ink);padding:0}
.rqx .phone input::placeholder{color:var(--ink-3);font-family:var(--sans)}
.rqx .addmob{display:inline-flex;align-items:center;gap:6px;flex-shrink:0;border:1.5px dashed var(--terra);border-radius:10px;
  background:var(--gold-tint);color:var(--terra);font-family:inherit;font-size:12.5px;font-weight:600;padding:7px 12px;cursor:pointer;transition:background .15s}
.rqx .addmob .ic{width:14px;height:14px;stroke:currentColor}
.rqx .addmob:hover{background:var(--terra-tint)}
.rqx .empty{font-size:13px;color:var(--ink-3);text-align:center;padding:18px 0}

/* new vendor */
.rqx .newrow{display:flex;align-items:center;gap:10px;margin-top:8px;padding:10px 14px;border:1.5px dashed var(--line-strong);border-radius:14px;background:var(--paper-2)}
.rqx .newrow input{border:0;background:transparent;outline:none;font-family:inherit;font-size:13.5px;color:var(--ink)}
.rqx .newrow input::placeholder{color:var(--ink-3)}
.rqx .newrow .nm{flex:1;min-width:0}
.rqx .newrow .ph{width:120px;font-family:var(--mono)}
.rqx .addsel{flex-shrink:0;border:1px solid var(--line);border-radius:10px;background:var(--paper);color:var(--ink-3);
  font-family:inherit;font-size:12.5px;font-weight:600;padding:8px 13px;cursor:pointer;transition:background .15s,color .15s,border-color .15s}
.rqx .addsel.ready{color:var(--terra);border-color:var(--terra)}
.rqx .addsel.ready:hover{background:var(--terra-tint)}
.rqx .addsel:disabled{cursor:default}

/* quotes-by presets */
.rqx .section{margin-top:22px}
.rqx .qp-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:11px}
.rqx .qp{height:38px;padding:0 15px;border-radius:11px;border:1px solid var(--line);background:var(--paper);color:var(--ink-2);
  font-family:inherit;font-size:13.5px;font-weight:500;cursor:pointer;transition:background .15s,color .15s,border-color .15s}
.rqx .qp:hover{border-color:var(--ink-3)}
.rqx .qp.on{background:var(--gold);border-color:var(--gold);color:#fff}
.rqx .qp-date{height:38px;margin-top:11px;padding:0 12px;border:1px solid var(--line);border-radius:11px;background:var(--paper);
  font-family:inherit;font-size:13.5px;color:var(--ink);outline:none}
.rqx .qp-date:focus{border-color:var(--terra);box-shadow:0 0 0 3px var(--terra-tint)}

/* preview */
.rqx .prev-tgl{display:inline-flex;align-items:center;gap:6px;margin-top:16px;background:none;border:0;padding:0;
  font-family:inherit;font-size:12.5px;font-weight:500;color:var(--ink-2);cursor:pointer;transition:color .15s}
.rqx .prev-tgl:hover{color:var(--terra)}
.rqx .prev-tgl .caret{width:14px;height:14px;transition:transform .2s var(--ease)}
.rqx .prev-tgl.open .caret{transform:rotate(90deg)}
.rqx .prev-box{margin-top:10px;border:1px solid var(--line-2);border-radius:12px;background:var(--paper-2);
  padding:13px 15px;font-size:12.5px;line-height:1.65;color:var(--ink-2);white-space:pre-wrap}
.rqx .prev-box .lk{font-family:var(--mono);color:var(--terra)}

/* footer */
.rqx .ft{flex-shrink:0;display:flex;align-items:center;gap:14px;padding:14px 24px;border-top:1px solid var(--line);background:var(--paper)}
.rqx .ft .sum{min-width:0;flex:1}
.rqx .ft .sum .l1{font-size:13.5px;color:var(--ink);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rqx .ft .sum .l1 em{color:var(--ink-3);font-style:normal;font-weight:400}
.rqx .ft .sum .l2{font-size:12px;color:var(--ink-3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rqx .cancel{background:none;border:0;font-family:inherit;font-size:14px;font-weight:500;color:var(--ink-2);cursor:pointer;transition:color .15s}
.rqx .cancel:hover{color:var(--ink)}
.rqx .send{display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 20px;border:0;border-radius:12px;
  background:var(--terra);color:#fff;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;
  transition:background .16s,transform .12s var(--ease),box-shadow .16s}
.rqx .send .ic{width:17px;height:17px;stroke:#fff;transition:transform .28s cubic-bezier(.34,1.56,.64,1)}
.rqx .send:not(:disabled):hover{background:var(--terra-deep);box-shadow:0 8px 20px -8px rgba(196,97,58,.6)}
.rqx .send:not(:disabled):hover .ic{transform:translate(3px,-3px) rotate(10deg)}
.rqx .send:not(:disabled):active{transform:scale(.98)}
.rqx .send:disabled{background:var(--line-strong);cursor:default}
.rqx .spin{width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;animation:rqxspin .7s linear infinite}
@keyframes rqxspin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.rqx .send .ic{transition:none}.rqx .prev-tgl .caret{transition:none}}

/* done */
.rqx .done{padding:34px 24px 30px;text-align:center}
.rqx .seal{width:60px;height:60px;border-radius:50%;background:var(--sage-tint);display:grid;place-items:center;margin:0 auto 16px}
.rqx .seal .ic{width:30px;height:30px;stroke:var(--sage);stroke-width:2.6}
.rqx .done h4{margin:0;font-family:var(--serif);font-size:19px;font-weight:600;color:var(--ink)}
.rqx .done .who{margin:6px 0 0;font-size:13.5px;color:var(--ink-2)}
.rqx .done .fail{margin-top:14px;text-align:left;background:var(--terra-tint);border:1px solid var(--terra-tint);border-radius:12px;padding:12px 14px}
.rqx .done .fail p{margin:0;font-size:12.5px;color:var(--terra-deep)}
.rqx .done .fail p.h{font-weight:600;margin-bottom:3px}
.rqx .done .ok-btn{margin-top:22px;height:44px;padding:0 26px;border:0;border-radius:12px;background:var(--ink);color:var(--paper);
  font-family:inherit;font-size:14px;font-weight:600;cursor:pointer}
`;

export default function RequestQuotesModal({ orgId, projectId, deliveryLocation, tradeCategory, items, rfqId, onClose, onSent }: Props) {
  const { show } = useSnackbar();
  const qc = useQueryClient();
  const append = !!rfqId;

  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState('');
  const [phase, setPhase] = useState<'pick' | 'sending' | 'done'>('pick');
  const [result, setResult] = useState<{ sent: string[]; failed: { name?: string; error: string }[] } | null>(null);

  // selection + per-vendor (possibly edited) phone + which no-number rows are being filled
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [phones, setPhones] = useState<Record<string, string>>({});
  const [openPhone, setOpenPhone] = useState<Record<string, boolean>>({});

  // add-a-vendor row
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [adding, setAdding] = useState(false);

  // quotes-by
  const [preset, setPreset] = useState<'today' | 'tom' | '3d' | 'pick'>('tom');
  const [customDate, setCustomDate] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);

  const { data: vendors = [] } = useQuery({
    queryKey: ['rfq_vendors', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('stakeholders')
        .select('stakeholder_id, name, category, contact').eq('type', 'Vendor').order('name');
      if (error) throw error;
      return (data ?? []) as Vendor[];
    },
  });

  const buyWords = useMemo(() => tradeWords(tradeCategory), [tradeCategory]);
  const tradeMatched = useMemo(() => {
    if (buyWords.length === 0) return vendors;
    return vendors.filter((v) => tradeWords(v.category).some((w) => buyWords.includes(w)));
  }, [vendors, buyWords]);
  const hasTrade = !!tradeCategory && tradeMatched.length > 0;

  const base = showAll || !hasTrade ? vendors : tradeMatched;
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? base.filter((v) => v.name.toLowerCase().includes(q)) : base;
  }, [base, search]);

  const phoneOf = (v: Vendor) => phones[v.stakeholder_id] ?? v.contact ?? '';
  const isValid = (p: string) => p.replace(/\D/g, '').length >= 10;

  const chosen = vendors.filter((v) => sel[v.stakeholder_id]);
  const validChosen = chosen.filter((v) => isValid(phoneOf(v)));
  const validCount = validChosen.length;

  const allShownOn = shown.length > 0 && shown.every((v) => sel[v.stakeholder_id]);
  const selectAllShown = () => setSel((s) => {
    const next = { ...s };
    const target = !allShownOn;
    shown.forEach((v) => { next[v.stakeholder_id] = target; });
    return next;
  });

  // resolved deadline
  const quoteByISO = useMemo(() => {
    if (append) return null;
    if (preset === 'today') return at6pm(0);
    if (preset === 'tom') return at6pm(1);
    if (preset === '3d') return at6pm(3);
    return customDate ? new Date(customDate + 'T18:00:00').toISOString() : null;
  }, [preset, customDate, append]);
  const quoteByLabel = preset === 'today' ? 'today 6 pm'
    : preset === 'tom' ? 'tomorrow 6 pm'
    : preset === '3d' ? 'in 3 days'
    : customDate ? `${niceDate(customDate)} 6 pm` : 'a date you pick';

  const chosenNames = chosen.map((v) => v.name);
  const summaryNames = chosenNames.slice(0, 2).join(', ') + (chosenNames.length > 2 ? ` +${chosenNames.length - 2}` : '');

  const itemsSummary = useMemo(() => {
    const names = items.map((i) => (i.item_name ?? '').trim()).filter(Boolean);
    if (names.length === 0) return `${items.length} item${items.length !== 1 ? 's' : ''}`;
    if (names.length <= 2) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
  }, [items]);

  const addVendor = async () => {
    const name = newName.trim(); const phone = newPhone.trim();
    if (!name) { show('Enter the vendor name', { type: 'error' }); return; }
    if (!isValid(phone)) { show('Enter a valid mobile number', { type: 'error' }); return; }
    setAdding(true);
    try {
      const ns = {
        stakeholder_id: `STK-${Math.floor(1000 + Math.random() * 9000)}`,
        name, type: 'Vendor', category: tradeCategory || 'Vendor', contact: phone, org_id: orgId,
      };
      const { data, error } = await supabase.from('stakeholders').insert([ns]).select('stakeholder_id, name, category, contact').single();
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ['rfq_vendors', orgId] });
      const v = data as Vendor;
      setSel((s) => ({ ...s, [v.stakeholder_id]: true }));
      setPhones((p) => ({ ...p, [v.stakeholder_id]: phone }));
      setNewName(''); setNewPhone('');
      show(`${name} added`);
    } catch (e: any) {
      show(e.message || 'Could not add vendor', { type: 'error' });
    } finally { setAdding(false); }
  };

  const send = async () => {
    if (validChosen.length === 0) { show('Pick at least one vendor with a mobile number', { type: 'error' }); return; }
    setPhase('sending');
    try {
      // persist any edited numbers back to the vendor record
      await Promise.all(validChosen.map(async (v) => {
        const p = phoneOf(v);
        if (p && p !== (v.contact ?? '')) await supabase.from('stakeholders').update({ contact: p }).eq('stakeholder_id', v.stakeholder_id);
      }));
      const recipients = validChosen.map((v) => ({ stakeholderId: v.stakeholder_id, name: v.name, phone: phoneOf(v) }));
      const body = append
        ? { rfqId, recipients }                                                        // append to an existing enquiry
        : { orgId, projectId, deliveryLocation, quoteBy: quoteByISO, items, recipients };
      const { data, error } = await supabase.functions.invoke('send-rfq', { body });
      if (error) throw error;
      const res = data as { ok: boolean; rfq_id?: string; sent: string[]; failed: { name?: string; error: string }[]; error?: string };
      if (!res.ok) throw new Error(res.error || 'Failed to send');
      setResult({ sent: res.sent ?? [], failed: res.failed ?? [] });
      setPhase('done');
      if (res.rfq_id) onSent?.(res.rfq_id);
    } catch (e: any) {
      show(e.message || 'Could not send the request', { type: 'error' });
      setPhase('pick');
    }
  };

  return createPortal(
    <div className="rqx" onClick={onClose}>
      <div className="scrim" aria-hidden="true" />
      <div className="box" role="dialog" aria-modal="true" aria-label={append ? 'Ask another vendor' : 'Request quotes'} onClick={(e) => e.stopPropagation()}>
        <style>{RQX_CSS}</style>

        {/* header */}
        <div className="hd">
          <h3>{append ? 'Ask another vendor' : 'Request quotes'}</h3>
          <p>{append
            ? 'They get the same enquiry with a WhatsApp link to enter their rates — no login for them'
            : `${items.length} item${items.length !== 1 ? 's' : ''} · vendors get a WhatsApp link to enter rates — no login for them`}</p>
          <button className="x" onClick={onClose} aria-label="Close"><IcClose /></button>
        </div>

        {phase === 'done' && result ? (
          <div className="done">
            <div className="seal"><IcCheck /></div>
            <h4>Request sent to {result.sent.length} vendor{result.sent.length !== 1 ? 's' : ''}</h4>
            {result.sent.length > 0 && <p className="who">{result.sent.join(', ')}</p>}
            {result.failed.length > 0 && (
              <div className="fail">
                <p className="h">Couldn&apos;t reach {result.failed.length}:</p>
                {result.failed.map((f, i) => <p key={i}>{f.name || 'Vendor'} — {f.error}</p>)}
              </div>
            )}
            <button className="ok-btn" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <div className="body">
              {/* search + trade filter */}
              <div className="filters">
                <div className="search">
                  <IcSearch />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendors" />
                </div>
                {hasTrade && (
                  <button className={`seg${!showAll ? ' on' : ''}`} onClick={() => setShowAll(false)}>
                    {tradeCategory} <span className="n">{tradeMatched.length}</span>
                  </button>
                )}
                <button className={`seg${showAll || !hasTrade ? ' on' : ''}`} onClick={() => setShowAll(true)}>
                  All vendors <span className="n">{vendors.length}</span>
                </button>
              </div>

              {/* vendors */}
              <div className="eyerow">
                <span className="eyebrow">Vendors</span>
                {shown.length > 0 && <button className="linkbtn" onClick={selectAllShown}>{allShownOn ? 'clear selection' : 'select all shown'}</button>}
              </div>

              <div className="vlist">
                {shown.map((v) => {
                  const on = !!sel[v.stakeholder_id];
                  const ph = phoneOf(v);
                  const showInput = !!ph || !!openPhone[v.stakeholder_id];
                  return (
                    <div key={v.stakeholder_id} className={`vrow${on ? ' on' : !ph ? ' need' : ''}`}>
                      <button className={`cbx${on ? ' on' : ''}`} onClick={() => setSel((s) => ({ ...s, [v.stakeholder_id]: !on }))} aria-label={on ? 'Deselect' : 'Select'}>
                        {on && <IcCheck />}
                      </button>
                      <div className="vmain">
                        <b>{v.name}</b>
                        {ph ? <span>{v.category || 'Vendor'}</span> : <span className="warn">no mobile on file</span>}
                      </div>
                      {showInput ? (
                        <div className="phone">
                          <IcPhone />
                          <input
                            value={ph} inputMode="tel" placeholder="mobile"
                            autoFocus={!!openPhone[v.stakeholder_id] && !v.contact}
                            onChange={(e) => setPhones((p) => ({ ...p, [v.stakeholder_id]: e.target.value }))}
                          />
                        </div>
                      ) : (
                        <button className="addmob" onClick={() => { setOpenPhone((o) => ({ ...o, [v.stakeholder_id]: true })); setSel((s) => ({ ...s, [v.stakeholder_id]: true })); }}>
                          <IcPhone /> add mobile
                        </button>
                      )}
                    </div>
                  );
                })}
                {shown.length === 0 && <p className="empty">{search ? 'No vendor matches that.' : 'No vendors yet — add one below.'}</p>}
              </div>

              {/* add a vendor */}
              <div className="newrow">
                <input className="nm" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New vendor — name" />
                <input className="ph" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="+91 mobile" inputMode="tel" />
                <button
                  className={`addsel${newName.trim() && isValid(newPhone) ? ' ready' : ''}`}
                  onClick={addVendor}
                  disabled={adding || !newName.trim() || !isValid(newPhone)}
                >
                  {adding ? '…' : 'Add & select'}
                </button>
              </div>

              {/* quotes by — only for a new enquiry */}
              {!append && (
                <div className="section">
                  <span className="eyebrow">Quotes by</span>
                  <div className="qp-row">
                    <button className={`qp${preset === 'today' ? ' on' : ''}`} onClick={() => setPreset('today')}>Today 6 pm</button>
                    <button className={`qp${preset === 'tom' ? ' on' : ''}`} onClick={() => setPreset('tom')}>Tomorrow 6 pm</button>
                    <button className={`qp${preset === '3d' ? ' on' : ''}`} onClick={() => setPreset('3d')}>In 3 days</button>
                    <button className={`qp${preset === 'pick' ? ' on' : ''}`} onClick={() => setPreset('pick')}>Pick a date</button>
                  </div>
                  {preset === 'pick' && (
                    <input type="date" className="qp-date" value={customDate} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setCustomDate(e.target.value)} />
                  )}

                  {/* preview */}
                  <button className={`prev-tgl${previewOpen ? ' open' : ''}`} onClick={() => setPreviewOpen((o) => !o)}>
                    <IcCaret /> Preview the WhatsApp message
                  </button>
                  {previewOpen && (
                    <div className="prev-box">
                      Hi [Vendor], we&apos;d like your best rates for <b>{itemsSummary}</b>
                      {deliveryLocation ? `, delivered to ${deliveryLocation}` : ''}. Please reply by {quoteByLabel}.{'\n'}
                      Enter your rates here (no login): <span className="lk">www.briklay.app/quote/…</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* footer */}
            <div className="ft">
              <div className="sum">
                {chosen.length > 0
                  ? <>
                      <div className="l1">{chosen.length} vendor{chosen.length !== 1 ? 's' : ''} <em>· {summaryNames}</em></div>
                      <div className="l2">{append ? 'each gets a personal link' : `Quotes by ${quoteByLabel} · each gets a personal link`}</div>
                    </>
                  : <div className="l1"><em>Pick vendors to send the enquiry to</em></div>}
              </div>
              <button className="cancel" onClick={onClose}>Cancel</button>
              <button className="send" onClick={send} disabled={phase === 'sending' || validCount === 0}>
                {phase === 'sending' ? <><span className="spin" /> Sending…</> : <><IcPlane /> Send request</>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
