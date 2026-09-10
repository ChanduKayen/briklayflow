// The txn/bill NOTE follow-up.
//
// After a payment or bill is staged, its conversation is CLOSED carrying `staged_entry_id` (the "lingering"
// row, read every turn). A following TEXT that clearly reads as a NOTE / reason / comment about that entry
// should ATTACH to it — not route fresh, where a site-ish note lands in SiteOps and parks as "which work?"
// (the reported bug). Same conservative posture as the siteops photo window: default to routing fresh; attach
// ONLY when it clearly reads as a note about the money (a purpose/reason/comment/purchase detail), never a
// NEW payment, an order to make, a question, or a site-work progress update.

import { callClaude, callOpenAI } from './_classify.ts'
import { isBareAffirmation } from './_siteops_assoc.ts'

export type NoteVerdict = 'note' | 'fresh' | 'noop'

/** PURE decision — the window/affirmation/note rule in one place (unit-tested).
 *   expired window → fresh (never a trap); bare "ok" → noop (nothing to attach, don't re-route);
 *   reads-as-note → note; else fresh. */
export function noteVerdict(withinHold: boolean, text: string, readsAsNote: boolean): NoteVerdict {
  if (!withinHold) return 'fresh'
  if (isBareAffirmation(text)) return 'noop'
  return readsAsNote ? 'note' : 'fresh'
}

/** A short human summary of the just-staged entry, for the note classifier's context. PURE. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function entrySummary(ai: Record<string, any> | null | undefined): string {
  const a = (ai ?? {}) as Record<string, any>
  const inr = (n: unknown) => (n != null && isFinite(Number(n)) ? '₹' + Number(n).toLocaleString('en-IN') : '')
  if (a.kind === 'BILL') {
    const who = a.vendor_name ?? 'a vendor'
    const amt = inr(a.bill_total)
    return `a bill from ${who}${amt ? ' for ' + amt : ''}`
  }
  const who = a.payee_name ?? a.payee_raw ?? 'someone'
  const amt = inr(a.amount)
  return `a payment${amt ? ' of ' + amt : ''}${who ? ' to ' + who : ''}`
}

const NOTE_SYS = `A payment or bill was JUST recorded from the user's WhatsApp: {{ENTRY}}.
The user then sent this message: "{{TEXT}}".
Decide ONE thing: is this message a NOTE / REASON / COMMENT about THAT recorded entry — what the money was
for, its purpose, a remark, a purchase detail — as opposed to a NEW action?
Answer STRICT JSON only: {"note": true} or {"note": false}.
- note=true ONLY when it clearly reads as a note/reason/comment about the entry (e.g. "for cement",
  "auto charges", "advance for material", "site urgent purchase", "labour payment for the slab").
- note=false for a NEW payment (an amount to someone), a purchase/order to make, a question, or a
  site-work PROGRESS update ("slab done", "wiring pending", "cars getting damaged").
When unsure, answer false.`

/** LLM: does the text read as a note about the entry? Defaults FALSE (route fresh) on any failure/uncertainty. */
export async function readsAsTxnNote(summary: string, text: string): Promise<boolean> {
  const t = (text ?? '').trim()
  if (!t) return false
  const sys = NOTE_SYS.replace('{{ENTRY}}', summary).replace('{{TEXT}}', t.replace(/"/g, "'"))
  const openai = Deno.env.get('OPENAI_API_KEY'); const anthropic = Deno.env.get('ANTHROPIC_API_KEY')
  const parse = (raw: string): boolean => {
    try { const m = (raw ?? '').match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]).note === true : false } catch { return false }
  }
  try {
    if (openai) { const r = await callOpenAI(openai, sys, t, 20, 0); if (r) return parse(r) }
    if (anthropic) { const r = await callClaude(anthropic, sys, t, 20, 0); if (r) return parse(r) }
  } catch (_) { /* fall through to false */ }
  return false
}

/**
 * Append a note to a staged rough_entry: onto its message (`raw_text`) AND its description, so it shows on the
 * Day Book / bill card with the entry. Best-effort; one merged write (reads the row for the existing values).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function attachNoteToEntry(supabase: any, entryId: string, text: string): Promise<boolean> {
  const note = (text ?? '').trim()
  if (!note) return false
  const { data } = await supabase.from('rough_entries').select('raw_text, ai_extracted').eq('id', entryId).maybeSingle()
  if (!data) return false
  const prevRaw = (data.raw_text ?? '').toString().trim()
  const ai = (data.ai_extracted ?? {}) as Record<string, unknown>
  const prevDesc = (ai.description_raw ?? '').toString().trim()
  const notes = Array.isArray((ai as { wa_notes?: unknown[] }).wa_notes) ? (ai as { wa_notes: unknown[] }).wa_notes : []
  const { error } = await supabase.from('rough_entries').update({
    raw_text: prevRaw ? `${prevRaw}\n${note}` : note,
    ai_extracted: { ...ai, description_raw: prevDesc ? `${prevDesc} · ${note}` : note, wa_notes: [...notes, note] },
  }).eq('id', entryId)
  if (error) { console.error('[txn-note] attach failed:', error.message); return false }
  return true
}
