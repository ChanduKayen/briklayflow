// SITE DESK — THE MEDALLION. The Ledger's idea, told in this page's own language.
//
// In the Ledger the medallion carries the one fact that governs the row — money in, or money out —
// restated at the opposite end from the amount. That redundancy is the point: you can scan the
// LEFT COLUMN ALONE and read the shape of the whole list without reading a word.
//
// Site Desk's governing fact is not a direction. It is WHO HAS THE BALL:
//
//   ◉  needs you      terracotta ring, filled centre   — it will not move without him
//   ◌  with Babai     breathing dot                    — being chased, on a clock
//   ◍  moving         soft ring, half-inked            — somebody accepted it and is acting
//   ✓  sorted         filled sage, a drawn check       — settled
//
// And the same vocabulary, unchanged, does the tasks: not started · blocked · in progress · done.
// It is deliberately the SAME dot language the floor timeline already speaks (hollow → inked ring →
// filled green ✓), so the product has one alphabet rather than three.
//
// KIND (issue vs snag) is NOT what this encodes. Kind is taxonomy — it lives in the subtext, where
// it belongs. A medallion that restated it would be a tidy column answering a question nobody asked.

import { Check } from './icons'
import type { MedTone } from '../../lib/desk/medTone'

const TITLES: Record<MedTone, string> = {
  you: 'Needs you',
  chasing: 'Babai is chasing it',
  moving: 'Someone is on it',
  done: 'Settled',
  idle: 'Not started',
  blocked: 'Blocked',
}

export function Medallion({ tone }: { tone: MedTone }) {
  return (
    <span className={`med med-${tone}`} title={TITLES[tone]} aria-label={TITLES[tone]}>
      {tone === 'done'
        ? <span className="med-check">{Check}</span>
        : tone === 'chasing'
          ? <span className="med-pulse" aria-hidden="true" />
          : <span className="med-core" aria-hidden="true" />}
    </span>
  )
}

