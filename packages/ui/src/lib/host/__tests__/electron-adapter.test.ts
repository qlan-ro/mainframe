import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ElectronAdapter } from '../electron-adapter';

interface FakeMainframe {
  platform: string;
  getAppInfo: ReturnType<typeof vi.fn>;
  getHomedir: ReturnType<typeof vi.fn>;
  getAuthToken: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
  readFileBase64: ReturnType<typeof vi.fn>;
  showItemInFolder: ReturnType<typeof vi.fn>;
  openExternal: ReturnType<typeof vi.fn>;
  showNotification: ReturnType<typeof vi.fn>;
  clearSandboxSession: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
  terminal: {
    create: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
    onData: ReturnType<typeof vi.fn>;
    onExit: ReturnType<typeof vi.fn>;
  };
  daemon: {
    port: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
    onStatus: ReturnType<typeof vi.fn>;
  };
  updates: {
    check: ReturnType<typeof vi.fn>;
    download: ReturnType<typeof vi.fn>;
    install: ReturnType<typeof vi.fn>;
    onStatus: ReturnType<typeof vi.fn>;
  };
}

let mf: FakeMainframe;
let dataCbs: Array<(id: string, data: Uint8Array) => void>;
let exitCbs: Array<(id: string, code: number | null) => void>;

beforeEach(() => {
  dataCbs = [];
  exitCbs = [];
  mf = {
    platform: 'darwin',
    getAppInfo: vi.fn().mockResolvedValue({ version: '1.0', author: 'q', homedir: '/h' }),
    getHomedir: vi.fn().mockResolvedValue('/h'),
    getAuthToken: vi.fn().mockResolvedValue('secret'),
    readFile: vi.fn().mockResolvedValue('text'),
    readFileBase64: vi.fn().mockResolvedValue('YmFzZTY0'),
    showItemInFolder: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn().mockResolvedValue(undefined),
    showNotification: vi.fn().mockResolvedValue(undefined),
    clearSandboxSession: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
    terminal: {
      create: vi.fn().mockResolvedValue({ id: 't1' }),
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      kill: vi.fn().mockResolvedValue(undefined),
      onData: vi.fn((cb: (id: string, data: Uint8Array) => void) => {
        dataCbs.push(cb);
        return () => {};
      }),
      onExit: vi.fn((cb: (id: string, code: number | null) => void) => {
        exitCbs.push(cb);
        return () => {};
      }),
    },
    daemon: {
      port: vi.fn().mockResolvedValue(31415),
      status: vi.fn().mockResolvedValue('ready'),
      onStatus: vi.fn((cb: (s: string) => void) => {
        cb('ready');
        return () => {};
      }),
    },
    updates: {
      check: vi.fn().mockResolvedValue({ state: 'not-available' }),
      download: vi.fn().mockResolvedValue(undefined),
      install: vi.fn(),
      onStatus: vi.fn((cb: (s: unknown) => void) => {
        cb({ state: 'checking' });
        return () => {};
      }),
    },
  };
  (globalThis as unknown as { window: { mainframe: FakeMainframe } }).window = Object.assign(globalThis.window ?? {}, {
    mainframe: mf,
  });
});

afterEach(() => {
  delete (globalThis.window as unknown as Record<string, unknown>).mainframe;
});

describe('ElectronAdapter — delegation', () => {
  it('app.platform maps darwin → macos', async () => {
    await expect(new ElectronAdapter().app.platform()).resolves.toBe('macos');
  });

  it('app.getInfo delegates to getAppInfo', async () => {
    await expect(new ElectronAdapter().app.getInfo()).resolves.toEqual({
      version: '1.0',
      author: 'q',
      homedir: '/h',
    });
  });

  it('app.getAuthToken delegates', async () => {
    await expect(new ElectronAdapter().app.getAuthToken()).resolves.toBe('secret');
  });

  it('fs.readFileBase64 delegates', async () => {
    await expect(new ElectronAdapter().fs.readFileBase64('/p')).resolves.toBe('YmFzZTY0');
  });

  it('daemon.port/status/onStatus delegate', async () => {
    const a = new ElectronAdapter();
    await expect(a.daemon.port()).resolves.toBe(31415);
    await expect(a.daemon.status()).resolves.toBe('ready');
    const cb = vi.fn();
    const unsub = await a.daemon.onStatus(cb);
    expect(cb).toHaveBeenCalledWith('ready');
    expect(() => unsub()).not.toThrow();
  });
});

describe('ElectronAdapter — terminal demux', () => {
  it('routes terminal:data to the matching handle only, as a Uint8Array', async () => {
    const a = new ElectronAdapter();
    const onData1 = vi.fn();
    const onExit1 = vi.fn();
    const onData2 = vi.fn();
    const onExit2 = vi.fn();
    mf.terminal.create.mockResolvedValueOnce({ id: 't1' });
    await a.terminal.create({ id: 't1', cwd: '/tmp', cols: 80, rows: 24 }, { onData: onData1, onExit: onExit1 });
    mf.terminal.create.mockResolvedValueOnce({ id: 't2' });
    await a.terminal.create({ id: 't2', cwd: '/tmp', cols: 80, rows: 24 }, { onData: onData2, onExit: onExit2 });

    const bytes = new Uint8Array([104, 105]);
    dataCbs.forEach((cb) => cb('t1', bytes));
    expect(onData1).toHaveBeenCalledWith(bytes);
    expect(onData2).not.toHaveBeenCalled();

    exitCbs.forEach((cb) => cb('t2', 0));
    expect(onExit2).toHaveBeenCalledWith(0);
    expect(onExit1).not.toHaveBeenCalled();
  });
});

describe('ElectronAdapter — log', () => {
  it('forwards to window.mainframe.log', () => {
    new ElectronAdapter().log('info', 'mod', 'msg', { a: 1 });
    expect(mf.log).toHaveBeenCalledWith('info', 'mod', 'msg', { a: 1 });
  });
});

describe('ElectronAdapter — kill stops delivery', () => {
  it('kill() stops further data delivery for that handle', async () => {
    const a = new ElectronAdapter();
    const onData1 = vi.fn();
    mf.terminal.create.mockResolvedValueOnce({ id: 't1' });
    const handle = await a.terminal.create(
      { id: 't1', cwd: '/tmp', cols: 80, rows: 24 },
      { onData: onData1, onExit: vi.fn() },
    );
    await handle.kill();
    const bytes = new Uint8Array([1, 2, 3]);
    dataCbs.forEach((cb) => cb('t1', bytes));
    expect(onData1).not.toHaveBeenCalled();
  });
});

describe('ElectronAdapter — preview', () => {
  it('clearSession delegates to clearSandboxSession', async () => {
    await new ElectronAdapter().preview.clearSession('p1');
    expect(mf.clearSandboxSession).toHaveBeenCalledWith('p1');
  });
});

describe('ElectronAdapter — updates + presence', () => {
  it('updates.check delegates to window.mainframe.updates.check', async () => {
    await expect(new ElectronAdapter().updates.check()).resolves.toEqual({ state: 'not-available' });
    expect(mf.updates.check).toHaveBeenCalled();
  });
  it('updates.onStatus subscribes and replays', async () => {
    const cb = vi.fn();
    await new ElectronAdapter().updates.onStatus(cb);
    expect(cb).toHaveBeenCalledWith({ state: 'checking' });
  });
  it('presence.reportActivity POSTs to the daemon device/activity endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    mf.daemon.port.mockResolvedValueOnce(31415);
    await new ElectronAdapter().presence.reportActivity('idle');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:31415/api/device/activity',
      expect.objectContaining({ method: 'POST' }),
    );
    fetchSpy.mockRestore();
  });
});
