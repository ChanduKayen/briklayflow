import { useState } from 'react';
import { useBillingMode, type BillingMode } from '../lib/billingMode';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export default function Settings() {
  const [companyName, setCompanyName] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [fyStart, setFyStart] = useState('April');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [billingMode, setBillingMode] = useBillingMode();

  const { data: existingPayments } = useQuery({
    queryKey: ['client_payments_count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('client_payments')
        .select('payment_id', { count: 'exact', head: true });
      return count ?? 0;
    },
  });

  const handleBillingModeChange = (next: BillingMode) => {
    if (next === 'integrated' && billingMode === 'standalone' && (existingPayments ?? 0) > 0) {
      const yes = confirm(
        `Create transaction entries for existing ${existingPayments} client payment(s)?\n\nSelect OK to proceed (entries will NOT be backfilled automatically — you can do this manually from the ledger). Select Cancel to abort.`,
      );
      if (!yes) return;
    }
    setBillingMode(next);
  };

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6">
      <div className="mb-stack-lg">
        <h2 className="text-headline-lg-mobile md:text-headline-lg font-headline-lg text-on-background">Settings</h2>
        <p className="text-body-sm text-on-surface-variant mt-1">Configure your company and platform preferences.</p>
      </div>

      <div className="max-w-2xl space-y-stack-lg">

        {/* Company Details */}
        <section className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-card overflow-hidden">
          <div className="px-6 py-4 bg-surface-container-low border-b border-outline-variant/20">
            <h3 className="text-headline-sm font-headline-md text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">business</span>
              Company Details
            </h3>
          </div>
          <div className="p-6 space-y-stack-lg">

            {/* Company Name */}
            <div className="space-y-stack-sm">
              <label className="text-label-caps font-label-caps text-on-surface-variant">COMPANY NAME</label>
              <input
                type="text"
                className="bk-input w-full"
                placeholder="e.g. Briklay Constructions Pvt Ltd"
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
              />
            </div>

            {/* Company Logo */}
            <div className="space-y-stack-sm">
              <label className="text-label-caps font-label-caps text-on-surface-variant">COMPANY LOGO</label>
              <div className="relative">
                <input
                  type="file"
                  id="logo-upload"
                  accept="image/*"
                  onChange={e => setLogoFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                <label
                  htmlFor="logo-upload"
                  className="flex items-center gap-3 px-4 py-3 border-2 border-dashed border-outline-variant/60 rounded-xl cursor-pointer hover:bg-primary/5 hover:border-primary/50 transition-all text-on-surface-variant w-full"
                >
                  <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-primary shrink-0">
                    <span className="material-symbols-outlined">add_photo_alternate</span>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <p className="text-body-sm font-semibold text-on-surface truncate">
                      {logoFile ? logoFile.name : 'Click to upload company logo'}
                    </p>
                    <p className="text-[12px] text-on-surface-variant mt-0.5">PNG, JPG, SVG — recommended 200×200px</p>
                  </div>
                  {logoFile && (
                    <div className="shrink-0 text-secondary flex items-center gap-1 bg-secondary-container/20 px-2 py-1 rounded">
                      <span className="material-symbols-outlined text-[16px]">check_circle</span>
                      <span className="text-[12px] font-bold">Selected</span>
                    </div>
                  )}
                </label>
              </div>
            </div>

          </div>
        </section>

        {/* Financial Preferences */}
        <section className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-card overflow-hidden">
          <div className="px-6 py-4 bg-surface-container-low border-b border-outline-variant/20">
            <h3 className="text-headline-sm font-headline-md text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">account_balance</span>
              Financial Preferences
            </h3>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-stack-lg">

            {/* Currency */}
            <div className="space-y-stack-sm">
              <label className="text-label-caps font-label-caps text-on-surface-variant">CURRENCY</label>
              <select
                className="bk-input w-full"
                value={currency}
                onChange={e => setCurrency(e.target.value)}
              >
                <option value="INR">INR — Indian Rupee (₹)</option>
                <option value="USD">USD — US Dollar ($)</option>
                <option value="EUR">EUR — Euro (€)</option>
                <option value="GBP">GBP — British Pound (£)</option>
                <option value="AED">AED — UAE Dirham (د.إ)</option>
              </select>
            </div>

            {/* Financial Year Start */}
            <div className="space-y-stack-sm">
              <label className="text-label-caps font-label-caps text-on-surface-variant">FINANCIAL YEAR START</label>
              <select
                className="bk-input w-full"
                value={fyStart}
                onChange={e => setFyStart(e.target.value)}
              >
                <option value="April">April (Indian FY)</option>
                <option value="January">January (Calendar Year)</option>
              </select>
            </div>

          </div>
        </section>

        {/* Client Billing Mode */}
        <section className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-card overflow-hidden">
          <div className="px-6 py-4 bg-surface-container-low border-b border-outline-variant/20">
            <h3 className="text-headline-sm font-headline-md text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">description</span>
              Client Billing Mode
            </h3>
          </div>
          <div className="p-6 space-y-3">
            <p className="text-[13px] text-on-surface-variant mb-4">
              Choose how client invoices and receipts interact with the Transaction ledger.
            </p>
            {([
              {
                value: 'standalone' as BillingMode,
                label: 'Standalone',
                desc: 'Client billing lives only in /Invoices. The Transaction ledger shows outgoing payments only.',
              },
              {
                value: 'integrated' as BillingMode,
                label: 'Integrated',
                desc: 'Recording a client receipt also creates an inward entry in the Transaction ledger.',
              },
            ]).map(opt => (
              <label
                key={opt.value}
                className={`flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                  billingMode === opt.value
                    ? 'border-primary/60 bg-primary/5'
                    : 'border-outline-variant/20 hover:border-primary/20'
                }`}
              >
                <input
                  type="radio"
                  name="billingMode"
                  value={opt.value}
                  checked={billingMode === opt.value}
                  onChange={() => handleBillingModeChange(opt.value)}
                  className="mt-0.5 accent-primary shrink-0"
                />
                <div>
                  <p className="text-[13px] font-semibold text-on-surface">
                    {opt.label}
                    {opt.value === 'standalone' && (
                      <span className="ml-2 text-[10px] font-bold text-secondary bg-secondary-container/40 px-1.5 py-0.5 rounded">DEFAULT</span>
                    )}
                  </p>
                  <p className="text-[12px] text-on-surface-variant mt-0.5">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </section>

        {/* Save */}
        <div className="flex justify-end">
          <button
            type="button"
            className="bk-btn flex items-center gap-2 px-8 py-3 rounded-xl"
            onClick={() => {}}
          >
            <span className="material-symbols-outlined text-[18px]">save</span>
            Save Settings
          </button>
        </div>

      </div>
    </div>
  );
}
