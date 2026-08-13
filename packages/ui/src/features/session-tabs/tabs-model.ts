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

/** The transient boot draft carries no `custom`; a session the list returned always does. */
function isSessionEntry(entry: ThreadListEntry): boolean {
  return entry.custom != null;
}

/**
 * Whether the thread list is trustworthy enough to restore the persisted tabs
 * against. All three conjuncts are load-bearing:
 *
 * - `listLoaded` — only `adapter.list()` returning proves the list is the real
 *   one. `isLoading` goes false on the FAILURE path too, and both `initialize()`
 *   (first send) and `fetch()` (a deep-link `switchToThread`) inject entries —
 *   the latter with `custom` — into a list that never loaded. Restoring there
 *   drops every persisted tab and the persist effect makes the loss permanent.
 * - `!isListLoading` — a reload in flight is not a list to restore against.
 * - at least one real session — the runtime seeds `threadItems` with the
 *   new-thread draft, so a non-empty list is not a loaded one, and a list that
 *   settles empty is "nothing restored yet", not "the user has no tabs".
 */
export function canRestoreTabs(
  items: readonly ThreadListEntry[],
  isListLoading: boolean,
  listLoaded: boolean,
): boolean {
  return listLoaded && !isListLoading && items.some(isSessionEntry);
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
function validTabIds(items: readonly ThreadListEntry[], activeId: string | null): Set<string> {
  const valid = new Set(items.filter((t) => t.status === 'regular').map((t) => t.id));
  if (activeId !== null) valid.add(activeId);
  return valid;
}

/**
 * A session's ONE tab id. aui keeps both of a session's identities in its
 * thread map for the run — the first send stamps `remoteId` onto the local
 * entry (`RemoteThreadListThreadListRuntimeCore.initialize`) and the
 * `chat.created` reload adds a second, remote-keyed entry (`classifyThreads`),
 * with nothing deleting the first. `switchToThread` resolves either id, so the
 * remote-keyed one is the safe canonical form.
 *
 * Only collapse once that remote-keyed entry exists: until it lands (and
 * forever, after a failed list load) the local entry is the session's only
 * entry, and a tab pointing at an id with no entry would show "New Session"
 * and no project colour. Lookups are by exact id — matching `remoteId` too
 * would collapse a session onto itself before its canonical entry arrives.
 */
export function canonicalTabId(id: string, items: readonly ThreadListEntry[]): string {
  const remoteId = items.find((t) => t.id === id)?.remoteId;
  if (remoteId == null || remoteId === id) return id;
  return items.some((t) => t.id === remoteId) ? remoteId : id;
}

/**
 * The open set, expressed in canonical ids with the dead tabs dropped.
 *
 * First-wins dedupe is what makes the local→remote handoff an in-place swap:
 * the membership seam appends the canonical id at the end, so the set reads
 * `[…, '__LOCALID_x', 'chat-x']`, and keeping the first occurrence merges the
 * appended tab into the slot the draft tab already held instead of moving the
 * session to the end of the strip.
 */
export function reconcileTabIds(
  tabIds: readonly string[],
  items: readonly ThreadListEntry[],
  activeId: string | null,
): string[] {
  const valid = validTabIds(items, activeId === null ? null : canonicalTabId(activeId, items));
  const next: string[] = [];
  for (const id of tabIds) {
    const canonical = canonicalTabId(id, items);
    if (valid.has(canonical) && !next.includes(canonical)) next.push(canonical);
  }
  return next;
}

/** The preview slot's reconcile: same canonicalisation and validity as a pinned
 *  tab, collapsed to a single nullable id. */
export function reconcilePreviewId(
  previewId: string | null,
  items: readonly ThreadListEntry[],
  activeId: string | null,
): string | null {
  if (previewId === null) return null;
  const valid = validTabIds(items, activeId === null ? null : canonicalTabId(activeId, items));
  const canonical = canonicalTabId(previewId, items);
  return valid.has(canonical) ? canonical : null;
}

/** Whether an activated thread is an UNSENT draft, which opens in the protected
 *  draft slot rather than as a peek at history. Judged by the ENTRY's status,
 *  not the id shape — a session created this run keeps its `__LOCALID_*` id for
 *  life, and re-opening it later previews like any other session. A local id
 *  with no entry yet is a brand-new draft. */
export function isDraftThread(id: string, items: readonly ThreadListEntry[]): boolean {
  const entry = items.find((t) => t.id === id);
  return entry == null ? isLocalId(id) : entry.status === 'new';
}

/** Which slot an activation opens into. */
export type TabSlot = 'pinned' | 'preview' | 'draft';

/** The three slots the strip is made of, in display order. */
export interface TabsState {
  tabIds: readonly string[];
  previewId: string | null;
  draftId: string | null;
}

/**
 * The whole open set's reconcile, in one pass — the per-slot rules plus the two
 * transitions that move an id BETWEEN slots and so cannot live in either:
 *
 * - the first send demotes the draft into the preview slot: it stops being the
 *   protected tab and becomes the temporary one, replacing whatever was peeked at;
 * - a preview (demoted or not) that resolves onto a pinned session dissolves
 *   into that pin, so the strip never shows one session twice.
 */
export function reconcileTabs(state: TabsState, items: readonly ThreadListEntry[], activeId: string | null): TabsState {
  const sent = state.draftId !== null && !isDraftThread(state.draftId, items);
  const draftId = sent ? null : reconcileDraftId(state.draftId, items);
  const tabIds = reconcileTabIds(state.tabIds, items, activeId);
  const preview = reconcilePreviewId(sent ? state.draftId : state.previewId, items, activeId);
  return { tabIds, previewId: preview !== null && tabIds.includes(preview) ? null : preview, draftId };
}

/** The draft slot's own rule: it survives going inactive (that is the point of
 *  the slot) and only leaves when it stops being a draft — sent, or gone. */
function reconcileDraftId(draftId: string | null, items: readonly ThreadListEntry[]): string | null {
  if (draftId === null) return null;
  return isDraftThread(draftId, items) ? draftId : null;
}
