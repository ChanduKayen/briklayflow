// Purchase orders list — exact port of the po-list.html reference. The real implementation lives in
// the shared POListSheet component (also used by the per-project PO list).
import type { Session } from '@supabase/supabase-js';
import POListSheet from '../components/po/POListSheet';

export default function PurchaseOrders(_props: { session: Session }) {
  return <POListSheet />;
}
