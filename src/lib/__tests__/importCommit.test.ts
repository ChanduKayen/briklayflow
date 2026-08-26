// importCommit — buildImportRows turns resolved rows into the import_transactions payload: positive
// amount, deterministic txn_id, cost code null, and the income marker that makes deriveDirection read
// money-IN without touching invoices.

import { suite, test, expect } from './harness';
import { buildImportRows, type ResolvedCommitRow } from '../importCommit';
import { deriveDirection } from '../transactions';

const CTX = { orgId: 'org-1', batchId: 'B7' };
const base: ResolvedCommitRow = {
  rowNo: 2, date: '2026-08-06', amount: 8400, mode: 'Cash', note: 'wages',
  stakeholderId: 'S1', partyType: 'Worker', projectId: 'P1',
};

suite('importCommit — build the RPC payload', () => {
  test('an expense row: positive amount, deterministic id, null cost code, out-direction', () => {
    const [p] = buildImportRows([base], CTX);
    expect(p.txn_id).toBe('IMP-B7-2');
    expect(p.total_amount).toBe(8400);
    expect(p.category).toBe(null);
    expect(p.project_id).toBe('P1');
    expect(p.payment_mode).toBe('Cash');
    // reads as money-OUT (no client_receipt marker, worker party)
    expect(deriveDirection({ ai_flag_data: p.ai_flag_data, category: p.category })).toBe('out');
  });

  test('a negative amount is income: stored positive + client_receipt marker → reads as IN', () => {
    const [p] = buildImportRows([{ ...base, amount: -500000, partyType: 'Client' }], CTX);
    expect(p.total_amount).toBe(500000);
    expect(p.ai_flag_data.type).toBe('client_receipt');
    expect(deriveDirection({ ai_flag_data: p.ai_flag_data })).toBe('in');
  });

  test('a Client party (positive amount) also reads as income', () => {
    const [p] = buildImportRows([{ ...base, partyType: 'Client', amount: 200000 }], CTX);
    expect(deriveDirection({ ai_flag_data: p.ai_flag_data })).toBe('in');
  });

  test('an income note keyword flips a non-client row to IN', () => {
    const [p] = buildImportRows([{ ...base, partyType: 'Vendor', note: 'refund received' }], CTX);
    expect(p.ai_flag_data.type).toBe('client_receipt');
  });

  test('a no-site row carries a null project (a no-allocation expense)', () => {
    const [p] = buildImportRows([{ ...base, projectId: null }], CTX);
    expect(p.project_id).toBe(null);
  });

  test('a blank mode stays null (not defaulted)', () => {
    const [p] = buildImportRows([{ ...base, mode: null }], CTX);
    expect(p.payment_mode).toBe(null);
  });
});
