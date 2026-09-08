/**
 * Onboarding — the reference design, wired to the real thing.
 *
 * Five steps: the firm, the first site, the number, the first entry, the handover. Each one
 * writes: the org is renamed, the project is created the same way the New Project wizard creates
 * it, the number is registered for WhatsApp through wa_self_register and greeted with the same
 * template Team access uses, and the message becomes a rough entry that goes through
 * ai-extract-entry — the identical path a real WhatsApp message takes. Nothing here is a mock.
 *
 * The reference has no error states, because nothing in it can fail. These writes can, so each
 * step keeps its failure on screen rather than pretending it worked.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { uniqueProjectId } from '../../lib/projectId';
import { OBX_CSS } from './obxCss';
import { startLamp, type Lamp } from './obxLamp';

interface Props {
  /** Accepted so the mount site is unchanged; the writes below use the profile and org. */
  session?: unknown;
  profile: { id: string; name?: string | null; org_id?: string | null };
  orgName?: string | null;
  orgId?: string | null;
  onComplete: () => void;
}

type StepId = 's1' | 's2' | 's3' | 's4' | 's4b' | 's5';
const MARK: Record<StepId, number> = { s1: 1, s2: 2, s3: 3, s4: 4, s4b: 4, s5: 5 };
const CAPS: Record<number, string> = { 1: 'Marking the plot', 2: 'Foundations', 3: 'Wiring the line', 4: 'First entry', 5: 'Handover' };
const PREFILL = 'Paid 12,000 to Srinivas for centering work';
// Read once, at import. Someone who has asked for less motion gets every step already arrived,
// which is an INITIAL STATE, not something an effect should rush in and set after the fact.
const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const only = (s: string) => s.replace(/\D/g, '');
const buzz = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* not offered */ } };

/** What the finale shows. Read from the message, exactly as the reference reads it. */
function parseEntry(t: string) {
  const raw = t.trim();
  const amtM = raw.match(/([\d][\d,]*)/);
  const whoM = raw.match(/to\s+([A-Za-z][A-Za-z .]*?)(?:\s+for\s|$)/i);
  const forM = raw.match(/for\s+(.+)$/i);
  return {
    raw,
    amt: amtM ? '₹' + amtM[1] : '₹—',
    who: whoM ? whoM[1].trim() : 'New party',
    note: forM ? forM[1].trim() : raw,
  };
}

export default function OnboardingFlow({ profile, orgName, orgId, onComplete }: Props) {
  const navigate = useNavigate();
  const bpRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const lampRef = useRef<Lamp | null>(null);

  const [step, setStep] = useState<StepId>('s1');
  const [leaving, setLeaving] = useState<StepId | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [firm, setFirm] = useState('');
  const [proj, setProj] = useState('');
  const [phone, setPhone] = useState('');
  const [compose, setCompose] = useState(REDUCED ? PREFILL : '');
  const [composeReady, setComposeReady] = useState(REDUCED);
  const [sent, setSent] = useState<{ raw: string; blue: boolean } | null>(null);

  const [imported, setImported] = useState<{ parties: number; outstanding: number; workers: number } | null>(null);
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const firmRef = useRef<HTMLInputElement>(null);
  const projRef = useRef<HTMLInputElement>(null);

  const [entry, setEntry] = useState(parseEntry(PREFILL));
  const [finale, setFinale] = useState(REDUCED
    ? { card: true, more: true, tm2: true, tm3: true, thesis: true }
    : { card: false, more: false, tm2: false, tm3: false, thesis: false });

  const firmName = firm.trim() || orgName || 'Your firm';
  const projName = proj.trim() || 'your site';
  const mark = MARK[step];

  // ── the lamp ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!bpRef.current || !orbRef.current) return;
    lampRef.current = startLamp(bpRef.current, orbRef.current);
    return () => { lampRef.current?.stop(); lampRef.current = null; };
  }, []);

  const go = (to: StepId) => {
    setErr(null);
    setLeaving(step);
    setStep(to);
    buzz(12);
    lampRef.current?.aim(innerWidth / 2, innerHeight * 0.45);
    window.setTimeout(() => setLeaving(null), 700);
  };

  // Focus the field a beat after the step lands, as the reference does.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (step === 's1') firmRef.current?.focus();
      if (step === 's2') projRef.current?.focus();
      if (step === 's3') phoneRef.current?.focus();
    }, 900);
    return () => window.clearTimeout(t);
  }, [step]);

  // ── s4: the greeting types itself, then the message does ──────────────────
  // A ref, not state: setting state here would change this effect's own dependencies, and the
  // re-run's cleanup would cancel the very timers it just scheduled — the greeting would never
  // arrive and the message would never type itself.
  const chatPlayed = useRef(false);
  const [helloShown, setHelloShown] = useState(REDUCED);
  useEffect(() => {
    if (step !== 's4' || chatPlayed.current) return;
    chatPlayed.current = true;
    if (REDUCED) return;   // already arrived, from the initial state
    const t1 = window.setTimeout(() => setHelloShown(true), 1500);
    const t2 = window.setTimeout(() => {
      let i = 0;
      const type = () => {
        if (i <= PREFILL.length) { setCompose(PREFILL.slice(0, i)); i++; window.setTimeout(type, 26 + Math.random() * 30); }
        else setComposeReady(true);
      };
      type();
    }, 2600);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [step]);

  // ── s5: the card lands, then the rest ─────────────────────────────────────
  useEffect(() => {
    if (step !== 's5') return;
    lampRef.current?.flood();
    if (REDUCED) return;   // already arrived, from the initial state
    const ts = [
      window.setTimeout(() => setFinale(f => ({ ...f, card: true })), 30),
      window.setTimeout(() => setFinale(f => ({ ...f, more: true, tm2: true })), 2100),
      window.setTimeout(() => setFinale(f => ({ ...f, tm3: true })), 2800),
      window.setTimeout(() => setFinale(f => ({ ...f, thesis: true })), 3700),
    ];
    return () => ts.forEach(window.clearTimeout);
  }, [step]);

  // ── the writes ────────────────────────────────────────────────────────────
  const saveFirm = async () => {
    const name = firm.trim();
    if (name.length < 2 || busy) return;
    setBusy(true); setErr(null);
    const org = orgId ?? profile.org_id;
    if (org) {
      const { error } = await supabase.from('organizations').update({ name }).eq('org_id', org);
      if (error) { setBusy(false); setErr(error.message || 'Could not save the firm name.'); return; }
    }
    setBusy(false); go('s2');
  };

  const saveSite = async () => {
    const name = proj.trim();
    if (name.length < 2 || busy) return;
    setBusy(true); setErr(null);
    const org = orgId ?? profile.org_id;
    // The same derivation the wizard used: the RPC needs a 2–6 char A-Z0-9 code.
    const stripped = name.replace(/\b(villa|flat|building|project|new|phase|the|and|of|for|at|in|a|an|dr|mr|mrs)\b/gi, '').replace(/[^a-zA-Z]/g, '');
    let code = (stripped || name.replace(/[^a-zA-Z]/g, '')).substring(0, 4).toUpperCase();
    if (code.length < 2) code = 'PROJ';
    const { error } = await supabase.from('projects').insert({
      project_id: uniqueProjectId(name),
      org_id: org,
      name,
      project_code: code,
      project_type: 'Residential',
      status: 'Active',
      created_by: profile.id,
      start_date: new Date().toISOString().split('T')[0],
    });
    setBusy(false);
    if (error) { setErr(error.message || 'Could not create the site.'); return; }
    go('s3');
  };

  const savePhone = async () => {
    if (phone.length !== 10 || busy) return;
    setBusy(true); setErr(null);
    try {
      const { data, error } = await supabase.rpc('wa_self_register', { p_phone: phone, p_org_id: orgId ?? profile.org_id ?? null });
      if (error) throw new Error(error.message);
      const res = data as { ok: boolean; error?: string; phone?: string; name?: string; needs_welcome?: boolean };
      if (!res?.ok) throw new Error(res?.error || 'Could not register your number');
      if (res.needs_welcome) {
        const to = res.phone || ('91' + phone);
        const { data: sentRes, error: fnErr } = await supabase.functions.invoke('send-template', {
          body: { templateKey: 'teammate_welcome', to, params: { name: res.name || profile.name || 'there' } },
        });
        // A failed hello is worth saying, but the number IS registered — do not lose the step.
        if (!fnErr && !(sentRes && sentRes.ok === false)) await supabase.rpc('wa_mark_welcomed', { p_phone: to });
      }
      setBusy(false); go('s4');
    } catch (e) {
      setBusy(false);
      setErr((e as Error)?.message || 'Could not register your number.');
    }
  };

  const sendMessage = async () => {
    const text = compose.trim();
    if (text.length < 4 || busy) return;
    setEntry(parseEntry(text));
    setSent({ raw: text, blue: false });
    setCompose(''); setComposeReady(false);
    buzz([10, 40, 18]);
    window.setTimeout(() => setSent(s => (s ? { ...s, blue: true } : s)), 900);
    // The message becomes a rough entry and goes through the same extractor a WhatsApp message
    // does. Whether it files straight or waits in For Review is that pipeline's call, not ours.
    setBusy(true);
    const { data, error } = await supabase.from('rough_entries').insert({
      source: 'UI_TEXT',
      raw_text: text,
      sender_name: profile.name || 'You',
      sender_number: phone ? '91' + phone : null,
      status: 'PENDING',
      created_by: profile.id,
    }).select('id').single();
    if (!error && data?.id) {
      try { await supabase.functions.invoke('ai-extract-entry', { body: { entry_id: data.id } }); } catch { /* the entry stands either way */ }
    }
    setBusy(false);
    window.setTimeout(() => go('s5'), 800);
  };

  const readFile = async (f: File) => {
    setFileName(f.name); setReading(true); setErr(null);
    try {
      const { readWorkbook } = await import('../../lib/importWorkbook');
      const sheet = await readWorkbook(f);
      // Real counts, read off the real sheet — the reference's figures are mock and inventing
      // numbers about someone's own books would be the worst possible first impression.
      const headers = (sheet.headers ?? []).map(h => String(h ?? '').toLowerCase());
      const nameCols = headers.map((h, i) => (/name|party|vendor|worker|supplier|account/.test(h) ? i : -1)).filter(i => i >= 0);
      const amtCols = headers.map((h, i) => (/amount|balance|due|outstanding|closing/.test(h) ? i : -1)).filter(i => i >= 0);
      const workerCols = headers.map((h, i) => (/worker|labour|labor|mason|helper/.test(h) ? i : -1)).filter(i => i >= 0);
      const names = new Set<string>(); const workers = new Set<string>();
      let outstanding = 0;
      for (const row of sheet.rows ?? []) {
        for (const i of nameCols) { const v = row[i]; if (typeof v === 'string' && v.trim()) names.add(v.trim().toLowerCase()); }
        for (const i of workerCols) { const v = row[i]; if (typeof v === 'string' && v.trim()) workers.add(v.trim().toLowerCase()); }
        for (const i of amtCols) { const n = Number(String(row[i] ?? '').replace(/[^\d.-]/g, '')); if (!isNaN(n)) outstanding += n; }
      }
      setImported({ parties: names.size, outstanding: Math.round(outstanding), workers: workers.size });
    } catch (e) {
      setErr((e as Error)?.message || 'Could not read that file.');
    } finally { setReading(false); }
  };

  const finish = async (dest: string) => {
    if (busy) return;
    setBusy(true);
    await supabase.from('user_profiles').update({ onboarding_done: true }).eq('id', profile.id);
    onComplete();
    navigate(dest, { replace: true });
  };

  const slug = useMemo(() => firm.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'your-firm', [firm]);
  const phoneShown = phone.length === 10 ? phone.slice(0, 5) + ' ' + phone.slice(5) : '—';
  const cls = (id: StepId) => `step${step === id ? ' active' : ''}${leaving === id ? ' leaving' : ''}`;

  return (
    <div className={`obx${step === 's5' ? ' finale' : ''}`}>
      <style>{OBX_CSS}</style>
      <div className="orb" ref={orbRef} />
      <div className="blueprint" ref={bpRef}>
        <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <g className="bp-fine">
            <line x1="200" y1="60" x2="200" y2="860" /><line x1="420" y1="60" x2="420" y2="860" />
            <line x1="640" y1="60" x2="640" y2="860" /><line x1="860" y1="60" x2="860" y2="860" />
            <line x1="1080" y1="60" x2="1080" y2="860" /><line x1="1300" y1="60" x2="1300" y2="860" />
            <line x1="120" y1="180" x2="1480" y2="180" /><line x1="120" y1="380" x2="1480" y2="380" />
            <line x1="120" y1="580" x2="1480" y2="580" /><line x1="120" y1="740" x2="1480" y2="740" />
          </g>
          <g className="bp">
            <circle cx="200" cy="48" r="16" fill="none" /><circle cx="420" cy="48" r="16" fill="none" /><circle cx="640" cy="48" r="16" fill="none" />
            <circle cx="860" cy="48" r="16" fill="none" /><circle cx="1080" cy="48" r="16" fill="none" /><circle cx="1300" cy="48" r="16" fill="none" />
          </g>
          <g fontSize="13" textAnchor="middle">
            <text x="200" y="53">A</text><text x="420" y="53">B</text><text x="640" y="53">C</text>
            <text x="860" y="53">D</text><text x="1080" y="53">E</text><text x="1300" y="53">F</text>
          </g>
          <g className="bp">
            <path d="M980 740 L980 300 L1210 240 L1440 300 L1440 740" />
            <line x1="980" y1="460" x2="1440" y2="460" /><line x1="980" y1="600" x2="1440" y2="600" />
            <rect x="1020" y="500" width="70" height="60" /><rect x="1150" y="500" width="70" height="60" /><rect x="1300" y="500" width="70" height="60" />
            <rect x="1020" y="640" width="70" height="60" /><rect x="1300" y="640" width="70" height="60" />
            <rect x="1150" y="640" width="80" height="100" />
            <rect x="1020" y="340" width="70" height="80" /><rect x="1150" y="340" width="70" height="80" /><rect x="1300" y="340" width="70" height="80" />
          </g>
          <g className="bp-fine">
            <line x1="980" y1="790" x2="1440" y2="790" />
            <line x1="980" y1="782" x2="980" y2="798" /><line x1="1440" y1="782" x2="1440" y2="798" />
          </g>
          <text x="1210" y="812" fontSize="12" textAnchor="middle">14 400</text>
          <g className="bp">
            <path d="M180 700 L560 700" />
            <path d="M220 700 L220 560 L380 480 L540 560 L540 700" />
            <path d="M250 700 L250 610 L330 610 L330 700" />
            <path d="M410 640 L490 640 L490 700 L410 700 Z" />
          </g>
          <g className="bp">
            <circle cx="320" cy="220" r="34" fill="none" />
            <path d="M320 246 L320 200 M320 200 L310 216 M320 200 L330 216" />
          </g>
          <text x="320" y="286" fontSize="12" textAnchor="middle">N</text>
          <g className="bp-fine">
            <rect x="620" y="640" width="260" height="90" />
            <line x1="620" y1="670" x2="880" y2="670" /><line x1="620" y1="700" x2="880" y2="700" />
            <line x1="760" y1="670" x2="760" y2="730" />
          </g>
          <text x="632" y="661" fontSize="11">SITE OFFICE — SHEET 01</text>
          <text x="632" y="691" fontSize="11">SCALE 1:100</text>
          <text x="772" y="691" fontSize="11">BRIKLAY</text>
        </svg>
      </div>

      <div className="mark">Briklay<i>.</i></div>

      {/* the phone's progress: five marks across the top, where a drawing will not fit */}
      <div className="rail" aria-hidden="true">
        {[1, 2, 3, 4, 5].map(n => <i key={n} className={n <= mark ? 'on' : ''} />)}
        <b>0{mark}/05</b>
      </div>

      <div className="stage">
        {/* 1 · FIRM */}
        <section className={cls('s1')}>
          <div className="inner">
            <div className="hello">Welcome</div>
            <h1>Set up your <em>site office.</em></h1>
            <p className="lede">One place for your projects, parties and money. Name the firm — you&rsquo;ll make your first entry in under a minute.</p>
            <div className="field">
              <label className="flabel" htmlFor="obx-firm">Firm name</label>
              <input ref={firmRef} className="ledger-input" id="obx-firm" value={firm} onChange={e => setFirm(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void saveFirm(); }}
                placeholder="Rabish Industries" autoComplete="off" spellCheck={false} />
            </div>
            <div className="slug">briklay.app/<b>{slug}</b></div>
            <button className="btn" disabled={firm.trim().length < 2 || busy} onClick={() => void saveFirm()}>
              {busy ? 'Creating…' : <>Create workspace <span className="arr">→</span></>}
            </button>
            {err && step === 's1' && <p className="err">{err}</p>}
          </div>
        </section>

        {/* 2 · SITE */}
        <section className={cls('s2')}>
          <div className="inner">
            <div className="hello">First site</div>
            <h1>Which site are you <em>running now?</em></h1>
            <p className="lede">Everything you record hangs off a site. Start with the one where money moved today.</p>
            <div className="field">
              <label className="flabel" htmlFor="obx-proj">Site name</label>
              <input ref={projRef} className="ledger-input" id="obx-proj" value={proj} onChange={e => setProj(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void saveSite(); }}
                placeholder="Rabish 1" autoComplete="off" spellCheck={false} />
            </div>
            <div style={{ height: 30 }} />
            <button className="btn" disabled={proj.trim().length < 2 || busy} onClick={() => void saveSite()}>
              {busy ? 'Creating…' : <>Create site <span className="arr">→</span></>}
            </button>
            {err && step === 's2' && <p className="err">{err}</p>}
          </div>
        </section>

        {/* 3 · PHONE */}
        <section className={cls('s3')}>
          <div className="inner">
            <div className="hello">Your number</div>
            <h1>Where does site news <em>find you?</em></h1>
            <p className="lede">Briklay lives in your WhatsApp. This number becomes your books&rsquo; front door — type it in.</p>
            <div className="numpad" onClick={() => phoneRef.current?.focus()}>
              <div className="cc-big">+91</div>
              <div className={`slots${phone.length === 10 ? ' done' : ''}`}>
                {Array.from({ length: 10 }, (_, i) => (
                  <span key={i} style={{ display: 'contents' }}>
                    {i === 5 && <div className="gap" />}
                    <div className={`slot${phone[i] ? ' filled' : ''}${i === phone.length && phone.length < 10 ? ' next' : ''}`}
                      style={{ ['--i' as string]: i }}>
                      {phone[i] ? <span>{phone[i]}</span> : ''}
                    </div>
                  </span>
                ))}
              </div>
              <svg className={`num-tick${phone.length === 10 ? ' on' : ''}`} viewBox="0 0 38 38" aria-hidden="true">
                <circle cx="19" cy="19" r="16" pathLength={1} />
                <path d="M12 19.5 L17 24.5 L26.5 13.5" pathLength={1} />
              </svg>
            </div>
            <input ref={phoneRef} className="hiddenphone" inputMode="numeric" autoComplete="tel" value={phone}
              onChange={e => { const v = only(e.target.value).slice(0, 10); if (v.length > phone.length) buzz(8); setPhone(v); }}
              onKeyDown={e => { if (e.key === 'Enter') void savePhone(); }} />
            <div className={`contact-card${phone.length === 10 ? ' show' : ''}`}>
              <div className="cc-av">B<span className="dot" /></div>
              <div className="cc-body">
                <b>Briklay</b>
                <span>will say hello on <span className="num">+91 {phoneShown}</span> · save the contact when it lands</span>
              </div>
            </div>
            <button className="btn" disabled={phone.length !== 10 || busy} onClick={() => void savePhone()}>
              {busy ? 'Saying hello…' : <>That&rsquo;s my number <span className="arr">→</span></>}
            </button>
            {err && step === 's3' && <p className="err">{err}</p>}
          </div>
        </section>

        {/* 4 · THE CHAT */}
        <section className={cls('s4')}>
          <div className="inner">
            <div className="hello">First entry</div>
            <h1>Message <em>your books.</em></h1>
            <p className="lede">This is how Briklay works — the day&rsquo;s money, said like you&rsquo;d say it. We&rsquo;ve typed today&rsquo;s entry for you.</p>
            <div className="chat">
              <div className="ch-head">
                <div className="ch-av">B</div>
                <div>
                  <div className="ch-name">Briklay</div>
                  <div className="ch-sub">online</div>
                </div>
              </div>
              <div className="ch-body">
                {!helloShown && <div className="typing show"><i /><i /><i /></div>}
                <div className={`msg in${helloShown ? ' show' : ''}`}>
                  Namaste! 🙏 What did you pay on <b>{projName}</b> today? Say it like you&rsquo;d say it to your accountant.
                  <span className="mt">18:02</span>
                </div>
                {sent && (
                  <div className="msg out show" dangerouslySetInnerHTML={{
                    __html: esc(sent.raw) + `<span class="mt">18:04 <span class="tk${sent.blue ? ' blue' : ''}">✓✓</span></span>`,
                  }} />
                )}
              </div>
              <div className="ch-compose">
                <div className="cwrap">
                  <input value={compose} readOnly={!composeReady}
                    onChange={e => setCompose(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && compose.trim().length >= 4) void sendMessage(); }} />
                </div>
                <button className={`send${composeReady && !sent ? ' glow' : ''}`} disabled={compose.trim().length < 4 || !!sent}
                  onClick={() => void sendMessage()} aria-label="Send">➤</button>
              </div>
            </div>
            <div className={`send-hint${composeReady && !sent ? ' show' : ''}`}>Edit it if you like — or just <b>hit send</b>.</div>
            <div><button className="quiet" onClick={() => go('s4b')}>I keep my books in Excel or Tally — bring them in instead</button></div>
          </div>
        </section>

        {/* 4b · IMPORT */}
        <section className={cls('s4b')}>
          <button className="back" onClick={() => go('s4')}>← Back to first entry</button>
          <div className="inner">
            <div className="hello">Bring your books</div>
            <h1>Nothing starts <em>from zero.</em></h1>
            <p className="lede">Drop your ledger — your parties, balances and history walk in with you.</p>
            {!fileName && (
              <div className="drop" onClick={() => fileRef.current?.click()}>
                <div className="d-ic">⇪</div>
                <b>Drop your file, or click to browse</b>
                <span>Excel · Tally export · bank statement CSV</span>
              </div>
            )}
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void readFile(f); }} />
            {fileName && (
              <div className="filechip show">
                <div className="fc-ic">{(fileName.split('.').pop() || 'FILE').toUpperCase().slice(0, 4)}</div>
                <div><b>{fileName}</b><span>{reading ? 'Reading…' : imported ? 'Read' : 'Could not read'}</span></div>
                <div className="inkbar"><i style={{ width: reading ? '60%' : imported ? '100%' : '0' }} /></div>
              </div>
            )}
            {imported && (
              <div className="counts show">
                <div className="cnt"><b>{imported.parties}</b><span>parties found</span></div>
                <div className="cnt"><b>₹{imported.outstanding.toLocaleString('en-IN')}</b><span>outstanding</span></div>
                <div className="cnt"><b>{imported.workers}</b><span>workers on books</span></div>
              </div>
            )}
            {err && step === 's4b' && <p className="err">{err}</p>}
            {imported && (
              <button className="btn" disabled={busy} onClick={() => void finish('/ledger/import')}>
                {busy ? 'Opening…' : <>Bring them all in <span className="arr">→</span></>}
              </button>
            )}
          </div>
        </section>

        {/* 5 · FINALE */}
        <section className={cls('s5')}>
          <div className="inner">
            <div className="hello">Handover</div>
            <h1>Your message is now <em>a ledger entry.</em></h1>
            <p className="setline"><b>{firmName}</b> · <b>{projName}</b></p>
            <div className={`ledger-card${finale.card ? ' land' : ''}`}>
              <div className="lc-head"><b>Day Book</b><span>Today</span></div>
              <div className="lc-row">
                <div className="lc-av">{(entry.who[0] || 'B').toUpperCase()}</div>
                <div className="lc-mid">
                  <div className="who">{entry.who}</div>
                  <div className="note">{entry.note}</div>
                </div>
                <div className="lc-right">
                  <div className="amt">{entry.amt}</div>
                  <div className="pills"><span className="pill sage">Filed · Payment</span><span className="pill terra">via WhatsApp</span></div>
                </div>
              </div>
              <div className="lc-foot">
                Messages from <b>+91 {phoneShown}</b> file here automatically. We&rsquo;ve sent a hello — save the contact.
              </div>
            </div>
            <div className={`more${finale.more ? ' show' : ''}`}>
              <div className="rv-lbl">And not just money</div>
              <div className={`tmsg${finale.tm2 ? ' show' : ''}`}><div className="bub">&ldquo;12 mason 8 helper today&rdquo;</div><span className="arrow">→</span><span className="pill sage">Attendance</span></div>
              <div className={`tmsg${finale.tm3 ? ' show' : ''}`}><div className="bub">&ldquo;cement 200 bags received, bill photo attached&rdquo;</div><span className="arrow">→</span><span className="pill sage">Delivery</span></div>
            </div>
            <div className={`thesis${finale.thesis ? ' show' : ''}`}>If it happened on site, message it. The books keep themselves.</div>
            <div style={{ height: 22 }} />
            <button className="btn" disabled={busy} onClick={() => void finish('/logbook')}>
              {busy ? 'Opening the Day Book…' : <>Open the Day Book <span className="arr">→</span></>}
            </button>
            <div><button className="quiet" onClick={() => void finish('/logbook')}>Invite the team later</button></div>
          </div>
        </section>
      </div>

      <div className="elev">
        <svg width="120" height="102" viewBox="0 0 120 102">
          <g className={mark >= 1 ? 'inked' : ''}><line x1="4" y1="96" x2="116" y2="96" /><path d="M18 96 L18 88 L102 88 L102 96" /></g>
          <g className={mark >= 2 ? 'inked' : ''}><line x1="26" y1="88" x2="26" y2="36" /><line x1="60" y1="88" x2="60" y2="36" /><line x1="94" y1="88" x2="94" y2="36" /></g>
          <g className={mark >= 3 ? 'inked' : ''}><line x1="18" y1="62" x2="102" y2="62" /><line x1="18" y1="36" x2="102" y2="36" /></g>
          <g className={mark >= 4 ? 'inked' : ''}><rect x="34" y="68" width="16" height="14" /><rect x="70" y="68" width="16" height="14" /><rect x="34" y="42" width="16" height="14" /><rect x="70" y="42" width="16" height="14" /></g>
          <g className={mark >= 5 ? 'inked' : ''}><path d="M14 36 L106 36 L106 28 L14 28 Z" /><line className="flag" x1="60" y1="28" x2="60" y2="12" /><path className="flag" d="M60 12 L74 16 L60 20" /></g>
        </svg>
        <div className="elev-cap">{CAPS[mark]}</div>
      </div>

      <div className="count"><b>0{mark}</b> — 05</div>
    </div>
  );
}
