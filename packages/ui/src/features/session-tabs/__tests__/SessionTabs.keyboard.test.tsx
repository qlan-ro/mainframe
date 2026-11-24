/**
 * SessionTabs — the keyboard side of session-tab switching and of opening a
 * session in the workspace (⌘1…⌘9, ⌃Tab / ⌃⇧Tab, ⌘⇧\, ⌘\), mounted alongside
 * the real dispatcher and the real shortcut actions the way `ChatSurface` mounts
 * them. ⌘⇧\ is proven against the SAME workspace tab the tab's own context menu
 * produces — the gesture and the menu can never disagree.
 *
 * Same mocked seams as SessionTabs.workspace.test.tsx.
 */
import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantClient } from '@assistant-ui/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useLayoutStore } from '@/store/layout';
import { useIndexHintsStore } from '@/features/shortcuts/index-hints';
import { useSessionTabsStore } from '../store';

let itemsValue: Array<{ id: string; status?: string; custom?: unknown; remoteId?: string; title?: string }>;
let mainThreadIdValue: string | null;
const switchToThread = vi.fn();
const newSession = vi.fn();

let isMac = true;
vi.mock('@/features/shortcuts/platform', () => ({ isMacPlatform: () => isMac }));

vi.mock('@assistant-ui/react', async () => {
  const actual = await vi.importActual<typeof import('@assistant-ui/react')>('@assistant-ui/react');
  return {
    ...actual,
    useAui: () => ({
      threads: { switchToThread, getState: () => ({ mainThreadId: mainThreadIdValue, threadItems: itemsValue }) },
    }),
    useAuiState: (sel: (s: { threads: { threadItems: typeof itemsValue; mainThreadId: string | null } }) => unknown) =>
      sel({ threads: { threadItems: itemsValue, mainThreadId: mainThreadIdValue } }),
  };
});

vi.mock('../use-session-tabs-sync', () => ({ useSessionTabsSync: () => {} }));

vi.mock('@/features/sessions/use-projects', () => ({
  useProjects: () => ({ projects: [], loading: false, reloadProjects: () => {} }),
}));

vi.mock('@/features/sessions/new-thread/use-start-new-session', () => ({
  useStartNewSession: () => newSession,
}));

// Fork's own daemon call + useDaemonPort/useAui plumbing has its own suite
// (use-fork-chat.test.tsx); irrelevant to the keyboard gestures under test here.
vi.mock('@/features/sessions/use-fork-chat', () => ({ useForkChat: () => vi.fn() }));
// Same reasoning for useOpenSideChat (todo #344) — its own suite covers the call.
vi.mock('@/features/side-chat/use-open-side-chat', () => ({ useOpenSideChat: () => vi.fn() }));

import { useShortcutDispatcher } from '@/features/shortcuts/use-shortcut-dispatcher';
import { useConversationShortcuts } from '@/features/workspace-chat/use-conversation-shortcuts';
import { SessionTabs } from '../SessionTabs';

/** Mirrors ChatSurface: the dispatcher, the shortcut actions, and the strip. */
function Harness() {
  const aui = {
    threads: { switchToThread, getState: () => ({ mainThreadId: mainThreadIdValue, threadItems: itemsValue }) },
  } as unknown as AssistantClient;
  useShortcutDispatcher();
  useConversationShortcuts(aui);
  return <SessionTabs />;
}

const render = () => rtlRender(<Harness />, { wrapper: TooltipProvider });

const SESSIONS = [
  { id: 'chat-a', status: 'regular', custom: { projectId: 'proj-1' }, title: 'A' },
  { id: 'chat-b', status: 'regular', custom: { projectId: 'proj-1' }, title: 'B' },
  { id: 'chat-c', status: 'regular', custom: { projectId: 'proj-1' }, title: 'C' },
];

/** Three tabs pinned in strip order (a, b, c), the given one active. */
function seedThreeTabs(active: string): void {
  itemsValue = SESSIONS;
  mainThreadIdValue = active;
  useSessionTabsStore.setState({
    tabIds: ['chat-a', 'chat-b', 'chat-c'],
    previewId: null,
    draftId: null,
    hydrated: true,
  });
}

const opened = () => useLayoutStore.getState().run?.panes.flatMap((pane) => pane.tabs.map((tab) => tab.chatId)) ?? [];
const emptyWorkspace = (sessionId: string) =>
  useLayoutStore.setState({
    layout: { top: ['chat'], topFlex: {} },
    run: null,
    sessions: new Map(),
    activeSessionId: sessionId,
  });

const pressTabIndex = (digit: number) => fireEvent.keyDown(window, { code: `Digit${digit}`, metaKey: true });
const pressTabNext = () => fireEvent.keyDown(window, { code: 'Tab', ctrlKey: true });
const pressTabPrev = () => fireEvent.keyDown(window, { code: 'Tab', ctrlKey: true, shiftKey: true });
const pressOpenBeside = () => fireEvent.keyDown(window, { code: 'Backslash', key: '|', metaKey: true, shiftKey: true });

beforeEach(() => {
  isMac = true;
  switchToThread.mockReset();
  newSession.mockReset();
  useSessionTabsStore.setState({ tabIds: [], previewId: null, draftId: null, hydrated: false });
  emptyWorkspace('chat-a');
  useIndexHintsStore.setState({ revealed: false });
});

describe('⌘1…⌘9 — activate the Nth displayed tab (AC 10)', () => {
  it('⌘1 activates the first tab', () => {
    seedThreeTabs('chat-b');
    render();

    pressTabIndex(1);

    expect(switchToThread).toHaveBeenCalledWith('chat-a');
  });

  it('⌘3 activates the third tab', () => {
    seedThreeTabs('chat-a');
    render();

    pressTabIndex(3);

    expect(switchToThread).toHaveBeenCalledWith('chat-c');
  });

  it('⌃5 leaves the active tab unchanged — only three tabs are open', () => {
    seedThreeTabs('chat-a');
    render();

    pressTabIndex(5);

    expect(switchToThread).not.toHaveBeenCalled();
  });
});

describe('⌃Tab / ⌃⇧Tab — cycle tabs (AC 11)', () => {
  it('⌃Tab from the last tab wraps to the first', () => {
    seedThreeTabs('chat-c');
    render();

    pressTabNext();

    expect(switchToThread).toHaveBeenCalledWith('chat-a');
  });

  it('⌃⇧Tab from the first tab wraps to the last', () => {
    seedThreeTabs('chat-a');
    render();

    pressTabPrev();

    expect(switchToThread).toHaveBeenCalledWith('chat-c');
  });
});

const pressCloseBeside = () => fireEvent.keyDown(window, { code: 'Backslash', key: '\\', metaKey: true });

describe('⌘⇧\\ — open the next tab in the workspace from the keyboard (AC 12)', () => {
  it('opens the same tab as the context menu’s Open in Workspace', () => {
    seedThreeTabs('chat-a');
    render();
    fireEvent.contextMenu(screen.getByTestId('session-tab-chat-b'));
    fireEvent.click(screen.getByTestId('session-tab-ctx-open-workspace'));
    const fromMenu = useLayoutStore.getState().run!.panes[0]!.tabs;

    act(() => emptyWorkspace('chat-a'));
    act(() => void pressOpenBeside());

    expect(useLayoutStore.getState().run!.panes[0]!.tabs).toEqual(fromMenu);
    expect(opened()).toEqual(['chat-b']);
  });

  it('opens another each time, and stops when there is none left', () => {
    seedThreeTabs('chat-a');
    render();
    act(() => void pressOpenBeside());
    act(() => void pressOpenBeside());
    act(() => void pressOpenBeside());
    expect(opened()).toEqual(['chat-b', 'chat-c']);
  });

  it('is inert with only one session open', () => {
    itemsValue = [SESSIONS[0]!];
    mainThreadIdValue = 'chat-a';
    useSessionTabsStore.setState({ tabIds: ['chat-a'], previewId: null, draftId: null, hydrated: true });
    render();

    pressOpenBeside();

    expect(opened()).toEqual([]);
  });

  it('is inert when the conversation is an unsent draft', () => {
    itemsValue = [SESSIONS[1]!, { id: '__LOCALID_1', status: 'new' }];
    mainThreadIdValue = '__LOCALID_1';
    useSessionTabsStore.setState({ tabIds: ['chat-b'], previewId: null, draftId: '__LOCALID_1', hydrated: true });
    render();

    pressOpenBeside();

    expect(opened()).toEqual([]);
  });
});

describe('⌘\\ — close the chat in the workspace', () => {
  it('takes the front chat tab away and keeps the session', () => {
    seedThreeTabs('chat-a');
    render();
    act(() => void pressOpenBeside());

    act(() => void pressCloseBeside());

    expect(opened()).toEqual([]);
    expect(useLayoutStore.getState().layout.top).toEqual(['chat']);
    expect(useSessionTabsStore.getState().tabIds).toContain('chat-b');
  });

  it('leaves a terminal in front alone', () => {
    seedThreeTabs('chat-a');
    render();
    act(() => void useLayoutStore.getState().addRunTab({ id: 'term-1', kind: 'terminal', title: 'zsh' }));

    act(() => void pressCloseBeside());

    expect(useLayoutStore.getState().run!.panes[0]!.tabs.map((tab) => tab.id)).toEqual(['term-1']);
  });
});

describe('⌘N hint badges', () => {
  // These pin the WIRING, not the reveal timing (index-hints.test.ts owns that).
  const hints = () =>
    screen
      .queryAllByTestId(/^session-tab-hint-/)
      .map((el) => el.textContent)
      .join('');

  it('shows no badge while the modifier is not held', () => {
    seedThreeTabs('chat-a');
    render();

    expect(hints()).toBe('');
  });

  it('numbers every tab on the plain strip once revealed', () => {
    seedThreeTabs('chat-a');
    useIndexHintsStore.setState({ revealed: true });
    render();

    expect(hints()).toBe('123');
  });

  it('badges the tab that ⌘2 actually switches to', () => {
    seedThreeTabs('chat-a');
    useIndexHintsStore.setState({ revealed: true });
    render();

    expect(screen.getByTestId('session-tab-hint-chat-b').textContent).toBe('2');
    pressTabIndex(2);
    expect(switchToThread).toHaveBeenCalledWith('chat-b');
  });
});
