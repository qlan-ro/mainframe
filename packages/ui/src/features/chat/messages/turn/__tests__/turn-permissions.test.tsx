/** A request is answered above the composer, whether its turn is open or folded (G5, T1b). */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useUiPrefs } from '@/store/ui-prefs';
import { buildChatExtras } from '../../../runtime/chat-extras';
import { createChatThreadState } from '../../../controller/chat-thread-state';
import type { AcpChatController } from '../../../controller/acp-chat-controller';
import { ChatGateMount } from '../../../gates/ChatGateMount';
import { TurnFixture, assistant, bash, running, text, user } from './fixtures';

vi.mock('../../AssistantForkAction', () => ({ AssistantForkAction: () => null }));
vi.mock('@/lib/api/background-tasks', () => ({
  listBackgroundTasks: vi.fn().mockResolvedValue([]),
  readBackgroundTaskOutput: vi.fn().mockResolvedValue(''),
}));

const entry = {
  requestId: 'request',
  askedAt: 1,
  request: {
    requestId: 'request',
    toolUseId: 'guarded',
    toolName: 'Bash',
    input: { command: 'npm test' },
    suggestions: [],
  },
  options: [
    { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' as const },
    { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' as const },
  ],
};
const gate: ReactNode = (
  <div data-testid="fixture-footer">
    <ChatGateMount />
  </div>
);
const messages = [user('Hi'), assistant([text('I will test it'), bash('guarded', 'npm test', running)], 'a')];
const header = () => screen.getByTestId(/^chat-work-toggle-/);

let roots = 0;
beforeEach(() => {
  roots++;
  useUiPrefs.setState({ finishedWork: 'fold' });
});

/** The thread while the request is pending: it reports itself idle. */
function show(reply: () => Promise<void>) {
  const state = createChatThreadState('chat-fixture');
  const extras = buildChatExtras({ replyToPermission: reply } as unknown as AcpChatController, 31415, {
    ...state,
    interactions: { ...state.interactions, permissions: { request: entry } },
  });
  return render(
    <TurnFixture rootId={`gate-${roots}`} messages={messages} extras={extras} isRunning={false} pending={['guarded']}>
      {gate}
    </TurnFixture>,
  );
}

it('never reads as finished, and stays open on the step that waits', () => {
  show(vi.fn());
  expect(header()).toHaveAccessibleName(/^Waiting on you/);
  expect(header()).toHaveAttribute('aria-expanded', 'true');
  expect(header().parentElement).toHaveAttribute('data-work-state', 'needs-you');
  expect(screen.getByTestId('chat-row-guarded-receipt')).toHaveTextContent('needs approval');
  // The reply isn't done, so it offers no copy of itself; the viewer's own message does.
  expect(screen.getAllByTestId('chat-message-copy')).toHaveLength(1);
});

it.each([
  ['allow-once', 'open'],
  ['reject-once', 'open'],
  ['allow-once', 'folded'],
  ['reject-once', 'folded'],
] as const)('answers %s while the turn is %s', (optionId, fold) => {
  const reply = vi.fn().mockResolvedValue(undefined);
  show(reply);
  if (fold === 'folded') {
    fireEvent.click(header());
    expect(header()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('chat-row-guarded')).toBeNull();
  }
  expect(screen.getByTestId('chat-thread-gate-slot')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: optionId === 'allow-once' ? 'Allow once' : 'Reject' }));
  expect(reply).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'request' }), optionId);
});

it.each([
  ['running', /^Waiting on you/],
  ['cancelling', /^Waiting on you/],
  // A background agent's request, whose call isn't loaded: the newest turn doesn't wait on it.
  ['idle', /^Worked/],
] as const)('reads a request whose call is not here by the run, %s, not by the thread', (type, name) => {
  const state = createChatThreadState('chat-fixture');
  const extras = buildChatExtras({} as AcpChatController, 31415, {
    ...state,
    runState: { type },
    interactions: { ...state.interactions, permissions: { request: entry } },
  });
  render(
    <TurnFixture
      rootId={`gate-${roots}`}
      messages={[user('Hi'), assistant([bash('b', 'ls'), text('One moment')], 'a')]}
      extras={extras}
      isRunning={false}
      pending={['guarded']}
    />,
  );
  expect(header()).toHaveAccessibleName(name);
});
