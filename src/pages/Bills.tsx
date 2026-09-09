// Bills — vendor-bill register (list + detail), a port of bills-module-mock.html scoped under .blx.
// Frontend-first over existing data (see billsApi). /bills is the list; /bills/:billId the detail.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { loadBills, loadBillDetail, deleteBill, extractBill, type BillRow, type BillStatus } from '../lib/billsApi';
import { intakeCommit } from '../lib/billIntake';
import { DocThumb } from '../components/DocThumb';
import { ImageLightbox } from '../components/ImageLightbox';
import { openDoc } from '../lib/storage';
import { useOrgId, useAuth } from '../lib/auth/AuthProvider';
import { useUserProfile } from '../App';
import { useSnackbar } from '../components/Snackbar';
import NewBillModal, { type BillDraft } from '../components/bills/NewBillModal';
import { useSearchScope } from '../components/search/searchScope';
import SearchBar from '../components/search/SearchBar';
import PartyFilterChip from '../components/search/PartyFilterChip';

const BLX_CSS = `
.blx{--cream:#F6F2EA;--paper:#FDFBF7;--walnut:#3B3128;--walnut-60:#7A6E61;--walnut-soft:#B4A897;--line:#E4DCCE;--line-strong:#D3C8B4;--terracotta:#B85C38;--sage:#6E7F5E;--sage-tint:#EEF1E8;--terra-tint:#F6E8E0;--amber-tint:#F3ECD9;
  background:var(--cream);color:var(--walnut);font-family:'DM Sans',system-ui,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh}
.blx *{box-sizing:border-box}
.blx .shell{max-width:1180px;margin:0 auto;padding:26px 40px 96px}
.blx .mono{font-family:'DM Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
.blx .pagehead{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:8px;gap:20px;flex-wrap:wrap}
.blx .pagehead h1{font-family:'Playfair Display',Georgia,serif;font-weight:500;font-size:2rem;letter-spacing:-.01em;margin:0}
.blx .pagehead .lede{font-size:.85rem;color:var(--walnut-60);margin-top:6px}
.blx .headwrap{display:flex;align-items:flex-end;gap:28px}
.blx .headfigure{text-align:right}
.blx .headfigure .num{font-family:'DM Mono',monospace;font-size:1.3rem;font-weight:500}
.blx .headfigure .cap{font-size:.78rem;color:var(--walnut-60);margin-top:2px}
.blx .addwrap{display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.blx .btn-add{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-width:158px;background:var(--terracotta);color:#fff;border:none;border-radius:12px;font-family:inherit;font-size:.95rem;font-weight:600;letter-spacing:.004em;padding:13px 22px;cursor:pointer;box-shadow:0 7px 20px -9px rgba(184,92,56,.75);transition:transform .18s cubic-bezier(.2,.85,.3,1),box-shadow .18s,background .18s}
.blx .btn-add:hover{background:#a44f2f;transform:translateY(-2px);box-shadow:0 14px 30px -10px rgba(184,92,56,.8)}
.blx .btn-add:active{transform:translateY(0) scale(.985);box-shadow:0 4px 12px -8px rgba(184,92,56,.7)}
.blx .btn-add:focus-visible{outline:2px solid var(--terracotta);outline-offset:3px}
.blx .btn-add svg{width:18px;height:18px;flex-shrink:0}
.blx .btn-add.busy{background:#a44f2f;cursor:progress}
.blx .btn-add.busy:hover{transform:none;box-shadow:0 7px 20px -9px rgba(184,92,56,.75)}
.blx .btn-add.done{background:var(--sage);box-shadow:0 7px 20px -9px rgba(110,127,94,.75)}
.blx .btn-add.done:hover{background:#5f6f50}
.blx .aspin{width:15px;height:15px;border:2px solid rgba(255,255,255,.38);border-top-color:#fff;border-radius:50%;animation:qspin .7s linear infinite}
.blx .addhint{display:inline-flex;align-items:center;gap:6px;font-size:.76rem;color:var(--walnut-soft);user-select:none;transition:color .15s}
.blx .addwrap:hover .addhint{color:var(--walnut-60)}
.blx .addhint svg{width:13px;height:13px;opacity:.75;animation:hintbob 2.4s ease-in-out infinite}
@keyframes hintbob{0%,100%{transform:translateY(0);opacity:.55}50%{transform:translateY(2px);opacity:.9}}
.blx .adderr{display:inline-flex;align-items:center;gap:6px;font-size:.76rem;color:var(--terracotta)}
.blx .adderr button{background:none;border:none;color:var(--terracotta);text-decoration:underline;text-underline-offset:2px;cursor:pointer;font-size:.76rem;padding:0}
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
.blx .delbill{margin-top:10px;font-size:.78rem;color:var(--walnut-60);background:none;border:1px solid var(--line-strong);border-radius:7px;padding:5px 12px;cursor:pointer;transition:color .15s,border-color .15s,background .15s}
.blx .delbill:hover{color:var(--terracotta);border-color:var(--terracotta);background:var(--terra-tint)}
.blx .delbill:disabled{opacity:.5;cursor:default}
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

// Small inline glyphs for the Add-bill control (no icon dep; stroke follows currentColor).
const IconUpload = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V4" /><path d="m7.5 8.5 4.5-4.5 4.5 4.5" /><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" /></svg>);
const IconCheck = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7" /></svg>);
const IconDrop = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="3" strokeDasharray="3 3" /><path d="M12 9v6M9 12h6" /></svg>);
const IconAlert = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v5" /><circle cx="12" cy="16.5" r=".6" fill="currentColor" /><path d="M10.3 4.3 3.5 16a2 2 0 0 0 1.7 3h13.6a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" /></svg>);

// ── list ───────────────────────────────────────────────────────────────────
export default function Bills() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const orgId = useOrgId();
  const { userId } = useAuth();
  const { data: profile } = useUserProfile(userId ?? '');
  const { show } = useSnackbar();
  const { data: bills = [], isLoading } = useQuery({ queryKey: ['bills'], queryFn: loadBills });
  const [site, setSite] = useState('');
  const [vendor, setVendor] = useState('');
  const [status, setStatus] = useState('');

  // ── drag-drop upload + queue ──
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<QItem[]>([]);
  const [flash, setFlash] = useState(false);   // brief "Added ✓" pulse on the button after a mint
  const dragDepth = useRef(0);
  // The hero opens the door itself. Its stage one IS the drop — plus the way in for a bill that has
  // no paper at all, which an OS file picker can never offer.
  const [manualOpen, setManualOpen] = useState(false);

  const current0 = queue.find(x => x.state === 'ready') ?? null;
  const sheetOpen = !!current0 || manualOpen;

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

  // Page-wide drag-and-drop. Silent while the modal is open: it has its own dropzone, and two
  // listeners reading the same file would read — and bill — it twice.
  useEffect(() => {
    if (sheetOpen) return;
    const onOver = (e: DragEvent) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); } };
    const onEnter = (e: DragEvent) => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth.current++; setDragging(true); } };
    const onLeave = () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false); };
    const onDrop = (e: DragEvent) => { e.preventDefault(); dragDepth.current = 0; setDragging(false); if (e.dataTransfer?.files?.length) enqueue(e.dataTransfer.files); };
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => { window.removeEventListener('dragover', onOver); window.removeEventListener('dragenter', onEnter); window.removeEventListener('dragleave', onLeave); window.removeEventListener('drop', onDrop); };
  }, [enqueue, sheetOpen]);

  // The modal confirms the first item ready for review; the rest stay counted on the button.
  const current = current0;
  const drop = (id: string) => setQueue(q => q.filter(x => x.id !== id));

  // Live progress surfaced ON the button (no bottom-right toast): how many are being read / saved,
  // and how many failed to read.
  const reading = queue.filter(x => x.state === 'reading').length;
  const saving = queue.filter(x => x.state === 'saving').length;
  const errCount = queue.filter(x => x.state === 'error').length;
  const busy = reading + saving > 0;

  // Mint through the shared pipeline (dedupe lives there). The confirm sheet gates on the dup-ack, so
  // we pass allowDuplicate once the user has chosen to add it anyway.
  const mint = async (d: BillDraft) => {
    const res = await intakeCommit(
      // NOTE: useAuth().userId is the ORG MEMBERSHIP id, not an auth.users id — writing it to
      // bills.created_by (FK → auth.users) violates the constraint. Provenance rides on created_by_name;
      // leave created_by null rather than send a non-auth id.
      { orgId, source: 'bills_page', file: d.file, vendorId: d.vendorId, projectId: d.projectId, createdBy: null, createdByName: (profile as { full_name?: string; name?: string } | undefined)?.full_name ?? (profile as { full_name?: string; name?: string } | undefined)?.name ?? null },
      { vendor: d.vendorName, billNo: d.billNo, billDate: d.billDate, amount: d.amount, lines: d.lines },
      d.vendorId, { allowDuplicate: d.allowDuplicate },
    );
    // The modal offers the reconcile ("open it") and the override; hand it the collision and let it ask.
    if (res.status === 'duplicate') return { duplicate: res.existing };
    setFlash(true); setTimeout(() => setFlash(false), 1800);
    show('Bill added');
    qc.invalidateQueries({ queryKey: ['bills'] });
    qc.invalidateQueries({ queryKey: ['party_ledger'] });
    qc.invalidateQueries({ queryKey: ['weekly_payments'] });
    qc.invalidateQueries({ queryKey: ['party_topay_map'] });
  };

  const sites = useMemo(() => [...new Set(bills.map(b => b.site).filter(Boolean))] as string[], [bills]);
  const vendors = useMemo(() => [...new Set(bills.map(b => b.vendor).filter(Boolean))], [bills]);
  const [q, setQ] = useState('');
  // ?party=<id> — arriving from the search's "Bills" row for one vendor.
  const [searchParams] = useSearchParams();
  const partyId = searchParams.get('party');
  const shown = useMemo(() => bills.filter(b =>
    (!partyId || b.vendorId === partyId) &&
    (!site || b.site === site) && (!vendor || b.vendor === vendor) && (!status || b.status === status) &&
    (!q || `${b.vendor} ${b.billNo ?? ''} ${b.site ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [bills, site, vendor, status, q, partyId]);
  useSearchScope('Bills', useMemo(() => shown.map(b => ({
    id: b.id, title: b.vendor, sub: `${b.billNo || 'No number'}${b.site ? ' · ' + b.site : ''}`, right: inr(b.amount),
    onPick: () => navigate(`/bills/${encodeURIComponent(b.id)}`),
  })), [shown, navigate]), setQ);

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
            <div className="addwrap">
              <button
                className={`btn-add${busy ? ' busy' : flash ? ' done' : ''}`}
                onClick={() => setManualOpen(true)}
                aria-busy={busy}
                title="Add a bill — drop the paper and we'll read it, or type it in. You can also drop files anywhere on this page."
              >
                {busy ? <span className="aspin" /> : flash ? <IconCheck /> : <IconUpload />}
                <span>{saving > 0 ? (saving > 1 ? `Saving ${saving} bills…` : 'Saving…') : reading > 0 ? `Reading ${reading} bill${reading > 1 ? 's' : ''}…` : flash ? 'Added' : 'Add bill'}</span>
              </button>
              {errCount > 0 ? (
                <span className="adderr"><IconAlert />{errCount} couldn{'’'}t be read — <button onClick={() => setQueue(q => q.filter(x => x.state !== 'error'))}>dismiss</button></span>
              ) : (
                <span className="addhint"><IconDrop />or drag &amp; drop bills anywhere</span>
              )}
            </div>
          </div>
        </header>

        <div className="filters">
          <select value={site} onChange={e => setSite(e.target.value)}><option value="">All sites</option>{sites.map(s => <option key={s} value={s}>{s}</option>)}</select>
          <select value={vendor} onChange={e => setVendor(e.target.value)}><option value="">All vendors</option>{vendors.map(v => <option key={v} value={v}>{v}</option>)}</select>
          <select value={status} onChange={e => setStatus(e.target.value)}><option value="">Any status</option><option value="unpaid">Unpaid</option><option value="part">Part-paid</option><option value="settled">Settled</option></select>
          <SearchBar label="bills" />
          <PartyFilterChip what="Bills" />
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
                <tr key={b.id} data-search-row={b.id} className="clk" onClick={() => navigate(`/bills/${encodeURIComponent(b.id)}`)}>
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

      {current && (
        <NewBillModal
          key={current.id}
          open
          onClose={() => drop(current.id)}
          queueMore={queue.filter(q => q.state === 'ready').length - 1}
          initialExtract={{ vendor: current.vendorName, billNo: current.billNo, billDate: current.billDate, amount: current.amount, lines: current.lines }}
          onOpenBill={(id) => { drop(current.id); navigate(`/bills/${encodeURIComponent('bl~' + id)}`); }}
          commit={(d) => mint({ ...d, file: current.file })}
        />
      )}

      {manualOpen && !current && (
        <NewBillModal
          open
          onClose={() => setManualOpen(false)}
          onOpenBill={(id) => { setManualOpen(false); navigate(`/bills/${encodeURIComponent('bl~' + id)}`); }}
          commit={mint}
        />
      )}
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
  const qc = useQueryClient();
  const { show } = useSnackbar();
  const { data: b, isLoading } = useQuery({ queryKey: ['bill', id], queryFn: () => loadBillDetail(id) });
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Back goes where you came FROM. Opening a bill from a PO and being returned to the bills register
  // loses the thread you were pulling — you were reading that order, not the register.
  const { state } = useLocation();
  const from = (state ?? null) as { backTo?: string; backLabel?: string } | null;
  const backTo = from?.backTo ?? '/bills';
  const backLabel = from?.backLabel ?? 'Bills';
  const goBack = () => navigate(backTo);

  if (isLoading) return <div className="blx"><style>{BLX_CSS}</style><div className="shell"><div className="empty">Loading…</div></div></div>;
  if (!b) return <div className="blx"><style>{BLX_CSS}</style><div className="shell"><button className="backline" onClick={goBack}>← {backLabel}</button><div className="empty">Bill not found.</div></div></div>;

  const remaining = Math.max(0, b.amount - b.paid);
  const pct = b.amount > 0 ? Math.min(100, Math.round((b.paid / b.amount) * 100)) : 0;
  const preview = (url: string) => { if (/\.pdf(\?|$)/i.test(url)) void openDoc(url); else setLightbox(url); };

  const onDelete = async () => {
    const msg = b.paid > 0.5
      ? `Delete this bill? ${inr(b.paid)} was paid against it — that payment reverts to an unallocated advance. This can't be undone.`
      : `Delete this bill? This can't be undone.`;
    if (!window.confirm(msg)) return;
    setDeleting(true);
    try {
      await deleteBill(id);
      show('Bill deleted');
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['party_ledger'] });
      qc.invalidateQueries({ queryKey: ['weekly_payments'] });
      qc.invalidateQueries({ queryKey: ['po_detail'] });
      qc.invalidateQueries({ queryKey: ['po_list_sheet'] });
      goBack();
    } catch (e) { show((e as Error)?.message || 'Could not delete the bill', { type: 'error' }); setDeleting(false); }
  };

  return (
    <div className="blx">
      <style>{BLX_CSS}</style>
      <div className="shell">
        <button className="backline" onClick={goBack}>← {backLabel}</button>

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
            <button className="delbill" disabled={deleting} onClick={onDelete}>{deleting ? 'Deleting…' : 'Delete bill'}</button>
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
