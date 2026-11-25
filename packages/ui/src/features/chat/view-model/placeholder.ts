/**
 * assistant-ui's stand-in for a reply that has not begun. While a run goes and
 * the last message isn't the assistant's, it appends an empty running assistant
 * message, with a new id on every update. Nobody said it, so it is no turn, has
 * no time and carries no status. Pure.
 */
import type { ThreadMessage } from '@assistant-ui/react';

export const isPlaceholder = (message: ThreadMessage | undefined): boolean =>
  message?.metadata?.isOptimistic === true && message.content.length === 0;

/** How many messages the thread holds, the stand-in left out. */
export const messageCount = (messages: readonly ThreadMessage[]): number =>
  messages.length - (isPlaceholder(messages[messages.length - 1]) ? 1 : 0);
