/**
 * A bottom sheet you can swipe down to dismiss. Styling stays with the caller — this only adds
 * the gesture — so a design's own `.sheet` CSS is untouched and every sheet in the app closes
 * the same way.
 */
import type { ReactNode } from 'react';
import { useSheetDrag } from '../lib/sheetDrag';

export default function DragSheet({
  open, onDismiss, className, children, ...rest
}: {
  open: boolean;
  onDismiss: () => void;
  className?: string;
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'className' | 'children'>) {
  const ref = useSheetDrag<HTMLDivElement>(onDismiss, open);
  return <div ref={ref} className={className} {...rest}>{children}</div>;
}
