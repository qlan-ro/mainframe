import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';

const state = vi.hoisted(() => ({
  messageId: 'reply-1',
  messageStatus: 'complete',
  threadRunning: false,
  remoteId: 'chat-1' as string | null,
  custom: {} as Record<string, unknown>,
  messages: [] as Array<Record<string, unknown>>,
  nested: false,
  fork: vi.fn(),
}));

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (s: unknown) => unknown) =>
    selector({
      message: { id: state.messageId, status: { type: state.messageStatus } },
      thread: { messages: state.messages, isRunning: state.threadRunning },
      threadListItem: { id: 'chat-1', remoteId: state.remoteId, custom: state.custom },
      threads: { threadItems: [] },
    }),
  ActionBarPrimitive: {
    Root: ({ children, autohide: _autohide, ...rest }: { children: React.ReactNode; autohide?: string }) => (
      <div {...rest}>{children}</div>
    ),
  },
}));
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span data-testid="hint">{children}</span>,
}));
vi.mock('@/features/sessions/use-fork-chat', () => ({ useForkChat: () => state.fork }));
vi.mock('../nested-transcript-context', () => ({ useIsNestedTranscript: () => state.nested }));

import { useAdaptersStore } from '@/store/adapters';
import { AssistantForkAction } from '../AssistantForkAction';

const adapter: AdapterInfo = {
  id: 'claude',
  name: 'Claude',
  description: '',
  installed: true,
  models: [],
  capabilities: { planMode: true, fork: true },
};
const button = () => screen.getByTestId('chat-assistant-message-fork');

beforeEach(() => {
  state.messageId = 'reply-1';
  state.messageStatus = 'complete';
  state.threadRunning = false;
  state.remoteId = 'chat-1';
  state.custom = {
    adapterId: 'claude',
    vendorSessionId: 'sess-1',
    temporary: false,
    noProject: false,
    transcriptMissing: false,
    directoryMissing: false,
    isRunning: false,
    hasPending: false,
  };
  state.messages = [
    { id: 'msg-1', role: 'user' },
    { id: 'reply-1', role: 'assistant' },
    { id: 'msg-2', role: 'user' },
    { id: 'reply-2', role: 'assistant' },
  ];
  state.nested = false;
  state.fork.mockReset();
  useAdaptersStore.setState({ byId: { claude: adapter } });
});

describe('AssistantForkAction', () => {
  it('forks after an earlier assistant turn with an empty composer', () => {
    render(<AssistantForkAction />);
    expect(button()).not.toBeDisabled();
    fireEvent.click(button());
    expect(state.fork).toHaveBeenCalledWith('chat-1', { fromMessageId: 'msg-2' });
  });

  it('can fork an earlier completed turn while a later turn runs', () => {
    state.custom.isRunning = true;
    render(<AssistantForkAction />);
    expect(button()).not.toBeDisabled();
  });

  it('forks at the current end after the latest completed assistant turn', () => {
    state.messageId = 'reply-2';
    render(<AssistantForkAction />);
    fireEvent.click(button());
    expect(state.fork).toHaveBeenCalledWith('chat-1', undefined);
  });

  it('hides the latest turn action while it runs', () => {
    state.messageId = 'reply-2';
    state.messageStatus = 'running';
    state.custom.isRunning = true;
    render(<AssistantForkAction />);
    expect(screen.queryByTestId('chat-assistant-message-fork')).toBeNull();
  });

  it('hides a completed intermediate message while the current turn still runs', () => {
    state.messageId = 'reply-2';
    state.threadRunning = true;
    render(<AssistantForkAction />);
    expect(screen.queryByTestId('chat-assistant-message-fork')).toBeNull();
  });

  it('hides an interrupted earlier turn action', () => {
    state.messageStatus = 'incomplete';
    render(<AssistantForkAction />);
    expect(screen.queryByTestId('chat-assistant-message-fork')).toBeNull();
  });

  it('does not offer an intermediate assistant message as a turn boundary', () => {
    state.messages.splice(2, 0, { id: 'reply-extra', role: 'assistant' });
    render(<AssistantForkAction />);
    expect(screen.queryByTestId('chat-assistant-message-fork')).toBeNull();
  });

  it('refuses a cut before the first message of a new provider segment', () => {
    state.messages.splice(2, 0, {
      id: 'divider',
      role: 'system',
      metadata: { custom: { mainframe: { providerSwitch: { kind: 'provider_switch', toAdapterName: 'Codex' } } } },
    });
    render(<AssistantForkAction />);
    expect(button()).toBeDisabled();
    expect(screen.getByTestId('hint')).toHaveTextContent("Can't fork from before the switch to Codex");
  });

  it('waits for a queued next user message to become a fork point', () => {
    state.messages[2]!.metadata = { custom: { mainframe: { queued: true } } };
    render(<AssistantForkAction />);
    expect(button()).toBeDisabled();
    expect(screen.getByTestId('hint')).toHaveTextContent("This message hasn't been sent yet");
  });

  it.each(['nested', 'temporary', 'noProject', 'draft'] as const)('hides in a %s context', (context) => {
    if (context === 'nested') state.nested = true;
    if (context === 'temporary' || context === 'noProject') state.custom[context] = true;
    if (context === 'draft') state.remoteId = null;
    render(<AssistantForkAction />);
    expect(screen.queryByTestId('chat-assistant-message-fork')).toBeNull();
  });
});
