import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useSnackbar } from '../components/Snackbar';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import { MAT_DIVISIONS } from '../lib/costCodes';
import { VENDOR_TRADE_GROUPS, OTHER_TRADE } from '../lib/trades';

// ── Helpers ───────────────────────────────────────────────────────────────────

function SectionLabel({ n, title }: { n: string; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <span className="text-[10px] font-bold text-on-surface-variant/40">{n}</span>
      <span className="h-px flex-1 bg-outline-variant/20" />
      <span className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-[0.1em]">{title}</span>
    </div>
  );
}

async function genPONumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;
  const { data } = await supabase
    .from('purchase_orders')
    .select('po_id')
    .like('po_id', `${prefix}%`)
    .order('po_id', { ascending: false })
    .limit(1);
  let seq = 1;
  if (data?.length) {
    const num = parseInt(data[0].po_id.replace(prefix, ''), 10);
    if (!isNaN(num)) seq = num + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}


const UNITS = ['Nos', 'Bags', 'MT', 'm³', 'm²', 'RFT', 'Ltr', 'kg', 'Set', 'LS', 'Pair', 'Rmt', 'Sqft'];
const GST_RATES = [0, 5, 12, 18, 28];
const PAYMENT_TERMS = [15, 30, 45, 60];

interface DraftLineItem {
  id: string;
  line_number: number;
  category_id: string;
  item_name: string;
  specification: string;
  unit: string;
  quantity_ordered: number;
  unit_rate: number;
  discount_percent: number;
  gst_rate: number;
  basic_amount: number;
  discount_amount: number;
  cgst: number;
  sgst: number;
  total_amount: number;
}

interface ExtractedItem {
  _id: string;
  item_name: string;
  specification: string;
  unit: string;
  quantity: number;
  unit_rate: number;
  gst_rate: number;
  amount: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

function newLine(lineNumber: number): DraftLineItem {
  return {
    id: crypto.randomUUID(),
    line_number: lineNumber,
    category_id: '',
    item_name: '',
    specification: '',
    unit: 'Nos',
    quantity_ordered: 1,
    unit_rate: 0,
    discount_percent: 0,
    gst_rate: 18,
    basic_amount: 0,
    discount_amount: 0,
    cgst: 0,
    sgst: 0,
    total_amount: 0,
  };
}

function computeLine(li: DraftLineItem): DraftLineItem {
  const basic   = li.quantity_ordered * li.unit_rate;
  const disc    = basic * (li.discount_percent / 100);
  const taxable = basic - disc;
  const cgst    = taxable * (li.gst_rate / 200);
  const sgst    = taxable * (li.gst_rate / 200);
  return {
    ...li,
    basic_amount:   basic,
    discount_amount: disc,
    cgst,
    sgst,
    total_amount: taxable + cgst + sgst,
  };
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const parsed = new Date(d);
  if (isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const EXTRACT_PROMPT = `You are a purchase-order line-item extractor specialising in Indian construction materials and vendor quotations.

Given an image of a quotation, proforma invoice, or price list, extract ALL line items.

Return ONLY valid JSON:
{
  "vendor_name": "string or null",
  "items": [
    {
      "item_name": "exact name from document",
      "specification": "grade / brand / spec string, or null",
      "unit": "one of: Nos Bags MT m³ m² RFT Ltr kg Set LS Pair Rmt Sqft",
      "quantity": number,
      "unit_rate": number (EXCLUSIVE of GST — if document shows inclusive price, divide by 1 + gst_rate/100),
      "gst_rate": 5 or 12 or 18 or 28,
      "amount": number (quantity × unit_rate before GST),
      "confidence": "HIGH" | "MEDIUM" | "LOW"
    }
  ]
}

Confidence: HIGH = all fields clearly visible, MEDIUM = some fields inferred, LOW = heavy guessing.
For lump-sum items use unit "LS", quantity 1, unit_rate = lump-sum value.
Do not invent items not visible in the document.`;

async function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const [header, base64] = dataUrl.split(',');
      const mimeType = header.match(/data:([^;]+)/)?.[1] || file.type || 'image/jpeg';
      resolve({ base64, mimeType });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NewPurchaseOrder({ session }: { session: Session }) {
  const navigate   = useNavigate();
  const qc         = useQueryClient();
  const { show: showSnackbar } = useSnackbar();
  const { data: profile } = useUserProfile(session.user.id);
  const vendorSearchRef = useRef<HTMLInputElement>(null);

  // ── PO Number ──────────────────────────────────────────────────────────────
  const [poId, setPoId]               = useState('');
  const [autoPoId, setAutoPoId]       = useState(true);
  const [poIdCopied, setPoIdCopied]   = useState(false);

  useEffect(() => {
    genPONumber().then(setPoId);
  }, []);

  // ── Section 01: Identity ──────────────────────────────────────────────────
  const [orderedDate, setOrderedDate]         = useState(new Date().toISOString().split('T')[0]);
  const [expectedDelivery, setExpectedDelivery] = useState('');
  const orderedBy = profile?.name ?? '';

  // ── Section 02: Vendor & Project ─────────────────────────────────────────
  const [projectId, setProjectId]               = useState('');
  const [vendorId, setVendorId]                 = useState('');
  const [vendorSearch, setVendorSearch]         = useState('');
  const [showVendorSug, setShowVendorSug]       = useState(false);
  const [selectedVendor, setSelectedVendor]     = useState<any>(null);
  const [paymentTermsDays, setPaymentTermsDays] = useState(30);
  const [customTerms, setCustomTerms]           = useState('');
  const [deliveryLocation, setDeliveryLocation] = useState('');

  // Add-vendor inline form
  const [showVendorCreate, setShowVendorCreate] = useState(false);
  const [newVendorName, setNewVendorName]             = useState('');
  const [newVendorCategory, setNewVendorCategory]     = useState('');
  const [newVendorCategoryOther, setNewVendorCategoryOther] = useState('');
  const [newVendorGstin, setNewVendorGstin]           = useState('');

  // ── Section 04: Line Items ────────────────────────────────────────────────
  const [lineItems, setLineItems] = useState<DraftLineItem[]>([newLine(1)]);

  // ── Section 03: AI Extraction ─────────────────────────────────────────────
  const [extractFile, setExtractFile]   = useState<File | null>(null);
  const [extracting, setExtracting]     = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [pendingItems, setPendingItems] = useState<ExtractedItem[] | null>(null);
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set());

  // ── Section 05: Terms ─────────────────────────────────────────────────────
  const [vendorNotes, setVendorNotes]   = useState('');
  const [internalNotes, setInternalNotes] = useState('');

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('project_id, name, site_location').order('name');
      if (error) throw error;
      return data as { project_id: string; name: string; site_location: string }[];
    },
  });

  const { data: vendors } = useQuery({
    queryKey: ['vendors_all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stakeholders')
        .select('stakeholder_id, name, category, gstin, is_approved, type')
        .in('type', ['Vendor'])
        .order('name');
      if (error) throw error;
      return data as any[];
    },
  });

  // Vendor suggestions
  const vendorSuggestions = useMemo(() => {
    if (!vendorSearch || !vendors) return [];
    const q = vendorSearch.toLowerCase();
    return vendors.filter(v => v.name.toLowerCase().includes(q) || v.category?.toLowerCase().includes(q)).slice(0, 8);
  }, [vendorSearch, vendors]);

  // ── Line item helpers ─────────────────────────────────────────────────────
  function updateLine(id: string, patch: Partial<DraftLineItem>) {
    setLineItems(prev =>
      prev.map(li => li.id === id ? computeLine({ ...li, ...patch }) : li)
    );
  }

  function addLine() {
    setLineItems(prev => [...prev, newLine(prev.length + 1)]);
  }

  function removeLine(id: string) {
    setLineItems(prev => {
      const next = prev.filter(li => li.id !== id);
      return next.map((li, i) => ({ ...li, line_number: i + 1 }));
    });
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  const subtotal      = lineItems.reduce((s, li) => s + li.basic_amount, 0);
  const totalDiscount = lineItems.reduce((s, li) => s + li.discount_amount, 0);
  const totalGST      = lineItems.reduce((s, li) => s + li.cgst + li.sgst, 0);
  const grandTotal    = lineItems.reduce((s, li) => s + li.total_amount, 0);

  // ── Project selection ─────────────────────────────────────────────────────
  function handleProjectChange(pid: string) {
    setProjectId(pid);
    const proj = projects?.find(p => p.project_id === pid);
    if (proj?.site_location) setDeliveryLocation(proj.site_location);
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (status: 'Draft' | 'Ordered') => {
      if (!vendorId)     throw new Error('Please select a vendor');
      if (!projectId)    throw new Error('Please select a project');
      if (!lineItems.length || !lineItems.some(li => li.item_name.trim())) {
        throw new Error('Please add at least one line item');
      }

      const finalPoId = poId.trim();
      if (!finalPoId) throw new Error('PO number is required');

      const terms = paymentTermsDays === -1 ? parseInt(customTerms) || 30 : paymentTermsDays;

      // Build legacy items JSON for backward compat
      const legacyItems = lineItems.map(li => ({
        description: li.item_name,
        qty: li.quantity_ordered,
        unit: li.unit,
        rate: li.unit_rate,
        amount: li.total_amount,
      }));

      const { error: poError } = await supabase.from('purchase_orders').insert({
        po_id:               finalPoId,
        project_id:          projectId,
        stakeholder_id:      vendorId,
        items:               legacyItems,
        order_value:         subtotal - totalDiscount,
        total_value:         grandTotal,
        gst_value:           totalGST,
        status,
        date_issued:         orderedDate,
        expected_delivery:   expectedDelivery || null,
        delivery_location:   deliveryLocation || null,
        payment_terms_days:  terms,
        ordered_by:          orderedBy || null,
        vendor_notes:        vendorNotes || null,
        internal_notes:      internalNotes || null,
        created_by:          session.user.id,
      });
      if (poError) throw poError;

      // Insert line items
      const lineItemRows = lineItems
        .filter(li => li.item_name.trim())
        .map(li => ({
          po_id:             finalPoId,
          line_number:       li.line_number,
          category_id:       li.category_id || null,
          item_name:         li.item_name,
          specification:     li.specification || null,
          unit:              li.unit,
          quantity_ordered:  li.quantity_ordered,
          unit_rate:         li.unit_rate,
          basic_amount:      li.basic_amount,
          discount_percent:  li.discount_percent,
          discount_amount:   li.discount_amount,
          gst_rate:          li.gst_rate,
          cgst:              li.cgst,
          sgst:              li.sgst,
          igst:              0,
          total_amount:      li.total_amount,
        }));

      if (lineItemRows.length > 0) {
        const { error: liError } = await supabase.from('po_line_items').insert(lineItemRows);
        if (liError) throw liError;
      }

      return finalPoId;
    },
    onSuccess: (finalPoId, status) => {
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      showSnackbar(status === 'Ordered' ? `PO ${finalPoId} placed` : `Draft ${finalPoId} saved`);
      navigate(`/purchase-orders/${finalPoId}`);
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to save', { type: 'error' }),
  });

  const createVendor = useMutation({
    mutationFn: async () => {
      if (!newVendorName.trim()) throw new Error('Vendor name is required');
      const resolvedCategory =
        newVendorCategory === OTHER_TRADE
          ? (newVendorCategoryOther.trim() || 'Other')
          : newVendorCategory;
      if (!resolvedCategory) throw new Error('Category is required');
      const payload = {
        stakeholder_id: `STK-${Math.floor(1000 + Math.random() * 9000)}`,
        name:     newVendorName.trim(),
        type:     'Vendor',
        category: resolvedCategory,
        gstin:    newVendorGstin.trim() || undefined,
      };
      const { data, error } = await supabase.from('stakeholders').insert([payload]).select().single();
      if (error) throw error;
      return data as any;
    },
    onSuccess: (v) => {
      qc.invalidateQueries({ queryKey: ['vendors_all'] });
      setVendorId(v.stakeholder_id);
      setSelectedVendor(v);
      setVendorSearch(v.name);
      setShowVendorCreate(false);
      setShowVendorSug(false);
      setNewVendorName('');
      setNewVendorCategory('');
      setNewVendorCategoryOther('');
      setNewVendorGstin('');
      showSnackbar(`Vendor "${v.name}" created`);
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to create vendor', { type: 'error' }),
  });

  // ── AI Extraction helpers ─────────────────────────────────────────────────

  async function extractFromDocument(file: File) {
    setExtracting(true);
    setExtractError(null);
    try {
      const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
      if (!apiKey) throw new Error('OpenAI API key not configured (VITE_OPENAI_API_KEY)');

      const { base64, mimeType } = await fileToBase64(file);

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          response_format: { type: 'json_object' },
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' } },
              { type: 'text', text: EXTRACT_PROMPT },
            ],
          }],
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as any).error?.message || `API error ${response.status}`);
      }

      const result = await response.json();
      const content = result.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty response from AI');

      const parsed = JSON.parse(content);
      const items: ExtractedItem[] = ((parsed.items ?? []) as any[])
        .map(it => ({
          _id:           crypto.randomUUID(),
          item_name:     String(it.item_name   || ''),
          specification: String(it.specification || ''),
          unit:          String(it.unit         || 'Nos'),
          quantity:      Number(it.quantity)    || 1,
          unit_rate:     Number(it.unit_rate)   || 0,
          gst_rate:      Number(it.gst_rate)    || 18,
          amount:        Number(it.amount)      || 0,
          confidence:    (['HIGH','MEDIUM','LOW'].includes(it.confidence) ? it.confidence : 'MEDIUM') as 'HIGH' | 'MEDIUM' | 'LOW',
        }))
        .filter((it: ExtractedItem) => it.item_name);

      if (items.length === 0) throw new Error('No line items found in document');

      setPendingItems(items);
      setSelectedIds(new Set(items.map((i: ExtractedItem) => i._id)));

      if (parsed.vendor_name && !vendorId) {
        setVendorSearch(String(parsed.vendor_name));
      }
    } catch (err: any) {
      setExtractError(err.message || 'Extraction failed');
    } finally {
      setExtracting(false);
    }
  }

  function applyExtractedItems() {
    if (!pendingItems) return;
    const toApply = pendingItems.filter(it => selectedIds.has(it._id));
    if (!toApply.length) return;
    setLineItems(toApply.map((it, i) => computeLine({
      ...newLine(i + 1),
      item_name:        it.item_name,
      specification:    it.specification,
      unit:             it.unit,
      quantity_ordered: it.quantity,
      unit_rate:        it.unit_rate,
      gst_rate:         it.gst_rate,
    })));
    setPendingItems(null);
    setExtractFile(null);
    setSelectedIds(new Set());
    showSnackbar(`${toApply.length} line item${toApply.length !== 1 ? 's' : ''} applied`);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6 pb-32">
      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/purchase-orders')}
          className="p-2 rounded-xl hover:bg-surface-container-low transition-colors text-on-surface-variant"
        >
          <span className="material-symbols-outlined text-[22px]">arrow_back</span>
        </button>
        <div className="flex-1">
          <h2 className="text-[22px] font-bold text-on-surface tracking-tight">New Purchase Order</h2>
        </div>
        {/* PO ID display */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-surface-container rounded-xl border border-outline-variant/20">
          <span className="font-data-mono text-[13px] text-on-surface-variant">{poId || '—'}</span>
          <button
            onClick={() => {
              navigator.clipboard.writeText(poId);
              setPoIdCopied(true);
              setTimeout(() => setPoIdCopied(false), 1500);
            }}
            className="text-on-surface-variant/50 hover:text-primary transition-colors"
            title="Copy PO number"
          >
            <span className="material-symbols-outlined text-[14px]">{poIdCopied ? 'check' : 'content_copy'}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
        {/* ── Left column: Form ──────────────────────────────────────────── */}
        <div className="space-y-6">

          {/* SECTION 01 — Order Identity */}
          <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-6">
            <SectionLabel n="01" title="Order Identity" />
            <div className="space-y-4">
              {/* PO Number */}
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">PO Number</label>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container-low rounded-lg border border-outline-variant/20">
                    <button
                      onClick={() => setAutoPoId(true)}
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded transition-colors ${autoPoId ? 'bg-primary text-on-primary' : 'text-on-surface-variant'}`}
                    >
                      Auto
                    </button>
                    <button
                      onClick={() => setAutoPoId(false)}
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded transition-colors ${!autoPoId ? 'bg-primary text-on-primary' : 'text-on-surface-variant'}`}
                    >
                      Manual
                    </button>
                  </div>
                  {autoPoId ? (
                    <div className="flex items-center gap-2 flex-1 px-3 py-2 bg-surface-container-low/50 rounded-xl border border-outline-variant/15">
                      <span className="font-data-mono text-[14px] font-bold text-on-surface">{poId}</span>
                      <button
                        onClick={() => { navigator.clipboard.writeText(poId); setPoIdCopied(true); setTimeout(() => setPoIdCopied(false), 1500); }}
                        className="ml-auto text-on-surface-variant/40 hover:text-primary transition-colors"
                      >
                        <span className="material-symbols-outlined text-[14px]">{poIdCopied ? 'check' : 'content_copy'}</span>
                      </button>
                    </div>
                  ) : (
                    <input
                      className="bk-input flex-1 font-data-mono"
                      value={poId}
                      onChange={e => setPoId(e.target.value)}
                      placeholder="Enter PO number"
                    />
                  )}
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Order Date</label>
                  <input type="date" className="bk-input" value={orderedDate} onChange={e => setOrderedDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Expected Delivery</label>
                  <input type="date" className="bk-input" value={expectedDelivery} onChange={e => setExpectedDelivery(e.target.value)} />
                </div>
              </div>

              {/* Ordered By */}
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Ordered By</label>
                <div className="px-3 py-2.5 bg-surface-container-low/60 rounded-xl border border-outline-variant/15 text-[13px] text-on-surface-variant/70">
                  {orderedBy || '—'}
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 02 — Vendor & Project */}
          <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-6">
            <SectionLabel n="02" title="Vendor & Project" />
            <div className="space-y-4">

              {/* Project */}
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Project *</label>
                <select
                  className="bk-input"
                  value={projectId}
                  onChange={e => handleProjectChange(e.target.value)}
                >
                  <option value="">Select project…</option>
                  {projects?.map(p => (
                    <option key={p.project_id} value={p.project_id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Vendor search */}
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Vendor *</label>
                <div className="relative">
                  <input
                    ref={vendorSearchRef}
                    className="bk-input"
                    placeholder="Search vendor by name…"
                    value={vendorSearch}
                    onChange={e => { setVendorSearch(e.target.value); setShowVendorSug(true); setShowVendorCreate(false); }}
                    onFocus={() => setShowVendorSug(true)}
                    onBlur={() => setTimeout(() => setShowVendorSug(false), 200)}
                  />
                  {showVendorSug && (vendorSuggestions.length > 0 || vendorSearch.trim()) && (
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white rounded-xl border border-outline-variant/20 shadow-lg overflow-hidden max-h-64 overflow-y-auto">
                      {vendorSuggestions.map(v => (
                        <button
                          key={v.stakeholder_id}
                          className="w-full px-4 py-3 text-left hover:bg-surface-container-low/60 flex flex-col gap-0.5 border-b border-outline-variant/[0.06] transition-colors"
                          onMouseDown={() => {
                            setVendorId(v.stakeholder_id);
                            setSelectedVendor(v);
                            setVendorSearch(v.name);
                            setShowVendorSug(false);
                          }}
                        >
                          <span className="text-[13px] font-semibold text-on-surface">{v.name}</span>
                          <span className="text-[11px] text-on-surface-variant/50">{v.category}</span>
                        </button>
                      ))}
                      {/* Add vendor row — always shown at the bottom */}
                      <button
                        className="w-full px-4 py-3 text-left flex items-center gap-2 text-primary hover:bg-primary/5 transition-colors border-t border-outline-variant/10"
                        onMouseDown={() => {
                          setNewVendorName(vendorSearch.trim());
                          setShowVendorCreate(true);
                          setShowVendorSug(false);
                        }}
                      >
                        <span className="material-symbols-outlined text-[16px]">add</span>
                        <span className="text-[13px] font-semibold">
                          {vendorSearch.trim() ? `Add "${vendorSearch.trim()}" as new vendor` : 'Add new vendor'}
                        </span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Inline add-vendor form */}
                {showVendorCreate && (
                  <div className="mt-2 p-4 bg-surface-container-low/40 rounded-xl border border-primary/20 space-y-3">
                    <p className="text-[11px] font-bold text-primary uppercase tracking-wider">New Vendor</p>
                    <div>
                      <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1">Name *</label>
                      <input
                        autoFocus
                        className="bk-input text-[13px]"
                        placeholder="Vendor / company name"
                        value={newVendorName}
                        onChange={e => setNewVendorName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1">
                        Category <span className="text-red-500">*</span>
                      </label>
                      <select
                        className="bk-input text-[13px]"
                        value={newVendorCategory}
                        onChange={e => { setNewVendorCategory(e.target.value); setNewVendorCategoryOther(''); }}
                      >
                        <option value="" disabled>Select category…</option>
                        {VENDOR_TRADE_GROUPS.map(g => (
                          <optgroup key={g.group} label={g.group}>
                            {g.trades.map(t => <option key={t} value={t}>{t}</option>)}
                          </optgroup>
                        ))}
                      </select>
                      {newVendorCategory === OTHER_TRADE && (
                        <input
                          autoFocus
                          className="bk-input text-[13px] mt-2"
                          placeholder="Specify category…"
                          value={newVendorCategoryOther}
                          onChange={e => setNewVendorCategoryOther(e.target.value)}
                        />
                      )}
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1">GSTIN</label>
                      <input
                        className="bk-input text-[13px] font-data-mono"
                        placeholder="Optional"
                        value={newVendorGstin}
                        onChange={e => setNewVendorGstin(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => { setShowVendorCreate(false); setNewVendorName(''); setNewVendorCategory(''); setNewVendorCategoryOther(''); setNewVendorGstin(''); }}
                        className="bk-btn-ghost border border-outline-variant/30 text-[12px] px-3 py-1.5 rounded-lg"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => createVendor.mutate()}
                        disabled={
                          !newVendorName.trim() ||
                          !newVendorCategory ||
                          (newVendorCategory === OTHER_TRADE && !newVendorCategoryOther.trim()) ||
                          createVendor.isPending
                        }
                        className="bk-btn text-[12px] px-4 py-1.5 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {createVendor.isPending ? 'Saving…' : 'Create & Select'}
                        <span className="material-symbols-outlined text-[14px]">check</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Vendor info card */}
                {selectedVendor && !showVendorCreate && (
                  <div className="mt-2 p-4 bg-surface-container-low/60 rounded-xl border border-outline-variant/20">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-[13px] font-bold text-on-surface">{selectedVendor.name}</p>
                        <p className="text-[11px] text-on-surface-variant/50 mt-0.5">{selectedVendor.category}</p>
                        {selectedVendor.gstin && (
                          <p className="text-[11px] text-on-surface-variant/50">GSTIN: {selectedVendor.gstin}</p>
                        )}
                      </div>
                      {selectedVendor.is_approved && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-secondary-container text-on-secondary-container shrink-0">✓ Approved</span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Payment Terms */}
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Payment Terms</label>
                <div className="flex gap-2 flex-wrap">
                  {PAYMENT_TERMS.map(t => (
                    <button
                      key={t}
                      onClick={() => setPaymentTermsDays(t)}
                      className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
                        paymentTermsDays === t
                          ? 'bg-primary text-on-primary border-primary'
                          : 'border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-low'
                      }`}
                    >
                      {t} days
                    </button>
                  ))}
                  <button
                    onClick={() => setPaymentTermsDays(-1)}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
                      paymentTermsDays === -1
                        ? 'bg-primary text-on-primary border-primary'
                        : 'border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-low'
                    }`}
                  >
                    Custom
                  </button>
                  {paymentTermsDays === -1 && (
                    <input
                      className="bk-input w-24 text-[13px]"
                      type="number"
                      placeholder="Days"
                      value={customTerms}
                      onChange={e => setCustomTerms(e.target.value)}
                      min={1}
                    />
                  )}
                </div>
              </div>

              {/* Delivery Location */}
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Delivery Location</label>
                <input
                  className="bk-input"
                  placeholder="Delivery address or site"
                  value={deliveryLocation}
                  onChange={e => setDeliveryLocation(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* SECTION 03 — AI Document Extraction */}
          <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-6">
            <SectionLabel n="03" title="AI Document Extraction" />

            {/* Drop zone — no file yet */}
            {!extractFile && !pendingItems && (
              <label className="group flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-outline-variant/30 hover:border-primary/40 p-8 text-center cursor-pointer transition-colors">
                <span className="material-symbols-outlined text-[40px] text-on-surface-variant/20 group-hover:text-primary/30 transition-colors mb-3">upload_file</span>
                <p className="text-[14px] font-semibold text-on-surface-variant/60">Upload quotation or proforma</p>
                <p className="text-[12px] text-on-surface-variant/35 mt-1">AI extracts line items, quantities &amp; rates</p>
                <span className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-outline-variant/30 text-[13px] text-on-surface-variant group-hover:border-primary/30 transition-colors">
                  <span className="material-symbols-outlined text-[16px]">smart_toy</span>
                  Choose file
                </span>
                <p className="text-[11px] text-on-surface-variant/35 mt-2">JPG · PNG · PDF · max 10 MB</p>
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) { setExtractFile(f); setExtractError(null); setPendingItems(null); }
                    e.target.value = '';
                  }}
                />
              </label>
            )}

            {/* File selected — ready to extract */}
            {extractFile && !pendingItems && (
              <div className="rounded-xl border border-outline-variant/20 overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 bg-surface-container-low/40">
                  <span className="material-symbols-outlined text-[24px] text-primary/50 shrink-0">description</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-on-surface truncate">{extractFile.name}</p>
                    <p className="text-[11px] text-on-surface-variant/50">{(extractFile.size / 1024).toFixed(0)} KB</p>
                  </div>
                  {!extracting && (
                    <button
                      onClick={() => { setExtractFile(null); setExtractError(null); }}
                      className="text-on-surface-variant/40 hover:text-red-500 transition-colors shrink-0"
                      title="Remove file"
                    >
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  )}
                </div>

                {extractError && (
                  <div className="px-4 py-2.5 bg-red-50 border-t border-red-100">
                    <p className="text-[12px] text-red-700">{extractError}</p>
                  </div>
                )}

                <div className="px-4 py-3 border-t border-outline-variant/10">
                  <button
                    onClick={() => extractFromDocument(extractFile)}
                    disabled={extracting}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-on-primary text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-60 transition-colors"
                  >
                    {extracting ? (
                      <>
                        <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                        Analyzing document…
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-[16px]">smart_toy</span>
                        Extract Line Items
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Review panel — extracted items */}
            {pendingItems && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[12px] font-bold text-on-surface">
                    {pendingItems.length} item{pendingItems.length !== 1 ? 's' : ''} found
                    <span className="font-normal text-on-surface-variant/50 ml-1">— select to apply</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setPendingItems(null); setExtractFile(null); setSelectedIds(new Set()); }}
                      className="text-[12px] text-on-surface-variant hover:text-red-500 transition-colors"
                    >
                      Discard
                    </button>
                    <button
                      onClick={applyExtractedItems}
                      disabled={selectedIds.size === 0}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[12px] font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[14px]">check</span>
                      Apply {selectedIds.size} item{selectedIds.size !== 1 ? 's' : ''}
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-outline-variant/20 overflow-hidden divide-y divide-outline-variant/[0.08]">
                  {/* Select all row */}
                  <label className="flex items-center gap-3 px-3 py-2 bg-surface-container-low/60 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === pendingItems.length}
                      onChange={() => {
                        if (selectedIds.size === pendingItems.length) setSelectedIds(new Set());
                        else setSelectedIds(new Set(pendingItems.map(i => i._id)));
                      }}
                      className="accent-primary w-3.5 h-3.5"
                    />
                    <span className="text-[11px] font-semibold text-on-surface-variant/60 uppercase tracking-wider">
                      All items
                    </span>
                  </label>

                  {pendingItems.map(item => (
                    <label key={item._id} className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors ${selectedIds.has(item._id) ? 'bg-white' : 'bg-surface-container-low/30'}`}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item._id)}
                        onChange={() => {
                          setSelectedIds(prev => {
                            const next = new Set(prev);
                            next.has(item._id) ? next.delete(item._id) : next.add(item._id);
                            return next;
                          });
                        }}
                        className="mt-0.5 accent-primary w-3.5 h-3.5 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[12px] font-semibold text-on-surface">{item.item_name}</p>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                            item.confidence === 'HIGH'   ? 'bg-green-100 text-green-700' :
                            item.confidence === 'MEDIUM' ? 'bg-amber-100 text-amber-700' :
                            'bg-red-100 text-red-700'
                          }`}>{item.confidence}</span>
                        </div>
                        {item.specification && (
                          <p className="text-[10px] text-on-surface-variant/50 mt-0.5 truncate">{item.specification}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-data-mono text-[11px] text-on-surface">
                          {item.quantity} {item.unit} × ₹{item.unit_rate.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </p>
                        <p className="font-data-mono text-[10px] text-on-surface-variant/50">GST {item.gst_rate}%</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* SECTION 04 — Line Items */}
          <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-6">
            <SectionLabel n="04" title="Line Items" />

            {/* Line items table */}
            <div className="overflow-x-auto -mx-2">
              <table className="w-full min-w-[820px] text-[12px]">
                <thead>
                  <tr className="border-b border-outline-variant/15">
                    <th className="px-2 py-2 text-left text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide w-6">#</th>
                    <th className="px-2 py-2 text-left text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide w-36">Category</th>
                    <th className="px-2 py-2 text-left text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide">Item</th>
                    <th className="px-2 py-2 text-left text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide w-20">Unit</th>
                    <th className="px-2 py-2 text-right text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide w-16">Qty</th>
                    <th className="px-2 py-2 text-right text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide w-24">Rate ₹</th>
                    <th className="px-2 py-2 text-right text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide w-16">Disc%</th>
                    <th className="px-2 py-2 text-center text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide w-16">GST%</th>
                    <th className="px-2 py-2 text-right text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide w-28">Total ₹</th>
                    <th className="px-2 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map(li => (
                    <tr key={li.id} className="border-b border-outline-variant/[0.06] hover:bg-surface-container-low/20 transition-colors">
                      <td className="px-2 py-2 text-on-surface-variant/40 font-bold text-[11px]">{li.line_number}</td>
                      <td className="px-2 py-1.5">
                        <select
                          className="w-full text-[11px] bg-surface-container-low/40 border border-outline-variant/20 rounded-lg px-2 py-1.5 outline-none focus:border-primary/40 focus:bg-white transition-colors"
                          value={li.category_id}
                          onChange={e => updateLine(li.id, { category_id: e.target.value })}
                        >
                          <option value="">—</option>
                          {MAT_DIVISIONS.map(div => (
                            <optgroup key={div.code} label={`${div.code} · ${div.name}`}>
                              {div.items.map(item => (
                                <option key={item.code} value={item.code}>{item.code}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className="w-full text-[12px] bg-surface-container-low/40 border border-outline-variant/20 rounded-lg px-2 py-1.5 outline-none focus:border-primary/40 focus:bg-white transition-colors"
                          placeholder="Item name"
                          value={li.item_name}
                          onChange={e => updateLine(li.id, { item_name: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          className="w-full text-[11px] bg-surface-container-low/40 border border-outline-variant/20 rounded-lg px-2 py-1.5 outline-none focus:border-primary/40 focus:bg-white transition-colors"
                          value={li.unit}
                          onChange={e => updateLine(li.id, { unit: e.target.value })}
                        >
                          {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          className="w-full text-[12px] text-right bg-surface-container-low/40 border border-outline-variant/20 rounded-lg px-2 py-1.5 outline-none focus:border-primary/40 focus:bg-white transition-colors font-data-mono"
                          value={li.quantity_ordered}
                          min={0}
                          step="any"
                          onChange={e => updateLine(li.id, { quantity_ordered: parseFloat(e.target.value) || 0 })}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-on-surface-variant/40">₹</span>
                          <input
                            type="number"
                            className="w-full text-[12px] text-right bg-surface-container-low/40 border border-outline-variant/20 rounded-lg pl-5 pr-2 py-1.5 outline-none focus:border-primary/40 focus:bg-white transition-colors font-data-mono"
                            value={li.unit_rate}
                            min={0}
                            step="any"
                            onChange={e => updateLine(li.id, { unit_rate: parseFloat(e.target.value) || 0 })}
                          />
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          className="w-full text-[12px] text-right bg-surface-container-low/40 border border-outline-variant/20 rounded-lg px-2 py-1.5 outline-none focus:border-primary/40 focus:bg-white transition-colors font-data-mono"
                          value={li.discount_percent}
                          min={0}
                          max={100}
                          step="any"
                          onChange={e => updateLine(li.id, { discount_percent: parseFloat(e.target.value) || 0 })}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          className="w-full text-[11px] text-center bg-surface-container-low/40 border border-outline-variant/20 rounded-lg px-1 py-1.5 outline-none focus:border-primary/40 focus:bg-white transition-colors"
                          value={li.gst_rate}
                          onChange={e => updateLine(li.id, { gst_rate: parseFloat(e.target.value) })}
                        >
                          {GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <span className="font-data-mono text-[12px] font-semibold text-on-surface">
                          ₹{li.total_amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <button
                          onClick={() => removeLine(li.id)}
                          className="p-1 rounded-lg text-on-surface-variant/30 hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="Remove row"
                        >
                          <span className="material-symbols-outlined text-[16px]">close</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              onClick={addLine}
              className="mt-3 flex items-center gap-2 text-[12px] text-primary font-semibold hover:bg-primary/5 px-3 py-2 rounded-lg transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              Add Row
            </button>

            {/* Totals summary */}
            <div className="flex justify-end mt-4">
              <div className="w-64 space-y-1.5 text-[13px]">
                <div className="flex justify-between text-on-surface-variant/60">
                  <span>Subtotal ({lineItems.length} item{lineItems.length !== 1 ? 's' : ''})</span>
                  <span className="font-data-mono">₹{subtotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                </div>
                {totalDiscount > 0 && (
                  <div className="flex justify-between text-on-surface-variant/60">
                    <span>Discount</span>
                    <span className="font-data-mono">- ₹{totalDiscount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                  </div>
                )}
                <div className="flex justify-between text-on-surface-variant/60">
                  <span>GST</span>
                  <span className="font-data-mono">₹{totalGST.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                </div>
                <div className="flex justify-between font-bold text-[15px] border-t border-outline-variant/20 pt-2">
                  <span>Grand Total</span>
                  <span className="font-data-mono text-primary">₹{grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 05 — Terms */}
          <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-6">
            <SectionLabel n="05" title="Terms & Notes" />
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">
                  Vendor-Facing Notes <span className="text-on-surface-variant/40 normal-case font-normal">(printed on PO)</span>
                </label>
                <textarea
                  className="bk-input resize-none text-[13px]"
                  rows={3}
                  placeholder="Payment terms, delivery conditions, quality standards…"
                  value={vendorNotes}
                  onChange={e => setVendorNotes(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">
                  Internal Notes <span className="text-on-surface-variant/40 normal-case font-normal">(not printed)</span>
                </label>
                <textarea
                  className="bk-input resize-none text-[13px]"
                  rows={3}
                  placeholder="Internal remarks, follow-up notes…"
                  value={internalNotes}
                  onChange={e => setInternalNotes(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Right column: Live Preview ───────────────────────────────────── */}
        <div className="hidden lg:block">
          <div className="sticky top-6">
            <div className="bg-white rounded-2xl border border-black/[0.08] shadow-sm p-5 font-mono text-[11px] leading-relaxed">
              {/* Preview header */}
              <div className="flex justify-between mb-4 pb-3 border-b border-black/[0.06]">
                <div>
                  <p className="text-[12px] font-black tracking-tight font-sans">BRIKLAY ENGINEERING</p>
                  <p className="text-[9px] text-on-surface-variant/40 mt-0.5">Kakinada, East Godavari, AP</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-widest font-sans">Purchase Order</p>
                  <p className="text-[10px] text-on-surface-variant/60 font-data-mono">{poId || '—'}</p>
                  <p className="text-[9px] text-on-surface-variant/40">{orderedDate ? fmtDate(orderedDate) : '—'}</p>
                </div>
              </div>

              {/* Vendor + Project */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <p className="text-[8px] font-bold uppercase text-on-surface-variant/40 tracking-wider mb-1">Vendor</p>
                  {selectedVendor ? (
                    <>
                      <p className="text-[10px] font-bold text-on-surface">{selectedVendor.name}</p>
                      {selectedVendor.gstin && <p className="text-[8px] text-on-surface-variant/50">GSTIN: {selectedVendor.gstin}</p>}
                    </>
                  ) : (
                    <p className="text-[10px] text-on-surface-variant/30 italic">Not selected</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-[8px] font-bold uppercase text-on-surface-variant/40 tracking-wider mb-1">Project</p>
                  {projectId ? (
                    <p className="text-[10px] font-bold text-on-surface">
                      {projects?.find(p => p.project_id === projectId)?.name ?? '—'}
                    </p>
                  ) : (
                    <p className="text-[10px] text-on-surface-variant/30 italic">Not selected</p>
                  )}
                  {deliveryLocation && (
                    <p className="text-[8px] text-on-surface-variant/50 mt-0.5">{deliveryLocation}</p>
                  )}
                </div>
              </div>

              {/* Mini line items */}
              {lineItems.some(li => li.item_name) && (
                <div className="mb-3">
                  <table className="w-full text-[9px]">
                    <thead>
                      <tr className="border-b border-black/[0.06]">
                        <th className="text-left py-1 text-on-surface-variant/40 font-bold">#</th>
                        <th className="text-left py-1 text-on-surface-variant/40 font-bold">Item</th>
                        <th className="text-right py-1 text-on-surface-variant/40 font-bold">Qty</th>
                        <th className="text-right py-1 text-on-surface-variant/40 font-bold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineItems.filter(li => li.item_name).map(li => (
                        <tr key={li.id} className="border-b border-black/[0.03]">
                          <td className="py-1 text-on-surface-variant/40">{li.line_number}</td>
                          <td className="py-1 text-on-surface truncate max-w-[100px]">{li.item_name}</td>
                          <td className="py-1 text-right text-on-surface-variant/60">{li.quantity_ordered} {li.unit}</td>
                          <td className="py-1 text-right font-data-mono">
                            ₹{li.total_amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Totals */}
              <div className="border-t border-black/[0.06] pt-2 space-y-0.5">
                {totalDiscount > 0 && (
                  <div className="flex justify-between text-[9px] text-on-surface-variant/50">
                    <span>Discount</span>
                    <span className="font-data-mono">- ₹{totalDiscount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                  </div>
                )}
                <div className="flex justify-between text-[9px] text-on-surface-variant/50">
                  <span>GST</span>
                  <span className="font-data-mono">₹{totalGST.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                </div>
                <div className="flex justify-between text-[11px] font-bold text-on-surface pt-1">
                  <span>Grand Total</span>
                  <span className="font-data-mono text-primary">₹{grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                </div>
              </div>

              {/* Delivery */}
              {expectedDelivery && (
                <p className="mt-3 text-[8px] text-on-surface-variant/40">
                  Expected delivery: {fmtDate(expectedDelivery)}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-outline-variant/20 px-margin-mobile md:px-margin-desktop py-4 flex items-center gap-3 z-40 md:ml-[inherit]">
        <button
          onClick={() => navigate('/purchase-orders')}
          className="bk-btn-ghost border border-outline-variant/30 text-[13px] px-4 py-2.5 rounded-xl"
          disabled={saveMutation.isPending}
        >
          Cancel
        </button>
        <div className="flex-1" />
        <button
          onClick={() => saveMutation.mutate('Draft')}
          disabled={saveMutation.isPending}
          className="bk-btn-ghost border border-outline-variant/30 text-[13px] px-4 py-2.5 rounded-xl font-semibold"
        >
          {saveMutation.isPending ? 'Saving…' : 'Save as Draft'}
        </button>
        <button
          onClick={() => saveMutation.mutate('Ordered')}
          disabled={saveMutation.isPending}
          className="bk-btn text-[13px] px-5 py-2.5 rounded-xl flex items-center gap-2 font-semibold"
        >
          {saveMutation.isPending ? 'Placing…' : 'Place Order'}
          <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
        </button>
      </div>
    </div>
  );
}
