/** What a sub-agent's row knows of its chat, and in whose scope its actions run (T1c, W8). */
import { fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ThreadMessage } from '@assistant-ui/react';
import { useLayoutStore } from '@/store/layout';
import { onSurfaceIntent } from '@/store/surface-intents';
import { createChatThreadState } from '../../../controller/chat-thread-state';
import { OwnChatStateProvider } from '../../../runtime/own-chat-state';
import { ChatFileBasesContext } from '../../../tools/chat-file-bases';
import { useWorkflowRun } from '../../../workflow/use-workflow-run';
import type { ToolPart } from '../../../view-model/turn/types';
import { AgentSteps } from '../AgentSteps';
import { AgentWorldProvider, useAgentWork, type AgentWorld } from '../agent-world';
import { TranscriptScopeProvider } from '../transcript-scope';
import { TurnFixture, assistant, running, text, tool, user } from './fixtures';

vi.mock('../../AssistantForkAction', () => ({ AssistantForkAction: () => null }));
vi.mock('@/lib/api/background-tasks', () => ({
  listBackgroundTasks: vi.fn().mockResolvedValue([]),
  readBackgroundTaskOutput: vi.fn(),
}));

const open = { ...tool({ toolCallId: 'call', toolName: 'Task', ...running }), status: { type: 'running' } } as ToolPart;
const scope = { rootThreadId: 'r', chatId: 'parent', ancestors: [], pendingToolIds: new Set<string>() };

function workIn(world?: AgentWorld, live?: boolean) {
  const wrapper = ({ children }: { children: ReactNode }) => {
    const inner = <TranscriptScopeProvider value={{ ...scope, live }}>{children}</TranscriptScopeProvider>;
    return world ? <AgentWorldProvider value={world}>{inner}</AgentWorldProvider> : inner;
  };
  return renderHook(() => useAgentWork(open), { wrapper }).result.current;
}
const runs: AgentWorld = { runs: true, tasks: null, live: true };

it('runs while its chat and its part do', () => {
  expect(workIn(runs)).toMatchObject({ status: 'running', outcome: 'going' });
  expect(workIn(runs, false)).toMatchObject({ status: 'stopped', outcome: 'stopped' });
});

it.each([
  ['nothing is known of its chat', undefined],
  ['its chat is idle', { ...runs, runs: false }],
  ['the connection is lost', { ...runs, live: false }],
])('is not said to run, nor to have ended, when %s', (_why, world) => {
  expect(workIn(world)).toMatchObject({ standing: null, status: 'unknown', outcome: 'going' });
});

it('is over with its part, where the chat says which parts are', () => {
  expect(workIn({ ...runs, over: new Set(['call']) }).status).toBe('stopped');
  expect(workIn({ ...runs, over: new Set(['other']) }).status).toBe('running');
});

const tabs = () => useLayoutStore.getState().run?.panes.flatMap((pane) => pane.tabs) ?? [];
beforeEach(() =>
  useLayoutStore.setState({ layout: { top: ['chat'], topFlex: {} }, run: null, activeSessionId: 'column' }),
);

const agent = (over: object = {}) =>
  tool({
    toolCallId: 'agent',
    toolName: 'Task',
    args: { subagent_type: 'worker', description: 'Inspect files', prompt: 'Look' },
    result: 'done',
    ...over,
  });

it('opens as an agent tab in the workspace, once, by its call', () => {
  render(<TurnFixture rootId="opens" messages={[user('Hi'), assistant([agent(), text('Done')], 'm')]} />);
  fireEvent.click(screen.getByTestId(/^chat-work-toggle-/));
  const action = screen.getByTestId('chat-task-open-agent');
  expect(action).toHaveAccessibleName('Open Inspect files in the workspace');
  fireEvent.click(action);
  fireEvent.click(action);
  expect(tabs()).toEqual([
    {
      id: 'agent-agent',
      kind: 'agent',
      title: 'Inspect files',
      chatId: 'chat-fixture',
      toolCallId: 'agent',
      messageId: 'm',
    },
  ]);
  expect(useLayoutStore.getState().layout.top).toEqual(['chat', 'workspace']);
});

/** An agent's steps in the workspace, whose chat is not the one in the column. */
function InTab({ messages }: { messages: readonly ThreadMessage[] }) {
  const bases = { worktreePath: '/wt/parent', projectPath: '/proj' };
  return (
    <TurnFixture rootId="tab" messages={[user('Hi')]}>
      <TranscriptScopeProvider value={scope}>
        <ChatFileBasesContext.Provider value={bases}>
          <div data-testid="tab">
            <AgentSteps bare messages={messages} messageId="m" toolCallId="outer" outcome="done" />
          </div>
        </ChatFileBasesContext.Provider>
      </TranscriptScopeProvider>
    </TurnFixture>
  );
}

it('opens its own agents and files as its parent’s, not as the conversation’s', () => {
  const intents: unknown[] = [];
  const off = onSurfaceIntent((intent) => intents.push(intent));
  const read = tool({ toolCallId: 'read', args: { file_path: '/wt/parent/src/a.ts' } });
  render(<InTab messages={[assistant([agent(), read], 'n')]} />);
  const tab = within(screen.getByTestId('tab'));
  fireEvent.click(tab.getByTestId('chat-task-open-agent'));
  expect(tabs().map(({ chatId }) => chatId)).toEqual(['parent']);
  expect(tab.getByTestId('chat-row-read')).toHaveTextContent(/src\/a\.ts/);
  expect(tab.getByTestId('chat-row-read')).not.toHaveTextContent('/wt/parent');
  fireEvent.click(tab.getByTestId('chat-row-open-file-read'));
  expect(intents).toEqual([expect.objectContaining({ type: 'open-file', path: '/wt/parent/src/a.ts' })]);
  off();
});

it('reads a workflow of its parent’s from its parent’s state', () => {
  const run = { taskId: 'w', workflowName: 'deploy' };
  const state = { ...createChatThreadState('parent'), workflowRuns: { w: run } } as never;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TurnFixture rootId="own" messages={[]}>
      <OwnChatStateProvider value={state}>{children}</OwnChatStateProvider>
    </TurnFixture>
  );
  expect(renderHook(() => useWorkflowRun('w'), { wrapper }).result.current).toBe(run);
  expect(renderHook(() => useWorkflowRun('x'), { wrapper }).result.current).toBeUndefined();
});
