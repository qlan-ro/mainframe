import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
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

describe('LaunchManager registry tracking', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => makeMockChild());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records the spawned launch child as a detached group with full argv and cwd', async () => {
    const { LaunchManager } = await import('../launch-manager.js');
    const registry = new RecordingRegistry();
    const manager = new LaunchManager('proj-1', '/tmp/project', vi.fn(), undefined, registry);

    await manager.start(makeConfig());

    expect(registry.added).toEqual([
      expect.objectContaining({
        pid: 12345,
        kind: 'launch',
        command: 'pnpm',
        args: ['run', 'dev'],
        cwd: '/tmp/project',
        group: true,
        label: 'proj-1:dev',
      }),
    ]);
  });

  it('records the resolved absolute path for a relative executable', async () => {
    const { LaunchManager } = await import('../launch-manager.js');
    const registry = new RecordingRegistry();
    const manager = new LaunchManager('proj-1', '/tmp/project', vi.fn(), undefined, registry);

    await manager.start(makeConfig({ runtimeExecutable: './gradlew', runtimeArgs: ['bootRun'] }));

    expect(registry.added[0]).toMatchObject({ command: '/tmp/project/gradlew', args: ['bootRun'] });
  });

  it('forgets the pid when the launch process exits', async () => {
    const { LaunchManager } = await import('../launch-manager.js');
    const registry = new RecordingRegistry();
    const manager = new LaunchManager('proj-1', '/tmp/project', vi.fn(), undefined, registry);

    const child = makeMockChild();
    spawnMock.mockReturnValueOnce(child);
    await manager.start(makeConfig());
    child.emit('exit', 0);

    expect(registry.removed).toContain(12345);
  });

  it('forgets the pid when the launch process errors', async () => {
    const { LaunchManager } = await import('../launch-manager.js');
    const registry = new RecordingRegistry();
    const manager = new LaunchManager('proj-1', '/tmp/project', vi.fn(), undefined, registry);

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
    const manager = new LaunchManager('proj-1', '/tmp/project', vi.fn(), undefined, registry);

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
