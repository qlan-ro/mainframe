/**
 * Which transcript "Show full output" reads inside a saved sub-agent: rows from
 * the child's page read the child, while the Agent call's own result, and steps
 * an older parent kept inline, read wherever the call itself lives.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ThreadMessage, ToolCallMessagePart } from '@assistant-ui/react';
import { TurnFixture, assistant, tool, user } from './fixtures';
import { historyKey, releaseSubagentHistory, useSubagentHistoryStore } from '../subagent-history-store';

vi.mock('../../AssistantForkAction', () => ({ AssistantForkAction: () => null }));
vi.mock('@/lib/api/background-tasks', () => ({
  listBackgroundTasks: vi.fn().mockResolvedValue([]),
  readBackgroundTaskOutput: vi.fn().mockResolvedValue(''),
}));
vi.mock('../../../tools/chat-tool-context', async (original) => ({
  ...(await original<object>()),
  useChatId: () => 'chat-fixture',
}));
vi.mock('../../../tools/ToolResultExpand', () => ({
  ToolResultExpand: ({ toolUseId, agentId }: { toolUseId: string; agentId?: string }) => (
    <div data-testid={`expand-${toolUseId}`}>{agentId ?? 'own'}</div>
  ),
}));

const CHAT = 'chat-fixture';
const cut = { content: 'first lines', truncated: true, fullBytes: 90_000 };

const read = (toolCallId: string) => tool({ toolCallId, result: cut as never });
const agent = (toolCallId: string, nativeAgentId: string): ToolCallMessagePart =>
  tool({
    toolCallId,
    toolName: 'Task',
    args: { description: `Run ${nativeAgentId}`, prompt: 'Go' },
    argsText: '',
    result: cut as never,
    providerMetadata: { mainframe: { acpStatus: 'completed', subagentFact: { status: 'completed', nativeAgentId } } },
  });

/** A page the store already holds, as if the child's transcript had been read. */
function loaded(toolCallId: string, messages: readonly ThreadMessage[]) {
  const entries = new Map(useSubagentHistoryStore.getState().entries);
  entries.set(historyKey(CHAT, toolCallId), { messages, loading: false } as never);
  useSubagentHistoryStore.setState({ entries });
}

const open = (id: string) => {
  const toggle = screen.getByTestId(`chat-row-${id}-toggle`);
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
};
const source = (toolCallId: string) => screen.getByTestId(`expand-${toolCallId}`).textContent;

function show(parent: ToolCallMessagePart, rootId: string) {
  render(<TurnFixture rootId={rootId} messages={[user('Hi'), assistant([parent], 'parent-m')]} />);
  const header = screen.getByTestId(/^chat-work-toggle-/);
  if (header.getAttribute('aria-expanded') === 'false') fireEvent.click(header);
  open(parent.toolCallId);
}

beforeEach(() => releaseSubagentHistory(CHAT));

it("reads the child's rows from the child and the call's own result from the chat", () => {
  loaded('outer', [assistant([read('child-read')], 'child-m')]);
  show(agent('outer', 'worker'), 'own-result');
  open('child-read');
  expect(source('child-read')).toBe('worker');
  expect(source('outer')).toBe('own');
});

it("reads a nested Agent call's result from the child that made it", () => {
  loaded('outer', [assistant([agent('inner', 'helper')], 'child-m')]);
  loaded('inner', [assistant([read('inner-read')], 'inner-m')]);
  show(agent('outer', 'worker'), 'nested');
  open('inner');
  open('inner-read');
  expect(source('inner-read')).toBe('helper');
  expect(source('inner')).toBe('worker');
  expect(source('outer')).toBe('own');
});

it('reads steps an older parent kept inline from the chat, before any child page arrives', () => {
  const parent = { ...agent('outer', 'worker'), messages: [assistant([read('inline-read')], 'inline-m')] };
  // No daemon here, so the child's page is never requested and the inline steps stay.
  show(parent as ToolCallMessagePart, 'inline');
  open('inline-read');
  expect(source('inline-read')).toBe('own');
  expect(source('outer')).toBe('own');
});
