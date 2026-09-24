import { useEffect, useState, type RefObject } from 'react';

/**
 * Reports whether the current DOM selection's anchor lies inside `scopeRef`'s
 * element. Split view mounts one `ChatThread` (and one `ChatSelectionToolbar`)
 * per zone, both portalled to the same fixed position by
 * `SelectionToolbarPrimitive.Root` — without this, a selection in either zone
 * shows both toolbars stacked, and the top one (belonging to whichever zone,
 * not necessarily the one holding the selection) eats the click (#359).
 *
 * `scopeRef` omitted means there is exactly one toolbar in view (no split, no
 * contention) — always in scope.
 *
 * Listens the same events `SelectionToolbarPrimitive.Root` does — mouseup/keyup
 * via rAF, plus `selectionchange` on collapse — so both agree on the same tick.
 */
export function useSelectionInScope(scopeRef?: RefObject<HTMLElement | null>): boolean {
  const [inScope, setInScope] = useState(scopeRef == null);

  useEffect(() => {
    if (scopeRef == null) {
      setInScope(true);
      return;
    }

    const check = () => {
      const selection = window.getSelection();
      const anchorNode = selection?.anchorNode ?? null;
      const scope = scopeRef.current;
      setInScope(anchorNode != null && scope != null && scope.contains(anchorNode));
    };

    let frame = 0;
    const scheduleCheck = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(check);
    };
    const onSelectionChange = () => {
      // Only a collapse (click, Escape) is observable this way without also
      // firing mid-drag on every extend — mouseup/keyup already cover the
      // completed-selection case.
      if (window.getSelection()?.isCollapsed) check();
    };

    document.addEventListener('mouseup', scheduleCheck);
    document.addEventListener('keyup', scheduleCheck);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('mouseup', scheduleCheck);
      document.removeEventListener('keyup', scheduleCheck);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [scopeRef]);

  return inScope;
}
