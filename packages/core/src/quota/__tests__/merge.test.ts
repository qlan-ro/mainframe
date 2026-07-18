import { describe, it, expect } from 'vitest';
import type { ProviderQuota, QuotaWindow } from '@qlan-ro/mainframe-types';
import { mergeProviderQuota } from '../merge.js';

const NOW = 1_720_000_000_000;

describe('mergeProviderQuota', () => {
  it('keeps the prior session window when the update omits it', () => {
    const session: QuotaWindow = { kind: 'session', usedPercent: 10, resetsAt: NOW + 10_000 };
    const weekly: QuotaWindow = { kind: 'weekly', usedPercent: 20, resetsAt: NOW + 10_000 };
    const prior: ProviderQuota = { status: 'ok', session, weekly, modelWindows: [], observedAt: NOW - 1_000 };
    const newWeekly: QuotaWindow = { kind: 'weekly', usedPercent: 25, resetsAt: NOW + 20_000 };

    const merged = mergeProviderQuota(prior, { weekly: newWeekly, observedAt: NOW }, NOW);

    expect(merged.session).toBe(session);
    expect(merged.weekly).toBe(newWeekly);
  });

  it('keeps the prior modelWindows array when the update omits it', () => {
    const model: QuotaWindow = { kind: 'weekly-model', usedPercent: 30, resetsAt: NOW + 10_000, label: 'opus' };
    const prior: ProviderQuota = { status: 'ok', modelWindows: [model], observedAt: NOW - 1_000 };

    const merged = mergeProviderQuota(prior, { observedAt: NOW }, NOW);

    expect(merged.modelWindows).toEqual([model]);
  });

  it('starts from an empty blob when there is no prior state', () => {
    const session: QuotaWindow = { kind: 'session', usedPercent: 5, resetsAt: NOW + 10_000 };

    const merged = mergeProviderQuota(undefined, { session, observedAt: NOW }, NOW);

    expect(merged).toEqual({
      status: 'ok',
      session,
      weekly: undefined,
      modelWindows: [],
      observedAt: NOW,
      accountIdentity: undefined,
    });
  });

  it('keeps the prior accountIdentity when the update omits it', () => {
    const prior: ProviderQuota = { status: 'ok', modelWindows: [], observedAt: NOW - 1_000, accountIdentity: 'user-a' };

    const merged = mergeProviderQuota(prior, { observedAt: NOW }, NOW);

    expect(merged.accountIdentity).toBe('user-a');
  });

  it('overwrites accountIdentity when the update provides a new one', () => {
    const prior: ProviderQuota = { status: 'ok', modelWindows: [], observedAt: NOW - 1_000, accountIdentity: 'user-a' };

    const merged = mergeProviderQuota(prior, { accountIdentity: 'user-b', observedAt: NOW }, NOW);

    expect(merged.accountIdentity).toBe('user-b');
  });

  it('recomputes status to unknown when the merged windows have all expired', () => {
    const session: QuotaWindow = { kind: 'session', usedPercent: 10, resetsAt: NOW - 1 };
    const prior: ProviderQuota = { status: 'ok', session, modelWindows: [], observedAt: NOW - 1_000 };

    const merged = mergeProviderQuota(prior, { observedAt: NOW }, NOW);

    expect(merged.status).toBe('unknown');
  });
});
