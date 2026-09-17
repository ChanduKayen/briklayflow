/**
 * Demo-record payload codec for the no-auth /demo page.
 *
 * A prospect on the landing taps "see it work on my site", messages the Briklay
 * WhatsApp bot, and the webhook echoes their entry back as a filed record + a
 * login-free link: /demo?d=<payload>. The payload carries ONLY the words they
 * typed — never a secret, id, or anything from a real org. The page reads it,
 * renders a demo dashboard, and writes nothing.
 *
 * SECURITY: the payload is attacker-supplied (it rides in a URL). `decodeDemo`
 * is defensive — it validates the shape and clamps every string/number — and the
 * page renders through JSX (auto-escaped), never dangerouslySetInnerHTML. Treat
 * anything that comes back from here as untrusted display data.
 *
 * The webhook (Deno) re-implements this same base64url(JSON) scheme; keep the two
 * in sync (see docs/wa-demo-concierge-spec.md).
 */

export type DemoEntry =
  | { kind: 'payment'; amount?: number; payee?: string; category?: string; site?: string; note?: string }
  | { kind: 'attendance'; site?: string; note?: string; rows?: { crew: string; present: number; amt?: number }[] }
  | { kind: 'issue'; site?: string; note?: string; title?: string };

export type DemoPayload = { v: 1; name?: string; entry: DemoEntry; ts?: number };

const MAX_STR = 80;
const MAX_ROWS = 8;

const str = (v: unknown, max = MAX_STR): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e12 ? v : undefined;

function sanitize(raw: unknown): DemoPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  const e = r.entry as Record<string, unknown> | undefined;
  if (!e || typeof e !== 'object') return null;

  let entry: DemoEntry;
  if (e.kind === 'payment') {
    entry = { kind: 'payment', amount: num(e.amount), payee: str(e.payee), category: str(e.category), site: str(e.site), note: str(e.note, 140) };
  } else if (e.kind === 'attendance') {
    const rows = Array.isArray(e.rows)
      ? (e.rows as unknown[]).slice(0, MAX_ROWS).map((row) => {
          const rr = row as Record<string, unknown>;
          return { crew: str(rr.crew) ?? '', present: num(rr.present) ?? 0, amt: num(rr.amt) };
        }).filter((row) => row.crew)
      : undefined;
    entry = { kind: 'attendance', site: str(e.site), note: str(e.note, 140), rows };
  } else if (e.kind === 'issue') {
    entry = { kind: 'issue', title: str(e.title, 140), site: str(e.site), note: str(e.note, 140) };
  } else {
    return null;
  }

  return { v: 1, name: str(r.name, 40), entry, ts: num(r.ts) };
}

// UTF-8 safe base64url (Telugu names survive the round trip).
function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function encodeDemo(p: DemoPayload): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(p)));
}

export function decodeDemo(s: string | null | undefined): DemoPayload | null {
  if (!s) return null;
  try {
    return sanitize(JSON.parse(new TextDecoder().decode(fromBase64Url(s))));
  } catch {
    return null;
  }
}

// A built-in sample so /demo (with no payload) still shows the experience.
export const SAMPLE_DEMO: DemoPayload = {
  v: 1,
  entry: { kind: 'payment', amount: 24000, payee: 'Raju', category: 'Steel', site: 'ASM Elite' },
};
