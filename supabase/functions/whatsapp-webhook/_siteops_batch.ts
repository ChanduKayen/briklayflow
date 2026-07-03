// Block B3 — the OPEN BATCH: the patient context a chase digest opens, and the
// content-matcher that sorts each reply fragment into "answers an open chase" vs
// "new narration". The batch is NOT a modal pending question — it lives in its
// own `chase_batches` row and stays OPEN in the background across however many
// messages, voice notes, and context-switches, until its items resolve or the
// next cycle re-chases them. Nothing here forces a "finish the batch first".
//
// THE MATCHER is the crux. A name-style fuzzy scorer over-matches: "3rd floor
// slab done" shares "floor"/"slab" with a "2nd floor slab cement short" issue
// and would wrongly resolve it. So instead we match on each item's KEY TOKENS —
// the content tokens that are *distinctive within this batch* (minimum document
// frequency). "cement" (the only cement issue) is a key token; "floor"/"slab"
// (shared by several) are not. A reply fragment matches an item iff it shares
// one of that item's key tokens. This makes:
//   • "cement sorted"            → the lone cement issue            (unique)
//   • "cement sorted" w/ cement issues at TWO sites, no site named → (collision)
//   • "3rd floor slab done"      → no key-token overlap            → new narration
// fall out for free, deterministically — no extra LLM call.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any

export interface BatchItem {
  kind: 'issue' | 'todo'
  id: string                  // problem_id or todo_id
  orgId: string
  projectId: string | null
  projectName: string
  title: string
  taskName: string | null
  cause: string | null
}

export interface OpenBatch {
  id: string
  items: BatchItem[]
}

// ── tokenization ────────────────────────────────────────────────────────────
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'for', 'to', 'of', 'on', 'in', 'at', 'by',
  'is', 'are', 'was', 'were', 'be', 'still', 'not', 'yet', 'now', 'its', 'it', 'this',
  'that', 'with', 'from', 'has', 'have', 'had', 'will', 'shall', 'we', 'you', 'i',
])
// LOCATION / structural words — WHERE work happens, not WHAT is being chased. An
// issue's identity is its subject (cement, masons, inspector), so these are never
// key tokens (else "3rd floor slab done" would match a "2F slab cement" issue on
// the shared "floor"/"slab"). They ARE kept for collision-narrowing (which floor).
const LOC = new Set([
  'floor', 'floors', 'slab', 'ground', 'gf', 'basement', 'cellar', 'roof', 'terrace',
  'wall', 'walls', 'beam', 'beams', 'column', 'columns', 'footing', 'footings',
  'foundation', 'plinth', 'lintel', 'unit', 'units', 'block', 'blocks', 'storey',
  'story', 'level', 'lobby', 'stair', 'stairs', 'staircase', 'side', 'area', 'zone',
  'north', 'south', 'east', 'west', 'first', 'second', 'third', 'fourth', 'fifth',
  '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '1f', '2f', '3f', '4f', '5f',
])
/** content tokens: lowercased words, len>=3, no pure-digits, no stopwords. */
function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !STOP.has(t))
}
/** subject tokens — content minus location (used for KEY-token identity). */
function subjectTokens(s: string): string[] {
  return tokens(s).filter((t) => !LOC.has(t))
}

/**
 * Per item, the SUBJECT tokens that are DISTINCTIVE in this batch — those with
 * the minimum document-frequency among the item's own subject tokens. For a
 * one-of-a-kind issue that's its df==1 subject (cement); for two same-cause
 * issues the shared cause word is the min, which is exactly what makes them
 * collide. Location words are excluded so a shared floor can't fake a match.
 */
function keyTokensByItem(items: BatchItem[]): string[][] {
  const docs = items.map((it) => new Set(subjectTokens(`${it.title} ${it.taskName ?? ''}`)))
  const df = new Map<string, number>()
  for (const d of docs) for (const t of d) df.set(t, (df.get(t) ?? 0) + 1)
  return docs.map((d) => {
    const toks = [...d]
    if (!toks.length) return []
    const min = Math.min(...toks.map((t) => df.get(t)!))
    return toks.filter((t) => df.get(t) === min)
  })
}

export type PieceMatch =
  | { kind: 'unique'; index: number }
  | { kind: 'collision'; indexes: number[] }
  | { kind: 'none' }

/**
 * Match ONE reply fragment against the open batch. project/floor/task named in
 * the fragment narrow a collision to one. Returns which batch item(s) it answers
 * (or none → it's new narration). Pure + deterministic.
 */
export function matchPieceToBatch(
  piece: { text: string; task_hint?: string | null; project_hint?: string | null },
  items: BatchItem[],
): PieceMatch {
  if (!items.length) return { kind: 'none' }
  const keys = keyTokensByItem(items)
  // match identity on SUBJECT tokens (cement/masons/inspector) — never location
  const replySubjects = new Set([...subjectTokens(piece.text), ...subjectTokens(piece.task_hint ?? '')])

  // candidate items = those sharing a key (subject) token with the fragment
  let hits = items.map((_it, i) => i).filter((i) => keys[i].some((t) => replySubjects.has(t)))

  if (!hits.length) return { kind: 'none' }
  if (hits.length === 1) return { kind: 'unique', index: hits[0] }

  // multiple share the subject (same-cause across sites) → try to narrow.
  // (a) an explicit site named in the reply
  const ph = (piece.project_hint ?? '').toLowerCase().trim()
  if (ph) {
    const narrowed = hits.filter((i) => {
      const pn = items[i].projectName.toLowerCase()
      return pn.includes(ph) || ph.includes(pn.split(/\s+/)[0])
    })
    if (narrowed.length === 1) return { kind: 'unique', index: narrowed[0] }
    if (narrowed.length) hits = narrowed
    if (hits.length === 1) return { kind: 'unique', index: hits[0] }
  }
  // (b) a site/floor mentioned in the reply that overlaps ONE candidate's full
  //     description (title + task + project) more than the others — full tokens
  //     here (location included) so "2nd floor"/"lakshmi" can pick the right one.
  const replyAll = new Set([...tokens(piece.text), ...tokens(piece.task_hint ?? ''), ...tokens(piece.project_hint ?? '')])
  const overlap = hits.map((i) => {
    const full = new Set(tokens(`${items[i].title} ${items[i].taskName ?? ''} ${items[i].projectName}`))
    let n = 0
    for (const t of replyAll) if (full.has(t)) n++
    return { i, n }
  }).sort((a, b) => b.n - a.n)
  if (overlap.length >= 2 && overlap[0].n - overlap[1].n >= 1) return { kind: 'unique', index: overlap[0].i }

  return { kind: 'collision', indexes: hits }
}

// ── reply intent (resolve vs still-open vs blocker) ─────────────────────────
export type ReplyStatus = 'resolved' | 'still_open' | 'unknown'

const RESOLVED_RE = /\b(sorted|sortd|resolved|resolve|done|cleared|clear|fixed|fix|arrived|received|complete|completed|finish|finished|settled|paid|ready|ok\s*now|good\s*now|sab\s*ho\s*gaya|ho\s*gaya|aa\s*gaya)\b/i
const OPEN_RE = /\b(still|not|yet|pending|nahi|delay|delayed|short|waiting|wait|blocked|stuck|tomorrow|later|next|by\s+\w+|no)\b/i

/** Read whether a reply fragment says an item is resolved or still open. */
export function interpretStatus(text: string): ReplyStatus {
  const t = text.toLowerCase()
  const resolved = RESOLVED_RE.test(t)
  const open = OPEN_RE.test(t)
  if (resolved && !open) return 'resolved'
  if (open && !resolved) return 'still_open'
  if (resolved && open) return 'still_open' // "not sorted yet" → keep open (safe default)
  return 'unknown'
}

// ── reply-fragment routing (the batch-vs-fresh decision) ─────────────────────
// The crux the message-eating regression lives in. For each fragment of a reply that arrives while a
// chase batch is open, decide: does it ANSWER a chase item (which), COLLIDE across same-cause items, or
// is it a NEW OBSERVATION (leftover → route fresh, NEVER consume empty)? Extracted PURE so the text path
// finally has the payment-gate treatment (see __tests__/batch_reply.test.ts).
export type FragmentVerdict =
  | { kind: 'match'; index: number }        // answers batch item[index]
  | { kind: 'collision'; indexes: number[] }
  | { kind: 'leftover' }                     // new observation → route fresh

/**
 * Classify ONE reply fragment against the open batch. `singleFragment` = the whole message was one
 * fragment; `hasObservation` = the decompose pass found a substantive site item (a real observation, not
 * a bare ack). PURE.
 */
/**
 * FIX 2 — project-scope the sender's batch. The batch is SENDER-scoped (spans every site the sender is
 * chased on), so a message that resolves to a project must only match/collide with chases ON that project
 * — extending Fix X from the photo branch to all message types. PURE.
 *   • projectId null (no site named / caption unresolved) → the whole batch (the honest ambiguous case).
 *   • projectId names a project WITH chases → just that project's items.
 *   • projectId names a CHASE-FREE project → routeFresh: the message isn't a chase reply at all.
 */
export function scopeBatchToProject(items: BatchItem[], projectId: string | null): { scoped: BatchItem[]; routeFresh: boolean } {
  if (!projectId) return { scoped: items, routeFresh: false }
  const scoped = items.filter((it) => it.projectId === projectId)
  return { scoped, routeFresh: scoped.length === 0 }
}

export function classifyReplyFragment(
  piece: { text: string; task_hint?: string | null; project_hint?: string | null },
  items: BatchItem[],
  signals: { singleFragment: boolean; hasObservation: boolean },
): FragmentVerdict {
  // FIX 1 — chase precedence is a PRIOR, not a LOCK. Force-match the lone open chase ONLY for a BARE
  // reply — one that decompose found NO substantive observation in ("sari"/"done"/"haan", the terse
  // non-English acks the shortcut was legitimately built for). A message carrying a real observation
  // ("tiles broken, blocking work") must EARN its chase match by content below, and on no match fall
  // through to `leftover` (routed fresh) — never be eaten. This uses work the pipeline already did: the
  // decompose pass tells us whether the message was an ack or an observation.
  if (items.length === 1 && !signals.hasObservation) return { kind: 'match', index: 0 }
  const m = matchPieceToBatch(piece, items)
  if (m.kind === 'unique') return { kind: 'match', index: m.index }
  if (m.kind === 'collision') return { kind: 'collision', indexes: m.indexes }
  return { kind: 'leftover' }
}

// ── batch state (chase_batches) ─────────────────────────────────────────────
const BATCH_COLS = 'id, items'

/** The sender's currently-open batch, or null. */
export async function getOpenBatch(supabase: SB, orgId: string, sender: string): Promise<OpenBatch | null> {
  const { data } = await supabase.from('chase_batches')
    .select(BATCH_COLS)
    .eq('org_id', orgId).eq('sender_number', sender).eq('status', 'OPEN')
    .order('updated_at', { ascending: false })
    .limit(1).maybeSingle()
  if (!data) return null
  return { id: data.id, items: (data.items ?? []) as BatchItem[] }
}

/** Open (or replace) the sender's batch with the items a digest just chased. */
export async function upsertOpenBatch(supabase: SB, orgId: string, sender: string, items: BatchItem[]): Promise<void> {
  const { data: existing } = await supabase.from('chase_batches')
    .select('id').eq('org_id', orgId).eq('sender_number', sender).eq('status', 'OPEN')
    .limit(1).maybeSingle()
  const now = new Date().toISOString()
  if (existing) {
    await supabase.from('chase_batches').update({ items, updated_at: now }).eq('id', existing.id)
  } else {
    await supabase.from('chase_batches').insert({ org_id: orgId, sender_number: sender, status: 'OPEN', items, updated_at: now })
  }
}

/**
 * Add ONE item to the sender's open batch (merge), creating the batch if none exists.
 * Used when an assignment notice goes out so the assignee's reply ("done"/"sorted") has
 * the item to resolve against — without it, the reply reads as a brand-new narration.
 */
export async function addToOpenBatch(supabase: SB, orgId: string, sender: string, item: BatchItem): Promise<void> {
  const existing = await getOpenBatch(supabase, orgId, sender)
  const now = new Date().toISOString()
  if (existing) {
    if (existing.items.some((i) => i.id === item.id)) return   // already tracked
    await supabase.from('chase_batches').update({ items: [...existing.items, item], updated_at: now }).eq('id', existing.id)
  } else {
    await supabase.from('chase_batches').insert({ org_id: orgId, sender_number: sender, status: 'OPEN', items: [item], updated_at: now })
  }
}

/** Drop resolved items from a batch; close it when nothing's left. */
export async function dropBatchItems(supabase: SB, batch: OpenBatch, resolvedIds: string[]): Promise<{ closed: boolean }> {
  const remaining = batch.items.filter((it) => !resolvedIds.includes(it.id))
  if (!remaining.length) {
    await supabase.from('chase_batches').update({ status: 'CLOSED', closed_at: new Date().toISOString() }).eq('id', batch.id)
    return { closed: true }
  }
  await supabase.from('chase_batches').update({ items: remaining, updated_at: new Date().toISOString() }).eq('id', batch.id)
  return { closed: false }
}
