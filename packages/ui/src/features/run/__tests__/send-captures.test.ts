import { it, expect, vi } from 'vitest';
import { sendCaptures } from '../send-captures';

it('uploads attachments then sends the sentinel markdown with attachment ids', async () => {
  const uploadAttachments = vi.fn().mockResolvedValue(['att-1', 'att-2']);
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  await sendCaptures(
    [
      { id: '1', type: 'element', imageDataUrl: 'data:image/png;base64,AAAA', selector: 'b.x' },
      { id: '2', type: 'screenshot', imageDataUrl: 'data:image/png;base64,BBBB' },
    ],
    { port: 31415, chatId: 'chat-1', uploadAttachments, sendMessage },
  );
  expect(uploadAttachments).toHaveBeenCalledWith(
    31415,
    'chat-1',
    expect.arrayContaining([expect.objectContaining({ name: 'element1.png' })]),
  );
  const sent = sendMessage.mock.calls[0]![0] as { text: string; attachmentIds: string[] };
  expect(sent.text.startsWith('\0__MF_SANDBOX_CAPTURE__')).toBe(true);
  expect(sent.attachmentIds).toEqual(['att-1', 'att-2']);
});

it('no-ops on empty captures', async () => {
  const uploadAttachments = vi.fn();
  const sendMessage = vi.fn();
  await sendCaptures([], { port: 31415, chatId: 'chat-1', uploadAttachments, sendMessage });
  expect(uploadAttachments).not.toHaveBeenCalled();
  expect(sendMessage).not.toHaveBeenCalled();
});

it('sendMessage receives all attachment ids returned by upload', async () => {
  const uploadAttachments = vi.fn().mockResolvedValue(['id-a', 'id-b', 'id-c']);
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  await sendCaptures(
    [
      { id: '1', type: 'screenshot', imageDataUrl: 'data:image/png;base64,X' },
      { id: '2', type: 'screenshot', imageDataUrl: 'data:image/png;base64,Y' },
      { id: '3', type: 'element', imageDataUrl: 'data:image/png;base64,Z' },
    ],
    { port: 31415, chatId: 'chat-2', uploadAttachments, sendMessage },
  );
  const sent = sendMessage.mock.calls[0]![0] as { text: string; attachmentIds: string[] };
  expect(sent.attachmentIds).toEqual(['id-a', 'id-b', 'id-c']);
});

it('upload is called with the correct port and chatId', async () => {
  const uploadAttachments = vi.fn().mockResolvedValue(['x']);
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  await sendCaptures([{ id: '1', type: 'screenshot', imageDataUrl: 'data:image/png;base64,A' }], {
    port: 9999,
    chatId: 'chat-xyz',
    uploadAttachments,
    sendMessage,
  });
  expect(uploadAttachments.mock.calls[0]![0]).toBe(9999);
  expect(uploadAttachments.mock.calls[0]![1]).toBe('chat-xyz');
});
