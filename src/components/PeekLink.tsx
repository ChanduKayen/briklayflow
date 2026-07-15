import type { ReactNode } from 'react';
import { usePeek, type PeekType } from '../context/PeekContextCore';

interface PeekLinkProps {
  type: PeekType;
  id: string;
  href: string;
  children: ReactNode;
  className?: string;
}

export function PeekLink({ type, id, href, children, className }: PeekLinkProps) {
  const { openPeek } = usePeek();
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
          e.preventDefault();
          openPeek(type, id);
        }
      }}
    >
      {children}
    </a>
  );
}
