// Per-line variance — the recorded bills vs the order, built from the bill entities' STORED lines
// (never a re-read of the image). Bill lines are matched to PO lines by normalised name and summed
// across all of the PO's bills; each row flags billed-over-ordered. Bill lines with no match on the
// order show as "not on the order". Scoped under .pbv so it can sit inside the PO detail (.podx).
import type { PoBill } from '../../lib/billsApi';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface PoLine { id: string | number; item_name: string; unit?: string | null; quantity_ordered?: number | null; unit_rate?: number | null; total_amount?: number | null }
interface BillLine { name: string; unit: string | null; qty: number; rate: number; amount: number }

const PBV_CSS = `
.pbv{margin-top:14px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--paper)}
.pbv .h{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:11px 14px;border-bottom:1px solid var(--line);background:var(--paper-2)}
.pbv .h b{font:600 12px/1 "DM Sans",system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-2)}
.pbv .h .note{font-size:11.5px;color:var(--ink-3)}
.pbv table{width:100%;border-collapse:collapse}
.pbv th{font:500 11px "DM Sans",system-ui,sans-serif;letter-spacing:.02em;color:var(--ink-3);text-align:right;padding:8px 14px;background:var(--paper-2);border-bottom:1px solid var(--line-2);white-space:nowrap}
.pbv th.l{text-align:left}
.pbv td{padding:9px 14px;border-bottom:1px solid var(--line-2);font-size:13px;vertical-align:top}
.pbv tr:last-child td{border-bottom:0}
.pbv td.num{text-align:right;font-family:"DM Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums;white-space:nowrap}
.pbv .item b{font-weight:600;color:var(--ink)}
.pbv .item small{display:block;color:var(--ink-3);font-size:11.5px;margin-top:1px}
.pbv .dim{color:var(--ink-3)}
.pbv .flag{font-size:11px;font-weight:600}
.pbv .flag.over{color:var(--terra)}
.pbv .flag.ok{color:var(--sage)}
.pbv .flag.extra{color:var(--gold)}
.pbv .flag.under{color:var(--ink-3)}
.pbv tfoot td{background:var(--paper-2);font-size:12.5px;border-top:2px solid var(--line)}
.pbv tfoot td.num{font-weight:600;color:var(--ink)}
`;

export function PoBillVariance({ poLines, bills }: { poLines: PoLine[]; bills: PoBill[] }) {
  const billLines: BillLine[] = bills.flatMap(b => (b.lines ?? []).map((l: any) => ({
    name: l.name ?? l.item ?? '—', unit: l.unit ?? null, qty: Number(l.qty) || 0, rate: Number(l.rate) || 0,
    amount: Number(l.amount) || (Number(l.qty) || 0) * (Number(l.rate) || 0),
  })));
  if (billLines.length === 0) return null;   // bills carry no itemised lines (e.g. a converted legacy bill)

  // Sum billed per normalised item name.
  const billByKey: Record<string, { qty: number; amount: number; rate: number }> = {};
  for (const l of billLines) {
    const k = norm(l.name);
    const e = (billByKey[k] ||= { qty: 0, amount: 0, rate: l.rate });
    e.qty += l.qty; e.amount += l.amount; if (l.rate) e.rate = l.rate;
  }
  const usedKeys = new Set<string>();

  const rows = poLines.map(li => {
    const k = norm(li.item_name);
    const b = billByKey[k];
    if (b) usedKeys.add(k);
    const ordQty = Number(li.quantity_ordered) || 0;
    const ordRate = Number(li.unit_rate) || 0;
    const ordAmt = Number(li.total_amount) || ordQty * ordRate;
    const billedAmt = b?.amount ?? 0;
    const diff = billedAmt - ordAmt;
    const flag = !b ? { cls: 'under', txt: 'not billed' }
      : diff > 0.5 ? { cls: 'over', txt: `+${inr(diff)}` }
      : diff < -0.5 ? { cls: 'ok', txt: `−${inr(-diff)}` }
      : { cls: 'ok', txt: 'matches' };
    return { name: li.item_name, unit: li.unit, ordQty, ordRate, ordAmt, b, flag };
  });

  // Bill lines that matched nothing on the order.
  const extras = Object.entries(billByKey).filter(([k]) => !usedKeys.has(k)).map(([, v], i) => ({ v, i }));
  const extraNames = billLines.filter(l => !usedKeys.has(norm(l.name)));

  const ordTotal = rows.reduce((s, r) => s + r.ordAmt, 0);
  const billedTotal = billLines.reduce((s, l) => s + l.amount, 0);
  const diffTotal = billedTotal - ordTotal;

  return (
    <div className="pbv">
      <style>{PBV_CSS}</style>
      <div className="h"><b>Bill vs order</b><span className="note">from the recorded bill{bills.length > 1 ? 's' : ''} · not re-read</span></div>
      <table>
        <thead><tr>
          <th className="l">Item</th>
          <th>Ordered</th>
          <th>Billed</th>
          <th>Δ</th>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`o${i}`}>
              <td className="item"><b>{r.name}</b>{r.unit ? <small>{r.unit}</small> : null}</td>
              <td className="num dim">{r.ordQty ? `${r.ordQty} × ${inr(r.ordRate)}` : ''}<div>{inr(r.ordAmt)}</div></td>
              <td className="num">{r.b ? <>{r.b.qty ? `${r.b.qty} × ${inr(r.b.rate)}` : ''}<div>{inr(r.b.amount)}</div></> : <span className="dim">—</span>}</td>
              <td className="num"><span className={`flag ${r.flag.cls}`}>{r.flag.txt}</span></td>
            </tr>
          ))}
          {extras.length > 0 && extraNames.length > 0 && (() => {
            // Group extra bill lines by name for the display.
            const byName: Record<string, { qty: number; amount: number; rate: number; unit: string | null }> = {};
            extraNames.forEach(l => { const e = (byName[l.name] ||= { qty: 0, amount: 0, rate: l.rate, unit: l.unit }); e.qty += l.qty; e.amount += l.amount; });
            return Object.entries(byName).map(([name, v], i) => (
              <tr key={`x${i}`}>
                <td className="item"><b>{name}</b><small>on the bill, not the order</small></td>
                <td className="num dim">—</td>
                <td className="num">{v.qty ? `${v.qty} × ${inr(v.rate)}` : ''}<div>{inr(v.amount)}</div></td>
                <td className="num"><span className="flag extra">extra</span></td>
              </tr>
            ));
          })()}
        </tbody>
        <tfoot>
          <tr>
            <td className="dim" style={{ fontWeight: 500 }}>Total</td>
            <td className="num">{inr(ordTotal)}</td>
            <td className="num">{inr(billedTotal)}</td>
            <td className="num"><span className={`flag ${diffTotal > 0.5 ? 'over' : diffTotal < -0.5 ? 'ok' : 'ok'}`}>{Math.abs(diffTotal) < 0.5 ? 'matches' : (diffTotal > 0 ? '+' : '−') + inr(Math.abs(diffTotal))}</span></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
