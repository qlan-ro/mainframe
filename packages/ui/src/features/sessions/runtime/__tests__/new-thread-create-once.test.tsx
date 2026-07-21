// @vitest-environment jsdom

/**
 * Integration test — create the daemon chat EXACTLY ONCE on first send.
 *
 * This is the test the original BLOCKER lacked: it mocks NEITHER
 * `@assistant-ui/react` NOR the new-thread coordinator. It mounts the REAL
 * sessions runtime — the same composition AppShell uses
 * (`DaemonPortProvider` → `AssistantRuntimeProvider` fed by
 * `useSessionsThreadList` → `useRemoteThreadListRuntime` → `useChatRuntimeHook`
 * → real per-chat controller + real `createForLocal`) — and stubs ONLY the
 * network boundary (`lib/api/*` + `lib/daemon/ws-client`).
 *
 * The bug: on first send to a `__LOCALID_*` thread BOTH create seams fire for
 * the same thread:
 *   (1) our external-store `onNew`  (use-chat-thread-runtime), and
 *   (2) assistant-ui's native thread-list `initialize` (the seam the library's
 *       `RemoteThreadListHookInstanceManager` drives off the thread's
 *       `"initialize"` event — i.e. `aui.threadListItem().initialize()`).
 * `createForLocal` had no idempotency guard → TWO `POST /api/chats` → two daemon
 * chats. The controller bound to chat #1; aui stamped `item.remoteId` = chat #2
 * → an orphaned empty session.
 *
 * The test drives both seams the way production does — `threads.main.append(...)`
 * (onNew) AND `threads.mainItem.initialize()` (the native thread-list seam) —
 * within one act() tick, then asserts:
 *   1. `createChat` (the lib/api fn) is called EXACTLY ONCE.
 *   2. The id the controller sends the first message to (its `daemonId`, read
 *      off the captured `message.send` WS frame) === the id aui stamped as
 *      `mainItem.remoteId`. Both seams converge on the SAME chat.
 *   3. The first message targets the real daemon id, never a `__LOCALID_*`.
 *
 * To make a duplicate-create regression unmistakable, the `createChat` stub
 * returns a DIFFERENT id per call (`chat-server-1`, `chat-server-2`, …): a
 * second create would surface as both a count of 2 AND a controller/aui id
 * divergence. Verified manually: against the pre-fix coordinator this test sees
 * `createChat` called twice; against the fix it is called once.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FC } from 'react';
import type { Chat, ChatHistoryPayload, ClientEvent } from '@qlan-ro/mainframe-types';
import type { AssistantRuntime } from '@assistant-ui/react';

// ---------------------------------------------------------------------------
// Network boundary mocks ONLY — aui + coordinator stay REAL.
// ---------------------------------------------------------------------------

let createChatCallCount = 0;
const createdIds: string[] = [];

vi.mock('../../../../lib/api/chats', () => ({
  // A distinct id per call so a duplicate create is visible as a divergence,
  // not just an over-count.
  createChat: vi.fn(async (): Promise<Chat> => {
    createChatCallCount += 1;
    const id = `chat-server-${createChatCallCount}`;
    createdIds.push(id);
    return { id } as Chat;
  }),
  // Benign reads the controller does on load/seed.
  getChat: vi.fn(async (_port: number, chatId: string): Promise<Chat> => ({ id: chatId }) as Chat),
  getChatMessages: vi.fn(async (): Promise<ChatHistoryPayload> => ({ messages: [], transcriptMissing: false })),
  listChats: vi.fn(async (): Promise<Chat[]> => []),
  setChatTuning: vi.fn(async () => undefined),
  setChatConfig: vi.fn(async () => undefined),
  archiveChat: vi.fn(async () => undefined),
}));

vi.mock('../../../../lib/api/attachments', () => ({
  uploadAttachments: vi.fn(async (): Promise<string[]> => []),
}));

// A daemonWs stub that captures every frame so we can read which chatId the
// first `message.send` targets (that equals the controller's daemonId).
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
// Imports AFTER mocks — the subject + the real coordinator/registry/draft.
// ---------------------------------------------------------------------------

import { AssistantRuntimeProvider, useAssistantRuntime } from '@assistant-ui/react';
import { DaemonPortProvider } from '../daemon-port-context';
import { useSessionsThreadList } from '../use-sessions-thread-list';
import { setDraftConfig, clearDraftConfig } from '../draft-config';
import { chatControllerRegistry } from '../chat-controller-registry';
import { createChat } from '../../../../lib/api/chats';

const PORT = 31415;

const RuntimeCapture: FC<{ runtimeRef: { current: AssistantRuntime | null } }> = ({ runtimeRef }) => {
  runtimeRef.current = useAssistantRuntime();
  return null;
};

// Mounts the SAME runtime tree AppShell composes in production:
// DaemonPortProvider → AssistantRuntimeProvider(useSessionsThreadList()).
const SessionsRuntimeRoot: FC<{ runtimeRef: { current: AssistantRuntime | null } }> = ({ runtimeRef }) => {
  const runtime = useSessionsThreadList();
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <RuntimeCapture runtimeRef={runtimeRef} />
    </AssistantRuntimeProvider>
  );
};

function mountRuntime() {
  const runtimeRef: { current: AssistantRuntime | null } = { current: null };
  const utils = render(
    <DaemonPortProvider port={PORT}>
      <SessionsRuntimeRoot runtimeRef={runtimeRef} />
    </DaemonPortProvider>,
  );
  if (!runtimeRef.current) throw new Error('runtime not captured');
  return { runtime: runtimeRef.current, ...utils };
}

/** Drain microtasks + the aui optimistic-update machinery. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

/**
 * Mount, switch to a brand-new local thread, stash its draft, then drive BOTH
 * create seams (onNew via append + the native thread-list initialize) in one
 * tick — exactly what production does. Returns the local id + the runtime.
 */
async function newThreadFirstSend(): Promise<{ runtime: AssistantRuntime; localId: string; unmount: () => void }> {
  const { runtime, unmount } = mountRuntime();

  await act(async () => {
    await runtime.threads.switchToNewThread();
  });
  await flush();

  // ThreadListRuntimeImpl exposes ids via getState(), not as own properties.
  const localId = runtime.threads.getState().mainThreadId;

  setDraftConfig(localId, {
    projectId: 'p1',
    adapterId: 'claude',
    model: 'sonnet',
    permissionMode: 'default',
    planMode: false,
    effort: null,
    fast: false,
    ultracode: false,
    adaptiveThinking: false,
  });

  await act(async () => {
    const sendP = runtime.threads.main.append('hello');
    const initP = runtime.threads.mainItem.initialize();
    await Promise.all([sendP, initP]);
  });
  await flush();

  return { runtime, localId, unmount };
}

beforeEach(() => {
  createChatCallCount = 0;
  createdIds.length = 0;
  sentFrames.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('new-thread create-once — one POST /api/chats per New+send', () => {
  it('calls createChat EXACTLY ONCE even though both onNew and aui.initialize fire', async () => {
    const { localId, unmount } = await newThreadFirstSend();

    expect(localId).toMatch(/^__LOCALID_/);
    expect(vi.mocked(createChat)).toHaveBeenCalledTimes(1);
    expect(createdIds).toEqual(['chat-server-1']);

    clearDraftConfig(localId);
    unmount();
  });

  it('converges: the controller send target === the stamped item.remoteId (no orphan)', async () => {
    const { runtime, localId, unmount } = await newThreadFirstSend();

    // The id aui stamped on the (now-regular) thread item after initialize.
    const stampedRemoteId = runtime.threads.mainItem.getState().remoteId;
    expect(stampedRemoteId).toBe('chat-server-1');

    // The id the controller actually sent the first message to (== its daemonId).
    const firstSend = sentFrames.find((f) => f.type === 'message.send') as
      | { type: 'message.send'; chatId: string; content: string }
      | undefined;
    expect(firstSend).toBeDefined();
    expect(firstSend!.chatId).toBe(stampedRemoteId);
    expect(firstSend!.chatId).not.toMatch(/^__LOCALID_/);

    clearDraftConfig(localId);
    unmount();
  });

  it('the registry controller for the local id adopts the SAME daemon id (no id-flip)', async () => {
    const { localId, unmount } = await newThreadFirstSend();

    // The controller is keyed by the STABLE local id (S1) and has adopted its
    // remote id via setRemoteId — hasRemoteId() is now true, threadId unchanged.
    const controller = chatControllerRegistry.getOrCreate(localId, PORT);
    expect(controller.getThreadId()).toBe(localId);
    expect(controller.hasRemoteId()).toBe(true);

    clearDraftConfig(localId);
    unmount();
  });
});
