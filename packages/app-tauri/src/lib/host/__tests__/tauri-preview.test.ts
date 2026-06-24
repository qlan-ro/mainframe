import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const invoke = vi.fn();
const listen = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: (...a: unknown[]) => listen(...a) }));

beforeEach(() => {
  (globalThis as Record<string, unknown>).window = Object.assign(globalThis.window ?? {}, { __TAURI_INTERNALS__: {} });
  invoke.mockReset().mockResolvedValue(undefined);
  listen.mockReset().mockResolvedValue(() => {});
});
afterEach(() => {
  delete (globalThis.window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

function fakeContainer(): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 400 }) as DOMRect;
  return el;
}

describe('mountTauriPreview', () => {
  it('mount() calls preview_create with the container rect bounds', async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    mountTauriPreview(fakeContainer(), 'http://localhost:3000', { projectId: 'p1' });
    // mount is sync, create fires async — flush microtasks
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledWith(
      'preview_create',
      expect.objectContaining({ url: 'http://localhost:3000', bounds: { x: 10, y: 20, w: 300, h: 400 } }),
    );
  });

  it('navigate() delegates to preview_navigate', async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    const handle = mountTauriPreview(fakeContainer(), 'http://localhost:3000');
    await Promise.resolve();
    invoke.mockClear();
    await handle.navigate('http://localhost:4000');
    expect(invoke).toHaveBeenCalledWith('preview_navigate', expect.objectContaining({ url: 'http://localhost:4000' }));
  });

  it('capture() wraps the invoke number[] as a Uint8Array', async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    const handle = mountTauriPreview(fakeContainer(), 'http://x');
    await Promise.resolve();
    invoke.mockResolvedValueOnce([137, 80, 78, 71]);
    const bytes = await handle.capture();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([137, 80, 78, 71]);
  });

  it('destroy() calls preview_destroy', async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    const handle = mountTauriPreview(fakeContainer(), 'http://x');
    await Promise.resolve();
    invoke.mockClear();
    handle.destroy();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledWith('preview_destroy', expect.objectContaining({ tabId: expect.any(String) }));
  });
});
