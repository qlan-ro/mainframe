/**
 * Turns a raw send/upload rejection into the sentence the failed message shows.
 *
 * Three cases the user can act on: not authorized (re-pair), too large (shrink
 * or drop a file), and everything else (retry). The HTTP status is read
 * structurally rather than by importing `ApiRequestError`, so this module stays
 * pure — no API layer, no React — and trivially testable.
 */

const AUTH_SENTENCE = 'Not authorized on this daemon. Re-pair it from the daemon menu, then send again.';
const RESTORED_CLAUSE = 'Your attachments are back in the composer.';
const TOO_LARGE_SENTENCE = 'The attachment is too large. The daemon accepts files up to 5MB.';
const UNREACHABLE_SENTENCE = 'The daemon is unreachable. Check the connection, then send again.';

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  return typeof status === 'number' ? status : undefined;
}

export function describeSendError(error: unknown, opts: { attachmentsRestored: boolean }): string {
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
