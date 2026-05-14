import { createContext, useContext, useState, lazy, Suspense, type ReactNode } from 'react';

export type PeekType = 'WO' | 'PO' | 'TRANSACTION' | 'STAKEHOLDER' | 'PROJECT';

export interface PeekState { type: PeekType; id: string; }

interface PeekContextValue {
  peek: PeekState | null;
  openPeek: (type: PeekType, id: string) => void;
  closePeek: () => void;
}

export const PeekContext = createContext<PeekContextValue | null>(null);

// Lazy imports break any circular-dependency cycle at module evaluation time
const WOPeekLazy     = lazy(() => import('../components/WOPeek').then(m => ({ default: m.WOPeek })));
const POPeekLazy     = lazy(() => import('../components/POPeek').then(m => ({ default: m.POPeek })));
const TxnPeekLazy   = lazy(() => import('../components/TransactionPeek').then(m => ({ default: m.TransactionPeek })));
const StkPeekLazy   = lazy(() => import('../components/StakeholderPeek').then(m => ({ default: m.StakeholderPeek })));
const ProjPeekLazy  = lazy(() => import('../components/ProjectPeek').then(m => ({ default: m.ProjectPeek })));

export function PeekProvider({ children }: { children: ReactNode }) {
  const [peek, setPeek] = useState<PeekState | null>(null);
  const openPeek = (type: PeekType, id: string) => { if (id) setPeek({ type, id }); };
  const closePeek = () => setPeek(null);

  return (
    <PeekContext.Provider value={{ peek, openPeek, closePeek }}>
      {children}
      <Suspense fallback={null}>
        {peek?.type === 'WO'          && <WOPeekLazy    woId={peek.id}            onClose={closePeek} />}
        {peek?.type === 'PO'          && <POPeekLazy    poId={peek.id}            onClose={closePeek} />}
        {peek?.type === 'TRANSACTION' && <TxnPeekLazy  txnId={peek.id}           onClose={closePeek} />}
        {peek?.type === 'STAKEHOLDER' && <StkPeekLazy  stakeholderId={peek.id}   onClose={closePeek} />}
        {peek?.type === 'PROJECT'     && <ProjPeekLazy projectId={peek.id}       onClose={closePeek} />}
      </Suspense>
    </PeekContext.Provider>
  );
}

export function usePeek() {
  const ctx = useContext(PeekContext);
  if (!ctx) throw new Error('usePeek must be used inside PeekProvider');
  return ctx;
}
