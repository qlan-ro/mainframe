import { describe, it, expect } from 'vitest';
import { classifyUpdateError, type UpdateErrorKind } from '../../main/auto-updater-error-classifier.js';

function makeErr(message: string, code?: string): Error {
  return code ? Object.assign(new Error(message), { code }) : new Error(message);
}

describe('classifyUpdateError', () => {
  it.each([
    ['ENOTFOUND via code', 'getaddrinfo ENOTFOUND github.com', 'ENOTFOUND'],
    ['ETIMEDOUT via code', 'connect ETIMEDOUT', 'ETIMEDOUT'],
    ['ECONNRESET via code', 'read ECONNRESET', 'ECONNRESET'],
    ['ECONNREFUSED via code', 'connect ECONNREFUSED', 'ECONNREFUSED'],
    ['HTTP 503 via message', 'Got status 503 from https://github.com/releases', undefined],
    ['HTTP 500 via message', 'Error: Got status 500', undefined],
    ['GitHub rate limit HTTP 403', 'Got status 403 from https://api.github.com/repos', undefined],
    ['HTTP 429', 'Got status 429', undefined],
    ['network unavailable message', 'net::ERR_NETWORK_CHANGED', undefined],
    ['DNS failure message', 'net::ERR_NAME_NOT_RESOLVED', undefined],
  ])('classifies %s as transient', (_label, message, code) => {
    expect(classifyUpdateError(makeErr(message, code))).toBe<UpdateErrorKind>('transient');
  });

  it.each([
    ['signature mismatch', 'signature verification failed for update', undefined],
    ['disk full via code', 'ENOSPC: no space left on device', 'ENOSPC'],
    ['manifest parse error', 'Cannot parse latest.yml: unexpected token', undefined],
    ['HTTP 404', 'Got status 404', undefined],
    ['generic unknown error', 'Something completely unknown went wrong', undefined],
  ])('classifies %s as persistent', (_label, message, code) => {
    expect(classifyUpdateError(makeErr(message, code))).toBe<UpdateErrorKind>('persistent');
  });
});
