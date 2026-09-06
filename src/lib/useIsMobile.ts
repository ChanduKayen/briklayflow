// useIsMobile — true below a phone breakpoint (default 760px), kept in sync with a matchMedia listener.
// One source of truth for "render the app-native mobile layout" vs the desktop layout.
import { useEffect, useState } from 'react';

export function useIsMobile(maxWidth = 760): boolean {
  const query = `(max-width:${maxWidth}px)`;
  const [is, setIs] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setIs(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return is;
}
