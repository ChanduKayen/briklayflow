import { useState, useRef, useEffect, useMemo, lazy, Suspense, type ReactNode, type MouseEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { resolveDocUrl } from '../lib/storage';
import { usePeek } from '../context/PeekContextCore';
import type { Stakeholder, Project } from '../types';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import { useSnackbar } from '../components/Snackbar';
import { getCostCode } from '../lib/costCodes';
import { Plus, Search, Download, Paperclip, Check, ArrowRight, ChevronRight, X, SlidersHorizontal } from 'lucide-react';
import { useIsMobile } from '../lib/useIsMobile';
import BottomSheet from '../components/BottomSheet';
import { WhatsAppGlyph } from '../components/day-book/atoms';
import { StartOnWhatsAppButton } from '../components/day-book/StartOnWhatsApp';
import { ImageLightbox } from '../components/ImageLightbox';
import { PageSkeleton } from '../components/SkeletonLoader';
import { useQueryGate } from '../components/QueryGate';
import { deriveDirection, isNotLinked, resolveAnchor, isGeneralExpense, generalExpenseLabel, payeeLabel, type TxnAnchor, type TxnDirection } from '../lib/transactions';
import { V, font, serif, nums, terraGrad } from '../components/txn-ledger/ledgerTokens';
import { useCursorLamp } from '../components/nav/useCursorLamp';
import { DirMedallion, Amount, AnchorChip, FilterChip } from '../components/txn-ledger/LedgerAtoms';
import { TrackChip, TRACK_CHIP_CSS } from '../components/txn-ledger/TrackChip';
import { unlinkTxnOrder } from '../lib/trackingApi';
import { useOrgId } from '../lib/auth/AuthProvider';
import StakeholderLedgerDrawer from '../components/StakeholderLedgerDrawer';
import { NewTxnFab } from '../components/NewTxnFab';
import { NewTxnMenuButton } from '../components/NewTxnMenuButton';
// Lazy — its xlsx parser is heavy and only needed when the import modal actually opens.
const ImportTransactions = lazy(() => import('./ImportTransactions'));

const PAGE_SIZE = 25;
const inr = (n: number) => Math.round(n).toLocaleString('en-IN');

/* ---------- linked-order info: a human title + burn-down for each WO/PO chip ---------- */

// What the redesigned AnchorChip needs to show a title, a burn-down bar, and the
// remaining balance — keyed by order id (wo_id / po_id). Total/paid drive the bar.
export type OrderInfo = { kind: 'WO' | 'PO'; title: string; total: number; paid: number; project: string };

// A WO's scope is a long paragraph; show the opening ~40 chars as a human header
// when the AI/user title is missing.
function summarizeScope(s: string | null | undefined): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return 'Contract';
  return t.length > 40 ? t.slice(0, 40).trimEnd() + '…' : t;
}

// A PO is a basket of line items; name the leading item(s) that fit in ~24 chars,
// then "+N others" for the rest — e.g. "Cement +23 others", "Cement, Steel +4 others".
function summarizeItems(items: Array<{ item_name?: string | null; specification?: string | null }> | null | undefined): string {
  const names = (items ?? [])
    .map((it) => (it?.item_name || it?.specification || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (names.length === 0) return 'Purchase';
  const lead: string[] = [];
  let used = 0;
  for (const n of names) {
    const add = (lead.length ? 2 : 0) + n.length; // ", " separator
    if (lead.length > 0 && used + add > 24) break;
    lead.push(n);
    used += add;
  }
  const rest = names.length - lead.length;
  return rest > 0 ? `${lead.join(', ')} +${rest} other${rest === 1 ? '' : 's'}` : lead.join(', ');
}

/* ---------- Import button: outline secondary with a tooltip + micro-interactions ----------
   Rest → hover (lifts, turns terra, the arrow rises and gently bobs) → active (presses in). */
/* ---------- the entry: machine-set, threaded on the spine ---------- */

type EntryProps = {
  dir: TxnDirection;
  payee: string;
  stakeholderId?: string | null;
  onPayeeClick?: (e: MouseEvent) => void;
  context: string;
  anchor: TxnAnchor;
  info?: OrderInfo;
  siblings?: number;
  partyName?: string | null;
  siteName?: string | null;
  anchorNode?: ReactNode;
  remark: string | null;
  amount: string;
  attach: boolean;
  voided: boolean;
  flagged: boolean;
  selected: boolean;
  selectionMode: boolean;
  sumSelected: boolean;
  onRowClick: () => void;
  onToggleSelect: (e: MouseEvent) => void;
  onAnchorClick: (e: MouseEvent) => void;
  onAnchorHover?: () => void;
  onUnlink?: () => void;
  onAmountDown: (e: MouseEvent) => void;
  onAmountEnter: () => void;
  onAttach?: (e: MouseEvent) => void;
};

function EntryRow(p: EntryProps) {
  const [hover, setHover] = useState(false);
  const showCheck = p.selectionMode || hover;
  // The press is toggled by hand rather than left to :active — iOS never gives :active
  // to a plain div — and the contact point is written onto the element so the tint
  // blooms from under the thumb instead of from the middle of the row.
  const press = (e: PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--px', `${e.clientX - r.left}px`);
    el.style.setProperty('--py', `${e.clientY - r.top}px`);
    el.classList.add('is-press');
  };
  const unpress = (e: PointerEvent<HTMLElement>) => e.currentTarget.classList.remove('is-press');
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={p.onRowClick}
      onPointerDown={press}
      onPointerUp={unpress}
      onPointerCancel={unpress}
      onPointerLeave={unpress}
      className="bk-ledger-row rounded-xl relative cursor-pointer"
      style={{
        background: p.sumSelected ? V.terraWash : hover ? V.field : 'transparent',
        opacity: p.voided ? 0.45 : 1,
      }}
    >
      {/* select ↔ medallion swap: the direction medallion BECOMES the checkbox on
          hover / in select mode (Gmail-style) — so the box never overlaps the glyph. */}
      <div className="bk-ledger-med flex items-center justify-center">
        {showCheck ? (
          <button
            type="button"
            onClick={p.onToggleSelect}
            aria-label={p.selected ? 'Deselect' : 'Select'}
            className="flex items-center justify-center rounded-md"
            style={{
              width: 20, height: 20,
              border: `1.5px solid ${p.selected ? V.terra : V.line}`,
              background: p.selected ? V.terra : V.surface,
              transition: 'background .15s, border-color .15s',
            }}
          >
            {p.selected && <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span>}
          </button>
        ) : (
          <DirMedallion dir={p.dir} />
        )}
      </div>

      <div className="bk-ledger-main">
        <p className="text-sm font-medium truncate" style={{ color: V.ink, ...font }}>
          {/* Mobile-only: the "flagged" badge lives in the (hidden) anchor cell on a phone, so
              carry a subtle amber dot beside the name instead. Desktop keeps the full badge. */}
          {p.flagged && (
            <span className="sm:hidden" title="AI-flagged" style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: V.ask, marginRight: 6, verticalAlign: 'middle' }} />
          )}
          {/* The party ledger is a pointer affordance: the page hands over onPayeeClick only on a
              desktop, where a hover can announce it and a cursor can hit it. On a phone the whole
              row is one target — the transaction — and the party is reached from inside it. */}
          {p.stakeholderId && p.onPayeeClick ? (
            <span
              role="button"
              tabIndex={0}
              title={`View ${p.payee}'s ledger`}
              onClick={(e) => { e.stopPropagation(); p.onPayeeClick!(e); }}
              className="cursor-pointer hover:underline underline-offset-2 decoration-dotted"
            >
              {p.payee}
            </span>
          ) : (
            p.payee
          )}
          {p.voided && <span className="ml-1.5 text-xs" style={{ color: V.faint, ...font }}>· voided</span>}
        </p>
        <p className="text-xs truncate" style={{ color: V.faint, ...font }}>{p.context}</p>
      </div>

      <div className="bk-ledger-anchor flex items-center gap-2">
        {p.anchorNode ?? <AnchorChip anchor={p.anchor} info={p.info} siblings={p.siblings} partyName={p.partyName} siteName={p.siteName} onHover={p.onAnchorHover} onUnlink={p.onUnlink} onClick={(e) => { e.stopPropagation(); p.onAnchorClick(e); }} />}
        {p.flagged && (
          <span className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: V.askWash, border: `1px solid ${V.askLine}`, color: V.ask, ...font }}>flagged</span>
        )}
        {p.remark && <span className="text-xs truncate" style={{ color: V.sys, ...font }}>{p.remark}</span>}
      </div>

      <div className="bk-ledger-amount flex items-center justify-end gap-2">
        {p.attach && (
          <button type="button" onClick={(e) => { e.stopPropagation(); p.onAttach?.(e); }} aria-label="Attachment" className="shrink-0 flex items-center">
            <Paperclip size={13} style={{ color: V.faint }} />
          </button>
        )}
        <div
          data-cell-select
          onMouseDown={(e) => { e.stopPropagation(); p.onAmountDown(e); }}
          onMouseEnter={p.onAmountEnter}
          style={{ userSelect: 'none' }}
        >
          <Amount dir={p.dir} value={p.amount} />
        </div>
        <ChevronRight className="bk-go" size={16} strokeWidth={2} aria-hidden="true" />
      </div>
    </div>
  );
}

/* ---------- empty ledger: teach how it fills, using the day's own spine ---------- */

function JourneyStop({ wash, accent, icon, title, body }: { wash: string; accent: string; icon: ReactNode; title: string; body: string }) {
  return (
    <div className="relative flex items-start gap-4 py-3">
      <span
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 relative"
        style={{ background: wash, color: accent, boxShadow: `0 0 0 4px ${V.page}`, zIndex: 1 }}
      >
        {icon}
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="text-sm font-medium" style={{ color: V.ink, ...font }}>{title}</p>
        <p className="text-xs mt-0.5 leading-relaxed" style={{ color: V.faint, ...font }}>{body}</p>
      </div>
    </div>
  );
}

function LedgerEmpty({ reviewCount, onReview, onNew }: { reviewCount: number; onReview: () => void; onNew: () => void }) {
  const waiting = reviewCount > 0;
  return (
    <div className="mx-auto mt-12 mb-8" style={{ maxWidth: 480 }}>
      <h2 className="text-2xl" style={{ color: V.ink, ...serif }}>
        {waiting ? 'Your first entries are waiting' : 'Your ledger fills itself'}
      </h2>
      <p className="text-sm mt-2 leading-relaxed" style={{ color: V.sys, ...font }}>
        {waiting
          ? `${reviewCount} ${reviewCount === 1 ? 'entry' : 'entries'} from WhatsApp ${reviewCount === 1 ? 'is' : 'are'} ready to review. File ${reviewCount === 1 ? 'it' : 'them'}, and your ledger begins.`
          : 'Money reaches your books the moment your site reports it. Here is the path every entry takes.'}
      </p>

      {/* the journey, threaded on the same spine that runs through every day */}
      <div className="relative mt-7">
        <div aria-hidden="true" className="absolute" style={{ left: 15.5, top: 28, bottom: 28, width: 1, background: V.line }} />
        <JourneyStop
          wash={V.field} accent="#1FA855"
          icon={<WhatsAppGlyph size={15} color="#1FA855" />}
          title="Your team sends it"
          body="a payment, a bill photo, or a voice note to Briklay on WhatsApp"
        />
        <JourneyStop
          wash={V.terraWash} accent={V.terraDeep}
          icon={<Check size={15} strokeWidth={2.5} />}
          title="It lands in For review"
          body="checked once, by you, whenever it suits you"
        />
        <JourneyStop
          wash={V.sageWash} accent={V.sage}
          icon={<span style={{ fontSize: 14, fontWeight: 600, ...nums }}>₹</span>}
          title="It settles into your books"
          body="and appears here, in this ledger"
        />
      </div>

      <div className="flex items-center gap-3 flex-wrap mt-7">
        {waiting ? (
          <button onClick={onReview} className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl" style={{ background: terraGrad, color: '#fff', ...font }}>
            Review {reviewCount} in For review <ArrowRight size={15} />
          </button>
        ) : (
          <StartOnWhatsAppButton size="sm" tone="solid" />
        )}
        <button onClick={onNew} className="text-sm font-medium px-4 py-2.5 rounded-xl" style={{ background: V.surface, border: `1px solid ${V.line}`, color: V.inkSoft, ...font }}>
          Add a transaction
        </button>
      </div>
    </div>
  );
}

/**
 * THE SAME LEDGER, UNDER A PROJECT.
 *
 * The project used to have a ledger of its own (ProjectTransactions) — a second, smaller table with its
 * own columns, its own filters and its own idea of what a transaction looks like. Two ledgers means two
 * places to fix the next bug, and the one nobody is looking at rots. It also means the same payment can
 * be described two different ways by the same product, which is the worst thing a book of account can do.
 *
 * And it was never needed: this page has ALWAYS filtered by project (`filterProject`). All it lacked was
 * somebody to tell it which one and to take the choice away afterwards.
 *
 *   lockedProject   the project's NAME (that is what the allocations carry). The Project filter simply
 *                   disappears — you are already inside the project, and offering to filter by a
 *                   different one is offering to leave without saying so.
 */
// The Transactions header band — bitter-chocolate (the rail's night binding) + the cursor lamp, the
// lead net/in/out figures, and a 14-day daily-outflow sparkline. Scoped to .txn-band / .txn-mini.
const LEDGER_BAND_CSS = `
.txn-band{position:relative;overflow:hidden;color:#F5F0E7;background:linear-gradient(180deg,#191009,#140D07);box-shadow:inset 0 -1px 0 #302014;--mx:50%;--my:50%}
.txn-band>*{position:relative;z-index:1}
.tb-fx{position:absolute;inset:0;z-index:0;pointer-events:none;opacity:0;transition:opacity .45s ease}
.txn-band.lit .tb-fx{opacity:1}
.tb-glow{background:radial-gradient(185px circle at var(--mx) var(--my), rgba(180,83,47,.10), rgba(180,83,47,.04) 55%, transparent 75%),radial-gradient(340px circle at var(--mx) var(--my), rgba(245,240,231,.04), transparent 74%)}
.tb-grid{background:repeating-linear-gradient(0deg, rgba(245,240,231,.05) 0 1px, transparent 1px 26px),repeating-linear-gradient(90deg, rgba(245,240,231,.05) 0 1px, transparent 1px 26px);-webkit-mask-image:radial-gradient(185px circle at var(--mx) var(--my), #000 0%, rgba(0,0,0,.55) 55%, transparent 82%);mask-image:radial-gradient(185px circle at var(--mx) var(--my), #000 0%, rgba(0,0,0,.55) 55%, transparent 82%)}
.tb-in{max-width:1120px;margin:0 auto;padding:26px 40px 0}
.tb-top{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
.tb-h1{font-family:"Playfair Display",Georgia,serif;font-size:30px;font-weight:500;margin:0;color:#F5F0E7;min-width:0}
.tb-date{font-size:13px;color:rgba(245,240,231,.5)}
.tb-actions{margin-left:auto;display:flex;gap:8px;flex-shrink:0}
.tb-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:36px;padding:0 14px;border-radius:9px;font-weight:500;font-size:13.5px;line-height:1;white-space:nowrap;color:rgba(245,240,231,.72);background:rgba(245,240,231,.07);box-shadow:inset 0 0 0 1px rgba(245,240,231,.14);border:0;cursor:pointer}
.tb-btn svg{flex-shrink:0}
/* each day of the book arrives rather than appearing — one beat per day, not per row,
   so a long ledger settles quickly instead of rippling for a second */
.mo-rise-day{animation:mo-rise .34s cubic-bezier(.22,.8,.28,1) both}
.mo-rise-day:nth-of-type(2){animation-delay:40ms}
.mo-rise-day:nth-of-type(3){animation-delay:80ms}
.mo-rise-day:nth-of-type(n+4){animation-delay:110ms}
@media (prefers-reduced-motion:reduce){.mo-rise-day{animation:none}}
.tb-btn:hover{color:#F5F0E7;background:rgba(245,240,231,.11)}
.tb-btn.primary{background:#B4532F;box-shadow:none;color:#fff}
.tb-btn.primary:hover{background:#9C4526}
.tb-lead{margin-top:26px}
.tb-amt{display:block;font-family:"DM Mono",ui-monospace,monospace;font-size:31px;font-variant-numeric:tabular-nums;letter-spacing:-.01em;line-height:1;color:#F5F0E7}
.tb-amt .k{font-size:12.5px;color:rgba(245,240,231,.5);font-family:"DM Sans",system-ui,sans-serif;margin-left:10px;vertical-align:4px}
.tb-meta{font-size:13px;color:rgba(245,240,231,.5);margin-top:11px}
.tb-meta .num{color:rgba(245,240,231,.72)}
.tb-meta i{font-style:normal;color:rgba(245,240,231,.28);margin:0 7px}
.txn-rhythm{position:relative;max-width:1120px;margin:22px auto 0;padding:0 40px 14px}
.txn-rhythm svg{display:block;width:100%;height:66px}
.txn-rhythm .bar{fill:rgba(245,240,231,.16);transition:transform .45s cubic-bezier(.2,.7,.3,1),fill .15s;transform:scaleY(0);transform-origin:bottom;transform-box:fill-box;cursor:default}
.txn-rhythm svg.up .bar{transform:scaleY(1)}
.txn-rhythm .bar:hover{fill:rgba(245,240,231,.34)}
.txn-rhythm .bar.hot{fill:url(#tbbarhot)}
.txn-rhythm .bar.today{fill:#F5F0E7}
/* the chosen day — a mouse hovers it, a finger leaves it selected */
.txn-rhythm .bar.on{fill:#F5F0E7}
.txn-rhythm .bar.hot.on{fill:#E2865C}
/* the readout: what the bars are, or what the chosen one says */
.txn-cap{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-top:8px;font-size:12px;line-height:1.3}
.txn-cap .d{color:rgba(245,240,231,.62);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.txn-cap .v{color:rgba(245,240,231,.82);white-space:nowrap;flex-shrink:0}
.txn-mini{position:fixed;top:0;left:var(--shell-ml,220px);right:0;z-index:20;transform:translateY(-100%);transition:transform .22s ease;background:linear-gradient(180deg,#191009,#140D07);box-shadow:inset 0 -1px 0 #302014;color:#F5F0E7}
.txn-mini.show{transform:translateY(0)}
.txn-mini .in{max-width:1120px;margin:0 auto;padding:0 40px;height:48px;display:flex;align-items:center;gap:14px}
.txn-mini .t{font-family:"Playfair Display",Georgia,serif;font-size:15.5px}
.txn-mini .p{font-size:13px;color:rgba(245,240,231,.72)}
.txn-mini .mc{margin-left:auto;font-size:12.5px;color:rgba(245,240,231,.72)}
@media (prefers-reduced-motion:reduce){.txn-rhythm .bar{transform:none}.tb-fx,.txn-mini{transition:none}}
@media (max-width:767px){
  .txn-mini{left:0;padding-top:env(safe-area-inset-top)}
  /* the slim bar carries the same three facts as the desktop one, in the room a phone has:
     the title and the net figure on the first line, the period and the count under it */
  .txn-mini .in{padding:0 18px;height:auto;min-height:52px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0 12px;align-content:center;padding-top:7px;padding-bottom:7px}
  .txn-mini .t{grid-column:1;font-size:15px;line-height:1.15}
  .txn-mini .p{grid-column:2;grid-row:1;text-align:right;font-size:13.5px;font-weight:500;color:#F5F0E7;white-space:nowrap}
  /* the period is already stated in the band; the slim bar keeps the money and the count */
  .txn-mini .p .sep{display:none}
  .txn-mini .mc{grid-column:1/-1;grid-row:2;margin-left:0;font-size:11.5px;margin-top:2px}
}
@media (max-width:640px){.tb-in,.txn-rhythm{padding-left:18px;padding-right:18px}.txn-rhythm{margin-top:18px;padding-bottom:13px}.txn-rhythm svg{height:58px}.txn-cap{font-size:11.5px;margin-top:7px}.tb-in{padding-top:20px}.tb-h1{font-size:25px;flex:1 1 100%}.tb-actions{margin-left:0;flex:1 1 100%;margin-top:12px;gap:10px}.tb-btn{flex:1;min-width:0;height:44px;padding:0 10px}.tb-lead{margin-top:20px}.tb-amt{font-size:28px}}
@media (max-width:380px){.tb-amt{font-size:24px}.tb-btn{font-size:13px;gap:6px}}
`;

// 14-day daily-outflow bars — grows on mount, hover shows the day + amount, click jumps to that day
// in the feed (matches the reference rhythm).
function Rhythm({ data, onPick }: { data: { k: string; v: number; iso: string }[]; onPick?: (iso: string) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(1040);
  const [up, setUp] = useState(false);
  // hover is for a mouse; sel is what a finger leaves behind. A touch has no "leave",
  // so a tapped bar stays chosen until another is tapped — and the caption, not a
  // floating tip, is what reports it.
  const [hover, setHover] = useState<number | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    // measure the real content box — the side padding differs between phone and desktop,
    // and assuming the desktop value put the old tooltip in the wrong place on a phone
    const measure = () => {
      const cs = getComputedStyle(el);
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      setW(Math.max(200, (el.clientWidth || 1120) - pad));
    };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el); return () => ro.disconnect();
  }, []);
  useEffect(() => { const r = requestAnimationFrame(() => requestAnimationFrame(() => setUp(true))); return () => cancelAnimationFrame(r); }, []);
  const N = data.length, CH = 66, TOP = 8;
  const max = Math.max(1, ...data.map(d => d.v));
  const total = data.reduce((a, d) => a + d.v, 0);
  const pitch = w / N, bw = Math.max(8, Math.round(pitch * 0.42));
  const fmt = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
  const active = hover ?? sel;

  const pick = (i: number) => { setSel(i); onPick?.(data[i].iso); };

  return (
    <div className="txn-rhythm" ref={wrapRef}>
      <svg viewBox={`0 0 ${w} ${CH}`} className={up ? 'up' : ''} onPointerLeave={() => setHover(null)}>
        <defs><linearGradient id="tbbarhot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#C46038" /><stop offset="1" stopColor="#8F3D1F" /></linearGradient></defs>
        {data.map((d, i) => {
          const h = Math.max(3, Math.round(d.v / max * (CH - TOP)));
          const x = Math.round(i * pitch + (pitch - bw) / 2);
          const cls = 'bar' + (d.v > max * 0.8 ? ' hot' : '') + (i === N - 1 ? ' today' : '') + (active === i ? ' on' : '');
          return <rect key={i} className={cls} x={x} y={CH - h} width={bw} height={h} rx="2" style={{ transitionDelay: `${i * 22}ms` }} />;
        })}
        {/* one full-height hit column per day, so a finger does not have to find an 8px bar */}
        {data.map((d, i) => (
          <rect key={`h${i}`} x={Math.round(i * pitch)} y={0} width={Math.ceil(pitch)} height={CH}
            fill="transparent" style={{ cursor: onPick ? 'pointer' : 'default' }}
            onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(i); }}
            onClick={() => pick(i)}>
            <title>{d.k} · {fmt(d.v)} out</title>
          </rect>
        ))}
      </svg>
      {/* the caption is the readout: what the bars are, and what the chosen one says */}
      <div className="txn-cap">
        {active != null ? (
          <>
            <span className="d">{data[active].k}{active === N - 1 ? ' · today' : ''}</span>
            <span className="v num">{data[active].v > 0 ? `${fmt(data[active].v)} out` : 'nothing out'}</span>
          </>
        ) : (
          <>
            <span className="d">Last {N} days</span>
            <span className="v num">{fmt(total)} out · busiest {fmt(max)}</span>
          </>
        )}
      </div>
    </div>
  );
}

export default function Ledger({ session, lockedProject }: { session: Session; lockedProject?: string }) {
  const qc = useQueryClient();
  const orgId = useOrgId();
  const navigate = useNavigate();
  // Matches the row's own 639px layout switch, not the app-wide 760px one.
  const isPhone = useIsMobile(640);
  const { openPeek, prefetchPeek } = usePeek();
  const [searchParams] = useSearchParams();
  const { data: profile } = useUserProfile(session.user.id);
  const [importOpen, setImportOpen] = useState(false);
  const closeImport = (imported?: boolean) => {
    setImportOpen(false);
    // An import may have added transactions, parties and sites — refresh what the Ledger shows.
    qc.invalidateQueries({ queryKey: ['ledger'] });
    qc.invalidateQueries({ queryKey: ['stakeholders'] });
    qc.invalidateQueries({ queryKey: ['projects'] });
    // Imported sheets are usually historical — the default "this month" filter would hide most rows.
    // Show ALL dates so every imported entry is visible, not just the ones dated this month.
    if (imported) setDatePreset('all');
  };

  type DatePreset = 'today' | 'week' | 'month' | 'last_month' | 'quarter' | 'fy' | 'all' | 'custom';
  const [filterFlagged] = useState(() => searchParams.get('flagged') === 'true');
  const [filterNeedsAction] = useState(() => searchParams.get('needs_action') === 'true');
  const [filterUnlinked, setFilterUnlinked] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  // Under a project, the project IS the filter — set once, and never offered again.
  const [filterProject, setFilterProject] = useState<string[]>(lockedProject ? [lockedProject] : []);
  const [filterType, setFilterType] = useState<string[]>([]);
  const [activeFilterDropdown, setActiveFilterDropdown] = useState<string | null>(null);
  const [chipDropPos, setChipDropPos] = useState<{ top: number; left: number } | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customRange, setCustomRange] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [filtersOpen, setFiltersOpen] = useState(false);   // mobile: all filters in one sheet
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // Infinite scroll: a sentinel near the end auto-reveals the next page (with a brief
  // spinner beat), so the accountant never has to click "Load more".
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Elastic over-pull at either end (Android-style), applied to the page content.
  const elasticRef = useRef<HTMLDivElement>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // Tapping a party name opens their running ledger in a side drawer (as on Txn Detail).
  // `?stakeholder=<id>` opens it on arrival — the landing point for the "View ledger" button on a WhatsApp
  // payment answer (partyLedgerLink), so the number he was told and the payments behind it are one tap apart.
  // Read once, as the initial state: closing the drawer must not re-open it, and must not touch the URL.
  const [drawerStk, setDrawerStk] = useState<string | null>(() => searchParams.get('stakeholder'));
  // `&project=<id>` narrows that drawer to one site. A WhatsApp answer about a SITE quoted a site's number,
  // so its button must land on that site's ledger — a whole-party ledger behind a per-site figure reads as a
  // contradiction. Only honoured for the deep-linked party: tapping a DIFFERENT party in the list is a fresh
  // question about them, and must not inherit a site filter from a link he followed earlier.
  const deepLinkStk = searchParams.get('stakeholder');
  const deepLinkProject = searchParams.get('project');
  const [drawerProject, setDrawerProject] = useState<string | null>(() => searchParams.get('project'));

  // Direction-aware drag-to-sum: a Set of txn_ids the accountant rubber-bands.
  const [sumSel, setSumSel] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);

  const [selectedTxnIds, setSelectedTxnIds] = useState<Set<string>>(new Set());
  const [showRecategorize, setShowRecategorize] = useState(false);
  const [showVoidAll, setShowVoidAll] = useState(false);
  const [recatCategory, setRecatCategory] = useState('');

  const ALL_CATEGORIES = ['Advance', 'Running Bill', 'Final Settlement', 'Retention Release',
    'Material Supply', 'PO Advance', 'PO Settlement', 'Transport & Handling',
    'Site Overhead', 'Labour Welfare', 'Tools & Equipment', 'Professional Fees', 'Utilities', 'Other'];

  const { data: ledger, isLoading, isError, refetch } = useQuery({
    queryKey: ['ledger'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*, stakeholders(name, type, category), txn_allocations(allocation_id, project_id, allocated_amount, order_type, order_ref, projects(name))')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  // A ledger row (transactions + its nested joins). The client is untyped, so this
  // resolves loosely — but it lets the helpers below take a named type, not bare `any`.
  type LedgerRow = NonNullable<typeof ledger>[number];
  type TxnAlloc = NonNullable<LedgerRow['txn_allocations']>[number];

  // S1-2 Step 4: the transactions landing (/ → /ledger, also the retry card's "Home" target) inherits the
  // S1-1 gate — skeleton → retry card on a hung/failed load post-relogin, never a blank perpetual spinner.
  const ledgerGate = useQueryGate({
    isLoading, isError, hasData: ledger !== undefined, refetch,
    skeleton: <div className="mt-7"><PageSkeleton /></div>, label: 'your ledger',
  });

  // The distinct WO/PO ids referenced by the visible ledger's allocations. These
  // key the order-info query so the chip can show a title + burn-down instead of a
  // bare code. Sorted so the query key is stable across re-renders.
  const { woRefs, poRefs } = useMemo(() => {
    const wo = new Set<string>();
    const po = new Set<string>();
    for (const txn of ledger ?? []) {
      for (const a of (txn.txn_allocations || []) as TxnAlloc[]) {
        if (!a?.order_type || !a?.order_ref) continue;
        if (a.order_type === 'PO') po.add(String(a.order_ref));
        else if (a.order_type === 'WO') wo.add(String(a.order_ref));
      }
    }
    return { woRefs: [...wo].sort(), poRefs: [...po].sort() };
  }, [ledger]);

  // One small lookup of order_id -> { kind, title, total, paid } for every order the
  // visible rows link to. Paid-to-date sums ALL allocations against each order (not
  // just the visible row), so the burn-down reflects the order's true settlement.
  const { data: orderMap = {} } = useQuery<Record<string, OrderInfo>>({
    queryKey: ['ledger_order_info', woRefs, poRefs],
    enabled: woRefs.length > 0 || poRefs.length > 0,
    queryFn: async () => {
      const map: Record<string, OrderInfo> = {};

      // WO: prefer the `title` column, but fall back if that migration isn't applied yet —
      // otherwise the column error would blank the whole map and the chip silently reverts.
      let woData: any[] = [];
      if (woRefs.length) {
        let r: any = await supabase.from('work_orders').select('wo_id, project_id, title, scope_of_work, order_value').in('wo_id', woRefs);
        if (r.error) r = await supabase.from('work_orders').select('wo_id, project_id, scope_of_work, order_value').in('wo_id', woRefs);
        woData = (r.data ?? []) as any[];
      }
      // PO: prefer the line-item embed; fall back to bare totals if the embed errors.
      let poData: any[] = [];
      if (poRefs.length) {
        let r: any = await supabase.from('purchase_orders').select('po_id, project_id, total_value, order_value, po_line_items(item_name, specification)').in('po_id', poRefs);
        if (r.error) r = await supabase.from('purchase_orders').select('po_id, project_id, total_value, order_value').in('po_id', poRefs);
        poData = (r.data ?? []) as any[];
      }
      for (const w of woData) {
        map[String(w.wo_id)] = {
          kind: 'WO',
          title: (w.title?.trim?.() || '') || summarizeScope(w.scope_of_work),
          total: Number(w.order_value) || 0,
          paid: 0,
          project: String(w.project_id ?? ''),
        };
      }
      for (const p of poData) {
        map[String(p.po_id)] = {
          kind: 'PO',
          title: summarizeItems(p.po_line_items),
          total: Number(p.total_value) || Number(p.order_value) || 0,
          paid: 0,
          project: String(p.project_id ?? ''),
        };
      }
      // Paid-to-date: sum every allocation booked against these orders.
      const allRefs = [...woRefs, ...poRefs];
      if (allRefs.length) {
        const { data: allocs, error } = await supabase
          .from('txn_allocations')
          .select('order_ref, allocated_amount')
          .in('order_ref', allRefs);
        if (error) throw error;
        for (const a of (allocs ?? []) as any[]) {
          const ref = String(a.order_ref);
          if (map[ref]) map[ref].paid += Number(a.allocated_amount) || 0;
        }
      }
      return map;
    },
  });

  // ── Silent "other open obligations" signal ───────────────────────────────────
  // The distinct stakeholder_ids whose rows carry an order-typed (WO/PO) allocation.
  // These are the parties for whom a "more open here" depth cue could apply; we count
  // each party's OPEN obligations per kind so the chip can grow a stacked-card edge.
  const partyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const txn of ledger ?? []) {
      if (!txn.stakeholder_id) continue;
      const hasOrderAlloc = ((txn.txn_allocations || []) as TxnAlloc[]).some(
        (a) => a?.order_type === 'WO' || a?.order_type === 'PO',
      );
      if (hasOrderAlloc) ids.add(String(txn.stakeholder_id));
    }
    return [...ids].sort();
  }, [ledger]);

  // Per-party open-obligation counts by kind. Open = an order with (total − paid) > 0.
  // Fetched once for all visible parties; sums paid-to-date across ALL txns per order.
  // Errors degrade gracefully (a missing party just shows no depth cue, never blanks).
  const { data: partyOpen = {} } = useQuery<Record<string, { WO: number; PO: number }>>({
    queryKey: ['ledger_party_open', partyIds],
    enabled: partyIds.length > 0,
    queryFn: async () => {
      // Counts are keyed by `${party}::${projectId}` — a contract/bill belongs to ONE site,
      // and the chip is reviewed in a site context, so "more open" means more on THIS site.
      const counts: Record<string, { WO: number; PO: number }> = {};
      const orders: Array<{ id: string; party: string; project: string; kind: 'WO' | 'PO'; total: number }> = [];

      const woRes = await supabase
        .from('work_orders')
        .select('wo_id, stakeholder_id, project_id, order_value, status')
        .in('stakeholder_id', partyIds)
        .not('status', 'in', '("Closed","Cancelled")');
      for (const w of (woRes.data ?? []) as any[]) {
        if (!w.stakeholder_id) continue;
        orders.push({ id: String(w.wo_id), party: String(w.stakeholder_id), project: String(w.project_id ?? ''), kind: 'WO', total: Number(w.order_value) || 0 });
      }

      const poRes = await supabase
        .from('purchase_orders')
        .select('po_id, stakeholder_id, project_id, total_value, order_value, status')
        .in('stakeholder_id', partyIds);
      for (const p of (poRes.data ?? []) as any[]) {
        if (!p.stakeholder_id) continue;
        orders.push({ id: String(p.po_id), party: String(p.stakeholder_id), project: String(p.project_id ?? ''), kind: 'PO', total: Number(p.total_value) || Number(p.order_value) || 0 });
      }

      if (orders.length === 0) return counts;

      // Paid-to-date for every order, in one sweep over its allocations.
      const paidByOrder: Record<string, number> = {};
      const allRefs = orders.map((o) => o.id);
      const allocRes = await supabase
        .from('txn_allocations')
        .select('order_ref, allocated_amount')
        .in('order_ref', allRefs);
      for (const a of (allocRes.data ?? []) as any[]) {
        const ref = String(a.order_ref);
        paidByOrder[ref] = (paidByOrder[ref] || 0) + (Number(a.allocated_amount) || 0);
      }

      for (const o of orders) {
        const balance = o.total - (paidByOrder[o.id] || 0);
        if (balance > 0) {
          const key = `${o.party}::${o.project}`;
          const c = counts[key] ?? { WO: 0, PO: 0 };
          c[o.kind] += 1;
          counts[key] = c;
        }
      }
      return counts;
    },
  });

  // Deep-link focus: the Day Book's filed "View →" links to /ledger?txn=<id>. Scroll to
  // and ring that row once the ledger has loaded (once — survives realtime refetches).
  const focusTxn = new URLSearchParams(window.location.search).get('txn');
  const didFocusTxn = useRef(false);
  useEffect(() => {
    if (!focusTxn || isLoading || didFocusTxn.current) return;
    const el = document.getElementById(`ledger-txn-${focusTxn}`);
    if (!el) return;
    didFocusTxn.current = true;
    requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [focusTxn, isLoading, ledger]);

  // On open with no ?txn deep-link, land on the first transaction row so the entries —
  // not the search/filter header — are the focus. Once only.
  const didInitLedgerScroll = useRef(false);
  useEffect(() => {
    if (focusTxn || isLoading || didInitLedgerScroll.current) return;
    const el = document.querySelector('[id^="ledger-txn-"]');
    if (!el) return;
    didInitLedgerScroll.current = true;
    requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [focusTxn, isLoading, ledger]);

  // Captures from WhatsApp still waiting in the Day book (same review bucket the
  // Day book uses: PENDING + AWAITING_CONTEXT). Drives the nudge strip below.
  const { data: dayBookReviewCount = 0 } = useQuery({
    queryKey: ['daybook_review_count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('rough_entries')
        .select('id', { count: 'exact', head: true })
        .in('status', ['PENDING', 'AWAITING_CONTEXT']);
      return count ?? 0;
    },
  });
  // Has the builder set up WhatsApp capture at all? (active authorised senders).
  // Only managers can read wa_registered_numbers, and only they can act on the hint.
  const canManageTeam = profile?.role === 'management' || profile?.role === 'principal';
  const { data: activeSenders = 0 } = useQuery({
    queryKey: ['wa_active_senders'],
    enabled: canManageTeam,
    queryFn: async () => {
      const { count } = await supabase
        .from('wa_registered_numbers')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true);
      return count ?? 0;
    },
  });
  const [waHintDismissed, setWaHintDismissed] = useState(() => {
    try { return localStorage.getItem('ledger_wa_setup_hint') === '1'; } catch { return false; }
  });
  const dismissWaHint = () => {
    try { localStorage.setItem('ledger_wa_setup_hint', '1'); } catch { /* private mode */ }
    setWaHintDismissed(true);
  };

  // Set up, but has anyone actually sent anything yet? (any capture ever).
  const { data: totalCaptures = 0 } = useQuery({
    queryKey: ['rough_entries_total'],
    enabled: canManageTeam,
    queryFn: async () => {
      const { count } = await supabase.from('rough_entries').select('id', { count: 'exact', head: true });
      return count ?? 0;
    },
  });
  const [waIdleDismissed, setWaIdleDismissed] = useState(() => {
    try { return localStorage.getItem('ledger_wa_idle_hint') === '1'; } catch { return false; }
  });
  const dismissWaIdle = () => {
    try { localStorage.setItem('ledger_wa_idle_hint', '1'); } catch { /* private mode */ }
    setWaIdleDismissed(true);
  };

  // fetched to warm the react-query cache for the peek/editor surfaces; data unused here
  useQuery({ queryKey: ['stakeholders'], queryFn: async () => { const { data } = await supabase.from('stakeholders').select('*'); return data as Stakeholder[]; } });
  useQuery({ queryKey: ['projects'], queryFn: async () => { const { data } = await supabase.from('projects').select('*'); return data as Project[]; } });

  const { show: showSnackbar } = useSnackbar();

  const voidAllMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('transactions').update({ status: 'Voided', voided_by: session.user.id, voided_at: new Date().toISOString() }).in('txn_id', ids);
      if (error) throw error;
    },
    onSuccess: (_d, ids) => {
      qc.invalidateQueries({ queryKey: ['ledger'] }); setSelectedTxnIds(new Set()); setShowVoidAll(false);
      showSnackbar(`${ids.length} transaction${ids.length !== 1 ? 's' : ''} voided`);
    },
    onError: (err: unknown) => showSnackbar((err instanceof Error && err.message) || 'Failed to void', { type: 'error' }),
  });

  const recatMutation = useMutation({
    mutationFn: async ({ ids, category }: { ids: string[]; category: string }) => {
      // Never edit a voided transaction — it is a closed audit record.
      const { error } = await supabase.from('transactions').update({ category }).in('txn_id', ids).neq('status', 'Voided');
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ledger'] }); setSelectedTxnIds(new Set()); setShowRecategorize(false); setRecatCategory(''); showSnackbar('Category updated'); },
    onError: (err: unknown) => showSnackbar((err instanceof Error && err.message) || 'Failed to update', { type: 'error' }),
  });

  const filterBarRef = useRef<HTMLDivElement>(null);
  const chipDropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: globalThis.MouseEvent) => {
      const t = e.target as Node;
      if (
        (filterBarRef.current && !filterBarRef.current.contains(t)) &&
        (!chipDropRef.current || !chipDropRef.current.contains(t))
      ) setActiveFilterDropdown(null);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => {
    const h = () => setActiveFilterDropdown(null);
    window.addEventListener('scroll', h, true);
    return () => window.removeEventListener('scroll', h, true);
  }, []);

  // drag-to-sum: end on mouseup, clear when clicking away from an amount cell
  useEffect(() => {
    const handleMouseUp = () => setIsDragging(false);
    const handleClickOutside = (e: globalThis.MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-cell-select]')) setSumSel(new Set());
    };
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousedown', handleClickOutside);
    return () => { window.removeEventListener('mouseup', handleMouseUp); window.removeEventListener('mousedown', handleClickOutside); };
  }, []);

  // Reset selection + pagination when the active filters change — the React-sanctioned
  // "adjust state during render" pattern (https://react.dev/learn/you-might-not-need-an-effect),
  // which avoids the extra commit (and cascading-render lint) of doing it in an effect.
  const filterKey = JSON.stringify([searchTerm, filterProject, filterType, datePreset, customRange, filterFlagged, filterNeedsAction, filterUnlinked]);
  const [seenFilterKey, setSeenFilterKey] = useState(filterKey);
  if (filterKey !== seenFilterKey) {
    setSeenFilterKey(filterKey);
    setSelectedTxnIds(new Set());
    setVisibleCount(PAGE_SIZE);
  }

  useEffect(() => {
    const handler = () => navigate('/ledger/new');
    window.addEventListener('shortcut:new-transaction', handler);
    return () => window.removeEventListener('shortcut:new-transaction', handler);
  }, [navigate]);

  const MATERIAL_CATEGORIES_LEGACY = ['Material Supply', 'PO Advance', 'PO Settlement', 'Transport & Handling'];

  const getNeedsAction = (txn: LedgerRow): 'link_wo' | 'link_po' | false => {
    if (txn.status === 'Voided') return false;
    const stkType = txn.stakeholders?.type;
    if (stkType !== 'Worker' && stkType !== 'Vendor') return false;
    const allocs = txn.txn_allocations || [];
    if (allocs.length === 0) return false;
    const hasUnlinked = allocs.some((a: TxnAlloc) => !a.order_type);
    if (!hasUnlinked) return false;
    return stkType === 'Worker' ? 'link_wo' : 'link_po';
  };

  const getTxnType = (txn: LedgerRow): string => {
    if (deriveDirection(txn) === 'in') return 'Client Receipt';
    if (txn.stakeholders?.type === 'Worker') return 'Worker Payment';
    if (txn.stakeholders?.type === 'Vendor') {
      const cc = getCostCode(txn.category || '');
      if (cc?.division.type === 'MAT') return 'Material Purchase';
      if (txn.category && MATERIAL_CATEGORIES_LEGACY.includes(txn.category)) return 'Material Purchase';
    }
    return 'General Expense';
  };

  const getDateRange = (preset: DatePreset): { from: Date | null; to: Date | null } => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    switch (preset) {
      case 'today': return { from: today, to: today };
      case 'week': { const mon = new Date(today); mon.setDate(today.getDate() - ((today.getDay() + 6) % 7)); return { from: mon, to: today }; }
      case 'month': return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: new Date(today.getFullYear(), today.getMonth() + 1, 0) };
      case 'last_month': return { from: new Date(today.getFullYear(), today.getMonth() - 1, 1), to: new Date(today.getFullYear(), today.getMonth(), 0) };
      case 'quarter': { const qm = Math.floor(today.getMonth() / 3) * 3; return { from: new Date(today.getFullYear(), qm, 1), to: new Date(today.getFullYear(), qm + 3, 0) }; }
      case 'fy': { const fyY = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1; return { from: new Date(fyY, 3, 1), to: new Date(fyY + 1, 2, 31) }; }
      case 'custom': {
        const from = customRange.from ? new Date(customRange.from + 'T00:00:00') : null;
        const to = customRange.to ? new Date(customRange.to + 'T00:00:00') : null;
        return { from, to };
      }
      default: return { from: null, to: null };
    }
  };

  const activeDateRange = getDateRange(datePreset);

  const periodLabel = (() => {
    const now = new Date();
    if (datePreset === 'all') return 'All time';
    if (datePreset === 'today') return 'Today';
    if (datePreset === 'week') return 'This week';
    if (datePreset === 'month') return now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    if (datePreset === 'last_month') { const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1); return lm.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); }
    if (datePreset === 'quarter') return 'This quarter';
    if (datePreset === 'fy') { const fyY = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; return `FY ${fyY}-${String(fyY + 1).slice(2)}`; }
    if (datePreset === 'custom') {
      const f = customRange.from, t = customRange.to;
      const nice = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      if (f && t) return `${nice(f)} – ${nice(t)}`;
      if (f) return `From ${nice(f)}`;
      if (t) return `Until ${nice(t)}`;
      return 'Custom range';
    }
    return 'Custom';
  })();

  // ── Filtering (per transaction; project filter matches any allocation) ───────
  const passesBase = (txn: LedgerRow): boolean => {
    // A voided transaction is a closed record — it must never count toward the entry count, the
    // in/out/net totals, or the visible ledger. It stays queryable on its own detail page.
    if (txn.status === 'Voided') return false;
    const term = searchTerm.toLowerCase();
    const matchesSearch = !term || txn.txn_id.toLowerCase().includes(term) || txn.stakeholders?.name?.toLowerCase().includes(term) || txn.category?.toLowerCase().includes(term) || (txn.remarks || '').toLowerCase().includes(term);
    const matchesFlagged = filterFlagged ? txn.ai_flag_status === 'Flagged' : true;
    const matchesNeedsAction = filterNeedsAction ? !!getNeedsAction(txn) : true;
    const matchesType = filterType.length ? filterType.includes(getTxnType(txn)) : true;
    const matchesProject = filterProject.length ? (txn.txn_allocations || []).some((a: TxnAlloc) => filterProject.includes(a.projects?.name || '')) : true;
    const matchesDate = (() => {
      const { from, to } = activeDateRange;
      if (!from && !to) return true;
      const d = new Date(txn.date); d.setHours(0, 0, 0, 0);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    })();
    return matchesSearch && matchesFlagged && matchesNeedsAction && matchesType && matchesProject && matchesDate;
  };

  const baseRows = (ledger || []).filter(passesBase);
  const unlinkedCount = baseRows.filter(isNotLinked).length;
  const filteredTransactions = filterUnlinked ? baseRows.filter(isNotLinked) : baseRows;

  // ── Aggregations over the FULL filtered set (never the visible slice) ────────
  let monthOut = 0, monthIn = 0;
  for (const t of filteredTransactions) {
    if (deriveDirection(t) === 'in') monthIn += Number(t.total_amount); else monthOut += Number(t.total_amount);
  }
  const monthTotal = monthIn + monthOut;
  const outPct = monthTotal > 0 ? (monthOut / monthTotal) * 100 : 0;
  const monthNet = monthIn - monthOut;
  const netLabel = `${monthNet < 0 ? '−' : '+'} ₹${inr(Math.abs(monthNet))}`;

  // ── Header band: the cursor lamp, the slim scroll bar, and the 14-day outflow sparkline ──
  const bandRef = useCursorLamp<HTMLElement>();
  const [miniShow, setMiniShow] = useState(false);
  useEffect(() => {
    const el = bandRef.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => setMiniShow(!e.isIntersecting), { rootMargin: '-40px 0px 0px 0px' });
    io.observe(el); return () => io.disconnect();
  }, [bandRef]);
  const spark = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const t of filteredTransactions) {
      if (deriveDirection(t) !== 'out') continue;
      byDay.set(String(t.date).slice(0, 10), (byDay.get(String(t.date).slice(0, 10)) || 0) + Number(t.total_amount || 0));
    }
    const out: { k: string; v: number; iso: string }[] = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.push({ k: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), v: byDay.get(iso) || 0, iso });
    }
    return out;
  }, [filteredTransactions]);

  const sortedTxns = [...filteredTransactions].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (a.created_at || '') < (b.created_at || '') ? 1 : -1;
  });

  const dayTotals = new Map<string, { out: number; in: number }>();
  for (const t of sortedTxns) {
    const cur = dayTotals.get(t.date) ?? { out: 0, in: 0 };
    if (deriveDirection(t) === 'in') cur.in += Number(t.total_amount); else cur.out += Number(t.total_amount);
    dayTotals.set(t.date, cur);
  }

  const visibleTxns = sortedTxns.slice(0, visibleCount);
  const hasMore = !isLoading && sortedTxns.length > visibleCount;

  // Auto-load the next page when the sentinel nears the viewport (a 300px lead-in),
  // with a short spinner beat so the reveal reads as a deliberate motion, not a jump.
  useEffect(() => {
    if (!hasMore) return;
    const el = loadMoreRef.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout>;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setLoadingMore(true);
        t = setTimeout(() => { setVisibleCount((c) => c + PAGE_SIZE); setLoadingMore(false); }, 280);
      }
    }, { rootMargin: '300px 0px' });
    io.observe(el);
    return () => { io.disconnect(); clearTimeout(t); };
  }, [hasMore, visibleCount]);

  // Elastic over-pull (touch only): at the very top/bottom, a downward/upward drag
  // rubber-bands the content with damping, then springs back — the Android feel.
  useEffect(() => {
    const wrap = elasticRef.current;
    if (!wrap || !('ontouchstart' in window)) return;
    const root = (document.scrollingElement || document.documentElement) as HTMLElement;
    let startY = 0, pull = 0, edge: 0 | 1 | -1 = 0; // -1 top, 1 bottom
    const onStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY; pull = 0;
      const atTop = root.scrollTop <= 0;
      const atBottom = root.scrollTop + window.innerHeight >= root.scrollHeight - 1;
      edge = atTop ? -1 : atBottom ? 1 : 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!edge) return;
      const dy = e.touches[0].clientY - startY;
      if ((edge === -1 && dy > 0) || (edge === 1 && dy < 0)) {
        pull = Math.sign(dy) * Math.min(Math.abs(dy) * 0.4, 72); // damped, capped
        wrap.style.transition = 'none';
        wrap.style.transform = `translateY(${pull}px)`;
        e.preventDefault(); // hold native scroll while rubber-banding
      }
    };
    const release = () => {
      if (!pull) return;
      wrap.style.transition = 'transform .42s cubic-bezier(.16,1,.3,1)';
      wrap.style.transform = '';
      pull = 0; edge = 0;
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', release);
    window.addEventListener('touchcancel', release);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', release);
      window.removeEventListener('touchcancel', release);
    };
  }, []);
  const visibleDays: { date: string; rows: LedgerRow[] }[] = [];
  for (const t of visibleTxns) {
    const last = visibleDays[visibleDays.length - 1];
    if (!last || last.date !== t.date) visibleDays.push({ date: t.date, rows: [t] });
    else last.rows.push(t);
  }

  // ── Selection / bulk ─────────────────────────────────────────────────────────
  const selectedCount = selectedTxnIds.size;

  const toggleTxn = (id: string) => {
    setSelectedTxnIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const selectedTxns = (ledger || []).filter(t => selectedTxnIds.has(t.txn_id));
  const selectedCategories = Array.from(new Set(selectedTxns.map((t) => t.category).filter(Boolean))) as string[];
  const hasAmendedSelected = selectedTxns.some((t) => t.amendments?.length > 0);
  const voidableSelected = selectedTxns.filter((t) => t.status !== 'Voided');

  // ── Drag-to-sum, direction-aware ────────────────────────────────────────────
  const sumRows = (ledger || []).filter((t) => sumSel.has(t.txn_id));
  let sumOut = 0, sumIn = 0;
  for (const t of sumRows) { if (deriveDirection(t) === 'in') sumIn += Number(t.total_amount); else sumOut += Number(t.total_amount); }
  const sumNet = sumIn - sumOut;

  const exportCSV = () => {
    const txnsToExport = selectedCount > 0 ? selectedTxns : filteredTransactions;
    const rows = txnsToExport.flatMap((t) => {
      const allocs = t.txn_allocations || [];
      const dir = deriveDirection(t);
      if (allocs.length === 0) return [[t.txn_id, t.date, payeeLabel(t), getTxnType(t), dir, t.category || '', t.payment_mode || '', t.total_amount, '', t.status]];
      return allocs.map((a: TxnAlloc) => [t.txn_id, t.date, payeeLabel(t), getTxnType(t), dir, t.category || '', t.payment_mode || '', t.total_amount, a.projects?.name || '', t.status]);
    });
    const header = ['TXN ID', 'Date', 'Payee', 'Type', 'Direction', 'Category', 'Mode', 'Amount', 'Project', 'Status'];
    const csv = [header, ...rows].map(r => r.map((v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `briklay-transactions-${new Date().toISOString().split('T')[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const uniqueProjects = Array.from(new Set((ledger || []).flatMap((t) => (t.txn_allocations || []).map((a: TxnAlloc) => a.projects?.name).filter(Boolean)))) as string[];
  const uniqueTypes = ['Worker Payment', 'Material Purchase', 'General Expense', 'Client Receipt'];

  // ── Filter chip + dropdown (reference look, multi-select body) ───────────────
  const openDrop = (key: string, e: MouseEvent) => {
    if (activeFilterDropdown === key) { setActiveFilterDropdown(null); return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setChipDropPos({ top: rect.bottom + 6, left: rect.left });
    setActiveFilterDropdown(key);
  };

  const multiDropdown = (options: string[], current: string[], setFilter: (f: string[]) => void) =>
    chipDropPos && createPortal(
      <div ref={chipDropRef} className="rounded-xl overflow-hidden" style={{ position: 'fixed', top: chipDropPos.top, left: chipDropPos.left, zIndex: 9999, width: 220, background: V.surface, border: `1px solid ${V.line}`, boxShadow: '0 10px 30px rgba(30,26,21,0.12)' }}>
        <div className="px-3 py-2 flex gap-4" style={{ borderBottom: `1px solid ${V.line}` }}>
          <button className="text-xs font-semibold" style={{ color: V.terraDeep, ...font }} onClick={() => setFilter([...options])}>Select all</button>
          <button className="text-xs font-semibold" style={{ color: V.faint, ...font }} onClick={() => setFilter([])}>Clear</button>
        </div>
        <div className="py-1 max-h-60 overflow-y-auto">
          {options.length === 0 && <p className="px-3 py-2 text-xs" style={{ color: V.faint, ...font }}>None</p>}
          {options.map(opt => (
            <button key={opt} type="button" className="w-full flex items-center gap-2.5 px-3 py-2 text-left" style={{ ...font }}
              onClick={() => setFilter(current.includes(opt) ? current.filter(v => v !== opt) : [...current, opt])}>
              <span className="flex items-center justify-center rounded shrink-0" style={{ width: 16, height: 16, border: `1.5px solid ${current.includes(opt) ? V.terra : V.line}`, background: current.includes(opt) ? V.terra : 'transparent' }}>
                {current.includes(opt) && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
              </span>
              <span className="text-sm truncate" style={{ color: V.ink }}>{opt}</span>
            </button>
          ))}
        </div>
      </div>,
      document.body,
    );

  const datePresets: { k: DatePreset; label: string }[] = [
    { k: 'today', label: 'Today' }, { k: 'week', label: 'This week' }, { k: 'month', label: 'This month' },
    { k: 'last_month', label: 'Last month' }, { k: 'quarter', label: 'This quarter' }, { k: 'fy', label: 'Financial year' }, { k: 'all', label: 'All time' },
    { k: 'custom', label: 'Custom range…' },
  ];

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div ref={elasticRef} className="min-h-screen" style={{ background: V.page, ...font, overscrollBehaviorY: 'contain' }}>
      <style>{TRACK_CHIP_CSS}</style>
      {importOpen && (
        <Suspense fallback={<div className="fixed inset-0 z-[1000]" style={{ background: 'rgba(30,26,21,0.55)' }} />}>
          <ImportTransactions session={session} onClose={closeImport} />
        </Suspense>
      )}
      <style>{LEDGER_BAND_CSS}</style>

      {/* slim espresso bar — slides in once the band scrolls away */}
      <div className={`txn-mini${miniShow ? ' show' : ''}`}>
        <div className="in">
          <span className="t">Transactions</span>
          <span className="p"><span className="sep">{periodLabel} · </span><span className="num">{netLabel}</span></span>
          <span className="mc">
            {unlinkedCount > 0 && (
              <button onClick={() => setFilterUnlinked(v => !v)} style={{ color: 'inherit', textDecoration: filterUnlinked ? 'underline' : 'none', textUnderlineOffset: 3 }}>
                <span className="num">{unlinkedCount}</span> not linked
              </button>
            )}
            <span style={{ opacity: 0.45 }}>{unlinkedCount > 0 ? ' · ' : ''}</span>
            {filteredTransactions.length} {filteredTransactions.length === 1 ? 'entry' : 'entries'}
            <span className="sm:hidden"> · {periodLabel}</span>
          </span>
        </div>
      </div>

      {/* ── header band — bitter chocolate + the nav's cursor lamp + a 14-day outflow sparkline ── */}
      <header ref={bandRef} className="txn-band">
        <div className="tb-fx tb-grid" aria-hidden="true" />
        <div className="tb-fx tb-glow" aria-hidden="true" />
        <div className="tb-in">
          <div className="tb-top">
            <h1 className="tb-h1">Transactions</h1>
            <div className="tb-actions">
              <button className="tb-btn" onClick={() => setImportOpen(true)}>Import</button>
              <NewTxnMenuButton className="tb-btn primary"><Plus size={15} /> New transaction</NewTxnMenuButton>
            </div>
          </div>
          <div className="tb-lead">
            <span className="tb-amt">{netLabel}<span className="k">net</span></span>
            <div className="tb-meta">
              <span className="num">+ ₹{inr(monthIn)}</span> in <i>|</i> <span className="num">− ₹{inr(monthOut)}</span> out <i>·</i> {periodLabel} <i>·</i> {filteredTransactions.length} {filteredTransactions.length === 1 ? 'entry' : 'entries'}
            </div>
          </div>
        </div>
        <Rhythm data={spark} onPick={(iso) => {
          const el = document.getElementById(`txn-day-${iso}`);
          if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 56, behavior: 'smooth' });
        }} />
      </header>

      <div className="mx-auto px-5 sm:px-8 py-4 sm:py-8 max-w-[880px] lg:max-w-[1040px] xl:max-w-[1200px] min-[1700px]:max-w-[1640px] min-[1700px]:grid min-[1700px]:grid-cols-[minmax(0,1fr)_340px] min-[1700px]:gap-12 min-[1700px]:items-start">

        {/* ── main column: the day-book ── */}
        <div className="min-w-0">

        {/* subtle invite: has entries, but never set up WhatsApp capture. Quiet,
            dismissible, manager-only — a builder typing every entry by hand may
            not know the site can send them in. */}
        {canManageTeam && (ledger?.length ?? 0) > 0 && dayBookReviewCount === 0 && activeSenders === 0 && !waHintDismissed && (
          <div className="flex items-center gap-3 mt-6 px-3.5 py-2.5 rounded-xl" style={{ background: V.surface, border: `1px solid ${V.line}`, ...font }}>
            <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: V.field }}>
              <WhatsAppGlyph size={14} color="#1FA855" />
            </span>
            <p className="text-sm min-w-0 flex-1" style={{ color: V.sys }}>
              Let your site send payments and bills on WhatsApp. You just check them, and they land here.
            </p>
            <button onClick={() => navigate('/logbook')} className="text-sm font-medium whitespace-nowrap shrink-0" style={{ color: V.terraDeep }}>
              Set up WhatsApp →
            </button>
            <button onClick={dismissWaHint} aria-label="Dismiss" className="shrink-0">
              <X size={15} style={{ color: V.faint }} />
            </button>
          </div>
        )}

        {/* subtle reassurance: set up, but no one has sent anything yet. Nudges the
            team to start, and tells the builder where it will land. */}
        {canManageTeam && (ledger?.length ?? 0) > 0 && dayBookReviewCount === 0 && activeSenders > 0 && totalCaptures === 0 && !waIdleDismissed && (
          <div className="flex items-center gap-3 mt-6 px-3.5 py-2.5 rounded-xl" style={{ background: V.surface, border: `1px solid ${V.line}`, ...font }}>
            <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: V.field }}>
              <WhatsAppGlyph size={14} color="#1FA855" />
            </span>
            <p className="text-sm min-w-0 flex-1" style={{ color: V.sys }}>
              You or your team can now message Briklay on WhatsApp. Each one waits in For review, and once you approve it, it lands here.
            </p>
            <span className="shrink-0"><StartOnWhatsAppButton tone="link" label="Start sending" /></span>
            <button onClick={dismissWaIdle} aria-label="Dismiss" className="shrink-0">
              <X size={15} style={{ color: V.faint }} />
            </button>
          </div>
        )}

        {/* filters — desktop chip bar */}
        <div ref={filterBarRef} className="hidden sm:flex items-center gap-2 flex-wrap mt-7">
          <FilterChip active onClick={(e) => openDrop('date', e)}>{periodLabel}</FilterChip>
          {activeFilterDropdown === 'date' && chipDropPos && createPortal(
            <div ref={chipDropRef} className="rounded-xl overflow-hidden py-1" style={{ position: 'fixed', top: chipDropPos.top, left: chipDropPos.left, zIndex: 9999, width: datePreset === 'custom' ? 250 : 200, background: V.surface, border: `1px solid ${V.line}`, boxShadow: '0 10px 30px rgba(30,26,21,0.12)' }}>
              {datePresets.map(d => (
                <button key={d.k} type="button" className="w-full text-left px-3 py-2 text-sm" style={{ color: datePreset === d.k ? V.terraDeep : V.ink, background: datePreset === d.k ? V.terraWash : 'transparent', ...font }}
                  onClick={() => { setDatePreset(d.k); if (d.k !== 'custom') setActiveFilterDropdown(null); }}>
                  {d.label}
                </button>
              ))}
              {datePreset === 'custom' && (
                <div className="px-3 pt-2 pb-1 mt-1" style={{ borderTop: `1px solid ${V.line}` }}>
                  <label className="block text-[11px] mb-1" style={{ color: V.faint, ...font }}>From</label>
                  <input type="date" value={customRange.from} max={customRange.to || undefined}
                    onChange={e => setCustomRange(r => ({ ...r, from: e.target.value }))}
                    className="w-full mb-2 px-2 py-1.5 text-sm rounded-lg" style={{ border: `1px solid ${V.line}`, background: V.surface, color: V.ink, ...font }} />
                  <label className="block text-[11px] mb-1" style={{ color: V.faint, ...font }}>To</label>
                  <input type="date" value={customRange.to} min={customRange.from || undefined}
                    onChange={e => setCustomRange(r => ({ ...r, to: e.target.value }))}
                    className="w-full px-2 py-1.5 text-sm rounded-lg" style={{ border: `1px solid ${V.line}`, background: V.surface, color: V.ink, ...font }} />
                  <button type="button" className="mt-2 w-full text-center text-sm font-semibold py-1.5 rounded-lg" style={{ color: V.terraDeep, background: V.terraWash, ...font }}
                    onClick={() => setActiveFilterDropdown(null)}>Done</button>
                </div>
              )}
            </div>,
            document.body,
          )}

          <FilterChip active={filterType.length > 0} onClick={(e) => openDrop('type', e)}>
            {filterType.length === 1 ? filterType[0] : filterType.length > 1 ? `Type: ${filterType.length}` : 'Type'}
          </FilterChip>
          {activeFilterDropdown === 'type' && multiDropdown(uniqueTypes, filterType, setFilterType)}

          {/* The site filter is for CHOOSING a project, and under one it is already chosen. */}
          {!lockedProject && (
            <>
              <FilterChip active={filterProject.length > 0} onClick={(e) => openDrop('project', e)}>
                {filterProject.length === 1 ? filterProject[0] : filterProject.length > 1 ? `Site: ${filterProject.length}` : 'Site'}
              </FilterChip>
              {activeFilterDropdown === 'project' && multiDropdown(uniqueProjects, filterProject, setFilterProject)}
            </>
          )}

          {/* "not linked" is a quiet, neutral toggle here (and echoed in the slim scroll bar) — never a
              loud yellow pill; it's a housekeeping cue, not a warning. */}
          {unlinkedCount > 0 && (
            <FilterChip active={filterUnlinked} hasDropdown={false} onClick={() => setFilterUnlinked(v => !v)}>
              {unlinkedCount} not linked
            </FilterChip>
          )}

          <span className="hidden sm:block flex-1" />

          <div className="inline-flex items-center gap-2 px-3 rounded-full flex-1 sm:flex-initial" style={{ background: V.surface, border: `1px solid ${V.line}`, height: 36, minWidth: 180 }}>
            <Search size={14} style={{ color: V.faint }} />
            <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search payee, order, remark" className="bg-transparent text-sm outline-none flex-1 min-w-0" style={{ color: V.ink, ...font }} />
          </div>
          <button onClick={exportCSV} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full" style={{ background: V.surface, border: `1px solid ${V.line}`, color: V.inkSoft, ...font }}>
            <Download size={13} style={{ color: V.faint }} /> Export
          </button>
        </div>

        {/* filters — mobile: one Filters button + a collapsed in/out/net pill + search */}
        {(() => {
          const activeFilterCount =
            (filterType.length ? 1 : 0) + (!lockedProject && filterProject.length ? 1 : 0) +
            (filterUnlinked ? 1 : 0) + (datePreset !== 'all' ? 1 : 0);
          return (
            <div className="sm:hidden mt-2 space-y-2.5">
              {/* filter · search · download — one aligned row */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFiltersOpen(true)}
                  aria-label={activeFilterCount ? `Filters (${activeFilterCount} active)` : 'Filters'}
                  className="inline-flex items-center gap-1.5 rounded-full shrink-0 active:scale-95 transition-transform"
                  style={{ height: 40, padding: activeFilterCount ? '0 12px' : '0', width: activeFilterCount ? undefined : 40, justifyContent: 'center', background: V.surface, border: `1px solid ${activeFilterCount ? V.terra : V.line}`, color: activeFilterCount ? V.terraDeep : V.inkSoft }}
                >
                  <SlidersHorizontal size={16} />
                  {activeFilterCount > 0 && (
                    <span className="inline-flex items-center justify-center text-[11px] font-bold rounded-full" style={{ minWidth: 17, height: 17, padding: '0 5px', background: V.terra, color: '#fff' }}>{activeFilterCount}</span>
                  )}
                </button>
                <div className="inline-flex items-center gap-2 px-3 rounded-full flex-1 min-w-0" style={{ background: V.surface, border: `1px solid ${V.line}`, height: 40 }}>
                  <Search size={15} style={{ color: V.faint, flexShrink: 0 }} />
                  <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search" className="bg-transparent text-sm outline-none flex-1 min-w-0" style={{ color: V.ink, ...font }} />
                  {searchTerm && <button onClick={() => setSearchTerm('')} aria-label="Clear search" className="shrink-0"><X size={15} style={{ color: V.faint }} /></button>}
                </div>
                <button onClick={exportCSV} aria-label="Export CSV" className="inline-flex items-center justify-center rounded-full shrink-0 active:scale-95 transition-transform" style={{ width: 40, height: 40, background: V.surface, border: `1px solid ${V.line}` }}>
                  <Download size={16} style={{ color: V.faint }} />
                </button>
              </div>
            </div>
          );
        })()}

        {/* mobile filter sheet — every filter in one place */}
        <BottomSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
          {(() => {
            const chip = (label: string, on: boolean, onClick: () => void) => (
              <button key={label} onClick={onClick} className="px-3 py-2 rounded-full text-sm active:scale-[0.97] transition-transform"
                style={{ background: on ? V.terraWash : V.field, color: on ? V.terraDeep : V.inkSoft, border: `1px solid ${on ? V.terra : 'transparent'}`, ...font }}>
                {label}
              </button>
            );
            const toggle = (opt: string, cur: string[], set: (f: string[]) => void) =>
              chip(opt, cur.includes(opt), () => set(cur.includes(opt) ? cur.filter(v => v !== opt) : [...cur, opt]));
            const label = { color: V.faint, letterSpacing: '0.06em', ...font } as const;
            return (
              <div className="px-5 pb-5 space-y-5">
                <div>
                  <p className="text-[11px] font-semibold uppercase mb-2.5" style={label}>Period</p>
                  <div className="flex flex-wrap gap-2">
                    {datePresets.map(d => chip(d.label, datePreset === d.k, () => setDatePreset(d.k)))}
                  </div>
                  {datePreset === 'custom' && (
                    <div className="flex items-center gap-2 mt-3">
                      <input type="date" value={customRange.from} max={customRange.to || undefined}
                        onChange={e => setCustomRange(r => ({ ...r, from: e.target.value }))}
                        className="flex-1 min-w-0 px-3 rounded-xl text-sm" style={{ height: 44, border: `1px solid ${V.line}`, background: V.field, color: V.ink, ...font }} />
                      <span style={{ color: V.faint }}>–</span>
                      <input type="date" value={customRange.to} min={customRange.from || undefined}
                        onChange={e => setCustomRange(r => ({ ...r, to: e.target.value }))}
                        className="flex-1 min-w-0 px-3 rounded-xl text-sm" style={{ height: 44, border: `1px solid ${V.line}`, background: V.field, color: V.ink, ...font }} />
                    </div>
                  )}
                </div>
                {uniqueTypes.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase mb-2.5" style={label}>Type</p>
                    <div className="flex flex-wrap gap-2">{uniqueTypes.map(o => toggle(o, filterType, setFilterType))}</div>
                  </div>
                )}
                {!lockedProject && uniqueProjects.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase mb-2.5" style={label}>Project</p>
                    <div className="flex flex-wrap gap-2">{uniqueProjects.map(o => toggle(o, filterProject, setFilterProject))}</div>
                  </div>
                )}
                {unlinkedCount > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase mb-2.5" style={label}>Linkage</p>
                    {chip(`${unlinkedCount} not linked`, filterUnlinked, () => setFilterUnlinked(v => !v))}
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    // "Clear all" clears the filters HE chose. It does not clear the project he is
                    // standing in — that is not a filter, it is the address. Wiping it would silently
                    // show him every site's money on a page titled with one site's name.
                    onClick={() => {
                      setDatePreset('all');
                      setCustomRange({ from: '', to: '' });
                      setFilterType([]);
                      setFilterProject(lockedProject ? [lockedProject] : []);
                      setFilterUnlinked(false);
                    }}
                    className="px-4 rounded-xl text-sm font-medium" style={{ height: 46, background: V.field, color: V.inkSoft, ...font }}
                  >
                    Clear all
                  </button>
                  <button
                    onClick={() => setFiltersOpen(false)}
                    className="flex-1 rounded-xl text-sm font-semibold" style={{ height: 46, background: terraGrad, color: '#fff', ...font }}
                  >
                    Show {filteredTransactions.length} {filteredTransactions.length === 1 ? 'entry' : 'entries'}
                  </button>
                </div>
              </div>
            );
          })()}
        </BottomSheet>

        {/* the day-book */}
        {ledgerGate ? ledgerGate : visibleDays.length === 0 ? (
          (ledger?.length ?? 0) === 0 ? (
            // nothing filed yet anywhere — teach how the ledger fills itself
            <LedgerEmpty
              reviewCount={dayBookReviewCount}
              onReview={() => navigate('/logbook')}
              onNew={() => navigate('/ledger/new')}
            />
          ) : (
            // there are entries, just not in this slice — stay quiet, offer a wider lens
            <div className="text-center mt-16">
              <p className="text-sm" style={{ color: V.faint, ...font }}>Nothing in {periodLabel}.</p>
              {datePreset !== 'all' && (
                <button onClick={() => setDatePreset('all')} className="text-sm font-semibold mt-2" style={{ color: V.terraDeep, ...font }}>
                  View all time →
                </button>
              )}
            </div>
          )
        ) : (
          visibleDays.map(day => {
            const tot = dayTotals.get(day.date) ?? { out: 0, in: 0 };
            const weekday = new Date(day.date).toLocaleDateString('en-IN', { weekday: 'long' });
            const dshort = new Date(day.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
            return (
              <section className="mt-4 sm:mt-7 mo-rise-day" key={day.date} id={`txn-day-${day.date}`} style={{ scrollMarginTop: 60 }}>
                <p className="px-4 py-2 text-sm sticky top-0" style={{ background: V.page, color: V.ink, zIndex: 2, ...serif }}>
                  {dshort} <span className="text-xs" style={{ color: V.faint, ...font }}>· {weekday}</span>
                </p>
                <div className="rounded-2xl pt-1 overflow-hidden relative" style={{ background: V.surface, border: '1px solid #E3DDD4' }}>
                  {/* the spine: one thread of money through the day */}
                  <div aria-hidden="true" className="absolute" style={{ left: 29, top: 16, bottom: 64, width: 1, background: V.line }} />

                  {day.rows.map((txn) => {
                    const dir = deriveDirection(txn);
                    const primaryAlloc = (txn.txn_allocations || []).find((a: TxnAlloc) => a.order_type) ?? null;
                    const anchor: TxnAnchor = dir === 'in'
                      ? resolveAnchor(txn, null)
                      : isNotLinked(txn) ? null : resolveAnchor(txn, primaryAlloc);
                    const genExp = isGeneralExpense(txn);
                    const genLabel = genExp ? generalExpenseLabel(txn) : '';
                    const projName = (txn.txn_allocations || [])[0]?.projects?.name || null;
                    const trade = txn.stakeholders?.category || null;
                    // Context = the payee's discipline/trade + what the money was for
                    // (description) — not the "Worker/Vendor" type label. A general expense
                    // leads with its KIND (the GEN head) on the bold line, so the context
                    // carries its free-text description.
                    const ctxParts = genExp ? [txn.remarks] : [trade, txn.remarks];
                    if (!(filterProject.length === 1) && projName) ctxParts.push(projName);
                    const context = ctxParts.filter(Boolean).join(' · ');
                    const proofUrl = txn.bill_doc_url || txn.proof_document_url || null;
                    // Silent depth cue: how many OTHER open obligations of the same kind
                    // this party has (beyond the one shown). Drives the stacked-card edge.
                    const linkedInfo = anchor && (anchor.kind === 'WO' || anchor.kind === 'PO') ? orderMap[anchor.ref] : undefined;
                    // Use the linked ORDER's project (same source the count is keyed on) so the
                    // lookup can't miss; fall back to the allocation's project.
                    const siteProjectId = linkedInfo?.project || (primaryAlloc?.project_id ? String(primaryAlloc.project_id) : '');
                    const siteName = (primaryAlloc?.projects as any)?.name ?? null;
                    const partyOpenCount = anchor && txn.stakeholder_id && (anchor.kind === 'WO' || anchor.kind === 'PO')
                      ? (partyOpen[`${txn.stakeholder_id}::${siteProjectId}`]?.[anchor.kind] ?? 0)
                      : 0;
                    const linkedOpen = linkedInfo ? (linkedInfo.total - linkedInfo.paid) > 0 : false;
                    const siblings = Math.max(0, partyOpenCount - (linkedOpen ? 1 : 0));
                    // The "not linked" region — the ONLY part of the row that changes:
                    //  · general expense -> a calm, non-actionable note (no tracking needed)
                    //  · an unlinked outgoing payment to a party -> the gentle Track nudge
                    //  · otherwise -> the existing AnchorChip (linked ref, or default)
                    const anchorNode: ReactNode =
                      genExp
                        ? <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md" style={{ background: V.field, color: V.inkSoft, ...font }}><span className="shrink-0 rounded-full" style={{ width: 5, height: 5, background: V.faint }} />Overhead <span style={{ color: V.faint }}>· no party</span></span>
                        : (anchor === null && dir === 'out' && txn.stakeholder_id && (txn.txn_allocations || []).length > 0 && txn.status !== 'Voided')
                          ? <TrackChip txn={txn} onLinked={() => { qc.invalidateQueries({ queryKey: ['ledger'] }); }} />
                          : undefined;
                    return (
                      <div
                        key={txn.txn_id}
                        id={`ledger-txn-${txn.txn_id}`}
                        style={{ scrollMarginTop: 40, ...(focusTxn === txn.txn_id ? { borderRadius: 12, boxShadow: '0 0 0 2px #C8603A', transition: 'box-shadow .3s' } : {}) }}
                      >
                      <EntryRow
                        dir={dir}
                        payee={genExp ? genLabel : (txn.stakeholders?.name || 'Unknown')}
                        stakeholderId={genExp ? null : (txn.stakeholder_id ?? null)}
                        onPayeeClick={isPhone ? undefined : () => { if (txn.stakeholder_id) { setDrawerProject(txn.stakeholder_id === deepLinkStk ? deepLinkProject : null); setDrawerStk(txn.stakeholder_id); } }}
                        context={context}
                        anchor={anchor}
                        info={linkedInfo}
                        siblings={siblings}
                        partyName={txn.stakeholders?.name ?? null}
                        siteName={siteName}
                        remark={null}
                        amount={inr(Number(txn.total_amount))}
                        attach={!!proofUrl}
                        voided={txn.status === 'Voided'}
                        flagged={txn.ai_flag_status === 'Flagged' && txn.status !== 'Voided'}
                        selected={selectedTxnIds.has(txn.txn_id)}
                        selectionMode={selectedCount > 0}
                        sumSelected={sumSel.has(txn.txn_id)}
                        anchorNode={anchorNode}
                        onRowClick={() => navigate(`/ledger/${txn.txn_id}`)}
                        onToggleSelect={(e) => { e.stopPropagation(); toggleTxn(txn.txn_id); }}
                        onAnchorClick={() => {
                          // A linked WO/PO chip opens that order's card; CLIENT/unlinked
                          // chips fall back to the transaction peek.
                          if (anchor && (anchor.kind === 'WO' || anchor.kind === 'PO')) openPeek(anchor.kind, anchor.ref);
                          else openPeek('TRANSACTION', txn.txn_id);
                        }}
                        onAnchorHover={() => {
                          // Warm the cache so the click paints instantly.
                          if (anchor && (anchor.kind === 'WO' || anchor.kind === 'PO')) prefetchPeek(anchor.kind, anchor.ref);
                          else prefetchPeek('TRANSACTION', txn.txn_id);
                        }}
                        onUnlink={anchor && (anchor.kind === 'WO' || anchor.kind === 'PO') && txn.status !== 'Voided'
                          ? async () => {
                              try {
                                await unlinkTxnOrder({ txn_id: txn.txn_id, status: txn.status }, orgId ?? '');
                                // Every dimension derives from txn_allocations, so refresh each view that
                                // reads them — the list, the txn detail page's allocations, the party
                                // ledger, the PO paid/balance — so an already-open page reflects the unlink.
                                qc.invalidateQueries({ queryKey: ['ledger'] });
                                qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
                                qc.invalidateQueries({ queryKey: ['txn_allocations', txn.txn_id] });
                                qc.invalidateQueries({ queryKey: ['transactions'] });
                                qc.invalidateQueries({ queryKey: ['party_ledger'] });
                                if (anchor && anchor.kind === 'PO') { qc.invalidateQueries({ queryKey: ['po_detail', anchor.ref] }); qc.invalidateQueries({ queryKey: ['po_linked_txns', anchor.ref] }); }
                                if (anchor && anchor.kind === 'WO') qc.invalidateQueries({ queryKey: ['wo_allocations', anchor.ref] });
                              } catch (e) { window.alert(e instanceof Error ? e.message : 'Could not unlink'); }
                            }
                          : undefined}
                        onAttach={async () => { const u = await resolveDocUrl(proofUrl); if (u) setLightboxUrl(u); }}
                        onAmountDown={() => { setIsDragging(true); setSumSel(new Set([txn.txn_id])); }}
                        onAmountEnter={() => { if (isDragging) setSumSel(prev => new Set(prev).add(txn.txn_id)); }}
                      />
                      </div>
                    );
                  })}

                  {/* ruling off: the bookkeeper closes the day */}
                  <div className="flex items-baseline justify-between px-4 py-3 mt-1" style={{ borderTop: `1px solid ${V.line}` }}>
                    <p className="text-sm" style={{ color: V.inkSoft, ...serif, fontStyle: 'italic' }}>Day closed</p>
                    <div className="text-right">
                      <p className="text-sm" style={{ color: V.inkSoft, ...serif, ...nums }}>
                        <span style={{ color: V.terraDeep }}>− ₹{inr(tot.out)}</span>
                        <span className="mx-2" style={{ color: V.faint }}>·</span>
                        <span style={{ color: V.sage }}>+ ₹{inr(tot.in)}</span>
                      </p>
                      <div className="mt-1.5 ml-auto" style={{ width: 148, borderTop: `1px solid ${V.inkSoft}`, borderBottom: `1px solid ${V.inkSoft}`, height: 4 }} />
                    </div>
                  </div>
                </div>
              </section>
            );
          })
        )}

        {/* auto-load sentinel: nearing this reveals the next page (no click needed) */}
        {hasMore && (
          <div ref={loadMoreRef} className="flex items-center justify-center gap-2 mt-6 px-1" style={{ minHeight: 44 }}>
            <span
              className="animate-spin"
              style={{ width: 16, height: 16, border: `2px solid ${V.line}`, borderTopColor: V.terra, borderRadius: '50%', opacity: loadingMore ? 1 : 0.45, transition: 'opacity .2s' }}
            />
            <span className="text-xs" style={{ color: V.faint, ...font }}>
              {loadingMore ? 'Loading more…' : `Showing ${visibleTxns.length} of ${sortedTxns.length}`}
            </span>
          </div>
        )}
        </div>{/* /main column */}

        {/* ── summary rail: only on extra-wide (≥1700px) screens; below that the book itself widens ── */}
        <aside className="hidden min-[1700px]:block">
          <div className="sticky top-8 rounded-2xl p-5" style={{ background: V.surface, border: '1px solid #E3DDD4' }}>
            <p className="text-[11px] uppercase" style={{ color: V.faint, letterSpacing: '0.07em', ...font }}>Period</p>
            <p className="text-xl mt-1" style={{ color: V.ink, ...serif }}>{periodLabel}</p>
            <p className="text-xs mt-1" style={{ color: V.sys, ...font, ...nums }}>
              {filteredTransactions.length} {filteredTransactions.length === 1 ? 'entry' : 'entries'}
            </p>

            <div className="mt-4 flex h-2 rounded-full overflow-hidden" style={{ background: V.field }}>
              <div style={{ width: `${100 - outPct}%`, background: V.sage, opacity: 0.85 }} />
              <div style={{ width: `${outPct}%`, background: V.terra, opacity: 0.8 }} />
            </div>

            <div className="mt-5">
              <p className="text-xs" style={{ color: V.faint, ...font }}>Net flow</p>
              <p className="text-2xl mt-0.5" style={{ color: monthNet < 0 ? V.terraDeep : V.sage, ...serif, ...nums }}>{netLabel}</p>
            </div>

            <div className="mt-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-sm" style={{ color: V.inkSoft, ...font }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: V.sage }} /> Money in
                </span>
                <span className="text-sm" style={{ color: V.sage, ...font, ...nums }}>+ ₹{inr(monthIn)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-sm" style={{ color: V.inkSoft, ...font }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: V.terra }} /> Money out
                </span>
                <span className="text-sm" style={{ color: V.terraDeep, ...font, ...nums }}>− ₹{inr(monthOut)}</span>
              </div>
            </div>

            {unlinkedCount > 0 && (
              <button
                onClick={() => setFilterUnlinked(v => !v)}
                className="mt-4 w-full text-left text-xs px-3 py-2 rounded-xl"
                style={{ background: filterUnlinked ? V.terraWash : V.field, border: `1px solid ${filterUnlinked ? '#EFD6C9' : 'transparent'}`, color: filterUnlinked ? V.terraDeep : V.inkSoft, ...font }}
              >
                {unlinkedCount} not linked yet · {filterUnlinked ? 'showing' : 'review'}
              </button>
            )}

            <button
              onClick={exportCSV}
              className="mt-4 w-full inline-flex items-center justify-center gap-1.5 text-sm py-2 rounded-xl"
              style={{ border: `1px solid ${V.line}`, color: V.inkSoft, ...font }}
            >
              <Download size={13} style={{ color: V.faint }} /> Export period
            </button>
          </div>
        </aside>

      </div>

      {/* direction-aware drag-to-sum panel */}
      {sumSel.size > 1 && selectedCount === 0 && (
        <div className="fixed bottom-4 right-4 rounded-xl shadow-lg p-3 z-50" style={{ background: 'rgba(255,255,255,0.97)', border: `1px solid ${V.line}`, ...font }}>
          <p className="text-xs" style={{ color: V.faint }}>{sumSel.size} selected</p>
          <p className="text-[15px] font-medium mt-0.5" style={{ ...nums, color: sumNet < 0 ? V.terraDeep : V.sage }}>
            net {sumNet < 0 ? '−' : '+'} ₹{inr(Math.abs(sumNet))}
          </p>
          <p className="text-xs mt-0.5" style={{ ...nums }}>
            <span style={{ color: V.terraDeep }}>− ₹{inr(sumOut)}</span>
            <span className="mx-1.5" style={{ color: V.line }}>·</span>
            <span style={{ color: V.sage }}>+ ₹{inr(sumIn)}</span>
          </p>
        </div>
      )}

      <ImageLightbox url={lightboxUrl} title="Payment Proof" onClose={() => setLightboxUrl(null)} />

      {drawerStk && (
        <StakeholderLedgerDrawer isOpen={!!drawerStk} onClose={() => setDrawerStk(null)} stakeholderId={drawerStk} projectId={drawerProject} />
      )}

      {/* bulk action bar */}
      {selectedCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pb-4 px-4 pointer-events-none">
          <div className="pointer-events-auto bg-on-surface/95 backdrop-blur-sm text-surface rounded-2xl shadow-2xl px-5 py-3 flex items-center gap-3 flex-wrap animate-in slide-in-from-bottom-4 duration-200">
            <span className="text-[13px] font-semibold whitespace-nowrap text-surface/90">{selectedCount} selected</span>
            <div className="w-px h-5 bg-surface/20" />
            <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold bg-surface/10 hover:bg-surface/20 transition-colors">
              <span className="material-symbols-outlined text-[16px]">download</span>Export CSV
            </button>
            <button onClick={() => { setRecatCategory(''); setShowRecategorize(true); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold bg-surface/10 hover:bg-surface/20 transition-colors">
              <span className="material-symbols-outlined text-[16px]">category</span>Re-categorize
            </button>
            {(profile?.role === 'management' || profile?.role === 'accountant' || profile?.role === 'principal') && voidableSelected.length > 0 && (
              <button onClick={() => setShowVoidAll(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold bg-error/80 hover:bg-error transition-colors text-white">
                <span className="material-symbols-outlined text-[16px]">block</span>Void All
              </button>
            )}
            <button onClick={() => setSelectedTxnIds(new Set())} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[12px] font-bold hover:bg-surface/10 transition-colors ml-1 text-surface/60 hover:text-surface">
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        </div>
      )}

      {/* Re-categorize modal */}
      {showRecategorize && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowRecategorize(false)}>
          <div className="bg-surface-container-lowest rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <h3 className="text-headline-sm font-bold mb-1">Re-categorize {selectedCount} transaction{selectedCount !== 1 ? 's' : ''}</h3>
            {selectedCategories.length > 1 ? (
              <p className="text-body-sm text-on-surface-variant mb-4">
                <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded text-[11px] font-bold mr-1">
                  <span className="material-symbols-outlined text-[13px]">warning</span>Mixed types
                </span>
                Current: <span className="font-semibold">{selectedCategories.join(', ')}</span>
              </p>
            ) : (
              <p className="text-body-sm text-on-surface-variant mb-4">Current: <span className="font-semibold">{selectedCategories[0] || '—'}</span></p>
            )}
            <div className="space-y-2 mb-5">
              <label className="text-label-caps font-label-caps text-on-surface-variant">NEW CATEGORY</label>
              <select value={recatCategory} onChange={e => setRecatCategory(e.target.value)} className="bk-input w-full">
                <option value="">Select category…</option>
                {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowRecategorize(false)} className="bk-btn-ghost px-4 py-2 rounded-xl text-body-sm">Cancel</button>
              <button disabled={!recatCategory || recatMutation.isPending}
                onClick={() => recatMutation.mutate({ ids: Array.from(selectedTxnIds), category: recatCategory })}
                className="bk-btn px-4 py-2 rounded-xl text-body-sm disabled:opacity-50">
                {recatMutation.isPending ? 'Applying…' : `Apply to all ${selectedCount}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Void all modal */}
      {showVoidAll && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowVoidAll(false)}>
          <div className="bg-surface-container-lowest rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-error-container flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-error">block</span>
              </div>
              <div>
                <h3 className="text-headline-sm font-bold">Void {voidableSelected.length} transaction{voidableSelected.length !== 1 ? 's' : ''}?</h3>
                <p className="text-body-sm text-on-surface-variant mt-1">This cannot be undone.</p>
              </div>
            </div>
            {hasAmendedSelected && (
              <div className="mb-4 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-amber-800 text-[12px]">
                <span className="material-symbols-outlined text-[16px]">warning</span>
                Some transactions have amendments — voiding will also void their amendments.
              </div>
            )}
            <div className="mb-5 max-h-40 overflow-y-auto bg-surface-container-low rounded-xl border border-outline-variant/30 p-3 space-y-1">
              {voidableSelected.map((t) => (
                <div key={t.txn_id} className="flex items-center justify-between text-body-sm">
                  <span className="font-data-mono">{t.txn_id}</span>
                  <span className="text-on-surface-variant text-[12px]">₹{Number(t.total_amount).toLocaleString('en-IN')}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowVoidAll(false)} className="bk-btn-ghost px-4 py-2 rounded-xl text-body-sm">Cancel</button>
              <button disabled={voidAllMutation.isPending}
                onClick={() => voidAllMutation.mutate(voidableSelected.map((t) => t.txn_id))}
                className="px-4 py-2 rounded-xl text-body-sm font-bold bg-error text-on-error hover:bg-error/90 transition-colors disabled:opacity-50">
                {voidAllMutation.isPending ? 'Voiding…' : `Void ${voidableSelected.length}`}
              </button>
            </div>
          </div>
        </div>
      )}
      <NewTxnFab />
    </div>
  );
}
