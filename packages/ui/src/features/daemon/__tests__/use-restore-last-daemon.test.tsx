import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { DaemonMeta } from '@qlan-ro/mainframe-types';
import { useRestoreLastDaemon, __resetRestoreGuardForTests } from '../use-restore-last-daemon';
import { getLastDaemonId, setLastDaemonId } from '@/lib/daemon/last-daemon';
import type { UseDaemonRegistryResult } from '../use-daemon-registry';

const LOCAL: DaemonMeta = { id: 'local', kind: 'local', label: 'This Mac', host: '127.0.0.1:31415' };
const STUDIO: DaemonMeta = { id: 'studio', kind: 'remote', label: 'Studio', host: 'studio.example.com' };

function makeRegistry(over: Partial<UseDaemonRegistryResult>): UseDaemonRegistryResult {
  return {
    daemons: [LOCAL],
    activeId: 'local',
    reload: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    switchTo: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

beforeEach(() => {
  __resetRestoreGuardForTests();
  localStorage.clear();
});

describe('last-daemon storage', () => {
  it('round-trips the id', () => {
    expect(getLastDaemonId()).toBeNull();
    setLastDaemonId('studio');
    expect(getLastDaemonId()).toBe('studio');
  });
});

describe('useRestoreLastDaemon', () => {
  it('switches to the saved remote once, when it is in the registry', () => {
    setLastDaemonId('studio');
    const reg = makeRegistry({ daemons: [LOCAL, STUDIO], activeId: 'local' });
    renderHook(() => useRestoreLastDaemon(reg));
    expect(reg.switchTo).toHaveBeenCalledTimes(1);
    expect(reg.switchTo).toHaveBeenCalledWith('studio');
  });

  it('does not switch when the saved daemon is local', () => {
    setLastDaemonId('local');
    const reg = makeRegistry({ daemons: [LOCAL, STUDIO], activeId: 'local' });
    renderHook(() => useRestoreLastDaemon(reg));
    expect(reg.switchTo).not.toHaveBeenCalled();
  });

  it('does not switch when nothing was saved', () => {
    const reg = makeRegistry({ daemons: [LOCAL, STUDIO], activeId: 'local' });
    renderHook(() => useRestoreLastDaemon(reg));
    expect(reg.switchTo).not.toHaveBeenCalled();
  });

  it('waits (no switch) until the saved remote appears in the registry', () => {
    setLastDaemonId('studio');
    const reg = makeRegistry({ daemons: [LOCAL], activeId: 'local' }); // studio not loaded yet
    renderHook(() => useRestoreLastDaemon(reg));
    expect(reg.switchTo).not.toHaveBeenCalled();
  });

  it('does not re-switch when already active on the saved daemon', () => {
    setLastDaemonId('studio');
    const reg = makeRegistry({ daemons: [LOCAL, STUDIO], activeId: 'studio' });
    renderHook(() => useRestoreLastDaemon(reg));
    expect(reg.switchTo).not.toHaveBeenCalled();
  });
});
