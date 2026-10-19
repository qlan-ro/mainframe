import { useEffect, useState } from 'react';
import type { ToolCallTiming } from '@assistant-ui/react';
import { compactElapsedMs, compactElapsedTicks, formatCompactElapsed } from './compact-timing';

export interface CompactElapsedProps {
  timing?: ToolCallTiming;
  running: boolean;
  reportedDurationMs?: number;
  format?: 'clock' | 'reasoning';
}

export function CompactElapsed({ timing, running, reportedDurationMs, format = 'clock' }: CompactElapsedProps) {
  // The clock is state, not a render-time `Date.now()`: the React Compiler would
  // cache that read alongside `elapsed` and the timer would stop moving.
  const [now, setNow] = useState(() => Date.now());
  const ticking = compactElapsedTicks(timing, running, now);
  useEffect(() => {
    if (!ticking) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [ticking]);
  const elapsed = compactElapsedMs(timing, running, now, reportedDurationMs);
  if (elapsed === undefined) return null;
  const text =
    format === 'reasoning' ? `${running ? '' : 'for '}${Math.floor(elapsed / 1000)}s` : formatCompactElapsed(elapsed);
  return (
    <span
      data-testid="chat-compact-elapsed"
      aria-live="off"
      className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground"
    >
      {text}
    </span>
  );
}
