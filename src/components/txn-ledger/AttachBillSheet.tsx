/**
 * AttachBillSheet — the SINGLE vendor action on a payment row (replaces the old
 * "Link to a bill" + "Direct purchase" pair). One flow:
 *   1. Attach the vendor's bill photo → AI reads the total (and lines).
 *   2. Split the bill AND this payment across sites — each site gets its own bill
 *      amount and its own paid amount, so its balance is exactly bill − paid.
 *   3. Each new site becomes a DELIVERED purchase order: paid-in-full → PAID, under-
 *      paid → PARTIAL with the balance owed (visible in the PO list). If the vendor
 *      already has open bills, they can be paid down here too.
 *
 * MONEY + received marker only — no GRN/stock lines beyond the bill line.
 */
import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Plus, Camera, Loader2, Check } from 'lucide-react';
import { V, font } from './ledgerTokens';
import { useOrgId } from '../../lib/auth/AuthProvider';
import { supabase } from '../../lib/supabase';
import type { TrackTxn } from '../../lib/trackingApi';
import {
  getVendorHub, readVendorBill, createDeliveredBillPO, commitBillSplit,
  type VendorBill, type BillRead,
} from '../../lib/vendorTrackingApi';

const num = (n: unknown) => Number(n) || 0;
const inr = (n: number) => '₹' + Math.round(num(n)).toLocaleString('en-IN');
const uid = () => Math.random().toString(36).slice(2, 8);
const COLORS = ['#C4592F', '#4C6B47', '#6366F1', '#0EA5E9', '#C79A2E'];

interface Row { id: string; mode: 'new' | 'existing'; projectId: string; poId?: string; label?: string; bill: number | ''; paid: number | ''; }

async function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export function AttachBillSheet({ txn, onClose, onLinked }: { txn: TrackTxn; onClose: () => void; onLinked: () => void }) {
  const orgId = useOrgId();
  const qc = useQueryClient();
  const payment = num(txn.total_amount);
  const vendor = txn.stakeholders?.name || 'this vendor';
  const seedProject = txn.txn_allocations?.[0]?.project_id || '';

  const { data: hub } = useQuery({ queryKey: ['vendorHub', txn.txn_id], queryFn: () => getVendorHub(txn) });
  const { data: projects } = useQuery({
    queryKey: ['projects_active_attach'],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('project_id, name').eq('status', 'Active').order('name');
      return (data ?? []) as { project_id: string; name: string }[];
    },
  });

  const [rows, setRows] = useState<Row[]>([{ id: 'r1', mode: 'new', projectId: seedProject, bill: '', paid: payment }]);
  const [reading, setReading] = useState(false);
  const [bill, setBill] = useState<BillRead | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const up = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const rm = (id: string) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));
  const addNew = () => setRows((rs) => [...rs, { id: uid(), mode: 'new', projectId: '', bill: '', paid: '' }]);
  const addExisting = (b: VendorBill) => setRows((rs) => rs.some((r) => r.poId === b.id) ? rs : [...rs, { id: uid(), mode: 'existing', projectId: b.project_id || '', poId: b.id, label: b.name, bill: b.due, paid: '' }]);

  const paidSum = rows.reduce((s, r) => s + num(r.paid), 0);
  const paidRemaining = Math.round((payment - paidSum) * 100) / 100;
  const rowsValid = rows.every((r) => r.projectId && (r.mode === 'existing' ? !!r.poId : num(r.bill) > 0) && num(r.paid) >= 0 && num(r.paid) <= num(r.bill) + 0.5);
  const valid = rows.length >= 1 && rowsValid && Math.abs(paidRemaining) < 0.5 && payment > 0;

  const openBills = (hub?.bills ?? []).filter((b) => !rows.some((r) => r.poId === b.id));

  const putRestOnLast = () => setRows((rs) => { if (!rs.length) return rs; const last = rs[rs.length - 1]; return rs.map((r) => (r.id === last.id ? { ...r, paid: num(r.paid) + paidRemaining } : r)); });

  async function onFile(f: File | null) {
    if (!f) return;
    setReading(true); setErr(null);
    try {
      const b64 = await fileToBase64(f);
      const r = await readVendorBill(b64, f.type || 'image/jpeg');
      setBill(r);
      // Seed the first new row's bill amount if it's empty (single-site is the common case).
      setRows((rs) => {
        const firstNew = rs.find((x) => x.mode === 'new' && !num(x.bill));
        return firstNew && r.total > 0 ? rs.map((x) => (x.id === firstNew.id ? { ...x, bill: r.total } : x)) : rs;
      });
    } catch (e: any) {
      setErr(e?.message || 'Could not read the bill — enter the amounts by hand.');
    } finally { setReading(false); }
  }

  async function confirm() {
    if (!valid || saving) return;
    setSaving(true); setErr(null);
    try {
      const parts: Array<{ projectId: string; poId: string; amount: number }> = [];
      for (const r of rows) {
        let poId = r.poId;
        if (r.mode === 'new') {
          const res = await createDeliveredBillPO(txn, orgId ?? '', {
            projectId: r.projectId,
            name: bill?.billNo ? `Bill ${bill.billNo} — ${vendor}` : `Bill — ${vendor}`,
            billAmount: num(r.bill), paidAmount: num(r.paid), gst: 0,
          });
          poId = res.poId;
        }
        if (poId && num(r.paid) > 0) parts.push({ projectId: r.projectId, poId, amount: num(r.paid) });
      }
      await commitBillSplit(txn, orgId ?? '', parts);
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      qc.invalidateQueries({ queryKey: ['vendorHub', txn.txn_id] });
      qc.invalidateQueries({ queryKey: ['po_list_sheet'] });
      onLinked();
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'Could not record the bill.');
      setSaving(false);
    }
  }

  const multi = rows.length > 1;

  return (
    <div style={{ ...font }}>
      {/* header */}
      <div className="flex items-start justify-between px-4 pt-4 pb-3" style={{ borderBottom: `1px solid ${V.line}` }}>
        <div>
          <p className="text-[15px] font-semibold" style={{ color: V.ink }}>Attach bill</p>
          <p className="text-[12px] mt-0.5" style={{ color: V.sys }}>Paying {vendor} · <span style={{ color: V.ink, fontWeight: 600 }}>{inr(payment)}</span></p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: V.faint }} aria-label="Close"><X size={16} /></button>
      </div>

      <div className="px-4 py-3.5 space-y-3.5">
        {/* attach photo */}
        <div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={reading}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
            style={{ background: bill ? V.field : V.askWash, border: `1px solid ${bill ? V.line : V.askLine}`, color: bill ? V.ink : V.terraDeep }}
          >
            {reading ? <Loader2 size={15} className="animate-spin" /> : bill ? <Check size={15} style={{ color: V.sage }} /> : <Camera size={15} />}
            {reading ? 'Reading the bill…' : bill ? `Bill read${bill.total ? ` · ${inr(bill.total)}` : ''}${bill.vendor ? ` · ${bill.vendor}` : ''}` : 'Attach bill photo — AI reads the amount'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0] || null)} />
          {bill && bill.lines.length > 1 && (
            <p className="text-[11px] mt-1.5" style={{ color: V.faint }}>{bill.lines.length} lines read. Split the amount across sites below.</p>
          )}
        </div>

        {/* paid split balance bar */}
        {payment > 0 && (
          <div className="rounded-xl p-3" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
            <div className="flex h-2 w-full rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.06)' }}>
              {rows.map((r, i) => { const pct = payment > 0 ? (num(r.paid) / payment) * 100 : 0; return pct > 0 ? <div key={r.id} style={{ width: `${Math.min(100, pct)}%`, background: COLORS[i % COLORS.length], transition: 'width .3s' }} /> : null; })}
              {paidRemaining > 0.5 && <div style={{ width: `${(paidRemaining / payment) * 100}%`, background: 'rgba(0,0,0,0.08)' }} />}
            </div>
            <div className="flex items-center justify-between mt-2 text-[11px] font-semibold">
              <span style={{ color: V.faint }}>Payment {inr(payment)}</span>
              <span style={{ color: paidRemaining < -0.5 ? V.terra : Math.abs(paidRemaining) < 0.5 ? V.sage : V.terraDeep }}>
                {paidRemaining < -0.5 ? `${inr(-paidRemaining)} over` : Math.abs(paidRemaining) < 0.5 ? 'All allocated' : `${inr(paidRemaining)} left`}
              </span>
            </div>
          </div>
        )}

        {/* rows */}
        <div className="space-y-2.5">
          {rows.map((r, i) => {
            const balance = num(r.bill) - num(r.paid);
            return (
              <div key={r.id} className="rounded-xl p-3" style={{ background: V.field, border: `1px solid ${V.line}` }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                  {r.mode === 'existing' ? (
                    <span className="flex-1 min-w-0 text-[13px] font-medium truncate" style={{ color: V.ink }}>{r.label || r.poId} <span style={{ color: V.faint }}>· open bill</span></span>
                  ) : (
                    <select
                      value={r.projectId}
                      onChange={(e) => up(r.id, { projectId: e.target.value })}
                      className="flex-1 min-w-0 text-[13px] px-2 py-1.5 rounded-lg outline-none appearance-none"
                      style={{ background: V.surface, border: `1px solid ${r.projectId ? V.line : V.askLine}`, color: V.ink }}
                    >
                      <option value="">Which site…</option>
                      {(projects ?? []).map((p) => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
                    </select>
                  )}
                  {multi && <button onClick={() => rm(r.id)} className="p-1 rounded-md shrink-0" style={{ color: V.faint }} aria-label="Remove"><X size={14} /></button>}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: V.faint }}>Bill amount</span>
                    <div className="flex items-center mt-0.5 px-2 rounded-lg" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
                      <span className="text-[12px]" style={{ color: V.faint }}>₹</span>
                      <input inputMode="numeric" disabled={r.mode === 'existing'}
                        value={r.bill === '' ? '' : String(r.bill)}
                        onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ''); up(r.id, { bill: v === '' ? '' : Number(v) }); }}
                        className="w-full text-[13px] py-1.5 pl-1 bg-transparent outline-none text-right" style={{ color: V.ink }} placeholder="0" />
                    </div>
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: V.faint }}>Paid now</span>
                    <div className="flex items-center mt-0.5 px-2 rounded-lg" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
                      <span className="text-[12px]" style={{ color: V.faint }}>₹</span>
                      <input inputMode="numeric"
                        value={r.paid === '' ? '' : String(r.paid)}
                        onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ''); up(r.id, { paid: v === '' ? '' : Number(v) }); }}
                        className="w-full text-[13px] py-1.5 pl-1 bg-transparent outline-none text-right" style={{ color: V.ink }} placeholder="0" />
                    </div>
                  </label>
                </div>

                <div className="mt-1.5 text-[11px] text-right">
                  {num(r.bill) > 0 && (
                    balance > 0.5
                      ? <span style={{ color: V.terraDeep }}>Balance {inr(balance)} — becomes a partly-paid PO</span>
                      : Math.abs(balance) < 0.5
                        ? <span style={{ color: V.sage }}>Fully paid</span>
                        : <span style={{ color: V.terra }}>{inr(-balance)} over the bill</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* add controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={addNew} className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: V.terraDeep }}>
            <Plus size={14} /> Add a site
          </button>
          {paidRemaining > 0.5 && rows.length >= 1 && (
            <button type="button" onClick={putRestOnLast} className="text-[12px] font-medium" style={{ color: V.sys }}>put {inr(paidRemaining)} on the last</button>
          )}
        </div>

        {/* existing open bills to pay down */}
        {openBills.length > 0 && (
          <div className="rounded-xl p-3" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
            <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: V.faint }}>{vendor}'s open bills</p>
            <div className="space-y-1.5">
              {openBills.map((b) => (
                <button key={b.id} type="button" onClick={() => addExisting(b)} className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left transition-colors" style={{ background: V.field, border: `1px solid ${V.line}` }}>
                  <span className="min-w-0 truncate text-[12.5px]" style={{ color: V.ink }}>{b.name}</span>
                  <span className="shrink-0 text-[12px] font-semibold" style={{ color: V.terraDeep }}>{inr(b.due)} due</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {err && <p className="text-[12px]" style={{ color: V.terra }}>{err}</p>}
      </div>

      {/* footer */}
      <div className="px-4 py-3 flex items-center justify-between gap-3" style={{ borderTop: `1px solid ${V.line}` }}>
        <button onClick={onClose} className="text-[13px] font-medium" style={{ color: V.sys }}>Cancel</button>
        <button
          onClick={confirm}
          disabled={!valid || saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-all disabled:cursor-not-allowed"
          style={{ background: valid && !saving ? V.terra : V.line, color: valid && !saving ? '#fff' : V.faint }}
        >
          {saving ? <><Loader2 size={14} className="animate-spin" /> Recording…</> : <>Record bill &amp; payment</>}
        </button>
      </div>
    </div>
  );
}
