import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TunnelManager } from '../../tunnel/tunnel-manager.js';

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

    expect(broadcast).toHaveBeenCalledWith({ type: 'tunnel:status', state: 'stopped' });
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
