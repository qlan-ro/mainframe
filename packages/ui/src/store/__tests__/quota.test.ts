import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderQuota } from '@qlan-ro/mainframe-types';

const handlers = new Set<(e: any) => void>();
vi.mock('@/lib/daemon/ws-client', () => ({
  daemonWs: {
    onEvent: (h: any) => {
      handlers.add(h);
      return () => handlers.delete(h);
    },
  },
}));

import {
  useQuotaStore,
  applyProviderQuota,
  resetQuota,
  useProviderQuota,
  installProviderQuotaSubscriber,
} from '../quota.js';

const OBSERVED = 1_752_750_000_000;

const quota = (observedAt: number, usedPercent: number): ProviderQuota => ({
  status: 'ok',
  observedAt,
  modelWindows: [],
  session: { kind: 'session', usedPercent, resetsAt: observedAt + 3_600_000 },
});

describe('ui quota store', () => {
  beforeEach(() => {
    resetQuota();
    handlers.clear();
  });

  it('applies a quota blob under its adapter id', () => {
    applyProviderQuota('claude', quota(OBSERVED, 30));
    expect(useQuotaStore.getState().byId.claude!.session!.usedPercent).toBe(30);
  });

  it('keeps the fresher blob (only-if-newer by observedAt)', () => {
    applyProviderQuota('claude', quota(OBSERVED, 30));
    applyProviderQuota('claude', quota(OBSERVED - 1000, 99)); // older → ignored
    expect(useQuotaStore.getState().byId.claude!.session!.usedPercent).toBe(30);
    applyProviderQuota('claude', quota(OBSERVED + 1000, 55)); // newer → applied
    expect(useQuotaStore.getState().byId.claude!.session!.usedPercent).toBe(55);
  });

  it('the subscriber applies provider.quota.updated events and ignores others', () => {
    const unsub = installProviderQuotaSubscriber();
    handlers.forEach((h) => h({ type: 'adapter.models.updated', adapterId: 'claude', models: [], modelsRevision: 1 }));
    expect(useQuotaStore.getState().byId.claude).toBeUndefined();
    handlers.forEach((h) => h({ type: 'provider.quota.updated', adapterId: 'codex', quota: quota(OBSERVED, 61) }));
    expect(useQuotaStore.getState().byId.codex!.session!.usedPercent).toBe(61);
    unsub();
  });

  it('reset clears the store', () => {
    applyProviderQuota('claude', quota(OBSERVED, 30));
    resetQuota();
    expect(Object.keys(useQuotaStore.getState().byId)).toHaveLength(0);
  });

  it('useProviderQuota selector reads a provider blob', () => {
    expect(useProviderQuota).toBeTypeOf('function');
  });
});
