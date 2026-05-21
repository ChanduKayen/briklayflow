import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import type { Stakeholder, GSTRegType } from '../types';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import { useAuth } from '../lib/auth/AuthProvider';
import { WORKER_TRADE_GROUPS, VENDOR_TRADE_GROUPS, OTHER_TRADE } from '../lib/trades';
import {
  IconDownload, IconPlus, IconUsers, IconClock,
  IconCircleCheck, IconHammer, IconArrowUp, IconSearch,
  IconTag, IconChevronDown, IconBook2, IconDots,
  IconChevronLeft, IconChevronRight, IconTable,
} from '@tabler/icons-react';
import PartySpreadsheet from '../components/PartySpreadsheet';

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

const AVATAR_COLORS = [
  { bg: '#FEF3C7', color: '#92400E' },
  { bg: '#EDE9FE', color: '#4C1D95' },
  { bg: '#DCFCE7', color: '#14532D' },
  { bg: '#FCE7F3', color: '#9D174D' },
  { bg: '#E0F2FE', color: '#075985' },
  { bg: '#FEF9C3', color: '#713F12' },
  { bg: '#F1F5F9', color: '#334155' },
  { bg: '#FFF7ED', color: '#9A3412' },
];

function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h += name.charCodeAt(i);
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initials(name: string) {
  const parts = name.trim().split(' ').filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatINR(amount: number): string {
  if (!amount || isNaN(amount)) return '₹0';
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`;
  if (amount >= 100000)   return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000)     return `₹${(amount / 1000).toFixed(0)}K`;
  return `₹${amount.toLocaleString('en-IN')}`;
}

const CAT_STYLES: Record<string, { bg: string; color: string }> = {
  vendor: { bg: '#F0F9FF', color: '#075985' },
  worker: { bg: '#FFF7ED', color: '#9A3412' },
  client: { bg: '#F0FDF4', color: '#14532D' },
};

export default function Stakeholders({ session }: { session: Session }) {
  const queryClient = useQueryClient();
  const { data: profile } = useUserProfile(session.user.id);
  const { orgId, authState } = useAuth();
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [showSpreadsheet, setShowSpreadsheet] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowForm(true);
      setSearchParams({}, { replace: true });
    }
  }, []);



  // ── New UI state ──────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'all' | 'worker' | 'vendor' | 'client'>('all');
  const [searchQ, setSearchQ] = useState('');
  const pillRef = useRef<HTMLDivElement>(null);
  const segRef  = useRef<HTMLDivElement>(null);

  function movePill(btn: HTMLButtonElement) {
    if (!segRef.current || !pillRef.current) return;
    const sr = segRef.current.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    pillRef.current.style.left  = (br.left - sr.left - 3) + 'px';
    pillRef.current.style.width = br.width + 'px';
  }

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
    queryKey: ['stakeholders', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stakeholders')
        .select('*')
        .eq('org_id', orgId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Stakeholder[];
    },
    enabled: !!orgId,
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
        org_id: orgId,
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
  const orgName = authState.status === 'authenticated' ? authState.context.orgName : '';

  const totalOutstanding = all.reduce((s, p) => s + ((p as any).outstanding ?? 0), 0);
  const advanceParties   = all.filter(p => ((p as any).advance_balance ?? (p as any).advance ?? 0) > 0).length;
  const approvedVendors  = all.filter(s => s.type === 'Vendor' && s.is_approved).length;
  const activeWorkers    = all.filter(s => s.type === 'Worker').length;

  const filtered = all
    .filter(s => activeTab === 'all' || s.type.toLowerCase() === activeTab)
    .filter(s => {
      if (!searchQ) return true;
      const q = searchQ.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.stakeholder_id.toLowerCase().includes(q) ||
        (s.category || '').toLowerCase().includes(q) ||
        (s.contact || '').toLowerCase().includes(q)
      );
    });



  if (showSpreadsheet) {
    return (
      <PartySpreadsheet
        orgId={orgId!}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['stakeholders'] });
          setShowSpreadsheet(false);
        }}
        onCancel={() => setShowSpreadsheet(false)}
      />
    );
  }

  return (
    <div style={{
      background: 'var(--color-background-tertiary)',
      minHeight:  '100vh',
      padding:    '28px 24px',
    }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{
        display:        'flex',
        alignItems:     'flex-end',
        justifyContent: 'space-between',
        marginBottom:   28,
      }}>
        <div>
          {orgName && (
            <div style={{
              fontSize:      10,
              letterSpacing: '.12em',
              color:         'var(--color-text-tertiary)',
              marginBottom:  6,
              textTransform: 'uppercase',
            }}>
              Briklay · {orgName}
            </div>
          )}
          <h1 style={{
            fontSize:      26,
            fontWeight:    500,
            letterSpacing: '-.02em',
            lineHeight:    1,
            color:         'var(--color-text-primary)',
            margin:        0,
          }}>
            Parties
          </h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            title="Export"
            style={{
              width: 36, height: 36,
              borderRadius: 8,
              border:       '0.5px solid var(--color-border-tertiary)',
              background:   'var(--color-background-primary)',
              display:      'flex', alignItems: 'center',
              justifyContent: 'center', cursor: 'pointer',
              color: 'var(--color-text-secondary)',
            }}
          >
            <IconDownload size={16} />
          </button>

          {canManage && (
            <>
              <button
                onClick={() => setShowSpreadsheet(true)}
                title="Add parties in bulk"
                style={{
                  display:      'inline-flex',
                  alignItems:   'center', gap: 6,
                  background:   'var(--color-background-primary)',
                  color:        'var(--color-text-secondary)',
                  border:       '0.5px solid var(--color-border-tertiary)',
                  borderRadius: 8,
                  padding:      '9px 14px',
                  fontSize:     12, fontWeight: 500,
                  cursor:       'pointer',
                  letterSpacing: '.01em',
                }}
              >
                <IconTable size={14} />
                Bulk add
              </button>
              <button
                onClick={() => { setShowForm(true); }}
                style={{
                  display:      'inline-flex',
                  alignItems:   'center', gap: 6,
                  background:   'var(--color-text-primary)',
                  color:        'var(--color-background-primary)',
                  border:       'none',
                  borderRadius: 8,
                  padding:      '9px 16px',
                  fontSize:     12, fontWeight: 500,
                  cursor:       'pointer',
                  letterSpacing: '.01em',
                }}
              >
                <IconPlus size={14} />
                New party
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Metrics band ───────────────────────────────────────────────── */}
      <div style={{
        display:             'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap:                 1,
        background:          'var(--color-border-tertiary)',
        borderRadius:        14,
        overflow:            'hidden',
        border:              '0.5px solid var(--color-border-tertiary)',
        marginBottom:        20,
      }}>
        {([
          {
            label:   'Total outstanding',
            value:   formatINR(totalOutstanding),
            sub:     `${all.length} active parties`,
            SubIcon: IconUsers,
            badge:   '₹3.2L this month',
            bStyle:  'warn',
          },
          {
            label:   'Advances issued',
            value:   formatINR(0),
            sub:     'Pending recovery',
            SubIcon: IconClock,
            badge:   `${advanceParties} parties`,
            bStyle:  'warn',
          },
          {
            label:   'Approved vendors',
            value:   String(approvedVendors),
            sub:     'GST verified',
            SubIcon: IconCircleCheck,
            badge:   '2 this month',
            bStyle:  'up',
          },
          {
            label:   'Active workforce',
            value:   String(activeWorkers),
            sub:     'On-site this week',
            SubIcon: IconHammer,
            badge:   '6 trades',
            bStyle:  'up',
          },
        ] as const).map((m, i) => (
          <div key={i} style={{
            background: 'var(--color-background-primary)',
            padding:    '20px 22px',
          }}>
            <div style={{
              fontSize: 10, letterSpacing: '.09em',
              color: 'var(--color-text-tertiary)', marginBottom: 12,
              textTransform: 'uppercase',
            }}>
              {m.label}
            </div>
            <div style={{
              fontSize: 24, fontWeight: 500,
              letterSpacing: '-.02em', lineHeight: 1,
              color: 'var(--color-text-primary)', marginBottom: 6,
            }}>
              {m.value}
            </div>
            <div style={{
              fontSize: 11, color: 'var(--color-text-tertiary)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <m.SubIcon size={12} />
              {m.sub}
            </div>
            <div style={{
              display:    'inline-flex', alignItems: 'center', gap: 3,
              fontSize:   10, padding: '2px 7px', borderRadius: 20,
              marginTop:  8,
              background: m.bStyle === 'up' ? '#EAF3DE' : '#FAEEDA',
              color:      m.bStyle === 'up' ? '#3B6D11'  : '#633806',
            }}>
              <IconArrowUp size={9} />
              {m.badge}
            </div>
          </div>
        ))}
      </div>

      {/* ── Board ──────────────────────────────────────────────────────── */}
      <div style={{
        background:   'var(--color-background-primary)',
        border:       '0.5px solid var(--color-border-tertiary)',
        borderRadius: 14,
        overflow:     'hidden',
      }}>

        {/* Tabs + tools row */}
        <div style={{
          padding:        '14px 20px',
          borderBottom:   '0.5px solid var(--color-border-tertiary)',
          display:        'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 12,
        }}>

          {/* Segmented control */}
          <div
            ref={segRef}
            style={{
              display:      'inline-flex',
              background:   'var(--color-background-secondary)',
              borderRadius: 8, padding: 3, position: 'relative',
            }}
          >
            {/* Sliding pill */}
            <div
              ref={pillRef}
              style={{
                position:      'absolute',
                top:           3,
                height:        'calc(100% - 6px)',
                background:    'var(--color-background-primary)',
                border:        '0.5px solid var(--color-border-tertiary)',
                borderRadius:  6,
                transition:    'left .22s cubic-bezier(.4,0,.2,1), width .22s cubic-bezier(.4,0,.2,1)',
                pointerEvents: 'none',
              }}
            />
            {(['all', 'vendor', 'worker', 'client'] as const).map(t => (
              <button
                key={t}
                onClick={e => {
                  setActiveTab(t);
                  movePill(e.currentTarget);
                }}
                ref={t === 'all'
                  ? el => { if (el) setTimeout(() => movePill(el), 60); }
                  : undefined
                }
                style={{
                  background:   'none', border: 'none',
                  padding:      '6px 18px',
                  fontSize:     12, letterSpacing: '.01em',
                  color:        activeTab === t
                                  ? 'var(--color-text-primary)'
                                  : 'var(--color-text-tertiary)',
                  fontWeight:   activeTab === t ? 500 : 400,
                  cursor:       'pointer',
                  borderRadius: 6, position: 'relative', zIndex: 1,
                  transition:   'color .15s', whiteSpace: 'nowrap',
                }}
              >
                {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1) + 's'}
              </button>
            ))}
          </div>

          {/* Search + filter pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>

            <div style={{ position: 'relative' }}>
              <IconSearch
                size={13}
                style={{
                  position: 'absolute', left: 9, top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--color-text-tertiary)', pointerEvents: 'none',
                }}
              />
              <input
                placeholder="Search parties..."
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                style={{
                  padding:      '7px 10px 7px 30px',
                  fontSize:     12,
                  border:       '0.5px solid var(--color-border-tertiary)',
                  borderRadius: 7,
                  background:   'var(--color-background-secondary)',
                  color:        'var(--color-text-primary)',
                  outline:      'none', width: 200,
                }}
                onFocus={e => {
                  e.target.style.background   = 'var(--color-background-primary)';
                  e.target.style.borderColor  = 'var(--color-border-secondary)';
                }}
                onBlur={e => {
                  e.target.style.background  = 'var(--color-background-secondary)';
                  e.target.style.borderColor = 'var(--color-border-tertiary)';
                }}
              />
            </div>

            {([
              { label: 'Category', Icon: IconTag },
              { label: 'Status',   Icon: IconCircleCheck },
            ] as const).map(({ label, Icon }) => (
              <button
                key={label}
                style={{
                  display:      'inline-flex', alignItems: 'center', gap: 4,
                  fontSize:     12, color: 'var(--color-text-secondary)',
                  background:   'var(--color-background-secondary)',
                  border:       '0.5px solid var(--color-border-tertiary)',
                  borderRadius: 7, padding: '7px 11px', cursor: 'pointer',
                  whiteSpace:   'nowrap',
                }}
              >
                <Icon size={13} />
                {label}
                <IconChevronDown size={10} />
              </button>
            ))}

          </div>
        </div>

        {/* ── Table ──────────────────────────────────────────────────── */}
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '64px 0' }}>
            <Loader2 className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '32%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '4%' }} />
            </colgroup>
            <thead>
              <tr>
                {['Party', 'Category', 'Trade', 'Status', 'Paid to date', 'Outstanding', ''].map((h, i) => (
                  <th key={i} style={{
                    fontSize:     10, letterSpacing: '.09em',
                    color:        'var(--color-text-tertiary)',
                    fontWeight:   400, padding: '10px 20px',
                    borderBottom: '0.5px solid var(--color-border-tertiary)',
                    textAlign:    i >= 4 && i < 6 ? 'right' : 'left',
                    whiteSpace:   'nowrap',
                    textTransform: 'uppercase',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((party, pi) => {
                const av       = avatarColor(party.name ?? '');
                const typeKey  = (party.type ?? '').toLowerCase();
                const catStyle = CAT_STYLES[typeKey] ?? CAT_STYLES.vendor;
                const paid     = paidMap?.[party.stakeholder_id] ?? 0;
                const outstanding = (party as any).outstanding ?? 0;
                const isWarn   = outstanding > 200000;

                return (
                  <tr
                    key={party.stakeholder_id ?? pi}
                    onClick={() => navigate(`/stakeholders/${party.stakeholder_id}`)}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement)
                        .querySelectorAll('td')
                        .forEach(td => (td as HTMLElement).style.background =
                          'var(--color-background-secondary)');
                      const acts = (e.currentTarget as HTMLElement)
                        .querySelector('.row-acts') as HTMLElement | null;
                      if (acts) acts.style.opacity = '1';
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement)
                        .querySelectorAll('td')
                        .forEach(td => (td as HTMLElement).style.background = '');
                      const acts = (e.currentTarget as HTMLElement)
                        .querySelector('.row-acts') as HTMLElement | null;
                      if (acts) acts.style.opacity = '0';
                    }}
                  >
                    {/* Party name + ID */}
                    <td style={{ padding: '14px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%',
                          background: av.bg, color: av.color,
                          display: 'flex', alignItems: 'center',
                          justifyContent: 'center', flexShrink: 0,
                          fontSize: 11, fontWeight: 500, letterSpacing: '.01em',
                        }}>
                          {initials(party.name ?? '?')}
                        </div>
                        <div>
                          <div style={{
                            fontSize: 13, fontWeight: 500,
                            letterSpacing: '-.005em',
                            color: 'var(--color-text-primary)',
                          }}>
                            {party.name}
                          </div>
                          <div style={{
                            fontSize: 10, color: 'var(--color-text-tertiary)',
                            fontFamily: 'var(--font-mono, monospace)',
                            marginTop: 1, letterSpacing: '.03em',
                          }}>
                            {party.stakeholder_id}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Category (type) pill */}
                    <td style={{ padding: '14px 20px' }}>
                      <span style={{
                        display:       'inline-flex', alignItems: 'center',
                        fontSize:      11, padding: '3px 8px', borderRadius: 5,
                        letterSpacing: '.01em',
                        background:    catStyle.bg,
                        color:         catStyle.color,
                      }}>
                        {party.type}
                      </span>
                    </td>

                    {/* Trade */}
                    <td style={{ padding: '14px 20px' }}>
                      <span style={{
                        fontSize: 12, color: 'var(--color-text-secondary)',
                        display: 'block', overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {party.category || '—'}
                      </span>
                    </td>

                    {/* Status dot */}
                    <td style={{ padding: '14px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{
                          width: 6, height: 6, borderRadius: '50%',
                          background: party.is_approved ? '#22c55e' : '#f59e0b',
                          flexShrink: 0,
                        }} />
                        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                          {party.is_approved ? 'Approved' : 'Pending'}
                        </span>
                      </div>
                    </td>

                    {/* Paid to date */}
                    <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                      <span style={{
                        fontSize: 13, fontWeight: 500,
                        letterSpacing: '-.01em',
                        fontVariantNumeric: 'tabular-nums',
                        color: 'var(--color-text-primary)',
                      }}>
                        {formatINR(paid)}
                      </span>
                    </td>

                    {/* Outstanding */}
                    <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                      <span style={{
                        fontSize: 13, fontWeight: 500,
                        letterSpacing: '-.01em',
                        fontVariantNumeric: 'tabular-nums',
                        color: isWarn ? '#B45309' : 'var(--color-text-primary)',
                      }}>
                        {formatINR(outstanding)}
                      </span>
                    </td>

                    {/* Row actions */}
                    <td style={{ padding: '14px 12px 14px 0' }}>
                      <div
                        className="row-acts"
                        style={{
                          display: 'flex', alignItems: 'center',
                          gap: 6, justifyContent: 'flex-end',
                          opacity: 0, transition: 'opacity .12s',
                        }}
                      >
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            navigate(`/stakeholders/${party.stakeholder_id}`);
                          }}
                          style={{
                            display:      'inline-flex', alignItems: 'center', gap: 3,
                            fontSize:     11, color: 'var(--color-text-secondary)',
                            background:   'none',
                            border:       '0.5px solid var(--color-border-tertiary)',
                            borderRadius: 5, padding: '4px 9px', cursor: 'pointer',
                          }}
                        >
                          <IconBook2 size={12} />
                          Ledger
                        </button>
                        <button
                          onClick={e => e.stopPropagation()}
                          style={{
                            display:        'inline-flex', alignItems: 'center',
                            justifyContent: 'center',
                            color:          'var(--color-text-secondary)',
                            background:     'none',
                            border:         '0.5px solid var(--color-border-tertiary)',
                            borderRadius:   5, padding: '4px 7px', cursor: 'pointer',
                          }}
                        >
                          <IconDots size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{
                    textAlign: 'center', padding: '40px 20px',
                    fontSize: 13, color: 'var(--color-text-tertiary)',
                  }}>
                    No parties found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <div style={{
          padding:        '12px 20px',
          display:        'flex', alignItems: 'center',
          justifyContent: 'space-between',
          borderTop:      '0.5px solid var(--color-border-tertiary)',
        }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            Showing {filtered.length} of {all.length} parties
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['←', '1', '2', '3', '→'] as const).map((p, i) => (
              <button
                key={i}
                style={{
                  width:          28, height: 28, borderRadius: 5,
                  border:         '0.5px solid var(--color-border-tertiary)',
                  background:     i === 1 ? 'var(--color-text-primary)' : 'none',
                  color:          i === 1
                                    ? 'var(--color-background-primary)'
                                    : 'var(--color-text-secondary)',
                  fontSize:       12, cursor: 'pointer',
                  display:        'flex', alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {p === '←' ? <IconChevronLeft size={13} />
                  : p === '→' ? <IconChevronRight size={13} />
                  : p}
              </button>
            ))}
          </div>
        </div>

      </div>

      {/* ── Add party modal ─────────────────────────────────────────── */}
      {showForm && (
        <div
          style={{
            position:       'fixed', inset: 0, zIndex: 100,
            background:     'rgba(0,0,0,0.45)',
            display:        'flex', alignItems: 'center', justifyContent: 'center',
            padding:        24,
          }}
          onClick={() => { setShowForm(false); setFormType('Worker'); resetForm(); }}
        >
          <div
            style={{
              background:  'var(--color-background-primary)',
              borderRadius: 16, overflow: 'hidden',
              maxWidth:    640, width: '100%', maxHeight: '90vh',
              overflowY:   'auto',
              boxShadow:   '0 24px 64px rgba(0,0,0,0.2)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 py-4 bg-surface-container-low border-b border-outline-variant/30">
              <h3 className="text-headline-md font-headline-md">Add New Stakeholder</h3>
              <p className="text-body-sm text-on-surface-variant">Register a new worker or vendor.</p>
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); createStakeholder.mutate(new FormData(e.currentTarget)); }}
              className="p-6"
            >
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
        </div>
      )}

    </div>
  );
}
