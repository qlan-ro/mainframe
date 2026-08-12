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
import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import { useAui, useAuiState } from '@assistant-ui/react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import { useNewChatHotkeyHandler } from '@/features/sessions/new-thread/use-new-chat-hotkey-handler';
import { useProjects } from '@/features/sessions/use-projects';
import type { ThreadListEntry } from '@/features/sessions/view-model/chat-to-thread-custom';
import { openInSplit } from '@/features/chat/zones/open-in-split';
import { splitVisible, useZonesStore } from '@/features/chat/zones/zones-store';
import { SessionTabPill, type SessionTabEntry } from './SessionTabPill';
import { useSessionTabsStore } from './store';
import { canonicalTabId, nextActiveAfterClose } from './tabs-model';
import { useSessionTabsSync } from './use-session-tabs-sync';

function toTabEntry(
  id: string,
  items: readonly ThreadListEntry[],
  projectNames: ReadonlyMap<string, string>,
  activeId: string | null,
  preview: boolean,
): SessionTabEntry {
  const entry = items.find((t) => t.id === id);
  const isDraft = entry == null || entry.status === 'new';
  const projectId = (entry?.custom as { projectId?: string } | undefined)?.projectId;
  return {
    id,
    title: entry?.title ?? (isDraft ? 'New Session' : 'Untitled'),
    projectId,
    projectName: projectId != null ? projectNames.get(projectId) : undefined,
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
  const { projects } = useProjects();
  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  // Between the chat.created reload and the router's handover the active
  // thread is still the draft's local id while its tab is already canonical;
  // comparing raw ids would blank the active underline and mis-resolve a close
  // in that window. aui switches on either id, so clicks pass the tab id.
  const activeTabId = canonicalTabId(mainThreadId, items);

  // Pinned tabs in order; the preview slot renders last (editor-style).
  const displayIds = previewId === null ? tabIds : [...tabIds, previewId];

  // While split, the two zone tabs regroup ADJACENT (in zone order, at the
  // first member's position) so the strip mirrors the surface — a visual
  // reorder only, the stored pin order is untouched.
  const zones = useZonesStore((s) => s.zones);
  const zoneMembers = zones == null ? [] : zones.filter((id) => displayIds.includes(id));
  const grouped = zoneMembers.length === 2;
  // A PARKED pair still renders its container — the two sessions are still a
  // pair — but the split isn't what you're looking at, so its underline is dark.
  const splitOnScreen = splitVisible(zones, mainThreadId);
  const ordered = grouped
    ? (() => {
        const firstAt = displayIds.findIndex((id) => zoneMembers.includes(id));
        const rest = displayIds.filter((id) => !zoneMembers.includes(id));
        return [...rest.slice(0, firstAt), ...zoneMembers, ...rest.slice(firstAt)];
      })()
    : displayIds;
  const tabs = ordered.map((id) => toTabEntry(id, items, projectNames, activeTabId, id === previewId));

  const handleActivate = (id: string, split: boolean) => {
    // ⌘-click: open the split (or retarget its unfocused slot). A tab already
    // visible, and any draft, degrades to a plain focus click.
    if (split && openInSplit(activeTabId, id)) return;
    if (id !== activeTabId) aui.threads.switchToThread(id);
  };

  const handleClose = (id: string) => {
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

  return (
    <div data-testid="session-tabs" className="flex h-full min-w-0 flex-1 items-center">
      <div
        data-no-drag
        className="flex h-full min-w-0 flex-initial items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none]"
      >
        {grouped ? (
          <>
            {tabs
              .filter((tab) => !zoneMembers.includes(tab.id))
              .slice(
                0,
                ordered.findIndex((id) => zoneMembers.includes(id)),
              )
              .map((tab) => (
                <SessionTabPill
                  key={tab.id}
                  tab={tab}
                  onActivate={handleActivate}
                  onClose={handleClose}
                  onPin={pinTab}
                />
              ))}
            {/* The split pair reads as ONE unit: one underline spanning both,
                lit on exactly the terms a lone tab's is — the split is ON
                SCREEN. So the line only ever means "this is live", and a parked
                pair leaves the strip unmarked rather than claiming focus it
                doesn't have. Adjacency is what says "these two go together". */}
            <div
              data-testid="session-tabs-zone-group"
              className={cn(
                'relative flex h-full shrink items-center after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground after:transition-opacity',
                splitOnScreen ? 'after:opacity-100' : 'after:opacity-0',
              )}
            >
              {tabs
                .filter((tab) => zoneMembers.includes(tab.id))
                .map((tab) => (
                  <SessionTabPill
                    key={tab.id}
                    tab={tab}
                    grouped
                    onActivate={handleActivate}
                    onClose={handleClose}
                    onPin={pinTab}
                  />
                ))}
            </div>
            {tabs
              .filter((tab) => !zoneMembers.includes(tab.id))
              .slice(ordered.findIndex((id) => zoneMembers.includes(id)))
              .map((tab) => (
                <SessionTabPill
                  key={tab.id}
                  tab={tab}
                  onActivate={handleActivate}
                  onClose={handleClose}
                  onPin={pinTab}
                />
              ))}
          </>
        ) : (
          tabs.map((tab) => (
            <SessionTabPill key={tab.id} tab={tab} onActivate={handleActivate} onClose={handleClose} onPin={pinTab} />
          ))
        )}
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
