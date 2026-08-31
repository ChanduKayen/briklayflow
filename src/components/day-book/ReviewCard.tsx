/**
 * ReviewCard — the day book's VOUCHER. One captured entry, and what to do about it.
 *
 * THE LAYOUT is three columns, in the order a bookkeeper's eye moves:
 *   THE FACT    the figure, who it went to, which site   — what enters the ledger
 *   THE STORY   the reason, then their words, verbatim   — why, and on whose word
 *   THE ACTION  approve · edit · set aside               — what you can do about it
 *
 * ══ THE CARD ASSISTS. IT DOES NOT RESTRICT. ════════════════════════════════════════════════════
 *
 * It used to grey the Approve button out whenever anything was missing and stop dead. That is a
 * locked door with the key in the lock — everything else about the payment is known, and the one
 * unknown is usually a question with a two-second answer. Being refused by a screen that could
 * simply have ASKED is the difference between a tool and an obstacle. So:
 *
 * APPROVE ALWAYS WORKS. If everything is known, it files. If anything is not, it opens the
 * confirmation (ConfirmSheet), which asks ONLY for what is missing — one question at a time, saving as
 * it goes — and files at the end of it. The card never becomes a form, and never stands in the doorway.
 *
 * THE REASON IS NOT MANDATORY. Payee + site + amount is a complete transaction; the reason is a note.
 *
 * ══ AND THE IDS ARE CHECKED ════════════════════════════════════════════════════════════════════
 *
 * The AI's `payee_id` / `project_id` are guesses in a jsonb blob, not foreign keys. They are resolved
 * against the org's REAL lists before anything is posted — see the note at resolveIds below. Nothing
 * is ever written with an id we have not seen with our own eyes.
 *
 * The file journey is bound to the REAL write — never a false "Filed".
 */
import { useEffect, useRef, useState } from 'react';
import { Check, X, Pencil, ArrowRight, Image as ImageIcon, Mic, Split } from 'lucide-react';
import type { RoughEntry } from '../../types';
import { V, WA, font, nums, display, mono, telugu, T } from './tokens';
import { WhatsAppGlyph } from './atoms';
import {
  fileRoughEntry, rejectRoughEntry, restoreRoughEntry, isResolved, gapsOf, errMessage,
  type ResolvedFields, type Gap,
} from './fileEntry';
import { useSwipeTriage } from './useSwipeTriage';
import { CardSplitPanel } from './CardSplitPanel';
import { useSignedDocUrl } from '../../lib/storage';

export interface StakeholderLite { stakeholder_id: string; name: string; type?: string; category?: string }
export interface ProjectLite { project_id: string; name: string }

type Phase = null | 'filing' | 'filed' | 'collapsed' | 'rejected';
type Leaving = null | 'file' | 'reject';

const inr = (n: number) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export function ReviewCard({
  entry, orgId, reveal, canManage, stakeholders, projects,
  onFiled, onView, onDismiss, onRejected, onRestore, onFix, onConfirm, onLightbox, onError, justFiled,
}: {
  entry: RoughEntry;
  orgId: string;
  reveal: boolean;
  canManage: boolean;
  stakeholders: StakeholderLite[];
  projects: ProjectLite[];
  onFiled: (txnId: string) => void;
  onView: (txnId: string) => void;
  onDismiss: () => void;
  onRejected: () => void;
  onRestore: () => void;
  onFix: () => void;
  /** Approve, with something missing: open the editor narrowed to exactly these fields. */
  onConfirm: (gaps: Gap[]) => void;
  /**
   * TRUE when this entry was filed from the EDITOR rather than from the card.
   *
   * The card owns the leaving — the sweep, the tick, the collapse — and it must own it whichever door
   * the approval came through. Filing from the popup used to make the row simply blink into an archived
   * strip on the next refetch: the same act, in the same list, with none of the same ceremony. Two ways
   * in, ONE way out.
   */
  justFiled?: boolean;
  onLightbox: (url: string) => void;
  onError: (message: string) => void;
}) {
  const ai = entry.ai_extracted || {};
  // The stored raw_image_url is a signed URL that can go stale (secret rotation / TTL). Re-sign it
  // from its own bucket+path so the proof always renders — the Transaction Detail page already does
  // this; the card used to trust the stored URL verbatim, which is why proofs could vanish.
  const proofUrl = useSignedDocUrl(entry.raw_image_url) ?? entry.raw_image_url ?? null;

  // ── Triage / journey. Declared FIRST: `archived` below depends on the journey, not the other way
  // round — a card that is mid-flight is not an archive entry yet, whatever the row says.
  const [leaving, setLeaving] = useState<Leaving>(null);
  const [phase, setPhase] = useState<Phase>(null);
  const [filedTxnId, setFiledTxnId] = useState<string | null>(null);
  /**
   * ARCHIVED — *and not in the middle of getting there*.
   *
   * THIS IS WHY THE CARD NEVER SLID. Filing writes POSTED to the row; the list refetches within a beat
   * of the write landing; `archived` went true — and the component returned the little grey archived
   * row instead of the voucher it was halfway through animating. The tick, the slide, the receipt: all
   * of them were rendered by a card that had already been swapped out from under them.
   *
   * A card that is LEAVING owns its own leaving. The database can say POSTED all it likes; until the
   * card has finished saying goodbye, it is still the card. (`phase` is null for every entry that is
   * genuinely, quietly archived — those still get the compact row, exactly as before.)
   */
  const archived = (entry.status === 'POSTED' || entry.status === 'DISMISSED') && !phase;

  /**
   * ══ THE AI'S IDS ARE GUESSES, NOT FOREIGN KEYS ═════════════════════════════════════════════════
   *
   * `ai_extracted` is a jsonb blob the WhatsApp extractor writes. `payee_id` and `project_id` are
   * strings in it that LOOK like keys — and the card used to hand them straight to the insert. So a
   * project id the AI had assembled from a name ("PRJ-ASM-ELITE" — the exact shape a real one takes,
   * because the real convention is PRJ-<slug>) sailed through every check we had, the card said READY,
   * and the FIRST thing in the entire path to notice it named nothing was the foreign key:
   *
   *     insert or update on "txn_allocations" violates foreign key constraint
   *     Key (project_id)=(PRJ-ASM-ELITE) is not present in table "projects". (23503)
   *
   * — a raw Postgres error, thrown in his face, after he had pressed Approve.
   *
   * The lists were RIGHT HERE all along: `stakeholders` and `projects` are passed into this component
   * and were never once read. So we read them. An id counts as resolved only if it names a row we can
   * actually see. Anything else is not a key — it is a heard name wearing a key's clothes, and it is
   * treated exactly like a blank, because that is what it is.
   *
   * We now never post an id we have not seen in the org's own tables.
   */
  /**
   * ID FIRST — but a missed id is not always a phantom.
   *
   * The id is the verified key. But this card re-checks the saved id against its OWN copy of the
   * project list, and that copy can lag what the editor just wrote (a project activated mid-session,
   * or simply a list this card fetched earlier). When it lags, `find(id)` misses even though the owner
   * picked a real site — and because `project_name` is now that real name, the card would print
   * "<real name> · not a project", which is the exact "site present but says not a project" bug.
   *
   * So when the id misses, fall back to an EXACT, UNIQUE name match against the SAME real list. That
   * is still verification — a phantom id whose name matches no row we can see stays unresolved — it
   * only rescues a real, named row the id lookup happened to miss.
   */
  const nrm = (s?: string | null) => (s ?? '').trim().toLowerCase();
  const projectByName = (() => {
    const q = nrm(ai.project_name);
    if (!q) return null;
    const hits = projects.filter((p) => nrm(p.name) === q);
    return hits.length === 1 ? hits[0] : null;
  })();
  const projectById = ai.project_id ? projects.find((p) => p.project_id === ai.project_id) ?? null : null;
  const projectRow = projectById ?? projectByName;
  const payeeRow = ai.payee_id ? stakeholders.find((s) => s.stakeholder_id === ai.payee_id) ?? null : null;

  const payeeId = payeeRow?.stakeholder_id ?? null;
  // the name is still worth showing even when the id was a phantom — it is what the site SAID
  const payeeName = payeeRow?.name ?? ai.payee_name ?? ai.payee_raw ?? null;
  const projectId = projectRow?.project_id ?? null;
  const projectName = projectRow?.name ?? null;
  const projectRaw = projectRow ? null : (ai.project_name || ai.project_raw || null);
  const description = (ai.description || ai.description_raw || '').trim();
  const amountNum = parseFloat(String(ai.amount ?? '').replace(/[^\d.]/g, '')) || 0;

  const resolved: ResolvedFields = {
    payeeId: payeeId || '',
    projectId: projectId || '',
    amount: amountNum,
    description,
    generalExpense: false,
  };
  const gaps = archived ? [] : gapsOf(resolved);
  const ready = !archived && isResolved(resolved);

  /**
   * APPROVE ALWAYS WORKS.
   *
   * It does not grey out, it does not shake, and it does not grow an amber banner on the card. If
   * everything is known it files. If something is not, it opens the confirmation (ConfirmSheet) — which
   * asks ONLY for what is missing, one question at a time, and files at the end of it.
   *
   * The card stays a card. It states the entry and offers the action; it does not become a form the
   * moment the AI could not hear a project name.
   */



  const [apHover, setApHover] = useState(false);   // Approve FILLS as you approach it
  const [menu, setMenu] = useState(false);         // the ⋯ — where "Not a transaction" now lives
  const [slide, setSlide] = useState(false);       // the card is leaving the desk
  const [splitOpen, setSplitOpen] = useState(false); // the inline "split into transactions" panel

  /**
   * THE VOUCHER IS THREE COLUMNS WIDE, AND THREE COLUMNS NEED THE ROOM FOR IT.
   *
   * Below ~700px it becomes one column again — the same three blocks, stacked in the same order (fact,
   * then story, then the actions). A phone gets the reading order; a desk gets the scanning order.
   */
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 760px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 760px)');
    const on = (e: MediaQueryListEvent) => setWide(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  /** The one write. Both the plain Approve and the assist's "Confirm & file" come through here, so
   *  the journey (filing → filed → collapsed) and the error handling can never diverge between them. */
  /**
   * THE LEAVING — and it is the CARD that leaves.
   *
   * This used to swap the whole voucher out for a little strip the instant Approve was pressed, so the
   * card never went anywhere: it was simply replaced, mid-blink, by a different object. There was no
   * moment, no motion, and nothing to tell you that the thing you had been reading had gone somewhere.
   *
   *   filing   the card STAYS, and greens over — the write is happening to THIS document
   *   filed    a tick draws on it. One beat. The work is done and you can see that it is.
   *   sliding  and THEN it leaves — off to the right, the way a cleared voucher leaves a desk
   *   record   the receipt remains in its place: "Transaction filed · View"
   *
   * The order matters. Celebrate, then leave. A card that slides away before the tick has landed has
   * told you it is gone without ever telling you it worked.
   */
  const leave = (txnId: string | null, reduced: boolean) => {
    if (txnId) setFiledTxnId(txnId);
    setPhase('filed');
    if (reduced) { setPhase('collapsed'); return; }
    setTimeout(() => setSlide(true), 620);                 // the tick has landed — now go
    setTimeout(() => setPhase('collapsed'), 620 + 430);    // ...and the receipt takes its place
  };

  const runFileWith = async (fields: ResolvedFields) => {
    if (leaving) return;
    const reduced = swipe.reducedMotion;
    setLeaving('file'); setPhase('filing');
    try {
      const txnId = await fileRoughEntry(entry, orgId, fields);
      onFiled(txnId);
      leave(txnId, reduced);
    } catch (err: unknown) {
      setLeaving(null); setPhase(null);
      throw err;                                    // the caller says it out loud
    }
  };

  const runFile = async () => {
    if (!ready || leaving) return;
    try { await runFileWith(resolved); }
    catch (err: unknown) { onError(errMessage(err, "Couldn't file, try again")); }
  };
  /**
   * THE WHOLE OF APPROVE. It files, or it asks — it never simply refuses.
   *
   * When something is missing it opens THE SAME EDITOR the Edit button opens (ResolvePopup), narrowed
   * to only the fields we do not have. One card, two errands: Edit shows everything, because you came
   * to change something; Approve shows only the blanks, because you came to fill them. There is no
   * second, lookalike "confirm" dialog — that was two cards pretending to be one product.
   */
  const tapApprove = () => {
    if (leaving) return;
    if (ready) { void runFile(); return; }
    onConfirm(gaps);
  };
  const runReject = async () => {
    if (leaving) return;
    setLeaving('reject');
    try { await rejectRoughEntry(entry); setPhase('rejected'); onRejected(); }
    catch (err: unknown) { setLeaving(null); onError(errMessage(err, "Couldn't reject, try again")); }
  };
  const runUndo = async () => {
    try { await restoreRoughEntry(entry); setPhase(null); setLeaving(null); onRestore(); }
    catch (err: unknown) { onError(errMessage(err, "Couldn't undo, try again")); }
  };
  const runRestore = async () => {
    try { await restoreRoughEntry(entry); onRestore(); }
    catch (err: unknown) { onError(errMessage(err, "Couldn't move it back, try again")); }
  };

  // Swipe-to-file / swipe-to-reject is disabled — actions are the explicit Approve / Split / ⋯
  // buttons only. (Kept for its reducedMotion signal used by the leave animation.)
  const swipe = useSwipeTriage({
    enabled: false,
    canFileRight: ready,
    onFileRight: runFile,
    onRejectLeft: runReject,
  });

  // The inline split filed N transactions and marked the entry POSTED — take the card's leave, exactly
  // as a normal file does (green over → tick → slide → receipt).
  const onSplitFiled = (ids: string[]) => {
    setSplitOpen(false);
    onFiled(ids[0] ?? '');
    setLeaving('file');
    leave(ids[0] ?? null, swipe.reducedMotion);
  };

  useEffect(() => {
    if (phase !== 'collapsed' && phase !== 'rejected') return;
    const t = setTimeout(onDismiss, 7000);
    return () => clearTimeout(t);
  }, [phase, onDismiss]);

  // Filed from the editor: the card takes its leave exactly as if it had been approved here.
  const flew = useRef(false);
  // Reacting to a PROP (the page telling us it was filed elsewhere) — there is nothing to derive here,
  // it is an event arriving from outside. Ref-guarded so it can only ever run once.
  useEffect(() => {
    if (!justFiled || flew.current) return;
    flew.current = true;
    setLeaving('file');
    leave(null, swipe.reducedMotion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justFiled]);

  // ── filed journey: filing → "Filed ✓" beat → a quiet one-line strip (in place) ──
  // NOTE: 'filing' and 'filed' no longer swap the card out for a strip. The CARD is what is being
  // filed, so the card is what shows it — see the overlay at the bottom of the voucher, and `leave()`.
  if (phase === 'collapsed') {
    return (
      <div className="db-confirm rounded-2xl px-4 sm:px-5 py-2.5 flex items-center gap-2.5" style={{ background: V.sageWash, border: `1px solid ${V.sage}33` }}>
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full shrink-0" style={{ background: V.sage }}>
          <Check size={11} color="#fff" strokeWidth={3} />
        </span>
        <span className="font-medium" style={{ color: V.sage, ...font, ...T.sm }}>Transaction filed</span>
        <span className="flex-1" />
        {filedTxnId && (
          <button onClick={(e) => { e.stopPropagation(); onView(filedTxnId); }} className="inline-flex items-center gap-1 font-medium" style={{ color: V.sage, ...font, ...T.sm }}>
            View <ArrowRight size={14} />
          </button>
        )}
      </div>
    );
  }
  if (phase === 'rejected') {
    return (
      <div className="db-confirm rounded-2xl px-4 sm:px-5 py-2.5 flex items-center gap-2.5" style={{ background: V.field, border: `1px solid ${V.line}` }}>
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full shrink-0" style={{ background: V.line }}>
          <X size={11} color={V.sys} strokeWidth={2.5} />
        </span>
        <span className="font-medium" style={{ color: V.sys, ...font, ...T.sm }}>Moved to &ldquo;Not a transaction&rdquo;</span>
        <span className="flex-1" />
        <button onClick={(e) => { e.stopPropagation(); runUndo(); }} className="font-medium" style={{ color: V.inkSoft, ...font, ...T.sm }}>
          Undo
        </button>
      </div>
    );
  }

  // ── archived compact row ──────────────────────────────────────────────────
  if (archived) {
    const filed = entry.status === 'POSTED';
    return (
      <div className="db-drop rounded-2xl px-4 sm:px-5 py-4 flex items-center gap-3" style={{ background: V.surface, border: '1px solid #E3DDD4' }}>
        <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: filed ? V.sageWash : V.field }}>
          {filed ? <Check size={13} color={V.sage} strokeWidth={3} /> : <X size={13} color={V.faint} />}
        </span>
        <div className="flex-1 min-w-0">
          <p className="truncate" style={{ color: V.inkSoft, ...font, ...nums, ...T.sm }}>
            {payeeName || 'Unknown'}{amountNum > 0 ? ` · ₹${inr(amountNum)}` : ''}
          </p>
          <p className="truncate" style={{ color: V.faint, ...font, ...T.xs }}>
            {filed ? 'in your books' : 'not a transaction'}{entry.sender_name ? ` · from ${entry.sender_name}` : ''}
          </p>
        </div>
        {filed
          ? entry.resolved_txn_id && (
              <button onClick={(e) => { e.stopPropagation(); onView(entry.resolved_txn_id!); }} className="shrink-0 inline-flex items-center gap-1" style={{ color: V.sage, ...font, ...T.xs }}>
                View transaction <ArrowRight size={12} />
              </button>
            )
          : <button onClick={(e) => { e.stopPropagation(); runRestore(); }} className="shrink-0" style={{ color: V.faint, ...font, ...T.xs }}>Move back</button>}
      </div>
    );
  }

  // ── active review card — THE VOUCHER ───────────────────────────────────────
  //
  // Three columns, and the order is the order a bookkeeper's eye actually moves in:
  //
  //   THE FACT    what enters the ledger — the figure, who it went to, which site
  //   THE STORY   why, and in whose words — the reason, then the message as it was sent
  //   THE ACTION  what you can do about it — approve, fix, or set it aside
  //
  // It replaces a vertical stack fronted by a dark amount block. The block was handsome and it was in
  // the way: it took the top third of every card to say one number, so the two things a reviewer is
  // actually comparing — the figure and the reason for it — could never be read on one line. Side by
  // side, a whole day's book can be scanned by running the eye down a single column.
  const dx = swipe.dx;
  const fileShown = dx > 24;
  const rejectShown = dx < -24;
  // The card only flies when it is actually LEAVING. While it is filing (and while the tick is landing)
  // it stays exactly where it is, because it is the thing being filed.
  const offClass = slide && leaving === 'file' ? 'db-file-off'
    : leaving === 'reject' ? 'db-reject-off'
    : '';
  const said = entry.raw_text || entry.transcribed_text || '';

  const fromWa = entry.source.startsWith('WHATSAPP');
  const senderName = entry.sender_name || 'Unknown sender';
  const sourceIcon = entry.source === 'WHATSAPP_VOICE' ? <Mic size={12} color={V.faint} />
    : (entry.source === 'WHATSAPP_IMAGE' || entry.source === 'UI_IMAGE') ? <ImageIcon size={12} color={V.faint} />
    : fromWa ? <WhatsAppGlyph size={13} color={WA} /> : null;
  const captured = new Date(entry.created_at);
  const sentDate = captured.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  const sentTime = captured.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  const pill = (label: string) => (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full align-middle" style={{ background: V.field, color: V.sys, ...font, fontSize: 11.5, fontWeight: 500 }}>{label}</span>
  );

  /**
   * A GAP IS A BUTTON, NOT A COMPLAINT.
   *
   * The card used to print "Payee missing" — a label, telling you off, with no way out of it. A gap is
   * the one thing on this card that is *actionable*, so it IS the action: click it and the confirmation
   * opens, on exactly that question. The words say what is NEEDED, not what is wrong, and they say it
   * in the voice of the job — "name needed", not "PAYEE: NULL".
   */
  /**
   * ══ A BLANK ON A VOUCHER IS A BLANK LINE ═══════════════════════════════════════════════════════
   *
   * Every gap used to be an amber chip: "name needed", "project needed", "amount needed". Three of
   * them on one card, in the loudest colour the palette has, all shouting the same thing — and on a
   * phone, where the columns stack, they piled into a heap of warning tape over what is, after all,
   * an ordinary payment somebody simply has not finished writing down.
   *
   * Colour is for things that are WRONG. Nothing here is wrong. Something is merely NOT YET WRITTEN,
   * and paper has known how to say that for four hundred years: you rule a line and leave it empty.
   *
   *        to  ·············          which is quieter, and says more, than
   *        to  [ name needed ]
   *
   * So a gap is a ruled blank with the question written into it, in the card's own faint ink — no
   * colour, no fill, no border, nothing to shout with. It reads as a form waiting to be finished,
   * because that is exactly what it is. Press it and the confirmation opens on that question.
   *
   * The card now carries exactly one coloured thing, and it is the button you press. That is the
   * whole point of colour.
   */
  const blank = (question: string) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onConfirm(gaps); }}
      className="db-blank"
      title="Add this before filing"
    >
      {question}
    </button>
  );

  /**
   * THE VOUCHER NUMBER. Not a sequence — we do not have one, and inventing one would be a small lie
   * printed in monospace, which is the most convincing kind. It is the entry's own id, shortened: a
   * real handle you can quote back to support and find the row with.
   */
  const vno = `Nº DB-${entry.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase()}`;

  return (
    <div className={`relative rounded-2xl select-none ${splitOpen ? '' : 'overflow-hidden'}`}>
      {/* underneath: swipe trail OR filing -> filed confirmation */}
      {phase ? (
        <div className="absolute inset-0 overflow-hidden db-reveal" style={{ background: V.sageWash }} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-between px-6" style={{ background: fileShown ? V.sageWash : rejectShown ? V.field : 'transparent' }}>
          <span className="inline-flex items-center gap-2" style={{ opacity: fileShown ? 1 : 0, color: V.sage, ...font, ...T.sm }}><Check size={18} strokeWidth={2.5} /> Approve</span>
          <span className="inline-flex items-center gap-2 ml-auto" style={{ opacity: rejectShown ? 1 : 0, color: V.sys, ...font, ...T.sm }}>Not a transaction <X size={18} /></span>
        </div>
      )}

      <div
        className={`db-voucher ${offClass} ${wide ? 'wide' : ''}`}
        {...swipe.bind}
        style={{
          /**
           * INLINE STYLES BEAT STYLESHEETS, AND THAT IS WHY THE CARD NEVER LIFTED.
           *
           * `border`, `boxShadow` and `transform` all used to be set here, on every render. An inline
           * rule wins over any class, so `.db-voucher:hover` — the lift, the shadow, the warming
           * border — was dead the day it was written. And `transform: translateX(0px) rotate(0deg)`,
           * dutifully re-applied while nothing was being dragged, overrode the hover lift outright.
           *
           * So the resting look lives in the stylesheet, where it can be hovered. Only the DRAG writes
           * a transform here — because only the drag knows the number — and it writes it only while
           * there is actually a finger on the card.
           */
          ...(dx !== 0 && !leaving ? { transform: `translateX(${dx}px) rotate(${dx * 0.02}deg)` } : {}),
          ...(swipe.dragging || leaving ? { transition: 'none' } : {}),
          borderRadius: 16, position: 'relative',
          cursor: swipe.dragging ? 'grabbing' : 'grab', touchAction: 'pan-y',
          display: 'grid', alignItems: 'start', gap: '0 28px',
          gridTemplateColumns: wide ? '212px minmax(0,1fr) auto' : '1fr',
          padding: wide ? '20px 26px 18px' : '18px',
        }}
      >
        {/* ═══ THE FILING, ON THE DOCUMENT ITSELF ═════════════════════════════════════════════════
            The card does not vanish and get replaced by a receipt. It GREENS OVER, a tick draws on it,
            and then it leaves. What is being filed is this voucher; so this voucher is what says so. */}
        {(phase === 'filing' || phase === 'filed') && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center db-reveal"
            style={{ background: 'rgba(233,242,231,.92)', borderRadius: 16 }}
          >
            {phase === 'filing' ? (
              <span className="inline-flex items-center gap-2.5 font-medium" style={{ color: V.sage, ...font, ...T.sm }}>
                <span className="db-spin" style={{ width: 15, height: 15, borderRadius: '50%', border: `2px solid ${V.sage}44`, borderTopColor: V.sage }} />
                Filing to your books…
              </span>
            ) : (
              <span className="inline-flex items-center gap-2.5 font-semibold db-confirm" style={{ color: V.sage, ...font, ...T.sm }}>
                <span className="db-pop grid place-items-center rounded-full" style={{ width: 24, height: 24, background: V.sage }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path className="db-draw" d="M5 12.5l4.5 4.5L19 7" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                Filed · in your books
              </span>
            )}
          </div>
        )}

        {/* THE DOCKET NUMBER. Small, monospaced, in the corner where a voucher has always carried it —
            the quiet mark that says this is a record, and that it can be quoted. */}
        <span className="db-vno absolute" style={{ top: 12, right: 16, ...mono, fontSize: 10, letterSpacing: '.1em' }}>
          {vno}
        </span>

        {/* ═══ COLUMN 1 — THE FACT ════════════════════════════════════════════════════════════════
            What enters the ledger: the figure, who it went to, which site it belongs to. */}
        <div className={`min-w-0 ${reveal ? 'tf-read' : ''}`}>
          <div className="flex items-baseline gap-2" style={{ ...display, ...nums, fontWeight: 600, fontSize: 23, letterSpacing: '.01em', whiteSpace: 'nowrap', color: V.ink }}>
            {amountNum > 0 ? (
              <span>
                <span style={{ color: V.faint, fontSize: 16, marginRight: -4 }}>–</span>
                <span style={{ ...font, fontSize: 13, color: V.sys, marginRight: -3 }}>₹</span>
                {inr(amountNum)}
              </span>
            ) : (
              <span className="db-blank-amt">{blank('how much?')}</span>
            )}
            <span style={{ ...mono, fontSize: 9, fontWeight: 400, letterSpacing: '.14em', color: V.faint, transform: 'translateY(-2px)' }}>OUT</span>
          </div>

          {/* to whom */}
          <div className="mt-2.5" style={{ ...font, fontSize: 15, lineHeight: 1.45, overflowWrap: 'break-word', color: V.ink }}>
            <span style={{ color: V.faint, fontSize: 12, marginRight: 5 }}>to</span>
            {payeeId ? <b style={{ fontWeight: 600 }}>{payeeName}</b>
              : payeeName ? <><b style={{ fontWeight: 600 }}>{payeeName}</b> {pill('not in your contacts')}</>
              : blank('who was paid?')}
          </div>

          {/* which site — the sage tick-square is the ledger's own mark for "booked to a project" */}
          <div className="mt-1 flex items-baseline gap-1.5" style={{ color: V.sys, ...font, fontSize: 12.5, lineHeight: 1.4 }}>
            {projectId ? (
              <>
                <span className="flex-none" style={{ width: 5, height: 5, borderRadius: 2, background: V.sage, opacity: .7, transform: 'translateY(-1px)' }} />
                {projectName}
              </>
            ) : projectRaw ? (
              <>
                <span className="flex-none" style={{ width: 5, height: 5, borderRadius: 2, background: V.faint, transform: 'translateY(-1px)' }} />
                {projectRaw} {pill('not a project')}
              </>
            ) : blank('which site?')}
          </div>
        </div>

        {/* ═══ COLUMN 2 — THE STORY ═══════════════════════════════════════════════════════════════
            Why, and in whose words. The reason we booked it, then the message exactly as it arrived —
            because the message is the evidence, and it is the only line here nobody at a desk wrote.

            THE PERFORATION. A dotted rule stands between the figure and the story, the way it stands
            on every voucher, receipt and counterfoil ever printed: it is the line you would TEAR — the
            money on one side, the account of it on the other. It is the single cheapest mark that says
            "this is a document, not a notification", and it does the work of the border it replaces. */}
        <div className="db-perf min-w-0" style={{ paddingTop: wide ? 3 : 12 }}>
          {/* THE REASON IS A NOTE, NOT A GATE. It used to be an amber "reason needed" chip and it used
              to block the filing — so an entry that knew who, where and how much sat there refusing to
              go into the books because nobody had typed "cement". It is offered, quietly, and never
              demanded: an invitation to say more, in the colour of a thing you may ignore. */}
          <div className={reveal ? 'tf-read' : ''} style={{ ...font, fontSize: 14.5, color: V.ink, lineHeight: 1.5 }}>
            <span style={{ color: V.faint, fontSize: 12, marginRight: 5 }}>for</span>
            {description || (
              // The reason is OPTIONAL, so its blank is quieter still — no rule under it, nothing to
              // fill in before you may proceed. An invitation, in a card full of questions.
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onFix(); }}
                className="db-blank db-blank-opt"
              >
                add a note
              </button>
            )}
          </div>

          <div className="mt-2.5 flex gap-2.5 items-start min-w-0">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); if (proofUrl) onLightbox(proofUrl); }}
              disabled={!entry.raw_image_url}
              className="flex-none grid place-items-center rounded-full"
              style={{ width: 17, height: 17, marginTop: 2, background: '#DFF0DD', cursor: entry.raw_image_url ? 'pointer' : 'default' }}
              aria-label={entry.raw_image_url ? 'Open the photo' : 'From WhatsApp'}
            >
              {sourceIcon ?? <WhatsAppGlyph size={10} color="#3E7B45" />}
            </button>
            <div className="min-w-0">
              {said && (
                <p className={reveal ? 'tf-raw' : ''} style={{ ...telugu, fontStyle: 'italic', fontSize: 13.5, color: V.inkSoft, lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  &ldquo;{said}&rdquo;
                </p>
              )}
              <p style={{ ...mono, fontSize: 10.5, color: V.faint, marginTop: said ? 3 : 0 }}>
                {senderName} · {sentTime} · via {fromWa ? 'WhatsApp' : 'Briklay'}
                <span style={{ marginLeft: 6 }}>{sentDate}</span>
              </p>
              {entry.raw_image_url && (
                <button
                  onClick={(e) => { e.stopPropagation(); if (proofUrl) onLightbox(proofUrl); }}
                  className="db-shot mt-2 rounded-lg overflow-hidden block"
                  style={{ width: '100%', maxWidth: 168, height: 96, background: '#E8E2DA', border: `1px solid ${V.line}` }}
                >
                  <img src={proofUrl ?? undefined} alt="what was sent" className="w-full h-full object-cover" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ═══ COLUMN 3 — THE ACTION ══════════════════════════════════════════════════════════════ */}
        {canManage && (
          <div className="flex items-center gap-2" style={{ paddingTop: wide ? 16 : 8 }}>
            {/* APPROVE. Tinted at rest, and it FILLS on hover — the button gets more certain as you
                approach it, which is the whole feeling of signing something off.
                It is NEVER disabled. If we know everything, it files. If we do not, it asks. */}
            <button
              onClick={(e) => { e.stopPropagation(); tapApprove(); }}
              disabled={!!leaving}
              title={ready ? 'Approve & file' : 'A couple of details to confirm first'}
              className="inline-flex items-center gap-1.5 rounded-[10px] transition-[background,color,box-shadow,transform] duration-150 active:scale-[.96]"
              style={{
                ...font, fontWeight: 600, fontSize: 13.5, padding: '8px 15px', border: 'none', cursor: 'pointer',
                color: apHover ? '#FFF6EF' : V.terra,
                background: apHover ? V.terra : V.terraWash,
                boxShadow: apHover ? '0 2px 10px rgba(188,75,39,.28)' : 'none',
              }}
              onMouseEnter={() => setApHover(true)}
              onMouseLeave={() => setApHover(false)}
            >
              <Check size={14} strokeWidth={2.6} /> Approve
            </button>

            {/* EDIT — the full editor, for changing something that is already THERE and wrong. It no
                longer has to double as a beacon pointing at what is missing: Approve handles missing.
                Two buttons, two jobs, neither apologising for the other. */}
            <button
              onClick={(e) => { e.stopPropagation(); onFix(); }}
              className="inline-flex items-center gap-1.5 rounded-[10px] transition-[background,box-shadow,color] duration-150 active:scale-[.96] hover:bg-[#FCF9F2]"
              style={{
                ...font, fontWeight: 600, fontSize: 13.5, padding: '8px 15px', cursor: 'pointer', border: 'none',
                color: V.inkSoft, background: 'transparent',
                boxShadow: `inset 0 0 0 1px ${V.line}`,
              }}
            >
              <Pencil size={12} /> Edit
            </button>

            {/* SPLIT — one entry, several transactions (different payees/sites). Opens an inline panel
                on the card itself; no popup. Only meaningful once there's an amount to divide. */}
            {amountNum > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); setSplitOpen((s) => !s); }}
                title="Split into several transactions"
                className="inline-flex items-center gap-1.5 rounded-[10px] transition-[background,box-shadow,color,transform] duration-150 active:scale-[.96]"
                style={{
                  ...font, fontWeight: 600, fontSize: 13.5, padding: '8px 15px', cursor: 'pointer', border: 'none',
                  color: splitOpen ? V.terra : '#FBF7F1', background: splitOpen ? V.terraWash : V.ink,
                }}
              >
                <Split size={12} /> Split
              </button>
            )}

            {/* THE THIRD THING. Setting an entry aside is rare, and irreversible-feeling, so it stops
                sitting in the open beside the two things you do all day. */}
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setMenu((m) => !m); }}
                aria-label="More"
                aria-expanded={menu}
                className="grid place-items-center rounded-[10px] transition-colors duration-150"
                style={{ width: 34, height: 34, border: 'none', background: menu ? V.field : 'transparent', color: V.faint, cursor: 'pointer', fontSize: 17, lineHeight: 1 }}
              >
                ···
              </button>
              {menu && (
                <>
                  <div className="fixed inset-0" style={{ zIndex: 39 }} onClick={(e) => { e.stopPropagation(); setMenu(false); }} />
                  <div className="absolute db-drop" style={{ zIndex: 40, top: 'calc(100% + 8px)', right: 0, minWidth: 190, padding: 6, background: V.surface, border: `1px solid ${V.line}`, borderRadius: 13, boxShadow: '0 12px 44px rgba(42,27,18,.16)' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); setMenu(false); runReject(); }}
                      disabled={!!leaving}
                      className="block w-full text-left rounded-[9px] transition-colors duration-100 hover:bg-[#F4F2EE]"
                      style={{ padding: '9px 12px', ...font, fontSize: 14, fontWeight: 500, color: V.terraDeep, border: 'none', background: 'none', cursor: 'pointer' }}
                    >
                      Not a transaction
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {/* THE SPLIT, ON THE CARD ITSELF — a full-width section inside the voucher grid, so it reads as
            one continuous card. The container drops its overflow clip while open so the payee dropdown
            isn't cut off. Files N transactions and takes the card's leave. */}
        {splitOpen && !leaving && (
          <div style={{ gridColumn: '1 / -1', marginTop: 14 }}>
            <CardSplitPanel
              entry={entry}
              orgId={orgId}
              stakeholders={stakeholders}
              projects={projects}
              base={{ payeeId: payeeId || '', payeeName: payeeName || '', projectId: projectId || '', amount: amountNum, description }}
              onFiled={onSplitFiled}
              onClose={() => setSplitOpen(false)}
              onError={onError}
            />
          </div>
        )}
      </div>
    </div>
  );
}

