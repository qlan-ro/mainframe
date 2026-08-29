/**
 * Pure function: DaemonEvent → ChatStateEvent | null, for the SIDE-BAND
 * event families only (desktop-cutover pass). The transcript, run frames,
 * and gates arrive over the ACP facade (`acp-session-plane.ts`); this mapper
 * handles what the facade does not model: config, queue refs, background
 * tasks, workflow runs, worktree offers, context usage, and compaction.
 * The legacy `display.*` and `permission.*` frames no longer exist — the
 * daemon retired them with the chat dialect (todo #350).
 */
import { toActivityTask, type DaemonEvent } from '@qlan-ro/mainframe-types';
import type { ChatStateEvent } from './chat-thread-state';

export type HandleResult = { kind: 'event'; event: ChatStateEvent } | { kind: 'noop' };

/** Maps a raw DaemonEvent to a HandleResult for the given chatId. */
export function handleDaemonEvent(event: DaemonEvent, chatId: string): HandleResult {
  switch (event.type) {
    case 'messages.cleared':
      if (event.chatId !== chatId) return { kind: 'noop' };
      return { kind: 'event', event: { type: 'transcript.cleared' } };

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

    // A spawned CLI is not a turn in flight. Restarts that carry no turn — a
    // worktree switch, a config change — would otherwise strand the thread on
    // "running" forever, since no result event is ever coming. Real runs arrive
    // as `chat.updated` with isRunning, plus the optimistic dispatch on send.
    case 'process.started':
      return { kind: 'noop' };

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

    case 'background_task.started':
    case 'background_task.updated':
      if (event.chatId !== chatId) return { kind: 'noop' };
      // A non-running payload (e.g. an adopt replay of a finished task) means
      // the task is no longer live — treat it as ended so it can't stick.
      if (event.task.status !== 'running') {
        return { kind: 'event', event: { type: 'background.ended', taskId: event.task.id } };
      }
      return { kind: 'event', event: { type: 'background.upsert', task: toActivityTask(event.task) } };

    case 'claude_workflow.run.updated':
      if (event.chatId !== chatId) return { kind: 'noop' };
      return { kind: 'event', event: { type: 'workflow.run.updated', run: event.run } };

    case 'background_task.ended':
      if (event.chatId !== chatId) return { kind: 'noop' };
      return { kind: 'event', event: { type: 'background.ended', taskId: event.task.id } };

    case 'worktree.offer.raised':
      if (event.chatId !== chatId) return { kind: 'noop' };
      return { kind: 'event', event: { type: 'worktree.offer.added', offer: event.offer } };

    case 'worktree.offer.resolved':
      if (event.chatId !== chatId) return { kind: 'noop' };
      return { kind: 'event', event: { type: 'worktree.offer.removed', worktreePath: event.worktreePath } };

    case 'worktree.offer.snapshot':
      if (event.chatId !== chatId) return { kind: 'noop' };
      return { kind: 'event', event: { type: 'worktree.offer.snapshot', offers: event.offers } };

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
