/**
 * Turns a raw send/upload rejection into the sentence the failed message shows.
 *
 * Three cases the user can act on: not authorized (re-pair), too large (shrink
 * or drop a file), and everything else (retry). The HTTP status is read
 * structurally rather than by importing `ApiRequestError`, so this module stays
 * pure — no API layer, no React — and trivially testable.
 *
 * A refused `session/prompt` rejects with the JSON-RPC error object, whose
 * `data["_mainframe.dev"]` carries the refusal in the user's words and, when
 * there is one, the remedy the failed message offers (`sendRemedyOf`).
 */
import { MAINFRAME_META_NAMESPACE, PromptFailureSchema } from '@qlan-ro/mainframe-types';
import type { PromptFailure, PromptRemedy } from '@qlan-ro/mainframe-types';

const AUTH_SENTENCE = 'Not authorized on this daemon. Re-pair it from the daemon menu, then send again.';
const RESTORED_CLAUSE = 'Your attachments are back in the composer.';
const TOO_LARGE_SENTENCE = 'The attachment is too large. The daemon accepts files up to 5MB.';
const UNREACHABLE_SENTENCE = 'The daemon is unreachable. Check the connection, then send again.';

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  return typeof status === 'number' ? status : undefined;
}

function promptFailureOf(error: unknown): PromptFailure | undefined {
  const data = (error as { data?: unknown } | null | undefined)?.data;
  const failure = (data as Record<string, unknown> | null | undefined)?.[MAINFRAME_META_NAMESPACE];
  const parsed = PromptFailureSchema.safeParse(failure);
  return parsed.success ? parsed.data : undefined;
}

/** The action a refused prompt offers before retrying, if any. */
export function sendRemedyOf(error: unknown): PromptRemedy | undefined {
  return promptFailureOf(error)?.remedy;
}

export function describeSendError(error: unknown, opts: { attachmentsRestored: boolean }): string {
  const failure = promptFailureOf(error);
  if (failure) return failure.reason;
  const status = statusOf(error);
  if (status === 401 || status === 403) {
    return opts.attachmentsRestored ? `${AUTH_SENTENCE} ${RESTORED_CLAUSE}` : AUTH_SENTENCE;
  }
  if (status === 413) return TOO_LARGE_SENTENCE;
  // fetch reports a network-level failure as a TypeError, never as a status.
  if (error instanceof TypeError) return UNREACHABLE_SENTENCE;
  if (error instanceof Error && error.message) return error.message;
  return 'Failed to send';
}
