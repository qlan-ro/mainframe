/**
 * UserMessageActionBar — "Fork from here" on a user message.
 *
 * `@assistant-ui/react` is mocked so `useAuiState` sees a synthetic message /
 * thread / thread-list state, and `ActionBarPrimitive.Root` renders inline
 * (its hover autohide is assistant-ui's own behavior). Tooltip content is
 * rendered inline so the hint text is assertable without a hover.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';

interface Meta {
  queued?: boolean;
  pending?: boolean;
  error?: string;
}

interface Custom {
  adapterId: string;
  claudeSessionId?: string;
  temporary: boolean;
  noProject: boolean;
  transcriptMissing: boolean;
  directoryMissing?: boolean;
}

const state = vi.hoisted(() => ({
  meta: {} as Record<string, unknown>,
  messageId: 'msg-2',
  firstUserId: 'msg-1',
  remoteId: 'chat-1' as string | null,
  custom: null as Record<string, unknown> | null,
  /** Overrides the default three-message thread (a switched chat's dividers). */
  threadMessages: null as unknown[] | null,
  nested: false,
  fork: vi.fn(),
}));

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (s: unknown) => unknown) =>
    selector({
      message: { id: state.messageId, metadata: { custom: { mainframe: state.meta } } },
      thread: {
        messages: state.threadMessages ?? [
          { id: state.firstUserId, role: 'user' },
          { id: 'reply-1', role: 'assistant' },
          { id: state.messageId, role: 'user' },
        ],
      },
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
import { UserMessageActionBar } from '../UserMessageActionBar';

const adapter = (fork: boolean): AdapterInfo => ({
  id: 'claude',
  name: 'Claude',
  description: '',
  installed: true,
  models: [],
  capabilities: { planMode: true, fork },
});

const READY: Custom = {
  adapterId: 'claude',
  claudeSessionId: 'sess-1',
  temporary: false,
  noProject: false,
  transcriptMissing: false,
  directoryMissing: false,
};

function setup(custom: Partial<Custom> = {}, meta: Meta = {}) {
  state.custom = { ...READY, ...custom };
  state.meta = { ...meta };
  render(<UserMessageActionBar prefill="second prompt" />);
}

const button = () => screen.getByTestId('chat-user-message-fork');
const hint = () => screen.getByTestId('hint').textContent;

beforeEach(() => {
  state.messageId = 'msg-2';
  state.remoteId = 'chat-1';
  state.nested = false;
  state.threadMessages = null;
  state.fork.mockReset();
  useAdaptersStore.setState({ byId: { claude: adapter(true) } });
});

describe('UserMessageActionBar', () => {
  it('is enabled with the "Fork from here" tooltip', () => {
    setup();
    expect(button()).not.toBeDisabled();
    expect(hint()).toBe('Fork from here');
  });

  it('a click forks the chat before this message with its text as the prefill', () => {
    setup();
    fireEvent.click(button());
    expect(state.fork).toHaveBeenCalledWith('chat-1', { fromMessageId: 'msg-2', prefill: 'second prompt' });
  });

  it.each([
    [
      'an adapter that cannot fork',
      () => useAdaptersStore.setState({ byId: { claude: adapter(false) } }),
      {},
      {},
      "Forking isn't available for Claude chats yet",
    ],
    ['no provider session', () => {}, { claudeSessionId: undefined }, {}, 'Nothing to fork yet'],
    ['a missing transcript', () => {}, { transcriptMissing: true }, {}, "This chat's transcript is missing"],
    ['a missing folder', () => {}, { directoryMissing: true }, {}, "This chat's folder is missing"],
    ['a message still sending', () => {}, {}, { pending: true }, "This message hasn't been sent yet"],
    ['a message that failed to send', () => {}, {}, { error: 'boom' }, "This message hasn't been sent yet"],
  ] as const)('is disabled for %s, with the reason as its hint', (_label, arrange, custom, meta, reason) => {
    arrange();
    setup(custom, meta);
    expect(button()).toBeDisabled();
    expect(hint()).toBe(reason);
  });

  it("is disabled on the chat's first user message", () => {
    state.messageId = 'msg-1';
    setup();
    expect(button()).toBeDisabled();
    expect(hint()).toBe('Nothing before this message to fork');
  });

  it('is disabled before the latest provider switch, naming the provider', () => {
    const divider = {
      id: 'segdiv-seg_1',
      role: 'system',
      metadata: { custom: { mainframe: { providerSwitch: { kind: 'provider_switch', toAdapterName: 'Codex' } } } },
    };
    state.threadMessages = [
      { id: 'msg-1', role: 'user' },
      { id: 'msg-2', role: 'user' },
      divider,
      { id: 'msg-3', role: 'user' },
      { id: 'msg-4', role: 'user' },
    ];
    setup();
    expect(button()).toBeDisabled();
    expect(hint()).toBe("Can't fork from before the switch to Codex");
  });

  it.each([
    ['a queued message', {}, { queued: true }],
    ['a temporary chat', { temporary: true }, {}],
    ['a no-project chat', { noProject: true }, {}],
  ] as const)('is not rendered for %s', (_label, custom, meta) => {
    setup(custom, meta);
    expect(screen.queryByTestId('chat-user-message-fork')).toBeNull();
  });

  it('is not rendered for a draft that has no chat yet', () => {
    state.remoteId = null;
    setup();
    expect(screen.queryByTestId('chat-user-message-fork')).toBeNull();
  });

  it('is not rendered inside a nested subagent transcript', () => {
    state.nested = true;
    setup();
    expect(screen.queryByTestId('chat-user-message-fork')).toBeNull();
  });
});
