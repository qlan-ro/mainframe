/**
 * resolveUrlTabTarget / composeTunnelUrl — pure tunnel-state resolution for a
 * `url` workspace tab (#281, plan Task 11's priority-ordered contract).
 */
import { describe, it, expect } from 'vitest';
import { resolveUrlTabTarget, composeTunnelUrl, type UrlTabTunnelInput } from '../resolve-url-target';
import type { PortTunnelEntry } from '../../../store/port-tunnels';

const LOOPBACK = 'http://localhost:5173/';

const input = (overrides: Partial<UrlTabTunnelInput> = {}): UrlTabTunnelInput => ({
  url: LOOPBACK,
  isLocal: false,
  daemonPort: 31415,
  entry: undefined,
  watching: false,
  startUrl: null,
  timedOut: false,
  everHadEntry: false,
  ...overrides,
});

describe('resolveUrlTabTarget — invalid input (fact 15)', () => {
  it.each(['', '   ', 'not a url'])('%s is invalid on a local daemon', (url) => {
    expect(resolveUrlTabTarget(input({ url, isLocal: true }))).toEqual({ kind: 'invalid', url });
  });

  it.each(['', '   ', 'not a url'])('%s is invalid on a remote daemon', (url) => {
    expect(resolveUrlTabTarget(input({ url, isLocal: false }))).toEqual({ kind: 'invalid', url });
  });
});

describe('resolveUrlTabTarget — direct (steps 1–2)', () => {
  it('any URL on a local daemon is direct, including a loopback URL', () => {
    expect(resolveUrlTabTarget(input({ url: LOOPBACK, isLocal: true }))).toEqual({
      kind: 'direct',
      url: LOOPBACK,
    });
    expect(resolveUrlTabTarget(input({ url: 'https://example.com/x', isLocal: true }))).toEqual({
      kind: 'direct',
      url: 'https://example.com/x',
    });
  });

  it('a non-loopback URL on a remote daemon is direct', () => {
    expect(resolveUrlTabTarget(input({ url: 'https://example.com/x' }))).toEqual({
      kind: 'direct',
      url: 'https://example.com/x',
    });
    expect(resolveUrlTabTarget(input({ url: 'http://192.168.1.5:3000/' }))).toEqual({
      kind: 'direct',
      url: 'http://192.168.1.5:3000/',
    });
  });
});

describe('resolveUrlTabTarget — daemonPort not yet known (step 3)', () => {
  it('a loopback URL with daemonPort null is pending', () => {
    expect(resolveUrlTabTarget(input({ daemonPort: null }))).toEqual({ kind: 'pending', port: 5173 });
  });
});

describe('resolveUrlTabTarget — rejected ports (step 4)', () => {
  it('a port below 1024 is rejected', () => {
    expect(resolveUrlTabTarget(input({ url: 'http://localhost:22/' }))).toEqual({
      kind: 'rejected',
      port: 22,
      reason: 'Port must be 1024 or higher',
    });
  });

  it("the daemon's own port is rejected", () => {
    expect(resolveUrlTabTarget(input({ url: 'http://localhost:31415/', daemonPort: 31415 }))).toEqual({
      kind: 'rejected',
      port: 31415,
      reason: "Cannot tunnel the daemon's own port",
    });
  });
});

describe('resolveUrlTabTarget — entry undefined (step 5)', () => {
  it('no entry yet and it never had one is pending, naming the port', () => {
    expect(resolveUrlTabTarget(input())).toEqual({ kind: 'pending', port: 5173 });
  });

  it("no entry, never had one, but this tab's own POST answered is tunnelled from startUrl", () => {
    expect(resolveUrlTabTarget(input({ startUrl: 'https://a.trycloudflare.com' }))).toEqual({
      kind: 'tunnelled',
      url: 'https://a.trycloudflare.com/',
    });
  });

  it('no entry but everHadEntry is stopped even with a startUrl on file', () => {
    expect(resolveUrlTabTarget(input({ everHadEntry: true, startUrl: null }))).toEqual({
      kind: 'stopped',
      port: 5173,
    });
    expect(resolveUrlTabTarget(input({ everHadEntry: true, startUrl: 'https://a.trycloudflare.com' }))).toEqual({
      kind: 'stopped',
      port: 5173,
    });
  });
});

describe('resolveUrlTabTarget — starting entry (step 8)', () => {
  it('a starting entry is pending', () => {
    expect(resolveUrlTabTarget(input({ entry: { state: 'starting' } }))).toEqual({
      kind: 'pending',
      port: 5173,
    });
  });
});

describe('resolveUrlTabTarget — ready entry, adopting (step 7, AC8)', () => {
  it('adopting a ready tunnel is tunnelled regardless of dnsVerified', () => {
    const entry: PortTunnelEntry = { state: 'ready', url: 'https://a.trycloudflare.com', dnsVerified: false };
    expect(resolveUrlTabTarget(input({ entry, watching: false }))).toEqual({
      kind: 'tunnelled',
      url: 'https://a.trycloudflare.com/',
    });
  });
});

describe("resolveUrlTabTarget — ready entry, watching this tab's own start (step 7)", () => {
  it('not yet dns-verified and no startUrl is pending', () => {
    const entry: PortTunnelEntry = { state: 'ready', url: 'https://a.trycloudflare.com', dnsVerified: false };
    expect(resolveUrlTabTarget(input({ entry, watching: true, startUrl: null }))).toEqual({
      kind: 'pending',
      port: 5173,
    });
  });

  it('dns-verified opens the gate to tunnelled', () => {
    const entry: PortTunnelEntry = { state: 'ready', url: 'https://a.trycloudflare.com', dnsVerified: true };
    expect(resolveUrlTabTarget(input({ entry, watching: true, startUrl: null }))).toEqual({
      kind: 'tunnelled',
      url: 'https://a.trycloudflare.com/',
    });
  });

  it("this tab's own POST answering opens the gate to tunnelled", () => {
    const entry: PortTunnelEntry = { state: 'ready', url: 'https://a.trycloudflare.com', dnsVerified: false };
    expect(resolveUrlTabTarget(input({ entry, watching: true, startUrl: 'https://a.trycloudflare.com' }))).toEqual({
      kind: 'tunnelled',
      url: 'https://a.trycloudflare.com/',
    });
  });
});

describe('resolveUrlTabTarget — error entry (step 6)', () => {
  it('an error entry with a message is failed', () => {
    expect(resolveUrlTabTarget(input({ entry: { state: 'error', error: 'boom' } }))).toEqual({
      kind: 'failed',
      error: 'boom',
    });
  });

  it('an error entry with no message falls back to a default', () => {
    expect(resolveUrlTabTarget(input({ entry: { state: 'error' } }))).toEqual({
      kind: 'failed',
      error: 'Tunnel failed to start',
    });
  });
});

describe('resolveUrlTabTarget — timeout (step 8, AC9)', () => {
  it('a timeout while still pending on a non-error, non-ready entry is failed', () => {
    expect(resolveUrlTabTarget(input({ entry: { state: 'starting' }, timedOut: true }))).toEqual({
      kind: 'failed',
      error: 'The tunnel did not produce a URL within 120 seconds',
    });
  });

  it('a URL that arrives after the timeout is non-terminal: the ready entry still wins', () => {
    const entry: PortTunnelEntry = { state: 'ready', url: 'https://a.trycloudflare.com' };
    expect(resolveUrlTabTarget(input({ entry, watching: false, timedOut: true }))).toEqual({
      kind: 'tunnelled',
      url: 'https://a.trycloudflare.com/',
    });
  });
});

describe('resolveUrlTabTarget — post-Retry inputs are all pending (PD1)', () => {
  const resetInput = input({ entry: undefined, everHadEntry: false, startUrl: null, timedOut: false });

  it('after a rejected start', () => {
    expect(resolveUrlTabTarget(resetInput)).toEqual({ kind: 'pending', port: 5173 });
  });

  it('after an externally stopped tunnel', () => {
    expect(resolveUrlTabTarget(resetInput)).toEqual({ kind: 'pending', port: 5173 });
  });

  it('after a 120s timeout whose starting entry was cleared', () => {
    expect(resolveUrlTabTarget(resetInput)).toEqual({ kind: 'pending', port: 5173 });
  });

  it('after a timeout that never had an entry', () => {
    expect(resolveUrlTabTarget(input({ entry: undefined, everHadEntry: false, timedOut: false }))).toEqual({
      kind: 'pending',
      port: 5173,
    });
  });
});

describe('composeTunnelUrl (D12)', () => {
  it('appends the path, query, and hash of the original URL to the tunnel origin', () => {
    expect(composeTunnelUrl('https://x.trycloudflare.com', 'http://localhost:5173/a/b?q=1#f')).toBe(
      'https://x.trycloudflare.com/a/b?q=1#f',
    );
  });

  it('an origin-only original URL composes to the bare tunnel origin', () => {
    expect(composeTunnelUrl('https://x.trycloudflare.com', 'http://localhost:5173/')).toBe(
      'https://x.trycloudflare.com/',
    );
  });
});
