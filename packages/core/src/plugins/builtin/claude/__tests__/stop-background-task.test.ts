import { describe, it, expect, vi, afterEach } from 'vitest';
import { ClaudeSession } from '../session.js';

describe('ClaudeSession.stopBackgroundTask()', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns stdin-unavailable when child has no stdin', async () => {
    const session = new ClaudeSession({ projectPath: '/tmp' } as any);
    session.state.child = { stdin: undefined } as any;

    const result = await session.stopBackgroundTask('task-1');

    expect(result).toEqual({ ok: false, error: 'stdin unavailable' });
    expect(session.state.pendingStopTaskCallbacks.size).toBe(0);
  });

  it('returns stdin-unavailable when stdin is destroyed', async () => {
    const session = new ClaudeSession({ projectPath: '/tmp' } as any);
    session.state.child = { stdin: { destroyed: true, write: vi.fn() } } as any;

    const result = await session.stopBackgroundTask('task-2');

    expect(result).toEqual({ ok: false, error: 'stdin unavailable' });
    expect(session.state.pendingStopTaskCallbacks.size).toBe(0);
  });

  it('resolves timeout after 5s when no callback arrives', async () => {
    vi.useFakeTimers();
    const session = new ClaudeSession({ projectPath: '/tmp' } as any);
    const fakeStdin = { destroyed: false, write: vi.fn() };
    session.state.child = { stdin: fakeStdin } as any;

    const pending = session.stopBackgroundTask('task-3');

    // Callback registered, not yet resolved
    await Promise.resolve();
    expect(session.state.pendingStopTaskCallbacks.size).toBe(1);

    await vi.advanceTimersByTimeAsync(5001);
    const result = await pending;

    expect(result).toEqual({ ok: false, error: 'timeout' });
    expect(session.state.pendingStopTaskCallbacks.size).toBe(0);
  });

  it('resolves with ok:true when the pending callback is invoked', async () => {
    const session = new ClaudeSession({ projectPath: '/tmp' } as any);
    const fakeStdin = { destroyed: false, write: vi.fn() };
    session.state.child = { stdin: fakeStdin } as any;

    const pending = session.stopBackgroundTask('task-4');

    // Let the Promise executor run and register the callback
    await Promise.resolve();

    const entries = [...session.state.pendingStopTaskCallbacks.entries()];
    const entry = entries[0];
    expect(entry).toBeDefined();
    const [requestId, callback] = entry!;
    expect(requestId).toBeTruthy();

    // Simulate the event router (Task 4) invoking the callback.
    // The implementation clears the entry via clearTimeout but does not
    // explicitly delete it from the map — only the timeout path does that.
    callback({ ok: true });

    const result = await pending;
    expect(result).toEqual({ ok: true });
  });

  it('writes a JSON stop_task control_request to stdin', async () => {
    const session = new ClaudeSession({ projectPath: '/tmp' } as any);
    const writes: string[] = [];
    const fakeStdin = {
      destroyed: false,
      write: (data: string) => writes.push(data),
    };
    session.state.child = { stdin: fakeStdin } as any;

    // Start the call but don't await — we just want to inspect what was written
    const pending = session.stopBackgroundTask('task-5');

    await Promise.resolve();

    expect(writes).toHaveLength(1);
    const parsed = JSON.parse(writes[0]!);
    expect(parsed.type).toBe('control_request');
    expect(parsed.request.subtype).toBe('stop_task');
    expect(parsed.request.task_id).toBe('task-5');

    // Clean up: invoke the pending callback so the promise settles
    const cbEntry = [...session.state.pendingStopTaskCallbacks.entries()][0];
    cbEntry![1]({ ok: true });
    await pending;
  });
});
