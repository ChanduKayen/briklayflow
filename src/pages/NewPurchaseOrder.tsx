// @ts-nocheck
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useSnackbar } from '../components/Snackbar';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import { useOrgId } from '../lib/auth/AuthProvider';
import { VENDOR_TRADE_GROUPS, OTHER_TRADE } from '../lib/trades';
import { multiply, subtract, applyPercent, sum } from '../lib/money';
import { matchSKUsFromFile, matchSKUsFromText } from '../lib/skuMatcher';
import { ParametricReviewPanel } from '../components/ParametricReviewPanel';

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


const UNITS = ['Nos', 'Bags', 'MT', 'm³', 'm²', 'RFT', 'Ltr', 'kg', 'Set', 'LS', 'Pair', 'Rmt', 'Sqft'];
const GST_RATES = [0, 5, 12, 18, 28];
const PAYMENT_TERMS = [15, 30, 45, 60];

const VENDOR_TO_SKU_CATEGORIES: Record<string, string[]> = {
  'Cement Supplier':                    ['Cement'],
  'Sand & Aggregate Supplier':          ['Sand', 'Aggregate'],
  'Bricks / Blocks Supplier':           ['Brick', 'Block'],
  'Steel / TMT Bar Supplier':           ['Steel'],
  'Waterproofing Materials Supplier':   ['Waterproofing'],
  'Admixture Supplier':                 ['Admixture', 'Chemical'],
  'Tiles Supplier':                     ['Tile'],
  'Marble / Granite Supplier':          ['Tile'],
  'Paint Supplier':                     ['Paint'],
  'Hardware & Fittings Supplier':       ['Hardware'],
  'Glass & Aluminium Supplier':         ['Glass', 'Windows', 'Doors'],
  'False Ceiling Materials Supplier':   ['Hardware', 'Plywood'],
  'Flooring Materials Supplier':        ['Tile'],
  'Electrical Materials Supplier':      ['Electrical'],
  'Plumbing Materials Supplier':        ['Plumbing'],
  'HVAC Materials Supplier':            ['Electrical', 'Plumbing'],
  'Sanitary Ware Supplier':             ['Plumbing'],
  'Lighting Supplier':                  ['Electrical'],
  'Cables & Conduits Supplier':         ['Electrical'],
  'Scaffolding Supplier':               ['Hardware'],
  'Tools & Machinery Vendor':           ['Hardware'],
  'Ready Mix Concrete (RMC) Plant':     ['Cement', 'Aggregate', 'Sand'],
};

type SKUResult = {
  sku_id:     string
  item_name:  string
  unit:       string
  similarity: number
}

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
  sku_id:        string | null;
  searchResults: SKUResult[];
  searching:     boolean;
  showDropdown:  boolean;
  confidence?:           number;
  needs_review?:         boolean;
  match_source?:         string;
  ai_suggested_name?:    string;
  extraction_confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  sku_alternatives?:     SKUResult[];
  validation_metrics?:   any;
  expandedReview?:       boolean;
  aiSuggestion?: {
    ai_suggested_name: string;
    extracted_attributes: {
      sub_category: string;
      dimension: string | null;
      variant: string | null;
      grade: string | null;
    };
    validation_metrics: {
      passes_shop_floor_test: boolean;
      missing_parameters: string[];
    };
    aliases?: string[];
    sku_id?: string;
    unit?: string;
  };
  isGeneratingAiChip?: boolean;
}

interface ExtractedItem {
  _id: string;
  item_raw: string;
  item_name: string;
  specification: string;
  unit: string;
  quantity: number;
  unit_rate: number;
  gst_rate: number;
  amount: number;
  has_price: boolean;
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
    sku_id:        null,
    searchResults: [],
    searching:     false,
    showDropdown:  false,
    isGeneratingAiChip: false,
  };
}

function computeLine(li: DraftLineItem): DraftLineItem {
  const basic   = multiply(li.quantity_ordered, li.unit_rate);
  const disc    = applyPercent(basic, li.discount_percent);
  const taxable = subtract(basic, disc);
  const cgst    = applyPercent(taxable, li.gst_rate / 2);
  const sgst    = applyPercent(taxable, li.gst_rate / 2);
  return {
    ...li,
    basic_amount:    basic,
    discount_amount: disc,
    cgst,
    sgst,
    total_amount: sum([taxable, cgst, sgst]),
  };
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const parsed = new Date(d);
  if (isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const EXTRACT_PROMPT = `You are a senior procurement manager for Indian construction projects with expertise in material trade names across AP, Telangana, and pan-India.

Given an image of a quotation, proforma invoice, or price list, extract ALL line items.

CRITICAL — item_name MUST be the standard industry name. NEVER copy the vendor's raw text verbatim.
Translate regional/trade shorthand to proper construction terminology:
- "jelly 20mm" / "metal" → "Coarse Aggregate 20mm"
- "tmt 12mm fe500d" / "tor bar" → "TMT Bar Fe500D 12mm"
- "opc 53" / "53 grade" / brand+"53" → "OPC 53 Cement"
- "opc 43" / "43 grade" → "OPC 43 Cement"
- "m-sand" / "robo sand" → "Manufactured Sand (M-Sand)"
- "river sand" / "fine agg" → "River Sand"
- "ita brick" / "mitti" / "country brick" → "Clay Brick"
- "solid block 200" / "cc block" → "Concrete Solid Block 200mm"
- "fly ash brick" / "fal-g" → "Fly Ash Brick"
Apply your domain knowledge for any other regional or trade terms you recognise.

Return ONLY valid JSON:
{
  "vendor_name": "string or null",
  "items": [
    {
      "item_raw": "verbatim text as it appears in the document",
      "item_name": "standard Indian construction industry name — never vendor shorthand or brand",
      "specification": "grade / size / variant string, or null",
      "unit": "one of: Nos Bags MT m³ m² RFT Ltr kg Set LS Pair Rmt Sqft",
      "quantity": number or null (null if not shown),
      "unit_rate": number or null — CRITICAL: null if the rate is NOT clearly printed in the document. DO NOT estimate, assume, or guess a price. Only set a number when the price is unambiguously visible.,
      "gst_rate": 5 or 12 or 18 or 28 or null (null if not shown — do not assume),
      "amount": number or null (null if unit_rate is null),
      "confidence": "HIGH" | "MEDIUM" | "LOW"
    }
  ]
}

Confidence: HIGH = all fields clearly visible, MEDIUM = some fields inferred, LOW = heavy guessing.
For lump-sum items use unit "LS", quantity 1, unit_rate = lump-sum value only if the value is explicitly stated.
Do not invent items, prices, or quantities not visible in the document.`;

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
  const location   = useLocation();
  const qc         = useQueryClient();
  const { show: showSnackbar } = useSnackbar();
  const { data: profile } = useUserProfile(session.user.id);
  const orgId = useOrgId();
  const vendorSearchRef   = useRef<HTMLInputElement>(null);
  const searchDebounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const aiMatchDebounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const fileInputRef      = useRef<HTMLInputElement>(null);
  const itemRefs          = useRef<Map<string, HTMLDivElement>>(new Map());
  const lineItemsRef      = useRef<DraftLineItem[]>([]);

  const [orderedDate, setOrderedDate]         = useState(new Date().toISOString().split('T')[0]);
  const [expectedDelivery, setExpectedDelivery] = useState('');
  const orderedBy = profile?.name ?? '';

  const [projectId, setProjectId]               = useState<string>((location.state as any)?.projectId || '');
  const [vendorId, setVendorId]                 = useState('');
  const [vendorSearch, setVendorSearch]         = useState('');
  const [showVendorSug, setShowVendorSug]       = useState(false);
  const [selectedVendor, setSelectedVendor]     = useState<any>(null);
  const [paymentTermsDays, setPaymentTermsDays] = useState(30);
  const [customTerms, setCustomTerms]           = useState('');
  const [deliveryLocation, setDeliveryLocation] = useState('');

  const [showVendorCreate, setShowVendorCreate] = useState(false);
  const [newVendorName, setNewVendorName]             = useState('');
  const [newVendorCategory, setNewVendorCategory]     = useState('');
  const [newVendorCategoryOther, setNewVendorCategoryOther] = useState('');
  const [newVendorGstin, setNewVendorGstin]           = useState('');

  const [lineItems, setLineItems] = useState<DraftLineItem[]>([newLine(1)]);
  const [aiMatchingIds, setAIMatchingIds]   = useState<Set<string>>(new Set());
  const [aiJustMatchedIds, setAIJustMatchedIds] = useState<Set<string>>(new Set());
  const [addingToDict, setAddingToDict]     = useState(false);
  const [dictAddResult, setDictAddResult]   = useState<{ added: number; items: string[] } | null>(null);
  const [dictAddingIds, setDictAddingIds]   = useState<Set<string>>(new Set());
  const [dictAddedIds, setDictAddedIds]     = useState<Set<string>>(new Set());
  const [isGlobalMatching, setIsGlobalMatching] = useState(false);
  const [skuResolutionMode, setSkuResolutionMode] = useState(false);
  const [isAnalyzingSubmit, setIsAnalyzingSubmit] = useState(false);

  lineItemsRef.current = lineItems;

  const [extractFile, setExtractFile]   = useState<File | null>(null);
  const [extracting, setExtracting]     = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [pendingItems, setPendingItems]   = useState<ExtractedItem[] | null>(null);
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set());
  const [docExtracting, setDocExtracting] = useState(false);
  const [docExtractError, setDocExtractError] = useState<string | null>(null);

  const [vendorNotes, setVendorNotes]   = useState('');
  const [internalNotes, setInternalNotes] = useState('');

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('project_id, name, site_location, project_code').order('name');
      if (error) throw error;
      return data as { project_id: string; name: string; site_location: string; project_code: string | null }[];
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

  const selectedProjectObj = projects?.find(p => p.project_id === projectId);

  const vendorSuggestions = useMemo(() => {
    if (!vendorSearch || !vendors) return [];
    const q = vendorSearch.toLowerCase();
    return vendors.filter(v => v.name.toLowerCase().includes(q) || v.category?.toLowerCase().includes(q)).slice(0, 8);
  }, [vendorSearch, vendors]);

  const vendorSKUCategories = useMemo<string[] | null>(() => {
    if (!selectedVendor?.category) return null;
    return VENDOR_TO_SKU_CATEGORIES[selectedVendor.category] ?? null;
  }, [selectedVendor]);

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

  async function searchSKUs(itemId: string, query: string) {
    clearTimeout(searchDebounceRef.current[itemId]);
    if (!query || query.trim().length < 2) {
      updateLine(itemId, { searchResults: [], showDropdown: false, sku_alternatives: [], searching: false });
      return;
    }
    updateLine(itemId, { searching: true });
    searchDebounceRef.current[itemId] = setTimeout(async () => {
      const cats = vendorSKUCategories;
      const rpcParams: Record<string, unknown> = {
        p_search_term: query.trim(),
        p_limit:       3
      };
      if (cats && cats.length === 1) rpcParams.p_category = cats[0];
      else if (cats && cats.length > 1) rpcParams.p_categories = cats;
      
      const { data, error } = await supabase.rpc('trgm_match_sku', rpcParams as any);
      if (error) {
        console.error('SKU search error:', error);
        updateLine(itemId, { searching: false });
        return;
      }
      const results = (data ?? []) as SKUResult[];
      const hasHighConfidenceMatch = results.some(c => c.similarity > 0.75);

      updateLine(itemId, {
        sku_alternatives: results,
        searchResults: [],
        showDropdown: false,
        searching: false,
        isGeneratingAiChip: !hasHighConfidenceMatch,
      });

      if (!hasHighConfidenceMatch) {
        runAIAutoMatch(itemId);
      }
    }, 350);
  }

  function selectSKU(itemId: string, sku: SKUResult) {
    updateLine(itemId, {
      item_name:        sku.item_name,
      sku_id:           sku.sku_id,
      unit:             sku.unit,
      searchResults:    [],
      showDropdown:     false,
      sku_alternatives: undefined,
    });
  }

  function clearSKU(itemId: string) {
    updateLine(itemId, { sku_id: null, searchResults: [], showDropdown: false, sku_alternatives: undefined });
  }

  async function autoMatchSKU(itemId: string, query: string) {
    if (!query || query.trim().length < 2) return;
    const cats = vendorSKUCategories;
    const rpcParams: Record<string, unknown> = {
      p_search_term: query.trim(),
      p_limit:       8,
    };
    if (cats && cats.length === 1)  rpcParams.p_category   = cats[0];
    else if (cats && cats.length > 1) rpcParams.p_categories = cats;

    updateLine(itemId, { searching: true, showDropdown: false });
    const { data, error } = await supabase.rpc('trgm_match_sku', rpcParams as any);
    if (error || !data?.length) {
      updateLine(itemId, { searching: false });
      return;
    }
    const results = data as SKUResult[];
    const top = results[0];
    if (top.similarity >= 0.82) {
      updateLine(itemId, {
        item_name:     top.item_name,
        sku_id:        top.sku_id,
        unit:          top.unit,
        searchResults: [],
        showDropdown:  false,
        searching:     false,
        confidence:    Math.round(top.similarity * 100),
        needs_review:  top.similarity < 0.85,
        match_source:  'trgm',
      });
    } else {
      updateLine(itemId, {
        sku_alternatives: results.slice(0, 3),
        searchResults:    [],
        showDropdown:     false,
        searching:        false,
      });
    }
  }

  async function runAIAutoMatch(itemId: string) {
    const li = lineItemsRef.current.find(l => l.id === itemId);
    if (!li || li.sku_id || li.item_name.trim().length < 2) return;

    setAIMatchingIds(prev => new Set([...prev, itemId]));
    try {
      const still = lineItemsRef.current.find(l => l.id === itemId);
      if (!still || still.sku_id) return;

      const siblingItems = lineItemsRef.current
        .filter(l => l.id !== itemId && l.item_name.trim().length > 0)
        .map(l => l.item_name);

      const { data, error } = await supabase.functions.invoke('sku-matcher', {
        body: {
          action: 'generateStructuredSkuWithContext',
          text: still.item_name,
          vendor_category: selectedVendor?.category,
          documentSiblingItems: siblingItems
        }
      });

      if (error || !data) {
        throw new Error('AI Web-Inference failed');
      }

      updateLine(itemId, {
        aiSuggestion: {
          ai_suggested_name: data.ai_suggested_name,
          extracted_attributes: data.extracted_attributes,
          validation_metrics: data.validation_metrics,
          aliases: data.aliases || [],
          unit: still.unit || 'Nos',
          p_embedding: data.p_embedding
        },
        isGeneratingAiChip: false,
        ai_suggested_name: undefined,
        searchResults: [],
        showDropdown: false,
      });
    } catch (err) {
      console.error('AI auto-match failed:', err);
      updateLine(itemId, { isGeneratingAiChip: false });
    } finally {
      setAIMatchingIds(prev => { const n = new Set(prev); n.delete(itemId); return n; });
    }
  }

  interface FinalSkuApprovalPayload {
    sub_category: string;
    dimension: string | null;
    variant: string | null;
    grade: string | null;
    canonicalName: string;
    aliases?: string[];
    p_embedding?: number[];
  }

  const handleApproveParametricSku = async (
    lineItemId: string, 
    formValues: FinalSkuApprovalPayload, 
    harvestedAliases: string[] = []
  ) => {
    try {
      // 1. Generate a clean, independent client-side UUID for the new master record
      const newSkuId = crypto.randomUUID();
      
      // ANTI-POLLUTION GUARD: Strip out internal vendor codes or messy formatting strings
      const cleanSubCategory = (formValues.sub_category || "Plumbing Putty / Joint Sealant")
        .replace(/[_\-]/g, ' ')
        .trim();

      // 2. Execute the atomic transaction directly into the data catalog
      const { error: rpcError } = await supabase.from('sku_directory').insert({
        sku_id: newSkuId,
        category: selectedVendor?.category || "General Supplies", // Bound Master Category Node
        sub_category: cleanSubCategory,
        dimension: formValues.dimension && formValues.dimension.toLowerCase() !== 'null' ? formValues.dimension.trim() : null,
        variant: formValues.variant && formValues.variant.toLowerCase() !== 'null' ? formValues.variant.trim() : null,
        grade: formValues.grade && formValues.grade.toLowerCase() !== 'null' ? formValues.grade.trim() : null,
        aliases: harvestedAliases, // Securely binds your 3-4 Serper-harvested trade aliases
        standard_unit: 'NOS',       // Enforce explicit canonical uppercase unit strings
        embedding: formValues.p_embedding || null, // CRITICAL FIX: Pull the synchronous float array natively
        is_active: true
      });

      if (rpcError) {
        if (rpcError.code === '23505') {
          console.warn('Race condition handled: SKU signature already exists. Proceeding with state relink.');
        } else {
          throw rpcError;
        }
      }

      // 3. RE-LINKING ENGINE: Update local line items state to clear submission gates
      setLineItems((prevLines) =>
        prevLines.map((line) => {
          if (line.id === lineItemId) {
            return {
              ...line,
              sku_id: newSkuId, // Force-bind the newly minted catalog ID to this line item row!
              item_name: formValues.canonicalName.toUpperCase().trim(), // Set the pristine uppercase name
              is_verified: true, // Clears ironclad submission validation
              needs_review: false,
              expandedReview: false // Collapses the open review card UI element instantly
            };
          }
          return line;
        })
      );

      console.log(`Pipeline Linked Successfully: Row ${lineItemId} linked to generated SKU ${newSkuId}`);
      showSnackbar(`✦ SKU Linked: ${formValues.canonicalName.toUpperCase().trim()}`);

    } catch (err: any) {
      console.error('Master Catalog Insertion Pipeline Crashed:', err);
      showSnackbar(`Database Link Failed: ${err.message}`);
    }
  };

  async function autoAddItemToDictionary(itemId: string, viaAI: boolean = false, explicitSkuData?: any) {
    const li = lineItemsRef.current.find(l => l.id === itemId);
    if (!li || li.sku_id || li.item_name.trim().length < 2) return;
    if (dictAddingIds.has(itemId)) return;

    setDictAddingIds(prev => new Set([...prev, itemId]));
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    try {
      let sku: any;

      if (explicitSkuData) {
        const category = selectedVendor?.category || 'Plumbing';
        const shortSub = explicitSkuData.sub_category.replace(/[^A-Za-z0-9]/g, '').substring(0, 10).toUpperCase();
        let skuId = `${category.toUpperCase()}-${shortSub}`;
        if (explicitSkuData.dimension) skuId += `-${explicitSkuData.dimension.replace(/[^A-Za-z0-9]/g, '').substring(0, 5).toUpperCase()}`;
        if (explicitSkuData.variant) skuId += `-${explicitSkuData.variant.replace(/[^A-Za-z0-9]/g, '').substring(0, 10).toUpperCase()}`;
        
        sku = {
          sku_id: skuId,
          category: category,
          sub_category: explicitSkuData.sub_category,
          dimension: explicitSkuData.dimension || null,
          variant: explicitSkuData.variant || null,
          grade: explicitSkuData.grade || null,
          standard_unit: li.unit,
          aliases: explicitSkuData.aliases || (explicitSkuData.originalName ? [explicitSkuData.originalName] : [])
        };
      } else {
        const prompt = `You are a construction materials procurement expert for Indian building projects.

An item was entered in a Purchase Order but could NOT be found in the SKU dictionary.
Your task: generate a proper sku_directory record for it AND explain the gap.

Item name   : "${li.item_name}"
Specification: "${li.specification || 'none'}"
Vendor type : "${selectedVendor?.category || 'unknown'}"

Return ONLY valid JSON (no markdown):
{
  "sku_id": "CATEGORY-SHORT_SUBCAT-DIM-VARIANT-GRADE (uppercase, hyphens only, max 45 chars, e.g. STEEL-TMT-16MM-BAR-FE415)",
  "category": "one of: Cement|Steel|Aggregate|Sand|Brick|Block|Paint|Tile|Plumbing|Electrical|Hardware|Plywood|Waterproofing|Admixture",
  "sub_category": "full descriptive name e.g. TMT Bar, OPC 53 Cement",
  "dimension": "size string e.g. 12mm or null",
  "variant": "type variant e.g. Bar, Bag or null",
  "grade": "grade/standard e.g. Fe500D, IS303 or null",
  "aliases": ["regional", "trade", "shorthand", "names", "vendors", "commonly", "use"],
  "standard_unit": "one of: Bags|MT|kg|Nos|Rmt|Sqft|Ltr|m³|m²|Set|LS|Pair",
  "reason_missing": "one sentence: what gap in the dictionary caused this miss"
}`;

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model:       'gpt-4.1-mini',
          max_tokens:  500,
          temperature: 0,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) return;

      const json    = await res.json();
      const raw     = json.choices?.[0]?.message?.content?.trim() ?? '';
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      sku     = JSON.parse(cleaned);
      if (!sku.sku_id || !sku.category || !sku.sub_category) return;
      }

      const { error } = await supabase.from('sku_directory').insert([{
        sku_id:        sku.sku_id,
        category:      sku.category,
        sub_category:  sku.sub_category,
        dimension:     sku.dimension    ?? null,
        variant:       sku.variant      ?? null,
        grade:         sku.grade        ?? null,
        aliases:       sku.aliases      ?? [],
        standard_unit: sku.standard_unit,
        embedding:     explicitSkuData?.p_embedding || null,
        is_active:     true,
      }]);
      if (error && error.code !== '23505') { console.error('SKU insert error:', error); return; }

      let topSkuId = null;
      let topItemName = null;
      let topUnit = null;

      if (explicitSkuData) {
        // Instant relinking for explicit data bypassing trgm index latency
        topSkuId = sku.sku_id;
        topItemName = explicitSkuData.canonicalName;
        topUnit = sku.standard_unit;
      } else {
        const cats = vendorSKUCategories;
        const params: Record<string, unknown> = { p_search_term: li.item_name.trim(), p_limit: 1, p_threshold: 0.10 };
        if (cats?.length === 1) params.p_category   = cats[0];
        else if (cats?.length)  params.p_categories = cats;
        const { data: trgmData } = await supabase.rpc('trgm_match_sku', params as any);
        const top = (trgmData as any[])?.[0];
        if (top) {
          topSkuId = top.sku_id;
          topItemName = top.item_name;
          topUnit = top.unit;
        }
      }

      const still = lineItemsRef.current.find(l => l.id === itemId);
      if (topSkuId && still && !still.sku_id) {
        updateLine(itemId, {
          sku_id:            topSkuId,
          item_name:         topItemName,
          unit:              topUnit || still.unit,
          confidence:        100,
          needs_review:      false,
          is_verified:       true,
          match_source:      explicitSkuData ? 'manual' : 'trgm',
          ai_suggested_name: undefined,
          expandedReview:    false
        });
        setDictAddedIds(prev => new Set([...prev, itemId]));
        setTimeout(() => setDictAddedIds(prev => { const n = new Set(prev); n.delete(itemId); return n; }), 4000);
        showSnackbar(`✦ New SKU "${sku.sub_category}" created & assigned`);
      }
    } catch (err) {
      console.error('Auto-add to dict failed for', li.item_name, err);
    } finally {
      setDictAddingIds(prev => { const n = new Set(prev); n.delete(itemId); return n; });
    }
  }

  async function addMissingToDictionary() {
    const missing = lineItemsRef.current.filter(li => !li.sku_id && li.item_name.trim().length >= 2);
    if (!missing.length) return;

    setAddingToDict(true);
    setDictAddResult(null);
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    const addedNames: string[] = [];

    for (const li of missing) {
      try {
        const prompt = `You are a construction materials procurement expert for Indian building projects.

An item was entered in a Purchase Order but could NOT be found in the SKU dictionary.
Your task: generate a proper sku_directory record for it AND explain the gap.

Item name   : "${li.item_name}"
Specification: "${li.specification || 'none'}"
Vendor type : "${selectedVendor?.category || 'unknown'}"

Return ONLY valid JSON (no markdown):
{
  "sku_id": "CATEGORY-SHORT_SUBCAT-DIM-VARIANT-GRADE (uppercase, hyphens only, max 45 chars, e.g. STEEL-TMT-16MM-BAR-FE415)",
  "category": "one of: Cement|Steel|Aggregate|Sand|Brick|Block|Paint|Tile|Plumbing|Electrical|Hardware|Plywood|Waterproofing|Admixture",
  "sub_category": "full descriptive name e.g. TMT Bar, OPC 53 Cement",
  "dimension": "size string e.g. 12mm or null",
  "variant": "type variant e.g. Bar, Bag or null",
  "grade": "grade/standard e.g. Fe500D, IS303 or null",
  "aliases": ["regional", "trade", "shorthand", "names", "vendors", "commonly", "use"],
  "standard_unit": "one of: Bags|MT|kg|Nos|Rmt|Sqft|Ltr|m³|m²|Set|LS|Pair",
  "reason_missing": "one sentence: what gap in the dictionary caused this miss"
}`;

        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model:       'gpt-4.1-mini',
            max_tokens:  500,
            temperature: 0,
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        if (!res.ok) continue;

        const json = await res.json();
        const raw  = json.choices?.[0]?.message?.content?.trim() ?? '';
        const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
        const sku  = JSON.parse(cleaned);

        if (!sku.sku_id || !sku.category || !sku.sub_category) continue;

        const { error } = await supabase.from('sku_directory').insert([{
          sku_id:        sku.sku_id,
          category:      sku.category,
          sub_category:  sku.sub_category,
          dimension:     sku.dimension    ?? null,
          variant:       sku.variant      ?? null,
          grade:         sku.grade        ?? null,
          aliases:       sku.aliases      ?? [],
          standard_unit: sku.standard_unit,
          is_active:     true,
        }]);

        if (error) {
          if (error.code !== '23505') console.error('SKU insert error:', error);
          continue;
        }

        addedNames.push(sku.sub_category);

        const cats = vendorSKUCategories;
        const params: Record<string, unknown> = { p_search_term: li.item_name.trim(), p_limit: 1, p_threshold: 0.10 };
        if (cats?.length === 1) params.p_category   = cats[0];
        else if (cats?.length)  params.p_categories = cats;
        const { data: trgmData } = await supabase.rpc('trgm_match_sku', params as any);
        const top = (trgmData as any[])?.[0];
        if (top?.sku_id) {
          updateLine(li.id, {
            sku_id:       top.sku_id,
            item_name:    top.item_name,
            unit:         top.unit || li.unit,
            confidence:   Math.round(top.similarity * 100),
            needs_review: true,
            match_source: 'trgm',
          });
          setAIJustMatchedIds(prev => new Set([...prev, li.id]));
          setTimeout(() => setAIJustMatchedIds(prev => { const n = new Set(prev); n.delete(li.id); return n; }), 4000);
        }
      } catch (err) {
        console.error('SKU generation failed for', li.item_name, err);
      }
    }

    setAddingToDict(false);
    setDictAddResult({ added: addedNames.length, items: addedNames });
    if (addedNames.length > 0) showSnackbar(`Added ${addedNames.length} new SKU${addedNames.length > 1 ? 's' : ''} to dictionary`);
  }

  const subtotal      = sum(lineItems.map(li => li.basic_amount));
  const totalDiscount = sum(lineItems.map(li => li.discount_amount));
  const totalGST      = sum(lineItems.map(li => li.cgst + li.sgst));
  const grandTotal    = sum(lineItems.map(li => li.total_amount));

  function handleProjectChange(pid: string) {
    setProjectId(pid);
    const proj = projects?.find(p => p.project_id === pid);
    if (proj?.site_location) setDeliveryLocation(proj.site_location);
  }

  const saveMutation = useMutation({
    mutationFn: async (status: string): Promise<string> => {
      if (!vendorId)     throw new Error('Please select a vendor');
      if (!projectId)    throw new Error('Please select a project');
      if (!lineItems.length || !lineItems.some(li => li.item_name.trim())) {
        throw new Error('Please add at least one line item');
      }

      const terms = paymentTermsDays === -1 ? parseInt(customTerms) || 30 : paymentTermsDays;

      const legacyItems = lineItems.map(li => ({
        description: li.item_name,
        qty: li.quantity_ordered,
        unit: li.unit,
        rate: li.unit_rate,
        amount: li.total_amount,
      }));

      const poData = {
        org_id:              orgId,
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
      };

      const lineItemRows = lineItems
        .filter(li => li.item_name.trim())
        .map(li => ({
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

      const { data, error: rpcError } = await supabase.rpc('create_purchase_order', {
        p_po_data:    poData,
        p_line_items: lineItemRows,
      });
      if (rpcError) throw rpcError;
      if (!data?.success) throw new Error(data?.error ?? 'Failed to create purchase order');

      return data.po_id as string;
    },
    onSuccess: (generatedPoId) => {
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      showSnackbar(`PO ${generatedPoId} created`);
      navigate(projectId ? `/projects/${projectId}/purchase-orders` : '/purchase-orders');
    },
    onError: (err: any) => {
      showSnackbar(err.message || 'Failed to save', { type: 'error' });
    },
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
        org_id:   orgId,
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
          model: 'gpt-4.1',
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
          item_raw:      String(it.item_raw     || it.item_name || ''),
          item_name:     String(it.item_name    || ''),
          specification: String(it.specification || ''),
          unit:          String(it.unit          || 'Nos'),
          quantity:      it.quantity  != null ? (Number(it.quantity)  || 1) : 1,
          unit_rate:     it.unit_rate != null ? (Number(it.unit_rate) || 0) : 0,
          gst_rate:      it.gst_rate  != null ? (Number(it.gst_rate)  || 18) : 18,
          amount:        it.amount    != null ? (Number(it.amount)    || 0) : 0,
          has_price:     it.unit_rate != null,
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
    const newLines = toApply.map((it, i) => computeLine({
      ...newLine(i + 1),
      item_name:             it.item_name,
      specification:         it.specification,
      unit:                  it.unit,
      quantity_ordered:      it.quantity,
      unit_rate:             it.unit_rate,
      gst_rate:              it.gst_rate,
      extraction_confidence: it.confidence,
    }));
    setLineItems(newLines);
    setPendingItems(null);
    setExtractFile(null);
    setSelectedIds(new Set());
    showSnackbar(`${toApply.length} line item${toApply.length !== 1 ? 's' : ''} applied — matching SKUs…`);
    newLines.forEach(li => {
      if (li.item_name.trim().length >= 2) autoMatchSKU(li.id, li.item_name);
    });
    setTimeout(() => {
      lineItemsRef.current
        .filter(li => !li.sku_id && li.item_name.trim().length >= 2 && !li.sku_alternatives?.length && !li.searchResults?.length)
        .forEach(li => autoAddItemToDictionary(li.id));
    }, 3000);
  }

  async function handleDocumentUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setDocExtracting(true);
    setDocExtractError(null);
    try {
      const result = await matchSKUsFromFile(file, 'po_creation', selectedVendor?.category);
      if (result.error) {
        setDocExtractError(result.error);
        return;
      }
      const base = lineItems.filter(l => l.item_name.trim()).length;
      const newItems = result.items.map((item, i) => computeLine({
        ...newLine(base + i + 1),
        item_name:        item.sku_name ?? item.item_name,
        sku_id:           item.sku_id,
        unit:             item.unit ?? 'Nos',
        quantity_ordered: item.quantity ?? 1,
        confidence:       item.confidence,
        needs_review:     item.needs_review,
        match_source:     item.match_source,
      }));
      setLineItems(prev => [...prev.filter(l => l.item_name.trim()), ...newItems]);
      showSnackbar(`${newItems.length} item${newItems.length !== 1 ? 's' : ''} extracted`);
      newItems
        .filter(li => !li.sku_id && li.item_name.trim().length >= 2)
        .forEach(li => setTimeout(() => autoAddItemToDictionary(li.id), 500));
    } catch (err: any) {
      setDocExtractError('Failed to process document. Try again.');
      console.error(err);
    } finally {
      setDocExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleSubmit(status: string) {
    setIsGlobalMatching(true);
    let hasUnresolved = false;
    const updatedLines = [...lineItems];

    for (let i = 0; i < updatedLines.length; i++) {
      const li = updatedLines[i];
      if (li.item_name.trim() && !li.sku_id) {
        const cats = vendorSKUCategories;
        const rpcParams: Record<string, unknown> = {
          p_search_term: li.item_name.trim(),
          p_limit: 8,
          p_threshold: 0.10,
        };
        if (cats && cats.length === 1) rpcParams.p_category = cats[0];
        else if (cats && cats.length > 1) rpcParams.p_categories = cats;

        const { data, error } = await supabase.rpc('trgm_match_sku', rpcParams as any);
        if (!error && data && data.length > 0) {
          const top = data[0] as SKUResult;
          if (top.similarity >= 0.82) {
            updatedLines[i] = {
              ...li,
              item_name: top.item_name,
              sku_id: top.sku_id,
              unit: top.unit,
            };
          } else {
            hasUnresolved = true;
            updatedLines[i] = { ...li, expandedReview: true };
          }
        } else {
          hasUnresolved = true;
          updatedLines[i] = { ...li, expandedReview: true };
        }
      }
    }

    if (hasUnresolved) {
      setLineItems(updatedLines);
      setIsGlobalMatching(false);
      setSkuResolutionMode(true);
      showSnackbar('Action Required: Please resolve missing SKUs before submission.');
      return;
    }

    setLineItems(updatedLines);
    setIsGlobalMatching(false);
    saveMutation.mutate(status);
  }

  return (
    <>
      {isGlobalMatching && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white/40 backdrop-blur-xl transition-all duration-300">
          <div className="relative flex items-center justify-center mb-6">
            <div className="absolute inset-0 rounded-full bg-blue-500/10 animate-ping scale-150 duration-1000" />
            <div className="p-5 bg-white shadow-xl rounded-2xl border border-slate-100 text-blue-600">
              <span className="material-symbols-outlined text-4xl animate-pulse">auto_awesome</span>
            </div>
          </div>
          <h3 className="text-xl font-semibold text-slate-800 tracking-tight mb-2">Analyzing Product Ontology</h3>
          <p className="text-sm text-slate-500 max-w-sm text-center mb-6 leading-relaxed">
            Cross-referencing line items with global master data standards and checking taxonomy constraints...
          </p>
          <div className="w-48 h-1.5 bg-slate-100 rounded-full overflow-hidden relative">
            <div className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full animate-[loading_1.5s_infinite_ease-in-out]" style={{ width: '40%' }} />
          </div>
          <style>{`
            @keyframes loading {
              0% { transform: translateX(-100%); }
              100% { transform: translateX(250%); }
            }
          `}</style>
        </div>
      )}

      <div className="px-margin-mobile md:px-margin-desktop pt-6 pb-32">
      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(projectId ? `/projects/${projectId}/purchase-orders` : '/purchase-orders')}
          className="p-2 rounded-xl hover:bg-surface-container-low transition-colors text-on-surface-variant"
        >
          <span className="material-symbols-outlined text-[22px]">arrow_back</span>
        </button>
        <div className="flex-1">
          <h2 className="text-[22px] font-bold text-on-surface tracking-tight">New Purchase Order</h2>
        </div>
        {/* PO ID display */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-surface-container rounded-xl border border-outline-variant/20">
          <span className="font-data-mono text-[13px] text-on-surface-variant/40 italic">
            {selectedProjectObj?.project_code
              ? `PO-${selectedProjectObj.project_code}-…`
              : 'Auto-generated'}
          </span>
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
                <div className="flex items-center gap-2 px-3 py-2 bg-surface-container-low/50 rounded-xl border border-outline-variant/15">
                  <span className="font-data-mono text-[14px] text-on-surface-variant/40 italic">
                    {selectedProjectObj?.project_code
                      ? `PO-${selectedProjectObj.project_code}-YYMMDD-NNN`
                      : 'Auto-generated on save'}
                  </span>
                  <span className="ml-auto text-[9px] px-1.5 py-0.5 bg-surface-container-highest text-on-surface-variant/50 rounded font-bold tracking-wider">AUTO</span>
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
                        {item.item_raw && item.item_raw !== item.item_name && (
                          <p className="text-[10px] text-on-surface-variant/35 mt-0.5 truncate italic">"{item.item_raw}"</p>
                        )}
                        {item.specification && (
                          <p className="text-[10px] text-on-surface-variant/50 mt-0.5 truncate">{item.specification}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-data-mono text-[11px] text-on-surface">
                          {item.quantity} {item.unit}
                          {item.has_price
                            ? <> × ₹{item.unit_rate.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</>
                            : <span className="text-on-surface-variant/40 not-italic font-sans text-[10px]"> · rate not found</span>
                          }
                        </p>
                        {item.has_price && (
                          <p className="font-data-mono text-[10px] text-on-surface-variant/50">GST {item.gst_rate}%</p>
                        )}
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

            {/* SKU document upload — Feature 2 */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.txt"
              onChange={handleDocumentUpload}
              style={{ display: 'none' }}
            />
            {!docExtracting && (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDrop={e => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file) handleDocumentUpload({ target: { files: [file] } } as any);
                }}
                onDragOver={e => e.preventDefault()}
                className="flex items-center gap-3 rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low/30 px-4 py-3 cursor-pointer mb-4 transition-colors hover:border-outline-variant/70 hover:bg-surface-container-low/50"
              >
                <span className="material-symbols-outlined text-[20px] text-on-surface-variant/30 shrink-0">cloud_upload</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-on-surface/80">Upload quotation or requirement list</div>
                  <div className="text-[11px] text-on-surface-variant/40 mt-0.5">
                    {vendorSKUCategories
                      ? <>AI matches to <span className="font-semibold text-primary/70">{vendorSKUCategories.join(', ')}</span> SKUs</>
                      : 'Photo, PDF or text — AI extracts and matches SKUs automatically'}
                  </div>
                </div>
                <span className="text-[11px] px-3 py-1 rounded-full border border-outline-variant/20 text-on-surface-variant/40 shrink-0 hidden sm:block">
                  or drag &amp; drop
                </span>
              </div>
            )}
            {docExtracting && (
              <div className="flex items-center gap-3 rounded-xl border border-outline-variant/15 bg-surface-container-low/30 px-4 py-3 mb-4">
                <span className="material-symbols-outlined text-[18px] text-on-surface-variant/40 animate-spin shrink-0">progress_activity</span>
                <div>
                  <div className="text-[13px] font-medium text-on-surface/80">Reading document...</div>
                  <div className="text-[11px] text-on-surface-variant/40 mt-0.5">Extracting items and matching to SKU library</div>
                </div>
              </div>
            )}
            {docExtractError && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2.5 text-[12px] text-red-700 mb-3">
                <span className="material-symbols-outlined text-[14px]">error</span>
                {docExtractError}
              </div>
            )}

            {/* Line items as Cards */}
            <div className="flex flex-col gap-3 mt-4">
              {lineItems.map((li, rowIdx) => {
                const needsReview = !li.sku_id && (li.validation_metrics || li.ai_suggested_name || li.needs_review || li.expandedReview);
                const isRedbox = li.needs_review || li.expandedReview;
                const isSuccess = aiJustMatchedIds.has(li.id);

                return (
                  <div 
                    key={li.id}
                    className={`relative rounded-xl border bg-white overflow-hidden transition-all duration-500 shadow-[0_2px_10px_rgba(0,0,0,0.02)] ${
                      isRedbox 
                        ? 'border-red-200/60 shadow-[0_4px_16px_rgba(239,68,68,0.08)]' 
                        : isSuccess 
                          ? 'border-green-200 shadow-[0_4px_16px_rgba(34,197,94,0.08)]' 
                          : 'border-outline-variant/20 hover:border-outline-variant/40 hover:shadow-[0_4px_16px_rgba(0,0,0,0.04)]'
                    }`}
                  >
                    {/* Collapsed / Main Body */}
                    <div className={`p-4 flex flex-col md:flex-row gap-4 md:items-start transition-colors ${isRedbox ? 'bg-red-50/20' : isSuccess ? 'bg-green-50/30' : ''}`}>
                      
                      {/* Left side: Item Name, Spec, Chips */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[10px] font-bold text-on-surface-variant/40 bg-surface-container/50 px-2 py-0.5 rounded-full tracking-wider">
                            #{li.line_number}
                          </span>
                          {/* Status pill */}
                          {li.sku_id ? (
                            <div className="flex items-center gap-1.5 bg-green-50 border border-green-200 text-green-700 px-2 py-0.5 rounded-full">
                              <span className="material-symbols-outlined text-[12px]">barcode_scanner</span>
                              <span className="font-mono text-[10px] font-bold tracking-wide">{li.sku_id}</span>
                              {isSuccess && <span className="text-[9px] font-bold text-amber-600 ml-1">✦ AI</span>}
                              <button type="button" onClick={() => clearSKU(li.id)} className="material-symbols-outlined text-[14px] text-green-400 hover:text-green-600 ml-1">close</button>
                            </div>
                          ) : (
                            <span className="flex items-center gap-1 bg-surface-container-low border border-outline-variant/20 text-on-surface-variant/60 px-2 py-0.5 rounded-full text-[10px] font-medium">
                              <span className="material-symbols-outlined text-[12px]">search</span>
                              Unlinked
                            </span>
                          )}
                        </div>

                        {/* Name Input WITH DROPDOWN REFS */}
                        <div className="relative group/input mt-2" ref={el => { if (el) itemRefs.current.set(li.id, el); else itemRefs.current.delete(li.id); }}>
                          <input
                            className="w-full text-[14px] font-bold text-on-surface bg-transparent border-0 px-0 py-0 outline-none placeholder:text-on-surface-variant/30 transition-colors focus:ring-0"
                            placeholder="Type item name to search…"
                            value={li.item_name}
                            onChange={e => {
                              updateLine(li.id, { item_name: e.target.value, sku_id: null, ai_suggested_name: undefined, sku_alternatives: undefined });
                              searchSKUs(li.id, e.target.value);
                            }}
                            onBlur={() => {
                              setTimeout(() => updateLine(li.id, { showDropdown: false }), 200);
                              clearTimeout(aiMatchDebounceRef.current[li.id]);
                            }}
                            onFocus={() => {
                              clearTimeout(aiMatchDebounceRef.current[li.id]);
                              if (li.searchResults && li.searchResults.length > 0) updateLine(li.id, { showDropdown: true });
                            }}
                          />
                          <div className="absolute left-0 bottom-[-2px] h-[1px] w-full bg-outline-variant/20 scale-x-0 group-focus-within/input:scale-x-100 group-hover/input:scale-x-100 transition-transform origin-left"></div>
                          
                          {aiMatchingIds.has(li.id) && (
                            <span className="material-symbols-outlined animate-spin absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-amber-600 pointer-events-none">
                              progress_activity
                            </span>
                          )}
                        </div>

                        {/* Inline AI name correction — appears between name input and spec line */}
                        {li.ai_suggested_name && !li.sku_id && !dictAddingIds.has(li.id) && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, padding: '2px 6px', background: '#eff6ff', border: '0.5px solid #bfdbfe', borderRadius: 4 }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 10, color: '#3b82f6', flexShrink: 0 }}>smart_toy</span>
                            <span style={{ fontSize: 10, color: '#6b7280', flexShrink: 0 }}>Did you mean</span>
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#1d4ed8', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{li.ai_suggested_name}</span>
                            <button type="button"
                              onClick={() => {
                                const corrected = li.ai_suggested_name;
                                updateLine(li.id, { item_name: corrected, ai_suggested_name: undefined, sku_id: null });
                                setTimeout(() => autoAddItemToDictionary(li.id), 50);
                              }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 3px', color: '#2563eb', lineHeight: 1, flexShrink: 0 }}
                              title="Accept suggestion">
                              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>check</span>
                            </button>
                            <button type="button"
                              onClick={() => updateLine(li.id, { ai_suggested_name: undefined })}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 2px', color: '#93c5fd', lineHeight: 1, flexShrink: 0 }}
                              title="Keep what I typed">
                              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>close</span>
                            </button>
                          </div>
                        )}

                        {/* Spec line */}
                        <input
                          className="w-full text-[11px] italic text-on-surface-variant/50 bg-transparent border-0 px-0 py-0 mt-1 outline-none placeholder:text-on-surface-variant/20 focus:text-on-surface-variant/80 transition-colors"
                          placeholder="grade / size / spec…"
                          value={li.specification}
                          onChange={e => updateLine(li.id, { specification: e.target.value })}
                        />

                        {/* Smart Matches & AI Suggestion Chips */}
                        {(() => {
                           const dbCandidates = li.sku_alternatives || [];
                           const shouldShowDbChips = !li.sku_id && !dictAddingIds.has(li.id) && !isRedbox && dbCandidates.length > 0;
                           const shouldShowAiChip = !li.sku_id && !dictAddingIds.has(li.id) && !isRedbox;

                           if (!shouldShowDbChips && !shouldShowAiChip) return null;

                           return (
                             <div className="mt-2.5 flex flex-wrap gap-2 items-center">
                               {shouldShowDbChips && dbCandidates.filter(c => c.similarity > 0.60).length > 0 && (
                                 <span className="text-[9px] font-bold text-slate-400 mr-0.5 uppercase tracking-widest flex items-center gap-0.5">
                                   <span className="material-symbols-outlined text-[11px]">database</span> DB Matches:
                                 </span>
                               )}
                               
                               {shouldShowDbChips && dbCandidates.filter(c => c.similarity > 0.60).slice(0, 3).map((chip) => (
                                 <button
                                   key={chip.sku_id}
                                   type="button"
                                   onClick={() => {
                                      updateLine(li.id, { item_name: chip.item_name, sku_id: chip.sku_id, unit: chip.standard_unit || chip.unit, sku_alternatives: undefined, aiSuggestion: undefined, validation_metrics: undefined });
                                   }}
                                   className="px-3 py-1 text-xs font-medium rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 transition-colors shadow-sm"
                                   title={chip.item_name}
                                 >
                                   {chip.item_name}
                                 </button>
                               ))}

                               {shouldShowAiChip && li.isGeneratingAiChip && (
                                  <span className="px-3 py-1 text-xs font-semibold rounded-full bg-indigo-50/50 text-indigo-400 border border-indigo-100 flex items-center gap-1 animate-pulse">
                                    <span className="material-symbols-outlined text-xs animate-spin">progress_activity</span>
                                    AI Thinking...
                                  </span>
                               )}

                               {shouldShowAiChip && li.aiSuggestion && !li.isGeneratingAiChip && (
                                 <button
                                   type="button"
                                   onClick={() => {
                                     if (li.aiSuggestion!.validation_metrics?.passes_shop_floor_test) {
                                       const originalInput = li.item_name;
                                       const finalData = {
                                         sub_category: li.aiSuggestion!.extracted_attributes.sub_category,
                                         dimension: li.aiSuggestion!.extracted_attributes.dimension,
                                         variant: li.aiSuggestion!.extracted_attributes.variant,
                                         grade: li.aiSuggestion!.extracted_attributes.grade,
                                         aliases: li.aiSuggestion!.aliases || [],
                                         originalName: originalInput
                                       };
                                       updateLine(li.id, { 
                                         item_name: li.aiSuggestion!.ai_suggested_name, 
                                         aiSuggestion: undefined, 
                                         needs_review: false,
                                         expandedReview: false
                                       });
                                       setTimeout(() => autoAddItemToDictionary(li.id, true, finalData), 100);
                                     } else {
                                       updateLine(li.id, { expandedReview: true });
                                     }
                                   }}
                                   className="px-3 py-1 text-xs font-semibold rounded-full bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 flex items-center gap-1 shadow-sm transition-all animate-fade-in"
                                 >
                                   <span className="material-symbols-outlined text-xs text-indigo-600">auto_awesome</span>
                                   {(() => {
                                     const attrs = li.aiSuggestion!.extracted_attributes;
                                     const parts: string[] = [];

                                     if (attrs.dimension && attrs.dimension.toLowerCase() !== 'null' && attrs.dimension.trim() !== '') {
                                       parts.push(attrs.dimension.trim());
                                     }
                                     if (attrs.grade && attrs.grade.toLowerCase() !== 'null' && attrs.grade.trim() !== '') {
                                       parts.push(attrs.grade.trim());
                                     }
                                     if (attrs.sub_category && attrs.sub_category.toLowerCase() !== 'null' && attrs.sub_category.trim() !== '') {
                                       parts.push(attrs.sub_category.trim());
                                     }
                                     let baseName = parts.join(' ').toUpperCase();
                                     if (attrs.variant && attrs.variant.toLowerCase() !== 'null' && attrs.variant.trim() !== '') {
                                       baseName += ` (${attrs.variant.trim().toUpperCase()})`;
                                     }
                                     return baseName.replace(/\s+/g, ' ').trim();
                                   })()}
                                 </button>
                               )}
                             </div>
                           );
                        })()}
                        
                        {/* SKU dropdown portal */}
                        {li.showDropdown && li.searchResults && li.searchResults.length > 0 && (() => {
                          const triggerEl = itemRefs.current.get(li.id);
                          if (!triggerEl) return null;
                          const rect = triggerEl.getBoundingClientRect();
                          return createPortal(
                            <div className="bg-white shadow-2xl border border-slate-200 opacity-100 z-40" style={{
                              position: 'fixed', top: rect.bottom + 6, left: rect.left,
                              width: Math.max(rect.width, 280),
                              borderRadius: 10,
                              overflow: 'hidden', maxHeight: 220, overflowY: 'auto',
                            }}>
                              <div style={{ padding: '6px 10px 4px', fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '0.5px solid rgba(0,0,0,0.06)' }}>
                                SKU matches — click to select
                              </div>
                              {li.searchResults.map((sku, si) => (
                                <div key={sku.sku_id} onMouseDown={() => selectSKU(li.id, sku)}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', cursor: 'pointer',
                                    borderBottom: si < li.searchResults.length - 1 ? '0.5px solid rgba(0,0,0,0.05)' : 'none',
                                    background: si === 0 ? 'rgba(22,163,74,0.03)' : 'transparent',
                                  }}
                                  onMouseEnter={e => { e.currentTarget.style.background = '#f3f4f6'; }}
                                  onMouseLeave={e => { e.currentTarget.style.background = si === 0 ? 'rgba(22,163,74,0.03)' : 'transparent'; }}
                                >
                                  {si === 0 && (
                                    <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#16a34a', flexShrink: 0 }}>star</span>
                                  )}
                                  <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ fontSize: 12, fontWeight: si === 0 ? 600 : 400, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sku.item_name}</div>
                                    <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 1, fontFamily: 'monospace' }}>{sku.sku_id} · {sku.unit}</div>
                                  </div>
                                  <span style={{
                                    fontSize: 10, padding: '1px 5px', borderRadius: 20, fontWeight: 600, flexShrink: 0,
                                    background: sku.similarity >= 0.75 ? '#dcfce7' : sku.similarity >= 0.5 ? '#dbeafe' : '#fef9c3',
                                    color: sku.similarity >= 0.75 ? '#16a34a' : sku.similarity >= 0.5 ? '#1d4ed8' : '#a16207',
                                  }}>
                                    {Math.round(sku.similarity * 100)}%
                                  </span>
                                </div>
                              ))}
                            </div>,
                            document.body
                          );
                        })()}
                      </div>

                      {/* Right side: Qty, Unit, Financials */}
                      <div className="flex items-start gap-4 shrink-0 mt-3 md:mt-0">
                        {/* Qty & Unit Group */}
                        <div className="flex flex-col gap-1 w-[110px]">
                          <label className="text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest pl-1">Qty & Unit</label>
                          <div className="flex items-center rounded-lg border border-outline-variant/30 bg-surface focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20 transition-all overflow-hidden shadow-sm h-[32px]">
                            <input
                              type="number" min="1"
                              className="w-[50px] h-full text-[12px] font-semibold text-center border-0 bg-transparent px-1 focus:ring-0"
                              value={li.quantity_ordered}
                              onChange={e => updateLine(li.id, { quantity_ordered: parseFloat(e.target.value) || 0 })}
                            />
                            <div className="w-[1px] h-4 bg-outline-variant/20 mx-0.5"></div>
                            <input
                              className="flex-1 min-w-0 h-full text-[11px] text-center text-on-surface-variant bg-transparent border-0 px-1 focus:ring-0 uppercase tracking-wider placeholder:text-on-surface-variant/30"
                              placeholder="UOM"
                              value={li.unit}
                              onChange={e => updateLine(li.id, { unit: e.target.value.toUpperCase() })}
                            />
                          </div>
                        </div>

                        {/* Rate Group */}
                        <div className="flex flex-col gap-1 w-[90px]">
                          <label className="text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest pl-1">Rate (₹)</label>
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-on-surface-variant/40">₹</span>
                            <input
                              type="number" min="0" step="0.01"
                              className="w-full h-[32px] pl-6 pr-2 rounded-lg border border-outline-variant/30 bg-surface text-[12px] font-semibold focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all shadow-sm"
                              value={li.unit_rate || ''}
                              onChange={e => updateLine(li.id, { unit_rate: parseFloat(e.target.value) || 0 })}
                            />
                          </div>
                          <div className="flex items-center justify-between mt-1 px-1">
                            <div className="flex items-center gap-0.5">
                              <input
                                type="number" min="0" max="100"
                                className="w-[28px] text-[9px] border-b border-outline-variant/30 bg-transparent px-0 py-0 text-center focus:border-primary focus:ring-0 text-on-surface-variant"
                                placeholder="0"
                                value={li.discount_percent || ''}
                                onChange={e => updateLine(li.id, { discount_percent: parseFloat(e.target.value) || 0 })}
                              />
                              <span className="text-[8px] text-on-surface-variant/40 uppercase">Disc</span>
                            </div>
                            <div className="flex items-center gap-0.5">
                              <input
                                type="number" min="0" max="100"
                                className="w-[28px] text-[9px] border-b border-outline-variant/30 bg-transparent px-0 py-0 text-center focus:border-primary focus:ring-0 text-on-surface-variant"
                                placeholder="0"
                                value={li.gst_rate || ''}
                                onChange={e => updateLine(li.id, { gst_rate: parseFloat(e.target.value) || 0 })}
                              />
                              <span className="text-[8px] text-on-surface-variant/40 uppercase">GST</span>
                            </div>
                          </div>
                        </div>

                        {/* Total */}
                        <div className="flex flex-col gap-1 w-[90px] items-end justify-center h-[32px] mt-4 mr-2">
                          {(() => {
                            const rate = li.unit_rate || 0;
                            const qty = li.quantity_ordered || 0;
                            const disc = li.discount_percent || 0;
                            const gst = li.gst_rate || 0;
                            const amtAfterDisc = rate * qty * (1 - disc / 100);
                            const total = amtAfterDisc * (1 + gst / 100);
                            return (
                              <>
                                <span className="text-[14px] font-black text-on-surface tracking-tight">₹{total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                                {disc > 0 && <span className="text-[9px] text-green-600 font-medium tracking-wide">-{disc}%</span>}
                              </>
                            );
                          })()}
                        </div>

                        <button type="button" onClick={() => removeLine(li.id)} className="mt-5 material-symbols-outlined text-[16px] text-on-surface-variant/30 hover:text-red-500 transition-colors p-1" title="Remove Line">
                          delete
                        </button>
                      </div>
                    </div>

                    {/* REDBOX: Expanded UI state for issues */}
                    {isRedbox && (
                      <div className="border-t border-red-100 bg-red-50/10 p-4">
                        {/* Parametric review panel */}
                        {li.expandedReview && li.aiSuggestion ? (
                          <ParametricReviewPanel
                            itemName={li.item_name}
                            payload={li.aiSuggestion as any}
                            onApprove={(finalSkuData) => {
                              handleApproveParametricSku(li.id, finalSkuData, finalSkuData.aliases);
                            }}
                          />
                        ) : li.ai_suggested_name ? (
                          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 bg-violet-50/50 rounded-lg border border-violet-100/50 gap-4">
                            <div className="flex items-start gap-3">
                              <span className="material-symbols-outlined text-violet-500 text-[18px] mt-0.5">auto_awesome</span>
                              <div>
                                <p className="text-[12px] text-violet-900 font-medium">Categorized as: <span className="font-bold text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded ml-1">{li.ai_suggested_name}</span></p>
                                <p className="text-[11px] text-violet-600/70 mt-1">Please review the name and specification before confirming.</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                              <button
                                type="button"
                                onClick={() => {
                                  updateLine(li.id, { item_name: li.ai_suggested_name, ai_suggested_name: undefined, needs_review: false });
                                }}
                                className="w-full sm:w-auto px-4 py-2 bg-violet-600 text-white text-[11px] font-bold rounded-lg hover:bg-violet-700 shadow-sm transition-colors"
                              >
                                Accept & Link
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between p-3 bg-amber-50 rounded-lg border border-amber-200">
                             <div className="flex items-center gap-3">
                               <span className="material-symbols-outlined text-amber-600 text-[18px]">warning</span>
                               <span className="text-[12px] text-amber-800 font-medium">Please review this item manually. No exact match found.</span>
                             </div>
                             <button type="button" onClick={() => updateLine(li.id, { needs_review: false })} className="text-[11px] font-bold text-amber-700 hover:text-amber-900">
                               Dismiss
                             </button>
                          </div>
                        )}
                        
                        {/* Insert as New SKU fallback inside Redbox */}
                        {(!li.sku_alternatives || li.sku_alternatives.length === 0) && (
                          <div className="mt-4 pt-3 border-t border-red-100/50 flex items-center justify-between">
                            <span className="text-[10px] text-red-800/60 font-medium">Still unable to match? Insert directly into the dictionary.</span>
                            <button type="button"
                              onClick={() => {
                                updateLine(li.id, { sku_alternatives: undefined });
                                setTimeout(() => autoAddItemToDictionary(li.id, true), 50);
                              }}
                              disabled={dictAddingIds.has(li.id)}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-800 rounded-lg text-[10px] font-bold transition-colors disabled:opacity-50"
                            >
                              {dictAddingIds.has(li.id) ? (
                                <><span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span> Adding...</>
                              ) : (
                                <><span className="material-symbols-outlined text-[14px]">add_circle</span> Force Add SKU</>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            
            <button
              onClick={addLine}
              className="mt-3 flex items-center gap-1.5 text-[12px] text-primary/70 font-semibold hover:text-primary hover:bg-primary/5 px-3 py-2 rounded-lg transition-colors"
            >
              <span className="material-symbols-outlined text-[15px]">add</span>
              Add Row
            </button>

            {/* ── SKU Dictionary gap-fill banner ─────────────────────────── */}
            {(() => {
              const autoRunning = dictAddingIds.size > 0;
              const unmatched = lineItems.filter(li => !li.sku_id && li.item_name.trim().length >= 2 && !dictAddingIds.has(li.id));
              if (unmatched.length === 0 && !dictAddResult && !autoRunning) return null;
              return (
                <div className="mt-3 rounded-xl border border-amber-200/80 bg-amber-50/60 px-4 py-3 flex items-start gap-3">
                  <span className="material-symbols-outlined text-[18px] text-amber-500 shrink-0 mt-0.5">
                    {autoRunning ? 'progress_activity' : 'auto_fix_high'}
                  </span>
                  <div className="flex-1 min-w-0">
                    {dictAddResult ? (
                      <>
                        <p className="text-[12px] font-semibold text-amber-900">
                          {dictAddResult.added > 0
                            ? `Added ${dictAddResult.added} new SKU${dictAddResult.added > 1 ? 's' : ''} to the dictionary`
                            : 'SKUs already exist — no new entries needed'}
                        </p>
                        {dictAddResult.items.length > 0 && (
                          <p className="text-[11px] text-amber-700/70 mt-0.5 truncate">
                            {dictAddResult.items.join(' · ')}
                          </p>
                        )}
                      </>
                    ) : autoRunning ? (
                      <>
                        <p className="text-[12px] font-semibold text-amber-900">
                          AI is analysing {dictAddingIds.size} item{dictAddingIds.size > 1 ? 's' : ''} and adding to dictionary…
                        </p>
                        <p className="text-[11px] text-amber-700/60 mt-0.5">
                          Each row will auto-link once its SKU is created.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-[12px] font-semibold text-amber-900">
                          {unmatched.length} item{unmatched.length > 1 ? 's' : ''} not matched to any SKU
                        </p>
                        <p className="text-[11px] text-amber-700/60 mt-0.5">
                          Click "Add to Dictionary" — AI will create & link SKU entries for these items.
                        </p>
                      </>
                    )}
                  </div>
                  {!dictAddResult && !autoRunning && (
                    <button
                      onClick={addMissingToDictionary}
                      disabled={addingToDict}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-[11px] font-semibold hover:bg-amber-600 disabled:opacity-60 transition-colors"
                    >
                      {addingToDict
                        ? <><span className="material-symbols-outlined text-[13px] animate-spin">progress_activity</span> Working…</>
                        : <><span className="material-symbols-outlined text-[13px]">add_circle</span> Add to Dictionary</>}
                    </button>
                  )}
                  {dictAddResult && (
                    <button
                      onClick={() => setDictAddResult(null)}
                      className="shrink-0 text-amber-400 hover:text-amber-600 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  )}
                </div>
              );
            })()}

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
                  <p className="text-[10px] text-on-surface-variant/40 italic">Auto-generated</p>
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
          onClick={() => handleSubmit('DRAFT')}
          disabled={saveMutation.isPending}
          className="bk-btn-ghost border border-outline-variant/30 text-[13px] px-4 py-2.5 rounded-xl font-semibold"
        >
          {saveMutation.isPending ? 'Saving…' : 'Save as Draft'}
        </button>
        <button
          onClick={() => handleSubmit('ORDERED')}
          disabled={saveMutation.isPending}
          className="bk-btn text-[13px] px-5 py-2.5 rounded-xl flex items-center gap-2 font-semibold"
        >
          {saveMutation.isPending ? 'Placing…' : 'Place Order'}
          <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
        </button>
      </div>
    </div>
    </>
  );
}
