/**
 * tabs-model — pure logic for the session tab strip (no store, no aui imports).
 *
 * Runtime tab ids are aui thread-list item ids. A thread created this app-run
 * keeps its `__LOCALID_*` id for life (no id-flip; the remoteId is stamped on
 * the same entry), so runtime ids are NOT stable across boots. Persistence
 * therefore stores `remoteId ?? id` and restore maps those back to the current
 * boot's runtime ids by matching either field.
 */
import type { ThreadListEntry } from '@/features/sessions/view-model/chat-to-thread-custom';

export const SESSION_TABS_STORAGE_KEY = 'mf:session-tabs';

function isLocalId(id: string): boolean {
  return id.startsWith('__LOCALID_');
}

function findEntry(items: readonly ThreadListEntry[], id: string): ThreadListEntry | undefined {
  return items.find((t) => t.id === id || t.remoteId === id);
}

/** `custom` is written only by the adapter's `list()` projection, so it is the one proof a load actually succeeded. */
function isSessionEntry(entry: ThreadListEntry): boolean {
  return entry.custom != null;
}

/**
 * Whether the thread list is trustworthy enough to restore the persisted tabs
 * against. Both halves are load-bearing: the runtime seeds `threadItems` with
 * the new-thread draft before `list()` resolves, so a non-empty list is not a
 * loaded one; and `isLoading` also goes false when the load FAILS, where
 * restoring would commit an empty set over a live payload. A remoteId alone
 * does NOT qualify: `initialize()` stamps one on the draft after a failed load
 * too, and hydrating there would drop every persisted tab.
 */
export function canRestoreTabs(items: readonly ThreadListEntry[], isListLoading: boolean): boolean {
  return !isListLoading && items.some(isSessionEntry);
}

/** Persisted ids → this boot's runtime ids. Unknown and archived ids drop out. */
export function restoreTabIds(persisted: readonly string[], items: readonly ThreadListEntry[]): string[] {
  const ids: string[] = [];
  for (const pid of persisted) {
    const entry = findEntry(items, pid);
    if (entry && entry.status === 'regular' && !ids.includes(entry.id)) ids.push(entry.id);
  }
  return ids;
}

/**
 * Runtime ids → boot-stable ids for storage. An unsent draft (`__LOCALID_*`
 * with no remoteId yet) means nothing next boot and is dropped.
 */
export function persistTabIds(tabIds: readonly string[], items: readonly ThreadListEntry[]): string[] {
  const ids: string[] = [];
  for (const id of tabIds) {
    const entry = findEntry(items, id);
    const stable = entry?.remoteId ?? (isLocalId(id) ? null : id);
    if (stable && !ids.includes(stable)) ids.push(stable);
  }
  return ids;
}

/**
 * Which tab to activate after closing `closedId`. Closing an inactive tab keeps
 * the current active; closing the active tab prefers the right neighbor, then
 * the left; closing the last tab returns null (caller starts the new-session flow).
 */
export function nextActiveAfterClose(
  tabIds: readonly string[],
  closedId: string,
  activeId: string | null,
): string | null {
  if (activeId !== null && closedId !== activeId) return activeId;
  const index = tabIds.indexOf(closedId);
  const remaining = tabIds.filter((id) => id !== closedId);
  if (remaining.length === 0) return null;
  return remaining[Math.min(index, remaining.length - 1)] ?? null;
}

/**
 * Ids the strip may keep: regular list entries plus the active thread (covers
 * the unsent draft WHILE active). An inactive draft drops out on purpose: aui
 * reuses one `__LOCALID_*` slot, so the "+" button reaches the same draft
 * again — a lingering "New Session" tab would be dead weight (and the boot
 * draft would otherwise survive every boot's auto-select redirect).
 */
export function validTabIds(items: readonly ThreadListEntry[], activeId: string | null): Set<string> {
  const valid = new Set(items.filter((t) => t.status === 'regular').map((t) => t.id));
  if (activeId !== null) valid.add(activeId);
  return valid;
}
