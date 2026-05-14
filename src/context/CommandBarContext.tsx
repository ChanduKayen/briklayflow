import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';

export type PlaceholderType = 'project' | 'person' | 'work order' | 'vendor' | 'transaction';

export interface PlaceholderItem {
  text: string;
  type: PlaceholderType;
}

interface CommandBarContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  placeholderPool: PlaceholderItem[];
}

const CommandBarContext = createContext<CommandBarContextValue | null>(null);

const FALLBACK_POOL: PlaceholderItem[] = [
  { text: 'DSR Classé Constructions', type: 'project' },
  { text: 'Block A Foundation Works', type: 'work order' },
  { text: 'Rajan Contractors', type: 'person' },
  { text: 'TXN-2024-001', type: 'transaction' },
  { text: 'Site Electrical Main Panel', type: 'vendor' },
];

export function CommandBarProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [placeholderPool, setPlaceholderPool] = useState<PlaceholderItem[]>(FALLBACK_POOL);
  const fetchedRef = useRef(false);

  const open  = () => setIsOpen(true);
  const close = () => setIsOpen(false);
  const toggle = () => setIsOpen(o => !o);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    (async () => {
      try {
        const [projRes, stkRes, woRes, poRes, txnRes] = await Promise.all([
          supabase.from('projects').select('name').eq('status', 'Active').limit(6),
          supabase.from('stakeholders').select('name').limit(8),
          supabase.from('work_orders').select('wo_id').in('status', ['Active', 'Issued', 'Assigned']).limit(6),
          supabase.from('purchase_orders').select('po_id').not('status', 'in', '("Tallied","Cancelled")').limit(5),
          supabase.from('transactions').select('txn_id').order('date', { ascending: false }).limit(5),
        ]);

        const pool: PlaceholderItem[] = [
          ...(projRes.data || []).map(p => ({ text: p.name as string, type: 'project' as const })),
          ...(stkRes.data  || []).map(s => ({ text: s.name as string, type: 'person'  as const })),
          ...(woRes.data   || []).map(w => ({ text: w.wo_id as string, type: 'work order' as const })),
          ...(poRes.data   || []).map(p => ({ text: p.po_id as string, type: 'vendor'  as const })),
          ...(txnRes.data  || []).map(t => ({ text: t.txn_id as string, type: 'transaction' as const })),
        ];

        if (pool.length > 0) {
          for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
          }
          setPlaceholderPool(pool);
        }
      } catch {
        // keep fallback
      }
    })();
  }, []);

  return (
    <CommandBarContext.Provider value={{ isOpen, open, close, toggle, placeholderPool }}>
      {children}
    </CommandBarContext.Provider>
  );
}

export function useCommandBar() {
  const ctx = useContext(CommandBarContext);
  if (!ctx) throw new Error('useCommandBar must be inside CommandBarProvider');
  return ctx;
}
