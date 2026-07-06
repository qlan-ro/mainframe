import { describe, it, expect, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock ChatThreadController — no WS / REST runs
// ---------------------------------------------------------------------------

// The mock implementation is a regular `function` (not an arrow): vitest 4 /
// tinyspy invokes the spy's implementation via Reflect.construct on `new`, and
// arrow functions are not constructable. A plain function returning an object
// keeps the same shape ({ chatId, dispose: vi.fn() }) and is `new`-safe.
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
  chatControllerRegistry.dispose('chat-1');
  chatControllerRegistry.dispose('chat-2');
  chatControllerRegistry.dispose('__LOCALID_a');
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// chat-controller-registry
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helper — the mock returns a plain object; cast to access the chatId field
// that the mock exposes but the real class keeps private.
// ---------------------------------------------------------------------------
function chatId(ctrl: unknown): string {
  return (ctrl as { chatId: string }).chatId;
}

describe('chat-controller-registry — getOrCreate returns controller keyed by id', () => {
  it('returns a controller whose chatId matches the requested id', () => {
    const ctrl = chatControllerRegistry.getOrCreate('chat-1', 31415);
    expect(chatId(ctrl)).toBe('chat-1');
  });

  it('constructs exactly one controller on first call', () => {
    chatControllerRegistry.getOrCreate('chat-1', 31415);
    expect(MockCtor).toHaveBeenCalledTimes(1);
  });
});

describe('chat-controller-registry — getOrCreate is idempotent (StrictMode-safe)', () => {
  it('returns the same reference on a second call for the same id', () => {
    const first = chatControllerRegistry.getOrCreate('chat-1', 31415);
    const second = chatControllerRegistry.getOrCreate('chat-1', 31415);
    expect(second).toBe(first);
  });

  it('does not construct a second controller on a repeated call', () => {
    chatControllerRegistry.getOrCreate('chat-1', 31415);
    chatControllerRegistry.getOrCreate('chat-1', 31415);
    expect(MockCtor).toHaveBeenCalledTimes(1);
  });
});

describe('chat-controller-registry — getOrCreate creates separate instances for different ids', () => {
  it('returns a different reference for a different id', () => {
    const ctrl1 = chatControllerRegistry.getOrCreate('chat-1', 31415);
    const ctrl2 = chatControllerRegistry.getOrCreate('chat-2', 31415);
    expect(ctrl2).not.toBe(ctrl1);
  });

  it('bumps the construction count to 2 when a second distinct id is requested', () => {
    chatControllerRegistry.getOrCreate('chat-1', 31415);
    chatControllerRegistry.getOrCreate('chat-2', 31415);
    expect(MockCtor).toHaveBeenCalledTimes(2);
  });
});

describe('chat-controller-registry — __LOCALID_* ids are treated like any other id', () => {
  it('returns a controller whose chatId matches the local id', () => {
    const ctrl = chatControllerRegistry.getOrCreate('__LOCALID_a', 31415);
    expect(chatId(ctrl)).toBe('__LOCALID_a');
  });

  it('returns the same reference on a repeated call for the same local id', () => {
    const first = chatControllerRegistry.getOrCreate('__LOCALID_a', 31415);
    const second = chatControllerRegistry.getOrCreate('__LOCALID_a', 31415);
    expect(second).toBe(first);
  });

  it('does not construct a second controller on a repeated call for the local id', () => {
    chatControllerRegistry.getOrCreate('__LOCALID_a', 31415);
    chatControllerRegistry.getOrCreate('__LOCALID_a', 31415);
    expect(MockCtor).toHaveBeenCalledTimes(1);
  });
});

describe('chat-controller-registry — dispose calls the controller dispose and evicts the entry', () => {
  it('calls the controller dispose method exactly once', () => {
    const ctrl = chatControllerRegistry.getOrCreate('chat-2', 31415);
    chatControllerRegistry.dispose('chat-2');
    // The mock factory returns { dispose: vi.fn() }; cast to access the spy.
    const disposeSpy = (ctrl as unknown as { dispose: ReturnType<typeof vi.fn> }).dispose;
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('constructs a fresh controller after dispose when getOrCreate is called again', () => {
    chatControllerRegistry.getOrCreate('chat-2', 31415);
    chatControllerRegistry.dispose('chat-2');
    vi.clearAllMocks();
    chatControllerRegistry.getOrCreate('chat-2', 31415);
    expect(MockCtor).toHaveBeenCalledTimes(1);
  });
});

describe('chat-controller-registry — dispose of unknown id is a no-op', () => {
  it('does not throw when disposing an id that was never registered', () => {
    expect(() => chatControllerRegistry.dispose('never-registered')).not.toThrow();
  });
});
