// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { FakeHostBridge } from '../fake-adapter';

describe('FakeHostBridge — browser-mode stub parity', () => {
  it.each([
    { name: 'fs.readFile resolves null', call: (h: FakeHostBridge) => h.fs.readFile('/p'), expected: null },
    { name: 'fs.readFileBase64 resolves null', call: (h: FakeHostBridge) => h.fs.readFileBase64('/p'), expected: null },
    {
      name: 'fs.showItemInFolder resolves undefined',
      call: (h: FakeHostBridge) => h.fs.showItemInFolder('/p'),
      expected: undefined,
    },
    { name: 'app.platform resolves "browser"', call: (h: FakeHostBridge) => h.app.platform(), expected: 'browser' },
    { name: 'app.getAuthToken resolves null', call: (h: FakeHostBridge) => h.app.getAuthToken(), expected: null },
    {
      name: 'app.getInfo resolves the dev stub',
      call: (h: FakeHostBridge) => h.app.getInfo(),
      expected: { version: 'dev', author: 'mainframe', homedir: '' },
    },
    { name: 'daemon.status resolves "ready"', call: (h: FakeHostBridge) => h.daemon.status(), expected: 'ready' },
    { name: 'notify resolves undefined', call: (h: FakeHostBridge) => h.notify('t', 'b'), expected: undefined },
    {
      name: 'updates.check resolves not-available',
      call: (h: FakeHostBridge) => h.updates.check(),
      expected: { state: 'not-available' },
    },
    {
      name: 'updates.download resolves undefined',
      call: (h: FakeHostBridge) => h.updates.download(),
      expected: undefined,
    },
    {
      name: 'presence.reportActivity resolves undefined',
      call: (h: FakeHostBridge) => h.presence.reportActivity('idle'),
      expected: undefined,
    },
  ])('$name', async ({ call, expected }) => {
    await expect(call(new FakeHostBridge())).resolves.toEqual(expected);
  });

  it('daemon.onStatus fires "ready" immediately and returns a no-op unsubscribe', async () => {
    const cb = vi.fn();
    const unsub = await new FakeHostBridge().daemon.onStatus(cb);
    expect(cb).toHaveBeenCalledWith('ready');
    expect(() => unsub()).not.toThrow();
  });

  it('updates.onStatus fires not-available and returns a no-op unsubscribe', async () => {
    const cb = vi.fn();
    const unsub = await new FakeHostBridge().updates.onStatus(cb);
    expect(cb).toHaveBeenCalledWith({ state: 'not-available' });
    expect(() => unsub()).not.toThrow();
  });

  it('shell.openExternal calls window.open', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await new FakeHostBridge().shell.openExternal('https://x.test');
    expect(open).toHaveBeenCalledWith('https://x.test', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('sync stubs (log, updates.install) do not throw', () => {
    const host = new FakeHostBridge();
    expect(() => host.log('debug', 'mod', 'msg')).not.toThrow();
    expect(() => host.log('error', 'mod', 'msg', { x: 1 })).not.toThrow();
    expect(() => host.updates.install()).not.toThrow();
  });
});

describe('FakeHostBridge — overrides', () => {
  it('app.getInfo honors an override', async () => {
    const host = new FakeHostBridge({ app: { getInfo: { version: '9.9.9', author: 'q', homedir: '/h' } } });
    await expect(host.app.getInfo()).resolves.toEqual({ version: '9.9.9', author: 'q', homedir: '/h' });
  });

  it('fs.readFile honors an override', async () => {
    const host = new FakeHostBridge({ fs: { readFile: 'file-contents' } });
    await expect(host.fs.readFile('/p')).resolves.toBe('file-contents');
  });

  it('daemon.port honors an override', async () => {
    const host = new FakeHostBridge({ daemon: { port: 31500 } });
    await expect(host.daemon.port()).resolves.toBe(31500);
  });
});
