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
import { openSessionBeside } from '@/features/workspace-chat/open-session';
import { isSurfaceFloor, useLayoutStore } from '@/store/layout';
import { useUiPrefs } from '@/store/ui-prefs';
import type { SessionTabPillActions } from './SessionTabPill';
import type { SurfaceMenuActions } from './SessionTabContextMenu';
import { useSessionTabsStore } from './store';
import { nextActiveAfterClose } from './tabs-model';

/** The chat surface's hide action, offered on every tab's context menu (ex-chat-header control). */
function useSurfaceMenuActions(): SurfaceMenuActions {
  const canHide = useLayoutStore((s) => !isSurfaceFloor(s.layout, 'chat'));
  const toggleSurface = useLayoutStore((s) => s.toggleSurface);
  return {
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

  const onActivate = (id: string, beside: boolean) => {
    // ⌘-click: open it in the workspace. The conversation itself, and any
    // draft, degrades to a plain focus click.
    if (beside && openSessionBeside(aui.threads, id)) return;
    if (id !== activeTabId) {
      aui.threads.switchToThread(id);
      // D3's seam (AppShell) fires on the resulting `mainThreadId` CHANGE.
    } else {
      // Clicking the already-active tab: switchToThread would be a no-op, so
      // there is no id change for the seam to see — push Chats back directly.
      setSidebarView('chats');
    }
  };

  const onClose = (id: string) => {
    const next = nextActiveAfterClose(displayIds, id, activeTabId);
    closeTab(id);
    if (next === null) newSession();
    else if (next !== activeTabId) aui.threads.switchToThread(next);
  };

  return {
    onActivate,
    onClose,
    onPin: pinTab,
    // The menu item shares the gesture's guard (`canOpenBeside`).
    onOpenBeside: (id) => {
      openSessionBeside(aui.threads, id);
    },
    onFork: (id) => void fork(id),
    onOpenSideChat: (id) => void openSideChat(id),
    surface,
  };
}
