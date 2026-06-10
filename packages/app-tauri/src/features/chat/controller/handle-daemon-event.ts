/**
 * Pure function: DaemonEvent → ChatStateEvent | null.
 *
 * Extracted from ChatThreadController to keep that file under 300 lines.
 * Returns null for events that don't concern this chat or are not handled.
 * The "refetch-on-gap" signal is a special return value so the controller
 * can call refresh() without this module knowing about HTTP.
 */
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import type { ChatStateEvent } from './chat-thread-state';

export type HandleResult = { kind: 'event'; event: ChatStateEvent } | { kind: 'refresh' } | { kind: 'noop' };

/**
 * Maps a raw DaemonEvent to a HandleResult for the given chatId.
 * `knownMessageIds` is used only for the refetch-on-gap check.
 */
export function handleDaemonEvent(
  event: DaemonEvent,
  chatId: string,
  knownMessageIds: Readonly<Record<string, unknown>>,
): HandleResult {
  switch (event.type) {
    case 'display.message.added':
      if (event.chatId !== chatId) return { kind: 'noop' };
      return { kind: 'event', event: { type: 'message.added', message: event.message } };

    case 'display.message.updated':
      if (event.chatId !== chatId) return { kind: 'noop' };
      // Refetch-on-gap: updated message not in state → we missed an add.
      if (!(event.message.id in knownMessageIds)) return { kind: 'refresh' };
      return { kind: 'event', event: { type: 'message.updated', message: event.message } };

    case 'display.messages.set':
      if (event.chatId !== chatId) return { kind: 'noop' };
      return { kind: 'event', event: { type: 'history.loaded', messages: event.messages } };

    case 'messages.cleared':
      if (event.chatId !== chatId) return { kind: 'noop' };
      return { kind: 'event', event: { type: 'messages.cleared' } };

    case 'chat.updated': {
      if (event.chat.id !== chatId) return { kind: 'noop' };
      if (event.chat.isRunning === false) {
        return { kind: 'event', event: { type: 'run.stopped' } };
      }
      if (event.chat.isRunning === true) {
        return { kind: 'event', event: { type: 'run.started' } };
      }
      return { kind: 'noop' };
    }

    case 'process.started':
      if (event.chatId !== chatId) return { kind: 'noop' };
      return { kind: 'event', event: { type: 'run.started' } };

    case 'permission.requested':
      if (event.chatId !== chatId) return { kind: 'noop' };
      return {
        kind: 'event',
        event: {
          type: 'permission.requested',
          requestId: event.request.requestId,
          request: event.request,
        },
      };

    case 'permission.resolved':
      if (event.chatId !== chatId) return { kind: 'noop' };
      return {
        kind: 'event',
        event: { type: 'permission.resolved', requestId: event.requestId },
      };

    case 'message.queued':
      if (event.chatId !== chatId) return { kind: 'noop' };
      return { kind: 'event', event: { type: 'queued.added', ref: event.ref } };

    case 'message.queued.processed':
      if (event.chatId !== chatId) return { kind: 'noop' };
      return { kind: 'event', event: { type: 'queued.removed', uuid: event.uuid } };

    case 'message.queued.cancelled':
      if (event.chatId !== chatId) return { kind: 'noop' };
      return { kind: 'event', event: { type: 'queued.removed', uuid: event.uuid } };

    case 'message.queued.cleared':
      if (event.chatId !== chatId) return { kind: 'noop' };
      return { kind: 'event', event: { type: 'queued.cleared' } };

    case 'message.queued.snapshot':
      if (event.chatId !== chatId) return { kind: 'noop' };
      return { kind: 'event', event: { type: 'queued.snapshot', refs: event.refs } };

    case 'message.queued.cancel_failed':
      if (event.chatId !== chatId) return { kind: 'noop' };
      return { kind: 'event', event: { type: 'queued.cancel_failed', uuid: event.uuid } };

    case 'chat.contextUsage':
      if (event.chatId !== chatId) return { kind: 'noop' };
      return {
        kind: 'event',
        event: {
          type: 'context.usage',
          percentage: event.percentage,
          totalTokens: event.totalTokens,
          maxTokens: event.maxTokens,
        },
      };

    case 'chat.compacting':
      if (event.chatId !== chatId) return { kind: 'noop' };
      return { kind: 'event', event: { type: 'compact.started' } };

    case 'chat.compactDone':
      if (event.chatId !== chatId) return { kind: 'noop' };
      return { kind: 'event', event: { type: 'compact.done' } };

    case 'error':
      // chatId is optional on error events. Ignore only when explicitly
      // targeting a different chat; a missing chatId means it is global and
      // applies to whatever chat is currently running.
      if (event.chatId !== undefined && event.chatId !== chatId) return { kind: 'noop' };
      return { kind: 'event', event: { type: 'run.failed', error: event.error } };

    default:
      return { kind: 'noop' };
  }
}
