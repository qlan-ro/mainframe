/**
 * State → ExportedMessageRepository projection.
 *
 * Mirrors react-opencode's `openCodeMessageProjection.ts` but adapted to our
 * ChatThreadState and DisplayMessage types (whole-message daemon protocol).
 *
 * The projection:
 *  1. Walks messageOrder → DisplayMessage → ThreadMessageLike via convertMessage.
 *  2. Inserts pending user messages (optimistic send) interleaved by createdAt.
 *  3. Returns ExportedMessageRepository.fromArray([...]).
 *
 * convertMessage handles all DisplayContent → content-part mapping including
 * the WS14c dual re-encode, \0 permission sentinel, and uniqueId dedup.
 * We delegate to it unchanged so the projection stays thin.
 */
import { ExportedMessageRepository } from '@assistant-ui/react';
import type { ThreadMessage, ThreadMessageLike, ThreadUserMessage } from '@assistant-ui/react';
import { convertMessage } from '../view-model/convert-message';
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
                error:
                  pending.error instanceof Error ? pending.error.message : String(pending.error ?? 'Failed to send'),
              }
            : {}),
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Projection entry
// ---------------------------------------------------------------------------

export function projectChatThreadMessages(state: ChatThreadState): ThreadMessage[] {
  // Server messages in order — convertMessage returns ThreadMessageLike; a single
  // cast suffices because fromArray also accepts ThreadMessageLike[], but we want
  // a consistent ThreadMessage[] for downstream hooks.
  const serverMessages: ThreadMessage[] = state.messageOrder
    .map((id) => state.messagesById[id])
    .filter((msg): msg is NonNullable<typeof msg> => msg != null)
    .map((msg) => convertMessage(msg) as ThreadMessageLike as ThreadMessage);

  // Streaming "typing" reveal: while a run is active, mark the TAIL assistant
  // message `running` so assistant-ui's default useSmooth (in MarkdownTextPrimitive)
  // reveals its text character-by-character as the daemon streams
  // display.message.updated deltas. We use a pre-built messageRepository, which
  // assistant-ui imports verbatim WITHOUT the auto-status it applies on the
  // messages+convertMessage path — so the running status must be set here, or
  // every message stays `complete` and appears instantly. Only the tail streams;
  // earlier turns and all loaded history (runState idle) stay complete/instant.
  if (state.runState.type === 'running') {
    for (let i = serverMessages.length - 1; i >= 0; i--) {
      const msg = serverMessages[i]!;
      if (msg.role === 'assistant') {
        serverMessages[i] = { ...msg, status: { type: 'running' } } as ThreadMessage;
        break;
      }
    }
  }

  // Pending (optimistic) messages sorted by createdAt
  const pendingMessages: ThreadUserMessage[] = Object.values(state.pendingUserMessages)
    .filter((p): p is PendingUserMessage => p != null)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(projectPendingMessage);

  // Merge: pending at end (they are always "newest" — sent just now).
  // If the fingerprint dedup has reconciled them they won't appear here.
  return [...serverMessages, ...pendingMessages];
}

export function projectChatThreadRepository(state: ChatThreadState) {
  return ExportedMessageRepository.fromArray(projectChatThreadMessages(state));
}
