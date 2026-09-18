/**
 * DemoRecord — the no-auth "/demo" page for landing prospects.
 *
 * The page itself is the "Briklay · Books" design, rendered VERBATIM inside a
 * full-viewport iframe (exactly like the login screen, src/pages/LoginRegister.tsx,
 * and the marketing landing) so its bespoke stylesheet, the card that travels into
 * the ledger, the slide-to-approve dock and the setup sheet all run as authored,
 * with zero global-CSS leakage. The HTML lives in src/pages/demoBooks.html.
 *
 * The builder's own WhatsApp entry comes in on the ?d= link (decodeDemo → clamped,
 * untrusted display data). We map it to the card's display shape and inject it as
 * `__BRIK_DEMO__`. There is ONE entry type per link — the link decides it.
 *
 * Sign-in is option (a): the setup sheet captures the site, the builder's name and
 * the WhatsApp number he messaged from; "Open my site" sends a one-time code to
 * that number, and the iframe postMessages a `brik-demo-req` up here, where we run
 * the REAL Supabase calls (send OTP, verify, create the account + workspace) and
 * open the Day Book. Nothing writes real data until the code is verified.
 */
import { useEffect, useMemo } from 'react';
import { decodeDemo, SAMPLE_DEMO, type DemoPayload } from '../lib/demoRecord';
import { supabase } from '../lib/supabase';
import demoBooksHtml from './demoBooks.html?raw';

const inr = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(n));

// Normalize to E.164 (mirrors LoginRegister/AuthPanel). India default: bare 10 digits → +91XXXXXXXXXX.
const toE164 = (raw: string): string => {
  const d = raw.replace(/\D/g, '');
  if (raw.trim().startsWith('+')) return '+' + d;
  if (d.length === 10) return '+91' + d;
  if (d.length === 12 && d.startsWith('91')) return '+' + d;
  return '+' + d;
};
const slugify = (n: string) => n.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 40);

type Req = { type?: string; id?: number; action?: string; payload?: { phone?: string; code?: string; site?: string; name?: string; supervisor?: string } };

// Map a WhatsApp entry to the "Briklay · Books" card's display fields (mirror of the
// artifact's TYPES shape). payment → ₹ hero; attendance → count + week grid; issue →
// title-led card with no number (`noNum`). A payment with no amount also goes noNum.
function buildDemo(payload: DemoPayload) {
  const e = payload.entry;
  const name = payload.name ?? '';
  const site = ('site' in e && e.site) ? e.site : '';
  const ts = payload.ts ?? null;
  const base = { site, name, ts };

  if (e.kind === 'payment') {
    const hasAmt = typeof e.amount === 'number';
    const words = [
      e.amount != null ? `Paid ₹${inr(e.amount)}` : (e.payee ? 'Paid' : ''),
      e.payee ? `to ${e.payee}` : '',
      e.category ? `for ${e.category}` : '',
    ].filter(Boolean).join(' ').trim() || e.note || '';
    return {
      ...base, key: 'payment',
      data: {
        chip: 'Payment', words, noNum: !hasAmt,
        pre: hasAmt ? '₹' : '', num: e.amount ?? 0, post: '', unit: '',
        lead: e.payee ? 'Paid to ' : '', a: e.payee ?? (e.note ?? 'Payment'), b: e.category ?? '',
        coach: 'Your message from {t}. Nothing is filed until you approve it.',
        wait: 'Waiting for your approval', slide: 'Slide to approve and file', done: 'Filed',
        home: 'Transactions',
      },
    };
  }

  if (e.kind === 'attendance') {
    const rows = e.rows ?? [];
    const total = rows.reduce((s, r) => s + (r.present || 0), 0);
    const parts = rows.map((r) => `${r.crew}${r.present ? ` ${r.present}` : ''}`);
    const words = parts.join(', ') || e.note || '';
    const a = parts[0] || 'On site';
    const b = parts.slice(1).join(', ') || (rows[0]?.present ? `${rows[0].present} present` : (e.note ?? ''));
    return {
      ...base, key: 'attendance',
      data: {
        chip: 'Attendance', words, noNum: total <= 0,
        pre: '', num: total, post: '', unit: 'on site today',
        lead: '', a, b,
        coach: 'Your message from {t}. Nothing goes on the register until you confirm it.',
        wait: 'Waiting for you to confirm', slide: 'Slide to confirm', done: 'Confirmed',
        home: 'Attendance',
      },
    };
  }

  // issue: a logged site problem — the title carries the card, no number.
  const title = e.title ?? e.note ?? 'Site issue';
  return {
    ...base, key: 'issue',
    data: {
      chip: 'Issue', words: e.note ?? e.title ?? '', noNum: true,
      pre: '', num: 0, post: '', unit: '',
      lead: '', a: title, b: '',
      coach: 'Your message from {t}. Nothing is filed until you approve it.',
      wait: 'Waiting for your approval', slide: 'Slide to log', done: 'Logged',
      home: 'Site issues',
    },
  };
}

// JSON safe to drop inside a <script>: escape sequences that could break out of it.
const safeJson = (o: unknown) =>
  JSON.stringify(o)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export default function DemoRecord() {
  const { payload, invalid } = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get('d');
    if (raw == null) return { payload: SAMPLE_DEMO, invalid: false };
    const p = decodeDemo(raw);
    return p ? { payload: p, invalid: false } : { payload: null as DemoPayload | null, invalid: true };
  }, []);

  const srcDoc = useMemo(
    () => (payload ? demoBooksHtml.replace('__BRIK_DEMO__', () => safeJson(buildDemo(payload))) : ''),
    [payload],
  );

  useEffect(() => {
    const prev = document.title;
    document.title = 'Your Briklay entry';
    return () => { document.title = prev; };
  }, []);

  useEffect(() => {
    if (!payload) return;
    const onMsg = async (e: MessageEvent) => {
      const d = e.data as Req | null;
      if (!d || d.type !== 'brik-demo-req') return;
      const source = e.source as Window | null;
      const reply = (r: { ok: boolean; error?: string }) => source?.postMessage({ type: 'brik-demo-res', id: d.id, ...r }, '*');
      const p = d.payload ?? {};
      try {
        if (d.action === 'send-otp') {
          const { error } = await supabase.auth.signInWithOtp({ phone: toE164(p.phone ?? ''), options: { shouldCreateUser: true } });
          reply({ ok: !error, error: error?.message });
          return;
        }
        if (d.action === 'verify') {
          const { data, error } = await supabase.auth.verifyOtp({ phone: toE164(p.phone ?? ''), token: p.code ?? '', type: 'sms' });
          if (error) { reply({ ok: false, error: 'That code didn’t work. Try again.' }); return; }
          // Carry the name + site into the real account, then create the workspace — no separate sign-up.
          const site = (p.site ?? '').trim(), name = (p.name ?? '').trim();
          try { await supabase.auth.updateUser({ data: { full_name: name, firm_name: site } }); } catch { /* non-fatal */ }
          const uid = data.user?.id;
          if (uid) {
            try {
              await supabase.rpc('create_workspace', { p_user_id: uid, p_name: site || 'My site', p_slug: `${slugify(site) || 'site'}-${Math.random().toString(36).slice(2, 6)}` }).single();
            } catch { /* if it fails, the app routes them through onboarding as a fallback */ }
          }
          // NOTE: the supervisor number (p.supervisor) is captured in the sheet but not yet
          // invited for real — the sheet's "say hi" is visual, as in the source design. Wiring
          // a real WhatsApp invite from here is a follow-up (needs the org to exist first).
          try { localStorage.removeItem('briklay_membership_ctx'); } catch { /* ignore */ }
          reply({ ok: true });
          window.setTimeout(() => { window.location.href = '/'; }, 900);
          return;
        }
      } catch (err) {
        reply({ ok: false, error: err instanceof Error ? err.message : 'Something went wrong.' });
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [payload]);

  if (invalid || !payload) return <Expired />;

  return (
    <iframe
      title="Your Briklay entry"
      srcDoc={srcDoc}
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 0, zIndex: 0, display: 'block' }}
    />
  );
}

// Bad/expired ?d= — a small on-brand dead-end (the iframe never mounts).
function Expired() {
  const V = { ink: '#2B211A', sys: '#5C4F45', terra: '#B5472A', page: '#FAF8F3' };
  const PF = "'Playfair Display', Georgia, serif";
  return (
    <div style={{ position: 'fixed', inset: 0, background: V.page, color: V.ink, fontFamily: "'DM Sans', system-ui, sans-serif", display: 'grid', placeItems: 'center', padding: 24 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600&family=Playfair+Display:wght@600&display=swap');`}</style>
      <div style={{ maxWidth: 360, textAlign: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: '1.3rem', letterSpacing: '-.02em', marginBottom: 18 }}>Briklay<span style={{ color: V.terra }}>.</span></div>
        <h1 style={{ fontFamily: PF, fontSize: '1.6rem', fontWeight: 600, margin: 0 }}>This link has expired.</h1>
        <p style={{ color: V.sys, marginTop: 10, lineHeight: 1.5 }}>Message Briklay again on WhatsApp and we’ll file a fresh one.</p>
        <a href="/signup" style={{ display: 'inline-block', marginTop: 20, background: V.terra, color: '#fff', textDecoration: 'none', fontWeight: 600, padding: '13px 22px', borderRadius: 14 }}>Set up my site</a>
      </div>
    </div>
  );
}
