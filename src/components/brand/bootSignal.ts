/**
 * When the app is actually up.
 *
 * The boot loader has to outlive that moment — the rule completes, the period blinks, then it
 * fades. If it were rendered inside App's own "still booting" branches it would be torn off the
 * screen the instant readiness flipped and none of that would ever be seen. So it lives above
 * App, and App tells it when it is up.
 */
let booted = false;
const listeners = new Set<(v: boolean) => void>();

export const isBooted = () => booted;

export function markBooted() {
  if (booted) return;
  booted = true;
  listeners.forEach(f => f(true));
}

export function onBooted(f: (v: boolean) => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}
