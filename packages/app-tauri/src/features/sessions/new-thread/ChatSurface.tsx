/**
 * ChatSurface — chooses what the right pane shows for the active thread.
 *
 * A brand-new local thread (__LOCALID_* / status 'new') with no messages yet
 * shows the NewThreadConfigPicker (project + adapter + permission mode); the
 * picker writes the draft-config that the new-thread coordinator reads on the
 * first send. Everything else (a sent local thread, a pre-existing chat, or a
 * blank/no-selection state) shows the real ChatThread transcript + composer.
 */
import { useAuiState } from '@assistant-ui/react';
import { ChatThread } from '../../../features/chat/thread/ChatThread';
import { NewThreadConfigPicker } from './NewThreadConfigPicker';

interface ActiveItem {
  id: string;
  status?: string;
}

export function ChatSurface({ port }: { port: number }) {
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const item = useAuiState((s) => s.threadListItem as unknown as ActiveItem | undefined);
  const messageCount = useAuiState((s) => s.thread.messages.length);

  const isNewLocal =
    mainThreadId != null && mainThreadId.startsWith('__LOCALID_') && item?.status === 'new' && messageCount === 0;

  if (isNewLocal) {
    return (
      <div data-testid="sessions-new-thread-surface" className="flex h-full items-center justify-center p-6">
        <NewThreadConfigPicker port={port} />
      </div>
    );
  }

  return <ChatThread />;
}
