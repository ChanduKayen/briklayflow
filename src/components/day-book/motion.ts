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
.db-allrow{transition:background .12s ease}
.db-allrow:hover{background:#FBF7EF}
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
/* one-row chip rail: scrolls horizontally on overflow, no scrollbar chrome */
.db-noscroll { scrollbar-width: none; -ms-overflow-style: none; -webkit-overflow-scrolling: touch; }
.db-noscroll::-webkit-scrollbar { display: none; }
/* card separation + hover lift — keeps cards from blending at the same level */
.db-card { border: 1px solid #E3DDD4; box-shadow: 0 1px 2px rgba(60,46,26,0.04); transition: box-shadow .2s ease, border-color .2s ease; }
.db-card:hover { border-color: #D2C5B4; box-shadow: 0 8px 22px rgba(60,46,26,0.10); }
@keyframes dbReveal { 0% { opacity: 0; } 100% { opacity: 1; } }
.db-reveal { animation: dbReveal .3s ease both; }
@keyframes dbConfirmSettle { 0% { opacity: 0; transform: translateY(4px); } 100% { opacity: 1; transform: none; } }
.db-confirm { animation: dbConfirmSettle .3s ease both; }
@keyframes dbSweep { 0% { transform: translateX(-100%); } 100% { transform: translateX(0); } }
.db-sweep { animation: dbSweep .85s cubic-bezier(.4,0,.1,1) forwards; }
@keyframes dbDraw { to { stroke-dashoffset: 0; } }
.db-draw { stroke-dasharray: 20; stroke-dashoffset: 20; animation: dbDraw .4s cubic-bezier(.5,0,.2,1) .05s forwards; }
/* grant-access micro-animations: a soft sage halo while selecting, a settled check on success */
@keyframes dbGlow { 0% { box-shadow: 0 0 0 0 rgba(47,93,52,0); } 45% { box-shadow: 0 0 0 3px rgba(47,93,52,0.13); } 100% { box-shadow: 0 0 0 0 rgba(47,93,52,0); } }
.db-glow { animation: dbGlow 1.05s ease both; }
@keyframes dbRing { 0% { transform: scale(.5); opacity: 0; } 55% { opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
.db-ring { animation: dbRing .5s cubic-bezier(.2,.9,.3,1.3) both; }
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
/* ═══ THE VOUCHER — how the card behaves ════════════════════════════════════════════════════════
 *
 * A day book is a DOCUMENT, and these are the manners of one.
 *
 * There is deliberately NO refusal animation here. There was one — a shake, and an amber pulse that
 * pointed at what was missing — and it is gone, because the card no longer refuses anything. Approve
 * always works: it files, or it asks (ConfirmSheet). A shake is what a screen does INSTEAD of helping,
 * and once you are helping there is nothing left for it to say.
 */

/* THE RESTING LOOK. It lives HERE, not in an inline style, or it could never be hovered — an inline
   rule beats any class, and that is precisely why the lift never used to happen. */
.db-voucher {
  background: #FFFFFF;
  border: 1px solid #EAE6E0;
  box-shadow: 0 1px 2px rgba(42,27,18,.05);
  transition: box-shadow .2s cubic-bezier(.3,.7,.2,1),
              transform .2s cubic-bezier(.3,.7,.2,1),
              border-color .2s ease,
              background .2s ease;
}

/* THE LIFT. The card rises a hair under the cursor — it is a thing you can pick up and act on, and it
   says so before you are touching it. Everything else on the card follows that one move: the paper
   warms, the perforation darkens, the docket number surfaces, the photo leans in. One gesture, felt in
   five places, which is the difference between a card that responds and a card that merely highlights. */
.db-voucher:hover {
  transform: translateY(-2px);
  border-color: #E2D5BF;
  background: #FFFDFA;
  box-shadow: 0 10px 30px -12px rgba(42,27,18,.16), 0 2px 6px rgba(42,27,18,.05);
}
.db-voucher:active { transform: translateY(-1px); }

/* THE PERFORATION — the line you would tear. Money on one side, the account of it on the other. It is
   the cheapest possible mark that says "this is a document", and it earns its keep on every voucher,
   receipt and counterfoil ever printed. Vertical on a desk; horizontal when the card stacks on a phone,
   where it lands exactly where he asked for it: under the amount. */
.db-voucher.wide .db-perf {
  border-left: 1px dashed #E4DACB;
  padding-left: 26px;
  margin-left: -2px;
  transition: border-color .2s ease;
}
/* ON A PHONE THERE IS NO PERFORATION.
 *
 * A tear-line works because it runs BESIDE the thing it separates — money on one side of it, the
 * account of that money on the other. Stack the card and the same line runs ACROSS it, and it stops
 * being a perforation and becomes a divider: a horizontal dashed rule through the middle of a small
 * card, which is fussy, busy and says nothing the whitespace was not already saying.
 *
 * So on a phone the columns simply breathe. The gap IS the separation. A mark you have to justify at
 * every width is a mark that belongs at only one of them. */
.db-voucher:not(.wide) .db-perf {
  padding-top: 14px;
  margin-top: 2px;
}
.db-voucher:hover .db-perf { border-color: #D6C6AE; }

/* The docket number is furniture at rest and a fact on approach. */
.db-voucher .db-vno { color: #C7BCAC; transition: color .2s ease; }
.db-voucher:hover .db-vno { color: #9A8E80; }

/* The evidence leans in. */
.db-voucher .db-shot { transition: transform .25s cubic-bezier(.3,.7,.2,1), box-shadow .2s ease; }
.db-voucher:hover .db-shot { transform: scale(1.02); box-shadow: 0 6px 16px -8px rgba(42,27,18,.3); }

@media (hover: none) {
  /* A finger has no hover. Nothing should move under it, or the tap looks like a mistake. */
  .db-voucher:hover { transform: none; box-shadow: 0 1px 2px rgba(42,27,18,.05); background: #FFFFFF; }
  .db-voucher:hover .db-shot { transform: none; }
}

/* ═══ A BLANK ON A VOUCHER ═══════════════════════════════════════════════════════════════════════
 * Not a chip. A ruled line with the question written into it, in the card's own faint ink. It reads as
 * a form waiting to be finished — which is precisely what it is — and it leaves the card with exactly
 * ONE coloured thing on it: the button you press. That is what colour is for.
 *
 * The rule is dashed, like the perforation, so the two marks on this card speak the same language:
 * "this is a document." */
.db-blank {
  display: inline-flex; align-items: baseline;
  min-width: 96px; padding: 0 2px 2px;
  font-family: 'DM Sans', system-ui, sans-serif; font-size: 13px; font-weight: 400;
  color: #B5A896;
  background: none; border: none; border-bottom: 1px dashed #D6C9B6;
  cursor: pointer;
  transition: color .16s ease, border-color .16s ease, background .16s ease;
}
.db-blank:hover { color: #3D3830; border-color: #8F7A5C; background: #FAF6EE; }
.db-blank:focus-visible { outline: 2px solid #BC4B27; outline-offset: 2px; border-radius: 2px; }

/* the amount's blank carries the amount's own voice — it is the figure that is missing, after all */
.db-blank-amt .db-blank {
  min-width: 118px;
  font-family: 'Playfair Display', Georgia, serif; font-size: 19px;
}

/* OPTIONAL. No rule under it: there is nothing here you must fill in before you may proceed. An
   invitation, in a card otherwise full of questions. */
.db-blank-opt { border-bottom: none; min-width: 0; font-size: 13px; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 3px; }
.db-blank-opt:hover { background: none; }

/* THE CONFIRMATION arrives from just under the press that summoned it — it is the continuation of
   pressing Approve, not a new place you have been sent to. */
@keyframes dbSheetIn { from { opacity: 0; transform: translateY(10px) scale(.985); } to { opacity: 1; transform: none; } }
.db-sheet-in { animation: dbSheetIn .22s cubic-bezier(.2,1,.4,1) both; }

@media (prefers-reduced-motion: reduce) {
  .tf-raw,.tf-arrow,.tf-read,.tf-chip,.tf-glow { animation: none !important; opacity: 1 !important; filter: none !important; transform: none !important; }
  .db-file-off,.db-reject-off,.db-sweep,.db-draw,.db-pop,.db-confirm,.db-glow,.db-ring { animation-duration: .01ms !important; }
  .db-sheet-in { animation-duration: .01ms !important; }
  .db-voucher:hover, .db-voucher:active { transform: none; }
  .db-voucher .db-shot { transition: none; }
}
/* Mobile: floor form text at 16px so iOS Safari doesn't zoom the viewport on focus
   (inline T.sm/T.xs sit below 16px). Scoped to .db-scope -> only the Day Book shifts. */
@media (max-width: 640px) {
  .db-scope input, .db-scope select, .db-scope textarea { font-size: 16px !important; }
}
`;
