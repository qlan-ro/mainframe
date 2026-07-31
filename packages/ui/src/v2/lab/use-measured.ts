import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Reads one computed style property off every `[data-probe]` element under the
 * returned ref, keyed by its `data-probe` value.
 *
 * The scales are the thing under test, so the lab measures what the browser
 * actually resolved rather than restating the numbers this file hopes are in
 * globals.css — a token that silently failed to apply would otherwise read as a
 * pass.
 */
export function useMeasured(property: 'paddingLeft' | 'fontSize'): {
  hostRef: React.RefObject<HTMLDivElement | null>;
  measured: Record<string, number>;
} {
  const hostRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<Record<string, number>>({});

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const next: Record<string, number> = {};
    for (const el of host.querySelectorAll<HTMLElement>('[data-probe]')) {
      const key = el.dataset.probe;
      if (key) next[key] = Number.parseFloat(getComputedStyle(el)[property]);
    }
    setMeasured(next);
  }, [property]);

  return { hostRef, measured };
}
