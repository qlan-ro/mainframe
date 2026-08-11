/**
 * Drop targets for the drag-to-split gesture, floated over the chat surface
 * while a session tab is being dragged (tab-drag-store).
 *
 * Single mode: the right half offers "Open in split" — dropping anchors the
 * current chat left and the dragged session right. Split mode: each zone is a
 * target — dropping retargets that slot (dropping a chat already in the split
 * just focuses it). Dragging the active tab in single mode has nothing to
 * split against, so no targets render.
 */
import { useAui, useAuiState } from '@assistant-ui/react';
import { Columns2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTabDragStore } from './tab-drag-store';
import { useZonesStore, type ZoneIndex } from './zones-store';

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
  return (
    <div
      data-testid={testId}
      onPointerUp={onDrop}
      className={cn(
        'pointer-events-auto flex items-center justify-center rounded-lg border-2 border-dashed',
        'border-primary/40 bg-primary/5 text-sm text-muted-foreground transition-colors',
        'hover:border-primary/70 hover:bg-primary/15 hover:text-foreground',
        className,
      )}
    >
      <span className="flex items-center gap-1.5">
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

  if (zones != null) {
    return (
      <div className="pointer-events-none absolute inset-0 z-40 flex gap-2 p-3">
        <DropTarget testId="zone-drop-left" label="Show here" className="flex-1" onDrop={() => dropOnZone(0)} />
        <DropTarget testId="zone-drop-right" label="Show here" className="flex-1" onDrop={() => dropOnZone(1)} />
      </div>
    );
  }

  // Single mode: nothing to split against when dragging the active chat.
  if (mainThreadId == null || draggingId === mainThreadId || mainThreadId.startsWith('__LOCALID_')) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex justify-end p-3">
      <DropTarget
        testId="zone-drop-split"
        label="Open in split"
        className="w-1/2"
        onDrop={() => useZonesStore.getState().openSplit(mainThreadId, draggingId)}
      />
    </div>
  );
}
