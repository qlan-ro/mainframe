/**
 * The turn status tail: one thread-level decision on whether the status row is
 * visible, shared by the row, the relocated clock and every footer clock.
 *
 * While the row shows under its anchor message, that message's clock follows the
 * row instead of sitting in the footer. The finished flash is per-instance state
 * with its own timer, so a single instance feeds all readers: two clocks or none
 * can never show during a transition. Without a provider (nested transcripts,
 * isolated tests) readers fall back to the footer behaviour.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { runningCount } from '@/features/session-panel/activity-view';
import { useChatExtras } from '../runtime/chat-extras';
import { TimestampLabel } from '../messages/MessageTimestamp';
import { useTurnStatusHost } from './turn-status-host';
import { statusAnchorId } from './turn-phase';

const FINISHED_FLASH_MS = 1500;

export interface TurnStatusTail {
  anchorId: string | null;
  running: boolean;
  tasks: number;
  finished: number;
  visible: boolean;
}

export function useRunningTasks() {
  return runningCount(Object.values(useChatExtras()?.state.backgroundTasks ?? {}));
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

export function useTurnStatusTailState(): TurnStatusTail {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const anchorId = useAuiState((s) => statusAnchorId(s.thread.messages));
  const count = useRunningTasks();
  const flash = useFinishedFlash(count);
  // A live group header carries the running status, its clock and task count included.
  const hosted = useTurnStatusHost() !== null;
  const running = isRunning && !hosted;
  const tasks = hosted ? 0 : count;
  return useMemo(
    () => ({ anchorId, running, tasks, finished: flash, visible: running || tasks > 0 || flash > 0 }),
    [anchorId, running, tasks, flash],
  );
}

const TurnStatusTailContext = createContext<TurnStatusTail | null>(null);

export function TurnStatusTailProvider({ children }: { children: ReactNode }) {
  return <TurnStatusTailContext.Provider value={useTurnStatusTailState()}>{children}</TurnStatusTailContext.Provider>;
}

export function useTurnStatusTail(): TurnStatusTail | null {
  return useContext(TurnStatusTailContext);
}

/** The anchor message's clock, rendered after the status row while the row is visible. */
export function TurnStatusClock() {
  const tail = useTurnStatusTail();
  const anchorId = tail?.anchorId;
  const createdAt = useAuiState((s) => s.thread.messages.find((m) => m.id === anchorId)?.createdAt);
  const hidden = useAuiState((s) => {
    const message = s.thread.messages.find((m) => m.id === anchorId);
    // The row follows a user prompt before any reply exists: no clock for it.
    return !message || message.role === 'user' || message.content.every((p) => p.type === 'text' && !p.text);
  });
  if (!tail?.visible || hidden || !createdAt) return null;
  // Align with the row's text: past the running dot and its gap.
  return (
    <div className={tail.running ? 'pl-3.5' : undefined}>
      <TimestampLabel createdAt={createdAt} />
    </div>
  );
}
