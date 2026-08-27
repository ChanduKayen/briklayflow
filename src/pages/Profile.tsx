import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useUserProfile } from '../App';
import { useOrgId } from '../lib/auth/AuthProvider';
import { useSnackbar } from '../components/Snackbar';
import { useBillingMode, type BillingMode } from '../lib/billingMode';

const MEMBERSHIP_CACHE_KEY = 'briklay_membership_ctx';

/** True when the account has no confirmed email — the "email update" the side-nav bubble points at. */
export function emailIsPending(session: Session): boolean {
  return !session.user.email;
}

const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

export default function Profile({ session }: { session: Session }) {
  const { data: profile } = useUserProfile(session.user.id);
  const orgId = useOrgId();
  const qc = useQueryClient();
  const { show: showSnackbar } = useSnackbar();

  const phone = session.user.phone || '';
  const currentEmail = session.user.email || '';
  const emailPending = !currentEmail;

  // ── Personal fields ───────────────────────────────────────────────
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  useEffect(() => { if (profile?.name) setName(profile.name); }, [profile?.name]);

  const [email, setEmail] = useState(currentEmail);
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);
  useEffect(() => { setEmail(currentEmail); }, [currentEmail]);

  const saveName = async () => {
    const n = name.trim();
    if (!n || n === profile?.name || savingName) return;
    setSavingName(true);
    try {
      const { error } = await supabase.from('user_profiles').update({ name: n }).eq('id', session.user.id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['profile', session.user.id] });
      showSnackbar('Name updated');
    } catch (err: any) {
      showSnackbar(err.message || 'Could not update name', { type: 'error' });
    } finally { setSavingName(false); }
  };

  const saveEmail = async () => {
    const e = email.trim().toLowerCase();
    if (!isValidEmail(e) || e === currentEmail || savingEmail) return;
    setSavingEmail(true);
    try {
      // Real login-email change: Supabase sends a confirmation link to the new address. Until it's
      // clicked, the email stays unconfirmed and the side-nav bubble remains.
      const { error } = await supabase.auth.updateUser(
        { email: e },
        { emailRedirectTo: `${window.location.origin}/profile` },
      );
      if (error) throw error;
      setEmailSentTo(e);
      showSnackbar('Confirmation link sent');
    } catch (err: any) {
      showSnackbar(err.message || 'Could not update email', { type: 'error' });
    } finally { setSavingEmail(false); }
  };

  // ── Org (admins only) ─────────────────────────────────────────────
  const isAdmin = profile?.role === 'principal' || profile?.role === 'management';
  const { data: org } = useQuery({
    queryKey: ['org_details', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('organizations').select('org_id, name, owner_id').eq('org_id', orgId).single();
      if (error) throw error;
      return data as { org_id: string; name: string; owner_id: string };
    },
    enabled: !!orgId && isAdmin,
  });
  const isOwner = org?.owner_id === session.user.id;
  const canDelete = isOwner && profile?.role === 'principal';

  const [company, setCompany] = useState('');
  const [savingCompany, setSavingCompany] = useState(false);
  useEffect(() => { if (org?.name) setCompany(org.name); }, [org?.name]);

  const saveCompany = async () => {
    const c = company.trim();
    if (!c || c === org?.name || savingCompany) return;
    setSavingCompany(true);
    try {
      const { data, error } = await supabase.from('organizations').update({ name: c }).eq('org_id', orgId).select('org_id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('You do not have permission to rename the workspace.');
      qc.invalidateQueries({ queryKey: ['org_details', orgId] });
      showSnackbar('Company name updated');
    } catch (err: any) {
      showSnackbar(err.message || 'Could not update company name', { type: 'error' });
    } finally { setSavingCompany(false); }
  };

  const [billingMode, setBillingMode] = useBillingMode();
  const { data: existingPayments } = useQuery({
    queryKey: ['client_payments_count'],
    queryFn: async () => {
      const { count } = await supabase.from('client_payments').select('payment_id', { count: 'exact', head: true });
      return count ?? 0;
    },
    enabled: isAdmin,
  });
  const handleBillingModeChange = (next: BillingMode) => {
    if (next === 'integrated' && billingMode === 'standalone' && (existingPayments ?? 0) > 0) {
      const yes = confirm(`Create transaction entries for existing ${existingPayments} client payment(s)?\n\nSelect OK to proceed (entries will NOT be backfilled automatically — you can do this manually from the ledger). Select Cancel to abort.`);
      if (!yes) return;
    }
    setBillingMode(next);
  };

  // ── Delete workspace ──────────────────────────────────────────────
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const confirmInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (showDeleteModal) { setConfirmName(''); setTimeout(() => confirmInputRef.current?.focus(), 80); }
  }, [showDeleteModal]);
  const nameMatches = confirmName === (org?.name ?? '');

  async function handleDeleteWorkspace() {
    if (!org || confirmName !== org.name) return;
    setDeleting(true);
    try {
      const { data: updated, error } = await supabase.from('organizations').update({ status: 'deleted' }).eq('org_id', orgId).select('org_id');
      if (error) throw error;
      if (!updated || updated.length === 0) throw new Error('Delete failed — you may not have permission to delete this workspace.');
      await supabase.from('org_memberships').update({ status: 'suspended' }).eq('org_id', orgId);
      localStorage.removeItem(MEMBERSHIP_CACHE_KEY);
      window.location.href = '/';
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to delete workspace', { type: 'error' });
      setDeleting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────
  const initials = (name || 'U').trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6 pb-32">
      <div className="mb-stack-lg">
        <h2 className="text-headline-lg-mobile md:text-headline-lg font-headline-lg text-on-background">Profile</h2>
        <p className="text-body-sm text-on-surface-variant mt-1">Your account details and workspace.</p>
      </div>

      <div className="max-w-2xl space-y-stack-lg">

        {/* ── Account ── */}
        <section className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-card overflow-hidden">
          <div className="px-6 py-4 bg-surface-container-low border-b border-outline-variant/20 flex items-center gap-3">
            <span className="w-11 h-11 rounded-full flex items-center justify-center text-[15px] font-bold bg-primary/10 text-primary shrink-0">{initials}</span>
            <div className="min-w-0">
              <h3 className="text-headline-sm font-headline-md text-on-surface truncate">{profile?.name || 'Your account'}</h3>
              <p className="text-[12px] text-on-surface-variant capitalize">{profile?.role || '—'}</p>
            </div>
          </div>
          <div className="p-6 space-y-stack-lg">

            {/* Name */}
            <div className="space-y-stack-sm">
              <label className="text-label-caps font-label-caps text-on-surface-variant">FULL NAME</label>
              <div className="flex gap-2">
                <input type="text" className="bk-input flex-1" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
                <button type="button" onClick={saveName} disabled={savingName || !name.trim() || name.trim() === profile?.name}
                  className="shrink-0 px-4 rounded-xl text-[13px] font-semibold border border-outline-variant/50 text-on-surface disabled:opacity-40 hover:bg-surface-container-low transition-colors">
                  {savingName ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            {/* Email */}
            <div className="space-y-stack-sm">
              <label className="text-label-caps font-label-caps text-on-surface-variant">EMAIL</label>
              {emailPending && !emailSentTo && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-xl mb-1" style={{ background: '#FDF3E7', border: '1px solid #F0D2A8' }}>
                  <span className="material-symbols-outlined text-[18px]" style={{ color: '#B26A1F' }}>mark_email_unread</span>
                  <p className="text-[12.5px]" style={{ color: '#8A5417' }}>No email on your account yet. Add one to secure it and enable email login.</p>
                </div>
              )}
              {emailSentTo ? (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl" style={{ background: '#EBF1E7', border: '1px solid #BFD8BC' }}>
                  <span className="material-symbols-outlined text-[18px]" style={{ color: '#4C6B47' }}>mark_email_read</span>
                  <p className="text-[12.5px]" style={{ color: '#3C5738' }}>
                    Confirmation link sent to <b>{emailSentTo}</b>. Open it to finish — until then, your email stays unconfirmed.
                  </p>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input type="email" className="bk-input flex-1" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
                  <button type="button" onClick={saveEmail} disabled={savingEmail || !isValidEmail(email) || email.trim().toLowerCase() === currentEmail}
                    className="shrink-0 px-4 rounded-xl text-[13px] font-semibold text-on-primary bg-primary disabled:opacity-40 transition-opacity">
                    {savingEmail ? 'Sending…' : emailPending ? 'Add email' : 'Update'}
                  </button>
                </div>
              )}
            </div>

            {/* Phone — the login identity, read-only */}
            <div className="space-y-stack-sm">
              <label className="text-label-caps font-label-caps text-on-surface-variant">PHONE</label>
              <div className="bk-input flex items-center justify-between" style={{ background: 'var(--color-surface-container-low, #F4EEE3)' }}>
                <span className="text-on-surface">{phone ? `+${phone.replace(/^\+/, '')}` : 'Not set'}</span>
                {phone && <span className="text-[11px] text-on-surface-variant">login number</span>}
              </div>
            </div>

          </div>
        </section>

        {/* ── Organization (admins) ── */}
        {isAdmin && (
          <section className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-card overflow-hidden">
            <div className="px-6 py-4 bg-surface-container-low border-b border-outline-variant/20">
              <h3 className="text-headline-sm font-headline-md text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">business</span>
                Organization
              </h3>
            </div>
            <div className="p-6 space-y-stack-lg">

              <div className="space-y-stack-sm">
                <label className="text-label-caps font-label-caps text-on-surface-variant">COMPANY NAME</label>
                <div className="flex gap-2">
                  <input type="text" className="bk-input flex-1" placeholder="e.g. Briklay Constructions Pvt Ltd" value={company} onChange={e => setCompany(e.target.value)} />
                  <button type="button" onClick={saveCompany} disabled={savingCompany || !company.trim() || company.trim() === org?.name}
                    className="shrink-0 px-4 rounded-xl text-[13px] font-semibold border border-outline-variant/50 text-on-surface disabled:opacity-40 hover:bg-surface-container-low transition-colors">
                    {savingCompany ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-label-caps font-label-caps text-on-surface-variant">CLIENT BILLING MODE</label>
                {([
                  { value: 'standalone' as BillingMode, label: 'Standalone', desc: 'Client billing lives only in /Invoices. The Transaction ledger shows outgoing payments only.' },
                  { value: 'integrated' as BillingMode, label: 'Integrated', desc: 'Recording a client receipt also creates an inward entry in the Transaction ledger.' },
                ]).map(opt => (
                  <label key={opt.value}
                    className={`flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${billingMode === opt.value ? 'border-primary/60 bg-primary/5' : 'border-outline-variant/20 hover:border-primary/20'}`}>
                    <input type="radio" name="billingMode" value={opt.value} checked={billingMode === opt.value} onChange={() => handleBillingModeChange(opt.value)} className="mt-0.5 accent-primary shrink-0" />
                    <div>
                      <p className="text-[13px] font-semibold text-on-surface">
                        {opt.label}
                        {opt.value === 'standalone' && <span className="ml-2 text-[10px] font-bold text-secondary bg-secondary-container/40 px-1.5 py-0.5 rounded">DEFAULT</span>}
                      </p>
                      <p className="text-[12px] text-on-surface-variant mt-0.5">{opt.desc}</p>
                    </div>
                  </label>
                ))}
              </div>

            </div>
          </section>
        )}

        {/* ── Danger Zone — owner + principal ── */}
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
                <p className="text-[12px] text-on-surface-variant mt-0.5">Permanently removes the workspace and all its data. This cannot be undone.</p>
              </div>
              <button onClick={() => setShowDeleteModal(true)}
                className="shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-red-300 text-red-700 text-[13px] font-semibold hover:bg-red-50 hover:border-red-400 transition-colors">
                <span className="material-symbols-outlined text-[16px]">delete_forever</span>
                Delete Workspace
              </button>
            </div>
          </section>
        )}

      </div>

      {/* ── Delete confirmation modal ── */}
      {showDeleteModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget && !deleting) setShowDeleteModal(false); }}>
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden" style={{ animation: 'bk-modal-in 160ms cubic-bezier(0.34,1.56,0.64,1)' }}>
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
              <div className="rounded-xl bg-red-50 border border-red-100 p-4 space-y-2">
                <p className="text-[12px] font-bold text-red-800 uppercase tracking-wider">Everything will be deleted</p>
                {['All projects, transactions, and contracts', 'All purchase orders and vendor records', 'All invoices, bills, and financial data', 'All team members and their access'].map(item => (
                  <div key={item} className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-red-400 text-[14px]">close</span>
                    <span className="text-[12px] text-red-700">{item}</span>
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-on-surface mb-1.5">
                  Type <span className="font-mono font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">{org?.name ?? '…'}</span> to confirm
                </label>
                <input ref={confirmInputRef} type="text" className="w-full px-4 py-2.5 rounded-xl border-2 text-[14px] outline-none transition-colors font-medium"
                  style={{ borderColor: confirmName.length > 0 ? (nameMatches ? '#16a34a' : '#ef4444') : 'rgba(0,0,0,0.15)' }}
                  placeholder={org?.name ?? ''} value={confirmName} onChange={e => setConfirmName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && nameMatches && !deleting) handleDeleteWorkspace(); }}
                  disabled={deleting} autoComplete="off" spellCheck={false} />
                {confirmName.length > 0 && !nameMatches && <p className="text-[11px] text-red-500 mt-1">Name doesn't match — check spacing and capitalisation</p>}
                {nameMatches && <p className="text-[11px] text-green-600 mt-1 flex items-center gap-1"><span className="material-symbols-outlined text-[13px]">check_circle</span>Confirmed</p>}
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setShowDeleteModal(false)} disabled={deleting}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-outline-variant/40 text-[13px] font-semibold text-on-surface-variant hover:bg-surface-container-low transition-colors disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={handleDeleteWorkspace} disabled={!nameMatches || deleting}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 text-white text-[13px] font-bold hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  {deleting ? <><span className="material-symbols-outlined animate-spin text-[15px]">progress_activity</span>Deleting…</> : <><span className="material-symbols-outlined text-[15px]">delete_forever</span>Delete Workspace</>}
                </button>
              </div>
            </div>
          </div>
          <style>{`@keyframes bk-modal-in { from { opacity: 0; transform: scale(0.92) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }`}</style>
        </div>,
        document.body
      )}
    </div>
  );
}
