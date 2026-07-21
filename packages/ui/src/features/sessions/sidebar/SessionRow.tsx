/**
 * SessionRow — one session in the sidebar list.
 *
 * Provider keyed by the STABLE item.id (NOT remoteId): a thread's id is fixed for
 * its whole life, so the row never re-keys when a new chat adopts its remoteId.
 * Active highlight is fully native — ThreadListItemPrimitive.Root sets data-active/
 * aria-current when mainThreadId === threadListItem.id; we only style data-[active=true].
 * Actions (rename/archive) come from the item RUNTIME (useThreadListItemRuntime),
 * not the item STATE (useThreadListItem). Status dot via deriveSessionBadge + unread.
 *
 * Single-line row (2026-07 compaction): the old second meta line
 * (worktree/PR/tags, via the now-removed SessionRowMeta) collapsed into small
 * trailing glyphs (SessionRowMetaIcons) on this same row. The full text
 * (worktree/branch, PR, tag pills, project, branch-safety warning) now lives
 * in a SessionMetaCard shown on hover, positioned from this row's rect
 * (useRowHoverCard).
 */
import { memo, useRef, useState } from 'react';
import {
  ThreadListItemPrimitive,
  ThreadListItemRuntimeProvider,
  useAssistantRuntime,
  useThreadListItemRuntime,
} from '@assistant-ui/react';
import { PinIcon } from 'lucide-react';
import type { TagColor } from '@qlan-ro/mainframe-types';
import type { SessionItem } from '../view-model/chat-to-thread-custom';
import { deriveSessionBadge } from '../view-model/session-status';
import { isSessionUnread } from '../view-model/session-unread';
import { formatRelativeTime } from '../view-model/relative-time';
import { useUnreadStore } from '@/store/unread-store';
import { useDaemonPort } from '../runtime/daemon-port-context';
import { pinChat } from '@/lib/api/chats';
import { StatusDot } from './SessionRowStatus';
import { RowHoverActions } from './SessionRowHoverActions';
import { SessionRowMetaIcons } from './SessionRowMetaIcons';
import { SessionMetaCard } from './SessionMetaCard';
import { useRowHoverCard } from './use-row-hover-card';
import { SessionRowRename } from './SessionRowRename';
import { SessionContextMenu } from './SessionContextMenu';
import { useTagPopoverTarget } from '../tags/use-tag-popover-target';
import { useArchiveSession } from './use-archive-session';
import { sidebarIndentPx, SIDEBAR_ROW_GUTTER_PX } from '@/layout/sidebar-indent';

/** Level 2 — one step deeper than SessionGroupHeader (level 1). Applied as the
 *  Trigger div's own paddingLeft, NOT a margin on Root — Root also owns the
 *  hover/active highlight background, and macOS sidebars keep that highlight
 *  full-width even for indented/nested rows; only the row's CONTENT indents.
 *  Subtract Root's own mx-2 gutter (see SIDEBAR_ROW_GUTTER_PX) so it isn't
 *  double-counted on top of the level inset. */
const SESSION_ROW_CONTENT_INSET_PX = sidebarIndentPx(2) - SIDEBAR_ROW_GUTTER_PX;

export { StatusDot } from './SessionRowStatus';

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
  const hoverCard = useRowHoverCard();
  // Captured on right-click so the context-menu "Tags" action can anchor the
  // popover at the cursor (same coordinates the context menu opened at) rather
  // than the host's default (0,0).
  const contextMenuPoint = useRef<{ x: number; y: number } | null>(null);
  const handleArchive = useArchiveSession(item.remoteId ?? item.id, custom.worktreePath != null);

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
    // Fragment, not a single child of SessionContextMenu: its ContextMenuTrigger
    // is `asChild` (a real Radix Slot, unmocked in tests) which requires exactly
    // one element child. SessionMetaCard portals to document.body regardless of
    // where it sits in this tree, so it must be a SIBLING, not nested inside.
    <>
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
        onArchive={handleArchive}
        claudeSessionId={custom.claudeSessionId}
      >
        <ThreadListItemPrimitive.Root
          data-testid="sessions-row"
          data-chat-id={item.id}
          className="group relative mx-2 rounded-md transition-colors hover:bg-accent data-[active=true]:bg-mf-selection"
        >
          {/* Whole-row select target: the entire row body is the trigger, so a click
              anywhere (title, status dot, meta icons, empty space) changes the active
              session. Interactive children (PR links, hover actions, the rename
              input) stopPropagation, so they keep their own behavior. */}
          <ThreadListItemPrimitive.Trigger asChild>
            <div
              onContextMenu={(e) => {
                contextMenuPoint.current = { x: e.clientX, y: e.clientY };
              }}
              onMouseEnter={hoverCard.onMouseEnter}
              onMouseLeave={hoverCard.onMouseLeave}
              style={{ paddingLeft: SESSION_ROW_CONTENT_INSET_PX }}
              className="flex h-[28px] w-full cursor-pointer items-center gap-[9px] pr-[12px] text-left"
            >
              <div className="flex flex-shrink-0 items-center gap-[5px]">
                {custom.pinned && !inPinnedGroup && (
                  <PinIcon data-testid="sessions-row-pin-glyph" className="size-[11px] flex-shrink-0 text-primary" />
                )}
                <StatusDot badge={badge} adapterId={custom.adapterId} />
              </div>
              {isRenaming ? (
                <SessionRowRename
                  initialTitle={title}
                  onCommit={handleCommitRename}
                  onCancel={() => setIsRenaming(false)}
                />
              ) : (
                // Plain truncation, no tooltip: SessionMetaCard (this row's
                // richer hover card) already surfaces the full untruncated
                // title, so a second tooltip here was pure duplication.
                <span
                  data-testid="sessions-row-title"
                  className={[
                    'min-w-0 flex-1 truncate text-body tracking-normal group-data-[active=true]:text-primary',
                    isUnread ? 'font-bold text-foreground' : 'font-medium text-muted-foreground',
                  ].join(' ')}
                >
                  {title}
                </span>
              )}
              <div className="@max-[260px]:hidden">
                <SessionRowMetaIcons
                  worktreePath={custom.worktreePath}
                  worktreeMissing={custom.worktreeMissing}
                  detectedPrs={custom.detectedPrs}
                  tags={custom.tags}
                  colorOf={colorOf}
                />
              </div>
              <RelativeTime updatedAt={custom.updatedAt} />
              <RowHoverActions
                pinned={custom.pinned}
                onPin={handlePin}
                onUnpin={handleUnpin}
                onTags={(rect) => handleTags(rect)}
                onArchive={handleArchive}
              />
            </div>
          </ThreadListItemPrimitive.Trigger>
        </ThreadListItemPrimitive.Root>
      </SessionContextMenu>
      {hoverCard.rect != null && (
        <SessionMetaCard
          anchorRect={hoverCard.rect}
          title={title}
          updatedAt={custom.updatedAt}
          projectId={custom.projectId}
          projectName={projectName}
          worktreePath={custom.worktreePath}
          branchName={custom.branchName}
          worktreeMissing={custom.worktreeMissing}
          transcriptMissing={custom.transcriptMissing}
          detectedPrs={custom.detectedPrs}
          tags={custom.tags}
          colorOf={colorOf}
        />
      )}
    </>
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
