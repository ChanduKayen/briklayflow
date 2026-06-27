// Block B1 — the follow-up TRAIL client. One small surface over the
// `followup_events` table (the per-issue / per-todo chronological story): a
// read hook for an item's trail, a writer that appends an event, and the
// mapping from the legacy ThreadEntry['type'] vocabulary onto the trail's.
//
// The trail is the spine every later piece writes to — chases (B2), replies and
// escalations (B3), and human comments/blockers typed into the expanded item.
// Reads are lazy (only an expanded row fetches its trail) and keyed per item.

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabase'

export type FollowupKind = 'issue' | 'todo'

// The trail's event vocabulary (mirrors the table CHECK in 20260627000000).
export type FollowupEventType =
  | 'chase_sent'
  | 'reply_received'
  | 'status_changed'
  | 'escalated'
  | 'blocker_noted'
  | 'comment'

export interface FollowupEvent {
  id: string
  problem_id: string | null
  todo_id: string | null
  type: FollowupEventType
  body: string | null
  actor_kind: 'system' | 'user'
  actor_id: string | null
  created_at: string
}

const COLS = 'id, problem_id, todo_id, type, body, actor_kind, actor_id, created_at'
const parentCol = (kind: FollowupKind) => (kind === 'issue' ? 'problem_id' : 'todo_id')

export const trailKey = (kind: FollowupKind, id: string) => ['followup_events', kind, id] as const

/** An item's full trail, chronological (oldest first). Only fetches when `enabled`. */
export function useItemTrail(kind: FollowupKind, id: string, enabled: boolean) {
  return useQuery({
    queryKey: trailKey(kind, id),
    queryFn: async (): Promise<FollowupEvent[]> => {
      const { data, error } = await supabase
        .from('followup_events')
        .select(COLS)
        .eq(parentCol(kind), id)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as FollowupEvent[]
    },
    enabled: enabled && !!id,
  })
}

// Per-item follow-up state, reduced from the trail — for the glanceable row indicator.
// (Resolution is read from the item's own status, not derived from event text.)
export interface FollowState {
  lastChaseAt: string | null
  lastReplyAt: string | null   // a reply OR a noted blocker (both = the owner answered)
  escalated: boolean
  last: { type: FollowupEventType; body: string | null; at: string; actorId: string | null } | null   // latest log line, for the collapsed card
}

/**
 * Batch-load the trail for MANY items at once (one query per kind) and reduce to a
 * per-id FollowState for the row indicator. Refetches on an interval so "awaiting"
 * ages and a server-side chase/escalation surfaces without a manual reload.
 */
export function useTrailStates(scopeKey: string, issueIds: string[], todoIds: string[]) {
  return useQuery({
    queryKey: ['followup_states', scopeKey, issueIds.length, todoIds.length],
    queryFn: async (): Promise<Record<string, FollowState>> => {
      const map: Record<string, FollowState> = {}
      const ensure = (id: string) => (map[id] ??= { lastChaseAt: null, lastReplyAt: null, escalated: false, last: null })
      type EvtRow = { type: FollowupEventType; body: string | null; created_at: string; actor_id: string | null }
      const fold = (fs: FollowState, e: EvtRow) => {
        if (e.type === 'chase_sent') { if (!fs.lastChaseAt || e.created_at > fs.lastChaseAt) fs.lastChaseAt = e.created_at }
        else if (e.type === 'reply_received' || e.type === 'blocker_noted') { if (!fs.lastReplyAt || e.created_at > fs.lastReplyAt) fs.lastReplyAt = e.created_at }
        if (e.type === 'escalated') fs.escalated = true
        if (!fs.last || e.created_at > fs.last.at) fs.last = { type: e.type, body: e.body, at: e.created_at, actorId: e.actor_id }
      }
      const COLS = 'type, body, created_at, actor_id'
      if (issueIds.length) {
        const { data } = await supabase.from('followup_events').select(`problem_id, ${COLS}`).in('problem_id', issueIds)
        for (const e of data ?? []) fold(ensure(e.problem_id), e as EvtRow)
      }
      if (todoIds.length) {
        const { data } = await supabase.from('followup_events').select(`todo_id, ${COLS}`).in('todo_id', todoIds)
        for (const e of data ?? []) fold(ensure(e.todo_id), e as EvtRow)
      }
      return map
    },
    enabled: issueIds.length + todoIds.length > 0,
    refetchInterval: 30000,
  })
}

/** Append one event to an item's trail. actorId present → a human event. */
export async function appendEvent(args: {
  kind: FollowupKind
  id: string
  orgId: string
  type: FollowupEventType
  body: string | null
  actorId: string | null
}): Promise<{ error: unknown }> {
  const row = {
    org_id: args.orgId,
    problem_id: args.kind === 'issue' ? args.id : null,
    todo_id: args.kind === 'todo' ? args.id : null,
    type: args.type,
    body: args.body,
    actor_kind: args.actorId ? 'user' : 'system',
    actor_id: args.actorId ?? null,
  }
  const { error } = await supabase.from('followup_events').insert(row)
  if (error) console.error('[followup] appendEvent error:', error)
  return { error }
}

export interface AssignmentNotifyResult { notified: boolean; channel?: string; reason?: string }

/** Notify a new owner of a manual hand-off (fires the siteops-notify-assignment
 *  edge function). Returns the outcome so the UI can confirm it (or surface why not);
 *  null = the notifier couldn't be reached (e.g. not deployed). */
export async function notifyAssignment(kind: FollowupKind, id: string, toUserId: string): Promise<AssignmentNotifyResult | null> {
  const { data, error } = await supabase.functions.invoke('siteops-notify-assignment', { body: { kind, id, to_user_id: toUserId } })
  if (error) { console.error('[followup] notifyAssignment failed:', error); return null }
  return (data ?? null) as AssignmentNotifyResult | null
}

// The legacy in-row thread vocabulary (chase/reply/escalation/system) that the
// existing inline controls speak, mapped onto the trail's types. Anything not a
// chase/reply/escalation is a status_changed (cause, assignee, re-timing, …).
export type LegacyThreadType = 'system' | 'chase' | 'reply' | 'escalation' | undefined
export function legacyToFollowupType(t: LegacyThreadType): FollowupEventType {
  switch (t) {
    case 'chase':      return 'chase_sent'
    case 'reply':      return 'reply_received'
    case 'escalation': return 'escalated'
    default:           return 'status_changed'
  }
}
