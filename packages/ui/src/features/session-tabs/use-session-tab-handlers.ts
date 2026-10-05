/**
 * use-session-tab-handlers — the strip's gestures, pulled out of
 * `SessionTabs.tsx` so the strip is markup over one bundle of actions.
 *
 * Every gesture here resolves against `activeTabId` (the canonical id, which
 * can differ from `mainThreadId` between the chat.created reload and the
 * router's handover) and the DISPLAYED order, never the stored pin order.
 */
import { useAui } from '@assistant-ui/react';
import { useStartNewSession } from '@/features/sessions/new-thread/use-start-new-session';
import { useForkChat } from '@/features/sessions/use-fork-chat';
import { useOpenSideChat } from '@/features/side-chat/use-open-side-chat';
import { openInSplit } from '@/features/chat/zones/open-in-split';
import { splitVisible, useZonesStore } from '@/features/chat/zones/zones-store';
import { isSurfaceFloor, layoutCanSplit, useLayoutStore } from '@/store/layout';
import { useUiPrefs } from '@/store/ui-prefs';
import type { SessionTabPillActions } from './SessionTabPill';
import type { SurfaceMenuActions } from './SessionTabContextMenu';
import { useSessionTabsStore } from './store';
import { nextActiveAfterClose } from './tabs-model';

/** The chat surface's split/hide actions, offered on every tab's context menu (ex-chat-header controls). */
function useSurfaceMenuActions(): SurfaceMenuActions {
  const canSplit = useLayoutStore((s) => layoutCanSplit(s.layout));
  const canHide = useLayoutStore((s) => !isSurfaceFloor(s.layout, 'chat'));
  const splitSurface = useLayoutStore((s) => s.splitSurface);
  const toggleSurface = useLayoutStore((s) => s.toggleSurface);
  return {
    canSplit,
    onSplitRight: () => splitSurface('v'),
    onSplitDown: () => splitSurface('h'),
    canHide,
    onHide: () => toggleSurface('chat'),
  };
}

export function useSessionTabHandlers(activeTabId: string | null, displayIds: string[]): SessionTabPillActions {
  const aui = useAui();
  const closeTab = useSessionTabsStore((s) => s.closeTab);
  const pinTab = useSessionTabsStore((s) => s.pinTab);
  const newSession = useStartNewSession();
  const fork = useForkChat();
  const openSideChat = useOpenSideChat();
  const surface = useSurfaceMenuActions();
  const setSidebarView = useUiPrefs((s) => s.setSidebarView);

  const onActivate = (id: string, split: boolean) => {
    // ⌘-click: open the split (or retarget its unfocused slot). A tab already
    // visible, and any draft, degrades to a plain focus click.
    if (split && openInSplit(activeTabId, id)) return;
    if (id !== activeTabId) {
      aui.threads.switchToThread(id);
      // D3's seam (AppShell) fires on the resulting `mainThreadId` CHANGE.
    } else {
      // Clicking the already-active tab: switchToThread would be a no-op, so
      // there is no id change for the seam to see — push Chats back directly.
      setSidebarView('chats');
    }
  };

  // The context-menu twin of ⌘\. Dissolving from a tab's own menu leaves you on
  // THAT session — the one you pointed at — rather than ⌘\'s "other zone wins",
  // which has no tab to aim at. A parked pair dissolves without moving focus.
  const onCloseSplit = (id: string) => {
    const zonesStore = useZonesStore.getState();
    if (zonesStore.zones == null) return;
    const visible = splitVisible(zonesStore.zones, activeTabId);
    zonesStore.closeSplit();
    if (visible && id !== activeTabId) aui.threads.switchToThread(id);
  };

  const onClose = (id: string) => {
    // Closing a zone member's tab dissolves the pair: the split collapses to
    // the other chat (VS Code's close-last-tab-closes-the-group). Focus only
    // moves when the split was VISIBLE — dissolving a parked pair must not
    // yank the user away from whatever they are reading.
    const zonesStore = useZonesStore.getState();
    if (zonesStore.zones?.includes(id)) {
      const visible = activeTabId != null && zonesStore.zones.includes(activeTabId);
      const other = zonesStore.zones[0] === id ? zonesStore.zones[1] : zonesStore.zones[0];
      zonesStore.closeSplit();
      closeTab(id);
      if (visible && other !== activeTabId) aui.threads.switchToThread(other);
      return;
    }
    const next = nextActiveAfterClose(displayIds, id, activeTabId);
    closeTab(id);
    if (next === null) newSession();
    else if (next !== activeTabId) aui.threads.switchToThread(next);
  };

  return {
    onActivate,
    onClose,
    onPin: pinTab,
    // The hover button and the menu item share the gesture guard (`canOpenInSplit`).
    onOpenInSplit: (id) => {
      openInSplit(activeTabId, id);
    },
    onCloseSplit,
    onFork: (id) => void fork(id),
    onOpenSideChat: (id) => void openSideChat(id),
    // A drop on the active pill or the pair is the same gesture as ⌘-click:
    // open beside, or retarget the unfocused segment of a visible pair.
    onDropTab: (draggedId) => {
      openInSplit(activeTabId, draggedId);
    },
    surface,
  };
}
