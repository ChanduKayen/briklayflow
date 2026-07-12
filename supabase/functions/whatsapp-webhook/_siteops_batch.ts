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

// DELETED (2026-07-09) — the entire REPLY-MATCHING layer: the tokenizer + STOP list, matchPieceToBatch,
// interpretStatus (RESOLVED_RE / OPEN_RE), isBareAck (ACK_WORDS / ACK_EMOJI_RE / ACK_HONORIFIC),
// classifyReplyFragment, scopeBatchToProject and routeEmptyDecompose.
//
// These decided, by keyword, what a supervisor's reply MEANT: was it an ack, was it a closure, which chased
// item did it answer. Across English, Telugu, Hindi, Tenglish and native script, that is not a set anyone can
// finish — and a word list cannot fail loudly. AFFIRM_NEG, the router's twin of ACK_WORDS, had shipped a
// corrupted entry (a Latin "v" glued to Telugu "ద్దు") that matched nothing, for months, in silence.
//
// A chase reply is now just an inbound message. The router reads the conversation (the chase digest is an
// assistant turn) and the resolution model reads the ⭐-ranked candidates. Meaning is inferred once, by a
// model, from context — not three times, by three regexes, from spelling.
//
// What survives below is the batch as EVIDENCE, which is all siteops.ts ever claimed it was: the rows we
// chased, so they can be ranked/injected into the candidate set, and struck off when genuinely resolved.

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
