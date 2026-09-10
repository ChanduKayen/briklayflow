// The PO's "Bills" door — the SAME bills that live in the Bills module. Bills only ever come from the Bills
// module (or WhatsApp); a PO never uploads one of its own. This shows the vendor's bills as document
// thumbnails (like files): tap one to select it (green tick), then Attach. "Upload a new bill" saves it to
// the Bills module and it loads into the grid, auto-selected. Platform cream/terracotta, states + motion.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import type { AttachableBill } from '../../lib/billsApi';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

export function PoAttachBillPopup({ bills, vendorName, poProjectId, onLink, onUploadNew, onClose }: {
  bills: AttachableBill[]; vendorName: string; poProjectId: string | null;
  onLink: (billId: string) => Promise<void>; onUploadNew: () => void; onClose: () => void;
}) {
  const navigate = useNavigate();
  const sites = useMemo(() => {
    const m = new Map<string, string>();
    bills.forEach((b) => { if (b.projectId) m.set(b.projectId, b.projectName || b.projectId); });
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [bills]);
  const [filter, setFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [done, setDone] = useState(false);

  // Default the site filter to the PO's own site once we know the bills carry it.
  useEffect(() => { if (poProjectId && sites.some((s) => s.id === poProjectId)) setFilter(poProjectId); }, [poProjectId, sites]);

  // A newly-uploaded bill lands in the grid → auto-select it (green tick), ready to attach.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(bills.map((b) => b.id));
    if (seen.current) {
      const fresh = bills.find((b) => !seen.current!.has(b.id));
      if (fresh) { setSelectedId(fresh.id); setFilter('all'); }
    }
    seen.current = ids;
  }, [bills]);

  const shown = filter === 'all' ? bills : bills.filter((b) => b.projectId === filter);
  const selected = bills.find((b) => b.id === selectedId) || null;

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
            <p className="pabx-sub">Pick one of {vendorName}'s bills to attach — or upload a new one</p>
          </div>
          <button className="pabx-x" onClick={onClose} aria-label="Close"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
        </div>

        {sites.length > 1 && (
          <div className="pabx-filters">
            <button className={`pabx-chip${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>All sites</button>
            {sites.map((s) => (
              <button key={s.id} className={`pabx-chip${filter === s.id ? ' on' : ''}`} onClick={() => setFilter(s.id)}>{s.name}</button>
            ))}
          </div>
        )}

        <div className="pabx-body">
          {shown.length === 0 ? (
            <div className="pabx-empty">
              <svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6zM14 3v5h5" /></svg>
              <p>No bills{filter === 'all' ? '' : ' on this site'} for {vendorName} yet.</p>
              <span>Upload one below — it's saved to the Bills module and attached here.</span>
            </div>
          ) : (
            <div className="pabx-grid">
              {shown.map((b) => (
                <button key={b.id} className={`pabx-tile${selectedId === b.id ? ' on' : ''}`} onClick={() => setSelectedId(b.id)} disabled={done}>
                  <span className="pabx-thumb">
                    {b.docUrl
                      ? <img src={b.docUrl} alt="" loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                      : null}
                    <span className="pabx-thumb-ic"><svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h4" /></svg></span>
                    <span className="pabx-check"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg></span>
                  </span>
                  <span className="pabx-cap">
                    <b>{inr(b.amount)}</b>
                    <small>{b.billNo ? `#${b.billNo}` : (b.billDate || 'bill')}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
          <button className="pabx-showall" onClick={() => { onClose(); navigate('/bills'); }}>Show all bills in the Bills module →</button>
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
.pabx-sheet{background:#FFFDF7;width:100%;max-width:560px;border-radius:20px 20px 0 0;max-height:86vh;
  display:flex;flex-direction:column;box-shadow:0 -18px 50px -20px rgba(42,36,28,.4);animation:pabx-rise .34s cubic-bezier(.32,1.28,.5,1)}
@media(min-width:600px){.pabx{align-items:center;padding:20px}.pabx-sheet{border-radius:20px}}

.pabx-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:18px 18px 12px;border-bottom:1px solid #EFE9DE}
.pabx-title{margin:0;font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:600;letter-spacing:-.01em}
.pabx-sub{margin:3px 0 0;font-size:12px;color:#9A8C77}
.pabx-x{flex:none;border:0;background:none;color:#9A8C77;cursor:pointer;padding:4px;border-radius:8px;transition:.15s}
.pabx-x:hover{background:#F4EEE3;color:#2A241C}
.pabx-x svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}

.pabx-filters{display:flex;gap:7px;flex-wrap:wrap;padding:12px 18px 2px}
.pabx-chip{padding:5px 11px;border-radius:999px;border:1px solid #E7E0D3;background:#FFFDF7;color:#6E5F4C;font-size:12px;cursor:pointer;transition:.15s}
.pabx-chip:hover{border-color:#D9CFBE}
.pabx-chip.on{background:#2A241C;border-color:#2A241C;color:#FAF7F0;font-weight:500}

.pabx-body{flex:1;overflow-y:auto;padding:14px 18px 4px}
.pabx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:14px}
.pabx-tile{display:flex;flex-direction:column;gap:6px;background:none;border:0;padding:0;cursor:pointer;text-align:center}
.pabx-tile:disabled{cursor:default}
.pabx-thumb{position:relative;aspect-ratio:3/4;border-radius:11px;overflow:hidden;border:2px solid #ECE5D9;background:#F7F2E8;
  display:grid;place-items:center;transition:border-color .18s,transform .12s,box-shadow .18s}
.pabx-tile:hover .pabx-thumb{border-color:#D9CFBE;transform:translateY(-1px)}
.pabx-tile.on .pabx-thumb{border-color:#2FA04C;box-shadow:0 0 0 3px rgba(47,160,76,.16)}
.pabx-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1}
.pabx-thumb-ic{z-index:0}
.pabx-thumb-ic svg{width:30px;height:30px;fill:none;stroke:#C9BFAF;stroke-width:1.4;stroke-linejoin:round;stroke-linecap:round}
.pabx-check{position:absolute;top:5px;right:5px;z-index:2;width:22px;height:22px;border-radius:999px;background:#2FA04C;
  display:grid;place-items:center;opacity:0;transform:scale(.4);transition:.22s cubic-bezier(.3,1.5,.5,1);box-shadow:0 2px 6px rgba(47,160,76,.4)}
.pabx-check svg{width:13px;height:13px;fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.pabx-tile.on .pabx-check{opacity:1;transform:scale(1)}
.pabx-cap{display:flex;flex-direction:column;line-height:1.2}
.pabx-cap b{font-size:12.5px;font-weight:600}
.pabx-cap small{font-size:10.5px;color:#9A8C77}

.pabx-empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:4px;padding:26px 16px;color:#9A8C77}
.pabx-empty svg{width:26px;height:26px;fill:none;stroke:#C9BFAF;stroke-width:1.5;stroke-linejoin:round;margin-bottom:4px}
.pabx-empty p{margin:0;font-size:13px;color:#6E5F4C;font-weight:500}
.pabx-empty span{font-size:11.5px}
.pabx-showall{display:block;width:100%;margin:14px 0 4px;padding:8px;background:none;border:0;color:#9A8C77;font-size:12px;cursor:pointer;transition:.15s}
.pabx-showall:hover{color:#C4502B}

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
