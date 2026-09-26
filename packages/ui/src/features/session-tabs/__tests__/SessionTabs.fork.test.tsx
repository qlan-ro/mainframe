/**
 * SessionTabs — the tab context menu's Fork item (AC 17), wired from each
 * tab's own SessionCustom through `tabForkAvailability` to `useForkChat`.
 * Same mocked seams as SessionTabs.test.tsx, except `useForkChat` is a real
 * spy here (it is the thing under test) and `useAdaptersStore` is the real
 * zustand store, seeded per test.
 */
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAdaptersStore } from '@/store/adapters';
import { useSessionTabsStore } from '../store';

let itemsValue: Array<{ id: string; status?: string; custom?: unknown; remoteId?: string; title?: string }>;
let mainThreadIdValue: string | null;
const switchToThread = vi.fn();
const newSession = vi.fn();
const forkFn = vi.fn();

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

vi.mock('@/features/sessions/use-projects', () => ({
  useProjects: () => ({ projects: [], loading: false, reloadProjects: () => {} }),
}));

vi.mock('@/features/sessions/new-thread/use-start-new-session', () => ({
  useStartNewSession: () => newSession,
}));

vi.mock('@/features/sessions/use-fork-chat', () => ({ useForkChat: () => forkFn }));

import { SessionTabs } from '../SessionTabs';

const render = () => rtlRender(<SessionTabs />, { wrapper: TooltipProvider });

const CLAUDE_ADAPTER: AdapterInfo = {
  id: 'claude',
  name: 'Claude',
  description: '',
  installed: true,
  models: [],
  capabilities: { planMode: true, fork: true },
};

const CODEX_ADAPTER: AdapterInfo = {
  id: 'codex',
  name: 'Codex',
  description: '',
  installed: true,
  models: [],
  capabilities: { planMode: true, fork: false },
};

function openMenu(tabId: string) {
  fireEvent.contextMenu(screen.getByTestId(`session-tab-${tabId}`));
}

beforeEach(() => {
  switchToThread.mockReset();
  newSession.mockReset();
  forkFn.mockReset();
  useSessionTabsStore.setState({ tabIds: [], previewId: null, draftId: null, hydrated: false });
  useAdaptersStore.setState({ byId: { claude: CLAUDE_ADAPTER, codex: CODEX_ADAPTER } });
});

describe('SessionTabs — Fork item, enabled', () => {
  it('activating it calls useForkChat with the tab id', () => {
    itemsValue = [
      {
        id: 'chat-a',
        status: 'regular',
        title: 'Fix the parser',
        custom: {
          adapterId: 'claude',
          claudeSessionId: 'sess-1',
          transcriptMissing: false,
          directoryMissing: false,
          isRunning: false,
          hasPending: false,
        },
      },
    ];
    mainThreadIdValue = 'chat-a';
    useSessionTabsStore.setState({ tabIds: [], previewId: 'chat-a', hydrated: true });
    render();

    openMenu('chat-a');
    fireEvent.click(screen.getByTestId('session-tab-ctx-fork'));

    expect(forkFn).toHaveBeenCalledWith('chat-a');
  });
});

describe('SessionTabs — Fork item, disabled', () => {
  function seedSingleTab(custom: Record<string, unknown>): void {
    itemsValue = [{ id: 'chat-a', status: 'regular', title: 'Fix the parser', custom }];
    mainThreadIdValue = 'chat-a';
    useSessionTabsStore.setState({ tabIds: [], previewId: 'chat-a', hydrated: true });
  }

  it('an adapter without the fork capability: disabled, exact reason', () => {
    seedSingleTab({
      adapterId: 'codex',
      claudeSessionId: 'sess-1',
      transcriptMissing: false,
      directoryMissing: false,
      isRunning: false,
      hasPending: false,
    });
    render();
    openMenu('chat-a');

    const fork = screen.getByTestId('session-tab-ctx-fork');
    expect(fork).toHaveAttribute('data-disabled');
    fireEvent.click(fork);
    expect(forkFn).not.toHaveBeenCalled();
  });

  it('a chat with no provider session: disabled, "Nothing to fork yet"', () => {
    seedSingleTab({
      adapterId: 'claude',
      claudeSessionId: undefined,
      transcriptMissing: false,
      directoryMissing: false,
      isRunning: false,
      hasPending: false,
    });
    render();
    openMenu('chat-a');

    expect(screen.getByTestId('session-tab-ctx-fork')).toHaveAttribute('data-disabled');
  });

  it('a working chat: disabled', () => {
    seedSingleTab({
      adapterId: 'claude',
      claudeSessionId: 'sess-1',
      transcriptMissing: false,
      directoryMissing: false,
      isRunning: true,
      hasPending: false,
    });
    render();
    openMenu('chat-a');

    expect(screen.getByTestId('session-tab-ctx-fork')).toHaveAttribute('data-disabled');
  });

  it('a waiting chat (pending permission/question): disabled', () => {
    seedSingleTab({
      adapterId: 'claude',
      claudeSessionId: 'sess-1',
      transcriptMissing: false,
      directoryMissing: false,
      isRunning: false,
      hasPending: true,
    });
    render();
    openMenu('chat-a');

    expect(screen.getByTestId('session-tab-ctx-fork')).toHaveAttribute('data-disabled');
  });

  it('an idle chat with background tasks only (isRunning false, hasPending false) is enabled', () => {
    seedSingleTab({
      adapterId: 'claude',
      claudeSessionId: 'sess-1',
      transcriptMissing: false,
      directoryMissing: false,
      isRunning: false,
      hasPending: false,
    });
    render();
    openMenu('chat-a');

    expect(screen.getByTestId('session-tab-ctx-fork')).not.toHaveAttribute('data-disabled');
  });

  it('a brand-new draft tab with no thread-list entry: disabled, "Nothing to fork yet"', () => {
    itemsValue = [];
    mainThreadIdValue = '__LOCALID_1';
    useSessionTabsStore.setState({ tabIds: ['__LOCALID_1'], previewId: null, hydrated: true });
    render();
    openMenu('__LOCALID_1');

    expect(screen.getByTestId('session-tab-ctx-fork')).toHaveAttribute('data-disabled');
  });
});
