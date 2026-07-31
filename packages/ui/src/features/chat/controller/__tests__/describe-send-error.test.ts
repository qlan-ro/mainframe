/**
 * describeSendError — turns a raw send/upload failure into a human sentence.
 *
 * Every case is asserted with a fixed input and a hardcoded expected
 * sentence — no branch recomputes the mapping the implementation performs.
 * `status` is read structurally (duck-typed), so fixtures attach it directly
 * rather than depending on `ApiRequestError` growing a constructor param.
 */
import { describe, it, expect } from 'vitest';
import { ApiRequestError } from '../../../../lib/api/http';
import { describeSendError } from '../describe-send-error';

function withStatus(message: string, status: number): ApiRequestError {
  return Object.assign(new ApiRequestError(message), { status });
}

describe('describeSendError', () => {
  it('a 401 reads as not-authorized, with no attachments to mention', () => {
    expect(describeSendError(withStatus('Unauthorized', 401), { attachmentsRestored: false })).toBe(
      'Not authorized on this daemon. Re-pair it from the daemon menu, then send again.',
    );
  });

  it('a 401 with restored attachments appends the restore sentence', () => {
    expect(describeSendError(withStatus('Unauthorized', 401), { attachmentsRestored: true })).toBe(
      'Not authorized on this daemon. Re-pair it from the daemon menu, then send again. Your attachments are back in the composer.',
    );
  });

  it('a 403 reads with the same authorization sentence as 401', () => {
    expect(describeSendError(withStatus('Forbidden', 403), { attachmentsRestored: false })).toBe(
      'Not authorized on this daemon. Re-pair it from the daemon menu, then send again.',
    );
  });

  it('a 413 reads as too large, naming the daemon-side limit', () => {
    expect(describeSendError(withStatus('Payload Too Large', 413), { attachmentsRestored: true })).toBe(
      'The attachment is too large. The daemon accepts files up to 5MB.',
    );
  });

  it('the composer pre-flight size error is returned verbatim', () => {
    const preflight = new Error('"shot.png" is too large. Max file size is 5MB.');
    expect(describeSendError(preflight, { attachmentsRestored: true })).toBe(
      '"shot.png" is too large. Max file size is 5MB.',
    );
  });

  it('a fetch-level TypeError reads as unreachable', () => {
    expect(describeSendError(new TypeError('Failed to fetch'), { attachmentsRestored: false })).toBe(
      'The daemon is unreachable. Check the connection, then send again.',
    );
  });

  it('an arbitrary Error falls back to its own message', () => {
    expect(describeSendError(new Error('boom'), { attachmentsRestored: false })).toBe('boom');
  });

  it('an undefined error falls back to a generic sentence', () => {
    expect(describeSendError(undefined, { attachmentsRestored: false })).toBe('Failed to send');
  });
});
