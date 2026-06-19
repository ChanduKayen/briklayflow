/**
 * ReviewCard — the two-tier transcription + triage, with INLINE gap-resolution.
 *
 *  tier 1  what the site SAID  (sender, channel, raw message / photo / voice)
 *  seam    a down-arrow
 *  tier 2  what Briklay UNDERSTOOD  (direction, amount, payee, project, note)
 *
 * The owner resolves gaps right here, not in a popup: each missing/unmatched
 * field is an amber chip that expands an inline editor. A payee the AI heard but
 * could not match to a stakeholder is shown by name in amber until the owner
 * picks the real party — Briklay records what it heard, but won't file an
 * unmatched name. Once every mandatory field is resolved, File lights up.
 * "Fix" still opens the full editor for advanced cases (category, linking, a
 * brand-new party).
 *
 * The file journey is bound to the REAL write: "Filing" while fileRoughEntry is
 * in flight, "Filed" on success, return-with-error on failure. Never a false
 * "Filed".
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Check, X, Pencil, Link2, ArrowUpRight, ArrowDownLeft, ArrowRight,
  Image as ImageIcon, Search, UserPlus, Wallet, Mic, Split, Plus,
} from 'lucide-react';
import type { RoughEntry } from '../../types';
import { V, WA, font, serif, nums, terraGrad, T } from './tokens';
import { WhatsAppGlyph } from './atoms';
import {
  fileRoughEntry, fileRoughEntrySplit, rejectRoughEntry, restoreRoughEntry, createParty, isResolved, errMessage, type ResolvedFields,
} from './fileEntry';
import { useSwipeTriage } from './useSwipeTriage';
import { WORKER_TRADE_GROUPS, VENDOR_TRADE_GROUPS, OTHER_TRADE } from '../../lib/trades';
import { GEN_HEADS, getCostCode } from '../../lib/costCodes';
import { classifyExpenseHead } from '../../lib/expenseHeads';

type PartyType = 'Worker' | 'Vendor' | 'Client';

export interface StakeholderLite { stakeholder_id: string; name: string; type?: string; category?: string }
export interface ProjectLite { project_id: string; name: string }

type Phase = null | 'filing' | 'filed' | 'collapsed' | 'rejected';
type Leaving = null | 'file' | 'reject';
type Field = null | 'payee' | 'amount' | 'project' | 'description' | 'genHead';

const inr = (n: number) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export function ReviewCard({
  entry, orgId, reveal, canManage, stakeholders, projects,
  onFiled, onView, onDismiss, onRejected, onRestore, onFix, onLightbox, onError,
}: {
  entry: RoughEntry;
  orgId: string;
  reveal: boolean;
  canManage: boolean;
  stakeholders: StakeholderLite[];
  projects: ProjectLite[];
  onFiled: (txnId: string) => void;
  onView: (txnId: string) => void;        // open the txn in the ledger (highlighted)
  onDismiss: () => void;                  // settle the lingering filed/rejected strip
  onRejected: () => void;
  onRestore: () => void;
  onFix: () => void;
  onLightbox: (url: string) => void;
  onError: (message: string) => void;
}) {
  const ai = entry.ai_extracted || {};
  const archived = entry.status === 'POSTED' || entry.status === 'DISMISSED';
  const out = true; // site-reported payments are money out

  // ── Draft (AI read, then the owner's inline edits) ───────────────────────
  const touched = useRef<Set<string>>(new Set());
  const [payeeId, setPayeeId] = useState<string | null>(ai.payee_id || null);
  const [payeeName, setPayeeName] = useState<string | null>(ai.payee_name || ai.payee_raw || null);
  const [amount, setAmount] = useState<string>(ai.amount != null ? String(ai.amount) : '');
  const [projectId, setProjectId] = useState<string | null>(ai.project_id || null);
  const [projectName, setProjectName] = useState<string | null>(ai.project_name || null);
  // Day Book split: opt-in, projects only. null = not splitting; confirmed = owner pressed Done.
  const [splitRows, setSplitRows] = useState<{ id: string; projectId: string; amount: string }[] | null>(null);
  const [splitConfirmed, setSplitConfirmed] = useState(false);
  const [description, setDescription] = useState<string>(ai.description || ai.description_raw || '');
  const [generalExpense, setGeneralExpense] = useState(false);   // payee-less general expense (no linked party)
  const [genHead, setGenHead] = useState<string>('');            // GEN-xx head it's filed under
  const [genHeadLoading, setGenHeadLoading] = useState(false);   // LLM is picking the head

  // keep untouched fields live while the AI is still filling them in
  useEffect(() => {
    const a = entry.ai_extracted || {};
    if (!touched.current.has('payee')) { setPayeeId(a.payee_id || null); setPayeeName(a.payee_name || a.payee_raw || null); }
    if (!touched.current.has('amount')) setAmount(a.amount != null ? String(a.amount) : '');
    if (!touched.current.has('project')) { setProjectId(a.project_id || null); setProjectName(a.project_name || null); }
    if (!touched.current.has('description')) setDescription(a.description || a.description_raw || '');
  }, [entry.ai_extracted]);

  const amountNum = parseFloat((amount || '').replace(/[^\d.]/g, '')) || 0;
  const resolved: ResolvedFields = {
    payeeId: payeeId || '', projectId: projectId || '', amount: amountNum, description: description.trim(),
    generalExpense, generalExpenseHead: genHead || undefined,
  };
  // Split (opt-in, projects only): each row needs a project + amount, they must sum to the
  // total, and the owner confirms with Done before File posts N separate transactions.
  const splitActive = splitRows !== null;
  const splitParsed = (splitRows ?? []).map(r => ({ projectId: r.projectId, amount: parseFloat((r.amount || '').replace(/[^\d.]/g, '')) || 0 }));
  const splitRemaining = amountNum - splitParsed.reduce((s, r) => s + r.amount, 0);
  const splitValid = splitActive && (splitRows?.length ?? 0) >= 2 && splitParsed.every(r => r.projectId && r.amount > 0) && Math.abs(splitRemaining) < 0.01;
  const payeeOk = generalExpense ? true : Boolean(payeeId);
  const baseReadyNoProject = !archived && payeeOk && amountNum > 0 && Boolean(description.trim());

  const ready = splitActive ? (splitConfirmed && baseReadyNoProject && splitValid) : (!archived && isResolved(resolved));

  // Turn an entry into (or out of) a general expense. On enter, the LLM reads the
  // description and picks the right GEN head; the owner can change it after.
  const markGeneral = async (on: boolean) => {
    setGeneralExpense(on);
    if (!on) { setGenHead(''); return; }
    if (genHead) return;                 // keep an already-chosen head
    setGenHeadLoading(true);
    try {
      const code = await classifyExpenseHead(description || ai.description_raw || '');
      setGenHead(code);
    } finally {
      setGenHeadLoading(false);
    }
  };

  // ── Inline editor + filter ───────────────────────────────────────────────
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Field>(null);
  const [q, setQ] = useState('');
  const [newType, setNewType] = useState<PartyType>('Vendor');
  const [newCategory, setNewCategory] = useState('');
  const [newCategoryOther, setNewCategoryOther] = useState('');
  const [creating, setCreating] = useState(false);
  const [payeeSugDismissed, setPayeeSugDismissed] = useState(false);
  const openEditor = (f: Field, seed = '') => { setQ(seed); setEditing(f); };
  const mark = (f: string) => touched.current.add(f);
  const startSplit = () => { setSplitConfirmed(false); setSplitRows([
    { id: '1', projectId: projectId || '', amount: amountNum > 0 ? String(amountNum) : '' },
    { id: '2', projectId: '', amount: '' },
  ]); };
  const projNameOf = (id: string) => projects.find(p => p.project_id === id)?.name || 'project';

  const addParty = async () => {
    const nm = q.trim();
    if (!nm || creating) return;
    setCreating(true);
    try {
      const category = newCategory === OTHER_TRADE ? newCategoryOther : newCategory;
      const party = await createParty(nm, newType, orgId, category);
      qc.invalidateQueries({ queryKey: ['daybook_stakeholders'] });
      qc.invalidateQueries({ queryKey: ['stakeholders'] });
      setPayeeId(party.id); setPayeeName(party.name); mark('payee'); setEditing(null); setNewCategory(''); setNewCategoryOther('');
    } catch (err: unknown) {
      onError(errMessage(err, "Couldn't add the party"));
    } finally {
      setCreating(false);
    }
  };

  // ── Triage / journey ──────────────────────────────────────────────────────
  const [leaving, setLeaving] = useState<Leaving>(null);
  const [phase, setPhase] = useState<Phase>(null);
  const [filedTxnId, setFiledTxnId] = useState<string | null>(null);

  const runFile = async () => {
    if (!ready || leaving) return;
    const reduced = swipe.reducedMotion;
    setLeaving('file'); setPhase('filing');
    try {
      let txnId: string;
      if (splitConfirmed && splitValid) {
        const base = { payeeId: payeeId || '', amount: amountNum, description: description.trim(), generalExpense, generalExpenseHead: genHead || undefined };
        const ids = await fileRoughEntrySplit(entry, orgId, base, splitParsed);
        txnId = ids[0];
      } else {
        txnId = await fileRoughEntry(entry, orgId, resolved);
      }
      setFiledTxnId(txnId);
      setPhase('filed');
      onFiled(txnId);   // Logbook keeps this card in place (justFiled) + refreshes ledger
      // hold the green "Filed" beat, then collapse to the persistent one-line strip
      setTimeout(() => setPhase('collapsed'), reduced ? 0 : 950);
    } catch (err: unknown) {
      setLeaving(null); setPhase(null);
      onError(errMessage(err, "Couldn't file, try again"));
    }
  };
  const runReject = async () => {
    if (leaving) return;
    setLeaving('reject');
    try {
      await rejectRoughEntry(entry);   // -> DISMISSED; the card collapses to an "undo" strip in place
      setPhase('rejected');
      onRejected();
    } catch (err: unknown) {
      setLeaving(null);
      onError(errMessage(err, "Couldn't reject, try again"));
    }
  };
  // Undo a reject from the strip: restore to the review queue.
  const runUndo = async () => {
    try {
      await restoreRoughEntry(entry);
      setPhase(null); setLeaving(null);
      onRestore();
    } catch (err: unknown) {
      onError(errMessage(err, "Couldn't undo, try again"));
    }
  };
  // Move a binned (Not-a-transaction) entry back to review — the actual restore the
  // old "move back" never performed (it only refetched).
  const runRestore = async () => {
    try {
      await restoreRoughEntry(entry);
      onRestore();
    } catch (err: unknown) {
      onError(errMessage(err, "Couldn't move it back, try again"));
    }
  };

  const swipe = useSwipeTriage({
    enabled: !archived && canManage && editing === null,
    canFileRight: ready,
    onFileRight: runFile,
    onRejectLeft: runReject,
  });

  // The lingering filed/rejected strip is a confirmation, not a permanent row — it
  // settles itself (into Filed / the Not-a-transaction bin) after a beat.
  useEffect(() => {
    if (phase !== 'collapsed' && phase !== 'rejected') return;
    const t = setTimeout(onDismiss, 7000);
    return () => clearTimeout(t);
  }, [phase, onDismiss]);

  // ── filed journey: filing → "Filed ✓" beat → a quiet one-line strip (in place) ──
  if (phase === 'filing' || phase === 'filed') {
    return (
      <div className="relative rounded-2xl overflow-hidden db-reveal" style={{ background: V.sageWash, border: `1px solid ${V.sage}33` }}>
        {phase === 'filing' && <div className="absolute inset-y-0 left-0 right-0 db-sweep" style={{ background: 'linear-gradient(90deg, rgba(47,93,52,0.16), rgba(47,93,52,0.05))' }} />}
        <div className="relative flex items-center px-4 sm:px-5" style={{ minHeight: 96 }}>
          {phase === 'filing' ? (
            <span className="inline-flex items-center gap-2.5 font-medium" style={{ color: V.sage, ...font, ...T.sm }}>
              <ArrowRight size={16} /> Filing to transactions
            </span>
          ) : (
            <span className="inline-flex items-center gap-2.5 font-medium db-confirm" style={{ color: V.sage, ...font, ...T.sm }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path className="db-draw" d="M5 12.5l4.5 4.5L19 7" stroke={V.sage} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Filed · in your books
            </span>
          )}
        </div>
      </div>
    );
  }
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

  const dx = swipe.dx;
  const fileShown = dx > 24;
  const rejectShown = dx < -24;
  const offClass = leaving === 'file' ? 'db-file-off' : leaving === 'reject' ? 'db-reject-off' : '';
  const said = entry.raw_text || entry.transcribed_text || (entry.raw_image_url ? '' : '—');

  // tier-1 provenance — entry no · sender · captured-at (the date line carries a dot).
  const fromWa = entry.source.startsWith('WHATSAPP');
  const senderName = entry.sender_name || 'Unknown sender';
  const initials = senderName.trim().split(/\s+/)[0].slice(0, 2).toUpperCase() || '—';
  const channelLabel = entry.source === 'WHATSAPP_VOICE' ? 'WhatsApp voice'
    : entry.source === 'WHATSAPP_IMAGE' ? 'WhatsApp photo' : 'WhatsApp';
  // How Briklay got these words — a quiet provenance caption (Instagram-byline grammar).
  const sourceCaption = entry.source === 'WHATSAPP_VOICE' ? 'Transcribed from a voice note'
    : entry.source === 'WHATSAPP_IMAGE' ? 'Read from the photo'
    : entry.source === 'UI_IMAGE' ? 'Scanned'
    : entry.source === 'UI_TEXT' ? 'Added here'
    : 'From a WhatsApp message';
  const SourceIcon = entry.source === 'WHATSAPP_VOICE' ? Mic
    : (entry.source === 'WHATSAPP_IMAGE' || entry.source === 'UI_IMAGE') ? ImageIcon
    : null;
  const captured = new Date(entry.created_at);
  const sentDate = captured.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  const sentTime = captured.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  // Show just the serial (the trailing number of an "RE-26-0142" code), not the prefix.
  const reSerial = (entry.re_number || '').split('-').pop()?.replace(/^0+(?=\d)/, '') || '';

  const amberChip = (label: string, onClick: () => void) => (
    <button onClick={(e) => { e.stopPropagation(); if (canManage) onClick(); }} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md" style={{ flexShrink: 0, whiteSpace: 'nowrap', background: V.askWash, border: `1px solid ${V.askLine}`, color: V.ask, ...font, ...T.xs }}>
      <Pencil size={10} /> {label}
    </button>
  );
  const filledChip = (icon: React.ReactNode, label: string, onClick: () => void) => (
    <button onClick={(e) => { e.stopPropagation(); if (canManage) onClick(); }} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md" style={{ flexShrink: 0, whiteSpace: 'nowrap', background: V.field, color: V.inkSoft, ...font, ...T.xs }}>
      {icon}<span className="truncate" style={{ maxWidth: 200 }}>{label}</span>
    </button>
  );
  // One-tap resolve button for Day Book suggestions ("Use Raju", "Pick project").
  // This is where the matching the chat deliberately DIDN'T do gets resolved, fast.
  const resolveBtn = (label: React.ReactNode, onClick: () => void, primary = false) => (
    <button onClick={(e) => { e.stopPropagation(); if (canManage) onClick(); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md" style={primary
      ? { background: V.sageWash, border: `1px solid ${V.sage}33`, color: V.sage, fontWeight: 500, ...font, ...T.xs }
      : { background: V.field, color: V.inkSoft, ...font, ...T.xs }}>
      {label}
    </button>
  );

  // the linked payee's own trade/category — shown next to the general-expense option
  const payeeStk = payeeId ? stakeholders.find(s => s.stakeholder_id === payeeId) : null;
  const payeeTrade = payeeStk?.category || payeeStk?.type || null;

  const filteredStk = stakeholders
    .filter(s => s.name.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 7);
  const filteredProj = projects
    .filter(p => p.name.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 8);

  return (
    <div className="relative rounded-2xl overflow-hidden select-none">
      {/* underneath: swipe trail OR filing -> filed confirmation */}
      {phase ? (
        <div className="absolute inset-0 overflow-hidden db-reveal" style={{ background: V.sageWash }}>
          {phase === 'filing' && <div className="absolute inset-y-0 left-0 right-0 db-sweep" style={{ background: 'linear-gradient(90deg, rgba(47,93,52,0.16), rgba(47,93,52,0.05))' }} />}
          <div className="absolute inset-0 flex items-center px-6">
            {phase === 'filing' ? (
              <span className="inline-flex items-center gap-2.5 font-medium" style={{ color: V.sage, ...font, ...T.sm }}><ArrowRight size={16} /> Filing to transactions</span>
            ) : (
              <span className="inline-flex items-center gap-2.5 font-medium db-confirm" style={{ color: V.sage, ...font, ...T.sm }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path className="db-draw" d="M5 12.5l4.5 4.5L19 7" stroke={V.sage} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Filed · in your books
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-between px-6" style={{ background: fileShown ? V.sageWash : rejectShown ? V.field : 'transparent' }}>
          <span className="inline-flex items-center gap-2" style={{ opacity: fileShown ? 1 : 0, color: V.sage, ...font, ...T.sm }}><Check size={18} strokeWidth={2.5} /> File it</span>
          <span className="inline-flex items-center gap-2 ml-auto" style={{ opacity: rejectShown ? 1 : 0, color: V.sys, ...font, ...T.sm }}>Not a transaction <X size={18} /></span>
        </div>
      )}

      {/* the card */}
      <div
        className={`db-card ${offClass}`}
        {...swipe.bind}
        style={{
          transform: leaving ? undefined : `translateX(${dx}px) rotate(${dx * 0.02}deg)`,
          transition: !swipe.dragging && !leaving ? 'transform .25s cubic-bezier(.3,.7,.2,1), box-shadow .2s ease, border-color .2s ease' : 'none',
          background: V.surface, borderRadius: 16,
          cursor: swipe.dragging ? 'grabbing' : 'grab', touchAction: 'pan-y',
        }}
      >
        {/* tier 1 — the site (social-post grammar: avatar · author · meta) */}
        <div className="px-4 sm:px-5 pt-4 pb-4">
          {/* author header — avatar, sender + meta line, review status pill on the right */}
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-medium" style={{ background: V.terraWash, color: V.terraDeep, ...font, ...T.sm }}>
              {initials}
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate" style={{ color: V.ink, ...font, ...T.sm }}>{senderName}</p>
              <p className="mt-0.5 truncate inline-flex items-center gap-1.5" style={{ color: V.faint, ...font, ...T.xs }}>
                {reSerial && (<><span style={{ ...nums }}>№ {reSerial}</span><span style={{ color: V.line }}>·</span></>)}
                {fromWa && (<><span className="inline-flex items-center gap-1"><WhatsAppGlyph size={11} color={WA} /> {channelLabel}</span><span style={{ color: V.line }}>·</span></>)}
                <span style={{ ...nums }}>{sentDate} · {sentTime}</span>
              </p>
            </div>
            {!ready && (
              <span className="shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full" style={{ background: V.askWash, border: `1px solid ${V.askLine}`, color: V.ask, ...font, ...T.xs }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: V.ask }} />
                needs your eye
              </span>
            )}
          </div>

          {/* what the site said — the hero, unquoted (Instagram-caption grammar) */}
          {said && <p className={`mt-3 ${reveal ? 'tf-raw' : ''}`} style={{ color: V.ink, ...serif, fontSize: 'clamp(1.05rem, 0.95rem + 0.7vw, 1.3rem)', lineHeight: 1.4 }}>{said}</p>}
          {entry.raw_image_url && (
            <button onClick={(e) => { e.stopPropagation(); onLightbox(entry.raw_image_url!); }} className="mt-3 rounded-xl overflow-hidden block" style={{ width: '100%', maxWidth: 240, height: 140, background: '#E8E2DA' }}>
              <img src={entry.raw_image_url} alt="capture" className="w-full h-full object-cover" />
            </button>
          )}
          {!said && !entry.raw_image_url && <span className="mt-3 inline-flex items-center gap-1.5" style={{ color: V.faint, ...font, ...T.xs }}><ImageIcon size={14} /> no message body</span>}

          {/* provenance subtext — how Briklay got these words */}
          {(said || entry.raw_image_url) && (
            <p className="mt-2 inline-flex items-center gap-1.5" style={{ color: V.faint, ...font, ...T.xs }}>
              {SourceIcon && <SourceIcon size={11} />}
              <span>{sourceCaption}</span>
            </p>
          )}
        </div>

        {/* what Briklay understood — one flat surface, an excellently quiet kicker */}
        <div className="px-4 sm:px-5 pb-4">
          <p className="mb-2" style={{ color: V.faint, ...font, ...T.xs, letterSpacing: '0.03em' }}>Briklay understood</p>
          {/* read + asks. Desktop: ONE line (values + a scrollable asks row). Mobile:
              values on top, the asks become their own tidy horizontally-scrollable row
              beneath — never a wall of wrapped chips, never hidden behind the amount. */}
          <div className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 ${reveal ? 'tf-read' : ''}`}>
            {/* values — badge · amount · payee, one unit that never splits */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="w-7 h-7 rounded-full flex items-center justify-center" style={{ flexShrink: 0, background: out ? V.terraWash : V.sageWash }}>
                {out ? <ArrowUpRight size={14} color={V.terraDeep} /> : <ArrowDownLeft size={14} color={V.sage} />}
              </span>
              {amountNum > 0 && (
                <button onClick={(e) => { e.stopPropagation(); if (canManage) openEditor('amount', amount); }} className="font-medium" style={{ flexShrink: 0, whiteSpace: 'nowrap', color: out ? V.terraDeep : V.sage, ...font, ...nums, ...T.amt }}>
                  {out ? '−' : '+'}₹{inr(amountNum)}
                </button>
              )}
              {generalExpense && payeeName ? (
                <button onClick={(e) => { e.stopPropagation(); if (canManage) markGeneral(false); }} title="Tap to link a payee instead" className="truncate" style={{ flexShrink: 1, minWidth: 0, color: V.sys, ...font, ...T.sm }}>
                  {payeeName}
                </button>
              ) : payeeId ? (
                <button onClick={(e) => { e.stopPropagation(); if (canManage) openEditor('payee', payeeName || ''); }} className="truncate" style={{ flexShrink: 1, minWidth: 0, color: V.ink, ...font, ...T.sm }}>
                  {payeeName}
                </button>
              ) : payeeName ? (
                <button onClick={(e) => { e.stopPropagation(); if (canManage) openEditor('payee', payeeName || ''); }} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md max-w-full" style={{ flexShrink: 1, minWidth: 0, background: V.askWash, border: `1px solid ${V.askLine}`, color: V.ask, ...font, ...T.sm }}>
                  <span className="truncate">{payeeName}</span>
                </button>
              ) : null}
            </div>

            {/* the asks — a single horizontally-scrollable row (its own line on mobile) */}
            <div className="db-noscroll" style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: 6, overflowX: 'auto', overflowY: 'hidden', minWidth: 0 }} onPointerDown={(e) => e.stopPropagation()}>
              {amountNum <= 0 && amberChip('how much?', () => openEditor('amount'))}
              {!payeeId && !payeeName && !generalExpense && amberChip('who was paid?', () => openEditor('payee'))}
              {projectId
                ? filledChip(<Link2 size={11} style={{ color: V.faint }} />, projectName || 'Project', () => openEditor('project', projectName || ''))
                : !ai.project_raw
                  ? amberChip('which project?', () => openEditor('project'))
                  : null}
              {description.trim()
                ? filledChip(<Pencil size={10} style={{ color: V.faint }} />, description.trim(), () => openEditor('description', description))
                : amberChip('what was it for?', () => openEditor('description'))}
              {ai.wo_number && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md" style={{ flexShrink: 0, whiteSpace: 'nowrap', background: V.field, color: V.inkSoft, ...font, ...T.xs }}>
                  <Link2 size={11} style={{ color: V.faint }} /><span style={{ color: V.faint }}>{ai.wo_number}</span>
                </span>
              )}
            </div>

          </div>

          {/* low-confidence amount (a spoken/code-mixed numeral the agent wasn't sure
              of) — the ONE amount flag, keyed to amount_confidence, showing the exact
              phrase so the owner catches it. Never a confident silent save. */}
          {ai.amount_confidence === 'LOW' && amountNum > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); if (canManage) openEditor('amount', amount); }}
              className="mt-1.5 inline-flex items-center gap-1.5 text-left"
              style={{ color: V.ask, ...font, ...T.xs, paddingLeft: 38 }}
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: V.ask }} />
              {ai.amount_source_phrase
                ? `read "${ai.amount_source_phrase}" as ₹${inr(amountNum)} — right?`
                : `₹${inr(amountNum)} — read that right?`}
            </button>
          )}

          {/* heard a name, but it is not one of your parties yet — the disambiguation
              WhatsApp deliberately skipped, resolved here in one tap */}
          {!payeeId && payeeName && editing !== 'payee' && !generalExpense && (
            ai.suggested_payee && !payeeSugDismissed
              && ai.suggested_payee.name.toLowerCase() !== (payeeName || '').toLowerCase() ? (
              <div className="mt-2" style={{ paddingLeft: 38 }}>
                <p style={{ color: V.ask, ...font, ...T.xs }}>
                  Heard <span style={{ fontWeight: 600, color: V.inkSoft }}>{payeeName}</span> — did you mean{' '}
                  <span style={{ fontWeight: 600, color: V.inkSoft }}>{ai.suggested_payee.name}</span>?
                </p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {resolveBtn(`Use ${ai.suggested_payee.name}`, () => { setPayeeId(ai.suggested_payee!.id); setPayeeName(ai.suggested_payee!.name); mark('payee'); }, true)}
                  {resolveBtn(`Keep ${payeeName}`, () => setPayeeSugDismissed(true))}
                  {resolveBtn(<><UserPlus size={11} /> New contact</>, () => openEditor('payee', payeeName || ''))}
                </div>
              </div>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); if (canManage) openEditor('payee', payeeName || ''); }}
                className="mt-2 inline-flex items-center gap-1.5 text-left"
                style={{ paddingLeft: 38, color: V.ask, ...font, ...T.xs }}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: V.ask }} />
                <span>
                  <span style={{ fontWeight: 600, color: V.inkSoft }}>{payeeName}</span> isn’t in your contacts — <span style={{ textDecoration: 'underline', textUnderlineOffset: 2, textDecorationColor: V.askLine }}>add them</span>
                </span>
              </button>
            )
          )}

          {/* general expense — sits BELOW the name line so "add them" reads first. On
              every entry (any payment can be a general expense). With a payee linked,
              it shows that party's trade/category, with general-expense as the alternative.
              Once chosen, the LLM picks the expense head from the description; the owner
              can change it — general expenses file under a head, never a payee. */}
          {generalExpense ? (
            <div className="mt-1.5 inline-flex items-center gap-1.5 flex-wrap" style={{ paddingLeft: 38, color: V.faint, ...font, ...T.xs }}>
              <Wallet size={11} style={{ color: V.faint }} />
              {genHeadLoading ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="db-spin inline-block w-3 h-3 rounded-full" style={{ border: `1.5px solid ${V.line}`, borderTopColor: V.faint }} />
                  Finding the right expense head…
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 flex-wrap">
                  <span>General expense ·</span>
                  <button onClick={(e) => { e.stopPropagation(); if (canManage) openEditor('genHead'); }} className="inline-flex items-center gap-1" style={{ color: V.inkSoft, fontWeight: 600 }}>
                    {genHead && getCostCode(genHead) ? getCostCode(genHead)!.item.name : 'Pick an expense head'}
                    <Pencil size={9} style={{ color: V.faint }} />
                  </button>
                </span>
              )}
            </div>
          ) : !canManage ? null : payeeId && payeeTrade ? (
            <p className="mt-1.5 inline-flex items-center gap-1.5 flex-wrap" style={{ paddingLeft: 38, color: V.sys, ...font, ...T.xs }}>
              <Wallet size={11} style={{ color: V.faint }} />
              <span>
                Is it <span style={{ color: V.inkSoft }}>{payeeTrade}</span> or a{' '}
                <button onClick={(e) => { e.stopPropagation(); markGeneral(true); }} style={{ textDecoration: 'underline', textUnderlineOffset: 2, textDecorationColor: V.line, color: V.sys }}>general expense</button>?
              </span>
            </p>
          ) : (
            <div className="mt-1.5" style={{ paddingLeft: 38 }}>
              <button
                onClick={(e) => { e.stopPropagation(); markGeneral(true); }}
                className="inline-flex items-center gap-1.5 text-left"
                style={{ color: V.sys, ...font, ...T.xs }}
              >
                <Wallet size={11} style={{ color: V.faint }} />
                <span><span style={{ textDecoration: 'underline', textUnderlineOffset: 2, textDecorationColor: V.line }}>Mark as a general expense</span> — a payee link isn't needed</span>
              </button>
              {/* scoped to general expenses only — normal payments still track to the payee */}
              <p className="mt-1" style={{ paddingLeft: 18, color: V.faint, ...font, ...T.xs, opacity: 0.85 }}>
                General expenses go under a category head, not a payee.
              </p>
            </div>
          )}

          {/* project heard but not a registered project — one-tap resolve */}
          {!projectId && ai.project_raw && editing !== 'project' && (
            <div className="mt-2" style={{ paddingLeft: 38 }}>
              <p style={{ color: V.ask, ...font, ...T.xs }}>
                <span style={{ fontWeight: 600, color: V.inkSoft }}>{ai.project_raw}</span> — not a registered project
              </p>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {ai.suggested_project && ai.suggested_project.name.toLowerCase() !== (ai.project_raw || '').toLowerCase()
                  && resolveBtn(`Use ${ai.suggested_project.name}`, () => { setProjectId(ai.suggested_project!.id); setProjectName(ai.suggested_project!.name); mark('project'); }, true)}
                {resolveBtn('Pick project', () => openEditor('project', ai.project_raw || ''))}
              </div>
            </div>
          )}

          {/* inline editor — a recessed panel, tinted distinct from the white card */}
          {editing && canManage && (
            <div onPointerDown={(e) => e.stopPropagation()} className="mt-3 rounded-xl p-3 w-full" style={{ maxWidth: 440, background: V.field, border: '1px solid #E3DDD4', boxShadow: 'inset 0 1px 2px rgba(60,46,26,0.05)' }}>
              {(editing === 'payee' || editing === 'project') && (
                <>
                  <div className="inline-flex items-center gap-2 px-2.5 rounded-lg w-full" style={{ background: V.surface, border: `1px solid ${V.line}`, height: 36 }}>
                    <Search size={13} style={{ color: V.faint }} />
                    <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={editing === 'payee' ? 'Search a party…' : 'Search a project…'} className="bg-transparent outline-none flex-1" style={{ color: V.ink, ...font, ...T.sm }} />
                  </div>
                  <div className="mt-2 max-h-44 overflow-y-auto -mx-0.5">
                    {editing === 'payee' && filteredStk.map(s => (
                      <button key={s.stakeholder_id} onClick={() => { setPayeeId(s.stakeholder_id); setPayeeName(s.name); mark('payee'); setEditing(null); }} className="w-full text-left px-2.5 py-2 rounded-lg flex items-center justify-between gap-2" style={{ ...font }}>
                        <span className="truncate" style={{ color: V.ink, ...T.sm }}>{s.name}</span>
                        {s.type && <span className="shrink-0" style={{ color: V.faint, ...T.xs }}>{s.type}</span>}
                      </button>
                    ))}
                    {editing === 'payee' && q.trim() && filteredStk.length === 0 && (
                      <p className="px-2.5 py-2" style={{ color: V.faint, ...font, ...T.xs }}>No party named "{q.trim()}" yet.</p>
                    )}
                    {editing === 'project' && filteredProj.map(p => (
                      <button key={p.project_id} onClick={() => { setProjectId(p.project_id); setProjectName(p.name); mark('project'); setEditing(null); }} className="w-full text-left px-2.5 py-2 rounded-lg" style={{ color: V.ink, ...font, ...T.sm }}>
                        <span className="truncate">{p.name}</span>
                      </button>
                    ))}
                    {editing === 'project' && filteredProj.length === 0 && <p className="px-2.5 py-2" style={{ color: V.faint, ...font, ...T.xs }}>No project found</p>}
                  </div>

                  {/* add a brand-new party, right here */}
                  {editing === 'payee' && q.trim() && (
                    <div className="mt-1 pt-2.5" style={{ borderTop: `1px solid ${V.line}` }}>
                      <p className="mb-2 inline-flex items-center gap-1.5" style={{ color: V.sys, ...font, ...T.xs }}>
                        <UserPlus size={12} style={{ color: V.faint }} /> Add "{q.trim()}" as a new party
                      </p>
                      <div className="flex gap-1 flex-wrap">
                        {(['Worker', 'Vendor', 'Client'] as PartyType[]).map(t => (
                          <button key={t} onClick={() => { setNewType(t); setNewCategory(''); setNewCategoryOther(''); }} className="px-2.5 py-1 rounded-full font-medium" style={newType === t ? { background: V.terraWash, border: `1px solid ${V.askLine}`, color: V.terraDeep, ...font, ...T.xs } : { background: V.surface, border: `1px solid ${V.line}`, color: V.sys, ...font, ...T.xs }}>
                            {t}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        {newType !== 'Client' ? (
                          <select value={newCategory} onChange={(e) => { setNewCategory(e.target.value); setNewCategoryOther(''); }} className="px-2.5 rounded-lg flex-1 min-w-0 outline-none appearance-none" style={{ background: V.surface, border: `1px solid ${V.line}`, color: newCategory ? V.ink : V.faint, height: 34, ...font, ...T.xs }}>
                            <option value="">Trade / category…</option>
                            {(newType === 'Worker' ? WORKER_TRADE_GROUPS : VENDOR_TRADE_GROUPS).map(g => (
                              <optgroup key={g.group} label={g.group}>
                                {g.trades.map(t => <option key={t} value={t}>{t}</option>)}
                              </optgroup>
                            ))}
                          </select>
                        ) : <span className="flex-1" />}
                        <button onClick={addParty} disabled={creating} className="inline-flex items-center justify-center gap-1.5 px-3.5 rounded-lg font-medium shrink-0" style={{ height: 34, background: terraGrad, color: '#fff', ...font, ...T.xs }}>
                          {creating ? 'Adding…' : <>Add &amp; link</>}
                        </button>
                        <button onClick={() => setEditing(null)} aria-label="Cancel" className="shrink-0 inline-flex items-center justify-center rounded-lg" style={{ width: 34, height: 34, background: V.surface, border: `1px solid ${V.line}`, color: V.faint }}>
                          <X size={15} />
                        </button>
                      </div>
                      {newType !== 'Client' && newCategory === OTHER_TRADE && (
                        <input value={newCategoryOther} onChange={(e) => setNewCategoryOther(e.target.value)} autoFocus placeholder="Specify trade…" className="px-2.5 rounded-lg w-full outline-none mt-2" style={{ background: V.surface, border: `1px solid ${V.line}`, color: V.ink, height: 34, ...font, ...T.xs }} />
                      )}
                    </div>
                  )}
                </>
              )}

              {editing === 'amount' && (
                <div className="flex items-center gap-2">
                  <div className="inline-flex items-center gap-1.5 px-2.5 rounded-lg flex-1" style={{ background: V.surface, border: `1px solid ${V.line}`, height: 38 }}>
                    <span style={{ color: V.faint, ...font, ...T.sm }}>₹</span>
                    <input autoFocus inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); mark('amount'); }} placeholder="0" className="bg-transparent outline-none flex-1" style={{ color: V.ink, ...font, ...nums, ...T.sm }} />
                  </div>
                  <button onClick={() => setEditing(null)} className="px-3 py-2 rounded-lg font-medium" style={{ background: V.surface, border: `1px solid ${V.line}`, color: V.inkSoft, ...font, ...T.sm }}>Done</button>
                </div>
              )}

              {editing === 'description' && (
                <div className="flex items-center gap-2">
                  <input autoFocus value={description} onChange={(e) => { setDescription(e.target.value); mark('description'); }} placeholder="What was it for?" className="px-2.5 rounded-lg flex-1 outline-none" style={{ background: V.surface, border: `1px solid ${V.line}`, color: V.ink, height: 38, ...font, ...T.sm }} />
                  <button onClick={() => setEditing(null)} className="px-3 py-2 rounded-lg font-medium" style={{ background: V.surface, border: `1px solid ${V.line}`, color: V.inkSoft, ...font, ...T.sm }}>Done</button>
                </div>
              )}

              {editing === 'genHead' && (
                <>
                  <div className="inline-flex items-center gap-2 px-2.5 rounded-lg w-full" style={{ background: V.surface, border: `1px solid ${V.line}`, height: 36 }}>
                    <Search size={13} style={{ color: V.faint }} />
                    <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search an expense head…" className="bg-transparent outline-none flex-1" style={{ color: V.ink, ...font, ...T.sm }} />
                  </div>
                  <div className="mt-2 max-h-44 overflow-y-auto -mx-0.5">
                    {GEN_HEADS.filter(h => h.name.toLowerCase().includes(q.toLowerCase()) || h.code.toLowerCase().includes(q.toLowerCase())).map(h => (
                      <button key={h.code} onClick={() => { setGenHead(h.code); setEditing(null); }} className="w-full text-left px-2.5 py-2 rounded-lg flex items-center justify-between gap-2" style={{ ...font }}>
                        <span className="truncate" style={{ color: h.code === genHead ? V.ink : V.inkSoft, fontWeight: h.code === genHead ? 600 : 400, ...T.sm }}>{h.name}</span>
                        {h.code === genHead && <Check size={13} style={{ color: V.sage }} className="shrink-0" />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* split across projects — sits with the File action */}
        {canManage && !archived && amountNum > 0 && (
          <div className="px-4 sm:px-5 pt-3 pb-3" onPointerDown={(e) => e.stopPropagation()}>
            {splitRows === null ? (
              // ── trigger ──
              <button onClick={startSplit} className="inline-flex items-center gap-1.5" style={{ color: V.terraDeep, ...font, ...T.xs }}>
                <Split size={13} /> Split this txn between projects
              </button>
            ) : splitConfirmed ? (
              // ── confirmed: subtle success + plain-language summary ──
              <div className="rounded-xl p-3 db-drop flex items-start gap-2.5" style={{ background: V.sageWash, border: `1px solid rgba(47,93,52,0.18)` }}>
                <span className="db-pop inline-flex items-center justify-center rounded-full shrink-0" style={{ width: 22, height: 22, background: V.sage }}>
                  <Check size={13} color="#fff" strokeWidth={3} />
                </span>
                <div className="flex-1 min-w-0">
                  <p style={{ color: V.sage, fontWeight: 600, ...font, ...T.sm }}>
                    Filing as {splitParsed.length} separate transactions, across {new Set(splitParsed.map(r => r.projectId)).size} projects
                  </p>
                  <p className="mt-0.5 leading-relaxed" style={{ color: V.sys, ...font, ...nums, ...T.xs }}>
                    {splitParsed.map(r => `₹${inr(r.amount)} → ${projNameOf(r.projectId)}`).join('   ·   ')}
                  </p>
                </div>
                <button onClick={() => setSplitConfirmed(false)} className="shrink-0 self-center" style={{ color: V.sage, ...font, ...T.xs }}>Edit</button>
              </div>
            ) : (
              // ── editor ──
              <div className="rounded-xl p-3 db-drop" style={{ background: V.field, border: `1px solid ${V.line}` }}>
                <div className="flex items-center justify-between mb-2.5">
                  <span className="uppercase inline-flex items-center gap-1.5" style={{ ...font, fontSize: 10, letterSpacing: '0.06em', color: V.faint }}>
                    <Split size={11} /> Split between projects
                  </span>
                  <span style={{ ...font, ...nums, fontSize: 11, color: Math.abs(splitRemaining) < 0.01 ? V.sage : splitRemaining < 0 ? V.terraDeep : V.ask }}>
                    {Math.abs(splitRemaining) < 0.01 ? 'Balanced' : splitRemaining < 0 ? `₹${inr(Math.abs(splitRemaining))} over` : `₹${inr(splitRemaining)} left`}
                  </span>
                </div>
                <div className="space-y-2">
                  {splitRows.map((r) => (
                    <div key={r.id} className="flex items-center gap-2">
                      <select value={r.projectId}
                        onChange={(e) => setSplitRows(rows => rows!.map(x => x.id === r.id ? { ...x, projectId: e.target.value } : x))}
                        className="flex-1 min-w-0 px-2 rounded-lg outline-none appearance-none" style={{ height: 36, background: V.surface, border: `1px solid ${V.line}`, color: r.projectId ? V.ink : V.faint, ...font, ...T.sm }}>
                        <option value="">Project…</option>
                        {projects.map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
                      </select>
                      <div className="inline-flex items-center gap-1 px-2 rounded-lg shrink-0" style={{ height: 36, width: 104, background: V.surface, border: `1px solid ${V.line}` }}>
                        <span style={{ color: V.faint, ...font, ...nums, ...T.sm }}>₹</span>
                        <input inputMode="decimal" value={r.amount}
                          onChange={(e) => setSplitRows(rows => rows!.map(x => x.id === r.id ? { ...x, amount: e.target.value } : x))}
                          placeholder="0" className="bg-transparent outline-none w-full min-w-0" style={{ color: V.ink, ...font, ...nums, ...T.sm }} />
                      </div>
                      {splitRows!.length > 1 && (
                        <button onClick={() => setSplitRows(rows => rows!.filter(x => x.id !== r.id))} aria-label="Remove split" className="shrink-0" style={{ color: V.faint }}><X size={15} /></button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <button onClick={() => setSplitRows(rows => [...rows!, { id: Math.random().toString(), projectId: '', amount: '' }])}
                    className="inline-flex items-center gap-1" style={{ color: V.terraDeep, ...font, ...T.xs }}>
                    <Plus size={13} /> Add project
                  </button>
                  <span className="flex-1" />
                  <button onClick={() => setSplitRows(null)} style={{ color: V.faint, ...font, ...T.xs }}>Cancel</button>
                  <button onClick={() => setSplitConfirmed(true)} disabled={!splitValid}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg font-medium"
                    style={splitValid ? { background: terraGrad, color: '#fff', ...font, ...T.xs } : { background: V.line, color: V.faint, ...font, ...T.xs, cursor: 'not-allowed' }}>
                    <Check size={13} /> Done
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* actions */}
        {canManage && (
          <div className="flex items-center gap-2 px-4 sm:px-5 py-3" style={{ borderTop: `1px solid ${V.line}` }}>
            <button onClick={runFile} disabled={!ready || !!leaving} title={ready ? 'File it' : 'Resolve the amber fields to file'} className="inline-flex items-center justify-center gap-1.5 font-medium px-4 py-2.5 min-h-[44px] whitespace-nowrap rounded-lg" style={ready ? { background: V.terraWash, border: `1px solid ${V.askLine}`, color: V.terraDeep, ...font, ...T.sm } : { background: V.field, color: V.faint, ...font, ...T.sm, cursor: 'not-allowed' }}>
              <Check size={15} /> File it
            </button>
            <button onClick={onFix} className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[44px] whitespace-nowrap rounded-lg" style={{ background: V.surface, border: `1px solid ${V.line}`, color: V.inkSoft, ...font, ...T.sm }}>
              <Pencil size={13} /> Fix
            </button>
            <span className="flex-1" />
            <button onClick={runReject} disabled={!!leaving} className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[44px] whitespace-nowrap rounded-lg" style={{ color: V.faint, ...font, ...T.sm }}>
              <X size={14} /> Not a transaction
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
