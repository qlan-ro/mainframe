/**
 * The run in progress: where in the transcript it began, when that was seen. It
 * says which parts are going and nothing about how one ended. Pure.
 */
import type { ChatThreadState } from './chat-thread-state';

export interface RunInProgress {
  /** The last message as the session went from idle to running, null when there was none. Absent: not seen. */
  readonly after?: string | null;
  /** Somebody else than this client's own send has told of it. */
  readonly confirmed: boolean;
}

export interface RunStart {
  readonly startedAtMs?: number;
  /** Told by a replay, or while the transcript is not followed: the run may be older. */
  readonly replayed?: boolean;
  /** Only this client's send says so. */
  readonly optimistic?: boolean;
}

export function runStarted(state: ChatThreadState, start: RunStart): RunInProgress {
  const { run, runState, loadState, messages } = state;
  const { startedAtMs, replayed = false, optimistic = false } = start;
  const known = 'startedAtMs' in runState ? runState.startedAtMs : undefined;
  // A queued prompt's run can start before the stop of the one before has settled.
  const another = startedAtMs !== undefined && known !== undefined && startedAtMs !== known;
  if (run && !another) return run.confirmed || optimistic ? run : { ...run, confirmed: true };
  const edge = another || loadState.type === 'ready';
  return {
    ...(edge && !replayed && { after: messages[messages.length - 1]?.id ?? null }),
    confirmed: !optimistic,
  };
}
