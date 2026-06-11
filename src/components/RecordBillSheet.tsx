import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import BottomSheet from './BottomSheet';

// Warm palette — matches the redesigned Purchase Orders page.
const C = {
  ink: '#1F1B16', inkSoft: '#6E665C', inkFaint: '#9C948A',
  paper: '#FAF9F7', surface: '#FFFFFF', line: '#E9E5DF',
};

function parseAmount(v: string): number {
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

interface RecordBillSheetProps {
  open: boolean;
  onClose: () => void;
  po: any | null;
  currentUserName: string;
  /** Fired after the bill is saved; use to show a snackbar etc. */
  onSaved: (data: { billAmount: number; billNo: string }) => void;
}

/**
 * Inline "Enter bill" task. Records the vendor bill against a PO using the
 * exact same fields + mutation as the detail page's BillEntryForm, then
 * invalidates the list/detail queries so the card status updates immediately.
 */
export default function RecordBillSheet({ open, onClose, po, currentUserName, onSaved }: RecordBillSheetProps) {
  const qc = useQueryClient();
  const [billNo, setBillNo]         = useState('');
  const [billAmount, setBillAmount] = useState('');
  const [billDate, setBillDate]     = useState(new Date().toISOString().split('T')[0]);
  const [billFile, setBillFile]     = useState<File | null>(null);
  const [uploading, setUploading]   = useState(false);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const bill = parseAmount(billAmount);
  const canSave = bill > 0 && !!po;

  const reset = () => {
    setBillNo(''); setBillAmount(''); setBillDate(new Date().toISOString().split('T')[0]);
    setBillFile(null); setUploading(false); setSaving(false); setError(null);
  };

  const close = () => { reset(); onClose(); };

  const handleSave = async () => {
    if (!canSave || !po) return;
    setSaving(true);
    setError(null);
    try {
      let billUrl: string | null = null;
      if (billFile) {
        setUploading(true);
        const ext = billFile.type === 'application/pdf' ? 'pdf' : 'jpg';
        const path = `po-bills/bill_${po.po_id}_${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('documents')
          .upload(path, billFile, { contentType: billFile.type });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from('documents').getPublicUrl(path);
        billUrl = pub.publicUrl;
        setUploading(false);
      }
      const { error: updErr } = await supabase.from('purchase_orders').update({
        vendor_bill_number:    billNo.trim() || null,
        vendor_bill_no:        billNo.trim() || null,
        vendor_bill_amount:    bill,
        vendor_bill_date:      billDate,
        vendor_bill_url:       billUrl,
        vendor_bill_doc_url:   billUrl,
        bill_recorded_at:      new Date().toISOString(),
        bill_recorded_by_name: currentUserName,
        status:                'BILLED',
      }).eq('po_id', po.po_id);
      if (updErr) throw updErr;

      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      qc.invalidateQueries({ queryKey: ['po_detail', po.po_id] });
      const saved = { billAmount: bill, billNo: billNo.trim() };
      reset();
      onClose();
      onSaved(saved);
    } catch (err: any) {
      setUploading(false);
      setSaving(false);
      setError(err?.message || 'Could not record the bill');
    }
  };

  return (
    <BottomSheet open={open} onClose={close} title="Enter bill" desktopAllowed>
      {po && (
        <div className="px-5 pb-6">
          <p className="text-xs mb-4" style={{ color: C.inkSoft }}>
            {po.po_id} · {po.stakeholders?.name ?? '—'}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.06em] mb-1 block" style={{ color: C.inkFaint }}>
                Bill / Invoice no
              </span>
              <input
                type="text"
                placeholder="e.g. INV-2023-0445"
                value={billNo}
                onChange={(e) => setBillNo(e.target.value)}
                className="w-full text-sm px-3 py-2 rounded-lg outline-none"
                style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.ink }}
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.06em] mb-1 block" style={{ color: C.inkFaint }}>
                Bill date
              </span>
              <input
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                className="w-full text-sm px-3 py-2 rounded-lg outline-none"
                style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.ink }}
              />
            </label>
          </div>

          <label className="block mt-3">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] mb-1 block" style={{ color: C.inkFaint }}>
              Bill amount *
            </span>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium" style={{ color: C.inkSoft }}>₹</span>
              <input
                type="number"
                inputMode="numeric"
                placeholder="0"
                value={billAmount}
                onChange={(e) => setBillAmount(e.target.value)}
                autoFocus
                className="w-full text-base font-semibold pl-7 pr-4 py-3 rounded-lg outline-none focus:border-terracotta"
                style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.ink }}
              />
            </div>
          </label>

          <div className="mt-3">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] mb-1 block" style={{ color: C.inkFaint }}>
              Bill document <span className="normal-case font-normal">(PDF or image)</span>
            </span>
            {billFile ? (
              <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
                <span className="material-symbols-outlined text-[16px]" style={{ color: C.inkSoft }}>attach_file</span>
                <p className="text-sm flex-1 truncate" style={{ color: C.ink }}>{billFile.name}</p>
                <button onClick={() => setBillFile(null)} className="text-[11px]" style={{ color: C.inkSoft }}>Remove</button>
              </div>
            ) : (
              <label
                className="flex items-center gap-2 p-3 rounded-lg cursor-pointer"
                style={{ background: C.surface, border: `1px dashed ${C.line}` }}
              >
                <span className="material-symbols-outlined text-[16px]" style={{ color: C.inkSoft }}>upload_file</span>
                <span className="text-sm" style={{ color: C.inkSoft }}>Upload vendor bill</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/jpg,application/pdf"
                  onChange={(e) => setBillFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {error && <p className="text-xs text-red-600 mt-3">{error}</p>}

          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className={`w-full h-11 mt-4 rounded-xl text-sm font-semibold transition-all ${
              canSave && !saving ? 'bg-terracotta text-white' : 'cursor-not-allowed'
            }`}
            style={canSave && !saving ? undefined : { background: C.line, color: C.inkFaint }}
          >
            {saving ? (uploading ? 'Uploading…' : 'Saving…')
              : `Record bill${bill > 0 ? ` — ₹${bill.toLocaleString('en-IN')}` : ''}`}
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
