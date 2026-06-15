/**
 * Minimal HTTP helpers for the daemon REST API.
 *
 * Port is dynamic (sidecar chooses a free port) — callers pass it in
 * rather than reading a build-time env var. The Tauri bridge provides
 * the live port via `getDaemonPort()`.
 */
import type { ApiResponse, ApiResponseEmpty } from '@qlan-ro/mainframe-types';

export function apiBase(port: number): string {
  return `http://127.0.0.1:${port}`;
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
  const res = await fetch(url, {
    method,
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(await extractError(res));
  const json = (await res.json()) as ApiResponse<T>;
  if (!json.success) throw new Error(json.error);
  return json.data;
}

/** Like `request` but for routes that return `okEmpty` (no `data`). */
export async function requestEmpty(method: string, url: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(await extractError(res));
  const json = (await res.json()) as ApiResponseEmpty;
  if (!json.success) throw new Error(json.error);
}

/** For routes that return HTTP 204 with no body (e.g. DELETE /api/tags/:name). */
export async function requestNoContent(method: string, url: string): Promise<void> {
  const res = await fetch(url, { method });
  if (!res.ok) throw new Error(await extractError(res));
}

/**
 * For builtin-plugin routes that return RAW JSON bodies (e.g. `{ todos }`),
 * NOT the `ApiResponse<T>` envelope. Throws on HTTP error; returns the parsed
 * body typed as T (the caller extracts the named field).
 */
export async function requestPlugin<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return (await res.json()) as T;
}

/** For plugin routes that return HTTP 204 with no body (DELETE). */
export async function requestPluginNoContent(method: string, url: string): Promise<void> {
  const res = await fetch(url, { method });
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
