// @vitest-environment jsdom

/**
 * Integration test — New → pick project+adapter → type in the REAL composer → send
 * (HIGH-1). This is the gap the mocked unit tests and the programmatic
 * `threads.main.append` create-once test both miss: it drives the actual
 * NewThreadConfigPicker selects and the actual ComposerPrimitive textarea/Send
 * button through the DOM, end to end.
 *
 * It mounts the SAME runtime tree AppShell composes
 * (DaemonPortProvider → AssistantRuntimeProvider(useSessionsThreadList) → ChatSurface)
 * and stubs ONLY the network boundary (`lib/api/*` + `lib/daemon/ws-client`).
 * assistant-ui, the new-thread coordinator, the picker, the ready-store, and the
 * composer are ALL real.
 *
 * Flow asserted:
 *   1. After switchToNewThread the picker (sessions-new-thread-send-gate) is shown,
 *      the composer is NOT (the bug: there was no composer at all here).
 *   2. Selecting project + adapter switches the surface to the real composer.
 *   3. Typing + clicking Send creates EXACTLY ONE chat (lib/api createChat) and the
 *      first message.send frame targets that created daemon id (never __LOCALID_*).
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FC } from 'react';
import type { AdapterInfo, Chat, ClientEvent, DisplayMessage, Project } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Network boundary mocks ONLY — aui + coordinator + picker + composer stay REAL.
// ---------------------------------------------------------------------------

let createChatCallCount = 0;
const createdIds: string[] = [];

vi.mock('../../../../lib/api/chats', () => ({
  createChat: vi.fn(async (): Promise<Chat> => {
    createChatCallCount += 1;
    const id = `chat-server-${createChatCallCount}`;
    createdIds.push(id);
    return { id } as Chat;
  }),
  getChat: vi.fn(async (_port: number, chatId: string): Promise<Chat> => ({ id: chatId }) as Chat),
  getChatMessages: vi.fn(async (): Promise<DisplayMessage[]> => []),
  getPendingPermission: vi.fn(async (): Promise<null> => null),
  listChats: vi.fn(async (): Promise<Chat[]> => []),
  resumeChat: vi.fn(async (): Promise<void> => {}),
  interruptChat: vi.fn(async (): Promise<void> => {}),
  cancelQueuedMessage: vi.fn(async (): Promise<void> => {}),
  editQueuedMessage: vi.fn(async (): Promise<void> => {}),
  setChatConfig: vi.fn(async (): Promise<void> => {}),
  setChatTuning: vi.fn(async (): Promise<void> => {}),
  renameChat: vi.fn(async (): Promise<void> => {}),
  pinChat: vi.fn(async (): Promise<void> => {}),
  archiveChat: vi.fn(async (): Promise<void> => {}),
  unarchiveChat: vi.fn(async (): Promise<void> => {}),
  getToolResultContent: vi.fn(async (): Promise<null> => null),
}));

vi.mock('../../../../lib/api/attachments', () => ({
  uploadAttachments: vi.fn(async (): Promise<string[]> => []),
}));

const PROJECTS: Project[] = [
  {
    id: 'p1',
    name: 'Mainframe',
    path: '/p/mainframe',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastOpenedAt: '2026-06-01T00:00:00.000Z',
  } as Project,
];

const ADAPTERS: AdapterInfo[] = [
  {
    id: 'claude',
    name: 'Claude',
    description: '',
    installed: true,
    models: [],
    capabilities: { planMode: true },
  } as unknown as AdapterInfo,
];

vi.mock('@/lib/api/projects', () => ({ getProjects: vi.fn(async (): Promise<Project[]> => PROJECTS) }));
vi.mock('../../../../lib/api/adapters', () => ({ getAdapters: vi.fn(async (): Promise<AdapterInfo[]> => ADAPTERS) }));
vi.mock('@/lib/api/adapters', () => ({ getAdapters: vi.fn(async (): Promise<AdapterInfo[]> => ADAPTERS) }));
vi.mock('@/lib/api/skills', () => ({ getSkills: vi.fn(async (): Promise<unknown[]> => []) }));
vi.mock('@/lib/api/agents', () => ({ getAgents: vi.fn(async (): Promise<unknown[]> => []) }));
vi.mock('@/lib/api/files', () => ({
  searchFiles: vi.fn(async (): Promise<unknown[]> => []),
  getFileTree: vi.fn(async (): Promise<unknown[]> => []),
  browseFilesystem: vi.fn(async (): Promise<unknown[]> => []),
}));
vi.mock('@/lib/api/tags', () => ({
  listTags: vi.fn(async (): Promise<unknown[]> => []),
  createTag: vi.fn(async (): Promise<unknown> => ({})),
  updateTag: vi.fn(async (): Promise<unknown> => ({})),
  deleteTag: vi.fn(async (): Promise<void> => {}),
  getChatTags: vi.fn(async (): Promise<unknown[]> => []),
  setChatTags: vi.fn(async (): Promise<void> => {}),
}));

const sentFrames: ClientEvent[] = [];

vi.mock('../../../../lib/daemon/ws-client', () => {
  const daemonWs = {
    setPort: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    get connected() {
      return true;
    },
    send: vi.fn((event: ClientEvent) => {
      sentFrames.push(event);
    }),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    onEvent: vi.fn(() => () => {}),
    subscribeConnection: vi.fn(() => () => {}),
  };
  return { daemonWs, DaemonWsClient: class {} };
});

// ---------------------------------------------------------------------------
// Imports AFTER mocks — the subject + the real composition.
// ---------------------------------------------------------------------------

import { AssistantRuntimeProvider, useAssistantRuntime } from '@assistant-ui/react';
import type { AssistantRuntime } from '@assistant-ui/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DaemonPortProvider } from '../../runtime/daemon-port-context';
import { useSessionsThreadList } from '../../runtime/use-sessions-thread-list';
import { useNewThreadReady } from '../../runtime/new-thread-ready-store';
import { ChatSurface } from '../ChatSurface';
import { createChat } from '../../../../lib/api/chats';

const PORT = 31415;

const RuntimeCapture: FC<{ runtimeRef: { current: AssistantRuntime | null } }> = ({ runtimeRef }) => {
  runtimeRef.current = useAssistantRuntime();
  return null;
};

const Root: FC<{ runtimeRef: { current: AssistantRuntime | null } }> = ({ runtimeRef }) => {
  const runtime = useSessionsThreadList();
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <RuntimeCapture runtimeRef={runtimeRef} />
      <ChatSurface port={PORT} />
    </AssistantRuntimeProvider>
  );
};

function mountApp() {
  const runtimeRef: { current: AssistantRuntime | null } = { current: null };
  const utils = render(
    <TooltipProvider delayDuration={0}>
      <DaemonPortProvider port={PORT}>
        <Root runtimeRef={runtimeRef} />
      </DaemonPortProvider>
    </TooltipProvider>,
  );
  if (!runtimeRef.current) throw new Error('runtime not captured');
  return { runtime: runtimeRef.current, ...utils };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  createChatCallCount = 0;
  createdIds.length = 0;
  sentFrames.length = 0;
  vi.clearAllMocks();
  useNewThreadReady.setState({ readyIds: new Set<string>() });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('new-thread composer flow — startable end to end (HIGH-1)', () => {
  it('shows the picker (not the composer) on a brand-new local thread', async () => {
    const { runtime } = mountApp();
    await act(async () => {
      await runtime.threads.switchToNewThread();
    });
    await flush();

    expect(runtime.threads.getState().mainThreadId).toMatch(/^__LOCALID_/);
    expect(screen.getByTestId('sessions-new-thread-send-gate')).toBeTruthy();
    expect(screen.queryByTestId('chat-composer-input')).toBeNull();
  });

  it('switches to the real composer once project+adapter are chosen', async () => {
    const { runtime } = mountApp();
    await act(async () => {
      await runtime.threads.switchToNewThread();
    });
    await flush();

    await waitFor(() => expect(screen.getByTestId('sessions-new-thread-project-select')).toBeTruthy());

    await act(async () => {
      await userEvent.selectOptions(screen.getByTestId('sessions-new-thread-project-select'), 'p1');
    });
    await flush();

    expect(screen.getByTestId('chat-composer-input')).toBeTruthy();
    expect(screen.queryByTestId('sessions-new-thread-send-gate')).toBeNull();
  });

  it('typing + Send creates exactly ONE chat and routes the first message to it', async () => {
    const { runtime } = mountApp();
    await act(async () => {
      await runtime.threads.switchToNewThread();
    });
    await flush();

    const localId = runtime.threads.getState().mainThreadId;
    expect(localId).toMatch(/^__LOCALID_/);

    await waitFor(() => expect(screen.getByTestId('sessions-new-thread-project-select')).toBeTruthy());
    await act(async () => {
      await userEvent.selectOptions(screen.getByTestId('sessions-new-thread-project-select'), 'p1');
    });
    await flush();

    const input = await screen.findByTestId('chat-composer-input');
    await act(async () => {
      await userEvent.type(input, 'first message from the real composer');
    });
    await act(async () => {
      await userEvent.click(screen.getByTestId('chat-composer-send'));
    });
    await flush();

    // Exactly one createChat — both onNew and aui.initialize fire, the idempotent
    // coordinator collapses them to one POST.
    expect(vi.mocked(createChat)).toHaveBeenCalledTimes(1);
    expect(createdIds).toEqual(['chat-server-1']);

    // The first message reached the controller for the CREATED chat, not the local id.
    const firstSend = sentFrames.find((f) => f.type === 'message.send') as
      | { type: 'message.send'; chatId: string; content: string }
      | undefined;
    expect(firstSend).toBeDefined();
    expect(firstSend!.chatId).toBe('chat-server-1');
    expect(firstSend!.chatId).not.toMatch(/^__LOCALID_/);
    expect(firstSend!.content).toBe('first message from the real composer');
  });
});
