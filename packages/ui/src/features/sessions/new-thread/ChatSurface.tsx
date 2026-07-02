/**
 * ChatSurface — chooses what the right pane shows for the active thread.
 *
 * - Zero projects, once useProjects has finished its initial load → the
 *   first-run hero (no ChatThread, no composer) — there is nowhere to send a
 *   message yet. Gated on `!loading` so a cold-boot render (projects still
 *   `[]` while the fetch is in flight) falls through to ChatThread instead of
 *   flashing the hero.
 * - A brand-new local thread (__LOCALID_* / status 'new' / no messages) whose
 *   draft already resolved a project (seeded by useNewThreadAutoConfig when a
 *   project pill is active, or by the ChatEmptyState welcome flow itself —
 *   Tasks 11-13) shows the ChatThread with the Welcome empty-state in its
 *   message column; the composer stays live so the first send still flows
 *   through onNew → coordinator → ONE createChat (no chat is created until the
 *   first send, D3).
 * - Everything else (a sent local thread, a pre-existing chat, or a new local
 *   thread with no project resolved yet) shows the plain ChatThread.
 */
import { useAuiState } from '@assistant-ui/react';
import { ChatCardHeader } from '../../chat/thread/ChatCardHeader';
import { ChatThread } from '../../chat/thread/ChatThread';
import { ChatEmptyState } from './ChatEmptyState';
import { useNewThreadAutoConfig } from './use-new-thread-auto-config';
import { useProjects } from '../use-projects';
import { useDraftConfigStore } from '../runtime/draft-config';

export function ChatSurface({ port: _port }: { port: number }) {
  // Seeds the draft + marks-ready when a project pill is active (skips the picker).
  useNewThreadAutoConfig();

  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  // s.threadListItem is the native active ThreadListItemState; its `status`
  // ('new' | 'regular' | 'archived' | 'deleted') is read directly — the
  // SessionItem projection would collapse 'new' to 'regular' and break the
  // new-thread surface, so it is NOT used here.
  const itemStatus = useAuiState((s) => s.threadListItem?.status);
  const messageCount = useAuiState((s) => s.thread.messages.length);
  const draftCfg = useDraftConfigStore((s) => (mainThreadId ? s.drafts.get(mainThreadId) : undefined));
  const { projects, loading } = useProjects();

  const isNewLocal =
    mainThreadId != null && mainThreadId.startsWith('__LOCALID_') && itemStatus === 'new' && messageCount === 0;

  if (isNewLocal && !loading && projects.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatCardHeader />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-6">
          <ChatEmptyState variant="firstrun" />
        </div>
      </div>
    );
  }

  const welcome =
    isNewLocal && draftCfg != null ? <ChatEmptyState variant="welcome" projectId={draftCfg.projectId} /> : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatCardHeader />
      {/* min-h-0 + flex-col so ChatThread's h-full resolves against a definite
          height — otherwise the sticky composer footer collapses/clips. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ChatThread emptyState={welcome} />
      </div>
    </div>
  );
}
