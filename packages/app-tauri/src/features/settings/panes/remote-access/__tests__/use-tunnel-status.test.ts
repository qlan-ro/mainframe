import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTunnelStatus } from '../use-tunnel-status';

let emit: (e: unknown) => void = () => {};
const getTunnelStatus = vi.fn();
const startTunnel = vi.fn();
const stopTunnel = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../../../lib/daemon/ws-client', () => ({
  daemonWs: {
    onEvent: (h: (e: unknown) => void) => {
      emit = h;
      return () => {};
    },
  },
}));
vi.mock('../../../../../lib/api/remote-access', () => ({
  getTunnelStatus: (...a: unknown[]) => getTunnelStatus(...a),
  startTunnel: (...a: unknown[]) => startTunnel(...a),
  stopTunnel: (...a: unknown[]) => stopTunnel(...a),
}));

const PORT = 31415;
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  getTunnelStatus.mockResolvedValue({ running: false, url: null, verified: false });
  startTunnel.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('use-tunnel-status', () => {
  it('seeds idle from the REST snapshot when not running', async () => {
    const { result } = renderHook(() => useTunnelStatus(PORT));
    await flush();
    expect(result.current.state).toBe('idle');
    expect(result.current.loading).toBe(false);
  });
  it('REST snapshot: url present but unverified → unreachable', async () => {
    getTunnelStatus.mockResolvedValue({ running: true, url: 'https://x', verified: false });
    const { result } = renderHook(() => useTunnelStatus(PORT));
    await flush();
    expect(result.current.state).toBe('unreachable');
  });
  it('REST snapshot: verified → ready', async () => {
    getTunnelStatus.mockResolvedValue({ running: true, url: 'https://x', verified: true });
    const { result } = renderHook(() => useTunnelStatus(PORT));
    await flush();
    expect(result.current.state).toBe('ready');
    expect(result.current.verified).toBe(true);
  });
  it('WS starting → ready(verifying) → dns_verified(true → ready)', async () => {
    const { result } = renderHook(() => useTunnelStatus(PORT));
    await flush();
    act(() => emit({ type: 'tunnel:status', state: 'starting', label: 'daemon' }));
    expect(result.current.state).toBe('starting');
    act(() => emit({ type: 'tunnel:status', state: 'ready', label: 'daemon', url: 'https://x' }));
    expect(result.current.state).toBe('verifying');
    expect(result.current.url).toBe('https://x');
    act(() =>
      emit({ type: 'tunnel:status', state: 'dns_verified', label: 'daemon', url: 'https://x', dnsVerified: true }),
    );
    expect(result.current.state).toBe('ready');
  });
  it('WS dns_verified(false) → unreachable', async () => {
    const { result } = renderHook(() => useTunnelStatus(PORT));
    await flush();
    act(() =>
      emit({ type: 'tunnel:status', state: 'dns_verified', label: 'daemon', url: 'https://x', dnsVerified: false }),
    );
    expect(result.current.state).toBe('unreachable');
  });
  it('WS error sets error state + message and clears url', async () => {
    getTunnelStatus.mockResolvedValue({ running: true, url: 'https://x', verified: false });
    const { result } = renderHook(() => useTunnelStatus(PORT));
    await flush();
    expect(result.current.url).toBe('https://x'); // seeded unreachable, url present
    act(() => emit({ type: 'tunnel:status', state: 'error', label: 'daemon', error: 'boom' }));
    expect(result.current.state).toBe('error');
    expect(result.current.errorMsg).toBe('boom');
    expect(result.current.url).toBeNull(); // error clears url
  });
  it('WS stopped → idle and clears url', async () => {
    getTunnelStatus.mockResolvedValue({ running: true, url: 'https://x', verified: true });
    const { result } = renderHook(() => useTunnelStatus(PORT));
    await flush();
    expect(result.current.url).toBe('https://x'); // seeded ready, url present
    act(() => emit({ type: 'tunnel:status', state: 'stopped', label: 'daemon' }));
    expect(result.current.state).toBe('idle');
    expect(result.current.url).toBeNull(); // stopped clears url
  });
  it('retryVerify() goes verifying then converges via refresh', async () => {
    getTunnelStatus
      .mockResolvedValueOnce({ running: true, url: 'https://x', verified: false })
      .mockResolvedValueOnce({ running: true, url: 'https://x', verified: true });
    const { result } = renderHook(() => useTunnelStatus(PORT));
    await flush();
    expect(result.current.state).toBe('unreachable');
    await act(async () => {
      await result.current.retryVerify();
    });
    expect(getTunnelStatus).toHaveBeenCalledTimes(2); // initial seed + retry refresh
    expect(result.current.state).toBe('ready');
  });
  it('ignores events for a different label', async () => {
    const { result } = renderHook(() => useTunnelStatus(PORT));
    await flush();
    act(() => emit({ type: 'tunnel:status', state: 'error', label: 'other', error: 'x' }));
    expect(result.current.state).toBe('idle');
  });
  it('start() optimistically goes starting then converges via refresh', async () => {
    startTunnel.mockResolvedValue({ url: 'https://x' });
    getTunnelStatus
      .mockResolvedValueOnce({ running: false, url: null, verified: false })
      .mockResolvedValueOnce({ running: true, url: 'https://x', verified: true });
    const { result } = renderHook(() => useTunnelStatus(PORT));
    await flush();
    await act(async () => {
      await result.current.start({ token: 't', url: 'https://x' });
    });
    expect(startTunnel).toHaveBeenCalledWith(PORT, { token: 't', url: 'https://x' });
    expect(result.current.state).toBe('ready');
  });
  it('start() failure → error state', async () => {
    startTunnel.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useTunnelStatus(PORT));
    await flush();
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe('error');
    expect(result.current.errorMsg).toBe('nope');
  });
  it('stop() returns to idle', async () => {
    getTunnelStatus.mockResolvedValue({ running: true, url: 'https://x', verified: true });
    const { result } = renderHook(() => useTunnelStatus(PORT));
    await flush();
    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.state).toBe('idle');
  });
});
