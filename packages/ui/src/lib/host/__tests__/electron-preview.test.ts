// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountElectronPreview, scaleCropRect } from '../electron-preview';

let destroyWebview: ReturnType<typeof vi.fn>;

beforeEach(() => {
  destroyWebview = vi.fn().mockResolvedValue(undefined);
  (globalThis as unknown as { window: { mainframe: unknown } }).window = Object.assign(
    (globalThis as unknown as { window?: object }).window ?? {},
    {
      mainframe: { destroyWebview, clearSandboxSession: vi.fn() },
    },
  );
});

afterEach(() => {
  delete (globalThis.window as unknown as Record<string, unknown>).mainframe;
});

describe('scaleCropRect', () => {
  it('multiplies CSS-px region by zoom for device px', () => {
    expect(scaleCropRect({ x: 10, y: 20, width: 30, height: 40 }, 2)).toEqual({
      x: 20,
      y: 40,
      width: 60,
      height: 80,
    });
  });

  it('rounds fractional device-px values', () => {
    expect(scaleCropRect({ x: 1, y: 1, width: 1, height: 1 }, 1.5)).toEqual({
      x: 2,
      y: 2,
      width: 2,
      height: 2,
    });
  });

  it('returns zero dimensions for zero input', () => {
    expect(scaleCropRect({ x: 0, y: 0, width: 0, height: 0 }, 3)).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });
});

describe('mountElectronPreview', () => {
  it('appends a <webview> with the per-project partition into the container', () => {
    const container = document.createElement('div');
    mountElectronPreview(container, 'http://localhost:3000', { projectId: 'p1' });
    const wv = container.querySelector('webview');
    expect(wv).not.toBeNull();
    expect(wv!.getAttribute('partition')).toBe('persist:sandbox-p1');
  });

  it('falls back to the default partition when projectId is absent', () => {
    const container = document.createElement('div');
    mountElectronPreview(container, 'http://x');
    expect(container.querySelector('webview')!.getAttribute('partition')).toBe('persist:sandbox-default');
  });

  it('sets position:absolute and fills the container via inset:0', () => {
    const container = document.createElement('div');
    mountElectronPreview(container, 'http://x', { projectId: 'p1' });
    const wv = container.querySelector('webview') as HTMLElement;
    expect(wv!.style.position).toBe('absolute');
    expect(wv!.style.width).toBe('100%');
    expect(wv!.style.height).toBe('100%');
  });

  it('sets initial src to about:blank (real URL loaded on dom-ready)', () => {
    const container = document.createElement('div');
    mountElectronPreview(container, 'http://localhost:3000', { projectId: 'p1' });
    const wv = container.querySelector('webview');
    expect(wv!.getAttribute('src')).toBe('about:blank');
  });

  it('setVisible(false) hides the element', () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });
    handle.setVisible(false);
    const wv = container.querySelector('webview') as HTMLElement;
    expect(wv.style.display).toBe('none');
  });

  it('setVisible(true) restores the element', () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });
    handle.setVisible(false);
    handle.setVisible(true);
    const wv = container.querySelector('webview') as HTMLElement;
    expect(wv.style.display).toBe('');
  });

  it('setDevice("mobile") sets width to 390px', () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });
    handle.setDevice('mobile');
    const wv = container.querySelector('webview') as HTMLElement;
    expect(wv.style.width).toBe('390px');
  });

  it('setDevice("desktop") restores full width', () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });
    handle.setDevice('mobile');
    handle.setDevice('desktop');
    const wv = container.querySelector('webview') as HTMLElement;
    expect(wv.style.width).toBe('100%');
  });

  it('onInspect unsubscribe stops delivery of a fired pick', async () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });
    const cb = vi.fn();
    const unsub = handle.onInspect(cb);
    unsub();
    const wv = container.querySelector('webview') as HTMLElement & {
      executeJavaScript: (js: string) => Promise<unknown>;
    };
    wv.executeJavaScript = () =>
      Promise.resolve({
        selector: '#btn',
        rect: { x: 5, y: 10, width: 50, height: 20 },
        viewport: { width: 800, height: 600 },
      });
    await handle.startInspect();
    expect(cb).not.toHaveBeenCalled();
  });

  it('onInspect multiple subscribers all receive a fired pick', async () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    handle.onInspect(cb1);
    handle.onInspect(cb2);
    const wv = container.querySelector('webview') as HTMLElement & {
      executeJavaScript: (js: string) => Promise<unknown>;
    };
    wv.executeJavaScript = () =>
      Promise.resolve({
        selector: '#btn',
        rect: { x: 5, y: 10, width: 50, height: 20 },
        viewport: { width: 800, height: 600 },
      });
    await handle.startInspect();
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
    expect(cb1.mock.calls[0]![0]).toMatchObject({ selector: '#btn' });
  });

  it('navigate resolves without throwing when loadURL is absent (jsdom fallback)', async () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });
    // jsdom <webview> has no loadURL method; navigate should resolve gracefully
    await expect(handle.navigate('http://new-url')).resolves.toBeUndefined();
  });

  it('destroy removes the element', () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });
    expect(container.querySelector('webview')).not.toBeNull();
    handle.destroy();
    expect(container.querySelector('webview')).toBeNull();
  });

  it('destroy tolerates missing getWebContentsId (jsdom)', () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });
    // getWebContentsId is not on a jsdom element — destroy must not throw
    expect(() => handle.destroy()).not.toThrow();
    expect(container.querySelector('webview')).toBeNull();
  });

  it('capture throws when capturePage is unavailable (jsdom)', async () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });
    await expect(handle.capture()).rejects.toThrow('capturePage unavailable');
  });

  it('capture with a mock capturePage applies DPR scaling', async () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });

    // Inject mock methods onto the webview element
    const wv = container.querySelector('webview') as HTMLElement & {
      capturePage: (rect?: unknown) => Promise<{ toDataURL(): string }>;
      getZoomFactor: () => number;
    };

    const capturedRects: unknown[] = [];
    wv.capturePage = (rect?: unknown) => {
      capturedRects.push(rect);
      // Return a minimal valid PNG data URL (1x1 transparent pixel)
      const png1x1 =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      return Promise.resolve({ toDataURL: () => png1x1 });
    };
    wv.getZoomFactor = () => 2;

    const region = { x: 10, y: 20, w: 30, h: 40 };
    const bytes = await handle.capture(region);

    // DPR=2 applied: 10*2=20, 20*2=40, 30*2=60, 40*2=80
    expect(capturedRects[0]).toEqual({ x: 20, y: 40, width: 60, height: 80 });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('capture without a region passes undefined to capturePage', async () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });

    const wv = container.querySelector('webview') as HTMLElement & {
      capturePage: (rect?: unknown) => Promise<{ toDataURL(): string }>;
    };

    const capturedRects: unknown[] = [];
    wv.capturePage = (rect?: unknown) => {
      capturedRects.push(rect);
      const png =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      return Promise.resolve({ toDataURL: () => png });
    };

    await handle.capture();
    expect(capturedRects[0]).toBeUndefined();
  });

  it('startInspect fans out the pick result to onInspect subscribers', async () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });

    const received: unknown[] = [];
    handle.onInspect((r) => received.push(r));

    // Mock executeJavaScript to return a fake element-pick result
    const wv = container.querySelector('webview') as HTMLElement & {
      executeJavaScript: (js: string) => Promise<unknown>;
    };
    wv.executeJavaScript = () =>
      Promise.resolve({
        selector: '#btn',
        rect: { x: 5, y: 10, width: 50, height: 20 },
        viewport: { width: 800, height: 600 },
      });

    await handle.startInspect();

    expect(received).toHaveLength(1);
    const result = received[0] as {
      tabId: string;
      selector: string;
      rect: { x: number; y: number; w: number; h: number };
      viewport: { x: number; y: number; w: number; h: number };
    };
    expect(result.selector).toBe('#btn');
    expect(result.rect).toEqual({ x: 5, y: 10, w: 50, h: 20 });
    expect(result.viewport).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });

  it('startInspect with null pick result delivers null selector/rect/viewport', async () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });

    const received: unknown[] = [];
    handle.onInspect((r) => received.push(r));

    const wv = container.querySelector('webview') as HTMLElement & {
      executeJavaScript: (js: string) => Promise<unknown>;
    };
    wv.executeJavaScript = () => Promise.resolve(null);

    await handle.startInspect();

    expect(received).toHaveLength(1);
    const result = received[0] as { selector: null; rect: null; viewport: null };
    expect(result.selector).toBeNull();
    expect(result.rect).toBeNull();
    expect(result.viewport).toBeNull();
  });

  it('startRegionSelect fans out the selected region to onRegionSelect subscribers', async () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });
    const received: unknown[] = [];
    handle.onRegionSelect((r) => received.push(r));
    const wv = container.querySelector('webview') as HTMLElement & {
      executeJavaScript: (js: string) => Promise<unknown>;
    };
    wv.executeJavaScript = () => Promise.resolve({ region: { x: 10, y: 20, w: 30, h: 40 } });
    await handle.startRegionSelect();
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ tabId: expect.any(String), region: { x: 10, y: 20, w: 30, h: 40 } });
  });

  it('startRegionSelect with a null/cancelled result delivers region: null', async () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });
    const received: unknown[] = [];
    handle.onRegionSelect((r) => received.push(r));
    const wv = container.querySelector('webview') as HTMLElement & {
      executeJavaScript: (js: string) => Promise<unknown>;
    };
    wv.executeJavaScript = () => Promise.resolve({ region: null });
    await handle.startRegionSelect();
    expect(received).toEqual([{ tabId: expect.any(String), region: null }]);
  });

  it('onRegionSelect unsubscribe stops delivery', async () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });
    const cb = vi.fn();
    const unsub = handle.onRegionSelect(cb);
    unsub();
    const wv = container.querySelector('webview') as HTMLElement & {
      executeJavaScript: (js: string) => Promise<unknown>;
    };
    wv.executeJavaScript = () => Promise.resolve({ region: { x: 0, y: 0, w: 5, h: 5 } });
    await handle.startRegionSelect();
    expect(cb).not.toHaveBeenCalled();
  });

  it('onNavigate fires when the webview emits did-navigate-in-page', () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });
    const received: string[] = [];
    handle.onNavigate((url) => received.push(url));
    const wv = container.querySelector('webview') as HTMLElement;
    wv.dispatchEvent(Object.assign(new Event('did-navigate-in-page'), { url: 'http://x/dashboard' }));
    expect(received).toEqual(['http://x/dashboard']);
  });

  it('onNavigate fires on full-page did-navigate', () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });
    const received: string[] = [];
    handle.onNavigate((url) => received.push(url));
    const wv = container.querySelector('webview') as HTMLElement;
    wv.dispatchEvent(Object.assign(new Event('did-navigate'), { url: 'http://x/other' }));
    expect(received).toEqual(['http://x/other']);
  });

  it('onNavigate unsubscribe stops delivery', () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });
    const cb = vi.fn();
    const unsub = handle.onNavigate(cb);
    unsub();
    const wv = container.querySelector('webview') as HTMLElement;
    wv.dispatchEvent(Object.assign(new Event('did-navigate'), { url: 'http://x/y' }));
    expect(cb).not.toHaveBeenCalled();
  });

  it('cancelInspect tears down the injected inspect picker', async () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });
    const wv = container.querySelector('webview') as HTMLElement & {
      executeJavaScript: (js: string) => Promise<unknown>;
    };
    const spy = vi.fn((_js: string) => Promise.resolve(undefined));
    wv.executeJavaScript = spy;
    await handle.cancelInspect?.();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toContain('__mf_inspect_cleanup');
  });

  it('cancelRegionSelect tears down the injected region picker', async () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });
    const wv = container.querySelector('webview') as HTMLElement & {
      executeJavaScript: (js: string) => Promise<unknown>;
    };
    const spy = vi.fn((_js: string) => Promise.resolve(undefined));
    wv.executeJavaScript = spy;
    await handle.cancelRegionSelect?.();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toContain('__mf_region_cleanup');
  });

  it('clearCache clears storage/caches then reloads ignoring the HTTP cache', async () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });
    const wv = container.querySelector('webview') as HTMLElement & {
      executeJavaScript: (js: string) => Promise<unknown>;
      reloadIgnoringCache: () => void;
    };
    const evalSpy = vi.fn((_js: string) => Promise.resolve(undefined));
    const reloadSpy = vi.fn();
    wv.executeJavaScript = evalSpy;
    wv.reloadIgnoringCache = reloadSpy;
    await handle.clearCache?.();
    expect(evalSpy).toHaveBeenCalledTimes(1);
    expect(evalSpy.mock.calls[0]![0]).toContain('caches.delete');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
