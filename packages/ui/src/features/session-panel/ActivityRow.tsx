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
import { CommandOutputDialog } from './CommandOutputDialog';
import { PanelRow } from './PanelSection';
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

/** The row's value makes way for Stop; both hide and show on the same hover or focus. */
const VALUE_AWAY = 'group-hover/activity:opacity-0 group-has-focus-visible/activity:opacity-0';
const STOP_SHOWN =
  'pointer-events-none opacity-0 group-hover/activity:pointer-events-auto group-hover/activity:opacity-100 group-has-focus-visible/activity:pointer-events-auto group-has-focus-visible/activity:opacity-100';

function StatusValue({ status, className }: { status: ActivityStatus; className?: string }) {
  return (
    <span className={cn('flex items-center gap-1', className)}>
      {status.tone === 'running' && <ActivitySpinner />}
      <span className={TONE[status.tone]}>{status.text}</span>
    </span>
  );
}

/** Beside the row's button, not inside it: the row has a main action of its own. */
function RowStop({ row, stopping, onStop }: { row: ActivityEntry; stopping: boolean; onStop: () => void }) {
  return (
    <Hint label={stopping ? 'Stopping' : 'Stop'}>
      <Button
        data-testid={`session-panel-activity-row-stop-${row.id}`}
        aria-label={stopping ? `Stopping ${row.title}` : `Stop ${row.title}`}
        // Not `disabled`, which would drop the focus it has.
        aria-disabled={stopping}
        variant="ghost"
        size="icon-xs"
        onClick={onStop}
        className={cn(
          'absolute top-0.5 right-2.5 text-destructive hover:bg-destructive/10 hover:text-destructive aria-disabled:text-muted-foreground',
          STOP_SHOWN,
        )}
      >
        <Square className="size-3 fill-current" />
      </Button>
    </Hint>
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
  if (!onJump && !onOutput && !onStop) return children;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
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
  readOutput?: () => Promise<string>;
  /** Present only while the work can be stopped. */
  onStop?: () => void;
  /** A Stop was asked for; the work hasn't ended yet. */
  stopping?: boolean;
}

const STOPPING: ActivityStatus = { tone: 'plain', text: 'stopping' };

export function ActivityRow({
  row,
  now,
  run,
  onActivate,
  onJump,
  readOutput,
  onStop,
  stopping = false,
}: ActivityRowProps) {
  const [open, setOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const rowRef = useRef<HTMLButtonElement>(null);
  const Icon = ACTIVITY_ICON[row.kind];
  const kind = ACTIVITY_KIND_LABEL[row.kind];
  const status = stopping ? STOPPING : activityStatus(row, now, run);
  const unfolds = row.kind === 'workflow' && run !== undefined;
  const spoken = status.tone === 'running' ? `running, ${status.text}` : status.text;
  return (
    <div>
      <RowMenu
        row={row}
        onJump={onJump}
        onOutput={readOutput && (() => setOutputOpen(true))}
        onStop={onStop}
        stopping={stopping}
      >
        <div className="group/activity relative">
          <Hint label={[row.title, kind, row.detail !== row.title && row.detail].filter(Boolean).join(' · ')}>
            <PanelRow
              ref={rowRef}
              data-testid={`session-panel-activity-${row.id}`}
              data-activity-state={row.state}
              aria-label={`${kind}: ${row.title}, ${spoken}`}
              aria-expanded={unfolds ? open : undefined}
              onClick={unfolds ? () => setOpen(!open) : onActivate}
              icon={<Icon />}
              label={row.title}
              value={<StatusValue status={status} className={onStop && VALUE_AWAY} />}
            />
          </Hint>
          {onStop && <RowStop row={row} stopping={stopping} onStop={onStop} />}
        </div>
      </RowMenu>
      {unfolds && open && <WorkflowPhases title={row.title} run={run} now={now} onStop={onStop} stopping={stopping} />}
      {readOutput && (
        <CommandOutputDialog
          title={row.title}
          command={row.command}
          read={readOutput}
          open={outputOpen}
          onOpenChange={setOutputOpen}
          returnFocus={rowRef}
        />
      )}
    </div>
  );
}
