import { useRef, useCallback } from 'react';

export function useLongPress(onLongPress: () => void) {
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos  = useRef<{ x: number; y: number } | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    timerRef.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(50);
      onLongPress();
    }, 480);
  }, [onLongPress]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!startPos.current || !timerRef.current) return;
    const dx = e.touches[0].clientX - startPos.current.x;
    const dy = e.touches[0].clientY - startPos.current.y;
    if (Math.sqrt(dx * dx + dy * dy) > 8) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  return { onTouchStart, onTouchMove, onTouchEnd, onContextMenu };
}
