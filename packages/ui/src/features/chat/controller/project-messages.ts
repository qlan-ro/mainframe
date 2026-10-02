/**
 * State → ExportedMessageRepository projection.
 *
 * Mirrors react-opencode's `openCodeMessageProjection.ts`. The transcript
 * arrives already converted (`state.messages`, produced by the ACP session
 * plane through `convert-acp-item.ts`); pending and queued user messages
 * follow it. Only legacy daemons need the nearest-assistant running fallback.
 */
import { ExportedMessageRepository } from '@assistant-ui/react';
import type { ThreadMessage, ThreadMessageLike, ThreadUserMessage } from '@assistant-ui/react';
import type { QueuedMessageRef } from '@qlan-ro/mainframe-types';
import { describeSendError } from './describe-send-error';
import type { ChatThreadState, PendingUserMessage } from './chat-thread-state';

// ---------------------------------------------------------------------------
// Pending message projection
// ---------------------------------------------------------------------------

/**
 * Typed factory for non-assistant messages. Returning `ThreadUserMessage` —
 * which structurally has no `status` field — makes a future re-introduction
 * of `status` on user/system messages a compile error rather than the runtime
 * throw ("status is only supported for assistant messages") that assistant-ui
 * raises inside `fromThreadMessageLike` for non-assistant roles.
 */
function makeUserMessage(fields: Omit<ThreadUserMessage, 'role'>): ThreadUserMessage {
  return { role: 'user', ...fields };
}

function projectPendingMessage(pending: PendingUserMessage): ThreadUserMessage {
  return makeUserMessage({
    id: `local:${pending.clientId}`,
    content: [{ type: 'text', text: pending.text }],
    attachments: [],
    createdAt: new Date(pending.createdAt),
    metadata: {
      custom: {
        mainframe: {
          pending: true,
          clientId: pending.clientId,
          ...(pending.status === 'failed'
            ? {
                error: describeSendError(pending.error, { attachmentsRestored: pending.attachmentsRestored === true }),
                attachmentsRestored: pending.attachmentsRestored === true,
              }
            : {}),
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Queued-turn projection (D1): the encoder drops messages carrying `queued`
// metadata, so queued turns render from `state.interactions.queued` alone.
// ---------------------------------------------------------------------------

function projectQueuedMessage(ref: QueuedMessageRef): ThreadUserMessage {
  return makeUserMessage({
    id: ref.messageId,
    content: [{ type: 'text', text: ref.content }],
    attachments: [],
    createdAt: new Date(ref.timestamp),
    metadata: { custom: { mainframe: { queued: true } } },
  });
}

/**
 * Queued refs in FIFO order, skipping any whose `messageId` already appears
 * in the confirmed transcript — the window between the dequeue's create
 * frame and the next `queue_state` snapshot, which would otherwise render
 * the same turn twice.
 */
function projectQueuedMessages(state: ChatThreadState, serverMessageIds: ReadonlySet<string>): ThreadUserMessage[] {
  return Object.values(state.interactions.queued)
    .filter((ref) => !serverMessageIds.has(ref.messageId))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map(projectQueuedMessage);
}

// ---------------------------------------------------------------------------
// Projection entry
// ---------------------------------------------------------------------------

function projectServerMessages(state: ChatThreadState): ThreadMessage[] {
  const messages = state.messages.map((message) => message as ThreadMessageLike as ThreadMessage);
  if (state.authoritativeItemStreaming) {
    return messages.map((message) =>
      message.role === 'assistant' && message.status === undefined
        ? { ...message, status: { type: 'complete', reason: 'unknown' } }
        : message,
    );
  }
  const running = state.runState.type === 'running' || state.runState.type === 'cancelling';
  const alreadyRunning = messages.some((message) => message.role === 'assistant' && message.status?.type === 'running');
  if (running && !alreadyRunning) {
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]!;
      if (message.role === 'assistant') {
        messages[index] = { ...message, status: { type: 'running' } };
        break;
      }
    }
  }
  return messages;
}

export function projectChatThreadMessages(state: ChatThreadState): ThreadMessage[] {
  const serverMessages = projectServerMessages(state);

  // Queued turns (D1) — the encoder never sends these as part of the
  // transcript, so they render from the queue snapshot alone, between the
  // confirmed transcript and any still-in-flight optimistic send.
  const serverMessageIds = new Set(serverMessages.map((m) => m.id));
  const queuedMessages = projectQueuedMessages(state, serverMessageIds);

  // Pending (optimistic) messages sorted by createdAt
  const pendingMessages: ThreadUserMessage[] = Object.values(state.pendingUserMessages)
    .filter((p): p is PendingUserMessage => p != null)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(projectPendingMessage);

  // Merge: pending at end (they are always "newest" — sent just now).
  // If the fingerprint dedup has reconciled them they won't appear here.
  return [...serverMessages, ...queuedMessages, ...pendingMessages];
}

export function projectChatThreadRepository(state: ChatThreadState) {
  return ExportedMessageRepository.fromArray(projectChatThreadMessages(state));
}
