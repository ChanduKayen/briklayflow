import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useSnackbar } from '../components/Snackbar';
import { useOrgId } from '../lib/auth/AuthProvider';
import type { Session } from '@supabase/supabase-js';
import type { Stakeholder, Project, InvoiceType } from '../types';

// ── Constants ─────────────────────────────────────────────────────────────────

type EntryPath = 'manual' | 'extract';

const INVOICE_TYPES: { key: InvoiceType; label: string; sub: string }[] = [
  { key: 'invoice',     label: 'Tax Invoice',       sub: 'Standard GST invoice'     },
  { key: 'proforma',    label: 'Proforma',           sub: 'Pre-billing estimate'     },
  { key: 'advance',     label: 'Advance Receipt',    sub: 'Upfront payment'          },
  { key: 'credit_note', label: 'Credit Note',        sub: 'Deduction / refund'       },
  { key: 'receipt',     label: 'Receipt',            sub: 'Simple payment receipt'   },
];

const UNITS = ['LS', 'Nos', 'Sqft', 'Sqm', 'RM', 'Kg', 'MT', 'Days', 'Months', '%'];

interface LineItemDraft {
  id: string;
  description: string;
  qty: string;
  unit: string;
  rate: string;
}

function genInvoiceId() {
  return `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
}

function SectionLabel({ n, title }: { n: string; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <span className="text-[10px] font-bold text-on-surface-variant/40">{n}</span>
      <span className="h-px flex-1 bg-outline-variant/20" />
      <span className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-[0.1em]">{title}</span>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NewInvoice({ session }: { session: Session }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { show: showSnackbar } = useSnackbar();
  const orgId = useOrgId();

  // ── Path selection ───────────────────────────────────────────────────────
  const [path, setPath] = useState<EntryPath | null>(null);
  const [extractFile, setExtractFile] = useState<File | null>(null);
  const [showForm, setShowForm] = useState(false);

  // ── Invoice form ─────────────────────────────────────────────────────────
  const [invoiceId] = useState(genInvoiceId);
  const [invoiceType, setInvoiceType] = useState<InvoiceType>('invoice');
  const [clientId, setClientId] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [showClientSug, setShowClientSug] = useState(false);
  const [showClientCreate, setShowClientCreate] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [subject, setSubject] = useState('');
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([
    { id: '1', description: '', qty: '1', unit: 'LS', rate: '' },
  ]);
  const [taxRate, setTaxRate] = useState('18');
  const [notes, setNotes] = useState('');
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

  // ── Computed ─────────────────────────────────────────────────────────────
  const computedItems = lineItems.map(li => ({
    ...li,
    qtyN: parseFloat(li.qty) || 0,
    rateN: parseFloat(li.rate) || 0,
    amount: (parseFloat(li.qty) || 0) * (parseFloat(li.rate) || 0),
  }));
  const subtotal = computedItems.reduce((s, li) => s + li.amount, 0);
  const taxRateN = parseFloat(taxRate) || 0;
  const taxAmount = subtotal * (taxRateN / 100);
  const total = subtotal + taxAmount;

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

  const clients = (stakeholders ?? []).filter(s => s.type === 'Client');
  const filteredClients = clients.filter(s =>
    s.name.toLowerCase().includes(clientSearch.toLowerCase()),
  );
  const selectedClient = clients.find(s => s.stakeholder_id === clientId);

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

  const saveInvoice = useMutation({
    mutationFn: async () => {
      let doc_url: string | null = null;
      if (extractFile) {
        const ext = extractFile.name.split('.').pop();
        const filename = `${invoiceId}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('documents')
          .upload(`invoices/${filename}`, extractFile);
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from('documents').getPublicUrl(`invoices/${filename}`);
        doc_url = pub.publicUrl;
      }

      const finalItems = computedItems.map(li => ({
        description: li.description,
        qty: li.qtyN,
        unit: li.unit,
        rate: li.rateN,
        amount: li.amount,
      }));

      const payload = {
        invoice_id: invoiceId,
        client_id: clientId || null,
        project_id: projectId || null,
        invoice_type: invoiceType,
        subject: subject.trim() || null,
        invoice_date: invoiceDate,
        due_date: dueDate || null,
        line_items: finalItems,
        subtotal,
        tax_rate: taxRateN,
        tax_amount: taxAmount,
        total_amount: total,
        paid_amount: 0,
        status: 'Draft',
        notes: notes.trim() || null,
        doc_url,
        source: extractFile ? 'ai_extracted' : 'manual',
        created_by: session.user.id,
        org_id: orgId,
      };

      const { error } = await supabase.from('client_invoices').insert([payload]);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client_invoices'] });
      showSnackbar(`${invoiceId} saved`, {
        action: { label: 'View', onClick: () => navigate(`/invoices/${invoiceId}`) },
      });
      navigate('/invoices');
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to save invoice', { type: 'error' }),
  });

  const handleSave = () => {
    setSaveAttempted(true);
    const hasValidItem = computedItems.some(li => li.description.trim() && li.rateN > 0);
    if (!hasValidItem) return;
    saveInvoice.mutate();
  };

  const addLine = () =>
    setLineItems(prev => [...prev, { id: String(Date.now()), description: '', qty: '1', unit: 'LS', rate: '' }]);
  const removeLine = (id: string) => setLineItems(prev => prev.filter(li => li.id !== id));
  const updateLine = (id: string, field: keyof LineItemDraft, value: string) =>
    setLineItems(prev => prev.map(li => (li.id === id ? { ...li, [field]: value } : li)));

  const missingItem = saveAttempted && !computedItems.some(li => li.description.trim() && li.rateN > 0);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-surface-container-low/50">
      <div className="max-w-2xl mx-auto px-4 pt-8 pb-36">

        {/* Header */}
        <div className="flex items-start gap-3 mb-10">
          <button
            onClick={() => navigate('/invoices')}
            className="mt-0.5 p-2 hover:bg-white/80 rounded-xl transition-colors text-on-surface-variant shrink-0"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div>
            <h1 className="text-[22px] font-bold text-on-surface tracking-tight">New Invoice</h1>
            <p className="text-[11px] text-on-surface-variant/50 font-data-mono mt-1">{invoiceId}</p>
          </div>
        </div>

        {/* ── Path selector ──────────────────────────────────────────────── */}
        {!path && (
          <div className="grid grid-cols-2 gap-4 mb-10">
            {[
              {
                key: 'extract' as EntryPath,
                icon: 'upload_file',
                title: 'Extract from Agreement',
                desc: 'Upload a signed contract and let AI extract the billing schedule',
              },
              {
                key: 'manual' as EntryPath,
                icon: 'edit_note',
                title: 'Create Manually',
                desc: 'Fill in invoice details directly — no document needed',
              },
            ].map(opt => (
              <button
                key={opt.key}
                onClick={() => {
                  setPath(opt.key);
                  if (opt.key === 'manual') setShowForm(true);
                }}
                className="flex flex-col items-start p-6 bg-white rounded-2xl border-2 border-outline-variant/25 hover:border-primary/40 hover:shadow-md transition-all text-left group"
              >
                <span className="material-symbols-outlined text-[40px] text-primary/60 group-hover:text-primary mb-4 transition-colors">
                  {opt.icon}
                </span>
                <p className="text-[15px] font-bold text-on-surface leading-tight mb-2">{opt.title}</p>
                <p className="text-[12px] text-on-surface-variant/60 leading-snug">{opt.desc}</p>
              </button>
            ))}
          </div>
        )}

        {/* ── Selected path strip ────────────────────────────────────────── */}
        {path && (
          <div className="flex items-center gap-3 mb-6 p-3 bg-primary/5 rounded-xl border border-primary/20">
            <span className="material-symbols-outlined text-primary text-[18px]">
              {path === 'manual' ? 'edit_note' : 'upload_file'}
            </span>
            <span className="text-[13px] font-semibold text-on-surface flex-1">
              {path === 'manual' ? 'Creating manually' : 'Extracting from agreement'}
            </span>
            <button
              onClick={() => { setPath(null); setShowForm(false); setExtractFile(null); }}
              className="text-[12px] text-primary hover:underline"
            >
              Change
            </button>
          </div>
        )}

        {/* ── Extract upload zone ────────────────────────────────────────── */}
        {path === 'extract' && !showForm && (
          <div className="mb-8">
            <input
              type="file"
              id="agreement-upload"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={e => setExtractFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            <label
              htmlFor="agreement-upload"
              className={`flex flex-col items-center gap-4 p-10 bg-white rounded-2xl border-2 border-dashed cursor-pointer transition-all ${
                extractFile
                  ? 'border-secondary/40 bg-secondary-container/10'
                  : 'border-outline-variant/30 hover:border-primary/40 hover:bg-primary/[0.02]'
              }`}
            >
              <span className={`material-symbols-outlined text-[48px] ${extractFile ? 'text-secondary' : 'text-on-surface-variant/30'}`}>
                {extractFile ? 'task' : 'cloud_upload'}
              </span>
              <div className="text-center">
                <p className="text-[14px] font-semibold text-on-surface">
                  {extractFile ? extractFile.name : 'Upload signed agreement'}
                </p>
                <p className="text-[12px] text-on-surface-variant/50 mt-1">
                  {extractFile ? `${(extractFile.size / 1024).toFixed(0)} KB` : 'PDF, JPG or PNG'}
                </p>
              </div>
            </label>

            {extractFile && (
              <div className="mt-4 p-4 bg-amber-50 border border-amber-200/60 rounded-xl text-[12px] text-amber-700 flex items-start gap-2">
                <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">info</span>
                <p>Document uploaded. AI extraction is coming soon — review and fill in the invoice details below.</p>
              </div>
            )}

            {extractFile && (
              <button
                onClick={() => setShowForm(true)}
                className="bk-btn mt-4 w-full py-3 rounded-xl flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                Review invoice form
              </button>
            )}
          </div>
        )}

        {/* ── Invoice form ───────────────────────────────────────────────── */}
        {showForm && (
          <div className="space-y-8">

            {/* 01 · Invoice Type */}
            <div>
              <SectionLabel n="01" title="Invoice Type" />
              <div className="flex gap-2 flex-wrap">
                {INVOICE_TYPES.map(t => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setInvoiceType(t.key)}
                    className={`px-4 py-2 rounded-xl border-2 text-left transition-all ${
                      invoiceType === t.key
                        ? 'border-primary/60 bg-primary/5'
                        : 'border-outline-variant/20 bg-white hover:border-outline-variant/40'
                    }`}
                  >
                    <p className={`text-[13px] font-semibold ${invoiceType === t.key ? 'text-on-surface' : 'text-on-surface-variant/60'}`}>
                      {t.label}
                    </p>
                    <p className={`text-[11px] mt-0.5 ${invoiceType === t.key ? 'text-on-surface-variant/70' : 'text-on-surface-variant/35'}`}>
                      {t.sub}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* 02 · Invoice Details */}
            <div>
              <SectionLabel n="02" title="Invoice Details" />
              <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-6 space-y-5">

                {/* Client */}
                <div className="relative" ref={clientDropRef}>
                  <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Client</label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant/35 pointer-events-none">search</span>
                    <input
                      type="text"
                      value={clientId ? (selectedClient?.name ?? '') : clientSearch}
                      onChange={e => { setClientSearch(e.target.value); if (clientId) setClientId(''); setShowClientSug(true); setShowClientCreate(false); }}
                      onFocus={() => setShowClientSug(true)}
                      placeholder="Search or create client…"
                      className="bk-input pl-10 pr-10"
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
                  <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Project <span className="text-on-surface-variant/35">(optional)</span></label>
                  <select className="bk-input" value={projectId} onChange={e => setProjectId(e.target.value)}>
                    <option value="">No project</option>
                    {(projects ?? []).map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
                  </select>
                </div>

                {/* Subject */}
                <div>
                  <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Subject / Description <span className="text-on-surface-variant/35">(optional)</span></label>
                  <input type="text" className="bk-input" value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Phase 1 milestone billing" />
                </div>

                {/* Dates */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Invoice Date</label>
                    <input type="date" className="bk-input" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Due Date <span className="text-on-surface-variant/35">(optional)</span></label>
                    <input type="date" className="bk-input" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                  </div>
                </div>
              </div>
            </div>

            {/* 03 · Line Items */}
            <div>
              <SectionLabel n="03" title="Line Items" />
              {missingItem && (
                <p className="text-error text-[12px] mb-2">At least one line item with description and rate is required.</p>
              )}
              <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm overflow-hidden">
                {/* Column headers */}
                <div className="hidden md:grid grid-cols-[1fr_60px_80px_110px_90px_32px] gap-2 px-4 pt-3 pb-1 text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-wide">
                  <span>Description</span><span>Qty</span><span>Unit</span><span>Rate (₹)</span><span className="text-right">Amount</span><span />
                </div>
                <div className="divide-y divide-outline-variant/[0.07]">
                  {lineItems.map((li, idx) => (
                    <div key={li.id} className="p-4 grid grid-cols-1 md:grid-cols-[1fr_60px_80px_110px_90px_32px] gap-2 items-center">
                      <input
                        type="text"
                        value={li.description}
                        onChange={e => updateLine(li.id, 'description', e.target.value)}
                        placeholder={`Item ${idx + 1} description…`}
                        className={`bk-input ${missingItem && !li.description.trim() ? 'border-error' : ''}`}
                      />
                      <input
                        type="number"
                        min="0"
                        value={li.qty}
                        onChange={e => updateLine(li.id, 'qty', e.target.value)}
                        onFocus={e => e.target.select()}
                        className="bk-input text-center font-data-mono"
                      />
                      <select value={li.unit} onChange={e => updateLine(li.id, 'unit', e.target.value)} className="bk-input">
                        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] font-bold text-on-surface-variant/30 font-data-mono">₹</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={li.rate}
                          onChange={e => updateLine(li.id, 'rate', e.target.value)}
                          onFocus={e => e.target.select()}
                          className="bk-input pl-6 font-data-mono"
                          placeholder="0"
                        />
                      </div>
                      <div className="font-data-mono text-[13px] font-semibold text-on-surface text-right">
                        {((parseFloat(li.qty) || 0) * (parseFloat(li.rate) || 0)).toLocaleString('en-IN')}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLine(li.id)}
                        disabled={lineItems.length === 1}
                        className="p-1 text-on-surface-variant/30 hover:text-error transition-colors disabled:opacity-20 justify-self-center"
                      >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </button>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-3 border-t border-outline-variant/[0.07]">
                  <button type="button" onClick={addLine} className="flex items-center gap-1.5 text-[12px] text-primary/70 hover:text-primary transition-colors">
                    <span className="material-symbols-outlined text-[16px]">add_circle</span>
                    Add line item
                  </button>
                </div>
              </div>
            </div>

            {/* 04 · Totals */}
            <div>
              <SectionLabel n="04" title="Totals" />
              <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-6">
                <div className="max-w-xs ml-auto space-y-3">
                  <div className="flex justify-between text-[13px]">
                    <span className="text-on-surface-variant/60">Subtotal</span>
                    <span className="font-data-mono font-semibold">₹{subtotal.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] text-on-surface-variant/60">GST</span>
                      <div className="relative w-20">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={taxRate}
                          onChange={e => setTaxRate(e.target.value)}
                          onFocus={e => e.target.select()}
                          className="bk-input py-1 text-[12px] pr-5 font-data-mono"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-on-surface-variant/50">%</span>
                      </div>
                    </div>
                    <span className="font-data-mono text-[13px]">₹{taxAmount.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between text-[16px] font-bold border-t border-outline-variant/20 pt-3">
                    <span>Total</span>
                    <span className="font-data-mono text-primary">₹{total.toLocaleString('en-IN')}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 05 · Notes */}
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
                {extractFile && (
                  <div className="mt-3 flex items-center gap-2 text-[12px] text-secondary">
                    <span className="material-symbols-outlined text-[16px]">attach_file</span>
                    <span className="font-medium">{extractFile.name}</span>
                    <span className="text-on-surface-variant/40">will be attached on save</span>
                    <button type="button" onClick={() => setExtractFile(null)} className="ml-auto hover:text-error transition-colors">
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {saveInvoice.isError && (
              <div className="p-4 bg-error-container text-on-error-container rounded-xl text-[13px] font-medium">
                {(saveInvoice.error as any)?.message || 'Failed to save invoice'}
              </div>
            )}

          </div>
        )}
      </div>

      {/* ── Bottom action bar ────────────────────────────────────────────────── */}
      {showForm && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-md border-t border-black/[0.06] shadow-sm">
          <div className="max-w-2xl mx-auto px-4 py-3.5 flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/invoices')}
              className="text-[13px] font-medium text-on-surface-variant/60 hover:text-on-surface px-3 py-2 rounded-xl hover:bg-surface-container-low/60 transition-colors"
            >
              Cancel
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={handleSave}
              disabled={saveInvoice.isPending}
              className="bk-btn flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-35"
            >
              {saveInvoice.isPending
                ? <Loader2 className="animate-spin" size={14} />
                : <span className="material-symbols-outlined text-[16px]">check</span>}
              Save Invoice
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
