/**
 * SessionTabs — chrome-style session tabs in the title bar's chat column. The
 * active session is whichever tab is focused; there is ONE chat surface and
 * tabs switch its content (docs/plans/2026-08-08-session-tabs-and-workspace-files.md).
 *
 * The open set lives in `store.ts` — pinned tabs, one peek, one unsent draft,
 * rendered in that order; membership + persistence in `useSessionTabsSync`
 * (mounted here — the strip is the feature's one always-rendered component).
 * A split pair renders as ONE fused entry (`stripEntries`); the pair itself
 * stays owned by `zones-store`. Closing removes from the set only — it never
 * archives. Closing the last tab falls back to the new-session flow.
 *
 * Overflow: pills shrink to min-w-24, then the row scrolls horizontally (no
 * scrollbar — the app's opt-out idiom). The trailing spacer stays outside
 * `data-no-drag`, so the empty middle remains a window-drag area.
 */
import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import { useAui, useAuiState } from '@assistant-ui/react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { useAdaptersStore } from '@/store/adapters';
import { useStartNewSession } from '@/features/sessions/new-thread/use-start-new-session';
import { useProjects } from '@/features/sessions/use-projects';
import { canOpenInSplit } from '@/features/chat/zones/open-in-split';
import { useZonesStore } from '@/features/chat/zones/zones-store';
import { useShortcutAction } from '@/features/shortcuts/action-store';
import { useIndexHintsStore } from '@/features/shortcuts/index-hints';
import { SessionTabPair } from './SessionTabPair';
import { SessionTabPill, type SessionTabEntry } from './SessionTabPill';
import { toTabEntry } from './tab-entry';
import { useSessionTabsStore } from './store';
import { canonicalTabId, displayedTabIds, nextTabId, stripEntries, tabAtIndex, tabHintIndex } from './tabs-model';
import { useSessionTabHandlers } from './use-session-tab-handlers';
import { useSessionTabsSync } from './use-session-tabs-sync';

export function SessionTabs() {
  useSessionTabsSync();
  const aui = useAui();
  const items = useAuiState((s) => s.threads.threadItems);
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const tabIds = useSessionTabsStore((s) => s.tabIds);
  const previewId = useSessionTabsStore((s) => s.previewId);
  const draftId = useSessionTabsStore((s) => s.draftId);
  const newSession = useStartNewSession();
  const { projects } = useProjects();
  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const adaptersById = useAdaptersStore((s) => s.byId);
  const zones = useZonesStore((s) => s.zones);

  // Between the chat.created reload and the router's handover the active
  // thread is still the draft's local id while its tab is already canonical;
  // comparing raw ids would blank the active fill and mis-resolve a close in
  // that window. aui switches on either id, so clicks pass the tab id.
  const activeTabId = canonicalTabId(mainThreadId, items);

  // Pinned tabs in order, then the peek, then the unsent draft. Passing no
  // zones keeps the PIN order, which is what a close resolves its successor
  // against; the regrouped order below is a display concern.
  const tabsState = { tabIds, previewId, draftId };
  const displayIds = displayedTabIds(tabsState, null, activeTabId);
  const ordered = displayedTabIds(tabsState, zones, activeTabId);
  const entries = stripEntries(tabsState, zones, activeTabId);
  const entryOf = (id: string): SessionTabEntry =>
    toTabEntry(id, items, projectNames, activeTabId, id === previewId, adaptersById);

  const actions = useSessionTabHandlers(activeTabId, displayIds);

  // ⌘1…⌘9 and ⌃Tab / ⌃⇧Tab walk the DISPLAYED order — what the user sees, not
  // the stored pin order; a pair's members still count one each.
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
        className="flex h-full min-w-0 flex-initial items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none] scroll-fade-x"
      >
        {entries.map((entry) =>
          entry.kind === 'pair' ? (
            <SessionTabPair
              key={`pair:${entry.ids[0]}:${entry.ids[1]}`}
              tabs={[entryOf(entry.ids[0]), entryOf(entry.ids[1])]}
              focused={entry.focused}
              visible={entry.visible}
              hintOf={hintOf}
              {...actions}
            />
          ) : (
            <SessionTabPill
              key={entry.id}
              tab={entryOf(entry.id)}
              hintIndex={hintOf(entry.id)}
              canOpenInSplit={canOpenInSplit(zones, activeTabId, entry.id)}
              {...actions}
            />
          ),
        )}
      </div>
      <Hint label="New session">
        <Button
          data-testid="session-tabs-new"
          data-tut="new-session-tab"
          variant="ghost"
          size="icon-xs"
          onClick={newSession}
          className="shrink-0 text-muted-foreground"
        >
          <Plus />
        </Button>
      </Hint>
      {/* Trailing slack — plain div under the title bar's drag region, so the
          empty middle of the bar still drags the window. */}
      <div className="h-full min-w-4 flex-1" />
    </div>
  );
}
