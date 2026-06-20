/**
 * layout/surfaces/RunSurface.tsx — renders the Run surface's pane model.
 * 1 or 2 panes laid out along `run.dir`; each pane is a `RunTabStrip` + the
 * active body. A preview-config tab shows the webview (`PreviewInstance`); a
 * process-config tab shows a full-space console (`ConsolePane variant="full"`);
 * a terminal tab shows the PTY. The whole surface is a drop target for a
 * Files-tab drag (`data-drop-surface="run"`).
 */
import { TerminalInstance } from '@/features/terminal/TerminalInstance';
import { PreviewInstance } from '@/features/preview/PreviewInstance';
import { ConsolePane } from '@/features/run/ConsolePane';
import { RunTabStrip } from '../RunTabStrip';
import { useLayoutStore } from '@/store/layout';
import { useSandboxStore } from '@/store/sandbox';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import type { RunPane, RunTab } from '@/store/run-pane';
import { SurfacePicker } from '../SurfacePicker';

interface RunPaneViewProps {
  pane: RunPane;
  primary: boolean;
  scopeKey: string | null;
  projectId?: string;
}

function RunTabBody({ tab, active, scopeKey, projectId }: { tab: RunTab; active: boolean; scopeKey: string | null; projectId?: string }) {
  // A launch tab carries its OWN scope (captured at launch); fall back to the
  // active-chat-derived scope only for tabs created before this was captured.
  // Run tabs are global, so the active chat may not resolve to this tab's scope.
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
  if (tab.kind === 'console') {
    return (
      <div className="absolute inset-0" style={{ visibility: active ? 'visible' : 'hidden' }}>
        {tabScope && tab.config ? (
          <ConsolePane scopeKey={tabScope} processName={tab.config} variant="full" />
        ) : (
          <div className="grid h-full place-items-center text-caption text-muted-foreground">Starting…</div>
        )}
      </div>
    );
  }
  // Files guests (code/diff/skill/viewer) — placeholder until wired.
  if (!active) return null;
  return (
    <div className="grid h-full place-items-center text-caption text-muted-foreground">{`${tab.kind}: ${tab.title}`}</div>
  );
}

function RunPaneView({ pane, primary, scopeKey, projectId }: RunPaneViewProps) {
  return (
    <div data-testid={`run-pane-${pane.id}`} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <RunTabStrip pane={pane} primary={primary} />
      <div className="relative min-h-0 flex-1">
        {pane.tabs.map((t) => (
          <RunTabBody key={t.id} tab={t} active={t.id === pane.active} scopeKey={scopeKey} projectId={projectId} />
        ))}
      </div>
    </div>
  );
}

export function RunSurface() {
  const run = useLayoutStore((s) => s.run);
  const hasContent = run && run.panes.some((p) => p.tabs.length > 0);

  const { projectId } = useActiveIdentity();
  const processStatuses = useSandboxStore((s) => s.processStatuses);

  // Derive the scope key from the first scope that has statuses for the active
  // project (the effectivePath comes from the launch status fetch) so we can pass
  // it to ConsolePane / PreviewInstance.
  const scopeKey = projectId
    ? (Object.keys(processStatuses).find((k) => k.startsWith(`${projectId}:`)) ?? null)
    : null;

  return (
    <div data-testid="run-surface" className="flex h-full flex-col">
      {hasContent ? (
        <div className={`flex min-h-0 flex-1 ${run.dir === 'h' ? 'flex-col' : 'flex-row'}`}>
          {run.panes.map((pane, i) => (
            <div
              key={pane.id}
              className={`flex min-h-0 min-w-0 flex-1 ${
                i > 0
                  ? run.dir === 'h'
                    ? '[border-top:0.5px_solid_var(--border)]'
                    : '[border-left:0.5px_solid_var(--border)]'
                  : ''
              }`}
            >
              <RunPaneView pane={pane} primary={i === 0} scopeKey={scopeKey} projectId={projectId} />
            </div>
          ))}
        </div>
      ) : (
        <SurfacePicker surface="run" />
      )}
    </div>
  );
}
