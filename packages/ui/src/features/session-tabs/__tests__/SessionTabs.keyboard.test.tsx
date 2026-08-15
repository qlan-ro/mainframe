/**
 * SessionTabs — the keyboard side of session-tab switching and open-in-split
 * (⌘1…⌘9, ⌃Tab / ⌃⇧Tab, ⌘⇧\), mounted alongside the real dispatcher and the
 * real zone shortcut actions the way `ChatSurface` mounts them. ⌘⇧\ is proven
 * against the SAME zones-store transition the tab's own context menu produces
 * — the keyboard gesture and the menu action can never disagree about what is
 * splittable (fact 18).
 *
 * Same mocked seams as SessionTabs.split.test.tsx.
 */
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantClient } from '@assistant-ui/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useZonesStore } from '@/features/chat/zones/zones-store';
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

vi.mock('@/features/sessions/new-thread/use-new-chat-hotkey-handler', () => ({
  useNewChatHotkeyHandler: () => newSession,
}));

import { useShortcutDispatcher } from '@/features/shortcuts/use-shortcut-dispatcher';
import { useZoneShortcutActions } from '@/features/chat/zones/use-zone-shortcut-actions';
import { SessionTabs } from '../SessionTabs';

/** Mirrors ChatSurface: the dispatcher, the zone shortcut actions, and the strip. */
function Harness() {
  const aui = {
    threads: { switchToThread, getState: () => ({ mainThreadId: mainThreadIdValue, threadItems: itemsValue }) },
  } as unknown as AssistantClient;
  useShortcutDispatcher();
  useZoneShortcutActions(aui);
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

const zones = () => useZonesStore.getState().zones;

const pressTabIndex = (digit: number) => fireEvent.keyDown(window, { code: `Digit${digit}`, metaKey: true });
const pressTabNext = () => fireEvent.keyDown(window, { code: 'Tab', ctrlKey: true });
const pressTabPrev = () => fireEvent.keyDown(window, { code: 'Tab', ctrlKey: true, shiftKey: true });
const pressOpenInSplit = () =>
  fireEvent.keyDown(window, { code: 'Backslash', key: '|', metaKey: true, shiftKey: true });

beforeEach(() => {
  isMac = true;
  switchToThread.mockReset();
  newSession.mockReset();
  useSessionTabsStore.setState({ tabIds: [], previewId: null, draftId: null, hydrated: false });
  useZonesStore.setState({ zones: null, focusedIndex: 0 });
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

describe('⌘⇧\\ — open the active session in a split from the keyboard (AC 12)', () => {
  it('produces the same zones state as the tab context menu’s Open in Split action', () => {
    seedThreeTabs('chat-a');
    render();

    // The menu's own path, captured first as the reference state.
    fireEvent.contextMenu(screen.getByTestId('session-tab-chat-b'));
    fireEvent.click(screen.getByTestId('session-tab-ctx-open-split'));
    const menuResult = zones();
    expect(menuResult).toEqual(['chat-a', 'chat-b']);

    useZonesStore.setState({ zones: null, focusedIndex: 0 });

    pressOpenInSplit();

    expect(zones()).toEqual(menuResult);
  });

  it('retargets the unfocused zone while a split is visible, matching the menu action on the third session', () => {
    seedThreeTabs('chat-a');
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    render();

    fireEvent.contextMenu(screen.getByTestId('session-tab-chat-c'));
    fireEvent.click(screen.getByTestId('session-tab-ctx-open-split'));
    const menuResult = zones();
    expect(menuResult).toEqual(['chat-a', 'chat-c']);

    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });

    pressOpenInSplit();

    expect(zones()).toEqual(menuResult);
  });

  it('is inert with only one session open — no partner to split with', () => {
    itemsValue = [SESSIONS[0]!];
    mainThreadIdValue = 'chat-a';
    useSessionTabsStore.setState({ tabIds: ['chat-a'], previewId: null, draftId: null, hydrated: true });
    render();

    pressOpenInSplit();

    expect(zones()).toBeNull();
  });

  it('is inert when the only two sessions are already the visible pair', () => {
    itemsValue = [SESSIONS[0]!, SESSIONS[1]!];
    mainThreadIdValue = 'chat-a';
    useSessionTabsStore.setState({ tabIds: ['chat-a', 'chat-b'], previewId: null, draftId: null, hydrated: true });
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    render();

    pressOpenInSplit();

    expect(zones()).toEqual(['chat-a', 'chat-b']);
  });

  it('is inert when the active session is an unsent draft — it cannot anchor a split', () => {
    itemsValue = [SESSIONS[1]!, { id: '__LOCALID_1', status: 'new' }];
    mainThreadIdValue = '__LOCALID_1';
    useSessionTabsStore.setState({ tabIds: ['chat-b'], previewId: null, draftId: '__LOCALID_1', hydrated: true });
    render();

    pressOpenInSplit();

    expect(zones()).toBeNull();
  });
});

describe('⌘N hint badges', () => {
  // These pin the WIRING, not the reveal timing (index-hints.test.ts owns that):
  // the strip renders pills from four separate call sites, and a prop missing
  // from the plain non-split one shipped badges that appeared only while split.
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

  it('numbers the regrouped order while split, so the badge matches what ⌘N opens', () => {
    seedThreeTabs('chat-a');
    // a and c pair up and regroup adjacently, making c the second tab.
    useZonesStore.setState({ zones: ['chat-a', 'chat-c'], focusedIndex: 0 });
    useIndexHintsStore.setState({ revealed: true });
    render();

    expect(hints()).toBe('123');
    expect(screen.getByTestId('session-tab-hint-chat-c').textContent).toBe('2');
    expect(screen.getByTestId('session-tab-hint-chat-b').textContent).toBe('3');
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
