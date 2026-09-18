/**
 * Render tests for ChatModelChip.
 *
 * Strategy:
 *  - Mock `useChatExtras` (from ../runtime/chat-extras) to inject
 *    fixture extras with the desired ChatThreadState.
 *  - Mock `useAdapters` (from ../composer/config-toolbar/use-composer-tuning)
 *    to inject a fixed adapter registry.
 *  - Mock `providerDot` (from ../composer/config-toolbar/ProviderModelSelect)
 *    to avoid Tailwind class computation in tests.
 *  - All expected text values are hardcoded — no derivation logic re-run here.
 */
import { render as rtlRender, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

// The v2 `Hint` carries no provider of its own (shadcn treats that as an
// app-root concern), so every bare render needs one — the v1 provider is a
// different context and satisfies nothing.
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: TooltipProvider });

// ---------------------------------------------------------------------------
// Module mocks (hoisted — must be before the component import)
// ---------------------------------------------------------------------------

// Paths are relative to the test file (in thread/__tests__/). The component
// (thread/ChatModelChip.tsx) imports `../runtime/...` and `../composer/...`,
// which resolve to `chat/runtime/...` and `chat/composer/...`. From this test
// file (thread/__tests__/) the same modules are two levels up.
vi.mock('../../runtime/chat-extras', () => ({
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

import { ChatModelChip } from '../ChatModelChip';
import { useChatExtras } from '../../runtime/chat-extras';
import { useAdapters } from '../../composer/config-toolbar/use-composer-tuning';
import { createChatThreadState, reduceChatThreadState } from '../../controller/chat-thread-state';
import type { ChatThreadState } from '../../controller/chat-thread-state';
import type { Chat, AdapterInfo } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal Chat fixture — only fields ChatModelChip reads. */
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
// 1. Renders nothing when chat config hasn't loaded
// ---------------------------------------------------------------------------

describe('ChatModelChip — renders nothing when config is absent', () => {
  it('renders nothing when useChatExtras returns undefined', () => {
    vi.mocked(useChatExtras).mockReturnValue(undefined);

    const { container } = render(<ChatModelChip />);

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when extras.state.chatConfig is null', () => {
    vi.mocked(useChatExtras).mockReturnValue(
      makeExtras(createChatThreadState('c1')) as ReturnType<typeof useChatExtras>,
    );

    const { container } = render(<ChatModelChip />);

    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. The chip
// ---------------------------------------------------------------------------

describe('ChatModelChip', () => {
  it('shows the model label "Sonnet 4.6" from the adapters registry', () => {
    render(<ChatModelChip />);

    expect(screen.getByTestId('chat-header-model').textContent).toBe('Sonnet 4.6');
  });

  it('falls back to chat.model when the model is not found in the adapter registry', () => {
    vi.mocked(useAdapters).mockReturnValue([]);

    render(<ChatModelChip />);

    expect(screen.getByTestId('chat-header-model').textContent).toBe('sonnet-4-6');
  });

  it('does not render the adapter name text "Claude"', () => {
    render(<ChatModelChip />);

    expect(screen.queryByText('Claude')).toBeNull();
  });

  it("falls back to the adapter's isDefault model label when chat.model is undefined (session inherits the adapter default)", () => {
    vi.mocked(useChatExtras).mockReturnValue(
      makeExtras(stateWithChat(makeChat({ model: undefined }))) as ReturnType<typeof useChatExtras>,
    );

    render(<ChatModelChip />);

    expect(screen.getByTestId('chat-header-model').textContent).toBe('Sonnet 4.6');
  });

  it('does not render a "·" separator', () => {
    render(<ChatModelChip />);

    expect(screen.queryByText('·')).toBeNull();
  });
});
