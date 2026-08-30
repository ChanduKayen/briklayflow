// Quote comparison + finalization — opened from an "Awaiting quotes" row in the PO list.
// Shows every vendor's rates side by side for one RFQ, marks the cheapest per item, and
// lets management/principal turn a chosen vendor's quote into a PO.
import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useUserProfile } from '../App';
import { useSnackbar } from '../components/Snackbar';

interface RfqItem { line: number; item_name: string; spec?: string; qty?: number | string; unit?: string }
interface Recipient { recipient_id: string; stakeholder_id: string | null; vendor_name: string | null; status: string; quoted_total: number | null; transport_included: boolean | null; gst_included: boolean | null; valid_days: number | null; vendor_note: string | null }
interface QuoteRow { recipient_id: string; line: number; unit_rate: number | null; supplied: boolean; variant_note: string | null }

const fmt = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

const CSS = `
.rcx{--cream:#F6F2EA;--paper:#FFFDF9;--paper-2:#FBF8F2;--ink:#2F2622;--ink-2:#6E635B;--ink-3:#A39A91;--line:#E4DCD0;--line-2:#EFE9DF;--terra:#C4613A;--terra-deep:#A94E2B;--terra-tint:#F8E7DE;--sage:#5F7F5B;--sage-tint:#E7EFE4;--gold:#B8862E;--gold-tint:#F7EEDA;
  background:var(--cream);color:var(--ink);font:15px/1.45 "DM Sans",system-ui,sans-serif;min-height:100vh}
.rcx *{box-sizing:border-box}
.rcx .mono{font-family:"DM Mono",ui-monospace,monospace;font-feature-settings:"tnum"}
.rcx .page{max-width:1100px;margin:0 auto;padding:22px 24px 80px}
.rcx .crumb{display:flex;align-items:center;gap:6px;color:var(--ink-3);font-size:13px;margin-bottom:14px}
.rcx .crumb a{color:var(--ink-2);cursor:pointer;text-decoration:none}
.rcx h1{font:600 24px/1.15 "Playfair Display",Georgia,serif;margin:0 0 4px}
.rcx .sub{color:var(--ink-2);font-size:14px;display:flex;flex-wrap:wrap;gap:6px 14px}
.rcx .sub b{color:var(--ink);font-weight:500}
.rcx .pending{margin:14px 0 0;font-size:13px;color:var(--ink-3)}
.rcx .pending b{color:var(--gold)}
.rcx .scroll{overflow-x:auto;border:1px solid var(--line);border-radius:12px;box-shadow:0 1px 2px rgba(47,38,34,.04),0 8px 24px -18px rgba(47,38,34,.25);background:var(--paper);margin-top:18px}
.rcx table{border-collapse:collapse;width:100%;min-width:640px;font-size:13.5px}
.rcx th,.rcx td{padding:10px 12px;border-bottom:1px solid var(--line-2);text-align:right;white-space:nowrap}
.rcx th.item,.rcx td.item{text-align:left;position:sticky;left:0;background:var(--paper);z-index:1;min-width:200px;white-space:normal}
.rcx thead th{background:var(--paper-2);font-weight:500;font-size:12px;color:var(--ink-2);border-bottom:1px solid var(--line)}
.rcx thead th.item{background:var(--paper-2)}
.rcx thead .vh{font-weight:600;color:var(--ink);font-size:13.5px}
.rcx thead .vh small{display:block;font-weight:400;color:var(--ink-3);font-size:11px}
.rcx td.item b{font-weight:600}
.rcx td.item small{display:block;color:var(--ink-3);font-size:12px}
.rcx td.item .q{font:500 11px "DM Mono";color:var(--ink-2)}
.rcx td.cell{font-family:"DM Mono",monospace}
.rcx td.cell.low{background:var(--sage-tint);color:var(--sage);font-weight:600}
.rcx td.cell.no{color:var(--ink-3)}
.rcx td.cell .v{display:block;font-size:10.5px;color:var(--gold);font-weight:600}
.rcx tfoot td{background:var(--paper-2);font-weight:600;color:var(--ink);border-top:2px solid var(--line);font-family:"DM Mono",monospace}
.rcx tfoot td.item{font-family:"DM Sans";background:var(--paper-2)}
.rcx tfoot td.low{color:var(--sage)}
.rcx .flags td{background:var(--paper);font-size:11.5px;color:var(--ink-2);font-family:"DM Sans";text-align:center;border-bottom:0}
.rcx .flags td.item{text-align:left;color:var(--ink-3)}
.rcx .actions td{background:var(--paper-2);padding:12px;border-top:1px solid var(--line);text-align:center}
.rcx .actions td.item{background:var(--paper-2)}
.rcx .pick{height:34px;padding:0 14px;border-radius:8px;border:1px solid var(--terra);background:var(--terra);color:#fff;font-size:13px;font-weight:600;cursor:pointer;transition:background .15s}
.rcx .pick:hover{background:var(--terra-deep)}
.rcx .pick:disabled{opacity:.5;cursor:not-allowed}
.rcx .empty{padding:60px 20px;text-align:center;color:var(--ink-3)}
.rcx .btn{height:38px;padding:0 16px;border-radius:8px;border:1px solid var(--line);background:var(--paper);font-weight:500;cursor:pointer}
`;

export default function RfqCompare({ session }: { session: Session }) {
  const { rfqId } = useParams();
  const navigate = useNavigate();
  const { data: profile } = useUserProfile(session.user.id);
  const { show } = useSnackbar();
  const canConvert = profile?.role === 'management' || profile?.role === 'principal';
  const [converting, setConverting] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['rfq_compare', rfqId],
    enabled: !!rfqId,
    queryFn: async () => {
      const [rfqQ, rcptQ, quoteQ] = await Promise.all([
        supabase.from('rfqs').select('*').eq('rfq_id', rfqId).single(),
        supabase.from('rfq_recipients').select('*').eq('rfq_id', rfqId).order('sent_at'),
        supabase.from('rfq_quotes').select('recipient_id, line, unit_rate, supplied, variant_note').eq('rfq_id', rfqId),
      ]);
      if (rfqQ.error) throw rfqQ.error;
      return {
        rfq: rfqQ.data as any,
        recipients: (rcptQ.data ?? []) as Recipient[],
        quotes: (quoteQ.data ?? []) as QuoteRow[],
      };
    },
  });

  const items: RfqItem[] = data?.rfq?.items ?? [];
  const replied = useMemo(() => (data?.recipients ?? []).filter((r) => r.status === 'quoted'), [data]);
  const pendingNames = (data?.recipients ?? []).filter((r) => r.status !== 'quoted').map((r) => r.vendor_name || 'Vendor');

  // rate lookup: [recipient_id][line] -> quote
  const rate = (rid: string, line: number) => (data?.quotes ?? []).find((x) => x.recipient_id === rid && x.line === line);
  const lineTotal = (rid: string, it: RfqItem) => {
    const q = rate(rid, it.line);
    if (!q || !q.supplied || q.unit_rate == null) return null;
    return Number(q.unit_rate) * (Number(it.qty) || 0);
  };
  const vendorTotal = (rid: string) => items.reduce((s, it) => s + (lineTotal(rid, it) ?? 0), 0);
  const lowestForLine = (it: RfqItem) => {
    const rates = replied.map((r) => { const q = rate(r.recipient_id, it.line); return q?.supplied && q.unit_rate != null ? Number(q.unit_rate) : Infinity; });
    const min = Math.min(...rates);
    return isFinite(min) ? min : null;
  };
  const cheapestVendor = useMemo(() => {
    let best: string | null = null, bestT = Infinity;
    replied.forEach((r) => { const t = vendorTotal(r.recipient_id); if (t > 0 && t < bestT) { bestT = t; best = r.recipient_id; } });
    return best;
  }, [replied, data]);

  const convert = async (r: Recipient) => {
    if (!r.stakeholder_id) { show('This vendor has no contact record — add them first', { type: 'error' }); return; }
    setConverting(r.recipient_id);
    try {
      const today = new Date().toISOString().split('T')[0];
      const lineItems = items.map((it, i) => {
        const q = rate(r.recipient_id, it.line);
        const unit = Number(q?.unit_rate) || 0;
        const qty = Number(it.qty) || 0;
        const basic = qty * unit;
        return { line_number: i + 1, category_id: null, item_name: it.item_name, specification: it.spec || null,
          unit: it.unit || null, quantity_ordered: qty, unit_rate: unit, basic_amount: basic,
          discount_percent: 0, discount_amount: 0, gst_rate: 0, cgst: 0, sgst: 0, igst: 0, total_amount: basic };
      }).filter((li) => li.quantity_ordered > 0 && li.unit_rate > 0);
      if (lineItems.length === 0) { show('This vendor priced nothing to order', { type: 'error' }); setConverting(null); return; }
      const orderValue = lineItems.reduce((s, li) => s + li.total_amount, 0);
      const poData = {
        org_id: data!.rfq.org_id, project_id: data!.rfq.project_id, stakeholder_id: r.stakeholder_id,
        items: [], order_value: orderValue, total_value: orderValue, gst_value: 0, status: 'ORDERED',
        date_issued: today, expected_delivery: '', delivery_location: data!.rfq.delivery_location || '',
        payment_terms_days: 0, ordered_by: profile?.name || session.user.id,
        vendor_notes: null, internal_notes: `From quote · ${r.vendor_name ?? ''}`, created_by: session.user.id,
      };
      const { data: res, error } = await supabase.rpc('create_purchase_order', { p_po_data: poData, p_line_items: lineItems });
      if (error) throw error;
      if (!(res as any)?.success) throw new Error((res as any)?.error || 'Could not create the PO');
      await supabase.from('rfqs').update({ status: 'closed' }).eq('rfq_id', rfqId);
      show('Purchase order created');
      navigate(`/purchase-orders/${(res as any).po_id}`, { state: { from: 'list' } });
    } catch (e: any) {
      show(e.message || 'Could not create the PO', { type: 'error' });
      setConverting(null);
    }
  };

  if (isLoading) return <div className="rcx"><style>{CSS}</style><div className="page"><div className="empty">Loading quotes…</div></div></div>;
  if (!data?.rfq) return <div className="rcx"><style>{CSS}</style><div className="page"><div className="empty">Enquiry not found.</div></div></div>;

  const summary = items.slice(0, 2).map((i) => i.item_name).join(', ') + (items.length > 2 ? ` +${items.length - 2}` : '');

  return (
    <div className="rcx"><style>{CSS}</style>
      <div className="page">
        <div className="crumb"><a onClick={() => navigate('/purchase-orders')}>Purchase orders</a> › <b>Quotes</b></div>
        <h1>Compare quotes</h1>
        <div className="sub">
          <span>{summary || `${items.length} items`}</span>
          {data.rfq.delivery_location && <><span>·</span><span>to <b>{data.rfq.delivery_location}</b></span></>}
          <span>·</span><span><b>{replied.length}</b> of {data.recipients.length} replied</span>
        </div>
        {pendingNames.length > 0 && <p className="pending">Awaiting: <b>{pendingNames.join(', ')}</b></p>}

        {replied.length === 0 ? (
          <div className="scroll"><div className="empty">No vendor has submitted rates yet. They'll appear here as they reply.</div></div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th className="item">Item</th>
                  {replied.map((r) => (
                    <th key={r.recipient_id} className="vh">{r.vendor_name}
                      <small>{r.transport_included ? 'transport in' : 'transport extra'} · {r.gst_included ? 'GST in' : 'GST extra'}{r.valid_days ? ` · ${r.valid_days}d` : ''}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const low = lowestForLine(it);
                  return (
                    <tr key={it.line}>
                      <td className="item"><b>{it.item_name}</b>{it.spec && <small>{it.spec}</small>}<span className="q">{it.qty} {it.unit}</span></td>
                      {replied.map((r) => {
                        const q = rate(r.recipient_id, it.line);
                        if (!q || !q.supplied || q.unit_rate == null) return <td key={r.recipient_id} className="cell no">—</td>;
                        const isLow = low != null && Number(q.unit_rate) === low;
                        return <td key={r.recipient_id} className={`cell${isLow ? ' low' : ''}`}>{fmt(Number(q.unit_rate))}{q.variant_note && <span className="v" title={q.variant_note}>≠ offered diff.</span>}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="item">Total</td>
                  {replied.map((r) => { const t = vendorTotal(r.recipient_id); return <td key={r.recipient_id} className={`${cheapestVendor === r.recipient_id ? 'low' : ''}`}>{fmt(t)}</td>; })}
                </tr>
                {replied.some((r) => r.vendor_note) && (
                  <tr className="flags">
                    <td className="item">Note</td>
                    {replied.map((r) => <td key={r.recipient_id}>{r.vendor_note || '—'}</td>)}
                  </tr>
                )}
                {canConvert && (
                  <tr className="actions">
                    <td className="item">{cheapestVendor && <span style={{ fontSize: 12, color: 'var(--sage)' }}>◆ cheapest highlighted</span>}</td>
                    {replied.map((r) => (
                      <td key={r.recipient_id}>
                        <button className="pick" disabled={converting !== null} onClick={() => convert(r)}>
                          {converting === r.recipient_id ? 'Creating…' : 'Create PO'}
                        </button>
                      </td>
                    ))}
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
