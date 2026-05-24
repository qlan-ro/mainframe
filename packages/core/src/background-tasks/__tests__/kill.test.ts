import { describe, it, expect, vi, beforeEach } from 'vitest';
import { killBackgroundTask } from '../kill.js';

vi.mock('tree-kill', () => ({
  default: vi.fn((pid: number, signal: string, cb: (err?: Error) => void) => cb()),
}));
import treeKill from 'tree-kill';

describe('killBackgroundTask', () => {
  const session = { stopBackgroundTask: vi.fn() };
  const tracker = { get: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    tracker.get.mockReturnValue({ id: 't1', status: 'running' });
  });

  it('returns ok when stop_task succeeds; does NOT fall back', async () => {
    session.stopBackgroundTask.mockResolvedValue({ ok: true });
    const result = await killBackgroundTask({
      chatId: 'c',
      taskId: 't1',
      session: session as any,
      tracker: tracker as any,
    });
    expect(result).toEqual({ ok: true, via: 'stop_task' });
    expect(treeKill).not.toHaveBeenCalled();
  });

  it('falls back to tree-kill when stop_task errors AND pid is known', async () => {
    session.stopBackgroundTask.mockResolvedValue({ ok: false, error: 'taskmgr offline' });
    tracker.get.mockReturnValue({ id: 't1', status: 'running', pid: 42 });
    const result = await killBackgroundTask({
      chatId: 'c',
      taskId: 't1',
      session: session as any,
      tracker: tracker as any,
    });
    expect(treeKill).toHaveBeenCalledWith(42, 'SIGKILL', expect.any(Function));
    expect(result).toEqual({ ok: true, via: 'tree_kill' });
  });

  it('reports failure when stop_task fails AND no pid is known', async () => {
    session.stopBackgroundTask.mockResolvedValue({ ok: false, error: 'timeout' });
    tracker.get.mockReturnValue({ id: 't1', status: 'running' }); // no pid
    const result = await killBackgroundTask({
      chatId: 'c',
      taskId: 't1',
      session: session as any,
      tracker: tracker as any,
    });
    expect(result).toEqual({ ok: false, error: 'timeout', via: 'none' });
  });

  it('returns 404-style result when task not in tracker', async () => {
    tracker.get.mockReturnValue(null);
    const result = await killBackgroundTask({
      chatId: 'c',
      taskId: 'ghost',
      session: session as any,
      tracker: tracker as any,
    });
    expect(result).toEqual({ ok: false, error: 'task not found', via: 'none' });
    expect(session.stopBackgroundTask).not.toHaveBeenCalled();
  });
});
