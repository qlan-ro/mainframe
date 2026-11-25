/**
 * SessionTabs — opening a session in the workspace from its tab (W9): ⌘-click and
 * the context menu. The conversation stays where it is.
 */
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useLayoutStore } from '@/store/layout';
import { useSessionTabsStore } from '../store';

let itemsValue: Array<{ id: string; status?: string; custom?: unknown; remoteId?: string; title?: string }>;
let mainThreadIdValue: string | null;
const switchToThread = vi.fn();
const newSession = vi.fn();

vi.mock('@assistant-ui/react', async () => {
  const actual = await vi.importActual<typeof import('@assistant-ui/react')>('@assistant-ui/react');
  return {
    ...actual,
    useAui: () => ({
      threads: {
        switchToThread,
        getState: () => ({ mainThreadId: mainThreadIdValue, threadItems: itemsValue }),
      },
    }),
    useAuiState: (sel: (s: { threads: { threadItems: typeof itemsValue; mainThreadId: string | null } }) => unknown) =>
      sel({ threads: { threadItems: itemsValue, mainThreadId: mainThreadIdValue } }),
  };
});

vi.mock('../use-session-tabs-sync', () => ({ useSessionTabsSync: () => {} }));

// The avatar's project-name lookup fetches through the daemon port — inert here.
vi.mock('@/features/sessions/use-projects', () => ({
  useProjects: () => ({ projects: [], loading: false, reloadProjects: () => {} }),
}));

vi.mock('@/features/sessions/new-thread/use-start-new-session', () => ({
  useStartNewSession: () => newSession,
}));

// Fork's own daemon call + useDaemonPort/useAui plumbing has its own suite
// (use-fork-chat.test.tsx); irrelevant to the split gesture under test here.
vi.mock('@/features/sessions/use-fork-chat', () => ({ useForkChat: () => vi.fn() }));
// Same reasoning for useOpenSideChat (todo #344) — its own suite covers the call.
vi.mock('@/features/side-chat/use-open-side-chat', () => ({ useOpenSideChat: () => vi.fn() }));

import { SessionTabs } from '../SessionTabs';

const render = () => rtlRender(<SessionTabs />, { wrapper: TooltipProvider });

const SESSIONS = [
  { id: 'chat-a', status: 'regular', custom: { projectId: 'proj-1' }, title: 'Fix the parser' },
  { id: 'chat-b', status: 'regular', custom: { projectId: 'proj-1' }, title: 'Write the docs' },
  { id: 'chat-p', status: 'regular', custom: { projectId: 'proj-2' }, title: 'Peek at history' },
];

/** Pinned a + b, previewing p — chat-a active unless a case says otherwise. */
function seed(active: string | null): void {
  itemsValue = SESSIONS;
  mainThreadIdValue = active;
  useSessionTabsStore.setState({ tabIds: ['chat-a', 'chat-b'], previewId: 'chat-p', hydrated: true });
  useLayoutStore.setState({ activeSessionId: active });
}

const cmdClick = (testId: string) => fireEvent.click(screen.getByTestId(testId), { metaKey: true });
const opened = () => useLayoutStore.getState().run?.panes.flatMap((pane) => pane.tabs.map((tab) => tab.chatId)) ?? [];

beforeEach(() => {
  switchToThread.mockReset();
  newSession.mockReset();
  useSessionTabsStore.setState({ tabIds: [], previewId: null, hydrated: false });
  useLayoutStore.setState({
    layout: { top: ['chat'], topFlex: {} },
    run: null,
    sessions: new Map(),
    activeSessionId: null,
  });
});

describe('⌘-click', () => {
  it('opens the session beside the conversation, without switching to it', () => {
    seed('chat-a');
    render();

    cmdClick('session-tab-chat-p');

    expect(opened()).toEqual(['chat-p']);
    expect(useLayoutStore.getState().layout.top).toEqual(['chat', 'workspace']);
    expect(switchToThread).not.toHaveBeenCalled();
  });

  it('opens a second one as another tab, and the first again as the same tab', () => {
    seed('chat-a');
    render();

    cmdClick('session-tab-chat-p');
    cmdClick('session-tab-chat-b');
    cmdClick('session-tab-chat-p');

    expect(opened()).toEqual(['chat-p', 'chat-b']);
    expect(useLayoutStore.getState().run!.panes[0]!.active).toBe('chat-chat-p');
  });

  it.each([
    ['the conversation is an unsent draft', '__LOCALID_1', 'chat-b'],
    ['the clicked tab is one', 'chat-a', '__LOCALID_1'],
  ])('plainly switches instead when %s', (_, active, clicked) => {
    itemsValue = [...SESSIONS, { id: '__LOCALID_1', status: 'new' }];
    mainThreadIdValue = active;
    useSessionTabsStore.setState({ tabIds: ['chat-a', '__LOCALID_1', 'chat-b'], previewId: null, hydrated: true });
    render();

    cmdClick(`session-tab-${clicked}`);

    expect(opened()).toEqual([]);
    expect(switchToThread).toHaveBeenCalledWith(clicked);
  });

  it('does nothing at all on the active tab', () => {
    seed('chat-a');
    render();

    cmdClick('session-tab-chat-a');

    expect(opened()).toEqual([]);
    expect(switchToThread).not.toHaveBeenCalled();
  });
});

describe('plain click', () => {
  it('switches the conversation and opens nothing', () => {
    seed('chat-a');
    render();

    fireEvent.click(screen.getByTestId('session-tab-chat-p'));

    expect(switchToThread).toHaveBeenCalledWith('chat-p');
    expect(opened()).toEqual([]);
  });
});

describe('the tab context menu', () => {
  const rightClick = (testId: string) => fireEvent.contextMenu(screen.getByTestId(testId));

  it('opens in the workspace, like ⌘-click', () => {
    seed('chat-a');
    render();

    rightClick('session-tab-chat-p');
    fireEvent.click(screen.getByTestId('session-tab-ctx-open-workspace'));

    expect(opened()).toEqual(['chat-p']);
  });

  it('offers it as DISABLED on the active tab: it is the conversation already', () => {
    seed('chat-a');
    render();

    rightClick('session-tab-chat-a');

    expect(screen.getByTestId('session-tab-ctx-open-workspace').getAttribute('data-disabled')).not.toBeNull();
  });

  it('closes the tab from the menu, the same path as the ✕', () => {
    seed('chat-a');
    render();

    rightClick('session-tab-chat-p');
    fireEvent.click(screen.getByTestId('session-tab-ctx-close'));

    expect(useSessionTabsStore.getState().previewId).toBeNull();
  });

  it('offers Keep Open on the preview tab only', () => {
    seed('chat-a');
    render();

    rightClick('session-tab-chat-p');
    fireEvent.click(screen.getByTestId('session-tab-ctx-keep-open'));

    expect(useSessionTabsStore.getState().tabIds).toContain('chat-p');
    expect(useSessionTabsStore.getState().previewId).toBeNull();
  });
});

describe('closing a session tab', () => {
  it('leaves the same session’s workspace tab alone', () => {
    seed('chat-a');
    render();
    cmdClick('session-tab-chat-b');

    fireEvent.click(screen.getByTestId('session-tab-close-chat-b'));

    expect(useSessionTabsStore.getState().tabIds).toEqual(['chat-a']);
    expect(opened()).toEqual(['chat-b']);
  });
});
