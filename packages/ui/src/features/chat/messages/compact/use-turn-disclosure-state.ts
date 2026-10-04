import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { TurnPresentation } from '../../view-model/compact/turn-types';
import { turnDisclosureStore } from './turn-disclosure-store';
import { useTurnInteractionGuard } from './use-turn-interaction-guard';

export function useTurnDisclosureState(
  model: TurnPresentation,
  root: RefObject<HTMLDivElement | null>,
  backgroundAgent: boolean,
) {
  const revision = useSyncExternalStore(turnDisclosureStore.subscribe, turnDisclosureStore.snapshot, () => 0);
  const guard = useTurnInteractionGuard(root, model.turns);
  const [automatic, setAutomatic] = useState<ReadonlySet<string>>(() => new Set());
  const anchors = useRef(new Map<string, () => void>());
  const register = useCallback((key: string, before: () => void) => {
    anchors.current.set(key, before);
    return () => {
      anchors.current.delete(key);
    };
  }, []);
  const open = (key: string) => {
    const turn = model.turns.get(key);
    if (!turn?.available || turn.unsafe || turnDisclosureStore.isInvalid(key)) return true;
    const choice = turnDisclosureStore.get(key);
    return choice ? choice === 'open' : !automatic.has(key);
  };
  useLayoutEffect(() => {
    const next = new Set(automatic);
    const blocked = guard.collectBlocked();
    for (const [key, turn] of model.turns) {
      if (turn.invalid) turnDisclosureStore.invalidate(key);
      const close =
        turn.available &&
        !turn.unsafe &&
        !turnDisclosureStore.isInvalid(key) &&
        (!backgroundAgent || automatic.has(key)) &&
        !turn.activeAgent &&
        !blocked.has(key);
      if (turnDisclosureStore.get(key) !== undefined || close === next.has(key)) continue;
      anchors.current.get(key)?.();
      if (close) next.add(key);
      else next.delete(key);
    }
    if (next.size !== automatic.size || [...next].some((key) => !automatic.has(key))) setAutomatic(next);
  }, [model, revision, backgroundAgent, guard.revision, guard.expanded, automatic]);
  const toggle = (key: string) => {
    anchors.current.get(key)?.();
    turnDisclosureStore.set(key, open(key) ? 'closed' : 'open');
  };
  return { open, toggle, register };
}
