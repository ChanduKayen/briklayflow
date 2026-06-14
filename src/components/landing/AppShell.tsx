/**
 * AppWin + Bloom — shared chrome for the live demo cards (verbatim from
 * docs/reference/BriklayLanding.jsx). AppWin frames content as a tiny app
 * window with a "live" badge; Bloom is the soft corner-glow overlay (its
 * parent must be position:relative).
 */
import type { ReactNode } from 'react';
import { V, font } from './landingTokens';

export function AppWin({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ position: 'relative', zIndex: 1, background: '#FFFFFF', border: `1px solid ${V.line}`, boxShadow: '0 1px 2px rgba(30,26,21,0.05)' }}>
      <div className="flex items-center gap-1.5 px-3.5 py-2" style={{ borderBottom: `1px solid ${V.line}`, background: '#FCFBF9' }}>
        <span className="rounded-full shrink-0" style={{ width: 7, height: 7, background: V.line }} />
        <span className="rounded-full shrink-0" style={{ width: 7, height: 7, background: V.line }} />
        <span className="rounded-full shrink-0" style={{ width: 7, height: 7, background: V.line }} />
        <span className="text-xs ml-2 truncate" style={{ color: V.faint, ...font }}>{title}</span>
        <span className="flex-1" />
        <span className="inline-flex items-center gap-1 shrink-0" style={{ fontSize: 10, color: V.faint, ...font }}>
          <span className="pdot rounded-full" style={{ width: 6, height: 6, background: V.terra }} /> live
        </span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export const Bloom = () => (
  <div
    aria-hidden="true"
    className="absolute inset-0 pointer-events-none"
    style={{ background: 'radial-gradient(420px circle at 10% 0%, rgba(188,75,39,0.09), transparent 62%), radial-gradient(380px circle at 100% 100%, rgba(160,130,109,0.13), transparent 62%)' }}
  />
);

/**
 * ChapterTag — the warm-umber numbered chapter pill (verbatim). zIndex 2 lifts
 * it above the .vcard paper sheen and Bloom atmosphere (both in-flow). No
 * className prop by design, so every instance is pixel-identical.
 */
export function ChapterTag({ n, label }: { n: string; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1"
      style={{ position: 'relative', zIndex: 2, background: '#463B2F', color: '#F6F1EA', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', borderRadius: 6, boxShadow: '0 2px 7px rgba(30,26,21,0.18), 0 1px 2px rgba(30,26,21,0.12)', ...font }}
    >
      <b style={{ color: '#D96A43' }}>{n}</b> {label}
    </span>
  );
}
