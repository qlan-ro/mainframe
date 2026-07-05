/**
 * Render tests for ChatSessionInline.
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

// Paths are relative to the test file (in thread/__tests__/). The component
// (thread/ChatSessionInline.tsx) imports `../runtime/...` and `../composer/...`,
// which resolve to `chat/runtime/...` and `chat/composer/...`. From this test
// file (thread/__tests__/) the same modules are two levels up.
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

import { ChatSessionInline } from '../ChatSessionInline';
import { useChatExtras } from '../../runtime/use-chat-thread-runtime';
import { useAdapters } from '../../composer/config-toolbar/use-composer-tuning';
import { createChatThreadState, reduceChatThreadState } from '../../controller/chat-thread-state';
import type { ChatThreadState } from '../../controller/chat-thread-state';
import type { Chat, AdapterInfo } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal Chat fixture — only fields ChatSessionInline reads. */
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

describe('ChatSessionInline — renders nothing when config is absent', () => {
  it('renders nothing (model part) when useChatExtras returns undefined', () => {
    vi.mocked(useChatExtras).mockReturnValue(undefined);

    const { container } = render(<ChatSessionInline part="model" />);

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing (status part) when extras.state.chatConfig is null', () => {
    vi.mocked(useChatExtras).mockReturnValue(
      makeExtras(createChatThreadState('c1')) as ReturnType<typeof useChatExtras>,
    );

    const { container } = render(<ChatSessionInline part="status" />);

    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Model part
// ---------------------------------------------------------------------------

describe('ChatSessionInline — model part', () => {
  it('shows the model label "Sonnet 4.6" from the adapters registry', () => {
    render(<ChatSessionInline part="model" />);

    expect(screen.getByTestId('chat-header-model').textContent).toBe('Sonnet 4.6');
  });

  it('falls back to chat.model when the model is not found in the adapter registry', () => {
    vi.mocked(useAdapters).mockReturnValue([]);

    render(<ChatSessionInline part="model" />);

    expect(screen.getByTestId('chat-header-model').textContent).toBe('sonnet-4-6');
  });

  it('does not render the adapter name text "Claude"', () => {
    render(<ChatSessionInline part="model" />);

    expect(screen.queryByText('Claude')).toBeNull();
  });

  it("falls back to the adapter's isDefault model label when chat.model is undefined (session inherits the adapter default)", () => {
    vi.mocked(useChatExtras).mockReturnValue(
      makeExtras(stateWithChat(makeChat({ model: undefined }))) as ReturnType<typeof useChatExtras>,
    );

    render(<ChatSessionInline part="model" />);

    expect(screen.getByTestId('chat-header-model').textContent).toBe('Sonnet 4.6');
  });

  it('does not render a "·" separator', () => {
    render(<ChatSessionInline part="model" />);

    expect(screen.queryByText('·')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Status part — context percentage
// ---------------------------------------------------------------------------

describe('ChatSessionInline — status part context percentage', () => {
  it('shows "42%" when contextUsage.percentage is 42', () => {
    const state = reduceChatThreadState(stateWithChat(makeChat()), {
      type: 'context.usage',
      percentage: 42,
      totalTokens: 84_000,
      maxTokens: 200_000,
    });
    vi.mocked(useChatExtras).mockReturnValue(makeExtras(state) as ReturnType<typeof useChatExtras>);

    render(<ChatSessionInline part="status" />);

    expect(screen.getByTestId('chat-header-context-pct').textContent).toBe('42%');
  });

  it('renders 8 meter segments', () => {
    const state = reduceChatThreadState(stateWithChat(makeChat()), {
      type: 'context.usage',
      percentage: 42,
      totalTokens: 84_000,
      maxTokens: 200_000,
    });
    vi.mocked(useChatExtras).mockReturnValue(makeExtras(state) as ReturnType<typeof useChatExtras>);

    render(<ChatSessionInline part="status" />);

    // Segments are the 3px-wide bars inside the meter (Hint-wrapped, so not
    // direct children of the container) — count them by their width class.
    const meter = screen.getByTestId('chat-header-context');
    expect(meter.querySelectorAll('.w-\\[3px\\]').length).toBe(8);
  });

  it('colors the unfilled segments with muted-foreground, not the lighter mf-text-3 (15.4)', () => {
    const state = reduceChatThreadState(stateWithChat(makeChat()), {
      type: 'context.usage',
      percentage: 10,
      totalTokens: 20_000,
      maxTokens: 200_000,
    });
    vi.mocked(useChatExtras).mockReturnValue(makeExtras(state) as ReturnType<typeof useChatExtras>);

    render(<ChatSessionInline part="status" />);

    const meter = screen.getByTestId('chat-header-context');
    const segments = meter.querySelectorAll('.w-\\[3px\\]');
    // 10% of 8 segments rounds to 1 filled (low tier), 7 unfilled — both should
    // use text-muted-foreground (design T.text2), never the lighter mf-text-3.
    expect(segments.length).toBe(8);
    segments.forEach((seg) => {
      expect(seg.className).not.toContain('mf-text-3');
    });
  });

  it('renders nothing when pct is null (no contextUsage and no contextWindow)', () => {
    const adapterNoWindow: AdapterInfo = {
      id: 'claude',
      name: 'Claude',
      models: [{ id: 'sonnet-4-6', label: 'Sonnet 4.6', isDefault: true }],
      installed: true,
    } as unknown as AdapterInfo;
    vi.mocked(useAdapters).mockReturnValue([adapterNoWindow]);
    vi.mocked(useChatExtras).mockReturnValue(makeExtras(stateWithChat(makeChat())) as ReturnType<typeof useChatExtras>);

    const { container } = render(<ChatSessionInline part="status" />);

    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('chat-header-context')).toBeNull();
    expect(screen.queryByTestId('chat-header-context-pct')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Status part — no status text
// ---------------------------------------------------------------------------

describe('ChatSessionInline — status part has no status text', () => {
  it('does not render "Thinking" when run state is running', () => {
    const state = reduceChatThreadState(
      reduceChatThreadState(stateWithChat(makeChat()), {
        type: 'context.usage',
        percentage: 42,
        totalTokens: 84_000,
        maxTokens: 200_000,
      }),
      { type: 'run.started' },
    );
    vi.mocked(useChatExtras).mockReturnValue(makeExtras(state) as ReturnType<typeof useChatExtras>);

    render(<ChatSessionInline part="status" />);

    expect(screen.queryByText('Thinking')).toBeNull();
    expect(screen.queryByText('Awaiting')).toBeNull();
    expect(screen.queryByText('Compacting')).toBeNull();
    expect(screen.queryByText('Error')).toBeNull();
  });

  it('does not render any status word anywhere in the status part output', () => {
    const state = reduceChatThreadState(
      reduceChatThreadState(stateWithChat(makeChat()), {
        type: 'context.usage',
        percentage: 42,
        totalTokens: 84_000,
        maxTokens: 200_000,
      }),
      { type: 'run.started' },
    );
    vi.mocked(useChatExtras).mockReturnValue(makeExtras(state) as ReturnType<typeof useChatExtras>);

    const { container } = render(<ChatSessionInline part="status" />);

    const text = container.textContent ?? '';
    expect(text).not.toContain('Thinking');
    expect(text).not.toContain('Awaiting');
    expect(text).not.toContain('Compacting');
    expect(text).not.toContain('Error');
  });
});
