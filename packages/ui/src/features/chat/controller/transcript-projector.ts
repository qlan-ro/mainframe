/**
 * `ChatThreadState` → the native `ThreadMessage[]` / `ExportedMessageRepository`
 * assistant-ui consumes, with identity preserved across projections.
 *
 * assistant-ui memoizes per message and per part on object identity
 * (`thread-message-client.js`): a message whose `ThreadMessage` object is the
 * same as last time costs nothing, and a tool-call part whose object is the
 * same keeps its card mounted untouched. `fromThreadMessageLike` builds fresh
 * objects on every call, so projecting the whole state anew on each frame —
 * the previous shape — re-rendered every text part and every tool card in
 * the transcript for each streamed chunk. This projector keeps three caches:
 *  - like → normalized `ThreadMessage` (a `WeakMap`, so an unchanged
 *    converted message — `TranscriptConverter` keeps those stable — maps to
 *    one native object for its lifetime);
 *  - like → its status-stamped variant (`project-messages.ts`'s running /
 *    complete stamps), so stamping doesn't defeat the first cache;
 *  - the previous projection by id, so a message that DID change (the
 *    streaming one) still reuses the native tool-call parts whose source
 *    parts are identical — only the growing text part is new.
 *
 * One instance per mounted thread (the runtime hook / zone owns it);
 * `project-messages.ts`'s one-shot `projectChatThreadRepository` stays for
 * callers that project a state once.
 */
import type { ExportedMessageRepository, ThreadMessage, ThreadMessageLike } from '@assistant-ui/react';
import { normalizeNativeMessage } from '../view-model/normalize-native-messages';
import type { ChatThreadState } from './chat-thread-state';
import { StatusStampCache, projectTrailingMessages, stampServerStatuses } from './project-messages';

interface Projected {
  readonly like: ThreadMessageLike;
  readonly message: ThreadMessage;
}

type ToolCallPart = Extract<ThreadMessage['content'][number], { type: 'tool-call' }>;

function toolCallsById<T extends { type: string }>(parts: readonly T[] | string): Map<string, T> {
  const byId = new Map<string, T>();
  if (typeof parts === 'string') return byId;
  for (const part of parts) {
    if (part.type === 'tool-call') byId.set((part as unknown as ToolCallPart).toolCallId, part);
  }
  return byId;
}

/**
 * Swap each tool-call part of `message` for the previous projection's native
 * part when the part's SOURCE object is unchanged — `fromThreadMessageLike`
 * spreads tool-call parts into new objects every time, which would otherwise
 * re-render every tool card of a streaming message on every chunk.
 */
function reuseToolCallParts(previous: Projected, like: ThreadMessageLike, message: ThreadMessage): ThreadMessage {
  if (message.role !== 'assistant' || previous.message.role !== 'assistant') return message;
  const sourceBefore = toolCallsById(previous.like.content);
  const sourceNow = toolCallsById(like.content);
  const nativeBefore = toolCallsById(previous.message.content);
  let reused = false;
  const content = message.content.map((part) => {
    if (part.type !== 'tool-call') return part;
    const before = sourceBefore.get(part.toolCallId);
    const native = nativeBefore.get(part.toolCallId);
    if (before === undefined || native === undefined || before !== sourceNow.get(part.toolCallId)) return part;
    reused = true;
    return native;
  });
  return reused ? { ...message, content } : message;
}

export class TranscriptProjector {
  private readonly stamps = new StatusStampCache();
  private readonly native = new WeakMap<ThreadMessageLike, ThreadMessage>();
  private previous = new Map<string, Projected>();

  /** The native message list — the `ExternalThread({ messages })` shape the split-view zones feed. */
  projectMessages(state: ChatThreadState): ThreadMessage[] {
    const likes = stampServerStatuses(state.messages, state, this.stamps);
    const next = new Map<string, Projected>();
    const server = likes.map((like) => {
      const message = this.normalize(like);
      next.set(message.id, { like, message });
      return message;
    });
    this.previous = next;
    const serverIds = new Set(server.map((message) => message.id));
    const trailing = projectTrailingMessages(state, serverIds).map((like) => normalizeNativeMessage(like));
    return [...server, ...trailing];
  }

  /** The pre-built repository `useExternalStoreRuntime` imports — a linear parent chain in list order. */
  projectRepository(state: ChatThreadState): ExportedMessageRepository {
    const messages = this.projectMessages(state);
    return {
      messages: messages.map((message, index) => ({
        parentId: index > 0 ? messages[index - 1]!.id : null,
        message,
      })),
    };
  }

  private normalize(like: ThreadMessageLike): ThreadMessage {
    const cached = this.native.get(like);
    if (cached) return cached;
    let message = normalizeNativeMessage(like);
    const previous = this.previous.get(message.id);
    if (previous) message = reuseToolCallParts(previous, like, message);
    this.native.set(like, message);
    return message;
  }
}
