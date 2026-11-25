// @vitest-environment jsdom

import { act, render } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { FC } from 'react';
import type { Chat } from '@qlan-ro/mainframe-types';
import type { AssistantClient } from '@assistant-ui/react';

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
  listChats: vi.fn(async (): Promise<Chat[]> => []),
  getChatWorkflowRuns: vi.fn(async () => []),
  resumeChat: vi.fn(async () => undefined),
  cancelQueuedMessage: vi.fn(async () => undefined),
  editQueuedMessage: vi.fn(async () => undefined),
  trustWorkspace: vi.fn(async () => undefined),
  setChatTuning: vi.fn(async () => undefined),
  setChatConfig: vi.fn(async () => undefined),
  archiveChat: vi.fn(async () => undefined),
}));

vi.mock('../../../../lib/api/attachments', () => ({
  uploadAttachments: vi.fn(async (): Promise<string[]> => []),
}));

let nextPromptError: Error | undefined;
const sentPrompts: Array<{ sessionId: string; text: string }> = [];

vi.mock('../../../../lib/daemon/ws-client', () => {
  const daemonWs = {
    setPort: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    get connected() {
      return true;
    },
    send: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    onEvent: vi.fn(() => () => {}),
    subscribeConnection: vi.fn(() => () => {}),
  };
  return { daemonWs, DaemonWsClient: class {} };
});

vi.mock('../../../../lib/daemon/acp-clients', () => {
  const client = {
    ensureConnected: vi.fn(async () => undefined),
    onSessionUpdate: vi.fn(() => () => {}),
    onPermissionRequest: vi.fn(() => () => {}),
    onGateResolved: vi.fn(() => () => {}),
    onGap: vi.fn(() => () => {}),
    prompt: vi.fn(async (sessionId: string, text: string) => {
      sentPrompts.push({ sessionId, text });
      if (nextPromptError) {
        const error = nextPromptError;
        nextPromptError = undefined;
        throw error;
      }
      return {};
    }),
    cancel: vi.fn(),
    resume: vi.fn(async () => ({})),
    respondPermission: vi.fn(),
  };
  return {
    getAcpFacadeClient: vi.fn(() => client),
    resetAcpFacadeClients: vi.fn(),
  };
});

import { AssistantRuntimeProvider, useAui } from '@assistant-ui/react';
import { DaemonPortProvider } from '../daemon-port-context';
import { useSessionsThreadList } from '../use-sessions-thread-list';
import { setDraftConfig, clearDraftConfig } from '../draft-config';
import { chatControllerRegistry } from '../chat-controller-registry';
import { createChat } from '../../../../lib/api/chats';

import { useComposerSegments } from '@/features/chat/composer/segments/segment-store';
import { useDraftContent, draftItemsOf } from '@/features/chat/composer/draft-content/draft-content-store';
import { useSessionReferences, sessionReferencesFor } from '@/features/chat/composer/sessions/session-reference-store';
import { useSubmitComposition, type SubmitComposition } from '@/features/chat/composer/segments/use-submit-composition';

let submit: SubmitComposition;
const PORT = 31415;

type AuiRef = { current: AssistantClient | null };

const AuiCapture: FC<{ auiRef: AuiRef }> = ({ auiRef }) => {
  auiRef.current = useAui();
  submit = useSubmitComposition();
  return null;
};

const SessionsRuntimeRoot: FC<{ auiRef: AuiRef }> = ({ auiRef }) => {
  const runtime = useSessionsThreadList();
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AuiCapture auiRef={auiRef} />
    </AssistantRuntimeProvider>
  );
};

function mountRuntime() {
  const auiRef: AuiRef = { current: null };
  const utils = render(
    <DaemonPortProvider port={PORT}>
      <SessionsRuntimeRoot auiRef={auiRef} />
    </DaemonPortProvider>,
  );
  if (!auiRef.current) throw new Error('aui client not captured');
  return { aui: () => auiRef.current!, ...utils };
}

/** Drain microtasks + the aui optimistic-update machinery. */
async function flush(): Promise<void> {
  await act(async () => {});
}

async function openDraft(aui: () => AssistantClient) {
  await act(async () => {
    await aui().threads.switchToNewThread();
  });
  await flush();
}

function seedDraft(localId: string) {
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
}

async function newThreadFirstSend(): Promise<{
  aui: () => AssistantClient;
  localId: string;
  unmount: () => void;
}> {
  const { aui, unmount } = mountRuntime();
  await openDraft(aui);
  const localId = aui().threads.getState().mainThreadId;
  seedDraft(localId);

  await act(async () => {
    const sendP = aui().threads.thread('main').append('hello');
    const initP = aui().threads.item('main').initialize();
    await Promise.all([sendP, initP]);
  });
  await flush();

  return { aui, localId, unmount };
}

beforeEach(() => {
  nextPromptError = undefined;
  createChatCallCount = 0;
  createdIds.length = 0;
  sentPrompts.length = 0;
  vi.clearAllMocks();
});

it('creates once and sends to the same id that assistant-ui stamps on the local thread', async () => {
  const { aui, localId, unmount } = await newThreadFirstSend();
  const remoteId = aui().threads.item('main').getState().remoteId;
  expect(localId).toMatch(/^__LOCALID_/);
  expect(createChat).toHaveBeenCalledTimes(1);
  expect(createdIds).toEqual(['chat-server-1']);
  expect(remoteId).toBe('chat-server-1');
  expect(sentPrompts).toEqual([{ sessionId: remoteId, text: 'hello' }]);
  const controller = chatControllerRegistry.getOrCreate(localId, PORT);
  expect(controller.getThreadId()).toBe(localId);
  expect(controller.hasRemoteId()).toBe(true);
  clearDraftConfig(localId);
  unmount();
});

it.each(['Unauthorized', 'Network unavailable', 'Create timed out', 'Provider refused creation'])(
  'restores first-send text before newer text and retries once after %s',
  async (error) => {
    const { aui, unmount } = mountRuntime();
    await openDraft(aui);
    const localId = aui().threads.getState().mainThreadId;
    seedDraft(localId);
    vi.mocked(createChat).mockRejectedValueOnce(new Error(error));
    await act(async () => {
      aui().composer.setText('first prompt');
      submit();
      aui().composer.setText('new text');
    });
    await flush();
    expect(aui().composer.getState().text).toBe('first prompt\n\nnew text');
    expect(sentPrompts).toHaveLength(0);
    await act(async () => submit());
    await flush();
    expect(sentPrompts.map(({ text }) => text)).toEqual(['first prompt\n\nnew text']);
    clearDraftConfig(localId);
    unmount();
  },
);

it('restores a quote, code note, capture, file and mention after the created chat refuses its first prompt', async () => {
  const { aui, unmount } = mountRuntime();
  await openDraft(aui);
  const localId = aui().threads.getState().mainThreadId;
  seedDraft(localId);
  const segments = useComposerSegments.getState();
  segments.append(localId, { quote: 'quoted', liveText: 'earlier', source: 'Earlier message' });
  useDraftContent.getState().add(localId, [
    { kind: 'code', filePath: 'src/a.ts', startLine: 1, endLine: 1, note: 'note', lineContent: 'const x = 1' },
    { kind: 'capture', type: 'screenshot', imageDataUrl: 'data:image/png;base64,AAAA', note: 'sketch' },
  ]);
  const before = draftItemsOf(localId).map(({ id }) => id);
  useSessionReferences.getState().record(localId, 'Prior', '/logs/prior.jsonl');
  nextPromptError = new Error('Provider refused prompt');
  await act(async () => {
    await aui().composer.addAttachment({
      id: 'attached',
      type: 'document',
      name: 'notes.txt',
      contentType: 'text/plain',
      content: [{ type: 'text', text: 'data:text/plain;base64,YQ==' }],
    });
    aui().composer.setText('first @Prior');
    submit();
    aui().composer.setText('typed meanwhile');
  });
  await flush();
  expect(aui().composer.getState().text).toBe('first @Prior\n\ntyped meanwhile');
  expect(
    aui()
      .composer.getState()
      .attachments.map(({ id }) => id),
  ).toEqual(['attached']);
  expect(useComposerSegments.getState().byThread[localId]?.liveQuote?.text).toBe('quoted');
  expect(
    draftItemsOf(localId)
      .filter((item) => item.kind !== 'mention')
      .map(({ id }) => id),
  ).toEqual(before);
  expect(sessionReferencesFor(localId).get('Prior')).toBe('/logs/prior.jsonl');

  await act(async () => submit());
  await flush();
  expect(createChat).toHaveBeenCalledTimes(1);
  expect(sentPrompts).toHaveLength(2);
  expect(sentPrompts[1]?.text).toContain('typed meanwhile');
  unmount();
});

it('returns a pending draft to the original composer after switching sessions', async () => {
  const { aui, localId: previousId, unmount } = await newThreadFirstSend();
  await openDraft(aui);
  const localId = aui().threads.getState().mainThreadId;
  seedDraft(localId);
  let refuse: (error: Error) => void = () => {};
  vi.mocked(createChat).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        refuse = reject;
      }),
  );
  await act(async () => {
    aui().composer.setText('draft belongs here');
    submit();
  });
  await act(async () => {
    await aui().threads.switchToThread(previousId);
  });
  await flush();
  await act(async () => {
    aui().composer.setText('different session');
    refuse(new Error('Network unavailable'));
  });
  expect(aui().composer.getState().text).toBe('different session');
  await act(async () => {
    await aui().threads.switchToThread(localId);
  });
  await flush();
  expect(aui().composer.getState().text).toBe('draft belongs here');
  clearDraftConfig(localId);
  unmount();
});
