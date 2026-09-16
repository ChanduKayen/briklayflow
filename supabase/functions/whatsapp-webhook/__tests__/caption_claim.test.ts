// The image CLAIMS a nearby text as its caption (within a 60s window), and the caption is not processed on
// its own. These pin the two DB reads that make that work: the payment pulls the recent text; a lone SiteOps
// miss is suppressed when a recent image owns the caption.
import { suite, test, expect } from './harness'
import { recentInboundText } from '../_agents/transaction.ts'
import { recentInboundImage } from '../_agents/siteops.ts'

// A tiny chainable fake — select/eq/gte/order all no-op; the awaited chain resolves to { data: rows }.
const fakeSb = (rows: unknown[]) => ({
  from() {
    const q: any = {
      select: () => q, eq: () => q, gte: () => q, order: () => q,
      limit: () => Promise.resolve({ data: rows }),
    }
    return q
  },
})

suite('caption claim — recentInboundText (the payment pulls the caption)', () => {
  test('returns the most recent inbound text', async () => {
    const rows = [
      { direction: 'IN', content: 'Chakradhar site', created_at: '2026-09-16T08:25:10Z', wa_message_id: 'w2' },
      { direction: 'IN', content: 'older', created_at: '2026-09-16T08:24:00Z', wa_message_id: 'w1' },
    ]
    expect(await recentInboundText(fakeSb(rows), '91999', null)).toBe('Chakradhar site')
  })
  test('skips our own OUT replies', async () => {
    const rows = [
      { direction: 'OUT', content: 'Got your photo', created_at: '2026-09-16T08:25:11Z', wa_message_id: 'o1' },
      { direction: 'IN', content: 'for electricity', created_at: '2026-09-16T08:25:05Z', wa_message_id: 'w1' },
    ]
    expect(await recentInboundText(fakeSb(rows), '91999', null)).toBe('for electricity')
  })
  test('excludes the given wamid (the image message itself)', async () => {
    const rows = [{ direction: 'IN', content: 'caption', created_at: 'x', wa_message_id: 'img' }]
    expect(await recentInboundText(fakeSb(rows), '91999', 'img')).toBe(null)
  })
  test('no inbound text → null', async () => {
    expect(await recentInboundText(fakeSb([]), '91999', null)).toBe(null)
  })
})

suite('caption claim — recentInboundImage (a lone miss is suppressed when an image owns the caption)', () => {
  test('a recent inbound image → true', async () => {
    const rows = [{ direction: 'IN', message_type: 'image', wa_message_id: 'img', created_at: 'x' }]
    expect(await recentInboundImage(fakeSb(rows), '91999', null)).toBe(true)
  })
  test('only text / only our OUT → false', async () => {
    expect(await recentInboundImage(fakeSb([{ direction: 'IN', message_type: 'text', wa_message_id: 't', created_at: 'x' }]), '91999', null)).toBe(false)
    expect(await recentInboundImage(fakeSb([{ direction: 'OUT', message_type: 'image', wa_message_id: 'o', created_at: 'x' }]), '91999', null)).toBe(false)
  })
  test('excludes the given wamid', async () => {
    expect(await recentInboundImage(fakeSb([{ direction: 'IN', message_type: 'image', wa_message_id: 'self', created_at: 'x' }]), '91999', 'self')).toBe(false)
  })
})
