// Multi-page photo batch — the PURE decision core of tryBatchAppend:
//   · foldItems   — folds a follow-up page into the open request, collapsing FULL-row duplicates so a
//                   re-processed page adds nothing the second time (idempotency without provenance).
//   · rawConflict — two RAW references clearly name different things → the page is its own request, not a page.
// The DB read/write around these lives in tryBatchAppend; here we pin the logic that decides WHAT gets merged.

import { suite, test, expect } from './harness'
import { foldItems, rawConflict } from '../_agents/procurement.ts'
import type { ProcItem } from '../_proc_extract.ts'

const it = (name: string, over: Partial<ProcItem> = {}): ProcItem => ({
  item_name: name, quantity: null, unit: null, width_mm: null, height_mm: null, spec: null, brand: null, note: null, ...over,
})

suite('procurement — multi-page photo batch fold', () => {
  test('page 2 appends to page 1 (one list across two photos)', () => {
    const page1 = [it('cement', { quantity: 200, unit: 'bags' }), it('sand', { quantity: 2, unit: 'brass' })]
    const page2 = [it('steel bars', { quantity: 3, unit: 'ton' }), it('bricks', { quantity: 5000 })]
    const { merged, added } = foldItems(page1, page2)
    expect(added).toBe(2)
    expect(merged.length).toBe(4)
    expect(merged.map((m) => m.item_name)).toEqual(['cement', 'sand', 'steel bars', 'bricks'])
  })

  test('a re-processed identical page adds NOTHING (idempotent)', () => {
    const page1 = [it('cement', { quantity: 200, unit: 'bags' }), it('sand', { quantity: 2, unit: 'brass' })]
    const { merged, added } = foldItems(page1, page1.map((x) => ({ ...x })))
    expect(added).toBe(0)
    expect(merged.length).toBe(2)
  })

  test('a partial overlap adds only the genuinely new rows', () => {
    const page1 = [it('cement', { quantity: 200, unit: 'bags' })]
    const page2 = [it('cement', { quantity: 200, unit: 'bags' }), it('tiles', { quantity: 40, unit: 'boxes' })]
    const { merged, added } = foldItems(page1, page2)
    expect(added).toBe(1)
    expect(merged.map((m) => m.item_name)).toEqual(['cement', 'tiles'])
  })

  test('same item, DIFFERENT quantity is a distinct row (never collapsed)', () => {
    const page1 = [it('cement', { quantity: 200, unit: 'bags' })]
    const page2 = [it('cement', { quantity: 50, unit: 'bags' })]
    const { merged, added } = foldItems(page1, page2)
    expect(added).toBe(1)
    expect(merged.length).toBe(2)
  })

  test('rawConflict — clearly different names conflict; blank / same / substring do not', () => {
    expect(rawConflict('Pattabhi Traders', 'Sri Balaji Steels')).toBe(true)   // different vendors → own request
    expect(rawConflict('ASM 103', 'ASM')).toBe(false)                          // substring → same site
    expect(rawConflict('pattabhi', 'Pattabhi Traders')).toBe(false)           // case + substring → same
    expect(rawConflict(null, 'ASM')).toBe(false)                               // page 2 named nothing → not a conflict
    expect(rawConflict('ASM', null)).toBe(false)
    expect(rawConflict('  ', 'ASM')).toBe(false)
  })
})
