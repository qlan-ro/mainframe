import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

const spawnSpy = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnSpy(...args),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    accessSync: vi.fn(),
  };
});

// Import AFTER the mocks above so they take effect.
const { ClaudeSession } = await import('../plugins/builtin/claude/session.js');

function fakeChildProcess(): ChildProcess {
  const ee = new EventEmitter() as unknown as ChildProcess;
  (ee as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
  (ee as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
  (ee as unknown as { stdin: { write: (s: string) => void; destroyed: boolean } }).stdin = {
    write: () => {},
    destroyed: false,
  };
  (ee as unknown as { pid: number }).pid = 42;
  return ee;
}

describe('ClaudeSession spawn args', () => {
  beforeEach(() => {
    spawnSpy.mockReset();
    spawnSpy.mockImplementation(() => fakeChildProcess());
  });

  it('passes --replay-user-messages so the CLI emits isReplay acks for queued uuids', async () => {
    const session = new ClaudeSession({ projectPath: '/tmp', chatId: undefined });
    await session.spawn();

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const args = spawnSpy.mock.calls[0][1] as string[];
    expect(args).toContain('--replay-user-messages');
    // Sanity check: still uses stream-json mode (the flag's prerequisite)
    expect(args).toContain('--input-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--output-format');
  });

  it('passes --permission-mode plan when planMode=true', async () => {
    const session = new ClaudeSession({ projectPath: '/tmp', chatId: undefined });
    await session.spawn({ planMode: true, permissionMode: 'acceptEdits' });

    const args = spawnSpy.mock.calls[0][1] as string[];
    expect(args).toContain('--permission-mode');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('plan');
  });

  it('passes --permission-mode <base> when planMode=false', async () => {
    const session = new ClaudeSession({ projectPath: '/tmp', chatId: undefined });
    await session.spawn({ planMode: false, permissionMode: 'acceptEdits' });

    const args = spawnSpy.mock.calls[0][1] as string[];
    expect(args).toContain('--permission-mode');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('acceptEdits');
  });
});
