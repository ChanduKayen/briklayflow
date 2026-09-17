/**
 * DemoRecord — the no-auth "see your record" page for landing prospects.
 *
 * Rendered at /demo (public, before every auth gate — see App.tsx). It decodes
 * the ?d= payload written by the WhatsApp demo concierge and shows the builder's
 * OWN just-sent entry filed on a mini Briklay dashboard. Read-only, client-only:
 * zero DB, zero session, nothing persisted. Watermarked "Demo" so it's never
 * mistaken for a real account. See docs/wa-demo-concierge-spec.md.
 *
 * The payload is untrusted (it rides in a URL): decodeDemo() clamps it and every
 * value renders through JSX (auto-escaped) — never dangerouslySetInnerHTML.
 */
import { useEffect, useMemo } from 'react';
import { decodeDemo, SAMPLE_DEMO, type DemoEntry } from '../lib/demoRecord';

const C = {
  paper: '#F7F6F1', sheet: '#E9EFE8', ink: '#12261F', mute: '#5D6E67',
  rule: '#C9D6CF', ruleSoft: '#DEE6E0', red: '#B23A2A', wa: '#008069', ok: '#0E6B4E',
};

const inr = (n: number) => '₹' + new Intl.NumberFormat('en-IN').format(Math.round(n));

const SIGNUP_URL = '/signup';

export default function DemoRecord() {
  // No ?d= → show the sample so the page is demoable on its own. A present-but-broken
  // payload → the honest "expired" state (don't fake a record for a bad link).
  const { payload, invalid } = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get('d');
    if (raw == null) return { payload: SAMPLE_DEMO, invalid: false };
    const p = decodeDemo(raw);
    return p ? { payload: p, invalid: false } : { payload: null, invalid: true };
  }, []);

  useEffect(() => {
    const prev = document.title;
    document.title = 'Your Briklay demo';
    return () => { document.title = prev; };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, overflowY: 'auto', background: C.paper, color: C.ink,
      fontFamily: "'Bricolage Grotesque',system-ui,-apple-system,'Segoe UI',sans-serif",
      backgroundImage: `repeating-linear-gradient(to bottom,transparent 0,transparent 33px,${C.ruleSoft} 33px,${C.ruleSoft} 34px)`,
      backgroundPosition: '0 6px' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&display=swap');
        @keyframes dpulse{0%{box-shadow:0 0 0 0 rgba(0,128,105,.45)}70%{box-shadow:0 0 0 7px rgba(0,128,105,0)}100%{box-shadow:0 0 0 0 rgba(0,128,105,0)}}
        .d-margin{position:fixed;top:0;bottom:0;left:16px;width:1.5px;background:${C.red};opacity:.85}
        @media(min-width:760px){.d-margin{left:calc(50% - 260px - 26px)}}
        .d-btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;width:100%;
          min-height:52px;padding:14px 22px;border-radius:10px;font-weight:600;font-size:1rem;
          background:${C.wa};color:#fff;text-decoration:none;box-shadow:0 5px 0 ${C.ink};
          transition:transform .16s,box-shadow .16s}
        .d-btn:hover,.d-btn:active{transform:translateY(5px);box-shadow:0 0 0 ${C.ink}}
      `}</style>
      <div className="d-margin" aria-hidden="true" />

      <main style={{ position: 'relative', maxWidth: 520, margin: '0 auto', padding: '32px 22px 64px' }}>
        {/* brand + demo badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 26 }}>
          <a href="/" style={{ display: 'inline-flex', alignItems: 'baseline', textDecoration: 'none', color: C.ink }}>
            <b style={{ fontWeight: 700, fontSize: '1.15rem', letterSpacing: '-.02em' }}>Briklay</b>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.red, marginLeft: 3, alignSelf: 'flex-end', marginBottom: 4 }} />
          </a>
          <span style={{ fontSize: '.72rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
            color: C.red, border: `1px solid ${C.red}`, borderRadius: 999, padding: '4px 10px' }}>Demo</span>
        </div>

        {invalid ? (
          <Expired />
        ) : payload ? (
          <>
            <h1 style={{ fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.05, fontSize: 'clamp(1.8rem,6vw,2.4rem)' }}>
              {payload.name ? `Filed for ${payload.name}.` : 'Filed from your WhatsApp.'}
            </h1>
            <p style={{ color: C.mute, marginTop: 12, fontSize: '1.02rem', lineHeight: 1.5 }}>
              This is the message you just sent — recorded, checked and filed. Nobody typed it into any software.
            </p>

            <div style={{ marginTop: 24, background: '#fff', border: `1px solid ${C.rule}`, borderRadius: 14, overflow: 'hidden',
              boxShadow: '0 1px 0 rgba(18,38,31,.03),0 24px 50px -30px rgba(18,38,31,.25)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 18px', borderBottom: `1px solid ${C.rule}` }}>
                <span style={{ fontWeight: 700, letterSpacing: '-.01em' }}>{entrySite(payload.entry) ?? 'Your site'}</span>
                <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '.78rem', color: C.mute }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.wa, animation: 'dpulse 1.8s ease-out infinite' }} />
                  Listening on WhatsApp
                </span>
              </div>
              <Entry entry={payload.entry} />
              <div style={{ padding: '11px 18px', borderTop: `1px solid ${C.rule}`, background: C.paper, color: C.ok, fontSize: '.85rem', fontWeight: 600 }}>
                ✓ Filed from your WhatsApp message
              </div>
            </div>

            <div style={{ marginTop: 28 }}>
              <a className="d-btn" href={SIGNUP_URL}>Set up my site — free for 3 months</a>
              <p style={{ marginTop: 14, textAlign: 'center', color: C.mute, fontSize: '.86rem' }}>
                Your real dashboard fills itself the same way — from the messages your team already sends.
              </p>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

function entrySite(e: DemoEntry): string | undefined {
  return 'site' in e ? e.site : undefined;
}

function Entry({ entry }: { entry: DemoEntry }) {
  if (entry.kind === 'payment') {
    const sub = [entry.payee ? `Paid to ${entry.payee}` : null, entry.category].filter(Boolean).join(' · ');
    return (
      <div style={{ padding: '20px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ width: 30, height: 30, borderRadius: '50%', background: C.ok, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, flex: 'none' }}>✓</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-.03em', lineHeight: 1 }}>
              {entry.amount != null ? inr(entry.amount) : (entry.note ?? 'Payment')}
            </div>
            {sub && <div style={{ color: C.mute, marginTop: 6, fontSize: '.95rem' }}>{sub}</div>}
          </div>
          <span style={{ marginLeft: 'auto', flex: 'none', fontSize: '.76rem', fontWeight: 600, borderRadius: 6, padding: '5px 10px', background: '#FBEFE9', color: C.red, border: '1px solid #EBC7BD' }}>
            pending your approval
          </span>
        </div>
      </div>
    );
  }
  if (entry.kind === 'attendance') {
    return (
      <div style={{ padding: '18px' }}>
        <div style={{ fontWeight: 600, marginBottom: entry.rows?.length ? 12 : 0 }}>Attendance recorded</div>
        {entry.rows?.length ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {entry.rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 12, fontSize: '.95rem' }}>
                <span style={{ fontWeight: 600 }}>{r.crew}</span>
                <span style={{ color: C.mute }}>{r.present} present</span>
                {r.amt != null && <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{inr(r.amt)}</span>}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: C.mute, fontSize: '.95rem' }}>{entry.note ?? 'Today’s muster, from your message.'}</div>
        )}
      </div>
    );
  }
  // issue
  return (
    <div style={{ padding: '18px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '1.02rem' }}>{entry.title ?? entry.note ?? 'Site issue logged'}</div>
          {entry.note && entry.title && <div style={{ color: C.mute, marginTop: 4, fontSize: '.9rem' }}>{entry.note}</div>}
        </div>
        <span style={{ marginLeft: 'auto', flex: 'none', fontSize: '.76rem', fontWeight: 600, borderRadius: 6, padding: '5px 10px', background: '#E3F4EC', color: C.ok, border: '1px solid #B7DDC9' }}>
          follow-up set
        </span>
      </div>
    </div>
  );
}

function Expired() {
  return (
    <div style={{ marginTop: 8 }}>
      <h1 style={{ fontWeight: 700, letterSpacing: '-.02em', fontSize: 'clamp(1.8rem,6vw,2.4rem)' }}>This demo link has expired.</h1>
      <p style={{ color: C.mute, marginTop: 12, fontSize: '1.02rem', lineHeight: 1.5 }}>
        No problem — message Briklay again on WhatsApp and we’ll file a fresh one, or set up your real site now.
      </p>
      <div style={{ marginTop: 24 }}>
        <a className="d-btn" href={SIGNUP_URL}>Set up my site — free for 3 months</a>
      </div>
    </div>
  );
}
