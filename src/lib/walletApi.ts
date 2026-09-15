// Site-Cash Wallet — client API (see docs/site-cash-wallet-spec.md).
//
// A wallet is a supervisor's cash-in-hand: an ASSET, not an expense. Balances are DERIVED
// (v_wallet_balance); the cash book is v_wallet_ledger_line. Money moves in three shapes:
//   • float  — bank → wallet   (wallet_dir 'in',  is_transfer true,  no cost)
//   • spend  — wallet → cost   (wallet_dir 'out', is_transfer false, has site + head)  ← via the normal txn path
//   • return — wallet → bank   (wallet_dir 'out', is_transfer true,  no cost)
//
// This module owns wallet admin + float/return. A wallet SPEND is an ordinary payment that simply
// carries wallet_id/wallet_dir='out' on the existing insert path, so it flows through every existing
// classification/ledger rule unchanged.
import { supabase } from './supabase';

const num = (v: unknown) => Number(v) || 0;

export interface Wallet {
  walletId: string; orgId: string; holderUserId: string | null;
  holderName: string; holderPhone: string | null; active: boolean; note: string | null;
}
export interface WalletBalance extends Pick<Wallet, 'walletId' | 'holderName' | 'holderUserId' | 'active'> {
  balance: number; totalIn: number; totalOut: number; lastActivity: string | null;
}
export interface WalletLedgerLine {
  txnId: string; date: string | null; kind: 'float' | 'spend' | 'return';
  category: string | null; remarks: string | null; stakeholderId: string | null;
  projectId: string | null; debit: number; credit: number;
}

/** Every LIVE wallet in the org with its DERIVED balance (v_wallet_balance). Revoked (inactive)
 *  wallets are hidden here — the rail, spend matching and top-up matching all read this — while their
 *  cash-book history stays intact under v_wallet_ledger_line, keyed by wallet_id. */
export async function loadWallets(orgId: string): Promise<WalletBalance[]> {
  const { data, error } = await supabase
    .from('v_wallet_balance')
    .select('wallet_id, holder_name, holder_user_id, active, balance, total_in, total_out, last_activity')
    .eq('org_id', orgId)
    .eq('active', true)
    .order('holder_name');
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    walletId: r.wallet_id, holderName: r.holder_name, holderUserId: r.holder_user_id, active: r.active,
    balance: num(r.balance), totalIn: num(r.total_in), totalOut: num(r.total_out), lastActivity: r.last_activity ?? null,
  }));
}

/** The current user's own wallet balance row, or null if they don't hold one. */
export async function loadMyWallet(orgId: string, userId: string): Promise<WalletBalance | null> {
  const { data, error } = await supabase
    .from('v_wallet_balance')
    .select('wallet_id, holder_name, holder_user_id, active, balance, total_in, total_out, last_activity')
    .eq('org_id', orgId).eq('holder_user_id', userId).eq('active', true).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    walletId: (data as any).wallet_id, holderName: (data as any).holder_name, holderUserId: (data as any).holder_user_id,
    active: (data as any).active, balance: num((data as any).balance), totalIn: num((data as any).total_in),
    totalOut: num((data as any).total_out), lastActivity: (data as any).last_activity ?? null,
  };
}

/** Resolve a WhatsApp sender's phone → their wallet (for the capture default). */
export async function walletByPhone(orgId: string, phone: string): Promise<Wallet | null> {
  const { data, error } = await supabase
    .from('wallets').select('*').eq('org_id', orgId).eq('holder_phone', phone).eq('active', true).maybeSingle();
  if (error) throw error;
  return data ? rowToWallet(data) : null;
}

/** The wallet of the member who sent a WhatsApp capture: sender phone → wa_registered_numbers.user_id →
 *  their wallet. Falls back to a direct holder_phone match. Returns null if the sender holds no wallet. */
export async function walletForSender(orgId: string, senderNumber: string | null | undefined): Promise<WalletBalance | null> {
  if (!senderNumber) return null;
  const digits = String(senderNumber).replace(/\D/g, '');
  const last10 = digits.slice(-10);
  try {
    const { data: regs } = await supabase
      .from('wa_registered_numbers').select('user_id, phone_number').eq('org_id', orgId);
    const reg = (regs ?? []).find((r: any) => String(r.phone_number || '').replace(/\D/g, '').endsWith(last10) && r.user_id);
    if (reg?.user_id) { const w = await loadMyWallet(orgId, reg.user_id); if (w) return w; }
  } catch { /* wa_registered_numbers absent → fall through */ }
  // Fallback: a wallet whose holder_phone matches.
  const byPhone = await walletByPhone(orgId, senderNumber).catch(() => null);
  if (byPhone) { const all = await loadWallets(orgId); return all.find(w => w.walletId === byPhone.walletId) ?? null; }
  return null;
}

export async function createWallet(input: { orgId: string; holderUserId?: string | null; holderName: string; holderPhone?: string | null; note?: string | null }): Promise<Wallet> {
  const { data, error } = await supabase.from('wallets').insert({
    org_id: input.orgId, holder_user_id: input.holderUserId ?? null,
    holder_name: input.holderName, holder_phone: input.holderPhone ?? null, note: input.note ?? null,
  }).select().single();
  if (error) throw error;
  return rowToWallet(data);
}

/** Open a wallet for a member, reusing (and reactivating) an existing one if present. A member can
 *  hold only one wallet per org (unique index on org_id+holder_user_id), so a fresh createWallet would
 *  fail for someone whose wallet was previously revoked — reactivate that row instead. */
export async function ensureWallet(input: { orgId: string; holderUserId?: string | null; holderName: string; holderPhone?: string | null; note?: string | null }): Promise<Wallet> {
  if (input.holderUserId) {
    const { data } = await supabase
      .from('wallets').select('*').eq('org_id', input.orgId).eq('holder_user_id', input.holderUserId).maybeSingle();
    if (data) {
      if (!data.active) await setWalletActive(data.wallet_id, true);
      return rowToWallet({ ...data, active: true });
    }
  }
  return createWallet(input);
}

export async function setWalletActive(walletId: string, active: boolean): Promise<void> {
  const { error } = await supabase.from('wallets').update({ active }).eq('wallet_id', walletId);
  if (error) throw error;
}

/** Remove a wallet. Hard-delete only when it has NO transactions (a clean, never-used wallet);
 *  otherwise DEACTIVATE (active=false) to keep its cash-book history intact — deleting would orphan
 *  its float/spend rows (wallet_id is ON DELETE SET NULL). Returns what it did. */
export async function removeWallet(walletId: string): Promise<'deleted' | 'deactivated'> {
  const { count, error: cErr } = await supabase
    .from('transactions').select('txn_id', { count: 'exact', head: true }).eq('wallet_id', walletId);
  if (cErr) throw cErr;
  if ((count ?? 0) > 0) { await setWalletActive(walletId, false); return 'deactivated'; }
  const { error } = await supabase.from('wallets').delete().eq('wallet_id', walletId);
  if (error) throw error;
  return 'deleted';
}

/** Resolve a wallet holder's WhatsApp number: the wallet's own holder_phone, else their registered
 *  WhatsApp number (wa_registered_numbers). Returns the canonical international string, or null. */
async function resolveHolderPhone(orgId: string, wallet: { holderUserId?: string | null; holderPhone?: string | null }): Promise<string | null> {
  if (wallet.holderPhone) return wallet.holderPhone;
  if (wallet.holderUserId) {
    const { data } = await supabase
      .from('wa_registered_numbers').select('phone_number')
      .eq('org_id', orgId).eq('user_id', wallet.holderUserId).eq('is_active', true).maybeSingle();
    if (data?.phone_number) return data.phone_number as string;
  }
  return null;
}

/** Tell the holder over WhatsApp that their site-cash wallet was funded (the `wallet_recharge` template).
 *  Fire-and-forget: never blocks or fails the give — a missing number or an unapproved template just
 *  means no message goes out. Values carry no ₹ and no commas-in-a-way-Meta-rejects (plain grouped ok). */
export async function notifyWalletRecharge(input: {
  orgId: string; wallet: { walletId: string; holderName: string; holderUserId?: string | null; holderPhone?: string | null };
  amount: number; newBalance: number;
}): Promise<{ sent: boolean; reason?: string }> {
  try {
    const to = await resolveHolderPhone(input.orgId, input.wallet);
    if (!to) return { sent: false, reason: 'no phone' };
    const grp = (n: number) => Math.round(Math.abs(n)).toLocaleString('en-IN');
    const { error } = await supabase.functions.invoke('send-template', {
      body: {
        templateKey: 'wallet_recharge', to,
        params: { name: input.wallet.holderName.split(' ')[0] || input.wallet.holderName, amount: grp(input.amount), balance: grp(input.newBalance) },
      },
    });
    if (error) throw error;
    return { sent: true };
  } catch (e) { console.warn('[wallet] recharge notify failed', e); return { sent: false, reason: String((e as any)?.message ?? e) }; }
}

export interface AssignableMember { userId: string; name: string; role: string }
/** Active org members who could hold a wallet (name from user_profiles, two-step to dodge the
 *  org_id-ambiguous embed — same pattern as Day Book's team loader). */
export async function loadAssignableMembers(orgId: string): Promise<AssignableMember[]> {
  const { data: rows, error } = await supabase
    .from('org_memberships').select('user_id, role, status').eq('org_id', orgId).eq('status', 'active');
  if (error) throw error;
  const ids = (rows ?? []).map((r: any) => r.user_id).filter(Boolean);
  if (!ids.length) return [];
  const { data: profiles } = await supabase.from('user_profiles').select('id, name').in('id', ids);
  const nameById = new Map((profiles ?? []).map((p: any) => [p.id, p.name as string]));
  return (rows ?? []).map((r: any) => ({ userId: r.user_id, name: nameById.get(r.user_id) ?? 'Unnamed', role: r.role }));
}

export interface WalletMoveInput { orgId: string; walletId: string; amount: number; date: string; mode: 'NEFT' | 'UPI' | 'Cheque' | 'Cash'; note?: string | null }

/** Issue a float: bank → wallet. A transfer (no cost, no vendor), it only raises the wallet balance. */
export async function issueFloat(i: WalletMoveInput): Promise<string> {
  return walletTransfer(i, 'in', 'Site advance (float)');
}
/** Return cash: wallet → bank. A transfer out, lowers the wallet balance. */
export async function returnCash(i: WalletMoveInput): Promise<string> {
  return walletTransfer(i, 'out', 'Cash returned from wallet');
}

async function walletTransfer(i: WalletMoveInput, dir: 'in' | 'out', category: string): Promise<string> {
  if (!(i.amount > 0)) throw new Error('Enter an amount');
  const txnId = `WAL-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  const { error } = await supabase.rpc('insert_transaction_with_allocations', {
    p_txn: {
      txn_id: txnId, stakeholder_id: null, date: i.date, total_amount: i.amount,
      payment_mode: i.mode, category, remarks: i.note ?? null,
      ai_flag_status: 'Clean', ai_flag_data: { wallet_transfer: true }, org_id: i.orgId,
      wallet_id: i.walletId, wallet_dir: dir, is_transfer: true,
    },
    p_allocations: [],   // a transfer has no project/cost allocation
  });
  if (error) throw error;
  return txnId;
}

/** Reconcile a wallet to a physical cash count: books a marked adjustment that trues the derived book
 *  balance up/down to the counted amount. A shortage (count < book) is a wallet-out adjustment; an overage
 *  is a wallet-in one. Both are transfers (is_transfer) — they true the balance, never a project cost;
 *  whether a shortage is recoverable or a loss is decided separately. Returns the difference booked. */
export async function reconcileWallet(i: { orgId: string; walletId: string; counted: number; bookBalance: number; date: string; note?: string | null }): Promise<{ diff: number }> {
  const diff = Math.round(i.counted - i.bookBalance);
  if (Math.abs(diff) < 1) return { diff: 0 };
  const txnId = `WAL-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  const { error } = await supabase.rpc('insert_transaction_with_allocations', {
    p_txn: {
      txn_id: txnId, stakeholder_id: null, date: i.date, total_amount: Math.abs(diff),
      payment_mode: 'Cash', category: diff < 0 ? 'Wallet shortage (reconciled)' : 'Wallet overage (reconciled)',
      remarks: i.note ?? `Reconciled to counted cash ₹${Math.round(i.counted).toLocaleString('en-IN')}`,
      ai_flag_status: 'Clean', ai_flag_data: { wallet_reconcile: true }, org_id: i.orgId,
      wallet_id: i.walletId, wallet_dir: diff < 0 ? 'out' : 'in', is_transfer: true,
    },
    p_allocations: [],
  });
  if (error) throw error;
  return { diff };
}

/** The cash book for one wallet — floats in, spends + returns out (v_wallet_ledger_line). */
export async function loadWalletLedger(walletId: string): Promise<WalletLedgerLine[]> {
  const { data, error } = await supabase
    .from('v_wallet_ledger_line')
    .select('txn_id, line_date, kind, category, remarks, stakeholder_id, project_id, debit, credit')
    .eq('wallet_id', walletId)
    .order('line_date', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    txnId: r.txn_id, date: r.line_date, kind: r.kind, category: r.category, remarks: r.remarks,
    stakeholderId: r.stakeholder_id, projectId: r.project_id, debit: num(r.debit), credit: num(r.credit),
  }));
}

function rowToWallet(r: any): Wallet {
  return { walletId: r.wallet_id, orgId: r.org_id, holderUserId: r.holder_user_id, holderName: r.holder_name, holderPhone: r.holder_phone, active: r.active, note: r.note };
}
