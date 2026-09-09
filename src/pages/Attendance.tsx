// Attendance list — live labour muster per project. Two surfaces over the same week: the
// desktop sheet (a seven-day grid) and the phone's day-at-a-time muster. Both read and write
// through attendanceApi, so a mark made on either shows up on the other.
import type { Session } from '@supabase/supabase-js';
import { useIsMobile } from '../lib/useIsMobile';
import AttendanceSheet from '../components/attendance/AttendanceSheet';
import AttendanceMobile from '../components/attendance/AttendanceMobile';

export default function Attendance({ session }: { session: Session }) {
  const isMobile = useIsMobile();
  return isMobile ? <AttendanceMobile session={session} /> : <AttendanceSheet session={session} />;
}
