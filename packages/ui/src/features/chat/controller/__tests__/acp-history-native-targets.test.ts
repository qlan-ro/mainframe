import { expect, it, vi } from 'vitest';
import { AcpItemAccumulator } from '../../view-model/acp-item-accumulator';
import { AcpHistory } from '../acp-history';
import { isHeldHistoryItem } from '../acp-history-items';
import { makeFakeAcpClient } from './acp-test-kit';

it.each([true, false])('loads a native task target when held only as context: %s', async (context) => {
  const acc = new AcpItemAccumulator();
  const task = {
    sessionUpdate: 'tool_call_update' as const,
    toolCallId: 'tool:task',
    title: 'Task',
    _meta: { '_mainframe.dev': { sourceToolCallId: 'task', containerId: 'root', subagent: true } },
  };
  if (context) acc.apply(task);
  acc.apply({
    sessionUpdate: 'agent_message',
    messageId: 'message:0:task:task',
    content: [],
    _meta: { '_mainframe.dev': { containerId: 'task', parentToolCallId: 'tool:task' } },
  });
  const client = makeFakeAcpClient();
  const history = new AcpHistory({
    chatId: () => 'chat',
    client: () => client,
    active: () => true,
    changed: () => {},
    prepend: () => {
      if (!context) acc.apply(task);
    },
    hasItem: (id, floor) => isHeldHistoryItem(acc.itemsInOrder, id, floor),
  });
  history.reset({ hasMore: true, floorItemId: 'message:0:task:task' });
  expect(history.isContextItem('task')).toBe(context);
  client.historyPage = vi.fn(async (params, apply) => {
    expect(params.untilItemId).toBe('task');
    apply({ hasMore: false, floorItemId: 'tool:task', updates: [] });
  });
  expect(await history.load('task')).toBe(true);
  expect(client.historyPage).toHaveBeenCalledTimes(1);
  expect(history.isContextItem('task')).toBe(false);
});
