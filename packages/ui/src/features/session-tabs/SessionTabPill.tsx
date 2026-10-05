/**
 * SessionTabPill — one session tab in the title bar: a 14px lead slot (the
 * provider dot, or the ⌘N badge while the hint modifier is held), the session
 * title, and hover controls (open-beside, pin, close).
 *
 * A content-sized `rounded-md` pill, `h-8`, capped at `max-w-45` and never
 * narrower than `min-w-24`: active is a filled `accent` pill with a soft
 * shadow; inactive is quiet ink. (The old 2px underline is gone with the
 * toolbar hairline it sat on.) The title fades only when it overflows, and it
 * owns the pill's full width at rest: the controls sit out of flow and overlay
 * its tail on hover (on the pill's ground, behind a short ramp) rather than
 * reserving room while invisible.
 *
 * Inside a split pair the pill is one SEGMENT (`segment`): the focused one is
 * filled, the other is not, and a parked pair fills neither.
 *
 * A PREVIEW tab (editor-style temporary slot) renders its title italic and
 * grows a hover pin; double-click also pins. Hovering a background tab reveals
 * an open-beside control. While another tab is being dragged, the ACTIVE pill
 * is a drop target (highlight via state, not `:hover` — WKWebView freezes hover
 * matching under a held button) and acts on pointerup, before the drag's
 * rAF-deferred `end()`.
 *
 * data-testid: session-tab-<id> / -close- / -pin- / -open-beside- / -waiting-.
 */
import { useRef, useState } from 'react';
import { Columns2, Pin, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FadeLabel } from '@/components/ui/fade-label';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import { useTabDragStore } from '@/features/chat/zones/tab-drag-store';
import type { ForkAvailability } from '@/features/sessions/view-model/fork-availability';
import { ProviderDot } from '@/features/shared/ProviderDot';
import { ShortcutIndexBadge } from '@/features/shortcuts/ShortcutIndexBadge';
import { SessionTabContextMenu, type SurfaceMenuActions } from './SessionTabContextMenu';

/** Pixels of pointer travel before a press becomes a drag-to-split. */
const DRAG_THRESHOLD = 6;

export interface SessionTabEntry {
  id: string;
  title: string;
  projectId: string | undefined;
  projectName: string | undefined;
  adapterId: string | undefined;
  active: boolean;
  /** The temporary slot — the next opened session replaces this tab. */
  preview: boolean;
  forkAvailability: ForkAvailability;
  /** The chat's own pending gate OR its side chat's (todo #344). */
  hasPending: boolean;
  /** True for a real, non-side-chat tab (todo #344) — a draft has no chat id yet. */
  canOpenSideChat: boolean;
}

export type PillSegment = 'focused' | 'unfocused' | 'parked';

export interface SessionTabPillActions {
  /** `split` is true on a ⌘-click — the open-in-split gesture. */
  onActivate: (id: string, split: boolean) => void;
  onClose: (id: string) => void;
  onPin: (id: string) => void;
  onOpenInSplit: (id: string) => void;
  onCloseSplit: (id: string) => void;
  onFork: (id: string) => void;
  onOpenSideChat: (id: string) => void;
  /** A dragged tab was dropped on this (active) pill. */
  onDropTab: (draggedId: string) => void;
  surface: SurfaceMenuActions;
}

interface SessionTabPillProps extends SessionTabPillActions {
  tab: SessionTabEntry;
  /** Set inside a split pair; absent for a lone tab. */
  segment?: PillSegment;
  /** 1-based ⌘N number, while the hint modifier is held; null the rest of the time. */
  hintIndex?: number | null;
  canOpenInSplit: boolean;
}

/** Drag-to-split: a press that travels DRAG_THRESHOLD becomes a tab drag. */
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

export function SessionTabPill({ tab, segment, hintIndex = null, canOpenInSplit, ...actions }: SessionTabPillProps) {
  const { onPointerDown, consumeDragClick } = useTabDrag(tab.id);
  const dragging = useTabDragStore((s) => s.draggingId === tab.id);
  // Only the active pill receives a drop — a background tab has nothing to split against.
  const dropTarget = useTabDragStore((s) => tab.active && s.draggingId != null && s.draggingId !== tab.id);
  const [dropHover, setDropHover] = useState(false);
  const filled = segment == null ? tab.active : segment === 'focused';
  const inPair = segment != null;
  const restingClose = filled || inPair;

  return (
    <SessionTabContextMenu
      inSplit={inPair}
      canOpenInSplit={canOpenInSplit}
      preview={tab.preview}
      onOpenInSplit={() => actions.onOpenInSplit(tab.id)}
      onCloseSplit={() => actions.onCloseSplit(tab.id)}
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
        aria-selected={tab.active}
        data-preview={tab.preview ? 'true' : 'false'}
        data-dragging={dragging || undefined}
        data-drop-hover={dropHover || undefined}
        // preventDefault at MOUSEDOWN, not at the drag threshold: WebKit anchors
        // a native text selection on mousedown, and once that gesture starts no
        // later user-select/removeAllRanges stops it from painting the
        // transcript as the pointer crosses it.
        onMouseDown={(event) => event.preventDefault()}
        onPointerDown={onPointerDown}
        onPointerEnter={() => dropTarget && setDropHover(true)}
        onPointerLeave={() => setDropHover(false)}
        onPointerUp={() => {
          if (!dropTarget) return;
          const draggedId = useTabDragStore.getState().draggingId;
          setDropHover(false);
          if (draggedId != null) actions.onDropTab(draggedId);
        }}
        onClick={(event) => {
          if (consumeDragClick()) return;
          actions.onActivate(tab.id, event.metaKey);
        }}
        onDoubleClick={() => {
          if (tab.preview) actions.onPin(tab.id);
        }}
        className={cn(
          'group relative flex max-w-45 min-w-24 shrink cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs select-none',
          // A pair segment fills the pair pill's content box (32px minus its 1px
          // border): at h-8 it overflowed by 1px top and bottom, and the hover
          // controls' ground painted over the pair's border.
          inPair ? 'h-full' : 'h-8',
          // The dragged pill ghosts so the cursor + drop targets read as the live thing.
          dragging && 'opacity-40',
          filled
            ? 'bg-accent font-semibold text-foreground shadow-sm'
            : 'font-medium text-muted-foreground hover:text-foreground',
          // A lone background tab tints on hover — quieter than the active pill's
          // fill + shadow, so "pointed at" never reads as "selected". Pair
          // segments already sit in their own bordered pill.
          !filled && !inPair && 'hover:bg-(--tab-hover)',
          dropHover && 'ring-2 ring-primary',
        )}
        // One opaque hover ground, shared with the controls cluster below so the
        // ✕ and open-beside sit on exactly the pill's colour (no patch).
        style={
          { '--tab-hover': 'color-mix(in oklch, var(--sidebar-accent) 60%, var(--sidebar))' } as React.CSSProperties
        }
      >
        {/* The badge takes the dot's 14px slot rather than adding one, so
            holding the modifier never reflows the strip under the pointer. */}
        <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center">
          {hintIndex != null ? (
            <ShortcutIndexBadge index={hintIndex} data-testid={`session-tab-hint-${tab.id}`} />
          ) : (
            <ProviderDot adapterId={tab.adapterId ?? ''} testId={`session-tab-provider-${tab.id}`} />
          )}
          {/* The chat's own pending gate or its side chat's (todo #344) — the
              same primary/pulse treatment as the sidebar's waiting state. */}
          {tab.hasPending && (
            <Hint label="Your turn">
              <span
                data-testid={`session-tab-waiting-${tab.id}`}
                aria-label="waiting"
                className="absolute -top-0.5 -right-0.5 size-1.5 animate-pulse rounded-full bg-primary"
              />
            </Hint>
          )}
        </span>
        {/* The title owns the whole pill at rest and fades at the pill's end. The
            controls are out of flow: they overlay its tail on hover, on the pill's
            own ground with a short ramp, so a hidden ✕ never reserves label room. */}
        <FadeLabel className={cn('flex-1', tab.preview && 'italic')}>{tab.title}</FadeLabel>
        <span
          data-testid={`session-tab-controls-${tab.id}`}
          className={cn(
            'absolute inset-y-0 right-1 flex items-center gap-0.5 pl-0.5',
            'before:pointer-events-none before:absolute before:inset-y-0 before:right-full before:w-4 before:bg-linear-to-r before:from-transparent',
            filled
              ? 'bg-accent before:to-accent'
              : inPair
                ? 'bg-popover before:to-popover'
                : 'bg-(--tab-hover) before:to-(--tab-hover)',
            // Pair segments are both ON SCREEN, so both keep the resting ✕ the
            // active tab gets — it closes the zone, not a hidden session. Every
            // other pill shows its controls (and their ground) only on hover.
            !restingClose && 'opacity-0 group-hover:opacity-100',
          )}
        >
          {canOpenInSplit && !inPair && (
            <Hint label="Open beside the current session">
              <Button
                data-testid={`session-tab-open-beside-${tab.id}`}
                variant="ghost"
                size="icon-2xs"
                className="opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  actions.onOpenInSplit(tab.id);
                }}
              >
                <Columns2 />
              </Button>
            </Hint>
          )}
          {tab.preview && (
            <Hint label="Keep open">
              <Button
                data-testid={`session-tab-pin-${tab.id}`}
                variant="ghost"
                size="icon-2xs"
                className={cn('opacity-0 group-hover:opacity-100', filled && 'opacity-60')}
                onClick={(e) => {
                  e.stopPropagation();
                  actions.onPin(tab.id);
                }}
              >
                <Pin />
              </Button>
            </Hint>
          )}
          <Hint label={`Close ${tab.title}`}>
            <Button
              data-testid={`session-tab-close-${tab.id}`}
              variant="ghost"
              size="icon-2xs"
              className={cn('opacity-0 group-hover:opacity-100', restingClose && 'opacity-60')}
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
