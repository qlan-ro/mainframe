/**
 * use-row-focus — keeps the keyboard in the section when the row it was in
 * moves or goes away: work that ends moves to Earlier and takes its Stop along.
 */
import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

const rowButtons = (section: HTMLElement) => [...section.querySelectorAll<HTMLElement>('[data-activity-row]')];
const rowButton = (section: HTMLElement, id: string) =>
  rowButtons(section).find((button) => button.dataset.activityRow === id);

/** The rows after this one, then those before it, the nearest first. */
function neighbours(section: HTMLElement, id: string): string[] {
  const ids = rowButtons(section).map((button) => button.dataset.activityRow ?? '');
  const at = ids.indexOf(id);
  return [...ids.slice(at + 1), ...ids.slice(0, Math.max(0, at)).reverse()];
}

interface LostFocus {
  chatId: string;
  id: string;
  neighbours: string[];
}

export function useRowFocus(
  sectionRef: RefObject<HTMLElement | null>,
  chatId: string,
  earlierRows: readonly { id: string }[],
) {
  const lost = useRef<LostFocus>(undefined);

  const focusRow = (id: string, nearby: readonly string[] = []) => {
    const section = sectionRef.current;
    if (!section) return;
    const earlier = section.querySelector<HTMLElement>('[data-activity-earlier]');
    const target =
      rowButton(section, id) ??
      (earlierRows.some((row) => row.id === id) ? earlier : undefined) ??
      nearby.map((other) => rowButton(section, other)).find(Boolean) ??
      earlier ??
      section;
    if (target === section) section.tabIndex = -1;
    target.focus();
  };

  // Runs in the commit that moved the row, once it stands where it went.
  useLayoutEffect(() => {
    const from = lost.current;
    lost.current = undefined;
    if (from?.chatId === chatId && document.activeElement === document.body) focusRow(from.id, from.neighbours);
  });

  const onFocusLost = (id: string) => {
    const section = sectionRef.current;
    if (section) lost.current = { chatId, id, neighbours: neighbours(section, id) };
  };

  return { focusRow, onFocusLost };
}

/** Reports the focus an element takes along when it is removed; nothing when it isn't in it. */
export function useFocusLoss(ref: RefObject<HTMLElement | null>, onLost: (() => void) | undefined) {
  const report = useRef(onLost);
  useLayoutEffect(() => {
    report.current = onLost;
  });
  useLayoutEffect(() => {
    const element = ref.current;
    // Before the element leaves the document, while the focus is still in it.
    return () => {
      if (element?.contains(document.activeElement)) report.current?.();
    };
  }, [ref]);
}

/** Returns focus to `ref` once the commit that removed a focused control is done. */
export function useFocusReturn(ref: RefObject<HTMLElement | null>): () => void {
  const lost = useRef(false);
  useLayoutEffect(() => {
    if (lost.current && document.activeElement === document.body) ref.current?.focus();
    lost.current = false;
  });
  return useCallback(() => {
    lost.current = true;
  }, []);
}
