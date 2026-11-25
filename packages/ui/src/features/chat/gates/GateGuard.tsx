'use client';

/**
 * Keeps one press from answering two requests (G5). Answering a gate brings up
 * the next under the same pointer, and that one may belong to another chat, so
 * a newly shown gate takes no input until nothing has been pressed for a
 * moment, and after that only input that began on it: a pointer pressed, or a
 * key pressed, over the previous gate cannot finish on this one.
 *
 * `inert` is what keeps the pointer, the keyboard and focus out while it arms;
 * the capture handlers hold the same line for events that skip hit testing.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';

export const GATE_ARM_MS = 500;
/** The keys that press a button. */
const ACTIVATION_KEYS: readonly string[] = ['Enter', ' '];
const isActivation = (key: string): boolean => ACTIVATION_KEYS.includes(key);

interface SwallowableEvent {
  preventDefault: () => void;
  stopPropagation: () => void;
}

function swallow(event: SwallowableEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

/** Where a held key types rather than presses: Enter in a one-line field submits. */
const isTyping = (target: EventTarget, key: string): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.matches('textarea') ||
    (key === ' ' && target.matches('input:not([type=checkbox], [type=radio])')));

/** True once nothing has been pressed anywhere for `GATE_ARM_MS`: a burst of clicks holds the gate off for its length. */
function useArmed(): boolean {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (armed) return;
    let timer = setTimeout(() => setArmed(true), GATE_ARM_MS);
    const startOver = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setArmed(true), GATE_ARM_MS);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (isActivation(event.key)) startOver();
    };
    window.addEventListener('pointerdown', startOver, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', startOver, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [armed]);
  return armed;
}

/**
 * The activation keys down anywhere since before they touched this gate. With
 * ⌘ down macOS never sends a key's keyup, so releasing ⌘ forgets them all. One
 * whose release was lost anyway blocks nothing: pressing it here starts afresh.
 */
function useHeldKeys() {
  const heldKeys = useRef(new Set<string>());
  useEffect(() => {
    const held = heldKeys.current;
    const down = (event: globalThis.KeyboardEvent) => {
      if (isActivation(event.key)) held.add(event.key);
    };
    const up = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Meta') held.clear();
      else held.delete(event.key);
    };
    const clear = () => held.clear();
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
    };
  }, []);
  return heldKeys;
}

/** Mount one per gate (keyed by its request): a remount arms afresh. */
export function GateGuard({ children }: { children: ReactNode }) {
  const armed = useArmed();
  const heldKeys = useHeldKeys();
  const pressedHere = useRef(false);
  /** A click that did not continue a double-click begun before this gate. */
  const clickedHere = useRef(false);
  /** The key whose event the browser is turning into a click, for this task only. */
  const activating = useRef<string | null>(null);

  const noteActivating = (key: string) => {
    if (!isActivation(key)) return;
    activating.current = key;
    setTimeout(() => (activating.current = null), 0);
  };

  const onPointerDownCapture = (event: SwallowableEvent) => {
    if (armed) pressedHere.current = true;
    else swallow(event);
  };
  // React events, so a dialog the gate opens counts as the gate.
  const onKeyDownCapture = (event: KeyboardEvent) => {
    noteActivating(event.key);
    if (!armed) return swallow(event);
    if (event.repeat) {
      // Holding a key never presses a button, whichever gate it went down on.
      const typing = isTyping(event.target, event.key) && !heldKeys.current.has(event.key);
      if (isActivation(event.key) && !typing) swallow(event);
      return;
    }
    heldKeys.current.delete(event.key);
  };
  const onKeyUpCapture = (event: KeyboardEvent) => {
    noteActivating(event.key);
    // Space presses on release: only a Space that went down here may.
    if (!armed || heldKeys.current.has(event.key)) swallow(event);
  };
  /** `detail` counts pointer clicks; 0 is a keyboard or assistive-technology activation. */
  const mayClick = (detail: number): boolean => {
    if (!armed) return false;
    if (detail === 0) return activating.current === null || !heldKeys.current.has(activating.current);
    if (!pressedHere.current) return false;
    if (detail === 1) clickedHere.current = true;
    return clickedHere.current;
  };
  const onClickCapture = (event: MouseEvent) => {
    if (!mayClick(event.detail)) swallow(event);
  };

  return (
    <div
      inert={!armed}
      data-testid="chat-gate-guard"
      data-armed={armed || undefined}
      onPointerDownCapture={onPointerDownCapture}
      onKeyDownCapture={onKeyDownCapture}
      onKeyUpCapture={onKeyUpCapture}
      onClickCapture={onClickCapture}
    >
      {children}
    </div>
  );
}
