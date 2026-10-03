import { useEffect, useReducer, useSyncExternalStore, type RefObject } from 'react';
import type { TurnDisclosure } from '../../view-model/compact/turn-types';
import { disclosureStore } from './disclosure-store';

function selected(element: HTMLElement): boolean {
  const selection = element.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed) return false;
  for (let index = 0; index < selection.rangeCount; index++)
    if (selection.getRangeAt(index).intersectsNode(element)) return true;
  return false;
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
  const blocked = (turn: TurnDisclosure) => {
    if (disclosureStore.isOpen(turn.innerKeys)) return true;
    const elements = root.current?.querySelectorAll<HTMLElement>('[data-work-turn]') ?? [];
    return [...elements].some(
      (element) =>
        element.dataset.workTurn === turn.key &&
        (element.contains(element.ownerDocument.activeElement) || selected(element)),
    );
  };
  return { blocked, revision, expanded };
}
