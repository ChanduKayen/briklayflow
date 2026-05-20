import { useState, useRef, useMemo } from 'react';
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
  // Always-current snapshot of lineItems for use inside async callbacks
  const lineItemsRef      = useRef<DraftLineItem[]>([]);

  // ── Section 01: Identity ──────────────────────────────────────────────────
  const [orderedDate, setOrderedDate]         = useState(new Date().toISOString().split('T')[0]);
  const [expectedDelivery, setExpectedDelivery] = useState('');
  const orderedBy = profile?.name ?? '';

  // ── Section 02: Vendor & Project ─────────────────────────────────────────
  const [projectId, setProjectId]               = useState<string>((location.state as any)?.projectId || '');
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
  const [aiMatchingIds, setAIMatchingIds]   = useState<Set<string>>(new Set());
  const [aiJustMatchedIds, setAIJustMatchedIds] = useState<Set<string>>(new Set());
  const [addingToDict, setAddingToDict]     = useState(false);
  const [dictAddResult, setDictAddResult]   = useState<{ added: number; items: string[] } | null>(null);
  const [dictAddingIds, setDictAddingIds]   = useState<Set<string>>(new Set());
  const [dictAddedIds, setDictAddedIds]     = useState<Set<string>>(new Set());

  // Keep ref in sync so async callbacks always see the latest line items
  lineItemsRef.current = lineItems;

  // ── Section 03: AI Extraction ─────────────────────────────────────────────
  const [extractFile, setExtractFile]   = useState<File | null>(null);
  const [extracting, setExtracting]     = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [pendingItems, setPendingItems]   = useState<ExtractedItem[] | null>(null);
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set());
  const [docExtracting, setDocExtracting] = useState(false);
  const [docExtractError, setDocExtractError] = useState<string | null>(null);

  // ── Section 05: Terms ─────────────────────────────────────────────────────
  const [vendorNotes, setVendorNotes]   = useState('');
  const [internalNotes, setInternalNotes] = useState('');

  // ── Queries ───────────────────────────────────────────────────────────────
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

  // Vendor suggestions
  const vendorSuggestions = useMemo(() => {
    if (!vendorSearch || !vendors) return [];
    const q = vendorSearch.toLowerCase();
    return vendors.filter(v => v.name.toLowerCase().includes(q) || v.category?.toLowerCase().includes(q)).slice(0, 8);
  }, [vendorSearch, vendors]);

  // SKU categories inferred from selected vendor's trade type
  const vendorSKUCategories = useMemo<string[] | null>(() => {
    if (!selectedVendor?.category) return null;
    return VENDOR_TO_SKU_CATEGORIES[selectedVendor.category] ?? null;
  }, [selectedVendor]);

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

  // ── SKU search ────────────────────────────────────────────────────────────

  async function searchSKUs(itemId: string, query: string) {
    clearTimeout(searchDebounceRef.current[itemId]);
    if (!query || query.trim().length < 2) {
      updateLine(itemId, { searchResults: [], showDropdown: false, searching: false });
      return;
    }
    // Show spinner immediately so the UI feels responsive before the fetch fires
    updateLine(itemId, { searching: true });
    searchDebounceRef.current[itemId] = setTimeout(async () => {
      const cats = vendorSKUCategories;
      const rpcParams: Record<string, unknown> = {
        p_search_term: query.trim(),
        p_limit:       8,
        p_threshold:   0.10,
      };
      if (cats && cats.length === 1) {
        rpcParams.p_category = cats[0];
      } else if (cats && cats.length > 1) {
        rpcParams.p_categories = cats;
      }
      const { data, error } = await supabase.rpc('trgm_match_sku', rpcParams as any);
      if (error) {
        console.error('SKU search error:', error);
        updateLine(itemId, { searching: false });
        return;
      }
      // Keep dropdown open if already open; open it only if results arrived
      updateLine(itemId, {
        searchResults: (data ?? []) as SKUResult[],
        showDropdown:  (data ?? []).length > 0,
        searching:     false,
      });
    }, 80);
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

  // Auto-match: runs trgm search and commits the top result when similarity >= 0.65.
  // Below that threshold the dropdown is shown so the user can pick manually.
  async function autoMatchSKU(itemId: string, query: string) {
    if (!query || query.trim().length < 2) return;
    const cats = vendorSKUCategories;
    const rpcParams: Record<string, unknown> = {
      p_search_term: query.trim(),
      p_limit:       8,
      p_threshold:   0.10,
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
      // Confident enough — auto-commit the SKU
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
      // Show "Did you mean?" alternatives for all unmatched items regardless of extraction confidence
      updateLine(itemId, {
        sku_alternatives: results.slice(0, 3),
        searchResults:    [],
        showDropdown:     false,
        searching:        false,
      });
    }
  }

  // ── Feature 1: AI auto-match after the user stops typing / moves away ───────
  // Fires 1.5 s after blur if the item still has no SKU.
  // Pass 1: edge function (trgm → LLM re-rank) for SKU matching.
  // Pass 2: direct GPT call for name standardisation if edge function returned the same name.
  async function runAIAutoMatch(itemId: string) {
    const li = lineItemsRef.current.find(l => l.id === itemId);
    if (!li || li.sku_id || li.item_name.trim().length < 2) return;

    setAIMatchingIds(prev => new Set([...prev, itemId]));
    try {
      const text = li.specification
        ? `Material item for purchase order:\nName: ${li.item_name}\nSpec: ${li.specification}`
        : `Material item for purchase order: ${li.item_name}`;
      const result = await matchSKUsFromText(text, 'ai_auto_match', selectedVendor?.category);
      const match  = result.items?.[0];

      const still = lineItemsRef.current.find(l => l.id === itemId);
      if (!still || still.sku_id) return;

      if (match?.sku_id) {
        // Show as "Did you mean?" so user confirms before committing
        updateLine(itemId, {
          sku_alternatives: [{
            sku_id:     match.sku_id,
            item_name:  match.sku_name ?? match.item_name,
            unit:       match.unit ?? still.unit,
            similarity: (match.confidence ?? 80) / 100,
          }],
          ai_suggested_name: undefined,
          searchResults:     [],
          showDropdown:      false,
        });
        return;
      }

      // Edge function found no SKU — check if it at least corrected the name
      const edgeSuggested = match?.item_name;
      if (edgeSuggested && edgeSuggested.toLowerCase().trim() !== still.item_name.toLowerCase().trim()) {
        updateLine(itemId, { ai_suggested_name: edgeSuggested });
        return;
      }

      // Edge function returned the same name (or nothing). Ask GPT directly for
      // the correct standard Indian trade name — catches typos like "Health Facets".
      const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
      if (!apiKey) return;
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model:       'gpt-4.1-mini',
          max_tokens:  60,
          temperature: 0,
          messages: [{
            role: 'user',
            content: `You are a construction materials naming expert for Indian building projects (AP, Telangana, pan-India).
Vendor type: ${selectedVendor?.category || 'general'}
User typed: "${still.item_name}"

Is this the correct standard Indian trade name for this material?
If not (typo, wrong spelling, wrong word), return the correct standard name.
If already correct, return null.

Reply ONLY with valid JSON: {"correct_name": "corrected name or null"}`,
          }],
        }),
      });
      if (!res.ok) return;
      const json    = await res.json();
      const raw     = json.choices?.[0]?.message?.content?.trim() ?? '';
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      const parsed  = JSON.parse(cleaned);
      const corrected = parsed?.correct_name;

      const latest = lineItemsRef.current.find(l => l.id === itemId);
      if (latest && !latest.sku_id && corrected && corrected.toLowerCase().trim() !== latest.item_name.toLowerCase().trim()) {
        updateLine(itemId, { ai_suggested_name: corrected });
      }
    } catch (err) {
      console.error('AI auto-match failed:', err);
    } finally {
      setAIMatchingIds(prev => { const n = new Set(prev); n.delete(itemId); return n; });
    }
  }

  // Auto-analyses why an item is missing from the SKU dictionary, generates the
  // correct record, inserts it, then re-runs trgm to link the row automatically.
  async function autoAddItemToDictionary(itemId: string) {
    const li = lineItemsRef.current.find(l => l.id === itemId);
    if (!li || li.sku_id || li.item_name.trim().length < 2) return;
    if (dictAddingIds.has(itemId)) return;

    setDictAddingIds(prev => new Set([...prev, itemId]));
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
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
      if (!res.ok) return;

      const json    = await res.json();
      const raw     = json.choices?.[0]?.message?.content?.trim() ?? '';
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      const sku     = JSON.parse(cleaned);
      if (!sku.sku_id || !sku.category || !sku.sub_category) return;

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
      if (error && error.code !== '23505') { console.error('SKU insert error:', error); return; }

      // Re-run trgm to link this row to the newly added (or already existing) SKU
      const cats = vendorSKUCategories;
      const params: Record<string, unknown> = { p_search_term: li.item_name.trim(), p_limit: 1, p_threshold: 0.10 };
      if (cats?.length === 1) params.p_category   = cats[0];
      else if (cats?.length)  params.p_categories = cats;
      const { data: trgmData } = await supabase.rpc('trgm_match_sku', params as any);
      const top = (trgmData as any[])?.[0];

      const still = lineItemsRef.current.find(l => l.id === itemId);
      if (top?.sku_id && still && !still.sku_id) {
        updateLine(itemId, {
          sku_id:            top.sku_id,
          item_name:         top.item_name,
          unit:              top.unit || still.unit,
          confidence:        Math.round(top.similarity * 100),
          needs_review:      true,
          match_source:      'trgm',
          ai_suggested_name: undefined,
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

  // ── Feature 2: Generate and add missing SKUs to the dictionary ───────────
  // For every row that still has no SKU after all matching attempts, asks GPT to:
  //  - understand what the item is in the context of the vendor trade
  //  - produce a proper sku_directory record (category, sub_category, aliases…)
  //  - explain why it was missing
  // Inserts the generated records and then re-runs trgm to link the lines.
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

        // Safety: only insert if we have the required fields
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
          // sku_id collision — skip silently (already in dict)
          if (error.code !== '23505') console.error('SKU insert error:', error);
          continue;
        }

        addedNames.push(sku.sub_category);

        // Re-run trgm so this line picks up the newly added SKU
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

  // ── Totals ────────────────────────────────────────────────────────────────
  const subtotal      = sum(lineItems.map(li => li.basic_amount));
  const totalDiscount = sum(lineItems.map(li => li.discount_amount));
  const totalGST      = sum(lineItems.map(li => li.cgst + li.sgst));
  const grandTotal    = sum(lineItems.map(li => li.total_amount));

  // ── Project selection ─────────────────────────────────────────────────────
  function handleProjectChange(pid: string) {
    setProjectId(pid);
    const proj = projects?.find(p => p.project_id === pid);
    if (proj?.site_location) setDeliveryLocation(proj.site_location);
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (status: string): Promise<string> => {
      if (!vendorId)     throw new Error('Please select a vendor');
      if (!projectId)    throw new Error('Please select a project');
      if (!lineItems.length || !lineItems.some(li => li.item_name.trim())) {
        throw new Error('Please add at least one line item');
      }

      const terms = paymentTermsDays === -1 ? parseInt(customTerms) || 30 : paymentTermsDays;

      // Build legacy items JSON for backward compat
      const legacyItems = lineItems.map(li => ({
        description: li.item_name,
        qty: li.quantity_ordered,
        unit: li.unit,
        rate: li.unit_rate,
        amount: li.total_amount,
      }));

      const poData = {
        // po_id omitted — generated by create_purchase_order() via generate_document_id()
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
      navigate(`/purchase-orders/${generatedPoId}`);
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
    // Auto-match each applied item against the SKU directory
    newLines.forEach(li => {
      if (li.item_name.trim().length >= 2) autoMatchSKU(li.id, li.item_name);
    });
    // After trgm matches settle, auto-add only items that have no SKU and no
    // "Did you mean?" alternatives (those wait for the user to decide manually)
    setTimeout(() => {
      lineItemsRef.current
        .filter(li => !li.sku_id && li.item_name.trim().length >= 2 && !li.sku_alternatives?.length && !li.searchResults?.length)
        .forEach(li => autoAddItemToDictionary(li.id));
    }, 3000);
  }

  // ── SKU document extraction (Feature 2) ──────────────────────────────────

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
      // Auto-add items the pipeline couldn't match to the SKU dictionary
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

  function handleSubmit(status: string) {
    const needsReview = lineItems.filter(li => li.item_name.trim() && li.needs_review);
    if (needsReview.length > 0) {
      showSnackbar(`${needsReview.length} item(s) need SKU review before submitting`, { type: 'error' });
      return;
    }
    const unresolved = lineItems.filter(li => li.item_name.trim() && !li.sku_id);
    if (unresolved.length > 0) {
      if (!window.confirm(`${unresolved.length} item(s) have no SKU selected. Continue?`)) return;
    }
    saveMutation.mutate(status);
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

            {/* Line items table */}
            <div className="overflow-x-auto -mx-2">
              <table className="w-full min-w-[680px] text-[12px] border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="px-2 pb-2 pt-0 text-left text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest w-7 border-b border-outline-variant/15">#</th>
                    <th className="px-2 pb-2 pt-0 text-left text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest border-b border-outline-variant/15">Item &amp; Specification</th>
                    <th className="px-2 pb-2 pt-0 text-left text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest w-[72px] border-b border-outline-variant/15">Unit</th>
                    <th className="px-2 pb-2 pt-0 text-right text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest w-14 border-b border-outline-variant/15">Qty</th>
                    <th className="px-2 pb-2 pt-0 text-right text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest w-24 border-b border-outline-variant/15">Rate ₹</th>
                    <th className="px-2 pb-2 pt-0 text-right text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest w-12 border-b border-outline-variant/15">Disc%</th>
                    <th className="px-2 pb-2 pt-0 text-center text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest w-[52px] border-b border-outline-variant/15">GST</th>
                    <th className="px-2 pb-2 pt-0 text-right text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest w-24 border-b border-outline-variant/15">Total ₹</th>
                    <th className="w-8 border-b border-outline-variant/15"></th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((li, rowIdx) => (
                    <tr
                      key={li.id}
                      className="group"
                      style={{
                        background: aiJustMatchedIds.has(li.id)
                          ? 'rgba(250,240,180,0.35)'
                          : rowIdx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.012)',
                        transition: 'background 1.2s ease',
                      }}
                    >
                      {/* # */}
                      <td className="px-2 py-2.5 text-center align-top border-b border-outline-variant/[0.05]">
                        <span className="text-[10px] font-bold text-on-surface-variant/30 tabular-nums">{li.line_number}</span>
                      </td>

                      {/* Item + Spec + SKU status */}
                      <td className="px-2 py-2 align-top border-b border-outline-variant/[0.05]">
                        {/* name input with dropdown anchor */}
                        <div
                          ref={el => { if (el) itemRefs.current.set(li.id, el); else itemRefs.current.delete(li.id); }}
                          style={{ position: 'relative' }}
                        >
                          <input
                            className="w-full text-[12px] font-medium bg-transparent border-0 border-b border-outline-variant/20 px-0.5 py-0.5 outline-none focus:border-primary/60 transition-colors placeholder:text-on-surface-variant/25"
                            placeholder="Material name…"
                            value={li.item_name}
                            style={{ paddingRight: (li.searching || li.sku_id) ? '20px' : undefined }}
                            onChange={e => {
                              updateLine(li.id, { item_name: e.target.value, sku_id: null, ai_suggested_name: undefined, sku_alternatives: undefined });
                              searchSKUs(li.id, e.target.value);
                            }}
                            onBlur={() => {
                              setTimeout(() => updateLine(li.id, { showDropdown: false }), 200);
                              // Schedule AI auto-match 1.5s after the user leaves the field
                              clearTimeout(aiMatchDebounceRef.current[li.id]);
                              if (!li.sku_id && li.item_name.trim().length >= 2) {
                                aiMatchDebounceRef.current[li.id] = setTimeout(
                                  () => runAIAutoMatch(li.id), 1500
                                );
                              }
                            }}
                            onFocus={() => {
                              clearTimeout(aiMatchDebounceRef.current[li.id]);
                              if (li.searchResults.length > 0) updateLine(li.id, { showDropdown: true });
                            }}
                          />
                          {(li.searching || aiMatchingIds.has(li.id)) && (
                            <span className="material-symbols-outlined animate-spin" aria-hidden="true"
                              style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: aiMatchingIds.has(li.id) ? '#d97706' : '#9ca3af', pointerEvents: 'none' }}>
                              progress_activity
                            </span>
                          )}
                          {li.sku_id && !li.searching && !aiMatchingIds.has(li.id) && (
                            <span className="material-symbols-outlined" aria-hidden="true"
                              style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#16a34a', pointerEvents: 'none' }}>
                              check_circle
                            </span>
                          )}
                        </div>

                        {/* Inline AI name correction — appears between name input and spec line */}
                        {li.ai_suggested_name && !li.sku_id && !dictAddingIds.has(li.id) && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, padding: '2px 6px', background: '#eff6ff', border: '0.5px solid #bfdbfe', borderRadius: 4 }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 10, color: '#3b82f6', flexShrink: 0 }}>smart_toy</span>
                            <span style={{ fontSize: 10, color: '#6b7280', flexShrink: 0 }}>Did you mean</span>
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#1d4ed8', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{li.ai_suggested_name}</span>
                            <button type="button"
                              onClick={() => {
                                const corrected = li.ai_suggested_name!;
                                updateLine(li.id, { item_name: corrected, ai_suggested_name: undefined, sku_id: null });
                                // Let React flush the updated item_name, then create SKU + assign
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
                          className="w-full text-[11px] italic text-on-surface-variant/45 bg-transparent border-0 px-0.5 py-0 mt-0.5 outline-none placeholder:text-on-surface-variant/20 focus:text-on-surface-variant/70 transition-colors"
                          placeholder="grade / size / spec…"
                          value={li.specification}
                          onChange={e => updateLine(li.id, { specification: e.target.value })}
                        />

                        {/* Did you mean? — shown for MEDIUM/LOW extraction confidence items */}
                        {li.sku_alternatives && li.sku_alternatives.length > 0 && !li.sku_id && !dictAddingIds.has(li.id) && (
                          <div style={{ marginTop: 5, padding: '6px 8px', background: '#f0f9ff', border: '0.5px solid #bae6fd', borderRadius: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 11, color: '#0284c7', flexShrink: 0 }}>help</span>
                              <span style={{ fontSize: 10, fontWeight: 700, color: '#0369a1' }}>Did you mean?</span>
                              <span style={{ fontSize: 9, color: '#94a3b8', marginLeft: 'auto' }}>select or create new</span>
                            </div>
                            {li.sku_alternatives.map((alt, ai) => (
                              <div key={alt.sku_id} style={{
                                display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0',
                                borderBottom: ai < li.sku_alternatives!.length - 1 ? '0.5px solid rgba(0,0,0,0.06)' : 'none',
                              }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <span style={{ fontSize: 11, fontWeight: 500, color: '#111827' }}>{alt.item_name}</span>
                                  <span style={{ fontSize: 9, color: '#9ca3af', marginLeft: 4, fontFamily: 'monospace' }}>{alt.sku_id} · {alt.unit}</span>
                                </div>
                                <span style={{
                                  fontSize: 9, padding: '1px 4px', borderRadius: 10, fontWeight: 600, flexShrink: 0,
                                  background: alt.similarity >= 0.65 ? '#dcfce7' : alt.similarity >= 0.4 ? '#fef9c3' : '#fee2e2',
                                  color: alt.similarity >= 0.65 ? '#16a34a' : alt.similarity >= 0.4 ? '#a16207' : '#dc2626',
                                }}>{Math.round(alt.similarity * 100)}%</span>
                                <button type="button"
                                  onClick={() => selectSKU(li.id, alt)}
                                  style={{ background: 'none', border: '0.5px solid #7dd3fc', borderRadius: 4, cursor: 'pointer', padding: '2px 5px', color: '#0284c7', lineHeight: 1, flexShrink: 0 }}
                                  title="Accept this SKU">
                                  <span className="material-symbols-outlined" style={{ fontSize: 12 }}>check</span>
                                </button>
                              </div>
                            ))}
                            <button type="button"
                              onClick={() => {
                                updateLine(li.id, { sku_alternatives: undefined });
                                autoAddItemToDictionary(li.id);
                              }}
                              style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, color: '#7c3aed', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}
                              title="None match — insert this as a new SKU">
                              <span className="material-symbols-outlined" style={{ fontSize: 11 }}>add_circle</span>
                              Insert as new SKU
                            </button>
                          </div>
                        )}

                        {/* SKU dropdown portal */}
                        {li.showDropdown && li.searchResults.length > 0 && (() => {
                          const triggerEl = itemRefs.current.get(li.id);
                          if (!triggerEl) return null;
                          const rect = triggerEl.getBoundingClientRect();
                          return createPortal(
                            <div style={{
                              position: 'fixed', top: rect.bottom + 6, left: rect.left,
                              width: Math.max(rect.width, 280),
                              background: 'white', border: '0.5px solid rgba(0,0,0,0.1)',
                              borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
                              zIndex: 9999, overflow: 'hidden', maxHeight: 220, overflowY: 'auto',
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
                                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#f3f4f6'; }}
                                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = si === 0 ? 'rgba(22,163,74,0.03)' : 'transparent'; }}
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

                        {/* SKU status chips */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
                          {li.extraction_confidence && (
                            <span style={{
                              fontSize: 9, padding: '1px 5px', borderRadius: 4, fontWeight: 700, letterSpacing: '0.03em',
                              background: li.extraction_confidence === 'HIGH' ? '#dcfce7' : li.extraction_confidence === 'MEDIUM' ? '#fef9c3' : '#fee2e2',
                              color: li.extraction_confidence === 'HIGH' ? '#15803d' : li.extraction_confidence === 'MEDIUM' ? '#92400e' : '#b91c1c',
                            }}>
                              {li.extraction_confidence === 'HIGH' ? 'Good' : li.extraction_confidence === 'MEDIUM' ? 'Average' : 'Poor'}
                            </span>
                          )}
                          {li.sku_id ? (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f0fdf4', border: '0.5px solid #bbf7d0', borderRadius: 4, padding: '1px 6px' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 10, color: '#16a34a' }}>barcode_scanner</span>
                              <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#15803d', letterSpacing: '0.02em' }}>{li.sku_id}</span>
                              {aiJustMatchedIds.has(li.id) && (
                                <span style={{ fontSize: 9, fontWeight: 700, color: '#d97706', letterSpacing: '0.02em' }}>✦ AI</span>
                              )}
                              <button type="button" onClick={() => clearSKU(li.id)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#86efac', lineHeight: 1, marginLeft: 1 }}
                                title="Clear SKU match">
                                <span className="material-symbols-outlined" style={{ fontSize: 10 }}>close</span>
                              </button>
                            </div>
                          ) : (li.item_name.trim().length >= 2 && !li.searching && !dictAddingIds.has(li.id)) ? (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: '#fffbeb', border: '0.5px solid #fde68a', borderRadius: 4, padding: '1px 6px' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 10, color: '#d97706' }}>search_off</span>
                              <span style={{ fontSize: 10, color: '#92400e' }}>No SKU matched</span>
                            </div>
                          ) : null}
                          {/* Auto-adding to dictionary */}
                          {dictAddingIds.has(li.id) && (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fef3c7', border: '0.5px solid #fde68a', borderRadius: 4, padding: '1px 6px' }}>
                              <span className="material-symbols-outlined animate-spin" style={{ fontSize: 10, color: '#d97706' }}>progress_activity</span>
                              <span style={{ fontSize: 10, color: '#92400e' }}>Creating SKU…</span>
                            </div>
                          )}
                          {/* Just added to dictionary */}
                          {dictAddedIds.has(li.id) && (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f0fdf4', border: '0.5px solid #bbf7d0', borderRadius: 4, padding: '1px 6px' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 10, color: '#16a34a' }}>new_label</span>
                              <span style={{ fontSize: 10, color: '#15803d' }}>New SKU created & linked</span>
                            </div>
                          )}
                          {li.confidence !== undefined && (
                            <span style={{
                              fontSize: 9, padding: '1px 5px', borderRadius: 20, fontWeight: 600,
                              background: li.confidence >= 70 ? '#dcfce7' : li.confidence >= 50 ? '#fef9c3' : '#fee2e2',
                              color: li.confidence >= 70 ? '#16a34a' : li.confidence >= 50 ? '#a16207' : '#dc2626',
                            }}>{li.confidence}%</span>
                          )}
                          {li.needs_review && (
                            <span style={{ fontSize: 9, color: '#d97706', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 10 }}>warning</span>
                              Review
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Unit */}
                      <td className="px-2 py-2 align-top border-b border-outline-variant/[0.05]">
                        <select
                          className="w-full text-[11px] bg-surface-container-low/40 border border-outline-variant/20 rounded-lg px-1.5 py-1.5 outline-none focus:border-primary/40 focus:bg-white transition-colors"
                          value={li.unit}
                          onChange={e => updateLine(li.id, { unit: e.target.value })}
                        >
                          {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </td>

                      {/* Qty */}
                      <td className="px-2 py-2 align-top border-b border-outline-variant/[0.05]">
                        <input
                          type="number"
                          className="w-full text-[12px] text-right bg-surface-container-low/40 border border-outline-variant/20 rounded-lg px-2 py-1.5 outline-none focus:border-primary/40 focus:bg-white transition-colors font-data-mono"
                          value={li.quantity_ordered}
                          min={0} step="any"
                          onChange={e => updateLine(li.id, { quantity_ordered: parseFloat(e.target.value) || 0 })}
                        />
                      </td>

                      {/* Rate */}
                      <td className="px-2 py-2 align-top border-b border-outline-variant/[0.05]">
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-on-surface-variant/35">₹</span>
                          <input
                            type="number"
                            className="w-full text-[12px] text-right bg-surface-container-low/40 border border-outline-variant/20 rounded-lg pl-4 pr-1.5 py-1.5 outline-none focus:border-primary/40 focus:bg-white transition-colors font-data-mono"
                            value={li.unit_rate}
                            min={0} step="any"
                            onChange={e => updateLine(li.id, { unit_rate: parseFloat(e.target.value) || 0 })}
                          />
                        </div>
                      </td>

                      {/* Disc% */}
                      <td className="px-2 py-2 align-top border-b border-outline-variant/[0.05]">
                        <input
                          type="number"
                          className="w-full text-[12px] text-right bg-surface-container-low/40 border border-outline-variant/20 rounded-lg px-1.5 py-1.5 outline-none focus:border-primary/40 focus:bg-white transition-colors font-data-mono"
                          value={li.discount_percent}
                          min={0} max={100} step="any"
                          onChange={e => updateLine(li.id, { discount_percent: parseFloat(e.target.value) || 0 })}
                        />
                      </td>

                      {/* GST% */}
                      <td className="px-2 py-2 align-top border-b border-outline-variant/[0.05]">
                        <select
                          className="w-full text-[11px] text-center bg-surface-container-low/40 border border-outline-variant/20 rounded-lg px-0.5 py-1.5 outline-none focus:border-primary/40 focus:bg-white transition-colors"
                          value={li.gst_rate}
                          onChange={e => updateLine(li.id, { gst_rate: parseFloat(e.target.value) })}
                        >
                          {GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                        </select>
                      </td>

                      {/* Total */}
                      <td className="px-2 py-2 align-top border-b border-outline-variant/[0.05] text-right">
                        <span className="font-data-mono text-[12px] font-semibold text-on-surface tabular-nums">
                          ₹{li.total_amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </span>
                        {li.discount_amount > 0 && (
                          <div className="text-[9px] text-on-surface-variant/40 tabular-nums font-data-mono mt-0.5">
                            −₹{li.discount_amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })} disc
                          </div>
                        )}
                      </td>

                      {/* Delete */}
                      <td className="px-1 py-2 align-top border-b border-outline-variant/[0.05]">
                        <button
                          onClick={() => removeLine(li.id)}
                          className="p-1 rounded-lg text-on-surface-variant/20 hover:text-red-400 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                          title="Remove row"
                        >
                          <span className="material-symbols-outlined text-[15px]">close</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
  );
}
