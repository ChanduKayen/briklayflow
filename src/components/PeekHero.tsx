/**
 * Shared peek hero language — the walnut amount/burn-down card that crowns each
 * preview popup, plus the thin burn-down track. Mirrors the TransactionDetail
 * WALNUT AMOUNT HERO (radial-terracotta + linear walnut, ivory serif figure,
 * dark-styled status pills). Reused across TransactionPeek / WOPeek / POPeek.
 */
import type { ReactNode } from 'react';

const IVORY = '#F3EADB';
export const SERIF = "Georgia, 'Times New Roman', serif";

// Soft accents: terracotta for money-OUT / contracts; sage for money-IN.
export const TERRA = '#E89A72';
export const SAGE = '#9CBB91';

const WALNUT_OUT =
  'radial-gradient(120% 120% at 85% 0%, rgba(224,138,92,.15) 0%, rgba(224,138,92,0) 42%), linear-gradient(158deg,#2D2118 0%,#221A13 60%,#1B140E 100%)';
const WALNUT_IN =
  'radial-gradient(120% 120% at 85% 0%, rgba(156,187,145,.17) 0%, rgba(156,187,145,0) 42%), linear-gradient(158deg,#232619 0%,#1c2014 60%,#161a0f 100%)';

export function fmtRupee(n: number) {
  return '₹' + Math.round(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

/** A dark-styled status pill for use on the walnut field. */
export function HeroPill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'active' | 'error' | 'neutral';
}) {
  const styles =
    tone === 'active'
      ? { background: 'rgba(123,176,108,.16)', color: '#AFD3A1', border: '1px solid rgba(123,176,108,.24)', dot: '#84BE74' }
      : tone === 'error'
      ? { background: 'rgba(229,115,115,.16)', color: '#F0A593', border: '1px solid rgba(229,115,115,.24)', dot: '#E57373' }
      : { background: 'rgba(243,234,219,.1)', color: 'rgba(243,234,219,.6)', border: '1px solid rgba(243,234,219,.14)', dot: 'rgba(243,234,219,.4)' };
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold shrink-0"
      style={{ background: styles.background, color: styles.color, border: styles.border }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: styles.dot }} />
      {label.toUpperCase()}
    </span>
  );
}

/**
 * The full-bleed walnut hero. Designed to escape the modal body's `p-5` via
 * negative margins (`-mx-5 -mt-5`) and round its top corners to match the chrome.
 */
export function WalnutHero({
  variant = 'terra',
  eyebrow,
  topLeft,
  topRight,
  children,
}: {
  variant?: 'terra' | 'sage';
  /** Optional eyebrow line above the headline figure (e.g. "MONEY OUT" or a scope summary). */
  eyebrow?: ReactNode;
  /** Optional small top-left identity block (id / subtitle). */
  topLeft?: ReactNode;
  /** Optional top-right block — typically the status pill(s). */
  topRight?: ReactNode;
  /** The hero body — the big serif figure + any burn-down. */
  children: ReactNode;
}) {
  return (
    <div
      className="-mx-5 -mt-5 mb-5 px-6 pt-5 pb-6 rounded-t-2xl sm:rounded-t-2xl"
      style={{ background: variant === 'sage' ? WALNUT_IN : WALNUT_OUT }}
    >
      {(topLeft || topRight) && (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">{topLeft}</div>
          <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">{topRight}</div>
        </div>
      )}
      {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
      {children}
    </div>
  );
}

/** The big ivory serif headline figure (with a soft-accent prefix glyph). */
export function HeroFigure({
  prefix,
  value,
  accent,
}: {
  prefix?: string;
  value: string;
  accent: string;
}) {
  return (
    <p
      style={{
        color: IVORY,
        fontFamily: SERIF,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1,
        letterSpacing: '-0.02em',
        fontSize: 'clamp(2.2rem, 1.4rem + 4vw, 3.1rem)',
      }}
    >
      {prefix && (
        <span style={{ fontSize: '0.4em', fontWeight: 600, marginRight: '0.1em', color: accent }}>{prefix}</span>
      )}
      {value}
    </p>
  );
}

/** Direction eyebrow — small accent-coloured "MONEY IN / OUT" with an arrow glyph. */
export function DirectionEyebrow({ isIn, accent }: { isIn: boolean; accent: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{ color: accent, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em' }}
    >
      <span className="material-symbols-outlined text-[13px]">{isIn ? 'south_west' : 'north_east'}</span>
      {isIn ? 'MONEY IN' : 'MONEY OUT'}
    </span>
  );
}

/**
 * Burn-down — a thin track + filled portion, on the dark hero field, with the
 * "{paidPct}% paid · ₹{paid} of ₹{total}" caption beneath. Accent fills the bar.
 */
export function BurnDown({
  total,
  paid,
  accent,
  totalKnown = true,
}: {
  total: number;
  paid: number;
  accent: string;
  totalKnown?: boolean;
}) {
  const pctPaid = total > 0 ? Math.min((paid / total) * 100, 100) : paid > 0 ? 100 : 0;
  return (
    <div className="mt-4">
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(243,234,219,.12)' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pctPaid}%`, background: accent }}
        />
      </div>
      <p className="mt-2 text-[11px]" style={{ color: 'rgba(243,234,219,.6)' }}>
        <span style={{ color: accent, fontWeight: 700 }}>{Math.round(pctPaid)}% paid</span>
        <span className="mx-1.5" style={{ color: 'rgba(243,234,219,.28)' }}>·</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtRupee(paid)}</span> of{' '}
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{totalKnown ? fmtRupee(total) : '—'}</span>
      </p>
    </div>
  );
}

/** A small uppercase group label used to chunk the modal body. */
export function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant mb-2">{children}</p>
  );
}

// ── Document-soul helpers (shared by WOPeek "contract" + POPeek "invoice") ──

/** Warm cream "paper" palette for the document body below the hero. */
export const PAPER = '#FBF7EF';
export const PAPER_EDGE = '#EDE3D2';
const INK = '#2C2620';
const INK_SOFT = '#6B6052';

/**
 * Deep terracotta + sage, tuned for INK-on-cream use (text, bar fills, seals).
 * The soft `TERRA`/`SAGE` above are calibrated for the dark hero field; on the
 * pale paper they wash out, so the document masthead uses these deeper tones.
 */
export const TERRA_INK = '#B25433';
export const SAGE_INK = '#5E8157';

/**
 * A light status pill that sits ON the cream masthead (terracotta / sage / ink
 * tones), the document-voice counterpart to the dark `HeroPill`. A faint tinted
 * fill, a hairline ring, a small dot, letterspaced caps.
 */
export function DocPill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'active' | 'paid' | 'error' | 'neutral';
}) {
  const c =
    tone === 'paid'
      ? SAGE_INK
      : tone === 'error'
      ? '#B0473A'
      : tone === 'active'
      ? TERRA_INK
      : INK_SOFT;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold shrink-0"
      style={{
        background: hexA(c, 0.1),
        color: c,
        border: `1px solid ${hexA(c, 0.28)}`,
        letterSpacing: '0.06em',
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />
      {label.toUpperCase()}
    </span>
  );
}

/**
 * A short letterspaced document marker for a masthead top row — a terracotta
 * § rule + label (e.g. "CONTRACT", "TAX INVOICE"). Lighter than `DocMarker`
 * (no underline rule) — it crowns the headline rather than chunking the body.
 */
export function DocEyebrow({
  label,
  glyph,
  accent = TERRA_INK,
}: {
  label: string;
  glyph?: string;
  accent?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      <span className="inline-block rounded-full shrink-0" style={{ width: 16, height: 2.5, background: accent }} />
      {glyph && <span style={{ fontFamily: SERIF, fontSize: 13, color: accent, lineHeight: 1 }}>{glyph}</span>}
      <span
        style={{ fontFamily: SERIF, color: accent }}
        className="text-[10.5px] font-semibold uppercase tracking-[0.18em] truncate"
      >
        {label}
      </span>
    </span>
  );
}

/**
 * The headline figure for a cream masthead: a calm `label` (BALANCE / BALANCE
 * DUE), the big serif `₹` figure in deep ink-on-cream accent, a `{pct}% paid`
 * note, and a refined LIGHT burn-down — a thin warm track filled to pct with a
 * `₹{paid} of ₹{total}` caption. The figure reads as part of the same paper as
 * the body below it (same cream, same serif).
 */
export function DocFigure({
  label,
  value,
  accent,
  total,
  paid,
  totalKnown = true,
  note,
}: {
  label: string;
  /** The big figure, already formatted with its ₹ (or pass a number-string). */
  value: string;
  accent: string;
  total: number;
  paid: number;
  totalKnown?: boolean;
  /** Optional quiet sub-note under the figure (e.g. estimated-from-milestones). */
  note?: ReactNode;
}) {
  const pctPaid = total > 0 ? Math.min((paid / total) * 100, 100) : paid > 0 ? 100 : 0;
  return (
    <div>
      <p
        className="text-[10px] font-semibold uppercase tracking-[0.16em] mb-1.5"
        style={{ color: INK_SOFT }}
      >
        {label}
      </p>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <p
          style={{
            color: accent,
            fontFamily: SERIF,
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 0.95,
            letterSpacing: '-0.02em',
            fontSize: 'clamp(2.1rem, 1.3rem + 3.6vw, 2.9rem)',
          }}
        >
          <span style={{ fontSize: '0.42em', fontWeight: 600, marginRight: '0.08em', verticalAlign: '0.18em' }}>₹</span>
          {value}
        </p>
        <p
          className="text-[12px] pb-1.5"
          style={{ color: INK_SOFT, fontFamily: SERIF, fontVariantNumeric: 'tabular-nums' }}
        >
          <span style={{ color: accent, fontWeight: 700 }}>{Math.round(pctPaid)}%</span> paid
        </p>
      </div>
      {note && <div className="mt-1.5">{note}</div>}
      <DocBurnDown total={total} paid={paid} accent={accent} totalKnown={totalKnown} />
    </div>
  );
}

/**
 * Light burn-down for the cream paper: a thin faint-warm track filled to pct
 * with the document accent, and a tabular `₹{paid} of ₹{total}` caption below.
 * The ink-on-cream counterpart to the dark-field `BurnDown`.
 */
export function DocBurnDown({
  total,
  paid,
  accent,
  totalKnown = true,
}: {
  total: number;
  paid: number;
  accent: string;
  totalKnown?: boolean;
}) {
  const pctPaid = total > 0 ? Math.min((paid / total) * 100, 100) : paid > 0 ? 100 : 0;
  return (
    <div className="mt-3">
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: hexA(INK, 0.08) }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pctPaid}%`, background: accent }}
        />
      </div>
      <p className="mt-2 text-[11px]" style={{ color: INK_SOFT, fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtRupee(paid)}</span>
        <span className="mx-1" style={{ color: hexA(INK, 0.3) }}>of</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{totalKnown ? fmtRupee(total) : '—'}</span>
      </p>
    </div>
  );
}

/**
 * A formal serif section marker: a short terracotta rule + uppercase label,
 * with a hairline rule running under the whole marker. The document voice for
 * what GroupLabel is to the generic body.
 */
export function DocMarker({
  label,
  glyph,
  accent = TERRA,
}: {
  label: string;
  /** Optional leading glyph, e.g. "§". */
  glyph?: string;
  accent?: string;
}) {
  return (
    <div className="mb-3" style={{ borderBottom: `1px solid ${PAPER_EDGE}` }}>
      <div className="flex items-center gap-2 pb-1.5">
        <span className="inline-block rounded-full" style={{ width: 18, height: 2.5, background: accent }} />
        {glyph && (
          <span style={{ fontFamily: SERIF, fontSize: 14, color: accent, lineHeight: 1 }}>{glyph}</span>
        )}
        <span
          style={{ fontFamily: SERIF, color: INK_SOFT }}
          className="text-[10.5px] font-semibold uppercase tracking-[0.16em]"
        >
          {label}
        </span>
      </div>
    </div>
  );
}

/**
 * The cream "paper" surface that holds the document body. Bleeds to the modal
 * edges (cancels PeekModal's `p-5`), carries a hairline border + soft inner
 * shadow, and clips an optional watermark child. `topEdge="perforated"` draws a
 * receipt-style scalloped/perforated divider along the top.
 */
export function DocPaper({
  children,
  watermark,
  topEdge,
  accent = TERRA,
}: {
  children: ReactNode;
  /** Optional faint rotated watermark, clipped to the paper. */
  watermark?: ReactNode;
  topEdge?: 'perforated';
  accent?: string;
}) {
  return (
    <div className="-mx-5 relative">
      {topEdge === 'perforated' && <Perforation />}
      <div
        className="relative overflow-hidden px-6 py-6"
        style={{
          background: PAPER,
          borderTop: `1px solid ${PAPER_EDGE}`,
          borderBottom: `1px solid ${PAPER_EDGE}`,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,.5), inset 0 0 60px rgba(150,120,80,.04)',
          color: INK,
        }}
      >
        {/* faint paper texture: a barely-there warm wash from the accent */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(140% 90% at 100% 0%, ${hexA(accent, 0.05)} 0%, transparent 55%)` }}
        />
        {watermark}
        <div className="relative">{children}</div>
      </div>
    </div>
  );
}

/** Receipt-style perforated top edge built from a row of radial-gradient notches. */
function Perforation() {
  return (
    <div
      aria-hidden
      className="h-3 -mb-px"
      style={{
        background: PAPER,
        WebkitMaskImage: 'radial-gradient(circle 6px at 9px 0, transparent 5px, #000 5.5px)',
        maskImage: 'radial-gradient(circle 6px at 9px 0, transparent 5px, #000 5.5px)',
        WebkitMaskSize: '18px 12px',
        maskSize: '18px 12px',
        WebkitMaskRepeat: 'repeat-x',
        maskRepeat: 'repeat-x',
        borderLeft: `1px solid ${PAPER_EDGE}`,
        borderRight: `1px solid ${PAPER_EDGE}`,
      }}
    />
  );
}

/**
 * A huge, faint, rotated watermark of an id/word behind the paper. Clipped by
 * DocPaper's overflow-hidden; non-interactive. `variant="id"` for a small
 * rotated id stamp at the corner; `variant="stamp"` for a big diagonal word.
 */
export function Watermark({
  text,
  accent = INK,
  variant = 'id',
}: {
  text: string;
  accent?: string;
  variant?: 'id' | 'stamp';
}) {
  if (variant === 'stamp') {
    return (
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center select-none"
        style={{ overflow: 'hidden' }}
      >
        <span
          style={{
            fontFamily: SERIF,
            fontWeight: 800,
            fontSize: 'clamp(4rem, 18vw, 7rem)',
            letterSpacing: '0.12em',
            transform: 'rotate(-22deg)',
            color: 'transparent',
            WebkitTextStroke: `2px ${hexA(accent, 0.1)}`,
            opacity: 0.9,
            whiteSpace: 'nowrap',
          }}
        >
          {text}
        </span>
      </div>
    );
  }
  return (
    <div aria-hidden className="pointer-events-none absolute -right-6 top-2 select-none" style={{ overflow: 'hidden' }}>
      <span
        style={{
          fontFamily: SERIF,
          fontWeight: 700,
          fontSize: 'clamp(3rem, 12vw, 5rem)',
          letterSpacing: '0.04em',
          transform: 'rotate(-12deg)',
          color: hexA(accent, 0.04),
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </span>
    </div>
  );
}

/**
 * A small embossed-look "executed" wax seal: a terracotta ring with a check,
 * for an assigned/active contract. ~44px, subtle.
 */
export function ExecutedSeal({ accent = TERRA }: { accent?: string }) {
  return (
    <div
      aria-hidden
      className="flex items-center justify-center rounded-full shrink-0"
      style={{
        width: 44,
        height: 44,
        background: `radial-gradient(circle at 35% 30%, ${hexA(accent, 0.28)}, ${hexA(accent, 0.12)})`,
        border: `1.5px solid ${hexA(accent, 0.55)}`,
        boxShadow: `inset 0 1px 2px ${hexA('#FFFFFF', 0.5)}, 0 1px 2px ${hexA(accent, 0.25)}`,
      }}
    >
      <div
        className="flex items-center justify-center rounded-full"
        style={{ width: 30, height: 30, border: `1px dashed ${hexA(accent, 0.5)}` }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16, color: hexA(accent, 0.95) }}>check</span>
      </div>
    </div>
  );
}

/** Tiny helper: a hex colour at an alpha (handles #rgb / #rrggbb). */
export function hexA(hex: string, a: number) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

export { IVORY, INK, INK_SOFT };
