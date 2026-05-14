import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Link } from 'react-router-dom';

interface PeekModalProps {
  title: string;
  subtitle?: string;
  fullPageHref: string;
  onClose: () => void;
  children: ReactNode;
}

export function PeekModal({ title, subtitle, fullPageHref, onClose, children }: PeekModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full sm:w-[700px] max-h-[90vh] sm:max-h-[85vh] flex flex-col
                   bg-surface rounded-t-2xl sm:rounded-2xl shadow-2xl
                   animate-peek-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-outline-variant/20 shrink-0">
          <div>
            <p className="text-[15px] font-semibold text-on-surface leading-tight">{title}</p>
            {subtitle && <p className="text-[12px] text-on-surface-variant mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-3 ml-4 shrink-0">
            <Link
              to={fullPageHref}
              className="text-[12px] text-primary hover:underline flex items-center gap-1 font-medium"
              onClick={onClose}
            >
              Open full ↗
            </Link>
            <button
              onClick={onClose}
              className="text-on-surface-variant hover:text-on-surface w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-container-high transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-5">
          {children}
        </div>
      </div>
    </div>
  );
}
