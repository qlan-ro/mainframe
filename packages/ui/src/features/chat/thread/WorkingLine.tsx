/**
 * The status line pinned above the composer: what the turn is doing, how long it
 * has run, and how much background work is live. It outlives the turn while
 * background tasks run, so long-running work stays visible without opening the
 * session panel. Stop itself is the composer's send slot.
 *
 * `chat-thread-running` exists only while the turn runs (e2e waits read it as the
 * turn's end); the background-task part sits beside it.
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
import { currentStep, runningTasksLabel, workingLabel } from './working-label';

const FINISHED_FLASH_MS = 1500;

function useLiveLabel() {
  const extras = useChatExtras();
  const permissions = extras?.permissions;
  const pending = useMemo(
    () =>
      new Set(
        Object.values(permissions ?? {}).flatMap((entry) => (entry.request.toolUseId ? [entry.request.toolUseId] : [])),
      ),
    [permissions],
  );
  const step = useAuiState((s) => currentStep(s.thread.messages, pending));
  const label = workingLabel(
    {
      stopping: extras?.state.runState.type === 'cancelling',
      compacting: extras?.state.compacting === true,
      awaitingInput: Object.keys(permissions ?? {}).length > 0,
    },
    step,
  );
  // Same hold as the live activity group: a step shows for at least a second.
  const text = useStableActivityLabel({ identity: label.text, text: label.text }, true);
  return { text, tone: label.tone };
}

function RunningStatus({ startedAtMs }: { startedAtMs?: number }) {
  const { text, tone } = useLiveLabel();
  const elapsed = useRunElapsed(true, startedAtMs);
  return (
    <div data-testid="chat-thread-running" className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 animate-pulse rounded-full motion-reduce:animate-none',
          tone === 'attention' ? 'bg-warning' : 'bg-primary',
        )}
      />
      <span
        data-testid="chat-thread-running-text"
        className={cn(
          'min-w-0 truncate text-xs font-medium',
          tone === 'attention' ? 'text-warning' : 'text-muted-foreground',
        )}
      >
        {text}
      </span>
      {elapsed !== undefined && (
        <span
          data-testid="chat-thread-running-elapsed"
          className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground"
        >
          {formatElapsedSeconds(elapsed)}
        </span>
      )}
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

function BackgroundTasks({ count, finished, interactive }: { count: number; finished: number; interactive: boolean }) {
  const columnId = useContext(PanelColumnContext);
  const revealActivity = usePanelControl((s) => s.revealActivity);
  if (count > 0) {
    const label = runningTasksLabel(count);
    if (!interactive || !columnId)
      return (
        <span data-testid="chat-thread-running-tasks" className="text-xs text-muted-foreground">
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
        className="text-muted-foreground"
      >
        {label}
      </Button>
    );
  }
  if (!finished) return null;
  return (
    <span data-testid="chat-thread-tasks-finished" className="text-xs text-muted-foreground">
      {finished} task{finished === 1 ? '' : 's'} finished
    </span>
  );
}

export function WorkingLine({ interactive = true }: { interactive?: boolean }) {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const extras = useChatExtras();
  const runState = extras?.state.runState;
  const startedAtMs = runState && 'startedAtMs' in runState ? runState.startedAtMs : undefined;
  const count = runningCount(Object.values(extras?.state.backgroundTasks ?? {}));
  const finished = useFinishedFlash(count);
  if (!isRunning && !count && !finished) return null;
  return (
    <div data-testid="chat-thread-working-line" className="flex h-7 min-w-0 items-center gap-3 px-1">
      {isRunning && <RunningStatus startedAtMs={startedAtMs} />}
      <BackgroundTasks count={count} finished={finished} interactive={interactive} />
    </div>
  );
}
