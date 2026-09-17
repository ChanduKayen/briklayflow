// THE DEMO CONCIERGE REFLECTS, IT DOES NOT INVENT.
//
// A landing prospect sends a line and Babai "files" it in a live sandbox. The danger is the same one
// concierge_invents_nothing guards: a number or status the user will believe. Here the record is composed
// by CODE from the user's own extracted words — never by the LLM — so these gates pin that the record
// carries ONLY what was typed, the sandbox never leaks a fabricated figure, and the /demo link round-trips.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { suite, test, expect } from './harness'
import { sanitizeEntry, buildRecord, buildNudgeBody, encodeDemo, type DemoEntry } from '../_agents/demo.ts'

// mirror of src/lib/demoRecord.ts decode (the /demo page reads exactly this)
function decode(s: string): any {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes))
}

suite('demo — sanitizeEntry keeps only real, non-empty entries', () => {
  test('a real payment survives with just its stated fields', () => {
    const e = sanitizeEntry({ kind: 'payment', amount: 24000, payee: 'Raju', category: 'Steel' }) as any
    expect(e?.kind).toBe('payment')
    expect(e.amount).toBe(24000)
    expect(e.payee).toBe('Raju')
  })

  test('an empty payment (no amount/payee/note) → null, never a blank record', () => {
    expect(sanitizeEntry({ kind: 'payment' })).toBe(null)
  })

  test('an unknown kind → null', () => {
    expect(sanitizeEntry({ kind: 'weather', amount: 5 })).toBe(null)
  })

  test('a garbage amount is dropped, not coerced', () => {
    const e = sanitizeEntry({ kind: 'payment', amount: 'lots', payee: 'Raju' }) as any
    expect(e?.kind).toBe('payment')
    expect(e.amount).toBe(undefined)
  })

  test('attendance drops crewless rows and keeps the real ones', () => {
    const e = sanitizeEntry({ kind: 'attendance', rows: [{ crew: 'Ravi gang', present: 14 }, { crew: '', present: 9 }] }) as any
    expect(e?.rows?.length).toBe(1)
    expect(e.rows[0].crew).toBe('Ravi gang')
  })

  test('an issue with only a note survives', () => {
    const e = sanitizeEntry({ kind: 'issue', note: 'honeycombs on 1st slab' }) as any
    expect(e?.kind).toBe('issue')
  })
})

suite('demo — buildRecord is grounded in the typed words', () => {
  test('a payment shows the exact amount, payee and "pending"', () => {
    const rec = buildRecord({ kind: 'payment', amount: 24000, payee: 'Raju', category: 'Steel' } as DemoEntry, 'en')
    expect(rec.includes('₹24,000')).toBe(true)
    expect(rec.includes('Raju')).toBe(true)
    expect(rec.includes('Steel')).toBe(true)
    expect(/pending/i.test(rec)).toBe(true)
  })

  test('THE SANDBOX FLOOR: no amount typed → no rupee figure invented', () => {
    const rec = buildRecord({ kind: 'payment', payee: 'Raju' } as DemoEntry, 'en')
    expect(rec.includes('₹')).toBe(false)
    expect(/\d/.test(rec)).toBe(false)
    expect(rec.includes('Raju')).toBe(true)
  })
})

suite('demo — the /demo link round-trips (and stays URL-safe)', () => {
  test('encodeDemo is base64url and decodes back to the entry', () => {
    const payload = { v: 1 as const, name: 'చందు', entry: { kind: 'payment', amount: 1850, payee: 'సురేష్' } as DemoEntry }
    const s = encodeDemo(payload)
    expect(/[+/=]/.test(s)).toBe(false)          // URL-safe: no +, /, or =
    const back = decode(s)
    expect(back.entry.amount).toBe(1850)
    expect(back.name).toBe('చందు')               // UTF-8 (Telugu) survives
    expect(back.entry.payee).toBe('సురేష్')
  })
})

suite('demo — the 23h nudge references the filed record, invents nothing', () => {
  test('a payment nudge names the exact amount + payee and invites setup', () => {
    const body = buildNudgeBody({ kind: 'payment', amount: 24000, payee: 'Raju', category: 'Steel' } as DemoEntry, 'en')
    expect(body.includes('₹24,000')).toBe(true)
    expect(body.includes('Raju')).toBe(true)
    expect(/free for 3 months/i.test(body)).toBe(true)
  })
  test('no amount typed → the nudge invents no figure', () => {
    const body = buildNudgeBody({ kind: 'issue', note: 'honeycombs' } as DemoEntry, 'en')
    expect(body.includes('₹')).toBe(false)
    expect(body.includes('honeycombs')).toBe(true)
  })
})

// ── the prompt floor, mirroring concierge_invents_nothing ──────────────────────────
const demoSrc = readFileSync(join(process.cwd(), 'supabase', 'functions', 'whatsapp-webhook', '_agents', 'demo.ts'), 'utf8')

suite('demo — SYSTEM_DEMO carries the honesty floor', () => {
  test('it forbids claiming a real account or stored data', () => {
    expect(/never claim they have an account/i.test(demoSrc)).toBe(true)
  })
  test('it forbids inventing an amount/number/status', () => {
    expect(/invent/i.test(demoSrc)).toBe(true)
    expect(/only the fields they actually stated/i.test(demoSrc)).toBe(true)
  })
  test('it hardens against injection (untrusted user message)', () => {
    expect(/UNTRUSTED DATA/i.test(demoSrc)).toBe(true)
  })
})
