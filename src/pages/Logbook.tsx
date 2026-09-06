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
import { ResolvePopup, type GapKey } from '../components/ResolvePopup';
import { ImageLightbox } from '../components/ImageLightbox';
import { PageSkeleton } from '../components/SkeletonLoader';
import { V, font, serif, nums, display, mono, T } from '../components/day-book/tokens';
import { ANIM, hasRevealed, markRevealed } from '../components/day-book/motion';
import { prefersReducedMotion } from '../components/day-book/useSwipeTriage';
import { WhatsAppGlyph } from '../components/day-book/atoms';
import { ManageTeam } from '../components/day-book/Invitation';
import { StartOnWhatsAppButton } from '../components/day-book/StartOnWhatsApp';
import { useCursorLamp } from '../components/nav/useCursorLamp';

// Briklay's WhatsApp business number (same single source the invitation uses) — the band's "Open WhatsApp".
const BRIKLAY_WA = '917330872705';

// The "For review" header band — bitter-chocolate (the rail's night binding) + the cursor-following lamp.
// Scoped to .review-band so it can't leak into the cream page below.
const BAND_CSS = `
.review-band{position:relative;overflow:hidden;color:#F5F0E7;
  background:linear-gradient(180deg,#191009,#140D07);box-shadow:inset 0 -1px 0 #302014;--mx:50%;--my:30%}
.review-band>*{position:relative;z-index:1}
.rb-fx{position:absolute;inset:0;z-index:0;pointer-events:none;opacity:0;transition:opacity .45s ease}
.review-band.lit .rb-fx{opacity:1}
.rb-glow{background:
  radial-gradient(115px circle at var(--mx) var(--my), rgba(180,83,47,.13), rgba(180,83,47,.05) 55%, transparent 75%),
  radial-gradient(215px circle at var(--mx) var(--my), rgba(245,240,231,.04), transparent 74%)}
.rb-draft{background:
  repeating-linear-gradient(0deg, rgba(245,240,231,.055) 0 1px, transparent 1px 26px),
  repeating-linear-gradient(90deg, rgba(245,240,231,.055) 0 1px, transparent 1px 26px);
  -webkit-mask-image:radial-gradient(115px circle at var(--mx) var(--my), #000 0%, rgba(0,0,0,.55) 55%, transparent 82%);
          mask-image:radial-gradient(115px circle at var(--mx) var(--my), #000 0%, rgba(0,0,0,.55) 55%, transparent 82%)}
.rb-in{max-width:1120px;margin:0 auto;padding:26px 40px}
.rb-top{display:flex;align-items:baseline;gap:14px}
.rb-h1{font-family:"Playfair Display",Georgia,serif;font-size:30px;font-weight:500;margin:0;color:#F5F0E7}
.rb-actions{margin-left:auto;display:flex;gap:8px;align-items:center}
.rb-btn{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 14px;border-radius:9px;font-weight:500;font-size:13.5px;
  color:rgba(245,240,231,.72);background:rgba(245,240,231,.07);box-shadow:inset 0 0 0 1px rgba(245,240,231,.14);text-decoration:none;cursor:pointer;border:0}
.rb-btn:hover{color:#F5F0E7;background:rgba(245,240,231,.11)}
.rb-btn svg{width:15px;height:15px}
.rb-sub{font-size:14px;color:rgba(245,240,231,.72);margin-top:10px;max-width:62ch}
.rb-sub .wa{color:#7CCB96;font-weight:500}
.rb-lead{margin-top:22px}
.rb-amt{display:block;font-family:"DM Mono",ui-monospace,monospace;font-size:31px;font-variant-numeric:tabular-nums;letter-spacing:-.01em;line-height:1}
.rb-amt .k{font-size:12.5px;color:rgba(245,240,231,.5);font-family:"DM Sans",system-ui,sans-serif;margin-left:10px;vertical-align:4px}
.rb-meta{font-size:13px;color:rgba(245,240,231,.5);margin-top:11px}
.rb-meta .num{color:rgba(245,240,231,.72)}
.rb-meta i{font-style:normal;color:rgba(245,240,231,.28);margin:0 7px}
@media(max-width:640px){
  .rb-in{padding:18px 16px}
  .rb-h1{font-size:24px}
  /* Title on its own line; the two actions drop below it and split the row evenly, so nothing crams. */
  .rb-top{flex-wrap:wrap;align-items:center}
  .rb-actions{margin-left:0;flex-basis:100%;margin-top:12px;gap:8px}
  .rb-btn{flex:1;justify-content:center;height:44px;padding:0 12px}
  .rb-sub{font-size:13px;margin-top:8px}
  .rb-lead{margin-top:18px}
  .rb-amt{font-size:27px}
}
@media (prefers-reduced-motion:reduce){.rb-fx{transition:none}}
`;
import { ReviewCard, type StakeholderLite, type ProjectLite } from '../components/day-book/ReviewCard';

type TabKey = 'all' | 'review' | 'filed' | 'rejected' | 'requests';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'review',   label: 'To review' },
  { key: 'filed',    label: 'Filed' },
  { key: 'rejected', label: 'Not a transaction' },
  { key: 'requests', label: 'Purchase requests' },
];

// A PR pointer row in the Day Book feed — NOT a review card. Item/title + site +
// a calm status line; tapping opens the request in the Purchase Requests page.
function PRPointerRow({ pr, onOpen }: { pr: PRPointer; onOpen: () => void }) {
  const items = pr.purchase_request_items ?? [];
  const headline = items.length === 0
    ? (pr.title ?? 'Purchase request')
    : items.length <= 2
      ? items.map((i) => `${i.quantity ?? ''}${i.unit ? ' ' + i.unit : ''} ${i.item_name}`.trim()).join(', ')
      : `${pr.title ?? `${items[0].item_name} + ${items.length - 1} more`} · ${items.length} items`;
  const site = pr.projects?.name ?? pr.site_raw ?? null;
  const st = pr.status === 'approved' ? { label: 'Approved', color: V.sage }
    : pr.status === 'sent_for_approval' ? { label: 'Sent for approval', color: V.ask }
    : { label: 'Draft', color: V.sys };
  return (
    <button onClick={onOpen} className="w-full text-left rounded-2xl p-4 db-card flex items-start gap-3" style={{ background: V.surface }}>
      <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 font-bold" style={{ background: V.terraWash, color: V.terraDeep, ...font, fontSize: 11, letterSpacing: '0.04em' }}>PR</span>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate" style={{ color: V.ink, ...font, ...T.sm }}>{headline}</p>
        <p className="text-[12px] mt-0.5 truncate" style={{ color: site ? V.sys : V.ask, ...font }}>{site ?? 'needs site'}</p>
        <p className="text-[11px] mt-1.5" style={{ color: st.color, ...font }}>
          {pr.status === 'draft' && !site ? 'Draft · complete it →' : `${st.label} · open →`}
        </p>
      </div>
    </button>
  );
}

interface PRPointer {
  id: string; status: string; title: string | null; site_raw: string | null;
  purchase_request_items: { item_name: string; quantity: number | null; unit: string | null }[];
  projects: { name: string } | null;
}

// Ease a number toward its target (cubic-out, ~340ms) so the band's unposted figure + count tick when
// a card files — the reference's setFigure. Snaps instantly under reduced-motion.
function useCountUp(value: number, ms = 340): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const from = fromRef.current, to = value;
    if (from === to) return;
    if (window.matchMedia('(prefers-reduced-motion:reduce)').matches) { setDisplay(to); fromRef.current = to; return; }
    let raf = 0; const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (to - from) * e));
      if (p < 1) raf = requestAnimationFrame(step); else fromRef.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return display;
}

export default function Logbook({ session }: { session: Session }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const orgId = useOrgId();
  const { show: showSnackbar } = useSnackbar();
  const { data: profile } = useUserProfile(session.user.id);

  const canManage = profile?.role === 'management' || profile?.role === 'principal' || profile?.role === 'accountant';

  const [tab, setTab] = useState<TabKey>('review');
  /**
   * ONE EDITOR, TWO ERRANDS.
   *
   * `only: undefined` — the EDIT button. Every field, because you came to change something that is
   *                     already there and wrong, and you must be able to see all of it.
   * `only: [...]`     — the APPROVE button, with something missing. The SAME popup, narrowed to
   *                     exactly the blanks. It does not re-present the facts you already gave it.
   *
   * There is deliberately no second "confirm" dialog. Two cards that look almost the same is how a
   * product starts feeling like two products.
   */
  const [editor, setEditor] = useState<{ entry: RoughEntry; only?: GapKey[] } | null>(null);
  /** An entry filed from the editor — the card is told, so it can take its leave. */
  const [flyOut, setFlyOut] = useState<string | null>(null);
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

  // Purchase requests — merged into the feed as a peer tab of pointer rows.
  const { data: prs = [] } = useQuery({
    queryKey: ['daybook_purchase_requests', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from('purchase_requests')
        .select('id, status, title, site_raw, purchase_request_items(item_name, quantity, unit), projects(name)')
        .eq('org_id', orgId).order('created_at', { ascending: false }).limit(60);
      return (data ?? []) as unknown as PRPointer[];
    },
  });

  // ── Buckets ──────────────────────────────────────────────────────────────
  // AWAITING_CONTEXT is pending-but-incomplete -> shows under "To review".
  // Filed / binned tabs sort by WHEN they were filed/binned (updated_at), latest first —
  // not by message arrival. Falls back to created_at until the column is populated.
  const byRecent = (a: RoughEntry, b: RoughEntry) =>
    +new Date(b.updated_at || b.created_at) - +new Date(a.updated_at || a.created_at);
  const review   = useMemo(() => entries.filter(e => e.status === 'PENDING' || e.status === 'AWAITING_CONTEXT' || lingering.has(e.id)), [entries, lingering]);
  const filed     = useMemo(() => entries.filter(e => e.status === 'POSTED').sort(byRecent), [entries]);
  const rejected  = useMemo(() => entries.filter(e => e.status === 'DISMISSED').sort(byRecent), [entries]);
  // ALL — one unified feed of to-review + filed, newest first. To-review render as full vouchers;
  // filed render as ReviewCard's compact, muted, action-less "in your books · View" row, so you
  // never have to cue between the day book and the transactions page. (A just-filed entry can be in
  // both buckets while it lingers mid-leave — dedupe by id, keeping its review instance.)
  const all = useMemo(() => {
    const seen = new Set<string>();
    return [...review, ...filed]
      .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  }, [review, filed]);
  const shown = tab === 'all' ? all : tab === 'review' ? review : tab === 'filed' ? filed : rejected;

  /**
   * THE DAY BOOK IS KEPT BY THE DAY — that is what makes it a day book and not an inbox.
   *
   * Grouped on the day the entry was CAPTURED (created_at), which is the day the money actually moved
   * as far as the site is concerned — the day somebody stood there and said so. Not the day we got
   * round to reading it.
   *
   * The order inside a day is left exactly as it was (`shown` is already sorted); this only cuts the
   * run into pages.
   */
  const byDay = useMemo(() => {
    const groups = new Map<string, { label: string; weekday: string; entries: typeof shown }>();
    for (const e of shown) {
      const d = new Date(e.created_at);
      const key = d.toDateString();                       // local day — the site's day, not UTC's
      const g = groups.get(key) ?? {
        label: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        weekday: d.toLocaleDateString('en-IN', { weekday: 'long' }),
        entries: [] as typeof shown,
      };
      g.entries.push(e);
      groups.set(key, g);
    }
    return [...groups.entries()];
  }, [shown]);

  // ── ALL-tab table helpers: a compact row per entry + the day's total ──────────
  const amtOf = (e: RoughEntry) => parseFloat(String(e.ai_extracted?.amount ?? '').replace(/[^\d.]/g, '')) || 0;
  const fmtRs = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
  const entryView = (e: RoughEntry) => {
    const ai = e.ai_extracted || {};
    const payee = stakeholders.find((s) => s.stakeholder_id === ai.payee_id)?.name || ai.payee_name || ai.payee_raw || 'Unknown';
    const proj = projects.find((p) => p.project_id === ai.project_id)?.name || ai.project_name || ai.project_raw || '';
    const desc = (ai.description || ai.description_raw || '').trim();
    return { payee, proj, desc, amount: amtOf(e), filed: e.status === 'POSTED', txnId: e.resolved_txn_id ?? null };
  };
  const dayTotal = (es: RoughEntry[]) => es.reduce((s, e) => s + amtOf(e), 0);

  /** What is standing in the book unposted. The number that turns a chore into a reason to sit down. */
  const unpostedTotal = useMemo(
    () => review.reduce((s, e) => s + (parseFloat(String(e.ai_extracted?.amount ?? '').replace(/[^\d.]/g, '')) || 0), 0),
    [review],
  );

  // On open with no deep-link, land on the first entry card so the cards — not the header
  // preamble — are the focus (the tabs stay peeking via scroll-margin). Once only.
  const didInitScroll = useRef(false);
  useEffect(() => {
    if (focusId || isLoading || didInitScroll.current) return;
    const el = document.getElementById(`db-entry-${shown[0]?.id}`);
    if (!el) return;
    didInitScroll.current = true;
    requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [focusId, isLoading, shown]);

  const counts: Record<TabKey, number> = { all: all.length, review: review.length, filed: filed.length, rejected: rejected.length, requests: prs.length };

  // ── Band figures: what's unposted, how many to review, the oldest one, and how many people send ──
  const bandRef = useCursorLamp<HTMLElement>();   // the same cursor lamp the nav rail wears
  const reviewCount = review.length;
  const oldestLabel = useMemo(() => {
    if (!review.length) return null;
    const oldest = review.reduce((a, e) => (a.created_at < e.created_at ? a : e));
    return new Date(oldest.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  }, [review]);
  const senderCount = useMemo(
    () => new Set(entries.map(e => e.sender_number || e.sender_name).filter(Boolean)).size,
    [entries],
  );
  const amtDisplay = useCountUp(Math.round(unpostedTotal));   // tween the unposted figure
  const countDisplay = useCountUp(reviewCount);               // tween the to-review count

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
    // The card has finished taking its leave. NOW the list may catch up with the truth.
    if (flyOut === entryId) { setFlyOut(null); invalidateEntries(); }
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
      <style>{BAND_CSS}</style>

      {/* ── For-review header band — bitter chocolate + the nav's cursor lamp ── */}
      <header ref={bandRef} className="review-band">
        <div className="rb-fx rb-draft" aria-hidden="true" />
        <div className="rb-fx rb-glow" aria-hidden="true" />
        <div className="rb-in">
          <div className="rb-top">
            <h1 className="rb-h1">For review</h1>
            <div className="rb-actions">
              {canManage && (
                <button className="rb-btn" onClick={() => setTeamOpen(true)}>
                  {senderCount} sender{senderCount !== 1 ? 's' : ''} · Manage
                </button>
              )}
              <a className="rb-btn" href={`https://wa.me/${BRIKLAY_WA}`} target="_blank" rel="noopener noreferrer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.4 8.5 8.5 0 0 1-4-1L3 21l2.1-5.4A8.4 8.4 0 1 1 21 11.5z" /></svg>
                Open WhatsApp
              </a>
            </div>
          </div>
          <div className="rb-sub">Everything you and your team send to Briklay on <span className="wa">WhatsApp</span> lands here — file each one and it enters your books.</div>
          <div className="rb-lead">
            <span className="rb-amt">₹{amtDisplay.toLocaleString('en-IN')}<span className="k">unposted</span></span>
            <div className="rb-meta">
              {reviewCount > 0
                ? <><span className="num">{countDisplay}</span> to review{oldestLabel ? <> <i>·</i> oldest {oldestLabel}</> : null}</>
                : <span style={{ color: '#7CCB96' }}>All caught up — every message is in your books</span>}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto pt-5 pb-6 sm:pt-6 sm:pb-8" style={{ width: '92%', maxWidth: 1100 }}>
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
        ) : tab === 'requests' ? (
          <div className="space-y-2.5 mt-6 mo-stagger">
            {prs.length === 0
              ? <p className="text-center py-12" style={{ color: V.faint, ...font, ...T.sm }}>No purchase requests yet. Ask Briklay to order materials on WhatsApp.</p>
              : prs.map((pr) => <PRPointerRow key={pr.id} pr={pr} onOpen={() => navigate('/purchase-orders?status=draft')} />)}
          </div>
        ) : (
          <div className="space-y-4 mt-6 mo-stagger">
            {shown.length === 0 && (
              (tab === 'review' || tab === 'all') ? (
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
            {/* ═══ THE LEDGER HEAD ═══════════════════════════════════════════════════════════════
                A day book is a bound ledger, and a ledger's page carries its own totals. Two facts,
                and only two: how many are still waiting on him, and how much money is standing in
                them unposted. The second is the one that makes the first urgent — "4 to review"
                is a chore; "₹1,03,100 unposted" is a reason to sit down. */}
            {shown.length > 0 && tab === 'review' && (
              <div className="flex items-baseline justify-between gap-3 px-1.5 pb-1" style={{ ...mono, fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: V.sys }}>
                <span>Day book</span>
                <span style={{ letterSpacing: '.04em', color: V.faint, textTransform: 'none' }}>
                  <b style={{ color: V.sys, fontWeight: 500 }}>{shown.length}</b> to review
                  {unpostedTotal > 0 && <> · <b style={{ color: V.sys, fontWeight: 500 }}>₹{unpostedTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</b> unposted</>}
                </span>
              </div>
            )}

            {/* ═══ THE DAYS ══════════════════════════════════════════════════════════════════════
                A day book is kept BY THE DAY — that is the whole of what makes it a day book. The
                entries were a flat run of cards, so a Sunday's three payments and last Tuesday's one
                sat in the same undifferentiated column, and there was nowhere for the eye to rest and
                nothing to finish. Now each day is a page: it opens with its date, it says how many are
                on it, and it ends. */}
            {byDay.map(([dayKey, group]) => (
              <div key={dayKey} className="space-y-4">
                <div className="flex items-baseline gap-3 px-1.5" style={{ marginTop: 2 }}>
                  <h2 style={{ ...display, fontWeight: 600, fontSize: 17, color: V.ink }}>{group.label}</h2>
                  <span style={{ ...mono, fontSize: 11, letterSpacing: '.06em', color: V.faint }}>
                    {group.weekday} · {group.entries.length} {tab === 'review' ? `to review` : group.entries.length === 1 ? 'entry' : 'entries'}
                  </span>
                  <span className="flex-1" style={{ height: 1, background: V.line, transform: 'translateY(-3px)' }} />
                  {/* ALL: the day's total is the headline of the row (the point of this view). */}
                  {tab === 'all' && <span style={{ ...display, ...nums, fontSize: 17, fontWeight: 700, color: V.ink }}>{fmtRs(dayTotal(group.entries))}</span>}
                </div>

                {/* ── ALL: a compact table of the day's entries (to-review + filed, filed muted) ── */}
                {tab === 'all' ? (
                  <div style={{ background: V.surface, border: `1px solid ${V.line}`, borderRadius: 12, overflow: 'hidden' }}>
                    {group.entries.map((e, i) => {
                      const v = entryView(e);
                      return (
                        <div
                          key={e.id}
                          id={`db-entry-${e.id}`}
                          onClick={() => (v.filed ? (v.txnId && viewTxn(v.txnId)) : setEditor({ entry: e }))}
                          className="db-allrow mo-row"
                          style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: '0 14px', padding: '11px 14px', cursor: 'pointer', borderTop: i > 0 ? `1px solid ${V.line}` : 'none', opacity: v.filed ? 0.66 : 1 }}
                        >
                          <div className="min-w-0">
                            <div style={{ ...font, fontSize: 14, fontWeight: 600, color: V.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.payee}</div>
                            <div style={{ ...font, fontSize: 12, color: V.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[v.proj, v.desc].filter(Boolean).join(' · ') || '—'}</div>
                          </div>
                          <div style={{ ...font, ...nums, fontSize: 14.5, fontWeight: 600, color: v.filed ? V.sys : V.ink, whiteSpace: 'nowrap', textAlign: 'right' }}>{v.amount > 0 ? fmtRs(v.amount) : '—'}</div>
                          <div style={{ ...font, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', color: v.filed ? V.sage : V.terra }}>
                            {v.filed ? '✓ Filed' : 'To review'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : group.entries.map((r) => (
                  <div
                    key={r.id}
                    id={`db-entry-${r.id}`}
                    style={{ scrollMarginTop: 40, ...(focusId === r.id ? { borderRadius: 18, boxShadow: '0 0 0 2px #C8603A', transition: 'box-shadow .3s' } : {}) }}
                  >
                    <ReviewCard
                      entry={r}
                      orgId={orgId}
                      canManage={canManage}
                      stakeholders={stakeholders}
                      projects={projects}
                      reveal={tab === 'review' && r.id === shown[0]?.id && reveal}
                      onFiled={() => handleFiled(r.id)}
                      onView={viewTxn}
                      onDismiss={() => dismiss(r.id)}
                      onRejected={() => handleRejected(r.id)}
                      onRestore={() => restore(r.id)}
                      onFix={() => setEditor({ entry: r })}
                      onConfirm={(gaps) => setEditor({ entry: r, only: gaps })}
                      justFiled={flyOut === r.id}
                      onLightbox={setLightboxUrl}
                      onError={(m) => showSnackbar(m, { type: 'error' })}
                    />
                  </div>
                ))}
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

      {/* THE editor. Edit opens it whole; Approve opens it narrowed to what is missing. */}
      {editor && (
        <ResolvePopup
          entry={editor.entry}
          only={editor.only}
          session={session}
          onClose={() => setEditor(null)}
          onUpdated={(updated) => {
            qc.invalidateQueries({ queryKey: ['ledger'] });
            // Refresh the lists the CARD resolves against, so a site/payee just picked in the editor
            // can't fail to resolve on the card because this page's copy of the list lagged the edit.
            qc.invalidateQueries({ queryKey: ['daybook_projects'] });
            qc.invalidateQueries({ queryKey: ['daybook_stakeholders'] });
            // Filed from the editor → hand the CARD its own exit: the tick, the slide, the receipt,
            // exactly as if he had approved it on the card. Two ways in, one way out.
            //
            // LINGERING IS WHAT KEEPS IT ALIVE TO DO THAT. The row is POSTED now, so the "to review"
            // list would drop it on the very next refetch and the card would simply vanish mid-leave.
            // `lingering` holds it on screen until it has finished going (dismiss() lets it go).
            if (updated.status === 'POSTED') {
              setLingering((l) => new Set(l).add(updated.id));
              setFlyOut(updated.id);
              setEditor(null);
              invalidateEntries();
              return;
            }
            invalidateEntries();
            if (updated.status !== 'PENDING') setEditor(null);
          }}
        />
      )}

      {teamOpen && <ManageTeam onClose={() => setTeamOpen(false)} />}

      <ImageLightbox url={lightboxUrl} title="Capture" onClose={() => setLightboxUrl(null)} />
    </div>
  );
}
