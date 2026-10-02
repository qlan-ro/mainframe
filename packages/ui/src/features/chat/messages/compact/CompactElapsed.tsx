import { useEffect, useState } from 'react';
import type { ToolCallTiming } from '@assistant-ui/react';
import { compactElapsedMs, formatCompactElapsed } from './compact-timing';

export interface CompactElapsedProps {
  timing?: ToolCallTiming;
  running: boolean;
  reportedDurationMs?: number;
  format?: 'clock' | 'reasoning';
}

export function CompactElapsed({ timing, running, reportedDurationMs, format = 'clock' }: CompactElapsedProps) {
  const [, tick] = useState(0);
  const now = Date.now();
  const elapsed = compactElapsedMs(timing, running, now, reportedDurationMs);
  const ticking = running && timing?.completedAt === undefined && elapsed !== undefined;
  useEffect(() => {
    if (!ticking) return;
    const interval = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(interval);
  }, [ticking]);
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
