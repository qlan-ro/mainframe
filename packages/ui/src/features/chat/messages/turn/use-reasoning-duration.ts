/**
 * How long a thought took, measured live: no provider reports it. A thought
 * never observed running (history) has no duration, and neither has one under
 * a second.
 */
import { useEffect, useRef, useState } from 'react';

export function useReasoningDuration(running: boolean): number | undefined {
  const startRef = useRef<number | null>(null);
  const [duration, setDuration] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (running) {
      if (startRef.current === null) startRef.current = Date.now();
      setDuration(undefined);
      return;
    }
    if (startRef.current !== null) {
      const seconds = Math.round((Date.now() - startRef.current) / 1000);
      startRef.current = null;
      if (seconds >= 1) setDuration(seconds);
    }
  }, [running]);

  return duration;
}
