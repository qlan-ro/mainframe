import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AcpFacadeClient } from '../acp-client';
import { FakeSocket, initializeResult, flushMicrotasks } from './acp-client-test-kit';
import { AcpSessionAttachment } from '../../../features/chat/controller/acp-session-attachment';
import { makeHost } from '../../../features/chat/controller/__tests__/acp-attachment-support';
import { createChatThreadState, reduceChatThreadState } from '../../../features/chat/controller/chat-thread-state';

const clients: AcpFacadeClient[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  clients.splice(0).forEach((client) => client.disconnect());
  vi.useRealTimers();
});
function setup() {
  const sockets: FakeSocket[] = [];
  const client = new AcpFacadeClient('mock-cli', {
    url: () => 'ws://test',
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  clients.push(client);
  const start = async () => {
    const done = client.ensureConnected();
    const socket = sockets[sockets.length - 1]!;
    socket.open();
    await flushMicrotasks();
    const reply = (flags: unknown, overrides = {}) =>
      socket.receive({
        jsonrpc: '2.0',
        id: 1,
        result: initializeResult({
          _meta: flags === undefined ? undefined : { '_mainframe.dev': flags },
          ...overrides,
        }),
      });
    return { socket, done, reply };
  };
  return { client, start };
}
it('installs both capabilities before back-to-back session and cursor traffic', async () => {
  const { client, start } = setup();
  const bundle = makeHost();
  let state = createChatThreadState('chat');
  const events: string[] = [];
  bundle.host.dispatch = (event) => {
    state = reduceChatThreadState(state, event);
    events.push(event.type);
  };
  const attachment = new AcpSessionAttachment(bundle.host);
  attachment.bindClient(client);
  client.onSessionUpdate(() => {
    expect(state.authoritativeItemStreaming).toBe(true);
    expect(client.connected).toBe(true);
    expect(client.connectionGeneration).toBe(1);
    events.push('session');
  });
  client.onCursor(() => {
    expect(state.authoritativeItemStreaming).toBe(true);
    expect(client.mainframeCapabilities?.revisionCursors).toBe(true);
    events.push('cursor');
  });
  const { socket, done, reply } = await start();
  const completed = done.then(() => events.push('resolved'));
  expect(socket.sent[0]).toMatchObject({ params: { _meta: { '_mainframe.dev': { revisionCursors: true } } } });
  reply({ authoritativeItemStreaming: true, revisionCursors: true, replayComplete: true });
  socket.receive({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 'chat',
      update: { sessionUpdate: 'state_update', state: 'running' },
    },
  });
  socket.receive({
    jsonrpc: '2.0',
    method: '_mainframe.dev/cursor',
    params: { sessionId: 'chat', epoch: 'e1', revision: 1 },
  });
  expect(events).toEqual(['capabilities.updated', 'session', 'cursor']);
  await completed;
  expect(events).toEqual(['capabilities.updated', 'session', 'cursor', 'resolved']);
  attachment.dispose();
});
it.each([
  undefined,
  {},
  { authoritativeItemStreaming: false },
  { authoritativeItemStreaming: 'true' },
  { replayComplete: true, itemCreationMarkers: true },
])('replaces true with legacy on successful reinitialize: %j', async (flags) => {
  const { client, start } = setup();
  const seen: unknown[] = [];
  client.onCapabilitiesChanged((value) => seen.push(value?.authoritativeItemStreaming === true));
  const first = await start();
  first.reply({ authoritativeItemStreaming: true });
  await first.done;
  first.socket.close();
  expect(client.mainframeCapabilities?.authoritativeItemStreaming).toBe(true);
  const next = await start();
  next.reply(flags);
  await next.done;
  expect(seen).toEqual([true, false]);
});
it('publishes an elsewhere-initiated legacy-to-true reconnect before this chat receives its delayed gap', async () => {
  const { client, start } = setup();
  const bundle = makeHost();
  const attachment = new AcpSessionAttachment(bundle.host);
  const first = await start();
  first.reply({});
  await first.done;
  attachment.bindClient(client);
  const gap = vi.fn();
  client.onGap(gap);
  first.socket.close();
  const next = await start();
  next.reply({ authoritativeItemStreaming: true });
  await next.done;
  expect(gap).not.toHaveBeenCalled();
  expect(bundle.dispatch).toHaveBeenLastCalledWith({ type: 'capabilities.updated', authoritativeItemStreaming: true });
  expect(next.socket.sent).toHaveLength(1);
  attachment.dispose();
});
it('retains successful negotiation when initialize fails and ignores traffic from failed or old sockets', async () => {
  const { client, start } = setup();
  const listener = vi.fn();
  client.onCapabilitiesChanged(listener);
  const updates = vi.fn();
  client.onSessionUpdate(updates);
  const first = await start();
  first.reply({ authoritativeItemStreaming: true });
  await first.done;
  first.socket.close();
  const failed = await start();
  const rejected = expect(failed.done).rejects.toThrow(/unsupported/);
  failed.reply({}, { protocolVersion: 99 });
  await rejected;
  expect(client.mainframeCapabilities?.authoritativeItemStreaming).toBe(true);
  expect(listener).toHaveBeenCalledTimes(1);
  const notification = {
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 'chat',
      update: { sessionUpdate: 'state_update', state: 'running' },
    },
  };
  first.socket.receive(notification);
  failed.socket.receive(notification);
  expect(updates).not.toHaveBeenCalled();
});
it('stops notifying an unsubscribed capability listener', async () => {
  const { client, start } = setup();
  const listener = vi.fn();
  const unsubscribe = client.onCapabilitiesChanged(listener);
  unsubscribe();
  const attempt = await start();
  attempt.reply({ authoritativeItemStreaming: true });
  await attempt.done;
  expect(listener).not.toHaveBeenCalled();
});

it('ignores a late initialize reply from an attempt superseded by a newer connection', async () => {
  const { client, start } = setup();
  const old = await start();
  client.disconnect();
  const next = await start();
  next.reply({ authoritativeItemStreaming: false });
  await next.done;
  const seen = vi.fn();
  client.onCapabilitiesChanged(seen);
  const rejected = expect(old.done).rejects.toThrow(/superseded/);
  old.reply({ authoritativeItemStreaming: true });
  await rejected;
  expect(client.mainframeCapabilities?.authoritativeItemStreaming).toBe(false);
  expect(client.connectionGeneration).toBe(1);
  expect(client.connected).toBe(true);
  expect(old.socket.closed).toBe(true);
  expect(seen).not.toHaveBeenCalled();
});
