/**
 * Lets a text selection START on a markdown link (#396). WebKit — the Tauri
 * shell's engine — never begins a selection on a mousedown over an `a[href]`
 * (`HTMLAnchorElement::canStartSelection` is false for a non-editable link),
 * and Chromium starts a link drag instead, so a drag that began on a URL or
 * file reference selected nothing. For the duration of that one drag this
 * drives the selection from script (caret under the pointer at mousedown →
 * caret under the pointer now), and reports the drag so the link's own click
 * handler can skip opening it. Callers pair it with `draggable={false}`.
 */
import { useCallback, useRef, type MouseEvent } from 'react';

/** Pointer travel below this is still a click, not a selection drag. */
const DRAG_THRESHOLD_PX = 4;

export interface LinkDragSelect {
  onMouseDown: (e: MouseEvent<HTMLAnchorElement>) => void;
  /** True if the click being handled ends a selection drag — the caller then must not open the link. */
  endedDrag: () => boolean;
}

export function useLinkDragSelect(): LinkDragSelect {
  const draggedRef = useRef(false);

  const onMouseDown = useCallback((e: MouseEvent<HTMLAnchorElement>) => {
    draggedRef.current = false;
    // Modified clicks keep their native meaning (Option-drag already selects in WebKit).
    if (e.button !== 0 || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const doc = e.currentTarget.ownerDocument;
    // Not every engine has it (Firefox); there the native behavior stands.
    const start = doc.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (!start) return;
    const { clientX: x0, clientY: y0 } = e;

    const onMove = (move: globalThis.MouseEvent) => {
      if (!draggedRef.current && Math.hypot(move.clientX - x0, move.clientY - y0) < DRAG_THRESHOLD_PX) return;
      draggedRef.current = true;
      const end = doc.caretRangeFromPoint(move.clientX, move.clientY);
      if (!end) return;
      doc
        .getSelection()
        ?.setBaseAndExtent(start.startContainer, start.startOffset, end.startContainer, end.startOffset);
    };
    const onUp = () => {
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', onUp, true);
      // The click (if any) dispatches right after this mouseup; clear the
      // flag only once it has had its chance to read it, so a later keyboard
      // activation of the link still opens it.
      setTimeout(() => {
        draggedRef.current = false;
      }, 0);
    };
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp, true);
  }, []);

  const endedDrag = useCallback(() => draggedRef.current, []);

  return { onMouseDown, endedDrag };
}
