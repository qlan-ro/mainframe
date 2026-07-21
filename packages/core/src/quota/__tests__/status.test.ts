import { describe, it, expect } from 'vitest';
import type { ProviderQuota, QuotaWindow } from '@qlan-ro/mainframe-types';
import { deriveProviderStatus } from '../status.js';

const NOW = 1_720_000_000_000;

describe('deriveProviderStatus', () => {
  it('is ok when every window is trusted', () => {
    const session: QuotaWindow = { kind: 'session', usedPercent: 10, resetsAt: NOW + 1_000 };
    const weekly: QuotaWindow = { kind: 'weekly', usedPercent: 20, resetsAt: NOW + 2_000 };
    const quota: ProviderQuota = { status: 'unknown', session, weekly, modelWindows: [], observedAt: NOW };
    expect(deriveProviderStatus(quota, NOW)).toBe('ok');
  });

  it('is unknown when every window has expired', () => {
    const session: QuotaWindow = { kind: 'session', usedPercent: 10, resetsAt: NOW - 1 };
    const weekly: QuotaWindow = { kind: 'weekly', usedPercent: 20, resetsAt: NOW - 1 };
    const quota: ProviderQuota = { status: 'ok', session, weekly, modelWindows: [], observedAt: NOW };
    expect(deriveProviderStatus(quota, NOW)).toBe('unknown');
  });

  it('is ok when at least one window among several is still trusted', () => {
    const session: QuotaWindow = { kind: 'session', usedPercent: 10, resetsAt: NOW - 1 };
    const weekly: QuotaWindow = { kind: 'weekly', usedPercent: 20, resetsAt: NOW + 1_000 };
    const quota: ProviderQuota = { status: 'unknown', session, weekly, modelWindows: [], observedAt: NOW };
    expect(deriveProviderStatus(quota, NOW)).toBe('ok');
  });

  it('is unknown when there are no windows at all', () => {
    const quota: ProviderQuota = { status: 'ok', modelWindows: [], observedAt: NOW };
    expect(deriveProviderStatus(quota, NOW)).toBe('unknown');
  });

  it('fails the whole provider closed when only a model window has expired', () => {
    const model: QuotaWindow = { kind: 'weekly-model', usedPercent: 50, resetsAt: NOW - 1, label: 'opus' };
    const quota: ProviderQuota = { status: 'ok', modelWindows: [model], observedAt: NOW };
    expect(deriveProviderStatus(quota, NOW)).toBe('unknown');
  });
});
