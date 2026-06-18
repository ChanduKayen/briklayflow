/**
 * Babai — Briklay's bookkeeper mascot.
 *
 * The full render (also the WhatsApp profile picture) lives at /babai.png. We use
 * it SPARINGLY and UNFRAMED — no circle, no border, no crop — so the whole figure
 * (and his wave) shows and blends into the page background. `variant="hero"` is the
 * large first-meet / empty-state appearance (with a soft grounding shadow);
 * `variant="badge"` is the smaller quiet signature beside a title or calm state.
 *
 * Decorative by default (aria-hidden); pass `alt` only where he carries meaning.
 *
 * NOTE: /babai.png must be a transparent PNG for a clean blend.
 */
const SRC = '/babai.png';

export function Babai({ size = 40, variant = 'badge', alt = '', className = '' }: {
  size?: number;
  variant?: 'badge' | 'hero';
  alt?: string;
  className?: string;
}) {
  return (
    <img
      src={SRC} alt={alt} aria-hidden={alt ? undefined : true}
      width={size} height={size} className={className}
      style={{
        width: size, height: size, objectFit: 'contain', display: 'block',
        ...(variant === 'hero' ? { filter: 'drop-shadow(0 10px 20px rgba(60,46,26,0.14))' } : null),
      }}
    />
  );
}
