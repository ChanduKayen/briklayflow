/**
 * ReviewCard — a calm "review & approve" card for a captured entry.
 *
 * Editorial layout (see the design reference): a MONEY OUT eyebrow, the amount as a
 * large serif hero, then a natural summary line — "To {payee} · at {project} · for
 * {reason}" — built from what's known. Anything not known shows as an amber "{Field}
 * missing" line; an unmatched payee/project shows a quiet grey pill. Beneath a hairline,
 * the original WhatsApp message reads in plain ink. Two actions: Approve (files;
 * inactive until every field is confirmed — tapping it then flashes what's missing) and
 * Edit (the full editor). "Not a transaction" is the quiet third.
 *
 * The card is READ-ONLY; all fixes happen in the Edit editor (ResolvePopup). The file
 * journey is bound to the REAL write — never a false "Filed".
 */
import { useEffect, useState } from 'react';
import { Check, X, Pencil, ArrowRight, ArrowUpRight, Image as ImageIcon, Mic, ChevronRight } from 'lucide-react';
import type { RoughEntry } from '../../types';
import { V, WA, font, serif, nums, terraGrad, T } from './tokens';
import { WhatsAppGlyph } from './atoms';
import {
  fileRoughEntry, rejectRoughEntry, restoreRoughEntry, isResolved, errMessage, type ResolvedFields,
} from './fileEntry';
import { useSwipeTriage } from './useSwipeTriage';

export interface StakeholderLite { stakeholder_id: string; name: string; type?: string; category?: string }
export interface ProjectLite { project_id: string; name: string }

type Phase = null | 'filing' | 'filed' | 'collapsed' | 'rejected';
type Leaving = null | 'file' | 'reject';

const inr = (n: number) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export function ReviewCard({
  entry, orgId, reveal, canManage,
  onFiled, onView, onDismiss, onRejected, onRestore, onFix, onLightbox, onError,
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
  onLightbox: (url: string) => void;
  onError: (message: string) => void;
}) {
  const ai = entry.ai_extracted || {};
  const archived = entry.status === 'POSTED' || entry.status === 'DISMISSED';

  // Read-only view of the AI read — edits happen in the full editor (which refetches).
  const payeeId = ai.payee_id || null;
  const payeeName = ai.payee_name || ai.payee_raw || null;
  const projectId = ai.project_id || null;
  const projectName = ai.project_name || null;
  const projectRaw = ai.project_raw || null;
  const description = (ai.description || ai.description_raw || '').trim();
  const amountNum = parseFloat(String(ai.amount ?? '').replace(/[^\d.]/g, '')) || 0;

  const resolved: ResolvedFields = {
    payeeId: payeeId || '', projectId: projectId || '', amount: amountNum, description,
    generalExpense: false,
  };
  const ready = !archived && isResolved(resolved);

  // ── Triage / journey ──────────────────────────────────────────────────────
  const [leaving, setLeaving] = useState<Leaving>(null);
  const [phase, setPhase] = useState<Phase>(null);
  const [filedTxnId, setFiledTxnId] = useState<string | null>(null);
  const [nudge, setNudge] = useState(false);
  const [hover, setHover] = useState(false);

  const runFile = async () => {
    if (!ready || leaving) return;
    const reduced = swipe.reducedMotion;
    setLeaving('file'); setPhase('filing');
    try {
      const txnId = await fileRoughEntry(entry, orgId, resolved);
      setFiledTxnId(txnId);
      setPhase('filed');
      onFiled(txnId);
      setTimeout(() => setPhase('collapsed'), reduced ? 0 : 950);
    } catch (err: unknown) {
      setLeaving(null); setPhase(null);
      onError(errMessage(err, "Couldn't file, try again"));
    }
  };
  const tapApprove = () => {
    if (ready) { runFile(); return; }
    setNudge(true);
    setTimeout(() => setNudge(false), 2400);
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

  const swipe = useSwipeTriage({
    enabled: !archived && canManage,
    canFileRight: ready,
    onFileRight: runFile,
    onRejectLeft: runReject,
  });

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

  // ── active review card ─────────────────────────────────────────────────────
  const dx = swipe.dx;
  const fileShown = dx > 24;
  const rejectShown = dx < -24;
  const offClass = leaving === 'file' ? 'db-file-off' : leaving === 'reject' ? 'db-reject-off' : '';
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
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full align-middle" style={{ background: V.field, color: V.sys, ...font, fontSize: 11.5, fontWeight: 500, transition: 'background .3s ease', ...(nudge ? { background: V.askWash, color: V.ask } : {}) }}>{label}</span>
  );

  // Each fact on its own row: "To {payee}", "at {project}", "for {reason}" when known;
  // an amber "{Field} missing" otherwise. One even rhythm, the connectors aligned.
  type Row = { connector: string; value: string; pill?: string } | { miss: string };
  const rows: Row[] = [
    payeeId ? { connector: 'To', value: payeeName! }
      : payeeName ? { connector: 'To', value: payeeName, pill: 'Not in your contacts' }
      : { miss: 'Payee' },
    projectId ? { connector: 'at', value: projectName! }
      : projectRaw ? { connector: 'at', value: projectRaw, pill: 'not a project' }
      : { miss: 'Project' },
    description ? { connector: 'for', value: description } : { miss: 'Reason' },
  ];

  const divider = <div style={{ height: 1, background: V.line }} className="mx-5" />;

  return (
    <div className="relative rounded-2xl overflow-hidden select-none">
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
        className={`db-card ${offClass}`}
        {...swipe.bind}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          transform: leaving ? undefined : `translateX(${dx}px) rotate(${dx * 0.02}deg)`,
          transition: !swipe.dragging && !leaving ? 'transform .25s cubic-bezier(.3,.7,.2,1), box-shadow .25s ease, border-color .25s ease' : 'none',
          background: V.surface, borderRadius: 16, overflow: 'hidden',
          border: `1px solid ${hover ? '#D8CFC2' : '#E3DDD4'}`,
          boxShadow: hover ? '0 16px 38px -16px rgba(34,26,19,.24)' : '0 1px 2px rgba(34,26,19,.03)',
          cursor: swipe.dragging ? 'grabbing' : 'grab', touchAction: 'pan-y',
        }}
      >
        {/* ── Walnut amount hero — mirrors the editor's amount card ── */}
        <div className={reveal ? 'tf-read' : ''} style={{
          position: 'relative', overflow: 'hidden', padding: '15px 20px 15px',
          background: 'radial-gradient(120% 120% at 85% 0%, rgba(217,106,67,.16) 0%, rgba(217,106,67,0) 42%), linear-gradient(158deg,#2D2118 0%,#221A13 60%,#1B140E 100%)',
          transition: 'filter .3s ease', filter: hover ? 'brightness(1.07)' : 'none',
        }}>
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5" style={{ color: '#E89A72', ...font, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em' }}>
              <ArrowUpRight size={12} strokeWidth={2.5} /> MONEY OUT
            </span>
            {!archived && (
              <span className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full" style={{
                ...font, fontSize: 9, fontWeight: 700, letterSpacing: '.07em',
                background: ready ? 'rgba(123,176,108,.15)' : 'rgba(224,138,92,.15)',
                color: ready ? '#AFD3A1' : '#EBAE86',
                border: `1px solid ${ready ? 'rgba(123,176,108,.24)' : 'rgba(224,138,92,.24)'}`,
              }}>
                <span className="w-1 h-1 rounded-full" style={{ background: ready ? '#84BE74' : '#E08A5C' }} />
                {ready ? 'READY' : 'IN REVIEW'}
              </span>
            )}
          </div>

          {amountNum > 0 ? (
            <p className="mt-2" style={{ color: '#F3EADB', ...serif, ...nums, lineHeight: 1, letterSpacing: '-0.02em', fontSize: 'clamp(2rem, 1.35rem + 3.4vw, 2.85rem)' }}>
              <span style={{ fontSize: '0.4em', fontWeight: 600, letterSpacing: 0, marginRight: '0.12em', color: '#E89A72' }}>− ₹</span>{inr(amountNum)}
            </p>
          ) : (
            <p className="mt-2.5 inline-flex items-center gap-2" style={{ color: '#EBAE86', ...serif, fontSize: 'clamp(1.05rem, 0.85rem + 1vw, 1.35rem)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#E08A5C' }} /> Amount missing
            </p>
          )}
        </div>

        {/* facts — To / at / for, on cream */}
        <div className={`px-4 sm:px-5 pt-3.5 pb-4 ${reveal ? 'tf-read' : ''}`}>
          <div className="flex flex-col gap-2">
            {rows.map((r, i) => 'miss' in r ? (
              <div key={i} className="flex items-center rounded-md" style={{ transition: 'background .3s ease', background: nudge ? V.askWash : 'transparent', padding: nudge ? '3px 6px' : 0, marginLeft: nudge ? -6 : 0 }}>
                <span className="inline-flex items-center" style={{ width: 26, flexShrink: 0 }}>
                  <span className="w-1 h-1 rounded-full" style={{ background: V.ask }} />
                </span>
                <span style={{ ...font, ...T.sm, color: V.faint }}>
                  <span style={{ color: V.inkSoft, fontWeight: 500 }}>{r.miss}</span> missing
                </span>
              </div>
            ) : (
              <div key={i} className="flex items-baseline">
                <span style={{ width: 26, flexShrink: 0, color: V.faint, ...font, ...T.xs, fontWeight: 400 }}>{r.connector}</span>
                <span className="min-w-0" style={{ color: V.inkSoft, ...font, ...T.sm, fontWeight: 500, lineHeight: 1.45 }}>
                  {r.value}{r.pill ? <> {pill(r.pill)}</> : null}
                </span>
              </div>
            ))}
          </div>
        </div>

        {divider}

        {/* provenance — the WhatsApp message, in plain ink */}
        <div className="px-4 sm:px-5 pt-3 pb-3.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (entry.raw_image_url) onLightbox(entry.raw_image_url); }}
            disabled={!entry.raw_image_url}
            className="w-full flex items-center gap-2 text-left"
            style={{ cursor: entry.raw_image_url ? 'pointer' : 'default' }}
          >
            {sourceIcon}
            <span className="min-w-0 flex-1 truncate" style={{ color: V.inkSoft, ...font, ...T.xs, fontWeight: 500 }}>
              {senderName} <span style={{ color: V.faint, fontWeight: 400 }}>· {sentDate}, {sentTime}</span>
            </span>
            {entry.raw_image_url && <ChevronRight size={15} style={{ color: V.faint }} className="shrink-0" />}
          </button>
          {said && (
            <p className={`mt-1.5 ${reveal ? 'tf-raw' : ''}`} style={{ color: V.inkSoft, ...font, ...T.sm, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              &ldquo;{said}&rdquo;
            </p>
          )}
          {entry.raw_image_url && (
            <button onClick={(e) => { e.stopPropagation(); onLightbox(entry.raw_image_url!); }} className="mt-2 rounded-lg overflow-hidden block" style={{ width: '100%', maxWidth: 180, height: 104, background: '#E8E2DA' }}>
              <img src={entry.raw_image_url} alt="capture" className="w-full h-full object-cover" />
            </button>
          )}
        </div>

        {divider}

        {/* actions */}
        {canManage && (
          <div className="px-4 sm:px-5 pt-3 pb-4">
            {nudge && !ready && (
              <p className="mb-2 inline-flex items-center gap-1.5 db-drop" style={{ color: V.ask, ...font, ...T.xs }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: V.ask }} />
                Confirm the highlighted fields, then Approve — tap Edit to fix them.
              </p>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); tapApprove(); }}
                disabled={!!leaving}
                title={ready ? 'Approve & file' : 'Some fields are yet to be confirmed'}
                className={`group inline-flex items-center justify-center gap-1.5 font-semibold px-4 py-2 min-h-[40px] whitespace-nowrap rounded-lg transition-[transform,box-shadow,filter,opacity] duration-200 ease-out active:scale-[0.97] ${ready ? 'shadow-[0_3px_12px_rgba(167,62,31,0.26)] hover:shadow-[0_7px_20px_rgba(167,62,31,0.34)] hover:-translate-y-px hover:brightness-[1.04]' : ''}`}
                style={{ background: terraGrad, color: '#fff', opacity: ready ? 1 : 0.45, ...font, ...T.sm }}
              >
                <Check size={14} className="transition-transform duration-300 ease-out group-hover:scale-110 group-active:scale-90" /> Approve
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onFix(); }}
                className="group inline-flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[40px] whitespace-nowrap rounded-lg border bg-[#F4F2EE] hover:bg-[#ECE7DF] border-[#EAE6E0] hover:border-[#DED9D1] transition-[transform,background-color,border-color] duration-200 ease-out active:scale-[0.97]"
                style={{ color: V.inkSoft, ...font, ...T.sm, fontWeight: 600 }}
              >
                <Pencil size={12} className="transition-transform duration-200 ease-out group-hover:-rotate-12 group-hover:-translate-y-px" /> Edit
              </button>
              <span className="flex-1" />
              <button onClick={(e) => { e.stopPropagation(); runReject(); }} disabled={!!leaving} className="inline-flex items-center justify-center whitespace-nowrap transition-opacity duration-200 hover:opacity-60" style={{ color: V.faint, ...font, ...T.xs }}>
                Not a transaction
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
