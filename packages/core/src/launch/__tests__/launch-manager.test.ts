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
