/**
 * ChatRuntimeProvider — the app's single chat-runtime root.
 *
 * Mounts ONE global sessions runtime (useSessionsThreadList) under
 * AssistantRuntimeProvider + DaemonPortProvider. assistant-ui keeps every
 * visited thread's subtree warm; per-chat controllers live in the module-level
 * chatControllerRegistry and bind via the runtimeHook. This replaces the old
 * per-provider controller map + `key={chatId}` remount.
 *
 * The sidebar and the chat surface both render as children, under this one
 * runtime — there is no per-chat provider anymore.
 */
import type { ReactNode } from 'react';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { DaemonPortProvider } from '../../sessions/runtime/daemon-port-context';
import { useSessionsThreadList } from '../../sessions/runtime/use-sessions-thread-list';

export { useChatExtras, useChatPermissionFront, useChatQueuedMessages } from './use-chat-thread-runtime';

function SessionsRuntimeRoot({ children }: { children: ReactNode }) {
  const runtime = useSessionsThreadList();
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

export function ChatRuntimeProvider({ port, children }: { port: number; children: ReactNode }) {
  return (
    <DaemonPortProvider port={port}>
      <SessionsRuntimeRoot>{children}</SessionsRuntimeRoot>
    </DaemonPortProvider>
  );
}
