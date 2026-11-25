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
import { NotSentError } from '@/lib/daemon/not-sent-error';
import { errorMessage } from '@/lib/error-message';

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

/** JSON-RPC's own refusals, answered before anything acts on the request: unparsable, invalid, no such method, invalid params. */
const PROTOCOL_REFUSALS: readonly unknown[] = [-32700, -32600, -32601, -32602];

/** The failure in words, whatever it is: an error, or a JSON-RPC error object. */
export function sendErrorMessage(error: unknown): string {
  return promptFailureOf(error)?.reason ?? errorMessage(error);
}

/**
 * The daemon's refusals that name a chat, a process or a queue, in plain words.
 * Its own sentences to the user pass as they are; any other text is the agent's
 * or the protocol's, and is logged instead of shown.
 */
const REFUSALS: readonly (readonly [RegExp, string])[] = [
  [/^Chat \S+ not running$|^Session \S+ not spawned$/, 'the session is not running.'],
  [/^Session \S+ stdin queue is full$/, 'the agent has too many messages waiting.'],
  [/^Project directory does not exist or is not accessible/, 'the session’s folder is missing.'],
];
const WRITTEN_FOR_THE_USER = /^This message is too large to send with /;

function refusalInWords(error: unknown, failure: PromptFailure | undefined): string {
  if (error instanceof NotSentError) return 'the connection to the daemon was lost.';
  if (!failure) return 'the daemon could not read it.';
  if (failure.remedy || WRITTEN_FOR_THE_USER.test(failure.reason)) return failure.reason;
  return REFUSALS.find(([raw]) => raw.test(failure.reason))?.[1] ?? 'the agent refused it.';
}

/** Why a prompt was refused, in plain words, when it certainly did not reach the agent; undefined when it may have. */
export function sendRefusal(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  const failure = promptFailureOf(error);
  const refused = error instanceof NotSentError || failure?.neverDelivered === true || PROTOCOL_REFUSALS.includes(code);
  return refused ? refusalInWords(error, failure) : undefined;
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
