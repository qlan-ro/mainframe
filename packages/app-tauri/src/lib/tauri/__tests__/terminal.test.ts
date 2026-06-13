import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — FakeChannel must be defined in vi.hoisted so the vi.mock factory
// can reference it after hoisting (class declarations are NOT hoisted).
// ---------------------------------------------------------------------------

const { FakeChannel, invokeMock } = vi.hoisted(() => {
  class FakeChannelClass<T = unknown> {
    onmessage: ((msg: T) => void) | null = null;
    static instances: FakeChannelClass[] = [];
    constructor() {
      FakeChannelClass.instances.push(this as unknown as FakeChannelClass<unknown>);
    }
  }
  return {
    FakeChannel: FakeChannelClass,
    invokeMock: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: FakeChannel,
}));

// Force IS_TAURI true for the duration of this file.
beforeEach(() => {
  (globalThis as Record<string, unknown>).window = Object.assign(globalThis.window ?? {}, {
    __TAURI_INTERNALS__: {},
  });
  invokeMock.mockClear();
  FakeChannel.instances = [];
});

import { createTerminal } from '../terminal';

describe('createTerminal', () => {
  it('invokes terminal_create with the two channels and the size/cwd args', async () => {
    await createTerminal({ id: 't1', cwd: '/wd', cols: 80, rows: 24 }, { onData: vi.fn(), onExit: vi.fn() });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = invokeMock.mock.calls[0]!;
    expect(cmd).toBe('terminal_create');
    expect(args).toMatchObject({ id: 't1', cwd: '/wd', cols: 80, rows: 24 });
    expect(args.onData).toBeInstanceOf(FakeChannel);
    expect(args.onExit).toBeInstanceOf(FakeChannel);
  });

  it('wraps raw ArrayBuffer output as Uint8Array for onData', async () => {
    const onData = vi.fn();
    await createTerminal({ id: 't1', cwd: '/wd', cols: 80, rows: 24 }, { onData, onExit: vi.fn() });
    const rawCh = FakeChannel.instances[0]!; // first constructed = data channel
    rawCh.onmessage?.(new Uint8Array([65, 66]).buffer);
    expect(onData).toHaveBeenCalledTimes(1);
    const arg = onData.mock.calls[0]![0];
    expect(arg).toBeInstanceOf(Uint8Array);
    expect(Array.from(arg as Uint8Array)).toEqual([65, 66]);
  });

  it('forwards exit code to onExit', async () => {
    const onExit = vi.fn();
    await createTerminal({ id: 't1', cwd: '/wd', cols: 80, rows: 24 }, { onData: vi.fn(), onExit });
    const exitCh = FakeChannel.instances[1]!; // second constructed = exit channel
    exitCh.onmessage?.({ code: 0 });
    expect(onExit).toHaveBeenCalledWith(0);
  });

  it('rejects in browser mode (no __TAURI_INTERNALS__)', async () => {
    delete (globalThis.window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    await expect(
      createTerminal({ id: 't1', cwd: '/wd', cols: 80, rows: 24 }, { onData: vi.fn(), onExit: vi.fn() }),
    ).rejects.toThrow();
  });
});
