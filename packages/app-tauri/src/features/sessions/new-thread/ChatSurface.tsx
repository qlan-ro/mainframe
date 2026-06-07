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

export function ChatSurface({ port }: { port: number }) {
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  // s.threadListItem is the native active ThreadListItemState; its `status`
  // ('new' | 'regular' | 'archived' | 'deleted') is read directly — the
  // SessionItem projection would collapse 'new' to 'regular' and break the
  // new-thread surface, so it is NOT used here.
  const itemStatus = useAuiState((s) => s.threadListItem?.status);
  const messageCount = useAuiState((s) => s.thread.messages.length);

  const isNewLocal =
    mainThreadId != null && mainThreadId.startsWith('__LOCALID_') && itemStatus === 'new' && messageCount === 0;

  if (isNewLocal) {
    return (
      <div data-testid="sessions-new-thread-surface" className="flex h-full items-center justify-center p-6">
        <NewThreadConfigPicker port={port} />
      </div>
    );
  }

  return <ChatThread />;
}
