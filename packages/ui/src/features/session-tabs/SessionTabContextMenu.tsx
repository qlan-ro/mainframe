/**
 * Right-click menu for a session tab: the split gestures, plus the two tab
 * actions that otherwise need a hover target (keep-open, close).
 *
 * Every gesture here already exists — ⌘-click opens a split, drag-to-split
 * retargets one, ⌘\ dissolves one, the ✕ closes a tab. None of them announces
 * itself, so this menu is where they become discoverable; it deliberately adds
 * no capability of its own.
 *
 * Wraps its child — the pill is the trigger — so the whole tab responds,
 * including the parts its ✕ and pin overlay (the SessionContextMenu pattern).
 *
 * data-testid: session-tab-ctx-<action>.
 */
import type { ReactNode } from 'react';
import { Columns2, GitFork, PinIcon, SquareSplitHorizontal, XIcon } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Hint } from '@/components/ui/hint';
import type { ForkAvailability } from '@/features/sessions/view-model/fork-availability';

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
        <ContextMenuSeparator />
        <ContextMenuItem data-testid="session-tab-ctx-close" onSelect={onClose}>
          <XIcon />
          Close
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
