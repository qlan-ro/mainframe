/**
 * ActivityRow — one piece of the session's work: its kind icon leads, live or
 * finished, and its status is the value at the end. A click runs the row's main
 * action; only a workflow unfolds, because its phases show nowhere else.
 */
import { useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  Binoculars,
  Bot,
  Clock3,
  LocateFixed,
  Route,
  Square,
  SquareTerminal,
  TextAlignStart,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import { BotFilled } from '@/lib/icons/bot-filled';
import type { ActivityEntry, ActivityKind } from './activity-model';
import { ACTIVITY_KIND_LABEL, activityStatus, type ActivityStatus } from './activity-status';
import { ActivitySpinner } from './ActivitySpinner';
import { PanelRow } from './PanelSection';
import { useFocusLoss, useFocusReturn } from './use-row-focus';
import { WorkflowPhases } from './WorkflowPhases';

export const ACTIVITY_ICON: Record<ActivityKind, LucideIcon> = {
  workflow: Route,
  subagent: Bot,
  delegated: BotFilled,
  monitor: Binoculars,
  scheduled: Clock3,
  command: SquareTerminal,
  background: Activity,
};

const TONE: Record<ActivityStatus['tone'], string | undefined> = {
  running: undefined,
  'needs-you': 'font-medium text-warning',
  failed: 'text-fail',
  plain: undefined,
};

/** The row's value makes way for its actions; both hide and show on the same hover or focus. */
const VALUE_AWAY = 'group-hover/activity:opacity-0 group-has-focus-visible/activity:opacity-0';
const VALUE_AWAY_FOCUSED = 'group-has-[[data-row-actions]_:focus-visible]/activity:opacity-0';
const ACTIONS_AWAY = 'pointer-events-none opacity-0';
const ACTIONS_SHOWN =
  'group-hover/activity:pointer-events-auto group-hover/activity:opacity-100 group-has-focus-visible/activity:pointer-events-auto group-has-focus-visible/activity:opacity-100';
const ACTIONS_FOCUSED = 'has-focus-visible:pointer-events-auto has-focus-visible:opacity-100';

function valueClass(actions: number, loading: boolean): string {
  return cn(
    actions > 0 && (loading ? VALUE_AWAY_FOCUSED : VALUE_AWAY),
    // Room for both, so they never cover the title.
    actions > 1 && 'min-w-12 justify-end',
  );
}

function StatusValue({ status, className }: { status: ActivityStatus; className?: string }) {
  return (
    <span className={cn('flex items-center gap-1', className)}>
      {status.tone === 'running' && <ActivitySpinner />}
      <span className={TONE[status.tone]}>{status.text}</span>
    </span>
  );
}

interface RowActionProps {
  id: string;
  label: string;
  hint: string;
  icon: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
  onClick: () => void;
  /** It is going away with the focus on it. */
  onFocusLost: () => void;
}

function RowAction({ id, label, hint, icon, disabled, destructive, onClick, onFocusLost }: RowActionProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useFocusLoss(ref, onFocusLost);
  return (
    <Hint label={hint}>
      <Button
        ref={ref}
        data-testid={`session-panel-activity-row-${id}`}
        aria-label={label}
        // Not `disabled`, which would drop the focus it has.
        aria-disabled={disabled}
        variant="ghost"
        size="icon-xs"
        onClick={onClick}
        className={cn(
          'aria-disabled:text-muted-foreground',
          destructive && 'text-destructive hover:bg-destructive/10 hover:text-destructive',
        )}
      >
        {icon}
      </Button>
    </Hint>
  );
}

interface RowActionsProps {
  row: ActivityEntry;
  stopping: boolean;
  /** The row's value stays while it says that history is loading. */
  loading: boolean;
  onOutput?: () => void;
  onStop?: () => void;
  onFocusLost: () => void;
}

/** Beside the row's button, not inside it: the row has a main action of its own. */
function RowActions({ row, stopping, loading, onOutput, onStop, onFocusLost }: RowActionsProps) {
  return (
    <span
      data-row-actions
      className={cn('absolute top-0.5 right-2.5 flex', ACTIONS_AWAY, loading ? ACTIONS_FOCUSED : ACTIONS_SHOWN)}
    >
      {onOutput && (
        <RowAction
          id={`output-${row.id}`}
          label={`Full output of ${row.title}`}
          hint="Full output"
          icon={<TextAlignStart className="size-3" />}
          onClick={onOutput}
          onFocusLost={onFocusLost}
        />
      )}
      {onStop && (
        <RowAction
          id={`stop-${row.id}`}
          label={stopping ? `Stopping ${row.title}` : `Stop ${row.title}`}
          hint={stopping ? 'Stopping' : 'Stop'}
          icon={<Square className="size-3 fill-current" />}
          disabled={stopping}
          destructive
          onClick={onStop}
          onFocusLost={onFocusLost}
        />
      )}
    </span>
  );
}

/** Right-click (or the menu key): the row's other actions, which the row itself doesn't show. */
function RowMenu({
  row,
  children,
  onJump,
  onOutput,
  onStop,
  stopping,
}: {
  row: ActivityEntry;
  children: ReactNode;
  onJump?: () => void;
  onOutput?: () => void;
  onStop?: () => void;
  stopping: boolean;
}) {
  return (
    <ContextMenu>
      {/* Without items it is off rather than gone: the row would remount and lose its focus. */}
      <ContextMenuTrigger asChild disabled={!onJump && !onOutput && !onStop}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {onJump && (
          <ContextMenuItem data-testid={`session-panel-activity-jump-${row.id}`} onSelect={onJump}>
            <LocateFixed /> Show in transcript
          </ContextMenuItem>
        )}
        {onOutput && (
          <ContextMenuItem data-testid={`session-panel-activity-output-${row.id}`} onSelect={onOutput}>
            <TextAlignStart /> Full output
          </ContextMenuItem>
        )}
        {onStop && (
          <ContextMenuItem
            disabled={stopping}
            data-testid={`session-panel-activity-stop-${row.id}`}
            variant="destructive"
            onSelect={onStop}
          >
            <Square /> Stop
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export interface ActivityRowProps {
  row: ActivityEntry;
  now: number;
  run?: ClaudeWorkflowRun;
  /** The row's main action; a workflow unfolds instead. */
  onActivate: () => void;
  onJump?: () => void;
  /** Present for a background command: its output, which the transcript row doesn't show yet. */
  onOutput?: () => void;
  /** Present only while the work can be stopped. */
  onStop?: () => void;
  /** A Stop was asked for; the work hasn't ended yet. */
  stopping?: boolean;
  /** Its jump waits for history to load. */
  loading?: boolean;
  /** The row is going away with the focus in it. */
  onFocusLost?: (id: string) => void;
}

const STOPPING: ActivityStatus = { tone: 'plain', text: 'stopping' };
const LOADING: ActivityStatus = { tone: 'running', text: 'loading' };

function spokenStatus(status: ActivityStatus): string {
  return status.tone === 'running' && status !== LOADING ? `running, ${status.text}` : status.text;
}

export function ActivityRow({
  row,
  now,
  run,
  onActivate,
  onJump,
  onOutput,
  onStop,
  stopping = false,
  loading = false,
  onFocusLost,
}: ActivityRowProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLButtonElement>(null);
  useFocusLoss(rootRef, onFocusLost && (() => onFocusLost(row.id)));
  const Icon = ACTIVITY_ICON[row.kind];
  const kind = ACTIVITY_KIND_LABEL[row.kind];
  const status = stopping ? STOPPING : loading ? LOADING : activityStatus(row, now, run);
  const unfolds = row.kind === 'workflow' && run !== undefined;
  const actions = [onOutput, onStop].filter(Boolean).length;
  const onControlLost = useFocusReturn(rowRef);
  return (
    <div ref={rootRef}>
      <RowMenu row={row} onJump={onJump} onOutput={onOutput} onStop={onStop} stopping={stopping}>
        <div className="group/activity relative">
          <Hint label={[row.title, kind, row.detail !== row.title && row.detail].filter(Boolean).join(' · ')}>
            <PanelRow
              ref={rowRef}
              data-testid={`session-panel-activity-${row.id}`}
              data-activity-row={row.id}
              data-activity-state={row.state}
              aria-label={`${kind}: ${row.title}, ${spokenStatus(status)}`}
              aria-expanded={unfolds ? open : undefined}
              onClick={unfolds ? () => setOpen(!open) : onActivate}
              icon={<Icon />}
              label={row.title}
              value={<StatusValue status={status} className={valueClass(actions, loading)} />}
            />
          </Hint>
          {actions > 0 && (
            <RowActions
              row={row}
              stopping={stopping}
              loading={loading}
              onOutput={onOutput}
              onStop={onStop}
              onFocusLost={onControlLost}
            />
          )}
        </div>
      </RowMenu>
      {unfolds && open && (
        <WorkflowPhases
          title={row.title}
          run={run}
          now={now}
          onStop={onStop}
          stopping={stopping}
          onFocusLost={onControlLost}
        />
      )}
    </div>
  );
}
