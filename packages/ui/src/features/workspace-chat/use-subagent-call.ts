/**
 * The call a sub-agent tab shows, and which copy of it (todo #460).
 *
 * The live stream owns a call whenever the parent's window holds it, a context ancestor included
 * (the stream keeps those current). Only what the window lacks is fetched: the whole call when it
 * is below the floor, the steps above the floor for a context call. The fetched copy lives in the
 * tab (`useOwnSubagentCall`) and is never merged into the parent transcript.
 */
import { useMemo, useState } from 'react';
import type { ThreadMessage, ToolCallMessagePart } from '@assistant-ui/react';
import type { AcpChatController } from '@/features/chat/controller/acp-chat-controller';
import type { ChatThreadState } from '@/features/chat/controller/chat-thread-state';
import { findSubagentCall, type SubagentCall } from './find-subagent-call';
import { mergeSteps } from './merge-steps';
import { useLoadParentCall } from './use-load-parent-call';
import { useOwnSubagentCall } from './use-own-subagent-call';

export interface ResolvedCall {
  call: SubagentCall | null;
  /** The messages the call is in: the parent's, or the tab's own copy of them. */
  messages: readonly ThreadMessage[];
  /** The copy is the tab's own, outside the parent's window: older than everything in it. */
  detached: boolean;
  /** The daemon cut the oldest steps of the fetched copy short (`hasMoreDescendants`). */
  omitted: boolean;
  error: string | null;
}

interface Options {
  controller: AcpChatController;
  state: ChatThreadState;
  messages: readonly ThreadMessage[];
  toolCallId: string;
  messageId?: string;
  savedNestedCall?: ToolCallMessagePart;
  taskKey: string | null;
  active: boolean;
}

export function useSubagentCall(options: Options): ResolvedCall {
  const { controller, state, messages, toolCallId, messageId, savedNestedCall, taskKey, active } = options;
  const nested = !!savedNestedCall;
  const liveCall = useMemo(
    () => (nested ? null : findSubagentCall(messages, toolCallId)),
    [messages, toolCallId, nested],
  );
  // Whether the call is in the window is known only once the window has loaded.
  const ready = state.loadState?.type === 'ready';
  const partial = liveCall != null && controller.isHistoryContext(toolCallId);
  const enabled = !nested && ready && (liveCall == null || partial);
  const own = useOwnSubagentCall({ controller, state, toolCallId, enabled, taskKey, active });
  const fallback = enabled && own.kind === 'unsupported';

  // The last copy the stream had, kept while a call that left the window is fetched. It is kept
  // with the message that holds it, which changes only when the call's own message does.
  const container = liveCall ? messages.find(({ id }) => id === liveCall.messageId) : undefined;
  const [lastLive, setLastLive] = useState<{ call: SubagentCall; container: ThreadMessage | undefined } | null>(null);
  if (liveCall && (lastLive?.call !== liveCall || lastLive.container !== container)) {
    setLastLive({ call: liveCall, container });
  }

  const ownCall = enabled && own.kind === 'call' ? own : null;
  const call = useMemo<SubagentCall | null>(() => {
    if (savedNestedCall) return { part: savedNestedCall, messageId: messageId ?? toolCallId };
    if (liveCall && partial && ownCall) {
      const steps = mergeSteps(ownCall.call.part.messages, liveCall.part.messages);
      return { ...liveCall, part: { ...liveCall.part, messages: steps } as ToolCallMessagePart };
    }
    if (liveCall) return liveCall;
    return ownCall?.call ?? lastLive?.call ?? null;
  }, [savedNestedCall, messageId, toolCallId, liveCall, partial, ownCall, lastLive]);

  // A copy kept for a call that left the window is as old as the window's first turn.
  const detached = !nested && !liveCall && (ownCall != null || lastLive != null);
  // The paging fallback looks for the call in the window itself, so it runs again when the call leaves it.
  const fallbackError = useLoadParentCall(controller, state, messages, liveCall, {
    toolCallId,
    messageId,
    nested,
    fallback,
  });
  let error: string | null = null;
  if (fallback) error = fallbackError;
  else if (own.kind === 'error') error = own.message;
  else if (own.kind === 'missing') error = 'Not in this transcript';
  return {
    call,
    messages:
      ownCall && detached ? ownCall.messages : !liveCall && lastLive?.container ? [lastLive.container] : messages,
    detached,
    omitted: ownCall?.omitted ?? false,
    error,
  };
}
