/**
 * A match in a message another element stands for: a delegated task's result,
 * shown in its task's row, or a skill's text, shown in its marker. The message
 * itself draws nothing, so the match is shown where its text is.
 */
import type { ThreadMessage } from '@assistant-ui/react';
import { showActivityRow } from '@/features/session-panel/activity-source';
import { taskResultsIn } from '../view-model/turn/task-results';

/** Several results can come in one message; the one that holds the query, else the first. */
function callFor(calls: readonly string[], message: ThreadMessage | undefined, query: string): string {
  const results = message ? taskResultsIn(message) : [];
  const index = results.findIndex(({ body }) => body.toLowerCase().includes(query.toLowerCase()));
  return calls[Math.max(0, index)] ?? calls[0]!;
}

const holdsCall = (messages: readonly ThreadMessage[], toolCallId: string) =>
  messages.find((message) =>
    message.content.some((part) => part.type === 'tool-call' && part.toolCallId === toolCallId),
  );

/** Opens the row, or nothing when the element draws its own message. */
export async function showAbsorbedMatch(
  chatId: string,
  element: HTMLElement,
  query: string,
  messages: readonly ThreadMessage[],
): Promise<HTMLElement | undefined> {
  const calls = element.dataset.absorbedBy?.split(' ');
  if (!calls?.length) return undefined;
  const own = messages.find((message) => message.id === element.dataset.messageId);
  const toolCallId = callFor(calls, own, query);
  const holder = holdsCall(messages, toolCallId);
  if (!holder) return undefined;
  const row = await showActivityRow(chatId, { messageId: holder.id, toolCallId }, { open: true, focus: false });
  if (row) row.dataset.findRow = element.dataset.messageId;
  return row;
}
