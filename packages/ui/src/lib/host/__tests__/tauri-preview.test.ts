// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RegionSelectResult } from '@qlan-ro/mainframe-types';

const previewCreate = vi.fn().mockResolvedValue(undefined);
const previewNavigate = vi.fn().mockResolvedValue(undefined);
const previewSetBounds = vi.fn().mockResolvedValue(undefined);
const previewSetVisible = vi.fn().mockResolvedValue(undefined);
const previewCapture = vi.fn().mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
const previewDestroy = vi.fn().mockResolvedValue(undefined);
const previewEval = vi.fn().mockResolvedValue(undefined);
const onInspectResult = vi.fn().mockResolvedValue(() => {});

// Captures the last callback registered via onRegionSelectResult so tests can
// emit synthetic events and verify the tabId filter in onRegionSelect.
let capturedRegionCallback: ((result: RegionSelectResult) => void) | null = null;
const onRegionSelectResult = vi.fn().mockImplementation((cb: (result: RegionSelectResult) => void) => {
  capturedRegionCallback = cb;
  return Promise.resolve(() => {
    capturedRegionCallback = null;
  });
});

let capturedNavigateCallback: ((result: { tabId: string; url: string }) => void) | null = null;
const onNavigateResult = vi.fn().mockImplementation((cb: (result: { tabId: string; url: string }) => void) => {
  capturedNavigateCallback = cb;
  return Promise.resolve(() => {
    capturedNavigateCallback = null;
  });
});

vi.mock('@/lib/tauri/preview', () => ({
  previewCreate: (...a: unknown[]) => previewCreate(...a),
  previewNavigate: (...a: unknown[]) => previewNavigate(...a),
  previewSetBounds: (...a: unknown[]) => previewSetBounds(...a),
  previewSetVisible: (...a: unknown[]) => previewSetVisible(...a),
  previewCapture: (...a: unknown[]) => previewCapture(...a),
  previewDestroy: (...a: unknown[]) => previewDestroy(...a),
  previewEval: (...a: unknown[]) => previewEval(...a),
  onInspectResult: (...a: unknown[]) => onInspectResult(...a),
  onRegionSelectResult: (...a: unknown[]) => onRegionSelectResult(...a),
  onNavigateResult: (...a: unknown[]) => onNavigateResult(...a),
}));

beforeEach(() => {
  previewCreate.mockReset().mockResolvedValue(undefined);
  previewNavigate.mockReset().mockResolvedValue(undefined);
  previewSetBounds.mockReset().mockResolvedValue(undefined);
  previewSetVisible.mockReset().mockResolvedValue(undefined);
  previewCapture.mockReset().mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
  previewDestroy.mockReset().mockResolvedValue(undefined);
  previewEval.mockReset().mockResolvedValue(undefined);
  onInspectResult.mockReset().mockResolvedValue(() => {});
  capturedRegionCallback = null;
  onRegionSelectResult.mockReset().mockImplementation((cb: (result: RegionSelectResult) => void) => {
    capturedRegionCallback = cb;
    return Promise.resolve(() => {
      capturedRegionCallback = null;
    });
  });
  capturedNavigateCallback = null;
  onNavigateResult.mockReset().mockImplementation((cb: (result: { tabId: string; url: string }) => void) => {
    capturedNavigateCallback = cb;
    return Promise.resolve(() => {
      capturedNavigateCallback = null;
    });
  });
});

/** Flush the per-handle op chain (each op is a then-link; a macrotask drains them all). */
const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeContainer(rect: Partial<DOMRect> = {}): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 400, ...rect }) as DOMRect;
  // Ops that read bounds skip detached anchors — tests need a connected node.
  document.body.appendChild(el);
  return el;
}

describe('mountTauriPreview', () => {
  it('mount() calls previewCreate with the container rect bounds', async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    mountTauriPreview(fakeContainer(), 'http://localhost:3000', { projectId: 'p1' });
    // mount is sync, create fires async — flush microtasks
    await Promise.resolve();
    expect(previewCreate).toHaveBeenCalledWith(expect.any(String), 'http://localhost:3000', {
      x: 10,
      y: 20,
      w: 300,
      h: 400,
    });
  });

  it('navigate() delegates to previewNavigate', async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    const handle = mountTauriPreview(fakeContainer(), 'http://localhost:3000');
    await Promise.resolve();
    await handle.navigate('http://localhost:4000');
    expect(previewNavigate).toHaveBeenCalledWith(expect.any(String), 'http://localhost:4000');
  });

  it('capture() returns a Uint8Array', async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    const handle = mountTauriPreview(fakeContainer(), 'http://x');
    await Promise.resolve();
    const bytes = await handle.capture();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([137, 80, 78, 71]);
  });

  it('destroy() calls previewDestroy', async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    const handle = mountTauriPreview(fakeContainer(), 'http://x');
    await flush();
    handle.destroy();
    await flush();
    expect(previewDestroy).toHaveBeenCalledWith(expect.any(String));
  });

  it('setDevice re-issues previewSetBounds with the current container rect', async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    const container = fakeContainer({ left: 5, top: 6, width: 320, height: 480 });
    const handle = mountTauriPreview(container, 'http://x');
    previewSetBounds.mockClear();
    handle.setDevice('mobile');
    await flush();
    expect(previewSetBounds).toHaveBeenCalledWith(expect.any(String), { x: 5, y: 6, w: 320, h: 480 });
  });

  it('queues setVisible behind previewCreate (never fires before the tab exists)', async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    let resolveCreate: () => void = () => {};
    previewCreate.mockReset().mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolveCreate = r;
        }),
    );
    const handle = mountTauriPreview(fakeContainer(), 'http://x');
    handle.setVisible(false);
    await flush();
    // create is still pending — the visibility op must wait for it.
    expect(previewSetVisible).not.toHaveBeenCalled();
    resolveCreate();
    await flush();
    expect(previewSetVisible).toHaveBeenCalledWith(expect.any(String), false);
  });

  it('queues destroy behind previewCreate (a raced destroy would orphan the webview)', async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    let resolveCreate: () => void = () => {};
    previewCreate.mockReset().mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolveCreate = r;
        }),
    );
    const handle = mountTauriPreview(fakeContainer(), 'http://x');
    handle.destroy();
    await flush();
    expect(previewDestroy).not.toHaveBeenCalled();
    resolveCreate();
    await flush();
    expect(previewDestroy).toHaveBeenCalledWith(expect.any(String));
  });

  it('keeps the op chain alive after a failed op', async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    previewSetVisible.mockRejectedValueOnce(new Error('boom'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handle = mountTauriPreview(fakeContainer(), 'http://x');
    handle.setVisible(false);
    handle.setVisible(true);
    await flush();
    expect(previewSetVisible).toHaveBeenCalledTimes(2);
    expect(previewSetVisible).toHaveBeenLastCalledWith(expect.any(String), true);
    warn.mockRestore();
  });

  it('reanchor() switches the bounds source for later refits', async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    const handle = mountTauriPreview(fakeContainer(), 'http://x');
    await flush();
    const next = fakeContainer({ left: 50, top: 60, width: 230, height: 420 });
    previewSetBounds.mockClear();
    handle.reanchor?.(next);
    await flush();
    expect(previewSetBounds).toHaveBeenCalledWith(expect.any(String), { x: 50, y: 60, w: 230, h: 420 });
  });

  it('refit() skips a detached anchor instead of sending a 0-rect', async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    const container = fakeContainer();
    const handle = mountTauriPreview(container, 'http://x');
    await flush();
    container.remove();
    previewSetBounds.mockClear();
    handle.refit();
    await flush();
    expect(previewSetBounds).not.toHaveBeenCalled();
  });

  it('startRegionSelect evals the region installer for this tab', async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    const handle = mountTauriPreview(document.createElement('div'), 'http://x');
    await Promise.resolve();
    const tabId = (previewCreate.mock.calls[0] as unknown[])?.[0] as string;
    await handle.startRegionSelect();
    expect(previewEval).toHaveBeenCalledWith(
      expect.stringContaining(tabId),
      expect.stringContaining('__mfRegionSelectInstall'),
    );
  });

  it("onRegionSelect delivers only this tab's region events", async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    const handle = mountTauriPreview(document.createElement('div'), 'http://x');

    const received: RegionSelectResult[] = [];
    handle.onRegionSelect((r) => received.push(r));

    // Flush microtasks so the onRegionSelectResult Promise resolves and unlisten is set
    await Promise.resolve();

    // Emit an event for a different tab — must be filtered out
    capturedRegionCallback?.({ tabId: 'preview-OTHER', region: { x: 0, y: 0, w: 1, h: 1 } });
    // Emit an event for this tab — must be delivered
    // The tabId is passed to previewCreate as the first arg
    const tabId = (previewCreate.mock.calls[0] as unknown[])?.[0] as string;
    capturedRegionCallback?.({ tabId, region: { x: 1, y: 2, w: 3, h: 4 } });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ tabId, region: { x: 1, y: 2, w: 3, h: 4 } });
  });

  it('onRegionSelect returns an unsubscribe that stops delivery', async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    const handle = mountTauriPreview(document.createElement('div'), 'http://x');
    const tabId = ((previewCreate.mock.calls[0] as unknown[])?.[0] as string) ?? 'preview-1';

    const received: RegionSelectResult[] = [];
    const unsub = handle.onRegionSelect((r) => received.push(r));

    await Promise.resolve();
    unsub();
    await Promise.resolve();

    capturedRegionCallback?.({ tabId, region: { x: 5, y: 6, w: 7, h: 8 } });
    expect(received).toHaveLength(0);
  });

  it('onNavigate forwards only events whose tabId matches this tab', async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    const handle = mountTauriPreview(fakeContainer(), 'http://localhost:3000', { projectId: 'p1' });
    await Promise.resolve();
    const calls = previewCreate.mock.calls;
    const tabId = (calls[calls.length - 1] as unknown[])[0] as string;
    const received: string[] = [];
    handle.onNavigate((url) => received.push(url));
    await Promise.resolve();
    capturedNavigateCallback!({ tabId: `${tabId}-WRONG`, url: 'http://other/' });
    capturedNavigateCallback!({ tabId, url: 'http://localhost:3000/x' });
    expect(received).toEqual(['http://localhost:3000/x']);
  });
});
