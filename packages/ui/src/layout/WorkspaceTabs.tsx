/**
 * WorkspaceTabs — one workspace pane's tab pills and its `+`. The primary pane's
 * live in the title bar (W2); a second pane keeps them on its own strip.
 *
 * With no pane (nothing open in this scope) only the `+` renders. The inline URL
 * entry replaces the pill row rather than floating over the tab body: the native
 * child webview composites above the DOM and would swallow it.
 *
 * Both the pills and the add menu read the ACTIVE session's launch scope: the
 * surface renders only tabs matching it, so the active identity is the right
 * scope for start/stop (launch stop MUST pass chatId).
 *
 * data-testid: workspace-tab-strip-<paneId> on the pill row; the pills and the
 * add menu document their own.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useLaunchActions } from '@/features/run/use-launch-actions';
import { onTabListKeyDown } from '@/features/session-tabs/tab-shape';
import { WorkspaceAddMenu } from './WorkspaceAddMenu';
import { WorkspaceTabPill } from './WorkspaceTabPill';
import { WorkspaceUrlEntry } from './WorkspaceUrlEntry';
import type { RunPane } from '@/store/run-pane';

/** Closing the last tab collapses the workspace and its `+`; the toggle that reopens it stays. */
const workspaceToggle = () => document.querySelector<HTMLElement>('[data-tut="workspace"]');

/** How far the row's edge fades reach (`--scroll-fade-size`). */
const FADE_SIZE = 20;

/**
 * Scrolls the selected tab into view when it changes and whenever the row is
 * resized. A tab that fills the row (`data-filled`) has no room between the edge
 * fades, so they go: they would dissolve its close button.
 */
function useSelectedTabInView(rowRef: RefObject<HTMLDivElement | null>, selected: string | null | undefined): void {
  useEffect(() => {
    const row = rowRef.current;
    if (row == null || selected == null) return undefined;
    const reveal = () => {
      const tab = row.querySelector<HTMLElement>('[aria-selected="true"]');
      if (tab == null) return;
      row.toggleAttribute('data-filled', tab.offsetWidth > row.clientWidth - 2 * FADE_SIZE);
      tab.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    };
    const observer = new ResizeObserver(reveal);
    observer.observe(row);
    reveal();
    return () => observer.disconnect();
  }, [rowRef, selected]);
}

export function WorkspaceTabs({ pane }: { pane: RunPane | null }) {
  const [urlEntryOpen, setUrlEntryOpen] = useState(false);
  const { projectId, chatId } = useActiveIdentity();
  const port = useDaemonPort();
  const { configs, scopeStatuses, handleLaunch, handleStop } = useLaunchActions(
    port,
    projectId ?? undefined,
    chatId ?? undefined,
  );

  const rowRef = useRef<HTMLDivElement>(null);
  useSelectedTabInView(rowRef, urlEntryOpen ? null : pane?.active);

  if (urlEntryOpen) {
    return (
      <div data-no-drag className="flex min-w-0 flex-1 items-center">
        <WorkspaceUrlEntry paneId={pane?.id} onDone={() => setUrlEntryOpen(false)} />
      </div>
    );
  }

  return (
    <>
      {pane && (
        <div
          ref={rowRef}
          data-testid={`workspace-tab-strip-${pane.id}`}
          data-no-drag
          data-scrollbar="none"
          role="tablist"
          aria-label="Workspace tabs"
          onKeyDown={(event) => onTabListKeyDown(event, workspaceToggle)}
          className="group/tabs flex h-full min-w-0 flex-initial items-center gap-1 overflow-x-auto scroll-fade-x data-filled:[--scroll-fade-size:0px]"
        >
          {pane.tabs.map((t) => (
            <WorkspaceTabPill
              key={t.id}
              pane={pane}
              tab={t}
              configs={configs}
              scopeStatuses={scopeStatuses}
              onStop={handleStop}
            />
          ))}
        </div>
      )}
      <WorkspaceAddMenu
        paneId={pane?.id}
        configs={configs}
        onLaunch={handleLaunch}
        onOpenUrl={() => setUrlEntryOpen(true)}
      />
    </>
  );
}
