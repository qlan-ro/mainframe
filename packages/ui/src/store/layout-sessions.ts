/**
 * store/layout-sessions.ts — per-session map operations for the layout store:
 * dropping a session's remembered workspace (kill-before-remove) and adopting
 * one entry onto a different key (the draft → real-chat handoff, todo #354).
 * Kept separate from layout.ts so the store's actions stay thin wiring.
 */
import type { SessionWorkspace } from './layout';
import { tabIdsInRun } from './run-pane';
import { killAndDisposeCachedTerminals } from './terminal-cleanup';
import { releaseUrlTunnels } from './url-tunnel-cleanup';

/** Remove `sessionId`'s entry, disposing its terminals/URL tabs; identity-stable when absent. */
export function dropSessionEntry(
  sessions: Map<string, SessionWorkspace>,
  sessionId: string,
): Map<string, SessionWorkspace> {
  const entry = sessions.get(sessionId);
  if (!entry) return sessions;
  killAndDisposeCachedTerminals(tabIdsInRun(entry.run, 'terminal'));
  releaseUrlTunnels(tabIdsInRun(entry.run, 'url'));
  const next = new Map(sessions);
  next.delete(sessionId);
  return next;
}

/**
 * Move `fromId`'s entry onto `toId` (overwriting any existing `toId` entry —
 * the source, what's on screen, wins) and drop `fromId`. A strict no-op when
 * `fromId` has no entry: `toId` is neither written nor clobbered, which also
 * makes a re-entrant call (source already adopted away) a no-op.
 */
export function adoptSessionEntry(
  sessions: Map<string, SessionWorkspace>,
  fromId: string,
  toId: string,
): Map<string, SessionWorkspace> {
  const entry = sessions.get(fromId);
  if (!entry) return sessions;
  const next = new Map(sessions);
  next.delete(fromId);
  next.set(toId, entry);
  return next;
}
