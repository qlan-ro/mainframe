/**
 * Delegated task results (T1f). The daemon delivers a finished task to its
 * parent as a `<mainframe-task-result>` message; the task's own card shows that
 * result, so the message is absorbed wherever its card is in the loaded
 * history. A result without one keeps a line of its own.
 */
import type { ThreadMessage } from '@assistant-ui/react';
import type { TaskStatus } from '@qlan-ro/mainframe-types';
import { parseTaskResults, type TaskResultMarker } from '../../markers/agent-message';
import { isTaskStatus, parseDelegateResult } from '../../orchestration/delegate-result';
import { resolveResultText } from '../../tools/shared/result';
import { toolKind } from './tool-kind';

interface TaskCard {
  readonly taskId: string;
  readonly toolCallId: string;
}

/** Messages keep their identity while they don't change, so each is parsed once. */
const resultsOf = new WeakMap<ThreadMessage, readonly TaskResultMarker[]>();
const cardsOf = new WeakMap<ThreadMessage, readonly TaskCard[]>();
const NONE: readonly never[] = [];

function memo<T>(cache: WeakMap<ThreadMessage, T>, message: ThreadMessage, build: () => T): T {
  const known = cache.get(message);
  if (known !== undefined) return known;
  const value = build();
  cache.set(message, value);
  return value;
}

export function taskResultsIn(message: ThreadMessage): readonly TaskResultMarker[] {
  if (message.role !== 'user') return NONE;
  return memo(resultsOf, message, () => {
    const text = message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');
    return parseTaskResults(text) ?? NONE;
  });
}

function taskCardsIn(message: ThreadMessage): readonly TaskCard[] {
  if (message.role !== 'assistant') return NONE;
  return memo(cardsOf, message, () =>
    message.content.flatMap((part) => {
      if (part.type !== 'tool-call' || toolKind(part.toolName) !== 'delegate' || part.isError) return [];
      const parsed = parseDelegateResult(resolveResultText(part.result).text);
      return parsed ? [{ taskId: parsed.taskId, toolCallId: part.toolCallId }] : [];
    }),
  );
}

/** Result messages whose every task has its card in the loaded history, with the cards' calls. */
export function absorbedTaskResults(messages: readonly ThreadMessage[]): Map<string, readonly string[]> {
  const cards = new Map(messages.flatMap(taskCardsIn).map((card) => [card.taskId, card.toolCallId]));
  const absorbed = new Map<string, readonly string[]>();
  for (const message of messages) {
    const calls = taskResultsIn(message).map((result) => cards.get(result.taskId));
    if (calls.length && calls.every((call) => call !== undefined)) absorbed.set(message.id, calls);
  }
  return absorbed;
}

/** Each task's status as its latest delivered result carries it. */
export function taskResultStatuses(messages: readonly ThreadMessage[]): Map<string, TaskStatus> {
  const statuses = new Map<string, TaskStatus>();
  for (const message of messages)
    for (const { taskId, status } of taskResultsIn(message)) if (isTaskStatus(status)) statuses.set(taskId, status);
  return statuses;
}

/** A task's latest delivered result. */
export function taskResult(messages: readonly ThreadMessage[], taskId: string): TaskResultMarker | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const found = taskResultsIn(messages[index]!).filter((result) => result.taskId === taskId);
    if (found.length) return found[found.length - 1];
  }
  return undefined;
}
