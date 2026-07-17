// THE DEEP LINK THAT DIED AT THE LOGIN SCREEN.
//
// Every WhatsApp money answer carries a "View ledger" button:
//
//     /ledger?stakeholder=STK-3819&project=The%20Pride
//
// WhatsApp opens it in its OWN in-app browser — a separate cookie jar from Chrome — so the tap usually
// arrives with no session. App.tsx's guard then did:
//
//     return <Navigate to={LOGIN_ROUTE} replace />;      // pathname gone. query gone.
//
// He signs in and lands on the default route: the COMPLETE ledger. Not his party, not his site. And the
// message he tapped from quoted ONE site's number — so the page and the message disagree, and he has no
// way to know which is the answer to his question. That contradiction is the exact thing partyLedgerLink's
// `&project=` was written to prevent; it was being built correctly and thrown away one redirect later.
//
// THE RECEIVING HALF ALREADY EXISTED. AuthPanel has read `?redirect=` and navigated to it since it was
// written. Nothing ever sent it. A whole feature, half-wired, silently — no error, no warning, just a man
// looking at the wrong ledger.

import { suite, test, expect } from './harness'
import { LOGIN_ROUTE, loginRouteFor, safeRedirect } from '../routes'

suite('loginRouteFor — the guard remembers where he was going', () => {
  // THE BUG, in one assertion.
  test('a ledger deep link survives the bounce to login', () => {
    const to = loginRouteFor('/ledger', '?stakeholder=STK-3819&project=The%20Pride')
    expect(to.startsWith(LOGIN_ROUTE + '?redirect=')).toBe(true)
    expect(safeRedirect(new URLSearchParams(to.split('?').slice(1).join('?')).get('redirect')))
      .toBe('/ledger?stakeholder=STK-3819&project=The%20Pride')
  })

  // The load-bearing half. WHICH party and WHICH site live entirely in the query string — carry only the
  // pathname and the button still lands on the complete ledger, which is the bug wearing a fix.
  test('the QUERY rides, not just the path', () => {
    expect(loginRouteFor('/ledger', '?project=The%20Pride').includes('project')).toBe(true)
  })

  test('the redirect is encoded, so & and = inside it survive the outer query', () => {
    const to = loginRouteFor('/ledger', '?stakeholder=A&project=B')
    // One '?' and one '&' at the OUTER level, or the inner query is read as more login params.
    expect(to.split('?').length).toBe(2)
    expect(to.includes('&project=B')).toBe(false)   // must be encoded, not naked
  })

  test('a path with no query is fine', () => {
    expect(loginRouteFor('/ledger')).toBe('/login?redirect=%2Fledger')
  })
})

// ── The value comes off a URL, so it is attacker-supplied ───────────────────────────────────────────────
// `…/login?redirect=//evil.example` costs nothing to send. Unvalidated, our own login screen becomes a
// redirector wearing our domain — a phishing primitive we handed out for free.
suite('safeRedirect — only a same-site path', () => {
  test('a plain path passes', () => {
    expect(safeRedirect('/ledger?stakeholder=A')).toBe('/ledger?stakeholder=A')
    expect(safeRedirect('/')).toBe('/')
  })

  test('protocol-relative is refused — the one that looks like a path', () => {
    expect(safeRedirect('//evil.example')).toBe(null)
    expect(safeRedirect('//evil.example/ledger')).toBe(null)
  })

  test('absolute urls are refused', () => {
    expect(safeRedirect('https://evil.example')).toBe(null)
    expect(safeRedirect('http://evil.example')).toBe(null)
    expect(safeRedirect('javascript:alert(1)')).toBe(null)
  })

  test('nothing is refused', () => {
    expect(safeRedirect(null)).toBe(null)
    expect(safeRedirect(undefined)).toBe(null)
    expect(safeRedirect('')).toBe(null)
  })

  // A bare word would navigate relative to the current route — not dangerous, but not what anyone meant.
  test('a relative path with no leading slash is refused', () => {
    expect(safeRedirect('ledger')).toBe(null)
  })
})
