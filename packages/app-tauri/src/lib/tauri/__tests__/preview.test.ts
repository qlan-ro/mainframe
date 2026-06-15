import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted above the imports below.
// ---------------------------------------------------------------------------
const invoke = vi.fn();
const listen = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: (...a: unknown[]) => listen(...a) }));

// Force IS_TAURI = true for all tests.
beforeEach(() => {
  (globalThis as Record<string, unknown>).window = Object.assign((globalThis as Record<string, unknown>).window ?? {}, {
    __TAURI_INTERNALS__: {},
  });
  invoke.mockReset();
  listen.mockReset();
  invoke.mockResolvedValue(undefined);
});

import {
  previewCreate,
  previewCapture,
  previewNavigate,
  previewSetBounds,
  previewSetVisible,
  previewDestroy,
  previewEval,
  onInspectResult,
} from '../preview';

describe('previewCreate', () => {
  it('invokes preview_create with tabId/url/bounds', async () => {
    await previewCreate('tab-1', 'http://localhost:3000', { x: 0, y: 0, w: 800, h: 600 });
    expect(invoke).toHaveBeenCalledWith('preview_create', {
      tabId: 'tab-1',
      url: 'http://localhost:3000',
      bounds: { x: 0, y: 0, w: 800, h: 600 },
    });
  });
});

describe('previewNavigate', () => {
  it('invokes preview_navigate with tabId and url', async () => {
    await previewNavigate('tab-1', 'http://localhost:3001');
    expect(invoke).toHaveBeenCalledWith('preview_navigate', {
      tabId: 'tab-1',
      url: 'http://localhost:3001',
    });
  });
});

describe('previewSetBounds', () => {
  it('invokes preview_set_bounds with tabId and bounds', async () => {
    await previewSetBounds('tab-1', { x: 10, y: 20, w: 400, h: 300 });
    expect(invoke).toHaveBeenCalledWith('preview_set_bounds', {
      tabId: 'tab-1',
      bounds: { x: 10, y: 20, w: 400, h: 300 },
    });
  });
});

describe('previewSetVisible', () => {
  it('invokes preview_set_visible with tabId and visible flag', async () => {
    await previewSetVisible('tab-1', false);
    expect(invoke).toHaveBeenCalledWith('preview_set_visible', {
      tabId: 'tab-1',
      visible: false,
    });
  });
});

describe('previewCapture', () => {
  it('returns a Uint8Array wrapping the invoke number[]', async () => {
    invoke.mockResolvedValue([137, 80, 78, 71]);
    const bytes = await previewCapture('tab-1');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([137, 80, 78, 71]);
  });

  it('passes region to preview_capture when provided', async () => {
    invoke.mockResolvedValue([]);
    await previewCapture('tab-1', { x: 10, y: 20, w: 100, h: 50 });
    expect(invoke).toHaveBeenCalledWith('preview_capture', {
      tabId: 'tab-1',
      region: { x: 10, y: 20, w: 100, h: 50 },
    });
  });

  it('passes null region when none provided', async () => {
    invoke.mockResolvedValue([]);
    await previewCapture('tab-1');
    expect(invoke).toHaveBeenCalledWith('preview_capture', {
      tabId: 'tab-1',
      region: null,
    });
  });
});

describe('previewDestroy', () => {
  it('invokes preview_destroy with tabId', async () => {
    await previewDestroy('tab-1');
    expect(invoke).toHaveBeenCalledWith('preview_destroy', { tabId: 'tab-1' });
  });
});

describe('previewEval', () => {
  it('invokes preview_eval with tabId and js', async () => {
    await previewEval('tab-1', 'console.log("hi")');
    expect(invoke).toHaveBeenCalledWith('preview_eval', {
      tabId: 'tab-1',
      js: 'console.log("hi")',
    });
  });
});

describe('onInspectResult', () => {
  it('registers a preview:inspect-result listener and returns unlisten', () => {
    const unlistenFn = vi.fn();
    listen.mockResolvedValue(unlistenFn);
    onInspectResult(vi.fn());
    expect(listen).toHaveBeenCalledWith('preview:inspect-result', expect.any(Function));
  });

  it('forwards the event payload to the callback', async () => {
    const cb = vi.fn();
    listen.mockImplementation((_event, handler) => {
      handler({ payload: { tabId: 'tab-1', selector: 'div', rect: null, viewport: null } });
      return Promise.resolve(vi.fn());
    });
    await onInspectResult(cb);
    expect(cb).toHaveBeenCalledWith({
      tabId: 'tab-1',
      selector: 'div',
      rect: null,
      viewport: null,
    });
  });
});

describe('browser mode', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
    if (globalThis.window) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis.window as any).__TAURI_INTERNALS__;
    }
  });

  it('previewCreate throws in browser mode', async () => {
    await expect(previewCreate('t', 'http://x', { x: 0, y: 0, w: 1, h: 1 })).rejects.toThrow(/Tauri/);
  });

  it('previewCapture throws in browser mode', async () => {
    await expect(previewCapture('t')).rejects.toThrow(/Tauri/);
  });
});
