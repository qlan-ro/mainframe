/**
 * turn-phase — what the transcript's turn status row says while a turn runs.
 *
 * The row reports the turn's phase only (Thinking / Writing / Working …). Naming
 * the current tool is the activity group header's and the tool card's job, so the
 * row never repeats a step the transcript already shows.
 */
import type { ThreadMessage } from '@assistant-ui/react';
import { toMessagePartStatus } from '@assistant-ui/core/internal';
import { resolveToolStatus } from '../view-model/compact/tool-status';
import type { CompactToolPart } from '../view-model/compact/types';
import type { MainframeMessageMeta } from '../view-model/message-meta';

export type TurnPhase = 'Needs your input' | 'Stopping' | 'Compacting' | 'Thinking' | 'Writing' | 'Working';
export interface TurnPhaseInputs {
  readonly stopping: boolean;
  readonly compacting: boolean;
  readonly awaitingInput: boolean;
}

const isQueued = (message: ThreadMessage) =>
  (message.metadata?.custom?.mainframe as MainframeMessageMeta | undefined)?.queued === true;

/** The message the row follows: the newest one that is not a queued, not-yet-sent prompt. */
export function statusAnchorId(messages: readonly ThreadMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (!isQueued(messages[index]!)) return messages[index]!.id;
  }
  return null;
}

/** The model-facing phase of the anchor message: reasoning, answering, or running a tool. */
function streamPhase(message: ThreadMessage | undefined, pendingToolIds: ReadonlySet<string>): TurnPhase {
  if (message?.role !== 'assistant') return 'Thinking';
  for (let index = message.content.length - 1; index >= 0; index--) {
    const part = message.content[index]!;
    if (part.type === 'text' && !part.text.trim()) continue;
    const status = toMessagePartStatus(message, index, part);
    if (part.type === 'text' && status.type === 'running') return 'Writing';
    if (part.type === 'tool-call') {
      const tool = { ...part, status } as CompactToolPart;
      return resolveToolStatus(tool, pendingToolIds) === 'running' ? 'Working' : 'Thinking';
    }
    return 'Thinking';
  }
  return 'Thinking';
}

export function turnPhase(
  inputs: TurnPhaseInputs,
  messages: readonly ThreadMessage[],
  pendingToolIds: ReadonlySet<string>,
): TurnPhase {
  if (inputs.stopping) return 'Stopping';
  if (inputs.awaitingInput) return 'Needs your input';
  if (inputs.compacting) return 'Compacting';
  const anchor = statusAnchorId(messages);
  return streamPhase(
    messages.find((message) => message.id === anchor),
    pendingToolIds,
  );
}

/** "1 running task" / "3 running tasks". */
export function runningTasksLabel(count: number): string {
  return `${count} running task${count === 1 ? '' : 's'}`;
}
