// Payables — "who do we owe, and how much", read from dues that already exist in the
// ledger (approved-PO balances + work-order balances + this week's labour muster).
// See src/lib/payablesApi.ts for the assembly. Lives under the Payments nav group.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { loadPayables } from '../lib/payablesApi';

const PAYLX_CSS = `
.paylx{background:var(--cream,#f6f2ea);color:var(--walnut,#3b2f27);font:15px/1.45 "DM Sans",system-ui,sans-serif;-webkit-font-smoothing:antialiased;padding:34px 28px 80px;
  --cream:#f6f2ea;--paper:#fdfbf7;--line:#e6dfd2;--line-2:#d5cbb9;--walnut:#3b2f27;--walnut-2:#6d5f54;--walnut-3:#9c9083;--terracotta:#b8613a;--sage:#5f7a5e}
.paylx *{box-sizing:border-box}
.paylx .wrap{width:100%;max-width:920px;margin:0 auto}
.paylx .mono{font-family:"DM Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}
.paylx h1{font:400 38px/1.05 "Playfair Display",serif;margin:0}
.paylx .lede{color:var(--walnut-2);margin-top:8px;font-size:15px}
.paylx .totals{display:flex;gap:26px;margin:20px 0 26px;padding:16px 20px;background:var(--paper);border:1px solid var(--line);border-radius:12px;align-items:center;flex-wrap:wrap}
.paylx .totals .t .l{font-size:12px;color:var(--walnut-3)}
.paylx .totals .t .v{font-size:24px;font-weight:500;margin-top:2px}
.paylx .totals .t.grand .v{color:var(--terracotta)}
.paylx .totals .sp{flex:1}
.paylx .sec{margin:26px 0 10px;display:flex;align-items:baseline;gap:12px}
.paylx .sec h2{font:500 19px "Playfair Display",serif;margin:0}
.paylx .sec .s{font-size:13px;color:var(--walnut-3)}
.paylx .card{background:var(--paper);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.paylx .row{display:flex;align-items:center;gap:14px;padding:14px 18px;border-top:1px solid var(--line);cursor:pointer;transition:background .12s ease}
.paylx .row:first-child{border-top:0}
.paylx .row:hover{background:var(--cream)}
.paylx .row .nm{font-weight:500;font-size:15px}
.paylx .row .sub{font-size:12.5px;color:var(--walnut-3);margin-top:2px}
.paylx .row .amt{margin-left:auto;text-align:right}
.paylx .row .amt .v{font-size:17px;font-weight:500}
.paylx .row .amt .k{font-size:12px;color:var(--walnut-3);margin-top:1px}
.paylx .row .amt .k b{color:var(--walnut-2);font-weight:500}
.paylx .empty{padding:26px 18px;text-align:center;color:var(--walnut-3);font-size:14px}
.paylx .state{padding:70px 18px;text-align:center;color:var(--walnut-3);font-size:14px}
`;

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

export default function Payables(_props: { session: Session }) {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({ queryKey: ['payables'], queryFn: loadPayables, staleTime: 60_000 });

  const grand = useMemo(() => (data ? data.totalParties + data.totalLabour : 0), [data]);

  return (
    <div className="paylx">
      <style>{PAYLX_CSS}</style>
      <div className="wrap">
        <h1>Payables</h1>
        <p className="lede">What you owe right now — vendor and contract balances from the ledger, plus this week's unpaid site wages.</p>

        <div className="totals">
          <div className="t grand"><div className="l">Total owed</div><div className="v mono">{isLoading ? '—' : inr(grand)}</div></div>
          <div className="t"><div className="l">Vendors &amp; contractors</div><div className="v mono">{isLoading ? '—' : inr(data?.totalParties || 0)}</div></div>
          <div className="t"><div className="l">Labour · this week</div><div className="v mono">{isLoading ? '—' : inr(data?.totalLabour || 0)}</div></div>
        </div>

        {isLoading && <div className="state">Loading payables…</div>}
        {error && <div className="state" style={{ color: 'var(--terracotta)' }}>Could not load payables — {(error as any)?.message || 'try again'}</div>}

        {!isLoading && !error && data && (
          <>
            <div className="sec"><h2>Vendors &amp; contractors</h2><span className="s">Approved-PO and work-order balances, by party</span></div>
            <div className="card">
              {data.parties.length === 0 ? (
                <div className="empty">Nothing outstanding — every vendor and contractor is settled.</div>
              ) : data.parties.map(p => (
                <div key={p.stakeholderId} className="row" onClick={() => navigate(`/stakeholders/${p.stakeholderId}`)}>
                  <div>
                    <div className="nm">{p.name}</div>
                    <div className="sub">{p.projects.length ? p.projects.join(' · ') : 'No project tag'}</div>
                  </div>
                  <div className="amt">
                    <div className="v mono">{inr(p.total)}</div>
                    <div className="k">{[p.poOwed > 0.5 ? `POs ${inr(p.poOwed)}` : '', p.woOwed > 0.5 ? `contract ${inr(p.woOwed)}` : ''].filter(Boolean).join(' · ')}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="sec"><h2>Labour · this week</h2><span className="s">Unpaid wages and contract-earned from the attendance muster</span></div>
            <div className="card">
              {data.labour.length === 0 ? (
                <div className="empty">No unpaid labour recorded this week.</div>
              ) : data.labour.map(l => (
                <div key={l.projectId} className="row" onClick={() => navigate('/attendance')}>
                  <div>
                    <div className="nm">{l.projectName}</div>
                    <div className="sub">This week's muster</div>
                  </div>
                  <div className="amt">
                    <div className="v mono">{inr(l.total)}</div>
                    <div className="k">{[l.wages > 0.5 ? `wages ${inr(l.wages)}` : '', l.contract > 0.5 ? `contract ${inr(l.contract)}` : ''].filter(Boolean).join(' · ')}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
