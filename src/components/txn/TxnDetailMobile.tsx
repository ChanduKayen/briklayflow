// TxnDetailMobile — the phone view of one transaction, built to the reference design.
//
// Presentation only. Every figure, every status and every action belongs to TransactionDetail and
// arrives as props, so linking, amending, voiding and the proof upload keep running through the
// code that already owns them.
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const CSS = `
.txm{--tint:#C4502B;--tint-press:#A8431F;--ink:#1B1713;--ink-2:#87807A;--ink-3:#B5AEA7;
  --bg:#F8F6F3;--card:#FFFFFF;--hair:rgba(50,42,35,.1);--good:#2FA04C;--good-bg:#EAF6EE;
  --warn:#B45309;--warn-bg:#FDF3E6;--r:18px;
  --spring:cubic-bezier(.32,1.4,.5,1);--ease:cubic-bezier(.25,.1,.25,1);--sheet:cubic-bezier(.32,.72,0,1);
  position:fixed;inset:0;z-index:45;background:var(--bg);color:var(--ink);
  display:flex;flex-direction:column;overflow:hidden;
  font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','DM Sans',system-ui,sans-serif;
  -webkit-font-smoothing:antialiased}
.txm *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.txm button{font:inherit}

.txm .nav{padding:calc(14px + env(safe-area-inset-top)) 16px 8px;display:flex;align-items:center;
  flex:none;background:linear-gradient(var(--bg) 55%,rgba(248,246,243,0))}
.txm .nbtn{border:0;background:none;cursor:pointer;color:var(--tint);display:grid;place-items:center;
  width:40px;height:40px;transition:opacity .15s}
.txm .nbtn:active{opacity:.35}
.txm .ntitle{flex:1;text-align:center;font-size:16px;font-weight:600}
.txm .ntitle span{display:block;font-size:11.5px;font-weight:500;color:var(--ink-3);margin-top:1px;letter-spacing:.02em}

.txm main{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:4px 20px 130px}
.txm main::-webkit-scrollbar{display:none}

.txm .hero{text-align:center;padding:18px 0 26px}
.txm .avatar{width:58px;height:58px;border-radius:50%;margin:0 auto 14px;background:var(--card);
  display:grid;place-items:center;font-size:22px;font-weight:700;color:var(--tint);
  box-shadow:0 6px 20px -8px rgba(27,23,19,.18)}
.txm .payee{font-size:17px;font-weight:600}
.txm .amount{font-size:46px;font-weight:800;letter-spacing:-.04em;margin-top:6px;font-variant-numeric:tabular-nums}
.txm .amount.void{text-decoration:line-through;color:var(--ink-3)}
.txm .meta{font-size:14.5px;color:var(--ink-2);margin-top:6px}
.txm .chip{display:inline-flex;align-items:center;gap:6px;margin-top:14px;background:var(--card);
  border:0;border-radius:999px;padding:8px 16px;font-size:14px;font-weight:500;cursor:pointer;
  box-shadow:0 2px 10px -4px rgba(27,23,19,.12);transition:transform .15s var(--spring)}
.txm .chip:active{transform:scale(.95)}
.txm .chip i{width:7px;height:7px;border-radius:50%;background:var(--tint)}

.txm .sect{margin-top:24px}
.txm .sect-h{font-size:13px;font-weight:600;color:var(--ink-2);margin:0 4px 8px}
.txm .group{background:var(--card);border-radius:var(--r);overflow:hidden}
.txm .row{display:flex;align-items:center;min-height:52px;padding:8px 18px;gap:14px;position:relative;width:100%;
  border:0;background:none;text-align:left}
.txm .row+.row::before{content:'';position:absolute;left:18px;right:0;top:0;height:1px;background:var(--hair);transform:scaleY(.5)}
.txm .row .lb{font-size:15.5px;color:var(--ink-2);flex-shrink:0}
.txm .row .vl{flex:1;text-align:right;font-size:15.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.txm .alloc .site{display:flex;align-items:center;padding:16px 18px;gap:12px}
.txm .alloc .site .n{flex:1;min-width:0}
.txm .alloc .site .nm{font-size:16px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.txm .alloc .site .sb{font-size:13.5px;color:var(--ink-2);margin-top:1px}
.txm .alloc .site .amt{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums;flex:none}
.txm .status{position:relative;display:flex;align-items:center;gap:12px;padding:14px 18px;width:100%;
  border:0;background:none;text-align:left;cursor:pointer;transition:background .3s}
.txm .status::before{content:'';position:absolute;left:18px;right:0;top:0;height:1px;background:var(--hair);transform:scaleY(.5)}
.txm .status .sd{width:8px;height:8px;border-radius:50%;background:var(--warn);flex-shrink:0}
.txm .status .st{flex:1;min-width:0}
.txm .status .s1{font-size:15px;font-weight:600;color:var(--warn)}
.txm .status .s2{font-size:13.5px;color:var(--ink-2);margin-top:1px}
.txm .status .act{font-size:15px;font-weight:600;color:var(--tint);flex-shrink:0}
.txm .status.linked .sd{background:var(--good)}
.txm .status.linked .s1{color:var(--good)}
.txm .status.linked .act{display:none}
.txm .status.linked{cursor:default}

.txm .note{padding:16px 18px}
.txm .note .src{font-size:12.5px;font-weight:600;color:var(--ink-2);margin-bottom:8px;display:flex;align-items:center;gap:6px}
.txm .note .src i{width:6px;height:6px;border-radius:50%;background:#25D366}
.txm .note .txt{font-size:15px;line-height:1.6;color:var(--ink);
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.txm .note.exp .txt{-webkit-line-clamp:unset}
.txm .note .more{border:0;background:none;font-size:14.5px;font-weight:600;color:var(--tint);
  cursor:pointer;margin-top:8px;padding:2px 0;transition:opacity .15s}
.txm .note .more:active{opacity:.35}
.txm .note .ref{font-size:13px;color:var(--ink-2);margin-top:10px;font-variant-numeric:tabular-nums}

.txm .receipt{display:flex;align-items:center;gap:14px;padding:14px 18px;width:100%;border:0;background:none;
  text-align:left;cursor:pointer;transition:background .15s}
.txm .receipt:active{background:#F6F2ED}
.txm .receipt .rn{flex:1;min-width:0}
.txm .receipt .r1{font-size:15.5px;font-weight:600}
.txm .receipt .r2{font-size:13.5px;color:var(--ink-2);margin-top:1px}
.txm .receipt .rep{font-size:15px;font-weight:600;color:var(--tint);flex:none}

.txm .tl{padding:6px 18px 14px}
.txm .ev{display:flex;gap:14px;padding-top:14px;position:relative}
.txm .ev .dt{width:10px;display:flex;flex-direction:column;align-items:center;flex-shrink:0}
.txm .ev .dt i{width:7px;height:7px;border-radius:50%;background:var(--ink-3);margin-top:6px}
.txm .ev .dt::after{content:'';flex:1;width:1.5px;background:var(--hair);margin-top:4px}
.txm .ev:last-child .dt::after{display:none}
.txm .ev .ec{flex:1;padding-bottom:2px;min-width:0}
.txm .ev .e1{font-size:14.5px;font-weight:500;line-height:1.45}
.txm .ev .e2{font-size:12.5px;color:var(--ink-2);margin-top:2px}
.txm .ev.new .dt i{background:var(--good)}

.txm .bar{position:absolute;left:0;right:0;bottom:0;z-index:30;
  padding:12px 20px calc(14px + env(safe-area-inset-bottom));
  background:rgba(248,246,243,.82);backdrop-filter:blur(20px) saturate(1.4);
  -webkit-backdrop-filter:blur(20px) saturate(1.4);display:flex;gap:10px}
.txm .bar::before{content:'';position:absolute;left:0;right:0;top:0;height:1px;background:var(--hair);transform:scaleY(.5)}
.txm .b2{height:52px;border:0;border-radius:16px;font-size:16.5px;font-weight:600;letter-spacing:-.01em;
  cursor:pointer;display:flex;align-items:center;justify-content:center;gap:9px;
  transition:transform .18s var(--spring),background .3s,opacity .3s}
.txm .b2:active{transform:scale(.97)}
.txm .b2.ghost{background:rgba(27,23,19,.06);color:var(--ink);width:96px;flex-shrink:0}
.txm .b2.pri{flex:1;background:var(--tint);color:#fff}
.txm .b2.pri:active{background:var(--tint-press)}
.txm .b2.pri.done{background:var(--good)}
.txm .b2 .ring{width:19px;height:19px;border-radius:50%;border:2.5px solid rgba(255,255,255,.35);
  border-top-color:#fff;animation:txm-sp .7s linear infinite}
@keyframes txm-sp{to{transform:rotate(360deg)}}

.txm .scrim{position:absolute;inset:0;z-index:80;background:rgba(20,16,12,.42);opacity:0;pointer-events:none;transition:opacity .35s var(--ease)}
.txm .scrim.show{opacity:1;pointer-events:auto}
.txm .sheet{position:absolute;left:0;right:0;bottom:0;z-index:90;background:var(--bg);
  border-radius:24px 24px 0 0;padding:10px 20px calc(22px + env(safe-area-inset-bottom));
  transform:translateY(105%);transition:transform .45s var(--sheet);box-shadow:0 -10px 40px rgba(20,16,12,.18)}
.txm .sheet.show{transform:translateY(0)}
.txm .grab{width:36px;height:4.5px;border-radius:3px;background:rgba(27,23,19,.18);margin:0 auto 16px}
.txm .sheet h3{font-size:20px;font-weight:700;letter-spacing:-.02em}
.txm .sheet .sh2{font-size:14px;color:var(--ink-2);margin:4px 0 16px;line-height:1.45}
.txm .sheet .b2.pri{width:100%;margin-top:6px}
.txm .msheet .mi{display:flex;align-items:center;background:var(--card);border-radius:15px;width:100%;
  border:0;text-align:left;padding:16px 18px;margin-bottom:8px;font-size:16px;font-weight:500;cursor:pointer;
  transition:transform .15s var(--spring)}
.txm .msheet .mi:active{transform:scale(.98)}
.txm .msheet .mi.danger{color:#D0342C}

@media (prefers-reduced-motion:reduce){
  .txm *,.txm *::before,.txm *::after{animation-duration:.01ms !important;transition-duration:.01ms !important}
}
`;

export interface TxmDetailRow { label: string; value: string }
export interface TxmEvent { title: ReactNode; meta: string }
export interface TxmMenuItem { label: string; danger?: boolean; onSelect?: () => void }

export interface TxnDetailMobileProps {
  txnNo: string;
  initials: string;
  payeeLine: string;
  amount: string;
  voided: boolean;
  meta: string;
  siteChip: string | null;
  onSiteChip: (() => void) | null;
  /** One row per allocation. The reference shows a single site because its example has one;
   *  a payment split across sites repeats the same row rather than inventing a second design. */
  sites: { name: string; sub: string; amount: string }[];
  linked: boolean;
  statusTitle: string;
  statusSub: string;
  onLink: (() => void) | null;
  details: TxmDetailRow[];
  noteSource: string | null;
  noteText: string | null;
  noteRef: string | null;
  proofThumb: ReactNode | null;
  proofTitle: string;
  proofSub: string;
  onProof: (() => void) | null;
  onReplaceProof: (() => void) | null;
  replacing: boolean;
  events: TxmEvent[];
  showBar: boolean;
  canEdit: boolean;
  onEdit: () => void;
  ctaLabel: string;
  menu: TxmMenuItem[];
  deleteTitle: string;
  deleteBody: string;
  onDelete: (() => void) | null;
  deleting: boolean;
  onBack: () => void;
}

export default function TxnDetailMobile(p: TxnDetailMobileProps) {
  const [sheet, setSheet] = useState<'menu' | 'delete' | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const close = () => setSheet(null);

  // Portalled to <body> for two reasons, both of which cost real behaviour when they were not:
  //  · TransactionDetail's own `.txnx` sheet styles a lot of short class names — `.amount`,
  //    `.row`, `.note`, and a bare `.txnx button` — and every one of them reached in here while
  //    this markup sat inside that host. `.txnx .amount{text-align:left}` is what pushed the hero
  //    figure off centre. Out at <body>, nothing scoped to a page can touch this.
  //  · The layer. This page is fixed and opaque, so anything the host renders at a lower z-index
  //    is not merely behind it, it is unreachable — that is why Edit and Amend appeared dead. It
  //    now sits at 45: above the tab bar (40), below every overlay the page opens (50 and up).
  return createPortal(
    <div className="txm">
      <style>{CSS}</style>

      <div className="nav">
        <button type="button" className="nbtn" onClick={p.onBack} aria-label="Back">
          <svg width="12" height="20" viewBox="0 0 12 20" fill="none" aria-hidden="true">
            <path d="M10 2L3 10l7 8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="ntitle">Transaction<span>{p.txnNo}</span></div>
        <button type="button" className="nbtn" onClick={() => setSheet('menu')} aria-label="More actions">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
          </svg>
        </button>
      </div>

      <main>
        <div className="hero">
          <div className="avatar">{p.initials}</div>
          <div className="payee">{p.payeeLine}</div>
          <div className={`amount${p.voided ? ' void' : ''}`}>{p.amount}</div>
          <div className="meta">{p.meta}</div>
          {p.siteChip && (
            <button type="button" className="chip" onClick={p.onSiteChip ?? undefined} disabled={!p.onSiteChip}>
              <i />{p.siteChip}
            </button>
          )}
        </div>

        <div className="group alloc">
          {p.sites.map((st, i) => (
            <div className="site" key={i} style={i > 0 ? { borderTop: '1px solid var(--hair)' } : undefined}>
              <div className="n">
                <div className="nm">{st.name}</div>
                <div className="sb">{st.sub}</div>
              </div>
              <div className="amt">{st.amount}</div>
            </div>
          ))}
          <button type="button" className={`status${p.linked ? ' linked' : ''}`}
            onClick={() => { if (!p.linked && p.onLink) p.onLink(); }} disabled={p.linked || !p.onLink}>
            <span className="sd" />
            <span className="st">
              <span className="s1" style={{ display: 'block' }}>{p.statusTitle}</span>
              <span className="s2" style={{ display: 'block' }}>{p.statusSub}</span>
            </span>
            {!p.linked && p.onLink && <span className="act">Link</span>}
          </button>
        </div>

        {p.details.length > 0 && (
          <div className="sect">
            <div className="sect-h">Details</div>
            <div className="group">
              {p.details.map(d => (
                <div className="row" key={d.label}>
                  <div className="lb">{d.label}</div>
                  <div className="vl">{d.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {p.noteText && (
          <div className="sect">
            <div className="sect-h">Note</div>
            <div className="group">
              <div className={`note${noteOpen ? ' exp' : ''}`}>
                {p.noteSource && <div className="src"><i />{p.noteSource}</div>}
                <div className="txt">{p.noteText}</div>
                <button type="button" className="more" onClick={() => setNoteOpen(o => !o)}>
                  {noteOpen ? 'Show less' : 'Show more'}
                </button>
                {p.noteRef && <div className="ref">{p.noteRef}</div>}
              </div>
            </div>
          </div>
        )}

        <div className="sect">
          <div className="sect-h">Proof of payment</div>
          <div className="group">
            <div className="receipt" onClick={p.onProof ?? undefined} role={p.onProof ? 'button' : undefined}>
              {p.proofThumb}
              <div className="rn">
                <div className="r1">{p.proofTitle}</div>
                <div className="r2">{p.proofSub}</div>
              </div>
              {p.onReplaceProof && (
                <button type="button" className="rep" disabled={p.replacing}
                  onClick={(e) => { e.stopPropagation(); p.onReplaceProof?.(); }}>
                  {p.replacing ? 'Uploading…' : p.proofThumb ? 'Replace' : 'Add'}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="sect">
          <div className="sect-h">Activity</div>
          <div className="group">
            <div className="tl">
              {p.events.map((e, i) => (
                <div className="ev" key={i}>
                  <div className="dt"><i /></div>
                  <div className="ec">
                    <div className="e1">{e.title}</div>
                    <div className="e2">{e.meta}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      {p.showBar && (
        <div className="bar">
          {p.canEdit && <button type="button" className="b2 ghost" onClick={p.onEdit}>Edit</button>}
          <button type="button" className={`b2 pri${p.linked ? ' done' : ''}`}
            onClick={() => { if (!p.linked && p.onLink) p.onLink(); }} disabled={p.linked || !p.onLink}>
            <span className="txt">{p.ctaLabel}</span>
          </button>
        </div>
      )}

      <div className={`scrim${sheet ? ' show' : ''}`} onClick={close} />

      <div className={`sheet msheet${sheet === 'menu' ? ' show' : ''}`} role="dialog" aria-label="Transaction actions">
        <div className="grab" />
        {p.menu.map(m => (
          <button type="button" key={m.label} className={`mi${m.danger ? ' danger' : ''}`}
            onClick={() => { if (m.danger) setSheet('delete'); else { close(); m.onSelect?.(); } }}>
            {m.label}
          </button>
        ))}
      </div>

      <div className={`sheet${sheet === 'delete' ? ' show' : ''}`} role="dialog" aria-label={p.deleteTitle}>
        <div className="grab" />
        <h3>{p.deleteTitle}</h3>
        <p className="sh2">{p.deleteBody}</p>
        <button type="button" className="b2 pri" style={{ width: '100%', background: '#D0342C' }}
          disabled={p.deleting} onClick={() => { close(); p.onDelete?.(); }}>
          {p.deleting ? <span className="ring" aria-hidden="true" /> : <span className="txt">Delete</span>}
        </button>
        <button type="button" className="b2 ghost" style={{ width: '100%', marginTop: 8 }} onClick={close}>Cancel</button>
      </div>
    </div>,
    document.body,
  );
}
