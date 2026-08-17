/**
 * The chat surface's split shortcut actions. Registered by ChatSurface, so
 * they exist exactly while a chat surface is mounted.
 *
 * ⌘\ closes the VISIBLE split: the pair dissolves and the other chat takes the
 * whole surface. Inert with no split — and with a PARKED pair, which is not
 * what the shortcut is aimed at. ⌘⇧\ is the keyboard twin of the tab strip's
 * ⌘-click: it walks the displayed tab order for the first partner
 * `canOpenInSplit` accepts, so keyboard and menu can never disagree about what
 * is splittable.
 */
import type { AssistantClient } from '@assistant-ui/react';
import { useShortcutAction } from '@/features/shortcuts/action-store';
import { useSessionTabsStore } from '@/features/session-tabs/store';
import { canonicalTabId, displayedTabIds, nextSplitPartner } from '@/features/session-tabs/tabs-model';
import { openInSplit } from './open-in-split';
import { splitVisible, useZonesStore } from './zones-store';

export function useZoneShortcutActions(aui: AssistantClient): void {
  useShortcutAction('sessions.close-split', () => {
    const store = useZonesStore.getState();
    const { mainThreadId } = aui.threads.getState();
    if (!splitVisible(store.zones, mainThreadId) || store.zones == null) return;
    const survivor = store.zones[store.focusedIndex === 0 ? 1 : 0];
    store.closeSplit();
    aui.threads.switchToThread(survivor);
  });

  useShortcutAction('sessions.open-in-split', () => {
    const { mainThreadId, threadItems } = aui.threads.getState();
    if (mainThreadId == null) return;
    // The strip canonicalizes too: during the draft → canonical handover the
    // raw main id is absent from the displayed set, and an uncanonicalized
    // lookup would find no partner where the menu offers one.
    const activeId = canonicalTabId(mainThreadId, threadItems);
    const { zones } = useZonesStore.getState();
    const displayed = displayedTabIds(useSessionTabsStore.getState(), zones, activeId);
    const partner = nextSplitPartner(displayed, activeId, zones);
    if (partner == null) return;
    openInSplit(activeId, partner);
  });
}
