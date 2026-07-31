/**
 * Minimal HTTP helpers for the daemon REST API.
 *
 * `apiBase` returns the active daemon's baseUrl. The `port` argument is
 * accepted for call-site compatibility but ignored — the active daemon
 * target owns the base URL (local or remote tunnel).
 */
import type { ApiResponse, ApiResponseEmpty } from '@qlan-ro/mainframe-types';
import { getActiveDaemon } from '../daemon/active-daemon';
import { markAuthFailure, clearAuthFailure } from '../daemon/auth-failure-store';
import { describeHttpFailure } from './http-failure';

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

/** One entry of a route's `errors[]` — `stepId` is the automations engine's; other routes may key their own. */
export interface ApiErrorDetail {
  stepId: string | null;
  message: string;
}

/**
 * The daemon's error body, kept whole. Routes that reject a document rather
 * than a request (automations' `engine_error`) send `errors[]` alongside the
 * joined `error` string; a bare `Error` would drop it and the caller could
 * only ever show one flat sentence.
 */
export class ApiRequestError extends Error {
  readonly details: ApiErrorDetail[];
  readonly status: number;

  constructor(message: string, details: ApiErrorDetail[] = [], status = 0) {
    super(message);
    this.name = 'ApiRequestError';
    this.details = details;
    this.status = status;
  }
}

/** Malformed entries are dropped, not thrown on — a broken error body must not replace the error it describes. */
function errorDetails(raw: unknown): ApiErrorDetail[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object') return [];
    const { stepId, message } = entry as { stepId?: unknown; message?: unknown };
    if (typeof message !== 'string') return [];
    return [{ stepId: typeof stepId === 'string' ? stepId : null, message }];
  });
}

/**
 * Every REST wrapper routes its fetch through here so a remote 401 marks that
 * daemon's auth-failure state (driving `needs-repair` in the footer) and any
 * other outcome clears it. A local (loopback-trusted) target is never marked
 * — it carries no token and can never legitimately need a re-pair. Any status
 * other than 401/ok leaves the marker untouched: a 500 is a server failure,
 * and a 403 here is application policy (e.g. "path outside project"), not a
 * credential problem — the daemon's auth middleware only ever emits 401.
 *
 * The daemon to attribute the outcome to is captured BEFORE the fetch, not
 * after: switching the active daemon mid-flight would otherwise let a
 * response from the old target mark or clear the new one's marker.
 */
async function fetchChecked(url: string, init: RequestInit): Promise<Response> {
  const { kind, id } = getActiveDaemon();
  const res = await fetch(url, init);
  if (kind === 'remote') {
    if (res.status === 401) markAuthFailure(id);
    else if (res.ok) clearAuthFailure(id);
  }
  return res;
}

async function extractError(res: Response): Promise<ApiRequestError> {
  try {
    const data = (await res.json()) as { error?: unknown; message?: unknown; errors?: unknown };
    const text =
      typeof data.error === 'string'
        ? data.error
        : typeof data.message === 'string'
          ? data.message
          : describeHttpFailure(res.status);
    return new ApiRequestError(text, errorDetails(data.errors), res.status);
  } catch {
    /* not JSON */
  }
  return new ApiRequestError(describeHttpFailure(res.status), [], res.status);
}

/** Fetch, unwrap the `ApiResponse<T>` envelope, and return `data`. Throws on HTTP or API error. */
export async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetchChecked(url, fetchInit(method, body));
  if (!res.ok) throw await extractError(res);
  const json = (await res.json()) as ApiResponse<T>;
  if (!json.success) throw new Error(json.error);
  return json.data;
}

/** Like `request` but for routes that return `okEmpty` (no `data`). */
export async function requestEmpty(method: string, url: string, body?: unknown): Promise<void> {
  const res = await fetchChecked(url, fetchInit(method, body));
  if (!res.ok) throw await extractError(res);
  const json = (await res.json()) as ApiResponseEmpty;
  if (!json.success) throw new Error(json.error);
}

/** For routes that return HTTP 204 with no body (e.g. DELETE /api/tags/:name). */
export async function requestNoContent(method: string, url: string): Promise<void> {
  const res = await fetchChecked(url, fetchInit(method));
  if (!res.ok) throw await extractError(res);
}

/**
 * For builtin-plugin routes that return RAW JSON bodies (e.g. `{ todos }`),
 * NOT the `ApiResponse<T>` envelope. Throws on HTTP error; returns the parsed
 * body typed as T (the caller extracts the named field).
 */
export async function requestPlugin<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetchChecked(url, fetchInit(method, body));
  if (!res.ok) throw await extractError(res);
  return (await res.json()) as T;
}

/** For plugin routes that return HTTP 204 with no body (DELETE). */
export async function requestPluginNoContent(method: string, url: string): Promise<void> {
  const res = await fetchChecked(url, { method, headers: authHeaders() });
  if (!res.ok) throw await extractError(res);
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
