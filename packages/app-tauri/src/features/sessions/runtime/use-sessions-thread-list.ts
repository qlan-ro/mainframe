/**
 * The single global sessions runtime (D1/§3.1).
 *
 * useRemoteThreadListRuntime owns per-chat runtime lifecycle via runtimeHook
 * (one subtree per alive thread) and lists/creates/archives chats via the
 * chats REST adapter. App mounts exactly one of these at the root (via
 * ChatRuntimeProvider); the sidebar and the chat surface both live under its
 * AssistantRuntimeProvider.
 *
 * The adapter is memoized by port so a stable identity survives re-renders
 * (a fresh adapter each render would churn the remote-list machinery).
 */
import { useMemo } from 'react';
import { useRemoteThreadListRuntime } from '@assistant-ui/react';
import type { AssistantRuntime } from '@assistant-ui/react';
import { makeChatsRemoteAdapter } from './chats-remote-adapter';
import { useChatRuntimeHook } from './use-chat-runtime-hook';
import { useDaemonPort } from './daemon-port-context';

export function useSessionsThreadList(): AssistantRuntime {
  const port = useDaemonPort();
  const adapter = useMemo(() => makeChatsRemoteAdapter(port), [port]);
  return useRemoteThreadListRuntime({ runtimeHook: useChatRuntimeHook, adapter });
}
