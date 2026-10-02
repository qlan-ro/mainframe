import { afterEach, expect, it, vi } from 'vitest';
import { RpcConnection } from '../acp-rpc-connection';
import { FakeSocket } from './acp-client-test-kit';

afterEach(() => vi.useRealTimers());
async function opened() {
  const socket = new FakeSocket();
  const connection = new RpcConnection('ws://test', () => socket);
  const ready = connection.open();
  socket.open();
  await ready;
  return { socket, connection };
}
it('runs the success observer before a back-to-back notification and Promise continuation', async () => {
  const { socket, connection } = await opened();
  const events: string[] = [];
  connection.onNotification(() => events.push('notification'));
  const request = connection.sendRequest('initialize', {}, () => events.push('accepted'));
  const settled = request.then(() => events.push('resolved'));
  socket.receive({ jsonrpc: '2.0', id: 1, result: {} });
  socket.receive({ jsonrpc: '2.0', method: 'next', params: {} });
  expect(events).toEqual(['accepted', 'notification']);
  await settled;
  expect(events).toEqual(['accepted', 'notification', 'resolved']);
  connection.close();
});
it('rejects observer failures and clears the pending entry and deadline', async () => {
  vi.useFakeTimers();
  const { socket, connection } = await opened();
  const observer = vi.fn(() => {
    throw new Error('invalid initialization');
  });
  const request = connection.sendRequest('initialize', {}, observer);
  const rejected = expect(request).rejects.toThrow('invalid initialization');
  expect(() => socket.receive({ jsonrpc: '2.0', id: 1, result: {} })).not.toThrow();
  await rejected;
  socket.receive({ jsonrpc: '2.0', id: 1, result: {} });
  expect(observer).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  connection.close();
});
it('keeps RPC errors unchanged and never calls the success observer for them', async () => {
  const { socket, connection } = await opened();
  const observer = vi.fn();
  const request = connection.sendRequest('initialize', {}, observer);
  socket.receive({ jsonrpc: '2.0', id: 1, error: { code: -32001, message: 'unsupported' } });
  await expect(request).rejects.toEqual({ code: -32001, message: 'unsupported' });
  expect(observer).not.toHaveBeenCalled();
  connection.close();
});
