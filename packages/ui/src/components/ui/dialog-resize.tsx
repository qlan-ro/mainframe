import * as React from 'react';
import { dialogSizeFor, useUiPrefs, type DialogSize } from '@/store/ui-prefs';

/** Matches `DialogContent`'s own `max-w-[calc(100%-2rem)]` outer margin. */
const VIEWPORT_MARGIN = 32;

/** Drag past this and the gesture is a resize, not a click on the grip (mirrors `SidebarRail`). */
const DRAG_SLOP = 3;

/** Min wins when the two cross, so a dialog wider than a small viewport is never squeezed below its own default. */
export function clampDialogSize(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function clampToViewport(size: DialogSize, min: DialogSize): DialogSize {
  return {
    width: clampDialogSize(size.width, min.width, window.innerWidth - VIEWPORT_MARGIN),
    height: clampDialogSize(size.height, min.height, window.innerHeight - VIEWPORT_MARGIN),
  };
}

interface CornerDragArgs {
  dialogKey: string;
  min: DialogSize;
  start: DialogSize;
  startX: number;
  startY: number;
  isMounted: React.RefObject<boolean>;
  onSizeChange: (size: DialogSize) => void;
  onDraggingChange: (dragging: boolean) => void;
}

/** Bound to `window` for the drag's lifetime — a corner smaller than the grip would lose the pointer otherwise. */
function startCornerDrag({
  dialogKey,
  min,
  start,
  startX,
  startY,
  isMounted,
  onSizeChange,
  onDraggingChange,
}: CornerDragArgs): void {
  let moved = false;
  let size = start;
  onDraggingChange(true);

  const onMove = (move: PointerEvent) => {
    if (Math.abs(move.clientX - startX) > DRAG_SLOP || Math.abs(move.clientY - startY) > DRAG_SLOP) moved = true;
    if (!moved || !isMounted.current) return;
    // Centered via translate(-50%,-50%): the edge moves half as far as the
    // box grows, so a pointer delta of N needs a size delta of 2N to keep
    // the grip under the cursor.
    size = clampToViewport(
      { width: start.width + 2 * (move.clientX - startX), height: start.height + 2 * (move.clientY - startY) },
      min,
    );
    onSizeChange(size);
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    onDraggingChange(false);
    // A click with no movement leaves the store untouched — committing it
    // would pin the mount-time (possibly viewport-clamped) measurement.
    if (moved && isMounted.current) useUiPrefs.getState().setDialogSize(dialogKey, size);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

interface DialogResizeGrabberProps {
  dialogKey: string;
  onSizeChange: (size: DialogSize | null) => void;
  onDraggingChange: (dragging: boolean) => void;
}

/**
 * Renders inside `DialogPrimitive.Content` (not the wrapper) because Radix
 * only unmounts that inner subtree on close — a wrapper-level mount effect
 * would fire once, before the dialog ever opens, and never again.
 */
function DialogResizeGrabber({ dialogKey, onSizeChange, onDraggingChange }: DialogResizeGrabberProps) {
  const handleRef = React.useRef<HTMLDivElement | null>(null);
  const minRef = React.useRef<DialogSize | null>(null);
  const isMounted = React.useRef(true);

  React.useLayoutEffect(() => {
    isMounted.current = true;
    const box = handleRef.current?.closest('[data-slot="dialog-content"]');
    if (!(box instanceof HTMLElement)) return;
    // offsetWidth/Height, not getBoundingClientRect: the open animation's
    // zoom-in scale transform would otherwise be baked into the "default".
    const min: DialogSize = { width: box.offsetWidth, height: box.offsetHeight };
    minRef.current = min;
    const stored = dialogSizeFor(useUiPrefs.getState().dialogSizes, dialogKey, min);
    if (stored !== min) onSizeChange(clampToViewport(stored, min));
    return () => {
      isMounted.current = false;
      onSizeChange(null);
    };
  }, [dialogKey, onSizeChange]);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const min = minRef.current;
    const box = handleRef.current?.closest('[data-slot="dialog-content"]');
    if (min === null || !(box instanceof HTMLElement)) return;
    const rect = box.getBoundingClientRect();
    startCornerDrag({
      dialogKey,
      min,
      start: { width: rect.width, height: rect.height },
      startX: event.clientX,
      startY: event.clientY,
      isMounted,
      onSizeChange,
      onDraggingChange,
    });
  }

  return (
    <div
      ref={handleRef}
      onPointerDown={onPointerDown}
      data-testid={`dialog-resize-grabber-${dialogKey}`}
      aria-hidden
      tabIndex={-1}
      className="absolute right-1 bottom-1 z-10 flex size-4 cursor-nwse-resize items-end justify-end"
    >
      <svg viewBox="0 0 12 12" className="size-3 text-muted-foreground/70">
        <path d="M11 1L1 11M11 6L6 11M11 10l-1 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

interface DialogResize {
  /** Applied to `DialogPrimitive.Content`; `undefined` until a size is measured or restored. */
  style: React.CSSProperties | undefined;
  /** True mid-drag, so the wrapper can drop its width/height transition and track the pointer. */
  dragging: boolean;
  /** Renders as the last child of `DialogPrimitive.Content`, or `null` when not opted in. */
  grabber: React.ReactNode;
}

/** Opt-in corner-resize behavior for `DialogContent`. No-op when `dialogKey` is absent. */
export function useDialogResize(dialogKey: string | undefined): DialogResize {
  const [size, setSize] = React.useState<DialogSize | null>(null);
  const [dragging, setDragging] = React.useState(false);

  if (dialogKey === undefined) {
    return { style: undefined, dragging: false, grabber: null };
  }

  return {
    // maxWidth/maxHeight lifted whenever a size is applied (not only while
    // dragging) — every opt-in call site carries a CSS max-* tighter than the
    // clamp ceiling, and a CSS max-* beats an inline width/height.
    style: size ? { width: size.width, height: size.height, maxWidth: 'none', maxHeight: 'none' } : undefined,
    dragging,
    grabber: <DialogResizeGrabber dialogKey={dialogKey} onSizeChange={setSize} onDraggingChange={setDragging} />,
  };
}
