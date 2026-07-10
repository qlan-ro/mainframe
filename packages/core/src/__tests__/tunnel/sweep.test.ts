import { describe, it, expect, vi } from 'vitest';
import { processMatchesBinary, sweepStrayTunnels } from '../../tunnel/sweep.js';
import { NoopTunnelRegistry } from '../../tunnel/tunnel-registry.js';
import type { TunnelRegistryEntry, TunnelRegistryPort } from '../../tunnel/tunnel-registry.js';

const BIN = '/home/user/.mainframe/bin/bin/cloudflared';

function entry(pid: number, binPath = BIN): TunnelRegistryEntry {
  return { pid, label: `preview:${pid}`, binPath, spawnedAt: 0 };
}

/** In-memory registry seeded with entries so the sweep can list/clear it. */
class FakeRegistry extends NoopTunnelRegistry {
  cleared = false;
  constructor(private entries: TunnelRegistryEntry[]) {
    super();
  }
  override async list(): Promise<TunnelRegistryEntry[]> {
    return this.entries;
  }
  override async clear(): Promise<void> {
    this.cleared = true;
  }
}

describe('processMatchesBinary', () => {
  it('matches when the live command references the exact recorded binary path', () => {
    expect(processMatchesBinary(`${BIN} tunnel --url http://localhost:4173`, BIN)).toBe(true);
  });

  it('rejects a non-absolute recorded path (a bare name could match user processes)', () => {
    expect(processMatchesBinary('cloudflared tunnel --url http://localhost:4173', 'cloudflared')).toBe(false);
  });

  it('rejects when the command is a different cloudflared binary (PID reuse)', () => {
    expect(processMatchesBinary('/opt/homebrew/bin/cloudflared tunnel run', BIN)).toBe(false);
  });

  it('rejects an unrelated command that happens to reuse the pid', () => {
    expect(processMatchesBinary('/usr/bin/postgres -D /data', BIN)).toBe(false);
  });

  it('matches a bare invocation of the recorded binary with no arguments', () => {
    expect(processMatchesBinary(BIN, BIN)).toBe(true);
  });

  it('rejects a sibling binary whose path merely has the recorded path as a prefix', () => {
    expect(processMatchesBinary(`${BIN}-updater tunnel run`, BIN)).toBe(false);
  });

  it('rejects a command that only references the recorded path as an argument', () => {
    expect(processMatchesBinary(`/usr/bin/tail -f ${BIN}.log`, BIN)).toBe(false);
  });
});

describe('sweepStrayTunnels', () => {
  it('reaps a still-alive child whose command matches the recorded binary', async () => {
    const registry = new FakeRegistry([entry(4242)]);
    const kill = vi.fn();
    const result = await sweepStrayTunnels(registry, {
      processCommand: async () => `${BIN} tunnel --url http://localhost:4173`,
      kill,
    });
    expect(kill).toHaveBeenCalledWith(4242, 'SIGTERM');
    expect(result).toEqual({ total: 1, reaped: 1, skipped: 0 });
    expect(registry.cleared).toBe(true);
  });

  it('skips a pid that is no longer alive', async () => {
    const registry = new FakeRegistry([entry(4242)]);
    const kill = vi.fn();
    const result = await sweepStrayTunnels(registry, {
      processCommand: async () => null,
      kill,
    });
    expect(kill).not.toHaveBeenCalled();
    expect(result).toEqual({ total: 1, reaped: 0, skipped: 1 });
    expect(registry.cleared).toBe(true);
  });

  it('never kills a reused pid whose command is not our cloudflared binary', async () => {
    const registry = new FakeRegistry([entry(4242)]);
    const kill = vi.fn();
    const result = await sweepStrayTunnels(registry, {
      processCommand: async () => '/usr/bin/ssh -N -L 4173:localhost:4173 host',
      kill,
    });
    expect(kill).not.toHaveBeenCalled();
    expect(result).toEqual({ total: 1, reaped: 0, skipped: 1 });
  });

  it('reaps only matching entries out of a mixed set', async () => {
    const registry = new FakeRegistry([entry(1), entry(2), entry(3)]);
    const kill = vi.fn();
    const commands: Record<number, string | null> = {
      1: `${BIN} tunnel --url http://localhost:4173`,
      2: null,
      3: '/opt/homebrew/bin/cloudflared tunnel run',
    };
    const result = await sweepStrayTunnels(registry, {
      processCommand: async (pid) => commands[pid] ?? null,
      kill,
    });
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(1, 'SIGTERM');
    expect(result).toEqual({ total: 3, reaped: 1, skipped: 2 });
  });

  it('leaves the registry intact and reaps nothing on win32 (no ps to inspect pids)', async () => {
    const registry = new FakeRegistry([entry(1), entry(2)]);
    const kill = vi.fn();
    const processCommand = vi.fn(async () => `${BIN} tunnel --url http://localhost:4173`);
    const result = await sweepStrayTunnels(registry, { processCommand, kill, platform: 'win32' });
    expect(kill).not.toHaveBeenCalled();
    expect(processCommand).not.toHaveBeenCalled();
    expect(registry.cleared).toBe(false);
    expect(result).toEqual({ total: 2, reaped: 0, skipped: 2 });
  });

  it('clears the registry and does nothing when there are no entries', async () => {
    const registry = new FakeRegistry([]);
    const kill = vi.fn();
    const result = await sweepStrayTunnels(registry, { processCommand: async () => null, kill });
    expect(kill).not.toHaveBeenCalled();
    expect(result).toEqual({ total: 0, reaped: 0, skipped: 0 });
    expect(registry.cleared).toBe(true);
  });

  it('continues sweeping when killing one entry throws', async () => {
    const registry = new FakeRegistry([entry(1), entry(2)]) as FakeRegistry & TunnelRegistryPort;
    const kill = vi.fn((pid: number) => {
      if (pid === 1) throw new Error('EPERM');
    });
    const result = await sweepStrayTunnels(registry, {
      processCommand: async () => `${BIN} tunnel --url http://localhost:4173`,
      kill,
    });
    expect(kill).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ total: 2, reaped: 2, skipped: 0 });
  });
});
