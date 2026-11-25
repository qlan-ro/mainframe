// @vitest-environment jsdom
/** A draft across a daemon switch (C14): the real provider, its keyed remount and the real sessions runtime. */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AssistantRuntimeProvider, useAui, type AssistantClient } from '@assistant-ui/react';
import type { Chat, DaemonTarget } from '@qlan-ro/mainframe-types';

const listChats = vi.hoisted(() => vi.fn(async (): Promise<Chat[]> => []));
vi.mock('../../../../lib/api/chats', () => ({
  createChat: vi.fn(),
  getChat: vi.fn(async (_port: number, id: string) => ({ id, projectId: 'p1' }) as Chat),
  listChats,
  getChatWorkflowRuns: vi.fn(async () => []),
  resumeChat: vi.fn(async () => undefined),
  chatExists: vi.fn(async () => true),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock('@/lib/toast', () => ({ mfToast: toast }));
vi.mock('../../../../lib/daemon/acp-clients', () => ({
  getAcpFacadeClient: vi.fn(() => ({
    ensureConnected: vi.fn(async () => undefined),
    onSessionUpdate: vi.fn(() => () => {}),
    onPermissionRequest: vi.fn(() => () => {}),
    onGateResolved: vi.fn(() => () => {}),
    onGap: vi.fn(() => () => {}),
    resume: vi.fn(async () => ({})),
  })),
  resetAcpFacadeClients: vi.fn(),
}));
// Nothing here may reach a daemon.
const network = vi.hoisted(() => vi.fn(() => Promise.reject(new TypeError('no network in this test'))));
vi.stubGlobal('fetch', network);
vi.stubGlobal('WebSocket', network);
vi.mock('@/lib/lsp', () => ({ rebindLspToActiveDaemon: vi.fn(async () => undefined) }));
vi.mock('@/lib/daemon/dispose-daemon-session', () => ({ disposeDaemonSession: vi.fn() }));
vi.mock('../../../../lib/daemon/ws-client', () => ({
  daemonWs: {
    setPort: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    connected: true,
    send: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    onEvent: vi.fn(() => () => {}),
    subscribeConnection: vi.fn(() => () => {}),
  },
  DaemonWsClient: class {},
}));

import { setActiveDaemon } from '@/lib/daemon/active-daemon';
import { ActiveDaemonProvider, useActiveDaemon } from '@/features/daemon/active-daemon-context';
import { draftItemsOf, useDraftContent } from '@/features/chat/composer/draft-content/draft-content-store';
import { useComposerSegments } from '@/features/chat/composer/segments/segment-store';
import { sessionReferencesFor, useSessionReferences } from '@/features/chat/composer/sessions/session-reference-store';
import { failUnsent, holdUnsent, useUnsentMessages } from '@/features/chat/composer/unsent/unsent-store';
import { useSandboxStore } from '@/store/sandbox';
import { DaemonPortProvider } from '../../runtime/daemon-port-context';
import { getDraftConfig, setDraftConfig, type DraftCfg } from '../../runtime/draft-config';
import { useNewThreadReady } from '../../runtime/new-thread-ready-store';
import { useSessionsThreadList } from '../../runtime/use-sessions-thread-list';
import { useSessionListRouter } from '../../ws/use-session-list-router';

const LOCAL: DaemonTarget = {
  id: 'local',
  kind: 'local',
  label: 'Local',
  baseUrl: 'http://127.0.0.1:1',
  token: null,
};
const REMOTE: DaemonTarget = {
  ...LOCAL,
  id: 'remote-1',
  kind: 'remote',
  label: 'Remote',
  baseUrl: 'http://127.0.0.1:2',
};
const SETUP: DraftCfg = { projectId: 'p1', adapterId: 'claude', model: 'opus' };

let client: AssistantClient;
let switchTo: (target: DaemonTarget) => Promise<void>;

function Body() {
  client = useAui();
  useSessionListRouter();
  return null;
}
function Session() {
  const runtime = useSessionsThreadList();
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Body />
    </AssistantRuntimeProvider>
  );
}
function Shell() {
  const daemon = useActiveDaemon();
  switchTo = daemon.switchTo;
  return <Session key={daemon.target.id} />;
}
const mount = () =>
  render(
    <DaemonPortProvider port={1}>
      <ActiveDaemonProvider initialTarget={LOCAL}>
        <Shell />
      </ActiveDaemonProvider>
    </DaemonPortProvider>,
  );

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
const main = () => client.threads.getState().mainThreadId;
const go = async (target: DaemonTarget) => {
  await act(async () => switchTo(target));
  await flush();
};
const undo = async () => {
  const [, { action }] = toast.info.mock.lastCall as [string, { action: { onClick: () => void } }];
  await act(async () => action.onClick());
  await flush();
};
const prose = () => ({
  text: client.composer.getState().text,
  files: client.composer.getState().attachments.map(({ name }) => name),
  quote: useComposerSegments.getState().byThread[main()]?.liveQuote?.text,
});

async function openDraft(): Promise<string> {
  mount();
  await flush();
  await act(async () => void (await client.threads.switchToNewThread()));
  await flush();
  act(() => setDraftConfig(main(), SETUP));
  return main();
}

async function fill() {
  const id = main();
  act(() => {
    useComposerSegments.getState().append(id, { quote: 'quoted', liveText: '' });
    useDraftContent
      .getState()
      .add(id, [{ kind: 'code', filePath: 'a', startLine: 1, endLine: 1, lineContent: 'a', note: 'n' }]);
    useSessionReferences.getState().record(id, 'Prior', '/logs/prior.jsonl');
    useSandboxStore.getState().addCapture({ type: 'screenshot', imageDataUrl: 'data:image/png;base64,A' });
  });
  await act(async () => {
    await client.composer.addAttachment({ id: 'f', type: 'document', name: 'notes.txt', content: [] });
    client.composer.setText('compare @Prior');
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  listChats.mockResolvedValue([]);
  setActiveDaemon(LOCAL);
  useUnsentMessages.setState({ entries: [] });
});
afterEach(() => {
  setActiveDaemon(LOCAL);
  expect(network).not.toHaveBeenCalled();
});

it('takes prose, quotes and files along, and says what it left', async () => {
  const before = await openDraft();
  await fill();
  await go(REMOTE);
  expect(main()).not.toBe(before);
  expect(prose()).toEqual({ text: 'compare @Prior', files: ['notes.txt'], quote: 'quoted' });
  expect(draftItemsOf(main())).toEqual([]);
  expect(sessionReferencesFor(main()).size).toBe(0);
  expect(getDraftConfig(main())).toBeUndefined();
  expect(toast.info).toHaveBeenCalledExactlyOnceWith(
    'Draft changed',
    expect.objectContaining({
      description: 'Removed 1 capture, 1 code note and 1 session mention',
      action: expect.objectContaining({ label: 'Undo' }),
    }),
  );
});

it('Undo goes back to the daemon, the project and everything in the draft, with what was written since', async () => {
  await openDraft();
  await fill();
  await go(REMOTE);
  await act(async () => client.composer.setText('compare @Prior, carefully'));
  await undo();
  expect(prose()).toEqual({ text: 'compare @Prior, carefully', files: ['notes.txt'], quote: 'quoted' });
  expect(draftItemsOf(main()).map(({ note }) => note)).toEqual(['n']);
  expect(Object.fromEntries(sessionReferencesFor(main()))).toEqual({ Prior: '/logs/prior.jsonl' });
  expect(useSandboxStore.getState().captures).toHaveLength(1);
  expect(getDraftConfig(main())).toEqual(SETUP);
  expect(useNewThreadReady.getState().isReady(main())).toBe(true);
});

it('Undo gives the draft back whole when another session was opened meanwhile', async () => {
  listChats.mockResolvedValue([{ id: 'chat-9', title: 'Other', projectId: 'p9' } as Chat]);
  await openDraft();
  await fill();
  await go(REMOTE);
  await act(async () => void (await client.threads.switchToThread('chat-9')));
  await flush();
  expect(main()).toBe('chat-9');
  await undo();
  expect(prose()).toEqual({ text: 'compare @Prior', files: ['notes.txt'], quote: 'quoted' });
});

it('Undo once already back puts what was removed into the draft there', async () => {
  await openDraft();
  await fill();
  await go(REMOTE);
  await go(LOCAL);
  expect(draftItemsOf(main())).toEqual([]);
  await undo();
  expect(draftItemsOf(main()).map(({ note }) => note)).toEqual(['n']);
  expect(getDraftConfig(main())).toEqual(SETUP);
});

it('Undo once already back leaves a draft for another project alone', async () => {
  await openDraft();
  await fill();
  await go(REMOTE);
  await go(LOCAL);
  act(() => setDraftConfig(main(), { ...SETUP, projectId: 'p2' }));
  const undoToast = toast.info.mock.lastCall;
  await undo();
  expect(undoToast).toBeDefined();
  expect(draftItemsOf(main())).toEqual([]);
  expect(toast.info).toHaveBeenLastCalledWith('Nothing to undo', expect.anything());
});

it('keeps the draft it brought on screen, rather than the last session', async () => {
  listChats.mockResolvedValue([{ id: 'chat-9', title: 'Other', projectId: 'p9' } as Chat]);
  await openDraft();
  await fill();
  await go(REMOTE);
  expect(main()).toMatch(/^__LOCALID_/);
  expect(prose().text).toBe('compare @Prior');
});

it('opens the last session as ever when there was nothing to bring', async () => {
  listChats.mockResolvedValue([{ id: 'chat-9', title: 'Other', projectId: 'p9' } as Chat]);
  await openDraft();
  await go(REMOTE);
  expect(main()).toBe('chat-9');
  expect(toast.info).not.toHaveBeenCalled();
});

it('brings nothing from a session', async () => {
  listChats.mockResolvedValue([{ id: 'chat-9', title: 'Other', projectId: 'p9' } as Chat]);
  await openDraft();
  await act(async () => void (await client.threads.switchToThread('chat-9')));
  await flush();
  await act(async () => client.composer.setText('to the session'));
  act(() =>
    useDraftContent
      .getState()
      .add('chat-9', [{ kind: 'code', filePath: 'a', startLine: 1, endLine: 1, lineContent: 'a', note: 'n' }]),
  );
  listChats.mockResolvedValue([]);
  await go(REMOTE);
  expect(prose().text).toBe('');
  expect(toast.info).not.toHaveBeenCalled();
});

it('leaves a draft alone when its own daemon is chosen again', async () => {
  const id = await openDraft();
  await fill();
  await go(LOCAL);
  expect(main()).toBe(id);
  expect(prose()).toMatchObject({ text: 'compare @Prior', files: ['notes.txt'] });
  expect(toast.info).not.toHaveBeenCalled();
});

it('leaves an unsent message on its daemon, for the draft opened on return', async () => {
  const id = await openDraft();
  act(() => {
    const entry = { threadId: id, draft: { text: 'unsent', items: [], attachments: [], references: {} }, sent: [] };
    failUnsent(holdUnsent(entry), new Error('no'));
  });
  const owner = () => useUnsentMessages.getState().entries[0]!.threadId;
  await go(REMOTE);
  expect(owner()).not.toBe(main());
  await go(LOCAL);
  expect(main()).not.toBe(id);
  expect(owner()).toBe(main());
});
