// /mywallet — a wallet HOLDER's own view of their site-cash wallet, open to ANY role. This is the
// page the `wallet_recharge` WhatsApp button ("My Wallet") lands on. It shows only the signed-in
// user's own wallet (loadMyWallet is keyed to their user id + org), so no role gate is needed — the
// wallets RLS policy already scopes rows to the member's org, and holder_user_id pins it to them.
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { useOrgId } from '../lib/auth/AuthProvider';
import { loadMyWallet, loadWalletLedger, type WalletLedgerLine } from '../lib/walletApi';

const inr = (n: number) => Math.round(Math.abs(Number(n) || 0)).toLocaleString('en-IN');
const ini = (s: string) => s.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const fmtDay = (d: string | null) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'long' }).replace(',', ' ·') : '';

export default function MyWallet({ session }: { session: Session }) {
  const orgId = useOrgId();
  const userId = session.user.id;
  const nav = useNavigate();

  const { data: wallet, isLoading } = useQuery({
    queryKey: ['my_wallet', orgId, userId],
    queryFn: () => loadMyWallet(orgId, userId),
    enabled: !!orgId && !!userId,
  });
  const { data: lines = [] } = useQuery({
    queryKey: ['wallet_ledger', wallet?.walletId],
    queryFn: () => loadWalletLedger(wallet!.walletId),
    enabled: !!wallet?.walletId,
  });

  // Oldest→newest running balance; render newest-first, grouped by day.
  const days = useMemo(() => {
    const asc = [...lines].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    let run = 0; const withRun = asc.map(l => { run += l.debit - l.credit; return { ...l, run }; });
    const byDay = new Map<string, (WalletLedgerLine & { run: number })[]>();
    [...withRun].reverse().forEach(l => { const k = fmtDay(l.date); (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(l); });
    return [...byDay.entries()];
  }, [lines]);

  const lineTitle = (l: WalletLedgerLine) => l.kind === 'float' ? 'Site advance received' : l.kind === 'return' ? 'Returned to office' : (l.category || 'Spent on site');
  const spent = wallet ? Math.max(0, wallet.totalIn - wallet.balance) : 0;

  return (
    <div className="mywx">
      <style>{CSS}</style>
      <div className="wrap">
        <div className="topbar">
          <button className="home" onClick={() => nav('/')} aria-label="Home">
            <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5 10 3l7 6.5M5 8.5V16h10V8.5"/></svg>
          </button>
          <span className="brand">Briklay</span>
        </div>

        {isLoading ? (
          <div className="skeleton" />
        ) : !wallet ? (
          <div className="empty">
            <div className="empty-ic"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9h15a1 1 0 0 1 1 1v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9Z"/><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2"/><circle cx="16.5" cy="13.5" r="1.2" fill="currentColor" stroke="none"/></svg></div>
            <div className="empty-t">No wallet yet</div>
            <div className="empty-s">When your team gives you site cash, it shows up here — and every expense you report on WhatsApp is deducted from it.</div>
          </div>
        ) : (
          <>
            <div className="hero">
              <div className="who"><span className="av">{ini(wallet.holderName)}</span>
                <div><div className="nm">{wallet.holderName}</div><div className="role">Your site-cash wallet</div></div>
              </div>
              <div className="bal mono"><span className="r">₹</span>{inr(wallet.balance)}</div>
              <div className="sub">{wallet.balance > 0
                ? 'in hand · every expense you report on WhatsApp is deducted from this'
                : 'settled · nothing in hand right now'}</div>
              <div className="stats">
                <div className="stat"><div className="k">Given so far</div><div className="v mono">₹{inr(wallet.totalIn)}</div></div>
                <div className="stat"><div className="k">Spent</div><div className="v mono">₹{inr(spent)}</div></div>
              </div>
            </div>

            <div className="sec">Cash book</div>
            <div className="book">
              {days.length === 0 ? (
                <div className="bempty">Nothing yet. When cash is added or you report a spend, it appears here.</div>
              ) : days.map(([d, rows]) => (
                <div key={d} className="dgrp">
                  <div className="dday">{d}</div>
                  {rows.map(l => (
                    <div key={l.txnId} className="brow">
                      <div className="bd"><div className="b1">{lineTitle(l)}</div>{(l.remarks || l.kind === 'spend') && <div className="b2">{l.remarks || 'Site spend'}</div>}</div>
                      <div className={`bo ${l.debit > 0 ? 'in' : ''}`}>{l.debit > 0 ? '+' : '−'} ₹{inr(l.debit > 0 ? l.debit : l.credit)}</div>
                      <div className="brun mono">₹{inr(l.run)}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="foot">Questions about an entry? Ask your site team — this is a read-only view of your cash.</div>
          </>
        )}
      </div>
    </div>
  );
}

const CSS = `
.mywx{--bg:#0E0A07;--card:#FCF8F1;--ink:#241A13;--ink2:#6E635B;--ink3:#A39A91;--line:#EFE8DC;--terra:#C2653A;--terra-lit:#D8794C;--sage:#5F7F5B;--on-dark:#F2E9DC;--on-dark-mute:#A2907C;min-height:100vh;background:var(--bg);font-family:"DM Sans",system-ui,sans-serif;color:var(--ink)}
.mywx .mono{font-family:"DM Mono",ui-monospace,monospace;font-feature-settings:"tnum";letter-spacing:-.02em}
.mywx .wrap{max-width:520px;margin:0 auto;padding:0 16px 40px;min-height:100vh}
.mywx button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
.mywx .topbar{display:flex;align-items:center;gap:12px;padding:16px 2px 18px;color:var(--on-dark)}
.mywx .home{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;color:var(--on-dark-mute);border:1px solid rgba(242,233,220,.14);transition:.2s}
.mywx .home:hover{background:rgba(242,233,220,.07);color:var(--on-dark)}
.mywx .brand{font-family:"Playfair Display",Georgia,serif;font-size:17px;letter-spacing:.01em;color:var(--on-dark)}
.mywx .skeleton{height:220px;border-radius:18px;background:linear-gradient(100deg,rgba(255,255,255,.04),rgba(255,255,255,.09),rgba(255,255,255,.04));background-size:200% 100%;animation:mywsh 1.2s linear infinite}
@keyframes mywsh{to{background-position:-200% 0}}
.mywx .hero{background:var(--card);border-radius:18px;padding:22px 20px 18px;box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 22px 46px -30px rgba(0,0,0,1);position:relative;overflow:hidden}
.mywx .hero::before{content:"";position:absolute;inset:0;background:radial-gradient(120% 90% at 100% 0,rgba(194,101,58,.14),transparent 55%);pointer-events:none}
.mywx .who{display:flex;align-items:center;gap:11px;position:relative}
.mywx .av{width:40px;height:40px;border-radius:50%;flex:none;display:grid;place-items:center;color:#FCF8F1;font-weight:600;font-size:14px;background:radial-gradient(130% 130% at 30% 25%,var(--terra-lit),var(--terra) 74%)}
.mywx .nm{font-size:16px;font-weight:600}
.mywx .role{font-size:12.5px;color:var(--ink2);margin-top:1px}
.mywx .bal{font-size:44px;line-height:1;margin:20px 0 4px;color:#1C140E;position:relative}
.mywx .bal .r{color:var(--ink3);font-size:28px;margin-right:2px}
.mywx .sub{font-size:12.5px;color:var(--ink2);line-height:1.5;position:relative}
.mywx .stats{display:flex;gap:10px;margin-top:18px;position:relative}
.mywx .stat{flex:1;background:#F6F1E8;border:1px solid var(--line);border-radius:12px;padding:11px 13px}
.mywx .stat .k{font-size:11px;color:var(--ink3);text-transform:uppercase;letter-spacing:.06em}
.mywx .stat .v{font-size:17px;margin-top:4px;color:var(--ink)}
.mywx .sec{color:var(--on-dark-mute);font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;padding:24px 4px 10px}
.mywx .book{background:var(--card);border-radius:16px;overflow:hidden;box-shadow:0 18px 40px -32px rgba(0,0,0,1)}
.mywx .bempty{padding:26px 18px;color:var(--ink2);font-size:13.5px;text-align:center;line-height:1.5}
.mywx .dday{font-size:11.5px;color:var(--ink3);padding:14px 16px 6px;background:#FBF7F0}
.mywx .brow{display:flex;gap:12px;align-items:baseline;padding:12px 16px;border-top:1px solid var(--line)}
.mywx .dgrp:first-child .dday{padding-top:16px}
.mywx .bd{flex:1;min-width:0}
.mywx .b1{font-size:14px;color:var(--ink)}
.mywx .b2{font-size:12px;color:var(--ink3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mywx .bo{font-family:"DM Mono",ui-monospace,monospace;font-size:14px;color:#7A6E60;white-space:nowrap}
.mywx .bo.in{color:var(--sage)}
.mywx .brun{font-size:11.5px;color:var(--ink3);width:78px;text-align:right}
.mywx .foot{color:var(--on-dark-mute);font-size:11.5px;text-align:center;line-height:1.5;padding:18px 20px 0}
.mywx .empty{background:var(--card);border-radius:18px;padding:40px 26px;text-align:center;box-shadow:0 22px 46px -30px rgba(0,0,0,1);margin-top:8px}
.mywx .empty-ic{width:56px;height:56px;border-radius:16px;display:grid;place-items:center;margin:0 auto 16px;color:var(--terra);background:#F8E7DE}
.mywx .empty-t{font-size:18px;font-weight:600}
.mywx .empty-s{font-size:13.5px;color:var(--ink2);line-height:1.55;margin-top:8px;max-width:340px;margin-inline:auto}
@media (prefers-reduced-motion:reduce){.mywx *{animation-duration:.01ms!important}}
`;
