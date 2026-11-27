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
import { useLoadParentCall } from './use-load-parent-call';
import { useOwnSubagentCall } from './use-own-subagent-call';

type Part = ThreadMessage['content'][number];

/** What names a part across copies: a tool call by its id, anything else by the item it came from. */
function partKey(part: Part): string | null {
  if (part.type === 'tool-call') return `call:${part.toolCallId}`;
  const itemId = (part as { providerMetadata?: { mainframe?: { itemId?: string } } }).providerMetadata?.mainframe
    ?.itemId;
  return itemId ? `item:${itemId}` : null;
}

/** The parts of both copies of one message: the stream's where it has a part, the fetched one's for the rest. */
function mergeParts(fetched: readonly Part[], live: readonly Part[]): Part[] {
  const liveByKey = new Map(
    live.flatMap((part) => {
      const key = partKey(part);
      return key ? [[key, part] as const] : [];
    }),
  );
  const known = new Set(fetched.flatMap((part) => partKey(part) ?? []));
  return [
    ...fetched.map((part) => liveByKey.get(partKey(part) ?? '') ?? part),
    ...live.filter((part) => {
      const key = partKey(part);
      return key !== null && !known.has(key);
    }),
  ];
}

/**
 * The steps of both copies. A sub-agent's steps are one message whose parts are the steps, so the
 * copies are merged part by part: what the stream has wins, the fetched copy adds what lies above
 * the floor.
 */
export function mergeSteps(
  fetched: readonly ThreadMessage[] = [],
  live: readonly ThreadMessage[] = [],
): readonly ThreadMessage[] {
  if (fetched.length === 0) return live;
  if (live.length === 0) return fetched;
  const liveById = new Map(live.map((step) => [step.id, step]));
  const known = new Set(fetched.map((step) => step.id));
  const merged = fetched.map((step) => {
    const current = liveById.get(step.id);
    if (!current) return step;
    return { ...current, content: mergeParts(step.content, current.content) } as ThreadMessage;
  });
  return [...merged, ...live.filter((step) => !known.has(step.id))];
}

export interface ResolvedCall {
  call: SubagentCall | null;
  /** The messages the call is in: the parent's, or the tab's own copy of them. */
  messages: readonly ThreadMessage[];
  /** The copy is the tab's own, outside the parent's window: older than everything in it. */
  detached: boolean;
  error: string | null;
}

interface Options {
  controller: AcpChatController;
  state: ChatThreadState;
  messages: readonly ThreadMessage[];
  toolCallId: string;
  messageId?: string;
  savedNestedCall?: ToolCallMessagePart;
  taskKey: string;
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

  // The last copy the stream had, kept while a call that left the window is fetched.
  const [lastLive, setLastLive] = useState<{ call: SubagentCall; messages: readonly ThreadMessage[] } | null>(null);
  if (liveCall && lastLive?.call !== liveCall) setLastLive({ call: liveCall, messages });

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

  const detached = !nested && !liveCall && ownCall != null;
  const fallbackError = useLoadParentCall(controller, state, messages, call, {
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
    messages: detached ? ownCall.messages : !liveCall && lastLive ? lastLive.messages : messages,
    detached,
    error,
  };
}
