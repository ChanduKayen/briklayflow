import { useState, useEffect, useRef } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { usePeek } from '../context/PeekContext';
import type { RoughEntry } from '../types';
import { useUserProfile } from '../App';
import { useSnackbar } from '../components/Snackbar';
import ShortcutTicker from '../components/ShortcutTicker';

const LOGBOOK_HINTS = [
  { key: 'L',     label: 'jump straight to logbook' },
  { key: '/',     label: 'new entry — pick type after' },
  { key: 'Space', label: 'open quick actions' },
]
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
  if (d >= startOfYest)  return 'Yest';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function isExtracting(entry: RoughEntry) {
  return entry.status === 'PENDING' && Object.keys(entry.ai_extracted || {}).length === 0;
}

function SkeletonCell({ w = 'w-20' }: { w?: string }) {
  return <span className={`inline-block h-3 rounded animate-pulse bg-black/[0.07] ${w}`} />;
}

// ── Source icon ────────────────────────────────────────────────────────────────

function SourceIcon({ source }: { source: string }) {
  if (source === 'WHATSAPP_TEXT')
    return <span className="material-symbols-outlined" style={{ fontSize: 14, color: 'rgba(37,211,102,0.65)' }}>chat</span>;
  if (source === 'WHATSAPP_IMAGE')
    return <span className="material-symbols-outlined" style={{ fontSize: 14, color: 'rgba(130,80,200,0.65)' }}>image</span>;
  if (source === 'WHATSAPP_VOICE')
    return <span className="material-symbols-outlined" style={{ fontSize: 14, color: 'rgba(245,158,11,0.75)' }}>mic</span>;
  if (source === 'UI_IMAGE')
    return <span className="material-symbols-outlined" style={{ fontSize: 14, color: 'rgba(100,116,139,0.65)' }}>photo_camera</span>;
  return <span className="material-symbols-outlined" style={{ fontSize: 14, color: 'rgba(100,116,139,0.65)' }}>edit</span>;
}

// ── Status dot ─────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  if (status === 'PENDING')
    return <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />;
  if (status === 'AWAITING')
    return <span className="animate-pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: '#94a3b8', display: 'inline-block' }} />;
  if (status === 'POSTED')
    return <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />;
  return null;
}

function rowOpacity(entry: RoughEntry) {
  if (entry.status === 'POSTED')    return 0.6;
  if (entry.status === 'DISMISSED') return 0.4;
  return 1;
}

// ── Desktop table ──────────────────────────────────────────────────────────────

function DesktopTable({
  entries, onReview, onLightbox,
}: {
  entries: RoughEntry[];
  onReview: (e: RoughEntry) => void;
  onLightbox: (url: string) => void;
}) {
  const { openPeek } = usePeek();
  return (
    <div className="hidden md:block bg-white rounded-xl border border-black/[0.06] overflow-x-auto">
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            {['', 'Time', 'Entry', 'Payee', 'Amount', '·', 'Action'].map((h, i) => (
              <th key={i} style={{
                padding: '10px 14px', fontSize: 10, textTransform: 'uppercase',
                letterSpacing: '0.06em', color: 'rgba(0,0,0,0.4)', fontWeight: 600,
                textAlign: h === 'Amount' ? 'right' : 'left', whiteSpace: 'nowrap',
                width: h === '' ? 36 : h === 'Time' ? 52 : h === '·' ? 20 : h === 'Action' ? 90 : undefined,
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, idx) => {
            const ai   = entry.ai_extracted;
            const skel = isExtracting(entry);
            return (
              <tr
                key={entry.id}
                style={{
                  opacity: rowOpacity(entry),
                  borderBottom: idx < entries.length - 1 ? '1px solid rgba(0,0,0,0.04)' : 'none',
                  minHeight: 52,
                }}
              >
                {/* Source icon */}
                <td style={{ padding: '0 14px', textAlign: 'center', width: 36 }}>
                  <SourceIcon source={entry.source} />
                </td>
                {/* Time */}
                <td style={{ padding: '0 14px', fontSize: 12, color: 'rgba(0,0,0,0.45)', whiteSpace: 'nowrap', width: 52 }}>
                  {fmtTime(entry.created_at)}
                </td>
                {/* Entry */}
                <td style={{ padding: '12px 14px', maxWidth: 200 }}>
                  {entry.raw_image_url ? (
                    <button onClick={() => onLightbox(entry.raw_image_url!)}
                      style={{ width: 32, height: 32, borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.1)', display: 'block' }}>
                      <img src={entry.raw_image_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </button>
                  ) : (
                    <span style={{
                      fontSize: 13, color: 'rgba(0,0,0,0.55)', fontStyle: 'italic',
                      display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180,
                      textDecoration: entry.status === 'POSTED' ? 'line-through' : 'none',
                    }}>
                      {entry.raw_text?.slice(0, 36) || '—'}
                    </span>
                  )}
                </td>
                {/* Payee */}
                <td style={{ padding: '0 14px', whiteSpace: 'nowrap' }}>
                  {skel ? <SkeletonCell /> : (ai.payee_name || ai.payee_raw) ? (
                    <span style={{
                      fontSize: 14, fontWeight: 400,
                      color: ai.payee_unmatched ? '#d97706'
                        : (ai.payee_confidence === 'MEDIUM' || ai.confidence?.payee === 'MEDIUM') ? '#d97706'
                        : '#0b1c30',
                      fontStyle: (ai.payee_unmatched || ai.payee_confidence === 'MEDIUM') ? 'italic' : 'normal',
                    }}>
                      {ai.payee_name || ai.payee_raw}
                      {ai.payee_unmatched && '?'}
                    </span>
                  ) : <span style={{ color: 'rgba(0,0,0,0.25)', fontSize: 14 }}>—</span>}
                </td>
                {/* Amount */}
                <td style={{ padding: '0 14px', textAlign: 'right' }}>
                  {skel ? <SkeletonCell w="w-14" /> : ai.amount != null ? (
                    <span style={{ fontSize: 14, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: '#0b1c30', fontFamily: 'Geist, monospace' }}>
                      ₹{Number(ai.amount).toLocaleString('en-IN')}
                    </span>
                  ) : <span style={{ color: 'rgba(0,0,0,0.25)', fontSize: 14 }}>—</span>}
                </td>
                {/* Status dot */}
                <td style={{ padding: '0 14px', textAlign: 'center', width: 20 }}>
                  <StatusDot status={entry.status} />
                </td>
                {/* Action */}
                <td style={{ padding: '0 14px', whiteSpace: 'nowrap' }}>
                  {entry.status === 'PENDING' ? (
                    <button
                      onClick={() => onReview(entry)}
                      style={{ fontSize: 11, color: '#C8603A', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 500 }}
                      onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
                      onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
                    >
                      Review
                    </button>
                  ) : entry.status === 'POSTED' && entry.resolved_txn_id ? (
                    <button
                      onClick={() => openPeek('TRANSACTION', entry.resolved_txn_id!)}
                      style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'Geist, monospace' }}
                    >
                      View payment →
                    </button>
                  ) : (
                    <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.3)', fontStyle: 'italic' }}>
                      {entry.status === 'DISMISSED' ? 'Dismissed' : 'Waiting…'}
                    </span>
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

// ── Mobile cards ───────────────────────────────────────────────────────────────

function MobileCards({
  entries, onReview, onLightbox,
}: {
  entries: RoughEntry[];
  onReview: (e: RoughEntry) => void;
  onLightbox: (url: string) => void;
}) {
  const { openPeek } = usePeek();
  return (
    <div className="md:hidden space-y-2">
      {entries.map((entry) => {
        const ai   = entry.ai_extracted;
        const skel = isExtracting(entry);
        return (
          <div key={entry.id} style={{
            background: 'white', borderRadius: 10,
            border: '1px solid rgba(0,0,0,0.06)', padding: 12,
            opacity: rowOpacity(entry),
          }}>
            {/* Row 1: source + time + amount */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <SourceIcon source={entry.source} />
                <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>{fmtTime(entry.created_at)}</span>
              </div>
              {skel ? <SkeletonCell w="w-14" /> : ai.amount != null ? (
                <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'Geist, monospace', color: '#0b1c30' }}>
                  ₹{Number(ai.amount).toLocaleString('en-IN')}
                </span>
              ) : <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.3)' }}>₹—</span>}
            </div>

            {/* Row 2: entry text / image */}
            {entry.raw_image_url ? (
              <button onClick={() => onLightbox(entry.raw_image_url!)}
                style={{ width: 36, height: 36, borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.1)', display: 'block', marginBottom: 8 }}>
                <img src={entry.raw_image_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </button>
            ) : entry.raw_text ? (
              <p style={{
                fontSize: 12, color: 'rgba(0,0,0,0.5)', fontStyle: 'italic', margin: '0 0 8px',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                textDecoration: entry.status === 'POSTED' ? 'line-through' : 'none',
              }}>
                {entry.raw_text.slice(0, 60)}
              </p>
            ) : null}

            {/* Row 3: payee + status + action */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                <StatusDot status={entry.status} />
                {skel ? <SkeletonCell w="w-20" /> : (ai.payee_name || ai.payee_raw) ? (
                  <span style={{
                    fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    color: ai.payee_unmatched ? '#d97706' : '#0b1c30',
                    fontStyle: ai.payee_unmatched ? 'italic' : 'normal',
                  }}>
                    {ai.payee_name || ai.payee_raw}{ai.payee_unmatched ? '?' : ''}
                  </span>
                ) : null}
              </div>
              {entry.status === 'PENDING' ? (
                <button onClick={() => onReview(entry)}
                  style={{ fontSize: 11, color: '#C8603A', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, fontWeight: 500 }}>
                  Review
                </button>
              ) : entry.status === 'POSTED' && entry.resolved_txn_id ? (
                <button onClick={() => openPeek('TRANSACTION', entry.resolved_txn_id!)}
                  style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, fontFamily: 'Geist, monospace' }}>
                  {entry.resolved_txn_id} →
                </button>
              ) : (
                <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.3)', fontStyle: 'italic', flexShrink: 0 }}>
                  {entry.status === 'DISMISSED' ? 'Dismissed' : 'Waiting…'}
                </span>
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

  useEffect(() => {
    const handler = () => textareaRef.current?.focus();
    window.addEventListener('shortcut:focus-logbook', handler);
    return () => window.removeEventListener('shortcut:focus-logbook', handler);
  }, []);

  // ── Realtime ───────────────────────────────────────────────────────────────
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

  // ── Submit ─────────────────────────────────────────────────────────────────
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
      if (newEntry) {
        supabase.functions.invoke('ai-extract-entry', { body: { entry_id: newEntry.id } })
          .then(({ error }) => { if (error) console.error('[ai-extract-entry]', error); })
          .catch(err => console.error('[ai-extract-entry] invoke failed:', err));
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
    const d = new Date(e.created_at), t = new Date();
    return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  }).length;

  const activeEntries = activeTab === 'PENDING' ? pending : activeTab === 'POSTED' ? posted : dismissed;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6 inbox-content-pb">

      {/* HEADER */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#0b1c30', margin: 0, fontFamily: 'Manrope, sans-serif' }}>
          Logbook
        </h1>
        <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', margin: '3px 0 0' }}>
          {pending.length} pending · {todayPostedCount} posted today
        </p>
        <ShortcutTicker hints={LOGBOOK_HINTS} className="mt-1.5" />
      </div>

      {/* TABS — underline style */}
      <div style={{ display: 'flex', gap: 24, borderBottom: '1px solid rgba(0,0,0,0.08)', marginBottom: 20 }}>
        {([
          { key: 'PENDING',   label: 'Pending',   count: pending.length   },
          { key: 'POSTED',    label: 'Posted',    count: null             },
          { key: 'DISMISSED', label: 'Dismissed', count: null             },
        ] as const).map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            style={{
              padding: '0 0 12px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 14, fontWeight: activeTab === key ? 500 : 400,
              color: activeTab === key ? '#0b1c30' : 'rgba(0,0,0,0.45)',
              borderBottom: activeTab === key ? '2px solid #C8603A' : '2px solid transparent',
              marginBottom: -1, transition: 'color 0.15s',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {label}
            {count !== null && count > 0 && (
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>({count})</span>
            )}
          </button>
        ))}
      </div>

      {/* CONTENT */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-secondary" size={32} />
        </div>
      ) : activeEntries.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 0', textAlign: 'center' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 40, color: 'rgba(0,0,0,0.1)', display: 'block', marginBottom: 12 }}>inbox</span>
          <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.35)', margin: 0 }}>
            {activeTab === 'PENDING'   ? 'No pending entries'  :
             activeTab === 'POSTED'    ? 'No posted entries'   : 'No dismissed entries'}
          </p>
          {activeTab === 'PENDING' && (
            <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.25)', margin: '4px 0 0' }}>Type something below to add your first entry</p>
          )}
        </div>
      ) : (
        <>
          <DesktopTable entries={activeEntries} onReview={setResolveEntry} onLightbox={setLightboxUrl} />
          <MobileCards  entries={activeEntries} onReview={setResolveEntry} onLightbox={setLightboxUrl} />
        </>
      )}

      {/* ENTRY BAR */}
      <div
        className="entry-bar fixed left-0 right-0 z-[35] md:left-[220px]"
        style={{
          background: 'white', borderTop: '1px solid rgba(0,0,0,0.06)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {/* Image preview */}
        {imagePreviewUrl && (
          <div style={{ padding: '8px 12px 0', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <img src={imagePreviewUrl} style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', border: '1px solid rgba(0,0,0,0.08)' }} />
            <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {imageFile?.name}
            </span>
            <button onClick={() => setImageFile(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(0,0,0,0.4)', padding: 4 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
            </button>
          </div>
        )}

        {/* Input row */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '10px 12px', minHeight: 52 }}>
          {/* Camera button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Attach image"
            style={{
              width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0,
              color: 'rgba(0,0,0,0.4)', borderRadius: 8,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>photo_camera</span>
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { setImageFile(f); e.target.value = ''; } }} />

          {/* Text input — borderless */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
            placeholder="What was paid, to whom, how much…"
            style={{
              flex: 1, resize: 'none', background: 'transparent', border: 'none', outline: 'none',
              fontSize: 14, color: '#0b1c30', lineHeight: 1.5, minHeight: 36, maxHeight: 80,
              padding: '8px 0',
            }}
          />

          {/* Send button */}
          <button
            onClick={handleSubmit}
            disabled={(!inputText.trim() && !imageFile) || isSubmitting}
            style={{
              width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 8, flexShrink: 0, border: 'none', cursor: (inputText.trim() || imageFile) && !isSubmitting ? 'pointer' : 'default',
              background: (inputText.trim() || imageFile) && !isSubmitting ? '#C8603A' : 'rgba(0,0,0,0.06)',
              color: (inputText.trim() || imageFile) && !isSubmitting ? 'white' : 'rgba(0,0,0,0.25)',
              transition: 'background 0.15s',
            }}
            title="Send (Enter)"
          >
            {isSubmitting
              ? <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
              : <span className="material-symbols-outlined" style={{ fontSize: 18 }}>send</span>}
          </button>
        </div>
      </div>

      {/* Resolve Popup */}
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

      {/* Lightbox */}
      <ImageLightbox url={lightboxUrl} title="Image" onClose={() => setLightboxUrl(null)} />
    </div>
  );
}
