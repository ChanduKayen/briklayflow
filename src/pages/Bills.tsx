// Bills — vendor-bill register (list + detail), a port of bills-module-mock.html scoped under .blx.
// Frontend-first over existing data (see billsApi). /bills is the list; /bills/:billId the detail.
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { loadBills, loadBillDetail, type BillRow, type BillStatus } from '../lib/billsApi';
import { DocThumb } from '../components/DocThumb';
import { ImageLightbox } from '../components/ImageLightbox';
import { openDoc } from '../lib/storage';

const BLX_CSS = `
.blx{--cream:#F6F2EA;--paper:#FDFBF7;--walnut:#3B3128;--walnut-60:#7A6E61;--walnut-soft:#B4A897;--line:#E4DCCE;--line-strong:#D3C8B4;--terracotta:#B85C38;--sage:#6E7F5E;--sage-tint:#EEF1E8;--terra-tint:#F6E8E0;--amber-tint:#F3ECD9;
  background:var(--cream);color:var(--walnut);font-family:'DM Sans',system-ui,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh}
.blx *{box-sizing:border-box}
.blx .shell{max-width:1180px;margin:0 auto;padding:26px 40px 96px}
.blx .mono{font-family:'DM Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
.blx .pagehead{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:8px;gap:20px;flex-wrap:wrap}
.blx .pagehead h1{font-family:'Playfair Display',Georgia,serif;font-weight:500;font-size:2rem;letter-spacing:-.01em;margin:0}
.blx .pagehead .lede{font-size:.85rem;color:var(--walnut-60);margin-top:6px}
.blx .headwrap{display:flex;align-items:center;gap:0}
.blx .headfigure{text-align:right}
.blx .headfigure .num{font-family:'DM Mono',monospace;font-size:1.3rem;font-weight:500}
.blx .headfigure .cap{font-size:.78rem;color:var(--walnut-60);margin-top:2px}
.blx .btn-add{background:var(--walnut);color:var(--paper);border:none;border-radius:6px;font-size:.85rem;font-weight:500;padding:9px 16px;margin-left:26px;cursor:pointer;transition:background .15s}
.blx .btn-add:hover{background:#2e261e}
.blx .filters{display:flex;gap:10px;align-items:center;margin:26px 0 14px;flex-wrap:wrap}
.blx .filters select{appearance:none;background:var(--paper);border:1px solid var(--line-strong);border-radius:6px;padding:7px 30px 7px 12px;font-family:inherit;font-size:.82rem;color:var(--walnut);cursor:pointer;
  background-image:url("data:image/svg+xml,%3Csvg width='9' height='6' viewBox='0 0 9 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l3.5 3.5L8 1' stroke='%237A6E61' stroke-width='1.4' stroke-linecap='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 11px center}
.blx .filters .count{margin-left:auto;font-size:.8rem;color:var(--walnut-60)}
.blx .ledger{background:var(--paper);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.blx table{width:100%;border-collapse:collapse}
.blx thead th{text-align:left;font-size:.75rem;font-weight:500;color:var(--walnut-60);padding:12px 16px;border-bottom:1px solid var(--line);background:#FAF6EE}
.blx thead th.r,.blx td.r{text-align:right}
.blx tbody td{padding:14px 16px;font-size:.88rem;border-bottom:1px solid var(--line);vertical-align:middle}
.blx tbody tr:last-child td{border-bottom:none}
.blx tbody tr.clk{cursor:pointer}
.blx tbody tr.clk:hover{background:#FBF7EF}
.blx .vendor{font-weight:500}
.blx .billno{font-family:'DM Mono',monospace;font-size:.8rem}
.blx .billdate{color:var(--walnut-60);font-size:.8rem;margin-top:2px}
.blx .site{color:var(--walnut-60);font-size:.83rem}
.blx .amt{font-family:'DM Mono',monospace;font-size:.88rem}
.blx .chip{display:inline-block;font-family:'DM Mono',monospace;font-size:.72rem;border:1px solid var(--line-strong);border-radius:5px;padding:3px 8px;background:var(--cream);color:var(--walnut);white-space:nowrap}
.blx .chip.consol{background:var(--amber-tint);border-color:#E0D3AC}
.blx .noref{color:var(--walnut-soft);font-size:.85rem}
.blx .status{font-size:.8rem;font-weight:500}
.blx .status.settled{color:var(--sage)}
.blx .status.part{color:var(--walnut-60)}
.blx .status.unpaid{color:var(--terracotta)}
.blx .status .sub{display:block;font-weight:400;font-family:'DM Mono',monospace;font-size:.72rem;color:var(--walnut-soft);margin-top:2px}
.blx .empty{padding:56px 20px;text-align:center;color:var(--walnut-60);font-size:.9rem}
/* detail */
.blx .backline{display:inline-flex;align-items:center;gap:8px;font-size:.83rem;color:var(--walnut-60);text-decoration:none;margin-bottom:22px;background:none;border:none;padding:0;cursor:pointer}
.blx .backline:hover{color:var(--walnut)}
.blx .dethead{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:26px;gap:20px;flex-wrap:wrap}
.blx .dethead h1{font-family:'Playfair Display',Georgia,serif;font-weight:500;font-size:1.7rem;margin:0}
.blx .dethead .meta{font-size:.85rem;color:var(--walnut-60);margin-top:6px}
.blx .dethead .meta .m{font-family:'DM Mono',monospace;font-size:.8rem;color:var(--walnut)}
.blx .detamount{text-align:right}
.blx .detamount .num{font-family:'DM Mono',monospace;font-size:1.6rem;font-weight:500}
.blx .detamount .state{font-size:.82rem;margin-top:4px}
.blx .detgrid{display:grid;grid-template-columns:380px 1fr;gap:28px;align-items:start}
.blx .docpane{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:18px}
.blx .docempty{min-height:200px;display:grid;place-items:center;color:var(--walnut-soft);font-size:.85rem;text-align:center;border:1px dashed var(--line-strong);border-radius:6px}
.blx .docactions{display:flex;gap:14px;margin-top:14px}
.blx .docactions button{background:none;border:none;font-size:.8rem;color:var(--walnut-60);text-decoration:underline;text-underline-offset:3px;padding:0;cursor:pointer}
.blx .docactions button:hover{color:var(--walnut)}
.blx .datapane{display:flex;flex-direction:column;gap:22px}
.blx .card{background:var(--paper);border:1px solid var(--line);border-radius:10px}
.blx .card .cardhead{padding:13px 18px;border-bottom:1px solid var(--line);font-size:.82rem;font-weight:600;display:flex;justify-content:space-between;align-items:baseline}
.blx .cardhead .aside{font-weight:400;font-size:.78rem;color:var(--walnut-60)}
.blx .lines td{padding:11px 18px;font-size:.85rem;border-bottom:1px solid var(--line)}
.blx .lines tr:last-child td{border-bottom:none}
.blx .lines .qty{font-family:'DM Mono',monospace;font-size:.8rem;color:var(--walnut-60);white-space:nowrap}
.blx .lines .lr{font-family:'DM Mono',monospace;font-size:.83rem;text-align:right;white-space:nowrap}
.blx .refrow{display:flex;align-items:center;justify-content:space-between;padding:13px 18px;border-bottom:1px solid var(--line);font-size:.85rem;gap:12px}
.blx .refrow:last-child{border-bottom:none}
.blx .refrow .what{display:flex;align-items:center;gap:12px;min-width:0}
.blx .refrow .kind{color:var(--walnut-60);font-size:.78rem;width:64px;flex-shrink:0}
.blx .refrow .lr{font-family:'DM Mono',monospace;font-size:.83rem;flex-shrink:0}
.blx .refrow button.lnk{font-size:.78rem;color:var(--walnut-60);background:none;border:none;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.blx .refrow button.lnk:hover{color:var(--walnut)}
.blx .settlebar{padding:16px 18px}
.blx .settlebar .track{height:6px;border-radius:3px;background:var(--terra-tint);overflow:hidden;margin-top:10px}
.blx .settlebar .fill{height:100%;background:var(--sage);border-radius:3px}
.blx .settlebar .legend{display:flex;justify-content:space-between;font-size:.76rem;color:var(--walnut-60);margin-top:8px}
.blx .settlebar .legend .m{font-family:'DM Mono',monospace;color:var(--walnut)}
@media (max-width:900px){.blx .shell{padding:20px 16px 72px}.blx .detgrid{grid-template-columns:1fr}}
`;

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const STATUS_LABEL: Record<BillStatus, string> = { settled: 'Settled', part: 'Part-paid', unpaid: 'Unpaid' };

function StatusCell({ s, left }: { s: BillStatus; left: number }) {
  return (
    <span className={`status ${s}`}>{STATUS_LABEL[s]}
      {s === 'part' && left > 0.5 && <span className="sub">{inr(left)} left</span>}
    </span>
  );
}

// ── list ───────────────────────────────────────────────────────────────────
export default function Bills() {
  const navigate = useNavigate();
  const { billId } = useParams();
  if (billId) return <BillDetailView id={decodeURIComponent(billId)} />;

  const { data: bills = [], isLoading } = useQuery({ queryKey: ['bills'], queryFn: loadBills });
  const [site, setSite] = useState('');
  const [vendor, setVendor] = useState('');
  const [status, setStatus] = useState('');

  const sites = useMemo(() => [...new Set(bills.map(b => b.site).filter(Boolean))] as string[], [bills]);
  const vendors = useMemo(() => [...new Set(bills.map(b => b.vendor).filter(Boolean))], [bills]);
  const shown = useMemo(() => bills.filter(b =>
    (!site || b.site === site) && (!vendor || b.vendor === vendor) && (!status || b.status === status)), [bills, site, vendor, status]);
  const unpaidTotal = useMemo(() => bills.filter(b => b.status !== 'settled').reduce((s, b) => s + (b.amount - b.paid), 0), [bills]);
  const unpaidCount = useMemo(() => bills.filter(b => b.status !== 'settled').length, [bills]);

  return (
    <div className="blx">
      <style>{BLX_CSS}</style>
      <div className="shell">
        <header className="pagehead">
          <div>
            <h1>Bills</h1>
            <p className="lede">Every bill recorded across sites. POs, payments and ledgers point here.</p>
          </div>
          <div className="headwrap">
            <div className="headfigure">
              <div className="num">{inr(unpaidTotal)}</div>
              <div className="cap">unpaid across {unpaidCount} bill{unpaidCount !== 1 ? 's' : ''}</div>
            </div>
          </div>
        </header>

        <div className="filters">
          <select value={site} onChange={e => setSite(e.target.value)}><option value="">All sites</option>{sites.map(s => <option key={s} value={s}>{s}</option>)}</select>
          <select value={vendor} onChange={e => setVendor(e.target.value)}><option value="">All vendors</option>{vendors.map(v => <option key={v} value={v}>{v}</option>)}</select>
          <select value={status} onChange={e => setStatus(e.target.value)}><option value="">Any status</option><option value="unpaid">Unpaid</option><option value="part">Part-paid</option><option value="settled">Settled</option></select>
          <span className="count">{shown.length} bill{shown.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="ledger">
          <table>
            <thead><tr>
              <th style={{ width: '24%' }}>Vendor</th><th style={{ width: '18%' }}>Bill</th><th style={{ width: '18%' }}>Site</th>
              <th className="r" style={{ width: '13%' }}>Amount</th><th style={{ width: '15%' }}>Reference</th><th style={{ width: '12%' }}>Status</th>
            </tr></thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="empty">Loading bills…</td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={6} className="empty">{bills.length === 0 ? 'No bills recorded yet. A vendor bill on a PO, or a consolidated bill, appears here.' : 'No bills match these filters.'}</td></tr>
              ) : shown.map(b => (
                <tr key={b.id} className="clk" onClick={() => navigate(`/bills/${encodeURIComponent(b.id)}`)}>
                  <td className="vendor">{b.vendor}</td>
                  <td><div className="billno">{b.billNo || '—'}</div><div className="billdate">{fmtDate(b.billDate)}</div></td>
                  <td className="site">{b.site || '—'}</td>
                  <td className="r amt">{inr(b.amount)}</td>
                  <td><RefCell row={b} /></td>
                  <td><StatusCell s={b.status} left={b.amount - b.paid} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RefCell({ row }: { row: BillRow }) {
  if (row.ref.kind === 'po') return <span className="chip">{row.ref.poId}</span>;
  if (row.ref.kind === 'consolidated') return <span className="chip consol">{row.ref.label}</span>;
  return <span className="noref">No PO</span>;
}

// ── detail ─────────────────────────────────────────────────────────────────
function BillDetailView({ id }: { id: string }) {
  const navigate = useNavigate();
  const { data: b, isLoading } = useQuery({ queryKey: ['bill', id], queryFn: () => loadBillDetail(id) });
  const [lightbox, setLightbox] = useState<string | null>(null);

  if (isLoading) return <div className="blx"><style>{BLX_CSS}</style><div className="shell"><div className="empty">Loading…</div></div></div>;
  if (!b) return <div className="blx"><style>{BLX_CSS}</style><div className="shell"><button className="backline" onClick={() => navigate('/bills')}>← Bills</button><div className="empty">Bill not found.</div></div></div>;

  const remaining = Math.max(0, b.amount - b.paid);
  const pct = b.amount > 0 ? Math.min(100, Math.round((b.paid / b.amount) * 100)) : 0;
  const preview = (url: string) => { if (/\.pdf(\?|$)/i.test(url)) void openDoc(url); else setLightbox(url); };

  return (
    <div className="blx">
      <style>{BLX_CSS}</style>
      <div className="shell">
        <button className="backline" onClick={() => navigate('/bills')}>← Bills</button>

        <header className="dethead">
          <div>
            <h1>{b.vendor}</h1>
            <p className="meta">
              {b.ref.kind === 'consolidated'
                ? <>Consolidated bill · {fmtDate(b.periodFrom ?? null)} – {fmtDate(b.periodTo ?? null)}</>
                : <>Bill <span className="m">{b.billNo || '—'}</span> · {fmtDate(b.billDate)}{b.site ? <> · {b.site}</> : null}</>}
            </p>
          </div>
          <div className="detamount">
            <div className="num">{inr(b.amount)}</div>
            <div className={`state status ${b.status}`}>
              {b.status === 'settled' ? 'Settled' : b.status === 'part' ? `Part-paid — ${inr(remaining)} remaining` : `Unpaid — ${inr(b.amount)} due`}
            </div>
          </div>
        </header>

        <div className="detgrid">
          {/* document */}
          <aside className="docpane">
            {b.docUrl ? (
              <>
                <DocThumb stored={b.docUrl} onImageClick={setLightbox} w={340} h={430} label="Bill document" />
                <div className="docactions">
                  <button onClick={() => preview(b.docUrl!)}>Open full size</button>
                </div>
              </>
            ) : (
              <div className="docempty">No bill document attached.</div>
            )}
          </aside>

          {/* data */}
          <div className="datapane">
            {b.lines.length > 0 && (
              <div className="card">
                <div className="cardhead">Lines <span className="aside">as on the bill</span></div>
                <table className="lines"><tbody>
                  {b.lines.map((l, i) => (
                    <tr key={i}>
                      <td>{l.name}{l.spec ? <div className="qty" style={{ marginTop: 3 }}>{l.spec}</div> : null}</td>
                      <td className="qty">{l.qty ? `${l.qty}${l.unit ? ' ' + l.unit : ''} × ${inr(l.rate)}` : ''}</td>
                      <td className="lr">{inr(l.amount)}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            )}

            <div className="card">
              <div className="cardhead">Referenced by</div>
              {b.poId && (
                <div className="refrow">
                  <div className="what"><span className="kind">Order</span><span className="chip">{b.poId}</span></div>
                  <button className="lnk" onClick={() => navigate(`/purchase-orders/${b.poId}`)}>Open</button>
                </div>
              )}
              {b.payments.map(p => (
                <div className="refrow" key={p.txnId}>
                  <div className="what"><span className="kind">Payment</span><span>{p.mode || 'Payment'} · {fmtDate(p.date)}</span></div>
                  <span className="lr">{inr(p.amount)}</span>
                </div>
              ))}
              {!b.poId && b.payments.length === 0 && <div className="refrow"><span className="site">Nothing points here yet.</span></div>}
            </div>

            <div className="card settlebar">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: '.82rem', fontWeight: 600 }}>Settlement</span>
                <span style={{ fontSize: '.78rem', color: 'var(--walnut-60)' }}>derived from allocations</span>
              </div>
              <div className="track"><div className="fill" style={{ width: `${pct}%` }} /></div>
              <div className="legend">
                <span><span className="m">{inr(b.paid)}</span> allocated</span>
                <span><span className="m">{inr(remaining)}</span> remaining</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <ImageLightbox url={lightbox} title="Bill document" onClose={() => setLightbox(null)} />
    </div>
  );
}
