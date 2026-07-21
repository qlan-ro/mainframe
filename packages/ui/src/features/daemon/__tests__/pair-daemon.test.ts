/**
 * pair-daemon — TDD test.
 *
 * Behaviors covered:
 *  1. verifyDaemon returns ok:true with parsed version on a 200 /health response.
 *  2. verifyDaemon returns ok:false on a network error (no throw).
 *  3. confirmPairing returns { token, deviceId } on a 200 success envelope.
 *  4. confirmPairing throws PairingError('invalid') on a 401 response.
 *  5. confirmPairing body carries a stable clientDeviceId (same UUID across two calls).
 *  6. getOrCreateClientDeviceId returns a valid UUID and persists it in localStorage.
 *  7. Trailing slash on the URL is trimmed before appending paths.
 *  8. parseRemoteUrl normalizes any user-typed URL into { host, baseUrl }
 *     (table-driven across the 6 equality cases; the throw case stays its
 *     own it — folding it into the table would need a conditional assert).
 *  9. verifyDaemon with a no-scheme input fetches the correct absolute URL.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { verifyDaemon, confirmPairing, getOrCreateClientDeviceId, PairingError, parseRemoteUrl } from '../pair-daemon';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Setup — clear localStorage and reset the fetch mock before every test
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Behavior 1 — verifyDaemon: 200 /health → ok:true with version and ms
// ---------------------------------------------------------------------------

describe('verifyDaemon', () => {
  it('returns ok:true and the parsed version on a 200 /health', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeResponse({ version: '1.2.3' }, 200));

    const result = await verifyDaemon('https://daemon.example.com');

    expect(result.ok).toBe(true);
    expect(result.version).toBe('1.2.3');
    expect(typeof result.ms).toBe('number');
  });

  it('returns ok:true even when the body has no version field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeResponse({}, 200));

    const result = await verifyDaemon('https://daemon.example.com');

    expect(result.ok).toBe(true);
    expect(result.version).toBeUndefined();
  });

  it('returns ok:false on a network error without throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network failure'));

    const result = await verifyDaemon('https://daemon.example.com');

    expect(result.ok).toBe(false);
    expect(result.version).toBeUndefined();
    expect(result.ms).toBeUndefined();
  });

  it('trims a trailing slash before hitting /health', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeResponse({}, 200));

    await verifyDaemon('https://daemon.example.com/');

    expect(spy).toHaveBeenCalledWith('https://daemon.example.com/health', expect.any(Object));
  });
});

// ---------------------------------------------------------------------------
// Behavior 2 — confirmPairing: 200 envelope → { token, deviceId }
// ---------------------------------------------------------------------------

describe('confirmPairing', () => {
  it('returns token and deviceId from the success envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeResponse({ success: true, data: { token: 'tok-abc', deviceId: 'dev-123' } }, 200),
    );

    const result = await confirmPairing('https://daemon.example.com', 'ABCDEF', 'Test Device');

    expect(result.token).toBe('tok-abc');
    expect(result.deviceId).toBe('dev-123');
  });

  it('throws PairingError("invalid") on a 401 response', async () => {
    // Two calls below — provide two mock responses.
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeResponse({ success: false, error: 'Bad code' }, 401))
      .mockResolvedValueOnce(makeResponse({ success: false, error: 'Bad code' }, 401));

    await expect(confirmPairing('https://daemon.example.com', 'BADCOD', 'Test Device')).rejects.toThrow(PairingError);

    await expect(confirmPairing('https://daemon.example.com', 'BADCOD', 'Test Device')).rejects.toMatchObject({
      kind: 'invalid',
    });
  });

  it('throws PairingError("network") on a fetch rejection', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('socket hang up'));

    await expect(confirmPairing('https://daemon.example.com', 'ABCDEF', 'Test Device')).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('sends a stable clientDeviceId (same UUID) across two separate calls', async () => {
    const capturedBodies: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      capturedBodies.push(init?.body as string);
      return Promise.resolve(makeResponse({ success: true, data: { token: 'tok-abc', deviceId: 'dev-123' } }, 200));
    });

    await confirmPairing('https://daemon.example.com', 'ABCDEF', 'Test Device');
    await confirmPairing('https://daemon.example.com', 'ABCDEF', 'Test Device');

    expect(capturedBodies).toHaveLength(2);

    const body1 = JSON.parse(capturedBodies[0]!) as { clientDeviceId: string };
    const body2 = JSON.parse(capturedBodies[1]!) as { clientDeviceId: string };

    expect(body1.clientDeviceId).toBe(body2.clientDeviceId);
    expect(body1.clientDeviceId).toMatch(UUID_RE);
  });

  it('trims a trailing slash before hitting /api/auth/confirm', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeResponse({ success: true, data: { token: 'tok-abc', deviceId: 'dev-123' } }, 200));

    await confirmPairing('https://daemon.example.com/', 'ABCDEF', 'Test Device');

    expect(spy).toHaveBeenCalledWith('https://daemon.example.com/api/auth/confirm', expect.any(Object));
  });
});

// ---------------------------------------------------------------------------
// Behavior 3 — getOrCreateClientDeviceId: stable, UUID-shaped, persisted
// ---------------------------------------------------------------------------

describe('getOrCreateClientDeviceId', () => {
  it('returns a valid UUID string', () => {
    const id = getOrCreateClientDeviceId();
    expect(id).toMatch(UUID_RE);
  });

  it('returns the same value on repeated calls', () => {
    const first = getOrCreateClientDeviceId();
    const second = getOrCreateClientDeviceId();
    expect(first).toBe(second);
  });

  it('persists the value in localStorage under mf:client-device-id', () => {
    const id = getOrCreateClientDeviceId();
    expect(localStorage.getItem('mf:client-device-id')).toBe(id);
  });

  it('reads the persisted value on a subsequent call (no new UUID generated)', () => {
    const stored = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    localStorage.setItem('mf:client-device-id', stored);

    const id = getOrCreateClientDeviceId();
    expect(id).toBe(stored);
  });
});

// ---------------------------------------------------------------------------
// Behavior 8 — parseRemoteUrl: normalizes user-typed URLs into { host, baseUrl }
// ---------------------------------------------------------------------------

describe('parseRemoteUrl', () => {
  it.each([
    [
      'no scheme → prepends https:// and returns bare host',
      'tunnel.example.com',
      { host: 'tunnel.example.com', baseUrl: 'https://tunnel.example.com' },
    ],
    [
      'preserves an explicit http:// scheme (no forced upgrade to https)',
      'http://h:31600',
      { host: 'h:31600', baseUrl: 'http://h:31600' },
    ],
    ['strips a trailing slash from https://h/', 'https://h/', { host: 'h', baseUrl: 'https://h' }],
    [
      'strips a path suffix from https://h/path — baseUrl carries only origin',
      'https://h/path',
      { host: 'h', baseUrl: 'https://h' },
    ],
    ['handles a bare host:port with no scheme', 'h:8443', { host: 'h:8443', baseUrl: 'https://h:8443' }],
    // The URL API considers 443 the default for https and omits it from host/origin.
    [
      'normalizes a full https URL, stripping the default https port 443',
      'https://studio.example.com:443',
      { host: 'studio.example.com', baseUrl: 'https://studio.example.com' },
    ],
  ] as const)('%s', (_label, input, expected) => {
    expect(parseRemoteUrl(input)).toEqual(expected);
  });

  it('throws on an input that cannot be parsed as a URL', () => {
    expect(() => parseRemoteUrl('not a url ##')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Behavior 9 — verifyDaemon: no-scheme input hits the correct absolute URL
// ---------------------------------------------------------------------------

describe('verifyDaemon — no-scheme input', () => {
  it('fetches an absolute URL even when the input has no scheme', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeResponse({ version: '2.0.0' }, 200));

    const result = await verifyDaemon('tunnel.example.com');

    expect(result.ok).toBe(true);
    // Must NOT be a relative URL resolved against app origin — must be absolute.
    const fetchedUrl = spy.mock.calls[0]?.[0] as string;
    expect(fetchedUrl).toBe('https://tunnel.example.com/health');
  });
});
