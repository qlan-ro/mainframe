import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const invoke = vi.fn();
const listen = vi.fn();
const openUrl = vi.fn();
const sendNotification = vi.fn();
const startDragging = vi.fn().mockResolvedValue(undefined);

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invoke(...a),
  Channel: class {
    onmessage: ((m: unknown) => void) | null = null;
  },
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: (...a: unknown[]) => listen(...a) }));
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ startDragging }),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: (...a: unknown[]) => openUrl(...a) }));
vi.mock('@tauri-apps/plugin-notification', () => ({
  sendNotification: (...a: unknown[]) => sendNotification(...a),
}));

beforeEach(() => {
  (globalThis as Record<string, unknown>).window = Object.assign(globalThis.window ?? {}, {
    __TAURI_INTERNALS__: {},
  });
  invoke.mockReset().mockResolvedValue(undefined);
  listen.mockReset().mockResolvedValue(() => {});
  openUrl.mockReset();
  sendNotification.mockReset();
  startDragging.mockClear();
});

afterEach(() => {
  delete (globalThis.window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe('TauriAdapter — delegation', () => {
  it('app.getInfo invokes get_app_info', async () => {
    const { TauriAdapter } = await import('../tauri-adapter');
    invoke.mockResolvedValueOnce({ version: '1.0', author: 'q', homedir: '/h' });
    await expect(new TauriAdapter().app.getInfo()).resolves.toEqual({
      version: '1.0',
      author: 'q',
      homedir: '/h',
    });
    expect(invoke).toHaveBeenCalledWith('get_app_info');
  });

  it('fs.readFile invokes read_file', async () => {
    const { TauriAdapter } = await import('../tauri-adapter');
    invoke.mockResolvedValueOnce('contents');
    await expect(new TauriAdapter().fs.readFile('/p')).resolves.toBe('contents');
    expect(invoke).toHaveBeenCalledWith('read_file', { path: '/p' });
  });

  it('shell.openExternal delegates to openUrl', async () => {
    const { TauriAdapter } = await import('../tauri-adapter');
    await new TauriAdapter().shell.openExternal('https://x.test');
    expect(openUrl).toHaveBeenCalledWith('https://x.test');
  });

  it('daemon.port invokes get_daemon_port', async () => {
    const { TauriAdapter } = await import('../tauri-adapter');
    invoke.mockResolvedValueOnce(31500);
    await expect(new TauriAdapter().daemon.port()).resolves.toBe(31500);
    expect(invoke).toHaveBeenCalledWith('get_daemon_port');
  });

  it('preview.capture wraps the invoke number[] in a Uint8Array', async () => {
    const { TauriAdapter } = await import('../tauri-adapter');
    invoke.mockResolvedValueOnce([137, 80, 78, 71]);
    const bytes = await new TauriAdapter().preview.capture('tab-1');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([137, 80, 78, 71]);
  });
});

describe('TauriAdapter — init installs the drag listener', () => {
  it('mousedown on a [data-tauri-drag-region] triggers startDragging', async () => {
    const { TauriAdapter } = await import('../tauri-adapter');
    new TauriAdapter().init();
    const region = document.createElement('div');
    region.setAttribute('data-tauri-drag-region', '');
    document.body.appendChild(region);
    region.dispatchEvent(new MouseEvent('mousedown', { button: 0, detail: 1, bubbles: true }));
    expect(startDragging).toHaveBeenCalled();
    region.remove();
  });
});
