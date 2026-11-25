/**
 * layout/surfaces/WorkspaceSurface.tsx — everything that is not the conversation:
 * files, terminals, consoles, previews, URL tabs, and every secondary chat or
 * sub-agent (W8, W9), in one pane model.
 * 1 or 2 panes laid out along `run.dir`. The first pane's tabs are in the title
 * bar (W2); a second pane has its own `WorkspaceTabStrip`. A preview-config tab shows the webview (`PreviewInstance`); a
 * process-config tab shows a full-space console (`ConsolePane variant="full"`);
 * a terminal tab shows the PTY; a `url` tab shows an arbitrary address in the
 * same webview (`UrlTabInstance`); a file tab shows the editor/diff/viewer
 * (`EditorTabBody`); a chat or agent tab shows a conversation
 * (`ConversationTabBody`). The surface is a drop target for a tab drag
 * (`data-drop-surface="workspace"`).
 */
import { TerminalInstance } from '@/features/terminal/TerminalInstance';
import { PreviewInstance } from '@/features/preview/PreviewInstance';
import { UrlTabInstance } from '@/features/url-tab/UrlTabInstance';
import { ConsolePane } from '@/features/run/ConsolePane';
import { ConversationTabBody } from '@/features/workspace-chat/ConversationTabBody';
import { SidebarProvider } from '@/components/ui/sidebar';
import { useSandboxStore } from '@/store/sandbox';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { isWorkspaceFilesPanelOpen, useWorkspaceFilesPanel } from '@/store/workspace-files-panel';
import { WorkspaceFilesPanel } from '@/features/files/WorkspaceFilesPanel';
import { WorkspaceEmptyState } from '../WorkspaceEmptyState';
import { WorkspaceTabStrip } from '../WorkspaceTabStrip';
import { EditorTabBody } from './EditorTabBody';
import { useScopedRun } from './use-scoped-run';
import { isConversationTab, type RunPane, type RunTab } from '@/store/run-pane';

interface WorkspacePaneViewProps {
  pane: RunPane;
  primary: boolean;
  scopeKey: string | null;
  projectId?: string;
}

function WorkspaceTabBody({
  tab,
  active,
  scopeKey,
  projectId,
}: {
  tab: RunTab;
  active: boolean;
  scopeKey: string | null;
  projectId?: string;
}) {
  // A launch tab carries its OWN scope (captured at launch); fall back to the
  // active-chat-derived scope only for tabs created before this was captured.
  // workspace tabs are global, so the active chat may not resolve to this tab's scope.
  const tabScope = tab.scopeKey ?? scopeKey;
  if (tab.kind === 'terminal') {
    return <TerminalInstance terminalId={tab.id} visible={active} />;
  }
  if (tab.kind === 'preview') {
    return (
      <PreviewInstance
        tabId={tab.id}
        config={tab.config}
        visible={active}
        scopeKey={tabScope ?? undefined}
        projectId={projectId ?? undefined}
        port={tab.port ?? null}
      />
    );
  }
  if (tab.kind === 'url') {
    // A corrupt persisted tab with no url resolves to the `invalid` body, which
    // still carries a live address bar — never the placeholder below.
    return (
      <UrlTabInstance
        tabId={tab.id}
        url={tab.url ?? ''}
        visible={active}
        scopeKey={tabScope ?? undefined}
        projectId={projectId ?? undefined}
      />
    );
  }
  if (tab.kind === 'console') {
    return (
      <div className="absolute inset-0" style={{ visibility: active ? 'visible' : 'hidden' }}>
        {tabScope && tab.config ? (
          <ConsolePane scopeKey={tabScope} processName={tab.config} variant="full" />
        ) : (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">Starting…</div>
        )}
      </div>
    );
  }
  if (isConversationTab(tab)) return <ConversationTabBody tab={tab} active={active} />;
  // File tabs (code/diff/skill/viewer) mount lazily and only while active: the
  // editor and viewers are heavy, and a hidden CodeMirror can't be measured.
  if (!active) return null;
  return (
    <div className="absolute inset-0">
      <EditorTabBody tab={tab} />
    </div>
  );
}

function WorkspacePaneView({ pane, primary, scopeKey, projectId }: WorkspacePaneViewProps) {
  return (
    <div data-testid={`workspace-pane-${pane.id}`} className="flex min-h-0 min-w-0 flex-1 flex-col">
      {!primary && <WorkspaceTabStrip pane={pane} />}
      <div className="relative min-h-0 flex-1">
        {pane.tabs.map((t) => (
          <WorkspaceTabBody
            key={t.id}
            tab={t}
            active={t.id === pane.active}
            scopeKey={scopeKey}
            projectId={projectId}
          />
        ))}
      </div>
    </div>
  );
}

/** `leaving`: the panel is sliding out, so an emptied one shows nothing rather than the empty state (W5). */
export function WorkspaceSurface({ leaving = false }: { leaving?: boolean } = {}) {
  const { run, scopeKey: activeScopeKey, projectId } = useScopedRun();
  const processStatuses = useSandboxStore((s) => s.processStatuses);
  const hasContent = run && run.panes.some((p) => p.tabs.length > 0);

  // Fallback scope for any legacy tab that predates per-tab scopeKeys: the first
  // scope with statuses for the active project. Filtered tabs carry their own.
  const scopeKey =
    activeScopeKey ??
    (projectId ? (Object.keys(processStatuses).find((k) => k.startsWith(`${projectId}:`)) ?? null) : null);

  // The docked Files sidebar's open state — scoped to the active-bases-store's
  // scopeKey (not the fallback-widened `scopeKey` above, which is a tab-display
  // convenience), and owned here so the sidebar and the content pane below are
  // flex siblings under one SidebarProvider — the panel never overlaps content.
  const filesScopeKey = useActiveBasesStore((s) => s.scopeKey);
  const filesOpen = useWorkspaceFilesPanel((s) => isWorkspaceFilesPanelOpen(s.openByScope, filesScopeKey));
  const setFilesOpen = useWorkspaceFilesPanel((s) => s.setOpen);

  return (
    <SidebarProvider data-testid="workspace-surface" open={filesOpen} onOpenChange={setFilesOpen} className="h-full">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {hasContent ? (
          <div className={`flex min-h-0 flex-1 ${run.dir === 'h' ? 'flex-col' : 'flex-row'}`}>
            {run.panes.map((pane, i) => (
              <div
                key={pane.id}
                className={`flex min-h-0 min-w-0 flex-1 ${
                  i > 0 ? (run.dir === 'h' ? 'border-t border-border' : 'border-l border-border') : ''
                }`}
              >
                <WorkspacePaneView pane={pane} primary={i === 0} scopeKey={scopeKey} projectId={projectId} />
              </div>
            ))}
          </div>
        ) : (
          !leaving && <WorkspaceEmptyState />
        )}
      </div>
      <WorkspaceFilesPanel />
    </SidebarProvider>
  );
}
