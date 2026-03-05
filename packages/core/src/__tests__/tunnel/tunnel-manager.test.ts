import { describe, it, expect } from 'vitest';
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
