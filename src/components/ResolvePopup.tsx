import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { RoughEntry } from '../types';
import { useSnackbar } from './Snackbar';
import { useOrgId } from '../lib/auth/AuthProvider';
import { ImageLightbox } from './ImageLightbox';
import { WORKER_TRADE_GROUPS, VENDOR_TRADE_GROUPS, OTHER_TRADE } from '../lib/trades';
import { searchPayees, rankPayeeName, PAYEE_SEARCH_FLOOR } from '../lib/payeeSearch';
import { fileRoughEntry } from './day-book/fileEntry';

// ── Walnut-ledger palette (mirrors NewTransaction.tsx) ──────────────────────────
// Warm cream canvas, walnut ink, terracotta accent for money-out, sage for money-in.
// Visual only — never read by any handler/mutation/query. Retuning these re-skins
// the editor at the source so it matches the New Transaction page exactly.
const VOICE = {
  user: '#2A211B', userSoft: '#5A4E42',
  system: '#5A4E42', systemFaint: '#9A8E80',
  ask: '#C75E32', askDeep: '#AC4D27', askWash: '#F7E9DF', askLine: '#E5C98F',
  confirm: '#4C6B47', confirmWash: '#EBF1E7',
  out: '#C75E32', outWash: '#F7E9DF', outLine: '#E8C5B4',
  inn: '#5E8157', innWash: '#EBF1E7', innLine: '#BFD8BC',
  page: '#F7F2E9', surface: '#FFFFFF', field: '#F4EEE3', line: '#EAE1D2',
  walnut: '#221A13', ivory: '#F3EADB', faint: '#C7BCAC', hairStrong: '#DDD2C0',
  cream2: '#FBF7EF', surface2: '#F4EEE3',
  accentSoft: '#E08A5C', accentDeep: '#AC4D27', accentTint: '#F7E9DF', innSoft: '#9CBB91',
  serif: "'Playfair Display', Georgia, 'Times New Roman', serif",
};
const VNUMS = { fontVariantNumeric: 'tabular-nums' as const };

// ── Helpers ────────────────────────────────────────────────────────────────────

type PayeeState = 'A' | 'B' | 'C' | 'confirmed';

/** The four things the editor can ask about. `only` narrows the popup to a subset of them. */
export type GapKey = 'amount' | 'payee' | 'description' | 'project';

// Names read better title-cased — capitalise the first letter of each word as the
// owner types, without fighting intentional caps elsewhere (e.g. "McRavi" stays).
const capitalizeWords = (v: string) => v.replace(/(^|\s)([a-z])/g, (_, sp, c) => sp + c.toUpperCase());

// ── Field question headline — serif, turns terracotta when the field is missing ──
function FieldQuestion({ text, missing }: { text: string; missing?: boolean }) {
  return (
    <h2 className="mb-3" style={{ fontFamily: VOICE.serif, fontSize: 19, fontWeight: 600, letterSpacing: '-0.2px', color: missing ? VOICE.out : VOICE.user }}>
      {text}
    </h2>
  );
}

// ── Payee fuzzy sort ──────────────────────────────────────────────────────────
// The scoring itself lives in src/lib/payeeSearch.ts, mirroring the Edge scorer (_match.ts) that WhatsApp
// uses — so "sreenu" finds Srinu in the Day Book and on the phone, or in neither. What was here was a THIRD
// matcher: a character-overlap heuristic with no edit distance, which only ever SORTED (by what the AI
// heard) while the list itself was filtered by a raw `.includes()`. So the ranking was fuzzy and the
// filtering was exact — the one that decided whether Srinu appeared at all was the one that couldn't spell.

/** 0..100, for the "did you mean" hint next to a row — the AI's heard name vs a stored one. */
function payeeSimilarityScore(name: string, q: string): number {
  if (!q) return 0;
  return Math.round(rankPayeeName(q, name) * 100);
}

function sortByPayeeSimilarity(list: any[], rawName: string): any[] {
  if (!rawName) return list;
  return [...list].sort(
    (a, b) => payeeSimilarityScore(b.name, rawName) - payeeSimilarityScore(a.name, rawName),
  );
}

// ── Inline Create Stakeholder Form ────────────────────────────────────────────

/**
 * NEW PARTY — A CONVERSATION, IN THE ROW ITSELF.
 *
 * ══ WHAT WAS WRONG WITH IT ═════════════════════════════════════════════════════════════════════
 *
 * It was a form: a panel with a name, three pills, a trade select, a phone box and a Create button.
 * Then it became a worse thing — the same form with the pills alone, which nobody reads as a QUESTION.
 * Three small grey capsules do not ask you anything. They sit there looking like labels, and a man with
 * a phone in one hand and a site in front of him has no reason to believe he is meant to press one. An
 * affordance that has to be explained is not an affordance.
 *
 * ══ WHAT IT IS NOW ═════════════════════════════════════════════════════════════════════════════
 *
 * Each step is a QUESTION, in words, above answers you would obviously press — a row apiece, each one
 * saying what it MEANS on a building site. Nobody has to guess what a chip is for.
 *
 *   "Who is Raju to you?"    Worker — labour on your site: mason, carpenter, helper
 *                            Vendor — supplies you material or services
 *                            Client — the customer who pays you
 *
 *   "What kind of worker?"   a box you TYPE into, that narrows ninety trades to the one you meant.
 *                            The old select made you hunt a wall of optgroups; this lets you say
 *                            "mas" and be done. And if your trade is not in our list, what you typed
 *                            IS the trade — you know your site better than the list does.
 *
 *   ✓ "Raju added to your contacts · Mason"    — and only THEN does the payment file.
 *
 * A CLIENT has no trade, so a client is never asked for one. There is no Create button anywhere,
 * because by the time the last answer lands there is nothing left to decide.
 */
function NewPartyRow({
  defaultName, onCreated, onCancel,
}: {
  defaultName: string;
  onCreated: (id: string, name: string) => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const { show: showSnackbar } = useSnackbar();
  const orgId = useOrgId();
  const [name, setName] = useState(capitalizeWords(defaultName));
  const [step, setStep] = useState<'type' | 'trade' | 'done'>('type');
  const [type, setType] = useState<'Worker' | 'Vendor' | 'Client'>('Worker');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [made, setMade] = useState<{ name: string; trade: string } | null>(null);

  const TYPES = [
    { t: 'Worker' as const, what: 'Labour on your site — mason, carpenter, helper' },
    { t: 'Vendor' as const, what: 'Supplies you material or services' },
    { t: 'Client' as const, what: 'The customer who pays you' },
  ];

  const create = async (trade: string) => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const newId = `STK-${Math.floor(1000 + Math.random() * 9000)}`;
      const { data, error } = await supabase.from('stakeholders').insert([{
        stakeholder_id: newId, name: name.trim(), type,
        category: trade || type, contact: null, org_id: orgId,
      }]).select().single();
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['stakeholders'] });

      /**
       * HE IS IN THE BOOK NOW, AND THAT IS WORTH A SECOND.
       *
       * The row used to say "Adding Raju…" in small green text and then just become something else. A
       * new person entering your business is not a loading message. So the row settles into a ticked
       * sage line that names him and what he is — one beat of "that is done" — and only then does the
       * payment go on. It is the courtesy a good clerk shows: he writes the name, turns the page round
       * so you can see it, and then takes your money.
       */
      setMade({ name: data.name, trade: trade || type });
      setStep('done');
      window.setTimeout(() => onCreated(data.stakeholder_id, data.name), 1150);
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to create stakeholder', { type: 'error' });
      setCreating(false);
    }
  };

  /* ── created: the celebration, such as it should be — small, certain, and over ── */
  if (step === 'done' && made) {
    return (
      <div className="rounded-xl px-3 py-3 db-drop" style={{ background: VOICE.confirmWash, border: `1px solid ${VOICE.innLine}` }}>
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 db-pop" style={{ background: VOICE.confirm }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path className="db-draw" d="M5 12.5l4.5 4.5L19 7" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="block text-[13.5px] font-semibold truncate" style={{ color: VOICE.user }}>
              {made.name} added to your contacts
            </span>
            <span className="block text-[11.5px]" style={{ color: VOICE.confirm }}>{made.trade}</span>
          </span>
        </div>
      </div>
    );
  }

  const groups = type === 'Worker' ? WORKER_TRADE_GROUPS : VENDOR_TRADE_GROUPS;
  const needle = q.trim().toLowerCase();
  const hits = groups
    .map((g) => ({ group: g.group, trades: g.trades.filter((t) => t !== OTHER_TRADE && (!needle || t.toLowerCase().includes(needle))) }))
    .filter((g) => g.trades.length);

  return (
    <div className="rounded-xl px-3 py-3" style={{ background: VOICE.askWash, border: `1px solid ${VOICE.outLine}` }}>
      {/* WHO — always there, always editable, exactly where the search box was */}
      <div className="flex items-center gap-2 min-w-0 pb-2.5 mb-2.5" style={{ borderBottom: `1px solid ${VOICE.outLine}` }}>
        <span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[12px] font-bold" style={{ background: VOICE.walnut, color: VOICE.ivory }}>
          {name.trim() ? name.trim()[0].toUpperCase() : '+'}
        </span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(capitalizeWords(e.target.value))}
          placeholder="Full name"
          autoFocus
          autoCapitalize="words"
          className="min-w-0 flex-1 text-[14px] font-semibold bg-transparent outline-none"
          style={{ color: VOICE.user }}
        />
        <button type="button" onClick={onCancel} className="shrink-0 text-[11px] hover:underline" style={{ color: VOICE.system }}>
          cancel
        </button>
      </div>

      {/* STEP 1 — WHO IS HE TO YOU? A question, with answers anyone would know to press. */}
      {step === 'type' && (
        <>
          <p className="text-[12px] font-semibold mb-2" style={{ color: VOICE.accentDeep }}>
            Who is {name.trim() || 'this'} to you?
          </p>
          <div className="space-y-1.5">
            {TYPES.map(({ t, what }) => (
              <button
                key={t}
                type="button"
                disabled={!name.trim() || creating}
                onClick={() => {
                  setType(t);
                  setQ('');
                  if (t === 'Client') void create('Client'); else setStep('trade');
                }}
                className="group w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all duration-150 disabled:opacity-40 hover:shadow-sm"
                style={{ background: VOICE.surface, border: `1px solid ${VOICE.line}` }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold" style={{ color: VOICE.user }}>{t}</span>
                  <span className="block text-[11.5px] leading-snug" style={{ color: VOICE.systemFaint }}>{what}</span>
                </span>
                <span className="material-symbols-outlined text-[18px] shrink-0 transition-transform group-hover:translate-x-0.5" style={{ color: VOICE.accentDeep }}>
                  arrow_forward
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* STEP 2 — WHICH TRADE? You TYPE it. Ninety trades is a wall to hunt through and two words to
          say, so it is a box you can say them into and the list narrows as you do. */}
      {step === 'trade' && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <button
              type="button"
              onClick={() => { setStep('type'); setQ(''); }}
              className="shrink-0 inline-flex items-center text-[11px]"
              style={{ color: VOICE.system }}
            >
              <span className="material-symbols-outlined text-[14px]">chevron_left</span>{type}
            </button>
            <p className="text-[12px] font-semibold" style={{ color: VOICE.accentDeep }}>
              What kind of {type.toLowerCase()}?
            </p>
          </div>

          <input
            type="text"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={type === 'Worker' ? 'Type a trade — mason, plumber, painter…' : 'Type what they supply — cement, steel, tiles…'}
            className="w-full text-[13.5px] px-3 py-2 rounded-lg outline-none mb-2"
            style={{ border: `1px solid ${VOICE.line}`, background: VOICE.surface, color: VOICE.user }}
          />

          <div className="space-y-2 overflow-y-auto" style={{ maxHeight: 190 }}>
            {hits.map((g) => (
              <div key={g.group}>
                <p className="text-[9.5px] font-bold tracking-wider uppercase mb-1" style={{ color: VOICE.faint }}>{g.group}</p>
                <div className="space-y-1">
                  {g.trades.map((t) => (
                    <button
                      key={t}
                      type="button"
                      disabled={creating}
                      onClick={() => void create(t)}
                      className="w-full text-left px-3 py-2 rounded-lg text-[13px] font-medium transition-colors hover:bg-white disabled:opacity-40"
                      style={{ background: VOICE.surface, border: `1px solid ${VOICE.line}`, color: VOICE.user }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {/* Nothing matched — then what he typed IS the trade. He knows his site better than our list. */}
            {needle && hits.length === 0 && (
              <button
                type="button"
                disabled={creating}
                onClick={() => void create(capitalizeWords(q.trim()))}
                className="w-full text-left px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-40"
                style={{ background: VOICE.surface, border: `1px solid ${VOICE.outLine}`, color: VOICE.accentDeep }}
              >
                Use &ldquo;{capitalizeWords(q.trim())}&rdquo;
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  entry: RoughEntry;
  onClose: () => void;
  onUpdated: (entry: RoughEntry) => void;
  session: Session;
  /**
   * ONE CARD, TWO ERRANDS.
   *
   * Undefined (the EDIT button) → every field. You came to change something that is already there and
   * wrong, so you must be able to see all of it.
   *
   * A list (the APPROVE button) → ONLY the fields in it, which are exactly the ones we do not have.
   * There is no reason to re-present the amount, the payee and the date, already correct, as a column
   * of filled-in boxes for a man to scroll past and re-approve. He said those things once. The screen's
   * whole job is the part he has not said.
   *
   * It is the SAME popup either way — same card, same field, same voice. It simply does not ask
   * questions it already knows the answer to.
   */
  only?: GapKey[];
}

export function ResolvePopup({ entry, onClose, onUpdated, only }: Props) {
  const qc = useQueryClient();
  const { show: showSnackbar } = useSnackbar();
  const orgId = useOrgId();

  /** Confirm mode asks ONLY what is missing. Edit mode asks everything. */
  const confirmMode = !!only;
  const show = (k: GapKey) => !only || only.includes(k);

  const ai = entry.ai_extracted;

  // ── Field state ────────────────────────────────────────────────────────────
  const [payeeId, setPayeeId] = useState(ai.payee_id || '');
  const [payeeName, setPayeeName] = useState(ai.payee_name || '');
  const [payeeSearch, setPayeeSearch] = useState(ai.payee_name || ai.payee_raw || '');
  const [showPayeeDrop, setShowPayeeDrop] = useState(false);
  // Payee resolution state machine (lifted here so the smart-CTA gap logic can read it):
  // A = confirmed match · B = matched LOW-confidence, needs confirm · C = searching/unmatched
  // · confirmed = user explicitly chose. Payee is "resolved" only in A or confirmed.
  const [payeeState, setPayeeState] = useState<PayeeState>(() => {
    if (!ai.payee_id) return 'C';
    if (ai.payee_matched === true && ai.payee_confidence === 'LOW') return 'B';
    return 'A';
  });
  const [amount, setAmount] = useState<number | ''>(ai.amount ?? '');
  const [description, setDescription] = useState(ai.description || ai.description_raw || '');
  const [projectId, setProjectId] = useState(ai.project_id || '');
  const [mode, setMode] = useState<'Cash' | 'NEFT' | 'UPI' | 'Cheque'>(ai.mode || 'Cash');
  const [showDismissConfirm, setShowDismissConfirm] = useState(false);
  const [posting, setPosting] = useState(false);

  // ── Drag-to-dismiss / swipe-to-full-height (mobile) ────────────────────────
  // Down-drag past a threshold dismisses (existing). Up-drag expands the sheet
  // toward full height (snaps to full on a small upward pull).
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [vp, setVp] = useState<{ height: number; offsetTop: number } | null>(null);
  const payeeRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef<HTMLSelectElement>(null);

  const handleDragStart = useCallback((e: React.PointerEvent) => {
    setIsDragging(true);
    dragStartY.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    const delta = e.clientY - dragStartY.current;
    // Only track downward drag for the transform (dismiss gesture). Upward drag is
    // resolved on release into a snap-to-full-height.
    setDragY(delta > 0 ? delta : 0);
  }, [isDragging]);

  const handleDragEnd = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    const delta = e.clientY - dragStartY.current;
    const threshold = (sheetRef.current?.offsetHeight || 400) * 0.4;
    if (delta > threshold) { onClose(); return; }
    setDragY(0);
  }, [isDragging, onClose]);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: stakeholders = [] } = useQuery({
    queryKey: ['stakeholders'],
    queryFn: async () => {
      const { data } = await supabase.from('stakeholders').select('*').order('name');
      return (data ?? []) as any[];
    },
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('*').eq('status', 'Active').order('name');
      return (data ?? []) as any[];
    },
  });

  /**
   * ══ THE AI'S IDS ARE GUESSES. VERIFY THEM, OR THE DATABASE WILL. ══════════════════════════════
   *
   * `ai_extracted.payee_id` / `.project_id` are strings the extractor wrote into a jsonb blob. They
   * are not foreign keys and nothing has ever checked them. This editor seeded its own state straight
   * from them — so a project id the AI had ASSEMBLED from a name ("PRJ-ASM-ELITE", which is the exact
   * shape a real one takes: the convention is PRJ-<slug>) arrived here looking perfectly resolved. The
   * project field showed as filled, `mandatoryFilled` went true, nothing was asked, and the very first
   * thing in the whole path to notice it named NOTHING was the foreign key, at the moment of writing:
   *
   *     txn_allocations violates foreign key constraint … Key (project_id)=(PRJ-ASM-ELITE)
   *     is not present in table "projects". (23503)
   *
   * So: the moment the real lists land, an id that names no row is CLEARED. It is not a key — it is a
   * heard name in a key's clothes — and clearing it turns a crash at the end into a question at the
   * start, which is the only place a question is any use.
   */
  const hasPreselected = useRef(false);
  useEffect(() => {
    if (hasPreselected.current || !stakeholders.length || !ai.payee_id) return;
    hasPreselected.current = true;
    const match = stakeholders.find((s) => s.stakeholder_id === ai.payee_id);
    if (match) {
      setPayeeId(match.stakeholder_id);
      setPayeeName(match.name);
      setPayeeSearch(match.name);
    } else {
      // the AI named somebody who is not in the contact book. Ask.
      setPayeeId('');
      setPayeeName('');
      setPayeeSearch(ai.payee_name || ai.payee_raw || '');
      setPayeeState('C');
    }
  }, [stakeholders, ai.payee_id, ai.payee_name, ai.payee_raw]);

  const projectChecked = useRef(false);
  // The check can only run once the real list has ARRIVED, so it is an effect by nature — there is no
  // render at which we could have known this. Guarded by a ref: it fires once, on the first real list.
  useEffect(() => {
    if (projectChecked.current || !projects.length || !ai.project_id) return;
    projectChecked.current = true;
    if (!projects.some((p) => p.project_id === ai.project_id)) setProjectId('');
  }, [projects, ai.project_id]);

  const isWhatsApp = entry.source.startsWith('WHATSAPP');

  // Lock the background scroll while the editor is open, so focusing a field can't jolt the
  // document underneath the fixed sheet (the source of the up/down jitter on mobile). The
  // sheet's own overflow-y-auto body still scrolls.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Bind the mobile sheet to the visual viewport so it always fills the visible area ABOVE
  // the keyboard, instead of a bottom-anchored partial sheet the keyboard shoves around
  // (that anchoring was the jitter). The sheet's own body scrolls within.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setVp({ height: vv.height, offsetTop: vv.offsetTop });
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const filteredPayees = searchPayees(stakeholders, payeeSearch);

  // THE REMARK IS NOT MANDATORY. Payee + site + amount is a complete transaction — who, where, how
  // much. The remark is a note ON it, and a ledger that refuses to record a payment because nobody
  // typed "cement" is a ledger arguing with its own owner.
  const mandatoryFilled = !!payeeId && !!amount && Number(amount) > 0 && !!projectId;
  const missingPayee = !payeeId;
  const missingAmount = !amount || Number(amount) <= 0;
  const missingDescription = !description.trim();
  const missingProject = !projectId;
  const payeeUnmatched = !payeeId && !!(ai.payee_unmatched || ai.payee_name || ai.payee_raw);
  const projectUnmatched = !projectId && !!ai.project_unmatched;

  // ── Auto-focus / auto-advance (copied from NewTransaction) ──────────────────
  // Focus SYNCHRONOUSLY inside the tap so the cursor/keyboard activates on mobile.
  // On mobile we DON'T preventScroll — that disables the browser's native
  // "scroll the focused input above the keyboard" behaviour. Desktop just centers.
  // Focus the field within the sheet's own body (preventScroll so the native focus-scroll
  // can't jolt the fixed sheet), then scroll it into view — top on mobile (clears the header
  // via scroll-margin), centered on desktop. Only inputs/selects take focus; others just scroll.
  const bringIntoFrame = (el: HTMLElement | null) => {
    if (!el) return;
    if (el.matches('input, select, textarea')) el.focus({ preventScroll: true });
    el.scrollIntoView({ behavior: 'smooth', block: window.innerWidth < 640 ? 'start' : 'center' });
  };

  // A field counts as RESOLVED, not merely filled — payee is resolved only once confirmed.
  const amountResolved = amount !== '' && Number(amount) > 0;
  const payeeResolved = !!payeeId && (payeeState === 'A' || payeeState === 'confirmed');
  const descriptionResolved = !!description.trim();
  const projectResolved = !!projectId;

  type GapKey = 'amount' | 'payee' | 'description' | 'project';
  const fieldEl = (k: GapKey): HTMLElement | null =>
    k === 'amount' ? document.getElementById('resolve-amount-input')
      : k === 'payee' ? (payeeState === 'C' || !payeeId ? payeeRef.current : document.getElementById('resolve-payee-field'))
      : k === 'description' ? document.getElementById('resolve-description-input')
      : projectRef.current;

  // Smart CTA walks ONLY the unresolved fields, in order. While a gap remains the footer
  // names it; once none remain it becomes "File it".
  const nextGap: { label: string; key: GapKey } | null = (() => {
    if (!amountResolved) return { label: 'Enter the amount', key: 'amount' };
    if (!payeeResolved) return { label: payeeState === 'B' ? 'Confirm the payee' : 'Add the payee', key: 'payee' };
    if (!projectResolved) return { label: 'Choose a project', key: 'project' };
    return null;
  })();
  const goToGap = () => { if (nextGap) bringIntoFrame(fieldEl(nextGap.key)); };

  // After a field is completed, jump to the first still-UNRESOLVED field — cursor active,
  // in the frame. Computed from current state synchronously (treating `justFilled` as done,
  // since its setState hasn't flushed yet), so the gesture carries and the keyboard opens.
  const advanceAfter = (justFilled: GapKey) => {
    const resolved: Record<GapKey, boolean> = { amount: amountResolved, payee: payeeResolved, description: descriptionResolved, project: projectResolved };
    for (const k of ['amount', 'payee', 'description', 'project'] as const) {
      if (k !== justFilled && !resolved[k]) { bringIntoFrame(fieldEl(k)); return; }
    }
  };

  // On open, ready the amount at the top (no scroll); the CTA and auto-advance drive the
  // rest. (Replaces the old amount-first + WhatsApp-project focus.)
  useEffect(() => {
    setTimeout(() => document.getElementById('resolve-amount-input')?.focus({ preventScroll: true }), 120);
  }, []);

  /**
   * APPROVE & FILE — what the CONFIRM mode's button does.
   *
   * Edit only ever SAVES corrections back onto the entry (below); the filing happens when the owner
   * taps Approve on the card. But in confirm mode he HAS tapped Approve — this popup only exists
   * because of it — so the button at the bottom of it must finish the job he started, not send him
   * back to the card to press the same thing twice.
   *
   * It writes the corrections, then files through the ONE write path the whole Day Book uses
   * (fileRoughEntry), so a transaction filed from here and one filed from the card are the same record.
   */
  const [autoFile, setAutoFile] = useState(false);

  /**
   * THE THREE STATES OF AN APPROVAL.
   *
   *   ask     — "Approving this transaction. We need two details from you."   (the information state)
   *   filing  — the write is in flight. Named, not spun at: he is watching his money move.
   *   filed   — it landed, and we say where it landed, and only THEN do we leave.
   *
   * The middle one is not decoration. A payment going into the books is the single most consequential
   * thing this app does, and a screen that simply blinks out has told him nothing about whether it
   * worked. The success state is the receipt, and it is what earns the right to close.
   */
  const [approval, setApproval] = useState<'ask' | 'filing' | 'filed'>('ask');

  const handleApprove = useCallback(async () => {
    if (posting || !mandatoryFilled) return;
    setPosting(true);
    setApproval('filing');
    try {
      const projectName = projects.find((p) => p.project_id === projectId)?.name ?? ai.project_name ?? null;
      const nextAi = {
        ...ai,
        payee_id: payeeId || null, payee_name: payeeName || null,
        amount: Number(amount), project_id: projectId || null, project_name: projectName,
        description: description.trim(), mode,
      };
      const { data: updatedEntry } = await supabase.from('rough_entries')
        .update({ ai_extracted: nextAi }).eq('id', entry.id).select().single();

      await fileRoughEntry(updatedEntry as RoughEntry, orgId ?? '', {
        payeeId, projectId, amount: Number(amount), description: description.trim(),
      });

      // IT LANDED. Say so, hold it for a beat, and only then step out of the way — and hand the card
      // back its own moment (the fly-off), so an entry approved from here leaves the list exactly as
      // one approved on the card does. Two ways in, one way out.
      setApproval('filed');
      window.setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['inbox_badge'] });
        onUpdated({ ...(updatedEntry as RoughEntry), status: 'POSTED' } as RoughEntry);
        onClose();
      }, 900);
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to file', { type: 'error' });
      setApproval('ask');
      setPosting(false);
    }
  }, [posting, mandatoryFilled, projects, projectId, ai, payeeId, payeeName, amount, description, mode, entry, orgId, qc, onUpdated, onClose, showSnackbar]);

  /**
   * "THEN CONFIRM AUTO." When adding the payee was the LAST thing standing between this payment and
   * the ledger, picking his trade files it. There is nothing left to ask, so there is nothing left to
   * press — a button whose only possible use is to agree with you is a button that should not exist.
   */
  const autoFired = useRef(false);
  useEffect(() => {
    if (!autoFile || autoFired.current) return;
    if (!confirmMode || !mandatoryFilled) return;
    autoFired.current = true;                 // once, and never again on a re-render
    void handleApprove();
  }, [autoFile, confirmMode, mandatoryFilled, handleApprove]);

  // ── Save action — Edit just records the owner's corrections back onto the entry so
  // the Day Book card reflects them. It does NOT file the transaction; that happens
  // when the owner taps Approve on the card. Status stays PENDING (still in review).
  const handleSave = async () => {
    if (posting) return;
    setPosting(true);
    try {
      const projectName = projects.find((p) => p.project_id === projectId)?.name ?? ai.project_name ?? null;
      const nextAi = {
        ...ai,
        payee_id: payeeId || null,
        payee_name: payeeName || null,
        amount: amount === '' ? null : Number(amount),
        project_id: projectId || null,
        project_name: projectName,
        description: description.trim(),
        mode,
      };
      const { data: updatedEntry } = await supabase
        .from('rough_entries')
        .update({ ai_extracted: nextAi })
        .eq('id', entry.id)
        .select().single();

      qc.invalidateQueries({ queryKey: ['rough_entries'] });
      onUpdated(updatedEntry as RoughEntry);
      onClose();
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to save', { type: 'error' });
    } finally {
      setPosting(false);
    }
  };

  // ── Dismiss action ─────────────────────────────────────────────────────────
  const handleDismiss = async () => {
    const { data: updatedEntry } = await supabase
      .from('rough_entries')
      .update({ status: 'DISMISSED' })
      .eq('id', entry.id)
      .select().single();
    qc.invalidateQueries({ queryKey: ['rough_entries'] });
    qc.invalidateQueries({ queryKey: ['inbox_badge'] });
    onUpdated(updatedEntry as RoughEntry);
    onClose();
  };

  const fmtTime = (ts: string) => new Date(ts).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  const sourceMeta: Record<string, { label: string; bg: string; fg: string }> = {
    WHATSAPP_TEXT:  { label: 'WhatsApp',       bg: VOICE.confirmWash, fg: VOICE.confirm },
    WHATSAPP_IMAGE: { label: 'WhatsApp Image', bg: VOICE.askWash,     fg: VOICE.accentDeep },
    WHATSAPP_VOICE: { label: 'WhatsApp Voice', bg: VOICE.askWash,     fg: VOICE.accentDeep },
    UI_TEXT:        { label: 'Manual',         bg: VOICE.field,       fg: VOICE.system },
    UI_IMAGE:       { label: 'Scan',           bg: VOICE.field,       fg: VOICE.system },
  };
  const sm = sourceMeta[entry.source] || sourceMeta.UI_TEXT;

  const sharedProps: ContentProps = {
    entry, sm, fmtTime,
    payeeId, payeeName, payeeSearch,
    setPayeeId, setPayeeName, setPayeeSearch,
    showPayeeDrop, setShowPayeeDrop,
    stakeholders, filteredPayees,
    amount, setAmount,
    description, setDescription,
    projectId, setProjectId, projectRef, projects,
    mode, setMode,
    isWhatsApp,
    missingPayee, missingAmount, missingDescription, missingProject,
    payeeUnmatched, projectUnmatched,
    mandatoryFilled, posting,
    showDismissConfirm, setShowDismissConfirm,
    onClose, handleSave, handleDismiss,
    payeeRef, advanceAfter, nextGap, goToGap,
    payeeState, setPayeeState,
    show, confirmMode, only, approval, handleApprove,
    armAutoFile: () => setAutoFile(true),
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-[3px] transition-opacity duration-150"
        onClick={onClose}
      />

      {/* Desktop: centered modal */}
      <div className="hidden md:flex fixed inset-0 z-[61] items-center justify-center p-4 pointer-events-none">
        <div
          className="resolve-editor pointer-events-auto w-full max-w-[480px] max-h-[88vh] flex flex-col rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.2)] overflow-hidden"
          style={{ background: VOICE.page, animation: 'popupIn 200ms cubic-bezier(0.4,0,0.2,1) both' }}
          onClick={(e) => e.stopPropagation()}
        >
          <PopupContents {...sharedProps} />
        </div>
      </div>

      {/* Mobile: bottom sheet (swipe up → full height, swipe down → dismiss) */}
      <div
        ref={sheetRef}
        className="resolve-editor md:hidden fixed left-0 right-0 z-[61] flex flex-col rounded-t-[20px] shadow-2xl overflow-hidden"
        style={{
          background: VOICE.page,
          top: vp ? vp.offsetTop : 0,
          height: vp ? vp.height : '100dvh',
          transform: `translateY(${isDragging ? dragY : 0}px)`,
          transition: isDragging ? 'none' : 'transform 280ms cubic-bezier(0.4,0,0.2,1)',
          animation: isDragging ? 'none' : 'sheetIn 280ms cubic-bezier(0.4,0,0.2,1) both',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing shrink-0"
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        >
          <div className="w-8 h-1 rounded-full" style={{ background: VOICE.hairStrong }} />
        </div>
        <PopupContents {...sharedProps} />
      </div>

      <style>{`
        @keyframes popupIn {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes sheetIn {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
        @media (max-width: 640px){
          .resolve-editor input:not(#resolve-amount-input), .resolve-editor select, .resolve-editor textarea { font-size: 16px }
        }
        .resolve-editor input, .resolve-editor textarea, .resolve-editor select, #resolve-amount-input { scroll-margin-top: 24px; scroll-margin-bottom: 150px; }
        #resolve-amount-input::placeholder { color: rgba(243,234,219,.26) }
        #resolve-amount-input::-webkit-outer-spin-button, #resolve-amount-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0 }
        #resolve-amount-input { -moz-appearance: textfield }
      `}</style>
    </>
  );
}

// ── Inner shared content ───────────────────────────────────────────────────────

interface ContentProps {
  entry: RoughEntry;
  sm: { label: string; bg: string; fg: string };
  fmtTime: (ts: string) => string;
  payeeId: string; payeeName: string; payeeSearch: string;
  setPayeeId: (v: string) => void; setPayeeName: (v: string) => void; setPayeeSearch: (v: string) => void;
  showPayeeDrop: boolean; setShowPayeeDrop: (v: boolean) => void;
  stakeholders: any[];
  filteredPayees: any[];
  amount: number | ''; setAmount: (v: number | '') => void;
  description: string; setDescription: (v: string) => void;
  projectId: string; setProjectId: (v: string) => void; projectRef: React.RefObject<HTMLSelectElement | null>;
  projects: any[];
  mode: 'Cash' | 'NEFT' | 'UPI' | 'Cheque'; setMode: (v: 'Cash' | 'NEFT' | 'UPI' | 'Cheque') => void;
  isWhatsApp: boolean;
  missingPayee: boolean; missingAmount: boolean; missingDescription: boolean; missingProject: boolean;
  payeeUnmatched: boolean; projectUnmatched: boolean;
  mandatoryFilled: boolean; posting: boolean;
  showDismissConfirm: boolean; setShowDismissConfirm: (v: boolean) => void;
  onClose: () => void; handleSave: () => void; handleDismiss: () => void;
  payeeRef: React.RefObject<HTMLInputElement | null>;
  advanceAfter: (justFilled: 'amount' | 'payee' | 'description' | 'project') => void;
  nextGap: { label: string; key: 'amount' | 'payee' | 'description' | 'project' } | null;
  goToGap: () => void;
  payeeState: PayeeState; setPayeeState: (v: PayeeState) => void;
  show: (k: GapKey) => boolean;
  confirmMode: boolean;
  only?: GapKey[];
  approval: 'ask' | 'filing' | 'filed';
  handleApprove: () => void;
  armAutoFile: () => void;
}

function PopupContents({
  entry, sm, fmtTime,
  payeeId, payeeName, payeeSearch, setPayeeId, setPayeeName, setPayeeSearch,
  showPayeeDrop, setShowPayeeDrop, stakeholders,
  amount, setAmount,
  description, setDescription,
  projectId, setProjectId, projectRef, projects,
  mode, setMode,
  isWhatsApp,
  missingPayee, missingAmount, missingProject,
  payeeUnmatched, projectUnmatched,
  posting,
  showDismissConfirm, setShowDismissConfirm,
  onClose, handleSave, handleDismiss,
  payeeRef, advanceAfter, nextGap, goToGap,
  payeeState, setPayeeState,
  show, confirmMode, only, approval, handleApprove, armAutoFile,
}: ContentProps) {
  const payeeDropRef    = useRef<HTMLDivElement>(null);
  const [showCreateStkForm, setShowCreateStkForm] = useState(false);

  const ai = entry.ai_extracted;

  // Payee state machine (A/B/C/confirmed) is lifted to the parent so the smart-CTA gap
  // logic can read it; this component just renders + drives it via the passed setter.

  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Close payee dropdown on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (payeeDropRef.current && !payeeDropRef.current.contains(e.target as Node)) {
        setShowPayeeDrop(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const selectPayee = (id: string, name: string) => {
    setPayeeId(id);
    setPayeeName(name);
    setPayeeSearch(name);
    setShowPayeeDrop(false);
    setPayeeState('confirmed');
    setShowCreateStkForm(false);
    // Auto-advance to the next still-empty mandatory field (cursor active on mobile).
    advanceAfter('payee');
  };

  // Payee search list. TWO different questions, and they were tangled: with NO typed text the ordering
  // question is "who did the AI hear?" (sort by similarity to payee_raw); the moment he types, the question
  // is "who is he looking for?" and searchPayees ranks by THAT — his query, not the AI's guess.
  const sortedPayees = sortByPayeeSimilarity(stakeholders, ai.payee_raw || '');
  const searchedPayees = payeeSearch ? searchPayees(stakeholders, payeeSearch) : sortedPayees;
  // The name the owner typed (or what the AI heard) — used to personalise the "Add …" CTA.
  const typedName = (payeeSearch.trim() || ai.payee_raw || '').trim();

  // Shared field-input style — walnut-on-cream, terracotta wash when missing, sage when filled.
  const fieldStyle = (state: 'missing' | 'filled' | 'idle') => ({
    border: `1px solid ${state === 'missing' ? VOICE.outLine : state === 'filled' ? VOICE.innLine : VOICE.line}`,
    background: state === 'missing' ? VOICE.askWash : state === 'filled' ? VOICE.innWash : VOICE.surface,
    color: VOICE.user,
  });

  /**
   * THE APPROVAL AND SUCCESS STATES.
   *
   * The questions do not fade out and the buttons do not go grey — the sheet simply BECOMES the thing
   * that is happening. Filing is a sentence, not a spinner in a corner ("Filing to your books" — the
   * money is going somewhere, and it says where). And it landed is a drawn tick and a place: "In your
   * books." He is watching money move; he gets told, in words, that it arrived.
   */
  if (approval !== 'ask') {
    const filed = approval === 'filed';
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center mb-5"
          style={{ background: filed ? VOICE.confirmWash : VOICE.field }}
        >
          {filed ? (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" className="db-pop">
              <path className="db-draw" d="M5 12.5l4.5 4.5L19 7" stroke={VOICE.confirm} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <span className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(154,142,128,.28)', borderTopColor: VOICE.walnut }} />
          )}
        </div>

        <h2 style={{ fontFamily: VOICE.serif, fontSize: 22, fontWeight: 600, color: filed ? VOICE.confirm : VOICE.user }}>
          {filed ? 'Filed' : 'Filing to your books'}
        </h2>
        <p className="mt-1.5 text-[13.5px]" style={{ color: VOICE.system }}>
          {filed
            ? 'It is in your ledger. You can find it in Transactions.'
            : 'Recording the payment and its project allocation.'}
        </p>

        {amount !== '' && (
          <p className="mt-4 text-[15px] font-semibold" style={{ color: VOICE.user, fontFamily: VOICE.serif, ...VNUMS }}>
            ₹{Number(amount).toLocaleString('en-IN')}
            {payeeName && <span className="font-normal text-[13px]" style={{ color: VOICE.systemFaint }}> · {payeeName}</span>}
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      {/* ── Sticky header (compact) ── */}
      <div className="shrink-0 flex items-center justify-between px-4 py-1.5" style={{ borderBottom: `1px solid ${VOICE.line}` }}>
        <span className="font-data-mono text-[11px]" style={{ color: VOICE.systemFaint, ...VNUMS }}>{entry.re_number}</span>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors -mr-1"
          style={{ color: VOICE.system }}
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">

      {/* ── Source strip (compact, one line) ── */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-1.5" style={{ background: VOICE.cream2, borderBottom: `1px solid ${VOICE.line}` }}>
        <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full shrink-0" style={{ background: sm.bg, color: sm.fg }}>{sm.label}</span>
        <span className="text-[11px] shrink-0" style={{ color: VOICE.systemFaint }}>{entry.sender_name || '—'}</span>
        <span className="text-[11px] shrink-0" style={{ color: VOICE.faint }}>·</span>
        <span className="text-[11px] shrink-0" style={{ color: VOICE.systemFaint }}>{fmtTime(entry.created_at)}</span>
        {entry.raw_image_url ? (
          <button onClick={() => setLightboxUrl(entry.raw_image_url!)} className="ml-auto shrink-0 inline-flex items-center gap-1.5">
            <img src={entry.raw_image_url} className="w-6 h-6 rounded object-cover" style={{ border: `1px solid ${VOICE.line}` }} />
            <span className="text-[11px] underline" style={{ color: VOICE.accentDeep }}>View</span>
          </button>
        ) : entry.raw_text ? (
          <span className="ml-auto text-[11px] italic truncate" style={{ color: VOICE.systemFaint, maxWidth: '46%' }} title={entry.raw_text}>
            "{entry.raw_text.length > 48 ? entry.raw_text.slice(0, 48) + '…' : entry.raw_text}"
          </span>
        ) : null}
      </div>

      {/* ── Fields ── */}
      <div className="px-4 pt-5 pb-2 space-y-7">

        {/* ═══ CONFIRM MODE — THE INFORMATION STATE ═══════════════════════════════════════════════
            He pressed Approve. He is not here to re-enter a transaction; he is here because we could
            not finish one. So the popup opens by SAYING SO — what it is about to do, on what, and what
            it needs from him — and then it asks. Nothing else.

            The great walnut amount card does not belong in this errand. It is the hero of the EDITOR,
            where the figure is the thing you came to change. Here the figure is settled; leading with a
            60px number would be shouting a fact nobody disputed, and pushing the actual questions below
            the fold to do it. It becomes one line of subtext — the receipt he is approving — and the
            questions get the room. */}
        {confirmMode && (
          <div className="db-drop">
            <h2 style={{ fontFamily: VOICE.serif, fontSize: 22, fontWeight: 600, letterSpacing: '-0.2px', color: VOICE.user }}>
              Approving this transaction
            </h2>
            <p className="mt-1.5 text-[13.5px]" style={{ color: VOICE.system }}>
              Before it goes into your books, we need {(only?.length ?? 0) === 1 ? 'one detail' : `${only?.length} details`} from you.
            </p>

            {/* THE RECEIPT — everything already settled, stated once, quietly. It is context, not a
                field: he said these things, and being asked to look at them again is not respect. */}
            <div className="mt-3.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 px-3 py-2.5 rounded-xl"
                 style={{ background: VOICE.cream2, border: `1px solid ${VOICE.line}` }}>
              {!show('amount') && amount !== '' && (
                <span className="text-[14px] font-semibold" style={{ color: VOICE.user, fontFamily: VOICE.serif, ...VNUMS }}>
                  ₹{Number(amount).toLocaleString('en-IN')}
                </span>
              )}
              {!show('payee') && payeeName && (
                <span className="text-[12.5px]" style={{ color: VOICE.userSoft }}>to <b style={{ color: VOICE.user }}>{payeeName}</b></span>
              )}
              {!show('project') && projectId && (
                <span className="text-[12.5px]" style={{ color: VOICE.userSoft }}>
                  · {projects.find((p: any) => p.project_id === projectId)?.name}
                </span>
              )}
              {description.trim() && (
                <span className="text-[12.5px]" style={{ color: VOICE.systemFaint }}>· {description.trim()}</span>
              )}
            </div>
          </div>
        )}

        {/* 1. Amount — the dark walnut "ledger" hero. The EDITOR's signature element, and the editor's
            alone: it is here because the amount is the thing you most often came to change. Confirm mode
            has no business with it unless the amount is the very thing that is missing. */}
        {(!confirmMode || show('amount')) && (
        <div
          className="relative overflow-hidden"
          onClick={() => document.getElementById('resolve-amount-input')?.focus()}
          style={{
            borderRadius: 24, padding: '28px 26px 24px', cursor: 'text',
            background: 'radial-gradient(120% 120% at 85% 0%, rgba(224,138,92,.14) 0%, rgba(224,138,92,0) 42%), linear-gradient(158deg,#2D2118 0%,#221A13 60%,#1B140E 100%)',
            boxShadow: '0 26px 50px -28px rgba(34,26,19,.7), inset 0 0 0 1px rgba(243,234,219,.06)',
          }}
        >
          <span className="inline-flex items-center gap-1.5 mb-3.5" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.6px', textTransform: 'uppercase', color: VOICE.accentSoft }}>
            <span className="material-symbols-outlined text-[13px]">north_east</span>
            Money going out
          </span>
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span style={{ fontFamily: VOICE.serif, fontSize: 'clamp(24px, 7vw, 30px)', fontWeight: 600, color: VOICE.accentSoft, flex: '0 0 auto' }}>₹</span>
            <input
              id="resolve-amount-input"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(parseFloat(e.target.value) || '')}
              onFocus={(e) => e.target.select()}
              onClick={(e) => e.stopPropagation()}
              onWheel={(e) => e.currentTarget.blur()}
              placeholder="0"
              aria-label="Amount"
              style={{
                fontFamily: VOICE.serif, fontWeight: 600, lineHeight: 1, letterSpacing: '-1.5px',
                fontSize: 'clamp(58px, 17vw, 64px)',
                background: 'transparent', border: 'none', outline: 'none', color: VOICE.ivory,
                caretColor: VOICE.accentSoft,
                flex: '1 1 auto', width: '100%', minWidth: 0, padding: 0,
              }}
            />
          </div>
          <div className="mt-4 pt-3.5 flex items-center justify-between" style={{ borderTop: '1px solid rgba(243,234,219,.1)' }}>
            <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12, fontWeight: 500, color: missingAmount ? '#F0A593' : 'rgba(243,234,219,.5)' }}>
              {missingAmount
                ? <><span className="material-symbols-outlined text-[14px]">error</span>Enter an amount above zero</>
                : 'Tap to enter the amount'}
            </span>
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.5px', color: 'rgba(243,234,219,.28)' }}>DRAFT</span>
          </div>
        </div>

        )}

        {/* 2. Payee */}
        {show('payee') && (
        <div id="resolve-payee-field" style={{ scrollMarginTop: 24 }}>
          <FieldQuestion text="Who are you paying?" missing={missingPayee && payeeState !== 'B'} />

          {/* STATE A / confirmed — sage ✓ */}
          {(payeeState === 'A' || payeeState === 'confirmed') && (
            <div className="flex items-center justify-between py-2 px-3 rounded-xl" style={{ border: `1px solid ${VOICE.innLine}`, background: VOICE.innWash }}>
              <div className="flex items-center gap-2 min-w-0">
                <div className="min-w-0">
                  <span className="text-[14px] font-semibold" style={{ color: VOICE.user }}>{payeeName}</span>
                  {(() => {
                    const s = stakeholders.find((x: any) => x.stakeholder_id === payeeId);
                    return s?.category
                      ? <span className="text-[11px] ml-1.5" style={{ color: VOICE.systemFaint }}>· {s.category}</span>
                      : null;
                  })()}
                </div>
              </div>
              <button type="button"
                onClick={() => {
                  setPayeeState('C');
                  setPayeeId('');
                  setPayeeName('');
                  setPayeeSearch(ai.payee_raw || '');
                  setTimeout(() => setShowPayeeDrop(true), 50);
                }}
                className="text-[11px] hover:underline shrink-0 ml-2" style={{ color: VOICE.accentDeep }}>
                change
              </button>
            </div>
          )}

          {/* STATE B — confirm match */}
          {payeeState === 'B' && (
            <div className="p-3 rounded-xl" style={{ background: VOICE.askWash, border: `1px solid ${VOICE.outLine}` }}>
              <p className="text-[11px] font-semibold flex items-center gap-1 mb-2" style={{ color: VOICE.accentDeep }}>
                <span className="text-[13px]">⚠</span> Confirm match
              </p>
              <p className="text-[12px] mb-2.5" style={{ color: VOICE.userSoft }}>
                AI matched{' '}
                <span className="font-semibold" style={{ color: VOICE.user }}>"{ai.payee_raw}"</span>
                {' → '}
                <span className="font-semibold" style={{ color: VOICE.user }}>{payeeName}</span>
                {(() => {
                  const s = stakeholders.find((x: any) => x.stakeholder_id === payeeId);
                  return s?.category
                    ? <span style={{ color: VOICE.systemFaint }}> · {s.category}</span>
                    : null;
                })()}
              </p>
              <div className="flex gap-2">
                <button type="button"
                  onClick={() => { setPayeeState('A'); advanceAfter('payee'); }}
                  className="flex-1 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
                  style={{ background: VOICE.confirm, color: '#fff' }}
                >
                  ✓ Yes, that's right
                </button>
                <button type="button"
                  onClick={() => {
                    setPayeeId('');
                    setPayeeName('');
                    setPayeeSearch(ai.payee_raw || '');
                    setPayeeState('C');
                    setTimeout(() => setShowPayeeDrop(true), 50);
                  }}
                  className="flex-1 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
                  style={{ border: `1px solid ${VOICE.line}`, color: VOICE.system }}
                >
                  ✗ No
                </button>
              </div>
            </div>
          )}

          {/* STATE C — search + dropdown.
              ...or, once "add" is tapped, THE SAME ROW becomes the new-party question (NewPartyRow).
              It REPLACES the field; it does not open beneath it. Nothing is pushed down the page, and
              there is never a form and a search box on screen at once arguing about which one you meant. */}
          {payeeState === 'C' && (showCreateStkForm ? (
            <NewPartyRow
              defaultName={ai.payee_raw || payeeSearch}
              onCreated={(id, name) => {
                selectPayee(id, name);
                setShowCreateStkForm(false);
                // If he was the last thing missing, adding him files the payment. "Then confirm auto."
                armAutoFile();
              }}
              onCancel={() => setShowCreateStkForm(false)}
            />
          ) : (
            <>
              {ai.payee_raw && (ai.payee_unmatched || payeeUnmatched) && (
                <p className="text-[11px] font-medium mb-1.5 flex items-center gap-1" style={{ color: VOICE.accentDeep }}>
                  <span className="material-symbols-outlined text-[13px]">warning</span>
                  "{ai.payee_raw}" not found — search or add below
                </p>
              )}
              <div className="relative" ref={payeeDropRef}>
                <div className="relative">
                  <input
                    ref={payeeRef}
                    type="text"
                    value={payeeSearch}
                    onChange={(e) => {
                      setPayeeSearch(e.target.value);
                      if (payeeId) { setPayeeId(''); setPayeeName(''); }
                      setShowPayeeDrop(true);
                    }}
                    onFocus={() => setShowPayeeDrop(true)}
                    placeholder="Search name…"
                    className="w-full text-[13px] px-2.5 py-2 pr-8 rounded-lg outline-none transition-colors"
                    style={fieldStyle(missingPayee ? 'missing' : 'idle')}
                    autoComplete="off"
                  />
                  <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-[15px] pointer-events-none" style={{ color: VOICE.systemFaint }}>
                    search
                  </span>
                </div>

                {showPayeeDrop && (() => {
                  /* stopPropagation on mousedown prevents the hidden PopupContents instance's
                     document mousedown handler from closing this dropdown before onClick fires */
                  const hasMatches = searchedPayees.length > 0;
                  const openCreate = (e: React.MouseEvent) => {
                    e.preventDefault();
                    setShowPayeeDrop(false);
                    setShowCreateStkForm(true);
                  };
                  return (
                  <div className="absolute left-0 right-0 top-full mt-1 z-10 rounded-xl shadow-lg max-h-56 overflow-y-auto"
                       style={{ background: VOICE.surface, border: `1px solid ${VOICE.line}` }}
                       onMouseDown={(e) => e.stopPropagation()}>

                    {/* ── Zero matches → the create action is promoted to the top as the hero.
                         A brand-new name is one tap: the form opens pre-filled with what was typed. ── */}
                    {!hasMatches && (
                      <button type="button" onMouseDown={openCreate}
                        className="group w-full flex items-center gap-3 px-3 py-3 text-left transition-colors"
                        style={{ background: VOICE.askWash }}
                      >
                        <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-[15px] font-bold shadow-sm" style={{ background: VOICE.walnut, color: VOICE.ivory }}>
                          {typedName ? typedName[0].toUpperCase() : '+'}
                        </span>
                        <span className="flex-1 min-w-0">
                          {typedName ? (
                            <>
                              <p className="text-[13px] font-semibold truncate" style={{ color: VOICE.user }}>Create &ldquo;{typedName}&rdquo;</p>
                              <p className="text-[11px]" style={{ color: VOICE.systemFaint }}>New contact · add type &amp; phone</p>
                            </>
                          ) : (
                            <>
                              <p className="text-[13px] font-semibold" style={{ color: VOICE.user }}>Add a new contact</p>
                              <p className="text-[11px]" style={{ color: VOICE.systemFaint }}>No one to match — create one</p>
                            </>
                          )}
                        </span>
                        <span className="material-symbols-outlined text-[18px] group-hover:translate-x-0.5 transition-transform" style={{ color: VOICE.accentDeep }}>
                          arrow_forward
                        </span>
                      </button>
                    )}

                    {/* ── Matches, when present ── */}
                    {hasMatches && searchedPayees.slice(0, 8).map((s: any) => {
                      // The hint CLAIMS a match ("· matched 'sreenu'"), so it answers to the same floor as
                      // everything else — under the old overlap scale, 30/100 was a coin toss wearing a fact's
                      // clothes. PAYEE_SEARCH_FLOOR is the one number that decides "is this near?" anywhere.
                      const score = payeeSimilarityScore(s.name, ai.payee_raw || '');
                      const showHint = ai.payee_raw && score >= PAYEE_SEARCH_FLOOR * 100 && s.name.toLowerCase() !== (ai.payee_raw || '').toLowerCase();
                      return (
                        <button key={s.stakeholder_id} type="button"
                          onMouseDown={(e) => { e.preventDefault(); selectPayee(s.stakeholder_id, s.name); }}
                          className="w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-black/[0.025]"
                          style={{ borderBottom: `1px solid ${VOICE.line}` }}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold" style={{ color: VOICE.user }}>{s.name}</p>
                            <p className="text-[11px]" style={{ color: VOICE.systemFaint }}>
                              {s.type} · {s.category}
                              {showHint && (
                                <span className="ml-1" style={{ color: VOICE.faint }}>· matched '{ai.payee_raw}'</span>
                              )}
                            </p>
                          </div>
                        </button>
                      );
                    })}

                    {/* ── Subtle "add" footer — only when matches exist (the hero covers the empty case) ── */}
                    {hasMatches && (
                      <button type="button" onMouseDown={openCreate}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-black/[0.02]"
                        style={{ borderTop: `1px solid ${VOICE.line}` }}
                      >
                        <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[12px] font-bold" style={{ background: VOICE.askWash, color: VOICE.accentDeep }}>
                          {typedName ? typedName[0].toUpperCase() : '+'}
                        </span>
                        <span className="flex-1 min-w-0 text-[12px]" style={{ color: VOICE.system }}>
                          {typedName ? (
                            <>Not here? Add <span className="font-semibold" style={{ color: VOICE.user }}>{typedName}</span> <span style={{ color: VOICE.systemFaint }}>· new contact</span></>
                          ) : (
                            <span className="font-semibold" style={{ color: VOICE.accentDeep }}>Add a new contact</span>
                          )}
                        </span>
                      </button>
                    )}
                  </div>
                  );
                })()}
              </div>

            </>
          ))}
        </div>
        )}

        {/* 3. Description — the REMARK. Optional now, so confirm mode never asks for it: it is a note
            on the payment, not a condition of it. Edit mode still offers it, because a note you want
            to write is a perfectly good reason to open the editor. */}
        {show('description') && (
        <div>
          <FieldQuestion text="What was this for?" missing={false} />
          <input
            id="resolve-description-input"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What was this payment for?"
            className="w-full text-[13px] px-2.5 py-2 rounded-lg outline-none transition-colors"
            style={fieldStyle(description.trim() ? 'filled' : 'idle')}
          />
        </div>
        )}

        {/* 4. Project */}
        {show('project') && (
        <div>
          <FieldQuestion text="Which project is this for?" missing={missingProject && !projectUnmatched} />
          <select
            ref={projectRef}
            value={projectId}
            onChange={(e) => { setProjectId(e.target.value); if (e.target.value) advanceAfter('project'); }}
            className="w-full text-[13px] px-2.5 py-2 rounded-lg outline-none transition-colors appearance-none"
            style={fieldStyle(missingProject && !projectUnmatched ? 'missing' : projectId ? 'filled' : projectUnmatched ? 'missing' : 'idle')}
          >
            <option value="">Select project…</option>
            {projects.map((p) => (
              <option key={p.project_id} value={p.project_id}>{p.name}</option>
            ))}
          </select>

          {projectUnmatched && !projectId && (ai.project_closest_match?.length ?? 0) > 0 && (
            <div className="mt-2 p-2.5 rounded-xl" style={{ background: VOICE.askWash, border: `1px solid ${VOICE.outLine}` }}>
              <p className="text-[11px] font-medium mb-2 flex items-center gap-1" style={{ color: VOICE.accentDeep }}>
                <span className="material-symbols-outlined text-[13px]">warning</span>
                "<span className="italic">{ai.project_raw}</span>" didn't match a project
              </p>
              <div className="space-y-1">
                {ai.project_closest_match!.map((p: any) => (
                  <button key={p.id} type="button"
                    onClick={() => { setProjectId(p.id); advanceAfter('project'); }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-[13px] font-semibold transition-colors"
                    style={{ background: VOICE.surface, border: `1px solid ${VOICE.outLine}`, color: VOICE.user }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isWhatsApp && !projectId && !projectUnmatched && (
            <div className="mt-1.5"><span className="inline-flex items-center gap-1 text-[11px]" style={{ color: VOICE.accentDeep }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: VOICE.accentSoft }} /> Pick a project</span></div>
          )}
        </div>
        )}

        {/* 5. Mode — never a gap (it defaults), so confirm mode does not ask. */}
        {!confirmMode && (
        <div>
          <FieldQuestion text="How was it paid?" />
          <div className="flex gap-1.5 flex-wrap">
            {(['Cash', 'NEFT', 'UPI', 'Cheque'] as const).map((m) => (
              <button key={m} type="button"
                onClick={() => setMode(m)}
                className="px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition-colors"
                style={mode === m
                  ? { background: VOICE.walnut, color: VOICE.ivory }
                  : { background: VOICE.field, color: VOICE.system }}
              >{m}</button>
            ))}
          </div>
        </div>
        )}
      </div>

      </div>

      {/* ── Sticky footer ── */}
      <div className="shrink-0 px-4 pt-3 pb-4" style={{ borderTop: `1px solid ${VOICE.line}`, background: VOICE.page, paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>

        {showDismissConfirm && (
          <div className="mb-3 p-3 rounded-xl flex items-center gap-2 flex-wrap" style={{ background: VOICE.field }}>
            <p className="text-[12px] flex-1" style={{ color: VOICE.system }}>Dismiss this entry? It won't be deleted.</p>
            <div className="flex gap-2">
              <button onClick={() => setShowDismissConfirm(false)}
                className="text-[12px] px-2 py-1" style={{ color: VOICE.systemFaint }}>
                Keep
              </button>
              <button onClick={handleDismiss}
                className="text-[12px] font-semibold px-3 py-1 rounded-lg" style={{ color: VOICE.accentDeep }}>
                Yes, dismiss
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-row gap-2 items-center">
          <button
            onClick={() => setShowDismissConfirm(true)}
            className="shrink-0 md:flex-none px-4 py-2.5 rounded-xl text-[13px] font-medium transition-colors"
            style={{ border: `1px solid ${VOICE.line}`, color: VOICE.system }}
          >
            Dismiss
          </button>
          <div className="hidden md:block flex-1" />
          {nextGap ? (
            /* Incomplete → one guiding button that names the next gap and jumps to it. */
            <button type="button" onClick={goToGap}
              className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl text-[13px] font-bold transition-all duration-200 active:scale-95"
              style={{ background: VOICE.walnut, color: VOICE.ivory, boxShadow: '0 8px 20px -10px rgba(34,26,19,.6)' }}>
              {nextGap.label}
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </button>
          ) : (
            /* Complete → the real action. In CONFIRM mode that is the filing itself: he pressed Approve
               to get here, and the button at the end of it must finish what he started rather than send
               him back to the card to press the same word a second time. */
            <button
              onClick={confirmMode ? handleApprove : handleSave}
              disabled={posting}
              className="flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold transition-all duration-200 active:scale-95"
              style={posting
                ? { background: VOICE.field, color: VOICE.systemFaint, cursor: 'not-allowed' }
                : { background: VOICE.walnut, color: VOICE.ivory, boxShadow: '0 8px 20px -10px rgba(34,26,19,.6)' }}
            >
              {posting ? (
                <>
                  <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(154,142,128,.3)', borderTopColor: VOICE.system }} />
                  {confirmMode ? 'Filing…' : 'Saving…'}
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[16px]">check</span>
                  {confirmMode ? 'Approve & file' : 'File it'}
                </>
              )}
            </button>
          )}
        </div>
      </div>

      <ImageLightbox url={lightboxUrl} title="Source Image" onClose={() => setLightboxUrl(null)} />
    </>
  );
}
