/**
 * layout/surfaces/WorkspaceSurface.tsx — the single non-chat surface: files,
 * terminals, consoles, previews and URL tabs in one pane model.
 * 1 or 2 panes laid out along `run.dir`; each pane is a `WorkspaceTabStrip` + the
 * active body. A preview-config tab shows the webview (`PreviewInstance`); a
 * process-config tab shows a full-space console (`ConsolePane variant="full"`);
 * a terminal tab shows the PTY; a `url` tab shows an arbitrary address in the
 * same webview (`UrlTabInstance`); a file tab shows the editor/diff/viewer
 * (`EditorTabBody`). The surface is a drop target for a tab drag
 * (`data-drop-surface="workspace"`).
 */
import { GripVertical, LayoutPanelLeft, LayoutPanelTop, Play, X } from 'lucide-react';
import { TerminalInstance } from '@/features/terminal/TerminalInstance';
import { PreviewInstance } from '@/features/preview/PreviewInstance';
import { UrlTabInstance } from '@/features/url-tab/UrlTabInstance';
import { ConsolePane } from '@/features/run/ConsolePane';
import { WorkspaceTabStrip } from '../WorkspaceTabStrip';
import { EditorTabBody } from './EditorTabBody';
import { isSurfaceFloor, layoutCanSplit, useLayoutStore } from '@/store/layout';
import { useSandboxStore } from '@/store/sandbox';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { activeLaunchScope } from '@/lib/launch-scope';
import { filterRunByScope } from '@/store/run-scope-filter';
import type { RunPane, RunTab } from '@/store/run-pane';
import { WorkspaceEmptyState } from '../WorkspaceEmptyState';
import { useSurfaceDragStore } from '../use-surface-drag';
import { Hint } from '@/components/ui/hint';

const HEADER_BTN =
  'inline-flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[6px] border-none bg-transparent cursor-pointer transition-[background] duration-[120ms] hover:bg-accent';

/**
 * Header shown when the workspace has no tabs — keeps the split/close controls
 * reachable so an empty surface can still be split or dismissed (todo #195). The
 * `+`/add affordance is the empty state below, so it isn't repeated here.
 */
function WorkspaceEmptyHeader() {
  const splitAvailable = useLayoutStore((s) => layoutCanSplit(s.layout));
  const splitSurface = useLayoutStore((s) => s.splitSurface);
  const toggleSurface = useLayoutStore((s) => s.toggleSurface);
  const isFloor = useLayoutStore((s) => isSurfaceFloor(s.layout, 'workspace'));
  const beginSurfaceDrag = useSurfaceDragStore((s) => s.beginSurfaceDrag);

  return (
    <div className="flex h-[36px] flex-shrink-0 items-center [border-bottom:0.5px_solid_var(--border)]">
      <div
        data-testid="workspace-surface-drag"
        className="grid h-full w-[20px] flex-shrink-0 cursor-grab place-items-center pl-[4px]"
        onPointerDown={(e) => beginSurfaceDrag('workspace', { clientX: e.clientX, clientY: e.clientY })}
      >
        <GripVertical size={13} className="text-mf-text-4" />
      </div>
      <div className="flex-shrink-0 px-[4px]">
        <Play size={11} className="text-mf-surface-run" fill="currentColor" />
      </div>
      <div className="flex-1" />
      <div className="flex flex-shrink-0 items-center gap-px pl-[2px] pr-[6px]">
        {splitAvailable && (
          <>
            <Hint label="Split right">
              <button
                data-testid="workspace-tab-strip-split-right"
                type="button"
                onClick={() => splitSurface('v')}
                className={HEADER_BTN}
              >
                <LayoutPanelLeft size={13} className="text-mf-text-3" />
              </button>
            </Hint>
            <Hint label="Split down">
              <button
                data-testid="workspace-tab-strip-split-down"
                type="button"
                onClick={() => splitSurface('h')}
                className={HEADER_BTN}
              >
                <LayoutPanelTop size={13} className="text-mf-text-3" />
              </button>
            </Hint>
          </>
        )}
        <Hint label="Close workspace">
          <button
            data-testid="workspace-surface-close"
            type="button"
            disabled={isFloor}
            onClick={() => toggleSurface('workspace')}
            className={`${HEADER_BTN} ${isFloor ? 'cursor-not-allowed opacity-40' : ''}`}
          >
            <X size={12} className="text-mf-text-3" />
          </button>
        </Hint>
      </div>
    </div>
  );
}

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
          <div className="grid h-full place-items-center text-caption text-muted-foreground">Starting…</div>
        )}
      </div>
    );
  }
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
      <WorkspaceTabStrip pane={pane} primary={primary} />
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

export function WorkspaceSurface() {
  const storeRun = useLayoutStore((s) => s.run);

  const { projectId, worktreePath, projectPath } = useActiveIdentity();
  const processStatuses = useSandboxStore((s) => s.processStatuses);

  // Show only the tabs belonging to the active session's launch scope — a tab
  // opened under another project/worktree must not leak into this session.
  const activeScopeKey = activeLaunchScope(projectId, worktreePath, projectPath);
  const run = filterRunByScope(storeRun, activeScopeKey);
  const hasContent = run && run.panes.some((p) => p.tabs.length > 0);

  // Fallback scope for any legacy tab that predates per-tab scopeKeys: the first
  // scope with statuses for the active project. Filtered tabs carry their own.
  const scopeKey =
    activeScopeKey ??
    (projectId ? (Object.keys(processStatuses).find((k) => k.startsWith(`${projectId}:`)) ?? null) : null);

  return (
    <div data-testid="workspace-surface" className="flex h-full flex-col">
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
              <WorkspacePaneView pane={pane} primary={i === 0} scopeKey={scopeKey} projectId={projectId} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <WorkspaceEmptyHeader />
          <WorkspaceEmptyState />
        </>
      )}
    </div>
  );
}
