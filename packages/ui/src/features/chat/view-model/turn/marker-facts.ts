/** What an event tool's pill says and opens on (T1g). Pure. */
import { parseApprovedPlanResult } from '../../messages/plan-message';
import { extractResultContent, resolveResultText } from '../../tools/shared/result';
import { settledStatus } from './tool-status';
import { argText } from './tool-values';
import type { LoadedSkill, ToolPart } from './types';
import { displayText, record } from './values';

export type MarkerIcon =
  | 'skill'
  | 'plan'
  | 'plan-approved'
  | 'wakeup'
  | 'cron-create'
  | 'cron-delete'
  | 'cron-list'
  | 'monitor'
  | 'worktree-enter'
  | 'worktree-leave'
  | 'worktree-remove'
  | 'notification';

export interface ScheduledJob {
  readonly id: string;
  readonly schedule: string;
  readonly cadence: string;
  readonly prompt: string;
}

export type MarkerBody =
  | { readonly type: 'markdown'; readonly text: string }
  | { readonly type: 'skill'; readonly path: string; readonly content: string; readonly args: string }
  | { readonly type: 'jobs'; readonly jobs: readonly ScheduledJob[] }
  | { readonly type: 'output'; readonly command: string; readonly text: string }
  | { readonly type: 'note'; readonly text: string; readonly detail?: string }
  /** What the call answered instead of doing it, under what it was going to do. */
  | { readonly type: 'answered'; readonly failed: boolean; readonly text: string; readonly body?: MarkerBody };

export interface MarkerFacts {
  readonly icon: MarkerIcon;
  readonly label: string;
  readonly target?: string;
  readonly mono?: boolean;
  readonly receipt?: string;
  readonly state: 'done' | 'running' | 'failed';
  readonly body?: MarkerBody;
}

type Draft = Omit<MarkerFacts, 'state'>;

export interface MarkerContext {
  readonly pending: ReadonlySet<string>;
  /** Whether the turn can still be going. Left out: yes. */
  readonly live?: boolean;
  readonly skill?: LoadedSkill;
  /** "Auto-Edits": how an approved plan is being carried out. */
  readonly mode?: string;
  /** A monitor that goes on after its call returned. */
  readonly monitoring?: boolean;
}

function parsed(part: ToolPart): unknown {
  try {
    return JSON.parse(extractResultContent(part.result));
  } catch {
    /* expected: most results are prose */
    return undefined;
  }
}

const delay = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  return minutes % 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${Math.floor(minutes / 60)}h`;
};
const note = (text: string, detail?: string): MarkerBody | undefined =>
  text ? { type: 'note', text, detail: detail || undefined } : undefined;
const cadence = (job: Record<string, unknown>) =>
  [job.recurring ? 'recurring' : 'one-shot', job.durable === false ? 'session-only' : ''].filter(Boolean).join(' · ');

function skillMarker(part: ToolPart, { skill }: MarkerContext): Draft {
  const name = argText(part, 'skill') || (skill?.skillName ?? '');
  const lines = skill?.content ? skill.content.replace(/\n$/, '').split('\n').length : 0;
  return {
    icon: 'skill',
    label: 'Used skill',
    target: `/${name.replace(/^\//, '')}`,
    mono: true,
    receipt: lines ? `${lines} ${lines === 1 ? 'line' : 'lines'}` : undefined,
    body: skill?.content
      ? { type: 'skill', path: skill.path, content: skill.content, args: argText(part, 'args') }
      : note(argText(part, 'args')),
  };
}

function planMarker(part: ToolPart, { mode }: MarkerContext): Draft {
  const approved = parseApprovedPlanResult(resolveResultText(part.result).text || undefined);
  const plan = approved ?? argText(part, 'plan');
  if (approved) return approvedPlan(approved, mode);
  return { icon: 'plan', label: 'Updated plan', body: plan ? { type: 'markdown', text: plan } : undefined };
}

export function approvedPlan(plan: string, mode: string | undefined, clearedContext = false): Draft {
  return {
    icon: 'plan-approved',
    label: 'Plan approved',
    target: mode ? `implementing with ${mode}` : undefined,
    receipt: clearedContext ? 'context cleared' : undefined,
    body: { type: 'markdown', text: plan },
  };
}

function jobsOf(entries: readonly unknown[]): ScheduledJob[] {
  return entries.map((entry) => {
    const job = record(entry) ?? {};
    return {
      id: displayText(job.id),
      schedule: displayText(job.humanSchedule ?? job.cron),
      cadence: cadence(job),
      prompt: displayText(job.prompt),
    };
  });
}

function scheduleMarker(part: ToolPart): Draft {
  const result = parsed(part);
  switch (part.toolName) {
    case 'ScheduleWakeup':
      return {
        icon: 'wakeup',
        label: 'Scheduled a wakeup',
        target: `in ${delay(Number(record(part.args)?.delaySeconds) || 0)}`,
        body: note(
          argText(part, 'prompt') || argText(part, 'reason'),
          argText(part, 'prompt') && argText(part, 'reason'),
        ),
      };
    case 'CronCreate': {
      const job = { ...record(part.args), ...record(result) };
      return {
        icon: 'cron-create',
        label: 'Scheduled',
        target: displayText(job.humanSchedule ?? job.cron),
        receipt: cadence(job),
        body: note(argText(part, 'prompt')),
      };
    }
    case 'CronDelete':
      return { icon: 'cron-delete', label: 'Removed schedule', target: argText(part, 'id'), mono: true };
    default: {
      const entries = Array.isArray(result) ? result : record(result)?.jobs;
      // Prose: the CLI's own list, or that there is none.
      if (!Array.isArray(entries))
        return { icon: 'cron-list', label: 'Listed schedules', body: note(resolveResultText(part.result).text) };
      const jobs = jobsOf(entries);
      return {
        icon: 'cron-list',
        label: 'Listed schedules',
        receipt: `${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}`,
        body: jobs.length ? { type: 'jobs', jobs } : undefined,
      };
    }
  }
}

function monitorMarker(part: ToolPart, running: boolean): Draft {
  const { text } = resolveResultText(part.result);
  const command = argText(part, 'command');
  return {
    icon: 'monitor',
    label: running ? 'Monitoring' : 'Monitored',
    target: argText(part, 'description') || command,
    mono: !argText(part, 'description'),
    body: text || command ? { type: 'output', command, text } : undefined,
  };
}

function worktreeMarker(part: ToolPart): Draft {
  const result = record(parsed(part));
  const name = displayText(record(part.args)?.name ?? result?.worktreeBranch ?? result?.worktreePath);
  if (part.toolName === 'EnterWorktree')
    return { icon: 'worktree-enter', label: 'Entered worktree', target: name, mono: true };
  if (argText(part, 'action') === 'remove')
    return { icon: 'worktree-remove', label: 'Removed worktree', target: name, mono: true };
  return { icon: 'worktree-leave', label: 'Left worktree', target: name, mono: true, receipt: 'kept' };
}

function notificationMarker(part: ToolPart): Draft {
  const message = argText(part, 'message');
  return {
    icon: 'notification',
    label: 'Notified',
    target: message,
    receipt: 'sent',
    body: note(message, resolveResultText(part.result).text),
  };
}

function draft(part: ToolPart, context: MarkerContext, running: boolean): Draft {
  switch (part.toolName) {
    case 'Skill':
      return skillMarker(part, context);
    case 'ExitPlanMode':
      return planMarker(part, context);
    case 'Monitor':
      return monitorMarker(part, running);
    case 'EnterWorktree':
    case 'ExitWorktree':
      return worktreeMarker(part);
    case 'PushNotification':
      return notificationMarker(part);
    default:
      return scheduleMarker(part);
  }
}

/** Present tense while the call runs. */
const RUNNING: Partial<Record<string, string>> = {
  Skill: 'Using skill',
  ExitPlanMode: 'Updating plan',
  ScheduleWakeup: 'Scheduling a wakeup',
  CronCreate: 'Scheduling',
  CronDelete: 'Removing schedule',
  CronList: 'Listing schedules',
  EnterWorktree: 'Entering worktree',
  ExitWorktree: 'Leaving worktree',
  PushNotification: 'Notifying',
};

export function markerFacts(part: ToolPart, context: MarkerContext): MarkerFacts {
  const status = settledStatus(part, context.pending, context.live !== false);
  const running = status === 'running' || status === 'awaiting-approval' || context.monitoring === true;
  const facts = draft(part, context, running);
  const text = resolveResultText(part.result).text;
  const answered = (failed: boolean): MarkerBody | undefined =>
    text ? { type: 'answered', failed, text, body: facts.body } : facts.body;
  // Nothing came of it, so it isn't told as done.
  const tried = facts.icon === 'plan' ? facts : { ...facts, label: RUNNING[part.toolName] ?? facts.label };
  if (status === 'failed') return { ...tried, receipt: 'failed', state: 'failed', body: answered(true) };
  if (running) return { ...facts, label: RUNNING[part.toolName] ?? facts.label, receipt: undefined, state: 'running' };
  if (status === 'stopped' || status === 'declined')
    return { ...tried, receipt: status, state: 'done', body: answered(false) };
  // A plan that isn't approved comes back with what to change.
  if (facts.icon === 'plan') return { ...facts, state: 'done', body: answered(false) };
  return { ...facts, state: 'done' };
}
