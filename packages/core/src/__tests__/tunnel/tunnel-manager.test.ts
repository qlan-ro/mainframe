import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

// resolve4 rejects forever, simulating DNS that never propagates within the test.
const resolve4Mock = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));
vi.mock('node:dns/promises', () => ({
  Resolver: vi.fn(function MockResolver(this: { setServers: () => void; resolve4: typeof resolve4Mock }) {
    this.setServers = vi.fn();
    this.resolve4 = resolve4Mock;
  }),
}));

// Imported after the mocks above so TunnelManager picks up the mocked deps.
const { TunnelManager } = await import('../../tunnel/tunnel-manager.js');
import type { TunnelRegistryEntry, TunnelRegistryPort } from '../../tunnel/tunnel-registry.js';

type MockChild = NodeJS.EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
  pid?: number;
};

function makeMockChild(pid?: number): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  child.pid = pid;
  return child;
}

class RecordingRegistry implements TunnelRegistryPort {
  added: TunnelRegistryEntry[] = [];
  removed: number[] = [];
  async add(entry: TunnelRegistryEntry): Promise<void> {
    this.added.push(entry);
  }
  async remove(pid: number): Promise<void> {
    this.removed.push(pid);
  }
  async list(): Promise<TunnelRegistryEntry[]> {
    return [];
  }
  async clear(): Promise<void> {}
}

describe('TunnelManager.parseUrl', () => {
  it('extracts a trycloudflare URL from a cloudflared log line', () => {
    const line =
      '2024-01-01T00:00:00Z INF | Your quick Tunnel has been created! Visit it at:  https://abc-def-ghi.trycloudflare.com';
    expect(TunnelManager.parseUrl(line)).toBe('https://abc-def-ghi.trycloudflare.com');
  });

  it('extracts URL when it appears in a plain line', () => {
    const line = 'https://some-tunnel-name.trycloudflare.com';
    expect(TunnelManager.parseUrl(line)).toBe('https://some-tunnel-name.trycloudflare.com');
  });

  it('returns null when no trycloudflare URL is present', () => {
    const line = '2024-01-01T00:00:00Z INF Starting tunnel';
    expect(TunnelManager.parseUrl(line)).toBeNull();
  });

  it('returns null for an http (not https) URL', () => {
    const line = 'http://abc-def.trycloudflare.com';
    expect(TunnelManager.parseUrl(line)).toBeNull();
  });

  it('returns null for a different cloudflare domain', () => {
    const line = 'https://example.cloudflare.com';
    expect(TunnelManager.parseUrl(line)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(TunnelManager.parseUrl('')).toBeNull();
  });
});

describe('TunnelManager lifecycle', () => {
  it('getUrl returns null for an unknown label', () => {
    const manager = new TunnelManager();
    expect(manager.getUrl('daemon')).toBeNull();
    expect(manager.getUrl('preview:Dev Server')).toBeNull();
  });

  it('stop is a no-op for an unknown label', () => {
    const manager = new TunnelManager();
    expect(() => manager.stop('nonexistent')).not.toThrow();
  });

  it('stopAll is a no-op when no tunnels are running', () => {
    const manager = new TunnelManager();
    expect(() => manager.stopAll()).not.toThrow();
  });
});

describe('TunnelManager.verify', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns false when no tunnel is running for the label', async () => {
    const manager = new TunnelManager();
    const result = await manager.verify('daemon');
    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns false without fetching when tunnel is not ready (DNS propagating)', async () => {
    const manager = new TunnelManager();
    (manager as any).tunnels.set('daemon', {
      process: {} as any,
      url: 'https://test.trycloudflare.com',
      ready: false,
    });

    const result = await manager.verify('daemon');
    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns true when health endpoint returns 200 with status ok', async () => {
    const manager = new TunnelManager();
    // Inject a tunnel entry via the private map
    (manager as any).tunnels.set('daemon', {
      process: {} as any,
      url: 'https://test.trycloudflare.com',
      ready: true,
    });

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok', timestamp: Date.now() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await manager.verify('daemon');
    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://test.trycloudflare.com/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns false when fetch throws a network error', async () => {
    const manager = new TunnelManager();
    (manager as any).tunnels.set('daemon', {
      process: {} as any,
      url: 'https://test.trycloudflare.com',
      ready: true,
    });

    fetchSpy.mockRejectedValue(new Error('fetch failed'));

    const result = await manager.verify('daemon');
    expect(result).toBe(false);
  });

  it('returns false when health endpoint returns non-200', async () => {
    const manager = new TunnelManager();
    (manager as any).tunnels.set('daemon', {
      process: {} as any,
      url: 'https://test.trycloudflare.com',
      ready: true,
    });

    fetchSpy.mockResolvedValue(new Response('Bad Gateway', { status: 502 }));

    const result = await manager.verify('daemon');
    expect(result).toBe(false);
  });

  it('returns false when body does not contain status ok', async () => {
    const manager = new TunnelManager();
    (manager as any).tunnels.set('daemon', {
      process: {} as any,
      url: 'https://test.trycloudflare.com',
      ready: true,
    });

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ status: 'error' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await manager.verify('daemon');
    expect(result).toBe(false);
  });

  it('caches successful result and does not re-fetch within TTL', async () => {
    const manager = new TunnelManager();
    (manager as any).tunnels.set('daemon', {
      process: {} as any,
      url: 'https://test.trycloudflare.com',
      ready: true,
    });

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const first = await manager.verify('daemon');
    expect(first).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = await manager.verify('daemon');
    expect(second).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after cache TTL expires', async () => {
    vi.useFakeTimers();
    const manager = new TunnelManager();
    (manager as any).tunnels.set('daemon', {
      process: {} as any,
      url: 'https://test.trycloudflare.com',
      ready: true,
    });

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await manager.verify('daemon');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(31_000);

    await manager.verify('daemon');
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});

describe('TunnelManager broadcast callbacks', () => {
  it('broadcasts stopped when stop() is called for a running tunnel', () => {
    const broadcast = vi.fn();
    const manager = new TunnelManager(broadcast);
    // Inject a synthetic tunnel entry
    (manager as any).tunnels.set('daemon', {
      process: { kill: vi.fn() } as any,
      url: 'https://test.trycloudflare.com',
      ready: true,
    });

    broadcast.mockClear();
    manager.stop('daemon');

    expect(broadcast).toHaveBeenCalledWith({ type: 'tunnel:status', state: 'stopped', label: 'daemon' });
  });

  it('does not broadcast when stop() is called for an unknown label', () => {
    const broadcast = vi.fn();
    const manager = new TunnelManager(broadcast);
    manager.stop('nonexistent');
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('works without a broadcast callback (no-op constructor)', () => {
    const manager = new TunnelManager();
    expect(() => manager.stop('nonexistent')).not.toThrow();
  });
});

describe('TunnelManager registry tracking', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('spawns the injected absolute cloudflared path', () => {
    const child = makeMockChild(4242);
    spawnMock.mockReturnValue(child);
    const manager = new TunnelManager(undefined, { cloudflaredPath: '/abs/bin/cloudflared' });

    manager.start(4173, 'preview:Dev').catch(() => {});

    expect(spawnMock).toHaveBeenCalledWith('/abs/bin/cloudflared', expect.any(Array), expect.any(Object));
  });

  it('records the spawned pid with its absolute binary path', () => {
    const child = makeMockChild(4242);
    spawnMock.mockReturnValue(child);
    const registry = new RecordingRegistry();
    const manager = new TunnelManager(undefined, { registry, cloudflaredPath: '/abs/bin/cloudflared' });

    manager.start(4173, 'preview:Dev').catch(() => {});

    expect(registry.added).toEqual([
      expect.objectContaining({ pid: 4242, label: 'preview:Dev', binPath: '/abs/bin/cloudflared' }),
    ]);
  });

  it('does not record when the cloudflared path is a bare name (unsafe to reap)', () => {
    const child = makeMockChild(4242);
    spawnMock.mockReturnValue(child);
    const registry = new RecordingRegistry();
    const manager = new TunnelManager(undefined, { registry }); // defaults to bare 'cloudflared'

    manager.start(4173, 'preview:Dev').catch(() => {});

    expect(spawnMock).toHaveBeenCalledWith('cloudflared', expect.any(Array), expect.any(Object));
    expect(registry.added).toEqual([]);
  });

  it('does not record when the child has no pid', () => {
    const child = makeMockChild(undefined);
    spawnMock.mockReturnValue(child);
    const registry = new RecordingRegistry();
    const manager = new TunnelManager(undefined, { registry, cloudflaredPath: '/abs/bin/cloudflared' });

    manager.start(4173, 'preview:Dev').catch(() => {});

    expect(registry.added).toEqual([]);
  });

  it('removes the pid from the registry when the tunnel process exits', () => {
    const child = makeMockChild(4242);
    spawnMock.mockReturnValue(child);
    const registry = new RecordingRegistry();
    const manager = new TunnelManager(undefined, { registry, cloudflaredPath: '/abs/bin/cloudflared' });

    manager.start(4173, 'preview:Dev').catch(() => {});
    child.emit('exit', 0);

    expect(registry.removed).toContain(4242);
  });

  it('removes the pid from the registry when stop() is called', async () => {
    const registry = new RecordingRegistry();
    const manager = new TunnelManager(undefined, { registry, cloudflaredPath: '/abs/bin/cloudflared' });
    (manager as unknown as { tunnels: Map<string, unknown> }).tunnels.set('preview:Dev', {
      process: { kill: vi.fn(), pid: 4242 },
      url: 'https://x.trycloudflare.com',
      ready: true,
    });

    manager.stop('preview:Dev');
    await Promise.resolve();

    expect(registry.removed).toContain(4242);
  });

  // stopAll is the daemon-shutdown reap path (SIGINT/SIGTERM/uncaughtException):
  // every tracked child must be SIGTERM'd and dropped from the registry, or it
  // orphans and re-parents to PID 1 (the prod incident this fix addresses).
  it('stopAll kills every running tunnel and forgets each pid', async () => {
    const registry = new RecordingRegistry();
    const manager = new TunnelManager(undefined, { registry, cloudflaredPath: '/abs/bin/cloudflared' });
    const daemonKill = vi.fn();
    const previewKill = vi.fn();
    const tunnels = (manager as unknown as { tunnels: Map<string, unknown> }).tunnels;
    tunnels.set('daemon', { process: { kill: daemonKill, pid: 100 }, url: 'https://a.trycloudflare.com', ready: true });
    tunnels.set('preview:Dev', {
      process: { kill: previewKill, pid: 200 },
      url: 'https://b.trycloudflare.com',
      ready: true,
    });

    manager.stopAll();
    await Promise.resolve();

    expect(daemonKill).toHaveBeenCalledWith('SIGTERM');
    expect(previewKill).toHaveBeenCalledWith('SIGTERM');
    expect(registry.removed).toEqual(expect.arrayContaining([100, 200]));
    expect(manager.getUrl('daemon')).toBeNull();
    expect(manager.getUrl('preview:Dev')).toBeNull();
  });

  // A child spawned but still mid-start (URL not yet parsed / connection not yet
  // registered) never enters this.tunnels, so a naive stopAll would leave it
  // running — it re-parents to PID 1 and keeps the public quick tunnel alive.
  it('stopAll kills a child still mid-start (before URL/registration) and forgets its pid', async () => {
    const child = makeMockChild(4242);
    spawnMock.mockReturnValue(child);
    const registry = new RecordingRegistry();
    const manager = new TunnelManager(undefined, { registry, cloudflaredPath: '/abs/bin/cloudflared' });

    manager.start(4173, 'preview:Dev').catch(() => {});
    // No stdout/stderr lines emitted → the tunnel is still pending.

    manager.stopAll();
    await Promise.resolve();

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(registry.removed).toContain(4242);
  });

  it('stopAll does not re-kill a child once it has finished starting', async () => {
    const child = makeMockChild(4242);
    spawnMock.mockReturnValue(child);
    const registry = new RecordingRegistry();
    const manager = new TunnelManager(undefined, { registry, cloudflaredPath: '/abs/bin/cloudflared' });

    manager.start(4173, 'preview:Dev').catch(() => {});
    child.stdout.emit('data', Buffer.from('https://abc-def.trycloudflare.com\n'));
    child.stdout.emit('data', Buffer.from('Registered tunnel connection\n'));
    await Promise.resolve();

    manager.stopAll();
    await Promise.resolve();

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});

describe('TunnelManager.start timeout interaction with DNS wait', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    resolve4Mock.mockReset().mockRejectedValue(new Error('ENOTFOUND'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the URL instead of killing an already-connected tunnel when DNS propagation outlasts the 45s start timeout', async () => {
    vi.useFakeTimers();
    const child = makeMockChild();
    spawnMock.mockReturnValue(child);
    const broadcast = vi.fn();
    const manager = new TunnelManager(broadcast);

    const startPromise = manager.start(3000, 'daemon');

    // cloudflared connects quickly (well inside the 45s start budget)
    child.stdout.emit('data', Buffer.from('https://abc-def.trycloudflare.com\n'));
    child.stdout.emit('data', Buffer.from('Registered tunnel connection\n'));
    await vi.advanceTimersByTimeAsync(0);

    // Past the 45s start timeout: the tunnel is connected, so it must NOT be killed
    // or rejected — the DNS wait (which has its own 45s timeout) still owns the outcome.
    await vi.advanceTimersByTimeAsync(45_000);
    expect(child.kill).not.toHaveBeenCalled();

    // Past the DNS wait's own timeout: the grace path resolves with the URL anyway.
    await vi.advanceTimersByTimeAsync(45_000);

    const url = await startPromise;
    expect(url).toBe('https://abc-def.trycloudflare.com');
    expect(child.kill).not.toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tunnel:status', state: 'dns_verified', dnsVerified: false }),
    );
  });
});
