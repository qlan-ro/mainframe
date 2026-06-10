import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reconcileBackgroundTasks } from '../reconcile.js';
import * as lsofMod from '../lsof.js';
import { BackgroundTaskTracker } from '../tracker.js';

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readdir: vi.fn(),
    realpath: vi.fn(async (p: string) => p),
    lstat: vi.fn(),
    stat: vi.fn(),
  };
});
import { readdir, lstat, stat } from 'node:fs/promises';

function makeChat(claudeSessionId: string, worktreePath: string | null = null, projectId = 'p1') {
  return { id: `chat-${claudeSessionId}`, projectId, claudeSessionId, worktreePath, status: 'active' } as any;
}
function makeDb(chats: any[], projects: Record<string, string>) {
  return {
    chats: { listAll: () => chats },
    projects: { get: (id: string) => ({ path: projects[id], id }) },
  } as any;
}
// Passthrough validator — bypasses uid-dependent makeSpoolValidator in tests.
const ALWAYS_VALID = vi.fn(async () => true);

describe('reconcileBackgroundTasks', () => {
  let tracker: BackgroundTaskTracker;
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset once-queues so leftover mockResolvedValueOnce values don't bleed across tests.
    (readdir as ReturnType<typeof vi.fn>).mockReset();
    (lstat as ReturnType<typeof vi.fn>).mockReset();
    (stat as ReturnType<typeof vi.fn>).mockReset();
    tracker = new BackgroundTaskTracker();
    (lstat as ReturnType<typeof vi.fn>).mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false });
    (stat as ReturnType<typeof vi.fn>).mockResolvedValue({ ctimeMs: 1000, mtimeMs: 2000 });
  });

  it('hydrates a running task when lsofWriters finds a writer', async () => {
    const db = makeDb([makeChat('sess1')], { p1: '/Users/x/proj' });
    (readdir as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(['-Users-x-proj'])
      .mockResolvedValueOnce(['sess1'])
      .mockResolvedValueOnce(['tkid01.output']);
    vi.spyOn(lsofMod, 'lsofWriters').mockResolvedValueOnce([777]);

    await reconcileBackgroundTasks({ tracker, db, spoolRoot: '/tmp/claude-501', validator: ALWAYS_VALID });

    const list = tracker.list('chat-sess1');
    expect(list).toHaveLength(1);
    expect(list[0]!).toMatchObject({
      status: 'running',
      recovered: true,
      outputPath: '/tmp/claude-501/-Users-x-proj/sess1/tasks/tkid01.output',
      startedAt: 1000,
      endedAt: null,
    });
    expect(tracker.getPid('chat-sess1', 'tkid01')).toBe(777);
  });

  it('marks stopped when no writer; endedAt = mtime', async () => {
    const db = makeDb([makeChat('sess1')], { p1: '/Users/x/proj' });
    (readdir as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(['-Users-x-proj'])
      .mockResolvedValueOnce(['sess1'])
      .mockResolvedValueOnce(['tkid01.output']);
    vi.spyOn(lsofMod, 'lsofWriters').mockResolvedValueOnce([]);
    await reconcileBackgroundTasks({ tracker, db, spoolRoot: '/tmp/claude-501', validator: ALWAYS_VALID });
    const t = tracker.list('chat-sess1')[0]!;
    expect(t.status).toBe('stopped');
    expect(t.endedAt).toBe(2000);
    expect(t.summary).toBe('recovered after daemon restart');
  });

  it('emits events for recovered tasks so live clients update after async reconciliation', async () => {
    const db = makeDb([makeChat('sess-running'), makeChat('sess-stopped')], { p1: '/Users/x/proj' });
    (readdir as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(['-Users-x-proj'])
      .mockResolvedValueOnce(['sess-running', 'sess-stopped'])
      .mockResolvedValueOnce(['run001.output'])
      .mockResolvedValueOnce(['stop01.output']);
    vi.spyOn(lsofMod, 'lsofWriters').mockResolvedValueOnce([777]).mockResolvedValueOnce([]);
    const events: Array<{ kind: string; chatId: string; taskId: string }> = [];
    tracker.on('background_task.started', (chatId, task) => events.push({ kind: 'started', chatId, taskId: task.id }));
    tracker.on('background_task.ended', (chatId, task) => events.push({ kind: 'ended', chatId, taskId: task.id }));

    await reconcileBackgroundTasks({ tracker, db, spoolRoot: '/tmp/claude-501', validator: ALWAYS_VALID });

    expect(events).toEqual([
      { kind: 'started', chatId: 'chat-sess-running', taskId: 'run001' },
      { kind: 'ended', chatId: 'chat-sess-stopped', taskId: 'stop01' },
    ]);
  });

  it('skips unknown claudeSessionId', async () => {
    const db = makeDb([makeChat('sess-known')], { p1: '/Users/x/proj' });
    (readdir as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(['-Users-x-proj'])
      .mockResolvedValueOnce(['sess-other'])
      .mockResolvedValueOnce(['tkid01.output']);
    await reconcileBackgroundTasks({ tracker, db, spoolRoot: '/tmp/claude-501', validator: ALWAYS_VALID });
    expect(tracker.list('chat-sess-known')).toEqual([]);
  });

  it('skips when encoded cwd does not match (provenance)', async () => {
    const db = makeDb([makeChat('sess1')], { p1: '/Users/x/proj' });
    (readdir as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(['-fake-spoof'])
      .mockResolvedValueOnce(['sess1'])
      .mockResolvedValueOnce(['tkid01.output']);
    await reconcileBackgroundTasks({ tracker, db, spoolRoot: '/tmp/claude-501', validator: ALWAYS_VALID });
    expect(tracker.list('chat-sess1')).toEqual([]);
  });

  it('rejects symlinks via lstat', async () => {
    const db = makeDb([makeChat('sess1')], { p1: '/Users/x/proj' });
    (readdir as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(['-Users-x-proj'])
      .mockResolvedValueOnce(['sess1'])
      .mockResolvedValueOnce(['tkid01.output']);
    (lstat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ isFile: () => true, isSymbolicLink: () => true });
    await reconcileBackgroundTasks({ tracker, db, spoolRoot: '/tmp/claude-501', validator: ALWAYS_VALID });
    expect(tracker.list('chat-sess1')).toEqual([]);
  });

  it('skips invalid task_id basenames', async () => {
    const db = makeDb([makeChat('sess1')], { p1: '/Users/x/proj' });
    (readdir as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(['-Users-x-proj'])
      .mockResolvedValueOnce(['sess1'])
      .mockResolvedValueOnce(['BAD..ID.output']);
    await reconcileBackgroundTasks({ tracker, db, spoolRoot: '/tmp/claude-501', validator: ALWAYS_VALID });
    expect(tracker.list('chat-sess1')).toEqual([]);
  });

  it('respects the injected SpoolValidator — rejected files are not adopted', async () => {
    const db = makeDb([makeChat('sess1')], { p1: '/Users/x/proj' });
    (readdir as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(['-Users-x-proj'])
      .mockResolvedValueOnce(['sess1'])
      .mockResolvedValueOnce(['tkid01.output']);
    const validator = vi.fn(async () => false);
    await reconcileBackgroundTasks({ tracker, db, spoolRoot: '/tmp/claude-501', validator });
    expect(validator).toHaveBeenCalledWith('/tmp/claude-501/-Users-x-proj/sess1/tasks/tkid01.output', 'tkid01');
    expect(tracker.list('chat-sess1')).toEqual([]);
  });
});
