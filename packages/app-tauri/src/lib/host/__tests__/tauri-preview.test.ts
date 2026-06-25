import { describe, it, expect, vi, beforeEach } from 'vitest';

const previewCreate = vi.fn().mockResolvedValue(undefined);
const previewNavigate = vi.fn().mockResolvedValue(undefined);
const previewSetBounds = vi.fn().mockResolvedValue(undefined);
const previewSetVisible = vi.fn().mockResolvedValue(undefined);
const previewCapture = vi.fn().mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
const previewDestroy = vi.fn().mockResolvedValue(undefined);
const previewEval = vi.fn().mockResolvedValue(undefined);
const onInspectResult = vi.fn().mockResolvedValue(() => {});

vi.mock('@/lib/tauri/preview', () => ({
  previewCreate: (...a: unknown[]) => previewCreate(...a),
  previewNavigate: (...a: unknown[]) => previewNavigate(...a),
  previewSetBounds: (...a: unknown[]) => previewSetBounds(...a),
  previewSetVisible: (...a: unknown[]) => previewSetVisible(...a),
  previewCapture: (...a: unknown[]) => previewCapture(...a),
  previewDestroy: (...a: unknown[]) => previewDestroy(...a),
  previewEval: (...a: unknown[]) => previewEval(...a),
  onInspectResult: (...a: unknown[]) => onInspectResult(...a),
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
});
