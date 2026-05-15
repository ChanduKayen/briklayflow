import { useState, useEffect } from 'react';

interface Hint { key: string; label: string; }
interface Props { hints: Hint[]; className?: string; }

type Phase = 'showing' | 'exiting' | 'pre-enter' | 'entering';

export function ShortcutTicker({ hints, className }: Props) {
  const [idx, setIdx]     = useState(0);
  const [phase, setPhase] = useState<Phase>('showing');

  useEffect(() => {
    if (hints.length <= 1) return;
    let t: ReturnType<typeof setTimeout>;

    if (phase === 'showing') {
      t = setTimeout(() => setPhase('exiting'), 1500);
    } else if (phase === 'exiting') {
      t = setTimeout(() => {
        setIdx(i => (i + 1) % hints.length);
        setPhase('pre-enter');
      }, 350);
    } else if (phase === 'pre-enter') {
      // One tick: snap element to enter-from position (no transition), then animate in
      t = setTimeout(() => setPhase('entering'), 20);
    } else {
      t = setTimeout(() => setPhase('showing'), 350);
    }

    return () => clearTimeout(t);
  }, [phase, hints.length]);

  const hint = hints[idx];

  const inner: React.CSSProperties =
    phase === 'exiting'
      ? { opacity: 0, transform: 'translateY(-4px)', transition: 'opacity 350ms ease, transform 350ms ease' }
      : phase === 'pre-enter'
      ? { opacity: 0, transform: 'translateY(4px)',  transition: 'none' }
      : { opacity: 1, transform: 'translateY(0)',    transition: 'opacity 350ms ease, transform 350ms ease' };

  return (
    <div
      className={className}
      style={{ height: 20, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, ...inner }}>
        {hint.key === '⟵ hold'
          ? <span style={{ fontSize: 11, fontStyle: 'italic', color: 'rgba(0,0,0,0.35)' }}>{hint.key}</span>
          : <span style={{
              fontFamily: 'monospace',
              fontSize: 11,
              lineHeight: '14px',
              background: 'rgba(0,0,0,0.055)',
              border: '0.5px solid rgba(0,0,0,0.14)',
              borderRadius: 4,
              padding: '1px 5px',
              color: 'rgba(0,0,0,0.5)',
            }}>{hint.key}</span>
        }
        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.38)' }}>
          {hint.label}
        </span>
      </div>
    </div>
  );
}
