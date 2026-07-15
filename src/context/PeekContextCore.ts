import { createContext, useContext } from 'react';

/**
 * THE CONTEXT OBJECT LIVES ALONE, ON PURPOSE.
 *
 * It used to be created in PeekContext.tsx, next to PeekProvider. That file exports a component,
 * so every edit to it — or to anything Vite invalidates through it — re-executes the module and
 * `createContext()` mints a BRAND NEW context object. Components still mounted from the previous
 * module graph (the lazy route chunks, above all) go on reading the OLD object, find no Provider
 * above them, and `usePeek` throws "must be used inside PeekProvider" — on a page that is, in fact,
 * inside the Provider. A hard reload "fixed" it, which is how a real bug hides as a phantom.
 *
 * Two guards, so the identity of this object survives everything:
 *   1. This module exports NO components, so React Fast Refresh has no reason to re-run it when a
 *      component file changes.
 *   2. Even if it were re-run, the object is pinned on globalThis and handed back, not remade.
 */
export type PeekType = 'WO' | 'PO' | 'TRANSACTION' | 'STAKEHOLDER' | 'PROJECT';

export interface PeekState { type: PeekType; id: string; }

export interface PeekContextValue {
  peek: PeekState | null;
  openPeek: (type: PeekType, id: string) => void;
  closePeek: () => void;
  /** Warm a peek's component chunk + primary query so the eventual click paints instantly. */
  prefetchPeek: (type: PeekType, id: string) => void;
}

const PEEK_CONTEXT_KEY = '__briklay_peek_context__';

type ContextCarrier = typeof globalThis & {
  [PEEK_CONTEXT_KEY]?: React.Context<PeekContextValue | null>;
};

const carrier = globalThis as ContextCarrier;

export const PeekContext: React.Context<PeekContextValue | null> =
  carrier[PEEK_CONTEXT_KEY] ??
  (carrier[PEEK_CONTEXT_KEY] = createContext<PeekContextValue | null>(null));

export function usePeek() {
  const ctx = useContext(PeekContext);
  if (!ctx) throw new Error('usePeek must be used inside PeekProvider');
  return ctx;
}
