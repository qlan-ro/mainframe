import { useEffect, useReducer, useSyncExternalStore, type RefObject } from 'react';
import type { TurnDisclosure } from '../../view-model/compact/turn-types';
import { disclosureStore } from './disclosure-store';

export function collectBlockedTurnKeys(
  root: HTMLDivElement | null,
  turns: ReadonlyMap<string, TurnDisclosure>,
): ReadonlySet<string> {
  const blocked = new Set([...turns].filter(([, turn]) => disclosureStore.isOpen(turn.innerKeys)).map(([key]) => key));
  if (!root) return blocked;
  const selection = root.ownerDocument.getSelection();
  const ranges =
    selection && !selection.isCollapsed
      ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index))
      : [];
  const active = root.ownerDocument.activeElement;
  for (const element of root.querySelectorAll<HTMLElement>('[data-work-turn]'))
    if (element.contains(active) || ranges.some((range) => range.intersectsNode(element)))
      blocked.add(element.dataset.workTurn!);
  return blocked;
}
export function useTurnInteractionGuard(
  root: RefObject<HTMLDivElement | null>,
  turns: ReadonlyMap<string, TurnDisclosure>,
) {
  const [revision, refresh] = useReducer((n: number) => n + 1, 0);
  const expanded = useSyncExternalStore(
    disclosureStore.subscribe,
    () => JSON.stringify([...turns].filter(([, turn]) => disclosureStore.isOpen(turn.innerKeys)).map(([key]) => key)),
    () => '[]',
  );
  useEffect(() => {
    const doc = root.current?.ownerDocument;
    if (!doc) return;
    const events = ['selectionchange', 'focusin', 'focusout'];
    events.forEach((event) => doc.addEventListener(event, refresh));
    return () => events.forEach((event) => doc.removeEventListener(event, refresh));
  }, [root]);
  return { collectBlocked: () => collectBlockedTurnKeys(root.current, turns), revision, expanded };
}
