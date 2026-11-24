import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessage,
} from '@assistant-ui/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SideChatScopeProvider } from '@/features/side-chat/side-chat-scope';
import { buildChatExtras } from '../../../runtime/chat-extras';
import { createChatThreadState, type ChatThreadState } from '../../../controller/chat-thread-state';
import type { AcpChatController } from '../../../controller/acp-chat-controller';
import * as rows from '../../../view-model/turn/tool-row';
import { TurnTranscript } from '../TurnTranscript';
import { NestedTranscriptScope, RootTranscriptScope, useTranscriptScope } from '../transcript-scope';
import { assistant, running, text, tool, user } from './fixtures';

const scopes = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../../MessageActionBar', async () => {
  const { useTranscriptScope } = await import('../transcript-scope');
  return {
    MessageActionBar: () => {
      const scope = useTranscriptScope();
      scopes.set(scope.messageId!, scope);
      return null;
    },
  };
});

function NestedProbe() {
  const scope = useTranscriptScope();
  return (
    <output data-testid="nested-scope">
      {JSON.stringify({ ...scope, pendingToolIds: [...scope.pendingToolIds] })}
    </output>
  );
}
function ScopeFixture({
  messages,
  state,
  sideId = 'side-root',
}: {
  messages: ThreadMessage[];
  state: ChatThreadState;
  sideId?: string;
}) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messages,
    isRunning: true,
    onNew: async () => {},
    extras: buildChatExtras({} as AcpChatController, 31415, state),
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider>
        <SideChatScopeProvider value={{ parentChatId: 'parent-chat', sideChatId: sideId }}>
          <RootTranscriptScope>
            <ThreadPrimitive.Root>
              <ThreadPrimitive.Viewport>
                <TurnTranscript />
                <NestedTranscriptScope messageId="outer-message" toolCallId="outer-call">
                  <NestedTranscriptScope messageId="inner-message" toolCallId="inner-call">
                    <NestedProbe />
                  </NestedTranscriptScope>
                </NestedTranscriptScope>
              </ThreadPrimitive.Viewport>
            </ThreadPrimitive.Root>
          </RootTranscriptScope>
        </SideChatScopeProvider>
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}
const history = assistant(
  [tool({ toolCallId: 'historical-read', toolName: 'Bash', args: { command: 'ls' } }), text('Done')],
  'history',
);
const activeTool = tool({ toolCallId: 'active-read', ...running });
const active = (value: string) => assistant([activeTool, text(value)], 'active', { running: true });
function withPermission(state: ChatThreadState): ChatThreadState {
  return {
    ...state,
    interactions: {
      ...state.interactions,
      permissions: {
        request: {
          requestId: 'request',
          askedAt: 1,
          options: [],
          request: {
            requestId: 'request',
            toolUseId: 'active-read',
            toolName: 'Read',
            input: {},
            suggestions: [],
          },
        },
      },
    },
  };
}
afterEach(() => vi.restoreAllMocks());
const readScope = () => JSON.parse(screen.getByTestId('nested-scope').textContent!);
beforeEach(() => {
  scopes.clear();
});

it('does not rebuild historical rows when only the active message streams with new extras', async () => {
  const build = vi.spyOn(rows, 'toolRowFacts');
  const state = createChatThreadState('scope-chat');
  const prompt = user('Next', 'between');
  const view = render(<ScopeFixture messages={[history, prompt, active('first chunk')]} state={state} />);
  await screen.findByText('first chunk');
  fireEvent.click(screen.getByRole('button', { name: /^Finished: Worked/ }));
  const historical = () => build.mock.calls.filter(([part]) => part.toolCallId === 'historical-read').length;
  const count = historical();
  expect(count).toBeGreaterThan(0);
  view.rerender(<ScopeFixture messages={[history, prompt, active('next chunk')]} state={{ ...state }} />);
  await screen.findByText('next chunk');
  expect(historical()).toBe(count);
});

it('preserves the active message scope value while its content changes', async () => {
  const state = createChatThreadState('scope-chat');
  const view = render(<ScopeFixture messages={[active('before')]} state={state} />);
  await screen.findByText('before');
  const scope = scopes.get('active');
  expect(scope).toMatchObject({ messageId: 'active', chatId: 'scope-chat' });
  view.rerender(<ScopeFixture messages={[active('after')]} state={{ ...state }} />);
  await screen.findByText('after');
  expect(scopes.get('active')).toBe(scope);
});

it('refreshes permission statuses and carries root identity and pending IDs through nested scopes', async () => {
  const state = createChatThreadState('scope-chat');
  const messages = [active('awaiting input')];
  const view = render(<ScopeFixture messages={messages} state={state} />);
  await screen.findByText('Reading');
  view.rerender(<ScopeFixture messages={messages} state={withPermission(state)} />);
  await screen.findByText('Wants to read');
  expect(readScope()).toMatchObject({
    rootThreadId: 'side-root',
    chatId: 'scope-chat',
    ancestors: ['["outer-message","outer-call"]', '["inner-message","inner-call"]'],
    pendingToolIds: ['active-read'],
  });
  view.rerender(<ScopeFixture messages={messages} state={{ ...state, chatId: 'other-chat' }} sideId="other-root" />);
  await screen.findByText('Reading');
  await waitFor(() =>
    expect(readScope()).toMatchObject({ rootThreadId: 'other-root', chatId: 'other-chat', pendingToolIds: [] }),
  );
});
