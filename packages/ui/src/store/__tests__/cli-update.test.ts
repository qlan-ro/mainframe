import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderCliStatus } from '@qlan-ro/mainframe-types';

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
  useCliUpdateStore,
  applyProviderCliStatus,
  applyProviderCliUpdateStarted,
  seedProviderCliStatuses,
  resetProviderCliStatuses,
  useProviderCliStatus,
  useAnyProviderCliUpdateAvailable,
  installProviderCliStatusSubscriber,
} from '../cli-update.js';

const status = (adapterId: string, overrides: Partial<ProviderCliStatus> = {}): ProviderCliStatus => ({
  adapterId,
  installedVersion: '1.0.0',
  latestVersion: '1.0.0',
  updateAvailable: false,
  installMethod: 'homebrew',
  updateCommand: 'brew upgrade claude-code',
  canUpdate: true,
  checkFailed: false,
  ...overrides,
});

describe('ui cli-update store', () => {
  beforeEach(() => {
    resetProviderCliStatuses();
    handlers.clear();
  });

  it('applies a status blob under its adapter id', () => {
    applyProviderCliStatus(status('claude', { installedVersion: '1.2.3' }));
    expect(useCliUpdateStore.getState().byId.claude!.installedVersion).toBe('1.2.3');
  });

  it('a later apply wholesale-replaces the earlier one (no partial merge)', () => {
    applyProviderCliStatus(
      status('claude', { installedVersion: '1.2.3', updateAvailable: true, latestVersion: '2.0.0' }),
    );
    applyProviderCliStatus(status('claude', { installedVersion: '2.0.0', updateAvailable: false }));
    const cur = useCliUpdateStore.getState().byId.claude!;
    expect(cur.installedVersion).toBe('2.0.0');
    expect(cur.updateAvailable).toBe(false);
    expect(cur.latestVersion).toBe('1.0.0'); // from the second call's defaults, not merged from the first
  });

  it('seeds a whole list in one state update, keyed by adapterId', () => {
    seedProviderCliStatuses([status('claude'), status('codex', { updateAvailable: true, latestVersion: '9.9.9' })]);
    const { byId } = useCliUpdateStore.getState();
    expect(byId.claude!.adapterId).toBe('claude');
    expect(byId.codex!.updateAvailable).toBe(true);
  });

  it('the subscriber applies provider.cli.updated events and ignores other event types', () => {
    const unsub = installProviderCliStatusSubscriber();
    handlers.forEach((h) => h({ type: 'adapter.models.updated', adapterId: 'claude', models: [], modelsRevision: 1 }));
    expect(useCliUpdateStore.getState().byId.claude).toBeUndefined();
    handlers.forEach((h) => h({ type: 'provider.cli.updated', status: status('codex', { updateAvailable: true }) }));
    expect(useCliUpdateStore.getState().byId.codex!.updateAvailable).toBe(true);
    unsub();
  });

  it('reset clears the store', () => {
    applyProviderCliStatus(status('claude'));
    resetProviderCliStatuses();
    expect(Object.keys(useCliUpdateStore.getState().byId)).toHaveLength(0);
  });

  it('useProviderCliStatus and useAnyProviderCliUpdateAvailable are selector hooks', () => {
    expect(useProviderCliStatus).toBeTypeOf('function');
    expect(useAnyProviderCliUpdateAvailable).toBeTypeOf('function');
  });

  it('useAnyProviderCliUpdateAvailable-backing state is true exactly when some provider has an update', () => {
    seedProviderCliStatuses([
      status('claude', { updateAvailable: false }),
      status('codex', { updateAvailable: false }),
    ]);
    expect(Object.values(useCliUpdateStore.getState().byId).some((s) => s.updateAvailable)).toBe(false);
    applyProviderCliStatus(status('codex', { updateAvailable: true }));
    expect(Object.values(useCliUpdateStore.getState().byId).some((s) => s.updateAvailable)).toBe(true);
  });

  it('the update-start reply never rolls back a push for the same run', () => {
    const run = (state: 'running' | 'succeeded', output: string) => ({
      state,
      output,
      startedAt: 500,
      permissionDenied: false,
    });
    applyProviderCliStatus(status('codex', { update: { ...run('succeeded', 'done\n'), finishedAt: 900 } }));
    applyProviderCliUpdateStarted(status('codex', { update: run('running', '') }));
    expect(useCliUpdateStore.getState().byId.codex?.update?.state).toBe('succeeded');

    applyProviderCliUpdateStarted(status('codex', { update: { ...run('running', ''), startedAt: 1_000 } }));
    expect(useCliUpdateStore.getState().byId.codex?.update?.startedAt).toBe(1_000);
  });

  it('the update-start reply applies when no run is stored yet', () => {
    applyProviderCliStatus(status('codex'));
    applyProviderCliUpdateStarted(
      status('codex', { update: { state: 'running', output: '', startedAt: 500, permissionDenied: false } }),
    );
    expect(useCliUpdateStore.getState().byId.codex?.update?.state).toBe('running');
  });
});
