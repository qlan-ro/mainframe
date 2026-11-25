/**
 * activity-status — what an activity row says at its end, what kind of work it
 * is, and the order rows come in. Pure and React-free.
 */
import type { ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import { neutralizedRun } from '@/features/chat/workflow/workflow-agent-view';
import { runTimeline } from '@/features/chat/workflow/workflow-phase-view';
import { formatRunDuration } from '@/features/chat/workflow/workflow-progress';
import { isOngoing, type ActivityEntry, type ActivityKind, type ActivityState } from './activity-model';

export const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  workflow: 'Workflow',
  subagent: 'Agent',
  delegated: 'Delegated task',
  monitor: 'Monitor',
  scheduled: 'Scheduled',
  command: 'Background command',
  background: 'Background task',
};

export interface ActivityStatus {
  tone: 'running' | 'needs-you' | 'failed' | 'plain';
  text: string;
}

const plain = (text: string): ActivityStatus => ({ tone: 'plain', text });

function scheduledText(row: ActivityEntry, now: number): string {
  if (row.recurring) return 'recurring';
  if (row.nextAt === undefined) return 'scheduled';
  return row.nextAt > now ? `in ${formatRunDuration(row.nextAt - now)}` : 'due';
}

function runningText(row: ActivityEntry, now: number, run: ClaudeWorkflowRun | undefined): string {
  if (run && run.phases.length > 0) {
    const reached = runTimeline(neutralizedRun(run, now)).shown.length;
    return `phase ${Math.max(1, reached)} of ${run.phases.length}`;
  }
  return formatRunDuration(now - row.startedAt);
}

export function activityStatus(row: ActivityEntry, now: number, run?: ClaudeWorkflowRun): ActivityStatus {
  switch (row.state) {
    case 'running':
      return { tone: 'running', text: runningText(row, now, run) };
    case 'needs-you':
      return { tone: 'needs-you', text: 'needs you' };
    case 'failed':
      return { tone: 'failed', text: 'failed' };
    case 'scheduled':
      return plain(scheduledText(row, now));
    case 'completed':
      return plain(
        row.endedAt ? new Date(row.endedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'done',
      );
    default:
      return plain(row.state);
  }
}

const ORDER: Partial<Record<ActivityState, number>> = { 'needs-you': 0, running: 1, queued: 2, scheduled: 3 };

export interface ActivityGroups {
  /** Needs-you first, then running, queued, scheduled. */
  ongoing: ActivityEntry[];
  /** Finished work, the latest first. */
  earlier: ActivityEntry[];
  failed: number;
}

export function groupActivity(entries: readonly ActivityEntry[]): ActivityGroups {
  const earlier = entries
    .filter((row) => !isOngoing(row.state))
    .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt));
  return {
    ongoing: entries.filter((row) => isOngoing(row.state)).sort((a, b) => ORDER[a.state]! - ORDER[b.state]!),
    earlier,
    failed: earlier.filter((row) => row.state === 'failed').length,
  };
}
