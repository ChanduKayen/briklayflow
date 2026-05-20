import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useSnackbar } from '../components/Snackbar';
import { useUserProfile } from '../App';
import type { Session } from '@supabase/supabase-js';

// ── Types ──────────────────────────────────────────────────────────────────────

interface SKURow {
  id: string;
  sku_id: string;
  category: string;
  sub_category: string;
  dimension: string | null;
  variant: string | null;
  grade: string | null;
  aliases: string[] | null;
  standard_unit: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

interface TrgmResult {
  sku_id: string;
  item_name: string;
  category: string;
  unit: string;
  aliases: string;
  similarity: number;
}

const CATEGORIES = ['All', 'Cement', 'Steel', 'Aggregate', 'Sand', 'Brick', 'Block',
  'Paint', 'Waterproofing', 'Tile', 'Plumbing', 'Electrical', 'Plywood',
  'Hardware', 'Admixture', 'Chemical', 'Glass', 'Doors', 'Windows'];

const UNITS = ['Bags', 'MT', 'kg', 'Nos', 'Rmt', 'Sqft', 'Ltr', 'm³', 'm²', 'Set', 'LS', 'Pair'];

const CATEGORY_COLORS: Record<string, { bg: string; color: string }> = {
  Cement:         { bg: '#fef3c7', color: '#92400e' },
  Steel:          { bg: '#dbeafe', color: '#1e40af' },
  Aggregate:      { bg: '#f3f4f6', color: '#374151' },
  Sand:           { bg: '#fef9c3', color: '#854d0e' },
  Brick:          { bg: '#fee2e2', color: '#991b1b' },
  Block:          { bg: '#fce7f3', color: '#9d174d' },
  Paint:          { bg: '#d1fae5', color: '#065f46' },
  Waterproofing:  { bg: '#e0f2fe', color: '#075985' },
  Tile:           { bg: '#ede9fe', color: '#5b21b6' },
  Plumbing:       { bg: '#ecfdf5', color: '#064e3b' },
  Electrical:     { bg: '#fff7ed', color: '#9a3412' },
  Plywood:        { bg: '#fef3c7', color: '#78350f' },
  Hardware:       { bg: '#f1f5f9', color: '#334155' },
  Admixture:      { bg: '#fdf4ff', color: '#6b21a8' },
  Chemical:       { bg: '#fdf2f8', color: '#831843' },
  Glass:          { bg: '#e0f7fa', color: '#006064' },
  Doors:          { bg: '#e8f5e9', color: '#1b5e20' },
  Windows:        { bg: '#e3f2fd', color: '#0d47a1' },
};



function CategoryBadge({ cat }: { cat: string }) {
  const c = CATEGORY_COLORS[cat] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 99, background: c.bg, color: c.color }}>
      {cat}
    </span>
  );
}

// ── Empty form state ───────────────────────────────────────────────────────────

function emptyForm() {
  return { category: '', sub_category: '', dimension: '', variant: '', grade: '', aliases: '', standard_unit: 'Nos', notes: '' };
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function SKUDirectory({ session }: { session: Session }) {
  const qc = useQueryClient();
  const { show: showSnackbar } = useSnackbar();
  const { data: profile } = useUserProfile(session.user.id);
  const canManage = profile?.role === 'management' || profile?.role === 'principal';

  const [categoryTab, setCategoryTab] = useState('All');
  const [searchQ, setSearchQ]         = useState('');
  const [testQ, setTestQ]             = useState('');
  const [showInactive, setShowInactive] = useState(false);

  // Drawer state
  const [drawerOpen, setDrawerOpen]   = useState(false);
  const [editSku, setEditSku]         = useState<SKURow | null>(null);
  const [form, setForm]               = useState(emptyForm());
  const [saving, setSaving]           = useState(false);

  // Test-match panel
  const testDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [testResults, setTestResults] = useState<TrgmResult[]>([]);
  const [testLoading, setTestLoading] = useState(false);

  // ── Data ──────────────────────────────────────────────────────────────────────

  const { data: skus = [], isLoading } = useQuery({
    queryKey: ['sku_directory', categoryTab, showInactive],
    queryFn: async () => {
      let q = supabase.from('sku_directory').select('*').order('category').order('sub_category');
      if (categoryTab !== 'All') q = q.eq('category', categoryTab);
      if (!showInactive) q = q.eq('is_active', true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as SKURow[];
    },
  });

  // Client-side text filter on top of the DB query
  const filtered = searchQ.trim().length < 2 ? skus : skus.filter(s => {
    const q = searchQ.toLowerCase();
    return (
      s.sku_id.toLowerCase().includes(q) ||
      s.sub_category.toLowerCase().includes(q) ||
      (s.dimension?.toLowerCase().includes(q) ?? false) ||
      (s.variant?.toLowerCase().includes(q) ?? false) ||
      (s.grade?.toLowerCase().includes(q) ?? false) ||
      (s.aliases ?? []).some(a => a.toLowerCase().includes(q))
    );
  });

  // ── trgm test ─────────────────────────────────────────────────────────────────

  function runTrgmTest(q: string) {
    if (testDebounceRef.current) clearTimeout(testDebounceRef.current);
    if (q.trim().length < 2) { setTestResults([]); return; }
    setTestLoading(true);
    testDebounceRef.current = setTimeout(async () => {
      const { data, error } = await supabase.rpc('trgm_match_sku', {
        p_search_term: q.trim(),
        p_limit: 8,
        p_threshold: 0.05,
      } as any);
      setTestLoading(false);
      if (!error) setTestResults((data ?? []) as TrgmResult[]);
    }, 250);
  }

  // ── Toggle active ─────────────────────────────────────────────────────────────

  const toggleActive = useMutation({
    mutationFn: async ({ id, val }: { id: string; val: boolean }) => {
      const { error } = await supabase.from('sku_directory').update({ is_active: val }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sku_directory'] });
    },
    onError: (e: any) => showSnackbar(e.message, { type: 'error' }),
  });

  // ── Save (add / edit) ─────────────────────────────────────────────────────────

  async function handleSave() {
    if (!form.category || !form.sub_category || !form.standard_unit) {
      showSnackbar('Category, sub-category and unit are required', { type: 'error' });
      return;
    }
    setSaving(true);
    try {
      const aliasArr = form.aliases
        .split(',')
        .map(a => a.trim().toLowerCase())
        .filter(Boolean);

      const payload: Record<string, unknown> = {
        category:      form.category,
        sub_category:  form.sub_category,
        dimension:     form.dimension  || null,
        variant:       form.variant    || null,
        grade:         form.grade      || null,
        aliases:       aliasArr.length ? aliasArr : null,
        standard_unit: form.standard_unit,
        notes:         form.notes      || null,
        is_active:     true,
      };

      if (editSku) {
        const { error } = await supabase.from('sku_directory').update(payload).eq('id', editSku.id);
        if (error) throw error;
        showSnackbar('SKU updated');
      } else {
        // Auto-generate sku_id
        const parts = [
          form.category.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8),
          form.sub_category.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/ +/g, '-').slice(0, 12),
          form.dimension   ? form.dimension.toUpperCase().replace(/[^A-Z0-9.]/g, '')  : 'STD',
          form.variant     ? form.variant.toUpperCase().replace(/[^A-Z0-9]/g, '')     : 'STD',
          form.grade       ? form.grade.toUpperCase().replace(/[^A-Z0-9]/g, '')       : 'STD',
        ];
        const skuId = parts.join('-').slice(0, 60);
        const { error } = await supabase.from('sku_directory').insert([{ ...payload, sku_id: skuId }]);
        if (error) throw error;
        showSnackbar(`SKU "${skuId}" added`);
      }

      qc.invalidateQueries({ queryKey: ['sku_directory'] });
      setDrawerOpen(false);
      setEditSku(null);
      setForm(emptyForm());
    } catch (e: any) {
      showSnackbar(e.message, { type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  function openAdd() {
    setEditSku(null);
    setForm(emptyForm());
    setDrawerOpen(true);
  }

  function openEdit(s: SKURow) {
    setEditSku(s);
    setForm({
      category:      s.category,
      sub_category:  s.sub_category,
      dimension:     s.dimension  ?? '',
      variant:       s.variant    ?? '',
      grade:         s.grade      ?? '',
      aliases:       (s.aliases ?? []).join(', '),
      standard_unit: s.standard_unit,
      notes:         s.notes      ?? '',
    });
    setDrawerOpen(true);
  }

  // ── Render ─────────────────────────────────────────────────────────────────────

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6 pb-20">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1">
          <h2 className="text-[22px] font-bold text-on-surface tracking-tight">SKU Directory</h2>
          <p className="text-[12px] text-on-surface-variant/50 mt-0.5">
            {filtered.length} SKU{filtered.length !== 1 ? 's' : ''}
            {!showInactive && ' · active only'}
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-on-surface-variant/60 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
            className="accent-primary"
          />
          Show inactive
        </label>
        {canManage && (
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-on-primary text-[13px] font-semibold hover:bg-primary/90 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            Add SKU
          </button>
        )}
      </div>

      {/* trgm test panel */}
      <div className="mb-5 bg-white rounded-2xl border border-black/[0.06] shadow-sm p-4">
        <p className="text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider mb-2">
          Test Matcher — type anything to see trgm matches
        </p>
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant/30">
              search
            </span>
            <input
              className="bk-input pl-9"
              placeholder="e.g. jelly 20mm, tmt 12mm fe500d, health facet…"
              value={testQ}
              onChange={e => { setTestQ(e.target.value); runTrgmTest(e.target.value); }}
            />
          </div>
          {testLoading && (
            <span className="material-symbols-outlined text-[18px] text-on-surface-variant/30 animate-spin">progress_activity</span>
          )}
        </div>

        {testResults.length > 0 && (
          <div className="mt-3 rounded-xl border border-outline-variant/20 overflow-hidden divide-y divide-outline-variant/[0.08]">
            {testResults.map((r, i) => (
              <div key={r.sku_id} className="flex items-center gap-3 px-3 py-2">
                {i === 0 && (
                  <span className="material-symbols-outlined text-[13px] text-green-600">star</span>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold text-on-surface truncate">{r.item_name}</p>
                  <p className="text-[10px] text-on-surface-variant/40 font-mono">{r.sku_id} · {r.unit}</p>
                  {r.aliases && (
                    <p className="text-[10px] text-on-surface-variant/35 truncate italic">{r.aliases}</p>
                  )}
                </div>
                <CategoryBadge cat={r.category} />
                <span style={{
                  fontSize: 11, padding: '2px 6px', borderRadius: 20, fontWeight: 700,
                  background: r.similarity >= 0.75 ? '#dcfce7' : r.similarity >= 0.5 ? '#dbeafe' : '#fef9c3',
                  color: r.similarity >= 0.75 ? '#16a34a' : r.similarity >= 0.5 ? '#1d4ed8' : '#a16207',
                }}>
                  {Math.round(r.similarity * 100)}%
                </span>
              </div>
            ))}
          </div>
        )}
        {testQ.trim().length >= 2 && testResults.length === 0 && !testLoading && (
          <p className="text-[12px] text-on-surface-variant/40 mt-2 italic">No matches found</p>
        )}
      </div>

      {/* Search + category tabs */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant/30">search</span>
          <input
            className="bk-input pl-9"
            placeholder="Filter by name, SKU ID, or alias…"
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryTab(cat)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
                categoryTab === cat
                  ? 'bg-primary text-on-primary border-primary'
                  : 'border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-low'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <span className="material-symbols-outlined text-[24px] text-on-surface-variant/30 animate-spin">progress_activity</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <span className="material-symbols-outlined text-[40px] text-on-surface-variant/15 mb-3">inventory_2</span>
            <p className="text-[14px] font-semibold text-on-surface-variant/40">No SKUs found</p>
            {searchQ && <p className="text-[12px] text-on-surface-variant/30 mt-1">Try a different search term</p>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest border-b border-outline-variant/15 bg-surface-container-low/30">SKU ID</th>
                  <th className="px-3 py-3 text-left text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest border-b border-outline-variant/15 bg-surface-container-low/30">Category</th>
                  <th className="px-3 py-3 text-left text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest border-b border-outline-variant/15 bg-surface-container-low/30">Item Name</th>
                  <th className="px-3 py-3 text-left text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest border-b border-outline-variant/15 bg-surface-container-low/30">Unit</th>
                  <th className="px-3 py-3 text-left text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest border-b border-outline-variant/15 bg-surface-container-low/30">Aliases</th>
                  {canManage && (
                    <th className="px-3 py-3 text-center text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest border-b border-outline-variant/15 bg-surface-container-low/30">Active</th>
                  )}
                  {canManage && (
                    <th className="px-3 py-3 border-b border-outline-variant/15 bg-surface-container-low/30 w-8"></th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, i) => (
                  <tr
                    key={s.id}
                    className="group hover:bg-surface-container-low/40 transition-colors"
                    style={{ opacity: s.is_active ? 1 : 0.45 }}
                  >
                    <td className={`px-4 py-2.5 border-b border-outline-variant/[0.07] ${i % 2 === 0 ? '' : 'bg-surface-container-low/20'}`}>
                      <span className="font-mono text-[10.5px] text-on-surface-variant/60 leading-tight">{s.sku_id}</span>
                    </td>
                    <td className={`px-3 py-2.5 border-b border-outline-variant/[0.07] ${i % 2 === 0 ? '' : 'bg-surface-container-low/20'}`}>
                      <CategoryBadge cat={s.category} />
                    </td>
                    <td className={`px-3 py-2.5 border-b border-outline-variant/[0.07] ${i % 2 === 0 ? '' : 'bg-surface-container-low/20'} max-w-[260px]`}>
                      <p className="text-[12px] font-semibold text-on-surface">{s.sub_category}</p>
                      {(s.dimension || s.variant || s.grade) && (
                        <p className="text-[10px] text-on-surface-variant/50 mt-0.5">
                          {[s.dimension, s.variant, s.grade].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </td>
                    <td className={`px-3 py-2.5 border-b border-outline-variant/[0.07] ${i % 2 === 0 ? '' : 'bg-surface-container-low/20'}`}>
                      <span className="text-[11px] font-semibold text-on-surface-variant/70">{s.standard_unit}</span>
                    </td>
                    <td className={`px-3 py-2.5 border-b border-outline-variant/[0.07] ${i % 2 === 0 ? '' : 'bg-surface-container-low/20'} max-w-[280px]`}>
                      <div className="flex flex-wrap gap-1">
                        {(s.aliases ?? []).slice(0, 4).map(a => (
                          <span key={a} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: '#f3f4f6', color: '#6b7280', fontFamily: 'monospace' }}>
                            {a}
                          </span>
                        ))}
                        {(s.aliases?.length ?? 0) > 4 && (
                          <span style={{ fontSize: 9, color: '#9ca3af' }}>+{(s.aliases?.length ?? 0) - 4}</span>
                        )}
                      </div>
                    </td>
                    {canManage && (
                      <td className={`px-3 py-2.5 border-b border-outline-variant/[0.07] ${i % 2 === 0 ? '' : 'bg-surface-container-low/20'} text-center`}>
                        <button
                          onClick={() => toggleActive.mutate({ id: s.id, val: !s.is_active })}
                          title={s.is_active ? 'Deactivate' : 'Activate'}
                          className="transition-opacity"
                        >
                          <span className="material-symbols-outlined text-[18px]" style={{
                            color: s.is_active ? '#16a34a' : '#d1d5db',
                            fontVariationSettings: s.is_active ? "'FILL' 1" : "'FILL' 0",
                          }}>
                            toggle_on
                          </span>
                        </button>
                      </td>
                    )}
                    {canManage && (
                      <td className={`px-2 py-2.5 border-b border-outline-variant/[0.07] ${i % 2 === 0 ? '' : 'bg-surface-container-low/20'}`}>
                        <button
                          onClick={() => openEdit(s)}
                          className="p-1 rounded-lg text-on-surface-variant/20 hover:text-primary hover:bg-primary/5 opacity-0 group-hover:opacity-100 transition-all"
                          title="Edit"
                        >
                          <span className="material-symbols-outlined text-[14px]">edit</span>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Add / Edit Drawer ─────────────────────────────────────────────────── */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={() => { setDrawerOpen(false); setEditSku(null); setForm(emptyForm()); }}
          />
          <div className="fixed right-0 top-0 h-full w-full max-w-[420px] bg-white shadow-2xl z-50 flex flex-col overflow-hidden">
            {/* Drawer header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-outline-variant/15">
              <button
                onClick={() => { setDrawerOpen(false); setEditSku(null); setForm(emptyForm()); }}
                className="p-1 rounded-lg text-on-surface-variant/40 hover:text-on-surface transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
              <div>
                <h3 className="text-[15px] font-bold text-on-surface">
                  {editSku ? 'Edit SKU' : 'New SKU'}
                </h3>
                {editSku && (
                  <p className="text-[10px] font-mono text-on-surface-variant/50">{editSku.sku_id}</p>
                )}
              </div>
            </div>

            {/* Drawer body */}
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">

              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">
                  Category <span className="text-red-500">*</span>
                </label>
                <select
                  className="bk-input"
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                >
                  <option value="" disabled>Select category…</option>
                  {CATEGORIES.filter(c => c !== 'All').map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">
                  Sub-Category / Item Name <span className="text-red-500">*</span>
                </label>
                <input
                  className="bk-input"
                  placeholder="e.g. OPC 53 Cement, TMT Bar, M-Sand"
                  value={form.sub_category}
                  onChange={e => setForm(f => ({ ...f, sub_category: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Dimension</label>
                  <input
                    className="bk-input text-[13px]"
                    placeholder="e.g. 12mm"
                    value={form.dimension}
                    onChange={e => setForm(f => ({ ...f, dimension: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Variant</label>
                  <input
                    className="bk-input text-[13px]"
                    placeholder="e.g. Bar"
                    value={form.variant}
                    onChange={e => setForm(f => ({ ...f, variant: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Grade</label>
                  <input
                    className="bk-input text-[13px]"
                    placeholder="e.g. Fe500D"
                    value={form.grade}
                    onChange={e => setForm(f => ({ ...f, grade: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">
                  Standard Unit <span className="text-red-500">*</span>
                </label>
                <select
                  className="bk-input"
                  value={form.standard_unit}
                  onChange={e => setForm(f => ({ ...f, standard_unit: e.target.value }))}
                >
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">
                  Aliases
                  <span className="ml-1 normal-case font-normal text-on-surface-variant/40">(comma-separated, lowercase)</span>
                </label>
                <textarea
                  className="bk-input resize-none text-[12px] font-mono"
                  rows={3}
                  placeholder="jelly, coarse agg, metal, stone chips"
                  value={form.aliases}
                  onChange={e => setForm(f => ({ ...f, aliases: e.target.value }))}
                />
                <p className="text-[10px] text-on-surface-variant/35 mt-1">
                  Add regional trade names and shorthand — these power the trgm matcher.
                </p>
              </div>

              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Notes</label>
                <input
                  className="bk-input text-[13px]"
                  placeholder="Optional internal note"
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>

              {!editSku && (
                <div className="rounded-xl bg-surface-container-low/60 border border-outline-variant/15 px-3 py-2.5">
                  <p className="text-[11px] text-on-surface-variant/60">
                    <span className="font-semibold">SKU ID</span> will be auto-generated as
                    <span className="font-mono ml-1 text-primary/70">
                      {[
                        form.category.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'CAT',
                        form.sub_category.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/ +/g, '-').slice(0, 12) || 'SUBCAT',
                        form.dimension  ? form.dimension.toUpperCase().replace(/[^A-Z0-9.]/g, '')  : 'STD',
                        form.variant    ? form.variant.toUpperCase().replace(/[^A-Z0-9]/g, '')     : 'STD',
                        form.grade      ? form.grade.toUpperCase().replace(/[^A-Z0-9]/g, '')       : 'STD',
                      ].join('-').slice(0, 60)}
                    </span>
                  </p>
                </div>
              )}
            </div>

            {/* Drawer footer */}
            <div className="px-5 py-4 border-t border-outline-variant/15 flex gap-3">
              <button
                onClick={() => { setDrawerOpen(false); setEditSku(null); setForm(emptyForm()); }}
                className="flex-1 py-2.5 rounded-xl border border-outline-variant/30 text-[13px] font-semibold text-on-surface-variant hover:bg-surface-container-low transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.category || !form.sub_category}
                className="flex-1 py-2.5 rounded-xl bg-primary text-on-primary text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {saving ? (
                  <><span className="material-symbols-outlined text-[15px] animate-spin">progress_activity</span> Saving…</>
                ) : (
                  <><span className="material-symbols-outlined text-[15px]">check</span> {editSku ? 'Update SKU' : 'Add SKU'}</>
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
