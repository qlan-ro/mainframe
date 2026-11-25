/**
 * SessionTabs — chrome-style session tabs in the title bar's chat column. The
 * active session is whichever tab is focused; there is ONE chat surface and
 * tabs switch its content (docs/plans/2026-08-08-session-tabs-and-workspace-files.md).
 *
 * The open set lives in `store.ts` — pinned tabs, one peek, one unsent draft,
 * rendered in that order; membership + persistence in `useSessionTabsSync`
 * (mounted here — the strip is the feature's one always-rendered component).
 * Closing removes from the set only — it never archives. Closing the last tab falls back to the new-session flow.
 *
 * Keyboard: the strip is a tablist with one tab stop (`onTabListKeyDown`).
 *
 * Overflow: pills shrink to min-w-24, then the row scrolls horizontally (no
 * scrollbar thumb: `data-scrollbar="none"`). The trailing spacer stays outside
 * `data-no-drag`, so the empty middle remains a window-drag area.
 */
import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import { useAui, useAuiState } from '@assistant-ui/react';
import { useThreadItems } from '@/features/sessions/runtime/use-thread-items';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { useAdaptersStore } from '@/store/adapters';
import { useStartNewSession } from '@/features/sessions/new-thread/use-start-new-session';
import { useProjects } from '@/features/sessions/use-projects';
import { canOpenBeside } from '@/features/workspace-chat/open-session';
import { useShortcutAction } from '@/features/shortcuts/action-store';
import { useIndexHintsStore } from '@/features/shortcuts/index-hints';
import { SessionTabPill, type SessionTabEntry } from './SessionTabPill';
import { toTabEntry } from './tab-entry';
import { useSessionTabsStore } from './store';
import { onTabListKeyDown } from './tab-shape';
import { canonicalTabId, displayedTabIds, nextTabId, tabAtIndex, tabHintIndex } from './tabs-model';
import { useSessionTabHandlers } from './use-session-tab-handlers';
import { useSessionTabsSync } from './use-session-tabs-sync';

export function SessionTabs() {
  useSessionTabsSync();
  const aui = useAui();
  const items = useThreadItems();
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const tabIds = useSessionTabsStore((s) => s.tabIds);
  const previewId = useSessionTabsStore((s) => s.previewId);
  const draftId = useSessionTabsStore((s) => s.draftId);
  const newSession = useStartNewSession();
  const { projects } = useProjects();
  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const adaptersById = useAdaptersStore((s) => s.byId);

  // Between the chat.created reload and the router's handover the active
  // thread is still the draft's local id while its tab is already canonical;
  // comparing raw ids would blank the active fill and mis-resolve a close in
  // that window. aui switches on either id, so clicks pass the tab id.
  const activeTabId = canonicalTabId(mainThreadId, items);

  const ordered = displayedTabIds({ tabIds, previewId, draftId });
  const entryOf = (id: string): SessionTabEntry =>
    toTabEntry(id, items, projectNames, activeTabId, id === previewId, adaptersById);

  const actions = useSessionTabHandlers(activeTabId, ordered);

  // ⌘1…⌘9 and ⌃Tab / ⌃⇧Tab walk the displayed order: what the user sees.
  const switchTo = (id: string | null) => {
    if (id != null && id !== activeTabId) aui.threads.switchToThread(id);
  };
  useShortcutAction('sessions.tab-by-index', (chordIndex) => switchTo(tabAtIndex(ordered, chordIndex)));
  useShortcutAction('sessions.tab-next', () => switchTo(nextTabId(ordered, activeTabId, 1)));
  useShortcutAction('sessions.tab-prev', () => switchTo(nextTabId(ordered, activeTabId, -1)));

  // Holding the chord's modifier paints each pill with the number that reaches
  // it — read off the same `ordered` the chord resolves against.
  const hintsRevealed = useIndexHintsStore((s) => s.revealed);
  const hintOf = (id: string) => (hintsRevealed ? tabHintIndex(ordered, id) : null);

  return (
    <div data-tut="session-tabs" data-testid="session-tabs" className="flex h-full min-w-0 flex-1 items-center">
      <div
        data-no-drag
        data-scrollbar="none"
        role="tablist"
        aria-label="Open sessions"
        onKeyDown={onTabListKeyDown}
        className="flex h-full min-w-0 flex-initial items-center gap-1 overflow-x-auto px-1 scroll-fade-x"
      >
        {ordered.map((id) => (
          <SessionTabPill
            key={id}
            tab={entryOf(id)}
            hintIndex={hintOf(id)}
            canOpenBeside={canOpenBeside(activeTabId, id)}
            {...actions}
          />
        ))}
      </div>
      <Hint label="New session">
        <Button
          data-testid="session-tabs-new"
          data-tut="new-session-tab"
          variant="ghost"
          aria-label="New session"
          size="icon-xs"
          onClick={newSession}
          className="size-7 shrink-0 text-muted-foreground hover:bg-foreground/5 dark:hover:bg-foreground/5"
        >
          <Plus className="size-4" />
        </Button>
      </Hint>
      {/* Trailing slack — plain div under the title bar's drag region, so the
          empty middle of the bar still drags the window. */}
      <div className="h-full min-w-4 flex-1" />
    </div>
  );
}
