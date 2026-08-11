/**
 * SessionTabs — chrome-style session tabs in the MainToolbar. The active
 * session is whichever tab is focused; there is ONE chat surface and tabs
 * switch its content (docs/plans/2026-08-08-session-tabs-and-workspace-files.md).
 *
 * The open set lives in `store.ts`; membership + persistence in
 * `useSessionTabsSync` (mounted here — the strip is the feature's one
 * always-rendered component). Closing removes from the set only — it never
 * archives. Closing the last tab falls back to the new-session flow, the same
 * behavior as the sidebar "+" / ⌘N.
 *
 * Overflow: pills shrink from w-45 to min-w-24, then the row scrolls
 * horizontally (no scrollbar — the app's opt-out idiom). The trailing spacer
 * stays outside `data-no-drag`, so the empty middle remains a window-drag area.
 */
import { Plus } from 'lucide-react';
import { useAui, useAuiState } from '@assistant-ui/react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { useNewChatHotkeyHandler } from '@/features/sessions/new-thread/use-new-chat-hotkey-handler';
import type { ThreadListEntry } from '@/features/sessions/view-model/chat-to-thread-custom';
import { SessionTabPill, type SessionTabEntry } from './SessionTabPill';
import { useSessionTabsStore } from './store';
import { canonicalTabId, nextActiveAfterClose } from './tabs-model';
import { useSessionTabsSync } from './use-session-tabs-sync';

function toTabEntry(
  id: string,
  items: readonly ThreadListEntry[],
  activeId: string | null,
  preview: boolean,
): SessionTabEntry {
  const entry = items.find((t) => t.id === id);
  const isDraft = entry == null || entry.status === 'new';
  return {
    id,
    title: entry?.title ?? (isDraft ? 'New Session' : 'Untitled'),
    projectId: (entry?.custom as { projectId?: string } | undefined)?.projectId,
    active: id === activeId,
    preview,
  };
}

export function SessionTabs() {
  useSessionTabsSync();
  const aui = useAui();
  const items = useAuiState((s) => s.threads.threadItems);
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const tabIds = useSessionTabsStore((s) => s.tabIds);
  const previewId = useSessionTabsStore((s) => s.previewId);
  const closeTab = useSessionTabsStore((s) => s.closeTab);
  const pinTab = useSessionTabsStore((s) => s.pinTab);
  const newSession = useNewChatHotkeyHandler(aui);

  // Between the chat.created reload and the router's handover the active
  // thread is still the draft's local id while its tab is already canonical;
  // comparing raw ids would blank the active underline and mis-resolve a close
  // in that window. aui switches on either id, so clicks pass the tab id.
  const activeTabId = canonicalTabId(mainThreadId, items);

  // Pinned tabs in order; the preview slot renders last (editor-style).
  const displayIds = previewId === null ? tabIds : [...tabIds, previewId];
  const tabs = displayIds.map((id) => toTabEntry(id, items, activeTabId, id === previewId));

  const handleActivate = (id: string) => {
    if (id !== activeTabId) aui.threads.switchToThread(id);
  };

  const handleClose = (id: string) => {
    const next = nextActiveAfterClose(displayIds, id, activeTabId);
    closeTab(id);
    if (next === null) newSession();
    else if (next !== activeTabId) aui.threads.switchToThread(next);
  };

  return (
    <div data-testid="session-tabs" className="flex h-full min-w-0 flex-1 items-center">
      <div
        data-no-drag
        className="flex h-full min-w-0 flex-initial items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none]"
      >
        {tabs.map((tab) => (
          <SessionTabPill key={tab.id} tab={tab} onActivate={handleActivate} onClose={handleClose} onPin={pinTab} />
        ))}
      </div>
      <Hint label="New session">
        <Button
          data-testid="session-tabs-new"
          variant="ghost"
          size="icon-xs"
          onClick={newSession}
          className="shrink-0 text-muted-foreground"
        >
          <Plus />
        </Button>
      </Hint>
      {/* Trailing slack — plain div under the toolbar's drag region, so the
          empty middle of the title bar still drags the window. */}
      <div className="h-full min-w-4 flex-1" />
    </div>
  );
}
