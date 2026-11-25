/**
 * What the composer's activity strip lists (K4): the session's ongoing work
 * only, needs-you first, then running, oldest first in each group. Scheduled
 * wake-ups and finished work stay in the session panel.
 */
import type { ActivityEntry } from '@/features/session-panel/activity-model';

export interface StripItem {
  entry: ActivityEntry;
  needsYou: boolean;
  /** Queued behind other delegated work: ongoing, not yet running. */
  queued: boolean;
}

/** `waitingCalls`: the sub-agents (by their Agent tool call) with a pending request in this chat. */
export function stripItems(entries: readonly ActivityEntry[], waitingCalls: ReadonlySet<string>): StripItem[] {
  const items = entries.flatMap((entry): StripItem[] => {
    const { state } = entry;
    if (state !== 'needs-you' && state !== 'running' && state !== 'queued') return [];
    const call = entry.source?.toolCallId;
    const asking = state === 'running' && call != null && waitingCalls.has(call);
    return [{ entry, needsYou: state === 'needs-you' || asking, queued: state === 'queued' }];
  });
  return items.sort((a, b) => Number(b.needsYou) - Number(a.needsYou) || a.entry.startedAt - b.entry.startedAt);
}

/** "Also ongoing": what is left while a request shows above the composer (K10). */
export function stripSummary(items: readonly StripItem[]): { running: string | null; waiting: string | null } {
  const waiting = items.filter((item) => item.needsYou).length;
  const running = items.length - waiting;
  return {
    running: running > 0 ? `${running} running` : null,
    waiting: waiting > 0 ? `${waiting} more ${waiting === 1 ? 'needs' : 'need'} you` : null,
  };
}
