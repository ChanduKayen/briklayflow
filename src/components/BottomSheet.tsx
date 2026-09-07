import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSheetDrag } from '../lib/sheetDrag';

type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** When true, sheet is also reachable above md. Defaults to mobile-only. */
  desktopAllowed?: boolean;
  /** Max sheet height as a vh fraction (default 85). */
  maxHeightVh?: number;
  /** Override className for the outer scrim container. */
  className?: string;
};

/**
 * Mobile bottom sheet. Slides up from the bottom of the screen with a spring
 * curve. Renders to a portal so it escapes overflow/transform stacking contexts.
 *
 * Dismissal: scrim tap, swipe down anywhere on the sheet, or onClose() from the consumer
 * (e.g. an item click). The swipe is the app-wide gesture in lib/sheetDrag, so it behaves the
 * same here as on every hand-rolled sheet — and it works from the body, not only the 12px
 * handle, which was the only part of this sheet that ever answered a thumb.
 */
export default function BottomSheet({
  open,
  onClose,
  title,
  children,
  desktopAllowed = false,
  maxHeightVh = 85,
  className,
}: BottomSheetProps) {
  // Mount lazily so the slide-down (close) animation can play before unmount.
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const sheetRef = useSheetDrag<HTMLDivElement>(onClose, open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Next frame: flip to visible so transition triggers.
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
    const t = window.setTimeout(() => setMounted(false), 320);
    return () => window.clearTimeout(t);
  }, [open]);

  // Lock background scroll while open.
  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mounted]);

  // Escape key dismisses.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  const hiddenAboveDesktop = desktopAllowed ? '' : 'md:hidden';

  return createPortal(
    <div
      className={`fixed inset-0 z-[100] ${hiddenAboveDesktop} ${className ?? ''}`}
      aria-modal="true"
      role="dialog"
    >
      {/* Scrim */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/35 backdrop-blur-[2px] transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
      />
      {/* Sheet */}
      <div
        ref={sheetRef}
        className={`absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-elevation-16 flex flex-col will-change-transform transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${visible ? 'translate-y-0' : 'translate-y-full'}`}
        style={{
          paddingBottom: 'env(safe-area-inset-bottom)',
          maxHeight: `${maxHeightVh}vh`,
        }}
      >
        {/* Drag handle — the sign that the sheet can be pulled down; the gesture itself
            listens on the whole sheet. */}
        <div className="flex justify-center pt-3 pb-2 select-none">
          <div className="w-9 h-1 rounded-full bg-on-surface-variant/25" />
        </div>

        {title && (
          <h2 className="px-5 pb-3 text-[17px] font-semibold text-on-surface">{title}</h2>
        )}

        <div className="flex-1 overflow-y-auto scroll-container">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
