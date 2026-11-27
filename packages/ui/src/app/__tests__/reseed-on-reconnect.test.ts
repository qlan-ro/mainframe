import { expect, it, vi } from 'vitest';
import { reseedOnReconnect } from '../reseed-on-reconnect';

function fakeWs(connected = false) {
  const listeners = new Set<() => void>();
  const ws = {
    connected,
    subscribeConnection: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    ws,
    set(next: boolean) {
      ws.connected = next;
      listeners.forEach((listener) => listener());
    },
    listeners,
  };
}

it('does not reseed on the boot connect, which follows the shell mount seed', () => {
  const socket = fakeWs(false);
  const reseed = vi.fn();
  reseedOnReconnect(socket.ws, reseed);
  socket.set(true);
  expect(reseed).not.toHaveBeenCalled();
});

it('reseeds once when the socket opens again after a drop', () => {
  const socket = fakeWs(true);
  const reseed = vi.fn();
  reseedOnReconnect(socket.ws, reseed);
  socket.set(false);
  expect(reseed).not.toHaveBeenCalled();
  socket.set(true);
  expect(reseed).toHaveBeenCalledTimes(1);
  socket.set(true);
  expect(reseed).toHaveBeenCalledTimes(1);
});

it('reseeds after a connect attempt failed before the first open', () => {
  const socket = fakeWs(false);
  const reseed = vi.fn();
  reseedOnReconnect(socket.ws, reseed);
  socket.set(false); // onerror
  socket.set(true);
  expect(reseed).toHaveBeenCalledTimes(1);
});

it('reseeds on every later drop and open, and stops after unsubscribe', () => {
  const socket = fakeWs(true);
  const reseed = vi.fn();
  const stop = reseedOnReconnect(socket.ws, reseed);
  socket.set(false);
  socket.set(true);
  socket.set(false);
  socket.set(true);
  expect(reseed).toHaveBeenCalledTimes(2);
  stop();
  socket.set(false);
  socket.set(true);
  expect(reseed).toHaveBeenCalledTimes(2);
  expect(socket.listeners.size).toBe(0);
});
