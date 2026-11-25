/**
 * Which turns are open. A turn folds by itself once it has ended and nothing
 * holds it open: child work still going (T1e), a selection or focus inside it,
 * or a row the viewer opened. The viewer's own choice wins over all of that.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import { useUiPrefs } from '@/store/ui-prefs';
import type { Turn, TurnModel } from '../../view-model/turn/types';
import { disclosureStore } from './disclosure-store';
import { turnState, turnUnclear, type LiveChildren } from './live-children';
import { turnDisclosureStore } from './turn-disclosure-store';

/** Turns the viewer is inside of: a row they opened, a selection, or focus. */
function heldTurns(root: HTMLDivElement | null, turns: ReadonlyMap<string, Turn>): ReadonlySet<string> {
  const held = new Set([...turns].filter(([, turn]) => disclosureStore.isOpen(turn.workKeys)).map(([key]) => key));
  if (!root) return held;
  const selection = root.ownerDocument.getSelection();
  const ranges =
    selection && !selection.isCollapsed
      ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index))
      : [];
  const active = root.ownerDocument.activeElement;
  for (const element of root.querySelectorAll<HTMLElement>('[data-work-turn]'))
    if (element.contains(active) || ranges.some((range) => range.intersectsNode(element)))
      held.add(element.dataset.workTurn!);
  return held;
}

/** Re-renders on what `heldTurns` reads. */
function useHoldRevision(root: RefObject<HTMLDivElement | null>, turns: ReadonlyMap<string, Turn>): string {
  const [revision, refresh] = useReducer((n: number) => n + 1, 0);
  const expanded = useSyncExternalStore(
    disclosureStore.subscribe,
    () => JSON.stringify([...turns].filter(([, turn]) => disclosureStore.isOpen(turn.workKeys)).map(([key]) => key)),
    () => '[]',
  );
  useEffect(() => {
    const doc = root.current?.ownerDocument;
    if (!doc) return;
    const events = ['selectionchange', 'focusin', 'focusout'];
    events.forEach((event) => doc.addEventListener(event, refresh));
    return () => events.forEach((event) => doc.removeEventListener(event, refresh));
  }, [root]);
  return `${revision}:${expanded}`;
}

export function useTurnState(model: TurnModel, live: LiveChildren, root: RefObject<HTMLDivElement | null>) {
  'use no memo'; // `open` reads the mutable disclosure store; `revision` only marks that it changed
  const revision = useSyncExternalStore(turnDisclosureStore.subscribe, turnDisclosureStore.snapshot, () => 0);
  const keepOpen = useUiPrefs((state) => state.finishedWork === 'open');
  const holds = useHoldRevision(root, model.turns);
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const anchors = useRef(new Map<string, (automatic?: boolean) => void>());
  const register = useCallback((key: string, before: (automatic?: boolean) => void) => {
    anchors.current.set(key, before);
    return () => {
      anchors.current.delete(key);
    };
  }, []);

  useLayoutEffect(() => {
    const held = heldTurns(root.current, model.turns);
    const next = new Set(folded);
    for (const [key, turn] of model.turns) {
      const state = turnState(turn, live);
      const unsettled = ['needs-you', 'going'].includes(state) || (state === 'neutral' && turnUnclear(turn, live));
      const unknownAgent = live.unplacedAgents && !folded.has(key);
      const fold = !keepOpen && !unsettled && !unknownAgent && (folded.has(key) || !held.has(key));
      if (turnDisclosureStore.get(key) !== undefined || fold === next.has(key)) continue;
      anchors.current.get(key)?.(true);
      if (fold) next.add(key);
      else next.delete(key);
    }
    if (next.size !== folded.size || [...next].some((key) => !folded.has(key))) setFolded(next);
  }, [model, live, revision, holds, folded, keepOpen, root]);

  const open = (key: string) => {
    const choice = turnDisclosureStore.get(key);
    return choice ? choice === 'open' : !folded.has(key);
  };
  const set = (key: string, choice: 'open' | 'closed') => {
    anchors.current.get(key)?.();
    turnDisclosureStore.set(key, choice);
  };
  return {
    open,
    toggle: (key: string) => set(key, open(key) ? 'closed' : 'open'),
    reveal: (key: string) => {
      if (!open(key)) set(key, 'open');
    },
    register,
  };
}
