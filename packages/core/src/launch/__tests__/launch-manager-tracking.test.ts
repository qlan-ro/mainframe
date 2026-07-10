import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LaunchConfiguration } from '@qlan-ro/mainframe-types';
import type { ManagedChildEntry, ChildRegistryPort, ManagedChildKind } from '../../process/index.js';

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

function makeMockChild(pid = 12345) {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const child = Object.assign(new EventEmitter(), { pid, stdout, stderr, kill: vi.fn() });
  process.nextTick(() => child.emit('spawn'));
  return child;
}

class RecordingRegistry implements ChildRegistryPort {
  added: ManagedChildEntry[] = [];
  removed: number[] = [];
  async add(entry: ManagedChildEntry): Promise<void> {
    this.added.push(entry);
  }
  async remove(pid: number): Promise<void> {
    this.removed.push(pid);
  }
  async list(): Promise<ManagedChildEntry[]> {
    return [];
  }
  async listByKind(_kind: ManagedChildKind): Promise<ManagedChildEntry[]> {
    return [];
  }
  async clear(): Promise<void> {}
}

function makeConfig(over: Partial<LaunchConfiguration> = {}): LaunchConfiguration {
  return { name: 'dev', runtimeExecutable: 'pnpm', runtimeArgs: ['run', 'dev'], port: null, url: null, ...over };
}

/** Stub for the live-command reader the sweep compares against (`ps -o command=`). */
function reader(output: string | null): (pid: number) => Promise<string | null> {
  return vi.fn(async () => output);
}

describe('LaunchManager registry tracking', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => makeMockChild());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records the live post-shebang command line as identity, not the recorded executable', async () => {
    // The kernel rewrites argv for a #! script: spawning `pnpm` shows
    // `node /opt/homebrew/bin/pnpm run dev` in `ps`, which is what the sweep
    // compares against. Recording the bare executable would never match, so the
    // sweep would prune the record without reaping and leak the dev-server tree.
    const { LaunchManager } = await import('../launch-manager.js');
    const registry = new RecordingRegistry();
    const live = 'node /opt/homebrew/bin/pnpm run dev';
    const manager = new LaunchManager('proj-1', '/tmp/project', vi.fn(), undefined, registry, reader(live));

    await manager.start(makeConfig());

    expect(registry.added).toEqual([
      expect.objectContaining({
        pid: 12345,
        kind: 'launch',
        command: live,
        args: [],
        cwd: '/tmp/project',
        group: true,
        label: 'proj-1:dev',
      }),
    ]);
  });

  it('records the realpath-resolved cwd so it matches the OS-reported cwd (macOS /tmp → /private/tmp)', async () => {
    // The sweep compares the recorded cwd against `lsof`, which reports the
    // realpath. A symlinked spawn cwd (every /tmp path on macOS) must be
    // resolved at record time or the guard rejects our own orphan and it lives.
    const dir = await mkdtemp(join(tmpdir(), 'launch-cwd-'));
    const real = await realpath(dir);
    try {
      const { LaunchManager } = await import('../launch-manager.js');
      const registry = new RecordingRegistry();
      const manager = new LaunchManager('proj-1', dir, vi.fn(), undefined, registry, reader('node /pnpm run dev'));
      await manager.start(makeConfig());
      expect(registry.added[0]!.cwd).toBe(real);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the resolved executable + argv when the live command line is unavailable', async () => {
    // If `ps` can't read the pid (already exited, or a sandbox denies it), keep
    // a best-effort record from what we spawned — the resolved absolute path for
    // a relative executable — rather than dropping the reap record entirely.
    const { LaunchManager } = await import('../launch-manager.js');
    const registry = new RecordingRegistry();
    const manager = new LaunchManager('proj-1', '/tmp/project', vi.fn(), undefined, registry, reader(null));

    await manager.start(makeConfig({ runtimeExecutable: './gradlew', runtimeArgs: ['bootRun'] }));

    expect(registry.added[0]).toMatchObject({ command: '/tmp/project/gradlew', args: ['bootRun'] });
  });

  it('forgets the pid when the launch process exits', async () => {
    const { LaunchManager } = await import('../launch-manager.js');
    const registry = new RecordingRegistry();
    const manager = new LaunchManager(
      'proj-1',
      '/tmp/project',
      vi.fn(),
      undefined,
      registry,
      reader('node /pnpm run dev'),
    );

    const child = makeMockChild();
    spawnMock.mockReturnValueOnce(child);
    await manager.start(makeConfig());
    child.emit('exit', 0);

    expect(registry.removed).toContain(12345);
  });

  it('forgets the pid when the launch process errors', async () => {
    const { LaunchManager } = await import('../launch-manager.js');
    const registry = new RecordingRegistry();
    const manager = new LaunchManager(
      'proj-1',
      '/tmp/project',
      vi.fn(),
      undefined,
      registry,
      reader('node /pnpm run dev'),
    );

    const child = Object.assign(new EventEmitter(), {
      pid: 999,
      stdout: new Readable({ read() {} }),
      stderr: new Readable({ read() {} }),
      kill: vi.fn(),
    });
    spawnMock.mockReturnValueOnce(child);
    const started = manager.start(makeConfig());
    process.nextTick(() => child.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })));
    await started.catch(() => {});

    expect(registry.removed).toContain(999);
  });

  it('kills the process group and forgets the pid on stop()', async () => {
    const { LaunchManager } = await import('../launch-manager.js');
    const registry = new RecordingRegistry();
    const manager = new LaunchManager(
      'proj-1',
      '/tmp/project',
      vi.fn(),
      undefined,
      registry,
      reader('node /pnpm run dev'),
    );

    const child = makeMockChild(7777);
    spawnMock.mockReturnValueOnce(child);
    await manager.start(makeConfig());

    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
    const stopping = manager.stop('dev');
    child.emit('exit', 0); // let stop()'s await settle
    await stopping;

    expect(killSpy).toHaveBeenCalledWith(-7777, 'SIGTERM');
    expect(registry.removed).toContain(7777);
  });
});
