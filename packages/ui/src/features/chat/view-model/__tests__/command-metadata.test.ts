import { expect, it } from 'vitest';
import { convertAcpItems } from '../convert-acp-item';

it.each([0, 1234])('preserves Codex actions and exact duration %i on the native tool part', (duration) => {
  const commandExecution = {
    commandActions: [{ type: 'read', command: 'cat a', name: 'a', path: 'a' }],
    reportedDurationMs: duration,
  };
  const messages = convertAcpItems(
    [
      {
        kind: 'tool-call',
        id: 'cmd',
        title: 'Bash',
        status: 'completed',
        rawInput: { command: 'cat a' },
        content: [],
        meta: { '_mainframe.dev': { containerId: 'm', commandExecution } },
      },
    ],
    () => new Date(0),
  );
  expect(messages[0]?.content).toEqual([
    expect.objectContaining({
      toolCallId: 'cmd',
      toolName: 'Bash',
      args: { command: 'cat a' },
      providerMetadata: { codex: commandExecution, mainframe: { acpStatus: 'completed' } },
    }),
  ]);
});

it('keeps metadata through whole-meta updates, grouping, and subagent projection', async () => {
  const { AcpItemAccumulator } = await import('../acp-item-accumulator');
  const acc = new AcpItemAccumulator();
  const commandActions = [
    { type: 'search', command: 'rg x', query: null, path: null },
    { type: 'listFiles', command: 'ls', path: null },
    { type: 'unknown', command: 'custom' },
  ];
  const base = { containerId: 'task', groupId: 'cmd', parentToolCallId: 'task' };
  acc.apply({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'task',
    title: 'task',
    _meta: { '_mainframe.dev': { subagent: true, containerId: 'm' } },
  });
  acc.apply({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'cmd',
    title: 'Bash',
    rawInput: { command: 'rg x' },
    _meta: { '_mainframe.dev': { ...base, commandExecution: { commandActions } } },
  });
  const commandExecution = { commandActions, reportedDurationMs: 1234 };
  acc.apply({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'cmd',
    _meta: { '_mainframe.dev': { ...base, commandExecution } },
  });
  acc.apply({ sessionUpdate: 'tool_call_update', toolCallId: 'cmd', status: 'completed' });
  expect(acc.itemsInOrder).toHaveLength(2);
  expect(acc.itemsInOrder[1]?.meta).toEqual({ '_mainframe.dev': { ...base, commandExecution } });
  const messages = convertAcpItems(acc.itemsInOrder, () => new Date(0));
  expect(messages[0]?.content).toEqual([
    expect.objectContaining({
      toolCallId: 'task',
      messages: [
        expect.objectContaining({
          content: [
            expect.objectContaining({
              toolCallId: 'cmd',
              providerMetadata: { codex: commandExecution, mainframe: { acpStatus: 'completed' } },
            }),
          ],
        }),
      ],
    }),
  ]);
});

it('does not attach provider metadata to legacy tool calls', () => {
  const messages = convertAcpItems(
    [
      {
        kind: 'tool-call',
        id: 'old',
        title: 'Bash',
        content: [],
        rawInput: { command: 'echo old' },
      },
    ],
    () => new Date(0),
  );
  expect(messages[0]?.content).toEqual([expect.not.objectContaining({ providerMetadata: expect.anything() })]);
});

it('projects lifecycle, Codex metadata and native timing together without altering arguments or output', () => {
  const commandExecution = {
    commandActions: [{ type: 'read', command: 'cat a', name: 'a', path: 'a' }],
    reportedDurationMs: 123,
  };
  const toolCallTiming = { startedAt: 1790899200000, completedAt: 1790899200123 };
  const messages = convertAcpItems(
    [
      {
        kind: 'tool-call',
        id: 'joint',
        title: 'Bash',
        status: 'completed',
        rawInput: { command: 'cat a', description: 'Read a' },
        content: [{ type: 'content', content: { type: 'text', text: 'file contents' } }],
        meta: { '_mainframe.dev': { containerId: 'message', commandExecution, toolCallTiming } },
      },
    ],
    () => new Date(0),
  );
  expect(messages[0]).toMatchObject({
    id: 'message',
    content: [
      {
        toolCallId: 'joint',
        toolName: 'Bash',
        args: { command: 'cat a', description: 'Read a' },
        result: 'file contents',
        timing: toolCallTiming,
        providerMetadata: { codex: commandExecution, mainframe: { acpStatus: 'completed' } },
      },
    ],
  });
});
