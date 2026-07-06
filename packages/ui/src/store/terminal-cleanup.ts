/**
 * store/terminal-cleanup.ts
 *
 * Kill the PTYs and dispose the xterm cache entries for the given terminal ids.
 * The PTY kill rides on the cache disposer (create-terminal registered
 * `handle.kill()` as a disposer), so disposeCachedTerminal does both.
 *
 * This module imports ONLY the terminal-cache feature — never a store — so
 * layout.ts can import it without creating a layout ↔ subscriber import cycle.
 */
import { disposeCachedTerminal, getCachedTerminal } from '@/features/terminal/terminal-cache';

export function killAndDisposeCachedTerminals(ids: string[]): void {
  for (const id of ids) {
    if (getCachedTerminal(id)) disposeCachedTerminal(id);
  }
}
