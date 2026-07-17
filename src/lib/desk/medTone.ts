// SITE DESK — the medallion's meaning. Pure, so it is testable and so the left column can never
// disagree with the status sentence beside it.
//
// ONE ALPHABET, spoken by the problems, the tasks and the floor timeline alike.

import type { ProblemState, TaskState } from './types'

export type MedTone = 'you' | 'chasing' | 'moving' | 'done' | 'idle' | 'blocked' | 'live' | 'ready'

/** Who has the ball on a problem. This is the axis the whole page sorts by. */
export const problemTone = (s: ProblemState): MedTone =>
  s === 'resolved' ? 'done'
    : s === 'you' ? 'you'
      : s === 'moving' ? 'moving'
        : 'chasing'

/**
 * The same question, asked of a task.
 *
 * BLOCKED OUTRANKS EVERYTHING SHORT OF DONE — a task that cannot move is the worse truth, and the
 * left column must not report it as merely "not started". (Done still wins: finished work is
 * finished, whatever is or was in its way.)
 */
export const taskTone = (state: TaskState, blocked: boolean): MedTone =>
  state === 'done' ? 'done'
    : blocked ? 'blocked'
      : state === 'active' ? 'chasing'
        : 'idle'
