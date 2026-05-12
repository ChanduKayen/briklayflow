import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import Breadcrumb from '../components/Breadcrumb';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import type { Project, Stakeholder } from '../types';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';

interface MilestoneDraft { id: string; name: string; trigger_condition: string; planned_amount: number; }

const fmtVal = (n: number) => `₹${Number(n || 0).toLocaleString()}`;

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
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([]);
  const [source, setSource] = useState<'manual' | 'uploaded_doc'>('manual');
  const [isAiExtracted, setIsAiExtracted] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

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
  const selectedWorker = workers?.find(w => w.stakeholder_id === stakeholderId);
  const totalMilestones = milestones.reduce((sum, m) => sum + (Number(m.planned_amount) || 0), 0);
  const isBalanced = milestones.length === 0 || totalMilestones === Number(orderValue);

  const createWO = useMutation({
    mutationFn: async () => {
      if (!projectId || !stakeholderId || !scope || !dateIssued) throw new Error('Please fill in all required fields.');
      const newWO = {
        wo_id: woId, project_id: projectId, stakeholder_id: stakeholderId,
        scope_of_work: scope, order_value: orderValue, date_issued: dateIssued,
        source, status: 'Draft' as const,
      };
      const { data: woData, error: woError } = await supabase.from('work_orders').insert([newWO]).select().single();
      if (woError) throw woError;
      if (milestones.length > 0) {
        const rows = milestones.map((m, idx) => ({
          wo_id: woId, seq_no: idx + 1, name: m.name,
          trigger_condition: m.trigger_condition, planned_amount: m.planned_amount,
          status: 'Pending' as const,
          ai_extracted: isAiExtracted,
        }));
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

  const addMilestone = () =>
    setMilestones(prev => [...prev, { id: Math.random().toString(), name: '', trigger_condition: '', planned_amount: 0 }]);
  const updateMilestone = (id: string, field: keyof MilestoneDraft, value: string | number) =>
    setMilestones(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m));
  const removeMilestone = (id: string) =>
    setMilestones(prev => prev.filter(m => m.id !== id));

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
          setMilestones(data.milestones.map((m: any) => ({
            id: Math.random().toString(), name: m.name || '',
            trigger_condition: m.trigger_condition || '', planned_amount: m.planned_amount || 0,
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

      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-headline-lg font-headline-lg text-on-background">New Work Order</h1>
        <p className="text-body-sm text-on-surface-variant mt-1">Fill in the details manually, or use AI extraction to auto-populate from a document.</p>
      </div>

      {/* Banners */}
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

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-8 items-start">

        {/* ── Left: Form ──────────────────────────────────────── */}
        <form
          id="wo-new-form"
          onSubmit={e => { e.preventDefault(); createWO.mutate(); }}
          className="flex-1 min-w-0 space-y-10"
        >

          {/* ── 01 Order Details ── */}
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

          {/* ── 02 Assigned Worker ── */}
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

          {/* ── 03 Scope of Work ── */}
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

          {/* ── 04 Financial ── */}
          <section>
            <SectionLabel n="04" label="Financial" />
            <div className="flex flex-col sm:flex-row gap-5 items-start">
              <div className="space-y-2 w-full sm:max-w-xs">
                <label className="text-label-caps font-label-caps text-on-surface-variant">Order Value</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-data-mono font-bold text-on-surface">₹</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
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

          {/* ── 05 Milestones ── */}
          <section>
            <div className="flex items-center justify-between mb-5">
              <SectionLabel n="05" label="Milestones" noMargin />
              <button type="button" onClick={addMilestone}
                className="flex items-center gap-1.5 px-3 py-1.5 text-label-caps font-label-caps text-primary border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors">
                <span className="material-symbols-outlined text-[16px]">add</span> Add Row
              </button>
            </div>

            {milestones.length === 0 ? (
              <button
                type="button"
                onClick={addMilestone}
                className="w-full border-2 border-dashed border-outline-variant/40 rounded-xl p-8 text-center text-on-surface-variant hover:border-primary/30 hover:bg-primary/5 transition-all group"
              >
                <span className="material-symbols-outlined text-[36px] opacity-30 group-hover:opacity-60 mb-2 block transition-opacity">playlist_add</span>
                <p className="text-body-sm">No milestones yet — click to add the first row.</p>
              </button>
            ) : (
              <div className="space-y-3">
                <div className="hidden sm:grid grid-cols-12 gap-3 px-3 text-[10px] font-bold text-on-surface-variant tracking-[0.08em] uppercase">
                  <div className="col-span-5">Name</div>
                  <div className="col-span-3">Amount (₹)</div>
                  <div className="col-span-3">Due Date</div>
                  <div className="col-span-1" />
                </div>
                {milestones.map(m => (
                  <div key={m.id} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center bg-surface-container-low p-3 rounded-xl border border-outline-variant/20">
                    <div className="sm:col-span-5">
                      <label className="sm:hidden text-[10px] font-bold text-on-surface-variant mb-1 block">NAME</label>
                      <input value={m.name} onChange={e => updateMilestone(m.id, 'name', e.target.value)} className="bk-input py-1.5 w-full" placeholder="e.g. Foundation Complete" required />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="sm:hidden text-[10px] font-bold text-on-surface-variant mb-1 block">AMOUNT</label>
                      <input type="number" min="0" value={m.planned_amount || ''} onChange={e => updateMilestone(m.id, 'planned_amount', parseFloat(e.target.value) || 0)} className="bk-input py-1.5 font-data-mono w-full" placeholder="0" required />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="sm:hidden text-[10px] font-bold text-on-surface-variant mb-1 block">DUE DATE</label>
                      <input type="date" value={m.trigger_condition} onChange={e => updateMilestone(m.id, 'trigger_condition', e.target.value)} className="bk-input py-1.5 w-full" />
                    </div>
                    <div className="sm:col-span-1 flex sm:justify-center">
                      <button type="button" onClick={() => removeMilestone(m.id)} className="p-2 text-error hover:bg-error-container/20 rounded-lg transition-colors">
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  </div>
                ))}

                {/* Balance bar */}
                {(() => {
                  const over = totalMilestones > (orderValue || 0);
                  const under = orderValue > 0 && totalMilestones < orderValue;
                  const balanced = orderValue > 0 && totalMilestones === orderValue;
                  return (
                    <div className={`mt-1 p-4 rounded-xl flex flex-wrap gap-4 items-center justify-between border ${
                      balanced ? 'bg-green-50 border-green-200'
                      : over   ? 'bg-error-container/20 border-error/20'
                      : under  ? 'bg-amber-50 border-amber-200'
                      :          'bg-surface-container border-outline-variant/20'
                    }`}>
                      <div className="flex gap-6">
                        <div>
                          <p className="text-[10px] font-bold text-on-surface-variant">MILESTONE SUM</p>
                          <p className={`font-data-mono font-bold text-body-lg ${balanced ? 'text-green-700' : over ? 'text-error' : under ? 'text-amber-700' : 'text-on-surface'}`}>
                            {fmtVal(totalMilestones)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-on-surface-variant">ORDER VALUE</p>
                          <p className="font-data-mono font-bold text-body-lg text-on-surface">{fmtVal(orderValue)}</p>
                        </div>
                      </div>
                      {over && (
                        <span className="text-body-sm text-error flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[16px]">error</span>
                          Over by {fmtVal(totalMilestones - orderValue)}
                        </span>
                      )}
                      {under && (
                        <span className="text-body-sm text-amber-700 flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[16px]">warning</span>
                          {fmtVal(orderValue - totalMilestones)} unassigned
                        </span>
                      )}
                      {balanced && (
                        <span className="text-body-sm text-green-700 flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[16px]">check_circle</span> Fully assigned
                        </span>
                      )}
                    </div>
                  );
                })()}
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

        {/* ── Right: Live Summary ──────────────────────────── */}
        <aside className="w-full lg:w-80 xl:w-88 shrink-0 lg:sticky lg:top-8">
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-card overflow-hidden">
            <div className="px-5 py-4 bg-surface-container-low border-b border-outline-variant/20 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-primary">preview</span>
              <h3 className="text-label-caps font-label-caps text-on-surface-variant">Order Summary</h3>
            </div>
            <div className="p-5 space-y-4">
              <SummaryRow icon="tag" label="WO ID" value={<span className="font-data-mono text-primary">{woId}</span>} />
              <SummaryRow icon="construction" label="Project" value={selectedProject?.name ?? <span className="text-on-surface-variant italic text-body-sm">Not selected</span>} />
              <SummaryRow icon="person" label="Worker" value={selectedWorker?.name ?? <span className="text-on-surface-variant italic text-body-sm">Not selected</span>} />
              <SummaryRow icon="payments" label="Order Value" value={<span className="font-data-mono font-bold">{fmtVal(orderValue)}</span>} />
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
                  <span className="material-symbols-outlined text-[14px]">playlist_add_check</span> MILESTONES
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  milestones.length > 0 && isBalanced && orderValue > 0
                    ? 'bg-secondary-container text-on-secondary-container'
                    : milestones.length > 0
                      ? 'bg-tertiary-container text-on-tertiary-container'
                      : 'bg-surface-container-high text-on-surface-variant'
                }`}>
                  {milestones.length === 0
                    ? 'None'
                    : `${milestones.length} row${milestones.length > 1 ? 's' : ''} · ${isBalanced && orderValue > 0 ? 'Balanced' : 'Unbalanced'}`}
                </span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* ── Fixed bottom action bar ── */}
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
          disabled={createWO.isPending}
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
