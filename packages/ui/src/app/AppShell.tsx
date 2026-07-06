/**
 * AppShell — the runnable application under a live daemon connection.
 *
 * DaemonPortProvider → AssistantRuntimeProvider feed the sidebar + surface host.
 * useSessionListRouter() runs INSIDE the provider (needs the live thread list).
 */
import { useEffect } from 'react';
import { AssistantRuntimeProvider, useAssistantRuntime } from '@assistant-ui/react';
import { ArchiveWorktreeDialog } from '../features/sessions/sidebar/ArchiveWorktreeDialog';
import { FilePickerDialog } from '../features/files/FilePickerDialog';
import { InspectorPane } from '../features/files/InspectorPane';
import { TagPopoverHost } from '../features/sessions/tags/TagPopoverHost';
import { TasksModalHost } from '../features/tasks/TasksModalHost';
import { WorkflowsModalHost } from '../features/workflows/WorkflowsModalHost';
import { GitConfirmDialog } from '../features/git/GitConfirmDialog';
import { SettingsDialog } from '../features/settings/SettingsDialog';
import { SpotlightPalette } from '../features/palette/SpotlightPalette';
import { FindInPathModal } from '../components/overlays/FindInPathModal';
import { DirectoryPickerModal } from '../components/overlays/DirectoryPickerModal';
import { ReviewPanel } from '../features/review/ReviewPanel';
import { TutorialOverlay } from '../features/tour/TutorialOverlay';
import { useFirstRunTour } from '../features/tour/use-first-run-tour';
import { useSettingsStore } from '../store/settings';
import { useSessionsThreadList } from '../features/sessions/runtime/use-sessions-thread-list';
import { useSessionListRouter } from '../features/sessions/ws/use-session-list-router';
import { useNewChatHotkey } from '../features/sessions/use-new-chat-hotkey';
import { useNewChatHotkeyHandler } from '../features/sessions/new-thread/use-new-chat-hotkey-handler';
import { useActiveIdentity } from '../features/sessions/use-active-identity';
import { useActiveBasesStore } from '../store/active-bases-store';
import { activeLaunchScope } from '../lib/launch-scope';
import { useUiPrefs } from '../store/ui-prefs';
import { useTheme } from '../store/theme';
import { windowStyleGeometry } from '../lib/appearance/window-style';
import { MainToolbar } from '../layout/MainToolbar';
import { SidebarCollapseHandle } from '../layout/SidebarCollapseHandle';
import { SIDEBAR_EXPANDED_WIDTH, SidebarShell } from '../layout/SidebarShell';
import { SurfaceHost } from '../layout/SurfaceHost';
import { TRAFFIC_LIGHTS_SPACER_WIDTH } from '../layout/SidebarHeader';
import { useSidebarResize } from '../layout/useSidebarResize';
import { setSessionNavigator } from '../lib/session-nav';
import { useGlobalOverlayHotkeys } from './use-global-overlay-hotkeys';
import { useSandboxWsRouter } from '../features/run/use-sandbox-ws-router';

/** While the sidebar is collapsed, the surface area's top-left sits under the
 *  native traffic lights, so the MainToolbar's left group insets to clear them. */
function getLeadingInset(sidebarRendered: boolean, sidebarWidth: number): number {
  if (!sidebarRendered) return TRAFFIC_LIGHTS_SPACER_WIDTH;
  return Math.max(0, TRAFFIC_LIGHTS_SPACER_WIDTH - sidebarWidth);
}

function getMainOverlap(sidebarRendered: boolean, sidebarWidth: number): number {
  if (!sidebarRendered) return 0;
  return Math.max(0, SIDEBAR_EXPANDED_WIDTH - sidebarWidth);
}

function RuntimeBody({ port }: { port: number }) {
  useSessionListRouter();
  useSandboxWsRouter();
  useGlobalOverlayHotkeys();

  // Register the session navigator so global toasts (mfToast) can deep-link to a
  // session via their "Open session →" CTA without reaching through to the runtime.
  const runtime = useAssistantRuntime();
  useEffect(() => {
    setSessionNavigator((chatId) => runtime.threads.switchToThread(chatId));
    return () => setSessionNavigator(null);
  }, [runtime]);

  // Global ⌘N / Ctrl+N → new chat. In "All" view (no project pill active) this
  // opens the sidebar "+" button's project picker instead of switching straight
  // to a projectless new thread (see useNewChatHotkeyHandler for the branch and
  // resolveNewChatHotkeyAction for the seam); a project pill active keeps the
  // native path (reset the stale draft, switch — auto-config seeds the project).
  useNewChatHotkey(useNewChatHotkeyHandler(runtime));

  // First-run coachmark tour — auto-opens only on an empty workspace.
  const showTour = useFirstRunTour();
  const sidebarVisible = useUiPrefs((s) => s.sidebarVisible);
  const toggleSidebar = useUiPrefs((s) => s.toggleSidebar);
  const inspectorVisible = useUiPrefs((s) => s.inspectorVisible);
  const { projectName, branchName, worktreePath, projectPath, projectId, chatId } = useActiveIdentity();

  // Sync the active bases into the store so the intent subscriber (outside React)
  // can normalize open-file path flavors to a canonical relative key (F1 fix).
  const setActiveBases = useActiveBasesStore((s) => s.setActiveBases);
  useEffect(() => {
    setActiveBases({ worktreePath, projectPath }, activeLaunchScope(projectId, worktreePath, projectPath));
  }, [projectId, worktreePath, projectPath, setActiveBases]);

  // ⌘, / Ctrl+, opens settings.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        useSettingsStore.getState().open();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const windowStyle = useTheme((s) => s.windowStyle);
  const geo = windowStyleGeometry(windowStyle);

  const {
    dragCollapsed,
    dragging,
    expand,
    finishDrag,
    handleKeyDown,
    handlePointerDown,
    handlePointerMove,
    sidebarWidth,
    willCollapse,
  } = useSidebarResize(sidebarVisible);

  const sidebarRendered = sidebarVisible && !dragCollapsed;
  // One-click expand from either collapsed state: a drag-collapse leaves the
  // sidebar "visible" but dragCollapsed, so clear that; a button-hide flips
  // sidebarVisible back on (the hook resets dragCollapsed on that transition).
  const expandSidebar = () => {
    if (sidebarVisible) expand();
    else toggleSidebar();
  };
  const leadingInset = getLeadingInset(sidebarRendered, sidebarWidth);
  const mainOverlap = getMainOverlap(sidebarRendered, sidebarWidth);

  return (
    <div data-window-style={windowStyle} className={`flex flex-1 overflow-hidden ${geo.windowRoot}`}>
      {/* Floating panels (prototype 04-engine root: padding + gap). The native
          traffic lights stay over the sidebar header; when collapsed, the
          MainToolbar's left group insets to clear them. */}
      {sidebarRendered && (
        <div className="flex flex-shrink-0">
          <SidebarShell
            dimmed={willCollapse}
            dragging={dragging}
            width={Math.max(SIDEBAR_EXPANDED_WIDTH, sidebarWidth)}
            windowStyle={windowStyle}
          />
        </div>
      )}

      <div
        data-testid="main-surface-shell"
        className={`relative flex flex-1 flex-col overflow-hidden ${geo.pane}`}
        style={{ marginLeft: mainOverlap > 0 ? -mainOverlap : undefined }}
      >
        {sidebarVisible && (
          <SidebarCollapseHandle
            collapsed={dragCollapsed}
            left={0}
            onKeyDown={handleKeyDown}
            onPointerCancel={finishDrag}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDrag}
            width={sidebarWidth}
          />
        )}
        <MainToolbar
          leadingInset={leadingInset}
          sidebarRendered={sidebarRendered}
          onExpandSidebar={expandSidebar}
          projectName={projectName}
          branchName={branchName}
          windowStyle={windowStyle}
          port={port}
          projectId={projectId}
          chatId={chatId}
        />
        <SurfaceHost port={port} />
      </div>

      {/* Right Inspector pane (Files tree / Changes), toggled from the toolbar. */}
      {inspectorVisible && <InspectorPane port={port} />}

      {/* Single app-wide outlets driven by their bridges/stores */}
      <ArchiveWorktreeDialog />
      <FilePickerDialog />
      <SpotlightPalette />
      <FindInPathModal />
      <DirectoryPickerModal />
      <ReviewPanel />
      <TagPopoverHost port={port} />
      <TasksModalHost port={port} />
      <WorkflowsModalHost port={port} />
      <GitConfirmDialog />
      <SettingsDialog port={port} />
      {showTour && <TutorialOverlay />}
    </div>
  );
}

export function AppShell({ port }: { port: number }) {
  const runtime = useSessionsThreadList();

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <RuntimeBody port={port} />
    </AssistantRuntimeProvider>
  );
}
