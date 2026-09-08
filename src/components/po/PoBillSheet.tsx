// PO record-bill door — a thin wrapper over the bill-intake pipeline. Upload the vendor's bill; it's
// extracted ONCE and minted as a first-class bills entity linked to this PO (vendor + site pre-filled).
// The PO then shows a link to it; nothing is re-extracted afterwards. Dedupe (vendor + bill no) links
// an existing bill instead of minting a duplicate.
import { useRef, useState } from 'react';
import { X, Plus, Loader2, Check } from 'lucide-react';
import { V, font } from '../txn-ledger/ledgerTokens';
import { intakeExtract, intakeCommit } from '../../lib/billIntake';

export function PoBillSheet({ poId, orgId, stakeholderId, projectId, vendorName, onClose, onDone }: {
  poId: string; orgId: string; stakeholderId: string | null; projectId: string | null; vendorName: string;
  onClose: () => void; onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<'minted' | 'linked' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File) => {
    if (!stakeholderId) { setErr('This PO has no vendor set.'); return; }
    setErr(null); setBusy(true);
    try {
      const ex = await intakeExtract(file);
      const res = await intakeCommit({ orgId, source: 'po', file, vendorId: stakeholderId, poId, projectId }, ex, stakeholderId, { allowDuplicate: false });
      if (res.status === 'duplicate') {
        // Same paper already on file for this vendor — link it to this PO instead of a duplicate.
        setDone('linked');
      } else {
        setDone('minted');
      }
      onDone();
      window.setTimeout(onClose, 900);
    } catch (e) { setErr((e as Error)?.message || 'Could not read the bill'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ ...font, position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(30,26,21,0.42)', display: 'grid', placeItems: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px,100%)', background: V.surface, border: `1px solid ${V.line}`, borderRadius: 16, overflow: 'hidden', boxShadow: '0 24px 60px -20px rgba(30,26,21,0.5)' }}>
        <div className="flex items-start justify-between px-4 pt-4 pb-3" style={{ borderBottom: `1px solid ${V.line}` }}>
          <div>
            <p className="text-[15px] font-semibold" style={{ color: V.ink }}>Record a bill</p>
            <p className="text-[12px] mt-0.5" style={{ color: V.sys }}>{vendorName} · {poId}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: V.faint }} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="px-4 py-5 text-center">
          <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} />
          {done ? (
            <div className="inline-flex items-center gap-2 text-[13.5px] font-medium" style={{ color: V.sage }}><Check size={16} /> {done === 'linked' ? 'Linked the existing bill' : 'Bill recorded'}</div>
          ) : (
            <>
              <p className="text-[12.5px] mb-4" style={{ color: V.sys }}>Upload the vendor&apos;s bill — we read it once and record it as this PO&apos;s bill.</p>
              <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-semibold"
                style={{ background: V.terra, color: '#fff', opacity: busy ? 0.6 : 1 }}>
                {busy ? <><Loader2 size={16} className="animate-spin" /> Reading the bill…</> : <><Plus size={16} /> Upload a bill</>}
              </button>
              {err && <p className="text-[12.5px] mt-3" style={{ color: V.terra }}>{err}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
