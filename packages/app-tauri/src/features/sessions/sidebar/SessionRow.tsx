/**
 * SessionRow — one session in the sidebar list.
 *
 * Provider keyed by the STABLE item.id (NOT remoteId): a thread's id is fixed for
 * its whole life, so the row never re-keys when a new chat adopts its remoteId.
 * Active highlight is fully native — ThreadListItemPrimitive.Root sets data-active/
 * aria-current when mainThreadId === threadListItem.id; we only style data-[active=true].
 * Actions (rename/archive) come from the item RUNTIME (useThreadListItemRuntime),
 * not the item STATE (useThreadListItem). Status dot via deriveSessionStatus + unread.
 * Responsive: @max-[300px] hides time; @max-[220px] hides meta row.
 */
import { useState } from 'react';
import {
  ThreadListItemPrimitive,
  ThreadListItemRuntimeProvider,
  useAssistantRuntime,
  useThreadListItemRuntime,
} from '@assistant-ui/react';
import type { SessionItem } from '../view-model/chat-to-thread-custom';
import { deriveSessionStatus, type SessionStatus } from '../view-model/session-status';
import { useUnreadStore } from '@/store/unread-store';
import { useDaemonPort } from '../runtime/daemon-port-context';
import { pinChat } from '@/lib/api/chats';
import { SessionRowMeta } from './SessionRowMeta';
import { SessionRowRename } from './SessionRowRename';
import { SessionContextMenu } from './SessionContextMenu';

const DOT_CLASS: Record<SessionStatus, string> = {
  'worktree-missing': 'size-1.5 bg-destructive',
  working: 'size-2 border-[1.5px] border-primary border-t-transparent animate-spin',
  waiting: 'size-2 border-[1.5px] border-primary border-t-transparent animate-spin',
  unread: 'size-1.5 bg-primary',
  idle: 'size-1.5 bg-mf-text-4 opacity-50',
};

function StatusDot({ status }: { status: SessionStatus }) {
  return (
    <span
      data-testid="sessions-row-status-dot"
      aria-label={status}
      className={`inline-block flex-shrink-0 rounded-full ${DOT_CLASS[status]}`}
    />
  );
}

function RelativeTime({ updatedAt }: { updatedAt: number }) {
  const text = new Date(updatedAt).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <span
      data-testid="sessions-row-relative-time"
      className="flex-shrink-0 text-micro tabular-nums text-mf-text-3 @max-[300px]:hidden"
    >
      {text}
    </span>
  );
}

function SessionRowInner({ item }: { item: SessionItem }) {
  const { custom } = item;
  const port = useDaemonPort();
  const itemRuntime = useThreadListItemRuntime();
  const isUnread = useUnreadStore((s) => s.isUnread(item.id));
  const status = deriveSessionStatus(custom, isUnread);
  const [isRenaming, setIsRenaming] = useState(false);

  const title = item.title ?? 'Untitled session';

  function handleCommitRename(newTitle: string) {
    void itemRuntime.rename(newTitle);
    setIsRenaming(false);
  }

  function handlePin() {
    void pinChat(port, item.id, true).catch((e: unknown) => {
      console.warn('[SessionRow] pinChat failed', e);
    });
  }

  function handleUnpin() {
    void pinChat(port, item.id, false).catch((e: unknown) => {
      console.warn('[SessionRow] unpinChat failed', e);
    });
  }

  return (
    <SessionContextMenu
      pinned={custom.pinned}
      onPin={handlePin}
      onUnpin={handleUnpin}
      onRename={() => {
        queueMicrotask(() => setIsRenaming(true));
      }}
      onArchive={() => void itemRuntime.archive()}
      claudeSessionId={item.remoteId}
    >
      <ThreadListItemPrimitive.Root
        data-testid="sessions-row"
        className="group relative flex cursor-pointer items-start gap-2.5 border-l-2 border-l-transparent px-2.5 py-2 transition-colors hover:bg-accent data-[active=true]:border-l-primary data-[active=true]:bg-accent"
      >
        <div className="mt-1 flex-shrink-0">
          <StatusDot status={status} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {isRenaming ? (
              <SessionRowRename
                initialTitle={title}
                onCommit={handleCommitRename}
                onCancel={() => setIsRenaming(false)}
              />
            ) : (
              <ThreadListItemPrimitive.Trigger asChild>
                <span
                  data-testid="sessions-row-title"
                  className={[
                    'flex-1 truncate text-body',
                    isUnread || custom.pinned ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground',
                  ].join(' ')}
                >
                  {title}
                </span>
              </ThreadListItemPrimitive.Trigger>
            )}
            <RelativeTime updatedAt={custom.updatedAt} />
          </div>
          <div className="mt-1 @max-[220px]:hidden">
            <SessionRowMeta
              adapterId={custom.adapterId}
              worktreePath={custom.worktreePath}
              worktreeMissing={custom.worktreeMissing}
              detectedPrs={custom.detectedPrs}
            />
          </div>
        </div>
      </ThreadListItemPrimitive.Root>
    </SessionContextMenu>
  );
}

export function SessionRow({ item }: { item: SessionItem }) {
  const threadListRuntime = useAssistantRuntime().threads;
  const itemRuntime = threadListRuntime?.getItemById(item.id) ?? null;
  if (itemRuntime == null) return null;

  return (
    <ThreadListItemRuntimeProvider runtime={itemRuntime}>
      <SessionRowInner item={item} />
    </ThreadListItemRuntimeProvider>
  );
}
