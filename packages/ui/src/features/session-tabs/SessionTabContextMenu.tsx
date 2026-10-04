/**
 * Right-click menu for a session tab: the split gestures, plus the two tab
 * actions that otherwise need a hover target (keep-open, close).
 *
 * Every gesture here already exists — ⌘-click opens a split, drag-to-split
 * retargets one, ⌘\ dissolves one, the ✕ closes a tab, ⌘1 hides the chat
 * surface. None of them announces itself, so this menu is where they become
 * discoverable; it deliberately adds no capability of its own. The
 * whole-surface actions (split the surface right/down, hide chat) moved here
 * from the retired chat header — they are about the surface, not the tab, so
 * every tab's menu offers them.
 *
 * Wraps its child — the pill is the trigger — so the whole tab responds,
 * including the parts its ✕ and pin overlay (the SessionContextMenu pattern).
 *
 * data-testid: session-tab-ctx-<action>.
 */
import type { ReactNode } from 'react';
import {
  Columns2,
  EyeOff,
  GitFork,
  LayoutPanelLeft,
  LayoutPanelTop,
  MessageSquarePlus,
  PinIcon,
  SquareSplitHorizontal,
  XIcon,
} from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Hint } from '@/components/ui/hint';
import type { ForkAvailability } from '@/features/sessions/view-model/fork-availability';

/** The chat SURFACE's actions — the same for every tab. */
export interface SurfaceMenuActions {
  /** A second surface can take the other half (`layoutCanSplit`). */
  canSplit: boolean;
  onSplitRight: () => void;
  onSplitDown: () => void;
  /** False while chat is the last lit surface — the dynamic floor. */
  canHide: boolean;
  onHide: () => void;
}

interface SessionTabContextMenuProps {
  /** A member of the open pair — the split actions invert for it. */
  inSplit: boolean;
  /** The open-in-split gesture has somewhere to go (`canOpenInSplit`). */
  canOpenInSplit: boolean;
  /** The temporary slot — only a preview tab can be kept open. */
  preview: boolean;
  onOpenInSplit: () => void;
  onCloseSplit: () => void;
  onKeepOpen: () => void;
  onClose: () => void;
  forkAvailability: ForkAvailability;
  onFork: () => void;
  /** True for a real, non-side-chat tab (todo #344) — a draft has no chat id yet. */
  canOpenSideChat: boolean;
  onOpenSideChat: () => void;
  surface: SurfaceMenuActions;
  children: ReactNode;
}

export function SessionTabContextMenu({
  inSplit,
  canOpenInSplit,
  preview,
  onOpenInSplit,
  onCloseSplit,
  onKeepOpen,
  onClose,
  forkAvailability,
  onFork,
  canOpenSideChat,
  onOpenSideChat,
  surface,
  children,
}: SessionTabContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {inSplit ? (
          <ContextMenuItem data-testid="session-tab-ctx-close-split" onSelect={onCloseSplit}>
            <SquareSplitHorizontal />
            Close Split
          </ContextMenuItem>
        ) : (
          <ContextMenuItem data-testid="session-tab-ctx-open-split" disabled={!canOpenInSplit} onSelect={onOpenInSplit}>
            <Columns2 />
            Open in Split
          </ContextMenuItem>
        )}
        {preview && (
          <ContextMenuItem data-testid="session-tab-ctx-keep-open" onSelect={onKeepOpen}>
            <PinIcon />
            Keep Open
          </ContextMenuItem>
        )}
        {forkAvailability.enabled ? (
          <ContextMenuItem data-testid="session-tab-ctx-fork" onSelect={onFork}>
            <GitFork />
            Fork
          </ContextMenuItem>
        ) : (
          // See SessionContextMenu's identical note: a disabled item's own
          // `data-disabled:pointer-events-none` never lets a Hint on itself fire.
          <Hint label={forkAvailability.reason}>
            <span className="flex">
              <ContextMenuItem data-testid="session-tab-ctx-fork" disabled>
                <GitFork />
                Fork
              </ContextMenuItem>
            </span>
          </Hint>
        )}
        {canOpenSideChat && (
          <ContextMenuItem data-testid="session-tab-ctx-side-chat" onSelect={onOpenSideChat}>
            <MessageSquarePlus />
            Open Side Chat
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        {surface.canSplit && (
          <>
            <ContextMenuItem data-testid="session-tab-ctx-split-right" onSelect={surface.onSplitRight}>
              <LayoutPanelLeft />
              Split Right
            </ContextMenuItem>
            <ContextMenuItem data-testid="session-tab-ctx-split-down" onSelect={surface.onSplitDown}>
              <LayoutPanelTop />
              Split Down
            </ContextMenuItem>
          </>
        )}
        <ContextMenuItem data-testid="session-tab-ctx-hide-chat" disabled={!surface.canHide} onSelect={surface.onHide}>
          <EyeOff />
          Hide Chat
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem data-testid="session-tab-ctx-close" onSelect={onClose}>
          <XIcon />
          Close
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
