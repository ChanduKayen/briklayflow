/**
 * The lamp that reveals the blueprint.
 *
 * On a desktop it is the reference's behaviour exactly: a soft circle that eases toward the
 * cursor, with the orb trailing further behind.
 *
 * A phone has no cursor, and a mask that simply sits still turns a live drawing into wallpaper.
 * So on touch it becomes a surveyor's lamp over the sheet:
 *
 *   · it follows the finger while a finger is down, so touching the screen feels like holding it;
 *   · left alone it DRIFTS along a slow Lissajous path, wide and unhurried, so the sheet is
 *     always being read rather than lit once and forgotten;
 *   · where the device reports its orientation — Android does, without asking — a gentle tilt
 *     leans the light, so it reads as resting on the drawing rather than painted on the glass;
 *   · every step change re-aims it at the middle of the screen, so the light arrives before the
 *     words do.
 *
 * Reduced motion gets one wide, still reveal and no loop at all.
 */

export interface Lamp {
  /** Re-aim at a point (a step change aims at the centre). */
  aim: (x: number, y: number) => void;
  /** Open the lamp right out — the finale floods the sheet. */
  flood: () => void;
  stop: () => void;
}

const isTouch = () => typeof window !== 'undefined'
  && (('ontouchstart' in window) || navigator.maxTouchPoints > 0);

export function startLamp(blueprint: HTMLElement, orb: HTMLElement): Lamp {
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touch = isTouch();

  let mx = innerWidth / 2, my = innerHeight / 2;
  let lx = mx, ly = my, ox = mx, oy = my;
  let radius = touch ? 300 : 340, target = touch ? 300 : 340;
  let raf = 0;
  let holding = false;
  let tilt = { x: 0, y: 0 };
  const t0 = performance.now();

  const paint = () => {
    const g = `radial-gradient(circle ${radius}px at ${lx}px ${ly}px, rgba(0,0,0,.95), rgba(0,0,0,.4) 45%, transparent 72%)`;
    blueprint.style.webkitMaskImage = g;
    blueprint.style.maskImage = g;
  };

  if (reduced) {
    radius = 3000; paint();
    return { aim: () => {}, flood: () => {}, stop: () => {} };
  }

  const onMouse = (e: MouseEvent) => { mx = e.clientX; my = e.clientY; };
  const onTouchMove = (e: TouchEvent) => {
    const t = e.touches[0]; if (!t) return;
    mx = t.clientX; my = t.clientY; holding = true;
  };
  const onTouchEnd = () => { holding = false; };
  const onTilt = (e: DeviceOrientationEvent) => {
    // gamma is the left/right lean, beta the front/back. A light hand — this is a nudge, not a joystick.
    tilt = { x: Math.max(-1, Math.min(1, (e.gamma ?? 0) / 45)), y: Math.max(-1, Math.min(1, ((e.beta ?? 45) - 45) / 45)) };
  };

  if (touch) {
    addEventListener('touchstart', onTouchMove, { passive: true });
    addEventListener('touchmove', onTouchMove, { passive: true });
    addEventListener('touchend', onTouchEnd, { passive: true });
    addEventListener('touchcancel', onTouchEnd, { passive: true });
    try { addEventListener('deviceorientation', onTilt, true); } catch { /* not offered */ }
  } else {
    addEventListener('mousemove', onMouse);
  }

  const loop = () => {
    if (touch && !holding) {
      // The drift: two slow sines that never quite repeat, so the path is unpredictable but calm.
      const t = (performance.now() - t0) / 1000;
      mx = innerWidth * (0.5 + 0.27 * Math.sin(t * 0.19) + 0.06 * Math.sin(t * 0.53));
      my = innerHeight * (0.5 + 0.22 * Math.cos(t * 0.14) + 0.05 * Math.cos(t * 0.47));
    }
    // The tilt rides on top of wherever the lamp is headed.
    const tx = mx + tilt.x * innerWidth * 0.16;
    const ty = my + tilt.y * innerHeight * 0.12;

    const ease = holding ? 0.22 : 0.05;      // a finger is followed closely; the drift is languid
    lx += (tx - lx) * ease; ly += (ty - ly) * ease;
    ox += (tx - ox) * 0.045; oy += (ty - oy) * 0.045;
    radius += (target - radius) * 0.05;
    paint();
    orb.style.transform = `translate(${ox - 380}px, ${oy - 380}px)`;
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return {
    aim: (x, y) => { if (!holding) { mx = x; my = y; } },
    flood: () => { target = 2600; },
    stop: () => {
      cancelAnimationFrame(raf);
      removeEventListener('mousemove', onMouse);
      removeEventListener('touchstart', onTouchMove);
      removeEventListener('touchmove', onTouchMove);
      removeEventListener('touchend', onTouchEnd);
      removeEventListener('touchcancel', onTouchEnd);
      try { removeEventListener('deviceorientation', onTilt, true); } catch { /* never bound */ }
    },
  };
}
