import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTunnelStatus,
  startTunnel,
  stopTunnel,
  getTunnelConfig,
  generatePairingCode,
  getDevices,
  removeDevice,
} from '../remote-access';

function mockFetchOk(data: unknown) {
  const fn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true, data }) });
  vi.stubGlobal('fetch', fn);
  return fn;
}
function mockFetchEmpty() {
  const fn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) });
  vi.stubGlobal('fetch', fn);
  return fn;
}
const PORT = 31415;
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe('remote-access api', () => {
  it('getTunnelStatus GETs /api/tunnel/status', async () => {
    mockFetchOk({ running: true, url: 'https://x', verified: true });
    expect(await getTunnelStatus(PORT)).toEqual({ running: true, url: 'https://x', verified: true });
  });
  it('startTunnel POSTs /api/tunnel/start with config and returns url', async () => {
    const fn = mockFetchOk({ url: 'https://x' });
    const out = await startTunnel(PORT, { token: 't', url: 'https://x' });
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:31415/api/tunnel/start');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ token: 't', url: 'https://x' });
    expect(out).toEqual({ url: 'https://x' });
  });
  it('stopTunnel POSTs /api/tunnel/stop with opts', async () => {
    const fn = mockFetchEmpty();
    await stopTunnel(PORT, { clearConfig: true });
    expect(JSON.parse(fn.mock.calls[0]![1].body)).toEqual({ clearConfig: true });
  });
  it('getTunnelConfig GETs /api/tunnel/config', async () => {
    mockFetchOk({ hasToken: true, url: 'https://x' });
    expect((await getTunnelConfig(PORT)).hasToken).toBe(true);
  });
  it('generatePairingCode POSTs /api/auth/pair', async () => {
    mockFetchOk({ pairingCode: 'ABC123' });
    expect((await generatePairingCode(PORT)).pairingCode).toBe('ABC123');
  });
  it('getDevices GETs /api/auth/devices', async () => {
    mockFetchOk([{ deviceId: 'd1', deviceName: 'iPhone', createdAt: 'x', lastSeen: null }]);
    expect((await getDevices(PORT))[0]!.deviceId).toBe('d1');
  });
  it('removeDevice DELETEs and uses the JSON-envelope path (not 204)', async () => {
    const fn = mockFetchEmpty();
    await removeDevice(PORT, 'd1');
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:31415/api/auth/devices/d1');
    expect(init.method).toBe('DELETE');
  });
});
