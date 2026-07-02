// STEP 3 — JOURNEY TESTS for the ATTACH axis (the seam this whole sequence's bug taught us to cover).
// Table-driven: given a project's OPEN candidate set (pre-state) and a decomposed photo ITEM, assert
// which TERMINAL it reaches — attach an existing item / open the typed pick / create fresh (observe).
// Plus the resume grammar (numeric tap, "None — it's new", typed full-set fallback). All PURE, no DB.

import { suite, test, expect } from './harness'
import { decideAttach, planPhotoItems, resolveTypedPick, type PickCandidate } from '../_siteops_attach.ts'
import type { Candidate } from '../_siteops_candidates.ts'
import type { SiteItem } from '../_siteops_extract.ts'

let seq = 0
function cand(p: Partial<Candidate>): Candidate {
  seq++
  return {
    kind: p.kind ?? 'issue', id: p.id ?? `x${seq}`, node_key: p.node_key ?? null,
    label: p.label ?? `label ${seq}`, floor: p.floor ?? null, unit: p.unit ?? null,
    tradeText: p.tradeText ?? '', chased: p.chased ?? false,
  }
}
function item(p: Partial<SiteItem>): SiteItem {
  return {
    type: p.type ?? 'issue', text: p.text ?? '', task_hint: p.task_hint ?? null,
    qc_statements: [], cause: p.type === 'issue' ? (p.cause ?? 'other') : null, cause_reason: null,
    owner_hint: null, date_hint: null, project_hint: null,
  }
}

suite('siteops attach — decideAttach terminal', () => {
  test('exactly one open item shares the trade → ATTACH (single unambiguous match)', () => {
    const cands = [
      cand({ id: 'crack', label: 'honeycombing on 2F column', tradeText: 'honeycombing column concrete' }),
      cand({ id: 'cement', label: 'cement short', tradeText: 'cement material' }),
    ]
    const d = decideAttach(cands, item({ text: 'honeycombing visible on the column face', task_hint: 'column' }))
    expect(d.kind).toBe('attach')
    expect(d.kind === 'attach' ? d.target.id : '').toBe('crack')
  })

  test('two open items both plausibly match → ASK (the grounded typed shortlist)', () => {
    const cands = [
      cand({ id: 'a', label: 'brickwork crack 1F', tradeText: 'brick masonry wall' }),
      cand({ id: 'b', label: 'blockwork honeycomb 2F', tradeText: 'block masonry wall' }),
      cand({ id: 'c', label: 'cement short', tradeText: 'cement material' }),
    ]
    const d = decideAttach(cands, item({ text: 'masonry wall issue', task_hint: null }))
    expect(d.kind).toBe('ask')
    expect(d.kind === 'ask' ? d.shortlist.map((c) => c.id).sort().join(',') : '').toBe('a,b')
  })

  test('nothing plausible → OBSERVE (the Fix-X residual: project has open items, photo is NEW)', () => {
    const cands = [
      cand({ id: 'cement', label: 'cement short', tradeText: 'cement material' }),
      cand({ id: 'inspector', kind: 'todo', label: 'call the inspector', tradeText: '' }),
    ]
    const d = decideAttach(cands, item({ text: 'water leak from the terrace waterproofing', task_hint: 'terrace' }))
    expect(d.kind).toBe('observe')
  })

  test('empty project set → OBSERVE', () => {
    expect(decideAttach([], item({ text: 'anything' })).kind).toBe('observe')
  })

  test('floor alone never makes a match plausible (too weak)', () => {
    const cands = [cand({ id: 'f', label: 'plastering', floor: 'Second', tradeText: 'plastering' })]
    // shares the floor but NOT the trade/subject → not plausible → observe
    const d = decideAttach(cands, item({ text: 'electrical conduit pulled', task_hint: 'second floor' }))
    expect(d.kind).toBe('observe')
  })
})

suite('siteops attach — planPhotoItems (whole-photo journey)', () => {
  test('mixed photo: one issue attaches, one issue observes, progress routes untouched', () => {
    const cands = [cand({ id: 'leak', label: 'roof leak', tradeText: 'waterproof roof leak' })]
    const items = [
      item({ type: 'issue', text: 'the roof leak is worse now', task_hint: null }),   // → attach 'leak'
      item({ type: 'issue', text: 'crane needs servicing', task_hint: null }),          // → observe
      item({ type: 'progress', text: '2F slab poured', task_hint: 'second floor slab' }),// → rest (task axis)
    ]
    const plan = planPhotoItems(cands, items)
    expect(plan.attaches.map((a) => a.target.id)).toEqual(['leak'])
    expect(plan.rest.length).toBe(2)                       // the observe issue + the progress item
    expect(plan.rest.some((i) => i.type === 'progress')).toBe(true)
    expect(plan.asks.length).toBe(0)
  })

  test('only ONE typed pick opens; a second ambiguous item falls to OBSERVE (no stacked picks)', () => {
    const cands = [
      cand({ id: 'a', label: 'masonry crack A', tradeText: 'brick masonry' }),
      cand({ id: 'b', label: 'masonry crack B', tradeText: 'block masonry' }),
    ]
    const items = [
      item({ type: 'issue', text: 'masonry problem one' }),
      item({ type: 'issue', text: 'masonry problem two' }),
    ]
    const plan = planPhotoItems(cands, items)
    expect(plan.asks.length).toBe(1)
    expect(plan.rest.length).toBe(1)                       // the extra ambiguous item observes
  })
})

suite('siteops attach — resolveTypedPick (resume grammar)', () => {
  const shortlist: PickCandidate[] = [{ kind: 'issue', id: 'a', label: 'roof leak' }, { kind: 'todo', id: 'b', label: 'order tiles' }]
  const full: PickCandidate[] = [...shortlist, { kind: 'issue', id: 'z', label: 'plinth beam crack' }]

  test('numeric tap → attach that shortlist item', () => {
    const r = resolveTypedPick(shortlist, full, '1')
    expect(r.kind === 'attach' ? r.target.id : '').toBe('a')
  })

  test('the trailing "None — it\'s new" row (n+1) → observe', () => {
    expect(resolveTypedPick(shortlist, full, '3').kind).toBe('observe')
  })

  test('typed word "new" → observe', () => {
    expect(resolveTypedPick(shortlist, full, "it's new").kind).toBe('observe')
  })

  test('TYPED-ANSWER FULL-SET FALLBACK: a label off the shortlist still matches the full set', () => {
    const r = resolveTypedPick(shortlist, full, 'plinth beam')
    expect(r.kind === 'attach' ? r.target.id : '').toBe('z')       // 'z' was NOT in the shortlist
  })

  test('unrecognised reply → none (re-ask, never mis-place)', () => {
    expect(resolveTypedPick(shortlist, full, 'huh?').kind).toBe('none')
  })
})
