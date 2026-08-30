// Contracts list — the exact visual of the purchase-orders list. The real implementation lives in
// the shared WOListSheet component (also usable by the per-project contracts list).
import type { Session } from '@supabase/supabase-js';
import WOListSheet from '../components/wo/WOListSheet';

export default function WorkOrders(_props: { session: Session }) {
  return <WOListSheet />;
}
