/**
 * Which turns are open. A turn folds by itself once it has ended and nothing
 * holds it open: child work still going (T1e), a selection or focus inside it,
 * a row the viewer opened, or (on the plain list) a reader who is reading above
 * the tail: a turn that folds under them takes away what they read and moves
 * them (#521), so it folds when they come back to the tail. The viewer's own
 * choice wins over all of that.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import { useUiPrefs } from '@/store/ui-prefs';
import { useTranscriptScroll } from '../../thread/transcript-scroll-context';
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
  const focusedInside = root.contains(active);
  const selectedInside = ranges.filter((range) => range.intersectsNode(root));
  if (!focusedInside && selectedInside.length === 0) return held;
  for (const element of root.querySelectorAll<HTMLElement>('[data-work-turn]'))
    if ((focusedInside && element.contains(active)) || selectedInside.some((range) => range.intersectsNode(element)))
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

const noSubscription = () => () => undefined;

/** The plain list's reader is above the tail. Always false on the virtualized list, which has no such owner. */
function useReaderAway(): boolean {
  const pinned = useTranscriptScroll()?.pinned;
  return useSyncExternalStore(pinned?.subscribe ?? noSubscription, () => (pinned ? !pinned.get() : false));
}

function canFold(turn: Turn, live: LiveChildren): boolean {
  const state = turnState(turn, live);
  return state !== 'needs-you' && state !== 'going' && (state !== 'neutral' || !turnUnclear(turn, live));
}

/** A turn that arrives already over (on open, in an older page, in a jump window) folds before it is first drawn. */
function foldsAtOnce(key: string, turn: Turn, live: LiveChildren, keepOpen: boolean): boolean {
  return (
    !keepOpen &&
    !live.unplacedAgents &&
    turnDisclosureStore.get(key) === undefined &&
    canFold(turn, live) &&
    !disclosureStore.isOpen(turn.workKeys)
  );
}

/**
 * Turns this hook has not seen before that fold at once. Folded in the render that first draws them, not by the
 * layout effect after it: an older page of ten finished turns otherwise commits every step of every turn and then
 * folds it again, in one long frame (#517).
 */
function freshFolds(
  turns: ReadonlyMap<string, Turn>,
  known: ReadonlySet<string>,
  folded: ReadonlySet<string>,
  live: LiveChildren,
  keepOpen: boolean,
): ReadonlySet<string> {
  const fresh = new Set<string>();
  for (const [key, turn] of turns)
    if (!known.has(key) && !folded.has(key) && foldsAtOnce(key, turn, live, keepOpen)) fresh.add(key);
  return fresh;
}

export function useTurnState(model: TurnModel, live: LiveChildren, root: RefObject<HTMLDivElement | null>) {
  'use no memo'; // `open` reads the mutable disclosure store and the known turns; `revision` only marks a change
  const revision = useSyncExternalStore(turnDisclosureStore.subscribe, turnDisclosureStore.snapshot, () => 0);
  const keepOpen = useUiPrefs((state) => state.finishedWork === 'open');
  const holds = useHoldRevision(root, model.turns);
  const readerAway = useReaderAway();
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  /** The turns a committed render drew: only one of those can fold under the reader's eyes. */
  const [known, setKnown] = useState<ReadonlySet<string>>(() => new Set());
  // `revision` and `holds` mark changes of the disclosure stores that `freshFolds` reads.
  const fresh = useMemo(
    () => freshFolds(model.turns, known, folded, live, keepOpen),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model.turns, known, folded, live, keepOpen, revision, holds],
  );
  const anchors = useRef(new Map<string, (automatic?: boolean) => void>());
  const register = useCallback((key: string, before: (automatic?: boolean) => void) => {
    anchors.current.set(key, before);
    return () => {
      anchors.current.delete(key);
    };
  }, []);

  useLayoutEffect(() => {
    const held = heldTurns(root.current, model.turns);
    const next = new Set([...folded, ...fresh]);
    for (const [key, turn] of model.turns) {
      const shut = next.has(key);
      const unknownAgent = live.unplacedAgents && !shut;
      const fold = !keepOpen && canFold(turn, live) && !unknownAgent && (shut || (!held.has(key) && !readerAway));
      if (turnDisclosureStore.get(key) !== undefined || fold === shut) continue;
      anchors.current.get(key)?.(true);
      if (fold) next.add(key);
      else next.delete(key);
    }
    if (model.turns.size !== known.size || [...model.turns.keys()].some((key) => !known.has(key)))
      setKnown(new Set(model.turns.keys()));
    if (next.size !== folded.size || [...next].some((key) => !folded.has(key))) setFolded(next);
  }, [model, live, revision, holds, folded, fresh, known, keepOpen, root, readerAway]);

  const open = (key: string) => {
    const choice = turnDisclosureStore.get(key);
    return choice ? choice === 'open' : !folded.has(key) && !fresh.has(key);
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
