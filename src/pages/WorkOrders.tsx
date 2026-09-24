// Contracts list. Desktop → the shared WOListSheet (mirrors the purchase-orders list). Mobile → the
// contracts-mobile artifact port, wired to the same real work orders.
import type { Session } from '@supabase/supabase-js';
import WOListSheet from '../components/wo/WOListSheet';
import ContractsMobile from '../components/work-orders/ContractsMobile';
import { useIsMobile } from '../lib/useIsMobile';

export default function WorkOrders(_props: { session: Session }) {
  const isMobile = useIsMobile();
  return isMobile ? <ContractsMobile /> : <WOListSheet />;
}
