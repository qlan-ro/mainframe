// @vitest-environment jsdom

/**
 * AppShell render isolation: the shell's subscribing hooks (the session-list
 * router, the active identity, the switch watchers) churn on every thread-list
 * reload, chat switch and active-chat update. They live in a leaf that renders
 * nothing, so that churn must never re-render the chrome — the title bar, the
 * rail, the sidebar, the surface host and the app-wide modal hosts.
 *
 * Every chrome module is a render-counting stub; the hooks are stubs that
 * subscribe to one test store, which the test bumps to stand in for a reload,
 * a switch or a background `chat.updated`.
 */
import { act, render } from '@testing-library/react';
import { useSyncExternalStore, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const { renders, churn, counted } = vi.hoisted(() => {
  const renders = new Map<string, number>();
  const listeners = new Set<() => void>();
  let version = 0;
  const churn = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => version,
    bump: () => {
      version += 1;
      listeners.forEach((listener) => listener());
    },
  };
  const counted =
    (name: string) =>
    ({ children }: { children?: ReactNode }) => {
      renders.set(name, (renders.get(name) ?? 0) + 1);
      return <>{children}</>;
    };
  return { renders, churn, counted };
});

/** A shell hook that re-runs whenever the test store moves. */
function useChurn(name: string) {
  renders.set(name, (renders.get(name) ?? 0) + 1);
  useSyncExternalStore(churn.subscribe, churn.get);
}

vi.mock('@assistant-ui/react', () => ({
  AssistantRuntimeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAui: () => ({ threads: { switchToThread: vi.fn() } }),
}));

vi.mock('../../features/sessions/runtime/use-sessions-thread-list', () => ({ useSessionsThreadList: () => ({}) }));
vi.mock('../../features/sessions/ws/use-session-list-router', () => ({
  useSessionListRouter: () => useChurn('useSessionListRouter'),
}));
vi.mock('../../features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => {
    useChurn('useActiveIdentity');
    return { projectName: 'Alpha', projectId: 'proj-a', isWorktree: false, noProject: false };
  },
}));
vi.mock('../../layout/use-return-to-chats-on-activate', () => ({
  useReturnToChatsOnActivate: () => useChurn('useReturnToChatsOnActivate'),
}));
vi.mock('../../features/sessions/runtime/use-offload-release', () => ({ useOffloadRelease: () => undefined }));
vi.mock('../../features/sessions/new-thread/use-start-new-session', () => ({ useStartNewSession: () => () => {} }));
vi.mock('../../features/tour/use-first-run-tour', () => ({ useFirstRunTour: () => false }));
vi.mock('../../features/shortcuts/use-shortcut-dispatcher', () => ({ useShortcutDispatcher: () => undefined }));
vi.mock('../../features/shortcuts/index-hints', () => ({ useIndexHintReveal: () => undefined }));
vi.mock('../use-app-shortcut-actions', () => ({ useAppShortcutActions: () => undefined }));
vi.mock('../../features/run/use-sandbox-ws-router', () => ({ useSandboxWsRouter: () => undefined }));

vi.mock('../../layout/TitleBar', () => ({ TitleBar: counted('TitleBar') }));
vi.mock('../../layout/NavRail', () => ({ NavRail: counted('NavRail') }));
vi.mock('../../layout/AppSidebar', () => ({ AppSidebar: counted('AppSidebar') }));
vi.mock('../../layout/ContentCard', () => ({ ContentCard: counted('ContentCard') }));
vi.mock('../../layout/SurfaceHost', () => ({ SurfaceHost: counted('SurfaceHost') }));
vi.mock('@/features/files/DirectoryPickerModal', () => ({ DirectoryPickerModal: counted('DirectoryPickerModal') }));
vi.mock('@/features/files/FindInPathModal', () => ({ FindInPathModal: counted('FindInPathModal') }));
vi.mock('@/features/palette/SpotlightPalette', () => ({ SpotlightPalette: counted('SpotlightPalette') }));
vi.mock('@/features/sessions/ArchiveWorktreeDialog', () => ({
  ArchiveWorktreeDialog: counted('ArchiveWorktreeDialog'),
}));
vi.mock('@/features/sessions/TagPopoverHost', () => ({ TagPopoverHost: counted('TagPopoverHost') }));
vi.mock('../../features/files/FilePickerDialog', () => ({ FilePickerDialog: counted('FilePickerDialog') }));
vi.mock('../../features/tasks/TasksModalHost', () => ({ TasksModalHost: counted('TasksModalHost') }));
vi.mock('../../features/tasks/TasksSurface', () => ({ TasksSurface: counted('TasksSurface') }));
vi.mock('../../features/automations/AutomationsHost', () => ({ AutomationsHost: counted('AutomationsHost') }));
vi.mock('../../features/automations/AutomationsRuntime', () => ({ AutomationsRuntime: counted('AutomationsRuntime') }));
vi.mock('../../features/automations/AutomationsSurface', () => ({ AutomationsSurface: counted('AutomationsSurface') }));
vi.mock('../../features/setup-advisor/AdvisorSurface', () => ({ AdvisorSurface: counted('AdvisorSurface') }));
vi.mock('../../features/settings/SettingsSurface', () => ({ SettingsSurface: counted('SettingsSurface') }));
vi.mock('../../components/overlays/ConfirmDialogHost', () => ({ ConfirmDialogHost: counted('ConfirmDialogHost') }));
vi.mock('../../features/review/ReviewPanel', () => ({ ReviewPanel: counted('ReviewPanel') }));
vi.mock('../../features/tour/TutorialOverlay', () => ({ TutorialOverlay: counted('TutorialOverlay') }));
vi.mock('../../features/shortcuts/ShortcutsCheatSheet', () => ({
  ShortcutsCheatSheet: counted('ShortcutsCheatSheet'),
}));

import { AppShell } from '../AppShell';

const CHROME = [
  'TitleBar',
  'NavRail',
  'AppSidebar',
  'ContentCard',
  'SurfaceHost',
  'ArchiveWorktreeDialog',
  'FilePickerDialog',
  'SpotlightPalette',
  'FindInPathModal',
  'DirectoryPickerModal',
  'ReviewPanel',
  'TagPopoverHost',
  'TasksModalHost',
  'AutomationsRuntime',
  'AutomationsHost',
  'ConfirmDialogHost',
  'ShortcutsCheatSheet',
];

describe('AppShell render isolation', () => {
  it('shell hook churn re-renders the hook leaf, never the chrome', () => {
    render(<AppShell port={31415} />);
    for (const name of CHROME) expect(renders.get(name), name).toBeGreaterThan(0);
    const before = new Map(renders);

    for (let i = 0; i < 5; i++) act(() => churn.bump());

    for (const name of CHROME) expect(renders.get(name), name).toBe(before.get(name));
    expect(renders.get('useSessionListRouter')).toBe(before.get('useSessionListRouter')! + 5);
    expect(renders.get('useActiveIdentity')).toBe(before.get('useActiveIdentity')! + 5);
  });
});
