// The PO's "Bills" door — the SAME bills that live in the Bills module (a PO never uploads one of its own;
// bills come from the module or WhatsApp). Shows the org's bills as document thumbnails (images AND PDFs),
// filterable by Site and Payee like a file picker. By default it shows unattached, still-owed bills; already-
// attached ones are hidden until "Show attached" is on. Tap to select (green tick), tap again to unselect,
// then Attach. "Upload a new bill" saves it to the module and it lands in the grid, auto-selected.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AttachBillRow } from '../../lib/billsApi';
import { resolveDocUrl } from '../../lib/storage';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const isPdf = (u: string) => /\.pdf(\?|#|$)/i.test(u);

export function PoAttachBillPopup({ bills, poProjectId, poVendorId, onLink, onUploadNew, onClose }: {
  bills: AttachBillRow[]; poProjectId: string | null; poVendorId: string | null;
  onLink: (billId: string) => Promise<void>; onUploadNew: () => void; onClose: () => void;
}) {
  const [site, setSite] = useState<string>('all');
  const [payee, setPayee] = useState<string>('all');
  const [showAttached, setShowAttached] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [done, setDone] = useState(false);

  // Filter options — every site / payee that has a bill (file-picker style: "All" + each).
  const siteOpts = useMemo(() => {
    const m = new Map<string, string>();
    bills.forEach((b) => { if (b.projectId) m.set(b.projectId, b.projectName || b.projectId); });
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [bills]);
  const payeeOpts = useMemo(() => {
    const m = new Map<string, string>();
    bills.forEach((b) => { if (b.vendorId) m.set(b.vendorId, b.vendorName || b.vendorId); });
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [bills]);

  // Default the filters to the PO's own site + vendor (the common case), once the data is in.
  const defaulted = useRef(false);
  useEffect(() => {
    if (defaulted.current || bills.length === 0) return;
    defaulted.current = true;
    if (poProjectId && siteOpts.some((s) => s.id === poProjectId)) setSite(poProjectId);
    if (poVendorId && payeeOpts.some((p) => p.id === poVendorId)) setPayee(poVendorId);
  }, [bills, poProjectId, poVendorId, siteOpts, payeeOpts]);

  // A newly-uploaded bill (unlinked) lands in the grid → point the filters at it and auto-select it.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(bills.map((b) => b.id));
    if (seen.current) {
      const fresh = bills.find((b) => !seen.current!.has(b.id) && !b.linked);
      if (fresh) { setSite(fresh.projectId || 'all'); setPayee(fresh.vendorId || 'all'); setSelectedId(fresh.id); }
    }
    seen.current = ids;
  }, [bills]);

  const shown = useMemo(() => bills.filter((b) => {
    if (!showAttached && (b.linked || b.remaining <= 0.5)) return false;   // default: unattached + still owed
    if (site !== 'all' && b.projectId !== site) return false;
    if (payee !== 'all' && b.vendorId !== payee) return false;
    return true;
  }), [bills, showAttached, site, payee]);

  const selected = bills.find((b) => b.id === selectedId && !b.linked) || null;
  const anyAttached = bills.some((b) => b.linked);

  // The documents bucket is PRIVATE — a stored doc_url is a dead public URL until re-signed. Sign each
  // visible bill's doc on demand (short-lived signed URLs) so the thumbnails/PDF previews actually render.
  const [signed, setSigned] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    const todo = shown.filter((b) => b.docUrl && !signed[b.id]);
    if (!todo.length) return;
    void Promise.all(todo.map(async (b) => [b.id, await resolveDocUrl(b.docUrl)] as const)).then((pairs) => {
      if (!active) return;
      setSigned((prev) => { const n = { ...prev }; pairs.forEach(([id, u]) => { if (u) n[id] = u; }); return n; });
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  async function attach() {
    if (!selectedId || linking || done) return;
    setLinking(true);
    try { await onLink(selectedId); setLinking(false); setDone(true); window.setTimeout(onClose, 850); }
    catch { setLinking(false); }
  }

  return createPortal(
    <div className="pabx" onClick={onClose}>
      <style>{PABX_CSS}</style>
      <div className="pabx-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="pabx-head">
          <div>
            <p className="pabx-title">Bills</p>
            <p className="pabx-sub">Pick a bill to attach to this order — or upload a new one</p>
          </div>
          <button className="pabx-x" onClick={onClose} aria-label="Close"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
        </div>

        <div className="pabx-filters">
          <label className="pabx-sel"><span>Payee</span>
            <select value={payee} onChange={(e) => setPayee(e.target.value)}>
              <option value="all">All payees</option>
              {payeeOpts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="pabx-sel"><span>Site</span>
            <select value={site} onChange={(e) => setSite(e.target.value)}>
              <option value="all">All sites</option>
              {siteOpts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          {anyAttached && (
            <label className="pabx-toggle">
              <input type="checkbox" checked={showAttached} onChange={(e) => setShowAttached(e.target.checked)} />
              Show attached
            </label>
          )}
        </div>

        <div className="pabx-body">
          {shown.length === 0 ? (
            <div className="pabx-empty">
              <svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6zM14 3v5h5" /></svg>
              <p>No bills to attach here yet.</p>
              <span>Upload one below — it's saved to the Bills module and lands here to attach.</span>
            </div>
          ) : (
            <div className="pabx-grid">
              {shown.map((b) => {
                const isSel = selectedId === b.id && !b.linked;
                return (
                <button key={b.id} className={`pabx-tile${isSel ? ' on' : ''}${b.linked ? ' linked' : ''}`}
                  onClick={() => { if (!b.linked && !done) setSelectedId(isSel ? null : b.id); }} disabled={done || b.linked}
                  title={b.linked ? `Already on ${b.poId || 'an order'}` : undefined}>
                  <span className="pabx-thumb">
                    {(() => {
                      const src = signed[b.id];
                      if (!src) return null;   // still resolving (or nothing) → the doc icon shows underneath
                      return isPdf(b.docUrl || '')
                        ? <object className="pabx-media" data={`${src}#toolbar=0&navpanes=0&scrollbar=0&view=FitH&page=1`} type="application/pdf" aria-label="bill" />
                        : <img className="pabx-media" src={src} alt="" loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />;
                    })()}
                    <span className="pabx-thumb-ic"><svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h4" /></svg></span>
                    <span className="pabx-check"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg></span>
                    {b.docUrl && isPdf(b.docUrl) && <span className="pabx-pdf">PDF</span>}
                    {b.linked && <span className="pabx-onpo">On order</span>}
                  </span>
                  <span className="pabx-cap">
                    <b>{inr(b.amount)}</b>
                    <small>{b.vendorName || (b.billNo ? `#${b.billNo}` : (b.billDate || 'bill'))}</small>
                    {b.remaining > 0.5 && b.paid > 0.5 && <em>{inr(b.remaining)} due</em>}
                  </span>
                </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="pabx-foot">
          <button className="pabx-upload" disabled={linking || done} onClick={onUploadNew}>
            <svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L8 8m4-4 4 4M5 20h14" /></svg>
            Upload a new bill
          </button>
          <button className={`pabx-attach${done ? ' done' : ''}`} disabled={!selected || linking || done} onClick={() => void attach()}>
            {done ? <><svg className="tk" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg> Attached</>
              : linking ? <><span className="pabx-spin light" /> Attaching…</>
              : <>Attach{selected ? ` · ${inr(selected.amount)}` : ' bill'}</>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const PABX_CSS = `
.pabx{position:fixed;inset:0;z-index:80;display:flex;align-items:flex-end;justify-content:center;
  background:rgba(42,36,28,.42);backdrop-filter:blur(2px);animation:pabx-fade .2s ease;
  font-family:'DM Sans',system-ui,-apple-system,sans-serif;color:#2A241C}
.pabx *{box-sizing:border-box}
.pabx-sheet{background:#FFFDF7;width:100%;max-width:580px;border-radius:20px 20px 0 0;max-height:88vh;
  display:flex;flex-direction:column;box-shadow:0 -18px 50px -20px rgba(42,36,28,.4);animation:pabx-rise .34s cubic-bezier(.32,1.28,.5,1)}
@media(min-width:620px){.pabx{align-items:center;padding:20px}.pabx-sheet{border-radius:20px}}

.pabx-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:18px 18px 12px;border-bottom:1px solid #EFE9DE}
.pabx-title{margin:0;font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:600;letter-spacing:-.01em}
.pabx-sub{margin:3px 0 0;font-size:12px;color:#9A8C77}
.pabx-x{flex:none;border:0;background:none;color:#9A8C77;cursor:pointer;padding:4px;border-radius:8px;transition:.15s}
.pabx-x:hover{background:#F4EEE3;color:#2A241C}
.pabx-x svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}

.pabx-filters{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:12px 18px;border-bottom:1px solid #F3EEE4}
.pabx-sel{display:flex;flex-direction:column;gap:2px;font-size:10px;color:#B5AEA7;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.pabx-sel select{margin-top:1px;font-family:inherit;font-size:12.5px;color:#2A241C;font-weight:500;border:1px solid #E7E0D3;
  border-radius:9px;background:#FFFDF7;padding:6px 26px 6px 10px;cursor:pointer;appearance:none;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%239A8C77' stroke-width='1.6' fill='none' stroke-linecap='round'/></svg>");
  background-repeat:no-repeat;background-position:right 9px center;transition:.15s}
.pabx-sel select:hover{border-color:#D9CFBE}
.pabx-sel select:focus{outline:none;border-color:#C4502B}
.pabx-toggle{display:inline-flex;align-items:center;gap:6px;margin-left:auto;font-size:12px;color:#6E5F4C;cursor:pointer;align-self:flex-end;padding-bottom:6px}
.pabx-toggle input{accent-color:#C4502B;width:15px;height:15px;cursor:pointer}

.pabx-body{flex:1;overflow-y:auto;padding:14px 18px}
.pabx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:14px}
.pabx-tile{display:flex;flex-direction:column;gap:6px;background:none;border:0;padding:0;cursor:pointer;text-align:center}
.pabx-tile:disabled{cursor:default}
.pabx-thumb{position:relative;aspect-ratio:3/4;border-radius:11px;overflow:hidden;border:2px solid #ECE5D9;background:#F7F2E8;
  display:grid;place-items:center;transition:border-color .18s,transform .12s,box-shadow .18s}
.pabx-tile:hover .pabx-thumb{border-color:#D9CFBE;transform:translateY(-1px)}
.pabx-tile.on .pabx-thumb{border-color:#2FA04C;box-shadow:0 0 0 3px rgba(47,160,76,.16)}
.pabx-media{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;border:0;pointer-events:none}
.pabx-thumb-ic{z-index:0}
.pabx-thumb-ic svg{width:30px;height:30px;fill:none;stroke:#C9BFAF;stroke-width:1.4;stroke-linejoin:round;stroke-linecap:round}
.pabx-check{position:absolute;top:5px;right:5px;z-index:3;width:22px;height:22px;border-radius:999px;background:#2FA04C;
  display:grid;place-items:center;opacity:0;transform:scale(.4);transition:.22s cubic-bezier(.3,1.5,.5,1);box-shadow:0 2px 6px rgba(47,160,76,.4)}
.pabx-check svg{width:13px;height:13px;fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.pabx-tile.on .pabx-check{opacity:1;transform:scale(1)}
.pabx-pdf{position:absolute;top:5px;left:5px;z-index:2;font-size:8.5px;font-weight:700;color:#fff;background:#C0392B;border-radius:4px;padding:1px 4px;letter-spacing:.03em}
.pabx-onpo{position:absolute;bottom:5px;left:5px;right:5px;z-index:2;font-size:9px;font-weight:600;color:#fff;
  background:rgba(42,36,28,.72);border-radius:5px;padding:2px 4px;text-align:center;letter-spacing:.02em}
.pabx-cap{display:flex;flex-direction:column;line-height:1.2}
.pabx-cap b{font-size:12.5px;font-weight:600}
.pabx-cap small{font-size:10.5px;color:#9A8C77;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pabx-cap em{font-size:9.5px;color:#B45309;font-style:normal;font-weight:600}
.pabx-tile.linked{cursor:default;opacity:.7}
.pabx-tile.linked .pabx-thumb{border-color:#ECE5D9;filter:grayscale(.35)}
.pabx-tile.linked:hover .pabx-thumb{transform:none;border-color:#ECE5D9}

.pabx-empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:4px;padding:26px 16px;color:#9A8C77}
.pabx-empty svg{width:26px;height:26px;fill:none;stroke:#C9BFAF;stroke-width:1.5;stroke-linejoin:round;margin-bottom:4px}
.pabx-empty p{margin:0;font-size:13px;color:#6E5F4C;font-weight:500}
.pabx-empty span{font-size:11.5px}

.pabx-foot{display:flex;gap:10px;padding:13px 18px 16px;border-top:1px solid #EFE9DE;background:#FFFDF7}
.pabx-upload{flex:none;display:flex;align-items:center;gap:7px;padding:12px 14px;border:1px dashed #E0B7A5;border-radius:12px;
  background:#FCF3EF;color:#C4502B;font-size:13px;font-weight:700;cursor:pointer;transition:.16s}
.pabx-upload:hover:not(:disabled){background:#F8E9E2;border-color:#C4502B}
.pabx-upload:active:not(:disabled){transform:translateY(1px)}
.pabx-upload:disabled{opacity:.5;cursor:default}
.pabx-upload svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.pabx-attach{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;padding:12px;border:0;border-radius:12px;
  background:#C4502B;color:#fff;font-size:14px;font-weight:700;cursor:pointer;transition:background .16s,transform .1s,box-shadow .16s;box-shadow:0 6px 14px -6px rgba(196,80,43,.55)}
.pabx-attach:hover:not(:disabled){background:#A8431F}
.pabx-attach:active:not(:disabled){transform:translateY(1px)}
.pabx-attach:disabled{background:#E4DACF;color:#B5AEA7;cursor:default;box-shadow:none}
.pabx-attach.done{background:#2FA04C;color:#fff}
.pabx-attach .tk{width:16px;height:16px;fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:26;stroke-dashoffset:26;animation:pabx-draw .35s ease forwards}

.pabx-spin{width:14px;height:14px;border-radius:999px;border:2px solid #E4DACF;border-top-color:#C4502B;animation:pabx-spin .7s linear infinite;display:inline-block}
.pabx-spin.light{border-color:rgba(255,255,255,.45);border-top-color:#fff}
@keyframes pabx-fade{from{opacity:0}to{opacity:1}}
@keyframes pabx-rise{from{transform:translateY(28px);opacity:.4}to{transform:translateY(0);opacity:1}}
@keyframes pabx-spin{to{transform:rotate(360deg)}}
@keyframes pabx-draw{to{stroke-dashoffset:0}}
@media(prefers-reduced-motion:reduce){.pabx,.pabx-sheet{animation:none}}
`;
