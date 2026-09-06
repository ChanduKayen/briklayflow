// PoQuickStart — how a purchase order begins on a phone.
//
// The desktop form asks you to type items into a spreadsheet. On site, with one hand, that is the
// slowest of the three things a phone is good at. This puts the other two first: say the order, or
// photograph the quotation. Both land in the same extractor the "Scan bill / quote" button already
// uses, so the order that comes out is identical however it was started — and typing is still one
// tap away for anyone who wants it.
//
// Speech uses the browser's own recogniser (Chrome on Android). It is feature-detected, so on a
// browser without it the card is absent rather than present and dead.
import { useEffect, useRef, useState } from 'react';

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  start: () => void; stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

function recognitionCtor(): (new () => Recognition) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => Recognition) | null;
}

export interface PoQuickStartProps {
  busy: boolean;
  error: string | null;
  /** Extract from a spoken order. */
  onSpoken: (transcript: string) => void;
  /** Extract from a photo or a document. */
  onFile: (file: File) => void;
  /** Skip straight to the item table. */
  onType: () => void;
  tokens: { ink: string; system: string; systemFaint: string; line: string; surface: string; field: string; accent: string; accentDeep: string; accentSoft: string; accentLine: string };
}

export function PoQuickStart({ busy, error, onSpoken, onFile, onType, tokens: t }: PoQuickStartProps) {
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const finalRef = useRef('');
  const camRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const canSpeak = typeof window !== 'undefined' && !!recognitionCtor();

  useEffect(() => () => { try { recRef.current?.stop(); } catch { /* already stopped */ } }, []);

  const stop = () => { try { recRef.current?.stop(); } catch { /* already stopped */ } setListening(false); };

  const listen = () => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    setVoiceErr(null); setHeard(''); finalRef.current = '';
    const rec = new Ctor();
    recRef.current = rec;
    // en-IN keeps Indian material names and numbers far closer than en-US.
    rec.lang = 'en-IN';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const txt = r[0]?.transcript ?? '';
        if (r.isFinal) finalRef.current += txt + ' '; else interim += txt;
      }
      setHeard((finalRef.current + interim).trim());
    };
    rec.onerror = (e) => {
      setListening(false);
      if (e?.error === 'not-allowed') setVoiceErr('Microphone permission is off for this site.');
      else if (e?.error !== 'aborted' && e?.error !== 'no-speech') setVoiceErr('Could not hear that — try again.');
    };
    rec.onend = () => setListening(false);
    try { rec.start(); setListening(true); } catch { setVoiceErr('Could not start the microphone.'); }
  };

  const useWhatIHeard = () => {
    const text = (finalRef.current + ' ' + heard).trim() || heard.trim();
    stop();
    if (text) onSpoken(text);
  };

  const card: React.CSSProperties = {
    background: t.surface, border: `1px solid ${t.line}`, borderRadius: 16,
    padding: '16px 16px', display: 'flex', alignItems: 'center', gap: 13, width: '100%', textAlign: 'left',
    minHeight: 64, WebkitTapHighlightColor: 'transparent',
  };
  const icon = (bg: string, color: string): React.CSSProperties => ({
    width: 42, height: 42, borderRadius: 12, background: bg, color,
    display: 'grid', placeItems: 'center', flexShrink: 0,
  });

  return (
    <div className="poqs">
      <style>{`
        .poqs .qs{transition:transform .14s cubic-bezier(.2,.7,.3,1),border-color .14s ease}
        .poqs .qs:active{transform:scale(.985)}
        .poqs .qs:disabled{opacity:.5}
        @keyframes qs-ring{0%{box-shadow:0 0 0 0 currentColor}70%{box-shadow:0 0 0 12px transparent}100%{box-shadow:0 0 0 0 transparent}}
        .poqs .mic-live{animation:qs-ring 1.6s ease-out infinite}
        @media (prefers-reduced-motion:reduce){.poqs .qs,.poqs .mic-live{transition:none;animation:none}}
      `}</style>

      <p style={{ fontSize: 13, color: t.system, margin: '0 0 10px' }}>
        Start the order the quickest way — you can still change everything afterwards.
      </p>

      {/* ── 1. say it ─────────────────────────────────────────────── */}
      {canSpeak && !listening && (
        <button type="button" className="qs" disabled={busy} onClick={listen}
          style={{ ...card, marginBottom: 10, borderColor: t.accentLine, background: t.accentSoft }}>
          <span style={icon(t.accent, '#fff')}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <rect x="9" y="2.5" width="6" height="11.5" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5" />
            </svg>
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 15.5, fontWeight: 600, color: t.accentDeep }}>Say the order</span>
            <span style={{ display: 'block', fontSize: 12.5, color: t.system, marginTop: 2 }}>“20 bags cement, 5 ton 16mm rod”</span>
          </span>
        </button>
      )}

      {listening && (
        <div style={{ ...card, marginBottom: 10, alignItems: 'flex-start', borderColor: t.accentLine, background: t.accentSoft }}>
          <span className="mic-live" style={{ ...icon(t.accent, '#fff'), color: t.accent }}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round">
              <rect x="9" y="2.5" width="6" height="11.5" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5" />
            </svg>
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase', color: t.accentDeep, fontWeight: 600 }}>Listening…</span>
            <span style={{ display: 'block', fontSize: 14.5, color: t.ink, marginTop: 4, lineHeight: 1.45, minHeight: 21 }}>
              {heard || <span style={{ color: t.systemFaint }}>Name the items and how many of each.</span>}
            </span>
            <span style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" onClick={stop} style={{ height: 42, padding: '0 14px', borderRadius: 11, border: `1px solid ${t.line}`, background: t.surface, color: t.system, fontSize: 13.5, fontWeight: 600 }}>Cancel</button>
              <button type="button" onClick={useWhatIHeard} disabled={!heard.trim()}
                style={{ flex: 1, height: 42, borderRadius: 11, border: 0, background: t.accent, color: '#fff', fontSize: 13.5, fontWeight: 600, opacity: heard.trim() ? 1 : 0.5 }}>
                Use this
              </button>
            </span>
          </span>
        </div>
      )}
      {voiceErr && <p style={{ fontSize: 12.5, color: t.accentDeep, margin: '0 0 10px' }}>{voiceErr}</p>}

      {/* ── 2. photograph it ──────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <button type="button" className="qs" disabled={busy} onClick={() => camRef.current?.click()}
          style={{ ...card, flexDirection: 'column', alignItems: 'flex-start', gap: 9, minHeight: 96 }}>
          <span style={icon(t.field, t.ink)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 8.5h3l1.5-2.2h9L18 8.5h3v11H3z" /><circle cx="12" cy="13.6" r="3.4" />
            </svg>
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: t.ink }}>Photo</span>
            <span style={{ display: 'block', fontSize: 12, color: t.system, marginTop: 1 }}>a quote or a list</span>
          </span>
        </button>
        <button type="button" className="qs" disabled={busy} onClick={() => docRef.current?.click()}
          style={{ ...card, flexDirection: 'column', alignItems: 'flex-start', gap: 9, minHeight: 96 }}>
          <span style={icon(t.field, t.ink)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h4" />
            </svg>
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: t.ink }}>File</span>
            <span style={{ display: 'block', fontSize: 12, color: t.system, marginTop: 1 }}>PDF or image</span>
          </span>
        </button>
      </div>

      {/* capture=environment opens the camera straight away rather than the gallery */}
      <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
      <input ref={docRef} type="file" accept="image/*,.pdf,.txt" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />

      {error && <p style={{ fontSize: 12.5, color: t.accentDeep, margin: '10px 0 0' }}>{error}</p>}

      <button type="button" onClick={onType} disabled={busy}
        style={{ width: '100%', marginTop: 12, minHeight: 46, background: 'none', border: 0, color: t.system, fontSize: 13.5, fontWeight: 600 }}>
        Or type the items yourself →
      </button>
    </div>
  );
}
