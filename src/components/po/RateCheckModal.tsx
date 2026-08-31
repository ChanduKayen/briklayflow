/**
 * RateCheckModal — the office opens this from a PO, PICKS which billed lines to check, and runs a
 * market rate check: Serper (live Google Shopping, region-scoped) fetches listings, the LLM judges each
 * billed rate against ONLY those listings, and we present the verdict with an honest confidence + the
 * sources. Built to the rate-check.html design (mineral-slate). Advisory — it flags, never blocks.
 */
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';

export interface RateItem { id: string; name: string; unit: string; rate: number; qty: number }
interface Result extends RateItem {
  verdict: 'fair' | 'high' | 'low' | 'no_benchmark' | 'error';
  market_low: number | null; market_high: number | null;
  confidence: 'high' | 'medium' | 'low'; reasoning: string; sources: string[];
  listings?: { title: string; price: string; source: string }[];
}

const VERDICT: Record<string, { cls: string; label: string }> = {
  fair: { cls: 'v-fair', label: 'Fair rate' },
  high: { cls: 'v-high', label: 'Above market' },
  low: { cls: 'v-low', label: 'Below market' },
  no_benchmark: { cls: 'v-none', label: 'No benchmark' },
  error: { cls: 'v-none', label: 'Check failed' },
};
const rs = (n: number) => '₹' + Number(Math.round(n)).toLocaleString('en-IN');

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap');
.rcx{position:fixed;inset:0;z-index:9998;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:rgba(31,42,48,.45);
  --bg:#f3f1ec;--sheet:#fbfaf7;--line:#e4e0d8;--line-strong:#cfc9bf;--ink:#1f2a30;--ink-2:#5a6670;--ink-3:#8b959c;--field:#fff;
  --good:#2f6b4a;--good-bg:#e9f2ec;--warn:#a8611c;--warn-bg:#fbf0e3;--bad:#9c3b32;--bad-bg:#f9e9e7;--none:#5a6670;--none-bg:#edeae3;--r:10px;
  font-family:"DM Sans",system-ui,sans-serif;color:var(--ink);font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased}
.rcx *{box-sizing:border-box;margin:0}
.rcx button,.rcx input{font:inherit;color:inherit}
.rcx button{background:none;border:0;cursor:pointer;padding:0}
.rcx .num{font-variant-numeric:tabular-nums}
.rcx .wrap{width:100%;max-width:760px;max-height:92vh;display:flex;flex-direction:column;gap:16px;background:var(--sheet);border:1px solid var(--line);border-radius:16px;box-shadow:0 12px 40px -20px rgba(31,42,48,.35);padding:22px 22px 18px;overflow:hidden;animation:rcxIn .2s cubic-bezier(.16,1,.3,1)}
@keyframes rcxIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.rcx .head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex:none}
.rcx .head h1{font-size:20px;font-weight:600;letter-spacing:-.01em}
.rcx .head p{color:var(--ink-2);margin-top:2px;font-size:14px}
.rcx .head .po{font-weight:500;color:var(--ink)}
.rcx .close{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;color:var(--ink-3);flex:none}
.rcx .close:hover{background:var(--line);color:var(--ink)}
.rcx .bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;flex:none}
.rcx .input{display:flex;align-items:center;border:1px solid var(--line);background:var(--field);border-radius:var(--r);padding:0 12px;height:42px;gap:8px;flex:1;min-width:220px}
.rcx .input:focus-within{border-color:var(--ink)}
.rcx .input input{flex:1;border:0;background:transparent;min-width:0}
.rcx .input input:focus{outline:none}
.rcx .input .tag{font-size:12px;color:var(--ink-3);white-space:nowrap}
.rcx .primary{background:var(--ink);color:#fff;border-radius:999px;padding:11px 20px;font-weight:500;flex:none;display:inline-flex;align-items:center;gap:8px}
.rcx .primary:hover{background:#0f171b}
.rcx .primary:disabled{background:var(--line-strong);cursor:not-allowed}
.rcx .card{background:var(--field);border:1px solid var(--line);border-radius:14px;overflow-y:auto}
.rcx .item{border-bottom:1px solid var(--line);padding:14px 16px;display:flex;gap:12px;align-items:flex-start}
.rcx .item:last-child{border-bottom:0}
.rcx .cbx{width:18px;height:18px;border-radius:5px;border:1.5px solid var(--line-strong);display:grid;place-items:center;flex:none;margin-top:2px;background:var(--field)}
.rcx .cbx.on{background:var(--ink);border-color:var(--ink);color:#fff}
.rcx .cbx svg{width:11px;height:11px;stroke:#fff;fill:none;stroke-width:3}
.rcx .main{flex:1;min-width:0}
.rcx .item h3{font-size:15px;font-weight:600}
.rcx .item .sub{color:var(--ink-2);font-size:13px;margin-top:1px}
.rcx .why{margin-top:8px;font-size:13.5px;color:var(--ink-2)}
.rcx .why .src{color:var(--ink-3);font-size:12.5px;margin-top:3px}
.rcx .right{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:6px;min-width:150px}
.rcx .verdict{border-radius:999px;padding:4px 11px;font-size:13px;font-weight:500;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.rcx .v-fair{background:var(--good-bg);color:var(--good)}
.rcx .v-high{background:var(--bad-bg);color:var(--bad)}
.rcx .v-low{background:var(--warn-bg);color:var(--warn)}
.rcx .v-none{background:var(--none-bg);color:var(--none)}
.rcx .v-wait{background:var(--none-bg);color:var(--ink-3)}
.rcx .range{font-size:13px;color:var(--ink-2)}
.rcx .toggle{font-size:13px;color:var(--ink-2);text-decoration:underline;text-decoration-color:var(--line-strong);text-underline-offset:3px}
.rcx .toggle:hover{color:var(--ink)}
.rcx .spin{width:13px;height:13px;border:2px solid var(--line-strong);border-top-color:var(--ink-2);border-radius:50%;animation:rcxSp .7s linear infinite;display:inline-block}
@keyframes rcxSp{to{transform:rotate(360deg)}}
.rcx .note{font-size:12.5px;color:var(--ink-3);flex:none}
.rcx .selbar{display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--ink-2);flex:none}
.rcx .selbar button{color:var(--ink-2);text-decoration:underline;text-decoration-color:var(--line-strong);text-underline-offset:3px}
@media (max-width:560px){.rcx{padding:0}.rcx .wrap{max-width:none;border-radius:0;min-height:100vh;max-height:100vh}.rcx .item{flex-wrap:wrap}.rcx .right{align-items:flex-start;min-width:0}}
@media (prefers-reduced-motion:reduce){.rcx .spin,.rcx .wrap{animation:none}}
`;

const Tick = () => <svg viewBox="0 0 16 16"><path d="M3 8.5l3 3 7-7" /></svg>;

export function RateCheckModal({ open, onClose, poId, vendorName, defaultRegion, items }: {
  open: boolean; onClose: () => void; poId: string; vendorName: string; defaultRegion: string; items: RateItem[];
}) {
  const [region, setRegion] = useState(defaultRegion || 'India');
  const [sel, setSel] = useState<Record<string, boolean>>(() => Object.fromEntries(items.map((i) => [i.id, true])));
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [openWhy, setOpenWhy] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<string | null>(null);

  // Line items load async, so seed a fresh (all-selected) state each time the modal opens — otherwise
  // the one-time useState initializer can capture an empty list and show "0 of 0".
  useEffect(() => {
    if (!open) return;
    setSel(Object.fromEntries(items.map((i) => [i.id, true])));
    setResults({}); setOpenWhy({}); setErr(null); setRegion(defaultRegion || 'India');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items.length]);

  if (!open) return null;
  const chosen = items.filter((i) => sel[i.id]);

  const run = async () => {
    if (running || chosen.length === 0) return;
    setRunning(true); setErr(null); setResults({});
    try {
      const { data, error } = await supabase.functions.invoke('rate-check', { body: { region: region.trim(), items: chosen } });
      if (error) throw error;
      const d = data as { ok?: boolean; error?: string; results?: Result[] } | null;
      if (!d?.ok) throw new Error(d?.error || 'Rate check failed');
      const map: Record<string, Result> = {};
      (d.results ?? []).forEach((r) => { map[r.id] = r; });
      setResults(map);
    } catch (e: any) {
      setErr(e.message || 'Could not run the rate check');
    } finally {
      setRunning(false);
    }
  };

  const hasResults = Object.keys(results).length > 0;

  return createPortal(
    <div className="rcx" onClick={onClose}>
      <style>{CSS}</style>
      <div className="wrap" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Rate check">
        <div className="head">
          <div>
            <h1>Rate check</h1>
            <p><span className="po">{poId} · {vendorName}</span> — checks each billed rate against what the market charges in your area, and flags what to question.</p>
          </div>
          <button className="close" aria-label="Close" onClick={onClose}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13" /></svg></button>
        </div>

        <div className="bar">
          <div className="input"><span className="tag">Region</span><input value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region for market rates" /></div>
          <button className="primary" onClick={run} disabled={running || chosen.length === 0}>
            {running ? <><span className="spin" /> Checking…</> : hasResults ? 'Check again' : `Check ${chosen.length} item${chosen.length !== 1 ? 's' : ''}`}
          </button>
        </div>

        <div className="selbar">
          <span>{chosen.length} of {items.length} selected</span>
          <button onClick={() => setSel(Object.fromEntries(items.map((i) => [i.id, !(chosen.length === items.length)])))}>{chosen.length === items.length ? 'Clear all' : 'Select all'}</button>
        </div>

        <div className="card">
          {items.map((it) => {
            const r = results[it.id];
            const v = r ? VERDICT[r.verdict] || VERDICT.no_benchmark : null;
            const on = !!sel[it.id];
            return (
              <div className="item" key={it.id}>
                {!hasResults && (
                  <button className={`cbx${on ? ' on' : ''}`} onClick={() => setSel((s) => ({ ...s, [it.id]: !on }))} aria-label={on ? 'Deselect' : 'Select'}>{on && <Tick />}</button>
                )}
                <div className="main">
                  <h3>{it.name}</h3>
                  <div className="sub num">Billed {rs(it.rate)} / {it.unit} · qty {it.qty}</div>
                  {r && openWhy[it.id] && (
                    <div className="why">
                      {r.reasoning || (r.verdict === 'error' ? "Couldn't complete this check — run it again." : 'No reasoning returned.')}
                      {(r.sources?.length || r.confidence) ? <div className="src">{(r.sources ?? []).join(' · ')}{r.confidence ? `${r.sources?.length ? ' · ' : ''}${r.confidence} confidence` : ''}</div> : null}
                    </div>
                  )}
                </div>
                <div className="right">
                  {running && sel[it.id] && !r
                    ? <span className="verdict v-wait"><span className="spin" /> Searching</span>
                    : r
                      ? <>
                          <span className={`verdict ${v!.cls}`}>{v!.label}</span>
                          {r.market_low != null && r.market_high != null && <span className="range num">market {rs(r.market_low)}–{rs(r.market_high)}</span>}
                          <button className="toggle" onClick={() => setOpenWhy((o) => ({ ...o, [it.id]: !o[it.id] }))}>{openWhy[it.id] ? 'Hide' : 'Why?'}</button>
                        </>
                      : !hasResults ? <span className="verdict v-wait">Not checked</span> : null}
                </div>
              </div>
            );
          })}
        </div>

        {err && <p style={{ color: 'var(--bad)', fontSize: 13.5 }}>{err}</p>}
        <div className="note">Verdicts come from live web search of online retail — a rough upper bound, not a local shop. "No benchmark" is an honest answer; your own purchase history is the better yardstick for generic hardware.</div>
      </div>
    </div>,
    document.body,
  );
}
