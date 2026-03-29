// packages/core/src/__tests__/codex-jsonrpc.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter, Readable, Writable } from 'node:stream';
import { JsonRpcClient } from '../plugins/builtin/codex/jsonrpc.js';
import type { ChildProcess } from 'node:child_process';

function createMockProcess(): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  const stdin = new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  Object.assign(proc, { stdin, stdout, stderr, pid: 1234, killed: false });
  proc.kill = vi.fn(() => {
    proc.emit('close', 0);
    return true;
  });
  return proc;
}

function createClient(
  proc: ChildProcess,
  overrides: Partial<import('../plugins/builtin/codex/jsonrpc.js').JsonRpcHandlers> = {},
) {
  return new JsonRpcClient(proc, {
    onNotification: vi.fn(),
    onRequest: vi.fn(),
    onError: vi.fn(),
    onExit: vi.fn(),
    ...overrides,
  });
}

describe('JsonRpcClient', () => {
  it('sends a request and resolves on response', async () => {
    const proc = createMockProcess();
    const written: string[] = [];
    proc.stdin!.write = vi.fn((data: string, _enc?: unknown, cb?: () => void) => {
      written.push(data);
      if (typeof cb === 'function') cb();
      return true;
    }) as unknown as typeof proc.stdin.write;

    const client = createClient(proc);
    const promise = client.request<{ thread: { id: string } }>('thread/start', { cwd: '/tmp' });

    // Parse what was written to stdin
    const sent = JSON.parse(written[0]!.trim());
    expect(sent.method).toBe('thread/start');
    expect(sent.params).toEqual({ cwd: '/tmp' });
    expect(typeof sent.id).toBe('number');

    // Simulate server response
    const response = JSON.stringify({ id: sent.id, result: { thread: { id: 'thr_1' } } }) + '\n';
    proc.stdout!.emit('data', Buffer.from(response));

    const result = await promise;
    expect(result).toEqual({ thread: { id: 'thr_1' } });
  });

  it('rejects on JSON-RPC error response', async () => {
    const proc = createMockProcess();
    const written: string[] = [];
    proc.stdin!.write = vi.fn((data: string, _enc?: unknown, cb?: () => void) => {
      written.push(data);
      if (typeof cb === 'function') cb();
      return true;
    }) as unknown as typeof proc.stdin.write;

    const client = createClient(proc);
    const promise = client.request('model/list');

    const sent = JSON.parse(written[0]!.trim());
    proc.stdout!.emit(
      'data',
      Buffer.from(JSON.stringify({ id: sent.id, error: { code: -32600, message: 'Bad request' } }) + '\n'),
    );

    await expect(promise).rejects.toThrow('Bad request');
  });

  it('dispatches notifications to handler', () => {
    const onNotification = vi.fn();
    const proc = createMockProcess();
    createClient(proc, { onNotification });

    proc.stdout!.emit(
      'data',
      Buffer.from(JSON.stringify({ method: 'thread/started', params: { thread: { id: 'thr_1' } } }) + '\n'),
    );

    expect(onNotification).toHaveBeenCalledWith('thread/started', { thread: { id: 'thr_1' } });
  });

  it('dispatches server-initiated requests to handler', () => {
    const onRequest = vi.fn();
    const proc = createMockProcess();
    createClient(proc, { onRequest });

    proc.stdout!.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          id: 99,
          method: 'item/commandExecution/requestApproval',
          params: { threadId: 't1', turnId: 'turn1', itemId: 'i1', command: 'rm -rf /' },
        }) + '\n',
      ),
    );

    expect(onRequest).toHaveBeenCalledWith(
      'item/commandExecution/requestApproval',
      { threadId: 't1', turnId: 'turn1', itemId: 'i1', command: 'rm -rf /' },
      99,
    );
  });

  it('sends respond() as JSON-RPC response', () => {
    const proc = createMockProcess();
    const written: string[] = [];
    proc.stdin!.write = vi.fn((data: string, _enc?: unknown, cb?: () => void) => {
      written.push(data);
      if (typeof cb === 'function') cb();
      return true;
    }) as unknown as typeof proc.stdin.write;

    const client = createClient(proc);
    client.respond(99, { decision: 'accept' });

    const sent = JSON.parse(written[0]!.trim());
    expect(sent).toEqual({ id: 99, result: { decision: 'accept' } });
  });

  it('handles partial chunks by buffering', () => {
    const onNotification = vi.fn();
    const proc = createMockProcess();
    createClient(proc, { onNotification });

    const full = JSON.stringify({ method: 'turn/started', params: { threadId: 't1', turn: { id: 'turn1' } } });
    proc.stdout!.emit('data', Buffer.from(full.slice(0, 20)));
    expect(onNotification).not.toHaveBeenCalled();

    proc.stdout!.emit('data', Buffer.from(full.slice(20) + '\n'));
    expect(onNotification).toHaveBeenCalledOnce();
  });

  it('rejects all pending requests on close()', async () => {
    const proc = createMockProcess();
    const written: string[] = [];
    proc.stdin!.write = vi.fn((data: string, _enc?: unknown, cb?: () => void) => {
      written.push(data);
      if (typeof cb === 'function') cb();
      return true;
    }) as unknown as typeof proc.stdin.write;

    const client = createClient(proc);
    const promise = client.request('thread/start');

    client.close();

    await expect(promise).rejects.toThrow();
  });

  it('skips malformed JSON lines', () => {
    const onNotification = vi.fn();
    const onError = vi.fn();
    const proc = createMockProcess();
    createClient(proc, { onNotification, onError });

    proc.stdout!.emit('data', Buffer.from('not valid json\n'));
    proc.stdout!.emit('data', Buffer.from(JSON.stringify({ method: 'turn/started', params: {} }) + '\n'));

    expect(onNotification).toHaveBeenCalledOnce();
  });

  it('calls onExit when process closes', () => {
    const onExit = vi.fn();
    const proc = createMockProcess();
    createClient(proc, { onExit });

    proc.emit('close', 1);
    expect(onExit).toHaveBeenCalledWith(1);
  });
});
