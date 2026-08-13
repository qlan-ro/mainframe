/**
 * SessionTabs — the strip's rendering and its three affordances over the
 * pinned-preview-draft model: the peek and then the unsent draft render LAST,
 * pinning promotes the peek in place, and closing resolves the next active over
 * the DISPLAYED order (so a pinned tab's right neighbor can be the preview).
 *
 * The membership seam is mocked away: `useSessionTabsSync` would open a tab for
 * whatever thread is active and rewrite the state each test seeds. It has its
 * own suites (use-session-tabs-sync*.test.tsx).
 */
import { fireEvent, render as rtlRender, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
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

/** Pinned a + b, previewing p — the arrangement every case below varies from. */
function seed(active: string | null): void {
  itemsValue = SESSIONS;
  mainThreadIdValue = active;
  useSessionTabsStore.setState({ tabIds: ['chat-a', 'chat-b'], previewId: 'chat-p', hydrated: true });
}

const tabOrder = () =>
  within(screen.getByTestId('session-tabs'))
    .getAllByRole('tab')
    .map((el) => el.getAttribute('data-testid'));

beforeEach(() => {
  switchToThread.mockReset();
  newSession.mockReset();
  useSessionTabsStore.setState({ tabIds: [], previewId: null, draftId: null, hydrated: false });
});

describe('the draft tab', () => {
  /** The seeded strip plus the unsent draft the user just created. */
  function seedWithDraft(): void {
    seed('__LOCALID_1');
    itemsValue = [...SESSIONS, { id: '__LOCALID_1', status: 'new' }];
    useSessionTabsStore.setState({ draftId: '__LOCALID_1' });
  }

  it('renders last, after the preview — a new session is always the end tab', () => {
    seedWithDraft();

    render();

    expect(tabOrder()).toEqual([
      'session-tab-chat-a',
      'session-tab-chat-b',
      'session-tab-chat-p',
      'session-tab-__LOCALID_1',
    ]);
  });

  it('reads as kept open, not as a peek: no italic title, no pin button', () => {
    seedWithDraft();

    render();

    expect(screen.getByText('New Session').className).not.toContain('italic');
    expect(screen.queryByTestId('session-tab-pin-__LOCALID_1')).toBeNull();
    expect(screen.getByTestId('session-tab-close-__LOCALID_1')).toBeDefined();
  });
});

describe('rendering', () => {
  it('renders the pinned tabs in order with the preview last', () => {
    seed('chat-a');

    render();

    expect(tabOrder()).toEqual(['session-tab-chat-a', 'session-tab-chat-b', 'session-tab-chat-p']);
  });

  it('renders the preview tab even when nothing is pinned', () => {
    itemsValue = SESSIONS;
    mainThreadIdValue = 'chat-p';
    useSessionTabsStore.setState({ tabIds: [], previewId: 'chat-p', hydrated: true });

    render();

    expect(tabOrder()).toEqual(['session-tab-chat-p']);
  });

  it('renders an empty strip when no session is open', () => {
    itemsValue = SESSIONS;
    mainThreadIdValue = null;
    useSessionTabsStore.setState({ tabIds: [], previewId: null, hydrated: true });

    render();

    expect(screen.queryAllByRole('tab')).toEqual([]);
    expect(screen.getByTestId('session-tabs-new')).toBeDefined();
  });

  it('marks only the preview tab with data-preview and an italic title', () => {
    seed('chat-a');

    render();

    expect(screen.getByTestId('session-tab-chat-p').getAttribute('data-preview')).toBe('true');
    expect(screen.getByTestId('session-tab-chat-a').getAttribute('data-preview')).toBe('false');
    expect(screen.getByText('Peek at history').className).toContain('italic');
    expect(screen.getByText('Fix the parser').className).not.toContain('italic');
  });

  it('gives only the preview tab a pin button', () => {
    seed('chat-a');

    render();

    expect(screen.getByTestId('session-tab-pin-chat-p')).toBeDefined();
    expect(screen.queryByTestId('session-tab-pin-chat-a')).toBeNull();
    expect(screen.queryByTestId('session-tab-pin-chat-b')).toBeNull();
  });

  it('marks the active tab selected and every other tab not', () => {
    seed('chat-p');

    render();

    expect(screen.getByTestId('session-tab-chat-p').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('session-tab-chat-a').getAttribute('aria-selected')).toBe('false');
  });
});

describe('pinning', () => {
  it('the pin button moves the preview into the pinned set, last', () => {
    seed('chat-a');
    render();

    fireEvent.click(screen.getByTestId('session-tab-pin-chat-p'));

    const state = useSessionTabsStore.getState();
    expect(state.tabIds).toEqual(['chat-a', 'chat-b', 'chat-p']);
    expect(state.previewId).toBeNull();
  });

  it('the pin button does not switch the active session', () => {
    seed('chat-a');
    render();

    fireEvent.click(screen.getByTestId('session-tab-pin-chat-p'));

    expect(switchToThread).not.toHaveBeenCalled();
  });

  it('double-clicking the preview tab pins it', () => {
    seed('chat-a');
    render();

    fireEvent.doubleClick(screen.getByTestId('session-tab-chat-p'));

    const state = useSessionTabsStore.getState();
    expect(state.tabIds).toEqual(['chat-a', 'chat-b', 'chat-p']);
    expect(state.previewId).toBeNull();
  });

  it('double-clicking a pinned tab changes nothing', () => {
    seed('chat-a');
    render();

    fireEvent.doubleClick(screen.getByTestId('session-tab-chat-b'));

    const state = useSessionTabsStore.getState();
    expect(state.tabIds).toEqual(['chat-a', 'chat-b']);
    expect(state.previewId).toBe('chat-p');
  });
});

describe('activation', () => {
  it('clicking a tab switches to that session', () => {
    seed('chat-a');
    render();

    fireEvent.click(screen.getByTestId('session-tab-chat-p'));

    expect(switchToThread).toHaveBeenCalledWith('chat-p');
  });

  it('clicking the active tab switches nothing', () => {
    seed('chat-a');
    render();

    fireEvent.click(screen.getByTestId('session-tab-chat-a'));

    expect(switchToThread).not.toHaveBeenCalled();
  });
});

describe('closing', () => {
  it('closing the preview empties only the slot', () => {
    seed('chat-a');
    render();

    fireEvent.click(screen.getByTestId('session-tab-close-chat-p'));

    const state = useSessionTabsStore.getState();
    expect(state.tabIds).toEqual(['chat-a', 'chat-b']);
    expect(state.previewId).toBeNull();
    expect(switchToThread).not.toHaveBeenCalled();
  });

  it('closing the ACTIVE preview falls back to the pinned tab on its left', () => {
    seed('chat-p');
    render();

    fireEvent.click(screen.getByTestId('session-tab-close-chat-p'));

    expect(switchToThread).toHaveBeenCalledWith('chat-b');
    expect(useSessionTabsStore.getState().previewId).toBeNull();
  });

  it('closing the last pinned tab activates the preview to its right', () => {
    // The display order is what resolves the neighbor, so the preview counts.
    seed('chat-b');
    render();

    fireEvent.click(screen.getByTestId('session-tab-close-chat-b'));

    expect(switchToThread).toHaveBeenCalledWith('chat-p');
    const state = useSessionTabsStore.getState();
    expect(state.tabIds).toEqual(['chat-a']);
    expect(state.previewId).toBe('chat-p');
  });

  it('closing an inactive tab keeps the active session', () => {
    seed('chat-a');
    render();

    fireEvent.click(screen.getByTestId('session-tab-close-chat-b'));

    expect(switchToThread).not.toHaveBeenCalled();
    expect(useSessionTabsStore.getState().tabIds).toEqual(['chat-a']);
  });

  it('closing the only open tab starts the new-session flow', () => {
    itemsValue = SESSIONS;
    mainThreadIdValue = 'chat-p';
    useSessionTabsStore.setState({ tabIds: [], previewId: 'chat-p', hydrated: true });
    render();

    fireEvent.click(screen.getByTestId('session-tab-close-chat-p'));

    expect(newSession).toHaveBeenCalledTimes(1);
    expect(switchToThread).not.toHaveBeenCalled();
  });
});

describe('titles', () => {
  it('labels a tab with no thread-list entry as a new session', () => {
    itemsValue = SESSIONS;
    mainThreadIdValue = '__LOCALID_1';
    useSessionTabsStore.setState({ tabIds: ['__LOCALID_1'], previewId: null, hydrated: true });

    render();

    expect(within(screen.getByTestId('session-tab-__LOCALID_1')).getByText('New Session')).toBeDefined();
  });
});
