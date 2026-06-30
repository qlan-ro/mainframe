import { describe, it, expect, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock ChatThreadController — no WS / REST runs
// ---------------------------------------------------------------------------

vi.mock('../../../chat/controller/chat-thread-controller', () => ({
  ChatThreadController: vi.fn().mockImplementation(function (chatId: string) {
    return { chatId, dispose: vi.fn() };
  }),
}));

// Import AFTER the mock is registered so the registry module picks up the mock.
import { chatControllerRegistry } from '../chat-controller-registry';
import { ChatThreadController } from '../../../chat/controller/chat-thread-controller';

const MockCtor = vi.mocked(ChatThreadController);

// ---------------------------------------------------------------------------
// Reset singleton state + mock call counts between cases
// ---------------------------------------------------------------------------

afterEach(() => {
  // Clean up any controllers that the tests may have created
  chatControllerRegistry.disposeAll();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// chat-controller-registry — disposeAll
// ---------------------------------------------------------------------------

describe('chat-controller-registry — disposeAll empties the registry', () => {
  it('leaves the registry empty so a subsequent getOrCreate returns a new instance', () => {
    const firstA = chatControllerRegistry.getOrCreate('a', 1);
    chatControllerRegistry.getOrCreate('b', 1);

    chatControllerRegistry.disposeAll();

    const secondA = chatControllerRegistry.getOrCreate('a', 1);
    expect(secondA).not.toBe(firstA);
  });

  it('calls dispose on every registered controller', () => {
    const ctrlA = chatControllerRegistry.getOrCreate('a', 1);
    const ctrlB = chatControllerRegistry.getOrCreate('b', 1);

    const disposeSpyA = (ctrlA as unknown as { dispose: ReturnType<typeof vi.fn> }).dispose;
    const disposeSpyB = (ctrlB as unknown as { dispose: ReturnType<typeof vi.fn> }).dispose;

    chatControllerRegistry.disposeAll();

    expect(disposeSpyA).toHaveBeenCalledTimes(1);
    expect(disposeSpyB).toHaveBeenCalledTimes(1);
  });

  it('constructs a fresh controller after disposeAll when getOrCreate is called again', () => {
    chatControllerRegistry.getOrCreate('a', 1);
    chatControllerRegistry.getOrCreate('b', 1);
    chatControllerRegistry.disposeAll();
    vi.clearAllMocks();

    chatControllerRegistry.getOrCreate('a', 1);
    expect(MockCtor).toHaveBeenCalledTimes(1);
  });

  it('is a no-op on an already empty registry', () => {
    expect(() => chatControllerRegistry.disposeAll()).not.toThrow();
  });
});
