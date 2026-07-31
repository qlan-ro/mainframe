/**
 * Shared readings for the background-activity chip and its popover. Kept in a leaf
 * module so the pill and the popover content can both use them without importing
 * each other.
 */
import { useEffect, useState } from 'react';
import type { BackgroundActivityTask } from '@qlan-ro/mainframe-types';
import { formatRunDuration } from '../workflow/workflow-progress';

/** "2 agents · 1 task · 1 workflow" — bash and unknown kinds both read as tasks. */
export function summarizeByKind(tasks: BackgroundActivityTask[]): string {
  const counts = { agent: 0, task: 0, workflow: 0 };
  for (const t of tasks) {
    if (t.kind === 'agent') counts.agent += 1;
    else if (t.kind === 'workflow') counts.workflow += 1;
    else counts.task += 1;
  }
  const parts: string[] = [];
  if (counts.agent > 0) parts.push(`${counts.agent} agent${counts.agent === 1 ? '' : 's'}`);
  if (counts.task > 0) parts.push(`${counts.task} task${counts.task === 1 ? '' : 's'}`);
  if (counts.workflow > 0) parts.push(`${counts.workflow} workflow${counts.workflow === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** "<1m", "5m", "1h 12m" — minute-level is enough for a background chip. */
export function formatElapsed(startedAt: number, now: number): string {
  return formatRunDuration(now - startedAt);
}

/** Re-renders every 30s so elapsed times stay fresh while work is live. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [active]);
  return active ? now : Date.now();
}
