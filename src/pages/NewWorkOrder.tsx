import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Breadcrumb from '../components/Breadcrumb';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import type { Project, Stakeholder } from '../types';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';

// ─── Work Stage types ──────────────────────────────────────────────────────

interface StageDraft {
  id: string;
  name: string;
  unit_type: string;
  quantity: number | null;
  rate: number | null;
  amount: number | null;   // directly-entered lumpsum; null means computed from qty×rate
  trigger_condition: string;
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

const QTY_LABELS: Record<string, string> = {
  Sqft: 'sq. feet',   Sqm: 'sq. metres',    Sqyd: 'sq. yards',
  Cum: 'cu. metres',  Cft: 'cu. feet',       'Cu.yd': 'cu. yards',
  Rmt: 'run. metres', Rft: 'run. feet',
  Nos: 'count',       Kg: 'kilograms',        MT: 'metric tonnes',
  Quintal: 'quintals',
};

function calcAmount(s: StageDraft): number {
  const mode = getMode(s);
  if (mode === 'measured') return Math.round((s.quantity ?? 0) * (s.rate ?? 0) * 100) / 100;
  if (mode === 'lumpsum')  return s.amount ?? 0;
  return 0;
}

const fmtRupee = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

// ─── Component ────────────────────────────────────────────────────────────

export default function NewWorkOrder({ session }: { session: Session }) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { data: profile } = useUserProfile(session.user.id);

  const initState = (location.state as any) || {};

  const [woId] = useState(() => `WO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`);
  const [woIdCopied, setWoIdCopied] = useState(false);
  const [projectId, setProjectId] = useState<string>(initState.projectId || '');
  const [stakeholderId, setStakeholderId] = useState<string>(initState.stakeholderId || '');
  const [scope, setScope] = useState('');
  const [orderValue, setOrderValue] = useState<number>(0);
  const [dateIssued, setDateIssued] = useState('');
  const [stages, setStages] = useState<StageDraft[]>([]);
  const [newStageId, setNewStageId] = useState<string | null>(null);
  const [source, setSource] = useState<'manual' | 'uploaded_doc'>('manual');
  const [isAiExtracted, setIsAiExtracted] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

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
      const { data, error } = await supabase.from('projects').select('project_id, name').eq('status', 'Active').order('name');
      if (error) throw error;
      return data as Pick<Project, 'project_id' | 'name'>[];
    },
  });

  const { data: workers } = useQuery({
    queryKey: ['workers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('stakeholders').select('stakeholder_id, name').eq('type', 'Worker').order('name');
      if (error) throw error;
      return data as Pick<Stakeholder, 'stakeholder_id' | 'name'>[];
    },
  });

  const selectedProject = projects?.find(p => p.project_id === projectId);
  const selectedWorker  = workers?.find(w => w.stakeholder_id === stakeholderId);
  const stagesTotal = stages.reduce((sum, s) => sum + calcAmount(s), 0);
  const pct     = orderValue > 0 ? Math.min((stagesTotal / orderValue) * 100, 100) : 0;
  const isOver  = orderValue > 0 && stagesTotal > orderValue + 0.01;
  const isExact = orderValue > 0 && Math.abs(stagesTotal - orderValue) < 0.01;
  const isUnder = orderValue > 0 && stagesTotal < orderValue - 0.01;

  // ─── Save mutation ───────────────────────────────────────────────────────

  const createWO = useMutation({
    mutationFn: async () => {
      if (!projectId || !stakeholderId || !scope || !dateIssued)
        throw new Error('Please fill in all required fields.');
      const { data: woData, error: woError } = await supabase.from('work_orders').insert([{
        wo_id: woId, project_id: projectId, stakeholder_id: stakeholderId,
        scope_of_work: scope, order_value: orderValue, date_issued: dateIssued,
        source, status: 'Draft' as const,
      }]).select().single();
      if (woError) throw woError;
      if (stages.length > 0) {
        const rows = stages.map((s, idx) => {
          const mode = getMode(s);
          return {
            wo_id: woId, seq_no: idx + 1, name: s.name,
            trigger_condition: s.trigger_condition || null,
            unit_type: s.unit_type || null,
            quantity: mode === 'measured' ? s.quantity : (mode === 'lumpsum' ? 1 : null),
            rate: mode === 'measured' ? s.rate : null,
            planned_amount: calcAmount(s),
            status: 'Pending' as const,
            ai_extracted: isAiExtracted,
          };
        });
        const { error: mError } = await supabase.from('wo_milestones').insert(rows);
        if (mError) throw mError;
      }
      return woData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work_orders'] });
      navigate('/work-orders');
    },
  });

  // ─── Stage helpers ────────────────────────────────────────────────────────

  const addStage = () => {
    const id = Math.random().toString();
    setStages(prev => [...prev, { id, name: '', unit_type: '', quantity: null, rate: null, amount: null, trigger_condition: '' }]);
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

  // ─── AI file upload ────────────────────────────────────────────────────────

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsExtracting(true);
    setAiError(null);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64String = (reader.result as string).split(',')[1];
        const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
        if (!apiKey) throw new Error('OpenAI API Key is not configured.');
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              { role: 'system', content: `You are a construction contract extractor. Extract details from the provided image and return ONLY a valid JSON object. Format: { "worker_name_fuzzy": "Name", "scope_of_work": "Scope", "order_value": 100000, "date_issued": "YYYY-MM-DD", "milestones": [{ "name": "Milestone", "trigger_condition": "Condition", "planned_amount": 50000 }] }` },
              { role: 'user', content: [{ type: 'text', text: 'Extract details.' }, { type: 'image_url', image_url: { url: `data:${file.type};base64,${base64String}` } }] },
            ],
            temperature: 0.2,
          }),
        });
        if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
        const result = await response.json();
        const jsonStr = result.choices[0].message.content.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
        const data = JSON.parse(jsonStr);
        setScope(data.scope_of_work || '');
        setOrderValue(data.order_value || 0);
        if (data.date_issued && !isNaN(Date.parse(data.date_issued))) setDateIssued(data.date_issued);
        if (Array.isArray(data.milestones)) {
          setStages(data.milestones.map((m: any) => ({
            id: Math.random().toString(),
            name: m.name || '',
            unit_type: 'LS',
            quantity: null,
            rate: null,
            amount: m.planned_amount || 0,
            trigger_condition: m.trigger_condition || '',
          })));
        }
        if (data.worker_name_fuzzy && workers) {
          const match = workers.find(w => w.name.toLowerCase().includes(data.worker_name_fuzzy.toLowerCase()));
          if (match) setStakeholderId(match.stakeholder_id);
        }
        setSource('uploaded_doc');
        setIsAiExtracted(true);
        setIsExtracting(false);
      };
    } catch (err: any) {
      setAiError(err.message || 'Failed to extract data.');
      setIsExtracting(false);
    }
  };

  // ─── Access guard ─────────────────────────────────────────────────────────

  if (profile && profile.role !== 'management' && profile.role !== 'principal') {
    return (
      <div className="px-margin-mobile md:px-margin-desktop pt-6">
        <div className="bg-error-container text-on-error-container p-6 rounded-xl">
          <h3 className="text-headline-md font-headline-md">Access Denied</h3>
          <p className="text-body-sm mt-2">Only Management and Principal can create Work Orders.</p>
        </div>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6 pb-32">

      <Breadcrumb items={
        initState.from === 'project' && initState.projectName
          ? [
              { label: 'Dashboard', href: '/' },
              { label: 'Projects', href: '/projects' },
              { label: initState.projectName, href: `/projects/${initState.projectId}` },
              { label: 'Work Orders', href: '/work-orders' },
              { label: 'New' },
            ]
          : [
              { label: 'Dashboard', href: '/' },
              { label: 'Work Orders', href: '/work-orders' },
              { label: 'New' },
            ]
      } />

      <div className="mb-8">
        <h1 className="text-headline-lg font-headline-lg text-on-background">New Work Order</h1>
        <p className="text-body-sm text-on-surface-variant mt-1">Fill in the details manually, or use AI extraction to auto-populate from a document.</p>
      </div>

      {aiError && (
        <div className="mb-6 p-4 bg-error-container text-on-error-container rounded-xl text-body-sm flex items-center gap-2">
          <span className="material-symbols-outlined shrink-0">error</span> {aiError}
        </div>
      )}
      {isAiExtracted && (
        <div className="mb-6 p-4 bg-secondary-container text-on-secondary-container rounded-xl text-body-sm flex items-center gap-2">
          <span className="material-symbols-outlined shrink-0">auto_awesome</span>
          Data extracted from document — please review all fields before saving.
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-8 items-start">

        {/* ── Left: Form ─────────────────────────────────────────────── */}
        <form
          id="wo-new-form"
          onSubmit={e => { e.preventDefault(); createWO.mutate(); }}
          className="flex-1 min-w-0 space-y-10"
        >

          {/* 01 Order Details */}
          <section>
            <SectionLabel n="01" label="Order Details" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

              <div className="space-y-2">
                <label className="text-label-caps font-label-caps text-on-surface-variant flex items-center gap-2">
                  WO ID
                  <span className="px-1.5 py-0.5 bg-surface-container-highest text-on-surface-variant rounded text-[9px] font-bold tracking-wider">AUTO</span>
                </label>
                <div className="relative">
                  <input value={woId} readOnly className="bk-input bg-surface-container text-on-surface-variant cursor-default font-data-mono pr-20" />
                  <button type="button"
                    onClick={() => { navigator.clipboard.writeText(woId); setWoIdCopied(true); setTimeout(() => setWoIdCopied(false), 2000); }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 py-1 rounded text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition-colors"
                    title="Copy WO ID">
                    {woIdCopied
                      ? <span className="text-[11px] font-bold text-secondary whitespace-nowrap">Copied!</span>
                      : <span className="material-symbols-outlined text-[18px]">content_copy</span>}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-label-caps font-label-caps text-on-surface-variant">Date Issued</label>
                <input type="date" value={dateIssued} onChange={e => setDateIssued(e.target.value)} className="bk-input" required />
              </div>

              <div className="space-y-2">
                <label className="text-label-caps font-label-caps text-on-surface-variant">Project</label>
                <select value={projectId} onChange={e => setProjectId(e.target.value)} className="bk-input" required>
                  <option value="">Select project…</option>
                  {projects?.map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-label-caps font-label-caps text-on-surface-variant">Status</label>
                <div className="bk-input bg-surface-container cursor-default flex items-center gap-2.5">
                  <span className="px-2 py-0.5 bg-tertiary-container text-on-tertiary-container rounded text-[10px] font-bold">DRAFT</span>
                  <span className="text-body-sm text-on-surface-variant">Set automatically on creation</span>
                </div>
              </div>

            </div>
          </section>

          {/* 02 Assigned Worker */}
          <section>
            <SectionLabel n="02" label="Assigned Worker" />
            <div className="space-y-2 max-w-sm">
              <label className="text-label-caps font-label-caps text-on-surface-variant">Worker</label>
              <select value={stakeholderId} onChange={e => setStakeholderId(e.target.value)} className="bk-input" required>
                <option value="">Select worker…</option>
                {workers?.map(w => <option key={w.stakeholder_id} value={w.stakeholder_id}>{w.name}</option>)}
              </select>
            </div>
          </section>

          {/* 03 Scope of Work */}
          <section>
            <SectionLabel n="03" label="Scope of Work" />
            <textarea
              value={scope}
              onChange={e => setScope(e.target.value)}
              rows={6}
              className="bk-input w-full resize-y"
              placeholder="Describe the work to be performed, materials to be used, and any specific requirements or exclusions…"
              required
            />
          </section>

          {/* 04 Financial */}
          <section>
            <SectionLabel n="04" label="Financial" />
            <div className="flex flex-col sm:flex-row gap-5 items-start">
              <div className="space-y-2 w-full sm:max-w-xs">
                <label className="text-label-caps font-label-caps text-on-surface-variant">Order Value</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-data-mono font-bold text-on-surface">₹</span>
                  <input
                    type="number" step="0.01" min="0"
                    value={orderValue || ''}
                    onChange={e => setOrderValue(parseFloat(e.target.value) || 0)}
                    className="bk-input pl-8 font-data-mono text-headline-sm font-bold"
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>
              <div className="sm:pt-8">
                <label className="bk-btn-ghost flex items-center gap-2 cursor-pointer border border-primary/20 px-4 py-2.5 rounded-xl">
                  {isExtracting
                    ? <Loader2 className="animate-spin text-primary" size={16} />
                    : <span className="material-symbols-outlined text-primary text-[18px]">auto_awesome</span>}
                  <span className="text-body-sm font-semibold">{isExtracting ? 'Extracting…' : 'AI Extract from Document'}</span>
                  <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileUpload} disabled={isExtracting} />
                </label>
              </div>
            </div>
          </section>

          {/* 05 Work Stages */}
          <section>
            <div className="flex items-center justify-between mb-5">
              <SectionLabel n="05" label="Work Stages" noMargin />
              <button type="button" onClick={addStage}
                className="flex items-center gap-1.5 px-3 py-1.5 text-label-caps font-label-caps text-primary border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors">
                <span className="material-symbols-outlined text-[16px]">add</span> Add Row
              </button>
            </div>

            {stages.length === 0 ? (
              <button
                type="button"
                onClick={addStage}
                className="w-full border-2 border-dashed border-outline-variant/40 rounded-xl p-8 text-center text-on-surface-variant hover:border-primary/30 hover:bg-primary/5 transition-all group"
              >
                <span className="material-symbols-outlined text-[36px] opacity-30 group-hover:opacity-60 mb-2 block transition-opacity">playlist_add</span>
                <p className="text-body-sm">No work stages yet — click to add the first row.</p>
              </button>
            ) : (
              <div className="overflow-x-auto -mx-1 px-1">
                {/* Column header */}
                <div
                  className="hidden sm:grid gap-x-2 pb-2 border-b border-black/[0.06] text-[10px] font-bold text-on-surface-variant tracking-[0.08em] uppercase"
                  style={{ gridTemplateColumns: '1fr 130px 80px 100px 110px 120px 36px' }}
                >
                  <div className="pl-1">Work Stage</div>
                  <div>Unit</div>
                  <div>Qty</div>
                  <div>Rate ₹</div>
                  <div className="text-right pr-2">Amount</div>
                  <div>Due</div>
                  <div />
                </div>

                {/* Stage rows */}
                {stages.map((s, idx) => {
                  const mode    = getMode(s);
                  const isLS    = s.unit_type === 'LS';
                  const amount  = calcAmount(s);
                  const dimCell = 'h-9 flex items-center justify-center text-[13px] text-on-surface-variant/40 rounded-md border border-black/[0.04] bg-black/[0.015] select-none';
                  const inputCls = 'h-9 w-full px-2.5 text-[13px] border border-black/10 rounded-md focus:outline-none focus:border-primary/40 bg-transparent placeholder:text-on-surface-variant/40';

                  return (
                    <div
                      key={s.id}
                      className="sm:grid gap-x-2 items-start py-2 border-b border-black/[0.04] last:border-0 flex flex-col gap-2"
                      style={{ gridTemplateColumns: '1fr 130px 80px 100px 110px 120px 36px' }}
                    >
                      {/* Work Stage name */}
                      <div className="flex flex-col gap-0.5 w-full">
                        <label className="sm:hidden text-[10px] font-bold text-on-surface-variant">WORK STAGE</label>
                        <input
                          data-stage-id={s.id}
                          value={s.name}
                          onChange={e => updateStage(s.id, 'name', e.target.value)}
                          onBlur={() => handleNameBlur(s)}
                          className={inputCls}
                          placeholder="e.g. Foundation slab, 2nd floor plastering"
                        />
                        <span className="h-3" />
                      </div>

                      {/* Unit */}
                      <div className="flex flex-col gap-0.5 w-full sm:w-auto">
                        <label className="sm:hidden text-[10px] font-bold text-on-surface-variant">UNIT</label>
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
                          className="h-9 w-full px-2 text-[13px] border border-black/10 rounded-md focus:outline-none focus:border-primary/40 bg-transparent"
                        >
                          <option value="">Unit</option>
                          {UNIT_GROUPS.map(g => (
                            <optgroup key={g.group} label={`── ${g.group} ──`}>
                              {g.items.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
                            </optgroup>
                          ))}
                        </select>
                        <span className="h-3" />
                      </div>

                      {/* Qty */}
                      <div className="flex flex-col gap-0.5 w-full sm:w-auto">
                        <label className="sm:hidden text-[10px] font-bold text-on-surface-variant">QTY</label>
                        {isLS ? (
                          <div className={dimCell}>—</div>
                        ) : (
                          <input
                            type="number" step="0.01" min="0"
                            value={s.quantity ?? ''}
                            onChange={e => {
                              const v = parseFloat(e.target.value) || null;
                              // typing qty clears any direct amount
                              setStages(prev => prev.map(st => st.id !== s.id ? st : { ...st, quantity: v, amount: null }));
                            }}
                            className={inputCls}
                            placeholder="0"
                          />
                        )}
                        <span className="text-[10px] text-on-surface-variant h-3 leading-3">
                          {s.unit_type && !isLS ? (QTY_LABELS[s.unit_type] ?? s.unit_type.toLowerCase()) : ''}
                        </span>
                      </div>

                      {/* Rate */}
                      <div className="flex flex-col gap-0.5 w-full sm:w-auto">
                        <label className="sm:hidden text-[10px] font-bold text-on-surface-variant">RATE ₹</label>
                        {isLS ? (
                          <div className={dimCell}>—</div>
                        ) : (
                          <input
                            type="number" step="0.01" min="0"
                            value={s.rate ?? ''}
                            onChange={e => {
                              const v = parseFloat(e.target.value) || null;
                              // typing rate clears any direct amount
                              setStages(prev => prev.map(st => st.id !== s.id ? st : { ...st, rate: v, amount: null }));
                            }}
                            className={inputCls}
                            placeholder="0"
                          />
                        )}
                        <span className="text-[10px] text-on-surface-variant h-3 leading-3">
                          {s.unit_type && !isLS ? `per ${s.unit_type}` : ''}
                        </span>
                      </div>

                      {/* Amount — editable in lumpsum, read-only when measured */}
                      <div className="flex flex-col gap-0.5 w-full sm:w-auto">
                        <label className="sm:hidden text-[10px] font-bold text-on-surface-variant">AMOUNT</label>
                        {mode === 'measured' ? (
                          // Computed — read-only tinted display
                          <div className="h-9 flex items-center justify-end px-2.5 rounded-md bg-black/[0.025] font-data-mono text-[13px] text-primary font-semibold">
                            {fmtRupee(amount)}
                          </div>
                        ) : (
                          // Editable — lumpsum path A (LS unit) or path B (direct entry)
                          <input
                            type="number" step="0.01" min="0"
                            value={s.amount ?? ''}
                            onChange={e => {
                              const v = parseFloat(e.target.value) || null;
                              // typing amount clears qty/rate to lock into lumpsum mode
                              setStages(prev => prev.map(st => st.id !== s.id ? st : { ...st, amount: v, quantity: null, rate: null }));
                            }}
                            className={`${inputCls} font-data-mono text-right ${(s.amount ?? 0) > 0 ? 'text-primary font-semibold' : ''}`}
                            placeholder="₹ amount"
                          />
                        )}
                        <span className="text-[10px] text-on-surface-variant h-3 leading-3">
                          {mode === 'measured'
                            ? `${(s.quantity ?? 0).toLocaleString('en-IN')} × ₹${(s.rate ?? 0).toLocaleString('en-IN')}`
                            : mode === 'lumpsum' ? 'Lump sum stage' : ''}
                        </span>
                      </div>

                      {/* Due Date */}
                      <div className="flex flex-col gap-0.5 w-full sm:w-auto">
                        <label className="sm:hidden text-[10px] font-bold text-on-surface-variant">DUE DATE</label>
                        <input
                          type="date"
                          value={s.trigger_condition}
                          onChange={e => updateStage(s.id, 'trigger_condition', e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Tab' && !e.shiftKey && idx === stages.length - 1) {
                              e.preventDefault();
                              addStage();
                            }
                          }}
                          className="h-9 w-full px-2 text-[13px] border border-black/10 rounded-md focus:outline-none focus:border-primary/40 bg-transparent"
                        />
                        <span className="h-3" />
                      </div>

                      {/* Delete */}
                      <div className="flex sm:flex-col items-start sm:items-center gap-0.5">
                        <label className="sm:hidden text-[10px] font-bold text-on-surface-variant opacity-0 select-none">×</label>
                        <button
                          type="button"
                          onClick={() => removeStage(s.id)}
                          className="h-9 w-9 flex items-center justify-center rounded-lg text-on-surface-variant/50 hover:text-error hover:bg-error-container/20 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[16px]">close</span>
                        </button>
                        <span className="h-3" />
                      </div>
                    </div>
                  );
                })}

                {/* Summary */}
                <div className="mt-4 pt-4 border-t border-outline-variant/20">
                  <div className="flex items-baseline justify-between gap-4 mb-3">
                    <span className="text-[12px] text-on-surface-variant">
                      {stages.length} work stage{stages.length !== 1 ? 's' : ''}
                    </span>
                    <div className="text-right">
                      <div className="text-[10px] font-bold tracking-wider text-on-surface-variant uppercase mb-0.5">Stages Total</div>
                      <div className="font-data-mono font-bold text-[18px] text-on-surface">{fmtRupee(stagesTotal)}</div>
                    </div>
                  </div>

                  {orderValue > 0 && (
                    <div>
                      <div className="flex items-center justify-between text-[11px] mb-1.5">
                        <span className="text-on-surface-variant">
                          Order Value: <span className="font-data-mono text-on-surface font-medium">{fmtRupee(orderValue)}</span>
                        </span>
                        <span className={`font-medium ${isOver ? 'text-error' : isExact ? 'text-green-700' : 'text-amber-600'}`}>
                          {isOver  && `⚠ Over by ${fmtRupee(stagesTotal - orderValue)}`}
                          {isExact && '✓ Fully allocated'}
                          {isUnder && `${fmtRupee(orderValue - stagesTotal)} unallocated`}
                          {!isOver && !isExact && !isUnder && ''}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-surface-container-highest overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${isOver ? 'bg-error' : 'bg-primary'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {createWO.isError && (
            <div className="p-4 bg-error-container text-on-error-container rounded-xl text-body-sm flex items-center gap-2">
              <span className="material-symbols-outlined shrink-0">error</span>
              {(createWO.error as Error)?.message}
            </div>
          )}
        </form>

        {/* ── Right: Summary sidebar ──────────────────────────────── */}
        <aside className="w-full lg:w-80 xl:w-88 shrink-0 lg:sticky lg:top-8">
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-card overflow-hidden">
            <div className="px-5 py-4 bg-surface-container-low border-b border-outline-variant/20 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-primary">preview</span>
              <h3 className="text-label-caps font-label-caps text-on-surface-variant">Order Summary</h3>
            </div>
            <div className="p-5 space-y-4">
              <SummaryRow icon="tag"         label="WO ID"        value={<span className="font-data-mono text-primary">{woId}</span>} />
              <SummaryRow icon="construction" label="Project"      value={selectedProject?.name ?? <span className="text-on-surface-variant italic text-body-sm">Not selected</span>} />
              <SummaryRow icon="person"       label="Worker"       value={selectedWorker?.name  ?? <span className="text-on-surface-variant italic text-body-sm">Not selected</span>} />
              <SummaryRow icon="payments"     label="Order Value"  value={<span className="font-data-mono font-bold">{fmtRupee(orderValue)}</span>} />
              <div className="pt-4 border-t border-outline-variant/20">
                <p className="text-[10px] font-bold text-on-surface-variant mb-2 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px]">description</span> SCOPE PREVIEW
                </p>
                <p className="text-body-sm text-on-surface leading-relaxed">
                  {scope
                    ? <>{scope.slice(0, 100)}{scope.length > 100 && <span className="text-on-surface-variant">…</span>}</>
                    : <span className="text-on-surface-variant italic">No scope added yet</span>}
                </p>
              </div>
              <div className="pt-4 border-t border-outline-variant/20 flex items-center justify-between">
                <span className="text-[10px] font-bold text-on-surface-variant flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px]">layers</span> WORK STAGES
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  stages.length > 0 && isExact
                    ? 'bg-secondary-container text-on-secondary-container'
                    : stages.length > 0
                      ? 'bg-tertiary-container text-on-tertiary-container'
                      : 'bg-surface-container-high text-on-surface-variant'
                }`}>
                  {stages.length === 0
                    ? 'None'
                    : `${stages.length} stage${stages.length > 1 ? 's' : ''} · ${fmtRupee(stagesTotal)}`}
                </span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Fixed bottom action bar */}
      <div className="fixed bottom-16 md:bottom-0 left-0 md:left-72 right-0 z-40 bg-surface/95 backdrop-blur-sm border-t border-outline-variant/20 px-margin-mobile md:px-margin-desktop py-3 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => navigate('/work-orders')}
          className="bk-btn-ghost border border-outline-variant/40 px-6 py-2.5 rounded-xl text-body-sm font-semibold"
        >
          Cancel
        </button>
        <button
          type="submit"
          form="wo-new-form"
          className="bk-btn flex items-center gap-2 px-8 py-2.5 rounded-xl"
          disabled={createWO.isPending || isOver}
        >
          {createWO.isPending
            ? <><Loader2 className="animate-spin" size={16} /> Saving…</>
            : <><span className="material-symbols-outlined text-[18px]">save</span> Save as Draft</>}
        </button>
      </div>
    </div>
  );
}

function SectionLabel({ n, label, noMargin }: { n: string; label: string; noMargin?: boolean }) {
  return (
    <div className={`flex items-center gap-3 ${noMargin ? '' : 'mb-5'}`}>
      <span className="text-[10px] font-bold text-on-surface-variant/50 font-data-mono shrink-0">{n}</span>
      <span className="text-[11px] font-bold text-on-surface-variant tracking-[0.1em] uppercase shrink-0">{label}</span>
      <div className="flex-1 border-t border-outline-variant/30" />
    </div>
  );
}

function SummaryRow({ icon, label, value }: { icon: string; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="material-symbols-outlined text-[16px] text-on-surface-variant mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold text-on-surface-variant">{label.toUpperCase()}</p>
        <div className="text-body-sm text-on-surface font-medium mt-0.5 truncate">{value}</div>
      </div>
    </div>
  );
}
