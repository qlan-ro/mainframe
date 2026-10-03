/**
 * State → message-list projection.
 *
 * Mirrors react-opencode's `openCodeMessageProjection.ts`. The transcript
 * arrives already converted (`state.messages`, produced by the ACP session
 * plane through `convert-acp-item.ts`); pending and queued user messages
 * follow it. Only legacy daemons need the nearest-assistant running fallback.
 *
 * The identity-preserving native projection (`TranscriptProjector`,
 * `transcript-projector.ts`) is built on the pieces exported here.
 */
import type {
  ExportedMessageRepository,
  ThreadMessage,
  ThreadMessageLike,
  ThreadUserMessage,
} from '@assistant-ui/react';
import type { QueuedMessageRef } from '@qlan-ro/mainframe-types';
import { normalizeNativeRepository } from '../view-model/normalize-native-messages';
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

/**
 * Everything that follows the confirmed transcript: queued turns (D1), then
 * the pending (optimistic) sends sorted by createdAt — always "newest", sent
 * just now; a reconciled pending no longer appears here.
 */
export function projectTrailingMessages(
  state: ChatThreadState,
  serverMessageIds: ReadonlySet<string>,
): ThreadUserMessage[] {
  const queued = projectQueuedMessages(state, serverMessageIds);
  const pending = Object.values(state.pendingUserMessages)
    .filter((p): p is PendingUserMessage => p != null)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(projectPendingMessage);
  return [...queued, ...pending];
}

// ---------------------------------------------------------------------------
// Server-message status stamps
// ---------------------------------------------------------------------------

type AssistantStatus = NonNullable<ThreadMessageLike['status']>;

const COMPLETE_STATUS: AssistantStatus = Object.freeze({ type: 'complete', reason: 'unknown' });
const RUNNING_STATUS: AssistantStatus = Object.freeze({ type: 'running' });

/**
 * Keeps one stamped variant per (like, status) so re-projecting an unchanged
 * like yields the same object — a fresh spread per projection would defeat
 * every identity-based cache downstream of it.
 */
export class StatusStampCache {
  private readonly stamped = new WeakMap<
    ThreadMessageLike,
    Partial<Record<AssistantStatus['type'], ThreadMessageLike>>
  >();

  stamp(like: ThreadMessageLike, status: AssistantStatus): ThreadMessageLike {
    const variants = this.stamped.get(like) ?? {};
    const existing = variants[status.type];
    if (existing) return existing;
    const stamped: ThreadMessageLike = { ...like, status };
    variants[status.type] = stamped;
    this.stamped.set(like, variants);
    return stamped;
  }
}

/**
 * Message-level status for the confirmed transcript. With authoritative item
 * streaming every assistant message without its own status is complete; a
 * legacy daemon instead gets the nearest assistant message stamped running
 * while the turn runs (`cancelling` counts), unless one already carries its
 * own `running` status (D6 — never second-guessed).
 */
export function stampServerStatuses(
  messages: readonly ThreadMessageLike[],
  state: ChatThreadState,
  cache: StatusStampCache = new StatusStampCache(),
): ThreadMessageLike[] {
  if (state.authoritativeItemStreaming) {
    return messages.map((message) =>
      message.role === 'assistant' && message.status === undefined ? cache.stamp(message, COMPLETE_STATUS) : message,
    );
  }
  const running = state.runState.type === 'running' || state.runState.type === 'cancelling';
  const alreadyRunning = messages.some((message) => message.role === 'assistant' && message.status?.type === 'running');
  const stamped = [...messages];
  if (running && !alreadyRunning) {
    for (let index = stamped.length - 1; index >= 0; index--) {
      const message = stamped[index]!;
      if (message.role === 'assistant') {
        stamped[index] = cache.stamp(message, RUNNING_STATUS);
        break;
      }
    }
  }
  return stamped;
}

// ---------------------------------------------------------------------------
// Projection entry
// ---------------------------------------------------------------------------

export function projectChatThreadMessages(state: ChatThreadState): ThreadMessage[] {
  // Already-converted server messages in order — a single cast suffices
  // because the native normalizer also accepts ThreadMessageLike[], but
  // downstream hooks want a consistent ThreadMessage[].
  const serverMessages = stampServerStatuses(state.messages, state).map((m) => m as ThreadMessageLike as ThreadMessage);
  const serverMessageIds = new Set(serverMessages.map((m) => m.id));
  return [...serverMessages, ...projectTrailingMessages(state, serverMessageIds)];
}

/** One-shot native projection with no identity cache — the mounted runtime uses `TranscriptProjector` instead. */
export function projectChatThreadRepository(state: ChatThreadState): ExportedMessageRepository {
  return normalizeNativeRepository(projectChatThreadMessages(state));
}
