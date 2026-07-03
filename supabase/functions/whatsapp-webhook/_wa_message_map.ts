// STEP 4a — the OUTBOUND-WAMID CAPTURE SPINE (pure core). Sends go through the async outbox, so the
// wamid WhatsApp assigns our message only exists AFTER the drainer POSTs and reads the response — long
// after send() returned. This module holds the two pure decisions that turn that recovered wamid into a
// durable wamid→object MAP: parse the wamid from the send response, and build the map row from the ref
// send() carried on the outbox row. The map is what lets a later inbound whose reaction.message_id /
// quoted context.id points at one of OUR messages resolve back to the objects it was about — the
// foundation Step 4b (readback corrections) and Step 5 (reactions / late-answer / retraction) consume.
//
// PURE + unit-tested; the drainer does the DB writes, the webhook does the reads.

// What a producer asks send() to remember about a message, carried on outbox.capture_ref until the
// drainer learns the wamid. ref_kind names WHAT the message was; object_refs names WHAT it was about.
export type CaptureRefKind = 'readback' | 'pick'
export interface CaptureRef {
  ref_kind: CaptureRefKind
  convo_id?: string | null
  project_id?: string | null
  // `event` (optional) binds a ref to a SPECIFIC event — the v2 undo carries the resolve's followup_events
  // id here so a "Not resolved" tap reopens only that resolve (stale-safe). jsonb persists the extra field.
  object_refs?: { kind: string; id: string; event?: string }[] | null
}

export interface MapRow {
  outbound_wamid: string
  org_id: string
  ref_kind: string
  convo_id: string | null
  project_id: string | null
  object_refs: { kind: string; id: string; event?: string }[] | null
}

/**
 * Parse the sent-message wamid from a WhatsApp Cloud API /messages response body (raw text). Shape:
 * `{ "messages": [ { "id": "wamid.XXX" } ], ... }`. Returns null on any deviation (error body, empty,
 * malformed) — the caller then simply records no map (best-effort; a send is never failed over this).
 */
export function parseSentWamid(responseBody: string): string | null {
  try {
    const j = JSON.parse(responseBody) as { messages?: { id?: unknown }[] }
    const id = j?.messages?.[0]?.id
    return typeof id === 'string' && id.trim() ? id : null
  } catch {
    return null
  }
}

/**
 * Build the wa_message_map insert from the captured ref + the learned wamid. Returns null when there's
 * nothing worth mapping — no wamid, no org, no capture, or a capture that names no target (no convo and
 * no object_refs) — so the drainer never writes a dangling row that resolves to nothing.
 */
export function buildMapRow(orgId: string | null, capture: CaptureRef | null | undefined, wamid: string | null): MapRow | null {
  if (!orgId || !capture || !wamid) return null
  const refs = capture.object_refs && capture.object_refs.length ? capture.object_refs : null
  if (!capture.convo_id && !refs) return null   // nothing to resolve back to
  return {
    outbound_wamid: wamid,
    org_id: orgId,
    ref_kind: capture.ref_kind,
    convo_id: capture.convo_id ?? null,
    project_id: capture.project_id ?? null,
    object_refs: refs,
  }
}
