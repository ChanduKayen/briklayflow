import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Breadcrumb from '../components/Breadcrumb';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import type { Stakeholder } from '../types';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import { useOrgId } from '../lib/auth/AuthProvider';
import { multiply, parseAmount } from '../lib/money';
import { WORKER_TRADE_GROUPS, OTHER_TRADE } from '../lib/trades';
import { useSnackbar } from '../components/Snackbar';
// ui/work-order-redesign — consolidated onto the shared po-new-ui voice tokens (ruling 7);
// VOICE/VNUMS are aliases so the prior reskin's VOICE.x usages keep working unchanged.
import { V as VOICE, nums as VNUMS } from '../components/po-new-ui/voiceTokens';
import { SEG } from '../components/wo-new-ui/woTokens';
import UiAllocationBar from '../components/wo-new-ui/UiAllocationBar';
import UiContractorCombobox from '../components/wo-new-ui/UiContractorCombobox';
import UiWoCeremony from '../components/wo-new-ui/UiWoCeremony';
import { UiTotalExclGst } from '../components/po-new-ui/UiMoney';
import UiSaveHint from '../components/po-new-ui/UiSaveHint';

// ─── Work Stage types ──────────────────────────────────────────────────────

interface StageDraft {
  id: string;
  name: string;
  unit_type: string;
  quantity: number | null;
  rate: number | null;
  amount: number | null;   // directly-entered lumpsum; null means computed from qty×rate
  ambiguous?: boolean;     // amber border flag for AI-extracted stages needing review
}

interface ExtractedStage {
  _id: string;
  name: string;
  mode: 'measured' | 'lumpsum' | 'ambiguous';
  unit_type: string | null;
  qty: number | null;
  rate: number | null;
  amount: number;
  amount_verified: boolean;
  arithmetic_mismatch: boolean;
  mismatch_note: string | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  confidence_reason: string;
}

type StageMode = 'empty' | 'measured' | 'lumpsum';

function getMode(s: StageDraft): StageMode {
  if (!s.name && !(s.amount ?? 0) && !(s.quantity ?? 0) && !(s.rate ?? 0)) return 'empty';
  if (s.unit_type === 'LS') return 'lumpsum';
  if ((s.quantity ?? 0) > 0 && (s.rate ?? 0) > 0) return 'measured';
  if ((s.amount ?? 0) > 0) return 'lumpsum';
  return 'empty';
}

// ─── Unit system ──────────────────────────────────────────────────────────

const UNIT_GROUPS = [
  { group: 'LUMP SUM', items: [
    { value: 'LS',    label: 'LS — Lump Sum' },
  ]},
  { group: 'AREA', items: [
    { value: 'Sqft',  label: 'Sqft — Square Feet' },
    { value: 'Sqm',   label: 'Sqm — Square Metres' },
    { value: 'Sqyd',  label: 'Sqyd — Square Yards' },
  ]},
  { group: 'VOLUME', items: [
    { value: 'Cum',   label: 'Cum — Cubic Metres' },
    { value: 'Cft',   label: 'Cft — Cubic Feet' },
    { value: 'Cu.yd', label: 'Cu.yd — Cubic Yards' },
  ]},
  { group: 'LENGTH', items: [
    { value: 'Rmt',   label: 'Rmt — Running Metres' },
    { value: 'Rft',   label: 'Rft — Running Feet' },
  ]},
  { group: 'COUNT', items: [
    { value: 'Nos',         label: 'Nos — Numbers' },
    { value: 'Per Point',   label: 'Per Point — Electrical' },
    { value: 'Per Fixture', label: 'Per Fixture — Plumbing' },
    { value: 'Per Set',     label: 'Per Set' },
    { value: 'Per Column',  label: 'Per Column' },
    { value: 'Per Beam',    label: 'Per Beam' },
    { value: 'Per Footing', label: 'Per Footing' },
  ]},
  { group: 'RESIDENTIAL', items: [
    { value: 'Per Flat',  label: 'Per Flat' },
    { value: 'Per Floor', label: 'Per Floor' },
    { value: 'Per Room',  label: 'Per Room' },
    { value: 'Per Bay',   label: 'Per Bay' },
  ]},
  { group: 'WEIGHT', items: [
    { value: 'Kg',      label: 'Kg — Kilograms' },
    { value: 'MT',      label: 'MT — Metric Tonnes' },
    { value: 'Quintal', label: 'Quintal — 100 Kg' },
  ]},
];

const UNIT_SUGGESTIONS: Array<{ pattern: RegExp; unit: string }> = [
  { pattern: /plastering|brickwork|masonry|tiling|flooring|painting|false.?ceiling|waterproofing/, unit: 'Sqft' },
  { pattern: /concrete|slab|excavation/,   unit: 'Cum' },
  { pattern: /steel|reinforcement/,         unit: 'Kg' },
  { pattern: /plumbing/,                    unit: 'Per Fixture' },
  { pattern: /electrical/,                  unit: 'Per Point' },
  { pattern: /door|window/,                 unit: 'Nos' },
];

function suggestUnit(name: string): string {
  const n = name.toLowerCase();
  for (const { pattern, unit } of UNIT_SUGGESTIONS) {
    if (pattern.test(n)) return unit;
  }
  return '';
}

function calcAmount(s: StageDraft): number {
  const mode = getMode(s);
  if (mode === 'measured') return multiply(s.quantity ?? 0, s.rate ?? 0);
  if (mode === 'lumpsum')  return s.amount ?? 0;
  return 0;
}

const fmtRupee = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

// ui/work-order-redesign (B4) — split `budget` across weighted stages by their
// percentages, each rounded to ₹500, the remainder absorbed into the LAST stage
// so the sum equals `budget` exactly (→ accept-all reconciles to the contract).
function uiAllocateWeighted(pcts: number[], budget: number): number[] {
  if (budget <= 0 || pcts.length === 0) return pcts.map(() => 0);
  const out = pcts.map(p => Math.round(((p / 100) * budget) / 500) * 500);
  out[out.length - 1] += budget - out.reduce((a, b) => a + b, 0);
  return out;
}

// ─── Component ────────────────────────────────────────────────────────────

export default function NewWorkOrder({ session }: { session: Session }) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { data: profile } = useUserProfile(session.user.id);
  const orgId = useOrgId();

  const initState = (location.state as any) || {};

  const [projectId, setProjectId] = useState<string>(initState.projectId || '');
  const [stakeholderId, setStakeholderId] = useState<string>(initState.stakeholderId || '');
  const [scope, setScope] = useState('');
  const [orderValue, setOrderValue] = useState<number>(0);
  // Date issued defaults to today, but stays editable.
  const [dateIssued, setDateIssued] = useState(new Date().toISOString().split('T')[0]);
  // Inline "add new worker" quick-create state.
  const [showAddWorker, setShowAddWorker] = useState(false);
  const [newWorkerName, setNewWorkerName] = useState('');
  const [newWorkerTrade, setNewWorkerTrade] = useState('');
  const [newWorkerTradeOther, setNewWorkerTradeOther] = useState('');
  const [newWorkerContact, setNewWorkerContact] = useState('');
  const { show: showSnackbar } = useSnackbar();
  const [stages, setStages] = useState<StageDraft[]>([]);
  const [newStageId, setNewStageId] = useState<string | null>(null);
  const [pendingStages, setPendingStages] = useState<ExtractedStage[]>([]);
  const [source, setSource] = useState<'manual' | 'uploaded_doc'>('manual');
  const [isAiExtracted, setIsAiExtracted] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [showOneTimeDialog, setShowOneTimeDialog] = useState(false);

  // Auto-focus newly added stage name input
  useEffect(() => {
    if (!newStageId) return;
    const el = document.querySelector(`[data-stage-id="${newStageId}"]`) as HTMLInputElement | null;
    el?.focus();
    setNewStageId(null);
  }, [newStageId]);

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('project_id, name, project_code').eq('status', 'Active').order('name');
      if (error) throw error;
      return data as Array<{ project_id: string; name: string; project_code: string | null }>;
    },
  });

  const { data: workers } = useQuery({
    queryKey: ['workers'],
    queryFn: async () => {
      // category = the worker's trade; needed by "Draft stages from scope" (B4) to pick a template.
      const { data, error } = await supabase.from('stakeholders').select('stakeholder_id, name, category').eq('type', 'Worker').order('name');
      if (error) throw error;
      return data as Pick<Stakeholder, 'stakeholder_id' | 'name' | 'category'>[];
    },
  });

  const selectedProject = projects?.find(p => p.project_id === projectId);
  const selectedWorker  = workers?.find(w => w.stakeholder_id === stakeholderId);
  const stagesTotal = stages.reduce((sum, s) => sum + calcAmount(s), 0);
  const isOver  = orderValue > 0 && stagesTotal > orderValue + 0.01;
  // ui/work-order-redesign — cosmetic, dead-ended (brief §1); read only by redesign JSX,
  // never by any handler/mutation/payload.
  const [uiCeremonyOpen, setUiCeremonyOpen] = useState(false);
  const [uiActiveSeg, setUiActiveSeg] = useState<number | null>(null);
  // B4 "Draft stages from scope" — separate from document extraction (both can be in flight).
  const [uiDrafting, setUiDrafting] = useState(false);
  const [uiDraftError, setUiDraftError] = useState<string | null>(null);
  // Pure render-time derivations for the living sentence / allocation bar / recap.
  const uiNamedStages = stages.filter(s => s.name.trim());
  const uiSegments = uiNamedStages.map(s => calcAmount(s));
  const uiAllocated = uiSegments.reduce((sum, a) => sum + a, 0);

  // ─── Save mutation ───────────────────────────────────────────────────────

  const createWO = useMutation({
    mutationFn: async (): Promise<string> => {
      if (!projectId || !stakeholderId || !scope || !dateIssued)
        throw new Error('Please fill in all required fields.');
      const milestones = stages.length > 0
        ? stages.map((s, idx) => {
            const mode = getMode(s);
            return {
              seq_no: idx + 1, name: s.name,
              unit_type: s.unit_type || null,
              quantity: mode === 'measured' ? s.quantity : (mode === 'lumpsum' ? 1 : null),
              rate: mode === 'measured' ? s.rate : null,
              planned_amount: calcAmount(s),
              ai_extracted: isAiExtracted,
            };
          })
        : [{
            seq_no: 1, name: 'Full Payment',
            unit_type: 'LS', quantity: 1, rate: null,
            planned_amount: orderValue,
            ai_extracted: false,
          }];
      const { data, error } = await supabase.rpc('create_work_order', {
        p_org_id:         orgId,
        p_project_id:     projectId,
        p_stakeholder_id: stakeholderId,
        p_scope:          scope,
        p_order_value:    orderValue,
        p_date_issued:    dateIssued,
        p_source:         source,
        p_milestones:     milestones,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error ?? 'Failed to create contract');
      return data.wo_id as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work_orders'] });
      // ui/work-order-redesign (B5): keep invalidation immediate; the ceremony now gates
      // the redirect. The id is read from createWO.data (=== the mutationFn's returned
      // wo_id) in UiWoCeremony.onLeave, which fires the identical navigate. Error path
      // untouched (still surfaces via createWO.isError).
      setUiCeremonyOpen(true);
    },
  });

  // ─── Add-new-worker mutation ──────────────────────────────────────────────

  const createWorker = useMutation({
    mutationFn: async () => {
      const name = newWorkerName.trim();
      if (!name) throw new Error('Worker name is required');
      const category = newWorkerTrade === OTHER_TRADE
        ? (newWorkerTradeOther.trim() || 'Other')
        : newWorkerTrade;
      if (!category) throw new Error('Trade is required');
      const ns = {
        stakeholder_id: `STK-${Math.floor(1000 + Math.random() * 9000)}`,
        name,
        type: 'Worker',
        category,
        contact: newWorkerContact.trim() || null,
        org_id: orgId,
      };
      const { data, error } = await supabase.from('stakeholders').insert([ns]).select().single();
      if (error) throw error;
      return data as Stakeholder;
    },
    onSuccess: (w) => {
      queryClient.invalidateQueries({ queryKey: ['workers'] });
      setStakeholderId(w.stakeholder_id);
      setShowAddWorker(false);
      setNewWorkerName(''); setNewWorkerTrade(''); setNewWorkerTradeOther(''); setNewWorkerContact('');
      showSnackbar(`Worker "${w.name}" added`);
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to add worker', { type: 'error' }),
  });

  // ─── Stage helpers ────────────────────────────────────────────────────────

  const addStage = () => {
    const id = Math.random().toString();
    setStages(prev => [...prev, { id, name: '', unit_type: '', quantity: null, rate: null, amount: null }]);
    setNewStageId(id);
  };

  const updateStage = (id: string, field: keyof StageDraft, value: string | number | null) =>
    setStages(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));

  const removeStage = (id: string) =>
    setStages(prev => prev.filter(s => s.id !== id));

  const handleNameBlur = (s: StageDraft) => {
    if (!s.unit_type && s.name.trim()) {
      const suggested = suggestUnit(s.name);
      if (suggested) updateStage(s.id, 'unit_type', suggested);
    }
  };

  // ─── Stage add helpers ────────────────────────────────────────────────────

  const addPendingStage = (es: ExtractedStage, amountOverride?: number) => {
    const resolvedAmount = amountOverride ?? es.amount;
    const newStage: StageDraft = {
      id: Math.random().toString(),
      name: es.name,
      unit_type: es.unit_type ?? '',
      quantity: es.mode === 'measured' ? es.qty : null,
      rate: es.mode === 'measured' ? es.rate : null,
      amount: es.mode === 'measured' ? null : resolvedAmount,
      ambiguous: es.mode === 'ambiguous',
    };
    setStages(prev => [...prev, newStage]);
    setPendingStages(prev => prev.filter(p => p._id !== es._id));
  };

  const addAllPendingStages = () => {
    const newStages = pendingStages
      .filter(es => !es.arithmetic_mismatch)
      .map(es => ({
        id: Math.random().toString(),
        name: es.name,
        unit_type: es.unit_type ?? '',
        quantity: es.mode === 'measured' ? es.qty : null,
        rate: es.mode === 'measured' ? es.rate : null,
        amount: es.mode === 'measured' ? null : es.amount,
        ambiguous: es.mode === 'ambiguous',
      }));
    setStages(prev => [...prev, ...newStages]);
    setPendingStages(prev => prev.filter(p => p.arithmetic_mismatch));
  };

  // ─── AI file upload ────────────────────────────────────────────────────────

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';   // let the same file be re-picked after a failure
    setIsExtracting(true);
    setAiError(null);
    // NOTE: the reader is promise-wrapped so a failure INSIDE the async work is caught here.
    // Previously the network call lived in reader.onload (async), which the surrounding try
    // never covered — so any server error left the button spinning "Extracting…" forever with
    // no message. (PDFs failed exactly this way: gpt-4o vision can't read a PDF as an image.)
    try {
      const base64String = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read that file — try again.'));
        reader.onload = () => {
          const res = (reader.result as string) || '';
          const b64 = res.includes(',') ? res.split(',')[1] : '';
          b64 ? resolve(b64) : reject(new Error('Could not read that file — try again.'));
        };
        reader.readAsDataURL(file);
      });

      // Server-side BOQ extraction — no OpenAI key in the browser. Handles photos AND PDFs.
      const { data: extracted, error: efError } = await supabase.functions.invoke('sku-matcher', {
        body: {
          action:       'extractWorkOrderBoQ',
          image_base64: base64String,
          image_mime:   file.type,
        },
      });
      if (efError) {
        // supabase.functions.invoke gives a generic "non-2xx" message; the real reason is in
        // the JSON body. Surface it so a failed extraction says WHY instead of nothing.
        let msg = efError.message;
        try {
          const ctx = (efError as any).context;
          const parsed = ctx && typeof ctx.json === 'function' ? await ctx.json() : null;
          if (parsed?.error) msg = parsed.error;
        } catch { /* keep the generic message */ }
        throw new Error(msg || 'Could not read the document. Try a clearer photo or a PDF.');
      }
      if ((extracted as any)?.error) throw new Error((extracted as any).error);
      const data = extracted as any;

      // Set header fields
      if (data.scope_of_work) setScope(data.scope_of_work);
      if (data.order_value)   setOrderValue(data.order_value);
      if (data.date_issued && !isNaN(Date.parse(data.date_issued))) setDateIssued(data.date_issued);
      if (data.worker_name_fuzzy && workers) {
        const match = workers.find(w => w.name.toLowerCase().includes((data.worker_name_fuzzy as string).toLowerCase()));
        if (match) setStakeholderId(match.stakeholder_id);
      }

      // Queue stages for review instead of adding directly
      if (Array.isArray(data.stages) && data.stages.length > 0) {
        setPendingStages(data.stages.map((s: any) => ({
          _id: Math.random().toString(),
          name: s.name ?? '',
          mode: s.mode ?? 'ambiguous',
          unit_type: s.unit_type ?? null,
          qty: s.qty ?? null,
          rate: s.rate ?? null,
          amount: Number(s.amount) || 0,
          amount_verified: Boolean(s.amount_verified),
          arithmetic_mismatch: Boolean(s.arithmetic_mismatch),
          mismatch_note: s.mismatch_note ?? null,
          confidence: s.confidence ?? 'LOW',
          confidence_reason: s.confidence_reason ?? '',
        })));
      }

      setSource('uploaded_doc');
      setIsAiExtracted(true);
    } catch (err: any) {
      setAiError(err.message || 'Failed to extract data.');
    } finally {
      setIsExtracting(false);
    }
  };

  // ─── B4: Draft stages from scope ──────────────────────────────────────────
  // Additive. Calls the NEW wo-stage-drafter edge function and feeds the EXISTING
  // pendingStages → AI Review Panel → addPendingStage pipeline. Touches nothing
  // existing (createWO, calcAmount, stage keys, save conditions all unchanged).
  async function handleDraftStages() {
    if (!scope.trim()) { setUiDraftError('Write the scope first.'); return; }
    setUiDrafting(true);
    setUiDraftError(null);
    try {
      const existing_stage_names = stages.filter(s => s.name.trim()).map(s => s.name.trim());
      const { data, error } = await supabase.functions.invoke('wo-stage-drafter', {
        body: {
          scope_text: scope,
          trade: selectedWorker?.category ?? null,
          contract_value: orderValue > 0 ? orderValue : null,
          existing_stage_names,
        },
      });
      if (error) throw error;
      const drafted = (data as any)?.stages as any[] | undefined;
      if (!Array.isArray(drafted) || drafted.length === 0) {
        setUiDraftError('No stages suggested — add more detail to the scope.');
        return;
      }
      // Weighted budget = contract minus explicit measured totals, so accept-all
      // reconciles to the contract exactly. Empty contract → amounts 0, pct shown.
      const measuredTotal = drafted
        .filter(s => s.mode === 'measured')
        .reduce((sum, s) => sum + (Number(s.quantity) || 0) * (Number(s.rate) || 0), 0);
      const priced = orderValue > 0;
      const budget = priced ? Math.max(0, orderValue - measuredTotal) : 0;
      const weightedPcts = drafted.filter(s => s.mode === 'weighted').map(s => Number(s.weight_pct) || 0);
      const weightedAmts = uiAllocateWeighted(weightedPcts, budget);

      let wi = 0;
      const pending: ExtractedStage[] = drafted.map((s): ExtractedStage => {
        if (s.mode === 'measured') {
          const qty = Number(s.quantity) || 0;
          const rate = Number(s.rate) || 0;
          return {
            _id: Math.random().toString(),
            name: String(s.name || ''),
            mode: 'measured',
            unit_type: s.unit_type ?? null,
            qty, rate,
            amount: qty * rate,
            amount_verified: true,
            arithmetic_mismatch: false,
            mismatch_note: null,
            confidence: 'HIGH',
            confidence_reason: '',
          };
        }
        const pct = Number(s.weight_pct) || 0;
        const amount = weightedAmts[wi++] || 0;
        return {
          _id: Math.random().toString(),
          name: String(s.name || ''),
          mode: 'lumpsum',
          unit_type: 'LS',
          qty: null, rate: null,
          amount,
          amount_verified: priced,
          arithmetic_mismatch: false,
          mismatch_note: null,
          confidence: priced ? 'HIGH' : 'MEDIUM',
          confidence_reason: priced ? '' : `${pct}% of contract — enter the contract value to price`,
        };
      });
      setPendingStages(pending);
    } catch (err: any) {
      setUiDraftError(err?.message || 'Could not draft stages. Try again.');
    } finally {
      setUiDrafting(false);
    }
  }

  // ─── Access guard ─────────────────────────────────────────────────────────

  if (profile && profile.role !== 'management' && profile.role !== 'principal') {
    return (
      <div className="px-margin-mobile md:px-margin-desktop pt-6">
        <div className="bg-error-container text-on-error-container p-6 rounded-xl">
          <h3 className="text-headline-md font-headline-md">Access Denied</h3>
          <p className="text-body-sm mt-2">Only Management and Principal can create Contracts.</p>
        </div>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
    <div className="min-h-screen" style={{ background: VOICE.page }}>
      <div className="mx-auto px-5 sm:px-6 pt-6 pb-40" style={{ maxWidth: 700 }}>

      <Breadcrumb items={
        initState.returnTo
          ? [
              { label: 'Dashboard', href: '/' },
              { label: initState.returnLabel || 'Back', href: initState.returnTo },
              { label: 'New' },
            ]
          : initState.from === 'project' && initState.projectName
          ? [
              { label: 'Dashboard', href: '/' },
              { label: 'Projects', href: '/projects' },
              { label: initState.projectName, href: `/projects/${initState.projectId}` },
              { label: 'Contracts', href: `/projects/${initState.projectId}/work-orders` },
              { label: 'New' },
            ]
          : [
              { label: 'Dashboard', href: '/' },
              { label: 'Contracts', href: '/work-orders' },
              { label: 'New' },
            ]
      } />

      {/* Header — compact (back handler unchanged) */}
      <header className="flex items-center gap-3 mb-2 mt-1">
        <button
          type="button"
          onClick={() => navigate(initState.returnTo || (initState.from === 'project' && initState.projectId ? `/projects/${initState.projectId}/work-orders` : '/work-orders'))}
          aria-label="Back to contracts"
          style={{ color: VOICE.user }}
        >
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <p className="text-sm flex-1" style={{ color: VOICE.system }}>New contract</p>
        <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: VOICE.field, color: VOICE.system, ...VNUMS }}>WO · auto</span>
      </header>

      {aiError && (
        <div className="mb-4 p-4 bg-error-container text-on-error-container rounded-xl text-body-sm flex items-center gap-2">
          <span className="material-symbols-outlined shrink-0">error</span> {aiError}
        </div>
      )}
      {isAiExtracted && (
        <div className="mb-4 p-4 bg-secondary-container text-on-secondary-container rounded-xl text-body-sm flex items-center gap-2">
          <span className="material-symbols-outlined shrink-0">auto_awesome</span>
          Data extracted from document — please review all fields before saving.
        </div>
      )}

      {/* Title — a plain heading; this is a contract */}
      <div className="mt-6 mb-1">
        <h1 className="text-[26px] font-semibold tracking-tight" style={{ color: VOICE.user }}>New Contract</h1>
      </div>

      {/* Entry mode — "extract from a document" (existing handleFileUpload, relocated) */}
      <div className="flex gap-2 items-center mt-4 flex-wrap">
        <p className="text-xs" style={{ color: VOICE.systemFaint }}>Fill it in below, or</p>
        <label className="text-xs font-medium inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full cursor-pointer" style={{ border: `1px solid ${VOICE.line}`, color: VOICE.user }}>
          {isExtracting ? <Loader2 className="animate-spin" size={12} /> : <span className="material-symbols-outlined text-[14px]">upload_file</span>}
          {isExtracting ? 'Extracting…' : 'extract from a document'}
          <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileUpload} disabled={isExtracting} />
        </label>
      </div>

      <hr className="border-0 mt-8 mb-2" style={{ height: 1, background: VOICE.line }} />

      <form
        id="wo-new-form"
        onSubmit={e => { e.preventDefault(); if (stages.length === 0) { setShowOneTimeDialog(true); } else { createWO.mutate(); } }}
        className="mt-2"
      >

          {/* 01 — Who's doing the work? */}
          <section>
            <Question n="01" hint="Search by name — if they're not in the list yet, add them right from the result.">Who's doing the work?</Question>
            <UiContractorCombobox
              workers={workers ?? []}
              selectedId={stakeholderId}
              selectedName={selectedWorker?.name ?? ''}
              onSelect={(id) => setStakeholderId(id)}
              onClear={() => setStakeholderId('')}
              onAddNew={(name) => { setNewWorkerName(name); setShowAddWorker(true); }}
            />

            {/* Existing inline add-worker form (createWorker) — opened by the combobox's "add as new" */}
            {showAddWorker && (
              <div className="mt-3 rounded-xl p-4 space-y-3" style={{ background: VOICE.askWash, border: `1px solid ${VOICE.askLine}`, maxWidth: 420 }}>
                <p className="text-xs font-semibold" style={{ color: VOICE.askDeep }}>New worker</p>
                <input value={newWorkerName} onChange={e => setNewWorkerName(e.target.value)} className="bk-input" placeholder="Worker name" autoFocus />
                <select value={newWorkerTrade} onChange={e => { setNewWorkerTrade(e.target.value); setNewWorkerTradeOther(''); }} className="bk-input">
                  <option value="" disabled>Select trade…</option>
                  {WORKER_TRADE_GROUPS.map(g => (
                    <optgroup key={g.group} label={g.group}>
                      {g.trades.map(t => <option key={t} value={t}>{t}</option>)}
                    </optgroup>
                  ))}
                </select>
                {newWorkerTrade === OTHER_TRADE && (
                  <input value={newWorkerTradeOther} onChange={e => setNewWorkerTradeOther(e.target.value)} className="bk-input" placeholder="Specify trade…" />
                )}
                <input value={newWorkerContact} onChange={e => setNewWorkerContact(e.target.value)} className="bk-input" placeholder="Contact (optional)" />
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => { setShowAddWorker(false); setNewWorkerName(''); setNewWorkerTrade(''); setNewWorkerTradeOther(''); setNewWorkerContact(''); }} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ border: `1px solid ${VOICE.line}`, color: VOICE.system }}>Cancel</button>
                  <button type="button" onClick={() => createWorker.mutate()} disabled={!newWorkerName.trim() || !newWorkerTrade || (newWorkerTrade === OTHER_TRADE && !newWorkerTradeOther.trim()) || createWorker.isPending} className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white inline-flex items-center gap-1.5 disabled:opacity-50" style={{ background: VOICE.askDeep }}>{createWorker.isPending ? 'Saving…' : 'Save & select'}</button>
                </div>
              </div>
            )}

            {/* Project + date (functional, restyled) */}
            <div className="flex gap-3 flex-wrap mt-4">
              <select value={projectId} onChange={e => setProjectId(e.target.value)} required className="flex-1 min-w-44 px-3.5 py-2.5 rounded-xl text-sm" style={{ background: VOICE.surface, border: `1px solid ${VOICE.line}`, color: VOICE.user }}>
                <option value="">Select project…</option>
                {projects?.map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
              </select>
              <input type="date" value={dateIssued} onChange={e => setDateIssued(e.target.value)} required className="flex-1 min-w-44 px-3.5 py-2.5 rounded-xl text-sm" style={{ background: VOICE.surface, border: `1px solid ${VOICE.line}`, color: VOICE.user, ...VNUMS }} />
            </div>
          </section>

          <hr className="border-0 my-9" style={{ height: 1, background: VOICE.line }} />

          {/* 02 — What's the work? */}
          <section>
            <div className="flex items-start justify-between gap-3">
              <Question n="02" hint="Write it the way you'd say it.">What's the work?</Question>
              {/* B4 — draft stages from the scope (wo-stage-drafter) */}
              <button
                type="button"
                onClick={handleDraftStages}
                disabled={uiDrafting || !scope.trim()}
                title={!scope.trim() ? 'Write the scope first' : 'Draft stages from the scope'}
                className="text-xs font-medium inline-flex items-center gap-1.5 mt-1 shrink-0 disabled:opacity-40"
                style={{ color: VOICE.askDeep }}
              >
                {uiDrafting
                  ? <Loader2 className="animate-spin" size={12} />
                  : <span className="material-symbols-outlined text-[14px]">auto_awesome</span>}
                {uiDrafting ? 'Drafting…' : 'draft stages from this'}
              </button>
            </div>
            {uiDraftError && (
              <p className="text-xs mt-2" style={{ color: '#B91C1C' }}>{uiDraftError}</p>
            )}
            <textarea
              value={scope}
              onChange={e => setScope(e.target.value)}
              rows={2}
              className="w-full px-4 py-3 rounded-xl text-sm outline-none resize-none"
              style={{ background: VOICE.surface, border: `1px solid ${VOICE.line}`, color: VOICE.user }}
              placeholder='"Foundation and plinth lump sum 1.8L, GF brickwork 1400 sft at 85, then plastering…"'
              required
            />
          </section>

          <hr className="border-0 my-9" style={{ height: 1, background: VOICE.line }} />

          {/* 03 — How is the money split? */}
          <section>
            <Question n="03" hint="Each stage becomes a payable milestone.">How is the money split?</Question>

            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-sm" style={{ color: VOICE.system }}>Contract value</span>
              <span className="text-lg" style={{ color: VOICE.systemFaint }}>₹</span>
              <input
                type="number" step="0.01" min="0"
                value={orderValue || ''}
                onChange={e => setOrderValue(parseAmount(e.target.value))}
                placeholder="0"
                required
                aria-label="Contract value in rupees"
                className="bg-transparent outline-none font-medium"
                style={{ color: VOICE.user, fontSize: 28, width: 220, ...VNUMS }}
              />
              <span className="text-xs" style={{ color: VOICE.systemFaint }}>excl. GST</span>
            </div>

            <UiAllocationBar
              contract={orderValue}
              total={uiAllocated}
              segments={uiSegments}
              isOver={isOver}
              activeSeg={uiActiveSeg}
              onSegTap={(i) => setUiActiveSeg(uiActiveSeg === i ? null : i)}
            />

            <div className="flex items-center justify-between mt-6 mb-1">
              <span className="text-xs font-semibold uppercase tracking-[0.1em]" style={{ color: VOICE.system }}>Stages</span>
              <button type="button" onClick={addStage} className="flex items-center gap-1.5 text-xs font-medium" style={{ color: VOICE.user }}>
                <span className="material-symbols-outlined text-[16px]">add</span> Add stage
              </button>
            </div>

            {/* AI Review Panel */}
            {pendingStages.length > 0 && (
              <div className="mb-4 rounded-xl border border-secondary/20 bg-secondary-container/10 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-secondary/10">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-secondary">auto_awesome</span>
                    <p className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">
                      {pendingStages.length} extracted stage{pendingStages.length > 1 ? 's' : ''} — review before adding
                    </p>
                  </div>
                  {pendingStages.some(p => !p.arithmetic_mismatch) && (
                    <button
                      type="button"
                      onClick={addAllPendingStages}
                      className="text-[11px] font-semibold text-primary hover:text-primary/80 px-3 py-1 rounded-lg hover:bg-primary/5 transition-colors"
                    >
                      Add All
                    </button>
                  )}
                </div>
                <div className="p-3 space-y-2">
                  {pendingStages.map(es => (
                    <ExtractedStageCard key={es._id} stage={es} onAdd={addPendingStage} />
                  ))}
                </div>
              </div>
            )}

            {stages.length === 0 && pendingStages.length === 0 ? (
              <button
                type="button"
                onClick={addStage}
                className="w-full border-2 border-dashed border-outline-variant/40 rounded-xl p-8 text-center text-on-surface-variant hover:border-primary/30 hover:bg-primary/5 transition-all group"
              >
                <span className="material-symbols-outlined text-[36px] opacity-30 group-hover:opacity-60 mb-2 block transition-opacity">playlist_add</span>
                <p className="text-body-sm">No work stages yet — click to add the first row.</p>
              </button>
            ) : stages.length > 0 ? (
              <div className="space-y-1">
                {stages.map((s) => {
                  const mode    = getMode(s);
                  const isLS    = s.unit_type === 'LS';
                  const amount  = calcAmount(s);
                  // ui/work-order-redesign — index among named stages, for the segment dot
                  // colour + the allocation-bar row highlight (decorative; no logic change).
                  const namedIdx = uiNamedStages.indexOf(s);

                  return (
                    <div
                      key={s.id}
                      className="rounded-xl px-4 py-4 transition-colors"
                      style={{
                        background: uiActiveSeg === namedIdx && namedIdx !== -1 ? VOICE.field : VOICE.surface,
                        border: `1px solid ${VOICE.line}`,
                        borderLeft: s.ambiguous ? '3px solid #E5A100' : `1px solid ${VOICE.line}`,
                      }}
                      title={s.ambiguous ? 'Verify this stage — add qty & rate if measured' : undefined}
                    >
                      {/* line 1 — segment dot + stage name + remove */}
                      <div className="flex items-center gap-2.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: s.name.trim() && namedIdx !== -1 ? SEG[namedIdx % SEG.length] : VOICE.line }}
                          aria-hidden="true"
                        />
                        <input
                          data-stage-id={s.id}
                          value={s.name}
                          onChange={e => updateStage(s.id, 'name', e.target.value)}
                          onBlur={() => handleNameBlur(s)}
                          aria-label="Stage description"
                          className="flex-1 min-w-0 bg-transparent text-[15px] font-medium outline-none"
                          style={{ color: VOICE.user }}
                          placeholder="e.g. Plastering — 2nd floor"
                        />
                        <button
                          type="button"
                          onClick={() => removeStage(s.id)}
                          aria-label="Remove stage"
                          className="shrink-0"
                          style={{ color: VOICE.systemFaint }}
                        >
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      </div>

                      {/* line 2 — qty · unit · rate … amount */}
                      <div className="flex items-center gap-2.5 mt-3 ml-5 flex-wrap">
                        {isLS ? (
                          <span className="text-sm h-10 inline-flex items-center justify-end px-3.5 rounded-lg select-none" style={{ background: VOICE.field, border: `1px solid ${VOICE.line}`, color: VOICE.systemFaint, width: 96 }}>—</span>
                        ) : (
                          <input
                            type="number" step="0.01" min="0"
                            value={s.quantity ?? ''}
                            onChange={e => {
                              const v = parseFloat(e.target.value) || null;
                              setStages(prev => prev.map(st => st.id !== s.id ? st : { ...st, quantity: v, amount: null }));
                            }}
                            aria-label="Stage quantity"
                            className="h-10 px-3.5 rounded-lg text-sm text-right outline-none"
                            style={{ background: VOICE.field, border: `1px solid ${VOICE.line}`, color: VOICE.user, width: 96, ...VNUMS }}
                            placeholder="qty"
                          />
                        )}
                        <select
                          value={s.unit_type}
                          onChange={e => {
                            const u = e.target.value;
                            // Switching to LS → clear qty/rate; switching away → clear direct amount
                            setStages(prev => prev.map(st => st.id !== s.id ? st : {
                              ...st,
                              unit_type: u,
                              quantity: u === 'LS' ? null : st.quantity,
                              rate:     u === 'LS' ? null : st.rate,
                              amount:   u === 'LS' ? st.amount : null,
                            }));
                          }}
                          aria-label="Stage unit"
                          className="h-10 px-3 rounded-lg text-sm outline-none"
                          style={{ background: VOICE.field, border: `1px solid ${VOICE.line}`, color: VOICE.system, minWidth: 104 }}
                        >
                          <option value="">unit</option>
                          {UNIT_GROUPS.map(g => (
                            <optgroup key={g.group} label={`── ${g.group} ──`}>
                              {g.items.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
                            </optgroup>
                          ))}
                        </select>
                        <span className="text-xs" style={{ color: VOICE.systemFaint }}>×</span>
                        {isLS ? (
                          <span className="text-sm h-10 inline-flex items-center justify-end px-3.5 rounded-lg select-none" style={{ background: VOICE.field, border: `1px solid ${VOICE.line}`, color: VOICE.systemFaint, width: 120 }}>—</span>
                        ) : (
                          <input
                            type="number" step="0.01" min="0"
                            value={s.rate ?? ''}
                            onChange={e => {
                              const v = parseFloat(e.target.value) || null;
                              setStages(prev => prev.map(st => st.id !== s.id ? st : { ...st, rate: v, amount: null }));
                            }}
                            aria-label="Stage rate"
                            className="h-10 px-3.5 rounded-lg text-sm text-right outline-none"
                            style={{ background: VOICE.field, border: `1px solid ${VOICE.line}`, color: VOICE.user, width: 120, ...VNUMS }}
                            placeholder="₹ rate"
                          />
                        )}
                        <span className="flex-1" />
                        {mode === 'measured' ? (
                          <span className="text-[15px] font-semibold text-right" style={{ color: VOICE.user, minWidth: 128, ...VNUMS }}>
                            {fmtRupee(amount)}
                          </span>
                        ) : (
                          <input
                            type="number" step="0.01" min="0"
                            value={s.amount ?? ''}
                            onChange={e => {
                              const v = parseFloat(e.target.value) || null;
                              // typing amount clears qty/rate to lock into lumpsum mode
                              setStages(prev => prev.map(st => st.id !== s.id ? st : { ...st, amount: v, quantity: null, rate: null }));
                            }}
                            aria-label="Stage amount"
                            className="h-10 px-3.5 rounded-lg text-[15px] text-right font-semibold outline-none"
                            style={{ background: VOICE.field, border: `1px solid ${VOICE.line}`, color: VOICE.user, width: 148, ...VNUMS }}
                            placeholder="₹ amount"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>

          {createWO.isError && (
            <div className="mt-8 p-4 bg-error-container text-on-error-container rounded-xl text-body-sm flex items-center gap-2">
              <span className="material-symbols-outlined shrink-0">error</span>
              {(createWO.error as Error)?.message}
            </div>
          )}
        </form>
      </div>

      {/* Fixed bottom action bar — total + status + single primary (B1: disable on isOver only) */}
      <footer className="fixed bottom-16 md:bottom-0 left-0 md:left-72 right-0 z-40 backdrop-blur-sm" style={{ background: VOICE.surface, borderTop: `1px solid ${VOICE.line}`, paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="px-margin-mobile md:px-margin-desktop py-3 flex items-center gap-3 flex-wrap">
          <div>
            <UiTotalExclGst amountLabel={`₹${uiAllocated.toLocaleString('en-IN')}`} size={16} />
            <p className="text-xs" style={{ color: VOICE.systemFaint, ...VNUMS }}>
              {uiNamedStages.length > 0 ? `${uiNamedStages.length} stage${uiNamedStages.length > 1 ? 's' : ''}` : 'one full payment'} · draft
            </p>
          </div>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => navigate(initState.returnTo || (initState.from === 'project' && initState.projectId ? `/projects/${initState.projectId}/work-orders` : '/work-orders'))}
            className="text-sm font-medium"
            style={{ color: VOICE.system }}
          >
            Cancel
          </button>
          <div className="text-right">
            <button
              type="submit"
              form="wo-new-form"
              className="text-sm font-medium px-6 py-3 rounded-xl inline-flex items-center gap-1.5 text-white disabled:opacity-50"
              style={{ background: VOICE.user }}
              disabled={createWO.isPending || isOver}
            >
              {createWO.isPending
                ? <><Loader2 className="animate-spin" size={15} /> Saving…</>
                : <><span className="material-symbols-outlined text-[18px]">check</span> Create contract</>}
            </button>
            <UiSaveHint text={isOver ? `stages exceed contract by ₹${(stagesTotal - orderValue).toLocaleString('en-IN')}` : null} />
          </div>
        </div>
      </footer>

      {/* ── One-time job confirmation dialog ──────────────────────────── */}
      {showOneTimeDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-[28px] text-amber-500 shrink-0">info</span>
              <div>
                <h3 className="text-title-md font-semibold text-on-surface">One-Time Job?</h3>
                <p className="text-body-sm text-on-surface-variant mt-1">
                  No work stages have been added. Is this a one-shot job? A single <strong>Full Payment</strong> milestone will be created for the full order value.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 pt-1">
              <button
                className="bk-btn w-full py-2.5 rounded-xl text-body-sm font-semibold"
                onClick={() => { setShowOneTimeDialog(false); createWO.mutate(); }}
              >
                Yes, it's a one-time job
              </button>
              <button
                className="bk-btn-ghost w-full py-2.5 rounded-xl border border-outline-variant/40 text-body-sm font-semibold"
                onClick={() => {
                  setShowOneTimeDialog(false);
                  const id = Math.random().toString();
                  setStages([{ id, name: '', unit_type: '', quantity: null, rate: null, amount: null }]);
                  setNewStageId(id);
                }}
              >
                Add milestones
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

    {/* ui/work-order-redesign — save ceremony (B5). onLeave fires the EXISTING navigate
        with the id read from createWO.data; every exit (scrim/Done/View) calls it. */}
    <UiWoCeremony
      open={uiCeremonyOpen}
      woId={createWO.data}
      workerName={selectedWorker?.name}
      projectName={selectedProject?.name}
      total={uiAllocated}
      contract={orderValue}
      segments={uiSegments}
      stageCount={uiNamedStages.length}
      onLeave={() => initState.returnTo
        ? navigate(initState.returnTo)
        : navigate(`/work-orders/${createWO.data}`, { state: initState.from === 'project' ? { from: 'project', projectId: initState.projectId, projectName: initState.projectName } : undefined })}
    />
    </>
  );
}

function Question({ n, hint, children }: { n: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 mb-4">
      <span className="text-xs" style={{ color: VOICE.systemFaint, ...VNUMS }}>{n}</span>
      <div>
        <h2 className="text-base font-medium" style={{ color: VOICE.user }}>{children}</h2>
        {hint && <p className="text-xs mt-0.5" style={{ color: VOICE.systemFaint }}>{hint}</p>}
      </div>
    </div>
  );
}

// ─── AI Extraction Review Card ─────────────────────────────────────────────

const CONFIDENCE_STYLE = {
  HIGH:   { bar: '████',  cls: 'bg-green-100 text-green-700' },
  MEDIUM: { bar: '███░',  cls: 'bg-amber-100 text-amber-700' },
  LOW:    { bar: '██░░',  cls: 'bg-red-100 text-red-700' },
} as const;

function ExtractedStageCard({
  stage,
  onAdd,
}: {
  stage: ExtractedStage;
  onAdd: (s: ExtractedStage, amountOverride?: number) => void;
}) {
  const conf = CONFIDENCE_STYLE[stage.confidence];
  const calcAmt =
    stage.qty != null && stage.rate != null
      ? multiply(stage.qty, stage.rate)
      : null;

  return (
    <div className={`rounded-lg border bg-surface p-3 ${
      stage.arithmetic_mismatch
        ? 'border-amber-300'
        : stage.confidence === 'HIGH'
          ? 'border-outline-variant/20'
          : 'border-amber-200/70'
    }`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">

          {/* Confidence badge row */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] text-on-surface-variant">🤖 Extracted</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded font-data-mono ${conf.cls}`}>
              {stage.confidence} {conf.bar}
            </span>
          </div>

          {/* Name */}
          <p className="text-[13px] font-semibold text-on-surface mb-0.5 truncate">{stage.name}</p>

          {/* Mode display */}
          {stage.mode === 'measured' && (
            <p className="text-[12px] text-on-surface-variant font-data-mono">
              {(stage.qty ?? 0).toLocaleString('en-IN')} {stage.unit_type} &times; ₹{(stage.rate ?? 0).toLocaleString('en-IN')} ={' '}
              <span className="text-on-surface font-semibold">{fmtRupee(stage.amount)}</span>
              {stage.amount_verified && !stage.arithmetic_mismatch && (
                <span className="text-green-600 ml-1 not-italic">✓</span>
              )}
            </p>
          )}
          {stage.mode === 'lumpsum' && (
            <p className="text-[12px] text-on-surface-variant">
              {stage.unit_type === 'LS' ? 'Lump Sum — ' : ''}{fmtRupee(stage.amount)}
            </p>
          )}
          {stage.mode === 'ambiguous' && (
            <p className="text-[12px] text-on-surface-variant">
              {fmtRupee(stage.amount)} — no qty/rate found
            </p>
          )}

          {/* Confidence warning */}
          {stage.confidence !== 'HIGH' && !stage.arithmetic_mismatch && (
            <p className="text-[11px] text-amber-700 mt-0.5">
              ⚠ {stage.mode === 'ambiguous' ? 'Assumed lump sum — verify' : stage.confidence_reason}
            </p>
          )}

          {/* Arithmetic mismatch — user must resolve */}
          {stage.arithmetic_mismatch && (
            <div className="mt-2 rounded-md bg-amber-50 border border-amber-200/60 p-2.5">
              <p className="text-[11px] text-amber-800 font-medium mb-1">
                ⚠ {stage.mismatch_note}
              </p>
              <p className="text-[11px] text-on-surface-variant mb-2">Which amount is correct?</p>
              <div className="flex gap-2 flex-wrap">
                {calcAmt != null && (
                  <button
                    type="button"
                    onClick={() => onAdd(stage, calcAmt)}
                    className="text-[11px] px-2.5 py-1.5 rounded-lg bg-white border border-outline-variant/30 text-on-surface hover:bg-surface-container-low transition-colors font-medium"
                  >
                    Use calculated {fmtRupee(calcAmt)}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onAdd(stage, stage.amount)}
                  className="text-[11px] px-2.5 py-1.5 rounded-lg bg-white border border-outline-variant/30 text-on-surface hover:bg-surface-container-low transition-colors font-medium"
                >
                  Use document {fmtRupee(stage.amount)}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Add button (hidden for mismatch — user must pick via choice buttons) */}
        {!stage.arithmetic_mismatch && (
          <button
            type="button"
            onClick={() => onAdd(stage)}
            className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          >
            <span className="material-symbols-outlined text-[13px]">check</span> Add
          </button>
        )}
      </div>
    </div>
  );
}
