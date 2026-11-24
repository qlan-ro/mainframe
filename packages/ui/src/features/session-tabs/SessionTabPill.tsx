/**
 * SessionTabPill — one session tab in the title bar: a 14px lead slot (the
 * status dot, or the ⌘N badge while the hint modifier is held), the session
 * title, and a ✕ — everything else (open in workspace, keep open, fork, side chat)
 * lives in the right-click menu.
 *
 * The shared title-bar tab shape (`tab-shape`), 180px wide, shrinking to 96.
 * The title fades only when it overflows. On a background tab it owns the whole
 * pill: the ✕ sits out of flow and overlays its tail on hover or keyboard focus
 * (on the pill's ground, behind a short ramp). The selected tab's ✕ is in flow.
 *
 * A PREVIEW tab (editor-style temporary slot) renders its title italic;
 * double-click or the menu's "Keep open" pins it. Dragged onto the chat, a
 * tab opens in the workspace (`SessionDropLayer`).
 *
 * data-testid: session-tab-<id> / -close- / -status- / -waiting-.
 */
import { useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FadeLabel } from '@/components/ui/fade-label';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import type { ForkAvailability } from '@/features/sessions/view-model/fork-availability';
import { ShortcutIndexBadge } from '@/features/shortcuts/ShortcutIndexBadge';
import { SessionTabContextMenu, type SurfaceMenuActions } from './SessionTabContextMenu';
import { SessionTabDot, type SessionTabStatus } from './SessionTabDot';
import { useTabDragStore } from './tab-drag-store';
import {
  keepFocusOnTabPress,
  TAB_CLOSE_ATTR,
  TAB_CLOSE_BUTTON,
  TAB_CLOSE_OVERLAY,
  TAB_KEYS_ATTR,
  TAB_HOVER_STYLE,
  tabShape,
} from './tab-shape';

/** Pixels of pointer travel before a press becomes a drag. */
const DRAG_THRESHOLD = 6;

export interface SessionTabEntry {
  id: string;
  title: string;
  projectId: string | undefined;
  projectName: string | undefined;
  active: boolean;
  /** The temporary slot — the next opened session replaces this tab. */
  preview: boolean;
  forkAvailability: ForkAvailability;
  status: SessionTabStatus;
  /** True for a real, non-side-chat tab (todo #344) — a draft has no chat id yet. */
  canOpenSideChat: boolean;
}

export interface SessionTabPillActions {
  /** `beside` is true on a ⌘-click — the open-in-workspace gesture. */
  onActivate: (id: string, beside: boolean) => void;
  onClose: (id: string) => void;
  onPin: (id: string) => void;
  onOpenBeside: (id: string) => void;
  onFork: (id: string) => void;
  onOpenSideChat: (id: string) => void;
  surface: SurfaceMenuActions;
}

interface SessionTabPillProps extends SessionTabPillActions {
  tab: SessionTabEntry;
  /** 1-based ⌘N number, while the hint modifier is held; null the rest of the time. */
  hintIndex?: number | null;
  canOpenBeside: boolean;
}

/** A press that travels DRAG_THRESHOLD becomes a tab drag. */
function useTabDrag(id: string) {
  const draggedRef = useRef(false);
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const { clientX, clientY } = event;
    const onMove = (e: PointerEvent) => {
      if (Math.abs(e.clientX - clientX) + Math.abs(e.clientY - clientY) < DRAG_THRESHOLD) return;
      if (useTabDragStore.getState().draggingId !== id) {
        draggedRef.current = true;
        useTabDragStore.getState().start(id);
        window.getSelection()?.removeAllRanges();
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      // After the drop target's own pointerup (bubbles first) has acted.
      requestAnimationFrame(() => useTabDragStore.getState().end());
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  /** True once, for the click that follows a drag's pointerup. */
  const consumeDragClick = () => {
    const dragged = draggedRef.current;
    draggedRef.current = false;
    return dragged;
  };
  return { onPointerDown, consumeDragClick };
}

export function SessionTabPill({ tab, hintIndex = null, canOpenBeside, ...actions }: SessionTabPillProps) {
  const { onPointerDown, consumeDragClick } = useTabDrag(tab.id);
  const dragging = useTabDragStore((s) => s.draggingId === tab.id);
  return (
    <SessionTabContextMenu
      canOpenBeside={canOpenBeside}
      preview={tab.preview}
      onOpenBeside={() => actions.onOpenBeside(tab.id)}
      onKeepOpen={() => actions.onPin(tab.id)}
      onClose={() => actions.onClose(tab.id)}
      forkAvailability={tab.forkAvailability}
      onFork={() => actions.onFork(tab.id)}
      canOpenSideChat={tab.canOpenSideChat}
      onOpenSideChat={() => actions.onOpenSideChat(tab.id)}
      surface={actions.surface}
    >
      <div
        data-testid={`session-tab-${tab.id}`}
        role="tab"
        {...TAB_KEYS_ATTR}
        aria-selected={tab.active}
        tabIndex={tab.active ? 0 : -1}
        data-preview={tab.preview ? 'true' : 'false'}
        data-dragging={dragging || undefined}
        // preventDefault at MOUSEDOWN, not at the drag threshold: WebKit anchors
        // a native text selection on mousedown, and once that gesture starts no
        // later user-select/removeAllRanges stops it from painting the
        // transcript as the pointer crosses it.
        onMouseDown={keepFocusOnTabPress}
        onPointerDown={onPointerDown}
        onClick={(event) => {
          if (consumeDragClick()) return;
          actions.onActivate(tab.id, event.metaKey);
        }}
        onDoubleClick={() => {
          if (tab.preview) actions.onPin(tab.id);
        }}
        className={tabShape(
          tab.active,
          cn(
            'w-45 min-w-24 shrink gap-2',
            tab.active ? 'pr-1 pl-3' : 'px-3',
            // The dragged pill ghosts so the cursor + drop target read as the live thing.
            dragging && 'opacity-40',
          ),
        )}
        style={TAB_HOVER_STYLE}
      >
        {/* The badge takes the dot's 14px slot rather than adding one, so
            holding the modifier never reflows the strip under the pointer. */}
        <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center">
          {hintIndex != null ? (
            <ShortcutIndexBadge index={hintIndex} data-testid={`session-tab-hint-${tab.id}`} />
          ) : (
            <SessionTabDot id={tab.id} status={tab.status} />
          )}
        </span>
        <FadeLabel className={cn('flex-1', tab.preview && 'italic')} tooltipDelay={600}>
          {tab.title}
        </FadeLabel>
        <span
          data-testid={`session-tab-controls-${tab.id}`}
          className={cn(
            !tab.active && TAB_CLOSE_OVERLAY,
            !tab.active && 'bg-(--tab-hover) opacity-0 before:to-(--tab-hover)',
            !tab.active && 'group-focus-within/tab:opacity-100 group-hover/tab:opacity-100',
          )}
        >
          <Hint label={`Close ${tab.title}`}>
            <Button
              data-testid={`session-tab-close-${tab.id}`}
              {...TAB_CLOSE_ATTR}
              aria-label={`Close ${tab.title}`}
              tabIndex={-1}
              variant="ghost"
              size="icon-xs"
              className={TAB_CLOSE_BUTTON}
              onClick={(e) => {
                e.stopPropagation();
                actions.onClose(tab.id);
              }}
            >
              <X />
            </Button>
          </Hint>
        </span>
      </div>
    </SessionTabContextMenu>
  );
}
