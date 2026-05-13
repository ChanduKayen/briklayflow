// WhatsApp session management (10-minute TTL, one row per phone number)

export type WaSessionState =
  | 'IDLE'
  | 'AWAIT_PAYEE'
  | 'AWAIT_AMOUNT'
  | 'AWAIT_PAYEE_CHOICE'
  | 'AWAIT_PROJECT'
  | 'AWAIT_IMAGE_CONTEXT'

export interface WaSession {
  id: string
  phone_number: string
  state: WaSessionState
  context: Record<string, any>
  rough_entry_id: string | null
  expires_at: string
}

/** Return the active (non-expired) session for a phone, or null. */
export async function getSession(
  supabase: any,
  phone: string,
): Promise<WaSession | null> {
  const { data } = await supabase
    .from('wa_sessions')
    .select('*')
    .eq('phone_number', phone)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  return data ?? null
}

/** Upsert a session with a 10-minute TTL. */
export async function saveSession(
  supabase: any,
  phone: string,
  state: WaSession['state'],
  context: Record<string, any>,
): Promise<void> {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  const { error } = await supabase.from('wa_sessions').upsert(
    {
      phone_number: phone,
      state,
      context,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'phone_number' },
  )
  if (error) console.error('[session] save error:', error)
}

/** Delete the session row for a phone number. */
export async function clearSession(supabase: any, phone: string): Promise<void> {
  const { error } = await supabase
    .from('wa_sessions')
    .delete()
    .eq('phone_number', phone)
  if (error) console.error('[session] clear error:', error)
}
