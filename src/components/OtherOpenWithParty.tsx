/**
 * "Also open with {party}" — the peek's silent companion to the ledger chip's
 * stacked-card edge. Lists a party's OTHER open obligations of the same kind
 * (balance > 0), excluding the order currently shown, each with a mini burn-down
 * + ₹balance left. Tapping a row peeks to that order. Renders nothing when there
 * are no siblings (or on a fetch error) — it must never blank the peek.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { usePeek } from '../context/PeekContext';

function fmtRupee(n: number) {
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

// A WO's scope is a paragraph; show the opening ~36 chars as a human header.
function summarizeScope(s: string | null | undefined): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return 'Contract';
  return t.length > 36 ? t.slice(0, 36).trimEnd() + '…' : t;
}

type Sibling = { id: string; title: string; total: number; paid: number };

export function OtherOpenWithParty({
  kind,
  stakeholderId,
  currentOrderId,
  partyName,
}: {
  kind: 'WO' | 'PO';
  stakeholderId: string | null | undefined;
  currentOrderId: string;
  partyName: string | null | undefined;
}) {
  const { openPeek } = usePeek();

  const { data: siblings = [] } = useQuery<Sibling[]>({
    queryKey: ['peek_other_open', kind, stakeholderId, currentOrderId],
    enabled: !!stakeholderId,
    queryFn: async () => {
      if (!stakeholderId) return [];
      const rows: Sibling[] = [];

      if (kind === 'WO') {
        // Prefer the `title` column, fall back if that migration isn't applied yet.
        let r: any = await supabase
          .from('work_orders')
          .select('wo_id, title, scope_of_work, order_value')
          .eq('stakeholder_id', stakeholderId)
          .not('status', 'in', '("Closed","Cancelled")');
        if (r.error) {
          r = await supabase
            .from('work_orders')
            .select('wo_id, scope_of_work, order_value')
            .eq('stakeholder_id', stakeholderId)
            .not('status', 'in', '("Closed","Cancelled")');
        }
        for (const w of (r.data ?? []) as any[]) {
          rows.push({
            id: String(w.wo_id),
            title: (w.title?.trim?.() || '') || summarizeScope(w.scope_of_work),
            total: Number(w.order_value) || 0,
            paid: 0,
          });
        }
      } else {
        const r: any = await supabase
          .from('purchase_orders')
          .select('po_id, total_value, order_value, po_line_items(item_name, description)')
          .eq('stakeholder_id', stakeholderId);
        for (const p of (r.data ?? []) as any[]) {
          const lead = (p.po_line_items ?? [])
            .map((it: any) => (it?.item_name || it?.description || '').trim())
            .filter(Boolean)[0];
          rows.push({
            id: String(p.po_id),
            title: lead || 'Purchase',
            total: Number(p.total_value) || Number(p.order_value) || 0,
            paid: 0,
          });
        }
      }

      if (rows.length === 0) return [];

      // Paid-to-date for each candidate order, in one sweep.
      const ids = rows.map((o) => o.id);
      const alloc = await supabase
        .from('txn_allocations')
        .select('order_ref, allocated_amount')
        .in('order_ref', ids);
      const paid: Record<string, number> = {};
      for (const a of (alloc.data ?? []) as any[]) {
        const ref = String(a.order_ref);
        paid[ref] = (paid[ref] || 0) + (Number(a.allocated_amount) || 0);
      }
      for (const o of rows) o.paid = paid[o.id] || 0;

      // Open (balance > 0), excluding the order currently shown.
      return rows.filter((o) => o.id !== currentOrderId && o.total - o.paid > 0);
    },
  });

  if (!siblings.length) return null;

  const noun = kind === 'WO' ? 'contracts' : 'bills';

  return (
    <div>
      <p className="text-[10px] font-semibold tracking-wider text-on-surface-variant uppercase mb-2">
        Also open with {partyName || 'this party'}
        <span className="ml-1.5 font-normal lowercase tracking-normal text-on-surface-variant/70">
          · {siblings.length} other {siblings.length === 1 ? noun.replace(/s$/, '') : noun}
        </span>
      </p>
      <div className="rounded-xl border border-outline-variant/20 overflow-hidden">
        {siblings.map((o, i) => {
          const balance = Math.max(0, o.total - o.paid);
          const pctPaid = o.total > 0 ? Math.min((o.paid / o.total) * 100, 100) : 0;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => openPeek(kind, o.id)}
              className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface-container-low transition-colors ${i > 0 ? 'border-t border-outline-variant/10' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-[12px] text-on-surface truncate">{o.title}</p>
                <p className="text-[10px] text-on-surface-variant font-data-mono mt-0.5">{o.id}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {o.total > 0 && (
                  <span className="h-1 w-10 rounded-full bg-surface-container-highest overflow-hidden">
                    <span className="block h-full rounded-full bg-secondary" style={{ width: `${pctPaid}%` }} />
                  </span>
                )}
                <span className="text-[11px] font-data-mono text-on-surface font-medium whitespace-nowrap">
                  {fmtRupee(balance)} left
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
