/**
 * useSessionTabsSync — the tab strip's ONE membership seam.
 *
 * Inserting a tab for whatever thread becomes active covers every activation
 * path at once — sidebar click, palette, toast deep-link, boot auto-select,
 * archived-active fallback — without touching any of those call sites. An
 * activation lands in the PREVIEW slot (editor-style: the next one replaces
 * it); an unsent draft lands in the protected DRAFT slot instead, and stays
 * there until its first send demotes it to preview (`reconcileTabs`).
 *
 * Also owns reconciliation and persistence: restore once a real `list()` has
 * SETTLED carrying at least one session (merging with tabs the boot already
 * opened), reconcile the open set on every thread-list change, and write the
 * boot-stable id set back. A list that is still loading, holds only the
 * transient boot draft, or failed to load leaves `hydrated` false: the
 * persisted payload survives untouched and a later, real list still restores it.
 *
 * Reconciling both prunes vanished threads AND collapses identities: a
 * session's pre-send and post-create ids are ONE member, merged onto the
 * remote-keyed entry in the slot the draft tab already held. It runs before
 * hydration on purpose — pre-hydration the set holds only ids the seam added
 * for an active thread, all valid by construction, and a ghost must not
 * outlive a list load that failed.
 */
import { useEffect, useRef } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useThreadItems } from '@/features/sessions/runtime/use-thread-items';
import { migrateSplitPair } from '@/features/workspace-chat/migrate-split';
import { useSessionListLoadState } from '../sessions/runtime/list-load-state';
import { useSessionTabsStore } from './store';
import {
  SESSION_TABS_STORAGE_KEY,
  canRestoreTabs,
  isDraftThread,
  persistTabIds,
  reconcileTabs,
  restoreTabIds,
} from './tabs-model';

interface PersistedTabs {
  ids: string[];
  preview: string | null;
  /** v3 only: the open split's pair, which v4 has no split to show (`migrateSplitPair`). */
  zones: string[];
}

const NOTHING_PERSISTED: PersistedTabs = { ids: [], preview: null, zones: [] };

function readPersisted(): PersistedTabs {
  try {
    const raw = localStorage.getItem(SESSION_TABS_STORAGE_KEY);
    if (!raw) return NOTHING_PERSISTED;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return NOTHING_PERSISTED;
    const { ids, preview, zones } = parsed as { ids?: unknown; preview?: unknown; zones?: unknown };
    return {
      ids: Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [],
      // v1 payloads carry no preview — every restored tab was pinned.
      preview: typeof preview === 'string' ? preview : null,
      zones: Array.isArray(zones) ? zones.filter((id): id is string => typeof id === 'string') : [],
    };
  } catch {
    /* expected — corrupt storage reads as no persisted tabs */
    return NOTHING_PERSISTED;
  }
}

export function useSessionTabsSync(): void {
  const items = useThreadItems();
  const isListLoading = useAuiState((s) => s.threads.isLoading);
  const listLoaded = useSessionListLoadState((s) => s.loaded);
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const hydrated = useSessionTabsStore((s) => s.hydrated);
  const tabIds = useSessionTabsStore((s) => s.tabIds);
  const previewId = useSessionTabsStore((s) => s.previewId);
  const hydrate = useSessionTabsStore((s) => s.hydrate);
  const ensureTab = useSessionTabsStore((s) => s.ensureTab);
  const closeTab = useSessionTabsStore((s) => s.closeTab);
  const pinTab = useSessionTabsStore((s) => s.pinTab);
  const reconcile = useSessionTabsStore((s) => s.reconcile);

  useEffect(() => {
    if (hydrated || !canRestoreTabs(items, isListLoading, listLoaded)) return;
    const persisted = readPersisted();
    // A live peek outranks the persisted one — but the boot draft is not a
    // peek. It holds the slot only because nothing real is on screen yet, and
    // auto-select is about to replace it, so it must not cost the user the
    // preview they left behind.
    const live = useSessionTabsStore.getState().previewId;
    if (live !== null && isDraftThread(live, items)) closeTab(live);
    hydrate(
      restoreTabIds(persisted.ids, items),
      persisted.preview === null ? null : (restoreTabIds([persisted.preview], items)[0] ?? null),
    );
    // A pair from before W9 opens as workspace tabs. Its members were pinned
    // tabs by rule, so both are here even if one's own tab was not persisted.
    const [left, right] = restoreTabIds(persisted.zones, items);
    if (left != null && right != null) {
      for (const id of [left, right]) {
        ensureTab(id, 'pinned');
        pinTab(id); // ensureTab won't promote a tab that is already open
      }
      migrateSplitPair([left, right], items);
    }
  }, [hydrated, items, isListLoading, listLoaded, hydrate, closeTab, ensureTab, pinTab]);

  useEffect(() => {
    if (!mainThreadId) return;
    // The runtime's transient boot draft and the user's "+" draft are the same
    // state; only WHEN they are activated tells them apart. A draft active
    // before `list()` ever returned is the boot one — it peeks, so auto-select
    // replaces it instead of leaving a "New Session" tab behind.
    const protect = isDraftThread(mainThreadId, items) && listLoaded;
    ensureTab(mainThreadId, protect ? 'draft' : 'preview');
    // `items` and `listLoaded` are deliberately not deps: membership reacts to
    // ACTIVATION and reads both as of that moment, and re-running on list ticks
    // would re-preview a session the user just closed.
  }, [mainThreadId, ensureTab]);

  useEffect(() => {
    reconcile((state) => reconcileTabs(state, items, mainThreadId));
  }, [items, mainThreadId, reconcile]);

  // `items` changes identity on every stream tick (title/status updates), so
  // this effect runs hot while a chat is running — skip the write unless the
  // MAPPED id set actually changed.
  const lastWrittenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    const ids = persistTabIds(tabIds, items);
    const preview = previewId === null ? null : (persistTabIds([previewId], items)[0] ?? null);
    const key = `${ids.join('\0')}\0\0${preview ?? ''}`;
    if (key === lastWrittenRef.current) return;
    try {
      localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 4, ids, preview }));
      lastWrittenRef.current = key;
    } catch {
      /* expected — storage may be unavailable; tabs simply don't survive the boot */
    }
  }, [hydrated, tabIds, previewId, items]);
}
