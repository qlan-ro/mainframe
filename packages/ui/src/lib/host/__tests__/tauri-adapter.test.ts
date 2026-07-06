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

  it('preview.mount returns a handle (delegates to the Tauri backend)', async () => {
    const { TauriAdapter } = await import('../tauri-adapter');
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
    const handle = new TauriAdapter().preview.mount(container, 'http://x', { projectId: 'p' });
    expect(typeof handle.setVisible).toBe('function');
    expect(typeof handle.destroy).toBe('function');
  });
});

describe('TauriAdapter — init installs the drag listener', () => {
  it('mousedown on a [data-drag-region] triggers startDragging', async () => {
    const { TauriAdapter } = await import('../tauri-adapter');
    new TauriAdapter().init();
    const region = document.createElement('div');
    region.setAttribute('data-drag-region', '');
    document.body.appendChild(region);
    region.dispatchEvent(new MouseEvent('mousedown', { button: 0, detail: 1, bubbles: true }));
    expect(startDragging).toHaveBeenCalled();
    region.remove();
  });
});

describe('TauriAdapter — updates + presence', () => {
  it('updates.check invokes updater_check', async () => {
    const { TauriAdapter } = await import('../tauri-adapter');
    invoke.mockResolvedValueOnce({ state: 'available', version: '2.0.0' });
    await expect(new TauriAdapter().updates.check()).resolves.toEqual({ state: 'available', version: '2.0.0' });
    expect(invoke).toHaveBeenCalledWith('updater_check');
  });
  it('presence.reportActivity invokes report_activity', async () => {
    const { TauriAdapter } = await import('../tauri-adapter');
    await new TauriAdapter().presence.reportActivity('idle');
    expect(invoke).toHaveBeenCalledWith('report_activity', { state: 'idle' });
  });
});

describe('TauriAdapter — log forwarding (host_log)', () => {
  it('log forwards to host_log invoke in Tauri mode', async () => {
    const { TauriAdapter } = await import('../tauri-adapter');
    invoke.mockResolvedValue(undefined);
    new TauriAdapter().log('info', 'test-module', 'hello world');
    // invoke is fire-and-forget; allow the micro-task to flush.
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledWith('host_log', {
      level: 'info',
      module: 'test-module',
      message: 'hello world',
      data: null,
    });
  });

  it('log passes data payload to host_log', async () => {
    const { TauriAdapter } = await import('../tauri-adapter');
    invoke.mockResolvedValue(undefined);
    new TauriAdapter().log('warn', 'auth', 'token expired', { code: 401 });
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledWith('host_log', {
      level: 'warn',
      module: 'auth',
      message: 'token expired',
      data: { code: 401 },
    });
  });
});

describe('TauriAdapter — terminal ArrayBuffer wrapping', () => {
  it('delivers an ArrayBuffer from the data Channel as a Uint8Array to onData', async () => {
    const { TauriAdapter } = await import('../tauri-adapter');
    const onData = vi.fn();
    const onExit = vi.fn();

    // Capture Channel instances created during terminal_create invocation.
    // terminal.ts constructs the dataChannel before calling invoke, then passes
    // it as the `onData` arg. After invoke resolves, dataChannel.onmessage is
    // already assigned by the lib/tauri/terminal.ts code path.
    let capturedDataChannel: { onmessage: ((m: unknown) => void) | null } | null = null;
    invoke.mockImplementationOnce((...args: unknown[]) => {
      const [cmd, params] = args as [string, Record<string, unknown>];
      if (cmd === 'terminal_create') {
        capturedDataChannel = params['onData'] as { onmessage: ((m: unknown) => void) | null };
      }
      return Promise.resolve(undefined);
    });

    await new TauriAdapter().terminal.create({ id: 'test-1', cwd: '/tmp', cols: 80, rows: 24 }, { onData, onExit });

    expect(capturedDataChannel).not.toBeNull();
    const buf = new Uint8Array([104, 105]).buffer;
    capturedDataChannel!.onmessage!(buf);

    expect(onData).toHaveBeenCalledTimes(1);
    const firstCall = onData.mock.calls[0];
    expect(firstCall).toBeDefined();
    const received = firstCall![0] as Uint8Array;
    expect(received).toBeInstanceOf(Uint8Array);
    expect(Array.from(received)).toEqual([104, 105]);
  });
});
