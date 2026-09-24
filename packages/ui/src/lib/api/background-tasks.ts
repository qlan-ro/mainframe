/**
 * Per-chat background-task REST wrappers: kill and the on-demand output tail
 * (list already exists via `Chat.backgroundActivity` on the WS/REST snapshot).
 *
 * Both functions are result-typed rather than throw-on-failure: a background
 * task's stop/output UI needs to distinguish "not found" from "unsupported"
 * from "read failed" without a try/catch per call site. Every JSON body is
 * Zod-validated — the daemon's failure envelope is `{success:false,error}`.
 */
import { z } from 'zod';
import { apiBase, authHeaders, fetchChecked } from './http';
import { describeHttpFailure } from './http-failure';

const FailEnvelopeSchema = z.object({ success: z.literal(false), error: z.string() });

const KillEnvelopeSchema = z.union([z.object({ success: z.literal(true) }), FailEnvelopeSchema]);

export type KillBackgroundTaskResult = { kind: 'ok' } | { kind: 'not-found' } | { kind: 'error'; message: string };

export type BackgroundTaskOutputResult =
  { kind: 'text'; text: string } | { kind: 'none' } | { kind: 'error'; message: string };

/** Parses a response body as JSON; `null` on a non-JSON or empty body rather than throwing. */
async function parseJsonSafely(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** `POST /api/chats/{chatId}/background-tasks/{taskId}/kill`. Never throws on an HTTP failure. */
export async function killBackgroundTask(chatId: string, taskId: string): Promise<KillBackgroundTaskResult> {
  const url = `${apiBase()}/api/chats/${chatId}/background-tasks/${taskId}/kill`;
  const res = await fetchChecked(url, { method: 'POST', headers: authHeaders() });
  const parsed = KillEnvelopeSchema.safeParse(await parseJsonSafely(res));
  if (!parsed.success) return { kind: 'error', message: describeHttpFailure(res.status) };
  if (parsed.data.success) return { kind: 'ok' };
  if (res.status === 404) return { kind: 'not-found' };
  return { kind: 'error', message: parsed.data.error };
}

/**
 * `GET /api/chats/{chatId}/background-tasks/{taskId}/output?bytes=N`. A 2xx body is the
 * raw tail text; a non-2xx body is the failure envelope, with `no_output` mapped to
 * `none` and any other error (`invalid_path`, `read failed`, `task not found`, …)
 * mapped to `error`. Never throws on an HTTP failure.
 */
export async function getBackgroundTaskOutput(
  chatId: string,
  taskId: string,
  bytes = 8192,
): Promise<BackgroundTaskOutputResult> {
  const url = `${apiBase()}/api/chats/${chatId}/background-tasks/${taskId}/output?bytes=${bytes}`;
  const res = await fetchChecked(url, { method: 'GET', headers: authHeaders() });
  if (res.ok) return { kind: 'text', text: await res.text() };
  const parsed = FailEnvelopeSchema.safeParse(await parseJsonSafely(res));
  if (!parsed.success) return { kind: 'error', message: describeHttpFailure(res.status) };
  if (parsed.data.error === 'no_output') return { kind: 'none' };
  return { kind: 'error', message: parsed.data.error };
}
