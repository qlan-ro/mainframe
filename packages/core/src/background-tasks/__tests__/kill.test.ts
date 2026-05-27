import { describe, it, expect, vi, beforeEach } from 'vitest';
import { killBackgroundTask } from '../kill.js';
import * as lsofMod from '../lsof.js';

vi.mock('tree-kill', () => ({
  default: vi.fn((_pid: number, _sig: string, cb: (err?: Error) => void) => cb()),
}));
import treeKill from 'tree-kill';

describe('killBackgroundTask', () => {
  const session = { stopBackgroundTask: vi.fn() };
  const tracker = { get: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    tracker.get.mockReturnValue({
      id: 't1',
      status: 'running',
      outputPath: '/tmp/claude-501/-x/sess/tasks/t1.output',
    });
  });

  it('returns ok via stop_task when CLI succeeds', async () => {
    session.stopBackgroundTask.mockResolvedValue({ ok: true });
    const r = await killBackgroundTask({ chatId: 'c', taskId: 't1', session: session as any, tracker: tracker as any });
    expect(r).toEqual({ ok: true, via: 'stop_task' });
    expect(treeKill).not.toHaveBeenCalled();
  });

  it('falls back to lsof + tree-kill when stop_task fails and a writer exists', async () => {
    session.stopBackgroundTask.mockResolvedValue({ ok: false, error: 'offline' });
    vi.spyOn(lsofMod, 'lsofWriters').mockResolvedValueOnce([42]).mockResolvedValueOnce([]);
    const r = await killBackgroundTask({ chatId: 'c', taskId: 't1', session: session as any, tracker: tracker as any });
    expect(treeKill).toHaveBeenCalledWith(42, 'SIGKILL', expect.any(Function));
    expect(r).toEqual({ ok: true, via: 'tree_kill' });
  });

  it('reports failure when no writer AND stop_task failed', async () => {
    session.stopBackgroundTask.mockResolvedValue({ ok: false, error: 'timeout' });
    vi.spyOn(lsofMod, 'lsofWriters').mockResolvedValueOnce([]);
    const r = await killBackgroundTask({ chatId: 'c', taskId: 't1', session: session as any, tracker: tracker as any });
    expect(r).toEqual({ ok: false, error: 'timeout', via: 'none' });
  });

  it('works without a session: goes straight to OS path', async () => {
    vi.spyOn(lsofMod, 'lsofWriters').mockResolvedValueOnce([99]).mockResolvedValueOnce([]);
    const r = await killBackgroundTask({ chatId: 'c', taskId: 't1', session: null, tracker: tracker as any });
    expect(session.stopBackgroundTask).not.toHaveBeenCalled();
    expect(treeKill).toHaveBeenCalledWith(99, 'SIGKILL', expect.any(Function));
    expect(r).toEqual({ ok: true, via: 'tree_kill' });
  });

  it('returns 404-style when task not in tracker', async () => {
    tracker.get.mockReturnValue(null);
    const r = await killBackgroundTask({
      chatId: 'c',
      taskId: 'ghost',
      session: session as any,
      tracker: tracker as any,
    });
    expect(r).toEqual({ ok: false, error: 'task not found', via: 'none' });
  });
});
