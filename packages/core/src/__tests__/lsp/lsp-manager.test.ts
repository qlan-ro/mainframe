import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { LspManager } from '../../lsp/lsp-manager.js';
import { LspRegistry } from '../../lsp/lsp-registry.js';

type MockProcess = NodeJS.EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  pid: number;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
};

function makeMockProcess(): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.pid = 12345;
  proc.killed = false;
  proc.kill = vi.fn(() => {
    proc.killed = true;
    // process.nextTick is not affected by vi.useFakeTimers, so this resolves immediately
    process.nextTick(() => proc.emit('exit', 0, null));
  });
  // Simulate LSP graceful shutdown sequence:
  // 1st stdin write (shutdown request) → respond with stdout data so first race resolves
  // 2nd stdin write (exit notification) → emit exit so second race resolves
  let writeCount = 0;
  proc.stdin.on('data', () => {
    writeCount++;
    if (writeCount === 1) {
      process.nextTick(() =>
        proc.stdout.emit(
          'data',
          Buffer.from('Content-Length: 46\r\n\r\n{"jsonrpc":"2.0","id":"shutdown","result":null}'),
        ),
      );
    } else {
      process.nextTick(() => proc.emit('exit', 0, null));
    }
  });
  return proc;
}

// Mock child_process.spawn while keeping the rest of the module intact
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(makeMockProcess),
  };
});

describe('LspManager', () => {
  let manager: LspManager;
  let registry: LspRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    registry = new LspRegistry();
    vi.spyOn(registry, 'resolveCommand').mockResolvedValue({
      command: '/usr/bin/node',
      args: ['/path/to/server.js', '--stdio'],
    });
    manager = new LspManager(registry);
  });

  afterEach(async () => {
    // Restore real timers before shutdownAll so internal shutdown timeouts resolve
    vi.useRealTimers();
    await manager.shutdownAll();
  });

  it('spawns a new server for unknown key', async () => {
    const handle = await manager.getOrSpawn('proj1', 'typescript', '/path/to/project');
    expect(handle).toBeDefined();
    expect(handle.language).toBe('typescript');
    expect(handle.projectPath).toBe('/path/to/project');
  });

  it('returns existing handle for same key', async () => {
    const h1 = await manager.getOrSpawn('proj1', 'typescript', '/path/to/project');
    const h2 = await manager.getOrSpawn('proj1', 'typescript', '/path/to/project');
    expect(h1).toBe(h2);
  });

  it('deduplicates concurrent spawn calls', async () => {
    const [h1, h2] = await Promise.all([
      manager.getOrSpawn('proj1', 'typescript', '/path/to/project'),
      manager.getOrSpawn('proj1', 'typescript', '/path/to/project'),
    ]);
    expect(h1).toBe(h2);
    const { spawn } = await import('node:child_process');
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('reports active languages for a project', async () => {
    await manager.getOrSpawn('proj1', 'typescript', '/path/to/project');
    const active = manager.getActiveLanguages('proj1');
    expect(active).toContain('typescript');
    expect(active).not.toContain('python');
  });

  it('shutdown removes handle', async () => {
    await manager.getOrSpawn('proj1', 'typescript', '/path/to/project');
    await manager.shutdown('proj1', 'typescript');
    const active = manager.getActiveLanguages('proj1');
    expect(active).not.toContain('typescript');
  });

  it('shutdownAll clears all handles', async () => {
    await manager.getOrSpawn('proj1', 'typescript', '/path/to/project');
    await manager.getOrSpawn('proj2', 'typescript', '/path/to/project2');
    await manager.shutdownAll();
    expect(manager.getActiveLanguages('proj1')).toHaveLength(0);
    expect(manager.getActiveLanguages('proj2')).toHaveLength(0);
  });

  it('starts idle timer on spawn (no client connected)', async () => {
    const handle = await manager.getOrSpawn('proj1', 'typescript', '/path/to/project');
    expect(handle.idleTimer).not.toBeNull();
  });

  it('cancels idle timer when getOrSpawn returns existing handle', async () => {
    const handle = await manager.getOrSpawn('proj1', 'typescript', '/path/to/project');
    expect(handle.idleTimer).not.toBeNull();
    const handle2 = await manager.getOrSpawn('proj1', 'typescript', '/path/to/project');
    expect(handle2).toBe(handle);
  });

  it('idle timer fires and shuts down server after timeout', async () => {
    await manager.getOrSpawn('proj1', 'typescript', '/path/to/project');
    expect(manager.getActiveLanguages('proj1')).toContain('typescript');

    // Advance past 10-minute idle timeout
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 100);

    expect(manager.getActiveLanguages('proj1')).not.toContain('typescript');
  });
});
