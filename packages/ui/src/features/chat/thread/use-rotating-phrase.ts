import { useEffect, useState } from 'react';

/**
 * Cycle through `phrases` while `active`, advancing one step every `intervalMs`
 * and wrapping last→first. Returns the first phrase when inactive (index reset)
 * or when there is nothing to rotate. The interval is cleared on unmount and
 * whenever `active` flips false, so it never advances after a run stops.
 */
export function useRotatingPhrase(active: boolean, phrases: readonly string[], intervalMs: number): string {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active || phrases.length <= 1) {
      setIndex(0);
      return;
    }
    const id = setInterval(() => setIndex((i) => (i + 1) % phrases.length), intervalMs);
    return () => clearInterval(id);
  }, [active, phrases, intervalMs]);

  return phrases[index] ?? phrases[0] ?? '';
}
