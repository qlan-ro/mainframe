import { afterEach, expect, it, vi } from 'vitest';
import type { ResumeSessionResponse } from '@qlan-ro/mainframe-types';
import { AcpSessionPlane } from '../acp-session-plane';
import { makeFakeAcpClient } from './acp-test-kit';

afterEach(() => vi.unstubAllGlobals());

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

it('loads an earlier item inside a container that already has a loaded tail', async () => {
  vi.stubGlobal('window', new EventTarget());
  const client = makeFakeAcpClient({ capabilities: { windowedHistory: true } });
  const plane = new AcpSessionPlane({ getChatId: () => 'chat', dispatch: vi.fn(), isDisposed: () => false });
  await plane.attach(client);
  client.emitUpdate('chat', {
    sessionUpdate: 'agent_message',
    messageId: 'partial-text-4',
    content: [{ type: 'text', text: 'tail' }],
    _meta: { '_mainframe.dev': { containerId: 'partial' } },
  });
  plane.history.reset({ hasMore: true, floorItemId: 'partial-text-4' });
  client.historyPage = vi.fn(async (params, apply) => {
    expect(params.untilItemId).toBe('partial');
    apply({
      hasMore: false,
      floorItemId: 'partial-thought',
      updates: [
        {
          sessionUpdate: 'agent_thought',
          messageId: 'partial-thought',
          content: [{ type: 'text', text: 'earlier' }],
          _meta: { '_mainframe.dev': { containerId: 'partial' } },
        },
      ],
    });
  });
  expect(await plane.history.load('partial')).toBe(true);
  expect(client.historyPage).toHaveBeenCalledTimes(1);
  plane.dispose();
});

it('loads through a task card that is present only as context before the floor', async () => {
  const client = makeFakeAcpClient({ capabilities: { windowedHistory: true } });
  const plane = new AcpSessionPlane({ getChatId: () => 'chat', dispatch: vi.fn(), isDisposed: () => false });
  await plane.attach(client);
  for (const id of ['parent', 'held'])
    client.emitUpdate('chat', {
      sessionUpdate: 'agent_message',
      messageId: id,
      content: [{ type: 'text', text: id }],
    });
  plane.history.reset({ hasMore: true, floorItemId: 'held' });
  client.historyPage = vi.fn(async (_, apply) => apply({ hasMore: false, floorItemId: 'parent', updates: [] }));
  expect(await plane.history.load('parent')).toBe(true);
  expect(client.historyPage).toHaveBeenCalledTimes(1);
  plane.dispose();
});
