/**
 * One ledger row as the phone's Transactions page thinks of it — see LedgerMobile.
 * Kept beside it so the page file exports a component only, and so the shaping is testable.
 */
import { deriveDirection, isNotLinked, isWalletSpend, isWalletTransfer, payeeLabel } from '../../lib/transactions';
import { costCodeLabel } from '../../lib/costCodes';

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

/** One ledger row as this page thinks of it. */
export type Entry = {
  id: string; date: string; day: string; dow: string;
  name: string; site: string; siteId: string; note: string; wa: string;
  amt: number; dir: 'in' | 'out';
  src: 'direct' | 'wallet' | 'topup';
  /** for a wallet transfer (src 'topup'): 'in' = a float (Bank → wallet), 'out' = a return (Wallet → bank) */
  walletDir: 'in' | 'out' | '';
  party: boolean; clip: boolean; linked: boolean; wallet: string; walletId: string; via: string; cat: string;
  /** who + type, for attributing a payment to a payable */
  stakeholderId: string | null; payeeType: string | null;
  /** the paper this entry carries, as stored — signed only when it is looked at */
  bill: string; proof: string;
  voided: boolean; status: string | null; allocs: number;
};

/** A ledger row as the query returns it — the client is untyped, so this stays loose on purpose. */
export type LedgerRaw = Record<string, unknown>;
/** The WhatsApp line the Day Book writes into the notes travels with the entry; the rest is the note. */
export function splitNotes(remarks: string): { note: string; wa: string } {
  const m = remarks.match(/WhatsApp:\s*[“"]([^”"]*)[”"]/);
  const wa = m ? m[1] : '';
  const note = remarks.replace(/WhatsApp:\s*[“"][^”"]*[”"]/, '').split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? '';
  return { note, wa };
}

export function toEntry(t: LedgerRaw): Entry {
  const allocs = (t.txn_allocations as LedgerRaw[] | null) ?? [];
  const a0 = allocs[0] as { project_id?: string; projects?: { name?: string } } | undefined;
  const { note, wa } = splitNotes(String(t.remarks ?? ''));
  const d = new Date(String(t.date) + 'T00:00:00');
  return {
    id: String(t.txn_id), date: String(t.date),
    day: `${d.getDate()} ${MON[d.getMonth()]}`, dow: DOW[d.getDay()],
    name: payeeLabel(t), site: a0?.projects?.name ?? '', siteId: a0?.project_id ?? '', note, wa,
    amt: Number(t.total_amount) || 0, dir: deriveDirection(t),
    src: isWalletTransfer(t) ? 'topup' : isWalletSpend(t) ? 'wallet' : 'direct',
    walletDir: (t.wallet_dir === 'in' || t.wallet_dir === 'out') ? t.wallet_dir : '',
    party: !!t.stakeholder_id, clip: !!t.bill_doc_url || !!t.proof_document_url, linked: !isNotLinked(t),
    stakeholderId: t.stakeholder_id ? String(t.stakeholder_id) : null,
    payeeType: (t.stakeholders as { type?: string } | null)?.type ?? null,
    bill: String(t.bill_doc_url ?? ''), proof: String(t.proof_document_url ?? ''),
    wallet: (t.wallets as { holder_name?: string } | null)?.holder_name ?? '', walletId: String(t.wallet_id ?? ''),
    via: String(t.payment_mode ?? ''), cat: t.category ? (costCodeLabel(String(t.category)) || String(t.category)) : '',
    voided: t.status === 'Voided', status: (t.status as string | null) ?? null, allocs: allocs.length,
  };
}
