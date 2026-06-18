/**
 * Start on WhatsApp — outbound onboarding for a WhatsApp-first product.
 *
 * Two presentations share one brain (the module functions below):
 *
 *  • StartOnWhatsAppButton — the inline pill used in the Day Book invitation banner.
 *    No card. The button does everything in place: a registered user is taken
 *    straight to WhatsApp on tap; an unregistered one watches the pill morph into a
 *    number field, types it, and is taken straight to WhatsApp once it resolves.
 *  • StartOnWhatsApp — the same flow as a small sheet, for page headers / empty
 *    states (Ledger, Logbook) where an inline-expanding field doesn't fit.
 *
 * Either way: first time on a number we send the approved
 * `teammate_welcome_to_whatsapp_utility` template (a utility template delivers
 * unprompted) to greet/confirm them; returning users just get "Hi Briklay". The
 * reads and writes go through SECURITY DEFINER RPCs because RLS on
 * wa_registered_numbers is admin-only — a plain member can't see/add their own row.
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X, Check, ArrowRight, Loader2, ExternalLink } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useOrgId } from '../../lib/auth/AuthProvider';
import { V, WA, font, serif, nums, terraGrad, T } from './tokens';
import { WhatsAppGlyph } from './atoms';

// Briklay's WhatsApp business number — hardcoded (it doesn't change). Single source
// of truth, so a stale env can't override where "Open WhatsApp" sends people.
const BRIKLAY_WA = '917330872705';
const briklayChat = (text: string) => `https://wa.me/${BRIKLAY_WA}?text=${encodeURIComponent(text)}`;

const onlyDigits = (s: string) => s.replace(/\D/g, '');
const local10 = (s: string) => onlyDigits(s).slice(-10);
const prettyPhone = (p: string) => { const d = local10(p); return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : d; };

export type Reg = { phone: string; name: string; welcomed: boolean };

// ── The brain: three plain async ops, shared by both presentations ──────────────

/** Does the caller already have a number on file IN THIS ORG? null = no (or the RPC
 *  isn't there yet, in which case we fall back to asking for the number). Org-scoped
 *  so a number registered in another org doesn't read as "already on" here. */
async function checkRegistration(orgId?: string): Promise<Reg | null> {
  const { data, error } = await supabase.rpc('wa_my_registration', { p_org_id: orgId ?? null });
  if (error) return null;
  const r = data as { has_number?: boolean; phone?: string; name?: string; welcomed?: boolean } | null;
  if (!r?.has_number || !r.phone) return null;
  return { phone: r.phone, name: r.name || 'there', welcomed: !!r.welcomed };
}

/** First-time greet for an already-registered number. Fire-and-forget so the
 *  WhatsApp hand-off never waits on it; welcomed_at stays NULL if the send fails so
 *  a later tap retries. */
function greetOnce(r: Reg, onWelcomed?: () => void) {
  if (r.welcomed) return;
  supabase.functions
    .invoke('send-template', { body: { templateKey: 'teammate_welcome', to: r.phone, params: { name: r.name } } })
    .then(({ data, error }) => {
      if (error || (data && data.ok === false)) return;
      supabase.rpc('wa_mark_welcomed', { p_phone: r.phone });
      onWelcomed?.();
    });
}

/** Register the caller's own typed number into THIS ORG, send the one-time welcome,
 *  stamp it. Returns the resolved Reg or throws with a human message. */
async function registerNumber(phoneInput: string, orgId?: string): Promise<Reg> {
  const { data, error } = await supabase.rpc('wa_self_register', { p_phone: onlyDigits(phoneInput), p_org_id: orgId ?? null });
  if (error) throw new Error(error.message);
  const res = data as { ok: boolean; error?: string; phone?: string; name?: string; needs_welcome?: boolean };
  if (!res?.ok) throw new Error(res?.error || 'Could not register your number');

  const to = res.phone || ('91' + local10(phoneInput));
  if (res.needs_welcome) {
    const { data: sent, error: fnErr } = await supabase.functions.invoke('send-template', {
      body: { templateKey: 'teammate_welcome', to, params: { name: res.name || 'there' } },
    });
    if (fnErr) {
      let msg = fnErr.message;
      try {
        const ctx = (fnErr as { context?: { json?: () => Promise<{ error?: string }> } }).context;
        const parsed = ctx?.json ? await ctx.json() : null;
        if (parsed?.error) msg = parsed.error;
      } catch { /* fall back to fnErr.message */ }
      throw new Error(msg || 'Could not send your welcome message');
    }
    if (sent && sent.ok === false) throw new Error(sent.error || 'Could not send your welcome message');
    await supabase.rpc('wa_mark_welcomed', { p_phone: to });
  }
  return { phone: to, name: res.name || 'there', welcomed: true };
}

// ── The inline button (the banner showpiece) ────────────────────────────────────

const SIZES = {
  xs: { padY: 6, padX: 14, glyph: 13, gap: 6, type: T.xs, inputW: '7rem', go: 24 },
  sm: { padY: 8, padX: 16, glyph: 15, gap: 7, type: T.sm, inputW: '7.5rem', go: 26 },
} as const;

const INLINE_CSS = `
.was { position: relative; display: inline-block; }
.was-pill { display: inline-flex; align-items: center; border-radius: 10px; cursor: pointer;
  position: relative; overflow: hidden;
  background: rgba(37,211,102,0.16); border: 1px solid rgba(37,211,102,0.18); color: ${WA};
  transition: background .28s ease, border-color .28s ease, box-shadow .28s cubic-bezier(.2,.7,.2,1), transform .16s cubic-bezier(.2,.7,.2,1); }
.was-pill[data-input="true"] { background: rgba(37,211,102,0.20); border-color: rgba(37,211,102,0.45); }
.was-pill[data-err="true"] { border-color: rgba(217,106,67,0.85); animation: wasShake .34s cubic-bezier(.36,.07,.19,.97); }
/* tactile button feel — only when it's actually a button (not a field, not busy) */
.was-pill[data-tappable="true"] { cursor: pointer; }
.was-pill[data-tappable="true"]:hover { background: rgba(37,211,102,0.26); border-color: rgba(37,211,102,0.40);
  transform: translateY(-1px); box-shadow: 0 8px 22px rgba(37,211,102,0.24); }
.was-pill[data-tappable="true"]:active { transform: translateY(0) scale(.972); box-shadow: 0 2px 8px rgba(37,211,102,0.18); transition-duration: .06s; }
.was-pill[data-tappable="true"]:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(37,211,102,0.16), 0 0 0 1px rgba(37,211,102,0.55); }
/* the leading glyph gives a hair of life on hover */
.was-glyph { display: inline-flex; transition: transform .28s cubic-bezier(.2,.9,.3,1.3); }
.was-pill[data-tappable="true"]:hover .was-glyph { transform: scale(1.08) rotate(-6deg); }
/* width morph: each segment animates 0fr <-> 1fr so the pill grows/shrinks smoothly */
.was-seg { display: grid; transition: grid-template-columns .46s cubic-bezier(.22,.61,.36,1); }
.was-seg[data-open="false"] { grid-template-columns: 0fr; }
.was-seg[data-open="true"]  { grid-template-columns: 1fr; }
.was-clip { overflow: hidden; white-space: nowrap; min-width: 0; display: flex; align-items: center; }
.was-label { font-weight: 500; transition: opacity .26s ease; }
.was-seg[data-open="false"] .was-label { opacity: 0; }
.was-row { opacity: 0; transition: opacity .3s ease .08s; }
.was-seg[data-open="true"] .was-row { opacity: 1; }
.was-prefix { color: rgba(255,255,255,0.55); font-variant-numeric: tabular-nums; }
.was-input { background: transparent; border: none; outline: none; color: #fff; font-variant-numeric: tabular-nums; }
.was-input::placeholder { color: rgba(255,255,255,0.38); }
.was-go { display: inline-flex; align-items: center; justify-content: center; border-radius: 999px;
  background: ${WA}; color: #fff; flex: none; transition: transform .22s cubic-bezier(.2,.9,.3,1.3), opacity .2s ease, box-shadow .2s ease; }
.was-go:not(:disabled):hover { transform: scale(1.08); box-shadow: 0 4px 12px rgba(37,211,102,0.45); }
.was-go:not(:disabled):active { transform: scale(.92); }
.was-go:disabled { opacity: .45; }
/* redirecting — an elegant "opening WhatsApp" beat: glyph breathes, a light sweeps across */
.was-busy-glyph { animation: wasBreath 1.05s ease-in-out infinite; }
.was-sheen { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
.was-sheen::after { content: ''; position: absolute; top: 0; bottom: 0; left: -45%; width: 45%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent);
  animation: wasSheen 1.15s cubic-bezier(.4,0,.2,1) infinite; }
.was-arrow { display: inline-flex; animation: wasNudge 1.15s ease-in-out infinite; }
.was-err { position: absolute; left: 2px; top: calc(100% + 6px); white-space: nowrap;
  animation: wasErrIn .26s ease both; }
@keyframes wasShake { 10%,90% { transform: translateX(-1px); } 30%,70% { transform: translateX(2px); } 50% { transform: translateX(-3px); } }
@keyframes wasErrIn { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: none; } }
@keyframes wasBreath { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.14); opacity: .82; } }
@keyframes wasSheen { 0% { left: -45%; } 60%,100% { left: 115%; } }
@keyframes wasNudge { 0%,100% { transform: translateX(0); } 50% { transform: translateX(3px); } }
@media (prefers-reduced-motion: reduce) {
  .was-seg, .was-label, .was-row, .was-go, .was-glyph, .was-pill { transition: none !important; }
  .was-pill[data-err="true"], .was-busy-glyph, .was-sheen::after, .was-arrow { animation: none !important; }
  .was-pill[data-tappable="true"]:hover, .was-pill[data-tappable="true"]:active { transform: none; }
}
`;

type InlineState = 'idle' | 'input' | 'working' | 'done' | 'redirecting';

export function StartOnWhatsAppButton({ size = 'xs' }: { size?: 'xs' | 'sm' }) {
  const S = SIZES[size];
  const orgId = useOrgId();
  const qc = useQueryClient();
  const [reg, setReg] = useState<Reg | null>(null);
  const [checked, setChecked] = useState(false);     // registration lookup finished
  const [state, setState] = useState<InlineState>('idle');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);     // user tapped before the lookup returned
  const inputRef = useRef<HTMLInputElement>(null);

  // Resolve a tap. `viaNav` = the gesture was already lost to an await (the pending
  // path), so navigate top-level (not popup-blocked) instead of opening a tab.
  const act = (r: Reg | null, viaNav: boolean) => {
    if (r) {
      greetOnce(r, () => setReg({ ...r, welcomed: true }));
      const url = briklayChat('Hi Briklay');
      setState('redirecting');                       // elegant "opening WhatsApp" beat
      if (viaNav) {
        setTimeout(() => { window.location.href = url; }, 620);
      } else {
        window.open(url, '_blank', 'noopener');      // open in-gesture (not popup-blocked)
        setTimeout(() => setState('idle'), 2400);    // settle back if they return to this tab
      }
      return;
    }
    setState('input');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // Look up the caller's number on mount so a tap is instant.
  useEffect(() => {
    let alive = true;
    checkRegistration(orgId).then((r) => { if (alive) { setReg(r); setChecked(true); } });
    return () => { alive = false; };
  }, [orgId]);

  const onTap = () => {
    if (state !== 'idle' || pending) return;
    if (checked) { act(reg, false); return; }     // in-gesture → open a tab
    // Outran the lookup: show "One sec…", finish the check, then hand off top-level.
    setPending(true);
    checkRegistration(orgId).then((r) => { setReg(r); setChecked(true); setPending(false); act(r, true); });
  };

  const valid = onlyDigits(phone).length >= 10;

  const submit = async () => {
    if (!valid || state === 'working') return;
    setError(null);
    setState('working');
    try {
      await registerNumber(phone, orgId);
      qc.invalidateQueries({ queryKey: ['wa_registered_numbers'] });   // refresh "Manage who can send"
      setState('done');                                // check pops in the go-button
      // a held beat on the check → the field collapses back into "Opening WhatsApp" → hand off
      setTimeout(() => {
        setState('redirecting');
        setTimeout(() => { window.location.href = briklayChat('Hi Briklay'); }, 640);
      }, 520);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect you — try again');
      setState('input');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const inputMode = state === 'input' || state === 'working' || state === 'done';
  const redirecting = state === 'redirecting';
  const waiting = pending;
  const tappable = state === 'idle' && !pending;
  const label = redirecting ? 'Opening WhatsApp' : waiting ? 'One sec…' : 'Start on WhatsApp';

  const pad = `${S.padY}px ${S.padX}px`;

  return (
    <div className="was" style={{ ...font, ...S.type }}>
      <style>{INLINE_CSS}</style>
      <div
        className="was-pill"
        data-input={inputMode}
        data-err={!!error}
        data-tappable={tappable}
        role={tappable ? 'button' : undefined}
        tabIndex={tappable ? 0 : undefined}
        onClick={tappable ? onTap : undefined}
        onKeyDown={tappable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(); } } : undefined}
        style={{ padding: pad, gap: S.gap }}
      >
        {redirecting && <span className="was-sheen" aria-hidden />}

        <span className="was-glyph shrink-0" style={{ marginRight: S.gap - 2 }}>
          {redirecting ? <span className="was-busy-glyph inline-flex"><WhatsAppGlyph size={S.glyph} color={WA} /></span>
            : waiting ? <Loader2 size={S.glyph} className="db-spin" color={WA} />
            : <WhatsAppGlyph size={S.glyph} color={WA} />}
        </span>

        {/* label segment — collapses as the field opens */}
        <div className="was-seg" data-open={!inputMode}>
          <span className="was-clip" style={{ gap: 5 }}>
            <span className="was-label">{label}</span>
            {redirecting && <span className="was-arrow"><ExternalLink size={S.glyph - 2} /></span>}
          </span>
        </div>

        {/* field segment — expands in its place */}
        <div className="was-seg" data-open={inputMode}>
          <div className="was-clip was-row" style={{ gap: S.gap }}>
            <span className="was-prefix">+91</span>
            <input
              ref={inputRef}
              inputMode="numeric"
              value={phone}
              disabled={state === 'working' || state === 'done'}
              onChange={(e) => { setPhone(e.target.value); if (error) setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape' && state === 'input') { setState('idle'); setPhone(''); setError(null); } }}
              placeholder="98765 43210"
              className="was-input"
              style={{ width: S.inputW }}
              aria-label="Your WhatsApp number"
            />
            <button
              className="was-go"
              disabled={!valid || state === 'working' || state === 'done'}
              onClick={submit}
              aria-label="Connect on WhatsApp"
              style={{ width: S.go, height: S.go, transform: state === 'done' ? 'scale(1.06)' : undefined }}
            >
              {state === 'working' ? <Loader2 size={S.glyph} className="db-spin" />
                : state === 'done' ? <Check size={S.glyph} strokeWidth={3} className="db-pop" />
                : <ArrowRight size={S.glyph} />}
            </button>
          </div>
        </div>
      </div>

      {error && <span className="was-err" style={{ color: '#F0A088', ...S.type }}>{error}</span>}
    </div>
  );
}

// ── The sheet (page headers / empty states) ─────────────────────────────────────

type Phase = 'checking' | 'has' | 'ask' | 'sending' | 'done';

export function StartOnWhatsApp({ onClose, onManageTeam }: { onClose: () => void; onManageTeam?: () => void }) {
  const orgId = useOrgId();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>('checking');
  const [reg, setReg] = useState<Reg | null>(null);
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savedPhone, setSavedPhone] = useState('');

  useEffect(() => {
    let alive = true;
    checkRegistration(orgId).then((r) => {
      if (!alive) return;
      if (r) { setReg(r); setPhase('has'); } else setPhase('ask');
    });
    return () => { alive = false; };
  }, [orgId]);

  const valid = onlyDigits(phone).length >= 10;

  const submit = async () => {
    if (!valid || phase === 'sending') return;
    setError(null);
    setPhase('sending');
    try {
      const r = await registerNumber(phone, orgId);
      qc.invalidateQueries({ queryKey: ['wa_registered_numbers'] });   // refresh "Manage who can send"
      setSavedPhone(r.phone);
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong — please try again');
      setPhase('ask');
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(30,26,21,0.4)' }} onClick={onClose}>
      <div className="db-drop w-full rounded-2xl p-6" style={{ maxWidth: 380, background: V.surface, border: '1px solid #E3DDD4', boxShadow: '0 20px 50px rgba(30,26,21,0.22)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(37,211,102,0.12)' }}>
              <WhatsAppGlyph size={18} />
            </span>
            <p style={{ color: V.ink, ...serif, fontSize: '1.2rem' }}>Start on WhatsApp</p>
          </div>
          <button onClick={onClose} aria-label="Close"><X size={18} style={{ color: V.faint }} /></button>
        </div>

        {phase === 'checking' && (
          <div className="py-10 flex flex-col items-center db-fade">
            <Loader2 size={22} className="db-spin" style={{ color: WA }} />
            <p className="mt-3" style={{ color: V.faint, ...font, ...T.sm }}>Getting you set up…</p>
          </div>
        )}

        {phase === 'has' && reg && (
          <div className="db-fade">
            <p className="mt-3 leading-relaxed" style={{ color: V.sys, ...font, ...T.sm }}>
              {reg.welcomed
                ? <>You're set on <span style={{ ...nums, color: V.ink }}>+91 {prettyPhone(reg.phone)}</span>. Pick up where you left off — send your payments and bills to Briklay.</>
                : <>You're connected on <span style={{ ...nums, color: V.ink }}>+91 {prettyPhone(reg.phone)}</span>. Open WhatsApp and we'll say a quick hello to get you going.</>}
            </p>
            <a
              href={briklayChat('Hi Briklay')}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => greetOnce(reg, () => setReg({ ...reg, welcomed: true }))}
              className="mt-4 w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl font-medium"
              style={{ background: WA, color: '#fff', ...font, ...T.sm }}
            >
              <WhatsAppGlyph size={15} color="#fff" /> Open WhatsApp <ExternalLink size={14} />
            </a>
          </div>
        )}

        {(phase === 'ask' || phase === 'sending') && (
          <>
            <p className="mt-3 leading-relaxed" style={{ color: V.sys, ...font, ...T.sm }}>
              Enter your WhatsApp number and we'll send you a hello. Reply to it, and your payments, bills, and photos come straight into Briklay — nothing to install.
            </p>

            <div className="mt-4 inline-flex items-center gap-2 px-3 rounded-xl w-full" style={{ background: V.field, height: 46, border: error ? '1px solid rgba(188,75,39,0.5)' : '1px solid transparent', transition: 'border-color .18s' }}>
              <WhatsAppGlyph size={15} color={WA} />
              <span style={{ color: V.faint, ...font, ...nums, ...T.sm }}>+91</span>
              <input
                autoFocus
                inputMode="numeric"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); if (error) setError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                placeholder="98765 43210"
                disabled={phase === 'sending'}
                className="bg-transparent outline-none flex-1 min-w-0"
                style={{ color: V.ink, ...font, ...nums, ...T.sm }}
              />
            </div>

            {error && <p className="mt-2 db-drop" style={{ color: V.terraDeep, ...font, ...T.xs }}>{error}</p>}

            <button
              onClick={submit}
              disabled={!valid || phase === 'sending'}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl font-medium"
              style={{ background: terraGrad, color: '#fff', opacity: valid || phase === 'sending' ? 1 : 0.55, transition: 'opacity .18s', ...font, ...T.sm }}
            >
              {phase === 'sending'
                ? <><Loader2 size={15} className="db-spin" /> Sending your hello…</>
                : <>Send my hello <ArrowRight size={15} /></>}
            </button>

            <p className="mt-2.5 text-center leading-relaxed" style={{ color: V.faint, ...font, ...T.xs }}>
              The number you enter becomes your Briklay number — everything you send comes in under your name.
            </p>
          </>
        )}

        {phase === 'done' && (
          <div className="mt-5 flex flex-col items-center text-center db-fade">
            <span className="w-14 h-14 rounded-full inline-flex items-center justify-center db-ring" style={{ background: 'rgba(37,211,102,0.14)' }}>
              <Check size={26} color={WA} strokeWidth={3} />
            </span>
            <p className="mt-4 font-medium" style={{ color: V.ink, ...serif, fontSize: '1.15rem' }}>Check your WhatsApp</p>
            <p className="mt-1.5 leading-relaxed" style={{ color: V.sys, ...font, ...T.sm }}>
              We just messaged <span style={{ ...nums, color: V.ink }}>+91 {prettyPhone(savedPhone)}</span>. Open it and reply to start sending your payments and bills.
            </p>
            <a
              href={briklayChat('Hi Briklay')}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl font-medium"
              style={{ background: WA, color: '#fff', ...font, ...T.sm }}
            >
              <WhatsAppGlyph size={15} color="#fff" /> Open WhatsApp <ExternalLink size={14} />
            </a>
            <button onClick={onClose} className="mt-2.5 w-full py-2 rounded-xl" style={{ color: V.sys, ...font, ...T.sm }}>Done</button>
          </div>
        )}

        {onManageTeam && phase !== 'done' && phase !== 'checking' && (
          <button onClick={onManageTeam} className="mt-4 w-full text-center" style={{ color: V.faint, ...font, ...T.xs }}>
            See who's on your team →
          </button>
        )}
      </div>
    </div>
  );
}
