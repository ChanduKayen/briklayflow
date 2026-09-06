import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Stakeholder, GSTRegType, StakeholderType } from '../types';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import { useAuth } from '../lib/auth/AuthProvider';
import { WORKER_TRADE_GROUPS, VENDOR_TRADE_GROUPS, OTHER_TRADE } from '../lib/trades';
import PartySpreadsheet from '../components/PartySpreadsheet';
import PhoneInput from '../components/PhoneInput';
import { usePrefetchStakeholder } from '../hooks/usePrefetch';
import StakeholderLedgerDrawer from '../components/StakeholderLedgerDrawer';
import { isNewLedgerOrg, loadProjectionMap } from '../lib/ledgerRead';

// ── helpers ─────────────────────────────────────────────────────────────────────
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;
function validateGSTIN(v: string) { return GSTIN_REGEX.test(v.trim().toUpperCase()); }

/** ₹ compact, matching the mockup: Cr / L, else grouped en-IN. */
function fmt(n: number): string {
  n = Number(n) || 0;
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2).replace(/\.?0+$/, '') + 'Cr';
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(1).replace(/\.0$/, '') + 'L';
  return '₹' + n.toLocaleString('en-IN');
}
function initials(name: string) {
  return (name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}

// ── star rating (kept; StarDisplay is imported by StakeholderDetail + the ledger drawer) ──
function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button"
          onMouseEnter={() => setHovered(n)} onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(value === n ? 0 : n)} className="p-0.5 transition-transform hover:scale-110">
          <span className="material-symbols-outlined text-[20px]" style={{
            color: (hovered || value) >= n ? '#B65C38' : '#D9CDB8',
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

type Tab = 'all' | 'vendor' | 'worker' | 'client';
type DrawerForm = {
  name: string; type: StakeholderType; category: string; categoryOther: string;
  contact: string; gstin: string; gstRegType: GSTRegType; isApproved: boolean;
  bank: string; rating: number; rd: number; rq: number; rp: number;
};
const EMPTY_FORM: DrawerForm = {
  name: '', type: 'Vendor', category: '', categoryOther: '', contact: '',
  gstin: '', gstRegType: 'Regular', isApproved: false, bank: '', rating: 0, rd: 0, rq: 0, rp: 0,
};

export default function Stakeholders({ session }: { session: Session }) {
  const queryClient = useQueryClient();
  const { data: profile } = useUserProfile(session.user.id);
  const { orgId, authState } = useAuth();
  const navigate = useNavigate();
  const prefetchStakeholder = usePrefetchStakeholder();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [showSpreadsheet, setShowSpreadsheet] = useState(false);

  // drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);   // null = new
  const [ledgerId, setLedgerId] = useState<string | null>(null);     // party ledger side drawer
  const [form, setForm] = useState<DrawerForm>(EMPTY_FORM);
  const [gstErr, setGstErr] = useState('');
  const [showSub, setShowSub] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const orgName = authState.status === 'authenticated' ? authState.context.orgName : '';
  const canManage = ['management', 'accountant', 'principal'].includes(profile?.role || '');

  // ── data ──────────────────────────────────────────────────────────────────
  const { data: stakeholders, isLoading } = useQuery({
    queryKey: ['stakeholders', orgId],
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stakeholders').select('*').eq('org_id', orgId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Stakeholder[];
    },
  });

  // Paid to date — real, from transactions (scoped to this org).
  const { data: paidMap } = useQuery({
    queryKey: ['stakeholders_paid', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions').select('stakeholder_id, total_amount')
        .eq('org_id', orgId!).eq('status', 'Active');
      const map: Record<string, number> = {};
      (data || []).forEach((t: any) => {
        if (t.stakeholder_id) map[t.stakeholder_id] = (map[t.stakeholder_id] || 0) + Number(t.total_amount);
      });
      return map;
    },
  });

  // Billed — real, from v_party_orders (facts: ordered + billed per project). We sum `billed`
  // per party; Outstanding = billed − paid (the sanctioned composition, no clamped ghost).
  const { data: billedMap } = useQuery({
    queryKey: ['stakeholders_billed', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from('v_party_orders').select('stakeholder_id, billed').eq('org_id', orgId!);
      const map: Record<string, number> = {};
      (data || []).forEach((r: any) => {
        if (r.stakeholder_id) map[r.stakeholder_id] = (map[r.stakeholder_id] || 0) + Number(r.billed || 0);
      });
      return map;
    },
  });

  // New-ledger orgs read the real dues from the allocation projection (INV-12); old orgs keep the
  // billed−paid netting. One switch, so the Parties list and the party ledger never disagree.
  const { data: newLedger } = useQuery({ queryKey: ['org_new_ledger', orgId], enabled: !!orgId, queryFn: () => isNewLedgerOrg(orgId!) });
  const { data: projMap } = useQuery({ queryKey: ['party_projection', orgId], enabled: !!orgId && !!newLedger, queryFn: () => loadProjectionMap(orgId!) });

  const all = stakeholders || [];
  const paidOf = (id: string) => paidMap?.[id] ?? 0;
  const billedOf = (id: string) => billedMap?.[id] ?? 0;
  const outstandingOf = (id: string) => newLedger ? (projMap?.[id]?.toPay ?? 0) : Math.max(billedOf(id) - paidOf(id), 0);
  const creditOf = (id: string) => newLedger ? (projMap?.[id]?.unclassifiedAhead ?? 0) : Math.max(paidOf(id) - billedOf(id), 0);

  // open ?new=1 → new-party drawer
  useEffect(() => {
    if (searchParams.get('new') === '1') { openDrawer(null); setSearchParams({}, { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── KPIs (all honest, from the facts above) ─────────────────────────────────
  const totalOutstanding = all.reduce((s, p) => s + outstandingOf(p.stakeholder_id), 0);
  const advancesIssued   = all.reduce((s, p) => s + creditOf(p.stakeholder_id), 0);
  const advCount         = all.filter((p) => creditOf(p.stakeholder_id) > 0).length;
  const vendorCount      = all.filter((p) => p.type === 'Vendor').length;
  const approvedVendors  = all.filter((p) => p.type === 'Vendor' && p.is_approved).length;
  const workforce        = all.filter((p) => p.type === 'Worker').length;
  const trades           = new Set(all.filter((p) => p.type === 'Worker' && p.category).map((p) => p.category)).size;

  const tabCount = (t: Tab) => t === 'all' ? all.length : all.filter((p) => p.type.toLowerCase() === t).length;

  const rows = all
    .filter((p) => tab === 'all' || p.type.toLowerCase() === tab)
    .filter((p) => {
      if (!q) return true;
      const s = q.toLowerCase();
      return (p.name + ' ' + (p.category || '') + ' ' + (p.contact || '') + ' ' + p.stakeholder_id).toLowerCase().includes(s);
    });

  // ── drawer ──────────────────────────────────────────────────────────────────
  function openDrawer(party: Stakeholder | null) {
    setEditingId(party ? party.stakeholder_id : null);
    setForm(party ? {
      name: party.name, type: party.type, category: party.category || '', categoryOther: '',
      contact: party.contact || '', gstin: party.gstin || '', gstRegType: party.gst_reg_type || 'Regular',
      isApproved: !!party.is_approved, bank: party.bank_details || '',
      rating: party.rating || 0, rd: party.rating_delivery || 0, rq: party.rating_quality || 0, rp: party.rating_pricing || 0,
    } : EMPTY_FORM);
    setGstErr(''); setShowSub(false); setDirty(false); setSaving(false);
    setDrawerOpen(true);
    document.body.style.overflow = 'hidden';
    setTimeout(() => nameRef.current?.focus(), party ? 340 : 300);
  }
  function closeDrawer() {
    setDrawerOpen(false);
    document.body.style.overflow = '';
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDrawer(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  const set = <K extends keyof DrawerForm>(k: K, v: DrawerForm[K]) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };

  // toast
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef<number | undefined>(undefined);
  function toast(msg: string) {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(''), 2400);
  }

  const isVendor = form.type === 'Vendor';
  const isClient = form.type === 'Client';

  async function saveParty() {
    if (!canManage) return;
    const name = form.name.trim();
    if (!name) { nameRef.current?.focus(); toast('Give this party a name first'); return; }
    if (isVendor && form.gstRegType !== 'Unregistered' && form.gstin && !validateGSTIN(form.gstin)) {
      setGstErr('Invalid GSTIN — e.g. 37AADCB2230M1Z3'); return;
    }
    const category = form.category === OTHER_TRADE ? (form.categoryOther.trim() || 'Other') : form.category;

    const payload: Record<string, unknown> = {
      name, type: form.type, category,
      contact: form.contact.trim() || null,
      bank_details: form.bank.trim() || null,
      org_id: orgId,
    };
    if (isVendor) {
      payload.gst_reg_type = form.gstRegType;
      payload.gstin = form.gstRegType !== 'Unregistered' && form.gstin ? form.gstin.toUpperCase() : null;
      payload.is_approved = form.isApproved;
      payload.rating = form.rating > 0 ? form.rating : null;
      payload.rating_delivery = form.rating > 0 && form.rd > 0 ? form.rd : null;
      payload.rating_quality = form.rating > 0 && form.rq > 0 ? form.rq : null;
      payload.rating_pricing = form.rating > 0 && form.rp > 0 ? form.rp : null;
    } else {
      payload.gstin = null; payload.gst_reg_type = null; payload.is_approved = false;
      payload.rating = null; payload.rating_delivery = null; payload.rating_quality = null; payload.rating_pricing = null;
    }

    setSaving(true);
    try {
      if (editingId) {
        const { error } = await supabase.from('stakeholders').update(payload).eq('stakeholder_id', editingId);
        if (error) throw error;
        toast(`Saved — ${name}`);
      } else {
        payload.stakeholder_id = `STK-${Math.floor(1000 + Math.random() * 9000)}`;
        const { error } = await supabase.from('stakeholders').insert([payload]);
        if (error) throw error;
        toast(`Added — ${name}`);
      }
      queryClient.invalidateQueries({ queryKey: ['stakeholders'] });
      setDirty(false); closeDrawer();
    } catch (e: any) {
      toast(e?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  // export the current view as CSV
  function exportCsv() {
    const head = ['ID', 'Name', 'Category', 'Trade', 'Phone', 'GSTIN', 'Paid to date', 'Outstanding'];
    const lines = rows.map((p) => [
      p.stakeholder_id, p.name, p.type, p.category || '', p.contact || '', p.gstin || '',
      paidOf(p.stakeholder_id), outstandingOf(p.stakeholder_id),
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'parties.csv'; a.click();
    URL.revokeObjectURL(url);
    toast('Exported — check your downloads');
  }

  function statusOf(p: Stakeholder): { dot: string; label: string } {
    if (p.type === 'Vendor') return p.is_approved ? { dot: 'active', label: 'Approved' } : { dot: 'onsite', label: 'Pending' };
    return { dot: 'active', label: 'Active' };
  }

  const gradeTrades = isClient ? [] : (form.type === 'Worker' ? WORKER_TRADE_GROUPS : VENDOR_TRADE_GROUPS);

  return (
    <div className="pt">
      <style>{CSS}</style>
      <div className="wrap">

        {/* ── header ── */}
        <div className="eyebrow">Briklay{orgName ? <> · <b>{orgName}</b></> : null}</div>
        <div className="head">
          <div>
            <h1>Parties</h1>
            <div className="head-sub">Every vendor, worker and client on your books — who they are, what they&rsquo;re owed, and what they owe you.</div>
          </div>
          <div className="actions">
            <button className="btn" onClick={exportCsv}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              Export
            </button>
            {canManage && <button className="btn" onClick={() => setShowSpreadsheet(true)}>Bulk add</button>}
            {canManage && <button className="btn primary" onClick={() => openDrawer(null)}>+ New party</button>}
          </div>
        </div>

        {/* ── ledger strip ── */}
        <div className="ledger">
          <div className="cell">
            <div className="k">Total outstanding</div>
            <div className="v"><span className="rupee">₹</span>{fmt(totalOutstanding).slice(1)}</div>
            <div className="s">{all.length} {all.length === 1 ? 'party' : 'parties'} on your books</div>
            <span className="delta warm">↑ settle oldest first</span>
          </div>
          <div className="cell">
            <div className="k">In credit to you</div>
            <div className="v"><span className="rupee">₹</span>{fmt(advancesIssued).slice(1)}</div>
            <div className="s">Paid ahead of bills</div>
            <span className="delta">{advCount} {advCount === 1 ? 'party' : 'parties'}</span>
          </div>
          <div className="cell">
            <div className="k">Approved vendors</div>
            <div className="v">{approvedVendors}</div>
            <div className="s">GST verified</div>
            <span className="delta">of {vendorCount} {vendorCount === 1 ? 'vendor' : 'vendors'}</span>
          </div>
          <div className="cell">
            <div className="k">Active workforce</div>
            <div className="v">{workforce}</div>
            <div className="s">Workers on your books</div>
            <span className="delta">{trades} {trades === 1 ? 'trade' : 'trades'}</span>
          </div>
        </div>

        {/* ── controls ── */}
        <div className="controls">
          <div className="tabs" role="tablist">
            {([['all', 'All'], ['vendor', 'Vendors'], ['worker', 'Workers'], ['client', 'Clients']] as [Tab, string][]).map(([v, l]) => (
              <button key={v} className={`tab ${tab === v ? 'on' : ''}`} role="tab" aria-selected={tab === v} onClick={() => setTab(v)}>
                {l} <span className="n">{tabCount(v)}</span>
              </button>
            ))}
          </div>
          <div className="search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input type="text" placeholder="Search by name, trade or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        {/* ── table ── */}
        <div className="tablecard">
          <div className="tscroll"><table>
            <thead>
              <tr>
                <th style={{ width: '34%' }}>Party</th>
                <th className="hide-sm">Category</th>
                <th className="hide-sm">Trade</th>
                <th>Status</th>
                <th className="num">Paid to date</th>
                <th className="num">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const st = statusOf(p);
                const out = outstandingOf(p.stakeholder_id);
                const pf = prefetchStakeholder(p.stakeholder_id);
                return (
                  <tr key={p.stakeholder_id} className="row" tabIndex={0}
                    onClick={() => setLedgerId(p.stakeholder_id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setLedgerId(p.stakeholder_id); }}
                    onMouseEnter={pf.onMouseEnter} onTouchStart={pf.onTouchStart} onPointerDown={pf.onPointerDown}>
                    <td>
                      <div className="pid">
                        <div className={`avatar ${p.type.toLowerCase()}`}>{initials(p.name)}</div>
                        <div>
                          <div className="pname">{p.name}{p.gstin ? <span className="gst">✓ GST</span> : null}</div>
                          <div className="psub">{p.contact || p.stakeholder_id}</div>
                        </div>
                        <button className="edit-ic" aria-label={`Edit ${p.name}`} title="Edit party"
                          onClick={(e) => { e.stopPropagation(); openDrawer(p); }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                        </button>
                      </div>
                    </td>
                    <td className="hide-sm"><span className="cat">{p.type}</span></td>
                    <td className="hide-sm"><span className="trade">{p.category || '—'}</span></td>
                    <td><span className="status"><span className={`dot ${st.dot}`} />{st.label}</span></td>
                    <td className="mono-cell">{fmt(paidOf(p.stakeholder_id))}</td>
                    <td className={`mono-cell ${out > 0 ? 'due' : 'zero'}`}>{out > 0 ? fmt(out) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>

          {!isLoading && rows.length === 0 && (
            <div className="empty">
              <h3>Nobody here yet</h3>
              <p>Add your first vendor, worker or client and payments will start tying themselves to people automatically.</p>
              {canManage && <button className="btn primary" onClick={() => openDrawer(null)}>+ New party</button>}
            </div>
          )}
          {isLoading && <div className="empty"><p>Loading your parties…</p></div>}

          <div className="tfoot">
            <span>Showing {rows.length} of {all.length} parties</span>
            <span>Tap a row to open the ledger · pencil to edit</span>
          </div>
        </div>
      </div>

      {/* ── drawer ── */}
      <div className={`scrim ${drawerOpen ? 'open' : ''}`} onClick={closeDrawer} />
      {/* host clips the off-canvas drawer so a closed (translated-off-screen) panel can't
          add horizontal page scroll — a fixed element parked past the right edge otherwise
          widens the scroll area. The drawer is absolute WITHIN this overflow-hidden host. */}
      <div className="drawer-host">
      <aside className={`drawer ${drawerOpen ? 'open' : ''}`} aria-label="Edit party">
        <div className="d-head">
          <div className="d-eyebrow">
            <span>{editingId ? 'Edit party' : 'New party'}{dirty && <span className="dirty-chip on">Unsaved</span>}</span>
            <button className="d-close" onClick={closeDrawer} aria-label="Close">×</button>
          </div>
          <div className={`name-wrap ${dirty ? '' : ''}`}>
            <input ref={nameRef} className="d-name-input" placeholder="Party name…" value={form.name}
              disabled={!canManage} onChange={(e) => set('name', e.target.value)} />
          </div>
          {editingId && (
            <button className="ledger-link" onClick={() => navigate(`/stakeholders/${editingId}`)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
              View full ledger
            </button>
          )}
        </div>

        {/* money — read-only, real */}
        {editingId && (
          <div className="d-money">
            <div className="m"><div className="mk">Paid to date</div><div className="mv">{fmt(paidOf(editingId))}</div></div>
            {creditOf(editingId) > 0
              ? <div className="m"><div className="mk">In credit to you</div><div className="mv" style={{ color: 'var(--sage)' }}>{fmt(creditOf(editingId))}</div></div>
              : <div className="m"><div className="mk">Outstanding</div><div className={`mv ${outstandingOf(editingId) > 0 ? 'due' : ''}`}>{outstandingOf(editingId) > 0 ? fmt(outstandingOf(editingId)) : '—'}</div></div>}
          </div>
        )}

        <div className="d-body">
          <div className="f-sect">Identity</div>

          <div className="field"><label>Category</label>
            <div className="seg">
              {(['Vendor', 'Worker', 'Client'] as StakeholderType[]).map((t) => (
                <button key={t} type="button" className={form.type === t ? 'on' : ''}
                  disabled={!canManage}
                  onClick={() => { set('type', t); set('category', ''); set('categoryOther', ''); }}>{t}</button>
              ))}
            </div>
          </div>

          {isClient ? (
            <div className="field"><label>Role / contract</label>
              <input placeholder="e.g. Flat 302 · Sai Enclave" value={form.category}
                disabled={!canManage} onChange={(e) => set('category', e.target.value)} /></div>
          ) : (
            <>
              <div className="field"><label>Trade / role</label>
                <select value={form.category} disabled={!canManage} onChange={(e) => { set('category', e.target.value); set('categoryOther', ''); }}>
                  <option value="">Select trade…</option>
                  {gradeTrades.map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.trades.map((t) => <option key={t} value={t}>{t}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              {form.category === OTHER_TRADE && (
                <div className="field"><label>Specify trade</label>
                  <input autoFocus placeholder="Type the trade…" value={form.categoryOther}
                    disabled={!canManage} onChange={(e) => set('categoryOther', e.target.value)} /></div>
              )}
            </>
          )}

          <div className="field"><label>Phone</label>
            <PhoneInput value={form.contact} disabled={!canManage} placeholder="98765 43210"
              style={{ width: 210, height: 38 }} onChange={(local) => set('contact', local)} /></div>

          <div className="field"><label>Bank / UPI</label>
            <input className="m" placeholder="Account no / UPI id" value={form.bank}
              disabled={!canManage} onChange={(e) => set('bank', e.target.value)} /></div>

          {/* vendor-only: GST + rating */}
          {isVendor && (
            <>
              <div className="f-sect">GST &amp; compliance</div>
              <div className="field"><label>GST reg. type</label>
                <select value={form.gstRegType} disabled={!canManage}
                  onChange={(e) => { set('gstRegType', e.target.value as GSTRegType); set('gstin', ''); setGstErr(''); }}>
                  <option value="Regular">Regular</option>
                  <option value="Composition">Composition</option>
                  <option value="Unregistered">Unregistered</option>
                </select>
              </div>
              {form.gstRegType !== 'Unregistered' && (
                <div className="field col">
                  <label>GSTIN <span style={{ color: 'var(--ink-faint)' }}>· optional</span></label>
                  <input className="m" style={{ textAlign: 'left', textTransform: 'uppercase', letterSpacing: '.05em' }}
                    placeholder="37AADCB2230M1Z3" maxLength={15} value={form.gstin} disabled={!canManage}
                    onChange={(e) => { set('gstin', e.target.value.toUpperCase()); setGstErr(''); }}
                    onBlur={() => { if (form.gstin && !validateGSTIN(form.gstin)) setGstErr('Invalid format — e.g. 37AADCB2230M1Z3'); }} />
                  {gstErr && <span style={{ fontSize: 11, color: 'var(--terracotta)', marginTop: 4 }}>{gstErr}</span>}
                </div>
              )}
              <div className="field"><label>Approved vendor</label>
                <button type="button" className={`switch ${form.isApproved ? 'on' : ''}`} disabled={!canManage}
                  onClick={() => set('isApproved', !form.isApproved)} aria-pressed={form.isApproved}><span /></button>
              </div>

              <div className="f-sect">Vendor rating</div>
              <div className="field"><label>Overall</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <StarRating value={form.rating} onChange={(v) => set('rating', v)} />
                  {form.rating > 0 && <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--ink-soft)' }}>{form.rating}/5</span>}
                </div>
              </div>
              {form.rating > 0 && (
                <>
                  <button type="button" className="sub-toggle" onClick={() => setShowSub((s) => !s)}>
                    {showSub ? '− Hide' : '+ Add'} delivery · quality · pricing
                  </button>
                  {showSub && ([['Delivery', 'rd'], ['Quality', 'rq'], ['Pricing', 'rp']] as [string, 'rd' | 'rq' | 'rp'][]).map(([lbl, key]) => (
                    <div className="field" key={key}><label>{lbl}</label>
                      <StarRating value={form[key]} onChange={(v) => set(key, v)} /></div>
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {canManage && (
          <div className="d-foot">
            <button className={`btn primary ${dirty ? 'dirty' : ''}`} style={{ flex: 1, justifyContent: 'center', padding: 12 }}
              onClick={saveParty} disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add party'}
            </button>
          </div>
        )}
      </aside>
      </div>

      {/* party ledger — the same ledger as the /stakeholders/:id page, opened from the side */}
      <StakeholderLedgerDrawer isOpen={!!ledgerId} onClose={() => setLedgerId(null)} stakeholderId={ledgerId ?? ''} />

      {/* toast */}
      <div className={`toast ${toastMsg ? 'show' : ''}`}>{toastMsg}</div>

      {/* bulk add (existing spreadsheet) */}
      {showSpreadsheet && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'var(--cream, #F6F1E8)', overflow: 'auto' }}>
          <PartySpreadsheet
            orgId={orgId!}
            onSaved={() => { queryClient.invalidateQueries({ queryKey: ['stakeholders'] }); setShowSpreadsheet(false); }}
            onCancel={() => setShowSpreadsheet(false)}
          />
        </div>
      )}
    </div>
  );
}

// ── scoped styles (ported from the mockup, prefixed under .pt) ────────────────────
const CSS = `
.pt{
  --cream:#F6F1E8;--paper:#FCFAF4;--ink:#332A20;--ink-soft:#77695A;--ink-faint:#A2937F;
  --line:#E7DCC9;--line-soft:#EFE7D7;--terracotta:#B65C38;--terracotta-tint:#F3E2D7;
  --sage:#77875F;--sage-tint:#E7EBDC;--walnut:#6E5B44;--walnut-tint:#EDE4D5;
  background:#FBF9F6;color:var(--ink);font-family:'DM Sans',sans-serif;font-size:14.5px;line-height:1.5;
  min-height:100vh;-webkit-font-smoothing:antialiased;
}
.pt *{box-sizing:border-box}
.pt .wrap{max-width:1180px;margin:0 auto;padding:44px 40px 90px}
.pt .eyebrow{font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink-faint)}
.pt .eyebrow b{color:var(--terracotta);font-weight:500}
.pt .head{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-top:10px}
.pt h1{font-family:'Playfair Display',serif;font-weight:600;font-size:44px;letter-spacing:-.01em;line-height:1.05;margin:0}
.pt .head-sub{color:var(--ink-soft);margin-top:8px;max-width:52ch}
.pt .actions{display:flex;gap:10px;align-items:center;flex-shrink:0}
.pt .btn{font-family:'DM Sans',sans-serif;font-size:13.5px;font-weight:500;border:1px solid var(--line);background:var(--paper);color:var(--ink);padding:9px 16px;border-radius:999px;cursor:pointer;transition:border-color .15s,background .15s,transform .1s;display:inline-flex;align-items:center;gap:7px}
.pt .btn:hover{border-color:var(--ink-faint)}
.pt .btn:active{transform:translateY(1px)}
.pt .btn:disabled{opacity:.5;cursor:default}
.pt .btn.primary{background:var(--ink);border-color:var(--ink);color:var(--cream)}
.pt .btn.primary:hover{background:#241d15}
.pt .btn:focus-visible,.pt .tab:focus-visible,.pt tr.row:focus-visible{outline:2px solid var(--terracotta);outline-offset:2px}

.pt .ledger{margin-top:36px;border-top:1px solid var(--ink);border-bottom:1px solid var(--line);display:grid;grid-template-columns:repeat(4,1fr);background:linear-gradient(180deg,rgba(252,250,244,.6),transparent)}
.pt .ledger .cell{padding:22px 26px 24px;border-left:1px solid var(--line-soft)}
.pt .ledger .cell:first-child{border-left:none;padding-left:4px}
.pt .cell .k{font-family:'DM Mono',monospace;font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-faint)}
.pt .cell .v{font-family:'DM Mono',monospace;font-size:30px;font-weight:500;margin-top:10px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.pt .cell .v .rupee{font-size:20px;color:var(--ink-soft);margin-right:2px}
.pt .cell .s{font-size:12.5px;color:var(--ink-soft);margin-top:5px}
.pt .delta{display:inline-block;margin-top:10px;font-family:'DM Mono',monospace;font-size:11px;color:var(--sage);background:var(--sage-tint);border-radius:999px;padding:3px 10px}
.pt .delta.warm{color:var(--terracotta);background:var(--terracotta-tint)}

.pt .controls{display:flex;align-items:center;justify-content:space-between;gap:18px;margin:30px 0 0;flex-wrap:wrap}
.pt .tabs{display:flex;gap:2px;background:var(--paper);border:1px solid var(--line);border-radius:999px;padding:4px}
.pt .tab{border:none;background:transparent;font-family:'DM Sans',sans-serif;font-size:13.5px;color:var(--ink-soft);padding:7px 16px;border-radius:999px;cursor:pointer;display:flex;align-items:center;gap:7px;transition:color .15s,background .15s}
.pt .tab .n{font-family:'DM Mono',monospace;font-size:11px;color:var(--ink-faint)}
.pt .tab.on{background:var(--ink);color:var(--cream)}
.pt .tab.on .n{color:rgba(246,241,232,.65)}
.pt .search{flex:1;min-width:220px;max-width:340px;display:flex;align-items:center;gap:9px;background:var(--paper);border:1px solid var(--line);border-radius:999px;padding:9px 16px;transition:border-color .15s}
.pt .search:focus-within{border-color:var(--ink-faint)}
.pt .search svg{flex-shrink:0;opacity:.45}
.pt .search input{border:none;background:transparent;outline:none;width:100%;font-family:'DM Sans',sans-serif;font-size:13.5px;color:var(--ink)}
.pt .search input::placeholder{color:var(--ink-faint)}

.pt .tablecard{margin-top:18px;background:var(--paper);border:1px solid var(--line);border-radius:18px;overflow:hidden}
.pt table{width:100%;border-collapse:collapse}
.pt thead th{font-family:'DM Mono',monospace;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-faint);font-weight:400;text-align:left;padding:14px 18px;border-bottom:1px solid var(--line)}
.pt thead th.num{text-align:right}
.pt tr.row{cursor:pointer;transition:background .12s}
.pt tr.row:hover{background:var(--cream)}
.pt tr.row td{padding:15px 18px;border-bottom:1px solid var(--line-soft);vertical-align:middle}
.pt tr.row:last-child td{border-bottom:none}
.pt .mono-cell{font-family:'DM Mono',monospace;font-size:13.5px;font-variant-numeric:tabular-nums;text-align:right}
.pt .mono-cell.zero{color:var(--ink-faint)}
.pt .mono-cell.due{color:var(--terracotta);font-weight:500}
.pt .pid{display:flex;align-items:center;gap:14px}
.pt .edit-ic{margin-left:auto;width:30px;height:30px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;color:var(--ink-faint);background:transparent;border:0;cursor:pointer;opacity:0;transition:opacity .15s,background .15s,color .15s;flex-shrink:0}
.pt .row:hover .edit-ic,.pt .row:focus-within .edit-ic{opacity:1}
.pt .edit-ic:hover{background:var(--line);color:var(--ink)}
.pt .edit-ic svg{width:15px;height:15px}
@media (hover:none){.pt .edit-ic{opacity:1}}
.pt .avatar{width:38px;height:38px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-size:15px;font-weight:600}
.pt .avatar.vendor{background:var(--terracotta-tint);color:var(--terracotta)}
.pt .avatar.worker{background:var(--sage-tint);color:var(--sage)}
.pt .avatar.client{background:var(--walnut-tint);color:var(--walnut)}
.pt .pname{font-family:'Playfair Display',serif;font-size:16.5px;font-weight:500;letter-spacing:.005em}
.pt .psub{font-family:'DM Mono',monospace;font-size:11.5px;color:var(--ink-faint);margin-top:2px}
.pt .cat{font-size:13px;color:var(--ink-soft);text-transform:capitalize}
.pt .trade{font-size:13.5px;color:var(--ink)}
.pt .gst{display:inline-flex;align-items:center;gap:5px;font-family:'DM Mono',monospace;font-size:10.5px;color:var(--sage);margin-left:8px;vertical-align:1px}
.pt .status{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-soft)}
.pt .dot{width:7px;height:7px;border-radius:50%}
.pt .dot.active{background:var(--sage)}
.pt .dot.inactive{background:var(--ink-faint)}
.pt .dot.onsite{background:var(--terracotta)}
.pt .empty{padding:70px 30px;text-align:center}
.pt .empty h3{font-family:'Playfair Display',serif;font-style:italic;font-weight:500;font-size:22px}
.pt .empty p{color:var(--ink-soft);margin:8px auto 18px;max-width:38ch}
.pt .tfoot{display:flex;align-items:center;justify-content:space-between;padding:13px 18px;border-top:1px solid var(--line);font-family:'DM Mono',monospace;font-size:11.5px;color:var(--ink-faint)}

.pt .scrim{position:fixed;inset:0;background:rgba(51,42,32,.32);opacity:0;pointer-events:none;transition:opacity .25s;z-index:40}
.pt .scrim.open{opacity:1;pointer-events:auto}
.pt .drawer-host{position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:50}
.pt .drawer{position:absolute;top:0;right:0;bottom:0;width:min(600px,100%);pointer-events:auto;background:var(--cream);border-left:1px solid var(--line);transform:translateX(100%);transition:transform .3s cubic-bezier(.32,.72,.24,1);display:flex;flex-direction:column;box-shadow:-24px 0 60px rgba(51,42,32,.12)}
.pt .drawer.open{transform:translateX(0)}
.pt .d-head{padding:26px 28px 20px;border-bottom:1px solid var(--line)}
.pt .d-eyebrow{font-family:'DM Mono',monospace;font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--ink-faint);display:flex;justify-content:space-between;align-items:center}
.pt .d-close{border:none;background:none;cursor:pointer;color:var(--ink-soft);font-size:18px;line-height:1;padding:4px}
.pt .d-close:hover{color:var(--ink)}
.pt .d-name-input{width:100%;border:none;background:transparent;outline:none;margin-top:12px;font-family:'Playfair Display',serif;font-size:27px;font-weight:600;color:var(--ink);border-bottom:1px dashed transparent;padding-bottom:3px;transition:border-color .15s}
.pt .d-name-input:hover,.pt .d-name-input:focus{border-bottom-color:var(--line)}
.pt .d-name-input::placeholder{color:var(--ink-faint);font-style:italic;font-weight:500}
.pt .ledger-link{margin-top:12px;border:none;background:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:12.5px;color:var(--terracotta);display:inline-flex;align-items:center;gap:6px;padding:0}
.pt .ledger-link:hover{text-decoration:underline;text-underline-offset:3px}
.pt .dirty-chip{display:none;align-items:center;gap:6px;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--terracotta);background:var(--terracotta-tint);border-radius:999px;padding:3px 10px;margin-left:10px}
.pt .dirty-chip::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--terracotta)}
.pt .dirty-chip.on{display:inline-flex}
.pt .btn.primary.dirty{background:var(--terracotta);border-color:var(--terracotta)}
.pt .btn.primary.dirty:hover{background:#a04e2e}
.pt .d-money{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line);border-bottom:1px solid var(--line)}
.pt .d-money .m{background:var(--paper);padding:16px 28px}
.pt .d-money .mk{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-faint)}
.pt .d-money .mv{font-family:'DM Mono',monospace;font-size:21px;margin-top:6px;font-variant-numeric:tabular-nums}
.pt .d-money .mv.due{color:var(--terracotta)}
.pt .d-body{flex:1;overflow-y:auto;padding:10px 28px 20px}
.pt .f-sect{font-family:'DM Mono',monospace;font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--ink-faint);margin:24px 0 4px}
.pt .field{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 10px;margin:0 -10px;border-bottom:1px solid var(--line-soft);transition:background .15s}
.pt .field:hover{background:rgba(252,250,244,.7)}
.pt .field label{font-size:13px;color:var(--ink-soft);flex-shrink:0;width:120px}
.pt .field input,.pt .field select{flex:1;border:none;background:transparent;outline:none;text-align:right;font-family:'DM Sans',sans-serif;font-size:14px;color:var(--ink);border-bottom:1px dashed transparent;transition:border-color .15s;padding:2px 0}
.pt .field input.m{font-family:'DM Mono',monospace;font-size:13px}
.pt .field input:hover,.pt .field select:hover{border-bottom-color:var(--line)}
.pt .field input:focus,.pt .field select:focus{border-bottom-color:var(--terracotta);border-bottom-style:solid}
.pt .field input::placeholder{color:var(--ink-faint)}
.pt .field input:disabled,.pt .field select:disabled{opacity:.7;cursor:default}
.pt .field select{appearance:none;cursor:pointer;text-align:right}
.pt .field.col{flex-direction:column;align-items:stretch}
.pt .field.col label{width:auto;margin-bottom:6px}
.pt .field.col input{text-align:left}
.pt .seg{display:flex;gap:2px;background:var(--paper);border:1px solid var(--line);border-radius:999px;padding:3px}
.pt .seg button{border:none;background:transparent;font-family:'DM Sans',sans-serif;font-size:12.5px;color:var(--ink-soft);padding:5px 13px;border-radius:999px;cursor:pointer}
.pt .seg button.on{background:var(--ink);color:var(--cream)}
.pt .seg button:disabled{cursor:default}
.pt .switch{width:42px;height:24px;border-radius:999px;border:none;background:var(--line);position:relative;cursor:pointer;transition:background .15s;flex-shrink:0}
.pt .switch.on{background:var(--sage)}
.pt .switch span{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 2px rgba(0,0,0,.18)}
.pt .switch.on span{left:21px}
.pt .switch:disabled{opacity:.6;cursor:default}
.pt .sub-toggle{border:none;background:none;color:var(--terracotta);font-size:12.5px;cursor:pointer;padding:10px 0 2px;font-family:'DM Sans',sans-serif}
.pt .sub-toggle:hover{text-decoration:underline;text-underline-offset:3px}
.pt .d-foot{padding:18px 28px;border-top:1px solid var(--line);display:flex;gap:10px;align-items:center;background:var(--cream)}

.pt .toast{position:fixed;bottom:28px;left:50%;transform:translate(-50%,16px);opacity:0;background:var(--ink);color:var(--cream);font-size:13px;padding:10px 20px;border-radius:999px;transition:all .3s;z-index:60;pointer-events:none;font-family:'DM Sans',sans-serif}
.pt .toast.show{opacity:1;transform:translate(-50%,0)}

@media(prefers-reduced-motion:reduce){.pt *{transition:none!important;animation:none!important}}
@media(max-width:900px){
  .pt .wrap{padding:28px 18px 70px}
  .pt .ledger{grid-template-columns:1fr 1fr}
  .pt .ledger .cell{padding:18px;border-left:none;border-top:1px solid var(--line-soft)}
  .pt .ledger .cell:nth-child(-n+2){border-top:none}
  .pt h1{font-size:34px}
  .pt .hide-sm{display:none}
}
`;
