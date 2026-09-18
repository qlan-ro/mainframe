/**
 * A draft that is exactly `/<command>` must reach the daemon as an invocation,
 * not as prose — carried under the prompt's `_meta['_mainframe.dev'].command`
 * (`PromptSendMeta`), the ACP-facade replacement for the legacy
 * `message.send` frame's `metadata.command`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/api/attachments', () => ({ uploadAttachments: vi.fn() }));
vi.mock('../../../../lib/api/chats', () => ({
  getChat: vi.fn().mockResolvedValue(null),
  getChatWorkflowRuns: vi.fn().mockResolvedValue([]),
  resumeChat: vi.fn().mockResolvedValue(undefined),
  cancelQueuedMessage: vi.fn().mockResolvedValue(undefined),
  editQueuedMessage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../lib/api/git', () => ({
  acceptWorktreeOffer: vi.fn().mockResolvedValue(undefined),
  dismissWorktreeOffer: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/toast', () => ({
  mfToast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), permission: vi.fn() },
}));

import type { CustomCommand } from '@qlan-ro/mainframe-types';
import { publishCommands } from '../../commands/command-registry';
import { CHAT_ID, makeController, makeMsg } from './acp-test-kit';

const COMMANDS: CustomCommand[] = [
  { name: 'launch-config', description: 'Generate .mainframe/launch.json for this project', source: 'mainframe' },
  { name: 'compact', description: 'Compact the conversation', source: 'claude' },
];

async function sendAndCapture(text: string) {
  const { ctrl, acpClient } = makeController();
  await ctrl.sendMessage(makeMsg(text));
  return acpClient.promptCalls[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  publishCommands(COMMANDS);
});

describe('AcpChatController.sendMessage — command invocations', () => {
  it('tags a bare command invocation with its name and source', async () => {
    expect(await sendAndCapture('/launch-config')).toEqual({
      sessionId: CHAT_ID,
      text: '/launch-config',
      extra: { _meta: { '_mainframe.dev': { command: { name: 'launch-config', source: 'mainframe' } } } },
    });
  });

  it('carries an adapter command through with its own source', async () => {
    expect(await sendAndCapture('/compact')).toMatchObject({
      extra: { _meta: { '_mainframe.dev': { command: { name: 'compact', source: 'claude' } } } },
    });
  });

  it('leaves an ordinary message untagged', async () => {
    expect(await sendAndCapture('hello world')).toEqual({ sessionId: CHAT_ID, text: 'hello world', extra: {} });
  });

  it('leaves a draft with trailing prose untagged, so the words are not discarded', async () => {
    expect(await sendAndCapture('/launch-config for the api package')).toEqual({
      sessionId: CHAT_ID,
      text: '/launch-config for the api package',
      extra: {},
    });
  });

  it('leaves an unknown slash token untagged', async () => {
    expect(await sendAndCapture('/not-a-command')).toEqual({ sessionId: CHAT_ID, text: '/not-a-command', extra: {} });
  });

  it('sends untagged when the command list never loaded', async () => {
    publishCommands([]);
    expect(await sendAndCapture('/launch-config')).toEqual({ sessionId: CHAT_ID, text: '/launch-config', extra: {} });
  });
});
