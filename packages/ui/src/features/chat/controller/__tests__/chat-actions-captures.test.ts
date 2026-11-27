// @vitest-environment jsdom
/** A send that fails gives the draft its preview captures back (C14), over a fake `ChatActionHost`. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppendMessage } from '@assistant-ui/react';
import type { Chat } from '@qlan-ro/mainframe-types';

const upload = vi.hoisted(() => vi.fn());
vi.mock('../../../../lib/api/attachments', () => ({ uploadAttachments: upload }));
vi.mock('@/lib/toast', () => ({ mfToast: { error: vi.fn() } }));

import { composeMessage } from '../../composer/draft-content/compose-message';
import {
  draftItemsOf,
  holdSentCaptures,
  restoreSentCapture,
  useDraftContent,
  type DraftCapture,
} from '../../composer/draft-content/draft-content-store';
import { getUnsent, holdUnsent, unsentMetadata } from '../../composer/unsent/unsent-store';
import { sendChatMessage, type ChatActionHost } from '../chat-actions';
import { createChatThreadState, reduceChatThreadState } from '../chat-thread-state';

const CAPTURE: DraftCapture = {
  id: 'cap-1',
  kind: 'capture',
  type: 'element',
  imageDataUrl: 'data:image/png;base64,AA',
  selector: '.btn',
  note: 'Too wide',
};
const FILE = {
  id: 'file-1',
  type: 'document',
  name: 'a.txt',
  contentType: 'text/plain',
  content: [{ type: 'text', text: 'data:text/plain;base64,aGk=' }],
  status: { type: 'complete' },
};

function makeHost(sendPrompt = vi.fn().mockResolvedValue({ queued: false }), chatConfig?: object) {
  let state = { ...createChatThreadState('chat-1'), ...(chatConfig ? { chatConfig: chatConfig as Chat } : {}) };
  const host: ChatActionHost = {
    getPort: () => 1,
    getDaemonId: () => 'chat-1',
    getState: () => state,
    dispatch: (event) => {
      state = reduceChatThreadState(state, event);
    },
    load: () => Promise.resolve(),
    sendPrompt,
    announceUserSend: vi.fn(),
  };
  return { host, pending: () => Object.values(state.pendingUserMessages)[0] };
}

function message(...extra: unknown[]): AppendMessage {
  holdSentCaptures('t1', [CAPTURE]);
  const { body, attachments } = composeMessage('Fix it', [CAPTURE]);
  return {
    role: 'user',
    content: [{ type: 'text', text: body }],
    attachments: [...attachments, ...extra],
  } as unknown as AppendMessage;
}

beforeEach(() => {
  vi.clearAllMocks();
  useDraftContent.setState({ byThread: {} });
  upload.mockResolvedValue(['att-1']);
});

describe('sendChatMessage with captures', () => {
  it('uploads the image and sends the note with the text', async () => {
    const sendPrompt = vi.fn().mockResolvedValue({ queued: false });
    await sendChatMessage(makeHost(sendPrompt).host, message());
    expect(upload).toHaveBeenCalledExactlyOnceWith(1, 'chat-1', [
      { name: 'element1.png', mediaType: 'image/png', data: 'AA' },
    ]);
    expect(sendPrompt.mock.calls[0]![0]).toContain('"Too wide"');
  });

  it('lets them go once it went through', async () => {
    await sendChatMessage(makeHost().host, message());
    expect(draftItemsOf('t1')).toEqual([]);
    expect(restoreSentCapture('cap-1')).toBe(false);
  });

  it.each([
    ['upload', () => upload.mockRejectedValue(new Error('413')), undefined],
    ['send', () => undefined, vi.fn().mockRejectedValue(new Error('offline'))],
  ])('puts them back, note and all, when the %s fails', async (_stage, arrange, sendPrompt) => {
    arrange();
    const { host, pending } = makeHost(sendPrompt);
    await expect(sendChatMessage(host, message())).rejects.toThrow();
    expect(draftItemsOf('t1')).toEqual([CAPTURE]);
    // Retry is text-only, so it is not offered for what is back in the composer.
    expect(pending()?.attachmentsRestored).toBe(true);
  });

  it('says only the captures are back when there were files too', async () => {
    upload.mockRejectedValue(new Error('413'));
    const { host, pending } = makeHost();
    await expect(sendChatMessage(host, message(FILE))).rejects.toThrow();
    expect(draftItemsOf('t1')).toEqual([CAPTURE]);
    expect(pending()?.attachmentsRestored).toBeUndefined();
  });

  it('does not call a failed plain message’s attachments restored', async () => {
    const { host, pending } = makeHost(vi.fn().mockRejectedValue(new Error('offline')));
    const plain = {
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
      attachments: [],
    } as unknown as AppendMessage;
    await expect(sendChatMessage(host, plain)).rejects.toThrow();
    expect(pending()?.attachmentsRestored).toBeUndefined();
  });
});

describe('a draft’s first message that stops before it is sent', () => {
  const first = (text: string) => {
    const draft = { text, items: [], attachments: [], references: {} };
    const id = holdUnsent({ threadId: 'chat-1', draft, sent: [] });
    const content = text ? [{ type: 'text', text }] : [];
    const parts = { role: 'user', content, attachments: [], metadata: unsentMetadata(id) };
    return { id, message: parts as unknown as AppendMessage };
  };

  it.each([
    ['hi', { directoryMissing: true }, 'The working directory is missing.'],
    ['', undefined, 'There is nothing in it to send.'],
  ])('is kept, with the reason', async (text, chatConfig, reason) => {
    const { id, message: parts } = first(text);
    await sendChatMessage(makeHost(undefined, chatConfig).host, parts);
    expect(getUnsent(id)?.failure).toEqual({ reason, delivery: 'none' });
  });
});
