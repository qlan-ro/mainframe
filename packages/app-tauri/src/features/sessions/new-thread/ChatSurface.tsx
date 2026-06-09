/**
 * ChatSurface — chooses what the right pane shows for the active thread.
 *
 * A brand-new local thread (__LOCALID_* / status 'new') with no messages yet
 * starts on the NewThreadConfigPicker (project + adapter + permission mode); the
 * picker writes the draft-config the new-thread coordinator reads on first send.
 * Once project+adapter are chosen the picker marks the local id ready (the
 * reactive `new-thread-ready-store`, since the draft-config Map is not reactive),
 * and the surface switches to the real ChatThread so the user can type and send
 * the first message — that send flows through onNew → coordinator → ONE createChat
 * (no chat is created until the first send, D3).
 *
 * Everything else (a sent local thread, a pre-existing chat, or a blank/no-
 * selection state) shows the ChatThread transcript + composer directly.
 */
import { useAuiState } from '@assistant-ui/react';
import { ChatCardHeader } from '../../../features/chat/thread/ChatCardHeader';
import { ChatThread } from '../../../features/chat/thread/ChatThread';
import { NewThreadConfigPicker } from './NewThreadConfigPicker';
import { useNewThreadReady } from '../runtime/new-thread-ready-store';
import { useNewThreadAutoConfig } from './use-new-thread-auto-config';
import { useSessionFilters } from '@/store/session-filters';

export function ChatSurface({ port }: { port: number }) {
  // Seeds the draft + marks-ready when a project pill is active (skips the picker).
  useNewThreadAutoConfig();

  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  // s.threadListItem is the native active ThreadListItemState; its `status`
  // ('new' | 'regular' | 'archived' | 'deleted') is read directly — the
  // SessionItem projection would collapse 'new' to 'regular' and break the
  // new-thread surface, so it is NOT used here.
  const itemStatus = useAuiState((s) => s.threadListItem?.status);
  const messageCount = useAuiState((s) => s.thread.messages.length);
  // Reactive readiness for THIS thread — picker→composer switch trigger.
  const isReady = useNewThreadReady((s) => (mainThreadId != null ? s.readyIds.has(mainThreadId) : false));
  // The picker is only for the "All" view (choose a project). With a project pill
  // active the auto-config hook makes the thread ready → straight to the composer;
  // gating on filterProjectId here avoids a one-frame picker flash before it runs.
  const filterProjectId = useSessionFilters((s) => s.filterProjectId);

  const isNewLocal =
    mainThreadId != null && mainThreadId.startsWith('__LOCALID_') && itemStatus === 'new' && messageCount === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatCardHeader />
      {/* min-h-0 + flex-col so ChatThread's h-full resolves against a definite
          height — otherwise the sticky composer footer collapses/clips. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {isNewLocal && !isReady && filterProjectId == null ? (
          <div data-testid="sessions-new-thread-surface" className="flex h-full items-center justify-center p-6">
            <NewThreadConfigPicker port={port} />
          </div>
        ) : (
          <ChatThread />
        )}
      </div>
    </div>
  );
}
