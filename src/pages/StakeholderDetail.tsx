// Party ledger — the redesigned party account page (replaces the old StakeholderDetail).
// Paid / Certified / "ahead" running balance, in By-date / By-contract / By-site views, with
// period + search filters. Certified is inferred from the attendance stage readings. Opening
// balance and Adjustments are recorded here; Payment reuses QuickTransactionSheet.
import { useMemo, useState, useEffect, type ReactElement } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { useOrgId, useAuth } from '../lib/auth/AuthProvider';
import { LedgerCutoverControl } from '../components/attendance/LedgerCutoverControl';
import { useSnackbar } from '../components/Snackbar';
import { QuickTransactionSheet } from '../components/QuickTransactionSheet';
import { loadPartyLedger, saveOpeningBalance, addAdjustment, bookConsolidatedBill, type LedgerEntry, type PartyLedger } from '../lib/partyLedgerApi';
import { readParty, isNewLedgerOrg } from '../lib/ledgerRead';
import { PieceWorkEntry } from '../components/attendance/PieceWorkEntry';
import { loadPartyCertifications } from '../lib/workCertification';
import { createCredit, fillCredit, allocateToCredit, allocateToPool, openCreditsFor, certifyStage, type OpenCredit } from '../lib/ledgerWrite';

const inr = (n: number) => n.toLocaleString('en-IN');
const initials = (name: string) => name.split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const monthKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const monthLabel = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

type View = 'date' | 'contract' | 'site';
type Period = 'all' | 'month' | '3m' | 'fy' | 'custom';

// Vendors and workers read differently: a worker's credit side is CERTIFIED work against
// contracts; a vendor's is BILLED amounts against POs, and the balance is what you owe.
interface Terms { credit: string; creditWord: string; contractCol: string; contract: string; byContract: string; aheadCol: string; aheadPos: string; aheadNeg: string; noContract: string }
const terms = (kind: 'worker' | 'vendor'): Terms => kind === 'vendor'
  ? { credit: 'Billed', creditWord: 'billed', contractCol: 'PO', contract: 'PO', byContract: 'By PO', aheadCol: 'Balance', aheadPos: 'paid in advance of billing', aheadNeg: 'still to pay', noContract: 'Billed against POs' }
  : { credit: 'Certified', creditWord: 'certified', contractCol: 'Contract', contract: 'contract', byContract: 'By contract', aheadCol: 'Ahead', aheadPos: 'paid ahead of certified work', aheadNeg: 'certified work not yet paid', noContract: 'No contract, weekly payments' };

const CSS = `
.plx{--cream:#F5F0E7;--paper:#FFFCF7;--line:#E5DCCD;--line-soft:#EFE8DB;--walnut:#33251B;--walnut-2:#6A5A4C;--walnut-3:#9A8B7B;--terra:#B4532F;--terra-soft:#F6E7DF;--sage:#5F7F5C;--sage-soft:#E7EEE3;
  --serif:"Playfair Display",Georgia,serif;--sans:"DM Sans",system-ui,sans-serif;--mono:"DM Mono",ui-monospace,monospace;
  background:#FBF9F6;color:var(--walnut);font-family:var(--sans);font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased;min-height:100vh}
.plx *{box-sizing:border-box}
.plx button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
.plx .num{font-family:var(--mono);font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.plx .page{max-width:1440px;margin:0 auto;padding:28px 40px 80px}
.plx .back{display:inline-flex;align-items:center;gap:6px;color:var(--walnut-3);font-size:13px;margin-bottom:18px}
.plx .back:hover{color:var(--walnut)}.plx .back svg{width:14px;height:14px}
.plx .who{display:flex;align-items:flex-start;justify-content:space-between;gap:24px}
.plx .who-left{display:flex;align-items:center;gap:16px}
.plx .avatar{width:52px;height:52px;border-radius:50%;background:var(--paper);border:1px solid var(--line);display:grid;place-items:center;font-family:var(--serif);font-size:18px;color:var(--terra)}
.plx .name{font-family:var(--serif);font-size:30px;line-height:1.1;font-weight:500;margin:0}
.plx .meta{color:var(--walnut-2);margin-top:4px;font-size:13.5px}
.plx .meta .uid{font-family:var(--mono);font-size:12.5px;color:var(--walnut-3);margin-left:10px}
.plx .actions{display:flex;gap:8px;align-items:center;padding-top:6px}
.plx .btn{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 14px;border-radius:8px;border:1px solid var(--line);background:var(--paper);font-weight:500;font-size:13.5px;color:var(--walnut-2)}
.plx .btn:hover{border-color:var(--walnut-3);color:var(--walnut)}
.plx .btn.primary{background:var(--walnut);border-color:var(--walnut);color:var(--paper)}.plx .btn.primary:hover{background:#221810}
.plx .btn svg{width:15px;height:15px}
.plx .menu-wrap{position:relative}
.plx .menu{display:none;position:absolute;right:0;top:42px;min-width:190px;background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:6px;box-shadow:0 14px 30px -14px rgba(51,37,27,.35);z-index:5}
.plx .menu-wrap.open .menu{display:block}
.plx .menu button{display:block;width:100%;text-align:left;padding:8px 10px;border-radius:6px;font-size:13.5px}
.plx .menu button:hover{background:var(--cream)}
.plx .menu .ob{border-top:1px solid var(--line-soft);margin-top:4px;padding-top:10px;color:var(--walnut-2)}
.plx .hero{display:grid;grid-template-columns:1.1fr 1fr;gap:32px;margin-top:30px;padding:28px 0 26px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.plx .lead{font-family:var(--serif);font-size:19px;line-height:1.35;font-weight:400;margin:0;color:var(--walnut-2)}
.plx .lead .big{display:block;font-size:54px;line-height:1;color:var(--terra);letter-spacing:-.015em;margin-bottom:10px;font-variant-numeric:tabular-nums}
.plx .facts{margin:18px 0 0;padding:0;list-style:none;display:grid;grid-template-columns:repeat(3,auto);gap:0 28px;justify-content:start}
.plx .facts li{display:flex;flex-direction:column;gap:2px}
.plx .facts .v{font-size:17px;font-weight:500}.plx .facts .l{font-size:12.5px;color:var(--walnut-3)}
.plx .flag{margin-top:18px;display:inline-flex;gap:10px;align-items:center;padding:8px 12px 8px 10px;border-radius:8px;background:var(--terra-soft);color:#7E3A20;font-size:13px}
.plx .flag svg{width:14px;height:14px}
.plx .flag button{text-decoration:underline;text-underline-offset:3px;font-weight:500;color:inherit}
.plx .bysite h3{font-family:var(--sans);font-size:12.5px;font-weight:500;color:var(--walnut-3);margin:4px 0 8px}
.plx .sites{width:100%;border-collapse:collapse}
.plx .sites td,.plx .sites th{padding:9px 0;border-bottom:1px solid var(--line-soft);text-align:right;font-weight:400}
.plx .sites th{font-size:12px;color:var(--walnut-3);padding-top:0}
.plx .sites td:first-child,.plx .sites th:first-child{text-align:left}
.plx .sites tr:last-child td{border-bottom:0}
.plx .sites .site{font-weight:500}.plx .sites .sub{color:var(--walnut-3);font-size:12px}
.plx .sites .ahead{color:var(--terra)}.plx .sites .none{color:var(--walnut-3)}
.plx .ledger-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:30px 0 14px;flex-wrap:wrap}
.plx .ledger-head h2{font-family:var(--serif);font-size:20px;font-weight:500;margin:0}
.plx .controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.plx .seg{display:inline-flex;background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:3px}
.plx .seg button{height:28px;padding:0 12px;border-radius:6px;font-size:13px;color:var(--walnut-2)}
.plx .seg button.on{background:var(--walnut);color:var(--paper)}
.plx .seg.quiet button.on{background:var(--cream);color:var(--walnut);box-shadow:inset 0 0 0 1px var(--line)}
.plx .search{display:flex;align-items:center;gap:8px;height:34px;padding:0 12px;border:1px solid var(--line);border-radius:8px;background:var(--paper);color:var(--walnut-3);font-size:13px;min-width:190px}
.plx .search svg{width:14px;height:14px;flex:none}
.plx .search input{border:0;background:none;outline:none;font:inherit;color:var(--walnut);width:100%}
.plx .custom{display:inline-flex;gap:6px;align-items:center}
.plx .custom input{height:34px;border:1px solid var(--line);border-radius:8px;background:var(--paper);padding:0 8px;font:inherit;font-size:12.5px;color:var(--walnut)}
.plx .sheet{background:var(--paper);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.plx table.ledger{width:100%;border-collapse:collapse}
.plx .ledger th{font-size:12px;font-weight:500;color:var(--walnut-3);text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);background:var(--paper)}
.plx .ledger th.r,.plx .ledger td.r{text-align:right}
.plx .ledger td{padding:9px 14px;border-bottom:1px solid var(--line-soft);vertical-align:middle;height:50px}
.plx .ledger tr.row:hover td{background:#FBF7EF}
.plx .ledger tr:last-child td{border-bottom:0}
.plx .ledger .date{width:82px;color:var(--walnut-2);font-size:12.5px;white-space:nowrap}
.plx .ledger .part .p{font-weight:500}
.plx .ledger .part .s{font-size:12.5px;color:var(--walnut-3);margin-top:1px}
.plx .ledger .part .s .narr{font-family:var(--mono);font-size:11.5px}
.plx .ledger .clip{display:inline-block;vertical-align:-2px;margin-left:6px;color:var(--walnut-3)}.plx .ledger .clip svg{width:12px;height:12px}
.plx .ledger .contract{width:130px;font-family:var(--mono);font-size:12.5px;color:var(--walnut-2)}
.plx .ledger .contract .link{font-family:var(--sans);font-size:12.5px;color:var(--terra);text-decoration:underline;text-underline-offset:3px}
.plx .ledger .contract .dash{color:var(--line)}
.plx .ledger .paid,.plx .ledger .cert,.plx .ledger .bal{width:120px;font-size:13.5px}
.plx .ledger .cert{color:var(--sage)}.plx .ledger .bal{color:var(--walnut-2)}
.plx .ledger .bal.now{color:var(--walnut);font-weight:500}
.plx .ledger tr.month td{height:40px;padding:8px 14px;background:var(--cream);border-bottom:1px solid var(--line);border-top:1px solid var(--line);font-size:12.5px}
.plx .ledger tr.month .m{font-weight:500;color:var(--walnut)}
.plx .ledger tr.month .t{text-align:right;color:var(--walnut-2)}.plx .ledger tr.month .t .cert{color:var(--sage)}
.plx .ledger tr.opening td{border-top:1px solid var(--line)}
.plx .ledger tr.opening .edit{margin-left:10px;color:var(--terra);font-size:12.5px;text-decoration:underline;text-underline-offset:3px}
.plx .group{background:var(--paper);border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:16px}
.plx .group-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding:16px 18px 14px;border-bottom:1px solid var(--line)}
.plx .group-head .title{font-weight:500;font-size:15px}
.plx .group-head .title .id{font-family:var(--mono);font-size:12.5px;color:var(--walnut-3);margin-left:8px;font-weight:400}
.plx .group-head .desc{color:var(--walnut-2);font-size:13px;margin-top:2px}
.plx .gstats{display:flex;gap:26px;text-align:right}
.plx .gstats .v{font-size:15px;font-weight:500}.plx .gstats .l{font-size:12px;color:var(--walnut-3)}
.plx .bars{padding:12px 18px 14px;border-bottom:1px solid var(--line-soft);display:grid;gap:8px}
.plx .bar{display:grid;grid-template-columns:150px 1fr 110px;align-items:center;gap:12px;font-size:12.5px;color:var(--walnut-2)}
.plx .bar .track{height:6px;border-radius:3px;background:var(--cream);overflow:hidden}
.plx .bar .fill{height:100%;border-radius:3px}.plx .bar .fill.sage{background:var(--sage)}.plx .bar .fill.walnut{background:var(--walnut-2)}
.plx .bar .pct{text-align:right}
.plx .group .ledger th{display:none}
.plx .unlinked .group-head{background:var(--terra-soft);border-color:#EBD3C6}
.plx .unlinked .group-head .title{color:#7E3A20}.plx .unlinked .group-head .desc{color:#7E3A20;opacity:.85}
.plx .btn.terra{background:var(--terra);border-color:var(--terra);color:#fff}.plx .btn.terra:hover{background:#9C4526}
.plx .empty{background:var(--paper);border:1px dashed var(--line);border-radius:10px;padding:48px 32px;text-align:center}
.plx .empty h3{font-family:var(--serif);font-size:20px;font-weight:500;margin:0 0 6px}
.plx .empty p{margin:0 auto;max-width:44ch;color:var(--walnut-2)}
.plx .empty .ask{margin-top:18px;color:var(--walnut-2)}
.plx .empty .ask button{color:var(--terra);font-weight:500;text-decoration:underline;text-underline-offset:3px}
.plx .state{padding:70px;text-align:center;color:var(--walnut-3)}
/* modal */
.plx .scrim{position:fixed;inset:0;background:rgba(51,37,27,.28);display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px;overflow:auto;z-index:60}
.plx .modal{width:100%;max-width:520px;background:var(--paper);border:1px solid var(--line);border-radius:12px;box-shadow:0 24px 60px -20px rgba(51,37,27,.35)}
.plx .modal header{padding:20px 22px 0}
.plx .modal h3{font-family:var(--serif);font-size:22px;font-weight:500;margin:0}
.plx .modal header p{margin:6px 0 0;color:var(--walnut-2);font-size:13px}
.plx .modal .body{padding:18px 22px 6px;display:grid;gap:18px}
.plx .field label,.plx .field .lbl{display:block;font-size:13px;font-weight:500;margin-bottom:6px}
.plx .field .help{font-size:12.5px;color:var(--walnut-3);margin-top:5px}
.plx .in{height:38px;width:100%;padding:0 12px;border:1px solid var(--line);border-radius:8px;background:#fff;font:inherit;color:var(--walnut)}
.plx .in:focus{outline:none;border-color:var(--walnut-3);box-shadow:0 0 0 3px #EFE8DB}
.plx .in.num{font-family:var(--mono)}
.plx textarea.in{height:auto;padding:9px 12px;resize:vertical;min-height:60px}
.plx .amount{position:relative}.plx .amount .in{padding-left:26px}.plx .amount:before{content:"₹";position:absolute;left:12px;top:9px;color:var(--walnut-3)}
.plx .dir{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.plx .dir label{display:block;padding:11px 13px;border:1px solid var(--line);border-radius:8px;cursor:pointer;margin:0;font-weight:400}
.plx .dir label b{display:block;font-weight:500;margin-bottom:2px}.plx .dir label span{font-size:12.5px;color:var(--walnut-2);line-height:1.35}
.plx .dir label.on{border-color:var(--walnut);box-shadow:inset 0 0 0 1px var(--walnut)}
.plx .check{display:flex;gap:10px;align-items:flex-start;font-size:13px;color:var(--walnut-2);cursor:pointer}
.plx .check input{margin:3px 0 0;accent-color:var(--walnut)}.plx .check b{font-weight:500;color:var(--walnut)}
.plx .split{display:grid;gap:8px;margin-top:10px;padding:12px;background:var(--cream);border-radius:8px}
.plx .split .row{display:grid;grid-template-columns:1fr 150px;gap:10px;align-items:center;font-size:13px}
.plx .split .sum{font-size:12.5px;color:var(--walnut-3);text-align:right}.plx .split .sum.bad{color:var(--terra)}.plx .split .sum.good{color:var(--sage)}
.plx .modal footer{display:flex;justify-content:flex-end;gap:8px;padding:16px 22px 20px}
/* consolidated bill — states, without-bills column, modal */
.plx .ledger .part .s .state{color:var(--walnut-2)}
.plx .ledger .part .s .state.open{color:var(--terra)}
.plx .ledger .part .s .state.ok{color:var(--sage)}
.plx .ledger .edit{margin-left:10px;color:var(--terra);font-size:12.5px;text-decoration:underline;text-underline-offset:3px}
.plx .sites .unb{color:var(--terra)}.plx .sites .zero{color:var(--walnut-3)}
.plx .flag.sage{background:var(--sage-soft);color:#3E5C3B}
.plx .lead .big.due{color:var(--terra)}
.plx .range{display:flex;gap:10px;align-items:center;color:var(--walnut-3)}
.plx .range .in{max-width:170px}
.plx .covers{border:1px solid var(--line);border-radius:8px;background:var(--cream);padding:12px 14px;font-size:13px}
.plx .covers .head{display:flex;justify-content:space-between;font-weight:500}
.plx .covers .head button{color:var(--terra);font-weight:400;font-size:12.5px;text-decoration:underline;text-underline-offset:3px}
.plx .covers ul{list-style:none;margin:10px 0 0;padding:0;max-height:180px;overflow:auto}
.plx .covers li{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-top:1px solid var(--line-soft);color:var(--walnut-2)}
.plx .covers li:first-child{border-top:0}
.plx .diff{font-size:12.5px;margin-top:6px}
.plx .diff.due{color:var(--terra)}.plx .diff.adv{color:var(--walnut-2)}.plx .diff.zero{color:var(--sage)}
.plx .doc label{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px;cursor:pointer;font-weight:400}
.plx .doc label.on{border-color:var(--walnut);box-shadow:inset 0 0 0 1px var(--walnut)}
.plx .doc input{margin-top:3px;accent-color:var(--walnut)}
.plx .doc b{font-weight:500;display:block}.plx .doc span{font-size:12.5px;color:var(--walnut-2)}
/* money-to-classify band (new engine) */
.plx .classify-band{margin-top:26px;border:1px solid #EBD3C6;background:var(--terra-wash);border-radius:12px;overflow:hidden}
.plx .classify-band .cb-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:13px 18px;border-bottom:1px solid #EBD3C6;flex-wrap:wrap}
.plx .classify-band .cb-t{font-weight:600;color:#7E3A20}
.plx .classify-band .cb-sum{font-size:12.5px;color:#7E3A20;opacity:.85}
.plx .classify-band .cb-list{padding:6px 8px}
.plx .classify-band .cb-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border-radius:8px}
.plx .classify-band .cb-row:hover{background:rgba(255,255,255,.45)}
.plx .classify-band .cb-info{display:flex;flex-direction:column;min-width:0}
.plx .classify-band .cb-amt{font-weight:600;color:var(--walnut)}
.plx .classify-band .cb-meta{font-size:12px;color:var(--walnut-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.plx .classify-band .cb-row .btn{height:30px;padding:0 13px;background:#fff;flex:none}
.plx .classify-band .cb-more{padding:8px 10px;font-size:12.5px;color:var(--walnut-2)}
@media (max-width:820px){
  .plx .page{padding:20px 16px 60px}
  .plx .hero{grid-template-columns:1fr;gap:22px}
  .plx .who{flex-direction:column}
  .plx .ledger .contract,.plx .ledger .cert{display:none}
  .plx .lead .big{font-size:42px}
}
/* compact — the shared ledger rendered inside the wide side drawer. It fills the drawer like the full
   page; only real phones (the 820px viewport query above) stack it. The table scrolls sideways rather
   than dropping columns so it never misaligns. */
.plx.compact .page{max-width:none;padding:22px 26px 60px}
.plx.compact .actions{flex-wrap:wrap}
.plx.compact .sheet,.plx.compact .group{overflow-x:auto}
.plx.compact table.ledger{min-width:600px}
.plx.compact .ledger .contract,.plx.compact .ledger .cert{display:table-cell}
.plx.compact .modal{max-width:560px}
`;

const parseInr = (s: string) => Number(String(s).replace(/[^\d]/g, '')) || 0;
const inFY = (iso: string) => { const d = new Date(iso); const m = d.getMonth(); const y = d.getFullYear(); const fyStart = m >= 3 ? y : y - 1; const now = new Date(); const cy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; return fyStart === cy; };
const fyLabel = () => { const now = new Date(); const s = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; return `FY ${String(s).slice(2)}-${String(s + 1).slice(2)}`; };

// The party ledger UI, shared by the full page and the side drawer so there is ONE ledger across the
// app. `compact` tightens it for the drawer; `onClose` (drawer only) turns the back link into a close.
export function PartyLedgerView({ stakeholderId, compact = false, onClose }: { stakeholderId: string; compact?: boolean; onClose?: () => void }) {
  const navigate = useNavigate();
  const orgId = useOrgId();
  const { isRole } = useAuth();
  const isManager = isRole('management') || isRole('principal');
  const { show: showSnackbar } = useSnackbar();
  const [view, setView] = useState<View>('date');
  const [period, setPeriod] = useState<Period>('all');
  const [range, setRange] = useState({ from: '', to: '' });
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [txnSheet, setTxnSheet] = useState(false);
  const [obOpen, setObOpen] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [cbOpen, setCbOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const [classifyEntry, setClassifyEntry] = useState<LedgerEntry | null>(null);
  const [certifyOpen, setCertifyOpen] = useState(false);
  const [pieceOpen, setPieceOpen] = useState(false);

  const { data: L, isLoading, error, refetch } = useQuery({
    queryKey: ['party_ledger', stakeholderId, orgId],
    queryFn: async () => (orgId && await isNewLedgerOrg(orgId)) ? readParty(stakeholderId) : loadPartyLedger(stakeholderId),
    enabled: !!stakeholderId,
  });

  const entries = useMemo(() => {
    if (!L) return [];
    const now = new Date();
    return L.entries.filter(e => {
      if (!e.date) return true;
      if (period === 'month') { const d = new Date(e.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }
      if (period === '3m') { const c = new Date(now); c.setMonth(c.getMonth() - 3); return new Date(e.date) >= c; }
      if (period === 'fy') return inFY(e.date);
      if (period === 'custom') { if (range.from && e.date < range.from) return false; if (range.to && e.date > range.to) return false; return true; }
      return true;
    }).filter(e => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (e.particulars + ' ' + (e.detail || '') + ' ' + (e.narr || '') + ' ' + (e.projectName || '') + ' ' + (e.mode || '')).toLowerCase().includes(q);
    });
  }, [L, period, range, search]);

  if (isLoading) return <div className={`plx${compact ? ' compact' : ''}`}><style>{CSS}</style><div className="page"><div className="state">Loading ledger…</div></div></div>;
  if (error || !L) return <div className={`plx${compact ? ' compact' : ''}`}><style>{CSS}</style><div className="page"><div className="state" style={{ color: 'var(--terra)' }}>Could not load — {(error as any)?.message || 'try again'}</div></div></div>;

  const isEmpty = L.entries.length === 0;
  const T = terms(L.kind);
  const newLedger = L.entries.some(e => e.kind === 'payment' && e.unclassified !== undefined);
  const toClassify = newLedger ? L.entries.filter(e => e.kind === 'payment' && e.unclassified) : [];
  const toClassifySum = toClassify.reduce((s, e) => s + (e.remainder ?? e.paid), 0);

  return (
    <div className={`plx${compact ? ' compact' : ''}`}>
      <style>{CSS}</style>
      <div className="page" onClick={() => menuOpen && setMenuOpen(false)}>
        <button className="back" onClick={() => (compact && onClose ? onClose() : navigate('/stakeholders'))}>
          {compact
            ? <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>Close</>
            : <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>Parties</>}
        </button>

        {/* identity */}
        <div className="who">
          <div className="who-left">
            <div className="avatar">{initials(L.stakeholder.name)}</div>
            <div>
              <h1 className="name">{L.stakeholder.name}</h1>
              <div className="meta">{[L.stakeholder.category, L.stakeholder.type].filter(Boolean).join(', ')} <span className="uid">{L.stakeholder.id}</span></div>
              {!compact && orgId && <div style={{ marginTop: 6 }}><LedgerCutoverControl orgId={orgId} isManager={isManager} /></div>}
            </div>
          </div>
          <div className="actions">
            <button className="btn" onClick={() => showSnackbar('Send statement on WhatsApp — coming soon')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.4 8.5 8.5 0 0 1-4-1L3 21l2.1-5.4A8.4 8.4 0 1 1 21 11.5z" /></svg>Send statement
            </button>
            <button className="btn" onClick={async () => {
              try {
                const { downloadPartyStatement } = await import('../lib/ledgerStatementPdf');
                downloadPartyStatement(L);
              } catch (e) { showSnackbar((e as Error)?.message || 'Could not build the statement', { type: 'error' }); }
            }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>Download
            </button>
            <div className={`menu-wrap${menuOpen ? ' open' : ''}`} onClick={(e) => e.stopPropagation()}>
              <button className="btn primary" onClick={() => setMenuOpen(o => !o)}>Record <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg></button>
              <div className="menu">
                <button onClick={() => { setMenuOpen(false); setTxnSheet(true); }}>Payment to {L.stakeholder.name.split(' ')[0]}</button>
                {newLedger && L.contracts.length > 0 && <button onClick={() => { setMenuOpen(false); setCertifyOpen(true); }}>Certify work</button>}
                {!newLedger && L.kind === 'worker' && <button onClick={() => { setMenuOpen(false); navigate('/attendance'); }}>Work certified</button>}
                {L.kind === 'worker' && <button onClick={() => { setMenuOpen(false); setPieceOpen(true); }}>Record piece / gutha work</button>}
                {L.kind === 'vendor' && <button onClick={() => { setMenuOpen(false); setBillOpen(true); }}>Enter a bill</button>}
                {L.kind === 'vendor' && L.unbilledCount > 0 && <button onClick={() => { setMenuOpen(false); setCbOpen(true); }}>Consolidated bill</button>}
                <button onClick={() => { setMenuOpen(false); setAdjOpen(true); }}>Adjustment</button>
                {!L.opening && <button className="ob" onClick={() => { setMenuOpen(false); setObOpen(true); }}>Opening balance</button>}
              </div>
            </div>
          </div>
        </div>

        {/* hero */}
        {isEmpty ? (
          <section className="hero" style={{ gridTemplateColumns: '1fr' }}>
            <div>
              <p className="lead"><span className="big" style={{ color: 'var(--walnut-3)', fontSize: 34, marginBottom: 6 }}>Nothing on the books yet</span>The balance appears once you record a payment, certify work, or add an opening balance.</p>
              <ul className="facts"><li><span className="v num" style={{ color: 'var(--walnut-3)' }}>₹0</span><span className="l">paid</span></li><li><span className="v num" style={{ color: 'var(--walnut-3)' }}>₹0</span><span className="l">certified</span></li><li><span className="v">—</span><span className="l">last paid</span></li></ul>
            </div>
          </section>
        ) : L.kind === 'vendor' ? (
          <VendorHero L={L} onBook={() => setCbOpen(true)} />
        ) : (
          <section className="hero">
            <div>
              {/* Lead with what's owed: obligation (wages accrued + work certified) beyond what's paid is
                  "to pay"; paid beyond obligation is an advance held with the worker. */}
              <p className="lead">
                {L.toPay > 0
                  ? <><span className="big due">₹{inr(L.toPay)} <span style={{ fontSize: 26 }}>to pay</span></span>wages and certified work not yet paid</>
                  : L.advance > 0
                    ? <><span className="big">₹{inr(L.advance)} <span style={{ fontSize: 26 }}>in advance</span></span>paid ahead of work done</>
                    : <><span className="big">₹0 <span style={{ fontSize: 26 }}>to pay</span></span>everything owed is settled</>}
              </p>
              <ul className="facts">
                <li><span className="v num">₹{inr(L.totalPaid)}</span><span className="l">paid, {L.paidCount} payment{L.paidCount !== 1 ? 's' : ''}</span></li>
                <li><span className="v num">₹{inr(L.totalCert)}</span><span className="l">owed for work{L.contractCount > 0 ? `, ${L.contractCount} ${T.contract}${L.contractCount !== 1 ? 's' : ''}` : ' (wages + certified)'}</span></li>
                <li><span className="v">{L.lastPaid ? fmtDate(L.lastPaid.date) : '—'}</span><span className="l">{L.lastPaid ? `last paid, ₹${inr(L.lastPaid.amount)} ${L.lastPaid.mode.toLowerCase()}` : 'last paid'}</span></li>
              </ul>
              {L.unlinkedCount > 0 && L.contractCount > 0 && (
                <div className="flag">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>
                  {L.unlinkedCount} payment{L.unlinkedCount !== 1 ? 's' : ''} {L.unlinkedCount !== 1 ? "aren't" : "isn't"} linked to a {T.contract}.
                  <button onClick={() => setView('contract')}>Link them</button>
                </div>
              )}
            </div>
            <div className="bysite">
              <h3>Balance by site</h3>
              <div className="tscroll"><table className="sites">
                <thead><tr><th /><th>Paid</th><th>{T.credit}</th><th>{T.aheadCol}</th></tr></thead>
                <tbody>
                  {L.sites.map(s => (
                    <tr key={s.projectId}>
                      <td><div className="site">{s.projectName}</div><div className="sub">{s.hasContract ? (L.kind === 'vendor' ? 'Has POs' : 'On a contract') : T.noContract}</div></td>
                      <td className="num">{inr(s.paid)}</td>
                      <td className={`num ${s.cert ? '' : 'none'}`}>{s.cert ? inr(s.cert) : '—'}</td>
                      <td className="num ahead">{inr(s.ahead)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          </section>
        )}

        {/* money to classify — new-engine orgs only */}
        {newLedger && toClassify.length > 0 && (
          <div className="classify-band">
            <div className="cb-head">
              <span className="cb-t">Money to classify</span>
              <span className="cb-sum">{toClassify.length} payment{toClassify.length !== 1 ? 's' : ''} · ₹{inr(toClassifySum)} not yet pointed anywhere</span>
            </div>
            <div className="cb-list">
              {toClassify.slice(0, 8).map(e => (
                <div className="cb-row" key={e.id}>
                  <div className="cb-info"><span className="cb-amt num">₹{inr(e.remainder ?? e.paid)}</span><span className="cb-meta">{e.date ? fmtDate(e.date) : ''}{e.mode ? ` · ${e.mode}` : ''}{e.projectName ? ` · ${e.projectName}` : ''}{e.narr ? ` · ${e.narr}` : ''}</span></div>
                  <button className="btn" onClick={() => setClassifyEntry(e)}>Classify</button>
                </div>
              ))}
              {toClassify.length > 8 && <div className="cb-more">…and {toClassify.length - 8} more</div>}
            </div>
          </div>
        )}

        {/* controls */}
        <div className="ledger-head">
          <h2>Ledger</h2>
          {!isEmpty && (
            <div className="controls">
              <div className="seg">
                {(['date', 'contract', 'site'] as View[]).map(v => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v === 'date' ? 'By date' : v === 'contract' ? T.byContract : 'By site'}</button>)}
              </div>
              <div className="seg quiet">
                {([['all', 'All'], ['month', 'This month'], ['3m', '3 months'], ['fy', fyLabel()], ['custom', 'Custom']] as [Period, string][]).map(([p, lbl]) => <button key={p} className={period === p ? 'on' : ''} onClick={() => setPeriod(p)}>{lbl}</button>)}
              </div>
              {period === 'custom' && (
                <span className="custom"><input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} /><span style={{ color: 'var(--walnut-3)' }}>–</span><input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} /></span>
              )}
              <div className="search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                <input placeholder="Search entries" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        {isEmpty ? (
          <div className="empty">
            <h3>This ledger starts empty</h3>
            <p>Payments you record and work you certify for {L.stakeholder.name.split(' ')[0]} will appear here, with a running balance.</p>
            <div className="ask">Already have a balance with them from your old books? <button onClick={() => setObOpen(true)}>Add an opening balance</button></div>
          </div>
        ) : view === 'date' ? (
          <DateView entries={entries} L={L} T={T} onEdit={() => setObOpen(true)} />
        ) : view === 'contract' ? (
          <ContractView entries={entries} L={L} T={T} onBook={() => setCbOpen(true)} />
        ) : (
          <SiteView entries={entries} L={L} T={T} />
        )}

        {L.kind === 'worker' && <CertHistory stakeholderId={L.stakeholder.id} />}
      </div>

      {txnSheet && (
        <QuickTransactionSheet
          stakeholder={{ stakeholder_id: L.stakeholder.id, name: L.stakeholder.name, type: L.stakeholder.type }}
          onClose={() => setTxnSheet(false)}
          onSuccess={() => { setTxnSheet(false); refetch(); }}
        />
      )}
      {obOpen && <OpeningModal orgId={orgId} L={L} onClose={() => setObOpen(false)} onSaved={() => { setObOpen(false); refetch(); }} onError={m => showSnackbar(m, { type: 'error' })} />}
      {adjOpen && <AdjustmentModal orgId={orgId} L={L} onClose={() => setAdjOpen(false)} onSaved={() => { setAdjOpen(false); refetch(); }} onError={m => showSnackbar(m, { type: 'error' })} />}
      {cbOpen && <ConsolidatedModal orgId={orgId} L={L} onClose={() => setCbOpen(false)} onSaved={() => { setCbOpen(false); refetch(); }} onError={m => showSnackbar(m, { type: 'error' })} />}
      {billOpen && <BillModal L={L} onClose={() => setBillOpen(false)} onSaved={(msg) => { setBillOpen(false); showSnackbar(msg); refetch(); }} onError={m => showSnackbar(m, { type: 'error' })} />}
      {pieceOpen && <PieceWorkEntry stakeholderId={L.stakeholder.id} partyName={L.stakeholder.name} onClose={() => setPieceOpen(false)} onDone={() => refetch()} />}
      {classifyEntry && <ClassifyModal L={L} entry={classifyEntry} onClose={() => setClassifyEntry(null)} onSaved={(msg) => { setClassifyEntry(null); showSnackbar(msg); refetch(); }} onError={m => showSnackbar(m, { type: 'error' })} />}
      {certifyOpen && <CertifyModal L={L} onClose={() => setCertifyOpen(false)} onSaved={(msg) => { setCertifyOpen(false); showSnackbar(msg); refetch(); }} onError={m => showSnackbar(m, { type: 'error' })} />}
    </div>
  );
}

// The certification audit trail — who certified this worker's contract/piece work, when, and its
// approval state. Read-only provenance (the money event lives in the ledger above).
function CertHistory({ stakeholderId }: { stakeholderId: string }) {
  const { data: certs = [] } = useQuery({ queryKey: ['party_certs', stakeholderId], queryFn: () => loadPartyCertifications(stakeholderId) });
  if (!certs.length) return null;
  const badge = (s: string) => s === 'approved' ? { c: '#2F5D34', b: '#E9F2E7', t: 'Approved' }
    : s === 'pending' ? { c: '#8A5A0B', b: '#FBF3E0', t: 'Pending' } : { c: '#8F3318', b: '#FBEFE9', t: 'Rejected' };
  const kindLabel = (k: string) => k === 'lump' ? 'Progress' : k === 'measured' ? 'Measured' : 'Piece';
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink, #1E1A15)', marginBottom: 8 }}>Certification history</div>
      <div style={{ border: '1px solid #EAE6E0', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
        {certs.map((c, i) => {
          const bd = badge(c.status);
          return (
            <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, padding: '10px 14px', borderTop: i ? '1px solid #F1EEE8' : 'none', alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: '#1E1A15' }}>
                  ₹{Math.round(c.amount).toLocaleString('en-IN')} <span style={{ color: '#6B6258' }}>· {kindLabel(c.kind)}{c.projectName ? ` · ${c.projectName}` : ''}</span>
                </div>
                <div style={{ fontSize: 11.5, color: '#9A9186', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {new Date(c.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {c.status === 'approved' && c.approvedBy ? ` · approved by ${c.approvedBy}` : c.submittedBy ? ` · by ${c.submittedBy}` : ''}
                  {c.note ? ` · ${c.note}` : ''}
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: bd.c, background: bd.b, borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' }}>{bd.t}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Routed page wrapper — the ledger is the shared PartyLedgerView above.
export default function StakeholderDetail(_props: { session: Session }) {
  const { stakeholderId } = useParams();
  if (!stakeholderId) return null;
  return <PartyLedgerView stakeholderId={stakeholderId} />;
}

// ── vendor hero (consolidated-bill framing) ──────────────────────────────────
function VendorHero({ L, onBook }: { L: PartyLedger; onBook: () => void }) {
  const { toPay, advance, unbilledTotal, unbilledCount } = L;
  const billedCount = L.contractCount + L.consolidated.length;
  const sub = toPay > 0 ? "billed beyond what's paid, remains to pay"
    : (L.consolidated.length > 0 && advance > 0) ? `settled, ₹${inr(advance)} stays as advance`
    : unbilledTotal > 0 ? "nothing billed and unpaid, but the books aren't clean"
    : 'everything paid is billed';
  const latestCb = L.consolidated[L.consolidated.length - 1];
  return (
    <section className="hero">
      <div>
        <p className="lead"><span className={`big${toPay > 0 ? ' due' : ''}`}>₹{inr(toPay)} <span style={{ fontSize: 26 }}>to pay</span></span>{sub}</p>
        <ul className="facts">
          <li><span className="v num">₹{inr(L.totalPaid)}</span><span className="l">paid, {L.paidCount} payment{L.paidCount !== 1 ? 's' : ''}</span></li>
          <li><span className="v num">₹{inr(L.totalCert)}</span><span className="l">billed, {billedCount} {billedCount === 1 ? 'bill' : 'bills'}</span></li>
          <li><span className="v num" style={unbilledTotal ? { color: 'var(--terra)' } : undefined}>₹{inr(unbilledTotal)}</span><span className="l">paid without bills{unbilledCount ? `, ${unbilledCount} payment${unbilledCount !== 1 ? 's' : ''}` : ''}</span></li>
        </ul>
        {unbilledCount > 0 ? (
          <div className="flag">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>
            {unbilledCount} payment{unbilledCount !== 1 ? 's' : ''} {unbilledCount !== 1 ? 'have' : 'has'} no bill on file.
            <button onClick={onBook}>Book a consolidated bill</button>
          </div>
        ) : latestCb ? (
          <div className="flag sage">Consolidated bill for {fmtDate(latestCb.from)} – {fmtDate(latestCb.to)} booked{latestCb.confirmed ? ', confirmed' : '. Awaiting confirmation'}.</div>
        ) : null}
      </div>
      <div className="bysite">
        <h3>Balance by site</h3>
        <div className="tscroll"><table className="sites">
          <thead><tr><th /><th>Paid</th><th>Billed</th><th>Without bills</th></tr></thead>
          <tbody>
            {L.sites.map(s => (
              <tr key={s.projectId}>
                <td><div className="site">{s.projectName}</div></td>
                <td className="num">{inr(s.paid)}</td>
                <td className={`num ${s.cert ? '' : 'zero'}`}>{s.cert ? inr(s.cert) : '—'}</td>
                <td className={`num ${s.unbilled ? 'unb' : 'zero'}`}>{s.unbilled ? inr(s.unbilled) : '0'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </section>
  );
}

// ── ledger row + table pieces ─────────────────────────────────────────────────
const ClipSvg = () => <span className="clip" title="Attachment"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg></span>;

function Row({ e, showContract = true, showSite = true, first = false }: { e: LedgerEntry; showContract?: boolean; showSite?: boolean; first?: boolean }) {
  const sub = [e.mode, showSite ? e.projectName : null, e.detail].filter(Boolean).join(', ');
  const stateCls = e.kind === 'consolidated' ? (e.state === 'confirmed' ? 'state ok' : 'state open')
    : e.unbilled ? 'state open' : e.covered ? 'state' : 'state ok';
  return (
    <tr className={`row${e.kind === 'opening' ? ' opening' : ''}`}>
      <td className="date">{e.date ? fmtDate(e.date) : '—'}</td>
      <td className="part">
        <div className="p">{e.particulars}{e.clip ? <ClipSvg /> : null}</div>
        {(sub || e.state) ? <div className="s">{sub}{sub && e.state ? ', ' : ''}{e.state ? <span className={stateCls}>{e.state}</span> : null}</div> : null}
        {e.narr ? <div className="s"><span className="narr">{e.narr}</span></div> : null}
      </td>
      {showContract && <td className="contract">{e.contractId ? e.contractId : <span className="dash">—</span>}</td>}
      <td className="r paid num">{e.paid ? inr(e.paid) : ''}</td>
      <td className="r cert num">{e.cert ? inr(e.cert) : ''}</td>
      <td className={`r bal num ${first ? 'now' : ''}`}>{inr(e.running)}</td>
    </tr>
  );
}
function Head({ showContract, T }: { showContract: boolean; T: Terms }) {
  return <thead><tr><th>Date</th><th>Particulars</th>{showContract && <th>{T.contractCol}</th>}<th className="r">Paid</th><th className="r">{T.credit}</th><th className="r">{T.aheadCol}</th></tr></thead>;
}
function OpeningRow({ L, onEdit, sub }: { L: PartyLedger; onEdit: () => void; sub: string }) {
  if (L.opening) {
    const ob = L.entries.find(e => e.kind === 'opening');
    return (
      <tr className="row opening">
        <td className="date">{ob?.date ? fmtDate(ob.date) : '—'}</td>
        <td className="part"><div className="p">Opening balance<button className="edit" onClick={onEdit}>Edit</button></div><div className="s">{sub}, {L.opening.confirmed ? 'confirmed' : 'not yet confirmed'}</div></td>
        <td className="contract" /><td className="r paid" /><td className="r cert" />
        <td className="r bal num">{inr(L.opening.total)}</td>
      </tr>
    );
  }
  return (
    <tr className="row opening">
      <td className="date">—</td>
      <td className="part"><div className="p">Opening balance<button className="edit" onClick={onEdit}>Add</button></div><div className="s">None recorded</div></td>
      <td className="contract" /><td className="r paid" /><td className="r cert" />
      <td className="r bal num" style={{ color: 'var(--walnut-3)' }}>0</td>
    </tr>
  );
}

function DateView({ entries, L, T, onEdit }: { entries: LedgerEntry[]; L: PartyLedger; T: Terms; onEdit: () => void }) {
  const rows: ReactElement[] = [];
  let lastMonth = ''; let first = true;
  for (const e of entries.filter(x => x.kind !== 'opening')) {
    const mk = e.date ? monthKey(e.date) : '';
    if (mk && mk !== lastMonth) {
      lastMonth = mk;
      const mEntries = entries.filter(x => x.date && monthKey(x.date) === mk);
      const paid = mEntries.reduce((s, x) => s + x.paid, 0), cert = mEntries.reduce((s, x) => s + x.cert, 0);
      const pc = mEntries.filter(x => x.kind === 'payment').length;
      rows.push(<tr className="month" key={`m-${mk}`}><td className="m" colSpan={2}>{monthLabel(e.date!)}</td><td className="t" colSpan={4}>{pc} payment{pc !== 1 ? 's' : ''}, ₹{inr(paid)} paid{cert ? <> · <span className="cert">₹{inr(cert)} certified</span></> : null}</td></tr>);
    }
    rows.push(<Row key={e.id} e={e} first={first} />); first = false;
  }
  return <div className="sheet"><div className="tscroll"><table className="ledger"><Head showContract T={T} /><tbody>{rows}<OpeningRow L={L} onEdit={onEdit} sub={L.opening ? `As of ${fmtDate(L.entries.find(x => x.kind === 'opening')!.date!)}` : ''} /></tbody></table></div></div>;
}

function ContractView({ entries, L, T, onBook }: { entries: LedgerEntry[]; L: PartyLedger; T: Terms; onBook?: () => void }) {
  return (
    <>
      {L.contracts.map(c => {
        const rows = entries.filter(e => e.contractId === c.woId);
        const certPct = c.value ? Math.round(c.cert / c.value * 100) : 0;
        const paidPct = c.value ? Math.round(c.paidLinked / c.value * 100) : 0;
        return (
          <div className="group" key={c.woId}>
            <div className="group-head">
              <div><div className="title">{c.title}<span className="id">{c.woId}</span></div>
                <div className="desc">{L.kind === 'vendor' ? 'Bill amount' : 'Contract value'} ₹{inr(c.value)}. {c.projectName || ''}</div></div>
              <div className="gstats"><div><div className="v num">₹{inr(c.cert)}</div><div className="l">{T.creditWord}</div></div><div><div className="v num">₹{inr(c.paidLinked)}</div><div className="l">paid, {c.paidCount} linked</div></div></div>
            </div>
            <div className="bars">
              <div className="bar"><span>{L.kind === 'vendor' ? 'Billed' : 'Work certified'}</span><div className="track"><div className="fill sage" style={{ width: `${Math.min(100, certPct)}%` }} /></div><span className="pct">{certPct}% of {T.contract}</span></div>
              <div className="bar"><span>Paid against {T.contract}</span><div className="track"><div className="fill walnut" style={{ width: `${Math.min(100, paidPct)}%` }} /></div><span className="pct">{paidPct}% of {T.contract}</span></div>
            </div>
            <div className="tscroll"><table className="ledger"><Head showContract={false} T={T} /><tbody>{rows.map(e => <Row key={e.id} e={e} showContract={false} />)}{rows.length === 0 && <tr className="row"><td colSpan={5} style={{ color: 'var(--walnut-3)' }}>No entries linked to this {T.contract} yet.</td></tr>}</tbody></table></div>
          </div>
        );
      })}
      {L.unlinkedCount > 0 && (
        <div className="group unlinked">
          <div className="group-head">
            <div><div className="title">{L.unlinkedCount} payment{L.unlinkedCount !== 1 ? 's' : ''} aren't linked to a {T.contract}</div>
              <div className="desc">{L.kind === 'vendor' && L.unbilledCount > 0 ? `₹${inr(L.unbilledTotal)} paid without bills. A consolidated bill can settle the billing; linking to POs is separate.` : `₹${inr(L.unlinkedTotal)}. Linking them moves the ${T.contract}'s paid figure.`}</div></div>
            {L.kind === 'vendor' && L.unbilledCount > 0 && onBook && <div><button className="btn terra" onClick={onBook}>Book consolidated bill</button></div>}
          </div>
          <div className="tscroll"><table className="ledger"><Head showContract T={T} /><tbody>{entries.filter(e => e.kind === 'payment' && !e.contractId).map(e => <Row key={e.id} e={e} />)}</tbody></table></div>
        </div>
      )}
      {L.contracts.length === 0 && L.unlinkedCount === 0 && <div className="state">No contract entries.</div>}
    </>
  );
}

function SiteView({ entries, L, T }: { entries: LedgerEntry[]; L: PartyLedger; T: Terms }) {
  return (
    <>
      {L.sites.map(s => {
        const rows = entries.filter(e => (e.byProject ? e.byProject[s.projectId] : e.projectId === s.projectId));
        return (
          <div className="group" key={s.projectId}>
            <div className="group-head">
              <div><div className="title">{s.projectName}</div><div className="desc">{s.hasContract ? (L.kind === 'vendor' ? 'Has POs' : 'On a contract') : T.noContract}</div></div>
              <div className="gstats"><div><div className="v num">₹{inr(s.paid)}</div><div className="l">paid</div></div><div><div className="v num">{s.cert ? '₹' + inr(s.cert) : '—'}</div><div className="l">{T.creditWord}</div></div><div><div className="v num" style={{ color: 'var(--terra)' }}>₹{inr(s.ahead)}</div><div className="l">{T.aheadCol.toLowerCase()}</div></div></div>
            </div>
            <div className="tscroll"><table className="ledger"><Head showContract T={T} /><tbody>{rows.map(e => <Row key={e.id} e={e} showSite={false} />)}</tbody></table></div>
          </div>
        );
      })}
      {L.sites.length === 0 && <div className="state">No site entries.</div>}
    </>
  );
}

// ── modals ─────────────────────────────────────────────────────────────────────
function OpeningModal({ orgId, L, onClose, onSaved, onError }: { orgId: string; L: PartyLedger; onClose: () => void; onSaved: () => void; onError: (m: string) => void }) {
  const [asOf, setAsOf] = useState(L.opening?.asOf || '2026-04-01');
  const [dir, setDir] = useState<'paid_ahead' | 'work_owed'>(L.opening?.direction || 'paid_ahead');
  const [amount, setAmount] = useState(L.opening ? inr(L.opening.total) : '');
  const [split, setSplit] = useState(!!(L.opening && Object.keys(L.opening.bySite).length));
  const [note, setNote] = useState(L.opening?.note || '');
  const [siteAmts, setSiteAmts] = useState<Record<string, string>>(() => { const o: Record<string, string> = {}; L.sites.forEach(s => { o[s.projectId] = L.opening?.bySite[s.projectId] ? inr(L.opening.bySite[s.projectId]) : ''; }); return o; });
  const [busy, setBusy] = useState(false);
  const total = parseInr(amount);
  const partsSum = L.sites.reduce((a, s) => a + parseInr(siteAmts[s.projectId] || ''), 0);
  const diff = total - partsSum;
  const save = async () => {
    if (busy || total <= 0) return; setBusy(true);
    const bySite: Record<string, number> = {};
    if (split) L.sites.forEach(s => { const v = parseInr(siteAmts[s.projectId] || ''); if (v) bySite[s.projectId] = v; });
    try { await saveOpeningBalance(orgId, L.stakeholder.id, { asOf, direction: dir, total, bySite, note }); onSaved(); }
    catch (e: any) { onError(e?.message || 'Could not save'); setBusy(false); }
  };
  return (
    <div className="scrim" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog">
        <header><h3>Opening balance for {L.stakeholder.name}</h3><p>Where your old books left off. Everything before this date stays in them.</p></header>
        <div className="body">
          <div className="field"><label>As of</label><input className="in" type="date" value={asOf} onChange={e => setAsOf(e.target.value)} style={{ maxWidth: 200 }} /><div className="help">1 April matches a financial year. Use today's date if starting mid-year.</div></div>
          <div className="field"><div className="lbl">Which way does it run?</div><div className="dir">
            <label className={dir === 'paid_ahead' ? 'on' : ''} onClick={() => setDir('paid_ahead')}><b>Paid ahead of work</b><span>You've paid them more than the work certified so far.</span></label>
            <label className={dir === 'work_owed' ? 'on' : ''} onClick={() => setDir('work_owed')}><b>Work done, not yet paid</b><span>They've certified work you still owe them for.</span></label>
          </div></div>
          <div className="field"><label>Amount</label><div className="amount" style={{ maxWidth: 220 }}><input className="in num" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} /></div>
            {L.sites.length > 1 && <label className="check" style={{ marginTop: 12 }}><input type="checkbox" checked={split} onChange={e => setSplit(e.target.checked)} /><span>Split by site <span style={{ color: 'var(--walnut-3)' }}>— each site keeps its own balance</span></span></label>}
            {split && <div className="split">{L.sites.map(s => <div className="row" key={s.projectId}><span>{s.projectName}</span><div className="amount"><input className="in num" value={siteAmts[s.projectId] || ''} onChange={e => setSiteAmts(a => ({ ...a, [s.projectId]: e.target.value }))} /></div></div>)}<div className={`sum ${diff === 0 ? 'good' : 'bad'}`}>{diff === 0 ? 'Adds up to the total' : diff > 0 ? `₹${inr(diff)} not yet assigned to a site` : `₹${inr(-diff)} over the total`}</div></div>}
          </div>
          <div className="field"><label>Where this figure comes from</label><textarea className="in" placeholder="e.g. site ledger book, page 14, agreed on 28 March" value={note} onChange={e => setNote(e.target.value)} /></div>
        </div>
        <footer><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || total <= 0 || (split && diff !== 0)} onClick={save}>{busy ? '…' : L.opening ? 'Save' : 'Add opening balance'}</button></footer>
      </div>
    </div>
  );
}

function AdjustmentModal({ orgId, L, onClose, onSaved, onError }: { orgId: string; L: PartyLedger; onClose: () => void; onSaved: () => void; onError: (m: string) => void }) {
  const [adjDate, setAdjDate] = useState(new Date().toISOString().slice(0, 10));
  const [side, setSide] = useState<'paid' | 'certified'>('paid');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const amt = parseInr(amount);
  const save = async () => {
    if (busy || amt <= 0 || !note.trim()) return; setBusy(true);
    try { await addAdjustment(orgId, L.stakeholder.id, { projectId: projectId || null, adjDate, side, amount: amt, note: note.trim() }); onSaved(); }
    catch (e: any) { onError(e?.message || 'Could not save'); setBusy(false); }
  };
  return (
    <div className="scrim" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog">
        <header><h3>Adjustment for {L.stakeholder.name}</h3><p>A manual correction — a waiver, a deduction, a figure agreed off the register.</p></header>
        <div className="body">
          <div className="field"><label>Date</label><input className="in" type="date" value={adjDate} onChange={e => setAdjDate(e.target.value)} style={{ maxWidth: 200 }} /></div>
          <div className="field"><div className="lbl">Which side?</div><div className="dir">
            <label className={side === 'paid' ? 'on' : ''} onClick={() => setSide('paid')}><b>Counts as paid</b><span>Raises what you've paid ahead (e.g. an advance recorded elsewhere).</span></label>
            <label className={side === 'certified' ? 'on' : ''} onClick={() => setSide('certified')}><b>Counts as {L.kind === 'vendor' ? 'billed' : 'certified'}</b><span>Lowers the balance (e.g. a deduction for damage or shortage).</span></label>
          </div></div>
          <div className="field"><label>Amount</label><div className="amount" style={{ maxWidth: 220 }}><input className="in num" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} /></div></div>
          {L.sites.length > 0 && <div className="field"><label>Site (optional)</label><select className="in" value={projectId} onChange={e => setProjectId(e.target.value)} style={{ maxWidth: 260 }}><option value="">Whole party</option>{L.sites.map(s => <option key={s.projectId} value={s.projectId}>{s.projectName}</option>)}</select></div>}
          <div className="field"><label>Why</label><textarea className="in" placeholder="e.g. ₹5,000 deducted for tiles broken on site, agreed 2 Sep" value={note} onChange={e => setNote(e.target.value)} /></div>
        </div>
        <footer><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || amt <= 0 || !note.trim()} onClick={save}>{busy ? '…' : 'Add adjustment'}</button></footer>
      </div>
    </div>
  );
}

// Enter one vendor bill → mints a bill credit, and (optionally) settles the earlier "paid without a
// bill" money against it, oldest first. The forward-model way to record the bills that arrive late.
function BillModal({ L, onClose, onSaved, onError }: { L: PartyLedger; onClose: () => void; onSaved: (msg: string) => void; onError: (m: string) => void }) {
  const [amount, setAmount] = useState('');
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [billNo, setBillNo] = useState('');
  const [docType, setDocType] = useState<'vendor' | 'kacha' | 'none'>('vendor');
  const [projectId, setProjectId] = useState('');
  const [settle, setSettle] = useState(true);
  const [busy, setBusy] = useState(false);
  const amt = parseInr(amount);

  const save = async () => {
    if (busy || amt <= 0) return; setBusy(true);
    try {
      const creditId = await createCredit({
        stakeholderId: L.stakeholder.id, kind: 'vendor_bill', amount: amt, entryDate: billDate,
        projectId: projectId || null, docFlag: docType, note: billNo.trim() || null, source: 'manual',
      });
      let msg = `Bill ₹${inr(amt)} recorded`;
      if (settle) { const r = await fillCredit(creditId); if (r.touched > 0) msg += ` · ₹${inr(r.allocated)} of earlier payments settled it`; else msg += ' · nothing earlier to settle'; }
      onSaved(msg);
    } catch (e: any) { onError(e?.message || 'Could not record the bill'); setBusy(false); }
  };

  const docOpts: { key: 'vendor' | 'kacha' | 'none'; b: string; s: string }[] = [
    { key: 'vendor', b: 'Proper vendor bill', s: 'A GST invoice or a printed bill.' },
    { key: 'kacha', b: 'Kacha statement', s: 'An informal note, not a proper bill.' },
    { key: 'none', b: 'No document', s: 'Booked on your figures. Stays flagged for your CA.' },
  ];

  return (
    <div className="scrim" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog">
        <header><h3>Enter a bill from {L.stakeholder.name}</h3><p>Records what {L.stakeholder.name.split(' ')[0]} has billed you. Payments already made can settle against it.</p></header>
        <div className="body">
          <div className="field"><label>Bill amount</label><div className="amount" style={{ maxWidth: 220 }}><input className="in num" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} autoFocus /></div></div>
          <div className="field" style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 160px' }}><label>Bill date</label><input className="in" type="date" value={billDate} onChange={e => setBillDate(e.target.value)} /></div>
            <div style={{ flex: '1 1 160px' }}><label>Bill number <span style={{ color: 'var(--walnut-3)', fontWeight: 400 }}>(optional)</span></label><input className="in" value={billNo} onChange={e => setBillNo(e.target.value)} placeholder="e.g. INV-0912" /></div>
          </div>
          {L.sites.length > 0 && <div className="field"><label>Site <span style={{ color: 'var(--walnut-3)', fontWeight: 400 }}>(optional)</span></label><select className="in" value={projectId} onChange={e => setProjectId(e.target.value)} style={{ maxWidth: 280 }}><option value="">Whole party</option>{L.sites.map(s => <option key={s.projectId} value={s.projectId}>{s.projectName}</option>)}</select></div>}
          <div className="field doc"><div className="lbl">What backs this bill?</div>{docOpts.map(o => (
            <label key={o.key} className={docType === o.key ? 'on' : ''} onClick={() => setDocType(o.key)}><input type="radio" name="billdoc" checked={docType === o.key} onChange={() => setDocType(o.key)} /><span><b>{o.b}</b><span>{o.s}</span></span></label>
          ))}</div>
          <label className="check"><input type="checkbox" checked={settle} onChange={e => setSettle(e.target.checked)} /><span><b>Settle earlier payments against this bill.</b> Points the money already paid without a bill at this one, oldest first.</span></label>
        </div>
        <footer><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || amt <= 0} onClick={save}>{busy ? '…' : 'Record bill'}</button></footer>
      </div>
    </div>
  );
}

// Certify a contract stage (§2.4 / §6.2): mints the certified credit and settles the advance pool
// against it, oldest first. Shortfall → the remainder is to-pay; excess advances stay for next stage.
function CertifyModal({ L, onClose, onSaved, onError }: { L: PartyLedger; onClose: () => void; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const [contractRef, setContractRef] = useState(L.contracts[0]?.woId || '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const amt = parseInr(amount);
  const c = L.contracts.find(x => x.woId === contractRef);
  const advanced = c?.paidLinked ?? 0;

  const save = async () => {
    if (busy || amt <= 0 || !contractRef) return; setBusy(true);
    try {
      const r = await certifyStage({ stakeholderId: L.stakeholder.id, contractRef, amount: amt, entryDate: date, projectId: c?.projectId ?? null, note: note.trim() || null });
      let msg = `Certified ₹${inr(amt)}`;
      if (r.settled > 0) msg += ` · ₹${inr(r.settled)} of advances settled`;
      if (r.open > 0.5) msg += ` · ₹${inr(r.open)} now to pay`;
      onSaved(msg);
    } catch (e: any) { onError(e?.message || 'Could not certify'); setBusy(false); }
  };

  return (
    <div className="scrim" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog">
        <header><h3>Certify work for {L.stakeholder.name}</h3><p>Records measured work as certified. Advances already paid on the contract settle against it, oldest first.</p></header>
        <div className="body">
          <div className="field"><label>Contract</label><select className="in" value={contractRef} onChange={e => setContractRef(e.target.value)}>{L.contracts.map(x => <option key={x.woId} value={x.woId}>{x.title}</option>)}</select>
            {c && <div className="help">Advanced so far ₹{inr(advanced)} · certified so far ₹{inr(c.value)}{advanced > c.value ? ` · ₹${inr(advanced - c.value)} paid beyond certified` : ''}</div>}
          </div>
          <div className="field"><label>Certified this time</label><div className="amount" style={{ maxWidth: 220 }}><input className="in num" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} autoFocus /></div>
            {amt > 0 && advanced > 0 && <div className="help">{advanced >= amt ? `Fully covered by advances — nothing new to pay.` : `₹${inr(amt - advanced)} will remain to pay after advances.`}</div>}
          </div>
          <div className="field"><label>Date</label><input className="in" type="date" value={date} onChange={e => setDate(e.target.value)} style={{ maxWidth: 200 }} /></div>
          <div className="field"><label>Note <span style={{ color: 'var(--walnut-3)', fontWeight: 400 }}>(optional)</span></label><textarea className="in" placeholder="e.g. slab concreting, 2nd floor — measured 2 Sep" value={note} onChange={e => setNote(e.target.value)} /></div>
        </div>
        <footer><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || amt <= 0 || !contractRef} onClick={save}>{busy ? '…' : 'Certify'}</button></footer>
      </div>
    </div>
  );
}

// Classify one payment (§4.4): point it at an open bill, an advance on a contract, or declare it
// self-settled (work done / goods received, no bill). "Bill expected later" leaves it honestly open.
function ClassifyModal({ L, entry, onClose, onSaved, onError }: { L: PartyLedger; entry: LedgerEntry; onClose: () => void; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const paymentId = entry.id.replace(/^t-/, '');
  const remainder = entry.remainder ?? entry.paid;
  const [mode, setMode] = useState<'bill' | 'advance' | 'self' | 'later'>('bill');
  const [openC, setOpenC] = useState<OpenCredit[]>([]);
  const [creditId, setCreditId] = useState('');
  const [contractRef, setContractRef] = useState(L.contracts[0]?.woId || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => { openCreditsFor(L.stakeholder.id).then(cs => { setOpenC(cs); if (cs[0]) setCreditId(cs[0].creditId); if (!cs.length) setMode(m => m === 'bill' ? (L.contracts.length ? 'advance' : 'self') : m); }).catch(() => {}); }, [L.stakeholder.id, L.contracts.length]);

  const save = async () => {
    if (busy) return; setBusy(true);
    try {
      if (mode === 'bill') {
        const c = openC.find(x => x.creditId === creditId);
        const amt = Math.min(remainder, c?.open ?? remainder);
        await allocateToCredit(paymentId, creditId, amt);
        onSaved(`₹${inr(amt)} settled against the bill`);
      } else if (mode === 'advance') {
        await allocateToPool(paymentId, contractRef, remainder);
        onSaved(`₹${inr(remainder)} recorded as an advance on ${contractRef}`);
      } else if (mode === 'self') {
        const cid = await createCredit({ stakeholderId: L.stakeholder.id, kind: 'self_settle', amount: remainder, entryDate: entry.date ?? new Date().toISOString().slice(0, 10), projectId: entry.projectId, parentPaymentId: paymentId, docFlag: 'none', note: 'Work done / goods received, no bill', source: 'manual' });
        await allocateToCredit(paymentId, cid, remainder);
        onSaved(`₹${inr(remainder)} booked as work done, no bill`);
      } else { onClose(); return; }
    } catch (e: any) { onError(e?.message || 'Could not classify'); setBusy(false); }
  };

  const opts: { key: typeof mode; b: string; s: string; disabled?: boolean }[] = [
    { key: 'bill', b: 'Against a bill', s: 'It pays down a bill already recorded.', disabled: openC.length === 0 },
    { key: 'advance', b: 'Advance on a contract', s: 'Paid ahead of measurement on a contract.', disabled: L.contracts.length === 0 },
    { key: 'self', b: 'Work done — no bill', s: 'Goods received or labour done, no bill will come.' },
    { key: 'later', b: 'A bill is expected', s: 'Leave it open until the bill arrives.' },
  ];

  return (
    <div className="scrim" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog">
        <header><h3>Classify ₹{inr(remainder)}</h3><p>{entry.date ? fmtDate(entry.date) : ''}{entry.mode ? ` · ${entry.mode}` : ''}{entry.narr ? ` · ${entry.narr}` : ''} — where should this money go?</p></header>
        <div className="body">
          <div className="dir" style={{ gridTemplateColumns: '1fr 1fr' }}>
            {opts.map(o => <label key={o.key} className={mode === o.key ? 'on' : ''} style={o.disabled ? { opacity: .4, pointerEvents: 'none' } : undefined} onClick={() => !o.disabled && setMode(o.key)}><b>{o.b}</b><span>{o.s}</span></label>)}
          </div>
          {mode === 'bill' && openC.length > 0 && (
            <div className="field"><label>Which bill?</label><select className="in" value={creditId} onChange={e => setCreditId(e.target.value)}>{openC.map(c => <option key={c.creditId} value={c.creditId}>{c.kind === 'vendor_bill' ? 'Bill' : c.kind === 'consolidated' ? 'Consolidated' : c.kind} · {fmtDate(c.entryDate)} · ₹{inr(c.open)} open</option>)}</select></div>
          )}
          {mode === 'advance' && L.contracts.length > 0 && (
            <div className="field"><label>Which contract?</label><select className="in" value={contractRef} onChange={e => setContractRef(e.target.value)}>{L.contracts.map(c => <option key={c.woId} value={c.woId}>{c.title}</option>)}</select></div>
          )}
        </div>
        <footer><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? '…' : mode === 'later' ? 'Leave open' : 'Classify'}</button></footer>
      </div>
    </div>
  );
}

// One bill that covers the vendor payments that never got their own — cleans "paid without bills".
function ConsolidatedModal({ orgId, L, onClose, onSaved, onError }: { orgId: string; L: PartyLedger; onClose: () => void; onSaved: () => void; onError: (m: string) => void }) {
  const unbilledPays = L.entries.filter(e => e.kind === 'payment' && e.unbilled && e.date);
  const sorted = unbilledPays.map(e => e.date!).sort();
  const defFrom = sorted[0] || new Date().toISOString().slice(0, 10);
  const now = new Date();
  const eom = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10); // end of last month
  const defTo = eom > defFrom ? eom : (sorted[sorted.length - 1] || defFrom);
  const initTotal = unbilledPays.filter(e => e.date! >= defFrom && e.date! <= defTo).reduce((s, e) => s + e.paid, 0);
  const [from, setFrom] = useState(defFrom);
  const [to, setTo] = useState(defTo);
  const [amount, setAmount] = useState(initTotal ? inr(initTotal) : '');
  const [docType, setDocType] = useState<'vendor' | 'kacha' | 'none'>('vendor');
  const [note, setNote] = useState('');
  const [showCovers, setShowCovers] = useState(false);
  const [busy, setBusy] = useState(false);

  const covered = unbilledPays.filter(e => e.date! >= from && e.date! <= to);
  const coversTotal = covered.reduce((s, e) => s + e.paid, 0);
  const perSite: Record<string, number> = {};
  covered.forEach(e => { if (e.byProject) Object.entries(e.byProject).forEach(([pid, amt]) => { perSite[pid] = (perSite[pid] || 0) + amt; }); });
  const siteName = (pid: string) => L.sites.find(s => s.projectId === pid)?.projectName || pid;
  const amt = parseInr(amount) || coversTotal;
  const diff = amt - coversTotal;
  const valid = to >= from && amt > 0 && covered.length > 0;

  const save = async () => {
    if (busy || !valid) return; setBusy(true);
    try { await bookConsolidatedBill(orgId, L.stakeholder.id, { from, to, amount: amt, docType, note: note.trim() }); onSaved(); }
    catch (e: any) { onError(e?.message || 'Could not book'); setBusy(false); }
  };

  const docOpts: { key: 'vendor' | 'kacha' | 'none'; b: string; s: string }[] = [
    { key: 'vendor', b: `${L.stakeholder.name.split(' ')[0]}'s consolidated bill`, s: 'They sent a bill or statement for the period.' },
    { key: 'kacha', b: 'Kacha statement or notebook figure', s: 'An informal note, not a proper bill.' },
    { key: 'none', b: 'No document — booked on my own figures', s: 'Stays flagged for your CA. No GST input on this.' },
  ];

  return (
    <div className="scrim" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 560 }} role="dialog">
        <header>
          <h3>Consolidated bill from {L.stakeholder.name}</h3>
          <p>One bill covering the payments that never got their own. The figure is yours to stand behind — it goes on the ledger and the statement.</p>
        </header>
        <div className="body">
          <div className="field">
            <div className="lbl">Period</div>
            <div className="range"><input className="in" type="date" value={from} onChange={e => setFrom(e.target.value)} /> to <input className="in" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
            <div className="help">From the first payment without a bill, through end of last month. Overlapping an existing consolidated bill isn't allowed.</div>
          </div>

          <div className="covers">
            <div className="head">
              <span>Covers {covered.length} payment{covered.length !== 1 ? 's' : ''} without bills, ₹{inr(coversTotal)}</span>
              {covered.length > 0 && <button onClick={() => setShowCovers(v => !v)}>{showCovers ? 'Hide' : 'Show them'}</button>}
            </div>
            {showCovers && (
              <ul>
                {covered.slice(0, 8).map(e => <li key={e.id}><span>{fmtDate(e.date!)}, {e.narr || e.particulars}{e.projectName ? `, ${e.projectName}` : ''}</span><span className="num">{inr(e.paid)}</span></li>)}
                {covered.length > 8 && <li><span>… and {covered.length - 8} more</span><span className="num">{inr(covered.slice(8).reduce((s, e) => s + e.paid, 0))}</span></li>}
              </ul>
            )}
            {Object.keys(perSite).length > 1 && (
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--line)', display: 'grid', gap: 3, fontSize: 12.5, color: 'var(--walnut-2)' }}>
                {Object.entries(perSite).sort((a, b) => b[1] - a[1]).map(([pid, v]) => <div key={pid} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{siteName(pid)}</span><span className="num">{inr(v)}</span></div>)}
              </div>
            )}
          </div>

          <div className="field">
            <label>Bill amount</label>
            <div className="amount" style={{ maxWidth: 220 }}><input className="in num" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} /></div>
            {diff !== 0 && <div className={`diff ${diff > 0 ? 'due' : 'adv'}`}>{diff > 0 ? `₹${inr(diff)} more than what's paid — stays open as an amount to pay.` : `₹${inr(-diff)} less than what's paid — stays as an advance.`}</div>}
            {diff === 0 && amt > 0 && <div className="diff zero">Matches the payments covered, nothing left over.</div>}
          </div>

          <div className="field doc">
            <div className="lbl">What's behind this figure?</div>
            {docOpts.map(o => (
              <label key={o.key} className={docType === o.key ? 'on' : ''} onClick={() => setDocType(o.key)}>
                <input type="radio" name="cbdoc" checked={docType === o.key} onChange={() => setDocType(o.key)} />
                <span><b>{o.b}</b><span>{o.s}</span></span>
              </label>
            ))}
          </div>

          <div className="field"><label>Note</label><textarea className="in" placeholder="e.g. wiring material for all three sites, May to August, as per his khata" value={note} onChange={e => setNote(e.target.value)} /></div>
        </div>
        <footer><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !valid} onClick={save}>{busy ? '…' : 'Book consolidated bill'}</button></footer>
      </div>
    </div>
  );
}
