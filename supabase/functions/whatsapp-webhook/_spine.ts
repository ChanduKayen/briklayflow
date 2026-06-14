// WhatsApp Sprint 1 spine: processing_job lifecycle, per-sender lock, and the
// transactional-outbox failure enqueue. Wraps the legacy processor (it does not
// replace it). All writes are service-role (RLS-bypassing) by design.

export type JobStatus =
  | 'RECEIVED' | 'PROCESSING' | 'WRITTEN' | 'FAILED' | 'CONFIRMED' | 'CONFIRM_PENDING'

/**
 * Create the processing_job for this wamid in PROCESSING. wamid is UNIQUE, so a
 * replay returns { duplicate: true } and the caller should stop (already handled).
 */
export async function createJob(
  supabase: any,
  job: { wamid: string; org_id: string; sender_number: string; message_type: string | null },
): Promise<{ jobId: string | null; duplicate: boolean }> {
  const { data, error } = await supabase
    .from('processing_job')
    .insert({
      wamid:         job.wamid,
      org_id:        job.org_id,
      sender_number: job.sender_number,
      message_type:  job.message_type,
      status:        'PROCESSING',
      processing_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { jobId: null, duplicate: true } // replay
    throw error
  }
  return { jobId: data.id as string, duplicate: false }
}

/** Mark a job terminal. */
export async function markJob(
  supabase: any,
  jobId: string,
  status: JobStatus,
  errorText?: string,
): Promise<void> {
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  if (status === 'WRITTEN' || status === 'FAILED' || status === 'CONFIRMED') {
    patch.terminal_at = new Date().toISOString()
  }
  if (errorText) patch.error = errorText
  const { error } = await supabase.from('processing_job').update(patch).eq('id', jobId)
  if (error) console.error('[spine] markJob error:', error)
}

/**
 * Enqueue a single user-facing failure message via the outbox. Idempotent: keyed
 * on the job so the watchdog (same dedup_key) never double-sends. Commit-coupled
 * to whatever transaction the caller is in (here: its own statement).
 */
export async function enqueueJobFailure(
  supabase: any,
  jobId: string,
  org_id: string,
  target: string,
  wamid: string,
): Promise<void> {
  const { error } = await supabase.from('outbox').upsert(
    {
      org_id,
      target,
      wamid,
      payload: { type: 'text', text: 'Sorry, we could not process your last message. Please try sending it again.' },
      dedup_key: `job-fail:${jobId}`,
    },
    { onConflict: 'dedup_key', ignoreDuplicates: true },
  )
  if (error) console.error('[spine] enqueueJobFailure error:', error)
}

/**
 * Per-sender lock with bounded wait. Polls wa_try_lock (atomic insert-or-reclaim).
 * Returns true if acquired. On timeout returns false; the caller proceeds anyway
 * (never wedge a sender) — the 60s lock TTL self-heals a crashed holder.
 */
export async function acquireSenderLock(
  supabase: any,
  sender: string,
  wamid: string,
  opts: { attempts?: number; delayMs?: number; ttlSeconds?: number } = {},
): Promise<boolean> {
  const attempts = opts.attempts ?? 10
  const delayMs  = opts.delayMs ?? 400
  const ttl      = opts.ttlSeconds ?? 60
  for (let i = 0; i < attempts; i++) {
    const { data, error } = await supabase.rpc('wa_try_lock', {
      p_sender: sender, p_wamid: wamid, p_ttl_seconds: ttl,
    })
    if (error) { console.error('[spine] wa_try_lock error:', error); return false }
    if (data === true) return true
    await new Promise((r) => setTimeout(r, delayMs))
  }
  console.warn(`[spine] lock wait timed out for ${sender}; proceeding without exclusive lock`)
  return false
}

export async function releaseSenderLock(supabase: any, sender: string, wamid: string): Promise<void> {
  const { error } = await supabase.rpc('wa_release_lock', { p_sender: sender, p_wamid: wamid })
  if (error) console.error('[spine] wa_release_lock error:', error)
}
