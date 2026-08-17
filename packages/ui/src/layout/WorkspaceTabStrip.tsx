/**
 * WorkspaceTabStrip — one pane's header row in the workspace surface:
 *
 *   [grip] [surface glyph] [tab pills…] [+] ……… [split▸][split▾][close]
 *
 * The ends come from `WorkspaceStripChrome` (shared with the empty-state header);
 * the `+` is `WorkspaceAddMenu`. Both the pills and the add-menu read the ACTIVE
 * session's launch scope: the surface renders only tabs matching it, so the
 * active identity is the right scope for start/stop (launch stop MUST pass
 * chatId).
 *
 * data-testid: workspace-tab-strip-<paneId> on the row; the pills, add-menu and
 * end controls document their own.
 */
import { useState } from 'react';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useLaunchActions } from '@/features/run/use-launch-actions';
import { WorkspaceAddMenu } from './WorkspaceAddMenu';
import { STRIP_ROW, WorkspaceStripActions, WorkspaceStripLead } from './WorkspaceStripChrome';
import { WorkspaceTabPill } from './WorkspaceTabPill';
import { WorkspaceUrlEntry } from './WorkspaceUrlEntry';
import type { RunPane } from '@/store/run-pane';

export function WorkspaceTabStrip({ pane, primary }: { pane: RunPane; primary: boolean }) {
  const [urlEntryOpen, setUrlEntryOpen] = useState(false);
  const { projectId, chatId } = useActiveIdentity();
  const port = useDaemonPort();
  const { configs, scopeStatuses, handleLaunch, handleStop } = useLaunchActions(
    port,
    projectId ?? undefined,
    chatId ?? undefined,
  );

  return (
    <div data-testid={`workspace-tab-strip-${pane.id}`} className={STRIP_ROW}>
      <WorkspaceStripLead primary={primary} />

      {/* The entry replaces the pill row rather than floating over the tab body:
          the native child webview composites above the DOM and would swallow it. */}
      {urlEntryOpen ? (
        <div className="flex min-w-0 flex-1 items-center pr-1.5">
          <WorkspaceUrlEntry paneId={pane.id} onDone={() => setUrlEntryOpen(false)} />
        </div>
      ) : (
        <>
          <div className="flex h-full min-w-0 flex-initial items-center gap-0.5 overflow-x-auto pr-0.5 [scrollbar-width:none] scroll-fade-x">
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

          <WorkspaceAddMenu
            paneId={pane.id}
            configs={configs}
            onLaunch={handleLaunch}
            onOpenUrl={() => setUrlEntryOpen(true)}
          />
          <div className="flex-1" />
        </>
      )}

      <WorkspaceStripActions paneId={pane.id} primary={primary} />
    </div>
  );
}
