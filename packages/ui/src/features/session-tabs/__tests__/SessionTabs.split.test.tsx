/**
 * SessionTabs — the ⌘-click gesture (open-in-split, P2 of
 * docs/plans/2026-08-11-split-chat-zones.md).
 *
 * ⌘-click means "show this session BESIDE the focused one": with no split it
 * opens one from the active tab, and with a split open it retargets the
 * UNFOCUSED slot, so the chat you are looking at stays put. Everything the
 * split cannot express — a tab already visible, a draft on either end, the
 * active tab itself — degrades to the plain focus click.
 *
 * Same mocked seams as SessionTabs.test.tsx; the zones store is the real one.
 */
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useZonesStore } from '@/features/chat/zones/zones-store';
import { useSessionTabsStore } from '../store';

let itemsValue: Array<{ id: string; status?: string; custom?: unknown; remoteId?: string; title?: string }>;
let mainThreadIdValue: string | null;
const switchToThread = vi.fn();
const newSession = vi.fn();

vi.mock('@assistant-ui/react', async () => {
  const actual = await vi.importActual<typeof import('@assistant-ui/react')>('@assistant-ui/react');
  return {
    ...actual,
    useAui: () => ({ threads: { switchToThread } }),
    useAuiState: (sel: (s: { threads: { threadItems: typeof itemsValue; mainThreadId: string | null } }) => unknown) =>
      sel({ threads: { threadItems: itemsValue, mainThreadId: mainThreadIdValue } }),
  };
});

vi.mock('../use-session-tabs-sync', () => ({ useSessionTabsSync: () => {} }));

// The avatar's project-name lookup fetches through the daemon port — inert here.
vi.mock('@/features/sessions/use-projects', () => ({
  useProjects: () => ({ projects: [], loading: false, reloadProjects: () => {} }),
}));

vi.mock('@/features/sessions/new-thread/use-new-chat-hotkey-handler', () => ({
  useNewChatHotkeyHandler: () => newSession,
}));

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
}

const cmdClick = (testId: string) => fireEvent.click(screen.getByTestId(testId), { metaKey: true });

const zones = () => useZonesStore.getState().zones;
const focusedIndex = () => useZonesStore.getState().focusedIndex;

beforeEach(() => {
  switchToThread.mockReset();
  newSession.mockReset();
  useSessionTabsStore.setState({ tabIds: [], previewId: null, hydrated: false });
  useZonesStore.setState({ zones: null, focusedIndex: 0 });
});

describe('⌘-click with no split open', () => {
  it('splits the active session against the clicked one, active on the left', () => {
    seed('chat-a');
    render();

    cmdClick('session-tab-chat-p');

    expect(zones()).toEqual(['chat-a', 'chat-p']);
    expect(focusedIndex()).toBe(0);
  });

  it('does not switch the focused session when it opens the split', () => {
    seed('chat-a');
    render();

    cmdClick('session-tab-chat-p');

    expect(switchToThread).not.toHaveBeenCalled();
  });

  it('plainly switches instead when the active session is an unsent draft', () => {
    // A draft cannot be a zone, so there is nothing to split against.
    itemsValue = [...SESSIONS, { id: '__LOCALID_1', status: 'new' }];
    mainThreadIdValue = '__LOCALID_1';
    useSessionTabsStore.setState({ tabIds: ['__LOCALID_1', 'chat-b'], previewId: null, hydrated: true });
    render();

    cmdClick('session-tab-chat-b');

    expect(zones()).toBeNull();
    expect(switchToThread).toHaveBeenCalledWith('chat-b');
  });

  it('plainly switches instead when the CLICKED tab is an unsent draft', () => {
    itemsValue = [...SESSIONS, { id: '__LOCALID_1', status: 'new' }];
    mainThreadIdValue = 'chat-a';
    useSessionTabsStore.setState({ tabIds: ['chat-a', '__LOCALID_1'], previewId: null, hydrated: true });
    render();

    cmdClick('session-tab-__LOCALID_1');

    expect(zones()).toBeNull();
    expect(switchToThread).toHaveBeenCalledWith('__LOCALID_1');
  });

  it('does nothing at all on the active tab', () => {
    seed('chat-a');
    render();

    cmdClick('session-tab-chat-a');

    expect(zones()).toBeNull();
    expect(switchToThread).not.toHaveBeenCalled();
  });
});

describe('⌘-click while split', () => {
  it('retargets the RIGHT zone while the left one has focus', () => {
    seed('chat-a');
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    render();

    cmdClick('session-tab-chat-p');

    expect(zones()).toEqual(['chat-a', 'chat-p']);
    expect(focusedIndex()).toBe(0);
    expect(switchToThread).not.toHaveBeenCalled();
  });

  it('retargets the LEFT zone while the right one has focus', () => {
    seed('chat-b');
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 1 });
    render();

    cmdClick('session-tab-chat-p');

    expect(zones()).toEqual(['chat-p', 'chat-b']);
    expect(focusedIndex()).toBe(1);
    expect(switchToThread).not.toHaveBeenCalled();
  });

  it('just focuses a session that is already visible in the other zone', () => {
    seed('chat-a');
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    render();

    cmdClick('session-tab-chat-b');

    expect(switchToThread).toHaveBeenCalledWith('chat-b');
    expect(zones()).toEqual(['chat-a', 'chat-b']);
  });
});

describe('plain click', () => {
  it('switches the focused session and never opens a split', () => {
    seed('chat-a');
    render();

    fireEvent.click(screen.getByTestId('session-tab-chat-p'));

    expect(switchToThread).toHaveBeenCalledWith('chat-p');
    expect(zones()).toBeNull();
  });

  it('leaves an open split pair alone — the reconciler moves focus, not the click', () => {
    seed('chat-a');
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    render();

    fireEvent.click(screen.getByTestId('session-tab-chat-p'));

    expect(switchToThread).toHaveBeenCalledWith('chat-p');
    expect(zones()).toEqual(['chat-a', 'chat-b']);
  });
});

describe('the tab context menu', () => {
  // The menu adds no capability — it makes the ⌘-click / ⌘\ gestures reachable
  // without knowing them. So each case asserts the SAME zones-store transition
  // the keyboard gesture produces.
  const rightClick = (testId: string) => fireEvent.contextMenu(screen.getByTestId(testId));

  it('opens a split against the focused session, like ⌘-click', () => {
    seed('chat-a');
    render();

    rightClick('session-tab-chat-p');
    fireEvent.click(screen.getByTestId('session-tab-ctx-open-split'));

    expect(zones()).toEqual(['chat-a', 'chat-p']);
    expect(focusedIndex()).toBe(0);
  });

  it('offers Open in Split as DISABLED on the active tab — there is nothing to split against', () => {
    seed('chat-a');
    render();

    rightClick('session-tab-chat-a');

    expect(screen.getByTestId('session-tab-ctx-open-split').getAttribute('data-disabled')).not.toBeNull();
    expect(zones()).toBeNull();
  });

  it('offers Close Split on a member instead of Open in Split', () => {
    seed('chat-a');
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    render();

    rightClick('session-tab-chat-b');

    expect(screen.getByTestId('session-tab-ctx-close-split')).toBeTruthy();
    expect(screen.queryByTestId('session-tab-ctx-open-split')).toBeNull();
  });

  it('dissolves the pair and lands on the session you pointed at', () => {
    seed('chat-a');
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    render();

    rightClick('session-tab-chat-b');
    fireEvent.click(screen.getByTestId('session-tab-ctx-close-split'));

    expect(zones()).toBeNull();
    expect(switchToThread).toHaveBeenCalledWith('chat-b');
    // Dissolving the split must not close either session's tab.
    expect(useSessionTabsStore.getState().tabIds).toEqual(['chat-a', 'chat-b']);
  });

  it('dissolves a PARKED pair without yanking focus off what you are reading', () => {
    seed('chat-p');
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    render();

    rightClick('session-tab-chat-a');
    fireEvent.click(screen.getByTestId('session-tab-ctx-close-split'));

    expect(zones()).toBeNull();
    expect(switchToThread).not.toHaveBeenCalled();
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
    expect(screen.getByTestId('session-tab-ctx-keep-open')).toBeTruthy();
    fireEvent.click(screen.getByTestId('session-tab-ctx-keep-open'));

    expect(useSessionTabsStore.getState().tabIds).toContain('chat-p');
    expect(useSessionTabsStore.getState().previewId).toBeNull();
  });
});

describe("the pair's shared underline", () => {
  // The underline is the SELECTION signal, and a split can be open while parked
  // behind a third session. Lighting it on membership rather than on visibility
  // is what used to make three tabs read as selected at once.
  const groupMark = () => screen.getByTestId('session-tabs-zone-group').className;

  it('is lit while a member of the pair is the focused session', () => {
    seed('chat-a');
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    render();

    expect(groupMark()).toContain('after:opacity-100');
  });

  it('goes dark while the pair is PARKED behind another session', () => {
    seed('chat-p');
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    render();

    expect(groupMark()).toContain('after:opacity-0');
    expect(groupMark()).not.toContain('after:opacity-100');
  });

  it('leaves the parked pair with exactly one lit tab in the strip — the focused one', () => {
    seed('chat-p');
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    render();

    expect(screen.getByTestId('session-tab-chat-p').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('session-tab-chat-a').getAttribute('aria-selected')).toBe('false');
    expect(screen.getByTestId('session-tab-chat-b').getAttribute('aria-selected')).toBe('false');
  });
});

describe('closing a zone tab', () => {
  it("collapses the split to the other chat when the FOCUSED zone's tab closes", () => {
    seed('chat-a');
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    render();

    fireEvent.click(screen.getByTestId('session-tab-close-chat-a'));

    expect(zones()).toBeNull();
    expect(useSessionTabsStore.getState().tabIds).toEqual(['chat-b']);
    expect(switchToThread).toHaveBeenCalledWith('chat-b');
  });

  it("collapses without a focus switch when the UNFOCUSED zone's tab closes", () => {
    seed('chat-a');
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    render();

    fireEvent.click(screen.getByTestId('session-tab-close-chat-b'));

    expect(zones()).toBeNull();
    expect(useSessionTabsStore.getState().tabIds).toEqual(['chat-a']);
    expect(switchToThread).not.toHaveBeenCalled();
  });

  it('closes a non-zone tab normally while split — the pair survives', () => {
    seed('chat-a');
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    render();

    fireEvent.click(screen.getByTestId('session-tab-close-chat-p'));

    expect(zones()).toEqual(['chat-a', 'chat-b']);
    expect(useSessionTabsStore.getState().previewId).toBeNull();
  });
});
