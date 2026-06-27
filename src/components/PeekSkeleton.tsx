export function PeekSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-32 bg-surface-container-highest rounded" />
      <div className="h-4 w-48 bg-surface-container-highest rounded" />
      <div className="h-px bg-outline-variant/20" />
      <div className="space-y-2">
        <div className="h-3 w-16 bg-surface-container-high rounded" />
        <div className="h-4 w-full bg-surface-container-high rounded" />
        <div className="h-4 w-3/4 bg-surface-container-high rounded" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-20 bg-surface-container-high rounded" />
        <div className="h-4 w-full bg-surface-container-high rounded" />
      </div>
    </div>
  );
}

/** Skeleton that mirrors the new walnut-hero peeks: a dark hero block + grouped rows. */
export function PeekHeroSkeleton() {
  return (
    <div className="animate-pulse">
      {/* Walnut hero placeholder — full-bleed, matches WalnutHero margins */}
      <div className="-mx-5 -mt-5 mb-5 px-6 pt-5 pb-6 rounded-t-2xl" style={{ background: 'linear-gradient(158deg,#2D2118,#1B140E)' }}>
        <div className="flex justify-between mb-5">
          <div className="h-3 w-24 rounded" style={{ background: 'rgba(243,234,219,.12)' }} />
          <div className="h-5 w-16 rounded-full" style={{ background: 'rgba(243,234,219,.12)' }} />
        </div>
        <div className="h-3 w-20 rounded mb-3" style={{ background: 'rgba(243,234,219,.12)' }} />
        <div className="h-10 w-48 rounded" style={{ background: 'rgba(243,234,219,.16)' }} />
        <div className="h-1.5 w-full rounded-full mt-5" style={{ background: 'rgba(243,234,219,.1)' }} />
      </div>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <div className="space-y-1.5"><div className="h-2.5 w-12 bg-surface-container-high rounded" /><div className="h-4 w-24 bg-surface-container-high rounded" /></div>
          <div className="space-y-1.5"><div className="h-2.5 w-12 bg-surface-container-high rounded" /><div className="h-4 w-24 bg-surface-container-high rounded" /></div>
        </div>
        <div className="space-y-2">
          <div className="h-3 w-20 bg-surface-container-high rounded" />
          <div className="h-12 w-full bg-surface-container-high rounded-xl" />
          <div className="h-12 w-full bg-surface-container-high rounded-xl" />
        </div>
      </div>
    </div>
  );
}

/**
 * Skeleton that mirrors the cream document peeks (WOPeek / POPeek): a single
 * cream paper that bleeds to the modal edges, a masthead (eyebrow + title +
 * headline figure + burn-down) and a couple of body sections. Shows instantly.
 */
export function PeekDocSkeleton() {
  const PAPER = '#FBF7EF';
  const EDGE = '#EDE3D2';
  const bar = 'rgba(60,48,36,.08)';
  const barStrong = 'rgba(60,48,36,.13)';
  return (
    <div className="-mx-5 -my-5 animate-pulse">
      <div
        className="px-6 py-6"
        style={{ background: PAPER, borderTop: `1px solid ${EDGE}`, borderBottom: `1px solid ${EDGE}` }}
      >
        {/* masthead */}
        <div className="flex items-center justify-between mb-4">
          <div className="h-2.5 w-24 rounded" style={{ background: barStrong }} />
          <div className="h-5 w-16 rounded-full" style={{ background: bar }} />
        </div>
        <div className="h-7 w-3/4 rounded mb-2" style={{ background: barStrong }} />
        <div className="h-3 w-1/2 rounded mb-5" style={{ background: bar }} />
        <div className="h-px w-full mb-5" style={{ background: EDGE }} />
        <div className="h-2.5 w-16 rounded mb-2" style={{ background: bar }} />
        <div className="h-9 w-44 rounded mb-3" style={{ background: barStrong }} />
        <div className="h-1.5 w-full rounded-full" style={{ background: bar }} />
        {/* body sections */}
        <div className="mt-8 space-y-3">
          <div className="h-2.5 w-24 rounded" style={{ background: bar }} />
          <div className="h-3.5 w-full rounded" style={{ background: bar }} />
          <div className="h-3.5 w-5/6 rounded" style={{ background: bar }} />
        </div>
        <div className="mt-7 space-y-3">
          <div className="h-2.5 w-28 rounded" style={{ background: bar }} />
          <div className="h-3.5 w-full rounded" style={{ background: bar }} />
          <div className="h-3.5 w-2/3 rounded" style={{ background: bar }} />
        </div>
      </div>
    </div>
  );
}

export function DataField({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant mb-0.5">{label}</p>
      <p className={`text-[13px] text-on-surface ${mono ? 'font-data-mono' : ''}`}>{value || '—'}</p>
    </div>
  );
}
