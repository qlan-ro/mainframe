import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers = new Map<string, (...a: unknown[]) => unknown>();
const sent: Array<{ channel: string; args: unknown[] }> = [];
const onDataCbs: Array<(d: string) => void> = [];
const onExitCbs: Array<(e: { exitCode: number }) => void> = [];

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn) },
}));
vi.mock('node-pty', () => ({
  default: {
    spawn: () => ({
      onData: (cb: (d: string) => void) => onDataCbs.push(cb),
      onExit: (cb: (e: { exitCode: number }) => void) => onExitCbs.push(cb),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    }),
  },
}));
vi.mock('node:fs', () => ({
  default: { statSync: () => ({ isDirectory: () => true }) },
  statSync: () => ({ isDirectory: () => true }),
}));
vi.mock('../logger.js', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

beforeEach(() => {
  handlers.clear();
  sent.length = 0;
  onDataCbs.length = 0;
  onExitCbs.length = 0;
});

function fakeEvent() {
  return {
    sender: {
      id: 1,
      isDestroyed: () => false,
      send: (channel: string, ...args: unknown[]) => sent.push({ channel, args }),
    },
  };
}

describe('terminal-manager — bytes over IPC, caller-supplied id', () => {
  it('uses the caller-supplied id and sends terminal:data as a Buffer', async () => {
    const { setupTerminalIPC } = await import('../terminal-manager.js');
    setupTerminalIPC({ SHELL: '/bin/zsh' });
    const create = handlers.get('terminal:create')!;
    const result = (await create(fakeEvent(), { id: 'caller-id', cwd: '/tmp', cols: 80, rows: 24 })) as {
      id: string;
    };
    expect(result.id).toBe('caller-id');

    onDataCbs[0]!('hi');
    const dataMsg = sent.find((s) => s.channel === 'terminal:data');
    expect(dataMsg).toBeDefined();
    expect(dataMsg!.args[0]).toBe('caller-id');
    expect(Buffer.isBuffer(dataMsg!.args[1])).toBe(true);
    expect((dataMsg!.args[1] as Buffer).toString('utf-8')).toBe('hi');
  });

  it('sends terminal:exit with the id and exit code', async () => {
    const { setupTerminalIPC } = await import('../terminal-manager.js');
    setupTerminalIPC({ SHELL: '/bin/zsh' });
    const create = handlers.get('terminal:create')!;
    await create(fakeEvent(), { id: 'caller-id', cwd: '/tmp', cols: 80, rows: 24 });
    onExitCbs[0]!({ exitCode: 0 });
    const exitMsg = sent.find((s) => s.channel === 'terminal:exit');
    expect(exitMsg).toBeDefined();
    expect(exitMsg!.args).toEqual(['caller-id', 0]);
  });

  it('sends each PTY chunk as a Buffer so the receiver can do stateful UTF-8 decoding', async () => {
    const { setupTerminalIPC } = await import('../terminal-manager.js');
    setupTerminalIPC({ SHELL: '/bin/zsh' });
    const create = handlers.get('terminal:create')!;
    await create(fakeEvent(), { id: 'mb-id', cwd: '/tmp', cols: 80, rows: 24 });

    // node-pty yields strings; two reads that together spell a multi-byte sequence
    const chunk1 = 'hello ';
    const chunk2 = 'héllo'; // é is U+00E9 — 2 bytes in UTF-8

    onDataCbs[0]!(chunk1);
    onDataCbs[0]!(chunk2);

    const dataMsgs = sent.filter((s) => s.channel === 'terminal:data' && s.args[0] === 'mb-id');
    expect(dataMsgs).toHaveLength(2);

    // Each chunk arrives as a Buffer (bytes) — the receiver (xterm) can apply a
    // stateful TextDecoder and handle sequences that span chunk boundaries.
    const buf1 = dataMsgs[0]!.args[1] as Buffer;
    const buf2 = dataMsgs[1]!.args[1] as Buffer;
    expect(Buffer.isBuffer(buf1)).toBe(true);
    expect(Buffer.isBuffer(buf2)).toBe(true);
    expect(buf1.toString('utf-8')).toBe(chunk1);
    expect(buf2.toString('utf-8')).toBe(chunk2);

    // Concatenated buffers decode to the original content without corruption
    const combined = Buffer.concat([buf1, buf2]);
    expect(combined.toString('utf-8')).toBe(chunk1 + chunk2);
  });
});
