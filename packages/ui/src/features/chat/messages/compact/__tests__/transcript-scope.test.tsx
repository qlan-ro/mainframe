import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessage,
} from '@assistant-ui/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUiPrefs } from '@/store/ui-prefs';
import { SideChatScopeProvider } from '@/features/side-chat/side-chat-scope';
import { buildChatExtras } from '../../../runtime/chat-extras';
import { createChatThreadState, type ChatThreadState } from '../../../controller/chat-thread-state';
import type { AcpChatController } from '../../../controller/acp-chat-controller';
import * as model from '../../../view-model/compact/build-compact-rows';
import { AssistantMessage } from '../../AssistantMessage';
import { NestedTranscriptScope, RootTranscriptScope, useTranscriptScope } from '../transcript-scope';
import { fixtureMessage, fixtureTool } from './fixtures';

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
                <ThreadPrimitive.Messages components={{ AssistantMessage, UserMessage: () => null }} />
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
const history = fixtureMessage([fixtureTool({ toolCallId: 'historical-read' })], 'history');
const activeTool = fixtureTool({
  toolCallId: 'active-read',
  result: undefined,
  providerMetadata: { mainframe: { acpStatus: 'in_progress' } },
});
const active = (text: string) => fixtureMessage([activeTool, { type: 'text', text }], 'active', true);
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
  useUiPrefs.getState().setTranscriptMode('compact');
});

it('does not rebuild historical rows when only the active message streams with new extras', async () => {
  const build = vi.spyOn(model, 'buildCompactRows');
  const state = createChatThreadState('scope-chat');
  const view = render(<ScopeFixture messages={[history, active('first chunk')]} state={state} />);
  await screen.findByText('first chunk');
  const historicalCalls = () =>
    build.mock.calls.filter(([parts]) =>
      parts.some(({ part }) => part.type === 'tool-call' && part.toolCallId === 'historical-read'),
    ).length;
  const count = historicalCalls();
  expect(count).toBeGreaterThan(0);
  view.rerender(<ScopeFixture messages={[history, active('next chunk')]} state={{ ...state }} />);
  await screen.findByText('next chunk');
  expect(historicalCalls()).toBe(count);
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
  await screen.findByRole('button', { name: /Reading/ });
  view.rerender(<ScopeFixture messages={messages} state={withPermission(state)} />);
  await screen.findByRole('button', { name: /Waiting for approval/ });
  expect(readScope()).toMatchObject({
    rootThreadId: 'side-root',
    chatId: 'scope-chat',
    ancestors: ['["outer-message","outer-call"]', '["inner-message","inner-call"]'],
    pendingToolIds: ['active-read'],
  });
  view.rerender(<ScopeFixture messages={messages} state={{ ...state, chatId: 'other-chat' }} sideId="other-root" />);
  await screen.findByRole('button', { name: /Reading/ });
  await waitFor(() =>
    expect(readScope()).toMatchObject({ rootThreadId: 'other-root', chatId: 'other-chat', pendingToolIds: [] }),
  );
});
