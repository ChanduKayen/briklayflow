/**
 * BackLink — a quiet, elegant "back to <list>" affordance for detail pages
 * (transaction / PO / WO). Muted by default; on hover the label warms and the
 * arrow nudges left, so the gesture reads before you've even clicked. The
 * caller passes the resolved destination (respecting project vs. global origin).
 */
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export function BackLink({ to, label = 'Back', className = '' }: { to: string; label?: string; className?: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      aria-label={`Back to ${label}`}
      className={`group inline-flex items-center gap-1.5 text-[12.5px] font-medium text-on-surface-variant/60 hover:text-on-surface transition-colors duration-200 ${className}`}
    >
      <ArrowLeft size={15} strokeWidth={2.2} className="transition-transform duration-200 ease-out group-hover:-translate-x-1" />
      <span>{label}</span>
    </button>
  );
}
