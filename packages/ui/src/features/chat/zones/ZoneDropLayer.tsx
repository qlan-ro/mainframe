/**
 * Drop targets for the drag-to-split gesture, floated over the chat surface
 * while a session tab is being dragged (tab-drag-store).
 *
 * Single view: BOTH halves are targets — drop left to put the dragged session
 * on the left of the split, right for the right; there is no dead half.
 * Visible split: each zone is a target — dropping retargets that slot
 * (dropping a chat already in the split just focuses it). Dragging the active
 * chat has nothing to split against, so no targets render.
 *
 * The mid-drag highlight is React state driven by pointerenter/leave, NOT CSS
 * `:hover` — WKWebView freezes hover matching while the mouse button is held,
 * which made a real drag show no feedback at all (synthetic tests can't catch
 * that; a live mouse did).
 */
import { useState } from 'react';
import { useAui, useAuiState } from '@assistant-ui/react';
import { Columns2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTabDragStore } from './tab-drag-store';
import { splitVisible, useZonesStore, type ZoneIndex } from './zones-store';

function DropTarget({
  testId,
  label,
  className,
  onDrop,
}: {
  testId: string;
  label: string;
  className?: string;
  onDrop: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      data-testid={testId}
      data-hovered={hovered || undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerUp={onDrop}
      className={cn(
        'pointer-events-auto flex items-center justify-center rounded-md border-2 border-dashed',
        'border-primary/40 bg-primary/5 transition-all duration-100',
        hovered && 'border-solid border-primary bg-primary/15',
        className,
      )}
    >
      {/* Solid chip, legible over whatever zone furniture sits behind. */}
      <span
        className={cn(
          'pointer-events-none flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium shadow-md',
          hovered ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-popover text-foreground',
        )}
      >
        <Columns2 className="size-3.5" aria-hidden />
        {label}
      </span>
    </div>
  );
}

export function ZoneDropLayer() {
  const aui = useAui();
  const draggingId = useTabDragStore((s) => s.draggingId);
  const zones = useZonesStore((s) => s.zones);
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);

  if (draggingId == null || draggingId.startsWith('__LOCALID_')) return null;

  const dropOnZone = (index: ZoneIndex) => {
    const store = useZonesStore.getState();
    if (store.zones == null) return;
    if (store.zones.includes(draggingId)) {
      aui.threads.switchToThread(draggingId);
      return;
    }
    store.replaceZone(index, draggingId);
    // Replacing the focused slot would strand mainThreadId outside the split —
    // focus follows the drop so the invariant holds before the reconciler runs.
    if (store.focusedIndex === index) aui.threads.switchToThread(draggingId);
  };

  // Near-full-bleed halves: a hairline 2px inset keeps the rectangles off the
  // zone edges without reading as floating boxes over the furniture behind
  // them (user-tuned; a dim+blur scrim round was rejected).
  const LAYER = 'pointer-events-none absolute inset-0 z-40 flex gap-0.5 p-0.5';

  // Only a VISIBLE split offers per-zone targets — a parked pair is off
  // screen, and the drop below rebuilds the pair around the current chat.
  if (splitVisible(zones, mainThreadId)) {
    return (
      <div className={LAYER}>
        <DropTarget testId="zone-drop-left" label="Show here" className="flex-1" onDrop={() => dropOnZone(0)} />
        <DropTarget testId="zone-drop-right" label="Show here" className="flex-1" onDrop={() => dropOnZone(1)} />
      </div>
    );
  }

  // Single view: nothing to split against when dragging the active chat.
  if (mainThreadId == null || draggingId === mainThreadId || mainThreadId.startsWith('__LOCALID_')) return null;

  return (
    <div className={LAYER}>
      <DropTarget
        testId="zone-drop-split-left"
        label="Split left"
        className="flex-1"
        onDrop={() => useZonesStore.getState().openSplit(draggingId, mainThreadId)}
      />
      <DropTarget
        testId="zone-drop-split"
        label="Split right"
        className="flex-1"
        onDrop={() => useZonesStore.getState().openSplit(mainThreadId, draggingId)}
      />
    </div>
  );
}
