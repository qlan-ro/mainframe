import type { DaemonEvent, DisplayMessage, ToolCategories } from '@qlan-ro/mainframe-types';
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
  } else if (newDisplay.length !== oldDisplay.length) {
    // Count changed (message removed, reordered, or added in non-append pattern) — full reset
    emitEvent({ type: 'display.messages.set', chatId, messages: newDisplay });
  } else {
    // Same count — check for order changes or per-message updates
    const orderChanged = newDisplay.some((msg, i) => msg.id !== oldDisplay[i]!.id);
    if (orderChanged) {
      emitEvent({ type: 'display.messages.set', chatId, messages: newDisplay });
    } else {
      // Same count, same order — emit updates for any messages that changed
      for (let i = 0; i < newDisplay.length; i++) {
        if (displayMessageChanged(oldDisplay[i]!, newDisplay[i]!)) {
          emitEvent({ type: 'display.message.updated', chatId, message: newDisplay[i]! });
        }
      }
    }
  }

  displayCache.set(chatId, newDisplay);
}

/** Quick check whether a display message changed (content blocks or metadata). */
function displayMessageChanged(a: DisplayMessage, b: DisplayMessage): boolean {
  if (a.content.length !== b.content.length) return true;
  // Metadata change (e.g. queued badge cleared)
  const aMeta = JSON.stringify(a.metadata ?? {});
  const bMeta = JSON.stringify(b.metadata ?? {});
  if (aMeta !== bMeta) return true;
  // Content block change — compare by serialized form for correctness
  for (let i = 0; i < a.content.length; i++) {
    if (JSON.stringify(a.content[i]) !== JSON.stringify(b.content[i])) return true;
  }
  return false;
}
