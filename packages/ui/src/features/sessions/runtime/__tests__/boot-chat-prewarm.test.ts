import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { chatControllerRegistry } from '../chat-controller-registry';
import { handOverBootPrewarm, resetBootPrewarm, settleBootPrewarm, startBootChatPrewarm } from '../boot-chat-prewarm';
import { useLastSessionStore } from '@/store/last-session';

function fakeController(order: string[], id = 'c', inUse = false) {
  return {
    isInUse: () => inUse,
    subscribeLive: vi.fn(() => {
      order.push(`${id}:live`);
      return () => order.push(`${id}:unlive`);
    }),
    holdActive: vi.fn(() => {
      order.push(`${id}:hold`);
      return () => order.push(`${id}:release`);
    }),
  };
}

let order: string[];
let controllers: Map<string, ReturnType<typeof fakeController>>;
let dispose: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  order = [];
  controllers = new Map();
  vi.spyOn(chatControllerRegistry, 'getOrCreate').mockImplementation(((id: string) => {
    if (!controllers.has(id)) controllers.set(id, fakeController(order, id));
    return controllers.get(id);
  }) as never);
  dispose = vi.spyOn(chatControllerRegistry, 'dispose').mockImplementation(() => undefined);
  useLastSessionStore.setState({ lastSessionId: null });
});

afterEach(() => {
  resetBootPrewarm();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('asks for the remembered chat at once: the daemon history load, then the plane', () => {
  useLastSessionStore.setState({ lastSessionId: 'chat-1' });
  startBootChatPrewarm(31415);
  expect(chatControllerRegistry.getOrCreate).toHaveBeenCalledWith('chat-1', 31415);
  expect(order).toEqual(['chat-1:live', 'chat-1:hold']);
});

it('does nothing on a first run with no remembered chat, or for a draft id', () => {
  startBootChatPrewarm(31415);
  startBootChatPrewarm(31415, '__LOCALID_x');
  expect(chatControllerRegistry.getOrCreate).not.toHaveBeenCalled();
});

it('is idempotent while a guess is live (StrictMode, effect re-runs)', () => {
  startBootChatPrewarm(31415, 'chat-1');
  startBootChatPrewarm(31415, 'chat-1');
  startBootChatPrewarm(31415, 'chat-2');
  expect(order).toEqual(['chat-1:live', 'chat-1:hold']);
});

it('keeps the guess when the router opened that chat, until the selection takes over', () => {
  startBootChatPrewarm(31415, 'chat-1');
  settleBootPrewarm('chat-1', new Set(['chat-1']));
  expect(order).toEqual(['chat-1:live', 'chat-1:hold']);
  handOverBootPrewarm(controllers.get('chat-1')!);
  expect(order.slice(2)).toEqual(['chat-1:unlive', 'chat-1:release']);
  expect(dispose).not.toHaveBeenCalled();
});

it('ignores a hand-over from a different controller', () => {
  startBootChatPrewarm(31415, 'chat-1');
  handOverBootPrewarm({});
  expect(order).toEqual(['chat-1:live', 'chat-1:hold']);
});

it('releases and drops the controller when the remembered chat is gone from the list', () => {
  startBootChatPrewarm(31415, 'chat-1');
  settleBootPrewarm('chat-2', new Set(['chat-2']));
  expect(order.slice(2)).toEqual(['chat-1:unlive', 'chat-1:release']);
  expect(dispose).toHaveBeenCalledWith('chat-1');
});

it('keeps a controller another view still holds, even when the list does not show the chat', () => {
  controllers.set('chat-1', fakeController(order, 'chat-1', true));
  startBootChatPrewarm(31415, 'chat-1');
  settleBootPrewarm('chat-2', new Set(['chat-2']));
  expect(order.slice(2)).toEqual(['chat-1:unlive', 'chat-1:release']);
  expect(dispose).not.toHaveBeenCalled();
});

it('releases but keeps the controller when the chat is listed and the router opened another', () => {
  startBootChatPrewarm(31415, 'chat-1');
  settleBootPrewarm('chat-2', new Set(['chat-1', 'chat-2']));
  expect(order.slice(2)).toEqual(['chat-1:unlive', 'chat-1:release']);
  expect(dispose).not.toHaveBeenCalled();
});

it('releases when nothing is opened (empty list, first chat deleted)', () => {
  startBootChatPrewarm(31415, 'chat-1');
  settleBootPrewarm(null, new Set());
  expect(order.slice(2)).toEqual(['chat-1:unlive', 'chat-1:release']);
  expect(dispose).toHaveBeenCalledWith('chat-1');
});

it('settling twice releases once, and a later start is a fresh guess', () => {
  startBootChatPrewarm(31415, 'chat-1');
  settleBootPrewarm(null, new Set());
  settleBootPrewarm(null, new Set());
  expect(order.filter((entry) => entry.endsWith(':release'))).toHaveLength(1);
  startBootChatPrewarm(31415, 'chat-1');
  expect(order.filter((entry) => entry.endsWith(':hold'))).toHaveLength(2);
});

it('releases itself if the list never answers', () => {
  startBootChatPrewarm(31415, 'chat-1');
  vi.advanceTimersByTime(14_999);
  expect(order).toEqual(['chat-1:live', 'chat-1:hold']);
  vi.advanceTimersByTime(2);
  expect(order.slice(2)).toEqual(['chat-1:unlive', 'chat-1:release']);
});

it('drops the guess on a daemon switch without disposing anything itself', () => {
  startBootChatPrewarm(31415, 'chat-1');
  resetBootPrewarm();
  expect(order.slice(2)).toEqual(['chat-1:unlive', 'chat-1:release']);
  expect(dispose).not.toHaveBeenCalled();
});
