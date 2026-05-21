import type { Session } from '@supabase/supabase-js';

export default function ProcurementRequests({ session: _session }: { session: Session }) {
  return (
    <div className="mobile-main-pb px-4 py-6 md:px-8 md:py-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-on-surface tracking-tight" style={{ fontFamily: 'Manrope, sans-serif' }}>
          Requests
        </h1>
        <p className="text-sm text-on-surface-variant mt-1">Material needs raised by site teams</p>
      </div>

      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-12 h-12 rounded-2xl bg-surface-container flex items-center justify-center mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-on-surface-variant">
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
            <rect x="9" y="3" width="6" height="4" rx="1" />
            <path d="m9 12 2 2 4-4" />
          </svg>
        </div>
        <p className="text-[15px] font-semibold text-on-surface">Coming in Sprint 2</p>
        <p className="text-sm text-on-surface-variant mt-1 max-w-xs">
          Material request creation, listing, and approval workflow will be built here.
        </p>
      </div>
    </div>
  );
}
