/**
 * navAction — the mobile action capsule's state, driven from outside.
 *
 * The capsule above the nav bar is the same object whether it is idle or reporting a save, exactly as
 * the reference prototype spells it out: filled = alive · hollow = not connected · clay = working ·
 * sage = done · breath = working · one shake = no. A save path calls `navAction.working('Filing')`
 * and then `done` / `failed` / `offline`; MobileNavBar subscribes and wears it.
 */
export type NavActionPhase = 'idle' | 'working' | 'done' | 'failed' | 'offline' | 'draft';
export type NavActionState = { phase: NavActionPhase; label: string; cls: string; retry?: () => void };
const IDLE: NavActionState = { phase: 'idle', label: '', cls: '' };

let actionState: NavActionState = IDLE;
const listeners = new Set<(s: NavActionState) => void>();
let actionTimers: ReturnType<typeof setTimeout>[] = [];
const clearActionTimers = () => { actionTimers.forEach(clearTimeout); actionTimers = []; };
const later = (fn: () => void, ms: number) => { actionTimers.push(setTimeout(fn, ms)); };
const emit = (s: NavActionState) => { actionState = s; listeners.forEach((f) => f(s)); };

/**
 * Drive the action capsule from a real save. `working('Filing')` breathes, says "Still filing" after
 * four seconds, and waits; `done('Filed ₹24,000')` turns sage, draws the tick and hands back to idle;
 * `failed('Couldn\'t file · Retry', retry)` shakes once and goes hollow — a tap retries;
 * `offline()` is hollow at once and settles into "Resume draft".
 */
export const navAction = {
  working(label: string) {
    clearActionTimers();
    emit({ phase: 'working', label, cls: 'working' });
    later(() => { if (actionState.phase === 'working') emit({ ...actionState, label: 'Still ' + label.toLowerCase(), cls: 'working slow' }); }, 4000);
  },
  done(label: string) {
    clearActionTimers();
    emit({ phase: 'done', label, cls: 'done' });
    later(() => emit(IDLE), 1900);
  },
  failed(label: string, retry?: () => void) { clearActionTimers(); emit({ phase: 'failed', label, cls: 'hollow no', retry }); },
  offline(label = 'Offline · kept as draft', resume?: () => void) {
    clearActionTimers();
    emit({ phase: 'offline', label, cls: 'hollow' });
    later(() => emit({ phase: 'draft', label: 'Resume draft', cls: 'draft', retry: resume }), 2600);
  },
  reset() { clearActionTimers(); emit(IDLE); },
  subscribe(f: (s: NavActionState) => void) { listeners.add(f); return () => { listeners.delete(f); }; },
  get state() { return actionState; },
};

