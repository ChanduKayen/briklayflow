// Per-project purchase orders — same reference list as /purchase-orders, scoped to this project.
import { useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import POListSheet from '../components/po/POListSheet';

export default function ProjectPurchaseOrders(_props: { session: Session }) {
  const { projectId } = useParams<{ projectId: string }>();
  return <POListSheet projectId={projectId} />;
}
