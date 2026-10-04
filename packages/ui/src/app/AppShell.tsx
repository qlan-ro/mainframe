/**
 * AppShell — the runnable application under a live daemon connection.
 *
 * DaemonPortProvider → AssistantRuntimeProvider feed the sidebar + surface host.
 * useSessionListRouter() runs INSIDE the provider (needs the live thread list).
 *
 * The chrome is a COLUMN over a ROW: the title bar spans the window; under it
 * the nav rail and the one content card (sidebar + chat). The app root is the
 * `sidebar` ground; the card is the only `background` surface. The
 * SidebarProvider wraps the whole column so the title bar reads
 * `--sidebar-width` live during a resize.
 */
import { useEffect } from 'react';
import { AssistantRuntimeProvider, useAui } from '@assistant-ui/react';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { DirectoryPickerModal } from '@/features/files/DirectoryPickerModal';
import { FindInPathModal } from '@/features/files/FindInPathModal';
import { SpotlightPalette } from '@/features/palette/SpotlightPalette';
import { ArchiveWorktreeDialog } from '@/features/sessions/ArchiveWorktreeDialog';
import { TagPopoverHost } from '@/features/sessions/TagPopoverHost';
import { FilePickerDialog } from '../features/files/FilePickerDialog';
import { TasksModalHost } from '../features/tasks/TasksModalHost';
import { AutomationsHost } from '../features/automations/AutomationsHost';
import { AutomationsRuntime } from '../features/automations/AutomationsRuntime';
import { SetupAdvisorHost } from '../features/setup-advisor/SetupAdvisorHost';
import { ConfirmDialogHost } from '../components/overlays/ConfirmDialogHost';
import { SettingsDialog } from '../features/settings/SettingsDialog';
import { ReviewPanel } from '../features/review/ReviewPanel';
import { TutorialOverlay } from '../features/tour/TutorialOverlay';
import { useFirstRunTour } from '../features/tour/use-first-run-tour';
import { useSessionsThreadList } from '../features/sessions/runtime/use-sessions-thread-list';
import { useSessionListRouter } from '../features/sessions/ws/use-session-list-router';
import { useOffloadRelease } from '../features/sessions/runtime/use-offload-release';
import { useStartNewSession } from '../features/sessions/new-thread/use-start-new-session';
import { useActiveIdentity } from '../features/sessions/use-active-identity';
import { useActiveBasesStore } from '../store/active-bases-store';
import { activeLaunchScope } from '../lib/launch-scope';
import { useUiPrefs } from '../store/ui-prefs';
import { AppSidebar } from '../layout/AppSidebar';
import { ContentCard } from '../layout/ContentCard';
import { NavRail } from '../layout/NavRail';
import { SurfaceHost } from '../layout/SurfaceHost';
import { TitleBar } from '../layout/TitleBar';
import { setSessionNavigator } from '../lib/session-nav';
import { getChat } from '../lib/api/chats';
import { navigateToSession } from '../features/side-chat/navigate-to-session';
import { useShortcutDispatcher } from '../features/shortcuts/use-shortcut-dispatcher';
import { useIndexHintReveal } from '../features/shortcuts/index-hints';
import { ShortcutsCheatSheet } from '../features/shortcuts/ShortcutsCheatSheet';
import { useAppShortcutActions } from './use-app-shortcut-actions';
import { useSandboxWsRouter } from '../features/run/use-sandbox-ws-router';

function RuntimeBody({ port }: { port: number }) {
  useSessionListRouter();
  // Idle whole-chat offload (#178): releases a chat's controller/thread subtree
  // on chat.offloaded, deferring while it's on screen. Beside useSessionListRouter
  // for the same reason (needs the live thread list under the provider).
  useOffloadRelease();
  useSandboxWsRouter();
  // The app's ONE keydown listener — every app chord dispatches through it.
  useShortcutDispatcher();
  // Hold ⌘ (Ctrl off-mac) to reveal which number each session tab answers to.
  useIndexHintReveal();

  // Register the session navigator so global toasts (mfToast) can deep-link to a
  // session via their "Open session →" CTA without reaching through to the runtime.
  // navigateToSession resolves a side-chat id to its parent + expands the panel
  // (todo #344, UI rule 2) instead of switching straight to an id aui never lists.
  const aui = useAui();
  useEffect(() => {
    setSessionNavigator((chatId) => {
      void navigateToSession(chatId, {
        switchToThread: (id) => aui.threads.switchToThread(id),
        getChat: (id) => getChat(port, id),
      });
    });
    return () => setSessionNavigator(null);
  }, [aui, port]);

  // ⌘N, ⌘K, ⌘⇧R, ⌘,, ⌘B and ⌘/ — the chords whose owner is the always-mounted
  // shell. ⌘N resolves the same target as every other "+" entry point (pill →
  // active session's project → none) and opens the draft there.
  useAppShortcutActions({ onNewSession: useStartNewSession() });

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
      className="min-h-0 flex-1 flex-col overflow-hidden bg-sidebar"
    >
      <TitleBar projectId={projectId} />
      <div className="flex min-h-0 flex-1">
        <NavRail />
        <ContentCard>
          <AppSidebar />
          <SidebarInset data-testid="main-surface-shell" className="overflow-hidden">
            <SurfaceHost />
          </SidebarInset>
        </ContentCard>
      </div>

      {/* Single app-wide outlets driven by their bridges/stores */}
      <ArchiveWorktreeDialog />
      <FilePickerDialog />
      <SpotlightPalette />
      <FindInPathModal />
      <DirectoryPickerModal />
      <ReviewPanel />
      <TagPopoverHost port={port} />
      <TasksModalHost port={port} />
      {/* Automations: the always-on runtime (toasts, WS patches, the rail's
          pending dot) and the modal host it feeds. */}
      <AutomationsRuntime />
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
