// @vitest-environment jsdom

/**
 * The windowed list's row identity. Rows own state — an open context menu, an
 * inline rename — and that state belongs to a session, not to a position, so it
 * must follow the session when an agent's activity reorders the list under it.
 *
 * Real rows over the real Virtuoso (jsdom lays nothing out, so its mock context
 * supplies the sizes).
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FC } from 'react';
import { VirtuosoMockContext } from 'react-virtuoso';
import {
  AssistantRuntimeProvider,
  useAuiState,
  useExternalStoreRuntime,
  useRemoteThreadListRuntime,
} from '@assistant-ui/react';
import type { AssistantRuntime, RemoteThreadListAdapter, ThreadMessage } from '@assistant-ui/react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { SidebarScrollRegion } from '@/features/shared/SidebarScrollRegion';
import { DaemonPortProvider } from '../runtime/daemon-port-context';
import type { SessionItem } from '../view-model/chat-to-thread-custom';
import type { SessionGroupResult } from '../view-model/group-sessions';
import { SessionList } from '../SessionList';

const NAMES = ['alpha', 'beta', 'gamma', 'delta'];
const archived: string[] = [];
const renamed: [string, string][] = [];

const threads = NAMES.map((name) => ({ status: 'regular' as const, remoteId: name, title: name }));

const adapter: RemoteThreadListAdapter = {
  list: async () => ({ threads }),
  fetch: async (id: string) => threads.find((t) => t.remoteId === id) ?? threads[0]!,
  rename: async (id: string, title: string) => {
    renamed.push([id, title]);
  },
  archive: async (id: string) => {
    archived.push(id);
  },
  unarchive: async () => {},
  delete: async () => {},
  initialize: async (id: string) => ({ remoteId: id, externalId: undefined }),
  generateTitle: () => Promise.resolve(new ReadableStream()),
};

const useStubThreadRuntime = (): AssistantRuntime =>
  useExternalStoreRuntime<ThreadMessage>({ isRunning: false, messages: [], onNew: async () => {} });

function item(id: string): SessionItem {
  return {
    id,
    remoteId: id,
    title: id,
    status: 'regular',
    custom: {
      projectId: 'proj-a',
      adapterId: 'claude',
      tags: [],
      pinned: false,
      temporary: false,
      noProject: false,
      status: 'active',
      displayStatus: 'idle',
      hasPending: false,
      detectedPrs: [],
      worktreeMissing: false,
      transcriptMissing: false,
      updatedAt: Date.now(),
    },
  };
}

const group = (label: string, ids: string[]): SessionGroupResult => ({ label, items: ids.map(item), depths: {} });

const Loaded: FC<{ groups: SessionGroupResult[] }> = ({ groups }) => {
  const loaded = useAuiState((s) => s.threads.threadItems.some((t) => t.id === 'alpha'));
  return loaded ? <SessionList groups={groups} /> : null;
};

const Harness: FC<{ groups: SessionGroupResult[] }> = ({ groups }) => {
  const runtime = useRemoteThreadListRuntime({ runtimeHook: useStubThreadRuntime, adapter });
  return (
    <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 28 }}>
      <DaemonPortProvider port={31415}>
        <SidebarProvider>
          <AssistantRuntimeProvider runtime={runtime}>
            <SidebarScrollRegion>
              <Loaded groups={groups} />
            </SidebarScrollRegion>
          </AssistantRuntimeProvider>
        </SidebarProvider>
      </DaemonPortProvider>
    </VirtuosoMockContext.Provider>
  );
};

async function mount(groups: SessionGroupResult[]) {
  const view = render(<Harness groups={groups} />);
  await waitFor(() => expect(row('alpha')).toBeTruthy());
  return { reorder: (next: SessionGroupResult[]) => act(async () => view.rerender(<Harness groups={next} />)) };
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-chat-id="${id}"]`);
const order = () => screen.getAllByTestId('sessions-row').map((r) => r.getAttribute('data-chat-id'));

async function startRename(id: string) {
  const user = userEvent.setup();
  fireEvent.contextMenu(row(id)!);
  await user.click(await screen.findByTestId('sessions-ctx-rename'));
  return screen.findByTestId<HTMLInputElement>('sessions-rename-input');
}

beforeEach(() => {
  archived.length = 0;
  renamed.length = 0;
});

describe('SessionListVirtuoso row identity', () => {
  it('archives the session the menu was opened on when the list reorders under it', async () => {
    const { reorder } = await mount([group('Today', ['alpha', 'beta', 'gamma', 'delta'])]);
    fireEvent.contextMenu(row('beta')!);
    await screen.findByTestId('sessions-ctx-archive');

    await reorder([group('Today', ['delta', 'alpha', 'beta', 'gamma'])]);
    expect(order()).toEqual(['delta', 'alpha', 'beta', 'gamma']);
    await userEvent.click(screen.getByTestId('sessions-ctx-archive'));

    await waitFor(() => expect(archived).toEqual(['beta']));
  });

  it('archives the right session when its menu is open as it moves to another group', async () => {
    const { reorder } = await mount([group('Today', ['alpha']), group('Earlier', ['beta', 'gamma', 'delta'])]);
    fireEvent.contextMenu(row('gamma')!);
    await screen.findByTestId('sessions-ctx-archive');

    await reorder([group('Today', ['gamma', 'alpha']), group('Earlier', ['beta', 'delta'])]);
    expect(order()).toEqual(['gamma', 'alpha', 'beta', 'delta']);
    await userEvent.click(screen.getByTestId('sessions-ctx-archive'));

    await waitFor(() => expect(archived).toEqual(['gamma']));
  });

  it('keeps a rename, its text and its focus on its session when the list reorders', async () => {
    const { reorder } = await mount([group('Today', ['alpha', 'beta', 'gamma', 'delta'])]);
    const input = await startRename('beta');
    await userEvent.clear(input);
    await userEvent.type(input, 'half typed');

    await reorder([group('Today', ['delta', 'alpha', 'beta', 'gamma'])]);

    const after = screen.getByTestId<HTMLInputElement>('sessions-rename-input');
    expect(row('beta')!.contains(after)).toBe(true);
    expect(after).toHaveValue('half typed');
    expect(after).toHaveFocus();
    expect(renamed).toEqual([]);

    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(renamed).toEqual([['beta', 'half typed']]));
  });

  it('keeps a rename when its session moves to another group', async () => {
    const { reorder } = await mount([group('Today', ['alpha']), group('Earlier', ['beta', 'gamma', 'delta'])]);
    const input = await startRename('gamma');
    await userEvent.clear(input);
    await userEvent.type(input, 'moving');

    await reorder([group('Today', ['gamma', 'alpha']), group('Earlier', ['beta', 'delta'])]);

    const after = screen.getByTestId<HTMLInputElement>('sessions-rename-input');
    expect(row('gamma')!.contains(after)).toBe(true);
    expect(after).toHaveValue('moving');
    expect(after).toHaveFocus();
  });

  it('lists both of two projects that share a name', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await mount([group('Pinned', ['delta']), group('web', ['alpha', 'beta']), group('web', ['gamma'])]);

    expect(order()).toEqual(['delta', 'alpha', 'beta', 'gamma']);
    expect(screen.getAllByTestId('sessions-group-header-web')).toHaveLength(2);
    expect(error.mock.calls.flat().join(' ')).not.toContain('same key');
    error.mockRestore();
  });
});
