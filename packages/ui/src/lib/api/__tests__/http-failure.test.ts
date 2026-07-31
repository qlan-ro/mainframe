/**
 * describeHttpFailure — pure mapping from an HTTP status to a human sentence.
 *
 * Every branch is asserted with a fixed status and a hardcoded expected
 * sentence — no branch recomputes the mapping the implementation performs.
 */
import { describe, it, expect } from 'vitest';
import { describeHttpFailure } from '../http-failure';

describe('describeHttpFailure', () => {
  it('401 reads as unauthorized', () => {
    expect(describeHttpFailure(401)).toBe('The daemon rejected this request as unauthorized (HTTP 401).');
  });

  it('403 reads as unauthorized, same shape as 401 with its own status', () => {
    expect(describeHttpFailure(403)).toBe('The daemon rejected this request as unauthorized (HTTP 403).');
  });

  it('413 reads as too large', () => {
    expect(describeHttpFailure(413)).toBe('The daemon rejected this request as too large (HTTP 413).');
  });

  it('500 reads as a daemon failure to handle the request', () => {
    expect(describeHttpFailure(500)).toBe('The daemon failed to handle this request (HTTP 500).');
  });

  it('503 reads as a daemon failure to handle the request, with its own status', () => {
    expect(describeHttpFailure(503)).toBe('The daemon failed to handle this request (HTTP 503).');
  });

  it('an unmapped status (418) falls back to a generic rejection sentence', () => {
    expect(describeHttpFailure(418)).toBe('The daemon rejected this request (HTTP 418).');
  });

  it('every branch carries the numeric status and ends in a period, never the bare "HTTP <n>"', () => {
    for (const status of [401, 403, 413, 500, 503, 418]) {
      const sentence = describeHttpFailure(status);
      expect(sentence).toContain(String(status));
      expect(sentence.endsWith('.')).toBe(true);
      expect(sentence).not.toBe(`HTTP ${status}`);
    }
  });
});
