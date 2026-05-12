import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import type { Stakeholder, GSTRegType } from '../types';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import { WORKER_TRADE_GROUPS, VENDOR_TRADE_GROUPS, OTHER_TRADE } from '../lib/trades';

// GSTIN: 2 state digits + 5 PAN letters + 4 PAN digits + 1 PAN letter + 1 entity + Z + 1 check
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

export default function Stakeholders({ session }: { session: Session }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: profile } = useUserProfile(session.user.id);
  const [showForm, setShowForm] = useState(false);

  // ── Filter state ──────────────────────────────────────────────────────────
  const [filterType, setFilterType] = useState<'all' | 'Worker' | 'Vendor'>('all');
  const [filterApprovedOnly, setFilterApprovedOnly] = useState(false);

  // ── Form controlled state ─────────────────────────────────────────────────
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

  const resetForm = () => {
    setFormCategory('');
    setFormCategoryOther('');
    resetVendorFields();
  };

  const { data: stakeholders, isLoading } = useQuery({
    queryKey: ['stakeholders'],
    queryFn: async () => {
      const { data, error } = await supabase.from('stakeholders').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data as Stakeholder[];
    },
  });

  const createStakeholder = useMutation({
    mutationFn: async (formData: FormData) => {
      // Validate GSTIN if vendor + not unregistered + value provided
      if (formType === 'Vendor' && gstRegType !== 'Unregistered' && gstinValue) {
        if (!validateGSTIN(gstinValue)) {
          setGstinError('Invalid GSTIN format. Expected format: 37AADCB2230M1Z3');
          throw new Error('Invalid GSTIN');
        }
      }
      const firstName = (formData.get('first_name') as string || '').trim();
      const lastName = (formData.get('last_name') as string || '').trim();
      const fullName = lastName ? `${firstName} ${lastName}` : firstName;
      const resolvedCategory = formCategory === OTHER_TRADE
        ? (formCategoryOther.trim() || 'Other')
        : formCategory;
      const payload: any = {
        stakeholder_id: formData.get('stakeholder_id') as string,
        name: fullName,
        type: formType,
        category: resolvedCategory,
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
          if (ratingQuality > 0) payload.rating_quality = ratingQuality;
          if (ratingPricing > 0) payload.rating_pricing = ratingPricing;
        }
      }
      const { data, error } = await supabase.from('stakeholders').insert([payload]).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stakeholders'] });
      setShowForm(false);
      setFormType('Worker');
      resetForm();
    },
  });

  const canManage = profile?.role === 'management' || profile?.role === 'accountant' || profile?.role === 'principal';

  const displayed = (stakeholders || []).filter((stk) => {
    if (filterType !== 'all' && stk.type !== filterType) return false;
    if (filterApprovedOnly && stk.type === 'Vendor' && !stk.is_approved) return false;
    return true;
  });

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6">
      <div className="flex justify-between items-end mb-stack-lg">
        <h2 className="text-headline-lg font-headline-lg text-primary">Stakeholders</h2>
        {canManage && (
          <button className="bk-btn flex items-center gap-2" onClick={() => { setShowForm(!showForm); if (showForm) { setFormType('Worker'); resetForm(); } }}>
            <span className="material-symbols-outlined text-[18px]">{showForm ? 'close' : 'add'}</span>
            {showForm ? 'Cancel' : 'Add Person'}
          </button>
        )}
      </div>

      {/* ── ADD FORM ─────────────────────────────────────────────────────────── */}
      {showForm && (
        <div className="bg-surface-container-lowest rounded-xl shadow-card border border-outline-variant/30 overflow-hidden mb-stack-lg">
          <div className="px-6 py-4 bg-surface-container-low border-b border-outline-variant/30">
            <h3 className="text-headline-md font-headline-md">Add New Stakeholder</h3>
            <p className="text-body-sm text-on-surface-variant">Register a new worker or vendor.</p>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); createStakeholder.mutate(new FormData(e.currentTarget)); }} className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-stack-lg">

              {/* Shared fields */}
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
                <select
                  className="bk-input"
                  value={formCategory}
                  onChange={(e) => { setFormCategory(e.target.value); setFormCategoryOther(''); }}
                  required
                >
                  <option value="" disabled>Select trade…</option>
                  {(formType === 'Worker' ? WORKER_TRADE_GROUPS : VENDOR_TRADE_GROUPS).map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.trades.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {formCategory === OTHER_TRADE && (
                  <input
                    className="bk-input mt-1"
                    placeholder="Specify trade…"
                    value={formCategoryOther}
                    onChange={(e) => setFormCategoryOther(e.target.value)}
                    autoFocus
                    required
                  />
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

              {/* ── Vendor-only fields ───────────────────────────────── */}
              {formType === 'Vendor' && (
                <>
                  {/* Divider */}
                  <div className="md:col-span-2 border-t border-outline-variant/30 pt-2">
                    <p className="text-label-caps font-label-caps text-on-surface-variant flex items-center gap-2">
                      <span className="material-symbols-outlined text-[14px]">receipt_long</span>
                      GST & COMPLIANCE
                    </p>
                  </div>

                  {/* GST Registration Type */}
                  <div className="space-y-stack-sm">
                    <label className="text-label-caps font-label-caps text-on-surface-variant">GST REGISTRATION TYPE</label>
                    <select className="bk-input" value={gstRegType}
                      onChange={(e) => { setGstRegType(e.target.value as GSTRegType); setGstinValue(''); setGstinError(''); }}>
                      <option value="Regular">Regular</option>
                      <option value="Composition">Composition</option>
                      <option value="Unregistered">Unregistered</option>
                    </select>
                  </div>

                  {/* GSTIN — hidden if Unregistered */}
                  {gstRegType !== 'Unregistered' ? (
                    <div className="space-y-stack-sm">
                      <label className="text-label-caps font-label-caps text-on-surface-variant">GSTIN (OPTIONAL)</label>
                      <input
                        className={`bk-input uppercase tracking-wider font-data-mono ${gstinError ? 'border-error ring-1 ring-error/30' : ''}`}
                        placeholder="37AADCB2230M1Z3"
                        value={gstinValue}
                        onChange={(e) => { setGstinValue(e.target.value.toUpperCase()); setGstinError(''); }}
                        onBlur={() => {
                          if (gstinValue && !validateGSTIN(gstinValue))
                            setGstinError('Invalid format. e.g. 37AADCB2230M1Z3');
                        }}
                        maxLength={15}
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

                  {/* Approved Vendor toggle */}
                  <div className="md:col-span-2 flex items-center justify-between p-4 bg-surface-container-low rounded-xl border border-outline-variant/30">
                    <div>
                      <p className="text-body-sm font-semibold text-on-surface">Approved Vendor</p>
                      <p className="text-[12px] text-on-surface-variant mt-0.5">Mark this vendor as approved for use on projects</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsApproved((v) => !v)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isApproved ? 'bg-secondary' : 'bg-outline-variant/50'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isApproved ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>

                  {/* Vendor Rating */}
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
                        <button type="button"
                          onClick={() => setShowSubRatings((v) => !v)}
                          className="flex items-center gap-1.5 text-[12px] text-primary hover:underline">
                          <span className="material-symbols-outlined text-[14px]">{showSubRatings ? 'expand_less' : 'expand_more'}</span>
                          {showSubRatings ? 'Hide' : 'Add'} subcategory ratings
                        </button>
                      )}

                      {showSubRatings && (
                        <div className="pl-4 border-l-2 border-outline-variant/30 space-y-3">
                          {([
                            { label: 'Delivery', value: ratingDelivery, onChange: setRatingDelivery },
                            { label: 'Quality', value: ratingQuality, onChange: setRatingQuality },
                            { label: 'Pricing', value: ratingPricing, onChange: setRatingPricing },
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

      {/* ── FILTER BAR ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-stack-md">
        {(['all', 'Worker', 'Vendor'] as const).map((t) => (
          <button key={t}
            onClick={() => { setFilterType(t); if (t !== 'Vendor') setFilterApprovedOnly(false); }}
            className={`px-3 py-1.5 rounded-full text-[12px] font-bold transition-colors border ${
              filterType === t
                ? 'bg-primary text-on-primary border-primary'
                : 'border-outline-variant/40 text-on-surface-variant hover:border-primary/40 hover:text-primary'
            }`}>
            {t === 'all' ? 'All' : t === 'Worker' ? 'Workers' : 'Vendors'}
          </button>
        ))}
        {(filterType === 'all' || filterType === 'Vendor') && (
          <button
            onClick={() => setFilterApprovedOnly((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold transition-colors border ${
              filterApprovedOnly
                ? 'bg-green-100 text-green-800 border-green-300'
                : 'border-outline-variant/40 text-on-surface-variant hover:border-green-400 hover:text-green-700'
            }`}>
            <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: filterApprovedOnly ? "'FILL' 1" : "'FILL' 0" }}>verified</span>
            Approved Only
          </button>
        )}
        <span className="text-[12px] text-on-surface-variant ml-auto">{displayed.length} {displayed.length === 1 ? 'result' : 'results'}</span>
      </div>

      {/* ── CARDS GRID ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-stack-md">
        {isLoading && <div className="col-span-full flex justify-center py-8"><Loader2 className="animate-spin text-secondary" /></div>}
        {!isLoading && displayed.length === 0 && (
          <p className="col-span-full text-body-sm text-on-surface-variant py-8 text-center">No stakeholders found.</p>
        )}
        {displayed.map((stk) => (
          <div key={stk.stakeholder_id}
            onClick={() => navigate(`/stakeholders/${stk.stakeholder_id}`)}
            className="bg-surface-container-lowest p-5 rounded-xl shadow-card border border-outline-variant/30 flex flex-col gap-3 cursor-pointer hover:shadow-card-md hover:border-outline-variant/60 transition-all">

            {/* Header row */}
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${stk.type === 'Worker' ? 'bg-primary-container text-on-primary' : 'bg-tertiary-container text-on-tertiary-container'}`}>
                  <span className="material-symbols-outlined">{stk.type === 'Worker' ? 'engineering' : 'store'}</span>
                </div>
                <div>
                  <h3 className="font-body-lg font-bold text-on-surface leading-tight">{stk.name}</h3>
                  <p className="text-label-caps text-on-surface-variant">{stk.stakeholder_id}</p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <span className={`px-2 py-1 text-[10px] font-bold rounded-full ${stk.type === 'Worker' ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-high text-on-surface'}`}>
                  {stk.type?.toUpperCase()}
                </span>
                {stk.type === 'Vendor' && stk.is_approved && (
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-[10px] font-bold">
                    <span className="material-symbols-outlined text-[11px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                    Approved
                  </span>
                )}
              </div>
            </div>

            {/* Details */}
            <div className="text-body-sm text-on-surface-variant space-y-1">
              <p className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px]">label</span>
                {stk.category}
                {stk.type === 'Vendor' && stk.gst_reg_type && (
                  <span className="text-[11px] text-on-surface-variant/60">· {stk.gst_reg_type}</span>
                )}
              </p>
              {stk.contact && <p className="flex items-center gap-2"><span className="material-symbols-outlined text-[16px]">call</span> {stk.contact}</p>}
              {stk.bank_details && <p className="flex items-center gap-2"><span className="material-symbols-outlined text-[16px]">account_balance</span> {stk.bank_details}</p>}
              {stk.type === 'Vendor' && stk.gstin && (
                <p className="flex items-center gap-2 font-data-mono text-[11px]">
                  <span className="material-symbols-outlined text-[16px]">receipt_long</span>
                  {stk.gstin}
                </p>
              )}
            </div>

            {/* Rating row (vendors only) */}
            {stk.type === 'Vendor' && stk.rating != null && stk.rating > 0 && (
              <div className="flex items-center gap-2 pt-2 border-t border-outline-variant/20">
                <StarDisplay value={stk.rating} size={14} />
                <span className="text-[12px] font-semibold text-on-surface">{stk.rating}/5</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
