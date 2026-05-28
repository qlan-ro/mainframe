import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runLivenessSweep, startLivenessScheduler, getMissCount, type MissMap } from '../liveness.js';
import * as lsofMod from '../lsof.js';
import { BackgroundTaskTracker } from '../tracker.js';

function seedRunning(tracker: BackgroundTaskTracker, chatId: string, id: string, outputPath: string) {
  tracker.start(chatId, { id, toolName: 'Bash', toolUseId: 'u', command: 'x', description: '' }, outputPath);
}

describe('runLivenessSweep (one tick)', () => {
  let tracker: BackgroundTaskTracker;
  let missMap: MissMap;
  beforeEach(() => {
    vi.clearAllMocks();
    tracker = new BackgroundTaskTracker();
    missMap = new Map();
  });

  it('skips tasks younger than GRACE_MS', async () => {
    seedRunning(tracker, 'c1', 't1', '/p/t1.out'); // startedAt = Date.now()
    const detailed = vi.spyOn(lsofMod, 'lsofWritersDetailed').mockResolvedValue({ ok: true, pids: [] });
    await runLivenessSweep({ tracker, missMap, now: Date.now(), forceWake: false });
    expect(detailed).not.toHaveBeenCalled();
    expect(tracker.get('c1', 't1')!.status).toBe('running');
  });

  it('two-strike grace: first empty observation does NOT end the task', async () => {
    seedRunning(tracker, 'c1', 't1', '/p/t1.out');
    const taskStart = tracker.get('c1', 't1')!.startedAt;
    vi.spyOn(lsofMod, 'lsofWritersDetailed').mockResolvedValue({ ok: true, pids: [] });
    await runLivenessSweep({ tracker, missMap, now: taskStart + 100_000, forceWake: false });
    expect(tracker.get('c1', 't1')!.status).toBe('running');
    expect(getMissCount(missMap, 'c1', 't1')).toBe(1);
  });

  it('two-strike grace: second consecutive empty observation ends the task', async () => {
    seedRunning(tracker, 'c1', 't1', '/p/t1.out');
    const taskStart = tracker.get('c1', 't1')!.startedAt;
    vi.spyOn(lsofMod, 'lsofWritersDetailed').mockResolvedValue({ ok: true, pids: [] });
    await runLivenessSweep({ tracker, missMap, now: taskStart + 100_000, forceWake: false });
    await runLivenessSweep({ tracker, missMap, now: taskStart + 160_000, forceWake: false });
    expect(tracker.get('c1', 't1')!.status).toBe('stopped');
    expect(tracker.get('c1', 't1')!.summary).toBe('process gone (liveness sweep)');
  });

  it('wake mode: one empty observation suffices', async () => {
    seedRunning(tracker, 'c1', 't1', '/p/t1.out');
    const taskStart = tracker.get('c1', 't1')!.startedAt;
    vi.spyOn(lsofMod, 'lsofWritersDetailed').mockResolvedValue({ ok: true, pids: [] });
    await runLivenessSweep({ tracker, missMap, now: taskStart + 100_000, forceWake: true });
    expect(tracker.get('c1', 't1')!.status).toBe('stopped');
  });

  it('{ok:false} from lsof: NO status change', async () => {
    seedRunning(tracker, 'c1', 't1', '/p/t1.out');
    const taskStart = tracker.get('c1', 't1')!.startedAt;
    vi.spyOn(lsofMod, 'lsofWritersDetailed').mockResolvedValue({ ok: false, error: 'lsof not installed' });
    await runLivenessSweep({ tracker, missMap, now: taskStart + 100_000, forceWake: true });
    await runLivenessSweep({ tracker, missMap, now: taskStart + 160_000, forceWake: true });
    expect(tracker.get('c1', 't1')!.status).toBe('running');
    expect(missMap.size).toBe(0);
  });

  it('live writer found: missCount reset + pid refreshed', async () => {
    seedRunning(tracker, 'c1', 't1', '/p/t1.out');
    const taskStart = tracker.get('c1', 't1')!.startedAt;
    vi.spyOn(lsofMod, 'lsofWritersDetailed')
      .mockResolvedValueOnce({ ok: true, pids: [] })
      .mockResolvedValueOnce({ ok: true, pids: [555] });
    await runLivenessSweep({ tracker, missMap, now: taskStart + 100_000, forceWake: false });
    expect(getMissCount(missMap, 'c1', 't1')).toBe(1);
    await runLivenessSweep({ tracker, missMap, now: taskStart + 160_000, forceWake: false });
    expect(getMissCount(missMap, 'c1', 't1')).toBe(0);
    expect(tracker.getPid('c1', 't1')).toBe(555);
  });
});

describe('startLivenessScheduler', () => {
  let tracker: BackgroundTaskTracker;
  beforeEach(() => {
    vi.useFakeTimers();
    tracker = new BackgroundTaskTracker();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('wake detection: wallclock jump > 2×TICK triggers immediate wake-mode sweep', async () => {
    const start = Date.now();
    seedRunning(tracker, 'c1', 't1', '/p/t1.out');
    // Make the task look old enough to be eligible immediately.
    const oldTask = tracker.get('c1', 't1')!;
    tracker.adopt('c1', { ...oldTask, startedAt: start - 200_000 });
    vi.spyOn(lsofMod, 'lsofWritersDetailed').mockResolvedValue({ ok: true, pids: [] });

    const sched = startLivenessScheduler({ tracker, intervalMs: 60_000 });
    // First tick at +60s: normal mode, one miss recorded but task remains running.
    vi.setSystemTime(start + 60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tracker.get('c1', 't1')!.status).toBe('running');

    // Jump 7 hours forward: scheduler treats next tick as wake.
    vi.setSystemTime(start + 60_000 + 7 * 3600 * 1000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tracker.get('c1', 't1')!.status).toBe('stopped');
    sched.stop();
  });

  it('stop() prevents further ticks', async () => {
    const detailed = vi.spyOn(lsofMod, 'lsofWritersDetailed').mockResolvedValue({ ok: true, pids: [] });
    const sched = startLivenessScheduler({ tracker, intervalMs: 60_000 });
    sched.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(detailed).not.toHaveBeenCalled();
  });
});
