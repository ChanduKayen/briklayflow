/**
 * AttachBillSheet — one-stop bill attach. NO wizard. The chip opens the file picker; this mounts
 * with the picked file and drives a single stateful pill:  Reading bill…  →  Attaching bill…  →
 * Attached ✓  (then closes). The only decision point:
 *
 *   • The vendor has NO PO on this payment's project  →  auto-create a new PO for the purchase and
 *     attach the bill. Zero taps.
 *   • The vendor HAS PO(s) on this project  →  show them as tap-to-attach rows, plus a
 *     "No — create a new PO" row. One tap attaches (to that PO) or creates a new PO.
 *
 * New PO carries the bill: bill amount = the bill's total (split by each site's paid share), paid =
 * the payment — so if the bill runs ahead of what was paid, the PO shows the balance owed, no ask.
 * Attaching to an existing PO only pins the bill image (non-destructive). The bill also lands on the
 * transaction (bill_doc_url) so it shows in Transaction Detail. MONEY + bill image only.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Camera, Loader2, Check, Plus, FileText, ChevronRight } from 'lucide-react';
import { V, font } from './ledgerTokens';
import { useOrgId } from '../../lib/auth/AuthProvider';
import type { TrackTxn } from '../../lib/trackingApi';
import {
  getTxnAllocations, readVendorBill, uploadBillDoc, createDeliveredBillPO,
  commitBillSplit, getVendorPOs, linkBillToExistingPO, attachBillDocToTxn,
  type BillRead, type VendorPO,
} from '../../lib/vendorTrackingApi';

const num = (n: unknown) => Number(n) || 0;
const inr = (n: number) => '₹' + Math.round(num(n)).toLocaleString('en-IN');
const errMsg = (e: unknown) => (e instanceof Error ? e.message : '');

type Status = 'reading' | 'ready' | 'attaching' | 'done';

export function AttachBillSheet({
  txn, initialFile, mode = 'upload', onClose, onLinked,
}: { txn: TrackTxn; initialFile?: File | null; mode?: 'upload' | 'link'; onClose: () => void; onLinked: () => void }) {
  const linkOnly = mode === 'link'; // "Link to PO": no bill, just point this payment at an order
  const orgId = useOrgId();
  const qc = useQueryClient();
  const payment = num(txn.total_amount);
  const vendor = txn.stakeholders?.name || 'this vendor';
  const seedProject = txn.txn_allocations?.[0]?.project_id || '';

  // The payment's existing per-site split — the sites a new PO would be created on.
  const { data: sites } = useQuery({ queryKey: ['txnSites', txn.txn_id], queryFn: () => getTxnAllocations(txn) });
  // Sites to actually build POs on (fall back to the payment's seed project if the split is empty).
  const workSites = useMemo(() => {
    if (sites && sites.length) return sites;
    return seedProject ? [{ projectId: seedProject, name: 'Site', paid: payment }] : [];
  }, [sites, seedProject, payment]);
  const projectIds = useMemo(() => workSites.map((s) => s.projectId), [workSites]);

  // The vendor's POs on this project — the tap-to-attach list. Only runs once the split is known.
  const { data: vendorPOs } = useQuery({
    queryKey: ['vendorPOs', txn.txn_id, projectIds.join(',')],
    queryFn: () => getVendorPOs(txn, projectIds),
    enabled: sites !== undefined,
  });

  const [bill, setBill] = useState<BillRead | null>(null);
  const [status, setStatus] = useState<Status>('reading');
  const [pickedPO, setPickedPO] = useState<VendorPO | null>(null); // the order being attached (for the selected-row state)
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickedRef = useRef<File | null>(initialFile ?? null);
  const decidedRef = useRef(false);
  const runningRef = useRef(false);

  async function readFile(f: File) {
    pickedRef.current = f;
    decidedRef.current = false;
    setStatus('reading'); setErr(null); setBill(null);
    try {
      const b64 = await fileToBase64(f);
      const r = await readVendorBill(b64, f.type || 'image/jpeg');
      setBill(r);
    } catch (e) {
      setErr(errMsg(e) || 'Could not read the bill — try another photo.');
    }
  }

  // Read the file the chip already picked, once (upload mode only).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!linkOnly && initialFile) void readFile(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Decide once. Link mode: go straight to the PO list as soon as it loads. Upload mode: wait for the
  // bill read too — auto-create if there are no POs, otherwise show the list.
  useEffect(() => {
    if (decidedRef.current || vendorPOs === undefined) return;
    if (linkOnly) {
      decidedRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus('ready');
      return;
    }
    if (!bill) return;
    decidedRef.current = true;
    if ((vendorPOs?.length ?? 0) === 0) void run('new'); else setStatus('ready');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bill, vendorPOs, linkOnly]);

  async function createNewPOs(billUrl: string | null) {
    if (!bill) return;
    if (!workSites.length) throw new Error("This payment isn't on a site yet — open it to set one, then attach.");
    const billName = bill.billNo ? `Bill ${bill.billNo} — ${vendor}` : `Bill — ${vendor}`;
    const parts: Array<{ projectId: string; poId: string; amount: number }> = [];
    for (const s of workSites) {
      // Bill amount for this site = the bill's total apportioned by this site's paid share (so a
      // bill bigger than the payment lands on the PO as a balance owed). Falls back to paid if the
      // bill total couldn't be read.
      const share = bill.total > 0 && payment > 0 ? (bill.total * s.paid) / payment : s.paid;
      const billAmount = Math.max(0, Math.round(share));
      const { poId } = await createDeliveredBillPO(txn, orgId ?? '', {
        projectId: s.projectId, name: billName,
        billAmount, paidAmount: s.paid, gst: 0, billUrl, billNo: bill.billNo,
      });
      parts.push({ projectId: s.projectId, poId, amount: s.paid });
    }
    await commitBillSplit(txn, orgId ?? '', parts);
  }

  async function run(target: 'new' | { po: VendorPO }) {
    if (runningRef.current || (!linkOnly && !bill)) return;
    runningRef.current = true;
    setPickedPO(target === 'new' ? null : target.po);
    setStatus('attaching'); setErr(null);
    try {
      const f = linkOnly ? null : pickedRef.current;
      const billUrl = f ? await uploadBillDoc(f, txn.txn_id || 'txn') : null;
      if (billUrl && txn.txn_id) await attachBillDocToTxn(txn.txn_id, billUrl);

      if (target === 'new') await createNewPOs(billUrl);
      else await linkBillToExistingPO(txn, orgId ?? '', {
        poId: target.po.poId, projectId: target.po.projectId,
        billAmount: bill?.total ?? 0, billUrl, billNo: bill?.billNo, billDate: bill?.billDate,
        sites: workSites,
      });

      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      qc.invalidateQueries({ queryKey: ['vendorPOs', txn.txn_id] });
      qc.invalidateQueries({ queryKey: ['po_list_sheet'] });
      if (target !== 'new') { qc.invalidateQueries({ queryKey: ['po_detail', target.po.poId] }); qc.invalidateQueries({ queryKey: ['po_linked_txns', target.po.poId] }); }
      setStatus('done');
      onLinked();
      window.setTimeout(() => onClose(), 850);
    } catch (e) {
      setErr(errMsg(e) || 'Could not attach the bill.');
      setStatus('ready'); setPickedPO(null);
    } finally {
      runningRef.current = false;
    }
  }

  const summary = bill
    ? `${bill.total > 0 ? inr(bill.total) : 'Bill'}${bill.vendor ? ` · ${bill.vendor}` : ''}${bill.billNo ? ` · #${bill.billNo}` : ''}`
    : '';

  return (
    <div style={{ ...font }}>
      {/* header */}
      <div className="flex items-start justify-between px-4 pt-4 pb-3" style={{ borderBottom: `1px solid ${V.line}` }}>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold" style={{ color: V.ink }}>{linkOnly ? 'Link to a PO' : 'Attach bill'}</p>
          <p className="text-[12px] mt-0.5 truncate" style={{ color: V.sys }}>
            {!linkOnly && summary ? summary : <>Paying {vendor} · <span style={{ color: V.ink, fontWeight: 600 }}>{inr(payment)}</span></>}
          </p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg shrink-0" style={{ color: V.faint }} aria-label="Close"><X size={16} /></button>
      </div>

      <div className="px-4 py-3.5">
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); }} />

        {/* ── error: let them re-pick ── */}
        {err && (
          <div className="space-y-2.5">
            <p className="text-[12.5px]" style={{ color: V.terra }}>{err}</p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold"
              style={{ background: V.askWash, border: `1px solid ${V.askLine}`, color: V.terraDeep }}
            >
              <Camera size={15} /> Attach another — photo or PDF
            </button>
          </div>
        )}

        {/* ── selected order — the tapped row, held with a spinner then a tick ── */}
        {!err && pickedPO && (status === 'attaching' || status === 'done') && (
          <div className="rounded-xl px-3 py-2.5 flex items-center gap-2.5" style={{ background: status === 'done' ? V.sageWash : V.terraWash, border: `1px solid ${status === 'done' ? V.sage : V.terra}`, transition: 'background .2s, border-color .2s' }}>
            {status === 'done' ? <Check size={16} className="shrink-0" style={{ color: V.sage }} /> : <Loader2 size={16} className="animate-spin shrink-0" style={{ color: V.terra }} />}
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-medium truncate" style={{ color: V.ink }}>{inr(pickedPO.total)} order{pickedPO.projectName ? ` · ${pickedPO.projectName}` : ''}</span>
              <span className="block text-[11px] truncate" style={{ color: status === 'done' ? V.sage : V.terraDeep }}>{status === 'done' ? (linkOnly ? 'Payment linked' : 'Bill added') : (linkOnly ? 'Linking payment…' : 'Adding this bill…')}</span>
            </span>
          </div>
        )}

        {/* ── busy / done pill (reading, or create-new attach) ── */}
        {!err && status !== 'ready' && !pickedPO && (
          <div
            className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-semibold"
            style={status === 'done'
              ? { background: V.sageWash, border: `1px solid ${V.sage}`, color: V.sage }
              : { background: V.field, border: `1px solid ${V.line}`, color: V.terraDeep }}
          >
            {status === 'done'
              ? <><Check size={15} /> {linkOnly ? 'Linked' : 'Attached'}</>
              : <><Loader2 size={15} className="animate-spin" /> {status === 'reading' ? (linkOnly ? 'Loading orders…' : 'Reading bill…') : (linkOnly ? 'Linking…' : 'Attaching bill…')}</>}
          </div>
        )}

        {/* ── the choice: attach this bill to an existing order, or make a new one ── */}
        {!err && status === 'ready' && (
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium mb-1.5" style={{ color: V.ink }}>
              {linkOnly
                ? <>Which order should this payment go to?</>
                : <>Attach this bill to an existing order, or create a new one for it?</>}
            </p>
            {linkOnly && (vendorPOs?.length ?? 0) === 0 && (
              <p className="text-[12px] py-2" style={{ color: V.faint }}>No open orders for {vendor}. Use <b style={{ color: V.terraDeep }}>Upload bill</b> instead to record one.</p>
            )}
            {(vendorPOs ?? []).map((po, i) => (
              <button
                key={po.poId}
                type="button"
                onClick={() => void run({ po })}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left db-attach-row"
                style={{ background: V.surface, border: `1px solid ${V.line}`, animationDelay: `${i * 45}ms` }}
              >
                <FileText size={16} className="shrink-0" style={{ color: V.faint }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium truncate" style={{ color: V.ink }}>
                    {inr(po.total)} order{po.projectName ? ` · ${po.projectName}` : ''}
                    {po.hasBill && <span className="text-[10px] font-normal" style={{ color: V.faint }}> · has a bill</span>}
                  </span>
                  <span className="block text-[11px] truncate" style={{ color: V.faint }}>{po.poId}</span>
                </span>
                <span className="shrink-0 text-[11px] font-medium" style={{ color: V.terraDeep }}>{linkOnly ? 'Link here' : 'Add here'}</span>
                <ChevronRight size={15} className="shrink-0" style={{ color: V.faint }} />
              </button>
            ))}
            {/* upload mode only: create a new order for this bill */}
            {!linkOnly && (
              <button
                type="button"
                onClick={() => void run('new')}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-colors db-attach-row"
                style={{ background: V.surface, border: `1px dashed ${V.askLine}` }}
              >
                <Plus size={15} className="shrink-0" style={{ color: V.terraDeep }} />
                <span className="text-[12.5px] font-semibold" style={{ color: V.terraDeep }}>None of these — create a new order</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
