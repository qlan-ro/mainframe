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
const REMOTE_B = {
  id: 'gamma',
  kind: 'remote' as const,
  label: 'G',
  baseUrl: 'https://gamma.example.com',
  token: 't2',
};
const LOCAL = { id: 'local', kind: 'local' as const, label: 'L', baseUrl: 'http://127.0.0.1:31500', token: null };

function mockFetchOnce(status: number, body: unknown = { success: false, error: 'nope' }): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

function deferredFetch(): { resolve: (status: number, body?: unknown) => void } {
  let resolveFetch!: (res: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });
  vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(pending);
  return {
    resolve: (status, body = { success: false, error: 'nope' }) =>
      resolveFetch(new Response(JSON.stringify(body), { status })),
  };
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

  it('a remote 403 is application policy, not a credential problem — leaves the marker untouched', async () => {
    setActiveDaemon(REMOTE);
    mockFetchOnce(403);

    await expect(request('GET', apiBase() + '/api/projects')).rejects.toBeInstanceOf(ApiRequestError);
    expect(hasAuthFailure('studio')).toBe(false);
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

  it('a delayed 401 marks the daemon that was active when the request was sent, not whatever became active meanwhile', async () => {
    setActiveDaemon(REMOTE);
    const deferred = deferredFetch();

    const pending = request('GET', apiBase() + '/api/projects');
    setActiveDaemon(REMOTE_B); // switch mid-flight, before the response lands
    deferred.resolve(401);

    await expect(pending).rejects.toBeInstanceOf(ApiRequestError);
    expect(hasAuthFailure('studio')).toBe(true);
    expect(hasAuthFailure('gamma')).toBe(false);
  });

  it('a delayed success clears the marker of the daemon that sent the request, not the one now active', async () => {
    setActiveDaemon(REMOTE);
    authFailureIds.add('studio');
    authFailureIds.add('gamma');
    const deferred = deferredFetch();

    const pending = request('GET', apiBase() + '/api/projects');
    setActiveDaemon(REMOTE_B); // switch mid-flight, before the response lands
    deferred.resolve(200, { success: true, data: [] });

    await pending;
    expect(hasAuthFailure('studio')).toBe(false);
    expect(hasAuthFailure('gamma')).toBe(true);
  });

  it('a delayed 401 still marks the originating remote daemon even after switching to local mid-flight', async () => {
    setActiveDaemon(REMOTE);
    const deferred = deferredFetch();

    const pending = request('GET', apiBase() + '/api/projects');
    setActiveDaemon(LOCAL); // switch mid-flight, before the response lands
    deferred.resolve(401);

    await expect(pending).rejects.toBeInstanceOf(ApiRequestError);
    expect(hasAuthFailure('studio')).toBe(true);
  });
});
