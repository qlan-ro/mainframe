/**
 * column-edges — where the window's columns start, measured from the DOM.
 *
 * The title bar is cut into segments whose separators sit exactly above the
 * column edges below it (W1). It has no layout relationship with those columns,
 * so each column reports its own left edge here and the title bar reads it;
 * nothing hard-codes an offset. Both columns draw their hairline on the pixel
 * just left of their edge, so a separator covers `[edge - 1, edge)`.
 *
 * `null` means "no such edge on screen": the sidebar's content pane has not
 * mounted, or the workspace is hidden, alone, or in the bottom strip.
 */
import { useCallback, type RefCallback } from 'react';
import { create } from 'zustand';

/** `content` is the pane right of the sidebar; `workspace` is the panel beside the chat. */
export type ColumnId = 'content' | 'workspace';

interface ColumnEdgesStore {
  content: number | null;
  workspace: number | null;
  report: (column: ColumnId, left: number | null) => void;
}

export const useColumnEdges = create<ColumnEdgesStore>()((set) => ({
  content: null,
  workspace: null,
  report: (column, left) => set((s) => (s[column] === left ? s : { ...s, [column]: left })),
}));

/**
 * Ref for a column: reports its left edge while mounted. A column's left edge
 * only moves when the column is resized too (the sidebar, the divider and the
 * window all reflow the row), so a ResizeObserver sees every move, including
 * each frame of the sidebar's collapse.
 */
export function useColumnEdge(column: ColumnId): RefCallback<HTMLElement> {
  return useCallback(
    (el: HTMLElement | null) => {
      if (el == null) return undefined;
      const { report } = useColumnEdges.getState();
      const measure = () => report(column, el.getBoundingClientRect().left);
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      measure();
      return () => {
        observer.disconnect();
        report(column, null);
      };
    },
    [column],
  );
}
