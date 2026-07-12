/**
 * SessionRow — one session in the sidebar list.
 *
 * Provider keyed by the STABLE item.id (NOT remoteId): a thread's id is fixed for
 * its whole life, so the row never re-keys when a new chat adopts its remoteId.
 * Active highlight is fully native — ThreadListItemPrimitive.Root sets data-active/
 * aria-current when mainThreadId === threadListItem.id; we only style data-[active=true].
 * Actions (rename/archive) come from the item RUNTIME (useThreadListItemRuntime),
 * not the item STATE (useThreadListItem). Status dot via deriveSessionBadge + unread.
 * Responsive: @max-[300px] hides time; @max-[220px] hides meta row.
 */
import type { MouseEvent } from 'react';
import { memo, useRef, useState } from 'react';
import {
  ThreadListItemPrimitive,
  ThreadListItemRuntimeProvider,
  useAssistantRuntime,
  useThreadListItemRuntime,
} from '@assistant-ui/react';
import { PaperclipIcon, PinIcon, TagIcon, XIcon } from 'lucide-react';
import type { TagColor } from '@qlan-ro/mainframe-types';
import type { SessionItem } from '../view-model/chat-to-thread-custom';
import { deriveSessionBadge, type SessionBadge } from '../view-model/session-status';
import { isSessionUnread } from '../view-model/session-unread';
import { formatRelativeTime } from '../view-model/relative-time';
import { useUnreadStore } from '@/store/unread-store';
import { useDaemonPort } from '../runtime/daemon-port-context';
import { pinChat } from '@/lib/api/chats';
import { SessionRowMeta } from './SessionRowMeta';
import { SessionRowRename } from './SessionRowRename';
import { SessionContextMenu } from './SessionContextMenu';
import { useTagPopoverTarget } from '../tags/use-tag-popover-target';
import { TruncatedWithTooltip } from '@/components/ui/truncated-with-tooltip';
import { Hint } from '@/components/ui/hint';
import { ProviderLogo } from '@/features/shared/ProviderLogo';

/**
 * The logo is the row's ONLY status indicator (no text pill): provider shape
 * identifies the adapter, unread controls vividness, and lifecycle only adds motion.
 */
function workingLogoAnimation(adapterId: string): string {
  return adapterId === 'claude' ? 'animate-[mf-claude-logo-working_1.52s_linear_infinite]' : 'animate-spin';
}

function statusLogoClass(badge: SessionBadge, adapterId: string): string {
  const base = 'inline-flex size-8 flex-shrink-0 items-center justify-center';
  const active = badge.base === 'working' || badge.base === 'waiting';
  const visual = badge.unread || active ? 'text-primary' : 'text-mf-text-3';
  switch (badge.base) {
    case 'worktree-missing':
    case 'transcript-missing':
      return `${base} ${visual}`;
    case 'working':
      return `${base} ${visual} ${workingLogoAnimation(adapterId)}`;
    case 'waiting':
      return `${base} ${visual} animate-pulse`;
    case 'idle':
      return `${base} ${visual}`;
  }
}

/** The dot is the row's ONLY status indicator (no text pill) — the tooltip carries the label. */
function dotLabel(badge: SessionBadge): string {
  switch (badge.base) {
    case 'worktree-missing':
      return 'Worktree missing';
    case 'transcript-missing':
      return 'Transcript missing';
    case 'working':
      return 'Working';
    case 'waiting':
      return 'Your turn';
    case 'idle':
      return badge.unread ? 'Unread response' : 'Idle';
  }
}

export function StatusDot({ badge, adapterId = 'claude' }: { badge: SessionBadge; adapterId?: string }) {
  return (
    <Hint label={dotLabel(badge)}>
      <span data-testid="sessions-row-status-dot" aria-label={badge.base} className={statusLogoClass(badge, adapterId)}>
        <ProviderLogo adapterId={adapterId} className="size-7" />
      </span>
    </Hint>
  );
}

function RelativeTime({ updatedAt }: { updatedAt: number }) {
  const text = formatRelativeTime(updatedAt, Date.now());
  return (
    <span
      data-testid="sessions-row-relative-time"
      className="flex-shrink-0 text-caption tabular-nums text-muted-foreground group-hover:hidden"
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
  onTags: (rect: DOMRect) => void;
  onRename: () => void;
  onArchive: () => void;
}) {
  const btn =
    'inline-flex size-[22px] items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    fn();
  };
  return (
    <div className="hidden flex-shrink-0 items-center group-hover:flex">
      <Hint label="Tags">
        <button
          data-testid="sessions-row-action-tags"
          type="button"
          className={btn}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onTags(e.currentTarget.getBoundingClientRect());
          }}
        >
          <TagIcon className="size-3.5" />
        </button>
      </Hint>
      <Hint label="Rename">
        <button data-testid="sessions-row-action-rename" type="button" className={btn} onClick={stop(onRename)}>
          <PaperclipIcon className="size-3.5" />
        </button>
      </Hint>
      <Hint label="Archive">
        <button data-testid="sessions-row-action-archive" type="button" className={btn} onClick={stop(onArchive)}>
          <XIcon className="size-3.5" />
        </button>
      </Hint>
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

function SessionRowInner({
  item,
  colorOf,
  inPinnedGroup,
  projectName,
}: {
  item: SessionItem;
  colorOf: (name: string) => TagColor;
  inPinnedGroup: boolean;
  projectName?: string;
}) {
  const { custom } = item;
  const port = useDaemonPort();
  const itemRuntime = useThreadListItemRuntime();
  const assistantRuntime = useAssistantRuntime();
  const unread = useUnreadStore((s) => s.unread);
  const isUnread = isSessionUnread(item, unread);
  const badge = deriveSessionBadge(custom, isUnread);
  const [isRenaming, setIsRenaming] = useState(false);
  // Captured on right-click so the context-menu "Tags" action can anchor the
  // popover at the cursor (same coordinates the context menu opened at) rather
  // than the host's default (0,0).
  const contextMenuPoint = useRef<{ x: number; y: number } | null>(null);

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

  function handleTags(anchorRect: DOMRect | null = null) {
    const chatId = item.remoteId ?? item.id;
    const currentTags = custom.tags ?? [];
    useTagPopoverTarget.getState().open(chatId, currentTags, anchorRect);
  }

  return (
    <SessionContextMenu
      pinned={custom.pinned}
      onPin={handlePin}
      onUnpin={handleUnpin}
      onRename={() => {
        queueMicrotask(() => setIsRenaming(true));
      }}
      onTags={() => {
        // Radix's ContextMenu is a MODAL layer: closing it on select restores
        // focus to the trigger via a requestAnimationFrame-scheduled callback
        // (its FocusScope handing focus back), which always runs AFTER the
        // microtask queue drains. A queueMicrotask-deferred open lets our
        // popover grab focus first, then loses it to that rAF right
        // afterwards — its own FocusScope reads that as "focus moved
        // outside" and dismisses the popover immediately (flash-open then
        // close). setTimeout (a macrotask) reliably runs after that
        // rAF-scheduled restore, so the popover keeps focus.
        setTimeout(() => {
          const p = contextMenuPoint.current;
          handleTags(p ? new DOMRect(p.x, p.y, 0, 0) : null);
        }, 0);
      }}
      onArchive={() => void itemRuntime.archive()}
      claudeSessionId={custom.claudeSessionId}
    >
      <ThreadListItemPrimitive.Root
        data-testid="sessions-row"
        data-chat-id={item.id}
        className="group relative rounded-md transition-colors hover:bg-accent data-[active=true]:bg-mf-chip"
      >
        {/* Whole-row select target: the entire row body is the trigger, so a click
            anywhere (title, status dot, meta row, empty space) changes the active
            session. Interactive children (PR links, hover actions, the rename
            input) stopPropagation, so they keep their own behavior. */}
        <ThreadListItemPrimitive.Trigger asChild>
          <div
            onContextMenu={(e) => {
              contextMenuPoint.current = { x: e.clientX, y: e.clientY };
            }}
            className="flex w-full cursor-pointer items-center gap-[9px] pb-[9px] pl-2.5 pr-[12px] pt-[8px] text-left"
          >
            <div className="flex flex-shrink-0 items-center gap-[5px]">
              {custom.pinned && !inPinnedGroup && (
                <PinIcon data-testid="sessions-row-pin-glyph" className="size-[11px] flex-shrink-0 text-primary" />
              )}
              <StatusDot badge={badge} adapterId={custom.adapterId} />
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
                  <TruncatedWithTooltip
                    data-testid="sessions-row-title"
                    text={title}
                    side="top"
                    className={[
                      'flex-1 text-body tracking-normal',
                      isUnread ? 'font-bold text-foreground' : 'font-medium text-foreground',
                    ].join(' ')}
                  />
                )}
                <RelativeTime updatedAt={custom.updatedAt} />
                <RowHoverActions
                  onTags={(rect) => handleTags(rect)}
                  onRename={() => queueMicrotask(() => setIsRenaming(true))}
                  onArchive={() => void itemRuntime.archive()}
                />
              </div>
              <div className="mt-[4px] @max-[220px]:hidden">
                <SessionRowMeta
                  worktreePath={custom.worktreePath}
                  worktreeMissing={custom.worktreeMissing}
                  transcriptMissing={custom.transcriptMissing}
                  detectedPrs={custom.detectedPrs}
                  tags={custom.tags}
                  colorOf={colorOf}
                  projectId={projectName != null ? custom.projectId : undefined}
                  projectName={projectName}
                />
              </div>
            </div>
          </div>
        </ThreadListItemPrimitive.Trigger>
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
function SessionRowResolver({
  item,
  colorOf = DEFAULT_COLOR_OF,
  inPinnedGroup = false,
  projectName,
}: {
  item: SessionItem;
  colorOf?: (name: string) => TagColor;
  /** True when this row sits inside the 'Pinned' group — suppresses the pin glyph. */
  inPinnedGroup?: boolean;
  /** Project chip label — passed only in "All" view (no active project filter). */
  projectName?: string;
}) {
  const threadListRuntime = useAssistantRuntime().threads;
  const threadItems = threadListRuntime?.getState().threadItems;
  if (threadItems == null || !(item.id in threadItems)) return null;

  const itemRuntime = threadListRuntime.getItemById(item.id);
  return (
    <ThreadListItemRuntimeProvider runtime={itemRuntime}>
      <SessionRowInner item={item} colorOf={colorOf} inPinnedGroup={inPinnedGroup} projectName={projectName} />
    </ThreadListItemRuntimeProvider>
  );
}

// Memoized: on a filter-pill switch the surviving rows receive referentially
// stable props (item objects come from the threadItems-memoized allItems, colorOf
// is a useCallback, projectName is a string), so memo short-circuits their
// re-render — only the rows entering/leaving the filtered set mount/unmount.
export const SessionRow = memo(SessionRowResolver);
