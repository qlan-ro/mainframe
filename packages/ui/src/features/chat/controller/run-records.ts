/**
 * The runs this client has seen: where in the transcript each began, where it
 * ended and how. A turn's state is read from them (`view-model/turn`), never
 * from the transcript's shape alone: the viewer can write into a run, so a
 * message after a part says nothing about whether the part ended. Pure.
 */
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { StopReason } from '@qlan-ro/mainframe-types';
import type { ChatThreadState } from './chat-thread-state';

/** A place in the transcript: everything up to this message's first `parts` visible parts. */
export interface TranscriptMark {
  readonly id: string;
  readonly parts: number;
}

export interface RunRecord {
  /** The end of the transcript as the run began; null: it was empty. */
  readonly after: TranscriptMark | null;
  /**
   * Whether the run is known to have begun there (the idle → running edge). When
   * not (a reload, a reconnect), `after` is only the last message somebody sent.
   */
  readonly exact: boolean;
  /** Only this client's send says it runs so far. */
  readonly optimistic?: boolean;
  readonly startedAtMs?: number;
  /** `until`: the end of the transcript as the run ended. `reason`: how, when the daemon said. */
  readonly end?: { readonly until: TranscriptMark | null; readonly reason?: StopReason };
}

export interface RunStart {
  readonly startedAtMs?: number;
  /** Told by a replay, or while the transcript is not followed: the run may be older. */
  readonly replayed?: boolean;
  readonly optimistic?: boolean;
}

type Part = { readonly type: string; readonly text?: string };

/** How many parts of a message show. The normalizer drops blank text, so it is counted in neither form. */
export function visibleParts(content: string | readonly Part[]): number {
  if (typeof content === 'string') return content.trim() ? 1 : 0;
  return content.filter((part) => !['text', 'reasoning'].includes(part.type) || Boolean(part.text?.trim())).length;
}

function markOf(message: ThreadMessageLike | undefined): TranscriptMark | null {
  return message?.id ? { id: message.id, parts: visibleParts(message.content as string | readonly Part[]) } : null;
}

const lastOf = <T>(list: readonly T[]): T | undefined => list[list.length - 1];
const lastMark = (messages: readonly ThreadMessageLike[]) => markOf(lastOf(messages));
const lastSent = (messages: readonly ThreadMessageLike[]) =>
  markOf(lastOf(messages.filter(({ role }) => role === 'user')));

/** Whether the thread was seen idle up to here, so that a start now is the run's own. */
function seenIdle(state: ChatThreadState, last: RunRecord | undefined): boolean {
  if (state.loadState.type !== 'ready') return false;
  if (state.runState.type === 'idle') return true;
  // A run that ended moments ago still shows as running; a send that failed started nothing.
  return last?.end !== undefined && (state.runState.type !== 'error' || last.optimistic === true);
}

export function runStarted(state: ChatThreadState, start: RunStart): readonly RunRecord[] {
  const { runs, messages } = state;
  const last = lastOf(runs);
  const open = last && !last.end ? last : undefined;
  const { startedAtMs, replayed = false, optimistic = false } = start;
  const another = startedAtMs !== undefined && open?.startedAtMs !== undefined && startedAtMs !== open.startedAtMs;
  const known = startedAtMs !== undefined && startedAtMs === open?.startedAtMs;
  if (open && !another && (!replayed || open.exact || known)) {
    const next = { ...open, startedAtMs: startedAtMs ?? open.startedAtMs, optimistic: open.optimistic && optimistic };
    const same = next.startedAtMs === open.startedAtMs && next.optimistic === open.optimistic;
    return same ? runs : [...runs.slice(0, -1), next];
  }
  // A live start of another run: the end of the one before was missed, but it is here.
  const ended = open && !replayed ? [...runs.slice(0, -1), { ...open, end: { until: lastMark(messages) } }] : runs;
  const before = open && replayed ? runs.slice(0, -1) : ended;
  const exact = !replayed && (open ? another : seenIdle(state, last));
  return [
    ...before,
    {
      after: exact ? lastMark(messages) : lastSent(messages),
      exact,
      ...(optimistic && { optimistic }),
      ...(startedAtMs !== undefined && { startedAtMs }),
    },
  ];
}

/** An end without a reason is completed by the daemon's, when that still comes. */
export function runEnded({ runs, messages }: ChatThreadState, reason?: StopReason): readonly RunRecord[] {
  const last = lastOf(runs);
  if (!last || (last.end && (last.end.reason !== undefined || reason === undefined))) return runs;
  const until = last.end ? last.end.until : lastMark(messages);
  return [...runs.slice(0, -1), { ...last, end: { until, ...(reason !== undefined && { reason }) } }];
}

/** Whether a run goes that somebody else than this client's own send has told of. */
export function runConfirmed({ runs }: ChatThreadState): boolean {
  const last = lastOf(runs);
  return last !== undefined && !last.end && !last.optimistic;
}
