import { useMemo, useState, type ReactNode } from 'react';
import { SearchCtx, type Scope } from './searchScope';

/** Holds whether the search is up, and which page has lent it its rows. */
export default function SearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope | null>(null);

  const value = useMemo(() => ({
    open, scope,
    openSearch: () => setOpen(true),
    closeSearch: () => setOpen(false),
    publish: setScope,
  }), [open, scope]);

  return <SearchCtx.Provider value={value}>{children}</SearchCtx.Provider>;
}
