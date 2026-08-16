/**
 * features/terminal/terminal-focus.ts — a one-slot request that hands keyboard
 * focus to a terminal the user deliberately opened (⌘J, the add menu, a tab
 * click), so they can type straight away.
 *
 * It is a request rather than a `visible` side-effect on purpose: the workspace
 * remounts terminal tabs whenever the launch scope changes (session switch) or
 * the surface is revealed, and focusing on those would yank the caret out of the
 * composer. Only a deliberate open claims focus.
 */

let pending: string | null = null;
const listeners = new Set<() => void>();

/** Ask for `id` to take focus once it is mounted and visible. */
export function requestTerminalFocus(id: string): void {
  pending = id;
  for (const listener of listeners) listener();
}

/** Take the pending request for `id`, if it is the one outstanding. */
export function claimTerminalFocus(id: string): boolean {
  if (pending !== id) return false;
  pending = null;
  return true;
}

/** Drop a request `id` will never claim (its terminal was disposed). */
export function clearTerminalFocus(id: string): void {
  if (pending === id) pending = null;
}

/** Notified when a request arrives, so a mounted terminal can claim it. */
export function onTerminalFocusRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
