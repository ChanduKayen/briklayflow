import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useBillingMode, type BillingMode } from '../lib/billingMode';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import { useOrgId } from '../lib/auth/AuthProvider';
import { useSnackbar } from '../components/Snackbar';

const MEMBERSHIP_CACHE_KEY = 'briklay_membership_ctx';

export default function Settings({ session }: { session: Session }) {
  const [companyName, setCompanyName] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [fyStart, setFyStart] = useState('April');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [billingMode, setBillingMode] = useBillingMode();
  const { data: profile } = useUserProfile(session.user.id);
  const orgId = useOrgId();
  const { show: showSnackbar } = useSnackbar();

  // ── Delete workspace state ────────────────────────────────────────
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const confirmInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showDeleteModal) {
      setConfirmName('');
      setTimeout(() => confirmInputRef.current?.focus(), 80);
    }
  }, [showDeleteModal]);

  // ── Org details ───────────────────────────────────────────────────
  const { data: org } = useQuery({
    queryKey: ['org_details', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('org_id, name, owner_id')
        .eq('org_id', orgId)
        .single();
      if (error) throw error;
      return data as { org_id: string; name: string; owner_id: string };
    },
    enabled: !!orgId,
  });

  const isOwner     = org?.owner_id === session.user.id;
  const isPrincipal = profile?.role === 'principal';
  const canDelete   = isOwner && isPrincipal;

  // ── Billing helpers ───────────────────────────────────────────────
  const { data: existingPayments } = useQuery({
    queryKey: ['client_payments_count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('client_payments')
        .select('payment_id', { count: 'exact', head: true });
      return count ?? 0;
    },
  });

  const handleBillingModeChange = (next: BillingMode) => {
    if (next === 'integrated' && billingMode === 'standalone' && (existingPayments ?? 0) > 0) {
      const yes = confirm(
        `Create transaction entries for existing ${existingPayments} client payment(s)?\n\nSelect OK to proceed (entries will NOT be backfilled automatically — you can do this manually from the ledger). Select Cancel to abort.`,
      );
      if (!yes) return;
    }
    setBillingMode(next);
  };

  // ── Delete workspace ──────────────────────────────────────────────
  async function handleDeleteWorkspace() {
    if (!org || confirmName !== org.name) return;
    setDeleting(true);
    try {
      // Update org and verify at least one row was affected.
      // Without .select(), Supabase returns no error even when RLS silently
      // blocks the update (0 rows changed), so we must check the returned data.
      const { data: updated, error } = await supabase
        .from('organizations')
        .update({ status: 'deleted' })
        .eq('org_id', orgId)
        .select('org_id');
      if (error) throw error;
      if (!updated || updated.length === 0) {
        throw new Error('Delete failed — you may not have permission to delete this workspace.');
      }

      // Suspend all memberships so RLS revokes data access immediately.
      // get_my_org_ids() also filters by org.status, but this adds a belt-
      // and-suspenders layer and keeps membership state consistent.
      await supabase
        .from('org_memberships')
        .update({ status: 'suspended' })
        .eq('org_id', orgId);

      // Clear auth cache so resolver re-runs and finds no active org
      localStorage.removeItem(MEMBERSHIP_CACHE_KEY);

      // Reload — resolver will see no active org → navigate to /create-workspace
      window.location.href = '/';
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to delete workspace', { type: 'error' });
      setDeleting(false);
    }
  }

  const nameMatches = confirmName === (org?.name ?? '');

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6 pb-32">
      <div className="mb-stack-lg">
        <h2 className="text-headline-lg-mobile md:text-headline-lg font-headline-lg text-on-background">Settings</h2>
        <p className="text-body-sm text-on-surface-variant mt-1">Configure your company and platform preferences.</p>
      </div>

      <div className="max-w-2xl space-y-stack-lg">

        {/* Company Details */}
        <section className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-card overflow-hidden">
          <div className="px-6 py-4 bg-surface-container-low border-b border-outline-variant/20">
            <h3 className="text-headline-sm font-headline-md text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">business</span>
              Company Details
            </h3>
          </div>
          <div className="p-6 space-y-stack-lg">

            <div className="space-y-stack-sm">
              <label className="text-label-caps font-label-caps text-on-surface-variant">COMPANY NAME</label>
              <input
                type="text"
                className="bk-input w-full"
                placeholder="e.g. Briklay Constructions Pvt Ltd"
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
              />
            </div>

            <div className="space-y-stack-sm">
              <label className="text-label-caps font-label-caps text-on-surface-variant">COMPANY LOGO</label>
              <div className="relative">
                <input
                  type="file"
                  id="logo-upload"
                  accept="image/*"
                  onChange={e => setLogoFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                <label
                  htmlFor="logo-upload"
                  className="flex items-center gap-3 px-4 py-3 border-2 border-dashed border-outline-variant/60 rounded-xl cursor-pointer hover:bg-primary/5 hover:border-primary/50 transition-all text-on-surface-variant w-full"
                >
                  <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-primary shrink-0">
                    <span className="material-symbols-outlined">add_photo_alternate</span>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <p className="text-body-sm font-semibold text-on-surface truncate">
                      {logoFile ? logoFile.name : 'Click to upload company logo'}
                    </p>
                    <p className="text-[12px] text-on-surface-variant mt-0.5">PNG, JPG, SVG — recommended 200×200px</p>
                  </div>
                  {logoFile && (
                    <div className="shrink-0 text-secondary flex items-center gap-1 bg-secondary-container/20 px-2 py-1 rounded">
                      <span className="material-symbols-outlined text-[16px]">check_circle</span>
                      <span className="text-[12px] font-bold">Selected</span>
                    </div>
                  )}
                </label>
              </div>
            </div>

          </div>
        </section>

        {/* Financial Preferences */}
        <section className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-card overflow-hidden">
          <div className="px-6 py-4 bg-surface-container-low border-b border-outline-variant/20">
            <h3 className="text-headline-sm font-headline-md text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">account_balance</span>
              Financial Preferences
            </h3>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-stack-lg">

            <div className="space-y-stack-sm">
              <label className="text-label-caps font-label-caps text-on-surface-variant">CURRENCY</label>
              <select className="bk-input w-full" value={currency} onChange={e => setCurrency(e.target.value)}>
                <option value="INR">INR — Indian Rupee (₹)</option>
                <option value="USD">USD — US Dollar ($)</option>
                <option value="EUR">EUR — Euro (€)</option>
                <option value="GBP">GBP — British Pound (£)</option>
                <option value="AED">AED — UAE Dirham (د.إ)</option>
              </select>
            </div>

            <div className="space-y-stack-sm">
              <label className="text-label-caps font-label-caps text-on-surface-variant">FINANCIAL YEAR START</label>
              <select className="bk-input w-full" value={fyStart} onChange={e => setFyStart(e.target.value)}>
                <option value="April">April (Indian FY)</option>
                <option value="January">January (Calendar Year)</option>
              </select>
            </div>

          </div>
        </section>

        {/* Client Billing Mode */}
        <section className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-card overflow-hidden">
          <div className="px-6 py-4 bg-surface-container-low border-b border-outline-variant/20">
            <h3 className="text-headline-sm font-headline-md text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">description</span>
              Client Billing Mode
            </h3>
          </div>
          <div className="p-6 space-y-3">
            <p className="text-[13px] text-on-surface-variant mb-4">
              Choose how client invoices and receipts interact with the Transaction ledger.
            </p>
            {([
              {
                value: 'standalone' as BillingMode,
                label: 'Standalone',
                desc: 'Client billing lives only in /Invoices. The Transaction ledger shows outgoing payments only.',
              },
              {
                value: 'integrated' as BillingMode,
                label: 'Integrated',
                desc: 'Recording a client receipt also creates an inward entry in the Transaction ledger.',
              },
            ]).map(opt => (
              <label
                key={opt.value}
                className={`flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                  billingMode === opt.value
                    ? 'border-primary/60 bg-primary/5'
                    : 'border-outline-variant/20 hover:border-primary/20'
                }`}
              >
                <input
                  type="radio"
                  name="billingMode"
                  value={opt.value}
                  checked={billingMode === opt.value}
                  onChange={() => handleBillingModeChange(opt.value)}
                  className="mt-0.5 accent-primary shrink-0"
                />
                <div>
                  <p className="text-[13px] font-semibold text-on-surface">
                    {opt.label}
                    {opt.value === 'standalone' && (
                      <span className="ml-2 text-[10px] font-bold text-secondary bg-secondary-container/40 px-1.5 py-0.5 rounded">DEFAULT</span>
                    )}
                  </p>
                  <p className="text-[12px] text-on-surface-variant mt-0.5">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </section>

        {/* Save */}
        <div className="flex justify-end">
          <button
            type="button"
            className="bk-btn flex items-center gap-2 px-8 py-3 rounded-xl"
            onClick={() => {}}
          >
            <span className="material-symbols-outlined text-[18px]">save</span>
            Save Settings
          </button>
        </div>

        {/* ── Danger Zone — owner + principal only ─────────────────────── */}
        {canDelete && (
          <section className="rounded-2xl border border-red-200 overflow-hidden">
            <div className="px-6 py-4 bg-red-50 border-b border-red-200">
              <h3 className="text-[15px] font-bold text-red-700 flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">warning</span>
                Danger Zone
              </h3>
            </div>
            <div className="p-6 flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1">
                <p className="text-[14px] font-semibold text-on-surface">Delete this workspace</p>
                <p className="text-[12px] text-on-surface-variant mt-0.5">
                  Permanently removes the workspace and all its data. This cannot be undone.
                </p>
              </div>
              <button
                onClick={() => setShowDeleteModal(true)}
                className="shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-red-300 text-red-700 text-[13px] font-semibold hover:bg-red-50 hover:border-red-400 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">delete_forever</span>
                Delete Workspace
              </button>
            </div>
          </section>
        )}

      </div>

      {/* ── Delete confirmation modal ─────────────────────────────────── */}
      {showDeleteModal && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget && !deleting) setShowDeleteModal(false); }}
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
            style={{ animation: 'bk-modal-in 160ms cubic-bezier(0.34,1.56,0.64,1)' }}
          >
            {/* Red header */}
            <div className="bg-red-600 px-6 py-5 flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center shrink-0 mt-0.5">
                <span className="material-symbols-outlined text-white text-[22px]">delete_forever</span>
              </div>
              <div>
                <p className="text-[16px] font-bold text-white leading-tight">Delete Workspace</p>
                <p className="text-[12px] text-red-100 mt-0.5">This action is permanent and cannot be reversed.</p>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {/* What gets deleted */}
              <div className="rounded-xl bg-red-50 border border-red-100 p-4 space-y-2">
                <p className="text-[12px] font-bold text-red-800 uppercase tracking-wider">Everything will be deleted</p>
                {[
                  'All projects, transactions, and contracts',
                  'All purchase orders and vendor records',
                  'All invoices, bills, and financial data',
                  'All team members and their access',
                ].map(item => (
                  <div key={item} className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-red-400 text-[14px]">close</span>
                    <span className="text-[12px] text-red-700">{item}</span>
                  </div>
                ))}
              </div>

              {/* Name confirmation */}
              <div>
                <label className="block text-[12px] font-semibold text-on-surface mb-1.5">
                  Type{' '}
                  <span className="font-mono font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                    {org?.name ?? '…'}
                  </span>
                  {' '}to confirm
                </label>
                <input
                  ref={confirmInputRef}
                  type="text"
                  className="w-full px-4 py-2.5 rounded-xl border-2 text-[14px] outline-none transition-colors font-medium"
                  style={{
                    borderColor: confirmName.length > 0
                      ? (nameMatches ? '#16a34a' : '#ef4444')
                      : 'rgba(0,0,0,0.15)',
                  }}
                  placeholder={org?.name ?? ''}
                  value={confirmName}
                  onChange={e => setConfirmName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && nameMatches && !deleting) handleDeleteWorkspace(); }}
                  disabled={deleting}
                  autoComplete="off"
                  spellCheck={false}
                />
                {confirmName.length > 0 && !nameMatches && (
                  <p className="text-[11px] text-red-500 mt-1">Name doesn't match — check spacing and capitalisation</p>
                )}
                {nameMatches && (
                  <p className="text-[11px] text-green-600 mt-1 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[13px]">check_circle</span>
                    Confirmed
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-outline-variant/40 text-[13px] font-semibold text-on-surface-variant hover:bg-surface-container-low transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteWorkspace}
                  disabled={!nameMatches || deleting}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 text-white text-[13px] font-bold hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {deleting ? (
                    <>
                      <span className="material-symbols-outlined animate-spin text-[15px]">progress_activity</span>
                      Deleting…
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[15px]">delete_forever</span>
                      Delete Workspace
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
          <style>{`
            @keyframes bk-modal-in {
              from { opacity: 0; transform: scale(0.92) translateY(8px); }
              to   { opacity: 1; transform: scale(1)    translateY(0);   }
            }
          `}</style>
        </div>,
        document.body
      )}
    </div>
  );
}
