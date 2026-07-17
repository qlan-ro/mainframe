import { describe, it, expect, afterEach, vi } from 'vitest';

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

// The mock factory returns a plain object; cast to access the fields the
// real class keeps private (`chatId`) or typed as `unknown` (`dispose`).
function chatId(ctrl: unknown): string {
  return (ctrl as { chatId: string }).chatId;
}
function disposeSpyOf(ctrl: unknown): ReturnType<typeof vi.fn> {
  return (ctrl as { dispose: ReturnType<typeof vi.fn> }).dispose;
}

afterEach(() => {
  chatControllerRegistry.disposeAll();
  vi.clearAllMocks();
});

describe('chatControllerRegistry', () => {
  it.each(['chat-1', '__LOCALID_a'])(
    'getOrCreate(%s) returns a matching controller and caches it across repeated calls',
    (id) => {
      const first = chatControllerRegistry.getOrCreate(id, 31415);
      expect(chatId(first)).toBe(id);
      expect(MockCtor).toHaveBeenCalledTimes(1);

      const second = chatControllerRegistry.getOrCreate(id, 31415);
      expect(second).toBe(first);
      expect(MockCtor).toHaveBeenCalledTimes(1);
    },
  );

  it('creates a separate instance for a different id and bumps the construction count', () => {
    const ctrl1 = chatControllerRegistry.getOrCreate('chat-1', 31415);
    const ctrl2 = chatControllerRegistry.getOrCreate('chat-2', 31415);
    expect(ctrl2).not.toBe(ctrl1);
    expect(MockCtor).toHaveBeenCalledTimes(2);
  });

  it('dispose calls the controller dispose method and evicts the entry so a later getOrCreate constructs fresh', () => {
    const ctrl = chatControllerRegistry.getOrCreate('chat-2', 31415);
    chatControllerRegistry.dispose('chat-2');
    expect(disposeSpyOf(ctrl)).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    chatControllerRegistry.getOrCreate('chat-2', 31415);
    expect(MockCtor).toHaveBeenCalledTimes(1);
  });

  it('dispose of an id that was never registered is a no-op', () => {
    expect(() => chatControllerRegistry.dispose('never-registered')).not.toThrow();
  });

  it('disposeAll calls dispose on every registered controller and empties the registry so a later getOrCreate constructs fresh instances', () => {
    const ctrlA = chatControllerRegistry.getOrCreate('a', 1);
    const ctrlB = chatControllerRegistry.getOrCreate('b', 1);

    chatControllerRegistry.disposeAll();

    expect(disposeSpyOf(ctrlA)).toHaveBeenCalledTimes(1);
    expect(disposeSpyOf(ctrlB)).toHaveBeenCalledTimes(1);

    const freshA = chatControllerRegistry.getOrCreate('a', 1);
    expect(freshA).not.toBe(ctrlA);
  });

  it('disposeAll on an already-empty registry is a no-op', () => {
    expect(() => chatControllerRegistry.disposeAll()).not.toThrow();
  });
});
