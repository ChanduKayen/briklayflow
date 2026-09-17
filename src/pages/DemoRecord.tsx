/**
 * DemoRecord — the no-auth "/demo" page for landing prospects, in the platform's OWN language.
 *
 * A prospect messaged the WhatsApp bot; the concierge filed their words (sandbox) and sent this link.
 * Here they see the entry as a real Day Book VOUCHER, tap Approve to watch it file (a stylized, visual-
 * only celebration — no DB write here), then add their PROJECT and NAME and continue straight into
 * onboarding: one phone + code step creates the account + workspace from what they just gave — no
 * separate sign-up form (option a). See docs/wa-demo-concierge-spec.md.
 *
 * The ?d= payload is untrusted (it rides in a URL): decodeDemo() clamps it; everything renders through
 * JSX (auto-escaped). Nothing here writes real data until the account is created at the end.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { decodeDemo, SAMPLE_DEMO, type DemoEntry } from '../lib/demoRecord';
import { supabase } from '../lib/supabase';

const V = {
  ink: '#1E1A15', inkSoft: '#3D3830', sys: '#6B6258', faint: '#9A9186',
  terra: '#BC4B27', terraDeep: '#8F3318', sage: '#2F5D34', sageWash: '#E9F2E7',
  page: '#FBF9F6', surface: '#FFFFFF', field: '#F4F2EE', line: '#EAE6E0',
};
const DM = "'DM Sans', system-ui, sans-serif";
const PF = "'Playfair Display', Georgia, serif";
const inr = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(n));

const toE164 = (raw: string): string => {
  const d = raw.replace(/\D/g, '');
  if (raw.trim().startsWith('+')) return '+' + d;
  if (d.length === 10) return '+91' + d;
  if (d.length === 12 && d.startsWith('91')) return '+' + d;
  return '+' + d;
};
const slugify = (n: string) => n.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 40);

type Stage = 'voucher' | 'filing' | 'onboard' | 'code' | 'done';

export default function DemoRecord() {
  const { payload, invalid } = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get('d');
    if (raw == null) return { payload: SAMPLE_DEMO, invalid: false };
    const p = decodeDemo(raw);
    return p ? { payload: p, invalid: false } : { payload: null, invalid: true };
  }, []);
  const entry = payload?.entry;

  const [stage, setStage] = useState<Stage>('voucher');
  const [name, setName] = useState(payload?.name ?? '');
  const [project, setProject] = useState((entry && 'site' in entry ? entry.site : '') ?? '');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flag, setFlag] = useState<'project' | 'name' | null>(null);

  useEffect(() => {
    const prev = document.title;
    document.title = 'Your Briklay entry';
    return () => { document.title = prev; };
  }, []);

  // Approve → play the file celebration (visual only) → ask for project + name.
  const approve = () => {
    setStage('filing');
    window.setTimeout(() => setStage('onboard'), 1700);
  };

  const startOnboard = async () => {
    if (!project.trim()) { setFlag('project'); return; }
    if (name.trim().length < 2) { setFlag('name'); return; }
    setFlag(null); setErr(null);
    const digits = phone.replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(digits)) { setErr('Enter your 10-digit WhatsApp number.'); return; }
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: toE164(digits), options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setStage('code');
  };

  const verify = async () => {
    setErr(null); setBusy(true);
    const digits = phone.replace(/\D/g, '');
    const { data, error } = await supabase.auth.verifyOtp({ phone: toE164(digits), token: code, type: 'sms' });
    if (error) { setBusy(false); setErr('That code didn’t work. Try again.'); return; }
    // Carry name + project into the real account, then create the workspace — no separate sign-up form.
    try { await supabase.auth.updateUser({ data: { full_name: name.trim(), firm_name: project.trim() } }); } catch { /* non-fatal */ }
    const uid = data.user?.id;
    if (uid) {
      try {
        await supabase.rpc('create_workspace', { p_user_id: uid, p_name: project.trim(), p_slug: `${slugify(project) || 'site'}-${Math.random().toString(36).slice(2, 6)}` }).single();
      } catch { /* if it fails, the app routes them through onboarding as a fallback */ }
    }
    try { localStorage.removeItem('briklay_membership_ctx'); } catch { /* ignore */ }
    setStage('done');
    window.setTimeout(() => { window.location.href = '/'; }, 900);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, overflowY: 'auto', background: V.page, color: V.ink, fontFamily: DM }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400..700&family=Playfair+Display:wght@500;600&display=swap');
        @keyframes drpop{0%{transform:translateY(10px) scale(.98);opacity:0}100%{transform:none;opacity:1}}
        @keyframes drtick{to{stroke-dashoffset:0}}
        @keyframes drlift{0%{transform:translateY(0)}40%{transform:translateY(-6px)}100%{transform:translateY(0)}}
        @keyframes drslip{0%{transform:translateY(16px);opacity:0}100%{transform:none;opacity:1}}
        @keyframes drring{0%{transform:scale(.4);opacity:.5}100%{transform:scale(1.5);opacity:0}}
        .dr-card{animation:drpop .5s cubic-bezier(.2,.8,.3,1) both}
        .dr-card.filing{animation:drlift .9s cubic-bezier(.3,.9,.35,1) both}
        .dr-in{width:100%;min-height:52px;border:1.5px solid ${V.line};border-radius:12px;background:${V.surface};
          padding:12px 14px;font:inherit;font-size:1.02rem;color:${V.ink};outline:none;transition:border-color .18s,box-shadow .18s}
        .dr-in:focus{border-color:${V.ink};box-shadow:0 0 0 3px rgba(30,26,21,.07)}
        .dr-in.bad{border-color:${V.terra};box-shadow:0 0 0 3px ${V.terra}22}
        .dr-btn{width:100%;min-height:54px;border:0;border-radius:12px;background:${V.terra};color:#fff;font:inherit;
          font-size:1.02rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:9px;
          box-shadow:0 8px 22px -10px ${V.terra};transition:transform .12s,opacity .2s}
        .dr-btn:active{transform:scale(.985)}
        .dr-btn:disabled{opacity:.6;cursor:default}
      `}</style>

      <main style={{ maxWidth: 460, margin: '0 auto', padding: '26px 18px 60px', position: 'relative' }}>
        {/* brand */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <a href="/" style={{ textDecoration: 'none', color: V.ink, fontWeight: 700, fontSize: '1.12rem', letterSpacing: '-.02em' }}>
            Briklay<span style={{ color: V.terra }}>.</span>
          </a>
          <span style={{ fontSize: '.7rem', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: V.faint }}>Day Book</span>
        </div>

        {invalid || !entry ? (
          <Expired />
        ) : stage === 'done' ? (
          <Done first={name.trim().split(' ')[0]} />
        ) : (
          <>
            <p style={{ color: V.sys, fontSize: '.95rem', marginBottom: 14 }}>
              {stage === 'voucher' ? 'From your WhatsApp message — check it, then file it.'
                : stage === 'filing' ? ' '
                : 'Filed. Now make it yours — takes one message.'}
            </p>

            {/* ── THE VOUCHER ── */}
            <div className={`dr-card${stage === 'filing' ? ' filing' : ''}`} style={{ background: V.surface, border: `1px solid ${V.line}`, borderRadius: 16, padding: 16, boxShadow: '0 1px 0 rgba(30,26,21,.03), 0 22px 44px -30px rgba(30,26,21,.28)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Chip filed={stage !== 'voucher'} entry={entry} />
                <span style={{ flex: 1 }} />
                <WaGlyph />
              </div>
              <Voucher entry={entry} />
            </div>

            {stage === 'filing' && <FiledStamp />}

            {/* ── VOUCHER stage: the one action ── */}
            {stage === 'voucher' && (
              <div style={{ marginTop: 18 }}>
                <button className="dr-btn" onClick={approve}>Approve &amp; file</button>
                <p style={{ marginTop: 12, textAlign: 'center', color: V.faint, fontSize: '.84rem' }}>
                  This is exactly how your team’s messages arrive — filed, waiting for your nod.
                </p>
              </div>
            )}

            {/* ── ONBOARD stage: project + name, then one-step continue ── */}
            {(stage === 'onboard' || stage === 'code') && (
              <div style={{ marginTop: 20, animation: 'drslip .5s cubic-bezier(.2,.8,.3,1) both' }}>
                {stage === 'onboard' ? (
                  <>
                    <Field label="Project" needed={flag === 'project'}>
                      <input className={`dr-in${flag === 'project' ? ' bad' : ''}`} value={project} onChange={(e) => setProject(e.target.value)} placeholder="e.g. ASM Elite" />
                    </Field>
                    <Field label="Your name" needed={flag === 'name'}>
                      <input className={`dr-in${flag === 'name' ? ' bad' : ''}`} value={name} onChange={(e) => setName(e.target.value)} placeholder="So your team knows who approves" />
                    </Field>
                    <Field label="Your WhatsApp number">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ color: V.sys, fontWeight: 600 }}>+91</span>
                        <input className="dr-in" style={{ flex: 1 }} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" maxLength={11} placeholder="98480 12321" />
                      </div>
                    </Field>
                    {err && <p style={{ color: V.terraDeep, fontSize: '.86rem', marginTop: 4 }}>{err}</p>}
                    <button className="dr-btn" style={{ marginTop: 16 }} disabled={busy} onClick={() => void startOnboard()}>
                      {busy ? 'Sending…' : 'Continue — set up my site'}
                    </button>
                    <p style={{ marginTop: 12, textAlign: 'center', color: V.faint, fontSize: '.84rem' }}>
                      We’ll send a 6-digit code to your WhatsApp. No password, nothing to install.
                    </p>
                  </>
                ) : (
                  <>
                    <p style={{ color: V.sys, fontSize: '.95rem', marginBottom: 12 }}>Enter the code we sent to <b style={{ color: V.ink }}>+91 {phone}</b> on WhatsApp.</p>
                    <input className="dr-in" style={{ textAlign: 'center', letterSpacing: '.4em', fontSize: '1.3rem', fontWeight: 700 }} value={code}
                      onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setCode(v); if (v.length === 6) setTimeout(() => void verify(), 120); }}
                      inputMode="numeric" maxLength={6} placeholder="••••••" autoFocus />
                    {err && <p style={{ color: V.terraDeep, fontSize: '.86rem', marginTop: 8 }}>{err}</p>}
                    <button className="dr-btn" style={{ marginTop: 16 }} disabled={busy || code.length < 6} onClick={() => void verify()}>
                      {busy ? 'Setting up…' : 'Verify & open my Day Book'}
                    </button>
                    <button onClick={() => { setStage('onboard'); setCode(''); setErr(null); }} style={{ display: 'block', margin: '12px auto 0', background: 'none', border: 0, color: V.sys, fontSize: '.86rem', cursor: 'pointer' }}>← Change number</button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ── the voucher fact ──
function Voucher({ entry }: { entry: DemoEntry }) {
  if (entry.kind === 'payment') {
    const sub = [entry.payee ? `Paid to ${entry.payee}` : null, entry.category].filter(Boolean).join(' · ');
    return (
      <div>
        <div style={{ fontFamily: PF, fontSize: '2.1rem', fontWeight: 600, lineHeight: 1, color: V.ink }}>
          {entry.amount != null ? <><span style={{ fontFamily: DM, fontSize: '1.1rem', color: V.sys }}>₹</span>{inr(entry.amount)}</> : <span style={{ fontFamily: DM, fontSize: '1rem', color: V.faint }}>amount not set</span>}
        </div>
        {sub && <div style={{ color: V.sys, marginTop: 7, fontSize: '.98rem' }}>{sub}</div>}
        <div style={{ marginTop: 12, display: 'inline-block', fontSize: '.74rem', fontWeight: 700, color: V.terra, background: '#FBEFE9', border: '1px solid #F0D6CB', borderRadius: 7, padding: '5px 10px' }}>pending your approval</div>
      </div>
    );
  }
  if (entry.kind === 'attendance') {
    return (
      <div>
        <div style={{ fontFamily: PF, fontSize: '1.5rem', fontWeight: 600, color: V.ink }}>Attendance</div>
        <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
          {(entry.rows ?? []).map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, fontSize: '.95rem' }}><b style={{ fontWeight: 600 }}>{r.crew}</b><span style={{ color: V.sys }}>{r.present} present</span>{r.amt != null && <span style={{ marginLeft: 'auto', fontWeight: 600 }}>₹{inr(r.amt)}</span>}</div>
          ))}
          {!(entry.rows?.length) && <div style={{ color: V.sys, fontSize: '.95rem' }}>{entry.note ?? 'Today’s muster, from your message.'}</div>}
        </div>
      </div>
    );
  }
  return (
    <div>
      <div style={{ fontFamily: PF, fontSize: '1.35rem', fontWeight: 600, color: V.ink, lineHeight: 1.2 }}>{entry.title ?? entry.note ?? 'Site issue'}</div>
      <div style={{ marginTop: 10, display: 'inline-block', fontSize: '.74rem', fontWeight: 700, color: V.sage, background: V.sageWash, border: '1px solid #C6DCC2', borderRadius: 7, padding: '5px 10px' }}>follow-up set</div>
    </div>
  );
}

function Chip({ filed, entry }: { filed: boolean; entry: DemoEntry }) {
  const label = filed ? 'Filed' : entry.kind === 'payment' ? 'Payment' : entry.kind === 'attendance' ? 'Attendance' : 'Issue';
  const c = filed ? V.sage : V.terra, bg = filed ? V.sageWash : '#FBEFE9';
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '.72rem', fontWeight: 700, color: c, background: bg, border: `1px solid ${c}33`, borderRadius: 999, padding: '4px 10px' }}>{filed && <Tick />}{label}</span>;
}

function Tick() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={V.sage} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6" style={{ strokeDasharray: 30, strokeDashoffset: 30, animation: 'drtick .45s ease .1s forwards' }} /></svg>;
}

function WaGlyph() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="#25D366" aria-hidden><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.1-1.3A10 10 0 1 0 12 2z" /></svg>;
}

function FiledStamp() {
  return (
    <div style={{ position: 'relative', height: 0 }}>
      <div style={{ position: 'absolute', left: '50%', top: -46, transform: 'translateX(-50%)', pointerEvents: 'none' }}>
        <span style={{ position: 'absolute', left: '50%', top: '50%', width: 46, height: 46, marginLeft: -23, marginTop: -23, borderRadius: '50%', border: `2px solid ${V.sage}`, animation: 'drring .8s ease-out forwards' }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: V.sage, color: '#fff', fontSize: '.82rem', fontWeight: 700, padding: '7px 14px', borderRadius: 999, boxShadow: '0 10px 24px -8px rgba(47,93,52,.6)', animation: 'drpop .4s cubic-bezier(.2,.9,.3,1.3) both' }}>
          <Tick /> Filed to your Books
        </span>
      </div>
    </div>
  );
}

function Field({ label, needed, children }: { label: string; needed?: boolean; children: ReactNode }) {
  return (
    <label style={{ display: 'block', marginTop: 14 }}>
      <span style={{ fontSize: '.8rem', fontWeight: 600, color: needed ? V.terra : V.sys, marginBottom: 6, display: 'block' }}>
        {label}{needed && ' · needed'}
      </span>
      {children}
    </label>
  );
}

function Done({ first }: { first: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 10px' }}>
      <div style={{ width: 68, height: 68, margin: '0 auto 18px', borderRadius: '50%', background: V.sageWash, display: 'grid', placeItems: 'center' }}>
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={V.sage} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6" /></svg>
      </div>
      <h1 style={{ fontFamily: PF, fontSize: '1.7rem', fontWeight: 600 }}>You’re in{first ? `, ${first}` : ''}.</h1>
      <p style={{ color: V.sys, marginTop: 8 }}>Opening your Day Book…</p>
    </div>
  );
}

function Expired() {
  return (
    <div style={{ padding: '30px 6px' }}>
      <h1 style={{ fontFamily: PF, fontSize: '1.7rem', fontWeight: 600 }}>This link has expired.</h1>
      <p style={{ color: V.sys, marginTop: 10, lineHeight: 1.5 }}>Message Briklay again on WhatsApp and we’ll file a fresh one.</p>
      <a href="/signup" style={{ display: 'inline-block', marginTop: 18, background: V.terra, color: '#fff', textDecoration: 'none', fontWeight: 700, padding: '12px 20px', borderRadius: 12 }}>Set up my site</a>
    </div>
  );
}
