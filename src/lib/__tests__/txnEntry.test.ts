// WHAT A LEDGER ROW LOOKS LIKE ON THE PHONE.
//
// The Transactions page draws two lines per entry, and almost every decision on those lines comes
// from shaping one raw row: whether it gets initials or the dashed ring, whether the amount is ink,
// sage or grey, whether it carries a wallet tag, and whether the note or the WhatsApp message it was
// captured from shows. Get the shaping wrong and the page lies quietly. These are its terms.

import { suite, test, expect } from './harness'
import { toEntry, splitNotes } from '../../components/txn-ledger/toEntry'

const base = {
  txn_id: 'TXN-1', date: '2026-09-18', total_amount: 450, remarks: 'Cement', status: null,
  stakeholder_id: 'STK-1', stakeholders: { name: 'Sri Durga Cements', type: 'Vendor' },
  category: 'MAT-01', payment_mode: 'NEFT', bill_doc_url: null, proof_document_url: null,
  wallet_id: null, wallet_dir: null, is_transfer: false, wallets: null,
  txn_allocations: [{ project_id: 'P1', allocated_amount: 450, order_type: null, order_ref: null, bill_id: null, projects: { name: 'ASM Elite Apartments' } }],
};
const e = (over: Record<string, unknown> = {}) => toEntry({ ...base, ...over });

suite('a ledger row, shaped for the phone', () => {
  test('where the money came from is the one thing the row marks', () => {
    expect(e().src).toBe('direct');                                                    // paid straight from you: nothing to mark
    expect(e({ wallet_dir: 'out', wallets: { holder_name: 'Raju' } }).src).toBe('wallet');
    expect(e({ wallet_dir: 'in', is_transfer: true, wallets: { holder_name: 'Raju' } }).src).toBe('topup');
    // a return (wallet → bank) is a transfer too: moved, not spent
    expect(e({ wallet_dir: 'out', is_transfer: true, wallets: { holder_name: 'Raju' } }).src).toBe('topup');
  });

  test('a wallet spend carries the holder it was spent from', () => {
    expect(e({ wallet_dir: 'out', wallets: { holder_name: 'Alluri' } }).wallet).toBe('Alluri');
    expect(e().wallet).toBe('');
  });

  test('a party gets its name; an overhead gets its head; a lost contact says so', () => {
    expect(e().name).toBe('Sri Durga Cements');
    expect(e({ stakeholder_id: null, stakeholders: null, category: 'GEN-01' }).name).toBe('Transport & logistics');
    expect(e({ stakeholder_id: null, stakeholders: null, category: 'MAT-01' }).name).toBe('(removed contact)');
  });

  test('the dashed ring is information: no party named', () => {
    expect(e().party).toBe(true);
    expect(e({ stakeholder_id: null, stakeholders: null, category: 'GEN-01' }).party).toBe(false);
  });

  test('a bill or a proof earns the clip', () => {
    expect(e().clip).toBe(false);
    expect(e({ bill_doc_url: 'x' }).clip).toBe(true);
    expect(e({ proof_document_url: 'x' }).clip).toBe(true);
  });

  test('linked means the money is against something — an order, or a recorded bill', () => {
    expect(e().linked).toBe(false);                                                    // a bare project allocation is not a link
    expect(e({ txn_allocations: [{ project_id: 'P1', order_type: 'PO', order_ref: 'PO-1', bill_id: null, projects: { name: 'X' } }] }).linked).toBe(true);
    expect(e({ txn_allocations: [{ project_id: 'P1', order_type: null, order_ref: null, bill_id: 'B-1', projects: { name: 'X' } }] }).linked).toBe(true);
    expect(e({ txn_allocations: [] }).linked).toBe(false);
  });

  test('a receipt is money in, and never counts as spending', () => {
    expect(e().dir).toBe('out');
    expect(e({ category: 'CLIENT-RECEIPT' }).dir).toBe('in');
    expect(e({ stakeholders: { name: 'A client', type: 'Client' } }).dir).toBe('in');
  });

  test('the day reads as a builder writes it', () => {
    const r = e({ date: '2026-09-18' });
    expect(r.day).toBe('18 Sept');
    expect(r.dow).toBe('Friday');
  });

  test('a split entry is remembered as split — one site cannot speak for it', () => {
    expect(e().allocs).toBe(1);
    expect(e({ txn_allocations: [{ project_id: 'P1', projects: { name: 'A' } }, { project_id: 'P2', projects: { name: 'B' } }] }).allocs).toBe(2);
  });

  test('the site is the first allocation it names, and nothing when it names none', () => {
    expect(e().site).toBe('ASM Elite Apartments');
    expect(e({ txn_allocations: [] }).site).toBe('');
  });

  test('a voided row is a closed record, and says so', () => {
    expect(e().voided).toBe(false);
    expect(e({ status: 'Voided' }).voided).toBe(true);
  });
});

suite('the note, and the message it came from', () => {
  test('a plain note is the note', () => {
    expect(splitNotes('Cement, 120 bags')).toEqual({ note: 'Cement, 120 bags', wa: '' });
  });

  test('the WhatsApp line travels separately, so the row is not filled with the transcript', () => {
    const r = splitNotes('Gate payment\nWhatsApp: “Gate payment 8500 Jagadish”');
    expect(r.note).toBe('Gate payment');
    expect(r.wa).toBe('Gate payment 8500 Jagadish');
  });

  test('a capture with nothing but the message still finds it', () => {
    expect(splitNotes('WhatsApp: “Paid 300 to kollu dirg for auto”')).toEqual({ note: '', wa: 'Paid 300 to kollu dirg for auto' });
  });

  test('straight quotes are the same message', () => {
    expect(splitNotes('WhatsApp: "Sand 2 loads"').wa).toBe('Sand 2 loads');
  });

  test('nothing written is nothing shown', () => {
    expect(splitNotes('')).toEqual({ note: '', wa: '' });
  });
});
