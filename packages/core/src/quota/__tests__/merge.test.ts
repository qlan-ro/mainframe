import { describe, it, expect } from 'vitest';
import type { ProviderQuota, QuotaWindow } from '@qlan-ro/mainframe-types';
import { mergeProviderQuota } from '../merge.js';

const NOW = 1_720_000_000_000;

describe('mergeProviderQuota', () => {
  it('keeps the prior session window untouched (incl. observedAt) when the update omits it', () => {
    const session: QuotaWindow = { kind: 'session', usedPercent: 10, resetsAt: NOW + 10_000, observedAt: NOW - 500 };
    const weekly: QuotaWindow = { kind: 'weekly', usedPercent: 20, resetsAt: NOW + 10_000 };
    const prior: ProviderQuota = { status: 'ok', session, weekly, modelWindows: [], observedAt: NOW - 1_000 };
    const newWeekly: QuotaWindow = { kind: 'weekly', usedPercent: 25, resetsAt: NOW + 20_000 };

    const merged = mergeProviderQuota(prior, { weekly: newWeekly, observedAt: NOW }, NOW);

    // The omitted window is kept verbatim (same reference, original observedAt preserved).
    expect(merged.session).toBe(session);
    // The incoming window is stamped with the harvest time.
    expect(merged.weekly).toEqual({ ...newWeekly, observedAt: NOW });
  });

  it('keeps the prior modelWindows array when the update omits it', () => {
    const model: QuotaWindow = { kind: 'weekly-model', usedPercent: 30, resetsAt: NOW + 10_000, label: 'opus' };
    const prior: ProviderQuota = { status: 'ok', modelWindows: [model], observedAt: NOW - 1_000 };

    const merged = mergeProviderQuota(prior, { observedAt: NOW }, NOW);

    expect(merged.modelWindows).toEqual([model]);
  });

  it('upserts model windows by label, keeping labels the update does not carry', () => {
    const opus: QuotaWindow = { kind: 'weekly-model', usedPercent: 30, resetsAt: NOW + 10_000, label: 'opus' };
    const sonnet: QuotaWindow = { kind: 'weekly-model', usedPercent: 40, resetsAt: NOW + 10_000, label: 'sonnet' };
    const prior: ProviderQuota = { status: 'ok', modelWindows: [opus, sonnet], observedAt: NOW - 1_000 };
    const newOpus: QuotaWindow = { kind: 'weekly-model', usedPercent: 55, resetsAt: NOW + 20_000, label: 'opus' };

    const merged = mergeProviderQuota(prior, { modelWindows: [newOpus], observedAt: NOW }, NOW);

    // opus is replaced (and stamped); sonnet is untouched because it was absent from the update.
    expect(merged.modelWindows).toEqual([{ ...newOpus, observedAt: NOW }, sonnet]);
  });

  it('starts from an empty blob when there is no prior state', () => {
    const session: QuotaWindow = { kind: 'session', usedPercent: 5, resetsAt: NOW + 10_000 };

    const merged = mergeProviderQuota(undefined, { session, observedAt: NOW }, NOW);

    expect(merged).toEqual({
      status: 'ok',
      session: { ...session, observedAt: NOW },
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
