import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useUiPrefs } from '@/store/ui-prefs';
import { buildChatExtras } from '../../../runtime/chat-extras';
import { createChatThreadState } from '../../../controller/chat-thread-state';
import type { AcpChatController } from '../../../controller/acp-chat-controller';
import { RootTranscriptScope } from '../transcript-scope';
import { AssistantMessage } from '../../AssistantMessage';
import { ChatGateMount } from '../../../gates/ChatGateMount';
import { CompactFixture, fixtureMessage, fixtureTool } from './fixtures';

function ScopedMessage() {
  return (
    <RootTranscriptScope>
      <AssistantMessage />
    </RootTranscriptScope>
  );
}
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

it.each(['allow-once', 'reject-once'])(
  'retains usable %s permission controls while switching modes and expanding',
  async (optionId) => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const state = createChatThreadState('permission-chat');
    const extras = buildChatExtras({ replyToPermission: reply } as unknown as AcpChatController, 31415, {
      ...state,
      interactions: { ...state.interactions, permissions: { request: entry } },
    });
    const messages = [
      fixtureMessage(
        [
          fixtureTool({
            toolName: 'Bash',
            toolCallId: 'guarded',
            args: { command: 'npm test' },
            result: undefined,
            providerMetadata: { mainframe: { acpStatus: 'in_progress' } },
          }),
        ],
        'gated',
        true,
      ),
    ];
    useUiPrefs.getState().setTranscriptMode('compact');
    render(
      <CompactFixture rootId={`gate-${optionId}`} messages={messages} extras={extras} Message={ScopedMessage}>
        <div data-testid="fixture-footer">
          <ChatGateMount />
        </div>
      </CompactFixture>,
    );
    expect(await screen.findByRole('button', { name: /Waiting for approval/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Waiting for approval/ }));
    act(() => useUiPrefs.getState().setTranscriptMode('verbose'));
    expect(screen.getByTestId('chat-thread-gate-slot')).toBeInTheDocument();
    act(() => useUiPrefs.getState().setTranscriptMode('compact'));
    fireEvent.click(screen.getByRole('button', { name: optionId === 'allow-once' ? 'Allow once' : 'Reject' }));
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'request' }), optionId);
  },
);
