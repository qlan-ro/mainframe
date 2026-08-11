/**
 * useSessionTabsSync — the tab strip's ONE membership seam.
 *
 * Inserting a tab for whatever thread becomes active covers every activation
 * path at once — sidebar click, palette, toast deep-link, boot auto-select,
 * archived-active fallback — without touching any of those call sites. An
 * activation lands in the PREVIEW slot (editor-style: the next one replaces
 * it); only a just-created draft pins immediately — see `shouldPinOnOpen`.
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
import { useAui, useAuiState } from '@assistant-ui/react';
import { useZonesStore } from '@/features/chat/zones/zones-store';
import { useSessionListLoadState } from '../sessions/runtime/list-load-state';
import { useSessionTabsStore } from './store';
import {
  SESSION_TABS_STORAGE_KEY,
  canRestoreTabs,
  persistTabIds,
  reconcilePreviewId,
  reconcileTabIds,
  restoreTabIds,
  shouldPinOnOpen,
} from './tabs-model';

interface PersistedTabs {
  ids: string[];
  preview: string | null;
  /** v3: the open split's zone pair — absent/short pairs restore as no split. */
  zones: string[];
}

function readPersisted(): PersistedTabs {
  try {
    const raw = localStorage.getItem(SESSION_TABS_STORAGE_KEY);
    if (!raw) return { ids: [], preview: null, zones: [] };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ids: [], preview: null, zones: [] };
    const { ids, preview, zones } = parsed as { ids?: unknown; preview?: unknown; zones?: unknown };
    return {
      ids: Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [],
      // v1 payloads carry no preview — every restored tab was pinned.
      preview: typeof preview === 'string' ? preview : null,
      // v1/v2 payloads carry no zones — they restore unsplit.
      zones: Array.isArray(zones) ? zones.filter((id): id is string => typeof id === 'string') : [],
    };
  } catch {
    /* expected — corrupt storage reads as no persisted tabs */
    return { ids: [], preview: null, zones: [] };
  }
}

export function useSessionTabsSync(): void {
  const aui = useAui();
  const items = useAuiState((s) => s.threads.threadItems);
  const isListLoading = useAuiState((s) => s.threads.isLoading);
  const listLoaded = useSessionListLoadState((s) => s.loaded);
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const hydrated = useSessionTabsStore((s) => s.hydrated);
  const tabIds = useSessionTabsStore((s) => s.tabIds);
  const previewId = useSessionTabsStore((s) => s.previewId);
  const hydrate = useSessionTabsStore((s) => s.hydrate);
  const ensureTab = useSessionTabsStore((s) => s.ensureTab);
  const reconcile = useSessionTabsStore((s) => s.reconcile);

  // A restored split parks here until focus lands on its left zone (below).
  const pendingZonesRef = useRef<[string, string] | null>(null);

  useEffect(() => {
    if (hydrated || !canRestoreTabs(items, isListLoading, listLoaded)) return;
    const persisted = readPersisted();
    hydrate(
      restoreTabIds(persisted.ids, items),
      persisted.preview === null ? null : (restoreTabIds([persisted.preview], items)[0] ?? null),
    );
    // Restore the split only when BOTH zones still resolve. The pair is PARKED
    // until focus actually lands on the left zone: switchToThread resolves
    // async, and opening the split while the boot draft is still main would
    // make the reconciler read draft-main and close it straight back. When
    // focus is ALREADY there (deep-link boot straight into the left chat) the
    // parked effect would never fire — open inline instead.
    const zones = restoreTabIds(persisted.zones, items);
    const [left, right] = zones;
    if (zones.length === 2 && left != null && right != null) {
      if (mainThreadId === left) {
        useZonesStore.getState().openSplit(left, right);
      } else {
        pendingZonesRef.current = [left, right];
        aui.threads.switchToThread(left);
      }
    }
  }, [hydrated, items, isListLoading, listLoaded, hydrate, aui, mainThreadId]);

  // Opens the parked restore once the switch has landed (see above).
  useEffect(() => {
    const pending = pendingZonesRef.current;
    if (pending == null || mainThreadId !== pending[0]) return;
    pendingZonesRef.current = null;
    useZonesStore.getState().openSplit(pending[0], pending[1]);
  }, [mainThreadId]);

  useEffect(() => {
    if (mainThreadId) ensureTab(mainThreadId, { pin: shouldPinOnOpen(mainThreadId, items) });
    // `items` is deliberately not a dep: membership reacts to ACTIVATION, and
    // re-running on list ticks would re-preview a session the user just closed.
  }, [mainThreadId, ensureTab]);

  // Zones ⊆ pinned tabs, always: splitting is a "keep this open" signal, so a
  // zone member's preview tab is promoted, and a member with no tab at all (a
  // restore whose tab was closed pre-reboot) gets one. Otherwise the strip and
  // the split disagree about what is open.
  const zonesPair = useZonesStore((s) => s.zones);
  useEffect(() => {
    if (zonesPair == null) return;
    const store = useSessionTabsStore.getState();
    for (const id of zonesPair) {
      store.ensureTab(id, { pin: true });
      store.pinTab(id); // ensureTab won't promote an existing preview
    }
  }, [zonesPair, previewId]);

  useEffect(() => {
    reconcile(
      (ids) => reconcileTabIds(ids, items, mainThreadId),
      (id) => reconcilePreviewId(id, items, mainThreadId),
    );
  }, [items, mainThreadId, reconcile]);

  // `items` changes identity on every stream tick (title/status updates), so
  // this effect runs hot while a chat is running — skip the write unless the
  // MAPPED id set actually changed.
  const lastWrittenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    const ids = persistTabIds(tabIds, items);
    const preview = previewId === null ? null : (persistTabIds([previewId], items)[0] ?? null);
    const zones = zonesPair === null ? [] : persistTabIds([...zonesPair], items);
    const key = `${ids.join('\0')}\0\0${preview ?? ''}\0\0${zones.join('\0')}`;
    if (key === lastWrittenRef.current) return;
    try {
      localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 3, ids, preview, zones }));
      lastWrittenRef.current = key;
    } catch {
      /* expected — storage may be unavailable; tabs simply don't survive the boot */
    }
  }, [hydrated, tabIds, previewId, zonesPair, items]);
}
