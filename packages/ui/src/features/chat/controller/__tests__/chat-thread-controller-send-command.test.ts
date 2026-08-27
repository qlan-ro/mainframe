/**
 * A draft that is exactly `/<command>` must reach the daemon as an invocation,
 * not as prose. Without `metadata.command` the daemon takes its plain-text path
 * and the model receives the literal "/launch-config" string — the regression
 * that left the built-in commands unreachable after the Electron→Tauri port.
 *
 * Harness mirrors chat-thread-controller-send.test.ts: a fake WS client records
 * the frames, the REST modules are mocked so nothing hits the network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppendMessage } from '@assistant-ui/react';
import type { ClientEvent, CustomCommand } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../../lib/daemon/ws-client';

vi.mock('../../../../lib/api/attachments', () => ({
  uploadAttachments: vi.fn(),
}));

vi.mock('../../../../lib/api/chats', () => ({
  getChatMessages: vi.fn().mockResolvedValue({ messages: [], transcriptMissing: false }),
  getChat: vi.fn().mockResolvedValue(null),
  getPendingPermission: vi.fn().mockResolvedValue(null),
  resumeChat: vi.fn().mockResolvedValue(undefined),
  interruptChat: vi.fn().mockResolvedValue(undefined),
  cancelQueuedMessage: vi.fn().mockResolvedValue(undefined),
  editQueuedMessage: vi.fn().mockResolvedValue(undefined),
}));

import { ChatThreadController } from '../chat-thread-controller';
import { publishCommands } from '../../commands/command-registry';

const CHAT_ID = 'chat-abc';
const PORT = 9999;

const COMMANDS: CustomCommand[] = [
  { name: 'launch-config', description: 'Generate .mainframe/launch.json for this project', source: 'mainframe' },
  { name: 'compact', description: 'Compact the conversation', source: 'claude' },
];

function makeFakeWs(): { sentEvents: ClientEvent[]; fakeClient: DaemonWsClient } {
  const sentEvents: ClientEvent[] = [];
  const fakeClient = {
    get connected() {
      return false;
    },
    send(event: ClientEvent) {
      sentEvents.push(event);
    },
    onEvent: () => () => {},
    subscribe: () => {},
    unsubscribe: () => {},
    subscribeConnection: () => () => {},
    setPort: () => {},
    connect: () => {},
    disconnect: () => {},
  } as unknown as DaemonWsClient;
  return { sentEvents, fakeClient };
}

function makeMsg(text: string): AppendMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    attachments: [],
    parentId: null,
  } as unknown as AppendMessage;
}

async function sendAndCapture(text: string): Promise<ClientEvent | undefined> {
  const { sentEvents, fakeClient } = makeFakeWs();
  await new ChatThreadController(CHAT_ID, PORT, fakeClient).sendMessage(makeMsg(text));
  return sentEvents.find((e) => e.type === 'message.send');
}

beforeEach(() => {
  vi.clearAllMocks();
  publishCommands(COMMANDS);
});

describe('ChatThreadController.sendMessage — command invocations', () => {
  it('tags a bare command invocation with its name and source', async () => {
    expect(await sendAndCapture('/launch-config')).toEqual({
      type: 'message.send',
      chatId: CHAT_ID,
      content: '/launch-config',
      metadata: { command: { name: 'launch-config', source: 'mainframe' } },
    });
  });

  it('sends the literal text as content — the daemon resolves the prompt itself', async () => {
    const sent = await sendAndCapture('/launch-config');
    expect(sent).toMatchObject({ content: '/launch-config' });
  });

  it('carries an adapter command through with its own source', async () => {
    expect(await sendAndCapture('/compact')).toMatchObject({
      metadata: { command: { name: 'compact', source: 'claude' } },
    });
  });

  it('leaves an ordinary message untagged', async () => {
    const sent = await sendAndCapture('hello world');
    expect(sent).toEqual({ type: 'message.send', chatId: CHAT_ID, content: 'hello world' });
  });

  it('leaves a draft with trailing prose untagged, so the words are not discarded', async () => {
    const sent = await sendAndCapture('/launch-config for the api package');
    expect(sent).toEqual({
      type: 'message.send',
      chatId: CHAT_ID,
      content: '/launch-config for the api package',
    });
  });

  it('leaves an unknown slash token untagged', async () => {
    const sent = await sendAndCapture('/not-a-command');
    expect(sent).toEqual({ type: 'message.send', chatId: CHAT_ID, content: '/not-a-command' });
  });

  it('sends untagged when the command list never loaded', async () => {
    publishCommands([]);
    const sent = await sendAndCapture('/launch-config');
    expect(sent).toEqual({ type: 'message.send', chatId: CHAT_ID, content: '/launch-config' });
  });
});
