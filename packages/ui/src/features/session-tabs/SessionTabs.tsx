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
import { useAssistantRuntime, useAuiState } from '@assistant-ui/react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { useNewChatHotkeyHandler } from '@/features/sessions/new-thread/use-new-chat-hotkey-handler';
import type { ThreadListEntry } from '@/features/sessions/view-model/chat-to-thread-custom';
import { SessionTabPill, type SessionTabEntry } from './SessionTabPill';
import { useSessionTabsStore } from './store';
import { nextActiveAfterClose } from './tabs-model';
import { useSessionTabsSync } from './use-session-tabs-sync';

function toTabEntry(id: string, items: readonly ThreadListEntry[], activeId: string | null): SessionTabEntry {
  const entry = items.find((t) => t.id === id);
  const isDraft = entry == null || entry.status === 'new';
  return {
    id,
    title: entry?.title ?? (isDraft ? 'New Session' : 'Untitled'),
    projectId: (entry?.custom as { projectId?: string } | undefined)?.projectId,
    active: id === activeId,
  };
}

export function SessionTabs() {
  useSessionTabsSync();
  const runtime = useAssistantRuntime();
  const items = useAuiState((s) => s.threads.threadItems);
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const tabIds = useSessionTabsStore((s) => s.tabIds);
  const closeTab = useSessionTabsStore((s) => s.closeTab);
  const newSession = useNewChatHotkeyHandler(runtime);

  const tabs = tabIds.map((id) => toTabEntry(id, items, mainThreadId));

  const handleActivate = (id: string) => {
    if (id !== mainThreadId) void runtime.threads.switchToThread(id);
  };

  const handleClose = (id: string) => {
    const next = nextActiveAfterClose(tabIds, id, mainThreadId);
    closeTab(id);
    if (next === null) newSession();
    else if (next !== mainThreadId) void runtime.threads.switchToThread(next);
  };

  return (
    <div data-testid="session-tabs" className="flex h-full min-w-0 flex-1 items-center">
      <div
        data-no-drag
        className="flex h-full min-w-0 flex-initial items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none]"
      >
        {tabs.map((tab) => (
          <SessionTabPill key={tab.id} tab={tab} onActivate={handleActivate} onClose={handleClose} />
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
