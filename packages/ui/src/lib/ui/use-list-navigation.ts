import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

/** Keyboard nav for a single-column listbox driven from a text input. */
export function useListNavigation(count: number, onConfirm: (index: number) => void) {
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    setActiveIndex(0);
  }, [count]);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => {
          const next = Math.min(i + 1, count - 1);
          rowRefs.current[next]?.scrollIntoView({ block: 'nearest' });
          return next;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => {
          const next = Math.max(i - 1, 0);
          rowRefs.current[next]?.scrollIntoView({ block: 'nearest' });
          return next;
        });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (count > 0) onConfirm(Math.min(activeIndex, count - 1));
      }
    },
    [count, activeIndex, onConfirm],
  );
  return { activeIndex, handleKeyDown, rowRefs };
}
