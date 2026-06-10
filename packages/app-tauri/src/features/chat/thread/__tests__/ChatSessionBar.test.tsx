/**
 * Render tests for ChatSessionBar.
 *
 * Strategy:
 *  - Mock `useChatExtras` (from ../runtime/use-chat-thread-runtime) to inject
 *    fixture extras with the desired ChatThreadState.
 *  - Mock `useAdapters` (from ../composer/config-toolbar/use-composer-tuning)
 *    to inject a fixed adapter registry.
 *  - Mock `providerDot` (from ../composer/config-toolbar/ProviderModelSelect)
 *    to avoid Tailwind class computation in tests.
 *  - All expected text values are hardcoded — no derivation logic re-run here.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks (hoisted — must be before the component import)
// ---------------------------------------------------------------------------

// Paths are relative to the test file (in thread/__tests__/).
// The component (thread/ChatSessionBar.tsx) imports `../runtime/...` and
// `../composer/...`, which resolve to `chat/runtime/...` and `chat/composer/...`.
// From this test file (thread/__tests__/) the same modules are two levels up.
vi.mock('../../runtime/use-chat-thread-runtime', () => ({
  useChatExtras: vi.fn(),
}));

vi.mock('../../composer/config-toolbar/use-composer-tuning', () => ({
  useAdapters: vi.fn(),
}));

// providerDot is a named export used inline by the component
vi.mock('../../composer/config-toolbar/ProviderModelSelect', () => ({
  providerDot: vi.fn().mockReturnValue('bg-gray-400'),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { ChatSessionBar } from '../ChatSessionBar';
import { useChatExtras } from '../../runtime/use-chat-thread-runtime';
import { useAdapters } from '../../composer/config-toolbar/use-composer-tuning';
import { createChatThreadState, reduceChatThreadState } from '../../controller/chat-thread-state';
import type { ChatThreadState } from '../../controller/chat-thread-state';
import type { Chat, AdapterInfo } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal Chat fixture — only fields ChatSessionBar reads. */
function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'c1',
    adapterId: 'claude',
    model: 'sonnet-4-6',
    worktreeMissing: false,
    lastContextTokensInput: 0,
    ...overrides,
  } as unknown as Chat;
}

/** Adapter fixture matching the default makeChat. */
const ADAPTER_CLAUDE: AdapterInfo = {
  id: 'claude',
  name: 'Claude',
  models: [
    {
      id: 'sonnet-4-6',
      label: 'Sonnet 4.6',
      isDefault: true,
      contextWindow: 200_000,
    },
  ],
  installed: true,
} as unknown as AdapterInfo;

/** Build a minimal ChatThreadState with the given chatConfig. */
function stateWithChat(chat: Chat): ChatThreadState {
  const base = createChatThreadState('c1');
  return reduceChatThreadState(base, { type: 'chat.config.updated', chat });
}

/** Fake extras wrapping a ChatThreadState. */
function makeExtras(state: ChatThreadState) {
  return { state };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAdapters).mockReturnValue([ADAPTER_CLAUDE]);
  vi.mocked(useChatExtras).mockReturnValue(makeExtras(stateWithChat(makeChat())) as ReturnType<typeof useChatExtras>);
});

// ---------------------------------------------------------------------------
// 1. Renders nothing when extras or chatConfig is absent
// ---------------------------------------------------------------------------

describe('ChatSessionBar — renders nothing when state is absent', () => {
  it('renders nothing when useChatExtras returns undefined', () => {
    vi.mocked(useChatExtras).mockReturnValue(undefined);

    render(<ChatSessionBar />);

    expect(screen.queryByTestId('chat-session-bar')).toBeNull();
  });

  it('renders nothing when extras.state.chatConfig is null', () => {
    vi.mocked(useChatExtras).mockReturnValue(
      makeExtras(createChatThreadState('c1')) as ReturnType<typeof useChatExtras>,
    );

    render(<ChatSessionBar />);

    expect(screen.queryByTestId('chat-session-bar')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Adapter and model labels
// ---------------------------------------------------------------------------

describe('ChatSessionBar — adapter and model labels', () => {
  it('shows the adapter name "Claude" from the adapters registry', () => {
    render(<ChatSessionBar />);

    expect(screen.getByTestId('chat-session-bar-adapter').textContent).toBe('Claude');
  });

  it('shows the model label "Sonnet 4.6" from the adapters registry', () => {
    render(<ChatSessionBar />);

    expect(screen.getByTestId('chat-session-bar-model').textContent).toBe('Sonnet 4.6');
  });

  it('falls back to chat.adapterId when the adapter is not found in the registry', () => {
    vi.mocked(useAdapters).mockReturnValue([]);

    render(<ChatSessionBar />);

    expect(screen.getByTestId('chat-session-bar-adapter').textContent).toBe('claude');
  });

  it('renders the root chat-session-bar element', () => {
    render(<ChatSessionBar />);

    expect(screen.getByTestId('chat-session-bar')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 3. Context percentage display
// ---------------------------------------------------------------------------

describe('ChatSessionBar — context percentage', () => {
  it('shows "38%" when contextUsage.percentage is 38', () => {
    const state = reduceChatThreadState(stateWithChat(makeChat()), {
      type: 'context.usage',
      percentage: 38,
      totalTokens: 76_000,
      maxTokens: 200_000,
    });
    vi.mocked(useChatExtras).mockReturnValue(makeExtras(state) as ReturnType<typeof useChatExtras>);

    render(<ChatSessionBar />);

    expect(screen.getByTestId('chat-session-bar-context-pct').textContent).toBe('38%');
  });

  it('context-pct element is absent when there is no contextUsage and no contextWindow on the model', () => {
    const adapterNoWindow: AdapterInfo = {
      id: 'claude',
      name: 'Claude',
      models: [{ id: 'sonnet-4-6', label: 'Sonnet 4.6', isDefault: true }],
      installed: true,
    } as unknown as AdapterInfo;
    vi.mocked(useAdapters).mockReturnValue([adapterNoWindow]);
    // contextUsage is null in the base state from stateWithChat(makeChat())
    // lastContextTokensInput is 0, so fallback would still be 0% — but no contextWindow → null
    vi.mocked(useChatExtras).mockReturnValue(makeExtras(stateWithChat(makeChat())) as ReturnType<typeof useChatExtras>);

    render(<ChatSessionBar />);

    expect(screen.queryByTestId('chat-session-bar-context-pct')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Status indicator text
// ---------------------------------------------------------------------------

describe('ChatSessionBar — status indicator text', () => {
  it('shows "Awaiting" when there is a pending permission entry', () => {
    const state = reduceChatThreadState(stateWithChat(makeChat()), {
      type: 'permission.requested',
      requestId: 'r1',
      request: { requestId: 'r1', toolName: 'Bash', toolUseId: 'tu1', input: {}, suggestions: [] },
    });
    vi.mocked(useChatExtras).mockReturnValue(makeExtras(state) as ReturnType<typeof useChatExtras>);

    render(<ChatSessionBar />);

    const statusContainer = screen.getByTestId('chat-session-bar-status');
    expect(statusContainer.textContent).toContain('Awaiting');
  });

  it('shows "Compacting" when compacting is true', () => {
    const state = reduceChatThreadState(stateWithChat(makeChat()), { type: 'compact.started' });
    vi.mocked(useChatExtras).mockReturnValue(makeExtras(state) as ReturnType<typeof useChatExtras>);

    render(<ChatSessionBar />);

    const statusContainer = screen.getByTestId('chat-session-bar-status');
    expect(statusContainer.textContent).toContain('Compacting');
  });

  it('shows "Thinking" when run-state is running', () => {
    const state = reduceChatThreadState(stateWithChat(makeChat()), { type: 'run.started' });
    vi.mocked(useChatExtras).mockReturnValue(makeExtras(state) as ReturnType<typeof useChatExtras>);

    render(<ChatSessionBar />);

    const statusContainer = screen.getByTestId('chat-session-bar-status');
    expect(statusContainer.textContent).toContain('Thinking');
  });

  it('shows no status text when idle with no conditions', () => {
    // Default state from beforeEach: idle, no permissions, not compacting.
    render(<ChatSessionBar />);

    const statusContainer = screen.getByTestId('chat-session-bar-status');
    expect(statusContainer.textContent?.trim()).toBe('');
  });
});
