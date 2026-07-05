import { describe, it, expect, vi } from 'vitest';
import { AdapterRegistry } from '../index.js';
import type { Adapter, AdapterModel, DaemonEvent } from '@qlan-ro/mainframe-types';

function fakeAdapter(over: Partial<Adapter> & { probeResult?: AdapterModel[] | null } = {}): Adapter {
  const fallback: AdapterModel[] = [{ id: 'fb', label: 'Fallback' }];
  return {
    id: 'claude',
    name: 'Claude',
    capabilities: { planMode: true },
    isInstalled: vi.fn().mockResolvedValue(true),
    getVersion: vi.fn().mockResolvedValue('1.0.0'),
    getFallbackModels: vi.fn().mockReturnValue(fallback),
    listModels: vi.fn().mockResolvedValue(fallback),
    probeModels: vi.fn().mockResolvedValue(over.probeResult ?? null),
    createSession: vi.fn(),
    killAll: vi.fn(),
    ...over,
  } as unknown as Adapter;
}

const deps = (emit: (e: DaemonEvent) => void, path: string | undefined = '/abs/claude') => ({
  resolveExecutablePath: async () => path,
  run: async () => ({ ok: true, stdout: 'claude 2.0.0' }),
  emitEvent: emit,
});

describe('AdapterRegistry catalog materialization', () => {
  it('seeds statically without spawning (no isInstalled/getVersion/listModels calls)', () => {
    const a = fakeAdapter();
    const reg = new AdapterRegistry();
    reg.register(a);
    reg.seedStaticSnapshots();
    const snaps = reg.getSnapshots();
    expect(snaps[0]!.catalogSource).toBe('fallback');
    expect(snaps[0]!.modelsRevision).toBe(1);
    expect(a.isInstalled as any).not.toHaveBeenCalled();
    expect(a.getVersion as any).not.toHaveBeenCalled();
    expect(a.listModels as any).not.toHaveBeenCalled();
  });

  it('REFUSES to refresh until allowRefresh() (blocker #1: no pre-backfill probe)', async () => {
    const a = fakeAdapter({ probeResult: [{ id: 'live', label: 'Live' }] });
    const events: DaemonEvent[] = [];
    const reg = new AdapterRegistry();
    reg.register(a);
    reg.seedStaticSnapshots();
    reg.configureRefresh(deps((e) => events.push(e)));
    await reg.list(); // refresh not allowed yet
    expect(a.probeModels as any).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
    expect(reg.getSnapshots()[0]!.catalogSource).toBe('fallback');
  });

  it('bumps revision, flips catalogSource, and emits after allowRefresh()', async () => {
    const probed: AdapterModel[] = [{ id: 'live', label: 'Live' }];
    const a = fakeAdapter({ probeResult: probed });
    const events: DaemonEvent[] = [];
    const reg = new AdapterRegistry();
    reg.register(a);
    reg.seedStaticSnapshots();
    reg.configureRefresh(deps((e) => events.push(e)));
    reg.allowRefresh();
    await reg.refreshAll();
    const info = reg.getSnapshots()[0]!;
    expect(info.catalogSource).toBe('probed');
    expect(info.modelsRevision).toBe(2);
    expect(info.models).toEqual(probed);
    expect(events).toContainEqual({
      type: 'adapter.models.updated',
      adapterId: 'claude',
      models: probed,
      modelsRevision: 2,
    });
    expect(a.probeModels as any).toHaveBeenCalledWith('/abs/claude');
  });

  it('latches per-adapter: a failed adapter retries while a succeeded one does not (blocker #5)', async () => {
    const ok = fakeAdapter({ probeResult: [{ id: 'ok', label: 'OK' }] });
    const bad = fakeAdapter();
    (bad as any).id = 'codex';
    (bad as any).name = 'Codex';
    (bad as any).probeModels = undefined;
    (bad as any).listModels = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'c', label: 'C' }]);
    (bad as any).getFallbackModels = () => [];
    const reg = new AdapterRegistry();
    reg.register(ok);
    reg.register(bad);
    reg.seedStaticSnapshots();
    reg.configureRefresh(deps(() => {}));
    reg.allowRefresh();
    await reg.refreshAll(); // ok succeeds+latches; codex returns [] (no live models) → not latched
    await reg.refreshAll(); // ok skipped (latched); codex retries → succeeds
    expect((ok.probeModels as any).mock.calls.length).toBe(1);
    expect((bad as any).listModels.mock.calls.length).toBe(2);
  });

  it('skips live discovery for an uninstalled adapter (blocker #9: no wasted 30s Codex spawn)', async () => {
    // A genuinely-uninstalled CLI adapter fails BOTH the registry's own `--version` spawn AND
    // its own isInstalled() (which independently re-resolves the same binary) — unlike a
    // plugin-provided adapter, which has no CLI binary but still reports installed:true itself.
    const a = fakeAdapter({
      probeResult: [{ id: 'live', label: 'Live' }],
      isInstalled: vi.fn().mockResolvedValue(false),
    });
    const reg = new AdapterRegistry();
    reg.register(a);
    reg.seedStaticSnapshots();
    // --version fails → installed === false → no probe.
    reg.configureRefresh({
      resolveExecutablePath: async () => undefined,
      run: async () => ({ ok: false, stdout: '' }),
      emitEvent: () => {},
    });
    reg.allowRefresh();
    await reg.refreshAll();
    expect(a.probeModels as any).not.toHaveBeenCalled();
    expect(reg.getSnapshots()[0]!.installed).toBe(false);
    expect(reg.getSnapshots()[0]!.catalogSource).toBe('fallback');
  });
});
