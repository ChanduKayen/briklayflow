import { useState, useEffect } from 'react'

interface Hint {
  key: string
  label: string
}

interface Props {
  hints: Hint[]
  className?: string
}

type Phase = 'enter' | 'in' | 'out'

export default function ShortcutTicker({ hints, className }: Props) {
  const [idx, setIdx]     = useState(0)
  const [phase, setPhase] = useState<Phase>('in')

  useEffect(() => {
    if (hints.length <= 1) return

    if (phase === 'in') {
      const t = setTimeout(() => setPhase('out'), 1500)
      return () => clearTimeout(t)
    }
    if (phase === 'out') {
      const t = setTimeout(() => {
        setIdx(i => (i + 1) % hints.length)
        setPhase('enter')
      }, 350)
      return () => clearTimeout(t)
    }
    if (phase === 'enter') {
      const t = setTimeout(() => setPhase('in'), 16)
      return () => clearTimeout(t)
    }
  }, [phase, hints.length])

  const hint = hints[idx]

  return (
    <div style={{ height: 20, overflow: 'hidden' }} className={className}>
      <div style={{
        height: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        transition: 'opacity 350ms ease, transform 350ms ease',
        opacity:   phase === 'in' ? 1 : 0,
        transform: phase === 'enter' ? 'translateY(4px)' : phase === 'out' ? 'translateY(-4px)' : 'translateY(0)',
      }}>
        <span style={{
          fontFamily: 'monospace',
          fontSize: 11,
          lineHeight: 1,
          background: 'rgba(0,0,0,0.05)',
          border: '0.5px solid rgba(0,0,0,0.14)',
          borderRadius: 4,
          padding: '1px 5px',
          flexShrink: 0,
        }}>
          {hint.key}
        </span>
        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', lineHeight: 1 }}>
          {hint.label}
        </span>
      </div>
    </div>
  )
}
