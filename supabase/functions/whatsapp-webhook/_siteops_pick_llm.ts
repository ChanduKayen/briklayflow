// THE PICK ANSWER, READ BY MEANING — the last resort when the lexical matcher cannot read the reply.
//
// resolveTypedPick (_siteops_attach.ts) is PURE and LEXICAL, and it is the right first pass: a bare number,
// a tapped row, an English label. But its tokenizer is `/[a-z0-9]{3,}/g` — LATIN ONLY — and our supervisors
// answer in Telugu. A Telugu-script reply produces ZERO tokens, so bestTokenOverlap returns null, every
// single time. The matcher was structurally incapable of understanding the language it was being answered in.
//
// LIVE FAILURE (2026-07-13). We asked which task "electrical chases made for 2nd floor Unit B" was about, and
// offered exactly one option: "Plumbing — in-wall lines (chases & sleeves)". He replied:
//
//     "ఎలక్ట్రికల్ గార్డలు తీసాం, ప్లంబింగ్ గార్డలు కాదు."   (we did the ELECTRICAL chases, not the plumbing ones)
//
// A perfect answer. Zero Latin tokens → no match → "not an answer" → the whole message was re-run as a FRESH
// narration, and decompose turned his negation into a brand-new ISSUE: "plumbing guards not removed". We
// invented a defect on his site out of a word he used to tell us we were wrong.
//
// ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────────────────────────────────────
// It does NOT remove the fresh-turn fall-through. That exists for a reason, and the reason is in siteops.ts:
// a ₹25,000 payment ("రాజుకి పాతికి వేలు ఇచ్చాను") once arrived while a pick was open, failed to match, and was
// answered "No problem — I'll check back next time." The money vanished. So a reply that is genuinely NOT
// about the question must still fall through and be handled as its own turn.
//
// That is the ONE judgement this makes: is this reply about the question we asked, or is it something else?
// It is bounded — the model may only name an id we offered — and it fails CLOSED: any error, any malformed
// response, any unknown id, and we return `not_an_answer`, which is exactly today's behaviour. It can make
// the pick smarter. It cannot make it lossier.

import { callLLM } from './_siteops_extract.ts'
import type { PickCandidate } from './_siteops_attach.ts'

export type PickReading =
  | { kind: 'pick'; target: PickCandidate }   // he named one of the options we offered
  | { kind: 'new' }                           // "it's something else" — new work, log it fresh
  | { kind: 'none' }                          // "none of these" — the offered list is wrong; park, change nothing
  | { kind: 'not_an_answer' }                 // not about this question at all → the caller's fresh-turn path

const SYSTEM = `You are reading a construction supervisor's reply to a question WE asked him on WhatsApp.

We showed him a numbered list of items and asked which one he meant. Your ONLY job is to decide what his reply says about THAT question. He writes in Telugu, English, Hindi, or a mix, and he speaks like a man on a site — short, blunt, often just naming the thing.

Answer with STRICT JSON, nothing else:
{"verdict":"pick|new|none|not_an_answer","id":"<the id of the option he named, ONLY when verdict is pick>","reason":"<one short clause>"}

THE FOUR VERDICTS:

"pick" — he named one of the options. He may name it by number, by its words, by its trade, by its floor or unit, or by ruling the others out ("the electrical one", "not the plumbing — the electrical", "Unit B one", "second floor"). A reply that RULES OUT some options and leaves exactly ONE standing is a pick of that one. Put its id in "id".

"new" — he says this is different work from anything offered: "it's a new one", "different task", "separate", "kotthadhi".

"none" — he says none of the options is right, AND does not point at anything else. The task he means may simply not exist in the system yet. We will change nothing and save it for review.

"not_an_answer" — he is not talking about our question at all. He has moved on: a payment, a material order, a different site, a greeting, a question of his own. THIS IS THE IMPORTANT ONE. If you are not sure his reply is about the list we showed him, say not_an_answer. We will handle it as its own message and ask our question again afterwards — nothing is lost. But if you wrongly call a payment a "pick", we write his money onto a construction task and it is gone.

RULES:
- "id" MUST be one of the ids in the OFFERED list, copied exactly. Never invent an id. Never use the number.
- A reply that rules out an option is still ABOUT our question — it is a pick if one option survives, "none" if none does. It is NOT "not_an_answer".
- A negation is not a new fact. "not the plumbing ones" tells you which option he means. It does not report anything about plumbing.
- When the reply is about our question but you cannot tell WHICH option, answer "none" — never guess an id.`

/**
 * Read a pick reply against the FROZEN offered list. Bounded: the only ids admitted are the ones we offered.
 * Fails CLOSED to `not_an_answer` — the caller's existing behaviour — so a model outage can never lose a
 * message, it can only make us fall back to what we did before.
 */
export async function interpretPickReply(
  question: string,
  offered: PickCandidate[],
  reply: string,
  call: (system: string, user: string) => Promise<string> = callLLM,
): Promise<PickReading> {
  if (!offered.length || !reply.trim()) return { kind: 'not_an_answer' }

  const list = offered.map((c, i) => `${i + 1}. id=${c.id} | ${c.label}`).join('\n')
  const user = `WE ASKED:\n${question || 'Which item is this about?'}\n\nOFFERED (the ONLY ids you may name):\n${list}\n\nHIS REPLY:\n${reply}`

  let raw: string
  try {
    raw = await call(SYSTEM, user)
  } catch (e) {
    console.error('[siteops:pick:llm] model failed — falling back to not_an_answer:', (e as Error)?.message ?? e)
    return { kind: 'not_an_answer' }
  }

  let j: { verdict?: unknown; id?: unknown; reason?: unknown }
  try {
    j = JSON.parse(raw.trim().replace(/^```(?:json)?|```$/g, '').trim())
  } catch {
    console.error('[siteops:pick:llm] unparseable response — falling back to not_an_answer:', raw.slice(0, 200))
    return { kind: 'not_an_answer' }
  }

  const verdict = typeof j.verdict === 'string' ? j.verdict : ''
  const reason = typeof j.reason === 'string' ? j.reason : ''

  if (verdict === 'pick') {
    // BOUNDED. The id must be one we offered — a model that names anything else has not answered our
    // question, and we will not act on an id we never showed him.
    const target = offered.find((c) => c.id === j.id)
    if (!target) {
      console.error(`[siteops:pick:llm] pick named an id we never offered (${JSON.stringify(j.id)}) — not_an_answer`)
      return { kind: 'not_an_answer' }
    }
    console.log(`[siteops:pick:llm] pick → ${target.id} (${target.label}) — ${reason}`)
    return { kind: 'pick', target }
  }
  if (verdict === 'new')  { console.log(`[siteops:pick:llm] new — ${reason}`); return { kind: 'new' } }
  if (verdict === 'none') { console.log(`[siteops:pick:llm] none of these — ${reason}`); return { kind: 'none' } }

  console.log(`[siteops:pick:llm] not_an_answer — ${reason}`)
  return { kind: 'not_an_answer' }
}
