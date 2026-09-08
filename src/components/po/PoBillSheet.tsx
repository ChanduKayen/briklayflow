// PO record-bill door — a thin wrapper over the bill-intake pipeline. The bill is ATTACHED first (shown
// immediately with a local preview), THEN read — a clear "reading the attached bill" loading state while
// extraction runs — and minted as a first-class bills entity linked to this PO (vendor + site pre-filled).
// Extracted ONCE at upload; the PO never re-reads it. Dedupe links an existing bill instead of duplicating.
import { useEffect, useRef, useState } from 'react';
import { X, Plus, Check, FileText } from 'lucide-react';
import { V, font } from '../txn-ledger/ledgerTokens';
import { intakeExtract, intakeCommit } from '../../lib/billIntake';

export function PoBillSheet({ poId, orgId, stakeholderId, projectId, vendorName, initialFile, onClose, onDone }: {
  poId: string; orgId: string; stakeholderId: string | null; projectId: string | null; vendorName: string;
  initialFile?: File | null; onClose: () => void; onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);   // local object-URL preview of the attached bill
  const [phase, setPhase] = useState<'idle' | 'reading' | 'done'>('idle');
  const [doneKind, setDoneKind] = useState<'minted' | 'linked'>('minted');
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const startedRef = useRef(false);

  // Revoke the object URL when it changes / unmounts.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  // The picker already ran (in the PO detail) — read the chosen file immediately on mount.
  useEffect(() => { if (initialFile && !startedRef.current) { startedRef.current = true; void onFile(initialFile); } }, [initialFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const onFile = async (f: File) => {
    if (!stakeholderId) { setErr('This PO has no vendor set.'); return; }
    setErr(null);
    setFile(f);
    setPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : null);
    setPhase('reading');            // attached — now reading it
    try {
      // Never leave the reader hanging: cap extraction + mint so a stuck bill-reader surfaces an error
      // instead of an endless "Reading…".
      const withTimeout = <T,>(p: Promise<T>, ms: number, msg: string) =>
        Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
      const ex = await withTimeout(intakeExtract(f), 60_000, 'Reading the bill took too long — the reader may be unavailable. Try again.');
      const res = await withTimeout(
        intakeCommit({ orgId, source: 'po', file: f, vendorId: stakeholderId, poId, projectId }, ex, stakeholderId, { allowDuplicate: false }),
        30_000, 'Saving the bill took too long. Try again.',
      );
      setDoneKind(res.status === 'duplicate' ? 'linked' : 'minted');
      setPhase('done');
      onDone();
      window.setTimeout(onClose, 1000);
    } catch (e) { setErr((e as Error)?.message || 'Could not read the bill'); setPhase('idle'); }
  };

  const isPdf = file && !file.type.startsWith('image/');

  return (
    <div style={{ ...font, position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(30,26,21,0.42)', display: 'grid', placeItems: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px,100%)', background: V.surface, border: `1px solid ${V.line}`, borderRadius: 16, overflow: 'hidden', boxShadow: '0 24px 60px -20px rgba(30,26,21,0.5)' }}>
        <style>{`@keyframes pbsShimmer{100%{transform:translateX(100%)}}@keyframes pbsSpin{to{transform:rotate(360deg)}}`}</style>
        <div className="flex items-start justify-between px-4 pt-4 pb-3" style={{ borderBottom: `1px solid ${V.line}` }}>
          <div>
            <p className="text-[15px] font-semibold" style={{ color: V.ink }}>Record a bill</p>
            <p className="text-[12px] mt-0.5" style={{ color: V.sys }}>{vendorName} · {poId}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: V.faint }} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="px-4 py-5">
          <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} />

          {!file ? (
            <div className="text-center">
              <p className="text-[12.5px] mb-4" style={{ color: V.sys }}>Attach the vendor&apos;s bill — we&apos;ll read it and record it as this PO&apos;s bill.</p>
              <button type="button" onClick={() => fileRef.current?.click()}
                className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-semibold" style={{ background: V.terra, color: '#fff' }}>
                <Plus size={16} /> Attach a bill
              </button>
              {err && <p className="text-[12.5px] mt-3" style={{ color: V.terra }}>{err}</p>}
            </div>
          ) : (
            // Attached → the bill is shown (preview + name) with the reading / done state over it.
            <div>
              <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${V.line}`, position: 'relative' }}>
                <div style={{ position: 'relative', minHeight: 132, maxHeight: 220, background: V.field, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
                  {preview
                    ? <img src={preview} alt="Attached bill" style={{ maxWidth: '100%', maxHeight: 220, display: 'block', filter: phase === 'reading' ? 'blur(1px)' : 'none', transition: 'filter .3s' }} />
                    : <div className="flex flex-col items-center gap-1.5 py-6" style={{ color: V.faint }}><FileText size={26} /><span className="text-[11.5px]">{isPdf ? 'PDF attached' : 'Attached'}</span></div>}
                  {/* reading sweep */}
                  {phase === 'reading' && (
                    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
                      <div style={{ position: 'absolute', inset: 0, transform: 'translateX(-100%)', background: 'linear-gradient(90deg,transparent,rgba(196,97,58,.18),transparent)', animation: 'pbsShimmer 1.1s infinite' }} />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2.5 px-3 py-2.5" style={{ background: V.surface }}>
                  {phase === 'reading'
                    ? <span style={{ width: 15, height: 15, borderRadius: '50%', border: `2px solid ${V.terra}33`, borderTopColor: V.terra, animation: 'pbsSpin .7s linear infinite', flexShrink: 0 }} />
                    : phase === 'done'
                    ? <Check size={15} className="shrink-0" style={{ color: V.sage }} />
                    : <span style={{ width: 8, height: 8, borderRadius: '50%', background: V.terra, flexShrink: 0 }} />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium truncate" style={{ color: V.ink }}>{file.name}</span>
                    <span className="block text-[11px]" style={{ color: phase === 'done' ? V.sage : phase === 'reading' ? V.sys : V.terra }}>
                      {phase === 'reading' ? 'Reading the attached bill…' : phase === 'idle' ? "Couldn't read this bill" : doneKind === 'linked' ? 'Linked the existing bill' : 'Bill recorded'}
                    </span>
                  </span>
                </div>
              </div>
              {err && (
                <div className="mt-3 text-center">
                  <p className="text-[12.5px] mb-2" style={{ color: V.terra }}>{err}</p>
                  <button type="button" onClick={() => fileRef.current?.click()} className="text-[12.5px] font-semibold underline" style={{ color: V.terraDeep, textUnderlineOffset: 3 }}>Attach another</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
