/**
 * http.request — auth-failure marking on REST calls (task 8, todo #219).
 *
 * `../../daemon/auth-failure-store` is replaced with a tiny real Set-backed
 * fake (not the production module, which doesn't exist yet) so `hasAuthFailure`
 * reflects genuine mark/clear calls rather than always reporting a mocked
 * default. Today `request()` never calls mark/clear at all, so the marking
 * and clearing assertions below are the genuine red; the "never marks" /
 * "unaffected" ones already hold and guard against regressions once task 11
 * wires the calls in.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActiveDaemon } from '../../daemon/active-daemon';
import { request, apiBase, ApiRequestError } from '../http';

const { authFailureIds, hasAuthFailure } = vi.hoisted(() => {
  const authFailureIds = new Set<string>();
  return { authFailureIds, hasAuthFailure: (id: string) => authFailureIds.has(id) };
});

vi.mock('../../daemon/auth-failure-store', () => ({
  markAuthFailure: (id: string) => {
    authFailureIds.add(id);
  },
  clearAuthFailure: (id: string) => {
    authFailureIds.delete(id);
  },
  hasAuthFailure,
  subscribeAuthFailures: () => () => {},
}));

const REMOTE = { id: 'studio', kind: 'remote' as const, label: 'S', baseUrl: 'https://studio.example.com', token: 't' };
const LOCAL = { id: 'local', kind: 'local' as const, label: 'L', baseUrl: 'http://127.0.0.1:31500', token: null };

function mockFetchOnce(status: number, body: unknown = { success: false, error: 'nope' }): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  authFailureIds.clear();
});

describe('http auth-failure marking', () => {
  it('a remote 401 marks the active daemon id and still rejects with ApiRequestError', async () => {
    setActiveDaemon(REMOTE);
    mockFetchOnce(401);

    await expect(request('GET', apiBase() + '/api/projects')).rejects.toBeInstanceOf(ApiRequestError);
    expect(hasAuthFailure('studio')).toBe(true);
  });

  it('a remote 403 marks the active daemon id and still rejects with ApiRequestError', async () => {
    setActiveDaemon(REMOTE);
    mockFetchOnce(403);

    await expect(request('GET', apiBase() + '/api/projects')).rejects.toBeInstanceOf(ApiRequestError);
    expect(hasAuthFailure('studio')).toBe(true);
  });

  it('a local 401 never marks (loopback-trusted, no re-pair concept)', async () => {
    setActiveDaemon(LOCAL);
    mockFetchOnce(401);

    await expect(request('GET', apiBase() + '/api/projects')).rejects.toBeInstanceOf(ApiRequestError);
    expect(hasAuthFailure('local')).toBe(false);
  });

  it('a remote 500 leaves an existing marker untouched and still rejects', async () => {
    setActiveDaemon(REMOTE);
    authFailureIds.add('studio');
    mockFetchOnce(500);

    await expect(request('GET', apiBase() + '/api/projects')).rejects.toBeInstanceOf(ApiRequestError);
    expect(hasAuthFailure('studio')).toBe(true);
  });

  it('a remote 500 leaves the absence of a marker untouched and still rejects', async () => {
    setActiveDaemon(REMOTE);
    mockFetchOnce(500);

    await expect(request('GET', apiBase() + '/api/projects')).rejects.toBeInstanceOf(ApiRequestError);
    expect(hasAuthFailure('studio')).toBe(false);
  });

  it('a successful remote 200 clears a previously-set marker', async () => {
    setActiveDaemon(REMOTE);
    authFailureIds.add('studio');
    mockFetchOnce(200, { success: true, data: [] });

    await request('GET', apiBase() + '/api/projects');
    expect(hasAuthFailure('studio')).toBe(false);
  });
});
