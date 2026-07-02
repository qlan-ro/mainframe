/**
 * Minimal HTTP helpers for the daemon REST API.
 *
 * `apiBase` returns the active daemon's baseUrl. The `port` argument is
 * accepted for call-site compatibility but ignored — the active daemon
 * target owns the base URL (local or remote tunnel).
 */
import type { ApiResponse, ApiResponseEmpty } from '@qlan-ro/mainframe-types';
import { getActiveDaemon } from '../daemon/active-daemon';

export function apiBase(_port?: number): string {
  return getActiveDaemon().baseUrl;
}

/**
 * Bearer auth header for the active daemon. Empty for a local (loopback-trusted)
 * target; `{ Authorization: 'Bearer <token>' }` for a remote one. Exported so
 * raw-`fetch` call sites that can't use the `request*` wrappers (e.g.
 * `createProject`, which treats 409 as success) still carry auth.
 */
export function authHeaders(): Record<string, string> {
  const { token } = getActiveDaemon();
  return token !== null ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Build the fetch init. The `headers` key is attached ONLY when there is a
 * header to send (auth token and/or Content-Type), so a local no-body request
 * stays byte-for-byte identical to the loopback-trusted call (no empty headers
 * object). Remote adds Authorization; a JSON body adds Content-Type.
 */
function fetchInit(method: string, body?: unknown): RequestInit {
  const headers = { ...authHeaders(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) };
  const init: RequestInit = { method };
  if (Object.keys(headers).length > 0) init.headers = headers;
  if (body !== undefined) init.body = JSON.stringify(body);
  return init;
}

async function extractError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string; message?: string };
    if (typeof data.error === 'string') return data.error;
    if (typeof data.message === 'string') return data.message;
  } catch {
    /* not JSON */
  }
  return `HTTP ${res.status}`;
}

/** Fetch, unwrap the `ApiResponse<T>` envelope, and return `data`. Throws on HTTP or API error. */
export async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, fetchInit(method, body));
  if (!res.ok) throw new Error(await extractError(res));
  const json = (await res.json()) as ApiResponse<T>;
  if (!json.success) throw new Error(json.error);
  return json.data;
}

/** Like `request` but for routes that return `okEmpty` (no `data`). */
export async function requestEmpty(method: string, url: string, body?: unknown): Promise<void> {
  const res = await fetch(url, fetchInit(method, body));
  if (!res.ok) throw new Error(await extractError(res));
  const json = (await res.json()) as ApiResponseEmpty;
  if (!json.success) throw new Error(json.error);
}

/** For routes that return HTTP 204 with no body (e.g. DELETE /api/tags/:name). */
export async function requestNoContent(method: string, url: string): Promise<void> {
  const res = await fetch(url, fetchInit(method));
  if (!res.ok) throw new Error(await extractError(res));
}

/**
 * For builtin-plugin routes that return RAW JSON bodies (e.g. `{ todos }`),
 * NOT the `ApiResponse<T>` envelope. Throws on HTTP error; returns the parsed
 * body typed as T (the caller extracts the named field).
 */
export async function requestPlugin<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, fetchInit(method, body));
  if (!res.ok) throw new Error(await extractError(res));
  return (await res.json()) as T;
}

/** For plugin routes that return HTTP 204 with no body (DELETE). */
export async function requestPluginNoContent(method: string, url: string): Promise<void> {
  const res = await fetch(url, { method, headers: authHeaders() });
  if (!res.ok) throw new Error(await extractError(res));
}

/**
 * Extracts a named field from a plugin response body.
 * Throws a clear error if the field is absent or undefined, so callers
 * never silently get `undefined.filter(...)` downstream.
 */
export function expectField<T>(body: unknown, key: string): T {
  if (
    body === null ||
    typeof body !== 'object' ||
    !(key in (body as object)) ||
    (body as Record<string, unknown>)[key] === undefined
  ) {
    throw new Error(`Plugin response missing field "${key}"`);
  }
  return (body as Record<string, unknown>)[key] as T;
}
