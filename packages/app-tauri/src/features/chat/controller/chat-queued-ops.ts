/**
 * Queued-message ops — thin REST wrappers the controller delegates to, extracted
 * so the controller stays under the 300-line limit. The daemon owns the queued
 * state; these just forward the cancel/edit to it.
 */
import { cancelQueuedMessage, editQueuedMessage } from '../../../lib/api/chats';

export function cancelQueued(port: number, chatId: string, messageId: string): Promise<void> {
  return cancelQueuedMessage(port, chatId, messageId);
}

export function editQueued(port: number, chatId: string, messageId: string, content: string): Promise<void> {
  return editQueuedMessage(port, chatId, messageId, content);
}
