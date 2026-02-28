import type { DaemonEvent, DisplayMessage, ToolCategories } from '@mainframe/types';
import type { MessageCache } from './message-cache.js';
import { prepareMessagesForClient } from '../messages/display-pipeline.js';

/**
 * Compares old and new display message arrays and emits the appropriate
 * display.message.added / display.message.updated / display.messages.set
 * events. Updates the display cache in place.
 */
export function emitDisplayDelta(
  chatId: string,
  messages: MessageCache,
  displayCache: Map<string, DisplayMessage[]>,
  categories: ToolCategories | undefined,
  emitEvent: (event: DaemonEvent) => void,
): void {
  const raw = messages.get(chatId) ?? [];
  const newDisplay = prepareMessagesForClient(raw, categories);
  const oldDisplay = displayCache.get(chatId) ?? [];

  if (oldDisplay.length === 0) {
    if (newDisplay.length > 0) {
      emitEvent({ type: 'display.messages.set', chatId, messages: newDisplay });
    }
  } else if (newDisplay.length > oldDisplay.length) {
    // Check if the last existing message was updated (tool_result merged)
    if (oldDisplay.length > 0) {
      const lastOld = oldDisplay[oldDisplay.length - 1]!;
      const lastNewAtOldIdx = newDisplay[oldDisplay.length - 1];
      if (
        lastNewAtOldIdx &&
        lastNewAtOldIdx.id === lastOld.id &&
        lastNewAtOldIdx.content.length !== lastOld.content.length
      ) {
        emitEvent({ type: 'display.message.updated', chatId, message: lastNewAtOldIdx });
      }
    }
    // Emit added events for new messages
    for (let i = oldDisplay.length; i < newDisplay.length; i++) {
      emitEvent({ type: 'display.message.added', chatId, message: newDisplay[i]! });
    }
  } else if (newDisplay.length === oldDisplay.length && newDisplay.length > 0) {
    // Same count — the last message was probably updated
    const lastNew = newDisplay[newDisplay.length - 1]!;
    emitEvent({ type: 'display.message.updated', chatId, message: lastNew });
  }

  displayCache.set(chatId, newDisplay);
}
