import type { Session } from '@supabase/supabase-js';

export default function ProcurementQuotes({ session: _session }: { session: Session }) {
  return (
    <div className="mobile-main-pb px-4 py-6 md:px-8 md:py-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-on-surface tracking-tight" style={{ fontFamily: 'Manrope, sans-serif' }}>
          Quotes
        </h1>
        <p className="text-sm text-on-surface-variant mt-1">Vendor responses to RFQs — compare rates before committing</p>
      </div>

      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-12 h-12 rounded-2xl bg-surface-container flex items-center justify-center mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-on-surface-variant">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14,2 14,8 20,8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10,9 9,9 8,9" />
          </svg>
        </div>
        <p className="text-[15px] font-semibold text-on-surface">Coming in Sprint 2</p>
        <p className="text-sm text-on-surface-variant mt-1 max-w-xs">
          RFQ creation, vendor quote collection, and side-by-side comparison will be built here.
        </p>
      </div>
    </div>
  );
}
