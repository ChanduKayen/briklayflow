import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import type { Stakeholder, GSTRegType } from '../types';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import { WORKER_TRADE_GROUPS, VENDOR_TRADE_GROUPS, OTHER_TRADE } from '../lib/trades';

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;
function validateGSTIN(v: string) { return GSTIN_REGEX.test(v.trim().toUpperCase()); }

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button"
          onMouseEnter={() => setHovered(n)} onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(value === n ? 0 : n)} className="p-0.5 transition-transform hover:scale-110">
          <span className="material-symbols-outlined text-[22px]" style={{
            color: (hovered || value) >= n ? '#f59e0b' : '#d1d5db',
            fontVariationSettings: (hovered || value) >= n ? "'FILL' 1" : "'FILL' 0",
          }}>star</span>
        </button>
      ))}
    </div>
  );
}

export function StarDisplay({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5 items-center">
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className="material-symbols-outlined" style={{
          fontSize: size,
          color: value >= n ? '#f59e0b' : '#d1d5db',
          fontVariationSettings: value >= n ? "'FILL' 1" : "'FILL' 0",
        }}>star</span>
      ))}
    </span>
  );
}

function initials(name: string) {
  const parts = name.trim().split(' ').filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarBg(name: string) {
  const palette = ['#e5e7eb', '#dbeafe', '#fef3c7', '#d1fae5', '#ede9fe', '#fce7f3'];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return palette[h % palette.length];
}

function TypePill({ type }: { type: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    Worker: { bg: '#dbeafe', color: '#1e40af' },
    Vendor: { bg: '#fef3c7', color: '#92400e' },
    Client: { bg: '#d1fae5', color: '#065f46' },
  };
  const s = styles[type] || { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{
      display: 'inline-block', fontSize: 11, fontWeight: 600, padding: '2px 8px',
      borderRadius: 99, background: s.bg, color: s.color,
    }}>
      {type}
    </span>
  );
}

function fmt(n: number) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)   return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toLocaleString('en-IN')}`;
}

export default function Stakeholders({ session }: { session: Session }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: profile } = useUserProfile(session.user.id);
  const [showForm, setShowForm] = useState(false);

  // ── Filter state ──────────────────────────────────────────────────────────
  const [filterType, setFilterType] = useState<'all' | 'Worker' | 'Vendor' | 'Client'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'approved' | 'unapproved'>('all');
  const [search, setSearch] = useState('');
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);

  // ── Form state ────────────────────────────────────────────────────────────
  const [formType, setFormType] = useState<'Worker' | 'Vendor'>('Worker');
  const [formCategory, setFormCategory] = useState('');
  const [formCategoryOther, setFormCategoryOther] = useState('');
  const [gstRegType, setGstRegType] = useState<GSTRegType>('Regular');
  const [gstinValue, setGstinValue] = useState('');
  const [gstinError, setGstinError] = useState('');
  const [isApproved, setIsApproved] = useState(false);
  const [rating, setRating] = useState(0);
  const [ratingDelivery, setRatingDelivery] = useState(0);
  const [ratingQuality, setRatingQuality] = useState(0);
  const [ratingPricing, setRatingPricing] = useState(0);
  const [showSubRatings, setShowSubRatings] = useState(false);

  const resetVendorFields = () => {
    setGstRegType('Regular'); setGstinValue(''); setGstinError('');
    setIsApproved(false); setRating(0); setRatingDelivery(0);
    setRatingQuality(0); setRatingPricing(0); setShowSubRatings(false);
  };
  const resetForm = () => { setFormCategory(''); setFormCategoryOther(''); resetVendorFields(); };

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: stakeholders, isLoading } = useQuery({
    queryKey: ['stakeholders'],
    queryFn: async () => {
      const { data, error } = await supabase.from('stakeholders').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data as Stakeholder[];
    },
  });

  const { data: paidMap } = useQuery({
    queryKey: ['stakeholders_paid'],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('stakeholder_id, total_amount')
        .eq('status', 'Active');
      const map: Record<string, number> = {};
      (data || []).forEach((t: any) => {
        if (t.stakeholder_id) map[t.stakeholder_id] = (map[t.stakeholder_id] || 0) + Number(t.total_amount);
      });
      return map;
    },
  });

  const createStakeholder = useMutation({
    mutationFn: async (formData: FormData) => {
      if (formType === 'Vendor' && gstRegType !== 'Unregistered' && gstinValue) {
        if (!validateGSTIN(gstinValue)) {
          setGstinError('Invalid GSTIN format. Expected format: 37AADCB2230M1Z3');
          throw new Error('Invalid GSTIN');
        }
      }
      const firstName = (formData.get('first_name') as string || '').trim();
      const lastName  = (formData.get('last_name')  as string || '').trim();
      const fullName  = lastName ? `${firstName} ${lastName}` : firstName;
      const resolvedCategory = formCategory === OTHER_TRADE
        ? (formCategoryOther.trim() || 'Other') : formCategory;
      const payload: any = {
        stakeholder_id: formData.get('stakeholder_id') as string,
        name: fullName, type: formType, category: resolvedCategory,
        contact: formData.get('contact') as string || null,
        bank_details: formData.get('bank_details') as string || null,
      };
      if (formType === 'Vendor') {
        payload.gst_reg_type = gstRegType;
        payload.gstin = (gstRegType !== 'Unregistered' && gstinValue) ? gstinValue.toUpperCase() : null;
        payload.is_approved = isApproved;
        if (rating > 0) {
          payload.rating = rating;
          if (ratingDelivery > 0) payload.rating_delivery = ratingDelivery;
          if (ratingQuality  > 0) payload.rating_quality  = ratingQuality;
          if (ratingPricing  > 0) payload.rating_pricing  = ratingPricing;
        }
      }
      const { data, error } = await supabase.from('stakeholders').insert([payload]).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stakeholders'] });
      setShowForm(false); setFormType('Worker'); resetForm();
    },
  });

  const canManage = ['management', 'accountant', 'principal'].includes(profile?.role || '');

  // ── Derived ───────────────────────────────────────────────────────────────
  const all = stakeholders || [];
  const workerCount = all.filter(s => s.type === 'Worker').length;
  const vendorCount = all.filter(s => s.type === 'Vendor').length;

  const displayed = all.filter((stk) => {
    if (filterType !== 'all' && stk.type !== filterType) return false;
    if (filterStatus === 'approved'   && !(stk.type === 'Vendor' && stk.is_approved)) return false;
    if (filterStatus === 'unapproved' && !(stk.type === 'Vendor' && !stk.is_approved)) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        stk.name.toLowerCase().includes(q) ||
        stk.stakeholder_id.toLowerCase().includes(q) ||
        (stk.category || '').toLowerCase().includes(q) ||
        (stk.contact || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6 mobile-main-pb">

      {/* PAGE HEADER */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#0b1c30', margin: 0, fontFamily: 'Manrope, sans-serif' }}>
            Stakeholders
          </h1>
          <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', margin: '3px 0 0' }}>
            {all.length} total · {workerCount} workers · {vendorCount} vendors
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => { setShowForm(!showForm); if (showForm) { setFormType('Worker'); resetForm(); } }}
            style={{
              fontSize: 13, fontWeight: 500, color: '#C8603A', background: 'white',
              border: '1px solid rgba(200,96,58,0.4)', borderRadius: 8,
              padding: '6px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{showForm ? 'close' : 'add'}</span>
            {showForm ? 'Cancel' : 'Add Stakeholder'}
          </button>
        )}
      </div>

      {/* ADD FORM — unchanged functionality */}
      {showForm && (
        <div className="bg-surface-container-lowest rounded-xl shadow-card border border-outline-variant/30 overflow-hidden mb-6">
          <div className="px-6 py-4 bg-surface-container-low border-b border-outline-variant/30">
            <h3 className="text-headline-md font-headline-md">Add New Stakeholder</h3>
            <p className="text-body-sm text-on-surface-variant">Register a new worker or vendor.</p>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); createStakeholder.mutate(new FormData(e.currentTarget)); }} className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-stack-lg">
              <div className="space-y-stack-sm">
                <label className="text-label-caps font-label-caps text-on-surface-variant">ID</label>
                <input name="stakeholder_id" className="bk-input" placeholder="STK-001" required />
              </div>
              <div className="space-y-stack-sm">
                <label className="text-label-caps font-label-caps text-on-surface-variant">TYPE</label>
                <select name="type" className="bk-input" value={formType}
                  onChange={(e) => { setFormType(e.target.value as 'Worker' | 'Vendor'); resetForm(); }}>
                  <option value="Worker">Worker</option>
                  <option value="Vendor">Vendor</option>
                </select>
              </div>
              <div className="space-y-stack-sm">
                <label className="text-label-caps font-label-caps text-on-surface-variant">FIRST NAME</label>
                <input name="first_name" className="bk-input" placeholder="First Name" required />
              </div>
              <div className="space-y-stack-sm">
                <label className="text-label-caps font-label-caps text-on-surface-variant">LAST NAME</label>
                <input name="last_name" className="bk-input" placeholder="Last Name" />
              </div>
              <div className="space-y-stack-sm">
                <label className="text-label-caps font-label-caps text-on-surface-variant">TRADE / CATEGORY</label>
                <select className="bk-input" value={formCategory}
                  onChange={(e) => { setFormCategory(e.target.value); setFormCategoryOther(''); }} required>
                  <option value="" disabled>Select trade…</option>
                  {(formType === 'Worker' ? WORKER_TRADE_GROUPS : VENDOR_TRADE_GROUPS).map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.trades.map((t) => <option key={t} value={t}>{t}</option>)}
                    </optgroup>
                  ))}
                </select>
                {formCategory === OTHER_TRADE && (
                  <input className="bk-input mt-1" placeholder="Specify trade…"
                    value={formCategoryOther} onChange={(e) => setFormCategoryOther(e.target.value)} autoFocus required />
                )}
              </div>
              <div className="space-y-stack-sm">
                <label className="text-label-caps font-label-caps text-on-surface-variant">CONTACT</label>
                <input name="contact" className="bk-input" placeholder="Phone / Email" />
              </div>
              <div className="space-y-stack-sm md:col-span-2">
                <label className="text-label-caps font-label-caps text-on-surface-variant">BANK / UPI</label>
                <input name="bank_details" className="bk-input" placeholder="Account No / UPI ID" />
              </div>
              {formType === 'Vendor' && (
                <>
                  <div className="md:col-span-2 border-t border-outline-variant/30 pt-2">
                    <p className="text-label-caps font-label-caps text-on-surface-variant flex items-center gap-2">
                      <span className="material-symbols-outlined text-[14px]">receipt_long</span>
                      GST & COMPLIANCE
                    </p>
                  </div>
                  <div className="space-y-stack-sm">
                    <label className="text-label-caps font-label-caps text-on-surface-variant">GST REGISTRATION TYPE</label>
                    <select className="bk-input" value={gstRegType}
                      onChange={(e) => { setGstRegType(e.target.value as GSTRegType); setGstinValue(''); setGstinError(''); }}>
                      <option value="Regular">Regular</option>
                      <option value="Composition">Composition</option>
                      <option value="Unregistered">Unregistered</option>
                    </select>
                  </div>
                  {gstRegType !== 'Unregistered' ? (
                    <div className="space-y-stack-sm">
                      <label className="text-label-caps font-label-caps text-on-surface-variant">GSTIN (OPTIONAL)</label>
                      <input
                        className={`bk-input uppercase tracking-wider font-data-mono ${gstinError ? 'border-error ring-1 ring-error/30' : ''}`}
                        placeholder="37AADCB2230M1Z3" value={gstinValue} maxLength={15}
                        onChange={(e) => { setGstinValue(e.target.value.toUpperCase()); setGstinError(''); }}
                        onBlur={() => { if (gstinValue && !validateGSTIN(gstinValue)) setGstinError('Invalid format. e.g. 37AADCB2230M1Z3'); }}
                      />
                      {gstinError
                        ? <p className="text-[11px] text-error">{gstinError}</p>
                        : <p className="text-[11px] text-on-surface-variant">e.g. 37AADCB2230M1Z3 · 15 characters</p>}
                    </div>
                  ) : (
                    <div className="flex items-center">
                      <p className="text-body-sm text-on-surface-variant italic mt-6">No GSTIN for unregistered vendors</p>
                    </div>
                  )}
                  <div className="md:col-span-2 flex items-center justify-between p-4 bg-surface-container-low rounded-xl border border-outline-variant/30">
                    <div>
                      <p className="text-body-sm font-semibold text-on-surface">Approved Vendor</p>
                      <p className="text-[12px] text-on-surface-variant mt-0.5">Mark this vendor as approved for use on projects</p>
                    </div>
                    <button type="button" onClick={() => setIsApproved(v => !v)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isApproved ? 'bg-secondary' : 'bg-outline-variant/50'}`}>
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isApproved ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                  <div className="md:col-span-2 border-t border-outline-variant/30 pt-2">
                    <p className="text-label-caps font-label-caps text-on-surface-variant flex items-center gap-2 mb-4">
                      <span className="material-symbols-outlined text-[14px]">star</span>
                      VENDOR RATING (OPTIONAL)
                    </p>
                    <div className="space-y-4">
                      <div className="flex items-center gap-4">
                        <span className="text-body-sm text-on-surface-variant w-20 shrink-0">Overall</span>
                        <StarRating value={rating} onChange={setRating} />
                        {rating > 0
                          ? <span className="text-body-sm font-semibold text-on-surface">{rating}/5</span>
                          : <span className="text-body-sm text-on-surface-variant italic">Not yet rated</span>}
                      </div>
                      {rating > 0 && (
                        <button type="button" onClick={() => setShowSubRatings(v => !v)}
                          className="flex items-center gap-1.5 text-[12px] text-primary hover:underline">
                          <span className="material-symbols-outlined text-[14px]">{showSubRatings ? 'expand_less' : 'expand_more'}</span>
                          {showSubRatings ? 'Hide' : 'Add'} subcategory ratings
                        </button>
                      )}
                      {showSubRatings && (
                        <div className="pl-4 border-l-2 border-outline-variant/30 space-y-3">
                          {([
                            { label: 'Delivery', value: ratingDelivery, onChange: setRatingDelivery },
                            { label: 'Quality',  value: ratingQuality,  onChange: setRatingQuality  },
                            { label: 'Pricing',  value: ratingPricing,  onChange: setRatingPricing  },
                          ] as const).map((r) => (
                            <div key={r.label} className="flex items-center gap-4">
                              <span className="text-body-sm text-on-surface-variant w-20 shrink-0">{r.label}</span>
                              <StarRating value={r.value} onChange={r.onChange} />
                              {r.value > 0 && <span className="text-body-sm text-on-surface-variant">{r.value}/5</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="mt-8 flex justify-end pt-4 border-t border-outline-variant/30">
              <button type="submit" className="bk-btn px-8" disabled={createStakeholder.isPending}>
                {createStakeholder.isPending ? 'Saving...' : 'Save Stakeholder'}
              </button>
            </div>
            {createStakeholder.isError && (
              <p className="text-error mt-4 text-body-sm">
                {(createStakeholder.error as any)?.message || 'Error saving stakeholder'}
              </p>
            )}
          </form>
        </div>
      )}

      {/* FILTER ROW */}
      <div className="flex flex-wrap items-center gap-2 mb-4" style={{ position: 'relative' }}>

        {/* Type filter */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => { setShowTypeMenu(v => !v); setShowStatusMenu(false); }}
            style={{
              fontSize: 13, padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)',
              background: filterType !== 'all' ? '#fff0eb' : 'white', cursor: 'pointer',
              color: filterType !== 'all' ? '#C8603A' : '#45464d', display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {filterType === 'all' ? 'Type' : filterType} ▾
          </button>
          {showTypeMenu && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4, background: 'white',
              border: '1px solid rgba(0,0,0,0.10)', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.10)',
              zIndex: 50, minWidth: 120, overflow: 'hidden',
            }}>
              {(['all', 'Worker', 'Vendor', 'Client'] as const).map(t => (
                <button key={t} onClick={() => { setFilterType(t); setShowTypeMenu(false); }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px',
                    fontSize: 13, color: filterType === t ? '#C8603A' : '#0b1c30',
                    background: filterType === t ? '#fff0eb' : 'transparent', border: 'none', cursor: 'pointer',
                  }}
                >
                  {t === 'all' ? 'All types' : t === 'Worker' ? 'Workers' : t === 'Vendor' ? 'Vendors' : 'Clients'}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Status filter */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => { setShowStatusMenu(v => !v); setShowTypeMenu(false); }}
            style={{
              fontSize: 13, padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)',
              background: filterStatus !== 'all' ? '#fff0eb' : 'white', cursor: 'pointer',
              color: filterStatus !== 'all' ? '#C8603A' : '#45464d', display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {filterStatus === 'all' ? 'Status' : filterStatus === 'approved' ? 'Approved' : 'Unapproved'} ▾
          </button>
          {showStatusMenu && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4, background: 'white',
              border: '1px solid rgba(0,0,0,0.10)', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.10)',
              zIndex: 50, minWidth: 130, overflow: 'hidden',
            }}>
              {([
                { key: 'all', label: 'All' },
                { key: 'approved', label: 'Approved' },
                { key: 'unapproved', label: 'Unapproved' },
              ] as const).map(s => (
                <button key={s.key} onClick={() => { setFilterStatus(s.key); setShowStatusMenu(false); }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px',
                    fontSize: 13, color: filterStatus === s.key ? '#C8603A' : '#0b1c30',
                    background: filterStatus === s.key ? '#fff0eb' : 'transparent', border: 'none', cursor: 'pointer',
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search */}
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 160, maxWidth: 280,
          background: 'white', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 8, padding: '6px 10px', gap: 6 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'rgba(0,0,0,0.35)' }}>search</span>
          <input
            value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, color: '#0b1c30', background: 'transparent' }}
          />
        </div>

        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', marginLeft: 'auto' }}>
          {displayed.length} result{displayed.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* STAKEHOLDER TABLE */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-secondary" /></div>
      ) : displayed.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant py-12 text-center">No stakeholders found.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-black/[0.06] overflow-hidden">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                  {['Name', 'Type', 'Trade', 'Phone', 'Paid', ''].map(h => (
                    <th key={h} style={{
                      padding: '10px 16px', fontSize: 10, textTransform: 'uppercase',
                      letterSpacing: '0.06em', color: 'rgba(0,0,0,0.4)', fontWeight: 600,
                      textAlign: h === 'Paid' ? 'right' : 'left', whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayed.map((stk, idx) => {
                  const paid = paidMap?.[stk.stakeholder_id] ?? null;
                  return (
                    <tr
                      key={stk.stakeholder_id}
                      onClick={() => navigate(`/stakeholders/${stk.stakeholder_id}`)}
                      style={{
                        cursor: 'pointer', height: 52,
                        borderBottom: idx < displayed.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.02)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      {/* Name */}
                      <td style={{ padding: '0 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{
                            width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                            background: avatarBg(stk.name), display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.55)',
                          }}>{initials(stk.name)}</span>
                          <div>
                            <p style={{ fontSize: 14, fontWeight: 500, color: '#0b1c30', margin: 0, whiteSpace: 'nowrap' }}>{stk.name}</p>
                            <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', margin: 0, fontFamily: 'Geist, monospace' }}>{stk.stakeholder_id}</p>
                          </div>
                        </div>
                      </td>
                      {/* Type */}
                      <td style={{ padding: '0 16px' }}><TypePill type={stk.type} /></td>
                      {/* Trade */}
                      <td style={{ padding: '0 16px', fontSize: 12, color: 'rgba(0,0,0,0.5)', maxWidth: 160 }}>
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {stk.category || '—'}
                        </span>
                      </td>
                      {/* Phone */}
                      <td style={{ padding: '0 16px', fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
                        {stk.contact
                          ? <a href={`tel:${stk.contact}`} onClick={e => e.stopPropagation()} style={{ color: 'inherit', textDecoration: 'none' }}>{stk.contact}</a>
                          : '—'}
                      </td>
                      {/* Paid */}
                      <td style={{ padding: '0 16px', textAlign: 'right' }}>
                        <span style={{ fontSize: 14, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: '#0b1c30' }}>
                          {paid !== null ? fmt(paid) : '—'}
                        </span>
                      </td>
                      {/* Arrow */}
                      <td style={{ padding: '0 16px 0 0', textAlign: 'right' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 14, color: 'rgba(0,0,0,0.3)' }}>chevron_right</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile list */}
          <div className="md:hidden space-y-px bg-white rounded-xl border border-black/[0.06] overflow-hidden">
            {displayed.map((stk, idx) => {
              const paid = paidMap?.[stk.stakeholder_id] ?? null;
              return (
                <div
                  key={stk.stakeholder_id}
                  onClick={() => navigate(`/stakeholders/${stk.stakeholder_id}`)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer',
                    borderBottom: idx < displayed.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
                  }}
                >
                  <span style={{
                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                    background: avatarBg(stk.name), display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, color: 'rgba(0,0,0,0.55)',
                  }}>{initials(stk.name)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <p style={{ fontSize: 14, fontWeight: 500, color: '#0b1c30', margin: 0 }}>{stk.name}</p>
                      <TypePill type={stk.type} />
                    </div>
                    <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', margin: 0 }}>
                      {stk.category}{stk.contact ? ` · ${stk.contact}` : ''}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: '#0b1c30', margin: 0 }}>
                      {paid !== null ? fmt(paid) : '—'}
                    </p>
                    <span className="material-symbols-outlined" style={{ fontSize: 14, color: 'rgba(0,0,0,0.3)' }}>chevron_right</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
