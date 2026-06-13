/**
 * Day Book keyframes + the one-time "said -> understood" reveal flag.
 *
 * The reveal is shown ONCE: the first time a user opens the Day Book with a card
 * to review. Persisted in localStorage for now (per-device-once is acceptable
 * interim behaviour). MIGRATION: when the column lands, move this to
 * user_profiles.daybook_revealed_at for true per-user-lifetime behaviour.
 *
 * All tf-* keyframes resolve to their final state under prefers-reduced-motion
 * (no swoosh, no blur) — that media query lives at the bottom of ANIM.
 */

export const REVEAL_KEY = 'daybook_revealed';

export function hasRevealed(): boolean {
  try { return localStorage.getItem(REVEAL_KEY) === '1'; } catch { return true; }
}
export function markRevealed(): void {
  try { localStorage.setItem(REVEAL_KEY, '1'); } catch { /* private mode: just skip */ }
}

export const ANIM = `
@keyframes dbFade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes dbPop { 0% { transform: scale(0); } 60% { transform: scale(1.15); } 100% { transform: scale(1); } }
@keyframes dbSpin { to { transform: rotate(360deg); } }
.db-fade { animation: dbFade .4s ease both; }
.db-pop { animation: dbPop .45s cubic-bezier(.2,.9,.3,1.3) both; }
.db-spin { animation: dbSpin .9s linear infinite; }
@keyframes dbFileOff { to { transform: translateX(115%) rotate(2deg); opacity: 0; } }
@keyframes dbRejectOff { to { transform: translateX(-115%) rotate(-2deg); opacity: 0; } }
.db-file-off { animation: dbFileOff .42s cubic-bezier(.4,0,.2,1) forwards; }
.db-reject-off { animation: dbRejectOff .42s cubic-bezier(.4,0,.2,1) forwards; }
@keyframes dbDropIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.db-drop { animation: dbDropIn .35s ease both; }
@keyframes dbReveal { 0% { opacity: 0; } 100% { opacity: 1; } }
.db-reveal { animation: dbReveal .3s ease both; }
@keyframes dbConfirmSettle { 0% { opacity: 0; transform: translateY(4px); } 100% { opacity: 1; transform: none; } }
.db-confirm { animation: dbConfirmSettle .3s ease both; }
@keyframes dbSweep { 0% { transform: translateX(-100%); } 100% { transform: translateX(0); } }
.db-sweep { animation: dbSweep .85s cubic-bezier(.4,0,.1,1) forwards; }
@keyframes dbDraw { to { stroke-dashoffset: 0; } }
.db-draw { stroke-dasharray: 20; stroke-dashoffset: 20; animation: dbDraw .4s cubic-bezier(.5,0,.2,1) .05s forwards; }
/* the transformation: said -> understood, shown once */
@keyframes tfRaw   { 0%{opacity:0; transform:translateY(4px);} 10%,46%{opacity:1; transform:none;} 58%{opacity:.25; filter:blur(2px);} 100%{opacity:.25; filter:blur(2px);} }
@keyframes tfArrow { 0%,46%{opacity:0; transform:translateY(-3px) scale(.8);} 56%{opacity:1; transform:none;} 100%{opacity:1;} }
@keyframes tfRead  { 0%,54%{opacity:0; transform:translateY(8px); filter:blur(3px);} 72%,100%{opacity:1; transform:none; filter:none;} }
@keyframes tfChip  { 0%,66%{opacity:0; transform:scale(.85);} 80%,100%{opacity:1; transform:none;} }
@keyframes tfGlow  { 0%,52%{opacity:0;} 60%{opacity:.5;} 100%{opacity:0;} }
.tf-raw   { animation: tfRaw   3.4s cubic-bezier(.3,.7,.2,1) forwards; }
.tf-arrow { animation: tfArrow 3.4s cubic-bezier(.3,.7,.2,1) forwards; }
.tf-read  { animation: tfRead  3.4s cubic-bezier(.3,.7,.2,1) forwards; }
.tf-chip  { animation: tfChip  3.4s cubic-bezier(.3,.7,.2,1) forwards; }
.tf-glow  { animation: tfGlow  3.4s ease forwards; }
@media (prefers-reduced-motion: reduce) {
  .tf-raw,.tf-arrow,.tf-read,.tf-chip,.tf-glow { animation: none !important; opacity: 1 !important; filter: none !important; transform: none !important; }
  .db-file-off,.db-reject-off,.db-sweep,.db-draw,.db-pop,.db-confirm { animation-duration: .01ms !important; }
}
`;
