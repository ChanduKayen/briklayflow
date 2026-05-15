// Central routing module: canonical intent types + telemetry logging.
// All routing decisions flow through here so thresholds live in one place.

export type CanonicalIntent =
  | 'TXN_RECORD'
  | 'SITE_UPDATE'
  | 'QUERY'
  | 'GENERAL'
  | 'SESSION_REPLY'

/** Map classifyMessage() output → canonical intent. */
export function classificationToIntent(
  c: 'FINANCIAL' | 'QUERY' | 'SITE_UPDATE' | 'GENERAL',
): CanonicalIntent {
  if (c === 'FINANCIAL')   return 'TXN_RECORD'
  if (c === 'QUERY')       return 'QUERY'
  if (c === 'SITE_UPDATE') return 'SITE_UPDATE'
  return 'GENERAL'
}

/** Map classifyIntent() IntentAction → canonical intent. */
export function intentActionToCanonical(action: string): CanonicalIntent {
  if (action === 'NEW_FINANCIAL')    return 'TXN_RECORD'
  if (action === 'NEW_SITE_UPDATE')  return 'SITE_UPDATE'
  if (action === 'NEW_QUERY')        return 'QUERY'
  if (action === 'CONTINUE_SESSION') return 'SESSION_REPLY'
  return 'GENERAL'
}

/**
 * Arbitration policy (used for telemetry labels; actual decision is made by
 * classifyIntent scores).
 *   new_intent >= 75 AND >= session + 20  → reroute
 *   session   >= 75 AND >= new_intent + 20 → continue session
 *   else                                   → ambiguous (default: keep session)
 */
export function describeArbitration(
  sessionScore: number,
  newIntentScore: number,
): 'REROUTE' | 'CONTINUE' | 'AMBIGUOUS' {
  if (newIntentScore >= 75 && newIntentScore >= sessionScore + 20) return 'REROUTE'
  if (sessionScore >= 75 && sessionScore >= newIntentScore + 20)   return 'CONTINUE'
  return 'AMBIGUOUS'
}

/** Fire-and-forget insert into wa_routing_log. Never throws. */
export function logRoute(
  supabase: any,
  params: {
    wa_message_id: string | null
    phone_number: string
    had_session: boolean
    session_state: string | null
    session_score: number
    new_intent_score: number
    classified_intent: string
    selected_handler: string
    outcome?: string
  },
): void {
  supabase
    .from('wa_routing_log')
    .insert(params)
    .then(({ error }: { error: any }) => {
      if (error) console.error('[router] log error:', error)
    })
}
