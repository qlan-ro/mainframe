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
import type { MouseEvent } from 'react';
import { useState } from 'react';
import {
  ThreadListItemPrimitive,
  ThreadListItemRuntimeProvider,
  useAssistantRuntime,
  useThreadListItemRuntime,
} from '@assistant-ui/react';
import { ArchiveIcon, PencilIcon, PinIcon, TagIcon } from 'lucide-react';
import type { TagColor } from '@qlan-ro/mainframe-types';
import type { SessionItem } from '../view-model/chat-to-thread-custom';
import { deriveSessionStatus, type SessionStatus } from '../view-model/session-status';
import { formatRelativeTime } from '../view-model/relative-time';
import { useUnreadStore } from '@/store/unread-store';
import { useDaemonPort } from '../runtime/daemon-port-context';
import { pinChat } from '@/lib/api/chats';
import { SessionRowMeta } from './SessionRowMeta';
import { SessionRowRename } from './SessionRowRename';
import { SessionContextMenu } from './SessionContextMenu';
import { useTagPopoverTarget } from '../tags/use-tag-popover-target';

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
  const text = formatRelativeTime(updatedAt, Date.now());
  return (
    <span
      data-testid="sessions-row-relative-time"
      className="flex-shrink-0 text-micro tabular-nums text-mf-text-3 group-hover:hidden @max-[300px]:hidden"
    >
      {text}
    </span>
  );
}

/**
 * RowHoverActions — tag / rename / archive icon buttons revealed on row hover
 * (artboard SessionRowDense `.tw-row-actions` shown on `:hover`, swapping out
 * the time). Each click stops propagation so it doesn't also select the row,
 * and wires to the same handlers the right-click context menu uses.
 */
function RowHoverActions({
  onTags,
  onRename,
  onArchive,
}: {
  onTags: () => void;
  onRename: () => void;
  onArchive: () => void;
}) {
  const btn =
    'inline-flex size-[22px] items-center justify-center rounded-md text-mf-text-3 transition-colors hover:bg-accent hover:text-foreground';
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    fn();
  };
  return (
    <div className="hidden flex-shrink-0 items-center group-hover:flex">
      <button data-testid="sessions-row-action-tags" type="button" title="Tags" className={btn} onClick={stop(onTags)}>
        <TagIcon className="size-[11px]" />
      </button>
      <button
        data-testid="sessions-row-action-rename"
        type="button"
        title="Rename"
        className={btn}
        onClick={stop(onRename)}
      >
        <PencilIcon className="size-[11px]" />
      </button>
      <button
        data-testid="sessions-row-action-archive"
        type="button"
        title="Archive"
        className={btn}
        onClick={stop(onArchive)}
      >
        <ArchiveIcon className="size-[11px]" />
      </button>
    </div>
  );
}

/**
 * `colorOf` is threaded down from the sidebar's single `useTagRegistry` so the
 * whole list shares ONE `listTags()` fetch — rows never fetch the registry
 * themselves. Defaults to the registry's own fallback color when omitted (e.g.
 * a row rendered in isolation), so tag dots still paint.
 */
const DEFAULT_COLOR_OF = (): TagColor => 'blue';

function SessionRowInner({ item, colorOf }: { item: SessionItem; colorOf: (name: string) => TagColor }) {
  const { custom } = item;
  const port = useDaemonPort();
  const itemRuntime = useThreadListItemRuntime();
  const assistantRuntime = useAssistantRuntime();
  const isUnread = useUnreadStore((s) => s.isUnread(item.id));
  const status = deriveSessionStatus(custom, isUnread);
  const [isRenaming, setIsRenaming] = useState(false);

  const title = item.title ?? 'Untitled session';

  function handleCommitRename(newTitle: string) {
    void itemRuntime.rename(newTitle);
    setIsRenaming(false);
  }

  function handlePin() {
    void pinChat(port, item.id, true)
      .then(() => assistantRuntime.threads.reload())
      .catch((e: unknown) => {
        console.warn('[SessionRow] pinChat failed', e);
      });
  }

  function handleUnpin() {
    void pinChat(port, item.id, false)
      .then(() => assistantRuntime.threads.reload())
      .catch((e: unknown) => {
        console.warn('[SessionRow] unpinChat failed', e);
      });
  }

  function handleTags() {
    const chatId = item.remoteId ?? item.id;
    const currentTags = custom.tags ?? [];
    useTagPopoverTarget.getState().open(chatId, currentTags);
  }

  return (
    <SessionContextMenu
      pinned={custom.pinned}
      onPin={handlePin}
      onUnpin={handleUnpin}
      onRename={() => {
        queueMicrotask(() => setIsRenaming(true));
      }}
      onTags={handleTags}
      onArchive={() => void itemRuntime.archive()}
      claudeSessionId={item.remoteId}
    >
      <ThreadListItemPrimitive.Root
        data-testid="sessions-row"
        className="group relative flex cursor-pointer items-center gap-[9px] border-l-2 border-l-transparent py-2 pl-2.5 pr-3 transition-colors hover:bg-accent data-[active=true]:border-l-primary data-[active=true]:bg-accent"
      >
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {custom.pinned && (
            <PinIcon data-testid="sessions-row-pin-glyph" className="size-3 flex-shrink-0 text-primary" />
          )}
          <StatusDot status={status} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex h-[22px] min-w-0 items-center gap-[9px]">
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
            <RowHoverActions
              onTags={handleTags}
              onRename={() => queueMicrotask(() => setIsRenaming(true))}
              onArchive={() => void itemRuntime.archive()}
            />
          </div>
          <div className="mt-1 @max-[220px]:hidden">
            <SessionRowMeta
              adapterId={custom.adapterId}
              worktreePath={custom.worktreePath}
              worktreeMissing={custom.worktreeMissing}
              detectedPrs={custom.detectedPrs}
              status={status}
              tags={custom.tags}
              colorOf={colorOf}
            />
          </div>
        </div>
      </ThreadListItemPrimitive.Root>
    </SessionContextMenu>
  );
}

/**
 * Guard: check whether the thread item exists in the store BEFORE calling
 * getItemById. getItemById constructs a ShallowMemoizeSubject that throws
 * synchronously ("Entry not available in the store") when the item is absent —
 * reachable during optimistic archive/delete removal or a cross-window reload
 * race. We read getState().threadItems (a plain Record) first; only if the id
 * is present do we call getItemById to get the live runtime binding.
 */
export function SessionRow({
  item,
  colorOf = DEFAULT_COLOR_OF,
}: {
  item: SessionItem;
  colorOf?: (name: string) => TagColor;
}) {
  const threadListRuntime = useAssistantRuntime().threads;
  const threadItems = threadListRuntime?.getState().threadItems;
  if (threadItems == null || !(item.id in threadItems)) return null;

  const itemRuntime = threadListRuntime.getItemById(item.id);
  return (
    <ThreadListItemRuntimeProvider runtime={itemRuntime}>
      <SessionRowInner item={item} colorOf={colorOf} />
    </ThreadListItemRuntimeProvider>
  );
}
