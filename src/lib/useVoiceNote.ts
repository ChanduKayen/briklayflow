/**
 * Record what was said, then hand over the audio. Nothing is transcribed in the browser.
 *
 * The browser's speech API was doing the transcription live, and it cannot hold Telugu or Hindi,
 * let alone the code-mix a site actually speaks. It also rewrote the sentence on screen as it
 * changed its mind, which read as the app malfunctioning. So this captures a plain voice note —
 * the same thing a supervisor would send on WhatsApp — and the server transcribes it with the
 * model that was chosen for exactly these languages.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { cueStart, cueStop } from './cue';

const MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of MIMES) {
    try { if (MediaRecorder.isTypeSupported?.(m)) return m; } catch { /* older browsers */ }
  }
  return '';
}

export function canRecordVoice(): boolean {
  return typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== 'undefined';
}

export interface VoiceNoteOptions {
  /** Hard stop, so a phone left in a pocket cannot upload ten minutes of nothing. */
  maxMs?: number;
  /** The finished recording. Never called for a recording with no audio in it. */
  onDone: (audio: Blob, ms: number) => void;
  onError: (message: string) => void;
  /** 0..1, roughly how loud it is right now — for the meter. Called on animation frames. */
  onLevel?: (level: number) => void;
}

export function useVoiceNote(opts: VoiceNoteOptions) {
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);

  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; });

  const recRef    = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const acRef     = useRef<AudioContext | null>(null);
  const rafRef    = useRef(0);
  const tickRef   = useRef(0);
  const capRef    = useRef(0);
  const chunksRef = useRef<Blob[]>([]);

  const release = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = 0; }
    if (capRef.current) { clearTimeout(capRef.current); capRef.current = 0; }
    // Letting go of the tracks is what turns the phone's recording indicator off. It also means
    // the microphone is opened exactly once per recording, so nothing chimes on a loop.
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    const ac = acRef.current; acRef.current = null;
    if (ac) void ac.close().catch(() => { /* already closed */ });
    recRef.current = null;
  }, []);

  useEffect(() => release, [release]);

  const stop = useCallback(() => {
    const r = recRef.current;
    if (!r) return;
    try { if (r.state !== 'inactive') r.stop(); } catch { /* already stopping */ }
  }, []);

  const start = useCallback(async () => {
    if (recRef.current) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      const name = (e as DOMException)?.name;
      optsRef.current.onError(
        name === 'NotAllowedError' ? 'Microphone permission is off'
        : name === 'NotFoundError' ? 'No microphone on this device'
        : 'Could not start the microphone',
      );
      return;
    }
    streamRef.current = stream;

    const mime = pickMime();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch {
      release();
      optsRef.current.onError('This browser cannot record audio');
      return;
    }
    recRef.current = rec;
    chunksRef.current = [];
    const startedAt = Date.now();

    rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      const ms = Date.now() - startedAt;
      const parts = chunksRef.current;
      chunksRef.current = [];
      release();
      setRecording(false);
      setSecs(0);
      cueStop();
      const size = parts.reduce((n, b) => n + b.size, 0);
      // A recording with nothing in it is not worth a round trip.
      if (!size || ms < 400) { optsRef.current.onError('Nothing was recorded'); return; }
      optsRef.current.onDone(new Blob(parts, { type: rec.mimeType || mime || 'audio/webm' }), ms);
    };
    rec.onerror = () => { release(); setRecording(false); setSecs(0); optsRef.current.onError('The recording stopped unexpectedly'); };

    // A live level from the microphone itself, so the meter moves with the voice rather than
    // animating on its own — on a screen that no longer shows words, this is the only proof
    // that anything is being heard.
    try {
      type WithWebkit = typeof window & { webkitAudioContext?: typeof AudioContext };
      const Ctor = window.AudioContext ?? (window as WithWebkit).webkitAudioContext;
      if (Ctor && optsRef.current.onLevel) {
        const ac = new Ctor();
        acRef.current = ac;
        const src = ac.createMediaStreamSource(stream);
        const an = ac.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        const buf = new Uint8Array(an.frequencyBinCount);
        const loop = () => {
          an.getByteTimeDomainData(buf);
          let peak = 0;
          for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
          optsRef.current.onLevel?.(Math.min(1, peak / 64));
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
      }
    } catch { /* no meter; recording is unaffected */ }

    try { rec.start(); } catch { release(); optsRef.current.onError('Could not start recording'); return; }
    cueStart();
    setRecording(true);
    setSecs(0);
    tickRef.current = window.setInterval(() => setSecs(s => s + 1), 1000);
    const cap = optsRef.current.maxMs ?? 90_000;
    capRef.current = window.setTimeout(() => { try { if (recRef.current?.state === 'recording') recRef.current.stop(); } catch { /* gone */ } }, cap);
  }, [release]);

  return { recording, secs, start, stop };
}
