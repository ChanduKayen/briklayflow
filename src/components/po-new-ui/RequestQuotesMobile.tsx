// The phone's vendor picker for a quote request — a faithful port of the reference design.
// Presentational: every query, the send and the vendor insert stay in RequestQuotesModal, which
// renders this in place of its own layout on a phone.
//
// Three things the reference does not draw, kept because they exist today and are wanted, each
// expressed in the reference's own components rather than new ones: the quote deadline reads as a
// second line in the bottom bar and opens a sheet of `.crow` rows; "Add a vendor" is one more `.v`
// row at the end of the list and opens a sheet built from `.numfield` and `.b2`.
import { useEffect, useRef, useState } from 'react';
import DragSheet from '../DragSheet';

export interface RqmVendor { id: string; name: string; category: string; phone: string }
export interface RqmContact { name: string; phone: string }

export interface RequestQuotesMobileProps {
  title: string;
  vendors: RqmVendor[];
  search: string;
  onSearch: (q: string) => void;
  selected: Set<string>;
  /** Tapping a vendor. Returns false when it has no number, so the sheet opens instead. */
  onToggle: (id: string) => void;
  onSaveNumber: (id: string, phone: string) => void;
  onAddVendor: (name: string, phone: string) => Promise<void> | void;
  /** Null hides the deadline line — an append send has no deadline of its own. */
  deadline: { label: string; onPick: (p: 'today' | 'tom' | '3d', custom?: string) => void } | null;
  sending: boolean;
  onSend: () => void;
  onClose: () => void;
  /** Set once the send is done — switches to the success screen. */
  done: { message: string } | null;
  onDone: () => void;
}

const RQM_CSS = `
.rqm{
  --tint:#C4502B;--tint-press:#A8431F;--ink:#1B1713;--ink-2:#87807A;--ink-3:#B5AEA7;
  --bg:#F8F6F3;--card:#FFFFFF;--hair:rgba(50,42,35,.1);--good:#2FA04C;
  --spring:cubic-bezier(.32,1.4,.5,1);--ease:cubic-bezier(.25,.1,.25,1);--sheet:cubic-bezier(.32,.72,0,1);
  position:fixed;inset:0;z-index:70;background:var(--bg);color:var(--ink);
  display:flex;flex-direction:column;overflow:hidden;
  font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Inter',system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;
}
.rqm *{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}

.rqm .hdr{padding:20px 24px 0;display:flex;align-items:center}
.rqm .title{font-size:24px;font-weight:800;letter-spacing:-.03em;flex:1}
.rqm .xbtn{
  width:36px;height:36px;border:0;border-radius:12px;background:var(--card);cursor:pointer;
  display:grid;place-items:center;color:var(--ink-2);flex-shrink:0;
  box-shadow:0 1px 6px -2px rgba(27,23,19,.12);
  transition:transform .15s var(--spring);
}
.rqm .xbtn:active{transform:scale(.88)}
.rqm .sub{font-size:13.5px;color:var(--ink-2);margin:4px 24px 0}

.rqm .search{
  display:flex;align-items:center;gap:10px;margin:14px 24px 0;
  background:var(--card);border-radius:14px;padding:0 16px;height:44px;
  transition:box-shadow .2s;
}
.rqm .search:focus-within{box-shadow:0 0 0 2px var(--tint)}
.rqm .search svg{color:var(--ink-3);flex-shrink:0}
.rqm .search input{flex:1;border:0;background:none;font:inherit;font-size:15.5px;outline:none;color:var(--ink)}
.rqm .search input::placeholder{color:var(--ink-3)}

.rqm main{flex:1;overflow-y:auto;padding:14px 24px 120px}
.rqm main::-webkit-scrollbar{display:none}
.rqm .group{background:var(--card);border-radius:18px;overflow:hidden}

.rqm .v{
  display:flex;align-items:center;gap:13px;padding:14px 18px;min-height:58px;cursor:pointer;
  position:relative;transition:background .15s;width:100%;text-align:left;border:0;background:none;font:inherit;color:inherit;
}
.rqm .v+.v::before{content:'';position:absolute;left:18px;right:0;top:0;height:1px;background:var(--hair);transform:scaleY(.5)}
.rqm .v:active{background:#F6F2ED}
.rqm .vw{flex:1;min-width:0}
.rqm .vn{font-size:15.5px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rqm .vs{font-size:13px;margin-top:2px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rqm .cb{
  width:24px;height:24px;border-radius:50%;flex-shrink:0;
  display:grid;place-items:center;color:#fff;
  opacity:0;transform:scale(.4);background:var(--tint);
  transition:all .28s var(--spring);
}
.rqm .v.sel .cb{opacity:1;transform:scale(1)}
.rqm .v.add .vn{color:var(--tint)}
.rqm .v.add .cb{opacity:1;transform:scale(1);background:transparent;color:var(--tint)}

.rqm .empty-msg{padding:34px 20px;text-align:center;font-size:14.5px;color:var(--ink-2)}

.rqm .bar{
  position:absolute;left:0;right:0;bottom:0;z-index:30;
  padding:12px 20px calc(14px + env(safe-area-inset-bottom));
  background:rgba(248,246,243,.85);backdrop-filter:blur(20px) saturate(1.4);
  -webkit-backdrop-filter:blur(20px) saturate(1.4);
  display:flex;align-items:center;gap:14px;
}
.rqm .bar::before{content:'';position:absolute;left:0;right:0;top:0;height:1px;background:var(--hair);transform:scaleY(.5)}
.rqm .barinfo{flex:1;font-size:15px;font-weight:600;color:var(--ink-2);font-variant-numeric:tabular-nums;min-width:0}
.rqm .byline{
  display:block;margin-top:2px;font-size:12.5px;font-weight:500;color:var(--tint);
  background:none;border:0;padding:0;font-family:inherit;cursor:pointer;text-align:left;
}
.rqm .send{
  height:52px;border:0;border-radius:16px;padding:0 26px;flex-shrink:0;
  background:var(--tint);color:#fff;font:inherit;font-size:16px;font-weight:600;cursor:pointer;
  display:flex;align-items:center;gap:9px;
  transition:transform .15s var(--spring),background .25s,opacity .3s;
}
.rqm .send:active{transform:scale(.96);background:var(--tint-press)}
.rqm .send:disabled{opacity:.35;pointer-events:none}
.rqm .send .ring{width:18px;height:18px;border-radius:50%;border:2.5px solid rgba(255,255,255,.35);border-top-color:#fff;animation:rqmsp .7s linear infinite}
@keyframes rqmsp{to{transform:rotate(360deg)}}

.rqm .scrim{position:absolute;inset:0;z-index:80;background:rgba(20,16,12,.42);opacity:0;pointer-events:none;transition:opacity .35s var(--ease)}
.rqm .scrim.show{opacity:1;pointer-events:auto}
.rqm .sheet{
  position:absolute;left:0;right:0;bottom:0;z-index:90;background:var(--bg);
  border-radius:24px 24px 0 0;padding:10px 20px calc(24px + env(safe-area-inset-bottom));
  transform:translateY(105%);transition:transform .45s var(--sheet);
  box-shadow:0 -10px 40px rgba(20,16,12,.18);max-height:74%;overflow-y:auto;
}
.rqm .sheet.show{transform:translateY(0)}
.rqm .grab{width:36px;height:4.5px;border-radius:3px;background:rgba(27,23,19,.18);margin:0 auto 14px}
.rqm .sheet h3{font-size:20px;font-weight:700;letter-spacing:-.02em}
.rqm .sheet .sh2{font-size:13.5px;color:var(--ink-2);margin:3px 0 16px;line-height:1.45}
.rqm .numfield{
  display:flex;align-items:center;gap:8px;background:var(--card);border-radius:14px;
  padding:0 16px;height:52px;transition:box-shadow .2s;
}
.rqm .numfield:focus-within{box-shadow:0 0 0 2px var(--tint)}
.rqm .numfield .cc{font-size:16px;font-weight:600;color:var(--ink-2);flex-shrink:0}
.rqm .numfield input{
  flex:1;border:0;background:none;font:inherit;font-size:17px;font-weight:600;outline:none;
  color:var(--ink);min-width:0;font-variant-numeric:tabular-nums;letter-spacing:.02em;
}
.rqm .numfield input::placeholder{color:var(--ink-3);font-weight:400;letter-spacing:0}
.rqm .numfield.text input{font-variant-numeric:normal;letter-spacing:0}
.rqm .orline{
  display:flex;align-items:center;gap:12px;margin:16px 0;
  font-size:12.5px;font-weight:600;color:var(--ink-3);
}
.rqm .orline::before,.rqm .orline::after{content:'';flex:1;height:1px;background:var(--hair)}
.rqm .crow{
  display:flex;align-items:center;gap:13px;padding:13px 16px;cursor:pointer;position:relative;
  background:var(--card);transition:background .15s;width:100%;text-align:left;border:0;font:inherit;color:inherit;
}
.rqm .crow:first-child{border-radius:14px 14px 0 0}
.rqm .crow:last-child{border-radius:0 0 14px 14px}
.rqm .crow:only-child{border-radius:14px}
.rqm .crow:active{background:#F6F2ED}
.rqm .crow+.crow::before{content:'';position:absolute;left:62px;right:0;top:0;height:1px;background:var(--hair);transform:scaleY(.5)}
.rqm .cav{width:36px;height:36px;border-radius:50%;flex-shrink:0;display:grid;place-items:center;
  font-size:13.5px;font-weight:700;color:#fff}
.rqm .crow .cw2{flex:1;min-width:0}
.rqm .crow .cn{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rqm .crow .cm{font-size:12.5px;color:var(--ink-2);margin-top:1px;font-variant-numeric:tabular-nums}
.rqm .crow.on .cn{color:var(--tint)}
.rqm .b2{
  width:100%;height:52px;border:0;border-radius:16px;font:inherit;font-size:16px;font-weight:600;
  color:#fff;background:var(--tint);cursor:pointer;margin-top:16px;
  transition:transform .15s var(--spring),opacity .3s;
}
.rqm .b2:active{transform:scale(.97)}
.rqm .b2:disabled{opacity:.35;pointer-events:none}

.rqm .success{
  position:absolute;inset:0;z-index:120;background:var(--bg);
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:40px 32px;text-align:center;
  opacity:0;pointer-events:none;transition:opacity .5s var(--ease);
}
.rqm .success.show{opacity:1;pointer-events:auto}
.rqm .halo{
  width:92px;height:92px;border-radius:50%;background:var(--card);
  display:grid;place-items:center;margin-bottom:24px;
  box-shadow:0 12px 32px -12px rgba(27,23,19,.16);
  transform:scale(.5);transition:transform .6s var(--spring) .12s;
}
.rqm .success.show .halo{transform:scale(1)}
.rqm .ckm path{stroke:var(--good);stroke-width:6.5;fill:none;stroke-linecap:round;stroke-linejoin:round;
  stroke-dasharray:80;stroke-dashoffset:80;transition:stroke-dashoffset .5s var(--ease) .5s}
.rqm .success.show .ckm path{stroke-dashoffset:0}
.rqm .success h2{font-size:23px;font-weight:800;letter-spacing:-.02em}
.rqm .success p{font-size:14.5px;color:var(--ink-2);margin-top:8px;line-height:1.55;max-width:290px}
.rqm .success button{
  margin-top:30px;height:52px;border:0;border-radius:16px;padding:0 28px;
  background:var(--tint);color:#fff;font:inherit;font-size:15.5px;font-weight:600;cursor:pointer;
  transition:transform .15s var(--spring);
}
.rqm .success button:active{transform:scale(.96)}

@media (prefers-reduced-motion:reduce){
  .rqm *,.rqm *::before,.rqm *::after{animation-duration:.01ms !important;transition-duration:.01ms !important}
}
`;

const fmt = (m: string) => m.replace(/(\d{5})(\d{5})/, '$1 $2');
const digits = (s: string) => s.replace(/\D/g, '');

/**
 * The browser's contact picker. It exists on Android Chrome over HTTPS and nowhere else, and it
 * never hands a page the contact LIST — it opens the phone's own picker and returns what was
 * chosen. So the reference's list of people is one row that opens that picker; where the API is
 * missing the row and its divider are not rendered at all.
 */
type ContactsManager = { select: (props: string[], opts?: { multiple?: boolean }) => Promise<{ name?: string[]; tel?: string[] }[]> };
function contactPicker(): ContactsManager | null {
  if (typeof navigator === 'undefined') return null;
  const n = navigator as Navigator & { contacts?: ContactsManager };
  return n.contacts && 'ContactsManager' in window ? n.contacts : null;
}

export default function RequestQuotesMobile(p: RequestQuotesMobileProps) {
  const [numFor, setNumFor] = useState<RqmVendor | null>(null);
  const [nsInput, setNsInput] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [adding, setAdding] = useState(false);
  const [byOpen, setByOpen] = useState(false);
  const [picked, setPicked] = useState<RqmContact | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const canPickContacts = !!contactPicker();

  // The row that was just given a number glows green for a moment, so the tap that opened the
  // sheet visibly lands back on the list it came from.
  const flashRef = useRef<string | null>(null);
  useEffect(() => {
    const id = flashRef.current;
    if (!id) return;
    flashRef.current = null;
    const el = listRef.current?.querySelector(`[data-v="${id}"]`);
    el?.animate?.([{ background: '#EAF6EE' }, { background: 'transparent' }], { duration: 1100, easing: 'ease-out' });
  });

  const openNum = (v: RqmVendor) => { setNumFor(v); setNsInput(''); setPicked(null); };
  const closeNum = () => { setNumFor(null); setPicked(null); };

  const finishNum = (m: string) => {
    if (!numFor) return;
    flashRef.current = numFor.id;
    p.onSaveNumber(numFor.id, m);
    closeNum();
  };

  const chooseContact = async () => {
    const cm = contactPicker();
    if (!cm) return;
    try {
      const [c] = await cm.select(['name', 'tel'], { multiple: false });
      const tel = digits(c?.tel?.[0] ?? '').slice(-10);
      if (!tel) return;
      setPicked({ name: c?.name?.[0] ?? '', phone: tel });
      setNsInput(tel);
    } catch { /* the picker was dismissed */ }
  };

  const n = p.selected.size;
  const sheetOpen = !!numFor || addOpen || byOpen;

  return (
    <div className="rqm">
      <style>{RQM_CSS}</style>

      <div className="hdr">
        <h1 className="title">{p.title}</h1>
        <button type="button" className="xbtn" onClick={p.onClose} aria-label="Close">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <p className="sub">Pick vendors — each gets one WhatsApp link to enter rates.</p>

      <div className="search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        <input value={p.search} onChange={(e) => p.onSearch(e.target.value)} placeholder="Search vendors" aria-label="Search vendors" />
      </div>

      <main>
        {p.vendors.length === 0
          ? <p className="empty-msg">No vendors match.</p>
          : (
            <div className="group" ref={listRef}>
              {p.vendors.map(v => (
                <button type="button" key={v.id} data-v={v.id}
                  className={`v${p.selected.has(v.id) ? ' sel' : ''}`}
                  aria-pressed={p.selected.has(v.id)}
                  onClick={() => (v.phone ? p.onToggle(v.id) : openNum(v))}>
                  <span className="vw">
                    <span className="vn" style={{ display: 'block' }}>{v.name}</span>
                    <span className="vs" style={{ display: 'block' }}>{v.category}</span>
                  </span>
                  <span className="cb">
                    <svg width="12" height="12" viewBox="0 0 20 20" fill="none"><path d="M4 10.5l4 4 8-9" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                </button>
              ))}
              <button type="button" className="v add" onClick={() => { setNewName(''); setNewPhone(''); setAddOpen(true); }}>
                <span className="vw"><span className="vn" style={{ display: 'block' }}>Add a vendor</span></span>
                <span className="cb">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                </span>
              </button>
            </div>
          )}
      </main>

      <div className="bar">
        <div className="barinfo">
          {n ? `${n} vendor${n === 1 ? '' : 's'} selected` : 'No vendors selected'}
          {p.deadline && (
            <button type="button" className="byline" onClick={() => setByOpen(true)}>Quote by {p.deadline.label}</button>
          )}
        </div>
        <button type="button" className={`send${p.sending ? ' loading' : ''}`} disabled={!n || p.sending} onClick={p.onSend}>
          {p.sending ? <span className="ring" /> : <span className="stxt">{n ? `Send to ${n}` : 'Send'}</span>}
        </button>
      </div>

      <div className={`scrim${sheetOpen ? ' show' : ''}`} onClick={() => { closeNum(); setAddOpen(false); setByOpen(false); }} />

      {/* appears only when a selected vendor has no number */}
      <DragSheet open={!!numFor} onDismiss={closeNum} className={`sheet${numFor ? ' show' : ''}`} role="dialog" aria-label="Add a number">
        <div className="grab" />
        <h3>{numFor?.name ?? 'Add a number'}</h3>
        <p className="sh2">The WhatsApp link needs a mobile number. Type it, or take it from your contacts.</p>
        <div className="numfield">
          <span className="cc">+91</span>
          <input value={nsInput} onChange={(e) => setNsInput(e.target.value)} inputMode="numeric" placeholder="Mobile number" aria-label="Mobile number" />
        </div>
        {canPickContacts && (
          <>
            <div className="orline">or from your contacts</div>
            <div>
              <button type="button" className={`crow${picked ? ' on' : ''}`} onClick={chooseContact}>
                <span className="cav" style={{ background: '#5B7A9D' }}>
                  {picked?.name ? picked.name[0] : (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="8" r="3.4" /><path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" /></svg>
                  )}
                </span>
                <span className="cw2">
                  <span className="cn" style={{ display: 'block' }}>{picked?.name || 'Choose from contacts'}</span>
                  <span className="cm" style={{ display: 'block' }}>{picked ? `+91 ${fmt(picked.phone)}` : 'Opens your phone’s contact list'}</span>
                </span>
              </button>
            </div>
          </>
        )}
        <button type="button" className="b2" disabled={digits(nsInput).length < 10} onClick={() => finishNum(digits(nsInput))}>Save &amp; select</button>
      </DragSheet>

      {/* a vendor that is not on the list yet */}
      <DragSheet open={addOpen} onDismiss={() => setAddOpen(false)} className={`sheet${addOpen ? ' show' : ''}`} role="dialog" aria-label="Add a vendor">
        <div className="grab" />
        <h3>Add a vendor</h3>
        <p className="sh2">Saved to your vendors, so you only type it once.</p>
        <div className="numfield text" style={{ marginBottom: 10 }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Vendor name" aria-label="Vendor name" />
        </div>
        <div className="numfield">
          <span className="cc">+91</span>
          <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} inputMode="numeric" placeholder="Mobile number" aria-label="Mobile number" />
        </div>
        <button type="button" className="b2" disabled={adding || !newName.trim() || digits(newPhone).length < 10}
          onClick={async () => {
            setAdding(true);
            try { await p.onAddVendor(newName.trim(), digits(newPhone)); setAddOpen(false); }
            finally { setAdding(false); }
          }}>{adding ? 'Adding…' : 'Add & select'}</button>
      </DragSheet>

      {/* when the rates are needed by */}
      {p.deadline && (
        <DragSheet open={byOpen} onDismiss={() => setByOpen(false)} className={`sheet${byOpen ? ' show' : ''}`} role="dialog" aria-label="Quote by">
          <div className="grab" />
          <h3>Quote by</h3>
          <p className="sh2">When you need their rates. Vendors can still reply after it.</p>
          <div>
            {([['today', 'Today', '6 pm'], ['tom', 'Tomorrow', '6 pm'], ['3d', 'In 3 days', '6 pm']] as const).map(([k, label, sub]) => (
              <button type="button" key={k} className="crow" onClick={() => { p.deadline!.onPick(k); setByOpen(false); }}>
                <span className="cav" style={{ background: '#8A6FB0' }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
                </span>
                <span className="cw2">
                  <span className="cn" style={{ display: 'block' }}>{label}</span>
                  <span className="cm" style={{ display: 'block' }}>{sub}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="orline">or a date</div>
          <div className="numfield text">
            <input type="date" aria-label="Quote by date"
              onChange={(e) => { if (e.target.value) { p.deadline!.onPick('3d', e.target.value); setByOpen(false); } }} />
          </div>
        </DragSheet>
      )}

      <div className={`success${p.done ? ' show' : ''}`}>
        <div className="halo">
          <svg className="ckm" width="42" height="42" viewBox="0 0 60 60"><path d="M16 31 L26 41 L45 21" /></svg>
        </div>
        <h2>Request sent</h2>
        <p>{p.done?.message}</p>
        <button type="button" onClick={p.onDone}>Done</button>
      </div>
    </div>
  );
}
