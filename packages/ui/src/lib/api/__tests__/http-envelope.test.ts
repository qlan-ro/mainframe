/**
 * http-envelope.test.ts — canonical tests for the ApiResponse envelope helpers.
 *
 * `request` / `requestEmpty` / `requestNoContent` are the single unwrap/error
 * seam for every daemon REST wrapper (git, files, tags, chats, projects, …).
 * Their success-unwrap and error behaviors are pinned HERE ONCE — endpoint
 * suites test only their own URL/method/body shaping and any field extraction.
 * (The plugin-side helpers have their own canonical file: http-plugin.test.ts.)
 *
 * Behaviors covered:
 *  1.  request unwraps `data` from a {success:true, data} envelope.
 *  2.  request throws the envelope `error` when success is false (HTTP 200).
 *  3.  request throws the body `error` field on HTTP error.
 *  4.  request throws the body `message` field on HTTP error when `error` is absent.
 *  5.  request throws "HTTP <status>" when the error body is not JSON.
 *  6.  request sends bare {method} for a local GET with no body.
 *  7.  request sends Content-Type + serialized JSON body when a body is passed.
 *  8.  requestEmpty resolves void on {success:true}.
 *  9.  requestEmpty throws the envelope `error` when success is false.
 *  10. requestEmpty throws on HTTP error.
 *  11. requestNoContent resolves void on 204 without reading the body.
 *  12. requestNoContent throws on HTTP error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { request, requestEmpty, requestNoContent } from '../http';
import { setActiveDaemon } from '../../daemon/active-daemon';

const LOCAL_DAEMON = {
  id: 'local',
  kind: 'local',
  label: 'Local',
  baseUrl: 'http://127.0.0.1:31415',
  token: null,
} as const;

const URL = 'http://127.0.0.1:31415/api/things';

function mockFetch(response: { ok: boolean; status?: number; json?: () => Promise<unknown> }): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

const okJson = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  setActiveDaemon({ ...LOCAL_DAEMON });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setActiveDaemon({ ...LOCAL_DAEMON });
});

describe('request — envelope unwrap', () => {
  it('returns the `data` field unwrapped from a success envelope', async () => {
    mockFetch(okJson({ success: true, data: { id: 'x-1', values: [1, 2] } }));

    await expect(request('GET', URL)).resolves.toEqual({ id: 'x-1', values: [1, 2] });
  });

  it('throws the envelope `error` when success is false (HTTP 200)', async () => {
    mockFetch(okJson({ success: false, error: 'thing not found' }));

    await expect(request('GET', URL)).rejects.toThrow('thing not found');
  });
});

describe('request — HTTP error extraction', () => {
  it('throws the `error` field from a JSON error body', async () => {
    mockFetch({ ok: false, status: 500, json: () => Promise.resolve({ error: 'db exploded' }) });

    await expect(request('GET', URL)).rejects.toThrow('db exploded');
  });

  it('throws the `message` field when `error` is absent', async () => {
    mockFetch({ ok: false, status: 422, json: () => Promise.resolve({ message: 'validation failed' }) });

    await expect(request('POST', URL, { a: 1 })).rejects.toThrow('validation failed');
  });

  it('throws "HTTP <status>" when the error body is not JSON', async () => {
    mockFetch({ ok: false, status: 503, json: () => Promise.reject(new Error('not json')) });

    await expect(request('GET', URL)).rejects.toThrow('HTTP 503');
  });
});

describe('request — fetch init shaping', () => {
  it('sends a bare {method} init for a local GET with no body (no headers key)', async () => {
    mockFetch(okJson({ success: true, data: null }));

    await request('GET', URL);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(URL, { method: 'GET' });
  });

  it('sends Content-Type and the serialized JSON body when a body is passed', async () => {
    mockFetch(okJson({ success: true, data: null }));

    await request('POST', URL, { name: 'new thing', count: 2 });

    expect(fetch).toHaveBeenCalledWith(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":"new thing","count":2}',
    });
  });
});

describe('requestEmpty', () => {
  it('resolves void on a {success:true} envelope with no data', async () => {
    mockFetch(okJson({ success: true }));

    await expect(requestEmpty('POST', URL, {})).resolves.toBeUndefined();
  });

  it('throws the envelope `error` when success is false', async () => {
    mockFetch(okJson({ success: false, error: 'operation rejected' }));

    await expect(requestEmpty('POST', URL, {})).rejects.toThrow('operation rejected');
  });

  it('throws the extracted error on HTTP error', async () => {
    mockFetch({ ok: false, status: 409, json: () => Promise.resolve({ error: 'conflict' }) });

    await expect(requestEmpty('POST', URL, {})).rejects.toThrow('conflict');
  });
});

describe('requestNoContent', () => {
  it('resolves void on 204 without reading the body', async () => {
    const jsonSpy = vi.fn().mockRejectedValue(new Error('no body'));
    mockFetch({ ok: true, status: 204, json: jsonSpy });

    await expect(requestNoContent('DELETE', URL)).resolves.toBeUndefined();
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it('throws the extracted error on HTTP error', async () => {
    mockFetch({ ok: false, status: 404, json: () => Promise.resolve({ error: 'missing' }) });

    await expect(requestNoContent('DELETE', URL)).rejects.toThrow('missing');
  });
});
