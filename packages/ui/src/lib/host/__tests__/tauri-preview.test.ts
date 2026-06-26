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
});

function fakeContainer(): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 400 }) as DOMRect;
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
    await Promise.resolve();
    handle.destroy();
    await Promise.resolve();
    expect(previewDestroy).toHaveBeenCalledWith(expect.any(String));
  });

  it('setDevice re-issues previewSetBounds with the current container rect', async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({ left: 5, top: 6, width: 320, height: 480 }) as DOMRect;
    const handle = mountTauriPreview(container, 'http://x');
    previewSetBounds.mockClear();
    handle.setDevice('mobile');
    expect(previewSetBounds).toHaveBeenCalledWith(expect.any(String), { x: 5, y: 6, w: 320, h: 480 });
  });

  it('startRegionSelect evals the region installer for this tab', async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    const handle = mountTauriPreview(document.createElement('div'), 'http://x');
    await handle.startRegionSelect();
    expect(previewEval).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('__mfRegionSelectInstall'));
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
    const tabIdArg = previewEval.mock.calls[0]?.[0] ?? (onRegionSelectResult.mock.calls[0] as unknown[])?.[0];
    // The tabId is passed to previewCreate as the first arg
    const tabId = (previewCreate.mock.calls[0] as unknown[])?.[0] as string;
    capturedRegionCallback?.({ tabId, region: { x: 1, y: 2, w: 3, h: 4 } });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ tabId, region: { x: 1, y: 2, w: 3, h: 4 } });
    void tabIdArg; // suppress unused warning
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
});
