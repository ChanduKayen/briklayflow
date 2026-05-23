import { useState } from 'react';
import { useRFQPOs, useCreateRFQForPO, useAddVendorToRFQ } from '../hooks/useProcurement';
import type { RFQPOData } from '../types/procurement';
import QuoteEntryDrawer from './QuoteEntryDrawer';
import QuoteComparisonModal from './QuoteComparisonModal';
import { useSnackbar } from './Snackbar';
import { PageSkeleton } from './SkeletonLoader';

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDeadline(d: string | null | undefined) {
  if (!d) return null;
  const p = new Date(d);
  if (isNaN(p.getTime())) return null;
  const now = new Date();
  const diff = Math.ceil((p.getTime() - now.getTime()) / 86400000);
  if (diff < 0) return { label: 'Deadline passed', urgent: true };
  if (diff === 0) return { label: 'Due today', urgent: true };
  if (diff === 1) return { label: 'Due tomorrow', urgent: true };
  return { label: `${diff}d left`, urgent: diff <= 3 };
}

function VendorInitials({ name }: { name: string }) {
  const init = name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <div className="w-7 h-7 rounded-xl bg-[#F5F5F7] border border-[#E5E5E7] flex items-center justify-center text-[10px] font-black text-[#515154] shrink-0">
      {init}
    </div>
  );
}

// ── AddVendorInline ───────────────────────────────────────────────────────────

function AddVendorInline({ rfqId, onAdded }: { rfqId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const addVendor = useAddVendorToRFQ();
  const { show: showSnackbar } = useSnackbar();

  const handleAdd = async () => {
    if (!vendorId.trim()) return;
    try {
      await addVendor.mutateAsync({ rfq_id: rfqId, vendor_id: vendorId.trim() });
      showSnackbar('Vendor added to RFQ');
      setVendorId('');
      setOpen(false);
      onAdded();
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to add vendor', { type: 'error' });
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-semibold text-[#515154] border border-dashed border-[#C7C7CC] hover:border-[#1D1D1F] hover:text-[#1D1D1F] transition-all"
      >
        <span className="material-symbols-outlined text-[12px]">add</span>
        Add vendor
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <input
        autoFocus
        type="text"
        value={vendorId}
        onChange={(e) => setVendorId(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setOpen(false); }}
        placeholder="Stakeholder ID"
        className="h-7 px-2.5 rounded-xl border border-[#D1D1D6] focus:border-[#1D1D1F] outline-none text-[12px] font-medium text-[#1D1D1F] w-36"
      />
      <button
        onClick={handleAdd}
        disabled={!vendorId.trim() || addVendor.isPending}
        className="h-7 px-2.5 rounded-xl bg-[#1D1D1F] text-white text-[11px] font-bold disabled:opacity-40 cursor-pointer"
      >
        Add
      </button>
      <button onClick={() => setOpen(false)} className="h-7 px-2 text-[#8E8E93] hover:text-[#1D1D1F] cursor-pointer">
        <span className="material-symbols-outlined text-[14px]">close</span>
      </button>
    </div>
  );
}

// ── RFQCard ───────────────────────────────────────────────────────────────────

function RFQCard({
  po,
  canManage,
  onEnterQuote,
  onCompare,
}: {
  po: RFQPOData;
  canManage: boolean;
  onEnterQuote: (poData: RFQPOData, quoteId: string) => void;
  onCompare: (po: RFQPOData) => void;
}) {
  const rfq = po.rfq;
  const deadline = fmtDeadline(rfq?.response_deadline);
  const receivedCount = rfq?.rfq_quotes.filter((q) => q.status === 'received' || q.status === 'selected').length ?? 0;
  const totalVendors = rfq?.rfq_quotes.length ?? 0;

  return (
    <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-[0_1px_4px_rgba(0,0,0,0.03)] overflow-hidden">
      {/* Card header */}
      <div className="px-5 pt-4 pb-3 border-b border-[#F2F2F7]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="font-mono text-[11px] font-bold text-[#8E8E93] bg-[#F5F5F7] px-2 py-0.5 rounded-lg">
                {po.po_id}
              </span>
              {rfq && (
                <span className="font-mono text-[11px] font-bold text-[#C8603A] bg-[#FCF7F2] border border-[#C8603A]/15 px-2 py-0.5 rounded-lg">
                  {rfq.rfq_number}
                </span>
              )}
              {deadline && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${deadline.urgent ? 'text-red-600 bg-red-50 border border-red-100' : 'text-amber-600 bg-amber-50 border border-amber-100'}`}>
                  {deadline.label}
                </span>
              )}
            </div>
            <p className="text-[14px] font-bold text-[#1D1D1F] truncate">
              {rfq?.title ?? po.po_id}
            </p>
            <div className="flex items-center gap-3 mt-1">
              {po.projects?.name && (
                <span className="text-[11px] text-[#8E8E93] flex items-center gap-0.5">
                  <span className="material-symbols-outlined text-[11px]">folder_open</span>
                  {po.projects.name}
                </span>
              )}
              {rfq?.response_deadline && (
                <span className="text-[11px] text-[#8E8E93] flex items-center gap-0.5">
                  <span className="material-symbols-outlined text-[11px]">calendar_today</span>
                  Deadline {fmtDate(rfq.response_deadline)}
                </span>
              )}
            </div>
          </div>

          {/* Quote progress */}
          <div className="text-right shrink-0">
            <p className="text-[22px] font-black text-[#1D1D1F] leading-none tabular-nums">
              {receivedCount}<span className="text-[14px] font-semibold text-[#8E8E93]">/{totalVendors}</span>
            </p>
            <p className="text-[10px] font-bold text-[#8E8E93] uppercase tracking-wide mt-0.5">
              Quotes in
            </p>
          </div>
        </div>
      </div>

      {/* Items preview */}
      {(po.po_line_items ?? []).length > 0 && (
        <div className="px-5 py-3 border-b border-[#F2F2F7]">
          <p className="text-[10px] font-bold text-[#8E8E93] uppercase tracking-wide mb-2">Items</p>
          <div className="flex flex-wrap gap-1.5">
            {po.po_line_items.slice(0, 5).map((li) => (
              <span key={li.id} className="text-[11px] font-medium text-[#515154] bg-[#F5F5F7] border border-[#E5E5E7] px-2.5 py-1 rounded-lg">
                {li.item_name}
                {li.quantity_ordered != null && (
                  <span className="text-[#8E8E93] ml-1">×{li.quantity_ordered}</span>
                )}
              </span>
            ))}
            {po.po_line_items.length > 5 && (
              <span className="text-[11px] text-[#8E8E93] px-2.5 py-1">+{po.po_line_items.length - 5} more</span>
            )}
          </div>
        </div>
      )}

      {/* Vendor quote chips */}
      <div className="px-5 py-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold text-[#8E8E93] uppercase tracking-wide">Vendors</p>
          {receivedCount > 1 && canManage && (
            <button
              onClick={() => onCompare(po)}
              className="text-[11px] font-bold text-[#C8603A] hover:text-[#B35230] flex items-center gap-1 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[13px]">compare_arrows</span>
              Compare
            </button>
          )}
        </div>

        {rfq && rfq.rfq_quotes.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {rfq.rfq_quotes.map((q) => {
              const isReceived = q.status === 'received' || q.status === 'selected';
              const isPending = q.status === 'pending';
              const isSelected = q.status === 'selected';

              return (
                <div key={q.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all ${
                  isSelected ? 'bg-emerald-50 border-emerald-200' :
                  isReceived ? 'bg-[#F5F5F7] border-[#E5E5E7]' :
                  'bg-white border-dashed border-[#D1D1D6]'
                }`}>
                  <VendorInitials name={q.vendor_name} />
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold text-[#1D1D1F] truncate max-w-[120px]">{q.vendor_name}</p>
                    {isReceived && q.total_quoted > 0 && (
                      <p className="text-[10.5px] font-bold text-emerald-700 tabular-nums">
                        ₹{q.total_quoted >= 100000
                          ? `${(q.total_quoted / 100000).toFixed(1)}L`
                          : q.total_quoted.toLocaleString('en-IN')}
                      </p>
                    )}
                    {isPending && (
                      <p className="text-[10px] text-[#8E8E93] font-medium">Awaiting</p>
                    )}
                    {isSelected && (
                      <p className="text-[10px] text-emerald-700 font-bold">Selected</p>
                    )}
                  </div>
                  {isPending && canManage && (
                    <button
                      onClick={() => onEnterQuote(po, q.id)}
                      className="ml-1 h-6 px-2 rounded-lg bg-[#1D1D1F] text-white text-[10px] font-bold cursor-pointer hover:bg-[#2D2D2F] transition-colors whitespace-nowrap"
                    >
                      Enter
                    </button>
                  )}
                  {isReceived && !isSelected && canManage && (
                    <button
                      onClick={() => onEnterQuote(po, q.id)}
                      className="ml-1 h-6 px-2 rounded-lg border border-[#D1D1D6] text-[#515154] text-[10px] font-bold cursor-pointer hover:border-[#C8603A] hover:text-[#C8603A] transition-colors whitespace-nowrap"
                    >
                      Edit
                    </button>
                  )}
                </div>
              );
            })}
            {canManage && rfq && (
              <AddVendorInline rfqId={rfq.id} onAdded={() => {}} />
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <p className="text-[12px] text-[#8E8E93]">No vendors yet</p>
            {canManage && rfq && (
              <AddVendorInline rfqId={rfq.id} onAdded={() => {}} />
            )}
          </div>
        )}
      </div>

      {/* Actions footer */}
      {canManage && rfq && receivedCount > 0 && (
        <div className="px-5 pb-4">
          <button
            onClick={() => onCompare(po)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#1D1D1F] hover:bg-[#2D2D2F] text-white text-[12.5px] font-bold transition-all cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
          >
            <span className="material-symbols-outlined text-[15px]">compare_arrows</span>
            Compare & Select Vendor
          </button>
        </div>
      )}
    </div>
  );
}

// ── CreateRFQForm ─────────────────────────────────────────────────────────────

function CreateRFQCard({ po, onCreated }: { po: RFQPOData; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(po.projects?.name ? `Materials for ${po.projects.name}` : 'Materials RFQ');
  const [deadline, setDeadline] = useState('');
  const createRFQ = useCreateRFQForPO();
  const { show: showSnackbar } = useSnackbar();

  const handleCreate = async () => {
    if (!deadline) return;
    try {
      await createRFQ.mutateAsync({
        po_id: po.po_id,
        org_id: po.org_id,
        title,
        response_deadline: deadline,
        line_items: po.po_line_items,
        vendor_ids: [],
      });
      showSnackbar('RFQ created — add vendors to start receiving quotes');
      onCreated();
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to create RFQ', { type: 'error' });
    }
  };

  if (!open) {
    return (
      <div className="bg-white rounded-2xl border border-dashed border-[#C8603A]/30 p-5 flex items-center justify-between">
        <div>
          <p className="text-[13px] font-semibold text-[#1D1D1F]">{po.po_id}</p>
          <p className="text-[11px] text-[#8E8E93] mt-0.5">No RFQ created yet</p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#FCF7F2] border border-[#C8603A]/20 text-[#C8603A] text-[12px] font-bold hover:bg-[#F5EDE5] transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[14px]">add_circle</span>
          Create RFQ
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-[#C8603A]/20 p-5 space-y-4 shadow-[0_2px_12px_rgba(200,96,58,0.08)]">
      <p className="text-[13px] font-bold text-[#1D1D1F]">New RFQ for {po.po_id}</p>
      <div>
        <label className="text-[10.5px] font-bold text-[#8E8E93] uppercase tracking-wide block mb-1.5">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full h-10 px-3 rounded-xl border border-[#D1D1D6] focus:border-[#1D1D1F] outline-none text-[13px] font-medium text-[#1D1D1F]"
        />
      </div>
      <div>
        <label className="text-[10.5px] font-bold text-[#8E8E93] uppercase tracking-wide block mb-1.5">Response deadline</label>
        <input
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          className="w-full h-10 px-3 rounded-xl border border-[#D1D1D6] focus:border-[#1D1D1F] outline-none text-[13px] text-[#1D1D1F]"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleCreate}
          disabled={!deadline || !title || createRFQ.isPending}
          className="flex-1 py-2.5 rounded-xl bg-[#1D1D1F] text-white text-[13px] font-bold disabled:opacity-40 cursor-pointer hover:bg-[#2D2D2F] transition-colors"
        >
          {createRFQ.isPending ? 'Creating…' : 'Create RFQ'}
        </button>
        <button onClick={() => setOpen(false)} className="px-4 py-2.5 rounded-xl border border-[#E5E5E7] text-[13px] font-semibold text-[#515154] hover:bg-[#F5F5F7] cursor-pointer">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

interface QuotationsTabProps {
  canManage: boolean;
}

export default function QuotationsTab({ canManage }: QuotationsTabProps) {
  const { data: rfqPOs, isLoading, isError, error } = useRFQPOs();

  const [quoteDrawer, setQuoteDrawer] = useState<{ po: RFQPOData; quoteId: string } | null>(null);
  const [compareModal, setCompareModal] = useState<RFQPOData | null>(null);

  const handleEnterQuote = (po: RFQPOData, quoteId: string) => setQuoteDrawer({ po, quoteId });
  const handleCompare = (po: RFQPOData) => setCompareModal(po);

  if (isLoading) return <div className="mt-4"><PageSkeleton /></div>;

  if (isError) {
    return (
      <div className="bg-white rounded-3xl border border-[#E5E5E7] flex flex-col items-center justify-center py-16 px-8 text-center mt-4">
        <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center mb-4">
          <span className="material-symbols-outlined text-[22px] text-red-400">error_outline</span>
        </div>
        <p className="text-[14px] font-bold text-[#1D1D1F] mb-1">Could not load quotations</p>
        <p className="text-[12px] text-[#8E8E93] max-w-sm font-mono break-all">
          {(error as any)?.message ?? 'Unknown error'}
        </p>
      </div>
    );
  }

  const pos = rfqPOs ?? [];

  if (pos.length === 0) {
    return (
      <div className="bg-white rounded-3xl border border-[#E5E5E7] shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex flex-col items-center justify-center py-24 px-8 text-center mt-4">
        <div className="w-14 h-14 rounded-2xl bg-[#FCF7F2] border border-[#C8603A]/15 flex items-center justify-center mb-5">
          <span className="material-symbols-outlined text-[28px] text-[#C8603A]/50">request_quote</span>
        </div>
        <p className="text-[16px] font-bold text-[#1D1D1F] mb-1.5">No active quotations</p>
        <p className="text-[13px] text-[#8E8E93] max-w-xs leading-relaxed">
          Set a purchase order's status to <strong>RFQ</strong> in "Awaiting Quotes" mode — it will appear here.
        </p>
      </div>
    );
  }

  // Find the active quote for the drawer
  const drawerQuote = quoteDrawer
    ? quoteDrawer.po.rfq?.rfq_quotes.find((q) => q.id === quoteDrawer.quoteId) ?? null
    : null;

  return (
    <>
      <div className="mt-4 space-y-4">
        {pos.map((po) =>
          po.rfq ? (
            <RFQCard
              key={po.po_id}
              po={po}
              canManage={canManage}
              onEnterQuote={handleEnterQuote}
              onCompare={handleCompare}
            />
          ) : canManage ? (
            <CreateRFQCard key={po.po_id} po={po} onCreated={() => {}} />
          ) : null
        )}
      </div>

      {/* Quote entry drawer */}
      {quoteDrawer && drawerQuote && quoteDrawer.po.rfq && (
        <QuoteEntryDrawer
          isOpen={!!quoteDrawer}
          onClose={() => setQuoteDrawer(null)}
          quote={drawerQuote}
          rfqItems={quoteDrawer.po.rfq.rfq_items}
          rfqId={quoteDrawer.po.rfq.id}
        />
      )}

      {/* Comparison modal */}
      {compareModal?.rfq && (
        <QuoteComparisonModal
          isOpen={!!compareModal}
          onClose={() => setCompareModal(null)}
          rfq={compareModal.rfq}
          poId={compareModal.po_id}
        />
      )}
    </>
  );
}
