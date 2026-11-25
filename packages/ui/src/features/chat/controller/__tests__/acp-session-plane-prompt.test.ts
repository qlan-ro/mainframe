import { expect, it, vi } from 'vitest';
import { AcpSessionPlane } from '../acp-session-plane';
import { CHAT_ID, makeFakeAcpClient } from './acp-test-kit';

it('maps the queue position and queued message id from the prompt response', async () => {
  const client = makeFakeAcpClient();
  vi.spyOn(client, 'prompt').mockResolvedValue({
    stopReason: 'end_turn',
    _meta: { '_mainframe.dev': { position: 1, messageId: 'queued-1' } },
  });
  const plane = new AcpSessionPlane({ getChatId: () => CHAT_ID, dispatch: vi.fn(), isDisposed: () => false });
  await plane.attach(client);
  expect(await plane.sendPrompt('text', {})).toEqual({ queued: true, queuedMessageId: 'queued-1' });
});
