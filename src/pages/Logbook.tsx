import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { RoughEntry } from '../types';
import { useUserProfile } from '../App';
import { useSnackbar } from '../components/Snackbar';
import { ResolvePopup } from '../components/ResolvePopup';
import { ImageLightbox } from '../components/ImageLightbox';

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtTime(ts: string) {
  const d = new Date(ts);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYest  = new Date(startOfToday.getTime() - 86400000);
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  if (d >= startOfToday) return time;
  if (d >= startOfYest)  return `Yest ${time}`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function isExtracting(entry: RoughEntry) {
  const keys = Object.keys(entry.ai_extracted || {});
  return entry.status === 'PENDING' && keys.length === 0;
}

const SOURCE_META: Record<string, { label: string; cls: string }> = {
  WHATSAPP_TEXT:  { label: 'WhatsApp', cls: 'bg-emerald-100 text-emerald-700' },
  WHATSAPP_IMAGE: { label: 'Image',    cls: 'bg-purple-100 text-purple-700' },
  WHATSAPP_VOICE: { label: 'Voice',    cls: 'bg-orange-100 text-orange-700' },
  UI_TEXT:        { label: 'Manual',   cls: 'bg-surface-container-high text-on-surface-variant' },
  UI_IMAGE:       { label: 'Scan',     cls: 'bg-surface-container-high text-on-surface-variant' },
};

function SkeletonCell({ w = 'w-20' }: { w?: string }) {
  return <span className={`inline-block h-3 rounded animate-pulse bg-surface-container-high ${w}`} />;
}

function rowBorder(entry: RoughEntry) {
  if (entry.status === 'POSTED')    return 'border-l-2 border-l-emerald-400';
  if (entry.status === 'DISMISSED') return '';
  const ai = entry.ai_extracted;
  // New flat fields take precedence
  if (ai.payee_unmatched && !ai.project_id) return 'border-l-2 border-l-red-400';
  if (ai.payee_unmatched || ai.project_unmatched) return 'border-l-2 border-l-amber-400';
  // Fall back to overall confidence (flat or nested)
  const overall = ai.overall_confidence ?? ai.confidence?.overall;
  if (overall === 'MEDIUM') return 'border-l-2 border-l-amber-400';
  if (overall === 'LOW')    return 'border-l-2 border-l-red-400';
  return '';
}

function rowOpacity(entry: RoughEntry) {
  if (entry.status === 'POSTED')    return 'opacity-60';
  if (entry.status === 'DISMISSED') return 'opacity-40';
  return '';
}

// ── Desktop table ──────────────────────────────────────────────────────────────

function DesktopTable({
  entries, tab: _tab, onReview, onLightbox,
}: {
  entries: RoughEntry[];
  tab: 'PENDING' | 'POSTED' | 'DISMISSED';
  onReview: (e: RoughEntry) => void;
  onLightbox: (url: string) => void;
}) {
  return (
    <div className="hidden md:block bg-white rounded-2xl border border-outline-variant/10 shadow-card overflow-x-auto">
      <table className="w-full text-left min-w-[860px]">
        <thead>
          <tr className="border-b border-outline-variant/[0.08] bg-surface-container-lowest/40">
            {['Source', 'Time', 'Original Input', 'Payee', 'Amount', 'Project', 'Description', 'Action'].map(h => (
              <th key={h} className="px-4 py-3 text-[10px] font-semibold text-on-surface-variant/40 uppercase tracking-wide whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const ai  = entry.ai_extracted;
            const skel = isExtracting(entry);
            const sm  = SOURCE_META[entry.source] || SOURCE_META.UI_TEXT;
            return (
              <tr
                key={entry.id}
                className={`border-b border-outline-variant/[0.05] last:border-0 transition-colors hover:bg-surface-container-lowest/30 ${rowBorder(entry)} ${rowOpacity(entry)}`}
                style={{ minHeight: 52 }}
              >
                {/* Source */}
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${sm.cls}`}>{sm.label}</span>
                </td>
                {/* Time */}
                <td className="px-4 py-3 whitespace-nowrap text-[12px] text-on-surface-variant/60">
                  {fmtTime(entry.created_at)}
                </td>
                {/* Original Input */}
                <td className="px-4 py-3 max-w-[180px]">
                  {entry.raw_image_url ? (
                    <button onClick={() => onLightbox(entry.raw_image_url!)}
                      className="w-9 h-9 rounded-lg overflow-hidden border border-outline-variant/20 hover:opacity-80 transition-opacity">
                      <img src={entry.raw_image_url} className="w-full h-full object-cover" />
                    </button>
                  ) : (
                    <span className={`text-[12px] text-on-surface-variant/70 line-clamp-2 ${entry.status === 'POSTED' ? 'line-through decoration-on-surface-variant/30' : ''}`}>
                      {entry.raw_text?.slice(0, 50) || '—'}
                    </span>
                  )}
                </td>
                {/* Payee */}
                <td className="px-4 py-3 whitespace-nowrap">
                  {skel ? <SkeletonCell /> : (ai.payee_name || ai.payee_raw) ? (
                    <div>
                      <span className={`text-[13px] font-medium ${
                        ai.payee_unmatched
                          ? 'italic text-red-600'
                          : (ai.payee_confidence === 'MEDIUM' || ai.confidence?.payee === 'MEDIUM')
                          ? 'italic text-amber-700'
                          : 'text-on-surface'
                      }`}>
                        {ai.payee_name || ai.payee_raw}
                        {ai.payee_unmatched && <span className="material-symbols-outlined text-[12px] ml-0.5 align-middle">warning</span>}
                        {!ai.payee_unmatched && (ai.payee_confidence === 'MEDIUM' || ai.confidence?.payee === 'MEDIUM') && '?'}
                      </span>
                    </div>
                  ) : <span className="text-on-surface-variant/30 text-[13px]">—</span>}
                </td>
                {/* Amount */}
                <td className="px-4 py-3 whitespace-nowrap">
                  {skel ? <SkeletonCell w="w-16" /> : ai.amount != null ? (
                    <span className="text-[13px] font-[500] font-data-mono text-on-surface">
                      ₹{Number(ai.amount).toLocaleString('en-IN')}
                    </span>
                  ) : <span className="text-on-surface-variant/30 text-[13px]">—</span>}
                </td>
                {/* Project */}
                <td className="px-4 py-3 max-w-[140px]">
                  {skel ? <SkeletonCell w="w-24" /> : ai.project_name ? (
                    <span className="text-[12px] text-on-surface truncate block">{ai.project_name}</span>
                  ) : ai.project_unmatched ? (
                    <span className="text-[12px] text-amber-600 italic flex items-center gap-0.5 truncate">
                      <span className="material-symbols-outlined text-[12px] shrink-0">warning</span>
                      {ai.project_raw?.slice(0, 14) || 'Unmatched'}
                    </span>
                  ) : (
                    <span className="text-[12px] text-amber-500 flex items-center gap-0.5">
                      <span className="material-symbols-outlined text-[12px]">warning</span>
                      {entry.source.startsWith('WHATSAPP') ? 'Assign' : '—'}
                    </span>
                  )}
                </td>
                {/* Description */}
                <td className="px-4 py-3 max-w-[180px]">
                  {skel ? <SkeletonCell w="w-28" /> : ai.description ? (
                    <span className="text-[12px] text-on-surface-variant/60 line-clamp-1">{ai.description}</span>
                  ) : <span className="text-on-surface-variant/30 text-[12px]">—</span>}
                </td>
                {/* Action */}
                <td className="px-4 py-3 whitespace-nowrap">
                  {entry.status === 'PENDING' ? (
                    <button
                      onClick={() => onReview(entry)}
                      className="px-3 py-1.5 rounded-lg border border-amber-400/60 text-amber-700 text-[12px] font-semibold hover:bg-amber-50 transition-colors"
                    >
                      Review →
                    </button>
                  ) : entry.status === 'POSTED' && entry.resolved_txn_id ? (
                    <Link to={`/ledger/${entry.resolved_txn_id}`}
                      className="text-[12px] text-on-surface-variant/50 hover:text-primary transition-colors font-data-mono">
                      {entry.resolved_txn_id} →
                    </Link>
                  ) : (
                    <span className="text-[12px] text-on-surface-variant/35 italic">Dismissed</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Mobile card ────────────────────────────────────────────────────────────────

function MobileCards({
  entries, onReview, onLightbox,
}: {
  entries: RoughEntry[];
  onReview: (e: RoughEntry) => void;
  onLightbox: (url: string) => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="md:hidden space-y-2">
      {entries.map((entry) => {
        const ai   = entry.ai_extracted;
        const skel = isExtracting(entry);
        const sm   = SOURCE_META[entry.source] || SOURCE_META.UI_TEXT;
        return (
          <div
            key={entry.id}
            className={`bg-white rounded-xl border border-black/[0.06] p-3 ${rowBorder(entry)} ${rowOpacity(entry)}`}
          >
            {/* Row 1 */}
            <div className="flex items-start justify-between mb-2 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${sm.cls}`}>
                  {sm.label}
                </span>
                <span className="text-[11px] text-on-surface-variant/50 shrink-0">{fmtTime(entry.created_at)}</span>
              </div>
              {skel ? <SkeletonCell w="w-16" /> : ai.amount != null ? (
                <span className="text-[15px] font-bold font-data-mono text-on-surface shrink-0">
                  ₹{Number(ai.amount).toLocaleString('en-IN')}
                </span>
              ) : <span className="text-on-surface-variant/30 text-[13px] shrink-0">₹—</span>}
            </div>

            {/* Row 2: payee + description */}
            <div className="flex items-start gap-2 mb-2">
              {entry.raw_image_url ? (
                <button onClick={() => onLightbox(entry.raw_image_url!)}
                  className="w-9 h-9 rounded-lg overflow-hidden border border-outline-variant/20 shrink-0">
                  <img src={entry.raw_image_url} className="w-full h-full object-cover" />
                </button>
              ) : (
                <p className={`text-[12px] text-on-surface-variant/55 line-clamp-1 flex-1 ${entry.status === 'POSTED' ? 'line-through' : ''}`}>
                  {entry.raw_text?.slice(0, 60) || '—'}
                </p>
              )}
            </div>

            {/* Row 3: payee + project + action */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                {skel ? <SkeletonCell w="w-20" /> : (ai.payee_name || ai.payee_raw) ? (
                  <span className={`text-[13px] font-semibold truncate ${
                    ai.payee_unmatched
                      ? 'italic text-red-600'
                      : (ai.payee_confidence === 'MEDIUM' || ai.confidence?.payee === 'MEDIUM')
                      ? 'italic text-amber-700'
                      : 'text-on-surface'
                  }`}>
                    {ai.payee_name || ai.payee_raw}
                    {ai.payee_unmatched && ' ⚠'}
                    {!ai.payee_unmatched && (ai.payee_confidence === 'MEDIUM' || ai.confidence?.payee === 'MEDIUM') && '?'}
                  </span>
                ) : null}
                {skel ? <SkeletonCell w="w-16" /> : ai.project_name ? (
                  <span className="text-[11px] text-on-surface-variant/50 truncate">{ai.project_name}</span>
                ) : ai.project_unmatched ? (
                  <span className="text-[11px] text-amber-600 italic truncate">⚠ {ai.project_raw?.slice(0, 12) || 'Unmatched'}</span>
                ) : (
                  entry.status === 'PENDING' && <span className="text-[11px] text-amber-500">⚠ No project</span>
                )}
              </div>
              {entry.status === 'PENDING' ? (
                <button
                  onClick={() => onReview(entry)}
                  className="px-3 py-1.5 rounded-lg border border-amber-400/60 text-amber-700 text-[12px] font-semibold shrink-0 hover:bg-amber-50"
                >
                  Review →
                </button>
              ) : entry.status === 'POSTED' && entry.resolved_txn_id ? (
                <button onClick={() => navigate(`/ledger/${entry.resolved_txn_id}`)}
                  className="text-[12px] text-on-surface-variant/50 font-data-mono shrink-0">
                  {entry.resolved_txn_id} →
                </button>
              ) : (
                <span className="text-[12px] text-on-surface-variant/35 italic shrink-0">Dismissed</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Logbook({ session }: { session: Session }) {
  const qc = useQueryClient();
  const { show: showSnackbar } = useSnackbar();
  const { data: profile } = useUserProfile(session.user.id);

  const [activeTab, setActiveTab] = useState<'PENDING' | 'POSTED' | 'DISMISSED'>('PENDING');
  const [resolveEntry, setResolveEntry] = useState<RoughEntry | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['rough_entries'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rough_entries')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as RoughEntry[];
    },
  });

  // ── Realtime subscription ──────────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('logbook_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rough_entries' }, () => {
        qc.invalidateQueries({ queryKey: ['rough_entries'] });
        qc.invalidateQueries({ queryKey: ['inbox_badge'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  // ── Image preview ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!imageFile) { setImagePreviewUrl(null); return; }
    const url = URL.createObjectURL(imageFile);
    setImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  // ── Auto-grow textarea ─────────────────────────────────────────────────────
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 72)}px`;
  }, [inputText]);

  // ── Submit new entry ───────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if ((!inputText.trim() && !imageFile) || isSubmitting) return;
    setIsSubmitting(true);
    try {
      let raw_image_url: string | null = null;
      if (imageFile) {
        const ext = imageFile.name.split('.').pop() || 'jpg';
        const fname = `logbook/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from('documents').upload(fname, imageFile);
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from('documents').getPublicUrl(fname);
        raw_image_url = pub.publicUrl;
      }

      const { data: newEntry, error } = await supabase
        .from('rough_entries')
        .insert({
          source: imageFile ? 'UI_IMAGE' : 'UI_TEXT',
          raw_text: inputText.trim() || null,
          raw_image_url,
          sender_name: profile?.name || session.user.email,
          created_by: session.user.id,
        })
        .select()
        .single();

      if (error) throw error;

      setInputText('');
      setImageFile(null);
      setActiveTab('PENDING');
      qc.invalidateQueries({ queryKey: ['rough_entries'] });
      qc.invalidateQueries({ queryKey: ['inbox_badge'] });

      // Fire AI extraction (async, non-blocking)
      if (newEntry) {
        supabase.functions.invoke('ai-extract-entry', { body: { entry_id: newEntry.id } })
          .then(({ error }) => { if (error) console.error('[ai-extract-entry]', error); })
          .catch((err) => console.error('[ai-extract-entry] invoke failed:', err));
      }
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to save entry', { type: 'error' });
    } finally {
      setIsSubmitting(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const pending   = entries.filter(e => e.status === 'PENDING');
  const posted    = entries.filter(e => e.status === 'POSTED');
  const dismissed = entries.filter(e => e.status === 'DISMISSED');

  const todayPostedCount = posted.filter(e => {
    const d = new Date(e.created_at);
    const t = new Date();
    return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  }).length;

  const activeEntries =
    activeTab === 'PENDING'   ? pending :
    activeTab === 'POSTED'    ? posted  : dismissed;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6 inbox-content-pb">

      {/* Header */}
      <div className="mb-stack-lg">
        <h2 className="text-headline-lg-mobile md:text-headline-lg font-headline-lg text-on-background">
          Rough Entries
        </h2>
        <p className="text-body-sm text-on-surface-variant mt-1">
          {pending.length} pending entries · {todayPostedCount} posted today
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-surface-container-low rounded-xl p-1">
        {([
          { key: 'PENDING',   label: `Pending${pending.length > 0 ? ` ${pending.length}` : ''}` },
          { key: 'POSTED',    label: 'Posted' },
          { key: 'DISMISSED', label: 'Dismissed' },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex-1 py-2 rounded-lg text-[13px] font-semibold transition-colors ${
              activeTab === key
                ? 'bg-white text-on-surface shadow-sm'
                : 'text-on-surface-variant/55 hover:text-on-surface'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-secondary" size={32} />
        </div>
      ) : activeEntries.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <span className="material-symbols-outlined text-[48px] text-on-surface-variant/15 block mb-3">inbox</span>
          <p className="text-body-sm text-on-surface-variant/40">
            {activeTab === 'PENDING'   ? 'No pending entries' :
             activeTab === 'POSTED'    ? 'No posted entries'  : 'No dismissed entries'}
          </p>
          {activeTab === 'PENDING' && (
            <p className="text-[12px] text-on-surface-variant/30 mt-1">
              Type something below to add your first rough entry
            </p>
          )}
        </div>
      ) : (
        <>
          <DesktopTable entries={activeEntries} tab={activeTab} onReview={setResolveEntry} onLightbox={setLightboxUrl} />
          <MobileCards  entries={activeEntries} onReview={setResolveEntry} onLightbox={setLightboxUrl} />
        </>
      )}

      {/* ── Direct Entry Bar ──────────────────────────────────────────────── */}
      <div className="entry-bar fixed left-0 right-0 z-[35] bg-white border-t border-black/[0.06] shadow-[0_-2px_8px_rgba(0,0,0,0.04)] md:left-[220px]"
           style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>

        {/* Image preview strip */}
        {imagePreviewUrl && (
          <div className="px-3 pt-2 flex items-center gap-2 border-b border-black/[0.04]">
            <img src={imagePreviewUrl} className="w-12 h-12 rounded-lg object-cover border border-outline-variant/20" />
            <span className="text-[12px] text-on-surface-variant/60 flex-1 truncate">{imageFile?.name}</span>
            <button onClick={() => setImageFile(null)}
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-surface-container text-on-surface-variant/50">
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        )}

        {/* Input row */}
        <div className="flex items-end gap-2 px-3 py-2" style={{ minHeight: 56 }}>
          {/* Camera button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-on-surface-variant/50 hover:bg-surface-container hover:text-on-surface-variant transition-colors shrink-0"
            title="Attach image"
          >
            <span className="material-symbols-outlined text-[20px]">photo_camera</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) { setImageFile(f); e.target.value = ''; }
            }}
          />

          {/* Text input */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
            }}
            placeholder="What was paid, to whom, how much… (e.g. ramu 5k cash plastering)"
            className="flex-1 resize-none bg-surface-container-lowest border border-outline-variant/25 rounded-xl px-3 py-2.5 text-[15px] text-on-surface placeholder:text-on-surface-variant/35 outline-none focus:border-outline-variant/50 transition-colors leading-snug"
            style={{ minHeight: 40, maxHeight: 80 }}
          />

          {/* Send button */}
          <button
            onClick={handleSubmit}
            disabled={(!inputText.trim() && !imageFile) || isSubmitting}
            className={`w-9 h-9 flex items-center justify-center rounded-xl shrink-0 transition-all ${
              (inputText.trim() || imageFile) && !isSubmitting
                ? 'bg-[#C45B39] text-white shadow-sm hover:opacity-90'
                : 'bg-surface-container-high text-on-surface-variant/25 cursor-not-allowed'
            }`}
            title="Send (Enter)"
          >
            {isSubmitting
              ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              : <span className="material-symbols-outlined text-[18px]">send</span>
            }
          </button>
        </div>
      </div>

      {/* ── Resolve Popup ─────────────────────────────────────────────────── */}
      {resolveEntry && (
        <ResolvePopup
          entry={resolveEntry}
          session={session}
          onClose={() => setResolveEntry(null)}
          onUpdated={(updated) => {
            qc.invalidateQueries({ queryKey: ['rough_entries'] });
            qc.invalidateQueries({ queryKey: ['inbox_badge'] });
            if (updated.status !== 'PENDING') setResolveEntry(null);
          }}
        />
      )}

      {/* ── Image Lightbox ────────────────────────────────────────────────── */}
      <ImageLightbox url={lightboxUrl} title="Image" onClose={() => setLightboxUrl(null)} />
    </div>
  );
}
