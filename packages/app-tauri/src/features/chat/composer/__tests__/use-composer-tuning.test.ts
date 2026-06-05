/**
 * Behavior tests for useComposerTuning — optimistic patch lifecycle.
 *
 * What we verify:
 *   - optimistic apply is immediate (chat state updates before the PATCH resolves)
 *   - on success, the resolved server Chat reconciles state (may differ from
 *     the optimistic value, e.g. server coercion)
 *   - on error, the previous value is restored exactly
 *   - setFeature sends ONLY the touched key in the PATCH payload (not the full chat)
 *
 * Mocking strategy
 * ----------------
 * 1. `@assistant-ui/react` → stub `useAuiState` to return a fixed isRunning
 *    value (false by default).  This avoids needing an AssistantRuntime tree.
 * 2. `../runtime/use-chat-thread-runtime` → stub `useChatExtras` to return
 *    a fake extras with a controllable chatId + port.  Eliminates the full
 *    external-store runtime context.
 * 3. `@/lib/api/chats` → vi.fn() stubs for `getChat` and `setChatTuning`.
 * 4. `@/lib/api/adapters` → stub `getAdapters` (not under test, just silenced).
 *
 * Both modules are vi.mock'd at the top (hoisted by vitest) so the import
 * of `useComposerTuning` picks up the stubs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Module mocks (hoisted — must be declared before imports that depend on them)
// ---------------------------------------------------------------------------

vi.mock('@assistant-ui/react', () => ({
  useAuiState: vi.fn().mockReturnValue(false),
}));

vi.mock('../../runtime/use-chat-thread-runtime', () => ({
  useChatExtras: vi.fn(),
}));

vi.mock('@/lib/api/chats', () => ({
  getChat: vi.fn(),
  setChatTuning: vi.fn(),
  setChatConfig: vi.fn(),
}));

vi.mock('@/lib/api/adapters', () => ({
  getAdapters: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { useComposerTuning } from '../use-composer-tuning';
import { useChatExtras } from '../../runtime/use-chat-thread-runtime';
import { getChat, setChatTuning } from '@/lib/api/chats';
import type { Chat } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHAT_ID = 'chat-tuning-test';
const PORT = 9988;

/** Minimal Chat with effort + ultracode fields in play. */
function makeChat(overrides?: Partial<Chat>): Chat {
  return {
    id: CHAT_ID,
    adapterId: 'claude',
    projectId: 'proj-1',
    status: 'active',
    createdAt: '2026-06-05T00:00:00.000Z',
    updatedAt: '2026-06-05T00:00:00.000Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    effort: 'medium',
    ultracode: false,
    fast: false,
    adaptiveThinking: false,
    ...overrides,
  };
}

/** Fake extras returned by useChatExtras — carries state.chatId + port. */
function makeFakeExtras() {
  return {
    state: { chatId: CHAT_ID },
    port: PORT,
    permissions: {},
    queued: {},
    cancel: vi.fn(),
    replyToPermission: vi.fn(),
    cancelQueued: vi.fn(),
    editQueued: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: extras are available with a known chatId.
  vi.mocked(useChatExtras).mockReturnValue(makeFakeExtras() as unknown as ReturnType<typeof useChatExtras>);
});

// ---------------------------------------------------------------------------
// 1. optimistic apply is immediate
// ---------------------------------------------------------------------------

describe('useComposerTuning — setEffort optimistic apply', () => {
  it('updates chat.effort to the new value synchronously before the PATCH resolves', async () => {
    const initialChat = makeChat({ effort: 'medium' });
    const serverChat = makeChat({ effort: 'high' });

    vi.mocked(getChat).mockResolvedValueOnce(initialChat);

    // The PATCH resolves after a tick — we want to see the optimistic value
    // in the window before it settles.
    let resolveServerPatch!: (c: Chat) => void;
    vi.mocked(setChatTuning).mockReturnValueOnce(
      new Promise<Chat>((res) => {
        resolveServerPatch = res;
      }),
    );

    const { result } = renderHook(() => useComposerTuning([]));

    // Wait for getChat to settle so chat !== null.
    await waitFor(() => expect(result.current.chat).not.toBeNull());

    // Trigger optimistic update.
    act(() => {
      result.current.setEffort('high');
    });

    // The optimistic value is reflected immediately — before the server responds.
    expect(result.current.chat?.effort).toBe('high');

    // Now let the server respond.
    act(() => {
      resolveServerPatch(serverChat);
    });

    await waitFor(() => expect(result.current.chat?.effort).toBe('high'));
  });
});

// ---------------------------------------------------------------------------
// 2. success — server value reconciles state
// ---------------------------------------------------------------------------

describe('useComposerTuning — setEffort reconciles server value on success', () => {
  it('replaces the optimistic chat with the server-returned Chat on success', async () => {
    const initialChat = makeChat({ effort: 'low' });
    // Server coerces 'max' → 'xhigh' (example of server-side coercion).
    const serverChat = makeChat({ effort: 'xhigh' });

    vi.mocked(getChat).mockResolvedValueOnce(initialChat);
    vi.mocked(setChatTuning).mockResolvedValueOnce(serverChat);

    const { result } = renderHook(() => useComposerTuning([]));
    await waitFor(() => expect(result.current.chat).not.toBeNull());

    act(() => {
      result.current.setEffort('max');
    });

    // Wait for the PATCH to settle and reconcile.
    await waitFor(() => expect(result.current.chat?.effort).toBe('xhigh'));

    // The full server chat object is stored — not just the effort field.
    expect(result.current.chat?.id).toBe(CHAT_ID);
  });
});

// ---------------------------------------------------------------------------
// 3. error — previous value is restored
// ---------------------------------------------------------------------------

describe('useComposerTuning — setEffort reverts on error', () => {
  it('restores the previous chat when setChatTuning rejects', async () => {
    const initialChat = makeChat({ effort: 'medium' });

    vi.mocked(getChat).mockResolvedValueOnce(initialChat);
    vi.mocked(setChatTuning).mockRejectedValueOnce(new Error('daemon unreachable'));

    const { result } = renderHook(() => useComposerTuning([]));
    await waitFor(() => expect(result.current.chat).not.toBeNull());

    act(() => {
      result.current.setEffort('high');
    });

    // Optimistic update is applied first.
    expect(result.current.chat?.effort).toBe('high');

    // After the rejection, the previous value is restored.
    await waitFor(() => expect(result.current.chat?.effort).toBe('medium'));
  });
});

// ---------------------------------------------------------------------------
// 4. setFeature sends ONLY the touched key
// ---------------------------------------------------------------------------

describe('useComposerTuning — setFeature sends only the touched key', () => {
  it('calls setChatTuning with only { ultracode: true } when toggling ultracode', async () => {
    const initialChat = makeChat({ ultracode: false });

    vi.mocked(getChat).mockResolvedValueOnce(initialChat);
    vi.mocked(setChatTuning).mockResolvedValueOnce(makeChat({ ultracode: true }));

    const { result } = renderHook(() => useComposerTuning([]));
    await waitFor(() => expect(result.current.chat).not.toBeNull());

    act(() => {
      result.current.setFeature('ultracode', true);
    });

    await waitFor(() => expect(vi.mocked(setChatTuning)).toHaveBeenCalled());

    const [portArg, chatIdArg, tuningArg] = vi.mocked(setChatTuning).mock.calls[0]!;
    expect(portArg).toBe(PORT);
    expect(chatIdArg).toBe(CHAT_ID);
    // The patch must contain ONLY the toggled key — no other fields.
    expect(tuningArg).toEqual({ ultracode: true });
  });

  it('calls setChatTuning with only { fast: false } when toggling fast off', async () => {
    const initialChat = makeChat({ fast: true });

    vi.mocked(getChat).mockResolvedValueOnce(initialChat);
    vi.mocked(setChatTuning).mockResolvedValueOnce(makeChat({ fast: false }));

    const { result } = renderHook(() => useComposerTuning([]));
    await waitFor(() => expect(result.current.chat).not.toBeNull());

    act(() => {
      result.current.setFeature('fast', false);
    });

    await waitFor(() => expect(vi.mocked(setChatTuning)).toHaveBeenCalled());

    const [, , tuningArg] = vi.mocked(setChatTuning).mock.calls[0]!;
    expect(tuningArg).toEqual({ fast: false });
  });
});

// ---------------------------------------------------------------------------
// 5. no-op when extras are not yet available
// ---------------------------------------------------------------------------

describe('useComposerTuning — no-op without extras', () => {
  it('does not throw and does not call setChatTuning when useChatExtras returns undefined', async () => {
    vi.mocked(useChatExtras).mockReturnValue(undefined);
    vi.mocked(getChat).mockResolvedValue(makeChat());

    const { result } = renderHook(() => useComposerTuning([]));

    act(() => {
      // setEffort is a no-op when extras/chatId are absent.
      result.current.setEffort('high');
    });

    expect(setChatTuning).not.toHaveBeenCalled();
    // chat remains null because no chatId → no getChat call.
    expect(result.current.chat).toBeNull();
  });
});
