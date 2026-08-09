/**
 * applyPairing — what the registry entry records about the endpoint.
 *
 * Behaviors covered:
 *  1. add-mode persists the scheme the daemon was paired with, so the entry can
 *     be rebuilt into the same origin later (todo #305).
 *  2. an http loopback pairing is canonicalized to 127.0.0.1, the one loopback
 *     host the webview CSP admits.
 *  3. an https host is stored verbatim — rewriting it would break TLS hostname
 *     verification.
 *  4. repair-mode still writes no meta and swaps the token in place.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DaemonMeta } from '@qlan-ro/mainframe-types';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { setHostForTesting, resetHostForTesting } from '@/lib/host';
import { applyPairing } from '../apply-pairing';

let fakeHost: FakeHostBridge;
const add = vi.fn<(meta: DaemonMeta, token: string) => Promise<void>>();
const retoken = vi.fn<(id: string) => Promise<void>>();

beforeEach(() => {
  fakeHost = new FakeHostBridge();
  setHostForTesting(fakeHost);
  add.mockResolvedValue(undefined);
  retoken.mockResolvedValue(undefined);
});

afterEach(() => {
  resetHostForTesting();
  vi.clearAllMocks();
});

async function pair(targetUrl: string): Promise<DaemonMeta> {
  await applyPairing({
    mode: 'add',
    targetUrl,
    device: 'This Mac',
    token: 'jwt-abc',
    registry: { add, retoken },
  });
  const meta = add.mock.calls[0]?.[0];
  expect(meta).toBeDefined();
  return meta as DaemonMeta;
}

describe('applyPairing — add mode', () => {
  it('persists an http loopback pairing as 127.0.0.1 with scheme http', async () => {
    const meta = await pair('http://localhost:31500');

    expect(meta.host).toBe('127.0.0.1:31500');
    expect(meta.scheme).toBe('http');
  });

  it('persists a 127.0.0.1 pairing unchanged', async () => {
    const meta = await pair('http://127.0.0.1:31500');

    expect(meta.host).toBe('127.0.0.1:31500');
    expect(meta.scheme).toBe('http');
  });

  it('persists an https pairing with scheme https', async () => {
    const meta = await pair('https://tunnel.example.com');

    expect(meta.host).toBe('tunnel.example.com');
    expect(meta.scheme).toBe('https');
  });

  it('keeps a localhost host under https — rewriting it would break TLS verification', async () => {
    const meta = await pair('https://localhost:8443');

    expect(meta.host).toBe('localhost:8443');
    expect(meta.scheme).toBe('https');
  });

  it('stores the token against the new entry and reports its id', async () => {
    const result = await applyPairing({
      mode: 'add',
      targetUrl: 'https://tunnel.example.com',
      device: 'This Mac',
      token: 'jwt-abc',
      registry: { add, retoken },
    });

    const meta = add.mock.calls[0]?.[0] as DaemonMeta;
    expect(add).toHaveBeenCalledWith(meta, 'jwt-abc');
    expect(result.addedId).toBe(meta.id);
  });
});

describe('applyPairing — repair mode', () => {
  const TARGET: DaemonMeta = {
    id: 'qa-daemon',
    kind: 'remote',
    label: 'QA daemon',
    host: '127.0.0.1:31500',
    scheme: 'http',
  };

  it('writes no new meta and swaps the token in place', async () => {
    const setToken = vi.spyOn(fakeHost.daemons, 'setToken');

    const result = await applyPairing({
      mode: 'repair',
      target: TARGET,
      targetUrl: 'http://127.0.0.1:31500',
      device: 'This Mac',
      token: 'jwt-repaired',
      registry: { add, retoken },
    });

    expect(add).not.toHaveBeenCalled();
    expect(setToken).toHaveBeenCalledWith(TARGET.id, 'jwt-repaired');
    expect(retoken).toHaveBeenCalledWith(TARGET.id);
    expect(result.addedId).toBeUndefined();
  });
});
