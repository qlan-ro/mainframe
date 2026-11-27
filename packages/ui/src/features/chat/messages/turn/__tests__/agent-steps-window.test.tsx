/** A sub-agent's held window: a page landing above keeps its rows, and a window cut short claims no answer (#463). */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ThreadMessage } from '@assistant-ui/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TurnFixture, assistant, bash, text, user } from './fixtures';
import { AgentSteps, type AgentStepsProps } from '../AgentSteps';

vi.mock('../../AssistantForkAction', () => ({ AssistantForkAction: () => null }));
vi.mock('@/lib/api/background-tasks', () => ({
  listBackgroundTasks: vi.fn().mockResolvedValue([]),
  readBackgroundTaskOutput: vi.fn().mockResolvedValue(''),
}));

let roots = 0;
beforeEach(() => roots++);

function steps(messages: readonly ThreadMessage[], props: Partial<AgentStepsProps> = {}) {
  return (
    <TurnFixture rootId={`window-${roots}`} messages={[user('Go'), assistant([text('Host')], 'host')]}>
      <TooltipProvider>
        <div data-testid="agent">
          <AgentSteps messages={messages} messageId="host" toolCallId="agent" outcome="done" bare {...props} />
        </div>
      </TooltipProvider>
    </TurnFixture>
  );
}
const agent = () => within(screen.getByTestId('agent'));
const newer = [assistant([bash('b2', 'git status')], 'a2'), assistant([bash('b3', 'git diff')], 'a3')];
const older = [assistant([bash('b0', 'ls')], 'a0'), assistant([bash('b1', 'pwd')], 'a1')];

// The list keys rows by message id (assistant-ui 0.15.38), so the browser and the scroll owner can anchor on them.
it('keeps the element of every row when an older page lands above', () => {
  const view = render(steps(newer));
  const rows = ['b2', 'b3'].map((id) => agent().getByTestId(`chat-row-${id}`));
  view.rerender(steps([...older, ...newer]));
  expect(agent().getByTestId('chat-row-b0')).toBeVisible();
  expect(['b2', 'b3'].map((id) => agent().getByTestId(`chat-row-${id}`))).toEqual(rows);
  rows.forEach((row) => expect(row.isConnected).toBe(true));
});

it('claims no answer from a window whose newest pages were dropped', () => {
  const cut = [...older, assistant([text('Halfway there.')], 'a2')];
  // Its last held words are a step in the middle of its work, not what it ended with.
  const view = render(steps(cut, { bare: false, prompt: 'Go', endsEarly: true }));
  expect(agent().queryByTestId('chat-agent-result')).toBeNull();
  expect(agent().getByText('Halfway there.')).toBeVisible();
  view.rerender(steps(cut, { bare: false, prompt: 'Go' }));
  expect(agent().getByTestId('chat-agent-result')).toHaveTextContent('ResultHalfway there.');
});
