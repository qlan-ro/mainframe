import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { LaunchConfiguration } from '@qlan-ro/mainframe-types';

// Must be called before any import that uses child_process.spawn.
// vi.mock is hoisted to the top of the file by vitest.
const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

function makeMockChild() {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const child = Object.assign(new EventEmitter(), { pid: 12345, stdout, stderr, kill: vi.fn() });
  // Simulate the process spawning successfully on the next tick, matching
  // real child_process behavior (the 'spawn' event fires asynchronously).
  process.nextTick(() => child.emit('spawn'));
  return child;
}

describe('LaunchManager cleanEnv PATH handling', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => makeMockChild());
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  function makeConfig(): LaunchConfiguration {
    return {
      name: 'dev',
      runtimeExecutable: 'npm',
      runtimeArgs: ['run', 'dev'],
      port: null,
      url: null,
    };
  }

  it('uses MAINFRAME_ORIG_PATH as child PATH when set, and does not forward it', async () => {
    process.env.PATH = '/mainframe/bundled/bin:/usr/bin';
    process.env.MAINFRAME_ORIG_PATH = '/usr/bin:/usr/local/bin';

    const { LaunchManager } = await import('../launch-manager.js');
    const manager = new LaunchManager('proj-1', '/tmp/project', vi.fn());
    await manager.start(makeConfig());

    const spawnEnv = spawnMock.mock.calls[0]?.[2]?.env as Record<string, string>;
    expect(spawnEnv.PATH).toBe('/usr/bin:/usr/local/bin');
    expect(spawnEnv.MAINFRAME_ORIG_PATH).toBeUndefined();
  });

  it('falls back to the daemon PATH when MAINFRAME_ORIG_PATH is unset', async () => {
    process.env.PATH = '/usr/bin:/usr/local/bin';
    delete process.env.MAINFRAME_ORIG_PATH;

    const { LaunchManager } = await import('../launch-manager.js');
    const manager = new LaunchManager('proj-1', '/tmp/project', vi.fn());
    await manager.start(makeConfig());

    const spawnEnv = spawnMock.mock.calls[0]?.[2]?.env as Record<string, string>;
    expect(spawnEnv.PATH).toBe('/usr/bin:/usr/local/bin');
  });
});

describe('LaunchManager output buffering (echo-once fast-subprocess race)', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function makeConfig(): LaunchConfiguration {
    return {
      name: 'echo-once',
      runtimeExecutable: 'echo',
      runtimeArgs: ['hello-from-launch'],
      port: null,
      url: null,
    };
  }

  it('retains stdout emitted before a near-instant exit, readable via getOutputBuffer', async () => {
    const { LaunchManager } = await import('../launch-manager.js');
    const manager = new LaunchManager('proj-1', '/tmp/project', vi.fn());

    const child = makeMockChild();
    spawnMock.mockReturnValueOnce(child);

    const startPromise = manager.start(makeConfig());
    // The "echo" lifecycle this reproduces: stdout data and exit both fire
    // before `start()`'s own returned promise ever resolves.
    child.stdout.push('hello-from-launch\n');
    child.emit('exit', 0);
    await startPromise;
    // Let the pushed stdout chunk's 'data' event flush (Readable delivers
    // pushed data asynchronously, even with a listener already attached).
    await new Promise((r) => setTimeout(r, 20));

    // The process map entry is gone (exited), but the output buffer is a
    // separate, non-deleted record — this is what a late-attaching or
    // slow-to-render console pane replays from instead of relying solely on
    // having caught the live WS event at the exact right moment.
    expect(manager.getOutputBuffer('echo-once')).toEqual([{ stream: 'stdout', data: 'hello-from-launch\n' }]);
  });

  it('resets the buffer for a config name on the next start (no stale output from a prior run)', async () => {
    const { LaunchManager } = await import('../launch-manager.js');
    const manager = new LaunchManager('proj-1', '/tmp/project', vi.fn());

    const first = makeMockChild();
    spawnMock.mockReturnValueOnce(first);
    const firstStart = manager.start(makeConfig());
    first.stdout.push('first-run\n');
    first.emit('exit', 0);
    await firstStart;
    await new Promise((r) => setTimeout(r, 20));
    expect(manager.getOutputBuffer('echo-once')).toEqual([{ stream: 'stdout', data: 'first-run\n' }]);

    const second = makeMockChild();
    spawnMock.mockReturnValueOnce(second);
    const secondStart = manager.start(makeConfig());
    second.stdout.push('second-run\n');
    second.emit('exit', 0);
    await secondStart;
    await new Promise((r) => setTimeout(r, 20));

    expect(manager.getOutputBuffer('echo-once')).toEqual([{ stream: 'stdout', data: 'second-run\n' }]);
  });
});
