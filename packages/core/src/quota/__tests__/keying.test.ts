import { describe, it, expect } from 'vitest';
import { computeQuotaKey, resolveAccountIdentity, UNKNOWN_ACCOUNT_IDENTITY } from '../keying.js';

describe('computeQuotaKey', () => {
  it('combines adapterId and accountIdentity', () => {
    expect(computeQuotaKey('claude', 'user-a')).toBe('claude:user-a');
  });

  it('falls back to the synthetic unknown-identity bucket when keyless', () => {
    expect(computeQuotaKey('codex', undefined)).toBe(`codex:${UNKNOWN_ACCOUNT_IDENTITY}`);
  });

  it('produces a different key when the account swaps under the same adapter', () => {
    expect(computeQuotaKey('claude', 'user-a')).not.toBe(computeQuotaKey('claude', 'user-b'));
  });

  it('keeps keyless buckets distinct per adapter', () => {
    expect(computeQuotaKey('claude', undefined)).not.toBe(computeQuotaKey('codex', undefined));
  });
});

describe('resolveAccountIdentity', () => {
  it('reuses the last-known identity on a transient read failure', () => {
    expect(resolveAccountIdentity(null, 'user-a')).toBe('user-a');
  });

  it('adopts a freshly-read identity over the last-known one', () => {
    expect(resolveAccountIdentity('user-b', 'user-a')).toBe('user-b');
  });

  it('stays undefined when there is neither a fresh read nor a last-known identity', () => {
    expect(resolveAccountIdentity(null, undefined)).toBeUndefined();
  });
});
