/**
 * ActivityRow — one piece of the session's work: its kind icon leads, live or
 * finished, and its status is the value at the end. A click runs the row's main
 * action; only a workflow unfolds, because its phases show nowhere else.
 */
import { useState, type ReactNode } from 'react';
import { Activity, Binoculars, Bot, Clock3, LocateFixed, Route, Square, SquareTerminal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Hint } from '@/components/ui/hint';
import { BotFilled } from '@/lib/icons/bot-filled';
import type { ActivityEntry, ActivityKind } from './activity-model';
import { ACTIVITY_KIND_LABEL, activityStatus, type ActivityStatus } from './activity-status';
import { ActivitySpinner } from './ActivitySpinner';
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

function StatusValue({ status }: { status: ActivityStatus }) {
  return (
    <>
      {status.tone === 'running' && <ActivitySpinner />}
      <span className={TONE[status.tone]}>{status.text}</span>
    </>
  );
}

/** Right-click (or the menu key): the row's other actions, which the row itself doesn't show. */
function RowMenu({
  row,
  children,
  onJump,
  onStop,
}: {
  row: ActivityEntry;
  children: ReactNode;
  onJump?: () => void;
  onStop?: () => void;
}) {
  if (!onJump && !onStop) return children;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {onJump && (
          <ContextMenuItem data-testid={`session-panel-activity-jump-${row.id}`} onSelect={onJump}>
            <LocateFixed /> Show in transcript
          </ContextMenuItem>
        )}
        {onStop && (
          <ContextMenuItem
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
  /** Present only while the work can be stopped. */
  onStop?: () => void;
}

export function ActivityRow({ row, now, run, onActivate, onJump, onStop }: ActivityRowProps) {
  const [open, setOpen] = useState(false);
  const Icon = ACTIVITY_ICON[row.kind];
  const kind = ACTIVITY_KIND_LABEL[row.kind];
  const status = activityStatus(row, now, run);
  const unfolds = row.kind === 'workflow' && run !== undefined;
  const spoken = row.state === 'running' ? `running, ${status.text}` : status.text;
  return (
    <div>
      <RowMenu row={row} onJump={onJump} onStop={onStop}>
        <div>
          <Hint label={[row.title, kind, row.detail !== row.title && row.detail].filter(Boolean).join(' · ')}>
            <PanelRow
              data-testid={`session-panel-activity-${row.id}`}
              data-activity-state={row.state}
              aria-label={`${kind}: ${row.title}, ${spoken}`}
              aria-expanded={unfolds ? open : undefined}
              onClick={unfolds ? () => setOpen(!open) : onActivate}
              icon={<Icon />}
              label={row.title}
              value={<StatusValue status={status} />}
            />
          </Hint>
        </div>
      </RowMenu>
      {unfolds && open && <WorkflowPhases title={row.title} run={run} now={now} onStop={onStop} />}
    </div>
  );
}
