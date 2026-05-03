import { describe, it, expect } from 'vitest';
import { classifyUpdateError, type UpdateErrorKind } from '../../main/auto-updater-error-classifier.js';

describe('classifyUpdateError', () => {
  it('classifies ENOTFOUND as transient', () => {
    const err = Object.assign(new Error('getaddrinfo ENOTFOUND github.com'), { code: 'ENOTFOUND' });
    expect(classifyUpdateError(err)).toBe<UpdateErrorKind>('transient');
  });

  it('classifies ETIMEDOUT as transient', () => {
    const err = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
    expect(classifyUpdateError(err)).toBe<UpdateErrorKind>('transient');
  });

  it('classifies ECONNRESET as transient', () => {
    const err = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    expect(classifyUpdateError(err)).toBe<UpdateErrorKind>('transient');
  });

  it('classifies ECONNREFUSED as transient', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(classifyUpdateError(err)).toBe<UpdateErrorKind>('transient');
  });

  it('classifies HTTP 503 as transient via message', () => {
    const err = new Error('Got status 503 from https://github.com/releases');
    expect(classifyUpdateError(err)).toBe<UpdateErrorKind>('transient');
  });

  it('classifies HTTP 500 as transient via message', () => {
    const err = new Error('Error: Got status 500');
    expect(classifyUpdateError(err)).toBe<UpdateErrorKind>('transient');
  });

  it('classifies GitHub rate limit HTTP 403 as transient', () => {
    const err = new Error('Got status 403 from https://api.github.com/repos');
    expect(classifyUpdateError(err)).toBe<UpdateErrorKind>('transient');
  });

  it('classifies HTTP 429 as transient', () => {
    const err = new Error('Got status 429');
    expect(classifyUpdateError(err)).toBe<UpdateErrorKind>('transient');
  });

  it('classifies network unavailable message as transient', () => {
    const err = new Error('net::ERR_NETWORK_CHANGED');
    expect(classifyUpdateError(err)).toBe<UpdateErrorKind>('transient');
  });

  it('classifies DNS failure message as transient', () => {
    const err = new Error('net::ERR_NAME_NOT_RESOLVED');
    expect(classifyUpdateError(err)).toBe<UpdateErrorKind>('transient');
  });

  it('classifies signature mismatch as persistent', () => {
    const err = new Error('signature verification failed for update');
    expect(classifyUpdateError(err)).toBe<UpdateErrorKind>('persistent');
  });

  it('classifies disk full as persistent', () => {
    const err = Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    expect(classifyUpdateError(err)).toBe<UpdateErrorKind>('persistent');
  });

  it('classifies manifest parse error as persistent', () => {
    const err = new Error('Cannot parse latest.yml: unexpected token');
    expect(classifyUpdateError(err)).toBe<UpdateErrorKind>('persistent');
  });

  it('classifies HTTP 404 as persistent', () => {
    const err = new Error('Got status 404');
    expect(classifyUpdateError(err)).toBe<UpdateErrorKind>('persistent');
  });

  it('classifies generic unknown error as persistent', () => {
    const err = new Error('Something completely unknown went wrong');
    expect(classifyUpdateError(err)).toBe<UpdateErrorKind>('persistent');
  });
});
