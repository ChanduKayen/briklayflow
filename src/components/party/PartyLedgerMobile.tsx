// The party ledger on a phone — a port of the reference design.
//
// Presentational. Every query, every modal and the PDF stay in StakeholderDetail, which renders
// this instead of its own layout on a phone.
//
// Activity groups the ledger the way the reference does: one row per PURCHASE — a PO with its bill
// and the payments against it folded in. A worker has no POs, so the same grammar runs on
// contracts: the contract is the row, its certified work and payments inside. Entries that belong
// to neither stand as their own row, so nothing in the ledger is hidden by the grouping.
import { useMemo, useState } from 'react';
import DragSheet from '../DragSheet';
import type { LedgerEntry, PartyLedger } from '../../lib/partyLedgerApi';

export interface PartyMenuItem { label: string; onSelect: () => void; group?: 'record' | 'party' }

export interface PartyLedgerMobileProps {
  L: PartyLedger;
  onBack: () => void;
  onRecordPayment: () => void;
  onDownloadStatement: () => void;
  onOpenRef: (ref: string) => void;      // a PO for a vendor, a contract for a worker
  onOpeningBalance: () => void;
  menu: PartyMenuItem[];
}

const PLM_CSS = `
.plm{
  --cream:#FAF7F1; --paper:#FFFEFA; --ink:#2B2219; --ink2:#75695A; --ink3:#A89B87;
  --hair:#ECE5D6; --terra:#BE5330; --sage:#54714F;
  position:fixed;inset:0;z-index:50;background:var(--cream);color:var(--ink);
  overflow-y:auto;-webkit-overflow-scrolling:touch;
  font-family:"DM Sans",-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
}
.plm *{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}

.plm .nav{position:sticky;top:0;z-index:30;display:flex;align-items:center;padding:calc(12px + env(safe-area-inset-top)) 12px 8px;
  background:color-mix(in srgb,var(--cream) 84%,transparent);
  -webkit-backdrop-filter:blur(20px) saturate(1.5);backdrop-filter:blur(20px) saturate(1.5)}
.plm .nav button{border:0;background:none;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;color:var(--ink);cursor:pointer}
.plm .nav button:active{background:rgba(43,34,25,.06)}
.plm .nav .sp{flex:1}

.plm .head{padding:4px 22px 6px}
.plm h1{font-family:"Playfair Display",Georgia,serif;font-weight:600;font-size:26px;letter-spacing:-.01em}
.plm .sub{font-size:13px;color:var(--ink3);margin-top:3px}
.plm .due{margin-top:22px}
.plm .due .n{font-family:"Playfair Display",Georgia,serif;font-weight:500;font-size:52px;letter-spacing:-.025em;line-height:1}
.plm .due .n em{font-style:normal;font-size:32px;color:var(--ink3);margin-right:6px}
.plm .due .s{margin-top:8px;font-size:14px;color:var(--ink2)}
.plm .due .s b{color:var(--sage);font-weight:600}
.plm .due .s b.owed{color:var(--terra)}

.plm .cta{display:flex;gap:8px;padding:20px 22px 4px}
.plm .btn{height:44px;border-radius:22px;border:1px solid var(--hair);background:var(--paper);
  font:500 14px "DM Sans",sans-serif;color:var(--ink);cursor:pointer;padding:0 18px;
  display:inline-flex;align-items:center;gap:7px;transition:transform .12s}
.plm .btn:active{transform:scale(.96)}
.plm .btn.dark{background:var(--ink);color:var(--cream);border-color:var(--ink);flex:1;justify-content:center}
.plm .btn svg{width:15px;height:15px;fill:none;stroke:currentColor}

.plm .searchbar{padding:10px 22px 0}
.plm .searchbar input{width:100%;height:40px;border-radius:20px;border:1px solid var(--hair);background:var(--paper);
  padding:0 16px;font:400 14.5px "DM Sans",sans-serif;color:var(--ink);outline:none}
.plm .searchbar input:focus{border-color:var(--terra)}

.plm .switch{position:sticky;top:calc(60px + env(safe-area-inset-top));z-index:25;display:flex;align-items:center;gap:10px;padding:14px 22px 10px;
  background:color-mix(in srgb,var(--cream) 84%,transparent);
  -webkit-backdrop-filter:blur(20px) saturate(1.5);backdrop-filter:blur(20px) saturate(1.5)}
.plm .tabs{display:flex;gap:18px;flex:1}
.plm .tabs button{border:0;background:none;font:600 15px "DM Sans",sans-serif;color:var(--ink3);cursor:pointer;
  padding:4px 0;position:relative;transition:color .2s}
.plm .tabs button.on{color:var(--ink)}
.plm .tabs button.on::after{content:"";position:absolute;left:0;right:0;bottom:-3px;height:2.5px;border-radius:2px;background:var(--terra)}
.plm .filter{border:1px solid var(--hair);background:var(--paper);height:32px;border-radius:16px;padding:0 12px;
  font:500 13px "DM Sans",sans-serif;color:var(--ink2);cursor:pointer;display:inline-flex;align-items:center;gap:6px;max-width:46%}
.plm .filter span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.plm .filter svg{width:11px;height:11px;flex:none;fill:none;stroke:currentColor}

.plm .list{padding:4px 14px 60px}
.plm .dayhead{padding:16px 8px 8px;font-size:13px;font-weight:600;color:var(--ink2)}
.plm .empty{padding:40px 12px;text-align:center;font-size:14px;color:var(--ink3)}

.plm .card{background:var(--paper);border:1px solid var(--hair);border-radius:18px;overflow:hidden}
.plm .p{display:flex;align-items:center;gap:14px;padding:16px;cursor:pointer;position:relative;transition:background .15s;
  width:100%;text-align:left;border:0;background:none;font:inherit;color:inherit}
.plm .p:active{background:rgba(43,34,25,.04)}
.plm .p + .p::before{content:"";position:absolute;top:0;left:16px;right:16px;height:1px;background:var(--hair)}
.plm .p .l{flex:1;min-width:0}
.plm .p .site{font-size:15px;font-weight:600;letter-spacing:-.005em}
.plm .p .meta{margin-top:3px;font-size:12.5px;color:var(--ink3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.plm .p .r{text-align:right;flex:none}
.plm .p .amt{font-family:"DM Mono",ui-monospace,monospace;font-size:15.5px;font-weight:500;font-variant-numeric:tabular-nums}
.plm .p .st{margin-top:3px;font-size:12px;font-weight:500;display:flex;align-items:center;justify-content:flex-end;gap:4px}
.plm .st.ok{color:var(--sage)}
.plm .st.due{color:var(--terra);font-weight:600}
.plm .st.wait{color:var(--ink3)}
.plm .st svg{width:12px;height:12px;fill:none;stroke:currentColor}
.plm .p.opening .site{font-weight:500;color:var(--ink2)}
.plm .p.opening .amt{color:var(--terra);font-family:"DM Sans",sans-serif;font-weight:600;font-size:13.5px}

.plm .stmt{background:var(--paper);border:1px solid var(--hair);border-radius:18px;overflow:hidden}
.plm .monthbar{display:flex;justify-content:space-between;align-items:baseline;padding:12px 16px;
  background:rgba(43,34,25,.035);font-size:12.5px;font-weight:600;color:var(--ink2)}
.plm .monthbar .r{font-family:"DM Mono",ui-monospace,monospace;font-weight:400;font-size:11.5px;color:var(--ink3);font-variant-numeric:tabular-nums}
.plm .cols{display:grid;grid-template-columns:42px 1fr 64px 64px;gap:8px;padding:10px 14px 8px;
  font-size:11px;font-weight:600;color:var(--ink3);border-bottom:1px solid var(--hair)}
.plm .cols span:nth-child(n+3){text-align:right}
.plm .sr{display:grid;grid-template-columns:42px 1fr 64px 64px;gap:8px;padding:13px 14px;position:relative;cursor:pointer;transition:background .15s;
  width:100%;text-align:left;border:0;background:none;font:inherit;color:inherit}
.plm .sr:active{background:rgba(43,34,25,.04)}
.plm .sr + .sr::before{content:"";position:absolute;top:0;left:14px;right:14px;height:1px;background:var(--hair)}
.plm .sr .dt{font-size:11.5px;color:var(--ink3);padding-top:2px;line-height:1.3}
.plm .sr .what{font-size:13.5px;font-weight:500;line-height:1.3;min-width:0}
.plm .sr .who{font-size:11.5px;color:var(--ink3);margin-top:2px;line-height:1.4;overflow:hidden;text-overflow:ellipsis}
.plm .sr .po-ref{font-family:"DM Mono",ui-monospace,monospace;font-size:10.5px;color:var(--ink3);margin-top:2px}
.plm .sr .tagline{margin-top:4px}
.plm .sr .tag{display:inline-block;font-size:10px;font-weight:600;color:var(--sage);background:rgba(84,113,79,.1);
  border-radius:5px;padding:2px 6px}
.plm .sr .num{font-family:"DM Mono",ui-monospace,monospace;font-size:12.5px;text-align:right;font-variant-numeric:tabular-nums;
  color:var(--ink);padding-top:2px}
.plm .sr .num.dim{color:var(--ink3)}
.plm .sr .num .bal{display:block;font-size:10.5px;color:var(--ink3);margin-top:3px}
.plm .sr.ob .what{color:var(--ink2)}
.plm .sr.ob .add{color:var(--terra);font-weight:600;font-size:12.5px;text-decoration:underline;text-underline-offset:2px}

.plm .scrim{position:fixed;inset:0;background:rgba(43,34,25,.34);z-index:60;opacity:0;pointer-events:none;transition:opacity .26s}
.plm .scrim.show{opacity:1;pointer-events:auto}
.plm .sheet{position:fixed;left:50%;bottom:0;transform:translate(-50%,105%);width:100%;max-width:430px;z-index:61;
  background:var(--paper);border-radius:24px 24px 0 0;box-shadow:0 -14px 44px rgba(43,34,25,.2);
  transition:transform .34s cubic-bezier(.32,.72,.25,1);
  padding:10px 22px calc(24px + env(safe-area-inset-bottom));max-height:84dvh;overflow-y:auto}
.plm .sheet.show{transform:translate(-50%,0)}
.plm .grab{width:36px;height:4px;border-radius:2px;background:var(--hair);margin:4px auto 18px}
.plm .sh-site{font-size:14px;font-weight:600;color:var(--ink2)}
.plm .sh-amt{font-family:"Playfair Display",Georgia,serif;font-size:40px;font-weight:500;letter-spacing:-.02em;margin-top:6px}
.plm .sh-state{margin-top:6px;font-size:14px;font-weight:500}
.plm .sh-state.ok{color:var(--sage)} .plm .sh-state.due{color:var(--terra)} .plm .sh-state.wait{color:var(--ink3)}
.plm .tl{margin-top:22px}
.plm .tl .e{display:flex;gap:14px;position:relative;padding-bottom:20px}
.plm .tl .e:last-child{padding-bottom:0}
.plm .tl .e::before{content:"";position:absolute;left:5.5px;top:16px;bottom:2px;width:1.5px;background:var(--hair)}
.plm .tl .e:last-child::before{display:none}
.plm .tl .d{width:12px;height:12px;border-radius:50%;border:2.5px solid var(--sage);background:var(--paper);flex:none;margin-top:3px}
.plm .tl .d.hollow{border-color:var(--ink3)}
.plm .tl .tx{flex:1}
.plm .tl .t1{font-size:14.5px;font-weight:500;display:flex;justify-content:space-between;gap:12px}
.plm .tl .t1 .m{font-family:"DM Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}
.plm .tl .t2{font-size:12.5px;color:var(--ink3);margin-top:2px}
.plm .sh-acts{display:flex;gap:8px;margin-top:24px}
.plm .sh-acts .btn{flex:1;justify-content:center;height:46px}
.plm .sh-menu button{display:block;width:100%;text-align:left;border:0;background:none;font:500 15px "DM Sans",sans-serif;
  color:var(--ink);padding:14px 4px;border-bottom:1px solid var(--hair);cursor:pointer}
.plm .sh-menu button:last-child{border-bottom:0}
.plm .sh-menu .grp{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ink3);padding:14px 4px 4px}

@media (prefers-reduced-motion:reduce){.plm *{transition:none!important}}
`;

const fmt = (n: number) => '₹' + Math.round(Math.abs(n)).toLocaleString('en-IN');
const dayLabel = (iso: string | null) => {
  if (!iso) return 'Before Briklay';
  const d = new Date(iso); if (isNaN(d.getTime())) return '—';
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  const diff = Math.round((t.getTime() - dd.getTime()) / 86400000);
  const nice = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });
  return diff === 0 ? `Today, ${nice}` : diff === 1 ? `Yesterday, ${nice}` : nice;
};
const shortDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const timeOf = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const Check = () => <svg viewBox="0 0 20 20" fill="none"><path d="m4.5 10.5 3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/** A purchase (vendor) or a contract (worker): the reference's row, with its entries folded in. */
interface Grp {
  key: string; ref: string | null;
  title: string; siteId: string | null;
  date: string | null; billed: number; paid: number;
  entries: LedgerEntry[];
}

export default function PartyLedgerMobile(p: PartyLedgerMobileProps) {
  const { L } = p;
  const [tab, setTab] = useState<'activity' | 'statement'>('activity');
  const [site, setSite] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [searchOn, setSearchOn] = useState(false);
  const [openGrp, setOpenGrp] = useState<Grp | null>(null);
  const [sheet, setSheet] = useState<'none' | 'sites' | 'menu' | 'opening'>('none');

  const isVendor = L.kind === 'vendor';

  const entries = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return L.entries.filter(e => e.kind !== 'start')
      .filter(e => !site || e.projectId === site)
      .filter(e => !needle || `${e.particulars} ${e.detail ?? ''} ${e.projectName ?? ''} ${e.contractId ?? ''} ${e.paid || e.cert}`.toLowerCase().includes(needle));
  }, [L.entries, site, q]);

  // One row per purchase / contract; anything with no reference keeps its own row.
  const groups = useMemo<Grp[]>(() => {
    const byKey = new Map<string, Grp>();
    const out: Grp[] = [];
    for (const e of entries) {
      const ref = e.kind === 'bill' && e.id.startsWith('bill-') ? e.id.slice(5) : e.contractId;
      const key = ref ? `r:${ref}` : `e:${e.id}`;
      let g = byKey.get(key);
      if (!g) {
        g = { key, ref: ref ?? null, title: e.projectName || e.particulars, siteId: e.projectId,
              date: e.date, billed: 0, paid: 0, entries: [] };
        byKey.set(key, g); out.push(g);
      }
      g.billed += e.cert; g.paid += e.paid;
      g.entries.push(e);
      if (e.date && (!g.date || e.date > g.date)) g.date = e.date;
      if (!g.title || g.title === e.particulars) g.title = e.projectName || g.title;
    }
    return out;
  }, [entries]);

  const stateOf = (g: Grp) => {
    if (g.billed > 0 && g.paid + 0.5 >= g.billed) return { cls: 'ok', txt: 'Settled', tick: true };
    if (g.billed > 0) return { cls: 'due', txt: `${fmt(g.billed - g.paid)} due`, tick: false };
    if (g.paid > 0) return { cls: 'wait', txt: isVendor ? 'Bill pending' : 'Not certified', tick: false };
    return { cls: 'wait', txt: '—', tick: false };
  };

  // Day headings over the grouped rows, newest first.
  const days = useMemo(() => {
    const m = new Map<string, Grp[]>();
    for (const g of groups) {
      const k = g.date ? g.date.slice(0, 10) : '';
      (m.get(k) ?? m.set(k, []).get(k)!).push(g);
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [groups]);

  const siteName = site ? (L.sites.find(s => s.projectId === site)?.projectName ?? 'One site') : 'All sites';
  const due = isVendor ? L.toPay : Math.max(0, L.totalCert - L.totalPaid);
  const closeSheet = () => { setSheet('none'); setOpenGrp(null); };
  const anySheet = sheet !== 'none' || !!openGrp;

  return (
    <div className="plm">
      <style>{PLM_CSS}</style>

      <div className="nav">
        <button type="button" onClick={p.onBack} aria-label="Back">
          <svg width="19" height="19" viewBox="0 0 20 20" fill="none"><path d="M12.5 4.5 7 10l5.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <span className="sp" />
        <button type="button" onClick={() => { setSearchOn(s => !s); if (searchOn) setQ(''); }} aria-label="Search">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.7" /><path d="m13.5 13.5 3.5 3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
        </button>
        <button type="button" onClick={() => setSheet('menu')} aria-label="More">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><circle cx="4" cy="10" r="1.6" /><circle cx="10" cy="10" r="1.6" /><circle cx="16" cy="10" r="1.6" /></svg>
        </button>
      </div>

      <div className="head">
        <h1>{L.stakeholder.name}</h1>
        <div className="sub">{[L.stakeholder.category, L.stakeholder.id].filter(Boolean).join(' · ')}</div>
        <div className="due">
          <div className="n"><em>₹</em>{Math.round(due).toLocaleString('en-IN')}</div>
          <div className="s">
            {due > 0
              ? <><b className="owed">{fmt(due)} to pay.</b> {fmt(L.totalPaid)} paid so far.</>
              : L.advance > 0
                ? <><b>Paid ahead.</b> {fmt(L.advance)} sits with them as an advance.</>
                : <><b>All settled.</b> {fmt(L.totalPaid)} paid, every rupee billed.</>}
          </div>
        </div>
      </div>

      <div className="cta">
        <button type="button" className="btn dark" onClick={p.onRecordPayment}>Record payment</button>
        <button type="button" className="btn" onClick={p.onDownloadStatement}>
          <svg width="15" height="15" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>Statement
        </button>
      </div>

      {searchOn && (
        <div className="searchbar">
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search site, order, amount" aria-label="Search entries" />
        </div>
      )}

      <div className="switch">
        <div className="tabs">
          <button type="button" className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}>Activity</button>
          <button type="button" className={tab === 'statement' ? 'on' : ''} onClick={() => setTab('statement')}>Statement</button>
        </div>
        <button type="button" className="filter" onClick={() => setSheet('sites')}>
          <span>{siteName}</span>
          <svg viewBox="0 0 20 20"><path d="m5 8 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>

      <div className="list">
        {tab === 'activity' ? (
          groups.length === 0 ? <p className="empty">Nothing here yet.</p> : (
            <>
              {days.map(([k, gs]) => (
                <div key={k || 'none'}>
                  <div className="dayhead">{dayLabel(gs[0].date)}</div>
                  <div className="card">
                    {gs.map(g => {
                      const s = stateOf(g);
                      return (
                        <button type="button" key={g.key} className="p" onClick={() => setOpenGrp(g)}>
                          <span className="l">
                            <span className="site" style={{ display: 'block' }}>{g.title || 'Entry'}</span>
                            <span className="meta" style={{ display: 'block' }}>
                              {[g.ref, g.entries.find(e => e.mode)?.mode].filter(Boolean).join(' · ') || g.entries[0]?.particulars}
                            </span>
                          </span>
                          <span className="r">
                            <span className="amt" style={{ display: 'block' }}>{fmt(g.billed || g.paid)}</span>
                            <span className={`st ${s.cls}`}>{s.tick && <Check />}{s.txt}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="dayhead">Before Briklay</div>
              <div className="card">
                <button type="button" className="p opening" onClick={p.onOpeningBalance}>
                  <span className="l">
                    <span className="site" style={{ display: 'block' }}>Old balance with {L.stakeholder.name.split(' ')[0]}</span>
                    <span className="meta" style={{ display: 'block' }}>
                      {L.opening ? `As of ${shortDate(L.opening.asOf)} · ${fmt(L.opening.total)}` : 'Anything owed before Briklay · none recorded'}
                    </span>
                  </span>
                  <span className="r"><span className="amt" style={{ display: 'block' }}>{L.opening ? fmt(L.opening.total) : 'Add'}</span></span>
                </button>
              </div>
            </>
          )
        ) : (
          <div className="stmt">
            <div className="monthbar">
              <span>{entries[0]?.date ? new Date(entries[0].date).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : 'Statement'}</span>
              <span className="r">{entries.filter(e => e.kind === 'payment').length} payments · {entries.filter(e => e.kind === 'bill' || e.kind === 'certified' || e.kind === 'wage').length} bills</span>
            </div>
            <div className="cols"><span>Date</span><span>Particulars</span><span>Paid</span><span>Billed</span></div>
            {entries.map(e => (
              <button type="button" key={e.id} className="sr" onClick={() => { const g = groups.find(x => x.entries.includes(e)); if (g) setOpenGrp(g); }}>
                <span className="dt">{shortDate(e.date)}</span>
                <span>
                  <span className="what" style={{ display: 'block' }}>{e.particulars}</span>
                  {(e.mode || e.projectName) && <span className="who" style={{ display: 'block' }}>{[e.mode, e.projectName].filter(Boolean).join(' · ')}</span>}
                  {e.contractId && <span className="po-ref" style={{ display: 'block' }}>for {e.contractId}</span>}
                  {e.kind === 'payment' && !e.unbilled && e.contractId && (
                    <span className="tagline" style={{ display: 'block' }}><span className="tag">{isVendor ? 'Billed on a PO' : 'On a contract'}</span></span>
                  )}
                </span>
                <span className={`num${e.paid ? '' : ' dim'}`}>{e.paid ? Math.round(e.paid).toLocaleString('en-IN') : '—'}</span>
                <span className={`num${e.cert ? '' : ' dim'}`}>
                  {e.cert ? Math.round(e.cert).toLocaleString('en-IN') : '—'}
                  <span className="bal">bal {Math.round(Math.abs(e.running)).toLocaleString('en-IN')}</span>
                </span>
              </button>
            ))}
            <button type="button" className="sr ob" onClick={p.onOpeningBalance}>
              <span className="dt">{L.opening ? shortDate(L.opening.asOf) : '—'}</span>
              <span>
                <span className="what" style={{ display: 'block' }}>Opening balance {!L.opening && <span className="add">Add</span>}</span>
                <span className="who" style={{ display: 'block' }}>{L.opening ? (L.opening.direction === 'work_owed' ? 'Owed to them' : 'Paid ahead') : 'None recorded'}</span>
              </span>
              <span className="num dim">—</span>
              <span className="num dim">{L.opening ? Math.round(L.opening.total).toLocaleString('en-IN') : '0'}</span>
            </button>
          </div>
        )}
      </div>

      <div className={`scrim${anySheet ? ' show' : ''}`} onClick={closeSheet} />

      {/* one purchase / contract, opened */}
      <DragSheet open={!!openGrp} onDismiss={closeSheet} className={`sheet${openGrp ? ' show' : ''}`} role="dialog" aria-label="Entry">
        <div className="grab" />
        {openGrp && (() => {
          const s = stateOf(openGrp);
          return (
            <>
              <div className="sh-site">{openGrp.title}</div>
              <div className="sh-amt">{fmt(openGrp.billed || openGrp.paid)}</div>
              <div className={`sh-state ${s.cls}`}>{s.txt}{s.cls === 'ok' ? ' · nothing left on this purchase' : ''}</div>
              <div className="tl">
                {openGrp.entries.map(e => (
                  <div className="e" key={e.id}>
                    <div className={`d${e.paid ? '' : ' hollow'}`} />
                    <div className="tx">
                      <div className="t1"><span>{e.paid ? `Paid${e.mode ? ' via ' + e.mode : ''}` : e.particulars}</span><span className="m">{fmt(e.paid || e.cert)}</span></div>
                      <div className="t2">{[timeOf(e.date), openGrp.ref ? `on ${openGrp.ref}` : e.projectName].filter(Boolean).join(' · ')}</div>
                    </div>
                  </div>
                ))}
              </div>
              {openGrp.ref && (
                <div className="sh-acts">
                  <button type="button" className="btn dark" onClick={() => { const r = openGrp.ref!; closeSheet(); p.onOpenRef(r); }}>
                    {isVendor ? 'Open PO' : 'Open contract'}
                  </button>
                </div>
              )}
            </>
          );
        })()}
      </DragSheet>

      {/* which site */}
      <DragSheet open={sheet === 'sites'} onDismiss={closeSheet} className={`sheet${sheet === 'sites' ? ' show' : ''}`} role="dialog" aria-label="Sites">
        <div className="grab" />
        <div className="sh-menu">
          <button type="button" onClick={() => { setSite(null); closeSheet(); }}>All sites</button>
          {L.sites.map(s => (
            <button type="button" key={s.projectId} onClick={() => { setSite(s.projectId); closeSheet(); }}>{s.projectName}</button>
          ))}
        </div>
      </DragSheet>

      {/* everything that is not recording a payment */}
      <DragSheet open={sheet === 'menu'} onDismiss={closeSheet} className={`sheet${sheet === 'menu' ? ' show' : ''}`} role="dialog" aria-label="More">
        <div className="grab" />
        <div className="sh-menu">
          {p.menu.some(m => m.group !== 'party') && <div className="grp">Record</div>}
          {p.menu.filter(m => m.group !== 'party').map(m => (
            <button type="button" key={m.label} onClick={() => { closeSheet(); m.onSelect(); }}>{m.label}</button>
          ))}
          {p.menu.some(m => m.group === 'party') && <div className="grp">Party</div>}
          {p.menu.filter(m => m.group === 'party').map(m => (
            <button type="button" key={m.label} onClick={() => { closeSheet(); m.onSelect(); }}>{m.label}</button>
          ))}
        </div>
      </DragSheet>
    </div>
  );
}
