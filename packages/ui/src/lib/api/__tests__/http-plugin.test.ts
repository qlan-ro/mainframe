/**
 * http-plugin.test.ts
 *
 * Behaviors covered:
 *  1.  requestPlugin returns the parsed JSON body typed as T (raw, not an envelope).
 *  2.  requestPlugin sends Content-Type: application/json + serialized body for POST.
 *  3.  requestPlugin sends no body for GET.
 *  4.  requestPlugin throws with the server-provided error message on HTTP error (json body).
 *  5.  requestPlugin throws "HTTP <status>" when the error body is not JSON.
 *  6.  requestPlugin throws the `message` field when `error` is absent.
 *  7.  requestPluginNoContent resolves void on HTTP 204.
 *  8.  requestPluginNoContent throws on HTTP error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requestPlugin, requestPluginNoContent, expectField } from '../http';
import { setActiveDaemon } from '../../daemon/active-daemon';

const LOCAL_DAEMON = {
  id: 'local',
  kind: 'local',
  label: 'Local',
  baseUrl: 'http://127.0.0.1:31415',
  token: null,
} as const;

// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetchOkJson(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(body),
    }),
  );
}

function mockFetchHttpError(status: number, jsonBody: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: () => Promise.resolve(jsonBody),
    }),
  );
}

function mockFetchHttpErrorNonJson(status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: () => Promise.reject(new Error('SyntaxError: JSON.parse')),
    }),
  );
}

function mockFetchNoContent(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    }),
  );
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  setActiveDaemon({ ...LOCAL_DAEMON });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setActiveDaemon({ ...LOCAL_DAEMON });
});

// ---------------------------------------------------------------------------
// requestPlugin — success paths
// ---------------------------------------------------------------------------

describe('requestPlugin — returns raw JSON body as T', () => {
  it('extracts the raw response body without unwrapping an ApiResponse envelope', async () => {
    mockFetchOkJson({ todos: [{ id: 'todo-1', title: 'Fix bug' }] });

    const result = await requestPlugin<{ todos: Array<{ id: string; title: string }> }>(
      'GET',
      'http://127.0.0.1:31415/api/plugins/todos/todos?projectId=proj-1',
    );

    expect(result).toEqual({ todos: [{ id: 'todo-1', title: 'Fix bug' }] });
  });

  it('calls fetch with GET and no body when no body arg is passed', async () => {
    mockFetchOkJson({ todos: [] });

    await requestPlugin('GET', 'http://127.0.0.1:31415/api/plugins/todos/todos?projectId=p1');

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/plugins/todos/todos?projectId=p1', {
      method: 'GET',
    });
  });

  it('calls fetch with Content-Type and serialized body when a body arg is passed', async () => {
    mockFetchOkJson({ todo: { id: 'todo-1', title: 'New task' } });

    await requestPlugin('POST', 'http://127.0.0.1:31415/api/plugins/todos/todos', {
      title: 'New task',
      status: 'open',
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/plugins/todos/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"title":"New task","status":"open"}',
    });
  });
});

// ---------------------------------------------------------------------------
// requestPlugin — error paths
// ---------------------------------------------------------------------------

describe('requestPlugin — throws on HTTP error', () => {
  it('throws with the `error` field from the JSON error body', async () => {
    mockFetchHttpError(400, { error: 'projectId is required' });

    await expect(requestPlugin('GET', 'http://127.0.0.1:31415/api/plugins/todos/todos')).rejects.toThrow(
      'projectId is required',
    );
  });

  it('throws with the `message` field when `error` is absent', async () => {
    mockFetchHttpError(422, { message: 'validation failed' });

    await expect(
      requestPlugin('POST', 'http://127.0.0.1:31415/api/plugins/todos/todos', { title: '' }),
    ).rejects.toThrow('validation failed');
  });

  it('throws "HTTP <status>" when the error body is not JSON', async () => {
    mockFetchHttpErrorNonJson(503);

    await expect(requestPlugin('GET', 'http://127.0.0.1:31415/api/plugins/todos/todos')).rejects.toThrow('HTTP 503');
  });
});

// ---------------------------------------------------------------------------
// requestPluginNoContent
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// expectField — field extraction helper
// ---------------------------------------------------------------------------

describe('expectField — throws when field is missing', () => {
  it('throws with a clear message when the key is absent', () => {
    expect(() => expectField({ todo: { id: '1' } }, 'todos')).toThrow('Plugin response missing field "todos"');
  });

  it('returns the field value when present', () => {
    expect(expectField({ todos: [{ id: '1' }] }, 'todos')).toEqual([{ id: '1' }]);
  });

  it('throws when body is null', () => {
    expect(() => expectField(null, 'todos')).toThrow('Plugin response missing field "todos"');
  });

  it('throws when the field value is undefined', () => {
    expect(() => expectField({ todos: undefined }, 'todos')).toThrow('Plugin response missing field "todos"');
  });

  it('does not throw for a falsy-but-present field value like an empty array', () => {
    expect(expectField({ todos: [] }, 'todos')).toEqual([]);
  });
});

describe('requestPluginNoContent — resolves void on 204', () => {
  it('returns undefined (void) when the response is 204', async () => {
    mockFetchNoContent();

    const result = await requestPluginNoContent('DELETE', 'http://127.0.0.1:31415/api/plugins/todos/todos/todo-1');

    expect(result).toBeUndefined();
  });

  it('calls fetch with DELETE and no body', async () => {
    mockFetchNoContent();

    await requestPluginNoContent('DELETE', 'http://127.0.0.1:31415/api/plugins/todos/todos/todo-1');

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/plugins/todos/todos/todo-1', {
      method: 'DELETE',
      headers: {},
    });
  });

  it('throws on HTTP error response', async () => {
    mockFetchHttpError(404, { error: 'todo not found' });

    await expect(
      requestPluginNoContent('DELETE', 'http://127.0.0.1:31415/api/plugins/todos/todos/missing'),
    ).rejects.toThrow('todo not found');
  });
});
