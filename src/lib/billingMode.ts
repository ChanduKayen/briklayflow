import { useState } from 'react';

export type BillingMode = 'standalone' | 'integrated';

const KEY = 'bk_billing_mode';

export function useBillingMode(): [BillingMode, (m: BillingMode) => void] {
  const [mode, setMode] = useState<BillingMode>(
    () => (localStorage.getItem(KEY) as BillingMode) ?? 'standalone',
  );

  const update = (m: BillingMode) => {
    localStorage.setItem(KEY, m);
    setMode(m);
  };

  return [mode, update];
}

export function getBillingMode(): BillingMode {
  return (localStorage.getItem(KEY) as BillingMode) ?? 'standalone';
}
