// Site-Cash Wallet — the "wallet rail" on the Transactions page. A faithful port of the reference design
// (briklay-wallets-v5.html): a sticky bar with a tonal meter + a total, expanding into a drawer of
// tonal-ladder cards, a give-a-wallet tile, and a peek (cash-book) drawer. Wired to the real walletApi.
// All CSS is scoped under .wrail-root so nothing else on the page is touched.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  loadWallets, loadWalletLedger, loadAssignableMembers, createWallet, issueFloat, returnCash,
  type WalletBalance, type WalletLedgerLine,
} from '../../lib/walletApi';

const inr = (n: number) => Math.round(Math.abs(Number(n) || 0)).toLocaleString('en-IN');
const ini = (n: string) => n.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const fmtDay = (d: string | null) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'long' }).replace(',', ' ·') : '';

// The tonal ladder — one warm family, stepped by how much is held (deepest = most cash).
const LADDER = [
  { tone: '#9E4A26', grad: 'linear-gradient(146deg,rgba(158,74,38,.24) 0%,rgba(196,112,68,.09) 34%,#FCF8F1 70%)', gradHi: 'linear-gradient(146deg,rgba(158,74,38,.31) 0%,rgba(196,112,68,.13) 40%,#FCF8F1 78%)', glow: 'rgba(158,74,38,.13)' },
  { tone: '#B76A41', grad: 'linear-gradient(202deg,rgba(183,106,65,.21) 0%,rgba(208,146,102,.07) 40%,#FCF8F1 74%)', gradHi: 'linear-gradient(202deg,rgba(183,106,65,.28) 0%,rgba(208,146,102,.11) 46%,#FCF8F1 82%)', glow: 'rgba(183,106,65,.12)' },
  { tone: '#C08A59', grad: 'linear-gradient(118deg,rgba(192,138,89,.22) 0%,rgba(216,180,132,.07) 38%,#FCF8F1 72%)', gradHi: 'linear-gradient(118deg,rgba(192,138,89,.29) 0%,rgba(216,180,132,.11) 44%,#FCF8F1 80%)', glow: 'rgba(192,138,89,.11)' },
  { tone: '#A38B67', grad: 'linear-gradient(168deg,rgba(163,139,103,.19) 0%,rgba(190,172,138,.06) 42%,#FCF8F1 76%)', gradHi: 'linear-gradient(168deg,rgba(163,139,103,.25) 0%,rgba(190,172,138,.10) 48%,#FCF8F1 84%)', glow: 'rgba(163,139,103,.10)' },
  { tone: '#9B8E7B', grad: 'linear-gradient(224deg,rgba(155,142,123,.17) 0%,#FCF8F1 66%)', gradHi: 'linear-gradient(224deg,rgba(155,142,123,.23) 0%,#FCF8F1 74%)', glow: 'rgba(155,142,123,.09)' },
];
const SETTLED = { tone: '#BCB0A0', grad: 'linear-gradient(158deg,rgba(138,146,152,.055) 0%,#FCF8F1 48%)', gradHi: 'linear-gradient(158deg,rgba(138,146,152,.075) 0%,#FCF8F1 54%)', glow: 'rgba(43,33,26,.045)' };

type Tone = typeof SETTLED;
interface WCard extends WalletBalance { role: string; note: string; tone: Tone }

export default function WalletRail({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const { data: wallets = [] } = useQuery({ queryKey: ['wallets', orgId], queryFn: () => loadWallets(orgId), enabled: !!orgId });
  const { data: members = [] } = useQuery({ queryKey: ['wallet_members', orgId], queryFn: () => loadAssignableMembers(orgId), enabled: !!orgId });
  const [open, setOpen] = useState(false);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [giving, setGiving] = useState(false);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [lit, setLit] = useState<string | null>(null);
  const totRef = useRef<HTMLDivElement>(null);

  const roleOf = useMemo(() => { const m = new Map(members.map(x => [x.userId, x.role])); return (uid: string | null) => (uid && m.get(uid) ? cap(m.get(uid)!) : 'Site cash'); }, [members]);

  // Rank live wallets by balance for the tonal ladder; settled get the silver tone.
  const cards: WCard[] = useMemo(() => {
    const live = wallets.filter(w => w.balance > 0).sort((a, b) => b.balance - a.balance);
    const toneOf = new Map<string, Tone>();
    live.forEach((w, i) => toneOf.set(w.walletId, LADDER[Math.min(i, LADDER.length - 1)]));
    wallets.filter(w => w.balance <= 0).forEach(w => toneOf.set(w.walletId, SETTLED));
    return wallets.map(w => {
      const used = Math.max(0, w.totalIn - w.balance);
      const note = w.balance <= 0 ? 'Settled' : used > 0 ? `₹${inr(used)} used` : 'Nothing spent yet';
      return { ...w, role: roleOf(w.holderUserId), note, tone: toneOf.get(w.walletId) || SETTLED };
    });
  }, [wallets, roleOf]);

  const live = cards.filter(w => w.balance > 0);
  const settledCount = cards.length - live.length;
  const total = cards.reduce((s, w) => s + w.balance, 0);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['wallets', orgId] }); qc.invalidateQueries({ queryKey: ['wallet_ledger'] }); qc.invalidateQueries({ queryKey: ['ledger'] }); };
  const showToast = (m: string) => { setToast(m); window.clearTimeout((showToast as any)._x); (showToast as any)._x = window.setTimeout(() => setToast(null), 2800); };

  // Nothing yet and can't create → render nothing.
  if (!wallets.length && !canManage) return null;

  const peekWallet = cards.find(w => w.walletId === peekId) || null;

  const onGiven = (fresh: string | null, msg: string) => { setFreshId(fresh); refresh(); showToast(msg); window.setTimeout(() => setFreshId(null), 1000); };

  return (
    <div className="wrail-root">
      <style>{CSS}</style>
      <div className={`rail${open ? ' open' : ''}`}>
        <div className="wrap">
          <div className="bar" role="button" tabIndex={0} aria-expanded={open}
            onClick={(e) => { if ((e.target as HTMLElement).closest('.give,.seg')) return; setOpen(o => !o); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}>
            <div className="total">
              <div className="fig mono" ref={totRef}><span className="r">₹</span>{inr(total)}</div>
              <div className="cap">{live.length ? `held in ${live.length} wallet${live.length > 1 ? 's' : ''}` : 'no cash out'}</div>
            </div>
            <div className="meter">
              <div className="track">
                {live.length ? live.map(w => (
                  <div key={w.walletId} className={`seg${lit === w.walletId ? ' lit' : ''}`} style={{ background: w.tone.tone, flex: w.balance } as any}
                    onMouseEnter={() => setLit(w.walletId)} onMouseLeave={() => setLit(null)}
                    onClick={(e) => { e.stopPropagation(); setOpen(true); setPeekId(w.walletId); }} />
                )) : <div className="seg" style={{ background: 'rgba(242,233,220,.1)', flex: 1 }} />}
              </div>
              <div className="legend">
                {live.slice(0, 4).map(w => (
                  <span key={w.walletId} onMouseEnter={() => setLit(w.walletId)} onMouseLeave={() => setLit(null)} style={{ color: lit === w.walletId ? '#F2E9DC' : undefined }}>
                    <i className="pip" style={{ background: w.tone.tone }} /><b>{w.holderName.split(' ')[0]}</b> <i>₹{inr(w.balance)}</i>
                  </span>
                ))}
                {settledCount > 0 && <span style={{ opacity: .55 }}>{settledCount} settled</span>}
              </div>
            </div>
            <div className="right">
              {canManage && <button className="give" onClick={(e) => { e.stopPropagation(); setOpen(true); setGiving(true); }}><span className="p">+</span> Give a wallet</button>}
              <div className="chev"><svg width="13" height="8" viewBox="0 0 13 8" fill="none"><path d="M1 1.5 6.5 6.5 12 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></div>
            </div>
          </div>
          <div className="drawer"><div className="din"><div className="tray">
            <div className="cards">
              {cards.map((w, i) => {
                const pct = w.totalIn ? Math.round(w.balance / w.totalIn * 100) : 0;
                return (
                  <button key={w.walletId} className={`card${w.balance <= 0 ? ' zero' : ''}${freshId === w.walletId ? ' fresh' : ''}`}
                    style={{ ['--i' as any]: i, ['--tone' as any]: w.tone.tone, ['--grad' as any]: w.tone.grad, ['--grad-hi' as any]: w.tone.gradHi, ['--glow' as any]: w.tone.glow }}
                    onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.style.setProperty('--mx', (e.clientX - r.left) + 'px'); e.currentTarget.style.setProperty('--my', (e.clientY - r.top) + 'px'); }}
                    onClick={(e) => { if ((e.target as HTMLElement).closest('[data-give]')) { e.stopPropagation(); setPeekId(w.walletId); return; } setPeekId(w.walletId); }}>
                    <div className="head"><div className="av" style={{ background: w.tone.tone }}>{ini(w.holderName)}</div>
                      <div style={{ minWidth: 0 }}><div className="nm">{w.holderName}</div><div className="role">{w.role}</div></div></div>
                    <div className="bal mono"><span className="r">₹</span>{inr(w.balance)}</div>
                    <div className="burn"><i style={{ ['--w' as any]: pct + '%', background: w.tone.tone }} /></div>
                    <div className="note">{w.balance < 0 ? 'Spent beyond float' : w.note}</div>
                    {canManage && <div className="acts"><span className="chip" data-give style={{ ['--tone' as any]: w.tone.tone }}>Give cash</span></div>}
                  </button>
                );
              })}
              {canManage && <GiveTile members={members} existing={wallets} orgId={orgId} forming={giving} setForming={setGiving} onGiven={onGiven} />}
            </div>
          </div></div></div>
        </div>
      </div>

      {peekWallet && <Peek wallet={peekWallet} orgId={orgId} canManage={canManage} onClose={() => setPeekId(null)} onChanged={(m) => { refresh(); if (m) showToast(m); }} />}
      <div className={`toast${toast ? ' on' : ''}`}><span className="sg" /><span>{toast}</span></div>
    </div>
  );
}

// ── give-a-wallet tile: pick a member + amount → create the wallet AND issue the float in one step ──
function GiveTile({ members, existing, orgId, forming, setForming, onGiven }: {
  members: { userId: string; name: string; role: string }[]; existing: WalletBalance[]; orgId: string;
  forming: boolean; setForming: (v: boolean) => void; onGiven: (fresh: string | null, msg: string) => void;
}) {
  const have = new Set(existing.map(w => w.holderUserId).filter(Boolean));
  const options = members.filter(m => !have.has(m.userId));
  const [pick, setPick] = useState('');
  const [amt, setAmt] = useState('');
  const [done, setDone] = useState<{ name: string; v: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const amtRef = useRef<HTMLInputElement>(null);
  const v = parseInt((amt || '').replace(/\D/g, ''), 10) || 0;
  const valid = !!pick && v > 0;
  useEffect(() => { if (forming) setTimeout(() => amtRef.current?.focus(), 120); }, [forming]);

  const cancel = () => { setForming(false); setPick(''); setAmt(''); };
  const submit = async () => {
    if (!valid || busy) return; setBusy(true);
    const m = options.find(o => o.userId === pick)!;
    try {
      const w = await createWallet({ orgId, holderUserId: m.userId, holderName: m.name });
      await issueFloat({ orgId, walletId: w.walletId, amount: v, date: new Date().toISOString().slice(0, 10), mode: 'Cash', note: 'Wallet opened' });
      setDone({ name: m.name, v });
      window.setTimeout(() => { setForming(false); setDone(null); setPick(''); setAmt(''); onGiven(w.walletId, `₹${inr(v)} given to ${m.name}`); }, 1100);
    } catch { setBusy(false); }
  };

  return (
    <div className={`tile${forming ? ' forming' : ''}${done ? ' done' : ''}`}>
      <div className="prompt" onClick={() => options.length && setForming(true)}>
        <div className="ring">+</div><div className="t1">Give a wallet</div>
        <div className="t2">{options.length ? 'Hand cash to someone and track what they spend.' : 'Everyone already has a wallet.'}</div>
      </div>
      <div className="form">
        <div className="lbl">Who is holding it</div>
        <div className="parties">{options.map(m => <button key={m.userId} className={`party${pick === m.userId ? ' on' : ''}`} onClick={() => setPick(m.userId)}>{m.name}</button>)}</div>
        <div className="lbl">Amount</div>
        <div className="amt"><span className="r">₹</span><input ref={amtRef} inputMode="numeric" placeholder="0" value={amt} onChange={e => setAmt(e.target.value)} /></div>
        <div className="quick">{[10000, 25000, 50000].map(q => <button key={q} onClick={() => setAmt(inr((v || 0) + q))}>+{inr(q)}</button>)}</div>
        <button className="solid" disabled={!valid || busy} onClick={submit}>{v > 0 ? `Give ₹${inr(v)}` : 'Give cash'}</button>
        <button className="cancel" onClick={cancel}>Cancel</button>
      </div>
      <div className="doneIn">
        <svg className="tick" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18.5" /><path d="M12 20.5l5.5 5.5L28 14.5" /></svg>
        <div className="d1">₹{done ? inr(done.v) : 0} given</div><div className="d2">{done?.name} is holding it</div>
      </div>
    </div>
  );
}

// ── peek: the wallet's cash book + Give cash / Settle wallet ──
function Peek({ wallet, orgId, canManage, onClose, onChanged }: {
  wallet: WCard; orgId: string; canManage: boolean; onClose: () => void; onChanged: (msg?: string) => void;
}) {
  const { data: lines = [] } = useQuery({ queryKey: ['wallet_ledger', wallet.walletId], queryFn: () => loadWalletLedger(wallet.walletId) });
  const [give, setGive] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h); }, [onClose]);

  // Oldest→newest running balance; render newest-first, grouped by day.
  const days = useMemo(() => {
    const asc = [...lines].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    let run = 0; const withRun = asc.map(l => { run += l.debit - l.credit; return { ...l, run }; });
    const byDay = new Map<string, (WalletLedgerLine & { run: number })[]>();
    [...withRun].reverse().forEach(l => { const k = fmtDay(l.date); (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(l); });
    return [...byDay.entries()];
  }, [lines]);

  const lineTitle = (l: WalletLedgerLine) => l.kind === 'float' ? 'Given (site advance)' : l.kind === 'return' ? 'Returned to office' : (l.category || 'Spend');

  const giveVal = parseInt((give || '').replace(/\D/g, ''), 10) || 0;
  const doGive = async () => {
    if (giveVal <= 0 || busy) return; setBusy(true);
    try { await issueFloat({ orgId, walletId: wallet.walletId, amount: giveVal, date: new Date().toISOString().slice(0, 10), mode: 'Cash', note: 'Top-up' }); setGive(''); setBusy(false); onChanged(`₹${inr(giveVal)} given to ${wallet.holderName}`); }
    catch { setBusy(false); }
  };
  const settle = async () => {
    if (busy || wallet.balance <= 0) return;
    if (!window.confirm(`Return ${wallet.holderName}'s remaining ₹${inr(wallet.balance)} to the office? The wallet settles to zero.`)) return;
    setBusy(true);
    try { await returnCash({ orgId, walletId: wallet.walletId, amount: wallet.balance, date: new Date().toISOString().slice(0, 10), mode: 'Cash', note: 'Wallet settled' }); setBusy(false); onChanged('Wallet settled'); onClose(); }
    catch { setBusy(false); }
  };

  return createPortal(
    <div className="wrail-root">
      <style>{CSS}</style>
      <div className="scrim on" onClick={onClose} />
      <aside className="peek on" aria-hidden="false">
        <div className="phead">
          <div className="pl1"><div className="av lg" style={{ background: wallet.tone.tone }}>{ini(wallet.holderName)}</div>
            <div><div className="nm">{wallet.holderName}</div><div className="role">{wallet.role}</div></div>
            <button className="close" onClick={onClose} aria-label="Close"><svg width="12" height="12" viewBox="0 0 13 13" fill="none"><path d="M1 1l11 11M12 1L1 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button>
          </div>
          <div className="pbal mono"><span className="r">₹</span>{inr(wallet.balance)}</div>
          <div className="psub">{wallet.balance > 0 ? `in hand · ₹${inr(wallet.totalIn)} given, ₹${inr(Math.max(0, wallet.totalIn - wallet.balance))} spent` : 'wallet settled · nothing in hand'}</div>
          {canManage && (
            <div className="pacts">
              <div className="giveinline"><span className="r">₹</span><input inputMode="numeric" placeholder="Give cash" value={give} onChange={e => setGive(e.target.value)} />
                {giveVal > 0 && <button className="givego" disabled={busy} onClick={doGive}>Give</button>}</div>
              <button className="give" disabled={busy || wallet.balance <= 0} onClick={settle}>Settle wallet</button>
            </div>
          )}
        </div>
        <div className="pbody">
          {days.length === 0 ? <div className="lday">No entries yet. Give a float to start.</div> : days.map(([d, rows]) => (
            <div key={d}>
              <div className="lday">{d}</div>
              {rows.map(l => (
                <div key={l.txnId} className="lrow"><div className="dd"><div className="d1">{lineTitle(l)}</div><div className="d2">{l.remarks || (l.kind === 'spend' ? 'Site spend' : '')}</div></div>
                  <div className={`o ${l.debit > 0 ? 'in' : ''}`}>{l.debit > 0 ? '+' : '−'} ₹{inr(l.debit > 0 ? l.debit : l.credit)}</div>
                  <div className="run">₹{inr(l.run)}</div></div>
              ))}
            </div>
          ))}
          <div className="open-bal"><div><div className="t">Opening balance</div><div className="m">Nothing carried before this wallet</div></div>
            <div className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>₹0</div></div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

const CSS = `
.wrail-root{--band:#2E231B;--band-hi:#382B21;--drawer:#221912;--seam:rgba(255,255,255,.075);--on-dark:#F2E9DC;--on-dark-mute:#A2907C;--cream:#F6F2EA;--paper:#FCF8F1;--walnut:#2B211A;--walnut-2:#544435;--rule:#E5DCCE;--rule-soft:#EFE8DC;--muted:#8E8274;--terra:#C2653A;--terra-lit:#D8794C;--sage:#8CA07C;--ease:cubic-bezier(.22,.61,.36,1);--out:cubic-bezier(.16,1,.3,1);font-family:"DM Sans",system-ui,sans-serif}
.wrail-root .mono{font-family:"DM Mono",ui-monospace,monospace;font-feature-settings:"tnum";letter-spacing:-.02em}
.wrail-root .wrap{max-width:1180px;margin:0 auto;padding:0 28px}
.wrail-root button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;-webkit-tap-highlight-color:transparent;user-select:none}
.wrail-root button:focus{outline:none}
.wrail-root button:focus-visible{outline:1.5px solid var(--terra);outline-offset:2px;border-radius:6px}
.rail{position:sticky;top:0;z-index:40;color:var(--on-dark);background:linear-gradient(180deg,var(--band-hi),var(--band));border-top:1px solid var(--seam);box-shadow:0 1px 0 rgba(255,255,255,.05) inset,0 -14px 30px -22px rgba(0,0,0,.9) inset;transition:background .6s var(--ease)}
.rail.open{background:linear-gradient(180deg,var(--band-hi) 0 56px,var(--drawer) 56px)}
.rail .bar{height:56px;display:flex;align-items:center;gap:24px;cursor:pointer;position:relative}
.rail .total{display:flex;flex-direction:column;gap:2px;flex:none}
.rail .total .fig{font-family:"DM Mono",ui-monospace,monospace;font-size:19px;letter-spacing:-.03em;line-height:1;color:#E9DFD0}
.rail .total .fig .r{color:var(--on-dark-mute);margin-right:2px;font-size:14px}
.rail .total .cap{font-size:11px;color:var(--on-dark-mute)}
.rail .meter{flex:1;min-width:0;display:flex;flex-direction:column;gap:7px;padding-top:1px}
.rail .track{display:flex;gap:2px;height:4px}
.rail .seg{border-radius:2px;opacity:.9;transition:transform .35s var(--ease),opacity .3s var(--ease);transform-origin:center bottom;cursor:pointer}
.rail .meter:hover .seg{opacity:.34}
.rail .seg:hover,.rail .seg.lit{opacity:1;transform:scaleY(1.6)}
.rail .legend{display:flex;gap:16px;font-size:11px;color:var(--on-dark-mute);white-space:nowrap;overflow:hidden}
.rail .legend span{display:flex;align-items:center;gap:6px;transition:color .25s}
.rail .legend b{font-weight:400;color:#BCAF9B}
.rail .legend i{font-style:normal;font-family:"DM Mono",ui-monospace,monospace;font-size:11px}
.rail .pip{width:4px;height:4px;border-radius:1.5px}
.rail .right{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none}
.rail .give{display:inline-flex;align-items:center;gap:7px;padding:6px 13px;border-radius:999px;border:1px solid rgba(242,233,220,.16);color:var(--on-dark-mute);font-size:12px;background:transparent;transition:background .3s var(--ease),border-color .3s var(--ease),color .3s,transform .25s var(--ease)}
.rail .give:hover{background:rgba(194,101,58,.14);border-color:rgba(194,101,58,.5);color:var(--on-dark);transform:translateY(-1px)}
.rail .give:active{transform:translateY(0) scale(.985)}
.rail .give .p{font-size:14px;line-height:0;transition:transform .45s var(--ease)}
.rail .give:hover .p{transform:rotate(90deg)}
.rail .chev{width:26px;height:26px;display:grid;place-items:center;border-radius:50%;color:var(--on-dark-mute);transition:transform .55s var(--ease),background .3s,color .3s}
.rail .bar:hover .chev{background:rgba(242,233,220,.07);color:var(--on-dark)}
.rail.open .chev{transform:rotate(180deg)}
.rail .drawer{display:grid;grid-template-rows:0fr;transition:grid-template-rows .6s var(--out)}
.rail.open .drawer{grid-template-rows:1fr}
.rail .din{overflow:hidden}
.rail .tray{padding:6px 0 32px;position:relative}
.rail .tray::before{content:"";position:absolute;left:-40px;right:-40px;top:-6px;height:24px;background:linear-gradient(180deg,rgba(0,0,0,.4),transparent)}
.rail .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(262px,1fr));gap:14px}
.rail .card{position:relative;text-align:left;width:100%;border-radius:14px;padding:18px 18px 16px;color:var(--walnut);background-color:var(--paper);background-image:var(--grad);opacity:0;transform:translateY(16px);box-shadow:0 1px 0 rgba(255,255,255,.55) inset,0 16px 34px -26px rgba(0,0,0,.95);transition:transform .42s var(--ease),box-shadow .45s var(--ease)}
.rail.open .card{animation:wrise .62s var(--out) forwards;animation-delay:calc(var(--i)*60ms + 70ms)}
@keyframes wrise{to{opacity:1;transform:none}}
.rail .card::after{content:"";position:absolute;inset:0;border-radius:14px;pointer-events:none;opacity:0;background:radial-gradient(230px 165px at var(--mx,50%) var(--my,50%),var(--glow),transparent 66%);transition:opacity .4s var(--ease)}
.rail .card:hover::after{opacity:1}
.rail .card:hover{transform:translateY(-4px);background-image:var(--grad-hi);box-shadow:0 1px 0 rgba(255,255,255,.65) inset,0 30px 52px -30px rgba(0,0,0,1)}
.rail .card:active{transform:translateY(-1px) scale(.995)}
.rail .head{display:flex;align-items:center;gap:11px}
.rail .av{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;color:#FCF8F1;font-size:11px;font-weight:600;letter-spacing:.02em;flex:none}
.rail .av.lg,.wrail-root .av.lg{width:42px;height:42px;font-size:14px}
.rail .nm{font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rail .role{font-size:11.5px;color:var(--muted);margin-top:1px}
.rail .bal{font-family:"DM Mono",ui-monospace,monospace;font-size:28px;letter-spacing:-.035em;margin:18px 0 0;color:#1C140E}
.rail .bal .r{color:var(--muted);font-size:20px;margin-right:1px}
.rail .burn{margin-top:14px;height:2px;border-radius:2px;background:rgba(43,33,26,.09);overflow:hidden}
.rail .burn i{display:block;height:100%;border-radius:2px;width:0;transition:width 1s var(--out) .35s}
.rail.open .burn i{width:var(--w)}
.rail .note{font-size:11.5px;color:var(--muted);margin-top:9px;letter-spacing:.005em}
.rail .card.zero{box-shadow:0 1px 0 rgba(255,255,255,.45) inset,0 12px 26px -24px rgba(0,0,0,.85)}
.rail .card.zero .bal{color:#BDB2A2}.rail .card.zero .nm{color:#6F6558}.rail .card.zero .av{opacity:.62}.rail .card.zero .burn{display:none}
.rail .acts{position:absolute;right:15px;bottom:14px;display:flex;gap:7px;opacity:0;transform:translateY(6px);transition:opacity .3s var(--ease),transform .35s var(--ease)}
.rail .card:hover .acts,.rail .card:focus-visible .acts{opacity:1;transform:none}
.rail .chip{font-size:11.5px;padding:6px 11px;border-radius:999px;border:1px solid var(--rule);background:rgba(255,255,255,.7);transition:background .25s,border-color .25s,color .25s}
.rail .chip:hover{background:var(--tone);border-color:var(--tone);color:#FCF8F1}
.rail .tile{border:1px dashed rgba(242,233,220,.2);border-radius:14px;min-height:160px;padding:18px;display:grid;place-items:center;text-align:center;color:var(--on-dark);opacity:0;transform:translateY(16px);transition:border-color .35s var(--ease),background .35s var(--ease)}
.rail.open .tile{animation:wrise .62s var(--out) forwards;animation-delay:calc(var(--i)*60ms + 70ms)}
.rail .tile .prompt{cursor:pointer}
.rail .tile:hover{border-color:rgba(194,101,58,.7);background:rgba(194,101,58,.06)}
.rail .ring{width:32px;height:32px;border-radius:50%;border:1px solid rgba(242,233,220,.22);display:grid;place-items:center;margin:0 auto 11px;color:var(--terra-lit);font-size:17px;line-height:0;transition:transform .45s var(--ease),border-color .3s}
.rail .tile:hover .ring{transform:rotate(90deg) scale(1.08);border-color:var(--terra)}
.rail .tile .t1{font-size:13.5px;font-weight:500}
.rail .tile .t2{font-size:11.5px;color:var(--on-dark-mute);margin-top:5px;max-width:172px;line-height:1.45}
.rail .form{display:none;width:100%;text-align:left}
.rail .tile.forming{border-style:solid;border-color:rgba(242,233,220,.16);background:rgba(0,0,0,.25);place-items:stretch;cursor:default}
.rail .tile.forming .prompt{display:none}.rail .tile.forming .form{display:block}
.rail .lbl{font-size:11.5px;color:var(--on-dark-mute);margin-bottom:8px}
.rail .parties{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
.rail .party{font-size:12px;padding:5px 10px;border-radius:999px;border:1px solid rgba(242,233,220,.18);color:var(--on-dark);transition:.25s}
.rail .party:hover{border-color:rgba(242,233,220,.45)}
.rail .party.on{background:var(--on-dark);border-color:var(--on-dark);color:var(--band)}
.rail .amt{display:flex;align-items:baseline;gap:6px;border-bottom:1px solid rgba(242,233,220,.2);padding-bottom:5px}
.rail .amt .r{font-family:"DM Mono",ui-monospace,monospace;font-size:21px;color:var(--on-dark-mute)}
.rail .amt input{border:0;background:none;width:100%;color:var(--on-dark);padding:0;font-family:"DM Mono",ui-monospace,monospace;font-size:25px;letter-spacing:-.03em}
.rail .amt input:focus{outline:none}.rail .amt:focus-within{border-color:var(--terra)}
.rail .quick{display:flex;gap:5px;margin:10px 0 14px}
.rail .quick button{font-family:"DM Mono",ui-monospace,monospace;font-size:11px;color:var(--on-dark-mute);padding:4px 7px;border-radius:6px;transition:.2s}
.rail .quick button:hover{background:rgba(242,233,220,.1);color:var(--on-dark)}
.rail .solid{width:100%;padding:11px;border-radius:9px;background:var(--terra);color:#fff;font-size:13.5px;font-weight:500;transition:background .3s,transform .25s var(--ease),box-shadow .4s,opacity .3s}
.rail .solid:hover{background:var(--terra-lit);transform:translateY(-1px);box-shadow:0 14px 26px -16px rgba(194,101,58,.95)}
.rail .solid[disabled]{opacity:.32;pointer-events:none}
.rail .cancel{display:block;width:100%;text-align:center;font-size:12px;color:var(--on-dark-mute);margin-top:10px}
.rail .cancel:hover{color:var(--on-dark)}
.rail .tile.done{border-style:solid;border-color:rgba(140,160,124,.45);background:rgba(140,160,124,.09);place-items:center}
.rail .tile.done .prompt,.rail .tile.done .form{display:none}
.rail .doneIn{display:none;text-align:center}.rail .tile.done .doneIn{display:block}
.rail .tick{width:38px;height:38px;margin:0 auto 10px}
.rail .tick circle{stroke:var(--sage);stroke-width:1.4;fill:none;stroke-dasharray:118;stroke-dashoffset:118;animation:wdraw .5s var(--out) forwards}
.rail .tick path{stroke:var(--sage);stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:30;stroke-dashoffset:30;animation:wdraw .34s var(--out) .3s forwards}
@keyframes wdraw{to{stroke-dashoffset:0}}
.rail .doneIn .d1{font-size:13.5px;font-weight:500}.rail .doneIn .d2{font-size:11.5px;color:var(--on-dark-mute);margin-top:4px}
.rail .card.fresh{animation:wfresh .8s var(--out)}
@keyframes wfresh{0%{opacity:0;transform:translateY(12px) scale(.96);box-shadow:0 0 0 3px rgba(140,160,124,.3)}70%{box-shadow:0 0 0 3px rgba(140,160,124,.14)}100%{opacity:1;transform:none}}
@media (max-width:760px){.rail .bar{height:auto;padding:16px 0;flex-wrap:wrap}.rail .meter{order:3;flex:1 0 100%}}
/* peek */
.wrail-root .scrim{position:fixed;inset:0;background:rgba(25,17,11,.42);backdrop-filter:blur(3px);opacity:0;pointer-events:none;transition:opacity .45s var(--ease);z-index:60}
.wrail-root .scrim.on{opacity:1;pointer-events:auto}
.wrail-root .peek{position:fixed;top:0;right:0;bottom:0;width:min(472px,95vw);background:var(--paper);z-index:70;transform:translateX(102%);transition:transform .55s var(--out);display:flex;flex-direction:column;box-shadow:-50px 0 90px -60px rgba(0,0,0,.95)}
.wrail-root .peek.on{transform:none}
.wrail-root .phead{padding:24px 26px 22px;background:linear-gradient(180deg,#2E231B,#261C15);color:var(--on-dark)}
.wrail-root .pl1{display:flex;align-items:center;gap:12px}
.wrail-root .pl1 .nm{font-size:15.5px}.wrail-root .pl1 .role{font-size:12px;color:var(--on-dark-mute)}
.wrail-root .close{margin-left:auto;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;color:var(--on-dark-mute);transition:.25s}
.wrail-root .close:hover{background:rgba(242,233,220,.1);color:var(--on-dark)}
.wrail-root .pbal{font-family:"DM Mono",ui-monospace,monospace;font-size:34px;letter-spacing:-.035em;margin:18px 0 4px}
.wrail-root .pbal .r{color:var(--on-dark-mute);font-size:24px}
.wrail-root .psub{font-size:12.5px;color:var(--on-dark-mute)}
.wrail-root .pacts{display:flex;gap:9px;margin-top:18px;align-items:center}
.wrail-root .pacts .give{display:inline-flex;align-items:center;gap:9px;padding:9px 14px;border-radius:999px;border:1px solid rgba(242,233,220,.2);color:var(--on-dark);font-size:12.5px;background:rgba(242,233,220,.04);transition:.3s}
.wrail-root .pacts .give:hover:not([disabled]){background:var(--terra);border-color:var(--terra)}
.wrail-root .pacts .give[disabled]{opacity:.4;pointer-events:none}
.wrail-root .giveinline{display:flex;align-items:center;gap:6px;padding:8px 12px;border-radius:999px;border:1px solid rgba(242,233,220,.2);background:rgba(242,233,220,.04)}
.wrail-root .giveinline .r{color:var(--on-dark-mute);font-family:"DM Mono",ui-monospace,monospace;font-size:13px}
.wrail-root .giveinline input{border:0;background:none;color:var(--on-dark);width:84px;font-family:"DM Mono",ui-monospace,monospace;font-size:13px;outline:none}
.wrail-root .giveinline .givego{color:var(--terra-lit);font-size:12.5px;font-weight:500}
.wrail-root .pbody{overflow:auto;padding:0 26px 40px;flex:1}
.wrail-root .lday{font-size:11.5px;color:var(--muted);padding:20px 0 8px;position:sticky;top:0;background:linear-gradient(180deg,var(--paper) 72%,rgba(252,248,241,0))}
.wrail-root .lrow{display:flex;gap:14px;align-items:baseline;padding:11px 0;border-bottom:1px solid var(--rule-soft)}
.wrail-root .lrow .dd{flex:1;min-width:0}.wrail-root .lrow .d1{font-size:14px}
.wrail-root .lrow .d2{font-size:12px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wrail-root .lrow .o{font-family:"DM Mono",ui-monospace,monospace;font-size:14px;color:var(--walnut-2);white-space:nowrap}
.wrail-root .lrow .o.in{color:#6C7F5C}
.wrail-root .lrow .run{font-family:"DM Mono",ui-monospace,monospace;font-size:11.5px;color:#B8AB98;width:76px;text-align:right}
.wrail-root .open-bal{background:var(--cream);border-radius:10px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;margin-top:8px}
.wrail-root .open-bal .t{font-size:13px}.wrail-root .open-bal .m{font-size:11.5px;color:var(--muted);margin-top:2px}
.wrail-root .toast{position:fixed;left:50%;bottom:32px;transform:translate(-50%,24px);z-index:90;background:var(--band);color:var(--on-dark);padding:12px 18px;border-radius:999px;font-size:13.5px;display:flex;align-items:center;gap:10px;opacity:0;pointer-events:none;transition:opacity .4s,transform .5s var(--out);box-shadow:0 22px 44px -24px rgba(0,0,0,.95)}
.wrail-root .toast.on{opacity:1;transform:translate(-50%,0)}
.wrail-root .toast .sg{width:6px;height:6px;border-radius:50%;background:var(--sage)}
@media (prefers-reduced-motion:reduce){.wrail-root *{animation-duration:.01ms!important;transition-duration:.01ms!important}.rail .card,.rail .tile{opacity:1;transform:none}}
`;
