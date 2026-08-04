/**
 * One session in the sidebar list.
 *
 * The active highlight stays native: `ThreadListItemPrimitive.Root` renders as
 * the `SidebarMenuItem` and sets `data-active` when it is the main thread, so
 * the button tints off the group rather than off a prop we would have to keep
 * in sync. Actions come from the item RUNTIME, not the item state, and the row
 * is keyed by the stable `item.id` — never `remoteId`, which a new chat can adopt.
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
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@v2/components/ui/hover-card';
import { SidebarMenuButton, SidebarMenuItem } from '@v2/components/ui/sidebar';
import { cn } from '@v2/lib/utils';
import type { SessionItem } from '@/features/sessions/view-model/chat-to-thread-custom';
import { deriveSessionBadge, type SessionBadge } from '@/features/sessions/view-model/session-status';
import { isSessionUnread } from '@/features/sessions/view-model/session-unread';
import { useUnreadStore } from '@/store/unread-store';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useArchiveSession } from '@/features/sessions/sidebar/use-archive-session';
import { useTagPopoverTarget } from '@/features/sessions/tags/use-tag-popover-target';
import { pinChat } from '@/lib/api/chats';
import { formatCompactTime } from './compact-time';
import { RowHoverActions } from './SessionRowHoverActions';
import { SessionContextMenu } from './SessionContextMenu';
import { SessionMetaCard } from './SessionMetaCard';
import { SessionRowMetaLine } from './SessionRowMetaLine';
import { SessionRowRename } from './SessionRowRename';
import { StatusDot } from './StatusDot';

/** The section owns the horizontal inset; the row only keeps the stock pad. */
const ROW_INDENT = 'pl-2';

/** Rows rendered outside the sidebar's tag registry still paint their dots. */
const DEFAULT_COLOR_OF = (): TagColor => 'blue';

interface RowActions {
  onPin: () => void;
  onUnpin: () => void;
  onTags: (anchorRect?: DOMRect | null) => void;
  onArchive: () => void;
}

function useRowActions(item: SessionItem): RowActions {
  const port = useDaemonPort();
  const assistantRuntime = useAssistantRuntime();
  const onArchive = useArchiveSession(item.remoteId ?? item.id, item.custom.worktreePath != null);

  const setPinned = (pinned: boolean) => {
    void pinChat(port, item.id, pinned)
      .then(() => assistantRuntime.threads.reload())
      .catch((e: unknown) => {
        console.warn('[SessionRow] pinChat failed', e);
      });
  };

  return {
    onPin: () => setPinned(true),
    onUnpin: () => setPinned(false),
    onTags: (anchorRect = null) => {
      useTagPopoverTarget.getState().open(item.remoteId ?? item.id, item.custom.tags ?? [], anchorRect);
    },
    onArchive,
  };
}

interface RowBodyProps {
  item: SessionItem;
  badge: SessionBadge;
  colorOf: (name: string) => TagColor;
  projectName?: string;
  showPinGlyph: boolean;
  renameSlot: React.ReactNode | null;
}

/**
 * Two lines — title plus time, then the meta line — beside one status column.
 * The status glyph stays a sibling of the whole stack rather than of the title,
 * so the button's own `items-center` centres it across both lines.
 */
function RowBody({ item, badge, colorOf, projectName, showPinGlyph, renameSlot }: RowBodyProps) {
  const { custom } = item;
  return (
    <>
      <StatusDot badge={badge} adapterId={custom.adapterId} />
      {/* gap-1: the two lines butted together, and on hover the action cluster
          overlapping line one left the meta glyphs sitting right under it. */}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Reserves the action cluster's width so it never lands on the title.
            Focus-within as well as hover: stock reveals the actions on both, and
            the row would otherwise paint the time underneath them. */}
        <span className="flex items-center gap-1.5 transition-[padding] group-focus-within/menu-item:pr-14 group-hover/menu-item:pr-14">
          {renameSlot ?? (
            // No tooltip on the title: the hover card already carries it in full.
            <span
              data-testid="sessions-row-title"
              className="min-w-0 flex-1 truncate-fade text-muted-foreground group-data-active/menu-item:text-primary"
            >
              {item.title ?? 'Untitled session'}
            </span>
          )}
          {showPinGlyph && <PinIcon data-testid="sessions-row-pin-glyph" className="size-3! shrink-0 text-primary" />}
          {/* The time yields to the hover actions — the same slot, not a second column. */}
          <span
            data-testid="sessions-row-relative-time"
            className="shrink-0 text-xs tabular-nums text-muted-foreground transition-opacity group-focus-within/menu-item:opacity-0 group-hover/menu-item:opacity-0"
          >
            {formatCompactTime(custom.updatedAt, Date.now())}
          </span>
        </span>
        <SessionRowMetaLine
          projectName={projectName}
          worktreePath={custom.worktreePath}
          branchName={custom.branchName}
          worktreeMissing={custom.worktreeMissing}
          detectedPrs={custom.detectedPrs}
          tags={custom.tags}
          colorOf={colorOf}
        />
      </span>
    </>
  );
}

interface SessionRowInnerProps {
  item: SessionItem;
  colorOf: (name: string) => TagColor;
  inPinnedGroup: boolean;
  projectName?: string;
}

function SessionRowInner({ item, colorOf, inPinnedGroup, projectName }: SessionRowInnerProps) {
  const { custom } = item;
  const itemRuntime = useThreadListItemRuntime();
  const unreadIds = useUnreadStore((s) => s.unread);
  const [isRenaming, setIsRenaming] = useState(false);
  const actions = useRowActions(item);
  // Captured on right-click so the menu's Tags action anchors the popover at the
  // cursor rather than at the host's default (0,0).
  const menuPoint = useRef<{ x: number; y: number } | null>(null);

  const unread = isSessionUnread(item, unreadIds);
  const title = item.title ?? 'Untitled session';

  function openTagsFromMenu() {
    // Radix's context menu is modal: on select it hands focus back to the
    // trigger from a rAF callback, which always runs after the microtask queue.
    // A microtask-deferred open would take focus first and then lose it to that
    // restore, which its FocusScope reads as a dismiss. A macrotask lands after.
    setTimeout(() => {
      const p = menuPoint.current;
      actions.onTags(p ? new DOMRect(p.x, p.y, 0, 0) : null);
    }, 0);
  }

  return (
    <SessionContextMenu
      pinned={custom.pinned}
      onPin={actions.onPin}
      onUnpin={actions.onUnpin}
      onRename={() => queueMicrotask(() => setIsRenaming(true))}
      onTags={openTagsFromMenu}
      onArchive={actions.onArchive}
      claudeSessionId={custom.claudeSessionId}
    >
      <ThreadListItemPrimitive.Root asChild data-testid="sessions-row" data-chat-id={item.id}>
        <SidebarMenuItem
          onContextMenu={(e) => {
            menuPoint.current = { x: e.clientX, y: e.clientY };
          }}
        >
          <HoverCard openDelay={500} closeDelay={60}>
            <HoverCardTrigger asChild>
              <ThreadListItemPrimitive.Trigger asChild>
                <SidebarMenuButton
                  size="sm"
                  // The reserve the variants add for an overlaid action would be
                  // spent twice: the meta cluster is in flow and fades out under
                  // the actions, so the gutter is already there.
                  className={cn(ROW_INDENT, 'h-auto py-1 pr-2! group-data-active/menu-item:bg-sidebar-selection')}
                >
                  <RowBody
                    item={item}
                    badge={deriveSessionBadge(custom, unread)}
                    colorOf={colorOf}
                    projectName={projectName}
                    showPinGlyph={custom.pinned && !inPinnedGroup}
                    renameSlot={
                      isRenaming ? (
                        <SessionRowRename
                          initialTitle={title}
                          onCommit={(next) => {
                            void itemRuntime.rename(next);
                            setIsRenaming(false);
                          }}
                          onCancel={() => setIsRenaming(false)}
                        />
                      ) : null
                    }
                  />
                </SidebarMenuButton>
              </ThreadListItemPrimitive.Trigger>
            </HoverCardTrigger>
            <HoverCardContent side="right" align="start">
              <SessionMetaCard
                title={title}
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
            </HoverCardContent>
          </HoverCard>
          <RowHoverActions
            pinned={custom.pinned}
            onPin={actions.onPin}
            onUnpin={actions.onUnpin}
            onTags={actions.onTags}
            onArchive={actions.onArchive}
          />
        </SidebarMenuItem>
      </ThreadListItemPrimitive.Root>
    </SessionContextMenu>
  );
}

interface SessionRowProps {
  item: SessionItem;
  colorOf?: (name: string) => TagColor;
  /** True inside the 'Pinned' group, where the pin glyph would be redundant. */
  inPinnedGroup?: boolean;
  projectName?: string;
}

/**
 * `getItemById` builds a subject that throws synchronously when the id is gone
 * — reachable during an optimistic archive — so the plain `threadItems` record
 * is checked first and only then resolved to a live runtime binding.
 */
function SessionRowResolver({ item, colorOf = DEFAULT_COLOR_OF, inPinnedGroup = false, projectName }: SessionRowProps) {
  const threadListRuntime = useAssistantRuntime().threads;
  const threadItems = threadListRuntime?.getState().threadItems;
  if (threadItems == null || !(item.id in threadItems)) return null;

  return (
    <ThreadListItemRuntimeProvider runtime={threadListRuntime.getItemById(item.id)}>
      <SessionRowInner item={item} colorOf={colorOf} inPinnedGroup={inPinnedGroup} projectName={projectName} />
    </ThreadListItemRuntimeProvider>
  );
}

// Memoized: on a filter switch the surviving rows keep referentially stable
// props, so only the rows entering or leaving the set re-render.
export const SessionRow = memo(SessionRowResolver);
