/**
 * Briklay's own start/stop cues — a rising perfect fifth to open, the same fifth falling to close.
 * Deliberately not any messaging app's chime: two clean sine notes, short and soft, so it reads as
 * this app acknowledging you rather than a notification arriving.
 *
 * Both are paired with a haptic, because on a noisy site the phone is often the only thing you can
 * feel and the sound is the thing you cannot hear.
 */

const D5 = 587.33;
const A5 = 880.00;

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    type WithWebkit = typeof window & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? (window as WithWebkit).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
    // A context created before the first tap starts suspended; a tap is what got us here.
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

/** One soft sine note with a quick attack and a gentle tail, so it never clicks. */
function note(a: AudioContext, hz: number, at: number, dur: number, peak: number) {
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(hz, a.currentTime + at);
  gain.gain.setValueAtTime(0.0001, a.currentTime + at);
  gain.gain.exponentialRampToValueAtTime(peak, a.currentTime + at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + at + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(a.currentTime + at);
  osc.stop(a.currentTime + at + dur + 0.02);
}

export function haptic(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported, or blocked */ }
}

/** Opening: the fifth rising. Haptic is a light tick then a firmer one — "it is on". */
export function cueStart() {
  const a = audio();
  if (a) { note(a, D5, 0, 0.09, 0.07); note(a, A5, 0.075, 0.13, 0.075); }
  haptic([14, 42, 26]);
}

/** Closing: the same fifth falling, and one settled buzz — "got it". */
export function cueStop() {
  const a = audio();
  if (a) { note(a, A5, 0, 0.08, 0.06); note(a, D5, 0.07, 0.15, 0.065); }
  haptic(28);
}

/** Nothing usable came back — a flat double note and a stutter, clearly not the happy path. */
export function cueFail() {
  const a = audio();
  if (a) { note(a, 392.0, 0, 0.1, 0.05); note(a, 392.0, 0.13, 0.16, 0.05); }
  haptic([18, 60, 18]);
}
