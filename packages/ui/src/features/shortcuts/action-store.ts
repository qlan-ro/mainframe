/**
 * Shortcut id → handler. The registry holds pure data (D4); the behavior is
 * registered here by whichever scope owns it, so a chord whose owner is not
 * mounted stays inert — that is what keeps the chat-scoped chords (find,
 * splits, focus-composer, surface toggles) working exactly as they do today.
 *
 * Registrations are a STACK per id, not a single slot: while the surface is
 * split two ChatThreads mount and both claim `chat.find`, so a cleanup that
 * cleared the id outright would kill the chord for the surviving thread. The
 * newest owner answers; unmounting removes only its own entry.
 */
import { useEffect, useRef } from 'react';
import type { ShortcutAction } from './shortcut-types';
import type { ShortcutId } from './registry';

type ActionRef = { current: ShortcutAction };

const registrations = new Map<string, ActionRef[]>();

/** The handler the dispatcher should call, or null when the id is unbound. */
export function shortcutAction(id: string): ShortcutAction | null {
  const stack = registrations.get(id);
  if (stack == null || stack.length === 0) return null;
  return stack[stack.length - 1]!.current;
}

/**
 * `id` is a `ShortcutId`, so a typo or a renamed registry entry is a compile
 * error rather than a permanently dead chord. The callback lives in a ref, so
 * a re-render swaps the behavior without re-registering.
 */
export function useShortcutAction(id: ShortcutId, fn: ShortcutAction): void {
  const ref = useRef(fn);
  ref.current = fn;

  useEffect(() => {
    const stack = registrations.get(id) ?? [];
    stack.push(ref);
    registrations.set(id, stack);
    return () => {
      const current = registrations.get(id);
      if (current == null) return;
      const at = current.lastIndexOf(ref);
      if (at !== -1) current.splice(at, 1);
      if (current.length === 0) registrations.delete(id);
    };
  }, [id]);
}
