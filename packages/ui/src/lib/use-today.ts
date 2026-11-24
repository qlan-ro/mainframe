/**
 * The start of the local day, as state: it changes at midnight and at no other
 * time, so day-bucketed lists re-render once a day rather than on every tick.
 * Polled, because a timer set for midnight drifts across a sleep.
 */
import { useEffect, useState } from 'react';
import { NOW_TICK_MS } from './use-now';

function startOfToday(): number {
  return new Date().setHours(0, 0, 0, 0);
}

export function useToday(): number {
  const [today, setToday] = useState(startOfToday);
  useEffect(() => {
    const timer = setInterval(() => setToday(startOfToday()), NOW_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return today;
}
