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
  Check, X, Pencil, Link2, ArrowUpRight, ArrowDownLeft, ArrowDown, ArrowRight,
  Image as ImageIcon, Search, UserPlus,
} from 'lucide-react';
import type { RoughEntry } from '../../types';
import { V, font, nums, terraGrad, T } from './tokens';
import { ChannelBadge } from './atoms';
import {
  fileRoughEntry, rejectRoughEntry, createParty, isResolved, type ResolvedFields,
} from './fileEntry';
import { useSwipeTriage } from './useSwipeTriage';
import { WORKER_TRADE_GROUPS, VENDOR_TRADE_GROUPS, OTHER_TRADE } from '../../lib/trades';

type PartyType = 'Worker' | 'Vendor' | 'Client';

export interface StakeholderLite { stakeholder_id: string; name: string; type?: string; category?: string }
export interface ProjectLite { project_id: string; name: string }

type Phase = null | 'filing' | 'filed';
type Leaving = null | 'file' | 'reject';
type Field = null | 'payee' | 'amount' | 'project' | 'description';

const inr = (n: number) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export function ReviewCard({
  entry, orgId, reveal, canManage, stakeholders, projects,
  onFiled, onRejected, onRestore, onFix, onLightbox, onError,
}: {
  entry: RoughEntry;
  orgId: string;
  reveal: boolean;
  canManage: boolean;
  stakeholders: StakeholderLite[];
  projects: ProjectLite[];
  onFiled: (txnId: string) => void;
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
  const [description, setDescription] = useState<string>(ai.description || ai.description_raw || '');

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
  };
  const ready = !archived && isResolved(resolved);

  // ── Inline editor + filter ───────────────────────────────────────────────
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Field>(null);
  const [q, setQ] = useState('');
  const [newType, setNewType] = useState<PartyType>('Vendor');
  const [newCategory, setNewCategory] = useState('');
  const [newCategoryOther, setNewCategoryOther] = useState('');
  const [creating, setCreating] = useState(false);
  const openEditor = (f: Field, seed = '') => { setQ(seed); setEditing(f); };
  const mark = (f: string) => touched.current.add(f);

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
      onError(err instanceof Error ? err.message : "Couldn't add the party");
    } finally {
      setCreating(false);
    }
  };

  // ── Triage / journey ──────────────────────────────────────────────────────
  const [leaving, setLeaving] = useState<Leaving>(null);
  const [phase, setPhase] = useState<Phase>(null);

  const runFile = async () => {
    if (!ready || leaving) return;
    const reduced = swipe.reducedMotion;
    setLeaving('file'); setPhase('filing');
    try {
      const txnId = await fileRoughEntry(entry, orgId, resolved);
      setPhase('filed');
      setTimeout(() => onFiled(txnId), reduced ? 0 : 700);
    } catch (err: unknown) {
      setLeaving(null); setPhase(null);
      onError(err instanceof Error ? err.message : "Couldn't file, try again");
    }
  };
  const runReject = async () => {
    if (leaving) return;
    setLeaving('reject');
    try {
      await rejectRoughEntry(entry);
      setTimeout(onRejected, swipe.reducedMotion ? 0 : 380);
    } catch (err: unknown) {
      setLeaving(null);
      onError(err instanceof Error ? err.message : "Couldn't reject, try again");
    }
  };

  const swipe = useSwipeTriage({
    enabled: !archived && canManage && editing === null,
    canFileRight: ready,
    onFileRight: runFile,
    onRejectLeft: runReject,
  });

  // ── archived compact row ──────────────────────────────────────────────────
  if (archived) {
    const filed = entry.status === 'POSTED';
    return (
      <div className="db-drop rounded-2xl px-5 py-4 flex items-center gap-3" style={{ background: V.surface, border: '1px solid #E3DDD4' }}>
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
        {!filed && <button onClick={onRestore} className="shrink-0" style={{ color: V.faint, ...font, ...T.xs }}>move back</button>}
      </div>
    );
  }

  const dx = swipe.dx;
  const fileShown = dx > 24;
  const rejectShown = dx < -24;
  const offClass = leaving === 'file' ? 'db-file-off' : leaving === 'reject' ? 'db-reject-off' : '';
  const said = entry.raw_text || entry.transcribed_text || (entry.raw_image_url ? '' : '—');

  const amberChip = (label: string, onClick: () => void) => (
    <button onClick={(e) => { e.stopPropagation(); if (canManage) onClick(); }} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md" style={{ background: V.askWash, border: `1px solid ${V.askLine}`, color: V.ask, ...font, ...T.xs }}>
      <Pencil size={10} /> {label}
    </button>
  );
  const filledChip = (icon: React.ReactNode, label: string, onClick: () => void) => (
    <button onClick={(e) => { e.stopPropagation(); if (canManage) onClick(); }} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md max-w-full" style={{ background: V.field, color: V.inkSoft, ...font, ...T.xs }}>
      {icon}<span className="truncate">{label}</span>
    </button>
  );

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
        {/* tier 1 — the site */}
        <div className="px-5 pt-4 pb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 font-medium" style={{ background: V.terraWash, color: V.terraDeep, ...font, ...T.xs }}>
                {(entry.sender_name || '?').split(' ')[0].slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="font-medium truncate" style={{ color: V.ink, ...font, ...T.sm }}>{entry.sender_name || 'Unknown sender'}</p>
                {entry.sender_number && <p className="truncate" style={{ color: V.faint, ...font, ...nums, ...T.xs }}>+91 {entry.sender_number}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <ChannelBadge source={entry.source} />
              <span style={{ color: V.faint, ...font, ...nums, ...T.xs }}>{new Date(entry.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>

          <p className="uppercase font-medium mt-3" style={{ color: V.faint, letterSpacing: '0.1em', ...font, ...T.xs }}>
            {entry.source.startsWith('WHATSAPP') ? 'You sent this from WhatsApp' : 'You added this here'}
          </p>

          <div className="mt-1.5 inline-block rounded-xl rounded-tl-sm px-3 py-2" style={{ background: V.field, maxWidth: '100%' }}>
            {entry.source === 'WHATSAPP_VOICE' && <p className="italic mb-1" style={{ color: V.faint, ...font, ...T.xs }}>voice note, transcribed</p>}
            {said && <p className={reveal ? 'tf-raw' : ''} style={{ color: V.inkSoft, ...font, ...T.sm }}>{said}</p>}
            {entry.raw_image_url && (
              <button onClick={(e) => { e.stopPropagation(); onLightbox(entry.raw_image_url!); }} className="mt-2 rounded-lg overflow-hidden block" style={{ width: 120, height: 76, background: '#E8E2DA' }}>
                <img src={entry.raw_image_url} alt="capture" className="w-full h-full object-cover" />
              </button>
            )}
            {!said && !entry.raw_image_url && <span className="inline-flex items-center gap-1.5" style={{ color: V.faint, ...font, ...T.xs }}><ImageIcon size={14} /> no message body</span>}
          </div>
        </div>

        {/* seam */}
        <div className="flex items-center gap-2 px-5 relative">
          <span className="flex-1" style={{ borderTop: `1px solid ${V.line}` }} />
          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full shrink-0 ${reveal ? 'tf-arrow' : ''}`} style={{ background: V.surface, border: `1px solid ${V.line}` }}>
            <ArrowDown size={12} style={{ color: reveal ? V.terra : V.faint }} />
          </span>
          <span className="flex-1" style={{ borderTop: `1px solid ${V.line}` }} />
        </div>

        {/* tier 2 — what it becomes */}
        <div className="px-5 pt-4 pb-4" style={{ background: V.page }}>
          <div className="flex items-center justify-between mb-2.5">
            <p className="uppercase font-medium" style={{ color: V.faint, letterSpacing: '0.1em', ...font, ...T.xs }}>Briklay understood</p>
            <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full" style={ready ? { background: V.field, color: V.sys, ...font } : { background: V.askWash, border: `1px solid ${V.askLine}`, color: V.ask, ...font }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: ready ? V.terra : V.ask }} />
              {ready ? 'ready to file' : 'needs your eye'}
            </span>
          </div>

          {/* the read line: direction · amount · payee (each inline-editable) */}
          <div className={`flex items-center flex-wrap gap-x-2 gap-y-1 ${reveal ? 'tf-read' : ''}`}>
            <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: out ? V.terraWash : V.sageWash }}>
              {out ? <ArrowUpRight size={13} color={V.terraDeep} /> : <ArrowDownLeft size={13} color={V.sage} />}
            </span>

            {amountNum > 0 ? (
              <button onClick={(e) => { e.stopPropagation(); if (canManage) openEditor('amount', amount); }} className="font-medium" style={{ color: out ? V.terraDeep : V.sage, ...font, ...nums, ...T.amt }}>
                {out ? '−' : '+'} ₹{inr(amountNum)}
              </button>
            ) : amberChip('how much?', () => openEditor('amount'))}

            {payeeId ? (
              <button onClick={(e) => { e.stopPropagation(); if (canManage) openEditor('payee', payeeName || ''); }} style={{ color: V.sys, ...font, ...T.sm }}>
                {out ? 'to' : 'from'} {payeeName}
              </button>
            ) : payeeName ? (
              // heard a name but not linked to a party yet -> amber until linked
              <button onClick={(e) => { e.stopPropagation(); if (canManage) openEditor('payee', payeeName || ''); }} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ background: V.askWash, border: `1px solid ${V.askLine}`, color: V.ask, ...font, ...T.sm }}>
                {out ? 'to' : 'from'} {payeeName}
              </button>
            ) : amberChip('who was paid?', () => openEditor('payee'))}
          </div>

          {/* heard a name, but it is not one of your parties yet */}
          {!payeeId && payeeName && editing !== 'payee' && (
            <button
              onClick={(e) => { e.stopPropagation(); if (canManage) openEditor('payee', payeeName || ''); }}
              className="mt-1.5 inline-flex items-center gap-1.5 text-left"
              style={{ color: V.ask, ...font, ...T.xs, paddingLeft: 32 }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: V.ask }} />
              "{payeeName}" is not linked to any party in your system — tap to link or add
            </button>
          )}

          {/* secondary chips: project · note · anchor */}
          <div className={`mt-3 flex flex-wrap gap-1.5 ${reveal ? 'tf-chip' : ''}`} style={{ paddingLeft: 32 }}>
            {projectId
              ? filledChip(<Link2 size={11} style={{ color: V.faint }} />, projectName || 'Project', () => openEditor('project', projectName || ''))
              : amberChip('which project?', () => openEditor('project'))}
            {description.trim()
              ? filledChip(<Pencil size={10} style={{ color: V.faint }} />, description.trim(), () => openEditor('description', description))
              : amberChip('what was it for?', () => openEditor('description'))}
            {ai.wo_number && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md" style={{ background: V.field, color: V.inkSoft, ...font, ...T.xs }}>
                <Link2 size={11} style={{ color: V.faint }} /><span style={{ color: V.faint }}>{ai.wo_number}</span>
              </span>
            )}
          </div>

          {/* inline editor */}
          {editing && canManage && (
            <div onPointerDown={(e) => e.stopPropagation()} className="mt-3 rounded-xl p-2.5" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
              {(editing === 'payee' || editing === 'project') && (
                <>
                  <div className="inline-flex items-center gap-2 px-2.5 rounded-lg w-full" style={{ background: V.field, height: 36 }}>
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
                          <button key={t} onClick={() => { setNewType(t); setNewCategory(''); setNewCategoryOther(''); }} className="px-2.5 py-1 rounded-full font-medium" style={newType === t ? { background: V.terraWash, border: `1px solid ${V.askLine}`, color: V.terraDeep, ...font, ...T.xs } : { background: V.field, color: V.sys, ...font, ...T.xs }}>
                            {t}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        {newType !== 'Client' ? (
                          <select value={newCategory} onChange={(e) => { setNewCategory(e.target.value); setNewCategoryOther(''); }} className="px-2.5 rounded-lg flex-1 outline-none appearance-none" style={{ background: V.field, color: newCategory ? V.ink : V.faint, height: 34, ...font, ...T.xs }}>
                            <option value="">Trade / category…</option>
                            {(newType === 'Worker' ? WORKER_TRADE_GROUPS : VENDOR_TRADE_GROUPS).map(g => (
                              <optgroup key={g.group} label={g.group}>
                                {g.trades.map(t => <option key={t} value={t}>{t}</option>)}
                              </optgroup>
                            ))}
                          </select>
                        ) : <span className="flex-1" />}
                        <button onClick={addParty} disabled={creating} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium shrink-0" style={{ background: terraGrad, color: '#fff', ...font, ...T.xs }}>
                          {creating ? 'Adding…' : <>Add &amp; link</>}
                        </button>
                      </div>
                      {newType !== 'Client' && newCategory === OTHER_TRADE && (
                        <input value={newCategoryOther} onChange={(e) => setNewCategoryOther(e.target.value)} autoFocus placeholder="Specify trade…" className="px-2.5 rounded-lg w-full outline-none mt-2" style={{ background: V.field, color: V.ink, height: 34, ...font, ...T.xs }} />
                      )}
                    </div>
                  )}
                </>
              )}

              {editing === 'amount' && (
                <div className="flex items-center gap-2">
                  <div className="inline-flex items-center gap-1.5 px-2.5 rounded-lg flex-1" style={{ background: V.field, height: 38 }}>
                    <span style={{ color: V.faint, ...font, ...T.sm }}>₹</span>
                    <input autoFocus inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); mark('amount'); }} placeholder="0" className="bg-transparent outline-none flex-1" style={{ color: V.ink, ...font, ...nums, ...T.sm }} />
                  </div>
                  <button onClick={() => setEditing(null)} className="px-3 py-2 rounded-lg font-medium" style={{ background: V.field, color: V.inkSoft, ...font, ...T.sm }}>Done</button>
                </div>
              )}

              {editing === 'description' && (
                <div className="flex items-center gap-2">
                  <input autoFocus value={description} onChange={(e) => { setDescription(e.target.value); mark('description'); }} placeholder="What was it for?" className="px-2.5 rounded-lg flex-1 outline-none" style={{ background: V.field, color: V.ink, height: 38, ...font, ...T.sm }} />
                  <button onClick={() => setEditing(null)} className="px-3 py-2 rounded-lg font-medium" style={{ background: V.field, color: V.inkSoft, ...font, ...T.sm }}>Done</button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* actions */}
        {canManage && (
          <div className="flex items-center gap-2 px-5 py-3" style={{ borderTop: `1px solid ${V.line}` }}>
            <button onClick={runFile} disabled={!ready || !!leaving} title={ready ? 'File it' : 'Resolve the amber fields to file'} className="inline-flex items-center gap-1.5 font-medium px-4 py-2 rounded-lg" style={ready ? { background: terraGrad, color: '#fff', ...font, ...T.sm } : { background: V.field, color: V.faint, ...font, ...T.sm, cursor: 'not-allowed' }}>
              <Check size={15} /> File it
            </button>
            <button onClick={onFix} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg" style={{ background: V.surface, border: `1px solid ${V.line}`, color: V.inkSoft, ...font, ...T.sm }}>
              <Pencil size={13} /> Fix
            </button>
            <span className="flex-1" />
            <button onClick={runReject} disabled={!!leaving} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg" style={{ color: V.faint, ...font, ...T.sm }}>
              <X size={14} /> Not a transaction
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
