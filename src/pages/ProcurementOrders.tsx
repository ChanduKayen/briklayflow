import type { Session } from '@supabase/supabase-js';

export default function ProcurementOrders({ session: _session }: { session: Session }) {
  return (
    <div className="mobile-main-pb px-4 py-6 md:px-8 md:py-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-on-surface tracking-tight" style={{ fontFamily: 'Manrope, sans-serif' }}>
          Orders
        </h1>
        <p className="text-sm text-on-surface-variant mt-1">Confirmed POs — tracks commitment, delivery and invoicing</p>
      </div>

      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-12 h-12 rounded-2xl bg-surface-container flex items-center justify-center mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-on-surface-variant">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <path d="M16 10a4 4 0 0 1-8 0" />
          </svg>
        </div>
        <p className="text-[15px] font-semibold text-on-surface">Coming in Sprint 2</p>
        <p className="text-sm text-on-surface-variant mt-1 max-w-xs">
          Procurement-sourced POs, GRN tracking, and 3-way match with vendor invoices will be built here.
        </p>
      </div>
    </div>
  );
}
