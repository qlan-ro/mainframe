/**
 * useSessionTabsSync — the tab strip's ONE membership seam.
 *
 * Inserting a tab for whatever thread becomes active covers every activation
 * path at once — sidebar click, palette, toast deep-link, boot auto-select,
 * archived-active fallback — without touching any of those call sites.
 *
 * Also owns persistence: restore once the thread list has SETTLED carrying at
 * least one real session (merging with tabs the boot already opened), prune
 * tabs whose thread vanished, and write the boot-stable id set back on every
 * change. A list that is still loading, holds only the transient boot draft, or
 * failed to load leaves `hydrated` false: the persisted payload survives
 * untouched and a later, real list still restores it.
 */
import { useEffect, useRef } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useSessionTabsStore } from './store';
import { SESSION_TABS_STORAGE_KEY, canRestoreTabs, persistTabIds, restoreTabIds, validTabIds } from './tabs-model';

function readPersisted(): string[] {
  try {
    const raw = localStorage.getItem(SESSION_TABS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const ids = (parsed as { ids?: unknown }).ids;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    /* expected — corrupt storage reads as no persisted tabs */
    return [];
  }
}

export function useSessionTabsSync(): void {
  const items = useAuiState((s) => s.threads.threadItems);
  const isListLoading = useAuiState((s) => s.threads.isLoading);
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const hydrated = useSessionTabsStore((s) => s.hydrated);
  const tabIds = useSessionTabsStore((s) => s.tabIds);
  const hydrate = useSessionTabsStore((s) => s.hydrate);
  const ensureTab = useSessionTabsStore((s) => s.ensureTab);
  const pruneTo = useSessionTabsStore((s) => s.pruneTo);

  useEffect(() => {
    if (hydrated || !canRestoreTabs(items, isListLoading)) return;
    hydrate(restoreTabIds(readPersisted(), items));
  }, [hydrated, items, isListLoading, hydrate]);

  useEffect(() => {
    if (mainThreadId) ensureTab(mainThreadId);
  }, [mainThreadId, ensureTab]);

  useEffect(() => {
    if (!hydrated) return;
    pruneTo(validTabIds(items, mainThreadId));
  }, [hydrated, items, mainThreadId, pruneTo]);

  // `items` changes identity on every stream tick (title/status updates), so
  // this effect runs hot while a chat is running — skip the write unless the
  // MAPPED id set actually changed.
  const lastWrittenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    const ids = persistTabIds(tabIds, items);
    const key = ids.join('\0');
    if (key === lastWrittenRef.current) return;
    try {
      localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 1, ids }));
      lastWrittenRef.current = key;
    } catch {
      /* expected — storage may be unavailable; tabs simply don't survive the boot */
    }
  }, [hydrated, tabIds, items]);
}
