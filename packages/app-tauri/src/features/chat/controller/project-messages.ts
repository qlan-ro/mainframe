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
import type { ThreadMessage } from '@assistant-ui/react';
import { convertMessage } from '../view-model/convert-message';
import type { ChatThreadState, PendingUserMessage } from './chat-thread-state';

// ---------------------------------------------------------------------------
// Pending message projection
// ---------------------------------------------------------------------------

function projectPendingMessage(pending: PendingUserMessage): ThreadMessage {
  return {
    id: `local:${pending.clientId}`,
    role: 'user',
    content: [{ type: 'text', text: pending.text }],
    attachments: [],
    createdAt: new Date(pending.createdAt),
    status: { type: 'complete', reason: 'unknown' },
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
  } satisfies ThreadMessage;
}

// ---------------------------------------------------------------------------
// Projection entry
// ---------------------------------------------------------------------------

export function projectChatThreadMessages(state: ChatThreadState): ThreadMessage[] {
  // Server messages in order
  const serverMessages: ThreadMessage[] = state.messageOrder
    .map((id) => state.messagesById[id])
    .filter((msg): msg is NonNullable<typeof msg> => msg != null)
    .map((msg) => {
      const like = convertMessage(msg);
      // convertMessage returns ThreadMessageLike; cast to ThreadMessage.
      // ExportedMessageRepository.fromArray accepts ThreadMessageLike too,
      // but typing consistently makes downstream hooks simpler.
      return like as unknown as ThreadMessage;
    });

  // Pending (optimistic) messages sorted by createdAt
  const pendingMessages: ThreadMessage[] = Object.values(state.pendingUserMessages)
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
