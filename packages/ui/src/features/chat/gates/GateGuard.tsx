'use client';

/**
 * Keeps one press from answering two requests (G5). Answering a gate brings up
 * the next under the same pointer, and that one may belong to another chat, so
 * a newly shown gate takes no input for a moment, and after that only input
 * that began on it: a pointer pressed, or a key pressed, over the previous gate
 * cannot finish on this one.
 *
 * `inert` is what keeps the pointer, the keyboard and focus out while it arms;
 * the capture handlers hold the same line for events that skip hit testing.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';

export const GATE_ARM_MS = 500;
/** The keys that press a button. */
const ACTIVATION_KEYS: readonly string[] = ['Enter', ' '];

interface SwallowableEvent {
  preventDefault: () => void;
  stopPropagation: () => void;
}

function swallow(event: SwallowableEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

/** Mount one per gate (keyed by its request): a remount arms afresh. */
export function GateGuard({ children }: { children: ReactNode }) {
  const [armed, setArmed] = useState(false);
  const pressedHere = useRef(false);
  const heldKeys = useRef(new Set<string>());

  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), GATE_ARM_MS);
    return () => clearTimeout(timer);
  }, []);

  // Every press of an activation key, anywhere, is held against this gate until
  // the key is released or goes down afresh on the gate itself (below). A held
  // key's auto-repeats are not presses.
  useEffect(() => {
    const held = heldKeys.current;
    const down = (event: globalThis.KeyboardEvent) => {
      if (ACTIVATION_KEYS.includes(event.key)) held.add(event.key);
    };
    const up = (event: globalThis.KeyboardEvent) => held.delete(event.key);
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

  const onPointerDownCapture = (event: SwallowableEvent) => {
    if (armed) pressedHere.current = true;
    else swallow(event);
  };
  // React events, so a dialog the gate opens counts as the gate.
  const onKeyDownCapture = (event: KeyboardEvent) => {
    if (armed && !event.repeat) heldKeys.current.delete(event.key);
    if (!armed || heldKeys.current.has(event.key)) swallow(event);
  };
  const onKeyUpCapture = (event: KeyboardEvent) => {
    // Space presses on release: only a Space that went down here may.
    if (!armed || heldKeys.current.has(event.key)) swallow(event);
  };
  const onClickCapture = (event: MouseEvent) => {
    // `detail` counts pointer clicks; 0 is a keyboard or assistive-technology activation.
    const fromPointer = event.detail > 0;
    if (!armed || (fromPointer && !pressedHere.current) || (!fromPointer && heldKeys.current.size > 0)) swallow(event);
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
