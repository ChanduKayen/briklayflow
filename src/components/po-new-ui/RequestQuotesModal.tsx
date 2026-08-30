// RequestQuotesModal — pick which vendors to ask for a quotation. Shows your vendors
// (defaulting to the trade you're buying), each with an editable mobile number; you can
// add a vendor by name + number on the spot (saved as a reusable Vendor). "Send" fires
// the approved request_for_quotation WhatsApp template to each, with a no-login link to
// enter their rates. Sibling of SendToVendorModal.
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

export default function RequestQuotesModal({ orgId, projectId, deliveryLocation, tradeCategory, items, rfqId, onClose, onSent }: Props) {
  const { show } = useSnackbar();
  const qc = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const [phase, setPhase] = useState<'pick' | 'sending' | 'done'>('pick');
  const [result, setResult] = useState<{ sent: string[]; failed: { name?: string; error: string }[] } | null>(null);
  const [quoteBy, setQuoteBy] = useState('');

  // selection + per-vendor (possibly edited) phone
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [phones, setPhones] = useState<Record<string, string>>({});

  // add-a-vendor row
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [adding, setAdding] = useState(false);

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
  const matched = useMemo(() => {
    if (showAll || buyWords.length === 0) return vendors;
    const m = vendors.filter((v) => { const vw = tradeWords(v.category); return vw.some((w) => buyWords.includes(w)); });
    return m.length ? m : vendors;  // never show an empty list
  }, [vendors, buyWords, showAll]);

  const phoneOf = (v: Vendor) => phones[v.stakeholder_id] ?? v.contact ?? '';
  const selectedVendors = matched.filter((v) => sel[v.stakeholder_id]);
  const validCount = selectedVendors.filter((v) => phoneOf(v).replace(/\D/g, '').length >= 10).length;

  const addVendor = async () => {
    const name = newName.trim(); const phone = newPhone.trim();
    if (!name) { show('Enter the vendor name', { type: 'error' }); return; }
    if (phone.replace(/\D/g, '').length < 10) { show('Enter a valid mobile number', { type: 'error' }); return; }
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
    const chosen = selectedVendors.filter((v) => phoneOf(v).replace(/\D/g, '').length >= 10);
    if (chosen.length === 0) { show('Pick at least one vendor with a mobile number', { type: 'error' }); return; }
    setPhase('sending');
    try {
      // persist any edited numbers back to the vendor record
      await Promise.all(chosen.map(async (v) => {
        const p = phoneOf(v);
        if (p && p !== (v.contact ?? '')) await supabase.from('stakeholders').update({ contact: p }).eq('stakeholder_id', v.stakeholder_id);
      }));
      const recipients = chosen.map((v) => ({ stakeholderId: v.stakeholder_id, name: v.name, phone: phoneOf(v) }));
      const body = rfqId
        ? { rfqId, recipients }                                                        // append to an existing enquiry
        : { orgId, projectId, deliveryLocation, quoteBy: quoteBy || null, items, recipients };
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
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="px-5 pt-5 pb-3 border-b border-black/[0.06]">
          <div className="flex items-center justify-between">
            <h3 className="text-[17px] font-semibold text-on-surface">{rfqId ? 'Ask another vendor' : 'Request quotes'}</h3>
            <button onClick={onClose} className="text-on-surface-variant/60 hover:text-on-surface"><span className="material-symbols-outlined">close</span></button>
          </div>
          <p className="text-[13px] text-on-surface-variant/70 mt-0.5">
            {rfqId ? 'They get the same enquiry with a link to enter their rates' : `${items.length} item${items.length !== 1 ? 's' : ''} · vendors get a WhatsApp link to enter their rates`}
          </p>
        </div>

        {phase === 'done' && result ? (
          <div className="p-6 text-center overflow-y-auto">
            <span className="material-symbols-outlined text-[44px] text-green-600">check_circle</span>
            <p className="text-[15px] font-semibold text-on-surface mt-2">Request sent to {result.sent.length} vendor{result.sent.length !== 1 ? 's' : ''}</p>
            {result.sent.length > 0 && <p className="text-[13px] text-on-surface-variant/70 mt-1">{result.sent.join(', ')}</p>}
            {result.failed.length > 0 && (
              <div className="mt-3 text-left bg-rose-50 border border-rose-100 rounded-xl p-3">
                <p className="text-[12px] font-semibold text-rose-700 mb-1">Couldn't send to {result.failed.length}:</p>
                {result.failed.map((f, i) => <p key={i} className="text-[12px] text-rose-600">{f.name || 'Vendor'} — {f.error}</p>)}
              </div>
            )}
            <button onClick={onClose} className="mt-5 h-11 px-6 rounded-xl bg-on-surface text-surface text-[14px] font-semibold">Done</button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant/50">
                  {tradeCategory && !showAll ? `${tradeCategory} vendors` : 'Your vendors'}
                </span>
                {tradeCategory && (
                  <button onClick={() => setShowAll((s) => !s)} className="text-[12px] font-medium text-primary">
                    {showAll ? 'Show matching only' : 'Show all vendors'}
                  </button>
                )}
              </div>

              <div className="space-y-1.5">
                {matched.map((v) => {
                  const on = !!sel[v.stakeholder_id];
                  return (
                    <div key={v.stakeholder_id} className={`flex items-center gap-3 rounded-xl border p-2.5 transition-colors ${on ? 'border-primary/40 bg-primary/[0.03]' : 'border-black/[0.07]'}`}>
                      <button onClick={() => setSel((s) => ({ ...s, [v.stakeholder_id]: !on }))}
                        className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${on ? 'bg-primary border-primary' : 'border-outline-variant/50'}`}>
                        {on && <span className="material-symbols-outlined text-[13px] text-white" style={{ fontVariationSettings: "'wght' 700" }}>check</span>}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium text-on-surface truncate">{v.name}</p>
                        {v.category && <p className="text-[11px] text-on-surface-variant/55 truncate">{v.category}</p>}
                      </div>
                      <input
                        value={phoneOf(v)} onChange={(e) => setPhones((p) => ({ ...p, [v.stakeholder_id]: e.target.value }))}
                        placeholder="mobile" inputMode="tel"
                        className="w-32 text-[13px] px-2.5 py-1.5 rounded-lg border border-black/[0.1] bg-surface-container-low/40 outline-none focus:border-primary/40"
                      />
                    </div>
                  );
                })}
                {matched.length === 0 && <p className="text-[13px] text-on-surface-variant/60 py-4 text-center">No vendors yet — add one below.</p>}
              </div>

              {/* add a vendor */}
              <div className="mt-4 rounded-xl border border-dashed border-black/[0.12] p-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant/45 mb-2">Add a vendor</p>
                <div className="flex gap-2">
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Vendor name"
                    className="flex-1 min-w-0 text-[13px] px-3 py-2 rounded-lg border border-black/[0.1] bg-surface outline-none focus:border-primary/40" />
                  <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Mobile" inputMode="tel"
                    className="w-32 text-[13px] px-3 py-2 rounded-lg border border-black/[0.1] bg-surface outline-none focus:border-primary/40" />
                  <button onClick={addVendor} disabled={adding} className="px-3 rounded-lg bg-on-surface/5 hover:bg-on-surface/10 text-[13px] font-semibold text-on-surface disabled:opacity-50">
                    {adding ? '…' : 'Add'}
                  </button>
                </div>
              </div>

              {/* quote-by */}
              <div className="mt-4 flex items-center gap-2">
                <label className="text-[12px] text-on-surface-variant/70">Quotes by</label>
                <input type="date" value={quoteBy} onChange={(e) => setQuoteBy(e.target.value)}
                  className="text-[13px] px-2.5 py-1.5 rounded-lg border border-black/[0.1] bg-surface outline-none focus:border-primary/40" />
                <span className="text-[12px] text-on-surface-variant/45">optional</span>
              </div>
            </div>

            {/* footer */}
            <div className="px-5 py-3.5 border-t border-black/[0.06] flex items-center gap-3">
              <span className="text-[13px] text-on-surface-variant/70">{validCount} selected</span>
              <span className="flex-1" />
              <button onClick={onClose} className="text-[14px] font-medium text-on-surface-variant/70">Cancel</button>
              <button onClick={send} disabled={phase === 'sending' || validCount === 0}
                className="h-11 px-5 rounded-xl text-[14px] font-semibold text-white inline-flex items-center gap-2 disabled:opacity-50"
                style={{ background: '#1a9d5a' }}>
                {phase === 'sending'
                  ? <><span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span> Sending…</>
                  : <><span className="material-symbols-outlined text-[18px]">send</span> Send request</>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
