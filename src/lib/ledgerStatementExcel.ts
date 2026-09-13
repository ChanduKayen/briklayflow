/**
 * ledgerStatementExcel — the same Statement of Account the PDF emits (ledgerStatementPdf.ts), as an
 * .xlsx workbook. Reads the already-loaded PartyLedger so it ties exactly to the party page. Keep the
 * columns + Dr/Cr convention in SYNC with ledgerStatementPdf.ts. xlsx is imported lazily (heavy).
 */
import type { PartyLedger, LedgerEntry } from './partyLedgerApi';

const money = (n: number) => (Math.abs(n) < 0.5 ? '' : Math.round(n));
/** A balance with its Dr/Cr sense: +payable → Cr, −advance → Dr. */
const balStr = (payable: number) =>
  Math.abs(payable) < 0.5 ? '0' : `${Math.abs(Math.round(payable)).toLocaleString('en-IN')} ${payable > 0 ? 'Cr' : 'Dr'}`;

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

/** Oldest-first, opening/start pinned to the top — same order as the PDF. */
function ordered(entries: LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort((a, b) => {
    const seed = (e: LedgerEntry) => (e.kind === 'start' ? 0 : e.kind === 'opening' ? 1 : 2);
    return seed(a) - seed(b) || (a.date || '').localeCompare(b.date || '');
  });
}

const vchType = (e: LedgerEntry) =>
  e.kind === 'payment' ? 'Payment'
    : (e.kind === 'bill' || e.kind === 'consolidated') ? 'Purchase'
    : e.kind === 'wage' ? 'Wages'
    : e.kind === 'certified' ? 'Measurement'
    : (e.kind === 'opening' || e.kind === 'start') ? 'Op. Bal.'
    : 'Journal';
const vchNo = (e: LedgerEntry) => e.ref?.label || e.contractId || (e.kind === 'bill' ? e.id.replace(/^billv?-/, '') : '');
const particularsOf = (e: LedgerEntry) => {
  if (e.kind === 'opening' || e.kind === 'start') return 'Opening Balance b/f';
  if ((e.paid || 0) > 0) { const m = (e.mode || '').trim(); return !m ? 'To Bank / Cash' : /cash/i.test(m) ? 'To Cash' : `To Bank (${m})`; }
  if (e.kind === 'consolidated') return 'By Purchases (Consolidated)';
  if (e.kind === 'wage') return 'By Wages (Attendance)';
  if (e.kind === 'certified') return 'By Work Certified';
  if (e.kind === 'adjustment') return 'By Adjustment';
  return 'By Purchases';
};

/** Build + download the Statement of Account as an .xlsx for a party. */
export async function downloadPartyStatementExcel(L: PartyLedger): Promise<void> {
  const XLSX = await import('xlsx');
  const rows = ordered(L.entries);
  const closingPayable = L.totalCert - L.totalPaid;
  const kind = [L.stakeholder.category, L.stakeholder.type].filter(Boolean).join(' · ') || (L.kind === 'vendor' ? 'Vendor' : 'Worker');

  const aoa: (string | number)[][] = [
    ['Statement of Account'],
    ['Party', L.stakeholder.name],
    ['Type', kind],
    ['Account ID', L.stakeholder.id],
    ['As on', new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })],
    [],
    ['Total billed', Math.round(L.totalCert)],
    ['Total paid', Math.round(L.totalPaid)],
    [closingPayable > 0.5 ? 'Amount payable' : closingPayable < -0.5 ? 'Advance with party' : 'Balance', Math.abs(Math.round(closingPayable))],
    [],
    ['Date', 'Particulars', 'Vch Type', 'Vch No', 'Debit (Paid)', 'Credit (Billed)', 'Balance'],
  ];

  let run = 0, sumPaid = 0, sumBilled = 0;
  for (const e of rows) {
    run += (e.cert || 0) - (e.paid || 0);
    sumPaid += e.paid || 0; sumBilled += e.cert || 0;
    aoa.push([fmtDate(e.date), particularsOf(e), vchType(e), vchNo(e), money(e.paid || 0), money(e.cert || 0), balStr(run)]);
  }
  aoa.push(['', 'Closing balance', '', '', Math.round(sumPaid), Math.round(sumBilled), balStr(run)]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 14 }, { wch: 34 }, { wch: 13 }, { wch: 22 }, { wch: 14 }, { wch: 15 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Statement');

  const safe = L.stakeholder.name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'party';
  const d = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Statement-${safe}-${d}.xlsx`);
}
