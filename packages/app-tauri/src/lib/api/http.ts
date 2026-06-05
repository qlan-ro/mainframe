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
