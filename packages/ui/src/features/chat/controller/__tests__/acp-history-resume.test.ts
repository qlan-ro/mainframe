import { expect, it, vi } from 'vitest';
import type { ResumeSessionResponse } from '@qlan-ro/mainframe-types';
import { AcpSessionPlane } from '../acp-session-plane';
import { makeFakeAcpClient } from './acp-test-kit';

it('does not page behind an unfinished resume and accepts pages after it settles', async () => {
  const client = makeFakeAcpClient({ capabilities: { windowedHistory: true } });
  const plane = new AcpSessionPlane({ getChatId: () => 'chat', dispatch: vi.fn(), isDisposed: () => false });
  await plane.attach(client);
  plane.history.reset({ hasMore: true, floorItemId: 'tail' });
  let finish!: (reply: ResumeSessionResponse) => void;
  client.resume = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  client.historyPage = vi.fn(async (_, apply) => apply({ hasMore: false, floorItemId: 'first', updates: [] }));
  const resume = plane.reattach();
  expect(await plane.history.load()).toBe(false);
  expect(client.historyPage).not.toHaveBeenCalled();
  finish({ _meta: { '_mainframe.dev': { history: { hasMore: true, floorItemId: 'tail' } } } });
  await resume;
  expect(await plane.history.load()).toBe(true);
  expect(client.historyPage).toHaveBeenCalledTimes(1);
  plane.dispose();
});
