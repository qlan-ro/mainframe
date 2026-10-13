import { useState } from 'react';
import {
  Activity,
  Bot,
  ChevronDown,
  Clock3,
  ExternalLink,
  MessagesSquare,
  Square,
  SquareTerminal,
  Workflow,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { cancelDelegatedTask, readBackgroundTaskOutput, stopBackgroundTask } from '@/lib/api/background-tasks';
import { formatElapsed } from './background-activity-view';
import type { ActivityEntry, ActivityKind } from './activity-model';
import { ActionFooter, DetailFields, type RowAction } from './ActivityRowDetails';

const ICONS: Record<ActivityKind, LucideIcon> = {
  workflow: Workflow,
  subagent: Bot,
  delegated: MessagesSquare,
  monitor: Activity,
  scheduled: Clock3,
  command: SquareTerminal,
};

function timeLabel(row: ActivityEntry, now: number): string {
  if (row.state === 'waiting' && row.nextAt) {
    const remaining = row.nextAt - now;
    return remaining > 0 ? `in ${formatElapsed(now - remaining, now)}` : 'due';
  }
  if (row.state === 'waiting') return 'waiting';
  if (row.endedAt) return new Date(row.endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return formatElapsed(row.startedAt, now);
}

function currentWorkflowPhase(run: ClaudeWorkflowRun): number {
  const active = run.agents.filter((agent) => agent.state === 'start' || agent.state === 'progress');
  return (active.length ? active : run.agents).reduce((index, agent) => Math.max(index, agent.phaseIndex), 0);
}

function detailLine(row: ActivityEntry, run: ClaudeWorkflowRun | undefined): string {
  let detail = row.detail;
  if (row.kind === 'workflow' && run) {
    const active = run.agents.filter((agent) => agent.state === 'start' || agent.state === 'progress').length;
    const phaseIndex = currentWorkflowPhase(run);
    const phase = run.phases.find((candidate) => candidate.index === phaseIndex);
    detail = run.phases.length
      ? [
          phase?.title || 'Running',
          `phase ${phaseIndex + 1} of ${run.phases.length}`,
          active ? `${active} agent${active === 1 ? '' : 's'} running` : '',
        ]
          .filter(Boolean)
          .join(' · ')
      : `${active} agent${active === 1 ? '' : 's'} running`;
  }
  const parts = [detail];
  if (row.kind === 'delegated' || (row.state !== 'running' && row.state !== 'waiting')) parts.push(row.state);
  if (row.usage?.totalTokens) parts.push(`${(row.usage.totalTokens / 1000).toFixed(1)}k tokens`);
  if (row.usage?.toolUses) parts.push(`${row.usage.toolUses} tools`);
  return parts.filter(Boolean).join(' · ');
}

function WorkflowRail({ run }: { run: ClaudeWorkflowRun }) {
  if (!run.phases.length) return null;
  const current = currentWorkflowPhase(run);
  return (
    <div className="mt-1 flex gap-0.5" aria-label={`Workflow phase ${current + 1} of ${run.phases.length}`}>
      {run.phases.map((phase) => (
        <span
          key={phase.index}
          className={cn('h-0.5 min-w-0 flex-1 rounded-full', phase.index <= current ? 'bg-primary' : 'bg-border')}
        />
      ))}
    </div>
  );
}

interface Props {
  row: ActivityEntry;
  now: number;
  chatId: string;
  adapterId?: string;
  run?: ClaudeWorkflowRun;
  onJump: () => void;
  onOpenChild?: () => void;
}

function useRowControls(row: ActivityEntry, chatId: string) {
  const [open, setOpen] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const taskId = row.task?.id;
  const delegatedTaskId = row.delegated?.taskId;
  async function execute(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  const stop = () => taskId && execute(() => stopBackgroundTask(chatId, taskId));
  const cancel = () => delegatedTaskId && execute(() => cancelDelegatedTask(chatId, delegatedTaskId));
  const showOutput = () => {
    if (!taskId) return;
    setOpen(true);
    return execute(async () => setOutput(await readBackgroundTaskOutput(chatId, taskId)));
  };
  return { open, setOpen, output, error, busy, stop, cancel, showOutput };
}

type Controls = ReturnType<typeof useRowControls>;

function navigationActions(row: ActivityEntry, onJump: () => void, onOpenChild?: () => void): RowAction[] {
  const actions: RowAction[] = [];
  if (row.source)
    actions.push({
      key: 'source',
      icon: ExternalLink,
      label: `Go to ${row.title} in transcript`,
      text: row.source.approximate ? 'Near start' : 'Transcript',
      title: row.source.approximate ? 'Open transcript near task start' : 'Go to source in transcript',
      onClick: onJump,
    });
  if (onOpenChild)
    actions.push({
      key: 'child',
      icon: MessagesSquare,
      label: `Open ${row.title} chat`,
      text: 'Open chat',
      title: 'Open child chat',
      onClick: onOpenChild,
    });
  return actions;
}

function controlActions(row: ActivityEntry, adapterId: string | undefined, controls: Controls): RowAction[] {
  const live = row.state === 'running' || row.state === 'waiting';
  const actions: RowAction[] = [];
  if (row.task && row.kind === 'command')
    actions.push({
      key: 'output',
      icon: SquareTerminal,
      label: `Output for ${row.title}`,
      text: 'Full output',
      title: 'Full output',
      onClick: () => void controls.showOutput(),
    });
  if (live && row.task && adapterId === 'claude')
    actions.push({
      key: 'stop',
      icon: Square,
      label: `Stop ${row.title}`,
      text: 'Stop',
      title: 'Stop',
      destructive: true,
      disabled: controls.busy,
      onClick: () => void controls.stop(),
    });
  if (live && row.delegated)
    actions.push({
      key: 'cancel',
      icon: X,
      label: `Cancel ${row.title}`,
      text: 'Cancel',
      title: 'Cancel task',
      destructive: true,
      disabled: controls.busy,
      onClick: () => void controls.cancel(),
    });
  return actions;
}

function IconActions({
  actions,
  open,
  onToggle,
  title,
}: {
  actions: RowAction[];
  open: boolean;
  onToggle: () => void;
  title: string;
}) {
  return (
    <div className={cn('shrink-0 items-center gap-0.5', open ? 'flex' : 'hidden group-hover:flex')}>
      {actions.map(({ key, icon: Icon, label, title: actionTitle, onClick, disabled, destructive }) => (
        <button
          key={key}
          type="button"
          title={actionTitle}
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            'rounded p-0.5',
            destructive ? 'text-destructive hover:bg-destructive/10' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className={key === 'stop' ? 'size-3' : 'size-3.5'} />
        </button>
      ))}
      <button
        type="button"
        title={open ? 'Collapse' : 'Details'}
        aria-label={`${open ? 'Collapse' : 'Details for'} ${title}`}
        onClick={onToggle}
        className="rounded p-0.5 text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn('size-3.5', open && 'rotate-180')} />
      </button>
    </div>
  );
}

function RowHeader({
  row,
  now,
  run,
  open,
  onToggle,
  actions,
}: {
  row: ActivityEntry;
  now: number;
  run?: ClaudeWorkflowRun;
  open: boolean;
  onToggle: () => void;
  actions: RowAction[];
}) {
  const Icon = ICONS[row.kind];
  const live = row.state === 'running' || row.state === 'waiting';
  return (
    <div className="flex min-w-0 items-start gap-2 px-2 py-1.5">
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', live ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
      <button type="button" onClick={onToggle} aria-expanded={open} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm text-foreground">{row.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{detailLine(row, run)}</span>
        {row.kind === 'workflow' && run && <WorkflowRail run={run} />}
      </button>
      <span
        className={cn(
          'shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground',
          open ? 'hidden' : 'group-hover:hidden',
        )}
      >
        {timeLabel(row, now)}
      </span>
      <IconActions actions={actions} open={open} onToggle={onToggle} title={row.title} />
    </div>
  );
}

export function ActivityRow({ row, now, chatId, adapterId, run, onJump, onOpenChild }: Props) {
  const controls = useRowControls(row, chatId);
  const actions = [...navigationActions(row, onJump, onOpenChild), ...controlActions(row, adapterId, controls)];
  return (
    <div data-testid={`session-panel-activity-${row.id}`} className="group rounded-md hover:bg-foreground/6">
      <RowHeader
        row={row}
        now={now}
        run={run}
        open={controls.open}
        onToggle={() => controls.setOpen(!controls.open)}
        actions={actions}
      />
      {controls.open && (
        <>
          <DetailFields row={row} run={run} output={controls.output} />
          {controls.error && (
            <p role="alert" className="px-2.5 pb-2 text-xs text-destructive">
              {controls.error}
            </p>
          )}
          <ActionFooter actions={actions} />
        </>
      )}
    </div>
  );
}
