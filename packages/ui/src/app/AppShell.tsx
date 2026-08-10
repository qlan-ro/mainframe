/**
 * AppShell — the runnable application under a live daemon connection.
 *
 * DaemonPortProvider → AssistantRuntimeProvider feed the sidebar + surface host.
 * useSessionListRouter() runs INSIDE the provider (needs the live thread list).
 *
 * The chrome is the v2 shell (SidebarProvider + the ported SessionSidebar); the
 * surfaces, toolbar, inspector and overlay hosts are legacy islands that port
 * in place, one at a time.
 */
import { useEffect } from 'react';
import { AssistantRuntimeProvider, useAui } from '@assistant-ui/react';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { DirectoryPickerModal } from '@/features/files/DirectoryPickerModal';
import { FindInPathModal } from '@/features/files/FindInPathModal';
import { SpotlightPalette } from '@/features/palette/SpotlightPalette';
import { ArchiveWorktreeDialog } from '@/features/sessions/ArchiveWorktreeDialog';
import { SessionSidebar } from '@/features/sessions/SessionSidebar';
import { TagPopoverHost } from '@/features/sessions/TagPopoverHost';
import { FilePickerDialog } from '../features/files/FilePickerDialog';
import { TasksModalHost } from '../features/tasks/TasksModalHost';
import { AutomationsHost } from '../features/automations/AutomationsHost';
import { SetupAdvisorHost } from '../features/setup-advisor/SetupAdvisorHost';
import { ConfirmDialogHost } from '../components/overlays/ConfirmDialogHost';
import { SettingsDialog } from '../features/settings/SettingsDialog';
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
import { MainToolbar } from '../layout/MainToolbar';
import { SurfaceHost } from '../layout/SurfaceHost';
import { setSessionNavigator } from '../lib/session-nav';
import { useGlobalOverlayHotkeys } from './use-global-overlay-hotkeys';
import { useSandboxWsRouter } from '../features/run/use-sandbox-ws-router';

/** While the sidebar is collapsed, the surface area's top-left sits under the
 *  native traffic lights, so the MainToolbar's left group insets to clear them. */
const TRAFFIC_LIGHTS_SPACER_WIDTH = 80;

function RuntimeBody({ port }: { port: number }) {
  useSessionListRouter();
  useSandboxWsRouter();
  useGlobalOverlayHotkeys();

  // Register the session navigator so global toasts (mfToast) can deep-link to a
  // session via their "Open session →" CTA without reaching through to the runtime.
  const aui = useAui();
  useEffect(() => {
    setSessionNavigator((chatId) => aui.threads.switchToThread(chatId));
    return () => setSessionNavigator(null);
  }, [aui]);

  // Global ⌘N / Ctrl+N → new chat. In "All" view (no project pill active) this
  // opens the sidebar "+" button's project picker instead of switching straight
  // to a projectless new thread (see useNewChatHotkeyHandler for the branch and
  // resolveNewChatHotkeyAction for the seam); a project pill active keeps the
  // native path (reset the stale draft, switch — auto-config seeds the project).
  useNewChatHotkey(useNewChatHotkeyHandler(aui));

  // First-run coachmark tour — auto-opens only on an empty workspace.
  const showTour = useFirstRunTour();
  const sidebarVisible = useUiPrefs((s) => s.sidebarVisible);
  const setSidebarVisible = useUiPrefs((s) => s.setSidebarVisible);
  const sidebarWidth = useUiPrefs((s) => s.sidebarWidth);
  const setSidebarWidth = useUiPrefs((s) => s.setSidebarWidth);
  const { branchName, worktreePath, projectPath, projectId, chatId, isWorktree } = useActiveIdentity();

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

  return (
    <SidebarProvider
      data-testid="app-shell-root"
      open={sidebarVisible}
      onOpenChange={setSidebarVisible}
      defaultWidth={sidebarWidth}
      onWidthChange={setSidebarWidth}
      className="min-h-0 flex-1 overflow-hidden"
    >
      <SessionSidebar />

      <SidebarInset data-testid="main-surface-shell" className="overflow-hidden">
        <MainToolbar
          leadingInset={sidebarVisible ? 0 : TRAFFIC_LIGHTS_SPACER_WIDTH}
          sidebarRendered={sidebarVisible}
          onExpandSidebar={() => setSidebarVisible(true)}
          branchName={branchName}
          isWorktree={isWorktree}
          port={port}
          projectId={projectId}
          chatId={chatId}
        />
        <SurfaceHost />
      </SidebarInset>

      {/* Single app-wide outlets driven by their bridges/stores */}
      <ArchiveWorktreeDialog />
      <FilePickerDialog />
      <SpotlightPalette />
      <FindInPathModal />
      <DirectoryPickerModal />
      <ReviewPanel />
      <TagPopoverHost port={port} />
      <TasksModalHost port={port} />
      {/* Automations v2 — production entry point is SidebarHeader's Workflows
          button (Phase 6); v1's WorkflowsModalHost is unmounted here but its
          tree stays on disk until Phase 7 deletes it. */}
      <AutomationsHost />
      <SetupAdvisorHost />
      <ConfirmDialogHost />
      <SettingsDialog port={port} />
      {showTour && <TutorialOverlay />}
    </SidebarProvider>
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
