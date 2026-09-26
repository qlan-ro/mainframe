/**
 * One session in the sidebar list.
 *
 * The active highlight stays native: `ThreadListItemPrimitive.Root` renders as
 * the `SidebarMenuItem` and sets `data-active` when it is the main thread, so
 * the button tints off the group rather than off a prop we would have to keep
 * in sync. Actions come from the `threadListItem` scope on the aui client, not
 * from the item state, and the row is keyed by the stable `item.id` — never
 * `remoteId`, which a new chat can adopt.
 */
import { memo, useCallback, useRef, useState } from 'react';
import { ThreadListItemPrimitive, useAui, useAuiState } from '@assistant-ui/react';
import { openInSplit } from '@/features/chat/zones/open-in-split';
import { useZonesStore } from '@/features/chat/zones/zones-store';
import type { TagColor } from '@qlan-ro/mainframe-types';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import type { SessionItem } from '@/features/sessions/view-model/chat-to-thread-custom';
import { deriveSessionBadge } from '@/features/sessions/view-model/session-status';
import { isSessionUnread } from '@/features/sessions/view-model/session-unread';
import { useUnreadStore } from '@/store/unread-store';
import { SessionRowItemScope } from '@/features/sessions/SessionRowItemScope';
import { RowHoverActions } from './SessionRowHoverActions';
import { SessionContextMenu } from './SessionContextMenu';
import { SessionMetaCard } from './SessionMetaCard';
import { RowBody } from './SessionRowBody';
import { SessionRowRename } from './SessionRowRename';
import { canOpenMetaCard, useHoverCardWedgeGuard } from './use-hover-card-wedge-guard';
import { useForkLineageRow } from './sidebar/use-fork-lineage-row';
import { useRowActions } from './sidebar/use-row-actions';
import { forkCount } from './view-model/fork-lineage';
import { useSessionLineage } from './SessionLineageContext';

/** The section owns the horizontal inset; the row only keeps the stock pad. */
const ROW_INDENT = 'pl-2';

/** Rows rendered outside the sidebar's tag registry still paint their dots. */
const DEFAULT_COLOR_OF = (): TagColor => 'blue';

interface SessionRowInnerProps {
  item: SessionItem;
  colorOf: (name: string) => TagColor;
  inPinnedGroup: boolean;
  projectName?: string;
  /** This row's indent depth from the group's `nestForks` pass — 0 when not nested. */
  depth: 0 | 1 | 2;
}

function SessionRowInner({ item, colorOf, inPinnedGroup, projectName, depth }: SessionRowInnerProps) {
  const { custom } = item;
  const aui = useAui();
  const lineage = useForkLineageRow(item, depth);
  const { allItems } = useSessionLineage();
  const childForkCount = forkCount(allItems, item.id);
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  // Visible-but-unfocused zone chats get the dimmed selection tint — the
  // focused one keeps the native full data-active treatment. A parked pair is
  // off screen, so its rows carry no tint.
  const zoneDimmed = useZonesStore(
    (s) =>
      s.zones != null &&
      mainThreadId != null &&
      s.zones.includes(mainThreadId) &&
      s.zones.includes(item.id) &&
      mainThreadId !== item.id,
  );
  const unreadIds = useUnreadStore((s) => s.unread);
  const [isRenaming, setIsRenaming] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const actions = useRowActions(item);
  // Captured on right-click so the menu's Tags action anchors the popover at the
  // cursor rather than at the host's default (0,0).
  const menuPoint = useRef<{ x: number; y: number } | null>(null);
  const rowRef = useRef<HTMLLIElement | null>(null);
  // A ref, not state: the menu only gates the card, and re-rendering the row on
  // every right-click would cost the open menu its anchor.
  const menuOpen = useRef(false);
  const closeMeta = useCallback(() => setMetaOpen(false), []);
  useHoverCardWedgeGuard(metaOpen, rowRef, closeMeta);

  const handleMetaOpenChange = useCallback((next: boolean) => {
    setMetaOpen(next && !menuOpen.current && canOpenMetaCard(rowRef.current, document.activeElement));
  }, []);

  const handleMenuOpenChange = useCallback((open: boolean) => {
    menuOpen.current = open;
    if (open) setMetaOpen(false);
  }, []);

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

  const row = (
    <SessionContextMenu
      pinned={custom.pinned}
      temporary={custom.temporary}
      onOpenChange={handleMenuOpenChange}
      onPin={actions.onPin}
      onUnpin={actions.onUnpin}
      onRename={() => queueMicrotask(() => setIsRenaming(true))}
      onTags={openTagsFromMenu}
      onArchive={actions.onArchive}
      onOpenInSplit={() => {
        if (!openInSplit(mainThreadId, item.id)) aui.threads.switchToThread(item.id);
      }}
      forkAvailability={actions.forkAvailability}
      onFork={actions.onFork}
      claudeSessionId={custom.claudeSessionId}
    >
      <ThreadListItemPrimitive.Root asChild data-testid="sessions-row" data-chat-id={item.id}>
        <SidebarMenuItem
          ref={rowRef}
          onContextMenu={(e) => {
            menuPoint.current = { x: e.clientX, y: e.clientY };
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {/* Controlled so the wedge guard can force-close and `canOpenMetaCard`
              can refuse an open the pointer never asked for: under load Radix's
              open timer can fire after the pointer already left the row (or on a
              click, which focuses it), and then no pointerleave ever closes the
              card. */}
          <HoverCard open={metaOpen} onOpenChange={handleMetaOpenChange} openDelay={500} closeDelay={60}>
            <HoverCardTrigger asChild>
              <ThreadListItemPrimitive.Trigger asChild>
                <SidebarMenuButton
                  size="sm"
                  data-zone-visible={zoneDimmed || undefined}
                  // ⌘-click opens/retargets the split; capture so the native
                  // trigger's switchToThread never fires for the absorbed case.
                  onClickCapture={(e) => {
                    if (!e.metaKey) return;
                    if (openInSplit(mainThreadId, item.id)) {
                      e.preventDefault();
                      e.stopPropagation();
                    }
                  }}
                  // pr-2!: the variants reserve a gutter for an overlaid
                  // SidebarMenuAction, but the actions render inline now.
                  className={cn(
                    ROW_INDENT,
                    'h-auto py-1 pr-2! group-data-active/menu-item:bg-sidebar-selection',
                    zoneDimmed && 'bg-sidebar-selection/40',
                  )}
                >
                  <RowBody
                    item={item}
                    badge={deriveSessionBadge(custom, unread)}
                    colorOf={colorOf}
                    projectName={projectName}
                    showPinGlyph={custom.pinned && !inPinnedGroup}
                    nestedFork={lineage.nested}
                    forkFallback={lineage.fallback}
                    actionsSlot={
                      hovered ? (
                        <RowHoverActions
                          pinned={custom.pinned}
                          temporary={custom.temporary}
                          onPin={actions.onPin}
                          onUnpin={actions.onUnpin}
                          onTags={actions.onTags}
                          onArchive={actions.onArchive}
                        />
                      ) : null
                    }
                    renameSlot={
                      isRenaming ? (
                        <SessionRowRename
                          initialTitle={title}
                          onCommit={(next) => {
                            void aui.threadListItem.rename(next);
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
                noProject={custom.noProject}
                worktreePath={custom.worktreePath}
                branchName={custom.branchName}
                worktreeMissing={custom.worktreeMissing}
                transcriptMissing={custom.transcriptMissing}
                detectedPrs={custom.detectedPrs}
                tags={custom.tags}
                colorOf={colorOf}
                parentState={lineage.parentState}
                forkCount={childForkCount}
              />
            </HoverCardContent>
          </HoverCard>
        </SidebarMenuItem>
      </ThreadListItemPrimitive.Root>
    </SessionContextMenu>
  );

  // Variant D: the indented wrapper (left rule) only exists for a nested row —
  // everything else (fallback glyph, hover card) renders on the plain row.
  // Indentation goes one step per level and stops at two: a depth-2 row (a
  // fork of a fork) gets a second nested wrapper so it reads as a child of
  // its own (already-indented) parent rather than a sibling of it.
  if (!lineage.nested) return row;
  const nestedOnce = (
    <div data-testid="sessions-row-fork-nest" className="ml-3.5 border-l-2 border-sidebar-border pl-2">
      {row}
    </div>
  );
  if (lineage.depth < 2) return nestedOnce;
  return (
    <div data-testid="sessions-row-fork-nest-2" className="ml-3.5 border-l-2 border-sidebar-border pl-2">
      {nestedOnce}
    </div>
  );
}

interface SessionRowProps {
  item: SessionItem;
  colorOf?: (name: string) => TagColor;
  /** True inside the 'Pinned' group, where the pin glyph would be redundant. */
  inPinnedGroup?: boolean;
  projectName?: string;
  /** This row's indent depth from the group's `nestForks` pass — 0 when not nested. */
  depth?: 0 | 1 | 2;
}

/**
 * Resolving a vanished id throws synchronously — reachable during an optimistic
 * archive — so presence in `threadItems` is checked before the scope below it
 * ever resolves. The selector returns the membership BOOLEAN, not the array, so
 * a row only re-renders when its own presence flips rather than on every list
 * change. `threadItems` holds regular and archived entries alike, so an archive
 * does not trip this guard; a delete does.
 */
function SessionRowResolver({
  item,
  colorOf = DEFAULT_COLOR_OF,
  inPinnedGroup = false,
  projectName,
  depth = 0,
}: SessionRowProps) {
  const present = useAuiState((s) => s.threads.threadItems.some((t) => t.id === item.id));
  if (!present) return null;

  return (
    <SessionRowItemScope id={item.id}>
      <SessionRowInner
        item={item}
        colorOf={colorOf}
        inPinnedGroup={inPinnedGroup}
        projectName={projectName}
        depth={depth}
      />
    </SessionRowItemScope>
  );
}

// Memoized: on a filter switch the surviving rows keep referentially stable
// props, so only the rows entering or leaving the set re-render.
export const SessionRow = memo(SessionRowResolver);
