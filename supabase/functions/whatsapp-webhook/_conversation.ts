// WhatsApp Sprint 3 -- conversation state over wa_conversations.
// This is the ROUTER's single source of truth (NOT the legacy wa_sessions).
// One OPEN conversation per sender at a time.

export type ConvoRow = {
  id: string
  org_id: string
  sender_number: string
  owning_agent: string | null
  status: 'OPEN' | 'CLOSED' | 'ABANDONED'
  pending_question: string | null
  slots_so_far: Record<string, unknown>
  staged_entry_id: string | null
  last_action_summary: string | null
  opened_at: string
  closed_at: string | null
  purge_at: string | null
  last_message_id: string | null
}

export type RouterView = {
  open: ConvoRow | null
  lingering: ConvoRow | null   // most-recent CLOSED still within the purge window
  state: 'OPEN' | 'LINGERING' | 'FRESH'
}

const LINGER_MS = 2 * 60 * 1000  // ~2 min lingering window (matches purge)

/** Three-tier read: OPEN -> lingering CLOSED -> fresh. */
export async function getRouterView(supabase: any, orgId: string, sender: string): Promise<RouterView> {
  const { data: openRow } = await supabase
    .from('wa_conversations')
    .select('*')
    .eq('org_id', orgId).eq('sender_number', sender).eq('status', 'OPEN')
    .order('opened_at', { ascending: false })
    .limit(1).maybeSingle()
  if (openRow) return { open: openRow, lingering: null, state: 'OPEN' }

  const { data: lingerRow } = await supabase
    .from('wa_conversations')
    .select('*')
    .eq('org_id', orgId).eq('sender_number', sender).eq('status', 'CLOSED')
    .gt('purge_at', new Date().toISOString())
    .order('closed_at', { ascending: false })
    .limit(1).maybeSingle()
  if (lingerRow) return { open: null, lingering: lingerRow, state: 'LINGERING' }

  return { open: null, lingering: null, state: 'FRESH' }
}

/** Open (or update the single OPEN) conversation for this sender. Returns the convo id (Step 4a/5b:
 *  a pick send captures it so its outbound wamid can later be mapped back to this conversation). */
export async function openConversation(
  supabase: any,
  c: {
    orgId: string; sender: string; owningAgent: string
    pendingQuestion: string; slots?: Record<string, unknown>
    stagedEntryId?: string | null; lastMessageId?: string | null
  },
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('wa_conversations')
    .select('id')
    .eq('org_id', c.orgId).eq('sender_number', c.sender).eq('status', 'OPEN')
    .limit(1).maybeSingle()

  // WHEN THIS QUESTION WAS FIRST ASKED — stamped ONCE, into the slots, and carried by every re-open.
  // `opened_at` cannot serve: a re-surface (and a drain) re-opens the row and would renew the lease, so an
  // interrupted question could be kept alive forever and never age out. If the caller's slots already carry
  // the stamp (a re-surface replays them verbatim), it stands; only a genuinely NEW question starts a clock.
  const slots = { ...(c.slots ?? {}) } as Record<string, unknown>
  if (typeof slots.first_asked_at !== 'string') slots.first_asked_at = new Date().toISOString()

  const patch = {
    org_id: c.orgId, sender_number: c.sender, owning_agent: c.owningAgent,
    status: 'OPEN', pending_question: c.pendingQuestion,
    slots_so_far: slots, staged_entry_id: c.stagedEntryId ?? null,
    last_message_id: c.lastMessageId ?? null,
  }
  if (existing) {
    const { error } = await supabase.from('wa_conversations').update(patch).eq('id', existing.id)
    if (error) console.error('[convo] openConversation error:', error)
    return existing.id
  }
  const { data, error } = await supabase.from('wa_conversations')
    .insert({ ...patch, opened_at: new Date().toISOString() }).select('id').single()
  if (error) { console.error('[convo] openConversation error:', error); return null }
  return data?.id ?? null
}

/** Close the conversation (lingering, with purge_at) -- transaction staged/done. */
export async function closeConversation(
  supabase: any,
  c: { orgId: string; sender: string; lastActionSummary: string; stagedEntryId?: string | null; lastMessageId?: string | null },
): Promise<void> {
  const now = new Date()
  const closed = {
    status: 'CLOSED', closed_at: now.toISOString(),
    purge_at: new Date(now.getTime() + LINGER_MS).toISOString(),
    last_action_summary: c.lastActionSummary,
    ...(c.stagedEntryId ? { staged_entry_id: c.stagedEntryId } : {}),
    ...(c.lastMessageId ? { last_message_id: c.lastMessageId } : {}),
  }
  const { data: existing } = await supabase
    .from('wa_conversations')
    .select('id')
    .eq('org_id', c.orgId).eq('sender_number', c.sender).eq('status', 'OPEN')
    .limit(1).maybeSingle()

  const { error } = existing
    ? await supabase.from('wa_conversations').update(closed).eq('id', existing.id)
    : await supabase.from('wa_conversations').insert({
        org_id: c.orgId, sender_number: c.sender, owning_agent: 'TRANSACTION',
        opened_at: now.toISOString(), ...closed,
      })
  if (error) console.error('[convo] closeConversation error:', error)
}

/** Park the OPEN conversation as ABANDONED on interruption (keep slots). */
export async function abandonConversation(supabase: any, orgId: string, sender: string): Promise<void> {
  const { error } = await supabase
    .from('wa_conversations')
    .update({ status: 'ABANDONED', closed_at: new Date().toISOString() })
    .eq('org_id', orgId).eq('sender_number', sender).eq('status', 'OPEN')
  if (error) console.error('[convo] abandonConversation error:', error)
}

/** Append a row to the router decision log (every router call, in production). */
export async function logRouterDecision(
  supabase: any,
  row: {
    orgId: string; sender: string; wamid: string; inputText: string
    decision: string; intentAgent: string | null; confidence: number
    chosenAgent: string; convoState: string
  },
): Promise<void> {
  // slot_hints is intentionally not written: the router no longer extracts domain slots
  // (the agent owns understanding). The nullable column stays for historical rows.
  const { error } = await supabase.from('wa_router_decisions').insert({
    org_id: row.orgId, sender: row.sender, wamid: row.wamid, input_text: row.inputText,
    decision: row.decision, intent_agent: row.intentAgent, confidence: row.confidence,
    chosen_agent: row.chosenAgent, convo_state: row.convoState,
  })
  if (error) console.error('[convo] logRouterDecision error:', error)
}
