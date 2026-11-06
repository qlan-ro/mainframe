/**
 * The turn status row: the transcript's last line while a turn runs, as in the
 * Claude and Codex desktop apps. It reports the phase, how long the turn has run,
 * and live background work, and it outlives the turn while background tasks run.
 * It never names a tool: activity group headers and tool cards own the step.
 *
 * One live indicator per turn: while a live activity group ends the transcript,
 * that group's header hosts the clock and task count (`TurnStatusTrailing`) and
 * this row steps aside (see `useTurnStatusHost`).
 *
 * `chat-thread-running` exists only while the turn runs, on whichever element
 * hosts the status (e2e waits read its removal as the turn's end).
 */
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PanelColumnContext, usePanelControl } from '@/features/session-panel/panel-control-store';
import { runningCount } from '@/features/session-panel/activity-view';
import { useChatExtras } from '../runtime/chat-extras';
import { formatElapsedSeconds } from '../format-duration';
import { useStableActivityLabel } from '../messages/compact/use-stable-activity-label';
import { useRunElapsed } from './use-run-elapsed';
import { useTurnStatusHost } from './turn-status-host';
import { runningTasksLabel, turnPhase } from './turn-phase';

const FINISHED_FLASH_MS = 1500;
/** Each segment and phase change fades in, rising 3px (the desktop apps' 180ms morph). */
const ENTER =
  'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-[3px] duration-180 ease-[cubic-bezier(0.2,0,0,1)]';

function usePhase() {
  const extras = useChatExtras();
  const permissions = extras?.permissions;
  const pending = useMemo(
    () =>
      new Set(
        Object.values(permissions ?? {}).flatMap((entry) => (entry.request.toolUseId ? [entry.request.toolUseId] : [])),
      ),
    [permissions],
  );
  const inputs = {
    stopping: extras?.state.runState.type === 'cancelling',
    compacting: extras?.state.compacting === true,
    awaitingInput: Object.keys(permissions ?? {}).length > 0,
  };
  const phase = useAuiState((s) => turnPhase(inputs, s.thread.messages, pending));
  // A phase shows for at least a second, so tool gaps don't flicker Working/Thinking.
  return useStableActivityLabel({ identity: phase, text: phase }, true);
}

function useTurnClock() {
  const runState = useChatExtras()?.state.runState;
  const startedAtMs = runState && 'startedAtMs' in runState ? runState.startedAtMs : undefined;
  return useRunElapsed(true, startedAtMs);
}

function useRunningTasks() {
  return runningCount(Object.values(useChatExtras()?.state.backgroundTasks ?? {}));
}

function Separator() {
  return (
    <span aria-hidden className="text-muted-foreground/60">
      ·
    </span>
  );
}

function Elapsed({ seconds, lead = true }: { seconds: number; lead?: boolean }) {
  return (
    <span className={cn('flex shrink-0 items-center gap-2', ENTER)}>
      {lead && <Separator />}
      <span data-testid="chat-thread-running-elapsed" className="font-mono tabular-nums text-muted-foreground">
        {formatElapsedSeconds(seconds)}
      </span>
    </span>
  );
}

/** The clock and task count, hosted at the right edge of the live header that ends the transcript. */
export function TurnStatusTrailing() {
  const elapsed = useTurnClock();
  const tasks = useRunningTasks();
  return (
    // `min-w-px` keeps a box before the first second, so the running marker is visible from the start.
    <span data-testid="chat-thread-running" className="inline-flex h-4 min-w-px shrink-0 items-center gap-2 text-xs">
      {elapsed !== undefined && <Elapsed seconds={elapsed} lead={false} />}
      {tasks > 0 && (
        <span className={cn('flex items-center gap-2 text-muted-foreground', ENTER)}>
          {elapsed !== undefined && <Separator />}
          <span data-testid="chat-thread-running-tasks">{runningTasksLabel(tasks)}</span>
        </span>
      )}
    </span>
  );
}

function RunningStatus() {
  const phase = usePhase();
  const attention = phase === 'Needs your input';
  const elapsed = useTurnClock();
  return (
    <div data-testid="chat-thread-running" className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 animate-pulse rounded-full motion-reduce:animate-none',
          attention ? 'bg-warning' : 'bg-primary',
        )}
      />
      {/* Two spans: the enter morph and the idle pulse both own `animation`. */}
      <span key={phase} className={cn('min-w-0 truncate', ENTER)}>
        <span
          data-testid="chat-thread-running-text"
          className={cn('mf-phase-pulse font-medium', attention ? 'text-warning' : 'text-muted-foreground')}
        >
          {phase}
        </span>
      </span>
      {elapsed !== undefined && <Elapsed seconds={elapsed} />}
    </div>
  );
}

/** "N tasks finished" for a moment after the last background task ends. */
function useFinishedFlash(count: number): number {
  const previous = useRef(count);
  const [finished, setFinished] = useState(0);
  useEffect(() => {
    const before = previous.current;
    previous.current = count;
    if (count > 0 || before === 0) return;
    setFinished(before);
    const timer = setTimeout(() => setFinished(0), FINISHED_FLASH_MS);
    return () => clearTimeout(timer);
  }, [count]);
  return count > 0 ? 0 : finished;
}

function BackgroundTasks({ count, finished }: { count: number; finished: number }) {
  const columnId = useContext(PanelColumnContext);
  const revealActivity = usePanelControl((s) => s.revealActivity);
  if (count > 0) {
    const label = runningTasksLabel(count);
    // Outside a panel column (side chats) there is no Activity to reveal.
    if (!columnId)
      return (
        <span data-testid="chat-thread-running-tasks" className={cn('text-muted-foreground', ENTER)}>
          {label}
        </span>
      );
    return (
      <Button
        variant="ghost"
        size="xs"
        data-testid="chat-thread-running-tasks"
        aria-label={`${label}, show in Activity`}
        onClick={() => revealActivity(columnId)}
        className={cn('-mx-2 text-muted-foreground', ENTER)}
      >
        {label}
      </Button>
    );
  }
  if (!finished) return null;
  return (
    <span data-testid="chat-thread-tasks-finished" className={cn('text-muted-foreground', ENTER)}>
      {finished} task{finished === 1 ? '' : 's'} finished
    </span>
  );
}

export function TurnStatusRow() {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const count = useRunningTasks();
  const finished = useFinishedFlash(count);
  // A live group header carries the running status, its clock and task count included.
  const hosted = useTurnStatusHost() !== null;
  const running = isRunning && !hosted;
  const tasks = hosted ? 0 : count;
  if (!running && !tasks && !finished) return null;
  return (
    <div data-testid="chat-turn-status" className="flex h-7 min-w-0 items-center gap-2 text-xs">
      {running && <RunningStatus />}
      {running && (tasks > 0 || finished > 0) && <Separator />}
      <BackgroundTasks count={tasks} finished={finished} />
    </div>
  );
}
