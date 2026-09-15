/**
 * AcpFacadeClient — gate_resolved, heartbeat/gap detection, and
 * session/prompt|cancel|resume. Split out of acp-client.test.ts (todo #350,
 * plan task 37, R2.13) to keep that file under the 300-line cap.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { connectedClient } from './acp-client-test-kit';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AcpFacadeClient — _mainframe.dev/gate_resolved (criterion 8 client half)', () => {
  it('delivers a validated gate resolution to listeners', async () => {
    const { client, socket } = await connectedClient();
    const resolutions: Array<{ sessionId: string; requestId: string }> = [];
    client.onGateResolved((sessionId, requestId) => resolutions.push({ sessionId, requestId }));

    socket.receive({
      jsonrpc: '2.0',
      method: '_mainframe.dev/gate_resolved',
      params: { sessionId: 'chat_1', requestId: 'gate-req_001' },
    });

    expect(resolutions).toEqual([{ sessionId: 'chat_1', requestId: 'gate-req_001' }]);
  });

  it('drops a gate_resolved notification that fails schema validation', async () => {
    const { client, socket } = await connectedClient();
    const resolutions = vi.fn();
    client.onGateResolved(resolutions);

    socket.receive({ jsonrpc: '2.0', method: '_mainframe.dev/gate_resolved', params: { sessionId: 42 } });

    expect(resolutions).not.toHaveBeenCalled();
  });
});

describe('AcpFacadeClient — heartbeat + gap detection (criterion 11 client half)', () => {
  it('does not signal a gap for consecutive heartbeat sequences', async () => {
    const { client, socket } = await connectedClient();
    const gaps = vi.fn();
    client.onGap(gaps);

    socket.receive({ jsonrpc: '2.0', method: '_mainframe.dev/heartbeat', params: { sequence: 1 } });
    socket.receive({ jsonrpc: '2.0', method: '_mainframe.dev/heartbeat', params: { sequence: 2 } });

    expect(gaps).not.toHaveBeenCalled();
  });

  it('signals a gap when a heartbeat sequence jumps by more than one', async () => {
    const { client, socket } = await connectedClient();
    const gaps = vi.fn();
    client.onGap(gaps);

    socket.receive({ jsonrpc: '2.0', method: '_mainframe.dev/heartbeat', params: { sequence: 1 } });
    expect(gaps).not.toHaveBeenCalled();

    socket.receive({ jsonrpc: '2.0', method: '_mainframe.dev/heartbeat', params: { sequence: 3 } });
    expect(gaps).toHaveBeenCalledTimes(1);
  });

  it('signals a gap on silence past 2x the advertised heartbeat interval', async () => {
    const { client, socket } = await connectedClient();
    const gaps = vi.fn();
    client.onGap(gaps);

    socket.receive({ jsonrpc: '2.0', method: '_mainframe.dev/heartbeat', params: { sequence: 1 } });
    vi.advanceTimersByTime(15000 * 2 - 1);
    expect(gaps).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(gaps).toHaveBeenCalledTimes(1);
  });

  it('a close marks the client unconnected and DEFERS the gap until reconnect', async () => {
    // A gap fired while the socket is down would make every session's
    // resume() throw — the client reconnects first and only then signals the
    // gap (see handleClose). Verify the deferral half here; the fired half
    // needs a live reconnect and is covered by the resume-after-silence e2e.
    const { client, socket } = await connectedClient();
    const gaps = vi.fn();
    client.onGap(gaps);

    socket.close();

    expect(client.connected).toBe(false);
    expect(gaps).not.toHaveBeenCalled();
    client.disconnect();
  });
});

describe('AcpFacadeClient — session/prompt, session/cancel, session/resume', () => {
  it('prompt() sends a text content block and parses the acceptance response', async () => {
    const { client, socket } = await connectedClient();
    const promptPromise = client.prompt('chat_1', 'hello');
    const req = socket.sent[socket.sent.length - 1] as { id: number; method: string; params: unknown };
    expect(req).toMatchObject({
      method: 'session/prompt',
      params: { sessionId: 'chat_1', prompt: [{ type: 'text', text: 'hello' }] },
    });

    socket.receive({ jsonrpc: '2.0', id: req.id, result: { _meta: { '_mainframe.dev': { position: 2 } } } });
    await expect(promptPromise).resolves.toEqual({ _meta: { '_mainframe.dev': { position: 2 } } });
  });

  it('cancel() sends a notification (no id, no reply expected)', async () => {
    const { client, socket } = await connectedClient();
    client.cancel('chat_1');
    expect(socket.sent[socket.sent.length - 1]).toEqual({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: 'chat_1' },
    });
  });

  it('resume() carries the replayFrom cursor and parses the response', async () => {
    const { client, socket } = await connectedClient();
    const resumePromise = client.resume('chat_1', '/repo', { type: 'start' });
    const req = socket.sent[socket.sent.length - 1] as { id: number };
    expect(req).toMatchObject({
      method: 'session/resume',
      params: { sessionId: 'chat_1', cwd: '/repo', replayFrom: { type: 'start' } },
    });

    socket.receive({ jsonrpc: '2.0', id: req.id, result: {} });
    await expect(resumePromise).resolves.toEqual({});
  });
});
