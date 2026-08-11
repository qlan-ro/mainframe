/**
 * SessionTabPill — one session tab in the title-bar strip: a project-colored
 * dot, the session title, and a hover close (×).
 *
 * A PREVIEW tab (editor-style temporary slot) renders its title italic and
 * grows a hover pin; double-click also pins. Pinned tabs are the plain form.
 *
 * Styled as the v2 Tabs primitive's `line` variant (verdict after trying the
 * boxed and Chrome-filled treatments): transparent pills, the active tab
 * marked by a 2px `bg-foreground` underline sitting ON the toolbar's bottom
 * hairline. The vocabulary is borrowed rather than the primitive used — a
 * closeable tab is never Radix Tabs, because `TabsTrigger` renders a <button>
 * and the close control would nest buttons (the workspace strip's rule).
 *
 * The pill lives inside the toolbar's window-drag region; the strip container
 * opts out via `data-no-drag` (see host `init()`), so pointer-downs here reach
 * the pill instead of starting an OS window drag.
 *
 * data-testid: session-tab-<id> / session-tab-close-<id> / session-tab-pin-<id>.
 */
import { useRef } from 'react';
import { Pin, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import { useTabDragStore } from '@/features/chat/zones/tab-drag-store';
import { projectColor } from '@/features/sessions/sidebar/project-color';

/** Pixels of pointer travel before a press becomes a drag-to-split. */
const DRAG_THRESHOLD = 6;

export interface SessionTabEntry {
  id: string;
  title: string;
  projectId: string | undefined;
  active: boolean;
  /** The temporary slot — the next opened session replaces this tab. */
  preview: boolean;
}

interface SessionTabPillProps {
  tab: SessionTabEntry;
  /** Inside the split pair's group container — the group owns the underline. */
  grouped?: boolean;
  /** `split` is true on a ⌘-click — the open-in-split gesture. */
  onActivate: (id: string, split: boolean) => void;
  onClose: (id: string) => void;
  onPin: (id: string) => void;
}

export function SessionTabPill({ tab, grouped = false, onActivate, onClose, onPin }: SessionTabPillProps) {
  // Drag-to-split: a press that travels DRAG_THRESHOLD becomes a tab drag
  // (tab-drag-store; ZoneDropLayer renders the targets and handles the drop).
  // The flag swallows the click that follows a drag's pointerup. While the
  // drag is live the page must not select text under the moving pointer —
  // suppress selection globally and show a grabbing cursor until release.
  const draggedRef = useRef(false);
  const dragging = useTabDragStore((s) => s.draggingId === tab.id);
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const { clientX, clientY } = event;
    const id = tab.id;
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

  return (
    <div
      data-testid={`session-tab-${tab.id}`}
      role="tab"
      aria-selected={tab.active}
      data-preview={tab.preview ? 'true' : 'false'}
      data-dragging={dragging || undefined}
      // preventDefault at MOUSEDOWN, not at the drag threshold: WebKit anchors
      // a native text selection on mousedown, and once that gesture starts no
      // later user-select/removeAllRanges stops it from painting the
      // transcript as the pointer crosses it.
      onMouseDown={(event) => event.preventDefault()}
      onPointerDown={onPointerDown}
      onClick={(event) => {
        if (draggedRef.current) {
          draggedRef.current = false;
          return;
        }
        onActivate(tab.id, event.metaKey);
      }}
      onDoubleClick={() => {
        if (tab.preview) onPin(tab.id);
      }}
      className={cn(
        // h-full puts the underline on the toolbar's bottom hairline and the
        // label on the toolbar midline — one alignment for every tab state.
        'group relative flex h-full w-45 min-w-24 shrink cursor-pointer items-center gap-1.5 px-2 text-xs select-none',
        // The dragged pill ghosts so the cursor + drop targets read as the live thing.
        dragging && 'opacity-40',
        !grouped &&
          'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground after:opacity-0 after:transition-opacity',
        tab.active
          ? cn('font-semibold text-foreground', !grouped && 'after:opacity-100')
          : 'font-medium text-muted-foreground hover:text-foreground',
      )}
    >
      <span
        className={cn('size-1.5 shrink-0 rounded-full', !tab.projectId && 'bg-muted-foreground/40')}
        style={tab.projectId ? { background: projectColor(tab.projectId) } : undefined}
        aria-hidden
      />
      <span className={cn('min-w-0 flex-1 truncate', tab.preview && 'italic')}>{tab.title}</span>
      {tab.preview && (
        <Hint label="Keep open">
          <Button
            data-testid={`session-tab-pin-${tab.id}`}
            variant="ghost"
            size="icon-2xs"
            className={cn('opacity-0 group-hover:opacity-100', tab.active && 'opacity-60')}
            onClick={(e) => {
              e.stopPropagation();
              onPin(tab.id);
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
          // Grouped (split) tabs are both ON SCREEN, so both keep the resting
          // ✕ the active tab gets — it closes the zone, not a hidden session.
          className={cn('opacity-0 group-hover:opacity-100', (tab.active || grouped) && 'opacity-60')}
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.id);
          }}
        >
          <X />
        </Button>
      </Hint>
    </div>
  );
}
