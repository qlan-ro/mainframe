import { describe, it, expect, vi } from 'vitest';
import { FakeHostBridge } from '../fake-adapter';

describe('FakeHostBridge — browser-mode stub parity', () => {
  it('fs.readFile resolves null', async () => {
    await expect(new FakeHostBridge().fs.readFile('/p')).resolves.toBeNull();
  });

  it('fs.readFileBase64 resolves null', async () => {
    await expect(new FakeHostBridge().fs.readFileBase64('/p')).resolves.toBeNull();
  });

  it('fs.showItemInFolder resolves undefined', async () => {
    await expect(new FakeHostBridge().fs.showItemInFolder('/p')).resolves.toBeUndefined();
  });

  it('app.platform resolves "browser"', async () => {
    await expect(new FakeHostBridge().app.platform()).resolves.toBe('browser');
  });

  it('app.getAuthToken resolves null', async () => {
    await expect(new FakeHostBridge().app.getAuthToken()).resolves.toBeNull();
  });

  it('app.getInfo resolves the dev stub', async () => {
    await expect(new FakeHostBridge().app.getInfo()).resolves.toEqual({
      version: 'dev',
      author: 'mainframe',
      homedir: '',
    });
  });

  it('daemon.status resolves "ready"', async () => {
    await expect(new FakeHostBridge().daemon.status()).resolves.toBe('ready');
  });

  it('daemon.onStatus fires "ready" immediately and returns a no-op unsubscribe', async () => {
    const cb = vi.fn();
    const unsub = await new FakeHostBridge().daemon.onStatus(cb);
    expect(cb).toHaveBeenCalledWith('ready');
    expect(() => unsub()).not.toThrow();
  });

  it('notify resolves undefined', async () => {
    await expect(new FakeHostBridge().notify('t', 'b')).resolves.toBeUndefined();
  });

  it('shell.openExternal calls window.open', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await new FakeHostBridge().shell.openExternal('https://x.test');
    expect(open).toHaveBeenCalledWith('https://x.test', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('log does not throw at any level', () => {
    const host = new FakeHostBridge();
    expect(() => host.log('debug', 'mod', 'msg')).not.toThrow();
    expect(() => host.log('error', 'mod', 'msg', { x: 1 })).not.toThrow();
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
