// Attendance list — live labour muster per project. The real implementation lives
// in the shared AttendanceSheet component (mirrors the PurchaseOrders/WorkOrders split).
import type { Session } from '@supabase/supabase-js';
import AttendanceSheet from '../components/attendance/AttendanceSheet';

export default function Attendance({ session }: { session: Session }) {
  return <AttendanceSheet session={session} />;
}
