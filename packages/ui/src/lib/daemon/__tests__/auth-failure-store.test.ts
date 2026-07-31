/**
 * auth-failure-store — per-daemon "needs re-pair" marker, keyed by daemon id.
 *
 * This is the "a 401 must not clear stored credentials" guard: the store must
 * never reach into @/lib/host (the keyring), so a marker write can never, by
 * construction, touch a stored token.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getHostSpy } = vi.hoisted(() => ({ getHostSpy: vi.fn() }));
vi.mock('@/lib/host', () => ({ getHost: getHostSpy }));

import { markAuthFailure, clearAuthFailure, hasAuthFailure, subscribeAuthFailures } from '../auth-failure-store';

beforeEach(() => {
  clearAuthFailure('d1');
  clearAuthFailure('d2');
  getHostSpy.mockClear();
});

describe('auth-failure-store', () => {
  it('an unmarked id reads as false', () => {
    expect(hasAuthFailure('d1')).toBe(false);
  });

  it('marking one id does not mark another (per-daemon keying)', () => {
    markAuthFailure('d1');
    expect(hasAuthFailure('d1')).toBe(true);
    expect(hasAuthFailure('d2')).toBe(false);
  });

  it('clearing a marked id returns it to false', () => {
    markAuthFailure('d1');
    clearAuthFailure('d1');
    expect(hasAuthFailure('d1')).toBe(false);
  });

  it('notifies subscribers on mark and on clear', () => {
    const cb = vi.fn();
    subscribeAuthFailures(cb);
    markAuthFailure('d1');
    expect(cb).toHaveBeenCalledTimes(1);
    clearAuthFailure('d1');
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('the unsubscribe function stops further notifications', () => {
    const cb = vi.fn();
    const unsubscribe = subscribeAuthFailures(cb);
    markAuthFailure('d1');
    expect(cb).toHaveBeenCalledTimes(1);
    unsubscribe();
    clearAuthFailure('d1');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('marking the same id twice notifies once (no redundant notification)', () => {
    const cb = vi.fn();
    subscribeAuthFailures(cb);
    markAuthFailure('d1');
    markAuthFailure('d1');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('never calls getHost — a 401 must not be able to touch stored credentials', () => {
    markAuthFailure('d1');
    clearAuthFailure('d1');
    hasAuthFailure('d1');
    expect(getHostSpy).not.toHaveBeenCalled();
  });
});
