'use client';

/**
 * Every request waiting on the user in this chat, oldest first (G5): its own,
 * its sub-agents' (they arrive in the same queue) and its delegated tasks'.
 */
import { useMemo } from 'react';
import type { ThreadMessage } from '@assistant-ui/react';
import type { ExecutionMode } from '@qlan-ro/mainframe-types';
import type { ActivityEntry } from '@/features/session-panel/activity-model';
import { useAdapters } from '@/store/adapters';
import { useChatExtras } from '../runtime/chat-extras';
import { useLiveMessages } from '../runtime/use-live-messages';
import type { ChatPermissionEntry } from '../controller/chat-thread-state';
import { useDelegatedGates } from './delegated-gates-store';
import type { ReplyFn } from './gate-types';
import { subagentOf } from './subagent-of';

/** Who is asking, when it is not the session itself. */
export interface GateSource {
  name: string;
  title: string;
  /** Whether an activity entry is this asker's row. */
  matches: (entry: ActivityEntry) => boolean;
}

export interface PendingGate {
  /** Unique across the chats that ask: the same request id in two chats is two gates. */
  key: string;
  /** The chat that asks. */
  chatId: string;
  entry: ChatPermissionEntry;
  reply: ReplyFn;
  adapterId: string | undefined;
  /** The asking chat's permission mode. */
  mode: ExecutionMode | undefined;
  from: GateSource | null;
}

export interface GateQueue {
  front: PendingGate | undefined;
  /** How many wait behind the front one. */
  more: number;
  /** The sub-agents' own Agent calls with a request pending. */
  waitingCalls: ReadonlySet<string>;
}

const NO_MESSAGES: readonly ThreadMessage[] = [];

export function useGateQueue(): GateQueue {
  const extras = useChatExtras();
  const permissions = extras?.permissions;
  const pending = permissions != null && Object.keys(permissions).length > 0;
  // Read the transcript only while something waits: naming the sub-agent needs it.
  const live = useLiveMessages();
  const messages = pending ? live : NO_MESSAGES;
  const chatId = extras?.state.chatId;
  const adapterId = extras?.state.chatConfig?.adapterId;
  const mode = extras?.state.chatConfig?.permissionMode;
  const reply = extras?.replyToPermission;
  const byTask = useDelegatedGates((s) => s.byTask);
  const adapters = useAdapters();

  return useMemo(() => {
    const own = Object.values(permissions ?? {})
      .filter((entry): entry is ChatPermissionEntry => entry != null)
      .map((entry) => ({ entry, agent: subagentOf(messages, entry.request.toolUseId) }));
    const gates: PendingGate[] = own.map(({ entry, agent }) => ({
      key: `${chatId}:${entry.requestId}`,
      chatId: chatId ?? '',
      entry,
      reply: reply ?? (() => Promise.reject(new Error('Chat runtime not ready'))),
      adapterId,
      mode,
      from: agent && {
        name: agent.name,
        title: agent.title,
        matches: (row) => row.source?.toolCallId === agent.toolCallId,
      },
    }));
    for (const gate of Object.values(byTask)) {
      if (gate.parentChatId !== chatId) continue;
      const from: GateSource = {
        name: [
          `${adapters.find((a) => a.id === gate.adapterId)?.name ?? 'Delegated'} task`,
          gate.parentTitle && `in “${gate.parentTitle}”`,
        ]
          .filter(Boolean)
          .join(' '),
        title: gate.title,
        matches: (row) => row.delegated?.taskId === gate.topTaskId,
      };
      const { reply: answer, adapterId: askerAdapter, mode: askerMode, chatId: askerChat } = gate;
      gates.push(
        ...gate.entries.map((entry) => ({
          key: `${askerChat}:${entry.requestId}`,
          chatId: askerChat,
          entry,
          reply: answer,
          adapterId: askerAdapter,
          mode: askerMode,
          from,
        })),
      );
    }
    gates.sort((a, b) => a.entry.askedAt - b.entry.askedAt);
    return {
      front: gates[0],
      more: Math.max(0, gates.length - 1),
      waitingCalls: new Set(own.flatMap(({ agent }) => (agent ? [agent.toolCallId] : []))),
    };
  }, [permissions, messages, reply, adapterId, mode, byTask, chatId, adapters]);
}
