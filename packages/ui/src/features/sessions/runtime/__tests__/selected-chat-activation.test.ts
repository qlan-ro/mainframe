import { expect, it, vi } from 'vitest';
import { subscribeSelectedChat } from '../selected-chat-activation';

function fixture() {
  let mainThreadId = 'first';
  const listeners = new Set<() => void>();
  const source = {
    getState: () => ({ mainThreadId }),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    source,
    listeners,
    select(id: string) {
      mainThreadId = id;
      listeners.forEach((listener) => listener());
    },
  };
}

function controller(id: string, order: string[], remote = true) {
  const live = vi.fn(() => {
    order.push(`${id}:subscribe`);
    return () => order.push(`${id}:unsubscribe`);
  });
  const hold = vi.fn(() => {
    order.push(`${id}:hold`);
    return () => order.push(`${id}:release`);
  });
  return { hasRemoteId: () => remote, subscribeLive: live, holdActive: hold };
}

it('starts the current controller immediately and switches synchronously before the next render', () => {
  const state = fixture();
  const order: string[] = [];
  const first = controller('first', order);
  const second = controller('second', order);
  const stop = subscribeSelectedChat(state.source, (id) => (id === 'first' ? first : second));
  expect(order).toEqual(['first:subscribe', 'first:hold']);
  state.select('second');
  expect(order.slice(2)).toEqual(['first:unsubscribe', 'first:release', 'second:subscribe', 'second:hold']);
  stop();
  expect(order.slice(-2)).toEqual(['second:unsubscribe', 'second:release']);
  expect(state.listeners.size).toBe(0);
});

it('keeps one hold when aliases or metadata notifications resolve to the same controller', () => {
  const state = fixture();
  const selected = controller('shared', []);
  const stop = subscribeSelectedChat(state.source, () => selected);
  state.select('remote-alias');
  state.select('remote-alias');
  expect(selected.subscribeLive).toHaveBeenCalledTimes(1);
  expect(selected.holdActive).toHaveBeenCalledTimes(1);
  stop();
});

it('leaves missing and local-only controllers to runtime activation', () => {
  const state = fixture();
  const local = controller('local', [], false);
  const find = vi.fn((id: string) => (id === 'local' ? local : undefined));
  const stop = subscribeSelectedChat(state.source, find);
  state.select('local');
  expect(local.subscribeLive).not.toHaveBeenCalled();
  expect(local.holdActive).not.toHaveBeenCalled();
  stop();
  expect(state.listeners.size).toBe(0);
});

it('balances setup cleanup setup and tolerates repeated cleanup', () => {
  const state = fixture();
  const order: string[] = [];
  const selected = controller('current', order);
  const firstStop = subscribeSelectedChat(state.source, () => selected);
  firstStop();
  firstStop();
  const secondStop = subscribeSelectedChat(state.source, () => selected);
  secondStop();
  expect(order).toEqual([
    'current:subscribe',
    'current:hold',
    'current:unsubscribe',
    'current:release',
    'current:subscribe',
    'current:hold',
    'current:unsubscribe',
    'current:release',
  ]);
  expect(state.listeners.size).toBe(0);
});

it('releases both controllers when selection changes during acquisition', () => {
  const state = fixture();
  const order: string[] = [];
  const first = controller('first', order);
  const second = controller('second', order);
  first.holdActive.mockImplementationOnce(() => {
    order.push('first:hold');
    state.select('second');
    return () => order.push('first:release');
  });
  const stop = subscribeSelectedChat(state.source, (id) => (id === 'first' ? first : second));
  stop();
  expect(order.filter((entry) => entry.endsWith(':release')).sort()).toEqual(['first:release', 'second:release']);
  expect(order.filter((entry) => entry.endsWith(':unsubscribe')).sort()).toEqual([
    'first:unsubscribe',
    'second:unsubscribe',
  ]);
});
