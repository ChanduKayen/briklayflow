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

export function DataField({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant mb-0.5">{label}</p>
      <p className={`text-[13px] text-on-surface ${mono ? 'font-data-mono' : ''}`}>{value || '—'}</p>
    </div>
  );
}
