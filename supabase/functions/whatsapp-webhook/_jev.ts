// ── Jev (TypeSafe AI) — payee matching, PROOF OF CONCEPT, SHADOW MODE ───────────────────────────────
//
// Jev is a System-1, non-autoregressive DECISION model: given a `state` (context) and typed
// `questions`, it returns typed values with probabilities/confidence — no text generation. Payee
// matching is a bounded decision, so it fits: conventional matching (see _match.ts) RETRIEVES a
// shortlist; Jev DECIDES among it. Jev never sees the whole DB.
//
// This module is deliberately inert unless BOTH are set:
//   JEV_ENABLED=1  and  JEV_API_KEY=<key>
// With either missing, `jevEnabled()` is false and the shadow caller no-ops — zero effect on the
// live WhatsApp path. It is called fire-and-forget in shadow mode (never awaited on the turn), so a
// slow or failing Jev can never affect a payment.
//
// The request/response shape below follows the published System-One format
// ({ state, questions: { name: { type, instructions } } } → typed answers with confidence) and is
// isolated here so it can be corrected to the real early-access API in one place. We use one Noul
// (yes/no) question PER shortlisted candidate — Jev evaluates them in parallel in a single request —
// and take the highest-probability "yes" as the pick. (If the early-access Choice type accepts a
// dynamic per-request option list, a single Choice over the shortlist is a drop-in replacement.)

const JEV_URL = Deno.env.get('JEV_API_URL') ?? 'https://api.typesafe.ai/v1/decide'
const JEV_KEY = Deno.env.get('JEV_API_KEY') ?? ''

/** True only when the POC is explicitly switched on AND a key is present. Default: off. */
export function jevEnabled(): boolean {
  return (Deno.env.get('JEV_ENABLED') ?? '') === '1' && !!JEV_KEY
}

export type JevCandidate = { id: string; name: string; trade?: string | null; aliases?: string[] | null }
export type JevPayeeResult = { id: string; confidence: number } | null

interface JevAnswer { noul?: number; confidence?: number }
interface JevResponse { answers?: Record<string, JevAnswer> }

/**
 * Ask Jev which shortlisted candidate the raw payee text names. Returns the best candidate id + its
 * probability, or null (no confident match / disabled / error / timeout). Pure decider over the
 * supplied candidates — it can only ever return one of their ids.
 */
export async function jevMatchPayee(
  input: string,
  ctx: { amount?: number | null; site?: string | null },
  candidates: JevCandidate[],
  timeoutMs = 1500,
): Promise<JevPayeeResult> {
  if (!jevEnabled() || !input?.trim() || !candidates.length) return null

  const state = [
    `A site payment note names a payee: "${input.trim()}".`,
    ctx.site ? `Site: ${ctx.site}.` : '',
    ctx.amount ? `Amount: ${ctx.amount}.` : '',
    'The payee is one of the people below, or none of them.',
  ].filter(Boolean).join(' ')

  const questions: Record<string, { type: 'noul'; instructions: string }> = {}
  candidates.forEach((c, i) => {
    const desc = [
      c.name,
      c.trade ? `(${c.trade})` : '',
      c.aliases?.length ? `also called ${c.aliases.join(', ')}` : '',
    ].filter(Boolean).join(' ')
    questions[`c${i}`] = {
      type: 'noul',
      instructions: `Does the payee named in the note refer to this person: ${desc}? Allow for spelling, romanisation of Indian names, nicknames and abbreviations.`,
    }
  })

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(JEV_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${JEV_KEY}` },
      body: JSON.stringify({ state, questions }),
      signal: ctrl.signal,
    })
    if (!res.ok) { console.warn('[jev] non-OK', res.status); return null }
    const data = await res.json() as JevResponse
    const ans = data.answers ?? {}
    let best = -1, bestI = -1
    candidates.forEach((_, i) => {
      const p = Number(ans[`c${i}`]?.noul ?? 0)
      if (p > best) { best = p; bestI = i }
    })
    return bestI >= 0 && best > 0 ? { id: candidates[bestI].id, confidence: best } : null
  } catch (e) {
    console.warn('[jev] error', (e as Error)?.message)
    return null
  } finally {
    clearTimeout(timer)
  }
}
