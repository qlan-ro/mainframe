/**
 * State → ExportedMessageRepository projection.
 *
 * Mirrors react-opencode's `openCodeMessageProjection.ts`. The transcript
 * arrives already converted (`state.messages`, produced by the ACP session
 * plane through `convert-acp-item.ts`); the projection appends the pending
 * (optimistic) user messages and stamps the streaming tail.
 */
import { ExportedMessageRepository } from '@assistant-ui/react';
import type { ThreadMessage, ThreadMessageLike, ThreadUserMessage } from '@assistant-ui/react';
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
// Projection entry
// ---------------------------------------------------------------------------

export function projectChatThreadMessages(state: ChatThreadState): ThreadMessage[] {
  // Already-converted server messages in order — a single cast suffices
  // because fromArray also accepts ThreadMessageLike[], but we want a
  // consistent ThreadMessage[] for downstream hooks.
  const serverMessages: ThreadMessage[] = state.messages.map((m) => m as ThreadMessageLike as ThreadMessage);

  // Streaming "typing" reveal: while a run is active, mark the TAIL assistant
  // message `running` so assistant-ui's default useSmooth (in MarkdownTextPrimitive)
  // reveals its text character-by-character as the facade streams
  // session/update chunks. We use a pre-built messageRepository, which
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
