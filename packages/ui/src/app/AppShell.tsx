/**
 * AppShell — the runnable application under a live daemon connection.
 *
 * DaemonPortProvider → AssistantRuntimeProvider feed the sidebar + surface host.
 * useSessionListRouter() runs INSIDE the provider (needs the live thread list).
 *
 * The chrome is the v2 shell (SidebarProvider + the ported SessionSidebar); the
 * surfaces, toolbar and overlay hosts are legacy islands that port in place,
 * one at a time.
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
import { useSessionsThreadList } from '../features/sessions/runtime/use-sessions-thread-list';
import { useSessionListRouter } from '../features/sessions/ws/use-session-list-router';
import { useNewChatHotkeyHandler } from '../features/sessions/new-thread/use-new-chat-hotkey-handler';
import { useActiveIdentity } from '../features/sessions/use-active-identity';
import { useActiveBasesStore } from '../store/active-bases-store';
import { activeLaunchScope } from '../lib/launch-scope';
import { useUiPrefs } from '../store/ui-prefs';
import { MainToolbar } from '../layout/MainToolbar';
import { SurfaceHost } from '../layout/SurfaceHost';
import { setSessionNavigator } from '../lib/session-nav';
import { useShortcutDispatcher } from '../features/shortcuts/use-shortcut-dispatcher';
import { useIndexHintReveal } from '../features/shortcuts/index-hints';
import { ShortcutsCheatSheet } from '../features/shortcuts/ShortcutsCheatSheet';
import { useAppShortcutActions } from './use-app-shortcut-actions';
import { useSandboxWsRouter } from '../features/run/use-sandbox-ws-router';

/** While the sidebar is collapsed, the surface area's top-left sits under the
 *  native traffic lights, so the MainToolbar's left group insets to clear them. */
const TRAFFIC_LIGHTS_SPACER_WIDTH = 80;

function RuntimeBody({ port }: { port: number }) {
  useSessionListRouter();
  useSandboxWsRouter();
  // The app's ONE keydown listener — every app chord dispatches through it.
  useShortcutDispatcher();
  // Hold ⌘ (Ctrl off-mac) to reveal which number each session tab answers to.
  useIndexHintReveal();

  // Register the session navigator so global toasts (mfToast) can deep-link to a
  // session via their "Open session →" CTA without reaching through to the runtime.
  const aui = useAui();
  useEffect(() => {
    setSessionNavigator((chatId) => aui.threads.switchToThread(chatId));
    return () => setSessionNavigator(null);
  }, [aui]);

  // ⌘N, ⌘K, ⌘⇧R, ⌘,, ⌘B and ⌘/ — the chords whose owner is the always-mounted
  // shell. ⌘N resets the stale draft and switches to the new thread; with a
  // project pill active useNewThreadAutoConfig seeds that project, without one
  // the welcome screen's own picker resolves it.
  useAppShortcutActions({ onNewSession: useNewChatHotkeyHandler(aui) });

  // First-run coachmark tour — auto-opens only on an empty workspace.
  const showTour = useFirstRunTour();
  const sidebarVisible = useUiPrefs((s) => s.sidebarVisible);
  const setSidebarVisible = useUiPrefs((s) => s.setSidebarVisible);
  const sidebarWidth = useUiPrefs((s) => s.sidebarWidth);
  const setSidebarWidth = useUiPrefs((s) => s.setSidebarWidth);
  const { worktreePath, projectPath, projectId } = useActiveIdentity();

  // Sync the active bases into the store so the intent subscriber (outside React)
  // can normalize open-file path flavors to a canonical relative key (F1 fix).
  const setActiveBases = useActiveBasesStore((s) => s.setActiveBases);
  useEffect(() => {
    setActiveBases({ worktreePath, projectPath }, activeLaunchScope(projectId, worktreePath, projectPath));
  }, [projectId, worktreePath, projectPath, setActiveBases]);

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
          projectId={projectId}
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
      <ShortcutsCheatSheet />
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
