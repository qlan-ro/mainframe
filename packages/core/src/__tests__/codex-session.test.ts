// packages/core/src/__tests__/codex-session.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodexSession } from '../plugins/builtin/codex/session.js';

// Mock fs.accessSync so projectPath validation never throws
vi.mock('node:fs', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:fs')>();
  return { ...orig, accessSync: vi.fn() };
});

// Mock child_process.spawn
vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events');
  const { Readable, Writable } = await import('node:stream');

  return {
    spawn: vi.fn(() => {
      const proc = new EventEmitter() as InstanceType<typeof EventEmitter> & Record<string, unknown>;
      proc.stdin = new Writable({
        write(_chunk: unknown, _enc: unknown, cb: () => void) {
          cb();
        },
      });
      proc.stdout = new Readable({ read() {} });
      proc.stderr = new Readable({ read() {} });
      proc.pid = 9999;
      proc.killed = false;
      proc.kill = vi.fn(() => {
        proc.emit('close', 0);
        return true;
      });
      return proc;
    }),
  };
});

import { spawn } from 'node:child_process';
import type { SessionSink } from '@qlan-ro/mainframe-types';

function createSink(): SessionSink {
  return {
    onInit: vi.fn(),
    onMessage: vi.fn(),
    onToolResult: vi.fn(),
    onPermission: vi.fn(),
    onResult: vi.fn(),
    onExit: vi.fn(),
    onError: vi.fn(),
    onCompact: vi.fn(),
    onCompactStart: vi.fn(),
    onContextUsage: vi.fn(),
    onPlanFile: vi.fn(),
    onSkillFile: vi.fn(),
    onQueuedProcessed: vi.fn(),
    onTodoUpdate: vi.fn(),
    onPrDetected: vi.fn(),
    onCliMessage: vi.fn(),
  };
}

describe('CodexSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('spawns codex app-server with correct args', async () => {
    const session = new CodexSession({ projectPath: '/tmp/project' });
    const sink = createSink();

    // Spawn will start the handshake which will hang, so we simulate the response
    const spawnPromise = session.spawn({ model: 'codex-mini-latest', permissionMode: 'default' }, sink);

    // Get the spawned process and simulate handshake response
    const proc = (spawn as unknown as ReturnType<typeof vi.fn>).mock.results[0]!.value;
    const initResponse =
      JSON.stringify({ id: 1, result: { userAgent: 'codex/1.0', codexHome: '/home/.codex' } }) + '\n';
    proc.stdout.push(initResponse);

    await spawnPromise;

    expect(spawn).toHaveBeenCalledWith(
      'codex',
      ['app-server'],
      expect.objectContaining({
        cwd: '/tmp/project',
        detached: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    );
  });

  it('sets adapterId to codex', () => {
    const session = new CodexSession({ projectPath: '/tmp' });
    expect(session.adapterId).toBe('codex');
  });

  it('isSpawned returns false before spawn', () => {
    const session = new CodexSession({ projectPath: '/tmp' });
    expect(session.isSpawned).toBe(false);
  });

  it('maps yolo permission mode to never approval + danger-full-access sandbox', async () => {
    const session = new CodexSession({ projectPath: '/tmp/project' });
    const sink = createSink();

    const spawnPromise = session.spawn({ permissionMode: 'yolo' }, sink);
    const proc = (spawn as unknown as ReturnType<typeof vi.fn>).mock.results[0]!.value;
    proc.stdout.push(JSON.stringify({ id: 1, result: { userAgent: 'codex/1.0', codexHome: '/home/.codex' } }) + '\n');
    await spawnPromise;

    // Send a message to trigger thread/start — check the params
    const written: string[] = [];
    proc.stdin.write = vi.fn((data: string, _enc?: unknown, cb?: () => void) => {
      written.push(data);
      if (typeof cb === 'function') cb();
      return true;
    });

    // Simulate thread/start response
    const sendPromise = session.sendMessage('hello');
    // initialized notification was already sent, next write is thread/start
    // We need to parse it and respond
    await vi.waitFor(() => expect(written.length).toBeGreaterThan(0));
    const threadStartMsg = JSON.parse(written[written.length - 1]!.trim());
    if (threadStartMsg.method === 'thread/start') {
      expect(threadStartMsg.params.approvalPolicy).toBe('never');
      expect(threadStartMsg.params.sandbox).toBe('danger-full-access');
      // Respond to thread/start
      proc.stdout.push(JSON.stringify({ id: threadStartMsg.id, result: { thread: { id: 'thr_1' } } }) + '\n');
      // Respond to thread/started notification
      proc.stdout.push(JSON.stringify({ method: 'thread/started', params: { thread: { id: 'thr_1' } } }) + '\n');
    }

    // Wait for turn/start
    await vi.waitFor(() => expect(written.length).toBeGreaterThan(1));
    const lastMsg = JSON.parse(written[written.length - 1]!.trim());
    if (lastMsg.method === 'turn/start') {
      proc.stdout.push(
        JSON.stringify({ id: lastMsg.id, result: { turn: { id: 'turn_1', status: 'running' } } }) + '\n',
      );
    }

    await sendPromise;
  });

  it('kill calls close on client', async () => {
    const session = new CodexSession({ projectPath: '/tmp' });
    const sink = createSink();

    const spawnPromise = session.spawn({}, sink);
    const proc = (spawn as unknown as ReturnType<typeof vi.fn>).mock.results[0]!.value;
    proc.stdout.push(JSON.stringify({ id: 1, result: { userAgent: 'codex/1.0', codexHome: '/tmp' } }) + '\n');
    await spawnPromise;

    await session.kill();
    expect(proc.kill).toHaveBeenCalled();
  });
});
