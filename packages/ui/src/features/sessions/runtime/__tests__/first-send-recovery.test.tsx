// @vitest-environment jsdom
/**
 * A draft's first message that did not go out (C14): the real sessions runtime,
 * coordinator, controller and submit path; only the network is stubbed.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi, describe } from 'vitest';
import { AssistantRuntimeProvider, useAui, type AssistantClient } from '@assistant-ui/react';
import type { Chat, DaemonTarget } from '@qlan-ro/mainframe-types';

vi.mock('../../../../lib/api/chats', () => ({
  createChat: vi.fn(),
  getChat: vi.fn(async (_port: number, id: string) => ({ id, projectId: 'p1' }) as Chat),
  listChats: vi.fn(async (): Promise<Chat[]> => []),
  getChatWorkflowRuns: vi.fn(async () => []),
  resumeChat: vi.fn(async () => undefined),
  cancelQueuedMessage: vi.fn(async () => undefined),
  editQueuedMessage: vi.fn(async () => undefined),
  trustWorkspace: vi.fn(async () => undefined),
  setChatTuning: vi.fn(async () => undefined),
  setChatConfig: vi.fn(async () => undefined),
  archiveChat: vi.fn(async () => undefined),
  unarchiveNativeSession: vi.fn(async () => undefined),
}));
vi.mock('../../../../lib/api/attachments', () => ({ uploadAttachments: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock('@/lib/toast', () => ({ mfToast: toast }));
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
// Nothing here may reach a daemon.
const network = vi.hoisted(() => vi.fn(() => Promise.reject(new TypeError('no network in this test'))));
vi.stubGlobal('fetch', network);
vi.stubGlobal('WebSocket', network);
const prompt = vi.hoisted(() => vi.fn());
vi.mock('../../../../lib/daemon/acp-clients', () => ({
  getAcpFacadeClient: vi.fn(() => ({
    ensureConnected: vi.fn(async () => undefined),
    onSessionUpdate: vi.fn(() => () => {}),
    onPermissionRequest: vi.fn(() => () => {}),
    onGateResolved: vi.fn(() => () => {}),
    onGap: vi.fn(() => () => {}),
    prompt,
    cancel: vi.fn(),
    resume: vi.fn(async () => ({})),
    respondPermission: vi.fn(),
  })),
  resetAcpFacadeClients: vi.fn(),
}));

import { archiveChat, createChat, unarchiveNativeSession } from '../../../../lib/api/chats';
import { uploadAttachments } from '../../../../lib/api/attachments';
import { NotSentError } from '@/lib/daemon/not-sent-error';
import { getActiveDaemon, setActiveDaemon } from '@/lib/daemon/active-daemon';
import { draftItemsOf, useDraftContent } from '@/features/chat/composer/draft-content/draft-content-store';
import { useComposerSegments } from '@/features/chat/composer/segments/segment-store';
import { useSubmitComposition, type SubmitComposition } from '@/features/chat/composer/segments/use-submit-composition';
import { sessionReferencesFor, useSessionReferences } from '@/features/chat/composer/sessions/session-reference-store';
import {
  closeUnsentDrafts,
  dropUnsentOf,
  reopenUnsentDrafts,
  useUnsentMessages,
} from '@/features/chat/composer/unsent/unsent-store';
import { UnsentNotices } from '@/features/chat/composer/unsent/UnsentNotices';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SendFailureNotice } from '@/features/chat/messages/SendFailureNotice';
import { useChatExtras } from '@/features/chat/runtime/chat-extras';
import { sendRemedyOf } from '@/features/chat/controller/describe-send-error';
import { resetNewThreadDraft } from '../../new-thread/reset-new-thread-draft';
import { useDraftRow, type DraftRowState } from '../../sidebar/use-draft-row';
import { makeChatsRemoteAdapter } from '../chats-remote-adapter';
import { chatControllerRegistry } from '../chat-controller-registry';
import { DaemonPortProvider } from '../daemon-port-context';
import { clearDraftConfig, getDraftConfig, setDraftConfig, type DraftCfg } from '../draft-config';
import { useSessionsThreadList } from '../use-sessions-thread-list';

const PORT = 1;
const LOCAL = getActiveDaemon();
const REMOTE: DaemonTarget = { ...LOCAL, id: 'remote-1', kind: 'remote', label: 'Remote' };
const SETUP: DraftCfg = {
  projectId: 'p1',
  adapterId: 'claude',
  model: 'sonnet',
  permissionMode: 'default',
  planMode: false,
  effort: null,
  fast: false,
  ultracode: false,
  adaptiveThinking: false,
};
const TIMEOUT = { code: -32000, message: 'request timed out' };
const refusal = (reason: string, extra: object = {}) => ({
  code: -32000,
  message: 'prompt failed',
  data: { '_mainframe.dev': { reason, ...extra } },
});

let client: AssistantClient;
let submit: SubmitComposition;
let row: DraftRowState;
const NO_FILTER = new Set<string>();
const aui = () => client;

function Bubbles() {
  const pending = Object.values(useChatExtras()?.state.pendingUserMessages ?? {});
  return (
    <>
      {pending
        .filter(({ status }) => status === 'failed')
        .map(({ clientId, error, attachmentsRestored }) => (
          <SendFailureNotice
            key={clientId}
            error=""
            clientId={clientId}
            remedy={sendRemedyOf(error)}
            attachmentsRestored={attachmentsRestored}
          />
        ))}
    </>
  );
}

function Surface({ name }: { name: string }) {
  return (
    <section aria-label={name}>
      <UnsentNotices />
    </section>
  );
}

function Body() {
  client = useAui();
  submit = useSubmitComposition();
  row = useDraftRow([], NO_FILTER);
  return (
    <>
      <Surface name="main" />
      <Surface name="split" />
      <Bubbles />
    </>
  );
}

function Root() {
  const runtime = useSessionsThreadList();
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider>
        <Body />
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}

const mount = () =>
  render(
    <DaemonPortProvider port={PORT}>
      <Root />
    </DaemonPortProvider>,
  );

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
const text = () => aui().composer.getState().text;
const type = (value: string) => act(async () => aui().composer.setText(value));
const send = async () => {
  await act(async () => submit());
  await flush();
};
const notices = (surface = 'main') =>
  within(screen.getByRole('region', { name: surface })).queryAllByTestId('composer-unsent');
const press = async (name: 'restore' | 'discard' | 'copy', index = 0) => {
  await act(async () => fireEvent.click(within(notices()[index]!).getByTestId(`composer-unsent-${name}`)));
  await flush();
};
const prompts = () => prompt.mock.calls.map(([, body]) => body as string);
const metaOf = (call: number) =>
  (prompt.mock.calls[call]![2] as { _meta?: Record<string, { attachmentIds?: string[] }> })._meta;

async function openDraft(): Promise<string> {
  await act(async () => {
    await aui().threads.switchToNewThread();
  });
  await flush();
  const id = aui().threads.getState().mainThreadId;
  act(() => setDraftConfig(id, SETUP));
  await flush();
  return id;
}

let created = 0;
beforeEach(() => {
  vi.clearAllMocks();
  setActiveDaemon(LOCAL);
  useUnsentMessages.setState({ entries: [] });
  useDraftContent.setState({ byThread: {} });
  useComposerSegments.setState({ byThread: {} });
  useSessionReferences.setState({ byThread: {} });
  vi.mocked(createChat).mockImplementation(async () => ({ id: `chat-${(created += 1)}` }) as Chat);
  vi.mocked(uploadAttachments).mockImplementation(async (_p, _c, items) => items.map((_, i) => `up-${i}`));
  prompt.mockReset().mockResolvedValue({});
});
afterEach(() => {
  chatControllerRegistry.disposeAll();
  expect(network).not.toHaveBeenCalled();
});

async function fill(id: string) {
  act(() => {
    useComposerSegments.getState().append(id, { quote: 'first quote', liveText: 'opening' });
    useComposerSegments.getState().append(id, { quote: 'quoted', liveText: 'earlier', source: 'From the reply' });
    useDraftContent.getState().add(id, [
      { kind: 'code', filePath: '/p/a.ts', startLine: 1, endLine: 2, note: 'why', lineContent: 'const x' },
      { kind: 'capture', type: 'screenshot', imageDataUrl: 'data:image/png;base64,AAAA', note: 'sketch' },
    ]);
    useSessionReferences.getState().record(id, 'Prior', '/logs/prior.jsonl');
  });
  await act(async () => {
    await aui().composer.addAttachment({
      id: 'notes',
      type: 'document',
      name: 'notes.txt',
      contentType: 'text/plain',
      content: [{ type: 'text', text: 'data:text/plain;base64,YQ==' }],
    });
    aui().composer.setText('compare @Prior');
  });
}

const contentOf = (id: string) => ({
  text: text(),
  composition: useComposerSegments.getState().byThread[id],
  items: draftItemsOf(id),
  references: Object.fromEntries(sessionReferencesFor(id)),
  files: aui()
    .composer.getState()
    .attachments.map(({ name }) => name),
});

describe('creating the session fails', () => {
  it.each([
    [Object.assign(new Error('Unauthorized'), { status: 401 }), /Not authorized on this daemon/],
    [new TypeError('Failed to fetch'), 'The daemon is unreachable. Check the connection, then send again.'],
    [new Error('Provider refused creation'), 'Provider refused creation'],
  ])('keeps the message for the user, with the reason: %s', async (error, reason) => {
    mount();
    const id = await openDraft();
    vi.mocked(createChat).mockRejectedValueOnce(error);
    await type('first');
    await send();
    expect(text()).toBe('');
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toHaveTextContent('Your message wasn’t sent.');
    expect(within(notices()[0]!).getByTestId('composer-unsent-reason')).toHaveTextContent(reason);
    expect(prompt).not.toHaveBeenCalled();

    await press('restore');
    expect(text()).toBe('first');
    expect(notices()).toEqual([]);
    await send();
    expect(prompts()).toEqual(['first']);
    expect(notices()).toEqual([]);
    expect(useUnsentMessages.getState().entries).toEqual([]);
    clearDraftConfig(id);
  });

  it('restores every part of the draft into an empty composer', async () => {
    mount();
    const id = await openDraft();
    await fill(id);
    const before = contentOf(id);
    vi.mocked(createChat).mockRejectedValueOnce(new Error('no'));
    await send();
    expect(contentOf(id)).toEqual({
      text: '',
      composition: { committed: [], liveQuote: null },
      items: [],
      references: {},
      files: [],
    });
    await press('restore');
    expect(contentOf(id)).toEqual(before);
  });

  it('puts the message before what was typed since, a blank line between, and adds the items', async () => {
    mount();
    const id = await openDraft();
    await fill(id);
    vi.mocked(createChat).mockRejectedValueOnce(new Error('no'));
    await send();
    await type('meanwhile');
    act(() =>
      useDraftContent
        .getState()
        .add(id, [{ kind: 'code', filePath: 'b.ts', startLine: 1, endLine: 1, note: 'new', lineContent: 'b' }]),
    );
    await press('restore');
    expect(text()).toBe('compare @Prior\n\nmeanwhile');
    expect(useComposerSegments.getState().byThread[id]?.liveQuote?.text).toBe('quoted');
    expect(draftItemsOf(id).map(({ note }) => note)).toEqual(['why', 'sketch', 'new']);
    await send();
    expect(prompts()).toHaveLength(1);
    expect(prompts()[0]).toMatch(/> first quote\n\nearlier\n\n> quoted\n\ncompare @session\[Prior\]\n\nmeanwhile/);
  });

  it('keeps quotes added since below the restored ones', async () => {
    mount();
    const id = await openDraft();
    vi.mocked(createChat).mockRejectedValueOnce(new Error('no'));
    await type('first');
    await send();
    act(() => useComposerSegments.getState().append(id, { quote: 'later quote', liveText: '' }));
    await type('about it');
    await press('restore');
    await send();
    expect(prompts()).toEqual(['first\n\n> later quote\n\nabout it']);
  });

  it('keeps a mention on its own session when its label now names another', async () => {
    mount();
    const id = await openDraft();
    vi.mocked(createChat).mockRejectedValueOnce(new Error('no'));
    act(() => useSessionReferences.getState().record(id, 'Prior', '/logs/one.jsonl'));
    await type('see @Prior');
    await send();
    act(() => useSessionReferences.getState().record(id, 'Prior', '/logs/two.jsonl'));
    await type('and @Prior');
    await press('restore');
    expect(text()).toBe('see @Prior (2)\n\nand @Prior');
    expect(Object.fromEntries(sessionReferencesFor(id))).toEqual({
      Prior: '/logs/two.jsonl',
      'Prior (2)': '/logs/one.jsonl',
    });
  });

  it('gives two failed sends as two entries, in order', async () => {
    mount();
    await openDraft();
    vi.mocked(createChat).mockRejectedValueOnce(new Error('one')).mockRejectedValueOnce(new Error('two'));
    await type('message one');
    await send();
    await type('message two');
    await send();
    expect(notices().map((n) => within(n).getByTestId('composer-unsent-reason').textContent)).toEqual(['One', 'Two']);
    await press('restore', 1);
    await press('restore', 0);
    expect(text()).toBe('message one\n\nmessage two');
  });

  it('shows the same entry in every composer of the thread, and settles it in all of them', async () => {
    mount();
    await openDraft();
    vi.mocked(createChat).mockRejectedValueOnce(new Error('no'));
    await type('first');
    await send();
    expect(notices('split')).toHaveLength(1);
    await press('restore');
    expect(notices('split')).toEqual([]);
  });

  it('discards only what it was asked to', async () => {
    mount();
    await openDraft();
    vi.mocked(createChat).mockRejectedValue(new Error('no'));
    await type('one');
    await send();
    await type('two');
    await send();
    await press('discard', 0);
    expect(notices()).toHaveLength(1);
    expect(text()).toBe('');
    await press('restore');
    expect(text()).toBe('two');
  });

  it('copies the text, quotes included, and stays', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    mount();
    const id = await openDraft();
    act(() => useComposerSegments.getState().append(id, { quote: 'quoted', liveText: '' }));
    vi.mocked(createChat).mockRejectedValueOnce(new Error('no'));
    await type('reply');
    await send();
    await press('copy');
    expect(writeText).toHaveBeenCalledExactlyOnceWith('> quoted\n\nreply');
    expect(notices()).toHaveLength(1);
  });
});

describe('the first prompt fails', () => {
  it('moves the entry to the session and restores all of it there, the failed bubble with it', async () => {
    mount();
    const id = await openDraft();
    await fill(id);
    const before = contentOf(id);
    prompt.mockRejectedValueOnce(refusal('No', { neverDelivered: true }));
    await send();
    const { threadId } = useUnsentMessages.getState().entries[0]!;
    expect(threadId).toBe(chatControllerRegistry.get(id)!.getDaemonId());
    expect(threadId).toMatch(/^chat-/);
    expect(screen.getAllByTestId('chat-user-message-retry')).toHaveLength(1);
    await press('restore');
    expect(contentOf(id)).toEqual(before);
    expect(screen.queryByTestId('chat-user-message-retry')).toBeNull();
    await send();
    expect(prompts()).toHaveLength(2);
    expect(prompts()[1]).toBe(prompts()[0]);
    expect(createChat).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a timeout', TIMEOUT, 'The daemon did not answer in time.'],
    [
      'a connection lost after writing',
      { code: -32000, message: 'connection closed' },
      'The connection to the daemon was lost.',
    ],
    ['a failure the agent may have seen', refusal('The turn failed'), 'The turn failed'],
  ])('says it may have gone out after %s, and sends nothing by itself', async (_what, error, reason) => {
    mount();
    await openDraft();
    prompt.mockRejectedValueOnce(error);
    await type('first');
    await send();
    expect(notices()[0]).toHaveTextContent('Your message may not have been sent.');
    expect(within(notices()[0]!).getByTestId('composer-unsent-reason')).toHaveTextContent(reason);
    expect(prompts()).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Your message may not have been sent.', {
      description: reason,
    });
  });

  it.each([
    ['never written', new NotSentError('connection closed'), 'The connection to the daemon was lost.'],
    ['refused', refusal('Chat c1 not running', { neverDelivered: true }), 'The session is not running.'],
    ['unreadable', { code: -32602, message: 'invalid params' }, 'The daemon could not read the message.'],
  ])('says it was not sent when the prompt was %s, with the reason in the toast', async (_what, error, reason) => {
    mount();
    await openDraft();
    prompt.mockRejectedValueOnce(error);
    await type('first');
    await send();
    expect(notices()[0]).toHaveTextContent('Your message wasn’t sent.');
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Your message wasn’t sent.', { description: reason });
  });

  it('says it was not sent when an upload or the session’s config failed before it', async () => {
    mount();
    const id = await openDraft();
    await fill(id);
    vi.mocked(uploadAttachments).mockRejectedValueOnce({ code: -32000, message: 'connection closed' });
    await send();
    expect(notices()[0]).toHaveTextContent('Your message wasn’t sent.');
    expect(draftItemsOf(id)).toEqual([]);
  });
});

describe('with the failed message’s own remedies', () => {
  const failFirst = async (error: unknown = refusal('No', { neverDelivered: true })) => {
    mount();
    const id = await openDraft();
    await fill(id);
    prompt.mockRejectedValueOnce(error);
    await send();
    return id;
  };
  const retry = async (which = 'retry') => {
    await act(async () => fireEvent.click(screen.getByTestId(`chat-user-message-${which}`)));
    await flush();
  };

  it('Retry sends the whole message, once, and takes the notice along', async () => {
    const id = await failFirst();
    await retry();
    expect(prompts()).toHaveLength(2);
    expect(prompts()[1]).toBe(prompts()[0]);
    expect(JSON.stringify(metaOf(1))).toContain('up-0');
    expect(JSON.stringify(metaOf(1))).toContain('up-1');
    expect(notices()).toEqual([]);
    expect(useUnsentMessages.getState().entries).toEqual([]);
    expect(contentOf(id)).toMatchObject({ text: '', items: [], files: [] });
  });

  it('offers nothing to restore while a Retry is on its way', async () => {
    await failFirst();
    let answer: (value: object) => void = () => {};
    prompt.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    await retry();
    expect(notices()).toEqual([]);
    await act(async () => answer({}));
    await flush();
    expect(useUnsentMessages.getState().entries).toEqual([]);
  });

  it('gives the notice back, with everything, when the Retry fails too', async () => {
    const id = await failFirst();
    prompt.mockRejectedValueOnce(TIMEOUT);
    await retry();
    expect(notices()[0]).toHaveTextContent('Your message may not have been sent.');
    await press('restore');
    expect(draftItemsOf(id).map(({ note }) => note)).toEqual(['why', 'sketch']);
    expect(screen.queryByTestId('chat-user-message-retry')).toBeNull();
  });

  it('Unarchive still shows, and settles both', async () => {
    await failFirst(refusal('Archived', { remedy: 'unarchive_native_session', neverDelivered: true }));
    expect(notices()[0]).toHaveTextContent('Archived');
    await retry('unarchive');
    expect(unarchiveNativeSession).toHaveBeenCalledTimes(1);
    expect(prompts()).toHaveLength(2);
    expect(notices()).toEqual([]);
  });

  it('a Retry that failed before its prompt went out is certain again', async () => {
    await failFirst(TIMEOUT);
    vi.mocked(uploadAttachments).mockRejectedValueOnce({ code: -32000, message: 'connection closed' });
    await retry();
    expect(notices()[0]).toHaveTextContent('Your message wasn’t sent.');
  });

  it('Discard takes the failed message off the transcript', async () => {
    await failFirst();
    await press('discard');
    expect(screen.queryByTestId('chat-user-message-retry')).toBeNull();
    expect(prompts()).toHaveLength(1);
  });
});

describe('after the draft moved to another project', () => {
  it('restores the prose and quotes, leaves the rest there, and Undo goes back to it', async () => {
    mount();
    const id = await openDraft();
    await fill(id);
    const before = contentOf(id);
    vi.mocked(createChat).mockRejectedValueOnce(new Error('no'));
    await send();
    act(() => setDraftConfig(id, { ...SETUP, projectId: 'p2' }));
    await press('restore');
    expect(contentOf(id)).toEqual({ ...before, items: [], references: {} });
    expect(toast.info).toHaveBeenCalledExactlyOnceWith(
      'Removed 1 capture, 1 code note and 1 session mention',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }),
    );
    const [, { action }] = toast.info.mock.lastCall as [string, { action: { onClick: () => void } }];
    await act(async () => action.onClick());
    expect(getDraftConfig(id)).toEqual(SETUP);
    expect(contentOf(id)).toEqual(before);
  });
});

describe('how long an entry lives', () => {
  it('keeps none of a message that was accepted, nor of a send in a session', async () => {
    mount();
    const id = await openDraft();
    await type('first');
    await send();
    expect(useUnsentMessages.getState().entries).toEqual([]);
    const controller = chatControllerRegistry.get(id)!;
    const second = vi.spyOn(controller, 'sendMessage').mockResolvedValue();
    await type('second');
    await send();
    expect(second).toHaveBeenCalledTimes(1);
    expect(useUnsentMessages.getState().entries).toEqual([]);
  });

  it('survives switching session, and its draft with it', async () => {
    mount();
    const first = await openDraft();
    await type('done');
    await send();
    const draft = await openDraft();
    expect(draft).not.toBe(first);
    vi.mocked(createChat).mockRejectedValueOnce(new Error('no'));
    await type('unsent');
    await send();
    await act(async () => void (await aui().threads.switchToThread(first)));
    await flush();
    expect(notices()).toEqual([]);
    expect(getDraftConfig(draft)).toEqual(SETUP);
    await act(async () => void (await aui().threads.switchToThread(draft)));
    await flush();
    await press('restore');
    expect(text()).toBe('unsent');
  });

  it('fails where it was sent from, while another session is open', async () => {
    mount();
    const first = await openDraft();
    await type('done');
    await send();
    const draft = await openDraft();
    let refuse: (error: Error) => void = () => {};
    vi.mocked(createChat).mockImplementationOnce(() => new Promise((_resolve, reject) => (refuse = reject)));
    await type('unsent');
    await send();
    await act(async () => void (await aui().threads.switchToThread(first)));
    await type('other session');
    await act(async () => refuse(new Error('no')));
    await flush();
    expect(text()).toBe('other session');
    expect(notices()).toEqual([]);
    await act(async () => void (await aui().threads.switchToThread(draft)));
    await flush();
    expect(notices()).toHaveLength(1);
    expect(getDraftConfig(draft)).toEqual(SETUP);
  });

  it('waits for its own daemon, and for the next draft there', async () => {
    mount();
    const id = await openDraft();
    vi.mocked(createChat).mockRejectedValueOnce(new Error('no'));
    await type('unsent');
    await send();
    act(() => {
      closeUnsentDrafts();
      setActiveDaemon(REMOTE);
      reopenUnsentDrafts(id);
    });
    expect(notices()).toEqual([]);
    act(() => {
      setActiveDaemon(LOCAL);
      reopenUnsentDrafts(id);
    });
    expect(notices()).toHaveLength(1);
  });

  it.each(['New', 'Discard'])('a late failure after %s: kept for New, gone with the draft', async (how) => {
    mount();
    const id = await openDraft();
    let answer: (chat: Chat) => void = () => {};
    vi.mocked(createChat).mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    await type('unsent');
    await send();
    act(() => (how === 'New' ? resetNewThreadDraft(id) : row.onDiscard()));
    await act(async () => answer({ id: 'late' } as Chat));
    await flush();
    expect(archiveChat).toHaveBeenCalledWith(PORT, 'late', true);
    expect(prompt).not.toHaveBeenCalled();
    const entries = useUnsentMessages.getState().entries;
    expect(entries.map((e) => e.failure?.reason)).toEqual(
      how === 'New' ? ['The new session was closed before it started.'] : [],
    );
  });

  it('goes with its session: archived, deleted or ended', async () => {
    const adapter = makeChatsRemoteAdapter(PORT);
    for (const end of [
      (chatId: string) => adapter.archive(chatId),
      (chatId: string) => adapter.delete(chatId),
      async (chatId: string) => dropUnsentOf(chatId),
    ]) {
      const { unmount } = mount();
      await openDraft();
      prompt.mockRejectedValueOnce(TIMEOUT);
      await type('unsent');
      await send();
      const { threadId } = useUnsentMessages.getState().entries[0]!;
      await act(async () => end(threadId));
      expect(useUnsentMessages.getState().entries).toEqual([]);
      unmount();
    }
  });

  it('a failure after its session ended does not bring it back', async () => {
    mount();
    await openDraft();
    let refuse: (error: unknown) => void = () => {};
    prompt.mockImplementationOnce(() => new Promise((_resolve, reject) => (refuse = reject)));
    await type('unsent');
    await send();
    const { threadId } = useUnsentMessages.getState().entries[0]!;
    act(() => dropUnsentOf(threadId));
    await act(async () => refuse(TIMEOUT));
    await flush();
    expect(useUnsentMessages.getState().entries).toEqual([]);
  });
});
