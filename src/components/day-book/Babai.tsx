/**
 * Babai — Briklay's bookkeeper mascot.
 *
 * The full 3D render (also the WhatsApp profile picture) lives at /babai.png. We
 * use it SPARINGLY, per the agreed UX direction:
 *   • variant="hero"  — large, the whole figure + wave, for first-meet / empty /
 *                       all-caught-up moments. Sits in a soft sage→terra halo.
 *   • variant="badge" — small circular crop framed on his face, a quiet signature
 *                       beside a title or in a calm state. Thin sage ring.
 *
 * Decorative by default (aria-hidden); pass `alt` only where he carries meaning
 * (the first-meet introduction).
 */
import { V } from './tokens';

const SRC = '/babai.png';

export function Babai({ size = 32, variant = 'badge', alt = '', className = '' }: {
  size?: number;
  variant?: 'badge' | 'hero';
  alt?: string;
  className?: string;
}) {
  if (variant === 'hero') {
    return (
      <span className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
        <span aria-hidden className="absolute rounded-full" style={{ inset: '-10%', background: 'radial-gradient(circle at 50% 42%, rgba(47,93,52,0.12), rgba(188,75,39,0.05) 46%, transparent 70%)' }} />
        <img
          src={SRC} alt={alt} aria-hidden={alt ? undefined : true} width={size} height={size}
          className="relative"
          style={{ width: size, height: size, objectFit: 'contain', filter: 'drop-shadow(0 8px 18px rgba(60,46,26,0.16))' }}
        />
      </span>
    );
  }
  // badge — small circular crop framed on the face (the square render is zoomed in)
  return (
    <span
      className={`inline-flex shrink-0 ${className}`}
      style={{ width: size, height: size, borderRadius: '9999px', overflow: 'hidden', border: `1.5px solid ${V.sageWash}`, background: V.field }}
    >
      <img src={SRC} alt={alt} aria-hidden={alt ? undefined : true}
        style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.5)', transformOrigin: '52% 31%' }} />
    </span>
  );
}
