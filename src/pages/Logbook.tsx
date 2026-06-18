/**
 * Day Book — the review gate. Captured -> reviewed -> filed.
 *
 * Everything the site sends to Briklay on WhatsApp lands here; the owner checks
 * each reading and files it into the books. This page is presentation over the
 * existing capture layer: it keeps the rough_entries query, realtime, the
 * ResolvePopup (now the "Fix" path), org id and profile/role — and renders the
 * reference design via src/components/day-book/*.
 *
 * The reference is a pure review gate, so the old manual composer is gone; the
 * UI_TEXT/UI_IMAGE capture path still exists at the data layer for later re-use.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { RoughEntry } from '../types';
import { useUserProfile } from '../App';
import { useOrgId } from '../lib/auth/AuthProvider';
import { useSnackbar } from '../components/Snackbar';
import { ResolvePopup } from '../components/ResolvePopup';
import { ImageLightbox } from '../components/ImageLightbox';
import { PageSkeleton } from '../components/SkeletonLoader';
import { V, font, serif, nums, T } from '../components/day-book/tokens';
import { ANIM, hasRevealed, markRevealed } from '../components/day-book/motion';
import { prefersReducedMotion } from '../components/day-book/useSwipeTriage';
import { WhatsAppGlyph } from '../components/day-book/atoms';
import { Invitation, ManageTeam } from '../components/day-book/Invitation';
import { StartOnWhatsAppButton } from '../components/day-book/StartOnWhatsApp';
import { ReviewCard, type StakeholderLite, type ProjectLite } from '../components/day-book/ReviewCard';

type TabKey = 'review' | 'filed' | 'rejected';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'review',   label: 'To review' },
  { key: 'filed',    label: 'Filed' },
  { key: 'rejected', label: 'Not a transaction' },
];

const STEPS = [
  { n: '1', t: 'Send it on WhatsApp', s: 'a payment, a bill photo, a voice note' },
  { n: '2', t: 'It lands here', s: 'recorded as it comes, on its own' },
  { n: '3', t: 'Review and file', s: 'file it, and it appears in your ledger' },
];

export default function Logbook({ session }: { session: Session }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const orgId = useOrgId();
  const { show: showSnackbar } = useSnackbar();
  const { data: profile } = useUserProfile(session.user.id);

  const canManage = profile?.role === 'management' || profile?.role === 'principal' || profile?.role === 'accountant';

  const [tab, setTab] = useState<TabKey>('review');
  const [fixEntry, setFixEntry] = useState<RoughEntry | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);

  // ── Data (unchanged hooks) ───────────────────────────────────────────────
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

  // Deep-link focus: the WhatsApp confirmation links to /logbook?entry=<id>. The card
  // only exists in the DOM when its tab is active, so we (1) switch to the tab that holds
  // the entry — it may already be filed/dismissed, not just "to review" — then (2) scroll
  // it into view once it has rendered. The ring highlight is applied at render below.
  const focusId = useMemo(() => new URLSearchParams(window.location.search).get('entry'), []);

  // 1) Once entries load, select the tab the focused entry lives in.
  useEffect(() => {
    if (!focusId || isLoading) return;
    const e = entries.find((x) => x.id === focusId);
    if (!e) return;
    setTab(e.status === 'POSTED' ? 'filed' : e.status === 'DISMISSED' ? 'rejected' : 'review');
  }, [focusId, isLoading, entries]);

  // 2) After the correct tab has rendered the card, scroll to it — once.
  const didFocus = useRef(false);
  useEffect(() => {
    if (!focusId || isLoading || didFocus.current) return;
    const el = document.getElementById(`db-entry-${focusId}`);
    if (!el) return;
    didFocus.current = true;
    requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [focusId, isLoading, tab, entries]);

  // Lists that power the inline gap editors (match payee / pick project).
  const { data: stakeholders = [] } = useQuery({
    queryKey: ['daybook_stakeholders'],
    queryFn: async (): Promise<StakeholderLite[]> => {
      const { data, error } = await supabase.from('stakeholders').select('stakeholder_id, name, type, category').order('name');
      if (error) throw error;
      return (data ?? []) as StakeholderLite[];
    },
  });
  const { data: projects = [] } = useQuery({
    queryKey: ['daybook_projects'],
    queryFn: async (): Promise<ProjectLite[]> => {
      const { data, error } = await supabase.from('projects').select('project_id, name').eq('status', 'Active').order('name');
      if (error) throw error;
      return (data ?? []) as ProjectLite[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel('daybook_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rough_entries' }, () => {
        qc.invalidateQueries({ queryKey: ['rough_entries'] });
        qc.invalidateQueries({ queryKey: ['inbox_badge'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  // Just-filed / just-rejected entries: kept in the review list so their in-card
  // confirmation strip (Filed · View / Moved to bin · Undo) survives the realtime
  // refetch, which flips them POSTED/DISMISSED and would otherwise yank the card.
  const [lingering, setLingering] = useState<Set<string>>(new Set());

  // ── Buckets ──────────────────────────────────────────────────────────────
  // AWAITING_CONTEXT is pending-but-incomplete -> shows under "To review".
  // Filed / binned tabs sort by WHEN they were filed/binned (updated_at), latest first —
  // not by message arrival. Falls back to created_at until the column is populated.
  const byRecent = (a: RoughEntry, b: RoughEntry) =>
    +new Date(b.updated_at || b.created_at) - +new Date(a.updated_at || a.created_at);
  const review   = useMemo(() => entries.filter(e => e.status === 'PENDING' || e.status === 'AWAITING_CONTEXT' || lingering.has(e.id)), [entries, lingering]);
  const filed     = useMemo(() => entries.filter(e => e.status === 'POSTED').sort(byRecent), [entries]);
  const rejected  = useMemo(() => entries.filter(e => e.status === 'DISMISSED').sort(byRecent), [entries]);
  const shown = tab === 'review' ? review : tab === 'filed' ? filed : rejected;

  const counts: Record<TabKey, number> = { review: review.length, filed: filed.length, rejected: rejected.length };

  // ── One-time reveal: first time the owner opens a Day Book with work to do ──
  const [reveal, setReveal] = useState(false);
  useEffect(() => {
    if (hasRevealed() || prefersReducedMotion()) return;
    if (review.length === 0) return;
    setReveal(true);
    markRevealed();
    const t = setTimeout(() => setReveal(false), 3600);
    return () => clearTimeout(t);
  }, [review.length]);

  const handleFiled = (entryId: string) => {
    setLingering((s) => new Set(s).add(entryId));
    qc.invalidateQueries({ queryKey: ['rough_entries'] });   // refetch -> POSTED, but lingering keeps it shown
    qc.invalidateQueries({ queryKey: ['inbox_badge'] });
    qc.invalidateQueries({ queryKey: ['ledger'] });
    qc.invalidateQueries({ queryKey: ['dashboard_metrics'] });
  };
  const handleRejected = (entryId: string) => {
    setLingering((s) => new Set(s).add(entryId));   // refetch -> DISMISSED, lingering keeps the undo strip in place
    qc.invalidateQueries({ queryKey: ['rough_entries'] });
    qc.invalidateQueries({ queryKey: ['inbox_badge'] });
  };
  const dismiss = (entryId: string) => {
    setLingering((s) => { const n = new Set(s); n.delete(entryId); return n; });
  };
  const restore = (entryId: string) => {
    setLingering((s) => { const n = new Set(s); n.delete(entryId); return n; });
    qc.invalidateQueries({ queryKey: ['rough_entries'] });
    qc.invalidateQueries({ queryKey: ['inbox_badge'] });
  };
  const viewTxn = (txnId: string) => navigate(`/ledger?txn=${encodeURIComponent(txnId)}`);
  const invalidateEntries = () => {
    qc.invalidateQueries({ queryKey: ['rough_entries'] });
    qc.invalidateQueries({ queryKey: ['inbox_badge'] });
  };

  return (
    <div className="db-scope min-h-screen" style={{ background: V.page, ...font }}>
      <style>{ANIM}</style>

      {/* full-bleed invitation */}
      <Invitation canManage={canManage} />

      <div className="mx-auto py-6 sm:py-8" style={{ width: '92%', maxWidth: 1100 }}>
        <h1 style={{ color: V.ink, ...serif, ...T.h1 }}>Day book</h1>
        <p className="mt-2 leading-relaxed flex flex-wrap items-center gap-x-1.5" style={{ color: V.sys, ...font, ...T.body }}>
          Everything you and your team sent to Briklay on
          <span className="inline-flex items-center gap-1 font-medium" style={{ color: V.inkSoft }}>
            <WhatsAppGlyph size={13} color="#1FA855" /> WhatsApp
          </span>
          lands here. Check each one, and it files into your books.
        </p>

        {/* three steps — side by side wide, stacked narrow */}
        <div className="mt-4 grid gap-3 sm:gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}>
          {STEPS.map((step) => (
            <div key={step.n} className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: V.line, color: V.sys, border: `1px solid ${V.line}`, fontWeight: 500, ...font, ...nums, ...T.xs }}>{step.n}</span>
              <span>
                <span className="block leading-snug" style={{ color: V.inkSoft, ...font, ...T.sm }}>{step.t}</span>
                <span className="block leading-snug mt-0.5" style={{ color: V.faint, ...font, ...T.xs }}>{step.s}</span>
              </span>
            </div>
          ))}
        </div>

        {/* tabs */}
        <div className="flex items-center gap-1 mt-8 overflow-x-auto" style={{ borderBottom: `1px solid ${V.line}` }}>
          {TABS.map((t) => {
            const on = tab === t.key;
            const c = counts[t.key];
            return (
              <button key={t.key} onClick={() => setTab(t.key)} className="relative shrink-0 px-3 sm:px-4 py-3 whitespace-nowrap" style={{ ...font, ...T.sm, color: on ? V.terraDeep : V.sys, fontWeight: on ? 500 : 400 }}>
                {t.label}
                {c > 0 && <span className="ml-1.5" style={{ color: on ? V.terra : V.faint, ...nums }}>{c}</span>}
                {on && <span className="absolute left-2 right-2 bottom-0 rounded-full" style={{ height: 2, background: V.terra }} />}
              </button>
            );
          })}
        </div>

        {/* queue / archives */}
        {isLoading ? (
          <div className="mt-6"><PageSkeleton /></div>
        ) : (
          <div className="space-y-4 mt-6">
            {shown.length === 0 && (
              tab === 'review' ? (
                entries.length === 0 ? (
                  // never used yet — show a lay builder, in plain words, how it works
                  <div className="text-center py-12 mx-auto" style={{ maxWidth: 420 }}>
                    <span className="inline-flex items-center justify-center w-12 h-12 rounded-full" style={{ background: V.field }}>
                      <WhatsAppGlyph size={20} color="#1FA855" />
                    </span>
                    <p className="mt-4" style={{ color: V.ink, ...serif, fontSize: '1.15rem' }}>Nothing to review yet</p>
                    <p className="text-sm mt-2 leading-relaxed" style={{ color: V.sys, ...font }}>
                      Send your payments and bills to Briklay on WhatsApp. A photo or a few words is enough.
                      They wait here for you to check, and go into your books whenever you get a minute.
                    </p>
                    <div className="mt-5 flex flex-col items-center gap-2.5">
                      <StartOnWhatsAppButton size="sm" tone="solid" />
                      {canManage && (
                        <button onClick={() => setTeamOpen(true)} className="text-xs" style={{ color: V.faint, ...font }}>
                          or add who can send →
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-center py-12" style={{ color: V.faint, ...font, ...T.sm }}>All caught up. Your books match your site.</p>
                )
              ) : (
                <p className="text-center py-12" style={{ color: V.faint, ...font, ...T.sm }}>
                  {tab === 'filed' ? 'Nothing filed yet.' : 'Nothing here. Everything was a real transaction.'}
                </p>
              )
            )}
            {shown.map((r, idx) => (
              <div
                key={r.id}
                id={`db-entry-${r.id}`}
                style={focusId === r.id ? { borderRadius: 18, boxShadow: '0 0 0 2px #C8603A', transition: 'box-shadow .3s' } : undefined}
              >
              <ReviewCard
                entry={r}
                orgId={orgId}
                canManage={canManage}
                stakeholders={stakeholders}
                projects={projects}
                reveal={tab === 'review' && idx === 0 && reveal}
                onFiled={() => handleFiled(r.id)}
                onView={viewTxn}
                onDismiss={() => dismiss(r.id)}
                onRejected={() => handleRejected(r.id)}
                onRestore={() => restore(r.id)}
                onFix={() => setFixEntry(r)}
                onLightbox={setLightboxUrl}
                onError={(m) => showSnackbar(m, { type: 'error' })}
              />
              </div>
            ))}
          </div>
        )}

        {tab === 'review' && shown.length > 0 && canManage && (
          <p className="text-center mt-10" style={{ color: V.faint, ...font, ...T.xs }}>
            Swipe right to file, left if it is not a transaction. Or use the buttons.
          </p>
        )}
      </div>

      {/* Fix — the full editor (existing ResolvePopup) */}
      {fixEntry && (
        <ResolvePopup
          entry={fixEntry}
          session={session}
          onClose={() => setFixEntry(null)}
          onUpdated={(updated) => {
            invalidateEntries();
            qc.invalidateQueries({ queryKey: ['ledger'] });
            if (updated.status !== 'PENDING') setFixEntry(null);
          }}
        />
      )}

      {teamOpen && <ManageTeam onClose={() => setTeamOpen(false)} />}

      <ImageLightbox url={lightboxUrl} title="Capture" onClose={() => setLightboxUrl(null)} />
    </div>
  );
}
