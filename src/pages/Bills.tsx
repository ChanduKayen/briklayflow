// Bills — vendor-bill register (list + detail), a port of bills-module-mock.html scoped under .blx.
// Frontend-first over existing data (see billsApi). /bills is the list; /bills/:billId the detail.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { loadBills, loadBillDetail, extractBill, findDuplicateBill, type BillRow, type BillStatus, type DuplicateBill } from '../lib/billsApi';
import { intakeCommit } from '../lib/billIntake';
import { DocThumb } from '../components/DocThumb';
import { ImageLightbox } from '../components/ImageLightbox';
import { openDoc } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { useOrgId, useAuth } from '../lib/auth/AuthProvider';
import { useUserProfile } from '../App';
import { useSnackbar } from '../components/Snackbar';
import { searchPayees } from '../lib/payeeSearch';

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
/* drag-drop overlay */
.blx .dropveil{position:fixed;inset:0;z-index:80;background:rgba(59,49,40,.45);display:grid;place-items:center;pointer-events:none}
.blx .dropveil .card{background:var(--paper);border:2px dashed var(--terracotta);border-radius:16px;padding:38px 54px;text-align:center;box-shadow:0 24px 60px -20px rgba(43,29,19,.5)}
.blx .dropveil .big{font-family:'Playfair Display',Georgia,serif;font-size:1.4rem;color:var(--walnut)}
.blx .dropveil .sub{font-size:.85rem;color:var(--walnut-60);margin-top:6px}
/* upload queue */
.blx .queue{position:fixed;right:20px;bottom:20px;z-index:70;width:min(340px,calc(100vw - 32px));display:flex;flex-direction:column;gap:10px}
.blx .qcard{background:var(--paper);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 30px -14px rgba(43,29,19,.4);padding:12px 14px;font-size:.83rem;animation:qin .2s ease}
@keyframes qin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.blx .qcard .qtop{display:flex;align-items:center;gap:8px}
.blx .qcard .qname{font-weight:500;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.blx .qcard .qx{background:none;border:none;color:var(--walnut-soft);cursor:pointer;font-size:1rem;line-height:1}
.blx .qcard .qstate{color:var(--walnut-60);margin-top:4px;font-size:.78rem}
.blx .qcard .qstate.err{color:var(--terracotta)}
.blx .qspin{width:13px;height:13px;border:2px solid var(--terra-tint);border-top-color:var(--terracotta);border-radius:50%;animation:qspin .7s linear infinite;flex-shrink:0}
@keyframes qspin{to{transform:rotate(360deg)}}
/* confirm sheet */
.blx .scrim{position:fixed;inset:0;z-index:90;background:rgba(59,49,40,.42);display:grid;place-items:center;padding:16px}
.blx .sheet-m{width:min(560px,100%);max-height:92vh;display:flex;flex-direction:column;overflow:hidden;background:var(--paper);border:1px solid var(--line);border-radius:14px;box-shadow:0 24px 60px -20px rgba(43,29,19,.5)}
.blx .sheet-m .sh{padding:16px 20px;border-bottom:1px solid var(--line);display:flex;align-items:baseline;justify-content:space-between}
.blx .sheet-m .sh h3{font-family:'Playfair Display',Georgia,serif;font-weight:500;font-size:1.25rem;margin:0}
.blx .sheet-m .sh .qn{font-size:.78rem;color:var(--walnut-60)}
.blx .sheet-m .sb{padding:18px 20px;overflow-y:auto;display:flex;flex-direction:column;gap:16px}
.blx .fld label{display:block;font-size:.78rem;font-weight:500;color:var(--walnut-60);margin-bottom:6px}
.blx .fld input,.blx .fld select{width:100%;height:42px;border:1px solid var(--line-strong);border-radius:8px;background:var(--paper);padding:0 12px;font-family:inherit;font-size:.9rem;color:var(--walnut);outline:none}
.blx .fld input:focus,.blx .fld select:focus{border-color:var(--terracotta)}
.blx .fld input.mono{font-family:'DM Mono',monospace}
.blx .row2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.blx .vsearch{position:relative}
.blx .vmenu{position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:5;background:var(--paper);border:1px solid var(--line);border-radius:8px;overflow:hidden;box-shadow:0 12px 30px -14px rgba(43,29,19,.4);max-height:220px;overflow-y:auto}
.blx .vmenu button{display:block;width:100%;text-align:left;padding:9px 12px;background:none;border:none;font-size:.86rem;color:var(--walnut);cursor:pointer}
.blx .vmenu button:hover{background:var(--cream)}
.blx .dupwarn{display:flex;gap:10px;align-items:flex-start;background:var(--terra-tint);border:1px solid #E0BBA8;border-radius:10px;padding:11px 13px;font-size:.82rem;color:#7E3A20}
.blx .dupwarn b{font-weight:600}
.blx .sheet-m .sf{padding:14px 20px;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:12px}
.blx .sheet-m .sf .amt-tot{font-family:'DM Mono',monospace;font-size:1.05rem;font-weight:500}
.blx .sheet-m .sf .acts{display:flex;gap:10px}
.blx .btn-ghost{background:none;border:1px solid var(--line-strong);border-radius:8px;padding:9px 16px;font-size:.85rem;color:var(--walnut-60);cursor:pointer}
.blx .btn-prim{background:var(--terracotta);border:none;border-radius:8px;padding:9px 18px;font-size:.85rem;font-weight:600;color:#fff;cursor:pointer}
.blx .btn-prim:disabled{opacity:.5;cursor:default}
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

type QState = 'reading' | 'ready' | 'saving' | 'done' | 'error';
interface QItem {
  id: string; file: File; state: QState; error?: string;
  vendorName: string | null; billNo: string | null; billDate: string | null; amount: number;
  lines: { name: string; spec: string | null; unit: string | null; qty: number; rate: number; amount: number }[];
}
let qseq = 0;

// The /bills/:billId route — a SEPARATE component from the list so React never reuses one instance
// across the two routes (which changed the hook count and crashed with "fewer hooks than expected").
export function BillDetailPage() {
  const { billId } = useParams();
  return <BillDetailView id={decodeURIComponent(billId ?? '')} />;
}

// ── list ───────────────────────────────────────────────────────────────────
export default function Bills() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const orgId = useOrgId();
  const { userId } = useAuth();
  const { data: profile } = useUserProfile(userId ?? '');
  const { show } = useSnackbar();
  const { data: bills = [], isLoading } = useQuery({ queryKey: ['bills'], queryFn: loadBills });
  const { data: vendorList = [] } = useQuery({
    queryKey: ['bill_vendors'],
    queryFn: async () => (await supabase.from('stakeholders').select('stakeholder_id, name').eq('type', 'Vendor').order('name')).data ?? [],
  });
  const { data: projectList = [] } = useQuery({
    queryKey: ['projects_active_min'],
    queryFn: async () => (await supabase.from('projects').select('project_id, name').eq('status', 'Active').order('name')).data ?? [],
  });
  const [site, setSite] = useState('');
  const [vendor, setVendor] = useState('');
  const [status, setStatus] = useState('');

  // ── drag-drop upload + queue ──
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<QItem[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const enqueue = useCallback((files: FileList | File[]) => {
    const list = Array.from(files).filter(f => /^image\/|application\/pdf/.test(f.type));
    if (!list.length) return;
    const items: QItem[] = list.map(f => ({ id: `q${++qseq}`, file: f, state: 'reading', vendorName: null, billNo: null, billDate: null, amount: 0, lines: [] }));
    setQueue(q => [...q, ...items]);
    // Read each in the background; the confirm sheet picks up 'ready' items one at a time.
    items.forEach(async (it) => {
      try {
        const ex = await extractBill(it.file);
        setQueue(q => q.map(x => x.id === it.id ? { ...x, state: 'ready', vendorName: ex.vendor, billNo: ex.billNo, billDate: ex.billDate, amount: ex.amount, lines: ex.lines } : x));
      } catch (e) {
        setQueue(q => q.map(x => x.id === it.id ? { ...x, state: 'error', error: (e as Error)?.message || 'Could not read the bill' } : x));
      }
    });
  }, []);

  // Page-wide drag-and-drop.
  useEffect(() => {
    const onOver = (e: DragEvent) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); } };
    const onEnter = (e: DragEvent) => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth.current++; setDragging(true); } };
    const onLeave = () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false); };
    const onDrop = (e: DragEvent) => { e.preventDefault(); dragDepth.current = 0; setDragging(false); if (e.dataTransfer?.files?.length) enqueue(e.dataTransfer.files); };
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => { window.removeEventListener('dragover', onOver); window.removeEventListener('dragenter', onEnter); window.removeEventListener('dragleave', onLeave); window.removeEventListener('drop', onDrop); };
  }, [enqueue]);

  // The confirm sheet shows the first item ready for review.
  const current = queue.find(x => x.state === 'ready') ?? null;
  const patch = (id: string, p: Partial<QItem>) => setQueue(q => q.map(x => x.id === id ? { ...x, ...p } : x));
  const drop = (id: string) => setQueue(q => q.filter(x => x.id !== id));

  // Mint through the shared pipeline (dedupe lives there). The confirm sheet gates on the dup-ack, so
  // we pass allowDuplicate once the user has chosen to add it anyway.
  const mint = async (it: QItem, vendorId: string, projectId: string | null, allowDuplicate: boolean) => {
    patch(it.id, { state: 'saving' });
    try {
      const res = await intakeCommit(
        // NOTE: useAuth().userId is the ORG MEMBERSHIP id, not an auth.users id — writing it to
        // bills.created_by (FK → auth.users) violates the constraint. Provenance rides on created_by_name;
        // leave created_by null rather than send a non-auth id.
        { orgId, source: 'bills_page', file: it.file, vendorId, projectId, createdBy: null, createdByName: (profile as any)?.full_name ?? (profile as any)?.name ?? null },
        { vendor: it.vendorName, billNo: it.billNo, billDate: it.billDate, amount: it.amount, lines: it.lines },
        vendorId, { allowDuplicate },
      );
      if (res.status === 'duplicate') { patch(it.id, { state: 'ready' }); return; } // sheet shows the reconcile offer
      drop(it.id);
      show('Bill added');
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['party_ledger'] });
      qc.invalidateQueries({ queryKey: ['weekly_payments'] });
    } catch (e) {
      patch(it.id, { state: 'error', error: (e as Error)?.message || 'Could not save the bill' });
    }
  };

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
            <button className="btn-add" onClick={() => fileRef.current?.click()}>Add bill</button>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { if (e.target.files?.length) enqueue(e.target.files); e.target.value = ''; }} />
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

      {dragging && (
        <div className="dropveil"><div className="card"><div className="big">Drop the bill{'’'}s here</div><div className="sub">We{'’'}ll read each one — image or PDF — then ask the vendor & site.</div></div></div>
      )}

      {queue.length > 0 && (
        <div className="queue">
          {queue.filter(q => q.id !== current?.id).map(q => (
            <div className="qcard" key={q.id}>
              <div className="qtop">
                {(q.state === 'reading' || q.state === 'saving') && <span className="qspin" />}
                <span className="qname">{q.file.name}</span>
                {(q.state === 'error' || q.state === 'ready') && <button className="qx" onClick={() => drop(q.id)} aria-label="Remove">×</button>}
              </div>
              <div className={`qstate${q.state === 'error' ? ' err' : ''}`}>
                {q.state === 'reading' ? 'Reading the bill…' : q.state === 'saving' ? 'Saving…' : q.state === 'ready' ? 'Ready — waiting to confirm' : q.state === 'error' ? (q.error || 'Failed') : 'Done'}
              </div>
            </div>
          ))}
        </div>
      )}

      {current && (
        <ConfirmBillSheet
          key={current.id}
          item={current}
          vendors={vendorList as { stakeholder_id: string; name: string }[]}
          projects={projectList as { project_id: string; name: string }[]}
          queueCount={queue.filter(q => q.state === 'ready').length}
          onPatch={(p) => patch(current.id, p)}
          onCancel={() => drop(current.id)}
          onOpenBill={(id) => { drop(current.id); navigate(`/bills/${encodeURIComponent('bl~' + id)}`); }}
          onConfirm={(vendorId, projectId, allowDuplicate) => mint(current, vendorId, projectId, allowDuplicate)}
        />
      )}
    </div>
  );
}

// Confirm sheet — after a bill is read, name the vendor & site, check the figures, warn on a duplicate,
// then mint. One sheet at a time; the queue feeds the next 'ready' item in behind it.
function ConfirmBillSheet({ item, vendors, projects, queueCount, onPatch, onCancel, onOpenBill, onConfirm }: {
  item: QItem; vendors: { stakeholder_id: string; name: string }[]; projects: { project_id: string; name: string }[];
  queueCount: number; onPatch: (p: Partial<QItem>) => void; onCancel: () => void; onOpenBill: (id: string) => void; onConfirm: (vendorId: string, projectId: string | null, allowDuplicate: boolean) => void;
}) {
  const [vendorId, setVendorId] = useState<string>('');
  const [vq, setVq] = useState(item.vendorName || '');
  const [vOpen, setVOpen] = useState(false);
  const [projectId, setProjectId] = useState<string>('');
  const [dup, setDup] = useState<DuplicateBill | null>(null);
  const [dupAck, setDupAck] = useState(false);

  // Pre-match the read vendor name to a real party.
  useEffect(() => {
    if (vendorId || !item.vendorName) return;
    const hit = searchPayees(vendors as any, item.vendorName)[0] as any;
    if (hit) { setVendorId(hit.stakeholder_id); setVq(hit.name); }
  }, [item.vendorName, vendors, vendorId]);

  // Same vendor + same bill number → warn before minting.
  useEffect(() => {
    setDup(null); setDupAck(false);
    if (!vendorId || !item.billNo) return;
    let live = true;
    findDuplicateBill(vendorId, item.billNo).then(d => { if (live) setDup(d); });
    return () => { live = false; };
  }, [vendorId, item.billNo]);

  const matches = vq.trim() ? searchPayees(vendors as any, vq).slice(0, 6) : vendors.slice(0, 6);
  const canSave = !!vendorId && item.amount > 0 && (!dup || dupAck);

  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="sheet-m" onClick={(e) => e.stopPropagation()}>
        <div className="sh">
          <h3>New bill</h3>
          {queueCount > 1 && <span className="qn">{queueCount - 1} more in queue</span>}
        </div>
        <div className="sb">
          <div className="fld vsearch">
            <label>Vendor</label>
            <input value={vq} placeholder="Search a vendor…" onChange={(e) => { setVq(e.target.value); setVendorId(''); setVOpen(true); }} onFocus={() => setVOpen(true)} />
            {vOpen && matches.length > 0 && !vendorId && (
              <div className="vmenu">
                {matches.map((m: any) => (
                  <button key={m.stakeholder_id} onClick={() => { setVendorId(m.stakeholder_id); setVq(m.name); setVOpen(false); }}>{m.name}</button>
                ))}
              </div>
            )}
          </div>
          <div className="fld">
            <label>Site</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">No site / unassigned</option>
              {projects.map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
            </select>
          </div>
          <div className="row2">
            <div className="fld"><label>Bill / invoice no</label><input className="mono" value={item.billNo ?? ''} placeholder="—" onChange={(e) => onPatch({ billNo: e.target.value || null })} /></div>
            <div className="fld"><label>Bill date</label><input type="date" value={item.billDate ?? ''} onChange={(e) => onPatch({ billDate: e.target.value || null })} /></div>
          </div>
          <div className="fld"><label>Amount</label><input className="mono" inputMode="numeric" value={item.amount ? String(item.amount) : ''} placeholder="0" onChange={(e) => onPatch({ amount: parseInt(e.target.value.replace(/[^\d]/g, ''), 10) || 0 })} /></div>
          {dup && (
            <div className="dupwarn" style={{ flexDirection: 'column', gap: 8, alignItems: 'stretch' }}>
              <span><b>This bill already exists.</b> {dup.billNo ? <>No. <b>{dup.billNo}</b> </> : null}for this vendor is already on file{dup.amount ? <> ({inr(dup.amount)}{dup.billDate ? `, ${fmtDate(dup.billDate)}` : ''})</> : ''}.</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" className="btn-prim" style={{ padding: '6px 12px' }} onClick={() => onOpenBill(dup.id)}>Open the existing bill →</button>
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '.8rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={dupAck} onChange={(e) => setDupAck(e.target.checked)} />
                  It&apos;s a different bill — add anyway
                </label>
              </div>
            </div>
          )}
        </div>
        <div className="sf">
          <span className="amt-tot">{inr(item.amount)}</span>
          <div className="acts">
            <button className="btn-ghost" onClick={onCancel}>Discard</button>
            <button className="btn-prim" disabled={!canSave || (item.state === 'saving')} onClick={() => onConfirm(vendorId, projectId || null, !!dup && dupAck)}>{item.state === 'saving' ? 'Saving…' : 'Add bill'}</button>
          </div>
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
