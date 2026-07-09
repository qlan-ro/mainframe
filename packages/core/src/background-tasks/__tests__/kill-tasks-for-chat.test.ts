import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { killTasksForChat } from '../kill.js';
import * as lsofMod from '../lsof.js';
import { BackgroundTaskTracker } from '../tracker.js';

vi.mock('tree-kill', () => ({
  default: vi.fn((_pid: number, _sig: string, cb: (err?: Error) => void) => cb()),
}));
import treeKill from 'tree-kill';

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readdir: vi.fn().mockResolvedValue([]),
    realpath: vi.fn(async (p: string) => p),
    lstat: vi.fn().mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false }),
  };
});

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execFile: vi.fn(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, result: { stdout: string }) => void) => {
        cb(null, { stdout: 'ps\n' });
        return {} as ReturnType<typeof import('node:child_process').execFile>;
      },
    ),
  };
});

function seed(tracker: BackgroundTaskTracker, chatId: string, id: string, outputPath: string) {
  tracker.start(
    chatId,
    { id, kind: 'bash', toolName: 'Bash', toolUseId: 'u', command: 'x', description: '' },
    outputPath,
  );
}

describe('killTasksForChat (CLI + OS, no sweep)', () => {
  let tracker: BackgroundTaskTracker;
  const session = { stopBackgroundTask: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    tracker = new BackgroundTaskTracker();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('CLI path: stop_task succeeds; tracker entries transition to stopped', async () => {
    seed(tracker, 'c1', 't1', '/tmp/claude-501/-x/sess/tasks/t1.output');
    seed(tracker, 'c1', 't2', '/tmp/claude-501/-x/sess/tasks/t2.output');
    session.stopBackgroundTask.mockResolvedValue({ ok: true });
    const p = killTasksForChat({ chatId: 'c1', session: session as any, tracker, spoolRoot: '/tmp/claude-501' });
    await vi.runAllTimersAsync();
    const out = await p;
    expect(out.killed.map((k) => k.taskId).sort()).toEqual(['t1', 't2']);
    expect(out.failed).toEqual([]);
    expect(tracker.listAllRunning()).toEqual([]);
  });

  it('OS path: no session, lsof returns writer, kill succeeds', async () => {
    seed(tracker, 'c1', 't1', '/tmp/claude-501/-x/sess/tasks/t1.output');
    vi.spyOn(lsofMod, 'lsofWriters').mockResolvedValueOnce([321]).mockResolvedValueOnce([]);
    const p = killTasksForChat({ chatId: 'c1', session: null, tracker, spoolRoot: '/tmp/claude-501' });
    await vi.runAllTimersAsync();
    const out = await p;
    expect(treeKill).toHaveBeenCalledWith(321, expect.stringMatching(/SIGTERM|SIGKILL/), expect.any(Function));
    expect(out.killed).toEqual([{ taskId: 't1', via: 'signal' }]);
    expect(tracker.get('c1', 't1')!.status).toBe('stopped');
  });

  it('OS path: no writer AND no session => entry stays running, reported in failed[]', async () => {
    seed(tracker, 'c1', 't1', '/tmp/claude-501/-x/sess/tasks/t1.output');
    vi.spyOn(lsofMod, 'lsofWriters').mockResolvedValue([]);
    const p = killTasksForChat({ chatId: 'c1', session: null, tracker, spoolRoot: '/tmp/claude-501' });
    await vi.runAllTimersAsync();
    const out = await p;
    expect(out.failed).toEqual([{ taskId: 't1', error: 'no live writer' }]);
    expect(tracker.get('c1', 't1')!.status).toBe('running');
  });
}, 15_000);

import { readdir, lstat } from 'node:fs/promises';

describe('killTasksForChat (worktree sweep)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('worktree sweep rejects symlinked spool files (does not lsof them)', async () => {
    (readdir as ReturnType<typeof vi.fn>).mockResolvedValueOnce(['sess-a']).mockResolvedValueOnce(['leftover.output']);
    (lstat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ isFile: () => true, isSymbolicLink: () => true });
    const lsofSpy = vi.spyOn(lsofMod, 'lsofWriters').mockResolvedValue([]);
    const tracker = new BackgroundTaskTracker();
    vi.useFakeTimers();
    const p = killTasksForChat({
      chatId: 'c1',
      worktreePath: '/Users/x/wt',
      session: null,
      tracker,
      spoolRoot: '/tmp/claude-501',
    });
    await vi.runAllTimersAsync();
    await p;
    vi.useRealTimers();
    expect(lsofSpy).not.toHaveBeenCalled();
  });

  it('scans spool-prefix dir, kills writer PIDs, filters daemon pid', async () => {
    (readdir as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(['sess-a', 'sess-b']) // <prefix> dirs
      .mockResolvedValueOnce(['leftover.output']) // sess-a/tasks
      .mockResolvedValueOnce([]); // sess-b/tasks
    (lstat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ isFile: () => true, isSymbolicLink: () => false });
    vi.spyOn(lsofMod, 'lsofWriters').mockResolvedValueOnce([999, process.pid]);
    const tracker = new BackgroundTaskTracker();
    vi.useFakeTimers();
    const p = killTasksForChat({
      chatId: 'c1',
      worktreePath: '/Users/x/wt',
      session: null,
      tracker,
      spoolRoot: '/tmp/claude-501',
    });
    await vi.runAllTimersAsync();
    const out = await p;
    vi.useRealTimers();
    expect(treeKill).toHaveBeenCalledWith(999, expect.anything(), expect.any(Function));
    expect(treeKill).not.toHaveBeenCalledWith(process.pid, expect.anything(), expect.anything());
    expect(out.swept.find((s) => s.pid === 999)).toBeDefined();
  });
});
