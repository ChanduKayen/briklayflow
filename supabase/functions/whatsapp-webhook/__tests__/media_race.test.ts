// The media-race guard — a trailing TEXT yields to an in-flight PHOTO from the same sender, so a bill the
// photo stages exists before the text is routed (else a site-ish caption overtakes the photo and leaks to
// SiteOps). The which-job-to-wait-on decision is pure and pinned here.
import { suite, test, expect } from './harness'
import { pickPhotoToAwait, looksLikeBillCaption, type JobRow } from '../_media_race.ts'

const NOW = 1_000_000
const iso = (ms: number) => new Date(ms).toISOString()

suite('media race — pickPhotoToAwait', () => {
  test('an in-flight image job within the window → wait on it (ignore self text row)', () => {
    const rows: JobRow[] = [
      { wamid: 'self', message_type: 'text', status: 'PROCESSING', received_at: iso(NOW) },
      { wamid: 'photo', message_type: 'image', status: 'PROCESSING', received_at: iso(NOW - 2000) },
    ]
    expect(pickPhotoToAwait(rows, 'self', NOW)).toBe('photo')
  })
  test('a photo already terminal → do not wait', () => {
    const rows: JobRow[] = [{ wamid: 'photo', message_type: 'image', status: 'WRITTEN', received_at: iso(NOW - 1000) }]
    expect(pickPhotoToAwait(rows, 'self', NOW)).toBe(null)
  })
  test('an old photo outside the window → do not wait', () => {
    const rows: JobRow[] = [{ wamid: 'photo', message_type: 'image', status: 'PROCESSING', received_at: iso(NOW - 60_000) }]
    expect(pickPhotoToAwait(rows, 'self', NOW)).toBe(null)
  })
  test('never wait on itself, even if it is somehow an image row', () => {
    const rows: JobRow[] = [{ wamid: 'self', message_type: 'image', status: 'PROCESSING', received_at: iso(NOW) }]
    expect(pickPhotoToAwait(rows, 'self', NOW)).toBe(null)
  })
  test('no image jobs → null', () => {
    const rows: JobRow[] = [{ wamid: 'x', message_type: 'text', status: 'PROCESSING', received_at: iso(NOW) }]
    expect(pickPhotoToAwait(rows, 'self', NOW)).toBe(null)
  })
  test('most recent in-flight photo is chosen', () => {
    const rows: JobRow[] = [
      { wamid: 'old', message_type: 'image', status: 'PROCESSING', received_at: iso(NOW - 8000) },
      { wamid: 'new', message_type: 'image', status: 'PROCESSING', received_at: iso(NOW - 1000) },
    ]
    expect(pickPhotoToAwait(rows, 'self', NOW)).toBe('new')
  })
})

suite('media race — looksLikeBillCaption (hold a bare caption for the photo)', () => {
  test('"Asm site bill" is a caption', () => { expect(looksLikeBillCaption('Asm site bill')).toBe(true) })
  test('bare "bill"', () => { expect(looksLikeBillCaption('bill')).toBe(true) })
  test('"here is the invoice"', () => { expect(looksLikeBillCaption('here is the invoice')).toBe(true) })
  test('"receipt" ', () => { expect(looksLikeBillCaption('receipt')).toBe(true) })
  test('a real payment is NOT a caption (has an amount)', () => { expect(looksLikeBillCaption('paid ramu 5000')).toBe(false) })
  test('a bill line WITH an amount is not a bare caption', () => { expect(looksLikeBillCaption('electricity bill 19627')).toBe(false) })
  test('site talk with no doc word is not a caption', () => { expect(looksLikeBillCaption('cement short on 2nd floor')).toBe(false) })
  test('a long sentence is not a caption', () => { expect(looksLikeBillCaption('please find the bill for the eastern power site attached here')).toBe(false) })
  test('empty', () => { expect(looksLikeBillCaption('')).toBe(false) })
})
