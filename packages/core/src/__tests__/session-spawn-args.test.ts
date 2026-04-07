import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Writable, Readable } from 'node:stream';

// Must be called before any import that uses child_process.spawn.
// vi.mock is hoisted to the top of the file by vitest.
const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({ spawn: spawnMock }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, accessSync: vi.fn() };
});

function makeMockChild() {
  const stdin = new Writable({
    write(_c, _e, cb) {
      cb();
    },
  });
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  return Object.assign(new EventEmitter(), { stdin, stdout, stderr, pid: 99999, kill: vi.fn() });
}

describe('ClaudeSession spawn args', () => {
  beforeEach(() => {
    spawnMock.mockReturnValue(makeMockChild());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  async function spawnWithMode(permissionMode: string | undefined): Promise<string[]> {
    const { ClaudeSession } = await import('../plugins/builtin/claude/session.js');
    const session = new ClaudeSession({ projectPath: '/tmp', chatId: undefined });
    await session.spawn({ permissionMode } as any).catch(() => {});
    return spawnMock.mock.calls[0]?.[1] as string[];
  }

  it('default mode passes --permission-mode default --allow-dangerously-skip-permissions', async () => {
    const args = await spawnWithMode('default');
    const modeIdx = args.indexOf('--permission-mode');
    expect(modeIdx).toBeGreaterThan(-1);
    expect(args[modeIdx + 1]).toBe('default');
    expect(args).toContain('--allow-dangerously-skip-permissions');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it('plan mode passes --permission-mode plan --allow-dangerously-skip-permissions', async () => {
    const args = await spawnWithMode('plan');
    const modeIdx = args.indexOf('--permission-mode');
    expect(args[modeIdx + 1]).toBe('plan');
    expect(args).toContain('--allow-dangerously-skip-permissions');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it('acceptEdits mode passes --permission-mode acceptEdits --allow-dangerously-skip-permissions', async () => {
    const args = await spawnWithMode('acceptEdits');
    const modeIdx = args.indexOf('--permission-mode');
    expect(args[modeIdx + 1]).toBe('acceptEdits');
    expect(args).toContain('--allow-dangerously-skip-permissions');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it('yolo mode passes --permission-mode bypassPermissions --allow-dangerously-skip-permissions', async () => {
    const args = await spawnWithMode('yolo');
    const modeIdx = args.indexOf('--permission-mode');
    expect(args[modeIdx + 1]).toBe('bypassPermissions');
    expect(args).toContain('--allow-dangerously-skip-permissions');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it('undefined permissionMode defaults to --permission-mode default', async () => {
    const args = await spawnWithMode(undefined);
    const modeIdx = args.indexOf('--permission-mode');
    expect(args[modeIdx + 1]).toBe('default');
    expect(args).toContain('--allow-dangerously-skip-permissions');
  });

  it('includes --append-system-prompt with Mainframe prompt by default', async () => {
    const { ClaudeSession } = await import('../plugins/builtin/claude/session.js');
    const { MAINFRAME_SYSTEM_PROMPT_APPEND } = await import('../plugins/builtin/claude/constants.js');
    const session = new ClaudeSession({ projectPath: '/tmp', chatId: undefined });
    await session.spawn({} as any).catch(() => {});
    const args = spawnMock.mock.calls[0]?.[1] as string[];
    const idx = args.indexOf('--append-system-prompt');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe(MAINFRAME_SYSTEM_PROMPT_APPEND);
  });

  it('omits --append-system-prompt when systemPrompt is disabled', async () => {
    const { ClaudeSession } = await import('../plugins/builtin/claude/session.js');
    const session = new ClaudeSession({ projectPath: '/tmp', chatId: undefined });
    await session.spawn({ systemPrompt: 'disabled' } as any).catch(() => {});
    const args = spawnMock.mock.calls[0]?.[1] as string[];
    expect(args).not.toContain('--append-system-prompt');
  });
});
