import { useState, useEffect, lazy, Suspense, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PeekContext, type PeekState, type PeekType } from './PeekContextCore';

// The context object and usePeek live in PeekContextCore — a module with no component exports, so
// editing this file can never mint a second context object and orphan the mounted tree. Consumers
// import { usePeek } from './PeekContextCore'; this file exports the Provider and nothing else.

// Lazy-import factories — reused for both <Suspense> rendering AND idle chunk-preloading,
// so the component code is downloaded before any click.
const importWO   = () => import('../components/WOPeek');
const importPO   = () => import('../components/POPeek');
const importTxn  = () => import('../components/TransactionPeek');

// Lazy imports break any circular-dependency cycle at module evaluation time
const WOPeekLazy     = lazy(() => importWO().then(m => ({ default: m.WOPeek })));
const POPeekLazy     = lazy(() => importPO().then(m => ({ default: m.POPeek })));
const TxnPeekLazy   = lazy(() => importTxn().then(m => ({ default: m.TransactionPeek })));
const StkPeekLazy   = lazy(() => import('../components/StakeholderPeek').then(m => ({ default: m.StakeholderPeek })));
const ProjPeekLazy  = lazy(() => import('../components/ProjectPeek').then(m => ({ default: m.ProjectPeek })));

// Idle-time chunk preload: after first paint, warm the WO/PO/Transaction peek code.
function preloadPeekChunks() {
  void importWO();
  void importPO();
  void importTxn();
}

export function PeekProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [peek, setPeek] = useState<PeekState | null>(null);
  const openPeek = (type: PeekType, id: string) => { if (id) setPeek({ type, id }); };
  const closePeek = () => setPeek(null);

  // (a) CHUNK PRELOAD — on first idle, fetch the peek component chunks.
  useEffect(() => {
    const ric = (window as any).requestIdleCallback as
      | ((cb: () => void) => number)
      | undefined;
    if (ric) {
      const id = ric(preloadPeekChunks);
      return () => (window as any).cancelIdleCallback?.(id);
    }
    const t = setTimeout(preloadPeekChunks, 1500);
    return () => clearTimeout(t);
  }, []);

  // (b) DATA PREFETCH — warm the right peek's primary query (lazy-import the module,
  // then call its exported prefetch helper). Chunk + data both ready before the click.
  const prefetchPeek = (type: PeekType, id: string) => {
    if (!id) return;
    if (type === 'WO')          void importWO().then(m => m.prefetchWo(qc, id));
    else if (type === 'PO')     void importPO().then(m => m.prefetchPo(qc, id));
    else if (type === 'TRANSACTION') void importTxn().then(m => m.prefetchTxn(qc, id));
  };

  return (
    <PeekContext.Provider value={{ peek, openPeek, closePeek, prefetchPeek }}>
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
