import { describe, it, expect, vi } from 'vitest';
import { processMatchesBinary, processMatchesLaunch, sweepStrayChildren, defaultKill } from '../../process/sweep.js';
import { NoopChildRegistry } from '../../process/child-registry.js';
import type { ManagedChildEntry } from '../../process/child-registry.js';

const BIN = '/home/user/.mainframe/bin/bin/cloudflared';
const PNPM = '/opt/homebrew/bin/pnpm';
const CWD = '/Users/me/project';

function tunnel(pid: number, command = BIN): ManagedChildEntry {
  return { pid, kind: 'tunnel', command, args: [], cwd: null, group: false, label: `preview:${pid}`, spawnedAt: 0 };
}

function launch(pid: number, args = ['run', 'dev'], cwd = CWD): ManagedChildEntry {
  return { pid, kind: 'launch', command: PNPM, args, cwd, group: true, label: `proj:${pid}`, spawnedAt: 0 };
}

/** In-memory registry seeded with entries; `remove` records prunes so tests can assert reaped vs retained. */
class FakeRegistry extends NoopChildRegistry {
  removed: number[] = [];
  constructor(private entries: ManagedChildEntry[]) {
    super();
  }
  override async list(): Promise<ManagedChildEntry[]> {
    return this.entries;
  }
  override async remove(pid: number): Promise<void> {
    this.removed.push(pid);
    this.entries = this.entries.filter((e) => e.pid !== pid);
  }
  remaining(): number[] {
    return this.entries.map((e) => e.pid);
  }
}

describe('processMatchesBinary', () => {
  it('matches the exact recorded binary path', () => {
    expect(processMatchesBinary(`${BIN} tunnel --url http://localhost:4173`, BIN)).toBe(true);
  });
  it('rejects a non-absolute recorded path', () => {
    expect(processMatchesBinary('cloudflared tunnel run', 'cloudflared')).toBe(false);
  });
  it('rejects a sibling binary sharing the path as a prefix', () => {
    expect(processMatchesBinary(`${BIN}-updater run`, BIN)).toBe(false);
  });
});

describe('processMatchesLaunch', () => {
  it('matches when the full argv and cwd both match', () => {
    expect(processMatchesLaunch(`${PNPM} run dev`, CWD, launch(1))).toBe(true);
  });
  it('matches an argv-only invocation (no extra args) with matching cwd', () => {
    expect(processMatchesLaunch(PNPM, CWD, launch(1, []))).toBe(true);
  });
  it('rejects when the command line differs (PID reuse by another program)', () => {
    expect(processMatchesLaunch('/usr/bin/postgres -D /data', CWD, launch(1))).toBe(false);
  });
  it('rejects when only a fragment of the argv matches', () => {
    expect(processMatchesLaunch(`${PNPM} run dev --host`, CWD, launch(1))).toBe(false);
  });
  it('rejects when the cwd differs (same command in a different project)', () => {
    expect(processMatchesLaunch(`${PNPM} run dev`, '/Users/me/other', launch(1))).toBe(false);
  });
  it('rejects when the live cwd is unreadable (null)', () => {
    expect(processMatchesLaunch(`${PNPM} run dev`, null, launch(1))).toBe(false);
  });
});

describe('sweepStrayChildren', () => {
  it('reaps a tunnel by pid when its command matches the recorded binary', async () => {
    const registry = new FakeRegistry([tunnel(4242)]);
    const kill = vi.fn(() => true);
    const result = await sweepStrayChildren(registry, {
      processCommand: async () => `${BIN} tunnel --url http://localhost:4173`,
      processCwd: async () => null,
      kill,
    });
    expect(kill).toHaveBeenCalledWith(4242, 'SIGTERM', false);
    expect(result).toEqual({ total: 1, reaped: 1, skipped: 0 });
    expect(registry.remaining()).toEqual([]);
  });

  it('reaps a launch child by process GROUP when argv and cwd match', async () => {
    const registry = new FakeRegistry([launch(5000)]);
    const kill = vi.fn(() => true);
    const result = await sweepStrayChildren(registry, {
      processCommand: async () => `${PNPM} run dev`,
      processCwd: async () => CWD,
      kill,
    });
    expect(kill).toHaveBeenCalledWith(5000, 'SIGTERM', true);
    expect(result).toEqual({ total: 1, reaped: 1, skipped: 0 });
    expect(registry.remaining()).toEqual([]);
  });

  it('never kills a launch pid reused by a bystander, but prunes the stale record', async () => {
    const registry = new FakeRegistry([launch(5000)]);
    const kill = vi.fn(() => true);
    const result = await sweepStrayChildren(registry, {
      processCommand: async () => '/usr/bin/postgres -D /data',
      processCwd: async () => '/var/lib/postgres',
      kill,
    });
    expect(kill).not.toHaveBeenCalled();
    expect(result).toEqual({ total: 1, reaped: 0, skipped: 1 });
    expect(registry.remaining()).toEqual([]);
  });

  it('never kills a launch group whose cwd no longer matches (same argv, different project)', async () => {
    const registry = new FakeRegistry([launch(5000)]);
    const kill = vi.fn(() => true);
    const result = await sweepStrayChildren(registry, {
      processCommand: async () => `${PNPM} run dev`,
      processCwd: async () => '/Users/me/other',
      kill,
    });
    expect(kill).not.toHaveBeenCalled();
    expect(registry.remaining()).toEqual([]);
  });

  it('prunes the stale record of a pid that is no longer alive', async () => {
    const registry = new FakeRegistry([launch(5000)]);
    const kill = vi.fn(() => true);
    const result = await sweepStrayChildren(registry, {
      processCommand: async () => null,
      processCwd: async () => null,
      kill,
    });
    expect(kill).not.toHaveBeenCalled();
    expect(result).toEqual({ total: 1, reaped: 0, skipped: 1 });
    expect(registry.remaining()).toEqual([]);
  });

  it('reaps matching entries out of a mixed tunnel/launch set and prunes every handled record', async () => {
    const registry = new FakeRegistry([tunnel(1), launch(2), launch(3)]);
    const kill = vi.fn(() => true);
    const commands: Record<number, string | null> = {
      1: `${BIN} tunnel --url http://localhost:4173`,
      2: `${PNPM} run dev`,
      3: '/opt/other/thing', // reused pid
    };
    const result = await sweepStrayChildren(registry, {
      processCommand: async (pid) => commands[pid] ?? null,
      processCwd: async () => CWD,
      kill,
    });
    expect(kill).toHaveBeenCalledTimes(2);
    expect(kill).toHaveBeenCalledWith(1, 'SIGTERM', false);
    expect(kill).toHaveBeenCalledWith(2, 'SIGTERM', true);
    expect(result).toEqual({ total: 3, reaped: 2, skipped: 1 });
    expect(registry.remaining()).toEqual([]);
  });

  it('leaves the registry intact and reaps nothing on win32 (no ps to inspect pids)', async () => {
    const registry = new FakeRegistry([tunnel(1), launch(2)]);
    const kill = vi.fn(() => true);
    const processCommand = vi.fn(async () => `${BIN} tunnel run`);
    const result = await sweepStrayChildren(registry, {
      processCommand,
      processCwd: async () => null,
      kill,
      platform: 'win32',
    });
    expect(kill).not.toHaveBeenCalled();
    expect(processCommand).not.toHaveBeenCalled();
    expect(registry.remaining()).toEqual([1, 2]);
    expect(result).toEqual({ total: 2, reaped: 0, skipped: 2 });
  });

  it('retains the record of a still-alive orphan whose kill fails (EPERM)', async () => {
    const registry = new FakeRegistry([launch(5000)]);
    const kill = vi.fn(() => false);
    const result = await sweepStrayChildren(registry, {
      processCommand: async () => `${PNPM} run dev`,
      processCwd: async () => CWD,
      kill,
    });
    expect(kill).toHaveBeenCalledWith(5000, 'SIGTERM', true);
    expect(result).toEqual({ total: 1, reaped: 0, skipped: 1 });
    expect(registry.remaining()).toEqual([5000]);
  });

  it('treats a thrown kill as a failure and retains the record', async () => {
    const registry = new FakeRegistry([launch(1), launch(2)]);
    const kill = vi.fn((pid: number) => {
      if (pid === 1) throw new Error('EPERM');
      return true;
    });
    const result = await sweepStrayChildren(registry, {
      processCommand: async () => `${PNPM} run dev`,
      processCwd: async () => CWD,
      kill,
    });
    expect(result).toEqual({ total: 2, reaped: 1, skipped: 1 });
    expect(registry.remaining()).toEqual([1]);
  });

  it('does not query cwd for tunnels (group:false)', async () => {
    const registry = new FakeRegistry([tunnel(1)]);
    const kill = vi.fn(() => true);
    const processCwd = vi.fn(async () => null);
    await sweepStrayChildren(registry, {
      processCommand: async () => `${BIN} tunnel run`,
      processCwd,
      kill,
    });
    expect(processCwd).not.toHaveBeenCalled();
  });
});

describe('defaultKill', () => {
  it('targets the pid when not a group kill', () => {
    const spy = vi.spyOn(process, 'kill').mockReturnValue(true);
    try {
      expect(defaultKill(4242, 'SIGTERM', false)).toBe(true);
      expect(spy).toHaveBeenCalledWith(4242, 'SIGTERM');
    } finally {
      spy.mockRestore();
    }
  });

  it('targets the negative pid (process group) for a group kill', () => {
    const spy = vi.spyOn(process, 'kill').mockReturnValue(true);
    try {
      expect(defaultKill(4242, 'SIGTERM', true)).toBe(true);
      expect(spy).toHaveBeenCalledWith(-4242, 'SIGTERM');
    } finally {
      spy.mockRestore();
    }
  });

  it('returns true when the process is already gone (ESRCH)', () => {
    const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('no such process') as NodeJS.ErrnoException;
      err.code = 'ESRCH';
      throw err;
    });
    try {
      expect(defaultKill(4242, 'SIGTERM', true)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('returns false when the kill is denied (EPERM)', () => {
    const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('operation not permitted') as NodeJS.ErrnoException;
      err.code = 'EPERM';
      throw err;
    });
    try {
      expect(defaultKill(4242, 'SIGTERM', false)).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
