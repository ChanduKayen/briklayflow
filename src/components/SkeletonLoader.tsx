
export function PageSkeleton() {
  return (
    <div className="animate-pulse">
      {/* Mobile view */}
      <div className="md:hidden space-y-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-black/[0.06] p-3">
            <div className="flex items-start justify-between mb-2">
              <div className="h-4 w-3/5 bg-surface-container-high rounded" />
              <div className="h-4 w-1/4 bg-surface-container-high rounded" />
            </div>
            <div className="flex items-center gap-2 mb-2">
              <div className="h-4 w-16 bg-surface-container-high rounded-full" />
              <div className="h-3 w-1/3 bg-surface-container-high rounded" />
            </div>
            <div className="flex items-center justify-between">
              <div className="h-3 w-1/4 bg-surface-container-highest rounded" />
              <div className="h-4 w-12 bg-surface-container-high rounded-full" />
            </div>
          </div>
        ))}
      </div>

      {/* Desktop view */}
      <div className="hidden md:block bg-white rounded-2xl border border-black/[0.06] shadow-sm overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-black/[0.06] bg-surface-container-low/30">
              <th className="w-10 px-3 py-3"><div className="h-3.5 w-3.5 rounded bg-surface-container-highest mx-auto" /></th>
              {[...Array(6)].map((_, i) => (
                <th key={i} className="px-4 py-3"><div className="h-3 w-16 bg-surface-container-highest rounded" /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...Array(12)].map((_, rowIndex) => (
              <tr key={rowIndex} className="border-b border-black/[0.04]">
                <td className="px-3 py-3 text-center"><div className="h-3.5 w-3.5 rounded bg-surface-container-highest mx-auto" /></td>
                <td className="px-4 py-3"><div className="h-4 w-16 bg-surface-container-high rounded" /></td>
                <td className="px-4 py-3"><div className="h-4 w-32 bg-surface-container-high rounded" /></td>
                <td className="px-4 py-3"><div className="h-4 w-20 bg-surface-container-high rounded" /></td>
                <td className="px-4 py-3"><div className="h-4 w-24 bg-surface-container-high rounded" /></td>
                <td className="px-4 py-3"><div className="h-4 w-16 bg-surface-container-high rounded" /></td>
                <td className="px-4 py-3"><div className="h-4 w-12 bg-surface-container-high rounded-full" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function BlockSkeleton({ rows = 3, className = "h-10 rounded-lg w-full" }: { rows?: number, className?: string }) {
  return (
    <div className="animate-pulse space-y-3">
      {[...Array(rows)].map((_, i) => (
        <div key={i} className={`bg-surface-container-high ${className}`} />
      ))}
    </div>
  );
}

export function ListSkeleton() {
  return (
    <div className="animate-pulse space-y-2">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-black/[0.06] p-4 flex flex-col md:flex-row gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-4 w-24 bg-surface-container-highest rounded" />
              <div className="h-3 w-16 bg-surface-container-high rounded" />
            </div>
            <div className="h-3 w-48 bg-surface-container-high rounded" />
          </div>
          <div className="flex md:flex-col items-center md:items-end gap-3 md:gap-1 shrink-0 mt-2 md:mt-0">
            <div className="h-4 w-20 bg-surface-container-highest rounded" />
            <div className="h-3 w-16 bg-surface-container-high rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="animate-pulse mobile-main-pb" style={{ padding: '24px 24px 0', maxWidth: 900 }}>
      <div style={{ marginBottom: 24 }}>
        <div className="h-6 w-48 bg-surface-container-highest rounded mb-2" />
        <div className="h-4 w-32 bg-surface-container-high rounded" />
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-black/[0.06] p-4">
            <div className="h-3 w-1/2 bg-surface-container-high rounded mb-3" />
            <div className="h-6 w-3/4 bg-surface-container-highest rounded mb-2" />
            <div className="h-3 w-2/3 bg-surface-container-high rounded" />
          </div>
        ))}
      </div>

      <div className="h-32 w-full bg-surface-container-high rounded-xl mb-6" />
      
      <div className="h-40 w-full bg-surface-container-high rounded-xl mb-6" />
      
      <div className="space-y-4">
        <div className="flex justify-between">
          <div className="h-3 w-24 bg-surface-container-high rounded" />
          <div className="h-3 w-16 bg-surface-container-high rounded" />
        </div>
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex justify-between py-2 border-b border-black/[0.05]">
            <div className="h-4 w-1/3 bg-surface-container-highest rounded" />
            <div className="h-4 w-16 bg-surface-container-highest rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardsSkeleton() {
  return (
    <div className="animate-pulse" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
      {[...Array(6)].map((_, i) => (
        <div key={i} style={{ background: '#ffffff', borderRadius: 20, border: '1px solid rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <div style={{ height: 3, background: 'rgba(0,0,0,0.06)' }} />
          <div style={{ padding: '20px 20px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <div className="h-5 w-3/4 bg-surface-container-highest rounded mb-2" />
                <div className="h-3 w-1/3 bg-surface-container-high rounded" />
              </div>
              <div className="h-5 w-16 bg-surface-container-high rounded-full shrink-0" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 18 }}>
              <div className="h-3 w-1/2 bg-surface-container-high rounded" />
              <div className="h-3 w-2/3 bg-surface-container-high rounded" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
            {[...Array(3)].map((_, j) => (
              <div key={j} style={{ padding: '14px 8px', borderRight: j < 2 ? '1px solid rgba(0,0,0,0.05)' : 'none' }}>
                <div className="h-4 w-12 bg-surface-container-highest rounded mx-auto mb-2" />
                <div className="h-2.5 w-16 bg-surface-container-high rounded mx-auto" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
