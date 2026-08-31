// Quote comparison + finalization — opened from an "Awaiting quotes" row in the PO list.
// Faithful build of the quote-compare mockup (scoped .qcx) wired to real RFQ data:
// figures, computed insights, item-by-item table, order / split-order, add-a-vendor,
// re-ask, add-a-quote-from-photo, extend/cancel, PDF. Ordering closes the enquiry so
// the vendors' quote pages stop taking rates.
import { useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../lib/supabase';
import { sendPoToVendor, normalizeWhatsApp } from '../lib/poVendorSend';
import { useUserProfile } from '../App';
import { useSnackbar } from '../components/Snackbar';
import RequestQuotesModal from '../components/po-new-ui/RequestQuotesModal';

interface RfqItem { line: number; item_name: string; spec?: string; qty?: number | string; unit?: string }
interface Recipient { recipient_id: string; stakeholder_id: string | null; vendor_name: string | null; vendor_phone: string | null; status: string; source: string | null; sent_at: string | null; quoted_at: string | null; quoted_total: number | null; transport_included: boolean | null; gst_included: boolean | null; valid_days: number | null; vendor_note: string | null }
interface QuoteRow { recipient_id: string; line: number; unit_rate: number | null; supplied: boolean; variant_note: string | null }

const fmt = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const dstr = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');
const daysAgo = (s: string | null | undefined) => (s ? Math.max(0, Math.round((Date.now() - new Date(s).getTime()) / 86400000)) : 0);

const CSS = `
.qcx{--cream:#F6F2EA;--paper:#FFFDF9;--paper-2:#FBF8F2;--ink:#2F2622;--ink-2:#6E635B;--ink-3:#A39A91;--line:#E4DCD0;--line-2:#EFE9DF;--terra:#C4613A;--terra-deep:#A94E2B;--terra-tint:#F8E7DE;--sage:#5F7F5B;--sage-tint:#E7EFE4;--gold:#B8862E;--gold-tint:#F7EEDA;--r:8px;--ease:cubic-bezier(.2,.7,.2,1);--shadow:0 1px 2px rgba(47,38,34,.04),0 8px 24px -18px rgba(47,38,34,.25);
  --serif:Georgia,'Times New Roman',serif;--sans:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;--mono:ui-monospace,'SF Mono',Menlo,Consolas,monospace;
  background:var(--cream);color:var(--ink);font:15px/1.45 var(--sans);-webkit-font-smoothing:antialiased;min-height:100vh}
.qcx *{box-sizing:border-box}
.qcx .mono{font-family:var(--mono);font-feature-settings:"tnum"}
.qcx button,.qcx input{font:inherit;color:inherit}
.qcx .page{max-width:1120px;margin:0 auto;padding:22px 32px 90px}
.qcx .crumb{display:flex;align-items:center;gap:6px;color:var(--ink-3);font-size:13px;margin-bottom:16px}
.qcx .crumb a{color:var(--ink-2);text-decoration:none;cursor:pointer}
.qcx .crumb b{color:var(--ink);font-weight:500}
.qcx .head{display:grid;grid-template-columns:1fr auto auto;gap:8px 22px;align-items:start;margin-bottom:20px}
.qcx h1{font:600 28px/1.1 var(--serif);margin:0 0 8px;letter-spacing:-.01em;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.qcx .tag{font:500 13px/1 var(--mono);letter-spacing:.04em;color:var(--ink-2);background:var(--paper);border:1px solid var(--line);padding:6px 9px;border-radius:6px}
.qcx .meta{color:var(--ink-2);font-size:14px;display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center}
.qcx .meta b{color:var(--ink);font-weight:500}
.qcx .meta .sep{width:1px;height:16px;background:var(--line)}
.qcx .chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:12.5px;font-weight:500}
.qcx .chip i{width:6px;height:6px;border-radius:50%}
.qcx .chip.gold{color:var(--gold);background:var(--gold-tint)}.qcx .chip.gold i{background:var(--gold)}
.qcx .awarded{display:flex;align-items:center;gap:12px;background:var(--sage-tint);border:1px solid #BFD8BC;border-radius:10px;padding:12px 16px;margin-bottom:18px;font-size:14px;color:var(--ink)}
.qcx .awarded .ic{width:26px;height:26px;border-radius:50%;background:var(--sage);color:#fff;display:grid;place-items:center;flex:none}
.qcx .awarded b{font-weight:600}
.qcx .awarded a{color:var(--sage);font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.qcx .awarded.cancelled{background:var(--terra-tint);border-color:#E8C5B4}
.qcx .awarded.cancelled .ic{background:var(--terra)}
.qcx .amount{text-align:right;padding-top:2px}
.qcx .amount small{border-top:3px solid var(--sage);padding-top:6px;display:inline-block;font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-2);margin-bottom:2px}
.qcx .amount .mono{font-size:28px;font-weight:500;letter-spacing:-.02em;line-height:1;display:block;color:var(--sage)}
.qcx .amount .dir{font-size:12px;color:var(--ink-3);margin-top:2px}
.qcx .more{position:relative}
.qcx .kebab{width:36px;height:36px;border-radius:50%;border:1px solid transparent;background:transparent;cursor:pointer;display:grid;place-items:center;color:var(--ink-2);transition:background .15s,border-color .15s}
.qcx .kebab:hover{background:var(--paper);border-color:var(--line)}
.qcx .menu{position:absolute;right:0;top:calc(100% + 6px);background:var(--paper);border:1px solid var(--line);border-radius:var(--r);box-shadow:0 12px 30px -12px rgba(47,38,34,.28);padding:4px;min-width:220px;z-index:40}
.qcx .menu button{display:flex;align-items:center;gap:10px;width:100%;border:0;background:transparent;text-align:left;padding:9px 10px;border-radius:6px;cursor:pointer;font-size:14px;color:var(--ink)}
.qcx .menu button:hover{background:var(--paper-2)}
.qcx .menu button.danger{color:var(--terra)}.qcx .menu button.danger:hover{background:var(--terra-tint)}
.qcx .menu hr{border:0;border-top:1px solid var(--line-2);margin:4px 0}
.qcx .menu svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.7}
.qcx .figs{display:grid;grid-template-columns:repeat(4,1fr);background:var(--paper);border:1px solid var(--line);border-radius:10px;overflow:hidden;box-shadow:var(--shadow);margin-bottom:14px}
.qcx .figs>div{padding:14px 18px 12px;border-right:1px solid var(--line-2);position:relative}
.qcx .figs>div:last-child{border-right:0}
.qcx .figs>div::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:var(--line-2)}
.qcx .figs .sage::before{background:var(--sage)}.qcx .figs .gold::before{background:var(--gold)}.qcx .figs .terra::before{background:var(--terra)}
.qcx .figs small{display:block;font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2);margin-bottom:4px}
.qcx .figs .mono{font-size:20px;font-weight:500}
.qcx .figs .sub{font-size:12px;color:var(--ink-3);margin-top:2px}
.qcx .figs .sage .mono{color:var(--sage)}.qcx .figs .gold .mono{color:var(--gold)}
.qcx .brieftgl{display:flex;align-items:center;gap:8px;width:100%;border:1px solid var(--line);background:var(--paper);border-radius:10px;padding:10px 16px;font-size:13.5px;font-weight:500;color:var(--ink-2);cursor:pointer;box-shadow:var(--shadow);margin-bottom:14px}
.qcx .brieftgl:hover{background:var(--paper-2)}
.qcx .brieftgl .g{color:var(--gold);font-weight:700}
.qcx .brieftgl .cue{margin-left:auto;font-size:12.5px;color:var(--ink-3);text-decoration:underline;text-underline-offset:2px}
.qcx .brief{background:var(--paper);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);padding:4px 0;margin:-6px 0 14px}
.qcx .brief div{display:grid;grid-template-columns:22px 1fr auto;gap:10px;align-items:start;padding:10px 16px;font-size:14px;color:var(--ink-2)}
.qcx .brief div+div{border-top:1px solid var(--line-2)}
.qcx .brief b{color:var(--ink);font-weight:500}
.qcx .brief .g{color:var(--gold);font-weight:700}.qcx .brief .s{color:var(--sage);font-weight:700}
.qcx .brief button{border:1px solid var(--line);background:var(--paper);border-radius:6px;height:28px;padding:0 10px;font-size:12.5px;font-weight:500;color:var(--ink-2);cursor:pointer;white-space:nowrap}
.qcx .brief button:hover{background:var(--sage-tint);color:var(--sage);border-color:transparent}
.qcx .sec{display:flex;align-items:center;justify-content:space-between;margin:22px 0 10px;gap:10px;flex-wrap:wrap}
.qcx .sec h2{margin:0;font:600 11.5px/1 var(--sans);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-2);padding-left:10px;border-left:3px solid var(--terra);display:flex;align-items:center;gap:14px;flex:1}
.qcx .sec h2::after{content:"";flex:1;height:1px;background:var(--line);margin-right:14px}
.qcx .btn{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 13px;border-radius:var(--r);border:1px solid var(--line);background:var(--paper);color:var(--ink);font-weight:500;font-size:13.5px;cursor:pointer;transition:background .16s}
.qcx .btn:hover{background:var(--paper-2)}
.qcx .btn svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.8}
.qcx .sheet{background:var(--paper);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);overflow-x:auto;position:relative}
.qcx table{border-collapse:collapse;min-width:100%}
.qcx th,.qcx td{border-bottom:1px solid var(--line-2);padding:10px 14px;text-align:left;vertical-align:top}
.qcx th+th,.qcx td+td{border-left:1px solid var(--line-2)}
.qcx thead th{background:var(--paper-2);position:sticky;top:0}
.qcx .colItem{min-width:210px;position:sticky;left:0;background:var(--paper);z-index:2}
.qcx thead .colItem{background:var(--paper-2);z-index:3}
.qcx .vcol{min-width:190px}
.qcx .vhead b{display:block;font-weight:600;font-size:14.5px}
.qcx .vhead .st{display:block;font-size:12px;color:var(--ink-3);margin-top:2px;font-weight:400}
.qcx .vhead .st.ok{color:var(--sage)}
.qcx .vhead .best-tag{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--sage);background:var(--sage-tint);padding:2px 7px;border-radius:999px;margin-top:5px}
.qcx .vhead .src{display:inline-block;font-size:10.5px;font-weight:600;letter-spacing:.05em;color:var(--gold);background:var(--gold-tint);padding:2px 7px;border-radius:999px;margin-top:5px}
.qcx .vhead .nudge{margin-top:6px;height:26px;padding:0 9px;font-size:12px;border:1px solid var(--line);background:var(--paper);border-radius:6px;color:var(--ink-2);cursor:pointer;font-weight:500}
.qcx .vhead .nudge:hover{background:var(--gold-tint);color:var(--gold);border-color:transparent}
.qcx .vhead .nudge:disabled{opacity:.55;cursor:default}
.qcx .item b{display:block;font-weight:600;font-size:14.5px}
.qcx .item small{color:var(--ink-3);font-size:12px}
.qcx .cell{white-space:nowrap}
.qcx .cell .rate{font-family:var(--mono);font-weight:500;font-size:15px}
.qcx .cell .rate small{color:var(--ink-3);font-weight:400;font-size:11.5px;font-family:var(--sans)}
.qcx .cell .lt{display:block;font-size:12px;color:var(--ink-3);font-family:var(--mono);margin-top:1px}
.qcx td.low{background:var(--sage-tint)}.qcx td.low .rate{color:var(--sage)}
.qcx .cell .var{display:block;font-size:11.5px;color:var(--gold);font-weight:500;white-space:normal;max-width:180px;margin-top:3px}
.qcx .cell .var::before{content:"◆ "}
.qcx .cell.na{color:var(--ink-3)}
.qcx .await{color:var(--ink-3);font-style:italic}
.qcx tfoot td{background:var(--paper-2);border-top:2px solid var(--line)}
.qcx tfoot .tot{font:600 17px var(--mono);color:var(--ink)}
.qcx tfoot .tot.best{color:var(--sage)}
.qcx tfoot .terms{display:block;font-size:11.5px;color:var(--ink-3);margin-top:3px;white-space:normal;max-width:180px;line-height:1.5}
.qcx tfoot .terms .warn{color:var(--gold);font-weight:600}
.qcx .order{margin-top:8px;height:32px;padding:0 12px;border-radius:7px;border:1px solid var(--terra);background:var(--terra);color:#fff;font-size:13px;font-weight:600;cursor:pointer;transition:background .15s}
.qcx .order:hover{background:var(--terra-deep)}.qcx .order:disabled{opacity:.5;cursor:default}
.qcx .addcol{min-width:170px;background:var(--paper-2);text-align:center;vertical-align:middle}
.qcx .addv{border:1.5px dashed var(--line);border-radius:9px;background:transparent;color:var(--ink-2);font-weight:500;font-size:13.5px;cursor:pointer;padding:12px 14px;transition:border-color .15s,color .15s,background .15s}
.qcx .addv:hover{border-color:var(--terra);color:var(--terra);background:var(--terra-tint)}
.qcx .log{list-style:none;margin:0;padding:6px 0}
.qcx .log li{display:grid;grid-template-columns:120px 14px 1fr;gap:10px;padding:10px 16px;font-size:13.5px;color:var(--ink-2);align-items:start}
.qcx .log li+li{border-top:1px solid var(--line-2)}
.qcx .log li i{width:8px;height:8px;border-radius:50%;background:var(--line);border:2px solid var(--paper);box-shadow:0 0 0 1px var(--line);margin-top:6px}
.qcx .log li:first-child i{background:var(--terra);box-shadow:0 0 0 1px var(--terra)}
.qcx .log .mono{color:var(--ink-3);font-size:12px;padding-top:2px}
.qcx .log b{color:var(--ink);font-weight:500}
.qcx .sheet.clip{overflow:hidden}
.qcx .empty{padding:50px 20px;text-align:center;color:var(--ink-3)}
.qcx .scrim{position:fixed;inset:0;background:rgba(47,38,34,.35);display:grid;place-items:center;z-index:60;padding:20px}
.qcx .card{background:var(--paper);border:1px solid var(--line);border-radius:12px;box-shadow:0 24px 60px -20px rgba(47,38,34,.5);max-width:360px;width:100%;padding:22px}
.qcx .card h3{font:600 17px var(--serif);margin:0 0 10px}
.qcx .card p{margin:0 0 14px;font-size:13.5px;color:var(--ink-2)}
.qcx .card input{width:100%;height:40px;border:1px solid var(--line);border-radius:8px;padding:0 12px;outline:none;margin-bottom:14px}
.qcx .card .row{display:flex;gap:8px;justify-content:flex-end}
@media (max-width:900px){.qcx .page{padding:16px 14px 60px}.qcx .head{grid-template-columns:1fr auto}.qcx .amount{text-align:left;grid-column:1}.qcx .figs{grid-template-columns:1fr 1fr}}
`;

export default function RfqCompare({ session }: { session: Session }) {
  const { rfqId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: profile } = useUserProfile(session.user.id);
  const { show } = useSnackbar();
  const canConvert = profile?.role === 'management' || profile?.role === 'principal';

  const [menuOpen, setMenuOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [orderConfirm, setOrderConfirm] = useState<Recipient | null>(null);
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendDate, setExtendDate] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

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
      const rfq = rfqQ.data as any;
      let projectName = '';
      if (rfq.project_id) { const { data: p } = await supabase.from('projects').select('name').eq('project_id', rfq.project_id).maybeSingle(); projectName = p?.name || ''; }
      let creator = '';
      if (rfq.created_by) { const { data: u } = await supabase.from('user_profiles').select('name').eq('id', rfq.created_by).maybeSingle(); creator = u?.name || ''; }
      return { rfq, projectName, creator, recipients: (rcptQ.data ?? []) as Recipient[], quotes: (quoteQ.data ?? []) as QuoteRow[] };
    },
  });

  const items: RfqItem[] = data?.rfq?.items ?? [];
  const recips = data?.recipients ?? [];
  const quotes = data?.quotes ?? [];

  const q = (rid: string, line: number) => quotes.find((x) => x.recipient_id === rid && x.line === line);
  const rateOf = (rid: string, line: number) => { const x = q(rid, line); return x && x.supplied && x.unit_rate != null ? Number(x.unit_rate) : null; };
  const lineTot = (rid: string, it: RfqItem) => { const r = rateOf(rid, it.line); return r == null ? null : r * (Number(it.qty) || 0); };
  const vendorTot = (rid: string) => items.reduce((s, it) => s + (lineTot(rid, it) ?? 0), 0);
  // lowest rate per line, excluding variant (offered-different) cells
  const lowRate = (it: RfqItem) => {
    const rs = replied.map((r) => { const x = q(r.recipient_id, it.line); return x?.supplied && x.unit_rate != null && !x.variant_note ? Number(x.unit_rate) : Infinity; });
    const m = Math.min(...rs); return isFinite(m) ? m : null;
  };

  const replied = useMemo(() => recips.filter((r) => r.status === 'quoted').sort((a, b) => vendorTot(a.recipient_id) - vendorTot(b.recipient_id)), [recips, quotes]); // eslint-disable-line
  const pending = recips.filter((r) => r.status !== 'quoted');
  const cols = [...replied, ...pending];

  const totalsById = useMemo(() => Object.fromEntries(replied.map((r) => [r.recipient_id, vendorTot(r.recipient_id)])), [replied, quotes]); // eslint-disable-line
  const best = useMemo(() => { let id: string | null = null, t = Infinity; replied.forEach((r) => { const v = totalsById[r.recipient_id]; if (v > 0 && v < t) { t = v; id = r.recipient_id; } }); return { id, total: isFinite(t) ? t : 0 }; }, [replied, totalsById]);
  const bestVendor = replied.find((r) => r.recipient_id === best.id);

  // cheapest mix — each item to its lowest non-variant vendor
  const mix = useMemo(() => {
    let total = 0; const winners = new Map<string, RfqItem[]>();
    items.forEach((it) => {
      let bId: string | null = null, bRate = Infinity;
      replied.forEach((r) => { const x = q(r.recipient_id, it.line); if (x?.supplied && x.unit_rate != null && !x.variant_note && Number(x.unit_rate) < bRate) { bRate = Number(x.unit_rate); bId = r.recipient_id; } });
      if (bId && isFinite(bRate)) { total += bRate * (Number(it.qty) || 0); (winners.get(bId) ?? winners.set(bId, []).get(bId)!).push(it); }
    });
    return { total, winners };
  }, [items, replied, quotes]); // eslint-disable-line
  const spread = useMemo(() => { const ts = replied.map((r) => totalsById[r.recipient_id]).filter((t) => t > 0); if (ts.length < 2) return { abs: 0, pct: 0 }; const mn = Math.min(...ts), mx = Math.max(...ts); return { abs: mx - mn, pct: mn ? Math.round(((mx - mn) / mn) * 100) : 0 }; }, [replied, totalsById]);

  // ── computed insights ──────────────────────────────────────────────────────
  const insights = useMemo(() => {
    const out: { icon: 's' | 'g'; body: React.ReactNode; action?: React.ReactNode }[] = [];
    if (bestVendor && bestVendor.transport_included === false) {
      const incl = replied.find((r) => r.transport_included === true);
      if (incl) out.push({ icon: 's', body: <><b>{bestVendor.vendor_name} is lowest on the quoted rates, but their transport is billed separately.</b> {incl.vendor_name} includes it — the totals here count quoted rates only, so compare transport before deciding.</> });
    }
    const variants = quotes.filter((x) => x.variant_note && x.supplied);
    variants.slice(0, 2).forEach((x) => {
      const r = recips.find((rr) => rr.recipient_id === x.recipient_id); const it = items.find((i) => i.line === x.line);
      if (r && it) out.push({ icon: 'g', body: <>{r.vendor_name} quoted <b>{x.variant_note}</b> on {it.item_name} instead of what was asked — excluded from the auto-best. Read the note before counting it.</> });
    });
    if (mix.total > 0 && best.total > mix.total + 100) {
      const n = mix.winners.size;
      out.push({ icon: 'g', body: <>Splitting each item to its cheapest vendor saves <b>{fmt(best.total - mix.total)}</b> — if you're fine with {n} vendor{n > 1 ? 's' : ''} and {n} delivery schedule{n > 1 ? 's' : ''}.</>, action: <button onClick={splitOrder}>Create {n} split PO{n > 1 ? 's' : ''}</button> });
    }
    return out;
  }, [bestVendor, replied, quotes, mix, best]); // eslint-disable-line

  // ── actions ─────────────────────────────────────────────────────────────────
  const buildLineItems = (rid: string, subset: RfqItem[]) => subset.map((it, i) => {
    const rate = rateOf(rid, it.line) ?? 0; const qty = Number(it.qty) || 0; const basic = qty * rate;
    return { line_number: i + 1, category_id: null, item_name: it.item_name, specification: it.spec || null, unit: it.unit || null, quantity_ordered: qty, unit_rate: rate, basic_amount: basic, discount_percent: 0, discount_amount: 0, gst_rate: 0, cgst: 0, sgst: 0, igst: 0, total_amount: basic };
  }).filter((li) => li.quantity_ordered > 0 && li.unit_rate > 0);

  const makePO = async (r: Recipient, subset: RfqItem[]) => {
    if (!r.stakeholder_id) throw new Error(`${r.vendor_name} has no contact record — add them as a vendor first`);
    const li = buildLineItems(r.recipient_id, subset);
    if (li.length === 0) throw new Error(`${r.vendor_name} priced nothing to order`);
    const orderValue = li.reduce((s, x) => s + x.total_amount, 0);
    const poData = { org_id: data!.rfq.org_id, project_id: data!.rfq.project_id, stakeholder_id: r.stakeholder_id, items: [], order_value: orderValue, total_value: orderValue, gst_value: 0, status: 'ORDERED', date_issued: new Date().toISOString().split('T')[0], expected_delivery: '', delivery_location: data!.rfq.delivery_location || '', payment_terms_days: 0, ordered_by: profile?.name || session.user.id, vendor_notes: null, internal_notes: `From quote · ${r.vendor_name ?? ''}`, created_by: session.user.id };
    const { data: res, error } = await supabase.rpc('create_purchase_order', { p_po_data: poData, p_line_items: li });
    if (error) throw error; if (!(res as any)?.success) throw new Error((res as any)?.error || 'Could not create the PO');
    return (res as any).po_id as string;
  };
  const closeRfq = async (awarded: { po_id: string; recipient_id: string; vendor_name: string | null }[]) => {
    await supabase.from('rfqs').update({ status: 'closed', awarded }).eq('rfq_id', rfqId);
    qc.invalidateQueries({ queryKey: ['open_rfqs'] });
    qc.invalidateQueries({ queryKey: ['po_list_sheet'] });
  };

  const order = async (r: Recipient) => {
    setOrderConfirm(null);
    setBusy(r.recipient_id);
    try {
      const po = await makePO(r, items);
      await closeRfq([{ po_id: po, recipient_id: r.recipient_id, vendor_name: r.vendor_name }]);
      // Send the order to the vendor on WhatsApp (they gave us a number for the enquiry).
      const to = normalizeWhatsApp(r.vendor_phone);
      if (to) {
        const res = await sendPoToVendor({ poId: po, to, vendorName: r.vendor_name, totalLabel: fmt(vendorTot(r.recipient_id)), projectName: data?.projectName });
        show(res.ok ? `Order sent to ${r.vendor_name} on WhatsApp` : `PO created — couldn't WhatsApp it: ${res.error}`, res.ok ? undefined : { type: 'error' });
      } else {
        show('Purchase order created — no WhatsApp number on file to send it');
      }
      navigate(`/purchase-orders/${po}`, { state: { from: 'list' } });
    } catch (e: any) { show(e.message || 'Could not create the PO', { type: 'error' }); setBusy(null); }
  };
  async function splitOrder() {
    setBusy('split');
    try {
      const entries = [...mix.winners.entries()];
      const awarded: { po_id: string; recipient_id: string; vendor_name: string | null }[] = [];
      for (const [rid, subset] of entries) { const r = replied.find((x) => x.recipient_id === rid)!; const po = await makePO(r, subset); awarded.push({ po_id: po, recipient_id: rid, vendor_name: r.vendor_name }); }
      await closeRfq(awarded); show(`${awarded.length} purchase orders created`); navigate('/purchase-orders', { state: { from: 'list' } });
    } catch (e: any) { show(e.message || 'Could not split the order', { type: 'error' }); setBusy(null); }
  }
  const askAgain = async (r: Recipient) => {
    setBusy(r.recipient_id);
    try { const { data: res, error } = await supabase.functions.invoke('send-rfq', { body: { rfqId, resendRecipientId: r.recipient_id } }); if (error || !(res as any)?.ok) throw new Error((res as any)?.error || 'Send failed'); show(`Re-sent to ${r.vendor_name}`); }
    catch (e: any) { show(e.message || 'Could not re-send', { type: 'error' }); }
    finally { setBusy(null); }
  };
  const extend = async () => {
    if (!extendDate) return;
    const { error } = await supabase.from('rfqs').update({ quote_by: extendDate }).eq('rfq_id', rfqId);
    if (error) { show('Could not extend', { type: 'error' }); return; }
    setExtendOpen(false); qc.invalidateQueries({ queryKey: ['rfq_compare', rfqId] }); show('Deadline extended');
  };
  const cancelEnquiry = async () => {
    const { error } = await supabase.from('rfqs').update({ status: 'cancelled' }).eq('rfq_id', rfqId);
    if (error) { show('Could not cancel', { type: 'error' }); return; }
    setConfirmCancel(false); show('Enquiry cancelled'); navigate('/purchase-orders');
  };
  const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = '';
    setBusy('photo');
    try {
      const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onerror = () => rej(new Error('read failed')); r.onload = () => { const s = (r.result as string) || ''; res(s.includes(',') ? s.split(',')[1] : ''); }; r.readAsDataURL(file); });
      const { data: ex, error } = await supabase.functions.invoke('reconcile-po-bill', { body: { bill_base64: b64, bill_mime_type: file.type } });
      if (error) throw error;
      const lines = ((ex as any)?.line_items ?? []) as { item?: string; rate?: number }[];
      if (lines.length === 0) throw new Error('No rates could be read from that image');
      const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      let total = 0;
      const p_lines = items.map((it) => {
        const m = lines.find((l) => norm(l.item || '').includes(norm(it.item_name).split(' ')[0]) || norm(it.item_name).includes(norm(l.item || '').split(' ')[0]));
        const rate = m?.rate != null ? Number(m.rate) : null;
        if (rate) total += rate * (Number(it.qty) || 0);
        return { line: it.line, item_name: it.item_name, unit_rate: rate, supplied: rate != null };
      });
      const vendorName = (ex as any)?.vendor_name || 'Photo quote';
      const { data: res, error: e2 } = await supabase.rpc('add_manual_quote', { p_rfq_id: rfqId, p_vendor_name: vendorName, p_stakeholder_id: null, p_lines, p_extras: { quoted_total: total } });
      if (e2 || !(res as any)?.ok) throw new Error((res as any)?.error || 'Could not save the quote');
      qc.invalidateQueries({ queryKey: ['rfq_compare', rfqId] }); show(`${vendorName} added from your photo — check the rates`);
    } catch (err: any) { show(err.message || 'Could not read that quote', { type: 'error' }); }
    finally { setBusy(null); }
  };

  const downloadPdf = () => {
    const doc = new jsPDF('l', 'mm', 'a4');
    doc.setFontSize(14); doc.text(`Compare quotes · ENQ-${String(rfqId).slice(0, 6).toUpperCase()}`, 14, 16);
    doc.setFontSize(9); doc.text(`${data?.projectName || ''}  ·  ${replied.length} of ${recips.length} replied`, 14, 22);
    const head = [['Item', 'Qty', ...replied.map((r) => r.vendor_name || 'Vendor')]];
    const body = items.map((it) => [it.item_name, `${it.qty ?? ''} ${it.unit ?? ''}`.trim(), ...replied.map((r) => { const rt = rateOf(r.recipient_id, it.line); return rt == null ? '—' : fmt(rt); })]);
    body.push(['Total', '', ...replied.map((r) => fmt(totalsById[r.recipient_id]))]);
    autoTable(doc, { startY: 28, head, body, styles: { fontSize: 8 }, headStyles: { fillColor: [251, 248, 242], textColor: 60 } });
    doc.save(`Quotes_ENQ-${String(rfqId).slice(0, 6).toUpperCase()}.pdf`);
  };

  if (isLoading) return <div className="qcx"><style>{CSS}</style><div className="page"><div className="empty">Loading quotes…</div></div></div>;
  if (!data?.rfq) return <div className="qcx"><style>{CSS}</style><div className="page"><div className="empty">Enquiry not found.</div></div></div>;

  const ref = 'ENQ-' + String(rfqId).slice(0, 6).toUpperCase();
  const closed = data.rfq.status && data.rfq.status !== 'open';
  const cancelled = data.rfq.status === 'cancelled';
  const awarded = (data.rfq.awarded ?? []) as { po_id: string; vendor_name: string | null }[];
  const dueDays = data.rfq.quote_by ? Math.round((new Date(data.rfq.quote_by).getTime() - Date.now()) / 86400000) : null;

  return (
    <div className="qcx"><style>{CSS}</style>
      <div className="page" onClick={() => setMenuOpen(false)}>
        <div className="crumb"><a onClick={() => navigate('/purchase-orders')}>Purchase orders</a> › <b>{ref} · rate enquiry</b></div>

        <div className="head">
          <div>
            <h1>Compare quotes <span className="tag mono">{ref}</span></h1>
            <div className="meta">
              {data.projectName && <><span>Site <b>{data.projectName}</b></span><span className="sep" /></>}
              <span>Asked <b>{dstr(data.rfq.created_at)}</b>{data.creator ? ` by ${data.creator}` : ''}</span>
              {data.rfq.quote_by && !closed && <><span className="sep" /><span className="chip gold"><i />{dueDays != null && dueDays <= 0 ? 'Quotes closed' : `Quotes close ${dstr(data.rfq.quote_by)}`}</span></>}
              {closed && <><span className="sep" /><span className="chip gold"><i />{data.rfq.status === 'cancelled' ? 'Cancelled' : 'Ordered · closed'}</span></>}
            </div>
          </div>
          <div className="amount"><small>Best all-in</small><span className="mono">{best.total ? fmt(best.total) : '—'}</span><div className="dir">{bestVendor ? `${bestVendor.vendor_name}${bestVendor.transport_included ? ' · transport included' : ''}` : 'no quotes yet'}</div></div>
          <div className="more" onClick={(e) => e.stopPropagation()}>
            <button className="kebab" onClick={() => setMenuOpen((o) => !o)}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg></button>
            {menuOpen && (
              <div className="menu">
                {!closed && <button onClick={() => { setMenuOpen(false); setExtendOpen(true); }}><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>Extend deadline</button>}
                <button onClick={() => { setMenuOpen(false); downloadPdf(); }}><svg viewBox="0 0 24 24"><path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" /></svg>Download comparison PDF</button>
                {!closed && canConvert && <><hr /><button className="danger" onClick={() => { setMenuOpen(false); setConfirmCancel(true); }}><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>Cancel enquiry</button></>}
              </div>
            )}
          </div>
        </div>

        {closed && (
          <div className={`awarded${cancelled ? ' cancelled' : ''}`}>
            <span className="ic"><span className="material-symbols-outlined" style={{ fontSize: 16 }}>{cancelled ? 'close' : 'check'}</span></span>
            {cancelled
              ? <span>This enquiry was <b>cancelled</b> — the vendors' quote links no longer accept rates.</span>
              : awarded.length
                ? <span>Awarded — {awarded.map((a, i) => (<span key={i}><b>{a.vendor_name}</b> <a onClick={() => navigate(`/purchase-orders/${a.po_id}`)}>{a.po_id}</a>{i < awarded.length - 1 ? ' · ' : ''}</span>))}. The enquiry is closed and read-only.</span>
                : <span>This enquiry is <b>closed</b>.</span>}
          </div>
        )}

        {/* figures */}
        <div className="figs">
          <div className="sage"><small>Best all-in</small><span className="mono">{best.total ? fmt(best.total) : '—'}</span><div className="sub">{bestVendor ? `${bestVendor.vendor_name}, quoted rates` : '—'}</div></div>
          <div className="gold"><small>Cheapest mix</small><span className="mono">{mix.total ? fmt(mix.total) : '—'}</span><div className="sub">best rate per item · {mix.winners.size} vendor{mix.winners.size !== 1 ? 's' : ''}</div></div>
          <div><small>Spread</small><span className="mono">{spread.abs ? `${fmt(spread.abs)} · ${spread.pct}%` : '—'}</span><div className="sub">between the quotes in hand</div></div>
          <div className="terra"><small>Replies</small><span className="mono">{replied.length} of {recips.length}</span><div className="sub">{pending.length ? `${pending.map((p) => p.vendor_name).filter(Boolean).join(', ')} silent` : 'all replied'}</div></div>
        </div>

        {/* insights */}
        {!closed && insights.length > 0 && (
          <>
            <button className="brieftgl" onClick={() => setBriefOpen((o) => !o)}><span className="g">◈</span> {insights.length} thing{insights.length > 1 ? 's' : ''} worth knowing about these quotes <span className="cue">{briefOpen ? 'hide' : 'show'}</span></button>
            {briefOpen && <div className="brief">{insights.map((it, i) => <div key={i}><span className={it.icon === 's' ? 's' : 'g'}>{it.icon === 's' ? '✓' : '◆'}</span><span>{it.body}</span>{it.action ?? <span />}</div>)}</div>}
          </>
        )}

        <div className="sec">
          <h2>Quotes · item by item</h2>
          {!closed && (
            <div>
              <button className="btn" disabled={busy === 'photo'} onClick={() => fileRef.current?.click()}><svg viewBox="0 0 24 24"><path d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" /></svg>{busy === 'photo' ? 'Reading…' : 'Add a quote from photo / PDF'}</button>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={onPhoto} />
            </div>
          )}
        </div>

        <div className="sheet">
          {cols.length === 0 ? <div className="empty">No vendors on this enquiry.</div> : (
            <table>
              <thead><tr>
                <th className="colItem">Item</th>
                {cols.map((r) => {
                  const isBest = r.recipient_id === best.id;
                  const quoted = r.status === 'quoted';
                  return (
                    <th key={r.recipient_id} className="vcol vhead">
                      <b>{r.vendor_name}</b>
                      {quoted
                        ? <span className="st ok">Quoted {dstr(r.quoted_at)} · {r.source === 'photo' ? 'from your upload' : 'on the link'}</span>
                        : <span className="st">No reply · asked {daysAgo(r.sent_at)}d ago</span>}
                      {isBest && <span className="best-tag">Best all-in</span>}
                      {r.source === 'photo' && <span className="src">From photo — check rates</span>}
                      {!quoted && !closed && <div><button className="nudge" disabled={busy === r.recipient_id} onClick={() => askAgain(r)}>↻ {busy === r.recipient_id ? 'Asking…' : 'Ask again'}</button></div>}
                    </th>
                  );
                })}
                {!closed && <th className="addcol" rowSpan={items.length + 2}><button className="addv" onClick={() => setShowAdd(true)}>+ Ask another vendor</button></th>}
              </tr></thead>
              <tbody>
                {items.map((it) => {
                  const low = lowRate(it);
                  return (
                    <tr key={it.line}>
                      <td className="colItem item"><b>{it.item_name}</b><small>{it.qty} {it.unit}{it.spec ? ` · ${it.spec}` : ''}</small></td>
                      {cols.map((r) => {
                        if (r.status !== 'quoted') return <td key={r.recipient_id} className="cell await">awaiting</td>;
                        const x = q(r.recipient_id, it.line);
                        if (!x || !x.supplied || x.unit_rate == null) return <td key={r.recipient_id} className="cell na">—</td>;
                        const rate = Number(x.unit_rate); const isLow = low != null && !x.variant_note && rate === low;
                        return (
                          <td key={r.recipient_id} className={`cell${isLow ? ' low' : ''}`}>
                            <span className="rate">{fmt(rate)} <small>/{it.unit || 'unit'}</small></span>
                            <span className="lt">= {fmt(rate * (Number(it.qty) || 0))}</span>
                            {x.variant_note && <span className="var">{x.variant_note}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr>
                <td className="colItem" style={{ fontWeight: 600 }}>Total<span className="terms">for quoted items</span></td>
                {cols.map((r) => {
                  if (r.status !== 'quoted') return <td key={r.recipient_id}><span className="await">—</span></td>;
                  const isBest = r.recipient_id === best.id;
                  return (
                    <td key={r.recipient_id}>
                      <span className={`tot${isBest ? ' best' : ''}`}>{fmt(totalsById[r.recipient_id])}</span>
                      <span className="terms">{r.transport_included ? 'Transport included' : <span className="warn">Transport extra</span>} · {r.gst_included ? 'GST included' : 'GST extra'}{r.valid_days ? ` · valid ${r.valid_days}d` : ''}{r.vendor_note ? ` · ${r.vendor_note}` : ''}</span>
                      {canConvert && !closed && <div><button className="order" disabled={busy !== null} onClick={() => setOrderConfirm(r)}>{busy === r.recipient_id ? 'Ordering…' : `Order from ${(r.vendor_name || '').split(' ')[0]} →`}</button></div>}
                    </td>
                  );
                })}
              </tr></tfoot>
            </table>
          )}
        </div>

        <div className="sec"><h2>Activity</h2></div>
        <div className="sheet clip"><ul className="log">
          {[...replied].sort((a, b) => new Date(b.quoted_at || 0).getTime() - new Date(a.quoted_at || 0).getTime()).map((r) => (
            <li key={r.recipient_id}><span className="mono">{dstr(r.quoted_at)}</span><i /><span><b>{r.vendor_name}</b> {r.source === 'photo' ? 'quote added from a photo' : 'submitted rates on the quote link'}</span></li>
          ))}
          <li><span className="mono">{dstr(data.rfq.created_at)}</span><i /><span><b>{data.creator || 'Someone'}</b> sent this enquiry to {recips.length} vendor{recips.length !== 1 ? 's' : ''}{data.rfq.quote_by ? ` · quote by ${dstr(data.rfq.quote_by)}` : ''}</span></li>
        </ul></div>
      </div>

      {showAdd && (
        <RequestQuotesModal
          orgId={data.rfq.org_id} rfqId={rfqId} items={[]}
          onClose={() => setShowAdd(false)}
          onSent={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['rfq_compare', rfqId] }); }}
        />
      )}

      {orderConfirm && (
        <div className="scrim" onClick={() => setOrderConfirm(null)}><div className="card" onClick={(e) => e.stopPropagation()}>
          <h3>Send order to {orderConfirm.vendor_name} on WhatsApp?</h3>
          <p>We'll raise the purchase order from {orderConfirm.vendor_name}'s quote (<b>{fmt(vendorTot(orderConfirm.recipient_id))}</b>){orderConfirm.vendor_phone ? <> and message it to <b>{orderConfirm.vendor_phone}</b> with the PO PDF</> : ''}. This closes the enquiry.</p>
          <div className="row"><button className="btn" onClick={() => setOrderConfirm(null)}>Cancel</button><button className="btn" style={{ background: 'var(--sage)', color: '#fff', borderColor: 'var(--sage)' }} onClick={() => order(orderConfirm)}>Yes, send on WhatsApp</button></div>
        </div></div>
      )}

      {extendOpen && (
        <div className="scrim" onClick={() => setExtendOpen(false)}><div className="card" onClick={(e) => e.stopPropagation()}>
          <h3>Extend the deadline</h3>
          <input type="date" value={extendDate} onChange={(e) => setExtendDate(e.target.value)} />
          <div className="row"><button className="btn" onClick={() => setExtendOpen(false)}>Cancel</button><button className="btn" style={{ background: 'var(--terra)', color: '#fff', borderColor: 'var(--terra)' }} onClick={extend}>Save</button></div>
        </div></div>
      )}

      {confirmCancel && (
        <div className="scrim" onClick={() => setConfirmCancel(false)}><div className="card" onClick={(e) => e.stopPropagation()}>
          <h3>Cancel this enquiry?</h3>
          <p>Vendors' quote links stop working and the request leaves your list. This can't be undone.</p>
          <div className="row"><button className="btn" onClick={() => setConfirmCancel(false)}>Keep it</button><button className="btn" style={{ background: 'var(--terra)', color: '#fff', borderColor: 'var(--terra)' }} onClick={cancelEnquiry}>Cancel enquiry</button></div>
        </div></div>
      )}
    </div>
  );
}
