import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useSnackbar } from '../components/Snackbar';
import { useOrgId } from '../lib/auth/AuthProvider';
import type { Session } from '@supabase/supabase-js';
import type { Stakeholder, Project } from '../types';
import { subtract, applyPercent, sum, parseAmount } from '../lib/money';

// ── Helpers ───────────────────────────────────────────────────────────────────

type BillType = 'progress' | 'final' | 'advance';

const BILL_TYPES: { key: BillType; label: string; tag: string; desc: string }[] = [
  {
    key: 'progress',
    label: 'Progress Bill',
    tag: 'Running Account Bill',
    desc: 'Milestone or stage-based billing as work progresses',
  },
  {
    key: 'final',
    label: 'Final Bill',
    tag: 'Project Closeout',
    desc: 'Complete settlement — total less all previous bills',
  },
  {
    key: 'advance',
    label: 'Advance Bill',
    tag: 'Advance Request',
    desc: 'Pre-mobilization or advance payment request',
  },
];

function SectionLabel({ n, title }: { n: string; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <span className="text-[10px] font-bold text-on-surface-variant/40">{n}</span>
      <span className="h-px flex-1 bg-outline-variant/20" />
      <span className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-[0.1em]">{title}</span>
    </div>
  );
}


function fmtPreview(n: number) {
  if (n === 0) return '—';
  // Indian number format with comma spacing
  return n.toLocaleString('en-IN');
}

async function genBillNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `BIL-${year}-`;
  const { data } = await supabase
    .from('client_invoices')
    .select('invoice_id')
    .like('invoice_id', `${prefix}%`)
    .order('invoice_id', { ascending: false })
    .limit(1);
  let seq = 1;
  if (data && data.length > 0) {
    const last = data[0].invoice_id as string;
    const num = parseInt(last.replace(prefix, ''), 10);
    if (!isNaN(num)) seq = num + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NewBill({ session }: { session: Session }) {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { show: showSnackbar } = useSnackbar();
  const orgId = useOrgId();

  // Pre-fill from navigation state (e.g. from NewTransaction)
  const navState = (location.state as any) || {};

  // ── Bill ID ──────────────────────────────────────────────────────────────
  const [billId, setBillId] = useState('');
  const [billIdCopied, setBillIdCopied] = useState(false);

  useEffect(() => {
    genBillNumber().then(setBillId);
  }, []);

  // ── Form State ───────────────────────────────────────────────────────────
  const [billType, setBillType] = useState<BillType>('progress');
  const [clientId, setClientId] = useState<string>(navState.clientId || '');
  const [clientSearch, setClientSearch] = useState('');
  const [showClientSug, setShowClientSug] = useState(false);
  const [showClientCreate, setShowClientCreate] = useState(false);
  const [projectId, setProjectId] = useState<string>(navState.projectId || '');
  const [milestoneName, setMilestoneName] = useState('');
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  });

  // ── Billing Calc ─────────────────────────────────────────────────────────
  const [grossAmount, setGrossAmount] = useState<string>(navState.amount ? String(navState.amount) : '');
  const [previousBills, setPreviousBills] = useState<string>('');
  const [retentionRate, setRetentionRate] = useState<string>('0');
  const [gstApplicable, setGstApplicable] = useState(true);
  const [sacCode, setSacCode] = useState('995411');
  const [cgstRate, setCgstRate] = useState<string>('9');
  const [notes, setNotes] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [saveAttempted, setSaveAttempted] = useState(false);

  const clientDropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (clientDropRef.current && !clientDropRef.current.contains(e.target as Node))
        setShowClientSug(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: stakeholders } = useQuery({
    queryKey: ['stakeholders'],
    queryFn: async () => {
      const { data } = await supabase.from('stakeholders').select('*');
      return data as Stakeholder[];
    },
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('project_id, name').eq('status', 'Active');
      return data as Pick<Project, 'project_id' | 'name'>[];
    },
  });

  // Auto-fill previous bills when project + client selected
  const { data: prevBillsData } = useQuery({
    queryKey: ['prev_bills', projectId, clientId],
    queryFn: async () => {
      if (!projectId || !clientId) return null;
      const { data, error } = await supabase
        .from('client_invoices')
        .select('total_amount, status')
        .eq('project_id', projectId)
        .eq('client_id', clientId)
        .neq('status', 'Void')
        .neq('status', 'Cancelled');
      if (error) throw error;
      return data;
    },
    enabled: !!projectId && !!clientId,
  });

  useEffect(() => {
    if (prevBillsData && billId) {
      const sum = prevBillsData
        .filter(b => b.status !== 'Draft')
        .reduce((s, b) => s + Number(b.total_amount), 0);
      if (sum > 0) setPreviousBills(String(sum));
    }
  }, [prevBillsData, billId]);

  const clients = (stakeholders ?? []).filter(s => s.type === 'Client');
  const filteredClients = clients.filter(s =>
    s.name.toLowerCase().includes(clientSearch.toLowerCase()),
  );
  const selectedClient = clients.find(s => s.stakeholder_id === clientId);

  // ── Computed amounts ─────────────────────────────────────────────────────
  const grossN = parseAmount(grossAmount);
  const prevN  = parseAmount(previousBills);
  const retN   = parseAmount(retentionRate);
  const cgstN  = parseAmount(cgstRate);
  const sgstN  = cgstN; // always equal to CGST for intra-state

  const netBillAmount    = Math.max(0, subtract(grossN, prevN));
  const retentionAmount  = applyPercent(netBillAmount, retN);
  const netPayablePretax = subtract(netBillAmount, retentionAmount);
  const cgstAmount       = gstApplicable ? applyPercent(netPayablePretax, cgstN) : 0;
  const sgstAmount       = gstApplicable ? applyPercent(netPayablePretax, sgstN) : 0;
  const grandTotal       = sum([netPayablePretax, cgstAmount, sgstAmount]);

  // ── Mutations ────────────────────────────────────────────────────────────
  const createClient = useMutation({
    mutationFn: async (fd: FormData) => {
      const payload = {
        stakeholder_id: `STK-${Math.floor(1000 + Math.random() * 9000)}`,
        name: (fd.get('company') as string).trim(),
        type: 'Client' as const,
        category: 'Client',
        contact: (fd.get('contact') as string) || undefined,
        gstin: (fd.get('gstin') as string) || undefined,
        org_id: orgId,
      };
      const { data, error } = await supabase.from('stakeholders').insert([payload]).select().single();
      if (error) throw error;
      return data as Stakeholder;
    },
    onSuccess: d => {
      qc.invalidateQueries({ queryKey: ['stakeholders'] });
      setClientId(d.stakeholder_id);
      setClientSearch(d.name);
      setShowClientCreate(false);
      setShowClientSug(false);
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to create client', { type: 'error' }),
  });

  const saveBill = useMutation({
    mutationFn: async ({ status }: { status: 'Draft' | 'Sent' }) => {
      let doc_url: string | null = null;
      if (docFile) {
        const ext = docFile.name.split('.').pop();
        const filename = `${billId}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('documents')
          .upload(`invoices/${filename}`, docFile);
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from('documents').getPublicUrl(`invoices/${filename}`);
        doc_url = pub.publicUrl;
      }

      const payload = {
        invoice_id: billId,
        client_id: clientId || null,
        project_id: projectId || null,
        invoice_type: billType,
        subject: milestoneName.trim() || null,
        invoice_date: billDate,
        due_date: dueDate || null,
        line_items: [],
        subtotal: netPayablePretax,
        tax_rate: gstApplicable ? cgstN + sgstN : 0,
        tax_amount: cgstAmount + sgstAmount,
        total_amount: grandTotal,
        paid_amount: 0,
        status,
        notes: notes.trim() || null,
        doc_url,
        source: 'manual',
        created_by: session.user.id,
        org_id: orgId,
        // Construction fields
        milestone_name: milestoneName.trim() || null,
        gross_amount: grossN,
        previous_bills_amount: prevN,
        net_bill_amount: netBillAmount,
        retention_rate: retN,
        retention_amount: retentionAmount,
        net_payable_pretax: netPayablePretax,
        gst_applicable: gstApplicable,
        sac_code: sacCode,
        cgst_rate: cgstN,
        cgst_amount: cgstAmount,
        sgst_amount: sgstAmount,
        igst_amount: 0,
      };

      const { error } = await supabase.from('client_invoices').insert([payload]);
      if (error) throw error;
      return { status };
    },
    onSuccess: ({ status }) => {
      qc.invalidateQueries({ queryKey: ['client_invoices'] });
      showSnackbar(`${billId} saved as ${status}`, {
        action: { label: 'View', onClick: () => navigate(`/billing/${billId}`) },
      });
      navigate('/billing');
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to save bill', { type: 'error' }),
  });

  const handleSave = (status: 'Draft' | 'Sent') => {
    setSaveAttempted(true);
    if (!clientId) return;
    if (grossN <= 0) return;
    saveBill.mutate({ status });
  };

  const missingClient = saveAttempted && !clientId;
  const missingGross  = saveAttempted && grossN <= 0;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-surface-container-low/50">
      <div className="max-w-7xl mx-auto px-4 pt-8 pb-36">

        {/* Header */}
        <div className="flex items-start gap-3 mb-10">
          <button
            onClick={() => navigate('/billing')}
            className="mt-0.5 p-2 hover:bg-white/80 rounded-xl transition-colors text-on-surface-variant shrink-0"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div>
            <h1 className="text-[22px] font-bold text-on-surface tracking-tight">Raise Bill</h1>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-[11px] text-on-surface-variant/50 font-data-mono">{billId || 'Generating…'}</p>
              {billId && (
                <button
                  type="button"
                  onClick={() => { navigator.clipboard.writeText(billId); setBillIdCopied(true); setTimeout(() => setBillIdCopied(false), 2000); }}
                  className="text-[11px] text-on-surface-variant/40 hover:text-primary transition-colors flex items-center gap-1"
                >
                  {billIdCopied
                    ? <><span className="material-symbols-outlined text-[13px] text-secondary">check</span><span className="text-secondary text-[11px]">Copied</span></>
                    : <span className="material-symbols-outlined text-[14px]">content_copy</span>}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8">

          {/* ── LEFT COLUMN — Form ──────────────────────────────────────────── */}
          <div className="space-y-8">

            {/* Bill Type */}
            <div>
              <SectionLabel n="01" title="Bill Type" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {BILL_TYPES.map(t => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setBillType(t.key)}
                    className={`flex flex-col items-start p-5 rounded-2xl border-2 text-left transition-all ${
                      billType === t.key
                        ? 'border-primary/60 bg-primary/5 shadow-sm'
                        : 'border-outline-variant/20 bg-white hover:border-outline-variant/40 hover:shadow-sm'
                    }`}
                  >
                    <p className={`text-[11px] font-bold uppercase tracking-wide mb-1 ${billType === t.key ? 'text-primary' : 'text-on-surface-variant/40'}`}>
                      {t.tag}
                    </p>
                    <p className={`text-[14px] font-bold leading-tight mb-2 ${billType === t.key ? 'text-on-surface' : 'text-on-surface-variant/60'}`}>
                      {t.label}
                    </p>
                    <p className={`text-[12px] leading-snug ${billType === t.key ? 'text-on-surface-variant/70' : 'text-on-surface-variant/35'}`}>
                      {t.desc}
                    </p>
                    {billType === t.key && (
                      <span className="mt-3 self-end material-symbols-outlined text-[16px] text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Section 01 — Bill Details */}
            <div>
              <SectionLabel n="02" title="Bill Details" />
              <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-6 space-y-5">

                {/* Bill Number — read only */}
                <div>
                  <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Bill Number</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={billId}
                      readOnly
                      className="bk-input flex-1 bg-surface-container-low/40 text-on-surface-variant/60 font-data-mono cursor-default"
                    />
                    <button
                      type="button"
                      onClick={() => { navigator.clipboard.writeText(billId); setBillIdCopied(true); setTimeout(() => setBillIdCopied(false), 2000); }}
                      className="p-2.5 border border-outline-variant/30 rounded-xl hover:bg-surface-container-low transition-colors text-on-surface-variant/50 hover:text-primary"
                    >
                      <span className="material-symbols-outlined text-[16px]">{billIdCopied ? 'check' : 'content_copy'}</span>
                    </button>
                  </div>
                </div>

                {/* Client */}
                <div className="relative" ref={clientDropRef}>
                  <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">
                    Client{missingClient && <span className="text-error ml-1.5">required</span>}
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant/35 pointer-events-none">search</span>
                    <input
                      type="text"
                      value={clientId ? (selectedClient?.name ?? '') : clientSearch}
                      onChange={e => { setClientSearch(e.target.value); if (clientId) setClientId(''); setShowClientSug(true); setShowClientCreate(false); }}
                      onFocus={() => setShowClientSug(true)}
                      placeholder="Search or create client…"
                      className={`bk-input pl-10 pr-10 ${missingClient ? 'border-error' : ''}`}
                      autoComplete="off"
                    />
                    {clientId && (
                      <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                    )}
                  </div>

                  {showClientSug && !clientId && (
                    <div className="absolute left-0 right-0 top-full bg-white border border-black/[0.08] rounded-xl mt-1 z-30 shadow-lg max-h-52 overflow-y-auto">
                      {filteredClients.map(c => (
                        <div
                          key={c.stakeholder_id}
                          onClick={() => { setClientId(c.stakeholder_id); setClientSearch(c.name); setShowClientSug(false); }}
                          className="px-4 py-3 hover:bg-surface-container-low/60 cursor-pointer border-b border-outline-variant/[0.08] last:border-0"
                        >
                          <p className="text-[13px] font-semibold text-on-surface">{c.name}</p>
                          {c.gstin && <p className="text-[11px] text-on-surface-variant/50">{c.gstin}</p>}
                        </div>
                      ))}
                      {filteredClients.length === 0 && clientSearch && (
                        <div className="px-4 py-3 text-[13px] text-on-surface-variant/50 text-center">No clients found</div>
                      )}
                      <div
                        onClick={() => { setShowClientCreate(true); setShowClientSug(false); }}
                        className="px-4 py-3 cursor-pointer flex items-center gap-2 text-primary border-t border-outline-variant/15 hover:bg-primary/[0.04]"
                      >
                        <span className="material-symbols-outlined text-[17px]">business</span>
                        <span className="text-[13px] font-semibold">Add new client{clientSearch ? ` "${clientSearch}"` : ''}</span>
                      </div>
                    </div>
                  )}

                  {showClientCreate && !clientId && (
                    <div className="mt-2 border border-outline-variant/30 rounded-2xl p-5 bg-surface-container-lowest/60">
                      <p className="text-[12px] font-semibold text-on-surface mb-4">Quick-add client</p>
                      <div className="space-y-3">
                        <div>
                          <label className="text-[10px] font-medium text-on-surface-variant/60 block mb-1.5">Company / Client name</label>
                          <input id="cl_company" className="bk-input w-full" placeholder="e.g. ABC Developers Pvt Ltd" defaultValue={clientSearch} autoFocus />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] font-medium text-on-surface-variant/60 block mb-1.5">Phone (optional)</label>
                            <input id="cl_contact" className="bk-input" placeholder="Contact number" />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium text-on-surface-variant/60 block mb-1.5">GSTIN (optional)</label>
                            <input id="cl_gstin" className="bk-input" placeholder="22AAAAA0000A1Z5" />
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2 justify-end mt-4">
                        <button type="button" className="bk-btn-ghost px-4 py-2 rounded-xl text-[13px]" onClick={() => setShowClientCreate(false)}>Cancel</button>
                        <button
                          type="button"
                          className="bk-btn px-4 py-2 rounded-xl text-[13px]"
                          disabled={createClient.isPending}
                          onClick={() => {
                            const fd = new FormData();
                            fd.append('company', (document.getElementById('cl_company') as HTMLInputElement).value);
                            fd.append('contact', (document.getElementById('cl_contact') as HTMLInputElement).value);
                            fd.append('gstin', (document.getElementById('cl_gstin') as HTMLInputElement).value);
                            createClient.mutate(fd);
                          }}
                        >
                          {createClient.isPending ? 'Saving…' : 'Save & select'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Project */}
                <div>
                  <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Project</label>
                  <select className="bk-input" value={projectId} onChange={e => setProjectId(e.target.value)}>
                    <option value="">No project</option>
                    {(projects ?? []).map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
                  </select>
                </div>

                {/* Milestone */}
                <div>
                  <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">
                    Milestone / Stage
                    <span className="text-on-surface-variant/35 ml-1">(what work this bill covers)</span>
                  </label>
                  <input
                    type="text"
                    className="bk-input"
                    value={milestoneName}
                    onChange={e => setMilestoneName(e.target.value)}
                    placeholder="e.g. Foundation & Basement Slab"
                  />
                </div>

                {/* Dates */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Bill Date</label>
                    <input type="date" className="bk-input" value={billDate} onChange={e => setBillDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Due Date</label>
                    <input type="date" className="bk-input" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                  </div>
                </div>
              </div>
            </div>

            {/* Section 02 — Billing Calculation */}
            <div>
              <SectionLabel n="03" title="Billing Calculation" />
              <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-6 space-y-4">

                {/* Gross amount */}
                <div>
                  <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">
                    Gross Value of Work Done (₹)
                    {missingGross && <span className="text-error ml-1.5">required</span>}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] font-bold text-on-surface-variant/30 font-data-mono">₹</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={grossAmount}
                      onChange={e => setGrossAmount(e.target.value)}
                      onFocus={e => e.target.select()}
                      className={`bk-input pl-7 font-data-mono ${missingGross ? 'border-error' : ''}`}
                      placeholder="0"
                    />
                  </div>
                </div>

                {/* Previous bills */}
                <div>
                  <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">
                    Less: Previous Bills (₹)
                    <span className="text-on-surface-variant/35 ml-1">— auto-filled from prior bills</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] font-bold text-on-surface-variant/30 font-data-mono">₹</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={previousBills}
                      onChange={e => setPreviousBills(e.target.value)}
                      onFocus={e => e.target.select()}
                      className="bk-input pl-7 font-data-mono"
                      placeholder="0"
                    />
                  </div>
                </div>

                {/* Net value — highlighted read-only */}
                <div className="flex items-center justify-between px-4 py-3 bg-primary/[0.04] rounded-xl border border-primary/[0.12]">
                  <span className="text-[12px] font-semibold text-on-surface/70">Net Value This Bill</span>
                  <span className="font-data-mono text-[15px] font-bold text-primary">₹{netBillAmount.toLocaleString('en-IN')}</span>
                </div>

                {/* Retention */}
                <div className="grid grid-cols-[1fr_auto] gap-4 items-end">
                  <div>
                    <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">
                      Retention %
                      <span className="text-on-surface-variant/35 ml-1">— 5–10% standard</span>
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        value={retentionRate}
                        onChange={e => setRetentionRate(e.target.value)}
                        onFocus={e => e.target.select()}
                        className="bk-input pr-7 font-data-mono"
                        placeholder="0"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-on-surface-variant/50">%</span>
                    </div>
                  </div>
                  <div className="pb-2.5">
                    <p className="text-[11px] text-on-surface-variant/50 mb-0.5">Retention Amount</p>
                    <p className="font-data-mono text-[14px] font-semibold text-on-surface">₹{retentionAmount.toLocaleString('en-IN')}</p>
                  </div>
                </div>

                {/* Net payable pretax — highlighted */}
                <div className="flex items-center justify-between px-4 py-3 bg-secondary/[0.04] rounded-xl border border-secondary/[0.12]">
                  <span className="text-[12px] font-semibold text-on-surface/70">Net Payable (before tax)</span>
                  <span className="font-data-mono text-[15px] font-bold text-secondary">₹{netPayablePretax.toLocaleString('en-IN')}</span>
                </div>
              </div>
            </div>

            {/* Section 03 — GST */}
            <div>
              <SectionLabel n="04" title="GST" />
              <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-6 space-y-4">

                {/* Toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-semibold text-on-surface">GST Applicable</p>
                    <p className="text-[11px] text-on-surface-variant/50 mt-0.5">SAC Code applies for construction services</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setGstApplicable(v => !v)}
                    className={`relative w-12 h-6 rounded-full transition-colors focus:outline-none ${gstApplicable ? 'bg-primary' : 'bg-surface-container-highest'}`}
                  >
                    <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${gstApplicable ? 'translate-x-6' : ''}`} />
                  </button>
                </div>

                {gstApplicable && (
                  <>
                    {/* SAC Code */}
                    <div>
                      <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">SAC Code</label>
                      <input
                        type="text"
                        className="bk-input font-data-mono"
                        value={sacCode}
                        onChange={e => setSacCode(e.target.value)}
                        placeholder="995411"
                      />
                    </div>

                    {/* CGST */}
                    <div className="grid grid-cols-[1fr_auto] gap-4 items-end">
                      <div>
                        <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">CGST Rate</label>
                        <div className="relative">
                          <input
                            type="number"
                            min="0"
                            max="28"
                            step="0.5"
                            value={cgstRate}
                            onChange={e => setCgstRate(e.target.value)}
                            onFocus={e => e.target.select()}
                            className="bk-input pr-7 font-data-mono"
                            placeholder="9"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-on-surface-variant/50">%</span>
                        </div>
                      </div>
                      <div className="pb-2.5">
                        <p className="text-[11px] text-on-surface-variant/50 mb-0.5">CGST Amount</p>
                        <p className="font-data-mono text-[14px] font-semibold text-on-surface">₹{cgstAmount.toLocaleString('en-IN')}</p>
                      </div>
                    </div>

                    {/* SGST (auto = CGST) */}
                    <div className="flex items-center justify-between px-4 py-3 bg-surface-container-low/60 rounded-xl">
                      <div>
                        <p className="text-[12px] font-medium text-on-surface">SGST Rate: {cgstN}%</p>
                        <p className="text-[11px] text-on-surface-variant/40">Always equal to CGST for intra-state</p>
                      </div>
                      <p className="font-data-mono text-[14px] font-semibold text-on-surface">₹{sgstAmount.toLocaleString('en-IN')}</p>
                    </div>
                  </>
                )}

                {/* Grand total */}
                <div className="flex items-center justify-between px-5 py-4 bg-primary rounded-2xl">
                  <span className="text-[14px] font-bold text-on-primary">Grand Total</span>
                  <span className="font-data-mono text-[20px] font-black text-on-primary">₹{grandTotal.toLocaleString('en-IN')}</span>
                </div>
              </div>
            </div>

            {/* Section 04 — Notes */}
            <div>
              <SectionLabel n="05" title="Notes" />
              <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-6">
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  className="bk-input w-full resize-none"
                  placeholder="Payment terms, bank details, remarks… (optional)"
                />
              </div>
            </div>

            {/* Document attachment */}
            <div>
              <SectionLabel n="06" title="Document" />
              <input type="file" id="doc-upload" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setDocFile(e.target.files?.[0] || null)} className="hidden" />
              <label htmlFor="doc-upload"
                className={`flex items-center gap-4 p-5 bg-white rounded-2xl border-2 border-dashed cursor-pointer transition-all group ${
                  docFile ? 'border-secondary/40 bg-secondary-container/10' : 'border-outline-variant/25 hover:border-primary/30'
                }`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${docFile ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-high text-on-surface-variant/50'}`}>
                  <span className="material-symbols-outlined text-[20px]">{docFile ? 'attach_file' : 'upload_file'}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-on-surface truncate">{docFile ? docFile.name : 'Attach agreement / document'}</p>
                  <p className="text-[11px] text-on-surface-variant/40 mt-0.5">{docFile ? `${(docFile.size / 1024).toFixed(0)} KB` : 'PDF, JPG or PNG · optional'}</p>
                </div>
                {docFile && (
                  <button type="button" onClick={e => { e.preventDefault(); setDocFile(null); }} className="p-1.5 hover:bg-error-container/20 rounded-lg transition-colors shrink-0">
                    <span className="material-symbols-outlined text-[16px] text-error/60">close</span>
                  </button>
                )}
              </label>
            </div>

            {saveBill.isError && (
              <div className="p-4 bg-error-container text-on-error-container rounded-xl text-[13px] font-medium">
                {(saveBill.error as any)?.message || 'Failed to save bill'}
              </div>
            )}
          </div>

          {/* ── RIGHT COLUMN — Live Preview ─────────────────────────────────── */}
          <div className="hidden lg:block">
            <div className="sticky top-6">
              <div className="bg-white rounded-2xl border border-black/[0.08] shadow-sm p-6 font-mono text-[12px] leading-relaxed">
                {/* Preview header */}
                <div className="flex justify-between items-start mb-5 pb-4 border-b border-black/[0.06]">
                  <div>
                    <p className="text-[13px] font-black text-on-surface tracking-tight">BRIKLAY ENGINEERING</p>
                    <p className="text-[10px] text-on-surface-variant/50 mt-0.5">Kakinada, East Godavari, AP</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] font-bold text-on-surface uppercase tracking-widest">
                      {BILL_TYPES.find(t => t.key === billType)?.label ?? 'Bill'}
                    </p>
                    <p className="text-[10px] text-on-surface-variant/60 mt-0.5 font-data-mono">{billId || '—'}</p>
                    <p className="text-[10px] text-on-surface-variant/50 mt-0.5">Date: {billDate}</p>
                    <p className="text-[10px] text-on-surface-variant/50">Due: {dueDate}</p>
                  </div>
                </div>

                {/* Bill to */}
                <div className="mb-4 pb-4 border-b border-black/[0.06]">
                  <p className="text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest mb-1">Bill To</p>
                  <p className="text-[12px] font-bold text-on-surface">{selectedClient?.name || '— Client —'}</p>
                  {selectedClient?.gstin && (
                    <p className="text-[10px] text-on-surface-variant/50">GSTIN: {selectedClient.gstin}</p>
                  )}
                  <div className="mt-2">
                    <p className="text-[10px] text-on-surface-variant/50">
                      Project: {projects?.find(p => p.project_id === projectId)?.name || '—'}
                    </p>
                  </div>
                </div>

                {/* Milestone */}
                {milestoneName && (
                  <div className="mb-4 pb-3 border-b border-black/[0.06]">
                    <p className="text-[11px] text-on-surface-variant/70 italic">{milestoneName}</p>
                  </div>
                )}

                {/* Abstract of Cost */}
                <div>
                  <p className="text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest mb-2">Abstract of Cost</p>
                  <div className="border-t border-black/[0.08] pt-2 space-y-1.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-on-surface-variant/70">Gross Value of Work Done</span>
                      <span className="font-semibold text-on-surface font-data-mono">₹ {fmtPreview(grossN)}</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-on-surface-variant/70">Less: Previous Bills</span>
                      <span className="font-semibold text-on-surface font-data-mono">₹ {fmtPreview(prevN)}</span>
                    </div>
                    <div className="flex justify-between text-[11px] font-semibold border-t border-black/[0.06] pt-1.5">
                      <span className="text-on-surface">Net Value This Bill</span>
                      <span className="text-on-surface font-data-mono">₹ {fmtPreview(netBillAmount)}</span>
                    </div>
                    {retN > 0 && (
                      <div className="flex justify-between text-[11px]">
                        <span className="text-on-surface-variant/70">Less: Retention @ {retN}%</span>
                        <span className="font-semibold text-on-surface font-data-mono">₹ {fmtPreview(retentionAmount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-[11px] font-semibold border-t border-black/[0.06] pt-1.5">
                      <span className="text-on-surface">Net Payable (pre-tax)</span>
                      <span className="text-on-surface font-data-mono">₹ {fmtPreview(netPayablePretax)}</span>
                    </div>
                    {gstApplicable && (
                      <>
                        <div className="flex justify-between text-[11px]">
                          <span className="text-on-surface-variant/70">CGST @ {cgstN}%</span>
                          <span className="font-data-mono text-on-surface">₹ {fmtPreview(cgstAmount)}</span>
                        </div>
                        <div className="flex justify-between text-[11px]">
                          <span className="text-on-surface-variant/70">SGST @ {sgstN}%</span>
                          <span className="font-data-mono text-on-surface">₹ {fmtPreview(sgstAmount)}</span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between text-[13px] font-black border-t-2 border-black/[0.08] pt-2 mt-1">
                      <span className="text-on-surface">GRAND TOTAL</span>
                      <span className="text-primary font-data-mono">₹ {fmtPreview(grandTotal)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── Bottom Action Bar ──────────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-md border-t border-black/[0.06] shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3.5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/billing')}
            className="text-[13px] font-medium text-on-surface-variant/60 hover:text-on-surface px-3 py-2 rounded-xl hover:bg-surface-container-low/60 transition-colors"
          >
            Cancel
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => handleSave('Draft')}
            disabled={saveBill.isPending}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-primary/30 text-primary text-[13px] font-semibold hover:bg-primary/5 transition-colors disabled:opacity-35"
          >
            {saveBill.isPending && saveBill.variables?.status === 'Draft'
              ? <Loader2 className="animate-spin" size={14} />
              : <span className="material-symbols-outlined text-[16px]">save</span>}
            Save as Draft
          </button>
          <button
            type="button"
            onClick={() => handleSave('Sent')}
            disabled={saveBill.isPending}
            className="bk-btn flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-35"
          >
            {saveBill.isPending && saveBill.variables?.status === 'Sent'
              ? <Loader2 className="animate-spin" size={14} />
              : <span className="material-symbols-outlined text-[16px]">send</span>}
            Save & Mark Sent
          </button>
        </div>
      </div>
    </div>
  );
}
