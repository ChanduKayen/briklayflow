// DEV ONLY — the Phase-1 parity gate, run in-app so it's scoped to your org by RLS.
// Step 1 materialises the new ledger_credits / ledger_allocations from source (idempotent,
// non-destructive to existing tables). Step 2 diffs the new derivation against the old netting.
// Nothing a normal user sees changes; this route is a tool, not a product surface.
import { useState } from 'react';
import { backfillOrg } from '../lib/ledgerBackfill';
import { parityOrg, type ParityReport } from '../lib/ledgerParity';
import { setNewLedgerEnabled } from '../lib/ledgerRead';
import { useOrgId } from '../lib/auth/AuthProvider';

const inr = (n: number) => Math.round(n).toLocaleString('en-IN');

const CSS = `
.lpx{background:#FBF9F6;min-height:100vh;color:#2E251C;font-family:'DM Sans',system-ui,sans-serif;font-size:14px;line-height:1.5}
.lpx *{box-sizing:border-box}
.lpx .wrap{max-width:1080px;margin:0 auto;padding:36px 32px 90px}
.lpx h1{font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:34px;margin:0}
.lpx .sub{color:#6A5A4C;margin:8px 0 26px;max-width:64ch}
.lpx .bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:20px}
.lpx button{font:inherit;font-weight:500;border:1px solid #E5DCCD;background:#FFFCF7;color:#2E251C;padding:9px 16px;border-radius:9px;cursor:pointer}
.lpx button:hover:not(:disabled){border-color:#9A8B7B}
.lpx button.primary{background:#33251B;border-color:#33251B;color:#FFFCF7}
.lpx button:disabled{opacity:.5;cursor:default}
.lpx .prog{font-family:'DM Mono',monospace;font-size:12.5px;color:#9A8B7B}
.lpx .cards{display:flex;gap:12px;flex-wrap:wrap;margin:8px 0 24px}
.lpx .card{border:1px solid #E5DCCD;border-radius:11px;background:#FFFCF7;padding:14px 18px;min-width:120px}
.lpx .card .v{font-family:'DM Mono',monospace;font-size:24px;font-variant-numeric:tabular-nums}
.lpx .card .l{font-size:12px;color:#9A8B7B;margin-top:2px}
.lpx .card.diff .v{color:#B4532F}.lpx .card.ok .v{color:#5F7F5C}
.lpx .tw{overflow-x:auto;border:1px solid #E5DCCD;border-radius:11px;background:#FFFCF7}
.lpx table{border-collapse:collapse;width:100%;min-width:640px;font-size:13.5px}
.lpx th{text-align:left;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9A8B7B;font-weight:500;padding:11px 14px;border-bottom:1px solid #E5DCCD;background:#F5F0E7}
.lpx td{padding:9px 14px;border-bottom:1px solid #EFE8DB;vertical-align:top}
.lpx td.num{font-family:'DM Mono',monospace;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.lpx tr:last-child td{border-bottom:0}
.lpx .party{font-weight:500}.lpx .muted{color:#9A8B7B;font-size:12px}
.lpx .d{color:#B4532F;font-weight:500}.lpx .d0{color:#9A8B7B}
.lpx .metric{color:#6A5A4C}
.lpx .err{color:#B4532F;font-family:'DM Mono',monospace;font-size:12px}
.lpx .warn{border:1px solid #EBD3C6;background:#F6E7DF;color:#7E3A20;border-radius:10px;padding:12px 16px;font-size:13px;margin-bottom:20px}
.lpx .empty{color:#9A8B7B;padding:40px;text-align:center}
`;

export default function LedgerParity() {
  const orgId = useOrgId();
  const [busy, setBusy] = useState<'' | 'backfill' | 'parity' | 'cutover'>('');
  const [prog, setProg] = useState('');
  const [backfillMsg, setBackfillMsg] = useState('');
  const [report, setReport] = useState<ParityReport | null>(null);
  const [cutMsg, setCutMsg] = useState('');
  const [err, setErr] = useState('');

  const runCutover = async () => {
    if (busy || !orgId) return;
    if (!confirm('Switch THIS org to the new allocation ledger?\n\nThe party pages will read from ledger_credits / ledger_allocations. Other orgs are unaffected. Reversible from here.')) return;
    setBusy('cutover'); setErr(''); setCutMsg('');
    try { await setNewLedgerEnabled(orgId, true, new Date().toISOString().slice(0, 10)); setCutMsg('New ledger enabled for this org. Party pages now read the allocation engine.'); }
    catch (e: any) { setErr(e?.message || 'Cutover failed'); }
    finally { setBusy(''); }
  };
  const undoCutover = async () => {
    if (busy || !orgId) return;
    setBusy('cutover'); setErr(''); setCutMsg('');
    try { await setNewLedgerEnabled(orgId, false); setCutMsg('Reverted — party pages read the old model again.'); }
    catch (e: any) { setErr(e?.message || 'Revert failed'); }
    finally { setBusy(''); }
  };

  const runBackfill = async () => {
    if (busy) return;
    if (!confirm('Materialise ledger_credits / ledger_allocations for every party from source data?\n\nIdempotent and non-destructive to existing tables.')) return;
    setBusy('backfill'); setErr(''); setBackfillMsg(''); setProg('Starting…');
    try {
      const res = await backfillOrg((d, t, p) => setProg(`${d}/${t} · ${p}`));
      const cr = res.reduce((s, r) => s + r.credits, 0), al = res.reduce((s, r) => s + r.allocations, 0);
      const skipped = res.filter(r => r.skipped);
      setBackfillMsg(`Materialised ${cr} credits and ${al} allocations across ${res.length} parties.${skipped.length ? ` ${skipped.length} skipped.` : ''}`);
    } catch (e: any) { setErr(e?.message || 'Backfill failed'); }
    finally { setBusy(''); setProg(''); }
  };

  const runParity = async () => {
    if (busy) return;
    setBusy('parity'); setErr(''); setProg('Starting…');
    try { setReport(await parityOrg((d, t) => setProg(`${d}/${t}`))); }
    catch (e: any) { setErr(e?.message || 'Parity failed'); }
    finally { setBusy(''); setProg(''); }
  };

  const diffRows = report?.rows.filter(r => r.hasDiff || r.error) ?? [];

  return (
    <div className="lpx">
      <style>{CSS}</style>
      <div className="wrap">
        <h1>Parity gate</h1>
        <p className="sub">Phase 1 · derive every party's position a second way and diff it against today's netting. A clean party has no diff; a diff is either an old-calc bug (→ cutover adjustment) or a real discrepancy to carry.</p>

        <div className="warn">Dev tool. Step 1 writes to the new tables only — it never touches transactions, POs or the existing ledger.</div>

        <div className="bar">
          <button className="primary" onClick={runBackfill} disabled={!!busy}>{busy === 'backfill' ? 'Materialising…' : '1 · Materialise (backfill)'}</button>
          <button onClick={runParity} disabled={!!busy}>{busy === 'parity' ? 'Diffing…' : '2 · Run parity'}</button>
          <span style={{ width: 1, alignSelf: 'stretch', background: '#E5DCCD' }} />
          <button onClick={runCutover} disabled={!!busy}>{busy === 'cutover' ? '…' : '3 · Enable new ledger'}</button>
          <button onClick={undoCutover} disabled={!!busy} style={{ borderColor: 'transparent', color: '#9A8B7B' }}>Revert</button>
          {prog && <span className="prog">{prog}</span>}
        </div>
        {backfillMsg && <p className="prog" style={{ marginTop: -8, marginBottom: 12 }}>{backfillMsg}</p>}
        {cutMsg && <p className="prog" style={{ marginTop: -4, marginBottom: 16, color: '#5F7F5C' }}>{cutMsg}</p>}
        {err && <p className="err">{err}</p>}

        {report && (
          <>
            <div className="cards">
              <div className="card"><div className="v">{report.parties}</div><div className="l">parties</div></div>
              <div className="card ok"><div className="v">{report.clean}</div><div className="l">clean</div></div>
              <div className="card diff"><div className="v">{report.diffs}</div><div className="l">with diffs</div></div>
              {report.errored > 0 && <div className="card"><div className="v">{report.errored}</div><div className="l">errored</div></div>}
            </div>

            <div className="tw">
              {diffRows.length === 0 ? (
                <div className="empty">Every party reconciles. Parity holds — nothing to carry.</div>
              ) : (
                <table>
                  <thead><tr><th>Party</th><th>Metric</th><th style={{ textAlign: 'right' }}>Old (netting)</th><th style={{ textAlign: 'right' }}>New (allocations)</th><th style={{ textAlign: 'right' }}>Δ</th></tr></thead>
                  <tbody>
                    {diffRows.map(r => r.error ? (
                      <tr key={r.stakeholderId}><td className="party">{r.name}<div className="muted">{r.stakeholderId}</div></td><td colSpan={4} className="err">{r.error}</td></tr>
                    ) : (
                      r.metrics.filter(mt => mt.flag).map((mt, i) => (
                        <tr key={r.stakeholderId + mt.metric}>
                          {i === 0 ? <td className="party" rowSpan={r.metrics.filter(x => x.flag).length}>{r.name}<div className="muted">{r.type} · {r.stakeholderId}</div></td> : null}
                          <td className="metric">{mt.metric}</td>
                          <td className="num">₹{inr(mt.old)}</td>
                          <td className="num">₹{inr(mt.neo)}</td>
                          <td className={`num ${Math.abs(mt.delta) > 1 ? 'd' : 'd0'}`}>{mt.delta >= 0 ? '+' : '−'}₹{inr(Math.abs(mt.delta))}</td>
                        </tr>
                      ))
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
