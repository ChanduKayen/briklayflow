// Bill intake — ONE pipeline behind every door that records a vendor bill.
//
//   upload → extract → resolve vendor → dedupe → mint bill (+ credit is emergent) → propose links
//
// The five doors (Bills page, PO record-bill, the two tx pickers, WhatsApp) are thin wrappers that
// differ only in what CONTEXT they pre-fill: a door that already knows the vendor/PO/payment asks
// nothing; a door that knows nothing resolves the vendor and confirms. Built as one service so the
// flows can't drift into five behaviours and five bug surfaces.
//
// DEDUPE LIVES HERE, not in any door — the same paper genuinely arrives twice through different doors
// (site engineer WhatsApps the photo Tuesday; you attach the same bill to the PO Friday). The
// fingerprint is vendor + bill-number; on a collision the pipeline returns the existing bill so the
// door can offer "link it here instead" — turning the duplicate into a free reconciliation.
import { supabase } from './supabase';
import { searchPayees } from './payeeSearch';
import { extractBill, findDuplicateBill, createBill, type ExtractedBill, type DuplicateBill } from './billsApi';

export type IntakeSource = 'bills_page' | 'tx_picker' | 'po' | 'whatsapp';

export interface IntakeContext {
  orgId: string;
  source: IntakeSource;
  file: File | null;                 // the document (present for a real intake; null = manual figures)
  vendorId?: string | null;          // pre-known vendor (tx / po doors) → skip resolve
  projectId?: string | null;         // pre-known site
  poId?: string | null;              // pre-known PO (po door)
  createdBy?: string | null; createdByName?: string | null;
}

export type IntakeResult =
  | { status: 'minted'; billId: string; extracted: ExtractedBill }
  | { status: 'duplicate'; existing: DuplicateBill; extracted: ExtractedBill }   // link, don't mint
  | { status: 'needs_vendor'; extracted: ExtractedBill };                         // couldn't resolve — door confirms

// ── steps (a door may call them individually to interleave its own confirmation UI) ──

// 1. Read the document.
export function intakeExtract(file: File): Promise<ExtractedBill> { return extractBill(file); }

// 2. Resolve the vendor. A pre-known id wins; else fuzzy-match the read name against the org's vendors.
export async function intakeResolveVendor(extracted: ExtractedBill, prefVendorId?: string | null): Promise<{ vendorId: string | null; name: string | null }> {
  if (prefVendorId) return { vendorId: prefVendorId, name: null };
  if (!extracted.vendor) return { vendorId: null, name: null };
  const { data } = await supabase.from('stakeholders').select('stakeholder_id, name').eq('type', 'Vendor');
  const hit = searchPayees((data ?? []) as any, extracted.vendor)[0] as any;
  return hit ? { vendorId: hit.stakeholder_id, name: hit.name } : { vendorId: null, name: extracted.vendor };
}

// 3 + 4. Dedupe (fingerprint = vendor + bill no), then mint. Dedupe is HERE, never in a door. Pass
//        allowDuplicate to proceed past a known collision (the user chose "add it anyway").
export type CommitResult =
  | { status: 'minted'; billId: string; extracted: ExtractedBill }
  | { status: 'duplicate'; existing: DuplicateBill; extracted: ExtractedBill };
export async function intakeCommit(ctx: IntakeContext, extracted: ExtractedBill, vendorId: string, opts?: { allowDuplicate?: boolean }): Promise<CommitResult> {
  // Dedupe on the full fingerprint (number OR amount+date), so a bill with no readable number is
  // still caught by the amount/date fallback — not only when a number was extracted.
  if (!opts?.allowDuplicate) {
    // Fingerprint the document org-wide (number OR header-name+amount+date OR amount+date), so the same
    // paper is caught even when this door and another linked it to different vendor rows.
    const dup = await findDuplicateBill({ orgId: ctx.orgId, billNo: extracted.billNo, amount: extracted.amount, billDate: extracted.billDate, vendorName: extracted.vendor });
    if (dup) return { status: 'duplicate', existing: dup, extracted };
  }
  const billId = await createBill({
    orgId: ctx.orgId, stakeholderId: vendorId, projectId: ctx.projectId ?? null, poId: ctx.poId ?? null,
    billNo: extracted.billNo, billDate: extracted.billDate, amount: extracted.amount, vendorName: extracted.vendor, lines: extracted.lines,
    createdBy: ctx.createdBy ?? null, createdByName: ctx.createdByName ?? null, file: ctx.file,
  });
  return { status: 'minted', billId, extracted };
}

// The whole pipeline in one call — for a door that has everything it needs (a known vendor). Returns
// 'needs_vendor' if it can't resolve one, so the door can confirm before committing.
export async function runIntake(ctx: IntakeContext, opts?: { allowDuplicate?: boolean }): Promise<IntakeResult> {
  if (!ctx.file) throw new Error('No document to read');
  const extracted = await intakeExtract(ctx.file);
  const { vendorId } = await intakeResolveVendor(extracted, ctx.vendorId);
  if (!vendorId) return { status: 'needs_vendor', extracted };
  return intakeCommit(ctx, extracted, vendorId, opts);
}
